// js/camera.js
import * as THREE from "three";

const BED_Z_POSITIONS = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
const BED_Y_TIERS = [1.62, 2.70];   // khớp LOWER_BED_Y/UPPER_BED_Y của interior.js
const BED_LENGTH = 1.7;
const BED_WIDTH = 0.7;
const X_OFFSET = 0.75;
const FRONT_VIEW_Z = 6.6;
const TWO_PI = Math.PI * 2;

// Offset camera theo chuyển động thân xe (PHẦN 10.5) — dùng chung, không
// cấp phát trong update() mỗi frame.
const _attachT1 = new THREE.Vector3();

function wrapAngle(angle) {
  return ((angle + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

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
// giữa x=0 dài 1.40m (bước 1.42 — khe 0.02 đặt vách ngăn khoang). Dãy giữa
// có lối đi 2 BÊN nên camera nhìn được cả hai hướng (pivot rộng hơn, xen
// kẽ trái/phải theo row) — KHÔNG dùng lại tọa độ của cấu hình 20 phòng.
export const PASSENGER_SEATS_34 = [];
{
  let id = 1;
  const TIERS34 = [1.62, 2.70];   // khớp CFG34 LOWER_Y/UPPER_Y của interior.js
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
    // Nguồn vật lý cảm giác (PHYSICS_STATE từ physics_step.js) — set 1 lần
    // từ main.js qua setMotionSource(). null = camera tĩnh như cũ.
    this.motionSource = null;

    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        e.preventDefault();
      }
    };
    this._onMouseUp = () => { this.isMouseDown = false; };
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onWheel = (e) => this.onWheel(e);
    this._onBlur = () => { this.isMouseDown = false; };
    this._onVisibilityChange = () => {
      if (document.hidden) this.isMouseDown = false;
    };

    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('wheel', this._onWheel);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    this.setMode(this.modes[0]);
  }

    /**
   * Nối camera vào trạng thái vật lý thân xe (PHẦN 10.5).
   * Camera nội thất/giường dán CỨNG theo cabin: pitch/roll/heave tạo offset
   * local cứng (rigid delta), rung động chỉ tồn khi có NGUỒN thật (va chạm,
   * load máy). Không random, không jitter vô hạn.
   */
  setMotionSource(ps) {
    this.motionSource = ps || null;
    // Apply to all cameras
  }

  // Δy = −z·pitch − x·roll (nghiêng rigid về tâm xe z=0), cộng heave/sway.
  // Áp cho cả vị trí ĐIỂM NHÌN để khung hình xoay SOLID theo thân (không fisheye).
  // PHASE 4 (Original): Positional vibration — driver seat vs middle vs rear
  // have different vibration profiles based on suspension geometry.
  _applyMotionAttach(p, look) {
    const ps = this.motionSource;
    if (!ps) return;
    const pitch = Number.isFinite(ps.pitch) ? ps.pitch : 0;
    const roll = Number.isFinite(ps.roll) ? ps.roll : 0;
    const heave = Number.isFinite(ps.heave) ? ps.heave : 0;
    const sway = Number.isFinite(ps.sway) ? ps.sway : 0;
    const adjust = (v) => {
      v.y += -v.z * pitch - v.x * roll - heave;
    };
    adjust(p);
    if (look) adjust(look);

    // Rung động có nguyên nhân thật, TÁCH NGUỒN rõ: engine / road / impact.
    // Động cơ: tồn khi máy nổ (idle cũng rung — xe khách diesel); RPM → 0
    // (tắt máy) thì rung động cơ tắt theo đúng spec. Road/impact: chỉ khi xe
    // lăn bánh / va chạm thật (va chạm được giữ kể cả đứng yên — cú tông khi
    // đỗ xe vẫn giật). Không random — phase theo quãng đường.
    const speedKmh = Number.isFinite(ps.speedKmh) ? ps.speedKmh : 0;
    const isMoving = Math.abs(speedKmh) > 1.0;
    const impact = Number.isFinite(ps.impactIntensity) ? ps.impactIntensity : 0;
    const eng = Number.isFinite(ps.engineLoad) ? ps.engineLoad : 0;
    const rough = Number.isFinite(ps.surfaceRoughness) ? ps.surfaceRoughness : 0;
    const rpm = Number.isFinite(ps.engineRPM) ? ps.engineRPM : 0;
    const roughPhase = Number.isFinite(ps.roughPhase) ? ps.roughPhase : 0;

    // Rung động cơ: load thật (0.004) + rò rỉ idle (0.0012 × tỉ lệ RPM/800).
    // RPM = 0 (tắt máy) ⇒ rung động cơ = 0 — đúng yêu cầu "tắt máy thì dừng".
    const idleNorm = Math.max(0, Math.min(1, (rpm - 700) / 800));
    const engVib = eng * 0.004 + 0.0012 * idleNorm;
    const roadVib = isMoving ? rough * 0.003 : 0;   // đứng yên: không rung đường
    const impactVib = impact * 0.08;                 // va chạm: mọi trạng thái

    // PHASE 4: Positional vibration scaling based on camera position
    // Driver seat (front, z~4.5): more pitch vibration, less heave
    // Middle (z~0): balanced
    // Rear (z~-4.5): more heave/sway, less pitch
    // Upper deck (y~2.5): amplified roll vibration
    const camZ = p.z || 0;
    const camY = p.y || 0;
    const frontFactor = Math.max(0, camZ / 5.0);   // 0 at center, 1 at front (driver)
    const rearFactor = Math.max(0, -camZ / 5.0);   // 0 at center, 1 at rear
    const upperDeckFactor = Math.max(0, (camY - 1.5) / 1.5);  // 0 below, 1 at upper deck

    // Vibration components with positional weights
    const pitchVib = 1.0 + frontFactor * 0.5;           // Front: more pitch from engine/road
    const heaveVib = 1.0 + rearFactor * 0.6;            // Rear: more heave from suspension
    const swayVib = 1.0 + rearFactor * 0.4 + upperDeckFactor * 0.3;  // Rear/upper: more sway
    const rollVib = 1.0 + upperDeckFactor * 0.8;        // Upper deck: amplified roll

    _attachT1.set(
      (sway * 0.6 + roadVib * Math.sin(roughPhase * 80)) * swayVib,
      (impactVib * Math.sin(roughPhase * 55) + engVib * Math.sin(roughPhase * 47) + roadVib * Math.sin(roughPhase * 65)) * heaveVib * rollVib,
      roadVib * Math.cos(roughPhase * 72) * pitchVib
    );
    p.add(_attachT1);
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
            this.orbitYaw = wrapAngle(this.orbitYaw - sensX);
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
            this.cabinYaw = wrapAngle(this.cabinYaw - sensX);
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

    // MẮT NGƯỜI THẬT theo interior.js: RHD — ghế tài xế x=+0.65 z=4.5
    // (cushion y=0.44); vô lăng runtime x=+0.65 z=5.02 r0.22; cluster bên
    // PHẢI (+0.45), dashboard z5.3-5.6.
    // TAY LÁI PHẢI (RHD): tài xế + vô-lăng bên PHẢI,
    // ghế phụ bên TRÁI (-0.35). z 4.42 = mắt ngồi trên ghế, lùi sau vô-lăng
    // ~0.5m đúng tỷ lệ buồng lái.
    if (mode === 'driver') this.targetPos = new THREE.Vector3(0.65, 1.48, 4.38);
    // copilot: mắt (-0.35, 1.45, 4.42) — ghế bên kia dash.
    else if (mode === 'copilot') this.targetPos = new THREE.Vector3(-0.35, 1.48, 4.38);
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
      // ngồi trong buồng giường có divider đầu giường trước mặt và rèm
      // aisle sát phía +z — quay 360° là đâm mesh ("vật cản vô hình") →
      // khoá yaw quanh pivot ±1.0 rad là phạm vi nhìn hữu dụng của buồng.
      // DÃY GIỮA (34 giường) giờ CÓ vách ngăn đầu/cuối khoang (full-height,
      // cách mắt đúng 0.28m = 0.70 − 0.42) nên pivot 0 (nhìn thẳng +z) là
      // nhìn ĐẦY màn hình vào vách -> đổi sang hướng lối đi và nới 0.65 →
      // 1.13 rad (≈65°): vách dãy giữa gần mắt hơn vách dãy bên (0.28 vs
      // 0.43m), ở 65° mép vách chỉ chiếm ~1/4 khung nhìn bên thay vì ~3/5.
      // Xen kẽ ±theo row: mỗi giường nhìn ra lối đi bên mình (2 lối đi).
      if (seat.side === 'center') this.seatPivotYaw = seat.row % 2 === 1 ? 1.13 : -1.13;
      else this.seatPivotYaw = seat.side === 'left' ? 0.65 : -0.65;
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
      // D-01: trước đây gọi _applyMotionAttach(p, look) với biến KHÔNG tồn tại
      // -> ReferenceError mỗi frame ở mọi mode seat_* (khiến updateWorld ném
      // lỗi trước map.updateChunks/npc/traffic/passenger/HUD). Ghế ngồi dùng
      // đúng cặp vector local vừa tính ở trên, giống nhánh cabin bên dưới.
      this._applyMotionAttach(localCamPos, localLookAt);
      this.camera.position.copy(localCamPos.applyMatrix4(busWorldMatrix));
      this.camera.lookAt(localLookAt.applyMatrix4(busWorldMatrix));
      if (this.motionSource) {
        const mRoll = Number.isFinite(this.motionSource.roll) ? this.motionSource.roll : 0;
        const mPitch = Number.isFinite(this.motionSource.pitch) ? this.motionSource.pitch : 0;
        const impactSeat = Number.isFinite(this.motionSource.impactIntensity) ? this.motionSource.impactIntensity : 0;
        // Không gate theo tốc độ: trên dốc đứng yên vẫn phải nghiêng đúng, cú
        // tông khi đỗ xe vẫn giật. Pitch/roll tại standstill = 0 trên đường
        // phẳng nên hành vi cũ không đổi.
        this.camera.rotateZ(-mRoll * 0.6);
        this.camera.rotateX(mPitch * 0.3);
        this.camera.position.y += impactSeat * 0.006 * Math.sin((Number.isFinite(this.motionSource.roughPhase) ? this.motionSource.roughPhase : 0) * 58);
      }
    } else {
      const lookDistance = 11;
      const localCamPos = this.targetPos.clone();
      const localLookAt = new THREE.Vector3(
        localCamPos.x + lookDistance * Math.sin(this.cabinYaw) * Math.cos(this.cabinPitch),
        localCamPos.y + lookDistance * Math.sin(this.cabinPitch),
        localCamPos.z + lookDistance * Math.cos(this.cabinYaw) * Math.cos(this.cabinPitch)
      );
      this._applyMotionAttach(localCamPos, localLookAt);
      this.camera.position.copy(localCamPos.applyMatrix4(busWorldMatrix));
      this.camera.lookAt(localLookAt.applyMatrix4(busWorldMatrix));
      if (this.motionSource) {
        const mRoll2 = Number.isFinite(this.motionSource.roll) ? this.motionSource.roll : 0;
        const mPitch2 = Number.isFinite(this.motionSource.pitch) ? this.motionSource.pitch : 0;
        const impact = Number.isFinite(this.motionSource.impactIntensity) ? this.motionSource.impactIntensity : 0;
        // Dùng roughPhase (quãng đường) — định tính. Không gate theo tốc độ:
        // va chạm lúc đứng yên vẫn giật; đường phẳng lúc đứng yên thì pitch/roll = 0.
        const roughPhase = Number.isFinite(this.motionSource.roughPhase) ? this.motionSource.roughPhase : 0;
        this.camera.rotateZ(-mRoll2 * 0.5);
        this.camera.rotateX(mPitch2 * 0.25);
        this.camera.position.x += impact * 0.01 * Math.sin(roughPhase * 60);
        this.camera.position.y += impact * 0.008 * Math.cos(roughPhase * 65);
      }
    }
  }

  dispose() {
        document.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('mouseup', this._onMouseUp);
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('wheel', this._onWheel);
        window.removeEventListener('blur', this._onBlur);
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this.busGroup = null;
        this.camera = null;
        this.seats = null;
    }
}
