#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appRoot = join(repoRoot, 'astraxml');
const logsRoot = join(appRoot, 'logs');
const devLogsRoot = join(logsRoot, 'dev');
const statePath = join(logsRoot, 'launcher-state.json');

const args = new Set(process.argv.slice(2));
const options = {
  dryRun: args.has('--dry-run'),
  verbose: args.has('--verbose') || process.env.ASTRAXML_LAUNCHER_VERBOSE === '1',
  forceInstall: args.has('--force-install'),
  json: args.has('--json') || process.env.ASTRAXML_LAUNCHER_JSON === '1',
  help: args.has('--help') || args.has('-h'),
};

const sessionStartedAt = new Date();
const sessionId = formatFileTimestamp(sessionStartedAt);
const sessionLogPath = join(devLogsRoot, `dev-session-${sessionId}.log`);
const startupState = createStartupState(sessionStartedAt);

let sessionStream;
let activeChild = null;
let shutdownRequested = false;

const COLORS = {
  STEP: '\u001b[36m',
  INFO: '\u001b[34m',
  OK: '\u001b[32m',
  WARN: '\u001b[33m',
  ERR: '\u001b[31m',
  RAW: '\u001b[90m',
  reset: '\u001b[0m',
};

main().catch((error) => {
  log('ERR', 'Launcher', error instanceof Error ? error.message : String(error));
  closeSessionLog();
  process.exit(1);
});

async function main() {
  if (options.help) {
    printHelp();
    return;
  }

  ensureDir(devLogsRoot);
  sessionStream = createWriteStream(sessionLogPath, { flags: 'a' });
  writeSessionHeader();
  installSignalHandlers();

  const manifests = collectManifestFiles();
  if (!existsSync(join(appRoot, 'package.json'))) {
    throw new Error(`Could not find package.json in ${appRoot}`);
  }

  const toolchain = collectToolchain();
  log('INFO', 'Workspace', appRoot, {
    event: 'workspace_detected',
    data: { repoRoot, appRoot },
  });
  log('OK', 'Toolchain', `Node ${toolchain.node} | npm ${normalizeVersionText(toolchain.npm, 'npm')} | cargo ${normalizeVersionText(toolchain.cargo, 'cargo')} | rustc ${normalizeVersionText(toolchain.rustc, 'rustc')}` , {
    event: 'toolchain_detected',
    data: toolchain,
  });
  log('INFO', 'Session', `Raw output is being captured in ${sessionLogPath}`, {
    event: 'session_log_ready',
    data: { sessionId, sessionLogPath },
  });

  const state = readState();
  const fingerprint = computeFingerprint(manifests);
  const shouldInstall = options.forceInstall || !dependenciesAreCurrent(state, fingerprint);

  if (options.dryRun) {
    log('STEP', 'DryRun', shouldInstall ? 'npm install would run before launch.' : 'Dependencies are current; npm install would be skipped.', {
      event: shouldInstall ? 'dependency_install_would_run' : 'dependency_install_skipped',
      data: {
        shouldInstall,
        dryRun: true,
      },
    });
    if (state?.installSummary) {
      emitInstallSummary(state.installSummary, true);
    }
    log('STEP', 'DryRun', 'Tauri dev launch is skipped in dry-run mode.', {
      event: 'dry_run_complete',
    });
    closeSessionLog();
    return;
  }

  if (shouldInstall) {
    await runDependencyInstall(toolchain, fingerprint);
  } else {
    startupState.dependencies.status = 'skipped';
    log('OK', 'Dependencies', `Current manifests unchanged (${fingerprint.label}); skipping npm install.`, {
      event: 'dependency_install_skipped',
      data: {
        fingerprint: fingerprint.hash,
        fingerprintLabel: fingerprint.label,
      },
    });
    if (state?.installSummary) {
      emitInstallSummary(state.installSummary, true);
    }
  }

  startupState.frontend.commandStartedAtMs = Date.now();
  log('STEP', 'Frontend', 'Starting Vite and Tauri dev services...', {
    event: 'tauri_dev_starting',
  });
  await runTauriDev();
}

function printHelp() {
  const lines = [
    'AstraXML structured dev launcher',
    '',
    'Usage:',
    '  node scripts/dev-launcher.mjs [--dry-run] [--verbose] [--force-install] [--json]',
    '',
    'Flags:',
    '  --dry-run        Validate toolchain and manifest state without starting Tauri.',
    '  --verbose        Stream raw child-process lines to the console as well as the session log.',
    '  --force-install  Run npm install even when manifests are unchanged.',
    '  --json           Emit newline-delimited JSON events for CI/tasks and diagnostics.',
  ];

  for (const line of lines) {
    console.log(line);
  }
}

function collectManifestFiles() {
  const packageJsonPath = join(appRoot, 'package.json');
  const packageLockPath = join(appRoot, 'package-lock.json');
  const manifests = [packageJsonPath];
  if (existsSync(packageLockPath)) {
    manifests.push(packageLockPath);
  }
  return manifests;
}

function collectToolchain() {
  const npm = getCommandVersion('npm');
  const cargo = getCommandVersion('cargo');
  const rustc = getCommandVersion('rustc');

  const missing = [];
  if (!npm) missing.push('npm');
  if (!cargo) missing.push('cargo');
  if (!rustc) missing.push('rustc');

  if (missing.length > 0) {
    throw new Error(`Missing required tools: ${missing.join(', ')}. Install Node.js and Rust, then try again.`);
  }

  return {
    node: process.version,
    npm,
    cargo,
    rustc,
  };
}

function getCommandVersion(commandName) {
  const invocation = buildCommandInvocation(commandName, ['--version']);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: appRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return text.split(/\r?\n/, 1)[0] ?? null;
}

function resolveCommand(commandName) {
  if (process.platform !== 'win32') {
    return commandName;
  }

  if (commandName === 'npm') {
    return 'npm.cmd';
  }

  if (commandName === 'npx') {
    return 'npx.cmd';
  }

  return commandName;
}

function buildCommandInvocation(commandName, commandArgs) {
  if (process.platform === 'win32' && (commandName === 'npm' || commandName === 'npx')) {
    const commandLine = [commandName, ...commandArgs].map(quoteForCmd).join(' ');
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
    };
  }

  return {
    command: resolveCommand(commandName),
    args: commandArgs,
  };
}

function quoteForCmd(arg) {
  if (arg.length === 0) {
    return '""';
  }

  if (!/[\s"&()<>^|]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '""')}"`;
}

function ensureDir(targetPath) {
  mkdirSync(targetPath, { recursive: true });
}

function computeFingerprint(paths) {
  const hash = createHash('sha1');
  const labels = [];

  for (const path of paths) {
    labels.push(path.replace(`${appRoot}\\`, '').replace(`${appRoot}/`, ''));
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }

  return {
    hash: hash.digest('hex'),
    label: labels.join(', '),
  };
}

function dependenciesAreCurrent(state, fingerprint) {
  if (!existsSync(join(appRoot, 'node_modules'))) {
    return false;
  }

  if (!state) {
    return false;
  }

  return state.fingerprint === fingerprint.hash;
}

function readState() {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(payload) {
  ensureDir(logsRoot);
  writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function runDependencyInstall(toolchain, fingerprint) {
  startupState.dependencies.status = 'running';
  startupState.dependencies.startedAtMs = Date.now();
  log('STEP', 'Dependencies', options.forceInstall
    ? 'Force-install requested; running npm install.'
    : `Manifest change detected (${fingerprint.label}); running npm install.`, {
    event: 'dependency_install_started',
    data: {
      forceInstall: options.forceInstall,
      fingerprint: fingerprint.hash,
      fingerprintLabel: fingerprint.label,
    },
  });

  const startedAt = Date.now();
  const { code, signal, stdout, stderr } = await runBufferedCommand('npm', ['install', '--no-progress'], 'npm-install');
  const finishedAt = Date.now();
  const summary = parseInstallSummary(`${stdout}\n${stderr}`, startedAt, finishedAt);

  if (code !== 0) {
    log('ERR', 'Dependencies', `npm install failed with exit code ${formatExit(code, signal)}.`);
    printTail(`${stdout}\n${stderr}`);
    throw new Error(`See ${sessionLogPath} for the full npm install output.`);
  }

  startupState.dependencies.status = 'completed';
  startupState.dependencies.completedAtMs = finishedAt;
  startupState.dependencies.durationMs = finishedAt - startedAt;
  startupState.dependencies.durationText = summary.durationText;
  emitInstallSummary(summary, false);
  writeState({
    fingerprint: fingerprint.hash,
    fingerprintLabel: fingerprint.label,
    installedAt: new Date().toISOString(),
    toolchain,
    installSummary: summary,
  });
}

function emitInstallSummary(summary, fromCache) {
  const prefix = fromCache ? 'Last install' : 'Install';
  const auditedText = summary.auditedPackages
    ? `${prefix.toLowerCase()} audited ${summary.auditedPackages} packages in ${summary.durationText}.`
    : `${prefix.toLowerCase()} completed in ${summary.durationText}.`;

  log('INFO', 'Dependencies', capitalize(auditedText), {
    event: fromCache ? 'dependency_install_cached_summary' : 'dependency_install_complete',
    data: summary,
  });

  if (summary.changeSummary) {
    log('INFO', 'Dependencies', summary.changeSummary, {
      event: 'dependency_install_changes',
      data: { changeSummary: summary.changeSummary },
    });
  }

  if (summary.fundingCount > 0) {
    log('INFO', 'Funding', `${summary.fundingCount} packages are looking for funding.`, {
      event: 'dependency_funding_notice',
      data: { fundingCount: summary.fundingCount },
    });
  }

  if (summary.vulnerabilities.length > 0) {
    log('WARN', 'Security', `${formatVulnerabilities(summary.vulnerabilities)} reported by npm audit.`, {
      event: 'dependency_audit_warning',
      data: { vulnerabilities: summary.vulnerabilities },
    });
    log('INFO', 'Security', 'Run npm audit fix if you want npm to attempt remediation.', {
      event: 'dependency_audit_fix_hint',
    });
  } else if (summary.auditRan) {
    log('OK', 'Security', 'npm audit reported 0 vulnerabilities.', {
      event: 'dependency_audit_clean',
      data: { vulnerabilities: [] },
    });
  }
}

function parseInstallSummary(output, startedAt, finishedAt) {
  const sanitized = output.replace(/\r/g, '');
  const auditedMatch = sanitized.match(/audited\s+(\d+)\s+packages?\s+in\s+([^\n]+)/i);
  const fundingMatch = sanitized.match(/(\d+)\s+packages?\s+are looking for funding/i);
  const addedMatch = sanitized.match(/added\s+(\d+)\s+packages?/i);
  const removedMatch = sanitized.match(/removed\s+(\d+)\s+packages?/i);
  const changedMatch = sanitized.match(/changed\s+(\d+)\s+packages?/i);
  const vulnerabilityMatches = [...sanitized.matchAll(/(\d+)\s+(low|moderate|high|critical)\s+severity vulnerabilities?/gi)];
  const auditRan = /audited\s+\d+\s+packages?/i.test(sanitized) || /found 0 vulnerabilities/i.test(sanitized);

  const changeParts = [];
  if (addedMatch) changeParts.push(`added ${addedMatch[1]}`);
  if (removedMatch) changeParts.push(`removed ${removedMatch[1]}`);
  if (changedMatch) changeParts.push(`changed ${changedMatch[1]}`);

  return {
    auditedPackages: auditedMatch ? Number(auditedMatch[1]) : null,
    durationText: auditedMatch ? auditedMatch[2].trim() : formatDuration(finishedAt - startedAt),
    durationMs: finishedAt - startedAt,
    fundingCount: fundingMatch ? Number(fundingMatch[1]) : 0,
    vulnerabilities: vulnerabilityMatches.map((match) => ({
      count: Number(match[1]),
      severity: match[2].toLowerCase(),
    })),
    auditRan,
    changeSummary: changeParts.length > 0 ? `Package changes: ${changeParts.join(', ')}.` : '',
  };
}

async function runTauriDev() {
  const invocation = buildCommandInvocation('npm', ['run', 'tauri', 'dev']);
  const child = spawn(invocation.command, invocation.args, {
    cwd: appRoot,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  activeChild = child;
  const state = {
    viteReadyDuration: '',
    burstPassthrough: 0,
  };

  attachLineReaders(child, {
    stdout: (line) => handleDevLine(line, 'stdout', state),
    stderr: (line) => handleDevLine(line, 'stderr', state),
  });

  const { code, signal } = await waitForExit(child);
  activeChild = null;

  if (signal && shutdownRequested) {
    log('INFO', 'Shutdown', 'AstraXML dev session stopped by user request.', {
      event: 'shutdown_requested',
    });
  } else if (code === 0) {
    log('OK', 'Shutdown', 'AstraXML dev session ended cleanly.', {
      event: 'shutdown_clean',
    });
  } else {
    log('ERR', 'Shutdown', `tauri dev exited with ${formatExit(code, signal)}. Full details are in ${sessionLogPath}.`, {
      event: 'shutdown_failed',
      data: { exitCode: code, signal, sessionLogPath },
    });
    closeSessionLog();
    process.exit(code ?? 1);
  }

  closeSessionLog();
}

function handleDevLine(line, source, state) {
  writeChildLine(source, line);
  const normalizedLine = normalizeConsoleLine(line);

  if (options.verbose) {
    logRaw(source.toUpperCase(), normalizedLine);
    return;
  }

  const trimmed = normalizedLine.trim();
  if (!trimmed) {
    return;
  }

  if (state.burstPassthrough > 0) {
    logRaw(source.toUpperCase(), trimmed);
    state.burstPassthrough -= 1;
    return;
  }

  if (/^>\s+astraxml@/i.test(trimmed) || /^>\s+vite$/i.test(trimmed) || /^>\s+tauri\s+/i.test(trimmed)) {
    return;
  }

  if (/^Running BeforeDevCommand/i.test(trimmed)) {
    startupState.frontend.bootStartedAtMs ??= Date.now();
    log('STEP', 'Frontend', 'Vite dev server booting...', {
      event: 'vite_booting',
    });
    return;
  }

  if (/^Running DevCommand/i.test(trimmed)) {
    startupState.backend.bootStartedAtMs ??= Date.now();
    log('STEP', 'Backend', 'Cargo dev process booting...', {
      event: 'cargo_dev_booting',
    });
    return;
  }

  const viteMatch = trimmed.match(/VITE\s+v[\d.]+\s+ready in\s+(.+)/i);
  if (viteMatch) {
    state.viteReadyDuration = viteMatch[1].trim();
    startupState.frontend.readyDurationText = state.viteReadyDuration;
    startupState.frontend.readyDurationMs = parseDurationTextToMs(state.viteReadyDuration);
    return;
  }

  const localMatch = trimmed.match(/Local:\s+(https?:\/\/\S+)/i);
  if (localMatch) {
    startupState.frontend.readyAtMs ??= Date.now();
    const durationSuffix = state.viteReadyDuration ? ` (${state.viteReadyDuration})` : '';
    log('OK', 'Frontend', `Vite ready at ${localMatch[1]}${durationSuffix}.`, {
      event: 'vite_ready',
      data: {
        url: localMatch[1],
        durationText: state.viteReadyDuration || null,
        durationMs: startupState.frontend.readyDurationMs,
      },
    });
    return;
  }

  const watchMatch = trimmed.match(/^Info\s+Watching\s+(.+)\s+for changes/i);
  if (watchMatch) {
    startupState.backend.watchingAtMs ??= Date.now();
    log('INFO', 'Backend', `Watching ${watchMatch[1]} for changes.`, {
      event: 'cargo_watch_ready',
      data: { path: watchMatch[1] },
    });
    return;
  }

  const frontendWaitMatch = trimmed.match(/^Warn\s+Waiting for your frontend dev server to start on\s+(https?:\/\/\S+)/i);
  if (frontendWaitMatch) {
    log('INFO', 'Frontend', `Waiting for Vite at ${trimTrailingEllipsis(frontendWaitMatch[1])}...`, {
      event: 'vite_waiting',
      data: { url: trimTrailingEllipsis(frontendWaitMatch[1]) },
    });
    return;
  }

  const compilingMatch = trimmed.match(/^Compiling\s+(.+)/);
  if (compilingMatch) {
    startupState.backend.compileStartedAtMs ??= Date.now();
    log('STEP', 'Backend', `Compiling ${compilingMatch[1]}.`, {
      event: 'rust_compile_started',
      data: { target: compilingMatch[1] },
    });
    return;
  }

  const finishedMatch = trimmed.match(/^Finished\s+.*?\s+in\s+([^\n]+)$/i);
  if (finishedMatch) {
    startupState.backend.compileFinishedAtMs ??= Date.now();
    startupState.backend.buildDurationText = finishedMatch[1].trim();
    startupState.backend.buildDurationMs = parseDurationTextToMs(startupState.backend.buildDurationText);
    log('OK', 'Backend', `Rust dev build finished in ${finishedMatch[1].trim()}.`, {
      event: 'rust_compile_finished',
      data: {
        durationText: startupState.backend.buildDurationText,
        durationMs: startupState.backend.buildDurationMs,
      },
    });
    return;
  }

  const runningMatch = trimmed.match(/^Running\s+`(.+astraxml(?:\.exe)?)`/i);
  if (runningMatch) {
    startupState.desktopLaunchedAtMs ??= Date.now();
    log('OK', 'Desktop', `Launched ${runningMatch[1]}.`, {
      event: 'desktop_launched',
      data: { target: runningMatch[1] },
    });
    emitStartupSummaryIfReady();
    return;
  }

  if (isBenignShutdownNoise(trimmed)) {
    log(shutdownRequested ? 'INFO' : 'WARN', 'Desktop', trimmed);
    return;
  }

  if (isErrorLine(trimmed)) {
    log('ERR', 'Dev', trimmed);
    state.burstPassthrough = 12;
    return;
  }

  if (isWarnLine(trimmed)) {
    log('WARN', 'Dev', trimmed);
    state.burstPassthrough = 4;
  }
}

function isErrorLine(line) {
  return /^npm ERR!/i.test(line)
    || /^error(\[[A-Z0-9]+\])?:/i.test(line)
    || /^error:/i.test(line)
    || /^Error:/i.test(line)
    || /\bfailed\b/i.test(line)
    || /panicked at/i.test(line)
    || /^thread '.*' panicked/i.test(line);
}

function isWarnLine(line) {
  return /^warning(\[[A-Z0-9]+\])?:/i.test(line)
    || /^warn:/i.test(line)
    || /^WARN\b/i.test(line);
}

function isBenignShutdownNoise(line) {
  return /Failed to unregister class Chrome_WidgetWin_0\. Error = 1412/i.test(line);
}

function attachLineReaders(child, handlers) {
  if (child.stdout) {
    child.stdout.setEncoding('utf8');
    const consumeStdout = createLineConsumer('stdout', handlers.stdout);
    child.stdout.on('data', consumeStdout.push);
    child.stdout.on('end', consumeStdout.flush);
  }

  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    const consumeStderr = createLineConsumer('stderr', handlers.stderr);
    child.stderr.on('data', consumeStderr.push);
    child.stderr.on('end', consumeStderr.flush);
  }
}

function createLineConsumer(source, onLine) {
  let remainder = '';

  return {
    push(chunk) {
      remainder += chunk;
      let splitIndex = remainder.indexOf('\n');
      while (splitIndex >= 0) {
        const line = remainder.slice(0, splitIndex).replace(/\r$/, '');
        remainder = remainder.slice(splitIndex + 1);
        onLine(line, source);
        splitIndex = remainder.indexOf('\n');
      }
    },
    flush() {
      if (remainder.length > 0) {
        onLine(remainder.replace(/\r$/, ''), source);
        remainder = '';
      }
    },
  };
}

async function runBufferedCommand(commandName, commandArgs, rawLabel) {
  const invocation = buildCommandInvocation(commandName, commandArgs);
  const child = spawn(invocation.command, invocation.args, {
    cwd: appRoot,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  activeChild = child;
  let stdout = '';
  let stderr = '';

  attachLineReaders(child, {
    stdout: (line) => {
      stdout += `${line}\n`;
      writeChildLine(rawLabel, line);
      if (options.verbose) {
        logRaw('NPM', line);
      }
    },
    stderr: (line) => {
      stderr += `${line}\n`;
      writeChildLine(rawLabel, line);
      if (options.verbose) {
        logRaw('NPM', line);
      }
    },
  });

  const { code, signal } = await waitForExit(child);
  activeChild = null;
  return { code, signal, stdout, stderr };
}

function waitForExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

function installSignalHandlers() {
  process.on('SIGINT', () => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    log('WARN', 'Shutdown', 'Ctrl+C received; forwarding shutdown to child process...');
    if (activeChild) {
      activeChild.kill('SIGINT');
      setTimeout(() => {
        if (activeChild) {
          activeChild.kill();
        }
      }, 2000).unref();
    } else {
      closeSessionLog();
      process.exit(130);
    }
  });
}

function writeSessionHeader() {
  writeSession(`[${sessionStartedAt.toISOString()}] SESSION START`);
  writeSession(`[${sessionStartedAt.toISOString()}] REPO ${repoRoot}`);
  writeSession(`[${sessionStartedAt.toISOString()}] APP ${appRoot}`);
  writeSession(`[${sessionStartedAt.toISOString()}] OPTIONS ${JSON.stringify(options)}`);
}

function writeChildLine(source, line) {
  writeSession(`[${new Date().toISOString()}] ${source.toUpperCase().padEnd(10)} ${line}`);
}

function writeSession(line) {
  if (sessionStream) {
    sessionStream.write(`${line}\n`);
  }
}

function closeSessionLog() {
  if (sessionStream) {
    sessionStream.end();
    sessionStream = null;
  }
}

function formatExit(code, signal) {
  if (signal) {
    return `signal ${signal}`;
  }
  return `exit code ${code ?? 1}`;
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function formatVulnerabilities(vulnerabilities) {
  return vulnerabilities
    .map((entry) => `${entry.count} ${entry.severity}`)
    .join(', ');
}

function printTail(output) {
  const tail = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-12);

  if (tail.length === 0) {
    return;
  }

  log('INFO', 'Tail', 'Last npm output lines:', {
    event: 'diagnostic_tail',
  });
  for (const line of tail) {
    logRaw('NPM', line);
  }
}

function log(status, label, message, meta = {}) {
  const now = new Date();
  const timestamp = formatClock(now);
  const statusToken = padRight(status, 4);
  const labelToken = padRight(label, 12);
  const consoleLine = `[${timestamp}] ${colorizeStatus(statusToken, status)} ${labelToken} ${message}`;
  const sessionLine = `[${now.toISOString()}] ${statusToken} ${labelToken} ${message}`;

  if (options.json) {
    console.log(JSON.stringify(buildJsonLogRecord(now, status, label, message, meta)));
  } else {
    console.log(consoleLine);
  }
  writeSession(sessionLine);
}

function logRaw(label, message, meta = {}) {
  const now = new Date();
  const timestamp = formatClock(now);
  const labelToken = padRight(label, 12);
  const consoleLine = `[${timestamp}] ${colorizeStatus('RAW ', 'RAW')} ${labelToken} ${message}`;

  if (options.json) {
    console.log(JSON.stringify(buildJsonLogRecord(now, 'RAW', label, message, {
      event: meta.event ?? 'raw_output',
      data: meta.data,
      raw: true,
    })));
  } else {
    console.log(consoleLine);
  }
}

function buildJsonLogRecord(now, status, label, message, meta = {}) {
  return {
    schemaVersion: 1,
    type: 'astraxml.launcher.log',
    timestamp: now.toISOString(),
    sessionId,
    status,
    label,
    message,
    event: meta.event ?? null,
    data: meta.data,
    raw: meta.raw ?? false,
  };
}

function colorizeStatus(text, status) {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `${COLORS[status] ?? ''}${text}${COLORS.reset}`;
}

function padRight(text, width) {
  return text.padEnd(width, ' ');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function createStartupState(startedAt) {
  return {
    sessionStartedAtMs: startedAt.getTime(),
    desktopLaunchedAtMs: null,
    summaryEmitted: false,
    dependencies: {
      status: 'pending',
      startedAtMs: null,
      completedAtMs: null,
      durationMs: null,
      durationText: null,
    },
    frontend: {
      commandStartedAtMs: null,
      bootStartedAtMs: null,
      readyAtMs: null,
      readyDurationMs: null,
      readyDurationText: null,
    },
    backend: {
      bootStartedAtMs: null,
      watchingAtMs: null,
      compileStartedAtMs: null,
      compileFinishedAtMs: null,
      buildDurationMs: null,
      buildDurationText: null,
    },
  };
}

function emitStartupSummaryIfReady() {
  if (startupState.summaryEmitted || !startupState.desktopLaunchedAtMs) {
    return;
  }

  const totalMs = startupState.desktopLaunchedAtMs - startupState.sessionStartedAtMs;
  const dependencyDurationMs = startupState.dependencies.status === 'completed'
    ? startupState.dependencies.durationMs
    : null;
  const viteReadyMs = startupState.frontend.readyDurationMs
    ?? diffMs(startupState.frontend.bootStartedAtMs ?? startupState.frontend.commandStartedAtMs, startupState.frontend.readyAtMs);
  const watchReadyMs = diffMs(startupState.backend.bootStartedAtMs, startupState.backend.watchingAtMs);
  const rustBuildMs = startupState.backend.buildDurationMs
    ?? diffMs(startupState.backend.compileStartedAtMs ?? startupState.backend.bootStartedAtMs, startupState.backend.compileFinishedAtMs);

  const summaryLine = [
    `total=${formatDuration(totalMs)}`,
    `deps=${formatDependencyTiming(startupState.dependencies.status, dependencyDurationMs)}`,
    `vite=${formatOptionalDuration(viteReadyMs)}`,
    `watch=${formatOptionalDuration(watchReadyMs)}`,
    `rust=${formatOptionalDuration(rustBuildMs)}`,
  ].join(' | ');

  log('OK', 'Summary', `Startup summary: ${summaryLine}`, {
    event: 'startup_summary',
    data: {
      totalTimeToDesktopMs: totalMs,
      dependencies: {
        status: startupState.dependencies.status,
        durationMs: dependencyDurationMs,
      },
      phaseTimingsMs: {
        viteReady: viteReadyMs,
        cargoWatch: watchReadyMs,
        rustBuild: rustBuildMs,
      },
      sessionLogPath,
    },
  });

  startupState.summaryEmitted = true;
}

function normalizeConsoleLine(line) {
  return stripAnsi(line)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\s+/g, ' ')
    .trimEnd();
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function trimTrailingEllipsis(text) {
  return text.replace(/\.\.\.$/, '');
}

function normalizeVersionText(text, toolName) {
  return text.replace(new RegExp(`^${toolName}\\s+`, 'i'), '');
}

function formatClock(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatFileTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function diffMs(startMs, endMs) {
  if (typeof startMs !== 'number' || typeof endMs !== 'number') {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

function formatDependencyTiming(status, durationMs) {
  if (status === 'skipped') {
    return 'skipped';
  }
  if (status === 'completed' && typeof durationMs === 'number') {
    return formatDuration(durationMs);
  }
  return 'n/a';
}

function formatOptionalDuration(durationMs) {
  return typeof durationMs === 'number' ? formatDuration(durationMs) : 'n/a';
}

function parseDurationTextToMs(text) {
  if (!text) {
    return null;
  }

  const match = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  return match[2] === 's' ? Math.round(value * 1000) : Math.round(value);
}