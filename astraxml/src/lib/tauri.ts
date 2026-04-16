const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

// Cache module imports so we only resolve them once
let _coreModule: typeof import('@tauri-apps/api/core') | null = null;
let _dialogModule: typeof import('@tauri-apps/plugin-dialog') | null = null;

async function getCoreModule() {
  if (!_coreModule) _coreModule = await import('@tauri-apps/api/core');
  return _coreModule;
}

async function getDialogModule() {
  if (!_dialogModule) _dialogModule = await import('@tauri-apps/plugin-dialog');
  return _dialogModule;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Tauri APIs are not available in a browser.');
  const { invoke: tauriInvoke } = await getCoreModule();
  return tauriInvoke<T>(cmd, args);
}

export async function openFileDialog(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri()) throw new Error('Tauri APIs are not available in a browser.');
  const { open } = await getDialogModule();
  const selected = await open({
    title: 'Open XML File',
    multiple: false,
    filters: filters ?? [{ name: 'XML Files', extensions: ['xml'] }],
  });
  if (!selected) return null;
  return typeof selected === 'string' ? selected : (selected as any).path ?? String(selected);
}

export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) throw new Error('Tauri APIs are not available in a browser.');
  const { save } = await getDialogModule();
  const dest = await save({
    title: 'Export XML File',
    defaultPath,
    filters: [{ name: 'XML Files', extensions: ['xml'] }],
  });
  return dest ?? null;
}

export { isTauri };
