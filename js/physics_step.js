// physics_step.js 
const BUS_WHEELBASE = 6.35;           // m — giữa cầu trước và cầu sau
const BUS_MASS_EMPTY = 12000;         // kg — xe không tải
const BUS_MASS_FULL = 16000;          // kg — xe đầy khách + hành lý
const MAX_STEER_ANGLE = 0.55;         // rad — chặn cứng góc lái nhận vào
const MAX_LATERAL_ACCEL = 4.5;        // m/s² — giới hạn bám ngang (chống lật)
const GRAV = 9.81;                    // m/s²

// =====================================================================
// D-02 — MỘT mô hình lái duy nhất (kinematic bicycle).
// Trước đây main.js tự xoay thân bằng `steerAngle*dt*1.5*sign(speed)` còn
// physics_step tự tính yawRate riêng → 2 mô hình song song, thân xe xoay
// khác gia tốc ngang dùng để tính roll. Nay cả hai gọi CHUNG hàm này.
// =====================================================================
/** rad/s — yaw rate thật từ góc lái + tốc độ, có chặn bám ngang. */
export function computeYawRate(speedMs, steerAngle) {
  if (!Number.isFinite(speedMs) || !Number.isFinite(steerAngle)) return 0;
  const v = Math.abs(speedMs);
  if (v < 0.05) return 0;
  const steer = Math.max(-MAX_STEER_ANGLE, Math.min(MAX_STEER_ANGLE, steerAngle));
  const raw = (speedMs * Math.tan(steer)) / BUS_WHEELBASE;
  // Chặn theo gia tốc ngang tối đa (a_lat = v · yawRate)
  const maxYawRate = MAX_LATERAL_ACCEL / Math.max(0.5, v);
  return Math.max(-maxYawRate, Math.min(maxYawRate, raw));
}

const IDLE_RPM = 800;                 // vòng tua khi đứng nổ máy
const MAX_RPM = 4500;                 // vòng tua tối đa
// (ENGINE_INERTIA/ENGINE_BRAKE_RPM_DROP đã bỏ — RPM một nguồn kinematic, không tích phân inertia song song)

const SUSPENSION_K = 28000;           // độ cứng lò xo per bánh
const SUSPENSION_C = 4500;            // giảm chấn (ζ ≈ 0.25 — nhíp chở hàng)
export const SUSPENSION_MAX_COMPRESSION = 0.35; // m — hành trình nén tối đa
const SUSPENSION_REBOUND_LIMIT = 0.15;  // m — giãn tối đa


const LAT_LOAD_COEF = 0.0225; // từng bánh (tổng 2 bên = 0.045)
// Lực phanh tính vào nhíp (full  brake → bánh trước nén ≈ 0.02m)
const BRAKE_DIVE_COEF = 0.10;
// Tải phanh chuẩn (N) dùng cho dồn tải nhíp
const BRAKE_FORCE_REF = 6000;


const ROLL_FILL = 0.20;
const MAX_ROLL = 0.09;                // rad ≈ 5.2° — chặn cứng visual
const MAX_PITCH = 0.06;               // rad ≈ 3.4° — chặn cứng visual
const MAX_HEAVE = 0.06;               // m — chặn nhún thân


export const PHYSICS_STATE = {
  speedKmh: 0,             // km/h — tốc độ thật nhận từ main.js

  // --- Lái — góc lái THẬT từ updateVehiclePhysics (rad). Không tự lọc lại. ---
  steeringAngle: 0,

  // --- Vào cua ---
  yaw: 0,                  // rad — tích lũy xoay thân (tương đối, có decay)
  yawRate: 0,              // rad/s
  lateralAccel: 0,         // m/s² — gia tốc ngang (dương = cua trái)
  roll: 0,                 // rad — nghiêng thân (>0 = nghiêng phải)
  rollVel: 0,              // rad/s
  pitch: 0,                // rad — chúi/ngẩng (>0 = chúi)
  pitchVel: 0,             // rad/s
  heave: 0,                // m — nhún thân (>0 = THẤT xuống)
  heaveVel: 0,             // m/s
  sway: 0,                 // m — trượt ngang thân (>0 = sang phải)
  weightTransfer: 0,       // -1..1 — dồn tải (dương = về bên ngoài cua)
  rearSwing: 0,            // m — dịch ngang đuôi xe
  rearOffset: 0,           // m — bánh sau lệch vệt bánh trước (off-tracking)

  // --- Treo 4 bánh: nén/giãn DỊCH so với tĩnh (m). (fl = trước trái...)
  suspension: { fl: 0, fr: 0, rl: 0, rr: 0 },
  suspensionVel: { fl: 0, fr: 0, rl: 0, rr: 0 },
  // PHASE 3 — trạng thái từng bánh: lực đang nén (N), cao độ mặt đường lệch so
  // với tâm xe (m), và chạm/đang nén hay không
  wheelLoad: { fl: 0, fr: 0, rl: 0, rr: 0 },
  wheelSurface: { fl: 0, fr: 0, rl: 0, rr: 0, ref: 0 },
  wheelContact: { fl: false, fr: false, rl: false, rr: false },

  // --- Va chạm (nguồn thật: registerImpact gọi từ collision của main.js) ---
  impactIntensity: 0,      // 0..1 — dao động gần đây nhất (decay mỗi frame)

  // --- Động cơ / hộp số ---
  engineRPM: IDLE_RPM,
  engineLoad: 0,           // 0..1
  accelLong: 0,            // m/s² — gia tốc dài thật (đã lọc) — camera/hành khách đọc
  gear: 1,                 // 1..5
  gearTarget: 1,
  gearShiftTimer: 0,       // s
  throttleInput: 0,        // 0..1
  brakeInput: 0,           // -1..0

  // --- Tải trọng (main.js cập nhật passengerCount từ hệ hành khách) ---
  massFactor: 1.0,         // 1.0 không tải ... 1.33 đầy
  passengerCount: 0,
  luggageWeight: 0,

  // --- Bề mặt đường (chưa có nguồn dữ liệu trong map — dormant, set qua
  //     setRoadSurface() khi thêm dữ liệu gờ/ướt vào generator) ---
  tireGrip: 1.0,
  surfaceWet: false,
  surfaceRoughness: 0,

  // --- Âm thanh ---
  brakeSqueal: 0,          // 0..1 — gầm rít phanh
};

// Nhíp treo nội bộ — kèm đối tượng {pos, vel} cho từng bánh
const _wheels = {
  fl: { pos: 0, vel: 0 },
  fr: { pos: 0, vel: 0 },
  rl: { pos: 0, vel: 0 },
  rr: { pos: 0, vel: 0 },
};
let _lastSpeedSigned = 0; // m/s — để tính gia tốc dài (pitch)
let _accLong = 0;         // m/s² — gia tốc dài đã lọc

// =====================================================================
// PHASE 2 — THÊM MÔ HÌNH ĐỘNG LỰC THỰC TẾ (Realistic Vehicle Dynamics)
// =====================================================================

// --- MASS MODEL (khối lượng & trọng tâm) ---
const MASS_EMPTY = 12000;         // kg — xe không tải
const MASS_PER_PASSENGER = 70;    // kg — hành khách + hành lý trung bình
const MASS_MAX = 16000;           // kg — giới hạn tải trọng
const CG_FRONT_RATIO = 0.45;      // tỉ lệ tĩnh trên cầu trước
const CG_REAR_RATIO = 0.55;       // tỉ lệ tĩnh trên cầu sau
const CG_HEIGHT = 1.80;           // m — trọng tâm theo Y
const TRACK_WIDTH = 2.05;         // m — khe giữa hai bánh cùng trục
const WHEELBASE_PH2 = BUS_WHEELBASE;  // m — giữa hai trục
const WHEEL_RADIUS = 0.525;       // m — bán kính bánh

// --- ENGINE MODEL ---
// Vùng thấp nâng lên sát diesel thật: xe khách THACO/AM bus diesel ở 800-1000
// RPM vẫn sản sinh 450-750 Nm (đặc tính phẳng toàn dải) — với 200Nm ở idle xe
// không bứt được khỏi 0 km/h, cảm giác "đóng băng bàn đạp ga". Giữ nguyên dải
// 1000-1400 Nm đỉnh 800 Nm.
const ENGINE_TORQUE_CURVE = [
  [800,  480], [1000, 720], [1200, 800], [1400, 790], [1600, 780],
  [1800, 720], [2000, 650], [2200, 580], [2400, 520], [2600, 460],
  [2800, 400], [3000, 350], [3200, 300], [3400, 260], [3600, 220],
  [3800, 180], [4000, 140], [4200, 110], [4500, 80]
];
const ENGINE_IDLE_RPM = 800;
const ENGINE_MAX_RPM = 4500;

// --- GEARBOX ---
export const GEAR_RATIOS_PH2 = [0, 3.80, 2.40, 1.50, 1.00, 0.75];
const REVERSE_RATIO = 3.40;
const FINAL_DRIVE = 4.10;
const DRIVETRAIN_EFFICIENCY = 0.92;

// --- AERODYNAMICS & ROLLING ---
const CD = 0.65;
const FRONTAL_AREA = 8.5;
const AIR_DENSITY = 1.225;
const ROLLING_RESISTANCE_COEF = 0.008;
const ROLLING_RESISTANCE_WET = 0.010;

// --- BRAKING ---
const BRAKE_BIAS_FRONT = 0.60;
const BRAKE_MAX_FORCE = 80000;
// Deceleration limit (m/s²) — prevents instant-stop at any speed.
// A real bus decelerates at ~6-8 m/s² under full brake. Above this the
// ABS would modulate; we hard-cap so brake force scales with speed.
const BRAKE_MAX_DECEL = 8.0; // m/s²

// --- TIRE GRIP ---
const GRIP_DRY = 0.85;
const GRIP_WET = 0.60;

/**
 * Khối lượng & trọng tâm xe — MỘT nguồn sự thật cho cả forces lẫn hệ treo.
 * berthStats (tuỳ chọn): { meanX, meanY, meanZ, upperDeckFraction } — trục
 * bus-local (z > 0 = về phía đầu xe), lấy từ vị trí giường THẬT của khách
 * đang trên xe (passenger.getLoadDistribution). Không truyền -> phân bố đều.
 * @returns {Object} { mass, massFront, massRear, cgHeight, cgLongitudinal, cgLateral, wheelLoads, passengerCount, luggageWeight, upperDeckFraction }
 */
export function computeVehicleMass(passengerCount = 0, luggageWeight = 0, interiorType = 'BED20', berthStats = null) {
  const cap = interiorType === 'BED34' ? 34 : 20;
  const pax = Math.max(0, Math.min(cap, passengerCount || 0));
  const paxMass = pax * MASS_PER_PASSENGER;
  const luggage = Math.max(0, luggageWeight || 0);
  let mass = MASS_EMPTY + paxMass + luggage;
  if (mass > MASS_MAX) mass = MASS_MAX;

  // --- CG dọc (z): xe rỗng lệch sau 5%L (45/55); khách/hành lý lệch theo vị trí thật
  const meanZ = (berthStats && Number.isFinite(berthStats.meanZ))
    ? Math.max(-4.5, Math.min(4.5, berthStats.meanZ)) : 0;
  const cgEmptyZ = -0.05 * BUS_WHEELBASE;                    // 45/55 tĩnh
  const cgLuggZ = 2.5;                                       // hầm hành lý lệch sau 2.5m
  const zcg = (MASS_EMPTY * cgEmptyZ + paxMass * meanZ + luggage * cgLuggZ) / mass;

  // --- CG ngang (x): khách ngồi lệch bên (BED20: ±0.75, BED34: ±0.87 / 0)
  const meanX = (berthStats && Number.isFinite(berthStats.meanX))
    ? Math.max(-1.2, Math.min(1.2, berthStats.meanX)) : 0;
  const cgLateral = (paxMass * meanX) / mass;                // + = lệch phải

  // --- CG cao (Y): khách tầng trên đội CG lên (theo vị trí giường THẬT);
  //     xe rỗng không còn bị cộng cứng +0.9m khi chưa có khách
  const meanTierY = (berthStats && Number.isFinite(berthStats.meanY))
    ? Math.max(0.6, Math.min(1.8, berthStats.meanY))
    : (interiorType === 'BED34' ? 1.17 : 0.95);
  const upperDeckFraction = (berthStats && Number.isFinite(berthStats.upperDeckFraction))
    ? Math.max(0, Math.min(1, berthStats.upperDeckFraction))
    : (interiorType === 'BED34' ? 0.5 : 0.0);
  const paxCGHeight = meanTierY + 0.35;                      // thân khách ~0.35m trên đệm
  const cgHeight = (MASS_EMPTY * CG_HEIGHT + paxMass * paxCGHeight) / mass;

  // --- Tải từng trục: R_f = m g (1/2 + z_cg/L) — z_cg>0 (lệch trước) -> cầu trước nặng
  const massFront = mass * (0.5 + zcg / BUS_WHEELBASE);
  const massRear = mass - massFront;

  // --- Tải từng bánh: chia trục + lệch ngang (sideShift so tâm, track 2.05m)
  const sideShift = cgLateral / TRACK_WIDTH;
  const wheelLoads = {
    fl: massFront * (0.5 - sideShift), fr: massFront * (0.5 + sideShift),
    rl: massRear * (0.5 - sideShift),  rr: massRear * (0.5 + sideShift),
  };

  return {
    mass, massFront, massRear, cgHeight,
    cgLongitudinal: zcg, cgLateral,
    wheelLoads, passengerCount: pax, luggageWeight: luggage, upperDeckFraction,
  };
}

// Trước đây main.js cộng Math.random() mỗi frame → rung ngẫu nhiên, không
// liên quan gì tới mặt đường. Nay: rung XÁC ĐỊNH theo quãng đường đã đi,
// biên độ tăng theo tốc độ (gờ nối, ổ gà lặp theo mét đường). Khi generator
// có dữ liệu gờ thật, setRoadSurface({ roughness }) sẽ override.
// =====================================================================

/**
 * Nội suy mô-men xoắn động cơ từ RPM.
 * @param {number} rpm - vòng/phút
 * @returns {number} mô-men xoắn (Nm)
 */
export function computeEngineTorque(rpm) {
  const r = Math.max(ENGINE_IDLE_RPM, Math.min(ENGINE_MAX_RPM, rpm));
  const curve = ENGINE_TORQUE_CURVE;
  for (let i = 0; i < curve.length - 1; i++) {
    const [r0, t0] = curve[i];
    const [r1, t1] = curve[i + 1];
    if (r >= r0 && r <= r1) {
      const t = (r - r0) / Math.max(0.001, (r1 - r0));
      return t0 + (t1 - t0) * t;
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * Tính công suất động cơ (kW): P = T * ω.
 * @param {number} torqueNm
 * @param {number} rpm
 * @returns {number} kW
 */
export function computeEnginePower(torqueNm, rpm) {
  const omega = (2 * Math.PI * rpm) / 60;
  return (torqueNm * omega) / 1000;
}

/**
 * Tính mô-men xoắn transmitted đến bánh (tổng 4 bánh).
 * @param {number} engineRPM
 * @param {number} gearIndex 1..5 (0 = không số)
 * @param {boolean} isReverse
 * @returns {number} Nm tại bánh
 */
export function computeWheelTorque(engineRPM, gearIndex = 1, isReverse = false) {
  const gearRatio = isReverse ? REVERSE_RATIO : (GEAR_RATIOS_PH2[gearIndex] || 1);
  const torque = computeEngineTorque(engineRPM);
  return torque * gearRatio * FINAL_DRIVE * DRIVETRAIN_EFFICIENCY;
}

/**
 * Tính lực cản lăn (N): F_rr = Crr * m * g * cos(grade)
 * @param {number} mass kg
 * @param {number} gradeRad radian dốc
 * @param {boolean} wet
 * @returns {number} N
 */
export function computeRollingResistance(mass, gradeRad = 0, wet = false) {
  const crr = wet ? ROLLING_RESISTANCE_WET : ROLLING_RESISTANCE_COEF;
  return crr * mass * GRAV * Math.cos(gradeRad);
}

/**
 * Tính lực cản khí động (N): F_drag = 0.5 * Cd * A * rho * v^2
 * @param {number} speedMs m/s
 * @returns {number} N
 */
export function computeAeroDrag(speedMs) {
  const v = Math.abs(speedMs);
  return 0.5 * CD * FRONTAL_AREA * AIR_DENSITY * v * v;
}

/**
 * Tính lực chịu đồi (N): F_grade = m * g * sin(grade)
 * @param {number} mass kg
 * @param {number} gradeRad radian dốc (dương = lên dốc -> lực cản)
 * @returns {number} N
 */
export function computeGradeResistance(mass, gradeRad = 0) {
  return mass * GRAV * Math.sin(gradeRad);
}

/**
 * Tải tĩnh từng bánh — ưu tiên wheelLoads từ CG thật (gồm lệch ngang),
 * fallback chia đều trục khi caller không truyền massInfo đầy đủ.
 */
export function computeStaticWheelLoads(massInfo) {
  if (massInfo?.wheelLoads) {
    const w = massInfo.wheelLoads;
    return { fl: w.fl * GRAV, fr: w.fr * GRAV, rl: w.rl * GRAV, rr: w.rr * GRAV };
  }
  const { massFront, massRear } = massInfo;
  const fl = (massFront ?? 0) * 0.5 * GRAV;
  const fr = (massFront ?? 0) * 0.5 * GRAV;
  const rl = (massRear ?? 0) * 0.5 * GRAV;
  const rr = (massRear ?? 0) * 0.5 * GRAV;
  return { fl, fr, rl, rr };
}

/**
 * Tính tổng lực tác động lên xe và tải từng bánh.
 * @param {number} speedMs m/s (dương = tiến)
 * @param {number} throttle 0..1
 * @param {number} brake 0..1 (1 = phanh hết)
 * @param {number} gearIndex 1..5
 * @param {boolean} isReverse
 * @param {Object} massInfo từ computeVehicleMass
 * @param {number} gradeRad radian dốc
 * @param {boolean} wet
 * @param {number} surfaceGrip 0..1 (tireGrip multiplier from surface system)
 * @param {number} engineRPMOverride Giữ cho tương thích API — BỎ QUA (RPM kinematic một nguồn)
 * @param {number} lateralAccelInput m/s² — gia tốc ngang hiện tại (friction ellipse)
 * @returns {Object} { netForce, traction, rolling, aero, grade, brakeForce, wheelLoads, gripLimits, engineRPM, engineTorque, wheelTorque, accelLong }
 */
export function computeVehicleForces(speedMs, throttle, brake, gearIndex, isReverse, massInfo, gradeRad = 0, wet = false, surfaceGrip = 1.0, engineRPMOverride = null, lateralAccelInput = 0) {
  const { mass } = massInfo;
  const v = Math.abs(speedMs);
  const sign = speedMs >= 0 ? 1 : -1;

  // Lực kéo từ động cơ
  const gearRatio = isReverse ? REVERSE_RATIO : (GEAR_RATIOS_PH2[gearIndex] || 1);

  // RPM là hàm XÁC ĐỊNH của vận tốc + cấp số (bánh↔động cơ, D kinematic).
  const kinematicRPM = v > 0.1
    ? (v / WHEEL_RADIUS) * gearRatio * FINAL_DRIVE * (60 / (2 * Math.PI))
    : ENGINE_IDLE_RPM;
  // CHỈ Một nguồn RPM: kinematic (v, gear). Không còn blend/override song song —
  // override cũ khiến RPM lệch dần rồi bị cắt về, sinh dao động và hai nguồn số.
  const engineRPM = Math.max(ENGINE_IDLE_RPM, Math.min(ENGINE_MAX_RPM, kinematicRPM));
  const engineTorque = computeEngineTorque(engineRPM);
  const wheelTorque = engineTorque * gearRatio * FINAL_DRIVE * DRIVETRAIN_EFFICIENCY;
  // Lực kéo THEO Ý PEDAL, không theo dấu vận tốc: D luôn kéo tiến (kể cả khi xe
  // đang trôi lùi — lúc đó lực này phanh đà lùi), R luôn kéo lùi. Trộn sign(v)
  // vào đây khiến đạp ga lúc đang lùi = lùi nhanh hơn, không thể chặn đà.
  const driveDirection = isReverse ? -1 : 1;
  const tractionForce = (wheelTorque / WHEEL_RADIUS) * throttle * driveDirection;

  // Lực cản
  // Lực cản lăn phải ngược chiều chuyển động — trước đây trừ vô điều kiện nên
  // khi lùi xe bị "lực đẩy" lùi vô hạn; ký theo vận tốc (v=0 -> dấu +1 giữ nguyên).
  const rolling = computeRollingResistance(mass, gradeRad, wet) * sign;
  const aero = computeAeroDrag(speedMs) * sign;
  const gradeForce = computeGradeResistance(mass, gradeRad) * sign;

  // Brake force limited by deceleration AND by the friction ellipse — trên
  // đường ướt (mu~0.5) lực phanh vượt μFz là vô lý (xe trượt lết, không giảm tốc).
  const muForBrake = GRIP_DRY * surfaceGrip;
  const totalGripN = muForBrake * mass * GRAV;
  const fLatN = Math.abs(lateralAccelInput) * mass;
  const remainingN = Math.sqrt(Math.max(0, totalGripN * totalGripN - fLatN * fLatN));
  const brakeLimit = Math.min(BRAKE_MAX_FORCE, mass * BRAKE_MAX_DECEL, remainingN * 0.9);
  const brakeForce = brake * brakeLimit * -sign;

  const netForce = tractionForce - rolling - aero - gradeForce + brakeForce;

  // Tải từng bánh (static từ CG thật + dồn tải theo chiều dài, CG thật)
  const staticLoads = computeStaticWheelLoads(massInfo);
  const accelLong = netForce / Math.max(1, mass);
  const cgHeightEff = Number.isFinite(massInfo?.cgHeight) ? massInfo.cgHeight : CG_HEIGHT;
  const longTransfer = mass * accelLong * cgHeightEff / WHEELBASE_PH2;

  const wheelLoads = {
    fl: staticLoads.fl - longTransfer * 0.5,
    fr: staticLoads.fr - longTransfer * 0.5,
    rl: staticLoads.rl + longTransfer * 0.5,
    rr: staticLoads.rr + longTransfer * 0.5
  };

  // Grip limit mỗi bánh: F_max = mu * F_z.
  // FIX: surfaceGrip ALREADY encodes wetness (0.65 wet, 1.0 dry from
  // applySurfaceFromSegment / setRoadSurface). Previously mu multiplied
  // by GRIP_WET/GRIP_DRY AGAIN when wet=true → double-counting.
  const mu = GRIP_DRY * surfaceGrip;
  const gripLimits = {
    fl: mu * Math.max(0, wheelLoads.fl),
    fr: mu * Math.max(0, wheelLoads.fr),
    rl: mu * Math.max(0, wheelLoads.rl),
    rr: mu * Math.max(0, wheelLoads.rr)
  };

  // Traction clamp theo friction ellipse: lực dọc khả dụng = phần còn lại
  // của (μΣFz)² sau khi trừ lực ngang đã dùng cho cua. Không được vượt
  // lốp dù ở bất kỳ hệ số nào — mô phỏng vật lý lốp thật, không phải fake grip.
  const muTot = GRIP_DRY * surfaceGrip * mass * GRAV;
  const fLat = Math.abs(lateralAccelInput) * mass;
  const remaining = Math.sqrt(Math.max(0, muTot * muTot - fLat * fLat));
  const maxTraction = remaining * 0.7;
  let finalNetForce = netForce;
  if (Math.abs(tractionForce) > maxTraction) {
    finalNetForce = netForce - tractionForce + Math.sign(tractionForce) * maxTraction;
  }

  return {
    netForce: finalNetForce, traction: tractionForce, rolling, aero: Math.abs(aero), grade: Math.abs(gradeForce),
    brakeForce: Math.abs(brakeForce),
    engineRPM, engineTorque, wheelTorque,
    wheelLoads, gripLimits,
    accelLong: finalNetForce / Math.max(1, mass)
  };
}

const ROUGH_BASE = 0.10;    // biên độ nền (chưa có dữ liệu gờ từ generator)
let _roughPhase = 0;        // m — quãng đường tích lũy (dùng cho rung định tính)
let _roughOverride = null;  // 0..1 — do setRoadSurface() đặt

export function updateRoadRoughness(dt, speedMs = 0) {
  const s = PHYSICS_STATE;
  if (Number.isFinite(dt) && dt > 0) {
    const v = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
    _roughPhase += v * dt;
  }
  if (_roughOverride !== null) {
    s.surfaceRoughness = _roughOverride;
    s.roughPhase = _roughPhase;
    return s.surfaceRoughness;
  }
  const v = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
  // Hai tần số lệch nhau → nhịp gờ không đều, nhưng vẫn tất định (không random).
  const wob = 0.55 + 0.45 * Math.sin(_roughPhase * 1.7) * Math.cos(_roughPhase * 0.31 + 1.7);
  const speedRamp = Math.min(1, v / 16.7); // 0 khi đứng yên, đủ ở ~60 km/h
  s.surfaceRoughness = ROUGH_BASE * speedRamp * wob;
  s.roughPhase = _roughPhase;
  return s.surfaceRoughness;
}

// Scratch dùng chung cho SAT OBB — single-threaded, ghi đè toàn bộ trước khi dùng
const _SAT_AXES_SHARED = new Float64Array(8);

/**
 * SAT 4-trục OBB × OBB / OBB × circle (circle coi như hộp hl=hw) — dùng chung
 * cho va chạm người chơi (main.js) và NPC↔NPC/NPC↔static (traffic).
 * Trả null nếu tách nhau, else {depth, nx, nz} với pháp tuyến hướng vào A.
 */
export function rectContactMTV(ax, az, aRot, ahl, ahw, bx, bz, bRot, bhl, bhw, margin = 0.12) {
  const aFx = Math.sin(aRot), aFz = Math.cos(aRot);
  const bFx = Math.sin(bRot), bFz = Math.cos(bRot);
  const dx = bx - ax, dz = bz - az;

  let bestPen = Infinity, bestNx = 0, bestNz = 0, bestSign = 1;
  const axes = _SAT_AXES_SHARED;
  axes[0] = aFx; axes[1] = aFz; axes[2] = aFz; axes[3] = -aFx;
  axes[4] = bFx; axes[5] = bFz; axes[6] = bFz; axes[7] = -bFx;
  for (let i = 0; i < 4; i++) {
    const nx = axes[i * 2], nz = axes[i * 2 + 1];
    const proj = dx * nx + dz * nz;
    const absProj = Math.abs(proj);
    const required =
          ahl * Math.abs(aFx * nx + aFz * nz)
        + ahw * Math.abs(aFz * nx - aFx * nz)
        + bhl * Math.abs(bFx * nx + bFz * nz)
        + bhw * Math.abs(bFz * nx - bFx * nz)
        + margin;
    if (absProj > required) return null;
    const pen = required - absProj;
    if (pen < bestPen) {
      bestPen = pen; bestNx = nx; bestNz = nz;
      bestSign = proj >= 0 ? -1 : 1;
    }
  }
  return { depth: bestPen, nx: bestSign > 0 ? bestNx : -bestNx, nz: bestSign > 0 ? bestNz : -bestNz };
}

/** massInfo tối giản cho NPC — chỉ cần những field mà computeVehicleForces đọc. */
export function makeSimpleMassInfo(totalMassKg, cgHeight = 1.1) {
  const m = Math.max(50, totalMassKg);
  const half = m * 0.5;
  return {
    mass: m, massFront: half, massRear: half, cgHeight,
    wheelLoads: { fl: half * 0.5, fr: half * 0.5, rl: half * 0.5, rr: half * 0.5 },
    cgLongitudinal: 0, cgLateral: 0,
  };
}

/**
 * Bộ giải BODY-MOTION dùng chung player↔NPC: pitch (chúi/ngẩng theo gia tốc dọc),
 * roll (nghiêng theo dồn tải ngang + địa hình), heave, sway.
 * Ghi vào object body {pitch,pitchVel,roll,rollVel,heave,heaveVel,sway} rồi trả về body.
 */
export function integrateBodyMotion(body, dt, params = {}) {
  const {
    accelLong = 0,
    speedMs = 0,
    speedKmh = 0,
    surfaceRoughness = 0,
    massNorm = 1,
    tireGrip = 1.0,
    impact = 0,
    latAccel = 0,
    isMoving = true,
    rollTerrain = 0,      // m: chênh lệch cao độ trái-phải (Phase 3)
    pitchTerrain = 0,     // m: chênh lệch cao độ trước-sau (Phase 3)
    heaveBonus = 0,       // m: mặt đường đẩy thân lên (Phase 3 bumpAvg)
  } = params;
  const v = Math.abs(speedMs);
  const latLim = MAX_LATERAL_ACCEL * (tireGrip || 1.0);
  const latA = Math.max(-latLim, Math.min(latLim, Number.isFinite(latAccel) ? latAccel : 0));

  // --- Roll: nghiêng theo lực ngang (ngoài cua) — spring-damper
  const rollTarget = Math.max(-MAX_ROLL, Math.min(MAX_ROLL,
    (latA / GRAV) * ROLL_FILL * massNorm * (tireGrip || 1.0) + rollTerrain));
  body.rollVel += (rollTarget - body.roll) * 6.0 * dt - body.rollVel * 3.5 * dt;
  body.roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, body.roll + body.rollVel * dt));

  // --- Pitch: chúi theo gia tốc dọc
  const pitchTarget = Math.max(-0.05, Math.min(0.05, -accelLong * 0.006 + pitchTerrain));
  body.pitchVel += (pitchTarget - body.pitch) * 8.0 * dt - body.pitchVel * 4.0 * dt;
  body.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, body.pitch + body.pitchVel * dt));

  // --- Heave: đường gồ + va chạm đẩy thân
  const speedFactor = Math.min(1.8, v * 1.5);
  const roadRough = Math.max(0, Math.min(1, Number.isFinite(surfaceRoughness) ? surfaceRoughness : 0));
  const impactIntensity = Math.max(0, Number.isFinite(impact) ? impact : 0);
  const heaveTarget = (isMoving ? roadRough * 0.03 * speedFactor * massNorm : 0) + impactIntensity * 0.012 + heaveBonus;
  body.heaveVel += (heaveTarget - body.heave) * 8.0 * dt - body.heaveVel * 6.0 * dt;
  body.heave += body.heaveVel * dt;
  body.heave = Math.max(-MAX_HEAVE, Math.min(MAX_HEAVE, body.heave));

  // --- Sway: trượt ngang nhẹ theo a_lat
  const swayTarget = Math.max(-0.06, Math.min(0.06, latA * 0.008 * massNorm));
  body.sway += (swayTarget - body.sway) * Math.min(1, dt * 3.0);
  return body;
}

// =====================================================================
// spring-damper 1 bánh: m·x'' = F − c·x' − k·x  (x = DỊCH so với tĩnh)
// =====================================================================
function updateWheelSpring(wheel, force, dt, wheelMass) {
  const accel = (force - SUSPENSION_C * wheel.vel - SUSPENSION_K * wheel.pos) / wheelMass;
  wheel.vel += accel * dt;
  wheel.pos += wheel.vel * dt;
  // Chặn hành trình — không cho dao động vô hạn khi bị OVERLOAD
  if (wheel.pos > SUSPENSION_MAX_COMPRESSION) {
    wheel.pos = SUSPENSION_MAX_COMPRESSION;
    wheel.vel = 0;
  } else if (wheel.pos < -SUSPENSION_REBOUND_LIMIT) {
    wheel.pos = -SUSPENSION_REBOUND_LIMIT;
    wheel.vel = 0;
  }
  return wheel.pos;
}

// =====================================================================
// CẬP NHẬT MỘT BƯỚC VẬT LÝ
// =====================================================================
// @param {number} dt — thời gian frame (s)
// @param {number} speedKmh — km/h (dương = tiến)
// @param {number} steerAngle — rad (góc lái thật từ main.js)
// @param {number} throttleInput — 0..1
// @param {number} brakeInput — -1..0
// @param {number} engineRPMOverride — RPM thật từ computeVehicleForces (nếu có)
// @param {number} gearOverride — cấp số 1..5 (nếu có)
// @param {Object} massInfoOverride — massInfo thật từ computeVehicleMass (kèm CG); không truyền -> fallback legacy từ massFactor
// @param {Object} wheelSurfaceOverride — cao độ mặt đường 4 bánh { fl, fr, rl, rr, ref } (world, mét)
export function updatePhysicsState(dt, speedKmh = 0, steerAngle = 0, throttleInput = 0, brakeInput = 0, engineRPMOverride = null, gearOverride = null, massInfoOverride = null, wheelSurfaceOverride = null) {
  const s = PHYSICS_STATE;
  if (!Number.isFinite(dt) || dt <= 0) return s; // khoan — không tính frame lỗi
  const speedClean = Number.isFinite(speedKmh) ? speedKmh : 0;
  s.speedKmh = speedClean;

  const vSigned = speedClean / 3.6;                 // m/s (âm = lùi)
  const v = Math.abs(vSigned);
  const isMoving = v > 0.05;

  s.throttleInput = Number.isFinite(throttleInput) ? Math.max(0, Math.min(1, throttleInput)) : 0;
  s.brakeInput = Number.isFinite(brakeInput) ? Math.max(-1, Math.min(0, brakeInput)) : 0;

  // Góc lái THẬT (nguồn main.js, có settings keySens) — chỉ chặn cứng NaN.
  const steer = Number.isFinite(steerAngle)
    ? Math.max(-MAX_STEER_ANGLE, Math.min(MAX_STEER_ANGLE, steerAngle))
    : 0;
  s.steeringAngle = steer;

  // Khối lượng hiện thời: ưu tiên massInfoOverride (main.js truyền thẳng từ
  // computeVehicleMass — MỘT nguồn sự thật). Fallback: công thức legacy từ
  // massFactor (chỉ để các caller cũ/test không truyền massInfo không vỡ).
  const legacyMass = BUS_MASS_EMPTY + (BUS_MASS_FULL - BUS_MASS_EMPTY) * Math.min(1, Math.max(0, (s.massFactor - 1)) / 0.33);
  const useInfo = massInfoOverride && Number.isFinite(massInfoOverride.mass);
  const mass = useInfo ? massInfoOverride.mass : legacyMass;
  const cgHeightEff = (useInfo && Number.isFinite(massInfoOverride.cgHeight)) ? massInfoOverride.cgHeight : CG_HEIGHT;
  const massNorm = Math.max(1.0, Math.min(1.6, mass / MASS_EMPTY));
  const massFront = (useInfo && Number.isFinite(massInfoOverride.massFront)) ? massInfoOverride.massFront : mass * CG_FRONT_RATIO;
  const massRear = (useInfo && Number.isFinite(massInfoOverride.massRear)) ? massInfoOverride.massRear : mass * CG_REAR_RATIO;
  const wheelMassFront = massFront / 2, wheelMassRear = massRear / 2; // kg mỗi bánh theo trục

  // =====================================================================
  // PHASE 3 — LẤY MẪU CAO ĐỘ TỪNG BÁNH + SÓNG GỢN MẶT ĐƯỜNG (TẤT ĐỊNH)
  // wheelSurfaceOverride: cao độ mặt đường lấy tại 4 vị trí bánh (dữ liệu
  // THẬT từ map: road surface boxes / địa hình — không suy diễn).
  // Sóng gợn vi mô: biên độ lấy từ surfaceRoughness của segment hiện tại,
  // chu kỳ theo QUÃNG ĐƯỜNG (s.roughPhase) — KHÔNG dùng Math.random.
  // =====================================================================
  const ws = wheelSurfaceOverride;
  const wFinite = ws && [ws.fl, ws.fr, ws.rl, ws.rr, ws.ref].every(Number.isFinite);
  const eFL = wFinite ? Math.max(-0.5, Math.min(0.5, ws.fl - ws.ref)) : 0;
  const eFR = wFinite ? Math.max(-0.5, Math.min(0.5, ws.fr - ws.ref)) : 0;
  const eRL = wFinite ? Math.max(-0.5, Math.min(0.5, ws.rl - ws.ref)) : 0;
  const eRR = wFinite ? Math.max(-0.5, Math.min(0.5, ws.rr - ws.ref)) : 0;
  const rough = Math.max(0, Math.min(1, s.surfaceRoughness || 0));
  let bumpF = 0, bumpR = 0;
  if (isMoving && rough > 0.02) {
    const k = (2 * Math.PI) / 22;   // chu kỳ 22m — gợn sóng mặt đường dài
    const k3 = (2 * Math.PI) / 7;   // chu kỳ 7m — gồ ghề kiểu washboard
    const sPos = s.roughPhase || 0;
    const amp = rough * 0.05, amp2 = rough * 0.022, amp3 = rough * 0.012;
    bumpF = amp * Math.sin(k * sPos) + amp2 * Math.sin(2.3 * k * sPos + 1.7) + amp3 * Math.sin(k3 * sPos + 0.6);
    const sRear = sPos - BUS_WHEELBASE;
    bumpR = amp * Math.sin(k * sRear) + amp2 * Math.sin(2.3 * k * sRear + 1.7) + amp3 * Math.sin(k3 * sRear + 0.6);
  }
  // Cao độ từng bánh lệch (signed — gờ đẩy lên, ổ gà kéo xuống). Dùng cho cả
  // lực lò xo lẫn dồn tải heave/pitch/roll để thân xe bám theo mặt đường 2 chiều.
  const bumpFL = eFL + bumpF, bumpFR = eFR + bumpF;
  const bumpRL = eRL + bumpR, bumpRR = eRR + bumpR;
  const frontBump = (bumpFL + bumpFR) / 2;
  const rearBump = (bumpRL + bumpRR) / 2;
  const leftBump = (bumpFL + bumpRL) / 2;
  const rightBump = (bumpFR + bumpRR) / 2;
  const bumpAvg = (frontBump * 2 + rearBump * 2) / 4;

  // =====================================================================
  // G2 — VÀO CUA: gia tốc ngang, yaw rate, dồn tải (kinematic bicycle).
  // Giới hạn bám ngang theo bề mặt (wet 0.65) — không còn trần cứng 4.5 m/s².
  // =====================================================================
  const tanDelta = Math.tan(steer);
  const latGripMax = MAX_LATERAL_ACCEL * (s.tireGrip || 1.0);
  const latTarget = isMoving ? (v * v * tanDelta) / BUS_WHEELBASE : 0;
  const latFiltered = Math.max(-latGripMax, Math.min(latGripMax, latTarget));
  s.lateralAccel += (latFiltered - s.lateralAccel) * Math.min(1, dt * 6);

  let yawRate = computeYawRate(vSigned, steer);
  s.yawRate += (yawRate - s.yawRate) * Math.min(1, dt * 3);
  s.yaw += s.yawRate * dt;
  // Decay góc tương đối — tránh tích lũy vô hạn khi chạy dài
  s.yaw *= Math.max(0, 1 - 0.15 * dt);

  // =====================================================================
  // G2 — NGHIÊNG/CHÚI/NHÚN/TRƯT THÂN — MỘT bộ giải DUY NHẤT integrateBodyMotion
  // (physics_step.js) dùng chung với NPC (TrafficAI). Các hệ số/giới hạn giữ
  // nguyên vật lý gốc. Phần terrain/bump vẫn tính ở đây và truyền vào.
  // =====================================================================
  const accelRaw = (v > 0.01 || Math.abs(_lastSpeedSigned) > 0.01)
    ? (vSigned - _lastSpeedSigned) / dt : 0;
  _lastSpeedSigned = vSigned;
  _accLong += (accelRaw - _accLong) * Math.min(1, dt * 8); // lọc chống nhảy
  s.accelLong = Number.isFinite(_accLong) ? _accLong : 0;

  // Dồn tải: tải về bên ngoài cua (dương = bên ngoài) — theo trần bám của bề mặt
  const transferTarget = Math.sign(s.lateralAccel) * Math.min(1, Math.abs(s.lateralAccel) / Math.max(0.5, latGripMax)) * massNorm * (s.tireGrip || 1.0);
  s.weightTransfer += (transferTarget - s.weightTransfer) * Math.min(1, dt * 2.0);

  integrateBodyMotion(s, dt, {
    accelLong: _accLong,
    speedMs: vSigned,
    speedKmh: speedClean,
    surfaceRoughness: s.surfaceRoughness || 0,
    massNorm,
    tireGrip: s.tireGrip || 1.0,
    impact: Number.isFinite(s.impactIntensity) ? s.impactIntensity : 0,
    latAccel: s.lateralAccel,
    isMoving,
    rollTerrain: (leftBump - rightBump) * 0.35,   // bánh phải trèo gờ → thân nghiêng trái
    pitchTerrain: (rearBump - frontBump) * 0.30,  // bánh trước trèo gờ → mũi ngẩng
    heaveBonus: bumpAvg * 0.55,                    // mặt đường đẩy thân lên
  });

  // Rear off-tracking ≈ L²/(8R), R = L/|tan δ| (không dùng asin mập mờ)
  if (isMoving && Math.abs(steer) > 0.01) {
    const turningRadius = BUS_WHEELBASE / Math.max(0.01, Math.abs(tanDelta));
    const offTrack = (BUS_WHEELBASE * BUS_WHEELBASE) / (8 * turningRadius);
    s.rearOffset = -Math.sign(s.lateralAccel) * Math.min(0.08, offTrack);
    // Rear swing: đuôi xe dịch ngang theo yawRate
    s.rearSwing = Math.max(-0.12, Math.min(0.12, s.yawRate * BUS_WHEELBASE * 0.06));
  } else {
    s.rearOffset *= 0.9;
    s.rearSwing *= 0.9;
  }

  // =====================================================================
  // G3 — TREO 4 BÁNH: LỰC LỆCH (dồn tải ngang + phanh). Trọng lượng tĩnh
  // KHÔNG đưa vào — nhíp mô hình hóa LỆCH so với điểm cân bằng.
  // =====================================================================
  const latLoad = Math.abs(s.lateralAccel) * mass * LAT_LOAD_COEF; // N, luôn dương
  const latSign = s.lateralAccel >= 0 ? 1 : -1;   // + : cua trái → bên PHẢI dồn
  const diveLoad = -s.brakeInput * (BRAKE_FORCE_REF * BRAKE_DIVE_COEF); // N

  // Trước trái/trước phải: bên ngoài cua nén, bên trong giãn.
  // fl là trước-TRÁI: cua trái (latSign=+) → fl GIẢN (x -latLoad)
  const latLoadMod = latLoad * (s.tireGrip || 1.0);
  let flLoad = -latSign * latLoadMod + diveLoad;
  let frLoad = +latSign * latLoadMod + diveLoad;
  let rlLoad = -latSign * latLoadMod - diveLoad * 0.5;
  let rrLoad = +latSign * latLoadMod - diveLoad * 0.5;

  // PHASE 3 — lực lò xo do cao độ mặt đường lệch (signed: gờ đẩy bánh lên,
  // ổ gà để bánh trôi xuống — xả tải). Hệ số 0.5: chỉ một phần lỗi cao độ
  // truyền thành lực (phần còn lại thân xe bám theo heave/pitch/roll).
  const bumpK = SUSPENSION_K * 0.5;
  const bumpForceFL = bumpFL * bumpK;
  const bumpForceFR = bumpFR * bumpK;
  const bumpForceRL = bumpRL * bumpK * 0.8;   // cầu sau nhíp êm hơn
  const bumpForceRR = bumpRR * bumpK * 0.8;
  flLoad += bumpForceFL; frLoad += bumpForceFR; rlLoad += bumpForceRL; rrLoad += bumpForceRR;

  // Lún tĩnh theo tải: xe đầy ngồi thấp hơn (nhíp nén đều 4 bánh; scale nhỏ
  // vì mô hình deviation chỉ giữ phần lệch — tải tĩnh tuyệt đối không đưa vào).
  const sagBias = (massNorm - 1.0) * 0.06 * SUSPENSION_K;
  flLoad += sagBias; frLoad += sagBias; rlLoad += sagBias; rrLoad += sagBias;

  s.suspension.fl = updateWheelSpring(_wheels.fl, flLoad, dt, wheelMassFront);
  s.suspension.fr = updateWheelSpring(_wheels.fr, frLoad, dt, wheelMassFront);
  s.suspension.rl = updateWheelSpring(_wheels.rl, rlLoad, dt, wheelMassRear);
  s.suspension.rr = updateWheelSpring(_wheels.rr, rrLoad, dt, wheelMassRear);
  s.suspensionVel.fl = _wheels.fl.vel;
  s.suspensionVel.fr = _wheels.fr.vel;
  s.suspensionVel.rl = _wheels.rl.vel;
  s.suspensionVel.rr = _wheels.rr.vel;

  // PHASE 3 — TRẠNG THÁI TỪNG BÁNH: lực đang nén (N), cao độ mặt đường lệch
  // so với tâm xe (m), đang chạm/nén hay không (nén > 2cm)
  s.wheelLoad.fl = flLoad; s.wheelLoad.fr = frLoad; s.wheelLoad.rl = rlLoad; s.wheelLoad.rr = rrLoad;
  s.wheelSurface.fl = eFL; s.wheelSurface.fr = eFR; s.wheelSurface.rl = eRL; s.wheelSurface.rr = eRR;
  if (wFinite) s.wheelSurface.ref = ws.ref;
  s.wheelContact.fl = s.suspension.fl > 0.02; s.wheelContact.fr = s.suspension.fr > 0.02;
  s.wheelContact.rl = s.suspension.rl > 0.02; s.wheelContact.rr = s.suspension.rr > 0.02;

  // --- Va chạm decay
  s.impactIntensity *= Math.pow(0.92, dt * 60);

  // =====================================================================
  // G5 — ĐỘNG CƠ / HỘP SỐ — RPM MỘT NGUỒN (kinematic): computeVehicleForces
  // tính RPM theo (v, gear) và trả về qua override. Không còn bảng ratio
  // cục bộ thứ ba, không còn tích phân inertia song song.
  // =====================================================================
  s.engineLoad = Math.max(0, Math.min(1,
    s.throttleInput * 0.7 +
    Math.max(0, _accLong) * 0.1 +
    (massNorm - 1) * 0.3
  ));

  if (engineRPMOverride !== null && Number.isFinite(engineRPMOverride)) {
    s.engineRPM = Math.max(IDLE_RPM * 0.8, Math.min(MAX_RPM, engineRPMOverride));
  } else if (!isMoving) {
    s.engineRPM = IDLE_RPM;
  }

  // Hộp số tự động theo tốc độ (ngưỡng + vùng trễ 5km/h để khỏi hụt ngược)
  // Use gearOverride if provided, else compute from speed.
  if (gearOverride !== null && Number.isFinite(gearOverride) && gearOverride >= 1 && gearOverride <= 5) {
    if (gearOverride !== s.gear && s.gearShiftTimer <= 0) {
      s.gearTarget = gearOverride;
      s.gearShiftTimer = 0.35;
    }
  } else {
    const gearTargets = [0, 12, 28, 52, 82, 120];
    let newGear = 1;
    for (let g = 5; g >= 1; g--) {
      if (v * 3.6 >= gearTargets[g] || (s.gear === g && v * 3.6 >= gearTargets[g] - 4)) {
        newGear = g;
        break;
      }
    }
    if (newGear !== s.gear && s.gearShiftTimer <= 0) {
      s.gearTarget = newGear;
      s.gearShiftTimer = 0.35;
    }
  }
  if (s.gearShiftTimer > 0) {
    s.gearShiftTimer -= dt;
    if (s.gearShiftTimer <= 0) s.gear = s.gearTarget;
  }

  // =====================================================================
  // G6 — PHANH + ÂM THANH
  // =====================================================================
  s.brakeSqueal = isMoving && s.brakeInput < -0.3 ? Math.min(1, -s.brakeInput * 1.5) : 0;

  return s;
}

// =====================================================================
// ĐIỀU KHIỂN TỪ SỰ KIỆN CÓ NGUỒN THẬT
// =====================================================================

/** Va chạm thật từ collision system: strength 0..1 (≈ depth/0.5, clamp). */
export function registerImpact(strength) {
  const val = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  PHYSICS_STATE.impactIntensity = Math.max(PHYSICS_STATE.impactIntensity, val);
}

/** Đặt bề mặt đường (dùng khi có dữ liệu gờ/ướt từ map). */
export function setRoadSurface({ wet, roughness } = {}) {
  if (typeof wet === "boolean") PHYSICS_STATE.surfaceWet = wet;
  if (Number.isFinite(roughness)) {
    _roughOverride = Math.max(0, Math.min(1, roughness));
    PHYSICS_STATE.surfaceRoughness = _roughOverride;
  }
  PHYSICS_STATE.tireGrip = PHYSICS_STATE.surfaceWet ? 0.65 : 1.0;
}

// =====================================================================
// PHASE 3 — SURFACE PROPERTIES FROM SEGMENT METADATA
// Map road segments have class/type/speed but NO surface data.
// This system derives surface properties procedurally from existing
// segment metadata — NO map JSON modification needed.
//
// Surface types:
//   - ASPHALT_DRY: QL1, highway, expressway, arterial (good grip, smooth)
//   - ASPHALT_WET: bridge, tunnel (slippery when wet — always wet flag)
//   - CONCRETE: rural, agricultural (medium grip, rougher)
//   - DIRT: alley, service road (low grip, very rough)
//
// Friction coefficients (μ):
//   - Dry asphalt: 0.8
//   - Wet asphalt: 0.5
//   - Concrete: 0.6
//   - Dirt: 0.35
//
// Roughness (0..1):
//   - Highway/expressway: 0.05 (very smooth)
//   - National/arterial: 0.10 (good)
//   - Collector/residential: 0.18 (medium)
//   - Rural/agricultural: 0.35 (rough)
//   - Alley/service: 0.50 (very rough)
// =====================================================================
const SURFACE_PROPS = {
  // Smooth asphalt — highways, QL1, expressway
  ASPHALT_DRY: { friction: 0.8, roughness: 0.08, wet: false },
  // Wet asphalt — bridges, tunnels (always wet in this sim)
  ASPHALT_WET: { friction: 0.5, roughness: 0.10, wet: true },
  // Concrete — rural roads, agricultural
  CONCRETE: { friction: 0.6, roughness: 0.35, wet: false },
  // Dirt/gravel — alleys, service roads
  DIRT: { friction: 0.35, roughness: 0.50, wet: false },
};

// Map segment class/type to surface type
const SEGMENT_SURFACE_MAP = {
  // Highways & expressways — smooth asphalt
  EXPRESSWAY: 'ASPHALT_DRY',
  highway: 'ASPHALT_DRY',
  highway_ramp: 'ASPHALT_DRY',
  RAMP: 'ASPHALT_DRY',

  // National roads & arterials — good asphalt
  NATIONAL: 'ASPHALT_DRY',
  national_road: 'ASPHALT_DRY',
  ARTERIAL: 'ASPHALT_DRY',
  arterial: 'ASPHALT_DRY',
  PROVINCIAL_ROAD: 'ASPHALT_DRY',
  provincial: 'ASPHALT_DRY',

  // Bridges & tunnels — wet asphalt (slippery)
  bridge: 'ASPHALT_WET',
  tunnel: 'ASPHALT_WET',
  TUNNEL: 'ASPHALT_WET',

  // Collectors & residential — concrete or rougher asphalt
  COLLECTOR: 'CONCRETE',
  collector: 'CONCRETE',
  RESIDENTIAL: 'CONCRETE',
  residential: 'CONCRETE',
  COMMERCIAL: 'CONCRETE',
  commercial: 'CONCRETE',
  LOCAL: 'CONCRETE',
  local: 'CONCRETE',
  INTER_VILLAGE: 'CONCRETE',
  inter_village: 'CONCRETE',

  // Rural & agricultural — rough
  AGRICULTURAL: 'CONCRETE',
  agricultural: 'CONCRETE',
  RURAL_LOCAL: 'CONCRETE',

  // Alleys & service — dirt
  ALLEY: 'DIRT',
  alley: 'DIRT',
  SERVICE: 'DIRT',
  service: 'DIRT',
  INTERNAL: 'ASPHALT_DRY',
  bus_station_road: 'ASPHALT_DRY',
  STATION_ACCESS: 'ASPHALT_DRY',
  station_access: 'ASPHALT_DRY',
  INDUSTRIAL_ACCESS: 'DIRT',
  industrial_access: 'DIRT',
};

/**
 * PHASE 3: Get surface properties from segment metadata.
 * Does NOT require map JSON modification — derives from class/type.
 *
 * @param {Object} segment - Road segment with class/type/speed
 * @returns {Object} Surface properties { surfaceType, friction, roughness, wet, tireGrip }
 */
export function getSurfaceProperties(segment) {
  if (!segment) {
    return { surfaceType: 'ASPHALT_DRY', friction: 0.8, roughness: 0.1, wet: false, tireGrip: 1.0 };
  }

  const segClass = segment.class;
  const segType = segment.type;
  const surfaceType = SEGMENT_SURFACE_MAP[segClass] || SEGMENT_SURFACE_MAP[segType] || 'ASPHALT_DRY';
  const props = SURFACE_PROPS[surfaceType];

  return {
    surfaceType,
    friction: props.friction,
    roughness: props.roughness,
    wet: props.wet,
    tireGrip: props.wet ? 0.65 : 1.0,
    // Additional properties for future use
    roadBank: 0,        // Cross-slope (not in map data yet)
    slope: 0,           // Longitudinal slope (from node heights)
    pothole: 0,         // Pothole intensity (not in map data yet)
    speedBump: 0,       // Speed bump (not in map data yet)
  };
}

/**
 * PHASE 3: Apply surface properties to physics state.
 * Called by main.js when vehicle enters a new road segment.
 *
 * @param {Object} segment - Road segment with class/type
 */
export function applySurfaceFromSegment(segment) {
  const props = getSurfaceProperties(segment);
  PHYSICS_STATE.surfaceType = props.surfaceType;
  PHYSICS_STATE.surfaceWet = props.wet;
  PHYSICS_STATE.surfaceRoughness = props.roughness;
  PHYSICS_STATE.tireGrip = props.tireGrip;
  PHYSICS_STATE.surfaceFriction = props.friction;
  return props;
}

// Getter — giữ nguyên API cũ
export function getPhysicsState() {
  return PHYSICS_STATE;
}

// Reset trạng thái (khởi tạo / đổi xe)
export function resetPhysicsState() {
  const s = PHYSICS_STATE;
  s.speedKmh = 0;
  s.steeringAngle = 0;
  s.yaw = 0; s.yawRate = 0; s.lateralAccel = 0;
  s.roll = 0; s.rollVel = 0;
  s.pitch = 0; s.pitchVel = 0;
  s.heave = 0; s.heaveVel = 0;
  s.sway = 0;
  s.weightTransfer = 0; s.rearSwing = 0; s.rearOffset = 0;
  s.suspension.fl = 0; s.suspension.fr = 0; s.suspension.rl = 0; s.suspension.rr = 0;
  s.suspensionVel.fl = 0; s.suspensionVel.fr = 0; s.suspensionVel.rl = 0; s.suspensionVel.rr = 0;
  s.wheelLoad.fl = 0; s.wheelLoad.fr = 0; s.wheelLoad.rl = 0; s.wheelLoad.rr = 0;
  s.wheelSurface.fl = 0; s.wheelSurface.fr = 0; s.wheelSurface.rl = 0; s.wheelSurface.rr = 0; s.wheelSurface.ref = 0;
  s.wheelContact.fl = false; s.wheelContact.fr = false; s.wheelContact.rl = false; s.wheelContact.rr = false;
  s.impactIntensity = 0;
  s.engineRPM = IDLE_RPM; s.engineLoad = 0; s.accelLong = 0; s.gear = 1; s.gearTarget = 1; s.gearShiftTimer = 0;
  s.throttleInput = 0; s.brakeInput = 0;
  s.massFactor = 1.0; s.passengerCount = 0; s.luggageWeight = 0;
  s.tireGrip = 1.0; s.surfaceWet = false; s.surfaceRoughness = 0;
  s.roughPhase = 0;
  s.brakeSqueal = 0;
  _lastSpeedSigned = 0;
  _accLong = 0;
  _roughPhase = 0;
  for (const key of ["fl", "fr", "rl", "rr"]) {
    _wheels[key].pos = 0;
    _wheels[key].vel = 0;
  }
}


