// Persistence adapter. localStorage is optional: every access is guarded so
// play continues in memory when storage is unavailable or full.

const KEY = 'molg.save.v1';
const DEBUG_KEY = 'molg.debug';

export const SAVE_FORMAT = 'molg-save';

export function storageAvailable() {
  try {
    const k = '__molg_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function makeSave(state, meta) {
  return { format: SAVE_FORMAT, version: 1, savedAt: new Date().toISOString(), meta, state };
}

/** Returns true on success, false if storage failed (play continues in memory). */
export function writeSave(state, meta) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(makeSave(state, meta)));
    return true;
  } catch {
    return false;
  }
}

export function readSave() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function readDebugFlag() {
  try { return window.localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; }
}

export function writeDebugFlag(on) {
  try { window.localStorage.setItem(DEBUG_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
