// js/economy.js
const KEY = 'busdrivevn_direction';
const VALID = ['north', 'south'];
// Số dư người chơi (VNĐ). Lưu localStorage để HUD tiền không reset mỗi lần F5.
const MONEY_KEY = 'busdrivevn_money';
// Khớp đúng số dư khởi điểm cũ in cứng trên HUD/menu (9.000.000 VNĐ).
export const STARTING_MONEY = 9000000;
// Giá vé bình quân tuyến Phú Yên ↔ Sài Gòn (giường nằm) — doanh thu mỗi khách
// lên xe. Một nguồn sự thật duy nhất để HUD tiền có số liệu thật.
export const FARE_PER_PASSENGER = 350000;

// Cache trong RAM: getMoney() được gọi mỗi lần updateHUD (10 Hz) nên không
// đọc localStorage liên tục (localStorage là API đồng bộ, có thể gây giật).
let moneyCache = null;

function sanitizeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return STARTING_MONEY;
  // VNĐ là số nguyên, không âm (không cho "âm quỹ" làm HUD hiện -1.000 ₫).
  return Math.max(0, Math.round(n));
}

export function getTravelDirection() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v) ? v : 'north';
  } catch (err) {
    console.warn('economy: đọc chiều chạy lỗi, dùng mặc định north', err);
    return 'north';
  }
}

export function setTravelDirection(dir) {
  if (!VALID.includes(dir)) return getTravelDirection();
  try {
    localStorage.setItem(KEY, dir);
  } catch (err) {
    console.warn('economy: lưu chiều chạy lỗi (private mode?)', err);
  }
  return dir;
}

/** Số dư hiện tại (VNĐ, số nguyên ≥ 0). */
export function getMoney() {
  if (moneyCache !== null) return moneyCache;
  try {
    const raw = localStorage.getItem(MONEY_KEY);
    moneyCache = raw === null ? STARTING_MONEY : sanitizeMoney(raw);
  } catch (err) {
    console.warn('economy: đọc số dư lỗi, dùng số dư khởi điểm', err);
    moneyCache = STARTING_MONEY;
  }
  return moneyCache;
}

/** Ghi đè số dư (VNĐ). Trả về giá trị đã chuẩn hoá. */
export function setMoney(value) {
  moneyCache = sanitizeMoney(value);
  try {
    localStorage.setItem(MONEY_KEY, String(moneyCache));
  } catch (err) {
    console.warn('economy: lưu số dư lỗi (private mode?)', err);
  }
  return moneyCache;
}

/** Cộng/trừ số dư (delta VNĐ, âm = chi). Trả về số dư mới. */
export function addMoney(delta) {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return getMoney();
  return setMoney(getMoney() + d);
}

// ===== NHIÊN LIỆU (bình 300L xe giường nằm) =====
const FUEL_KEY = 'busdrivevn_fuel';
// Thể tích bình (lít) — bình thật của xe giường nằm cỡ lớn.
export const FUEL_CAPACITY = 300;
// Lần đầu chơi: đổ đầy bình.
export const STARTING_FUEL = 300;
// Mức tiêu hao ~30 L/100 km (xe giường nằm) = 0.30 L/km.
export const FUEL_PER_KM = 0.30;
// Giá xăng dầu bình quân VN (VNĐ/lít).
export const FUEL_PRICE = 20000;
// Phí cứu hộ khi hết xăng giữa đường (kéo về trạm gần nhất).
export const RESCUE_FEE = 800000;

// Cache RAM: fuel bị trừ mỗi bước vật lý (30 Hz) nên KHÔNG ghi localStorage
// mỗi lần — flushFuel() được main.js gọi định kỳ (5s) và ở các sự kiện lớn.
let fuelCache = null;
let fuelDirty = false;

function sanitizeFuel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return STARTING_FUEL;
  return Math.min(FUEL_CAPACITY, Math.max(0, n));
}

/** Mức nhiên liệu hiện tại (lít, 0..FUEL_CAPACITY). */
export function getFuel() {
  if (fuelCache !== null) return fuelCache;
  try {
    const raw = localStorage.getItem(FUEL_KEY);
    fuelCache = raw === null ? STARTING_FUEL : sanitizeFuel(raw);
  } catch (err) {
    console.warn('economy: đọc mức xăng lỗi, dùng đầy bình', err);
    fuelCache = STARTING_FUEL;
  }
  return fuelCache;
}

/** Ghi đè mức xăng (lít). Ghi localStorage ngay. */
export function setFuel(value) {
  fuelCache = sanitizeFuel(value);
  fuelDirty = false;
  try {
    localStorage.setItem(FUEL_KEY, String(fuelCache));
  } catch (err) {
    console.warn('economy: lưu mức xăng lỗi (private mode?)', err);
  }
  return fuelCache;
}

/** Cộng/trừ xăng (delta lít, âm = tiêu hao). Ghi localStorage ngay. */
export function addFuel(delta) {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return getFuel();
  return setFuel(getFuel() + d);
}

/** Trừ xăng tiêu hao — CHỈ cập nhật RAM, phải gọi flushFuel() để lưu. */
export function consumeFuel(litres) {
  const n = Number(litres);
  if (!Number.isFinite(n) || n <= 0) return getFuel();
  fuelCache = sanitizeFuel(getFuel() - n);
  fuelDirty = true;
  return fuelCache;
}

/** Lưu mức xăng vào localStorage nếu có phần chưa lưu. */
export function flushFuel() {
  if (!fuelDirty) return;
  fuelDirty = false;
  try {
    localStorage.setItem(FUEL_KEY, String(fuelCache));
  } catch (err) {
    console.warn('economy: lưu mức xăng lỗi (private mode?)', err);
  }
}
