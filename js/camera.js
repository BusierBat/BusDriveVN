// js/camera.js
import * as THREE from "three";

const BED_Z_POSITIONS = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
const BED_Y_TIERS = [0.67, 1.67];
const BED_LENGTH = 1.7;
const BED_WIDTH = 0.7;
const X_OFFSET = 0.75;
const FRONT_VIEW_Z = 6.6;

export const PASSENGER_SEATS = [];
let seatId = 1;
for (let row = 0; row < BED_Z_POSITIONS.length; row++) {
  const bedZ = BED_Z_POSITIONS[row];
  for (let tier = 0; tier < BED_Y_TIERS.length; tier++) {
    const bedY = BED_Y_TIERS[tier];
    const camY = bedY + 0.4;
    const camZ = bedZ + 0.2;
    PASSENGER_SEATS.push({
      id: `Seat_${seatId}`,
      localPos: new THREE.Vector3(-X_OFFSET, camY, camZ),
      side: 'left',
      row: row + 1,
      tier: tier + 1,
      bedY: bedY,
      hasWall: true
    });
    seatId++;
    PASSENGER_SEATS.push({
      id: `Seat_${seatId}`,
      localPos: new THREE.Vector3(X_OFFSET, camY, camZ),
      side: 'right',
      row: row + 1,
      tier: tier + 1,
      bedY: bedY,
      hasWall: true
    });
    seatId++;
  }
}

// ===== BỘ GHẾ HÀNH KHÁCH CHO CẤU HÌNH 34 GIƯỜNG VIP =====
// 3 dãy (trái 5 · giữa 7 · phải 5) x 2 tầng = 34 chỗ ngồi. Tọa độ lấy
// đúng bố cục interior.js (CFG34): giường bên |x|=0.87 dài 1.70m, giường
// giữa x=0 dài 1.42m. Dãy giữa có lối đi 2 BÊN nên camera nhìn được cả
// hai hướng (pivot rộng hơn) — KHÔNG dùng lại tọa độ của cấu hình 20 phòng.
export const PASSENGER_SEATS_34 = [];
{
  let id = 1;
  const TIERS34 = [0.67, 1.67];
  const SIDE_Z34 = [3.00, 1.00, -1.00, -3.00, -5.00];
  const CENTER_Z34 = [3.30, 1.88, 0.46, -0.96, -2.38, -3.80, -5.22];
  const addSeat = (x, z, side, row) => {
    for (const bedY of TIERS34) {
      PASSENGER_SEATS_34.push({
        id: `Seat34_${id}`,
        localPos: new THREE.Vector3(x, bedY + 0.4, z + 0.2),
        side, row, tier: (bedY > 1 ? 2 : 1), bedY, hasWall: true
      });
      id++;
    }
  };
  SIDE_Z34.forEach((z, i) => { addSeat(-0.87, z, 'left', i + 1); addSeat(0.87, z, 'right', i + 1); });
  CENTER_Z34.forEach((z, i) => { addSeat(0.0, z, 'center', i + 1); });
}

export class CameraSystem {
  constructor(camera, busGroup, options = {}) {
    this.camera = camera;
    this.busGroup = busGroup;
    // Danh sách ghế hành khách theo cấu hình nội thất (20 phòng / 34 giường).
    // Đổi cấu hình -> setSeatList(), KHÔNG tạo lại CameraSystem (tránh đăng ký
    // trùng listener mousedown/mousemove trên document).
    this.seats = options.seats || PASSENGER_SEATS;
    this.settings = {
      cameraSensitivity: 0.0035,
      mouseSensitivity: 0.0035,
      invertX: false,
      invertY: false,
      fov: 70,
      outsideDistance: 12,
      outsideMinDistance: 5,
      outsideMaxDistance: 20
    };
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.modes = [
      'driver',
      'copilot',
      'cabin',
      'outside',
      ...this.seats.map((_, i) => `seat_${i}`)
    ];
    this.currentIndex = 0;

    this.isMouseDown = false;
    this.orbitYaw = Math.PI;
    this.orbitPitch = 0.2;
    this.orbitDistance = this.settings.outsideDistance;

    this.bedLookYaw = 0;
    this.bedLookPitch = 0;
    this.seatPivotYaw = 0;
    this.cabinYaw = 0;
    this.cabinPitch = 0;

    this.currentPos = new THREE.Vector3();
    this.currentLook = new THREE.Vector3();

    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        e.preventDefault();
      }
    };
    this._onMouseUp = () => { this.isMouseDown = false; };
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onWheel = (e) => this.onWheel(e);

    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('wheel', this._onWheel);

    this.setMode(this.modes[0]);
  }

    onMouseMove(e) {
        if (!this.isMouseDown) return;
        const mode = this.modes[this.currentIndex];
        const moveX = Math.max(-100, Math.min(100, e.movementX || 0));
        const moveY = Math.max(-100, Math.min(100, e.movementY || 0));

        const sensX = (this.settings.invertX ? -1 : 1) * this.settings.cameraSensitivity * moveX;
        const sensY = (this.settings.invertY ? -1 : 1) * this.settings.cameraSensitivity * moveY;

        if (isNaN(sensX) || isNaN(sensY)) return;
        if (mode === 'outside') {
            this.orbitYaw -= sensX;
            this.orbitPitch -= sensY;
            this.orbitPitch = Math.max(-Math.PI / 1.7, Math.min(Math.PI / 1.7, this.orbitPitch));
        } else if (mode.startsWith('seat_')) {
            this.bedLookYaw -= sensX;
            this.bedLookPitch -= sensY;
            // Kẹp quanh pivot hướng aisle (setMode seat_) — hết nhìn xuyên
            // divider đầu/đuôi giường + rèm aisle = hết "vật cản vô hình";
            // pitch hẹp ±0.8 tránh dính trần/sàn buồng.
            const pivot = this.seatPivotYaw || 0;
            this.bedLookYaw = Math.max(pivot - 1.0, Math.min(pivot + 1.0, this.bedLookYaw));
            this.bedLookPitch = Math.max(-0.8, Math.min(0.8, this.bedLookPitch));
        } else {
            this.cabinYaw -= sensX;
            this.cabinPitch -= sensY;
            this.cabinPitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.cabinPitch));
        }
    }

  onWheel(e) {
    if (this.modes[this.currentIndex] !== 'outside') return;
    this.orbitDistance += e.deltaY * 0.01;
    this.orbitDistance = Math.max(this.settings.outsideMinDistance, Math.min(this.settings.outsideMaxDistance, this.orbitDistance));
  }

  setMode(mode) {
    const idx = this.modes.indexOf(mode);
    if (idx === -1) return;
    this.currentIndex = idx;
    this.cabinYaw = 0;
    this.cabinPitch = 0;
    this.bedLookYaw = 0;
    this.bedLookPitch = 0;
    this.orbitYaw = Math.PI;
    this.orbitPitch = 0.2;

    // MẮT NGƯỜI THẬT theo interior.js: ghế tài xế x=-0.35 z=4.5 (cushion
    // y=0.44); vô lăng x=-0.35 (đã dời runtime) z=5.1 r0.22 (viền trên y1.32);
    // dashboard z5.3-5.6, cluster center y~1.05.
    // CAO HƠN (y 1.28 -> 1.42): mắt tài xế ngồi trên ghế xe khách cao cổ
    // thực tế ở ~1.40-1.45m; ở 1.28 nhìn xuống vô-lăng quá nhiều (báo cáo
    // "góc nhìn hơi thấp"). z 4.75 -> 4.88 để giữ nguyên góc nhìn về
    // đường/kính trước khi nâng cao.
    if (mode === 'driver') this.targetPos = new THREE.Vector3(0.65, 1.42, 4.88);
    // copilot: mắt (−0.35, 1.42, 4.88) — ghế bên kia dash.
    else if (mode === 'copilot') this.targetPos = new THREE.Vector3(-0.35, 1.42, 4.88);
    else if (mode === 'cabin') this.targetPos = new THREE.Vector3(0, 1.5, 3.2);
    else if (mode === 'outside') { /* nhanh orbit: update() dung orbitYaw/Pitch/Distance, khong dung targetPos */ }
    else if (mode.startsWith('seat_')) {
      const idx = parseInt(mode.split('_')[1]);
      const seat = this.seats[idx % this.seats.length];
      this.targetPos = seat.localPos.clone();
      this.targetPos.y += 0.15;
      // Lùi 0.35 -> 0.22: camera lìa tường đầu giường 0.30m (bản cũ chỉ cách
      // 0.30m tổng, các row cuối còn sát ~0.15m) — thoáng hơn mà vẫn giữ
      // tầm nhìn ra aisle. Điều chỉnh CHỈ camera, không dựng thêm mesh.
      this.targetPos.z += 0.22;
      // Pivot = hướng lối đi (aisle): trái nhìn +x, phải nhìn −x. Camera
      // ngồi trong buồng giường có divider đầu giường 0.43m trước mặt và rèm
      // aisle sát phía +z — quay 360° là đâm mesh ("vật cản vô hình") →
      // khoá yaw quanh pivot ±1.0 rad là phạm vi nhìn hữu dụng của buồng.
      // Dãy giữa (34 giường) có lối đi 2 BÊN -> nhìn được cả hai hướng.
      this.seatPivotYaw = seat.side === 'center' ? 0 : (seat.side === 'left' ? 0.65 : -0.65);
      this.bedLookYaw = this.seatPivotYaw;
      this.bedLookPitch = -0.08;
    }
  }

  /**
   * Đổi bộ ghế hành khách (khi đổi cấu hình nội thất 20 phòng <-> 34 giường).
   * Mode hiện tại được giữ nếu vẫn hợp lệ, nếu không -> về 'driver' (góc nhìn
   * an toàn, không nằm trong giường).
   */
  setSeatList(seats) {
    if (!Array.isArray(seats) || !seats.length) return;
    const prevMode = this.modes[this.currentIndex] || 'driver';
    this.seats = seats;
    this.modes = [
      'driver',
      'copilot',
      'cabin',
      'outside',
      ...this.seats.map((_, i) => `seat_${i}`)
    ];
    const stillThere = this.modes.indexOf(prevMode) !== -1;
    const nextMode = stillThere ? prevMode : 'driver';
    this.currentIndex = this.modes.indexOf(nextMode);
    this.setMode(nextMode);
  }

  cycleNext() {
    this.currentIndex = (this.currentIndex + 1) % this.modes.length;
    this.setMode(this.modes[this.currentIndex]);
  }

  getCurrentModeName() {
    const mode = this.modes[this.currentIndex];
    if (mode === 'driver') return "Tài xế";
    if (mode === 'copilot') return "Ghế phụ";
    if (mode === 'cabin') return "Cabin";
    if (mode === 'outside') return "Ngoài xe";
    if (mode.startsWith('seat_')) {
      const idx = parseInt(mode.split('_')[1]);
      // Dùng this.seats (bộ ghế THEO CẤU HÌNH hiện tại) — dùng PASSENGER_SEATS
      // cứng sẽ hiện sai tên ghế khi đã đổi sang cấu hình 34 giường.
      const seat = this.seats[idx % this.seats.length];
      return `Ghế ${seat.id} (T${seat.tier}, H${seat.row})`;
    }
    return mode;
  }

  update(deltaTime) {
    if (!this.busGroup) return;
    this.busGroup.updateMatrixWorld(true);
    const busWorldMatrix = this.busGroup.matrixWorld;
    const mode = this.modes[this.currentIndex];

    if (mode === 'outside') {
      const x = this.orbitDistance * Math.cos(this.orbitPitch) * Math.sin(this.orbitYaw);
      const y = this.orbitDistance * Math.sin(this.orbitPitch);
      const z = this.orbitDistance * Math.cos(this.orbitPitch) * Math.cos(this.orbitYaw);
      const localTarget = new THREE.Vector3(0, 1.5, 0);
      const localCamPos = new THREE.Vector3(x, y + 1.5, z);

      const worldTargetPos = localCamPos.clone().applyMatrix4(busWorldMatrix);
      const worldTargetLook = localTarget.clone().applyMatrix4(busWorldMatrix);

      const smoothFactor = Math.min(1, 20 * deltaTime);
      this.currentPos.lerp(worldTargetPos, smoothFactor);
      this.currentLook.lerp(worldTargetLook, smoothFactor);

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
    } else if (mode.startsWith('seat_')) {
      const lookDistance = 5.2;
      const localCamPos = this.targetPos.clone();
      const localLookAt = new THREE.Vector3(
        localCamPos.x + lookDistance * Math.cos(this.bedLookPitch) * Math.sin(this.bedLookYaw),
        localCamPos.y + lookDistance * Math.sin(this.bedLookPitch),
        localCamPos.z + lookDistance * Math.cos(this.bedLookPitch) * Math.cos(this.bedLookYaw)
      );
      this.camera.position.copy(localCamPos.applyMatrix4(busWorldMatrix));
      this.camera.lookAt(localLookAt.applyMatrix4(busWorldMatrix));
    } else {
      const lookDistance = 11;
      const localCamPos = this.targetPos.clone();
      const localLookAt = new THREE.Vector3(
        localCamPos.x + lookDistance * Math.sin(this.cabinYaw) * Math.cos(this.cabinPitch),
        localCamPos.y + lookDistance * Math.sin(this.cabinPitch),
        localCamPos.z + lookDistance * Math.cos(this.cabinYaw) * Math.cos(this.cabinPitch)
      );
      this.camera.position.copy(localCamPos.applyMatrix4(busWorldMatrix));
      this.camera.lookAt(localLookAt.applyMatrix4(busWorldMatrix));
    }
  }
}
