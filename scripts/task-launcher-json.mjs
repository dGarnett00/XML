#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appRoot = join(repoRoot, 'astraxml');
const taskLogsRoot = join(appRoot, 'logs', 'tasks');

const wrapperStartedAt = new Date();
const wrapperSessionId = formatFileTimestamp(wrapperStartedAt);
const latestArtifactPath = join(taskLogsRoot, 'launcher-task-latest.ndjson');
const runArtifactPath = join(taskLogsRoot, `launcher-task-${wrapperSessionId}.ndjson`);
const launcherPath = join(repoRoot, 'scripts', 'dev-launcher.mjs');
const forwardedArgs = process.argv.slice(2);

let child = null;

main().catch((error) => {
  emitWrapperEvent('task_wrapper_failed', 'ERR', 'Task', error instanceof Error ? error.message : String(error), {
    artifactPath: runArtifactPath,
    latestArtifactPath,
  });
  process.exit(1);
});

async function main() {
  ensureDir(taskLogsRoot);
  writeFileSync(runArtifactPath, '', 'utf8');
  writeFileSync(latestArtifactPath, '', 'utf8');

  emitWrapperEvent('task_artifact_ready', 'INFO', 'Task', `Writing launcher NDJSON to ${runArtifactPath}`, {
    artifactPath: runArtifactPath,
    latestArtifactPath,
    forwardedArgs,
  });

  installSignalHandlers();

  const childArgs = [launcherPath, '--json', ...forwardedArgs];
  child = spawn(process.execPath, childArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  attachStream(child.stdout, 'stdout');
  attachStream(child.stderr, 'stderr');

  const exit = await waitForExit(child);
  child = null;

  if (exit.signal) {
    emitWrapperEvent('task_wrapper_exit', 'WARN', 'Task', `Wrapper observed launcher exit via signal ${exit.signal}.`, {
      signal: exit.signal,
      artifactPath: runArtifactPath,
      latestArtifactPath,
    });
    process.exit(1);
  }

  emitWrapperEvent('task_wrapper_exit', exit.code === 0 ? 'OK' : 'ERR', 'Task', `Wrapper finished with exit code ${exit.code ?? 1}.`, {
    exitCode: exit.code ?? 1,
    artifactPath: runArtifactPath,
    latestArtifactPath,
  });
  process.exit(exit.code ?? 1);
}

function ensureDir(targetPath) {
  mkdirSync(targetPath, { recursive: true });
}

function attachStream(stream, source) {
  if (!stream) {
    return;
  }

  stream.setEncoding('utf8');
  const consumer = createLineConsumer((line) => handleLine(line, source));
  stream.on('data', consumer.push);
  stream.on('end', consumer.flush);
}

function createLineConsumer(onLine) {
  let remainder = '';

  return {
    push(chunk) {
      remainder += chunk;
      let splitIndex = remainder.indexOf('\n');
      while (splitIndex >= 0) {
        const line = remainder.slice(0, splitIndex).replace(/\r$/, '');
        remainder = remainder.slice(splitIndex + 1);
        if (line.length > 0) {
          onLine(line);
        }
        splitIndex = remainder.indexOf('\n');
      }
    },
    flush() {
      const line = remainder.replace(/\r$/, '');
      if (line.length > 0) {
        onLine(line);
      }
      remainder = '';
    },
  };
}

function handleLine(line, source) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  if (looksLikeJsonLine(trimmed)) {
    emitJsonLine(trimmed);
    return;
  }

  emitWrapperEvent('task_non_json_output', source === 'stderr' ? 'ERR' : 'INFO', 'Task', trimmed, {
    stream: source,
  });
}

function looksLikeJsonLine(line) {
  if (!line.startsWith('{') || !line.endsWith('}')) {
    return false;
  }

  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function emitJsonLine(line) {
  process.stdout.write(`${line}\n`);
  appendLine(runArtifactPath, line);
  appendLine(latestArtifactPath, line);
}

function emitWrapperEvent(event, status, label, message, data = {}) {
  const record = {
    schemaVersion: 1,
    type: 'astraxml.launcher.task',
    timestamp: new Date().toISOString(),
    taskSessionId: wrapperSessionId,
    status,
    label,
    message,
    event,
    data,
    raw: false,
  };

  const line = JSON.stringify(record);
  emitJsonLine(line);
}

function appendLine(filePath, line) {
  appendFileSync(filePath, `${line}\n`, 'utf8');
}

function installSignalHandlers() {
  process.on('SIGINT', () => {
    emitWrapperEvent('task_wrapper_signal', 'WARN', 'Task', 'Ctrl+C received; forwarding SIGINT to launcher.', {
      signal: 'SIGINT',
    });
    if (child) {
      child.kill('SIGINT');
    }
  });
}

function waitForExit(activeChild) {
  return new Promise((resolvePromise, rejectPromise) => {
    activeChild.once('error', rejectPromise);
    activeChild.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
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