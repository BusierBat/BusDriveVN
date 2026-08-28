// js/save.js
export const SAVE_KEY = "bus_vn_save_v1";
export const SAVE_VERSION = 1;

let storageSupported = null;

function isStorageSupported() {
  if (storageSupported !== null) return storageSupported;
  try {
    const testKey = `${SAVE_KEY}__test`;
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    storageSupported = true;
  } catch {
    storageSupported = false;
  }
  return storageSupported;
}

function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }
function toFiniteNumber(v, fb) { return isFiniteNumber(v) ? v : fb; }
function toInteger(v, fb) { return isFiniteNumber(v) ? Math.trunc(v) : fb; }
function clampNumber(v, min, max, fb) { return isFiniteNumber(v) ? Math.min(max, Math.max(min, v)) : fb; }

export function getSaveKey(slot = 0) {
  const index = Math.max(0, Math.trunc(Number(slot) || 0));
  return index === 0 ? SAVE_KEY : `${SAVE_KEY}_slot_${index}`;
}

export function createDefaultSaveState() {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    camera: { x: -860, y: 12, z: -965, yaw: Math.PI, pitch: -0.22 },
    clock: { minutes: 360, day: 1 },
    gameState: { money: 500000, fuel: 1, passengers: 0, passengerCapacity: 40 }
  };
}

function migrateSaveState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const version = toInteger(raw.version, 1);
  if (version === SAVE_VERSION) return raw;
  return { ...raw, version: SAVE_VERSION };
}

export function normalizeSaveState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const migrated = migrateSaveState(raw);
  if (!migrated) return null;
  const base = createDefaultSaveState();

  const cameraRaw = migrated.camera && typeof migrated.camera === "object" ? migrated.camera : {};
  const clockRaw = migrated.clock && typeof migrated.clock === "object"
    ? migrated.clock
    : { minutes: migrated.timeMinutes, day: migrated.day };
  const gameStateRaw = migrated.gameState && typeof migrated.gameState === "object"
    ? migrated.gameState
    : migrated.game && typeof migrated.game === "object" ? migrated.game : {};

  const rawMinutes = toFiniteNumber(clockRaw.minutes ?? clockRaw.timeMinutes, base.clock.minutes);
  const minutes = ((rawMinutes % 1440) + 1440) % 1440;
  const day = Math.max(1, toInteger(clockRaw.day, base.clock.day) + Math.floor(rawMinutes / 1440));

  let fuel = toFiniteNumber(gameStateRaw.fuel, base.gameState.fuel);
  if (fuel > 1.5) fuel /= 100;
  fuel = clampNumber(fuel, 0, 1, base.gameState.fuel);

  const passengerCapacity = Math.max(0, toInteger(gameStateRaw.passengerCapacity, base.gameState.passengerCapacity));
  const passengers = Math.min(passengerCapacity, Math.max(0, toInteger(gameStateRaw.passengers, base.gameState.passengers)));

  return {
    version: SAVE_VERSION,
    savedAt: toFiniteNumber(migrated.savedAt, base.savedAt),
    camera: {
      x: toFiniteNumber(cameraRaw.x, base.camera.x),
      y: toFiniteNumber(cameraRaw.y, base.camera.y),
      z: toFiniteNumber(cameraRaw.z, base.camera.z),
      yaw: toFiniteNumber(cameraRaw.yaw, base.camera.yaw),
      pitch: toFiniteNumber(cameraRaw.pitch, base.camera.pitch)
    },
    clock: { minutes, day },
    gameState: {
      money: Math.max(0, toInteger(gameStateRaw.money, base.gameState.money)),
      fuel,
      passengers,
      passengerCapacity
    }
  };
}

export function saveGameState(state, options = {}) {
  if (!isStorageSupported()) return { ok: false, reason: "storage_unavailable" };
  const normalized = normalizeSaveState(state);
  if (!normalized) return { ok: false, reason: "invalid_state" };
  normalized.savedAt = Date.now();
  try {
    localStorage.setItem(getSaveKey(options.slot), JSON.stringify(normalized));
    return { ok: true, state: normalized };
  } catch (error) {
    return { ok: false, reason: "storage_write_failed", error };
  }
}

export function loadGameState(options = {}) {
  if (!isStorageSupported()) return { ok: false, reason: "storage_unavailable" };
  try {
    const raw = localStorage.getItem(getSaveKey(options.slot));
    if (!raw) return { ok: false, reason: "empty" };
    const normalized = normalizeSaveState(JSON.parse(raw));
    if (!normalized) return { ok: false, reason: "invalid_state" };
    return { ok: true, state: normalized };
  } catch (error) {
    return { ok: false, reason: "parse_error", error };
  }
}

export function clearGameState(options = {}) {
  if (!isStorageSupported()) return { ok: false, reason: "storage_unavailable" };
  try {
    localStorage.removeItem(getSaveKey(options.slot));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "storage_clear_failed", error };
  }
}

export function hasGameState(options = {}) {
  if (!isStorageSupported()) return false;
  try {
    return localStorage.getItem(getSaveKey(options.slot)) !== null;
  } catch {
    return false;
  }
}

export function findSavedSlots(maxSlots = 8) {
  const slots = [];
  for (let slot = 0; slot < maxSlots; slot++) {
    if (hasGameState({ slot })) slots.push(slot);
  }
  return slots;
}

export function createSaveManager(options = {}) {
  const slot = options.slot ?? 0;
  const autoSaveInterval = Number(options.autoSaveInterval) || 0;
  const onResult = typeof options.onResult === "function" ? options.onResult : null;
  let autoSaveTimer = 0;
  let lastResult = null;

  function report(result) {
    lastResult = result;
    if (onResult) onResult(result);
    return result;
  }
  function save(stateOrGetter) {
    const state = typeof stateOrGetter === "function" ? stateOrGetter() : stateOrGetter;
    return report(saveGameState(state, { slot }));
  }
  function startAutoSave(getState, interval = autoSaveInterval) {
    stopAutoSave();
    if (typeof getState !== "function" || interval <= 0) return false;
    autoSaveTimer = setInterval(() => save(getState), interval);
    return true;
  }
  function stopAutoSave() {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = 0; return true; }
    return false;
  }

  return {
    save,
    load: () => loadGameState({ slot }),
    clear: () => clearGameState({ slot }),
    has: () => hasGameState({ slot }),
    startAutoSave,
    stopAutoSave,
    dispose: stopAutoSave,
    get lastResult() { return lastResult; }
  };
}