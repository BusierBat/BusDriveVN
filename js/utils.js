// js/utils.js
import * as THREE from "three";

export const EPSILON = 1e-6;
export const TWO_PI = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value, min, max) {
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

export function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpClamped(a, b, t) {
  return lerp(a, b, clamp01(t));
}

export function inverseLerp(a, b, value) {
  if (Math.abs(b - a) < EPSILON) return 0;
  return (value - a) / (b - a);
}

export function remap(value, inMin, inMax, outMin, outMax) {
  if (Math.abs(inMax - inMin) < EPSILON) return outMin;
  const t = inverseLerp(inMin, inMax, value);
  return lerp(outMin, outMax, t);
}

// smoothstep(e0, e1, x): 0 khi x<=e0, 1 khi x>=e1, interpolated mượt giữa.
// Dùng bởi atmosphere.js + time_system.js (import từ đây).
export function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function damp(current, target, lambda, dt) {
  if (dt <= 0 || lambda <= 0) return current;
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function roundToStep(value, step) {
  if (step <= EPSILON) return value;
  return Math.round(value / step) * step;
}

export function wrap(value, min, max) {
  if (max < min) {
    const temp = min;
    min = max;
    max = temp;
  }

  const range = max - min;
  if (range <= EPSILON) return min;

  return min + (((value - min) % range) + range) % range;
}

export function distanceSquared2(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

export function distance2(x1, y1, x2, y2) {
  return Math.sqrt(distanceSquared2(x1, y1, x2, y2));
}

export function distanceSquared3(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return dx * dx + dy * dy + dz * dz;
}

export function distance3(x1, y1, z1, x2, y2, z2) {
  return Math.sqrt(distanceSquared3(x1, y1, z1, x2, y2, z2));
}

export function normalizeAngle(angle) {
  let a = angle % TWO_PI;

  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;

  return a;
}

export function lerpAngle(a, b, t) {
  const delta = normalizeAngle(b - a);
  return normalizeAngle(a + delta * clamp01(t));
}

export function dampAngle(current, target, lambda, dt) {
  const delta = normalizeAngle(target - current);
  const step = delta * (1 - Math.exp(-lambda * dt));
  return normalizeAngle(current + step);
}

export function kmhToMs(kmh) {
  return kmh * (1000 / 3600);
}

export function msToKmh(ms) {
  return ms * 3.6;
}

const hasIntl = typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function";
const numberFormatCache = new Map();

function makeNumberFormatter(digits) {
  const fallback = {
    format(value) {
      if (!Number.isFinite(value)) value = 0;
      return digits <= 0 ? String(Math.round(value)) : Number(value).toFixed(digits);
    }
  };

  if (!hasIntl) return fallback;

  try {
    return new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: digits
    });
  } catch {
    return fallback;
  }
}

function getNumberFormatter(digits) {
  const key = clamp(Math.trunc(digits), 0, 20);
  let formatter = numberFormatCache.get(key);

  if (!formatter) {
    formatter = makeNumberFormatter(key);
    numberFormatCache.set(key, formatter);
  }

  return formatter;
}

function makeMoneyFormatter() {
  const fallback = {
    format(value) {
      if (!Number.isFinite(value)) value = 0;
      return `${Math.round(value).toLocaleString("vi-VN")}₫`;
    }
  };

  if (!hasIntl) return fallback;

  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0
    });
  } catch {
    return fallback;
  }
}

const moneyFormatter = makeMoneyFormatter();

export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) value = 0;
  return getNumberFormatter(digits).format(value);
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) value = 0;
  return moneyFormatter.format(Math.round(value));
}

export function formatPercent(value01, digits = 0) {
  if (!Number.isFinite(value01)) value01 = 0;
  return `${formatNumber(value01 * 100, digits)}%`;
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

export function formatTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) totalMinutes = 0;

  const wrapped = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;

  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function formatClock(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) totalSeconds = 0;
  return formatTime(totalSeconds / 60);
}

export function createSeededRandom(seed = 1) {
  let state = (Number.isFinite(seed) ? seed : 1) >>> 0;

  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(random = Math.random, min = 0, max = 0) {
  min = Math.ceil(min);
  max = Math.floor(max);

  if (min > max) {
    const temp = min;
    min = max;
    max = temp;
  }

  return Math.floor(random() * (max - min + 1)) + min;
}

export function randomFloat(random = Math.random, min = 0, max = 1) {
  if (min > max) {
    const temp = min;
    min = max;
    max = temp;
  }

  return min + random() * (max - min);
}

export function pick(random = Math.random, items) {
  if (!items || items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

export function shuffle(array, random = Math.random) {
  if (!array || array.length <= 1) return array;

  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }

  return array;
}

let idCounter = 0;

export function createId(prefix = "id") {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}



export function createEventBus() {
  const listeners = new Map();

  function on(type, handler) {
    if (typeof handler !== "function") return () => {};

    let handlers = listeners.get(type);

    if (!handlers) {
      handlers = new Set();
      listeners.set(type, handlers);
    }

    handlers.add(handler);

    return () => off(type, handler);
  }

  function off(type, handler) {
    const handlers = listeners.get(type);
    if (!handlers) return;

    handlers.delete(handler);

    if (handlers.size === 0) {
      listeners.delete(type);
    }
  }

  function once(type, handler) {
    const wrapper = (...args) => {
      off(type, wrapper);
      handler(...args);
    };

    return on(type, wrapper);
  }

  function emit(type, ...args) {
    const handlers = listeners.get(type);
    if (!handlers || handlers.size === 0) return;

    for (const handler of Array.from(handlers)) {
      handler(...args);
    }
  }

  function clear() {
    listeners.clear();
  }

  return {
    on,
    off,
    once,
    emit,
    clear
  };
}

export function throttle(fn, wait = 0) {
  if (wait <= 0) {
    const immediate = (...args) => fn(...args);
    immediate.cancel = () => {};
    return immediate;
  }

  let lastTime = 0;
  let timeout = null;
  let pendingArgs = null;

  function invoke() {
    lastTime = performance.now();

    if (pendingArgs) {
      fn(...pendingArgs);
    }

    pendingArgs = null;
  }

  const throttled = (...args) => {
    const now = performance.now();
    const remaining = wait - (now - lastTime);

    pendingArgs = args;

    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      invoke();
    } else if (!timeout) {
      timeout = setTimeout(() => {
        timeout = null;
        invoke();
      }, remaining);
    }
  };

  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    pendingArgs = null;
  };

  return throttled;
}

export function debounce(fn, wait = 0) {
  if (wait <= 0) {
    const immediate = (...args) => fn(...args);
    immediate.cancel = () => {};
    return immediate;
  }

  let timeout = null;
  let pendingArgs = null;

  const debounced = (...args) => {
    pendingArgs = args;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      timeout = null;

      if (pendingArgs) {
        fn(...pendingArgs);
      }

      pendingArgs = null;
    }, wait);
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    pendingArgs = null;
  };

  return debounced;
}


export function createMovingAverage(windowSize = 30) {
    const samples = new Float32Array(windowSize);
    let index = 0;
    let count = 0;
    let sum = 0;

    return {
        add(value) {
            if (count === windowSize) {
                sum -= samples[index];
            } else {
                count++;
            }

            samples[index] = value;
            sum += value;

            index = (index + 1) % windowSize;

            return this.get();
        },

        get() {
            if (count === 0) return 0;
            return sum / count;
        },

        reset() {
            samples.fill(0);
            index = 0;
            count = 0;
            sum = 0;
        }
    };
}

function disposeMaterial(material) {
  if (!material || typeof material.dispose !== "function") return;

  for (const key in material) {
    const value = material[key];

    if (value && value.isTexture) {
      value.dispose();
    }
  }

  if (material.uniforms) {
    for (const key in material.uniforms) {
      const uniform = material.uniforms[key];
      const value = uniform && uniform.value;

      if (value && value.isTexture) {
        value.dispose();
      }
    }
  }

  material.dispose();
}

export function disposeObject3D(root) {
  if (!root) return;

  if (Array.isArray(root)) {
    for (const item of root) {
      disposeObject3D(item);
    }

    return;
  }

  const disposeNode = (node) => {
    if (!node) return;

    if (node.geometry && typeof node.geometry.dispose === "function") {
      node.geometry.dispose();
    }

    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        disposeMaterial(material);
      }
    } else if (node.material) {
      disposeMaterial(node.material);
    }
  };

  if (typeof root.traverse === "function") {
    root.traverse(disposeNode);
  } else {
    disposeNode(root);
  }

  if (typeof root.clear === "function") {
    root.clear();
  }
}

// =====================================================================
// OBJECT POOLING - Tối ưu GC cho các object thường tạo trong hot loop
// =====================================================================

// Vector3 pool
const _vec3Pool = [];
let _vec3PoolSize = 0;
export function getVec3(x = 0, y = 0, z = 0) {
    const v = _vec3Pool.pop() || new THREE.Vector3();
    v.set(x, y, z);
    return v;
}
export function releaseVec3(v) {
    if (_vec3PoolSize < 64) {
        _vec3Pool.push(v);
        _vec3PoolSize++;
    }
}

// Matrix4 pool
const _mat4Pool = [];
let _mat4PoolSize = 0;
export function getMat4() {
    return _mat4Pool.pop() || new THREE.Matrix4();
}
export function releaseMat4(m) {
    if (_mat4PoolSize < 32) {
        _mat4Pool.push(m);
        _mat4PoolSize++;
    }
}

// Color pool
const _colorPool = [];
let _colorPoolSize = 0;
export function getColor(r = 1, g = 1, b = 1) {
    const c = _colorPool.pop() || new THREE.Color();
    c.set(r, g, b);
    return c;
}
export function releaseColor(c) {
    if (_colorPoolSize < 32) {
        _colorPool.push(c);
        _colorPoolSize++;
    }
}

// Euler pool
const _eulerPool = [];
let _eulerPoolSize = 0;
export function getEuler(x = 0, y = 0, z = 0, order = 'XYZ') {
    const e = _eulerPool.pop() || new THREE.Euler();
    e.set(x, y, z, order);
    return e;
}
export function releaseEuler(e) {
    if (_eulerPoolSize < 32) {
        _eulerPool.push(e);
        _eulerPoolSize++;
    }
}

// Quaternion pool
const _quatPool = [];
let _quatPoolSize = 0;
export function getQuat(x = 0, y = 0, z = 0, w = 1) {
    const q = _quatPool.pop() || new THREE.Quaternion();
    q.set(x, y, z, w);
    return q;
}
export function releaseQuat(q) {
    if (_quatPoolSize < 32) {
        _quatPool.push(q);
        _quatPoolSize++;
    }
}

// Generic object pool factory
export function createObjectPool(createFn, resetFn = null, maxSize = 64) {
    const pool = [];
    return {
        acquire(...args) {
            return pool.pop() || createFn(...args);
        },
        release(obj) {
            if (!obj) return;
            if (resetFn) resetFn(obj);
            if (pool.length < maxSize) pool.push(obj);
        },
        clear() { pool.length = 0; },
        get size() { return pool.length; }
    };
}

// Pre-allocated temp objects for hot paths (singleton pattern)
export const Temp = {
    vec3: () => getVec3(),
    vec3_2: () => getVec3(),
    vec3_3: () => getVec3(),
    mat4: () => getMat4(),
    mat4_2: () => getMat4(),
    color: () => getColor(),
    color_2: () => getColor(),
    euler: () => getEuler(),
    euler_2: () => getEuler(),
    quat: () => getQuat(),
    quat_2: () => getQuat(),
    // Release all at frame end
    releaseAll() {
        // Note: In practice, we'd release at specific points, not all at once
        // This is just a helper for cleanup
    }
};
