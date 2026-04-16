const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Tauri APIs are not available in a browser.');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export async function openFileDialog(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri()) throw new Error('Tauri APIs are not available in a browser.');
  const { open } = await import('@tauri-apps/plugin-dialog');
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
  const { save } = await import('@tauri-apps/plugin-dialog');
  const dest = await save({
    title: 'Export XML File',
    defaultPath,
    filters: [{ name: 'XML Files', extensions: ['xml'] }],
  });
  return dest ?? null;
}

export { isTauri };
