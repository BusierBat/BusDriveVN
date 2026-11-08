// js/economy.js
const KEY = 'busdrivevn_direction';
const VALID = ['north', 'south'];

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
