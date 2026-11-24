// js/main.js
import * as THREE from "three";
import { MapLoader } from "./map.js";
import { createUI } from "./ui.js";
import { createNPC } from "./npc.js";
import { createBus, loadNpcSkinList, BUS_DIMENSIONS } from "./bus.js";
import { createBusInterior, createBusInterior34, optimizeInteriorLights, migrateInteriorCockpit } from "./interior.js";
import { CameraSystem, PASSENGER_SEATS, PASSENGER_SEATS_34 } from "./camera.js";
import { createAudioSystem } from "./audio.js";
import { createMusicPlayer } from "./music.js";
import { LightingSystem, LIGHTING_QUALITY_PRESETS } from "./lighting.js";
import { TravelClock } from "./TravelClock.js";
import { createPassengerSystem } from "./passenger.js";
import { createTrafficManager } from "./traffic/TrafficManager.js";
import { TrafficDebug } from "./traffic/TrafficDebug.js";
import { initEndermanEasterEgg, updateEnderman } from "./enderman.js";
import { getTravelDirection, setTravelDirection, getMoney, addMoney, FARE_PER_PASSENGER, getFuel, setFuel, addFuel, consumeFuel, flushFuel, FUEL_CAPACITY, FUEL_PER_KM, FUEL_PRICE, RESCUE_FEE } from "./economy.js";
import { formatMoney } from "./utils.js";
import { createCSGTManager } from "./csgt.js";
import { CollisionSystem } from "./collisionSystem.js";
import { updatePhysicsState, PHYSICS_STATE, registerImpact, computeYawRate, updateRoadRoughness, applySurfaceFromSegment, computeVehicleMass, computeVehicleForces, rectContactMTV, computeEnginePower, configureVehicleGeometry, selectGear } from "./physics_step.js"; // vật lý cảm giác (roll/pitch/heave + nhíp bánh + RPM)

let renderer, scene, camera, canvas, map, lighting, npc, bus, interior, passengerSystem, trafficManager, trafficDebug, ui, cameraSystem;
let travelClock = null;   // ước lượng giờ game từ lái xe thật (js/TravelClock.js)
const clock = new THREE.Clock();
let gameState = "menu", paused = false;
let doorProgress = 0, doorTarget = 0, doorServiceStarted = false;
let playerColId = -1;
let playerStuckT = 0;   // đếm thời gian bị chặn hoàn toàn liên tục (Bug "dính cứng")
let lastRescuePress = 0;
let lastTime = performance.now();
let webglLost = false;
let isConsoleOpen = false;
let speedCameraFlashTimer = 0;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
let gameSettings = {
    graphics: 'low', renderDist: 2, npcDensity: 15, camSens: 30, fov: 70,
    lightingQuality: 'MEDIUM', godRays: 'high',
    // --- Cấu hình mới (mọi giá trị đều có tác dụng THẬT) ---
    interior: 'BED20',        // 'BED20' = 20 phòng VIP | 'BED34' = 34 giường VIP
    keySens: 1.0,             // độ nhạy lái xe bằng bàn phím (A/D)
    audioVolume: 0.6,         // âm lượng (0..1)
    audioMute: false          // tắt tiếng
};
// GIÁ TRỊ MẶC ĐỊNH (nút "Đặt lại") — 1 nguồn duy nhất để không lệch nhau.
let currentDirection = "north"; // mặc định: Phú Yên → Sài Gòn
const DEFAULT_SETTINGS = { ...gameSettings };


// Load settings from localStorage
try {
    const saved = localStorage.getItem('busdrivevn_settings');
    if (saved) {
        const parsed = JSON.parse(saved);
        gameSettings = { ...gameSettings, ...parsed };
        // Migration mot lan: ban cu da luu npcDensity=5 (default cu) vao localStorage,
        // khong nang len thi nguoi choi van bi mac dinh 5 xe moi khi mo game.
        // Chi nang khi GIONG default cu de khong deo cai dat ma nguoi dung da tu chon.
        if (parsed.npcDensity === 5 && !localStorage.getItem('busdrivevn_density_v2')) {
            gameSettings.npcDensity = 15;
            try {
                localStorage.setItem('busdrivevn_settings', JSON.stringify(gameSettings));
                localStorage.setItem('busdrivevn_density_v2', '1');
            } catch(e) {}
        }
    }
} catch(e) {}

if (isMobile || isLowEnd) {
    gameSettings.renderDist = 1;

    gameSettings.lightingQuality = 'LOW';
}

let mobileInput = { steer: 0, accel: 0, brake: 0 };

// 1 unit = 1 meter. Speed in m/s; km/h = m/s * 3.6
const SPEED_CONVERSION = 1 / 3.6; // 0.2777... so that phys.speed (m/s) / SPEED_CONVERSION = km/h
const MS_TO_KMH = 3.6;
const KMH_TO_MS = 1 / MS_TO_KMH;


const OBB_HALF_LEN = BUS_DIMENSIONS.length * 0.5; 
const OBB_HALF_W   = BUS_DIMENSIONS.width * 0.5; 
const OBB_MARGIN   = 0.12;   
const PLAYER_HITBOX_QUERY_R = 10.1;


// SAT OBB×OBB — một implementation duy nhất ở physics_step (rectContactMTV),
// dùng chung với TrafficManager. Giữ hàm wrapper để callers không phải đổi tên.
function rectContact(ax, az, aRot, ahl, ahw, bx, bz, bRot, bhl, bhw) {
    return rectContactMTV(ax, az, aRot, ahl, ahw, bx, bz, bRot, bhl, bhw, OBB_MARGIN);
}

// Bọc cũ cho xe↔xe (2 bus OBB), giữ tên cho các nơi gọi cũ
function obbContact(ax, az, aRot, bx, bz, bRot) {
    return rectContact(ax, az, aRot, OBB_HALF_LEN, OBB_HALF_W, bx, bz, bRot, OBB_HALF_LEN, OBB_HALF_W);
}


function mtvForHit(x, z, aRot, c) {
    const data = c.data;
    if (data && data.ai) {
        const ai = data.ai;
        const grp = ai.vehicle && ai.vehicle.group;
        const rot = grp ? grp.rotation.y
                   : (typeof ai.heading === 'number' ? ai.heading : 0);
        return obbContact(x, z, aRot, c.x, c.z, rot);
    }
    const hl = data && typeof data.hl === 'number' ? data.hl : c.r;
    const hw = data && typeof data.hw === 'number' ? data.hw : c.r;
    const rot = data && typeof data.rot === 'number' ? data.rot : 0;
    return rectContact(x, z, aRot, OBB_HALF_LEN, OBB_HALF_W, c.x, c.z, rot, hl, hw);
}

const vehiclePhysics = {
    speed: 0,

    maxSpeedKmh: 110,
    maxSpeed: (110 / 3.6), // m/s
    maxReverseSpeed: -(15 / 3.6), // m/s — lùi chậm như xe khách thật
    currentSpeedKmh: 0,
    isReversing: false,
    forwardVector: new THREE.Vector3(),
    // Trạng thái động cơ/hộp số (được cập nhật từ computeVehicleForces)
    gear: 1,
    gearTarget: 1,
    gearShiftTimer: 0,   // s — đang trong thời gian chuyển số (ly hợp)
    engineRPM: 800,
    engineLoad: 0,
    engineTorque: 200,
    enginePowerKW: 0,
    massInfo: null,
    throttleInput: 0,
    brakeInput: 0
};

let steerAngle = 0, steerTarget = 0;
let wheelSpinAngle = 0;   // rad — góc quay cộng dồn của bánh (theo quãng đường thật)



const KEY_BY_NAME = new Map();
const LEGACY_BY_KEYCODE = new Map();
const keysPressed = new Map();
const steerReleaseAt = new Map();
const physicalSteerKeys = new Set();
const imeSteerKeys = new Set();
const imeSteerRefreshUntil = new Map();


let keyDiagOn = false;
const keyDiagLog = [];
function keyDiagPush(kind, e) {
  if (!keyDiagOn || keyDiagLog.length >= 200) return;
  keyDiagLog.push([
    kind,
    `code="${e.code ?? ""}"`,
    `key="${e.key ?? ""}"`,
    `kc=${e.keyCode ?? 0}`,
    `comp=${e.isComposing ? 1 : 0}`,
    `rep=${e.repeat ? 1 : 0}`,
  ].join(" "));
}
function keyDiagDump() {
  const lines = keyDiagLog.slice(-40);
  console.log(lines.length
    ? "[keys-diag] %d event:\n" + lines.join("\n")
    : "[keys-diag] khong co event nao duoc ghi", lines.length);
  ui?.toast?.(lines.length
    ? `keys-diag: ${lines.length} event — mở console (F12) để copy`
    : "keys-diag: KHÔNG ghi được event nào (bật: gõ lệnh keys rồi bấm WASD)");
}

const KEY_HOLD_TIMEOUT_MS = 5000;
// A/D chỉ tự hết hạn khi IME nuốt keyup VÀ phím không còn auto-repeat.
// 800ms cũ (theo performance.now()) cắt lái giữa cua: Windows chỉ repeat phím
// bấm SAU CÙNG, nên đang giữ A rồi bấm W là A im luôn -> 0.8s sau tự thẳng.
// 3000ms đủ cho thao tác giữ A+W thực tế mà vẫn dọn ghost trong 3s.
const STEER_KEY_HOLD_TIMEOUT_MS = 3000;
const STEER_KEY_MIN_HOLD_MS = 60;
const IME_STEER_REFRESH_MS = 15000;

function buildInputKeyMaps() {
    // a..z / A..Z -> KeyA..KeyZ
    for (let i = 0; i < 26; i++) {
        const up = String.fromCharCode(65 + i);
        KEY_BY_NAME.set(up, "Key" + up);
        KEY_BY_NAME.set(up.toLowerCase(), "Key" + up);
    }
    // 0..9 hàng trên -> Digit0..Digit9
    for (let i = 0; i < 10; i++) KEY_BY_NAME.set(String(i), "Digit" + i);

    // Chữ tiếng Việt: UniKey VI có thể xuất ký tự này thay cho phím gốc.
    // Map ve BACK tieu chuon (a/ă/â -> A, d/đ -> D...).
    const VI_FAMILIES = [
        ["KeyA", "aàáảãạăằắẳẵặâầấẩẫậ"],
        ["KeyD", "dđ"],
        ["KeyE", "eèéẻẽẹêềếểễệ"],
        ["KeyI", "iìíỉĩị"],
        ["KeyO", "oòóỏõọôồốổỗộơờớởỡợ"],
        ["KeyU", "uùúủũụ"],
        ["KeyY", "yỳýỷỹỵ"],
        // Ư (cả họ ừứửữự) = phím W trong cả Telex lẫn VNI.
        // KHÔNG được map về KeyU: bấm W mà UniKey xuất "ư" thì xe phải VẪN ga được.
        ["KeyW", "ưừứửữự"],
    ];
    for (const [code, chars] of VI_FAMILIES) {
        for (const ch of chars) KEY_BY_NAME.set(ch, code);
    }

    // Ten phim chuan (e.key) -> ma vat ly
    const named = {
        " ": "Space", "Spacebar": "Space",
        "Enter": "Enter", "NumpadEnter": "Enter",
        "Escape": "Escape", "Esc": "Escape",
        "Tab": "Tab", "Backspace": "Backspace", "Delete": "Delete", "Insert": "Insert",
        "ArrowUp": "ArrowUp", "ArrowDown": "ArrowDown", "ArrowLeft": "ArrowLeft", "ArrowRight": "ArrowRight",
        "Up": "ArrowUp", "Down": "ArrowDown", "Left": "ArrowLeft", "Right": "ArrowRight",
        "PageUp": "PageUp", "PageDown": "PageDown", "Home": "Home", "End": "End",
        "CapsLock": "CapsLock", "NumLock": "NumLock", "ScrollLock": "ScrollLock",
        "/": "Slash", "?": "Slash",
        ".": "Period", ",": "Comma", ";": "Semicolon", "'": "Quote", "`": "Backquote",
        "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "-": "Minus", "=": "Equal",
    };
    for (const [k, v] of Object.entries(named)) KEY_BY_NAME.set(k, v);

    // e.keyCode / e.which legacy (event bơm theo VK). 229 = "IME dang xu ly" -> bo qua.
    LEGACY_BY_KEYCODE.set(8, "Backspace");
    LEGACY_BY_KEYCODE.set(9, "Tab");
    LEGACY_BY_KEYCODE.set(13, "Enter");
    LEGACY_BY_KEYCODE.set(16, "Shift");
    LEGACY_BY_KEYCODE.set(17, "Control");
    LEGACY_BY_KEYCODE.set(18, "Alt");
    LEGACY_BY_KEYCODE.set(20, "CapsLock");
    LEGACY_BY_KEYCODE.set(27, "Escape");
    LEGACY_BY_KEYCODE.set(32, "Space");
    LEGACY_BY_KEYCODE.set(33, "PageUp");
    LEGACY_BY_KEYCODE.set(34, "PageDown");
    LEGACY_BY_KEYCODE.set(35, "End");
    LEGACY_BY_KEYCODE.set(36, "Home");
    LEGACY_BY_KEYCODE.set(37, "ArrowLeft");
    LEGACY_BY_KEYCODE.set(38, "ArrowUp");
    LEGACY_BY_KEYCODE.set(39, "ArrowRight");
    LEGACY_BY_KEYCODE.set(40, "ArrowDown");
    LEGACY_BY_KEYCODE.set(45, "Insert");
    LEGACY_BY_KEYCODE.set(46, "Delete");
    LEGACY_BY_KEYCODE.set(186, "Semicolon");
    LEGACY_BY_KEYCODE.set(187, "Equal");
    LEGACY_BY_KEYCODE.set(188, "Comma");
    LEGACY_BY_KEYCODE.set(189, "Minus");
    LEGACY_BY_KEYCODE.set(190, "Period");
    LEGACY_BY_KEYCODE.set(191, "Slash");
    LEGACY_BY_KEYCODE.set(192, "Backquote");
    LEGACY_BY_KEYCODE.set(219, "BracketLeft");
    LEGACY_BY_KEYCODE.set(220, "Backslash");
    LEGACY_BY_KEYCODE.set(221, "BracketRight");
    LEGACY_BY_KEYCODE.set(222, "Quote");
    for (let i = 0; i < 12; i++) LEGACY_BY_KEYCODE.set(112 + i, "F" + (i + 1));
}
buildInputKeyMaps();

function legacyKeyCodeToCode(e) {
    const kc = e.which || e.keyCode || 0;
    if (!kc || kc === 229) return null;          // 229 = IME đang nuốt phím, không có thông tin
    if (kc >= 65 && kc <= 90) return "Key" + String.fromCharCode(kc);   // A-Z
    if (kc >= 48 && kc <= 57) return "Digit" + (kc - 48);               // 0-9 hàng trên
    if (kc >= 96 && kc <= 105) return "Numpad" + (kc - 96);             // NumPad 0-9
    const hit = LEGACY_BY_KEYCODE.get(kc);
    if (!hit) return null;
    if (hit === "Shift" || hit === "Control" || hit === "Alt") {
        return hit + (e.location === 2 ? "Right" : "Left");
    }
    return hit;
}

function resolveEventCode(e) {
    // 1) Code vat ly: nguon chac nhat, khong quan tam UniKey dang VI hay EN.
    const code = e.code;
    if (typeof code === "string" && code.length > 0 && code !== "Unidentified") return code;

    // 2) e.key: khi IME nuot code.
    const key = typeof e.key === "string" ? e.key : "";
    if (key && key !== "Process" && key !== "Unidentified" && key !== "Dead") {
        if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") {
            return key + (e.location === 2 ? "Right" : "Left");
        }
        const direct = KEY_BY_NAME.get(key);
        if (direct) return direct;
        const lower = KEY_BY_NAME.get(key.toLowerCase());
        if (lower) return lower;
    }

    // 3) keyCode/which legacy (event bơm theo VK).
    return legacyKeyCodeToCode(e);
}

function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return typeof target.closest === "function" && !!target.closest("[contenteditable]");
}

function pruneStaleKeys(now) {
    if (!keysPressed.size) return;
    for (const [code, last] of keysPressed) {
        if (imeSteerKeys.has(code) && now >= (imeSteerRefreshUntil.get(code) || 0)) {
            keysPressed.delete(code);
            steerReleaseAt.delete(code);
            physicalSteerKeys.delete(code);
            imeSteerKeys.delete(code);
            imeSteerRefreshUntil.delete(code);
            continue;
        }
        const releaseAt = steerReleaseAt.get(code);
        if (releaseAt !== undefined && now >= releaseAt) {
            keysPressed.delete(code);
            steerReleaseAt.delete(code);
            physicalSteerKeys.delete(code);
            imeSteerKeys.delete(code);
            imeSteerRefreshUntil.delete(code);
            continue;
        }
        const timeout = imeSteerKeys.has(code) ? IME_STEER_REFRESH_MS
            : (code === "KeyA" || code === "KeyD") ? STEER_KEY_HOLD_TIMEOUT_MS : KEY_HOLD_TIMEOUT_MS;
        if (now - last > timeout) {
            keysPressed.delete(code);
            steerReleaseAt.delete(code);
            physicalSteerKeys.delete(code);
            imeSteerKeys.delete(code);
            imeSteerRefreshUntil.delete(code);
        }
    }
}

function clearPressedKeys() {
    keysPressed.clear();
    steerReleaseAt.clear();
    physicalSteerKeys.clear();
    imeSteerKeys.clear();
    imeSteerRefreshUntil.clear();
}

// Thu vi tri TAT CA cot den duong trong scene (dung cho street lights pool
// cua lighting.js — xem STREET_LIGHT_* o do).
//
// Nhan dang bang CHINH material cua den duong trong map.js:
//   lamp: MeshStandardMaterial({ color: 0xfff2c0, ..., emissive: 0x554400 })
// Khong dua vao ten object (map.js khong dat ten), va KHONG sua map.js de giu
// API hien co (getRoadGraph/getMinimapData/getHeight/setPlayerPosition) nguyen ven.
//
// Den duong o 4 cho trong map.js, phan lon la InstancedMesh (khoang 188 mesh /
// 341 cot) nen phai doc instanceMatrix + matrixWorld de lay toa do world tung cot.
function collectStreetLampPositions(sceneRoot) {
    const out = [];
    if (!sceneRoot) return out;
    sceneRoot.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    sceneRoot.traverse((o) => {
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mat || !mat.emissive) return;
        if (mat.emissive.getHexString() !== '554400') return;
        if (o.isInstancedMesh && typeof o.getMatrixAt === 'function') {
            for (let i = 0; i < o.count; i++) {
                o.getMatrixAt(i, m4);
                v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
                out.push({ x: v.x, y: v.y, z: v.z });
            }
        } else if (o.isMesh) {
            const e = o.matrixWorld.elements;
            out.push({ x: e[12], y: e[13], z: e[14] });
        }
    });
    return out;
}

let lastFPressTime = 0, lastCameraPressTime = 0, lastHornPressTime = 0;

// === 3D PHYSICS RAYCAST VARS ===
const _raycaster = new THREE.Raycaster();
const _downVector = new THREE.Vector3(0, -1, 0);
const _groundIntersect = new THREE.Vector3();
const _tmpForward = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpNormal = new THREE.Vector3();
let _lastValidGroundY = 10.0;

// === HỘP SỐ TỰ ĐỘNG (PHASE 1) ===
// selectGear/rpmForGear/gearSpeedForRpm + 3 hằng ngưỡng đã chuyển sang
// physics_step.js để NPC và player DÙNG CHUNG một nguồn (Phase 7).
const GEAR_SHIFT_TIME = 0.45;   // s — hộp số tự động xe khách (có ly hợp)

function updateGearbox(phys) {
    if (phys.gearShiftTimer > 0) {
        phys.gearShiftTimer -= FIXED_STEP;
        if (phys.gearShiftTimer <= 0) phys.gear = phys.gearTarget;
        return;
    }
    const kmh = Math.abs(phys.speed) * 3.6;
    const target = selectGear(kmh, phys.gear);
    if (target !== phys.gear) {
        phys.gearTarget = target;
        phys.gearShiftTimer = GEAR_SHIFT_TIME;
    }
}

/**
 * Đoạn đường bus đang chạy: độ dốc (rad, dương = LÊN dốc) + bề mặt.
 * Hình chiếu tâm xe lên segment gần nhất (segmentsNear r=2.0) để nội suy
 * node.y — cùng nguồn cao độ map dùng dựng mặt đường, không đoán.
 * Ưu tiên giữ segment đang chạy nếu vẫn còn trong bán kính (ổn định bề mặt).
 */
let _roadSegId = null;
function roadSegmentInfo(phys) {
    const g = map?.roadGraph;
    const info = { gradeRad: _lastGrade, segment: null };
    if (!g || !bus?.group) return info;
    const p = bus.group.position;
    const segs = g.segmentsNear(p.x, p.z, 2.0);
    if (!segs.length) return info;
    let seg = segs[0];
    if (_roadSegId) {
        const same = segs.find(s => s.id === _roadSegId);
        if (same) seg = same;
    }
    if (_roadSegId !== seg.id) {
        _roadSegId = seg.id;
        applySurfaceFromSegment(seg);
    }
    info.segment = seg;
    const a = g.getNode(seg.from), b = g.getNode(seg.to);
    if (!a || !b) return info;
    const dx = b.x - a.x, dz = b.z - a.z;
    const horiz = Math.sqrt(dx * dx + dz * dz) || 1;
    const ay = Number.isFinite(a.y) ? a.y : 0, by = Number.isFinite(b.y) ? b.y : ay;
    // Hướng xe (forward = local +Z quay theo rotation.y) — lên dốc nếu đi về
    // phía node cao hơn. Xe di chuyển bằng `(0,0,1).applyQuaternion()` nên
    // forward thế giới = (sin yaw, cos yaw); bản cũ dùng (cos, sin) ⇒ dấu dốc
    // bị lật theo hướng xe (chỉ đúng khi yaw = 0/π/2...), làm pitch sai.
    const fx = Math.sin(bus.group.rotation.y), fz = Math.cos(bus.group.rotation.y);
    const dir = (fz * dz + fx * dx) / horiz >= 0 ? 1 : -1;
    _lastGrade = dir * Math.atan2(by - ay, horiz);
    info.gradeRad = _lastGrade;
    return info;
}
let _lastGrade = 0;
let _terrainNullWarned = false;

// js/main.js - Chỉ phần updateVehiclePhysics được thay đổi

function updateVehiclePhysics(dt) {
    if (!bus?.group) return;
    const phys = vehiclePhysics;
    const isAccel = keysPressed.has("KeyW") || mobileInput.accel > 0;
    const isBrake = keysPressed.has("KeyS") || mobileInput.brake > 0;
    const isShift = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight");
    const isAlt = keysPressed.has("AltLeft") || keysPressed.has("AltRight");
    
    // ===== DẠT GA / PHANH (D-03, D-04) =====
    // Trước đây: W chỉ GIỮ tốc độ (không tăng), Shift+W mới tăng; Space đặt
    // speed = 0 trong đúng 1 bước (phanh tức thời, không có quãng phanh).
    // Nay mô phỏng đúng chân ga/phanh của xe khách:
    //   W = ga (giữ ga thì tăng tốc), Shift+W = ga tối đa (vượt)
    //   S = phanh -> hết đà thì lùi; Alt = phanh thường (không lùi)
    //   Space = phanh khẩn cấp (giảm tốc lớn nhưng HỮU HẠN)
    //   Thả hết = chỉ còn lực cản lăn + cản khí động
    const isSpace = keysPressed.has("Space");

    let throttle = 0;
    let brake = 0;
    let wantReverse = false;
    if (isSpace) {
        brake = 1.0;
    } else if (isShift && isAccel) {
        throttle = 1.0;
    } else if (isAccel) {
        throttle = 0.62;
    } else if (isBrake) {
        // Đang tiến -> phanh 0.85; đã đứng yên -> ga lùi (lùi chậm như xe khách
        // thật, trần = maxReverseSpeed). Trước đây S chỉ có phanh đối kháng
        // tốc độ về 0 nên xe KHÔNG BAO GIỜ lùi được (model lực không có nguồn
        // lực âm nào ở v=0) — comment “hết đà thì lùi” chỉ là comment.
        if (phys.speed > 0.05) brake = 0.85;
        else { throttle = 0.5; wantReverse = true; }
    } else if (isAlt) {
        brake = 0.72;
    }

    // HẾT XĂNG = KHÔNG đạp ga được nữa (bus đã bị cắt ở đây khi fuel=0).
    // Xe vẫn trôi theo đà và bị lực cản lăn/phanh hạ tốc độ tự nhiên.
    if (throttle > 0 && getFuel() <= 0) throttle = 0;

    phys.throttleInput = throttle;
    phys.brakeInput = -brake;

    const paxCount = passengerSystem?.getPassengerCount?.()?.onboard || 0;
    const loadDist = passengerSystem?.getLoadDistribution?.() || null;
    const massInfo = computeVehicleMass(paxCount, 0, gameSettings.interior || 'BED20', loadDist);
    phys.massInfo = massInfo;   // share sang updateWorld (massInfo là local của hàm này)

    // Ý lùi = CHỈ do paddle R (muốn lùi), KHÔNG suy từ dấu vận tốc — nếu suy từ
    // speed<0 thì đang trôi lùi mà đạp D vẫn ra lực lùi (đà lùi không chặn nổi).
    const isReverse = wantReverse;

    // ===== HỘP SỐ TỰ ĐỘNG THẬT (PHASE 1) =====
    // Lỗi cũ: `phys.gear = phys.gear` (tự gán chính nó) nên số kẹt ở 1 mãi,
    // trong khi computeVehicleForces lại suy RPM TỪ số đó → vòng lặp khép kín
    // (số 1 ở 100 km/h = 11700 RPM bị cắt về 4500, mô-men sụt → không lên nổi).
    // Nay: số chọn theo TỐC ĐỘ + vùng trễ, RPM suy từ số+bánh (một nguồn duy
    // nhất, có chặn vòng tua tối đa nên số có trần tốc độ theo lý thuyết).
    if (!isReverse) updateGearbox(phys);

    // Độ dốc THẬT + bề mặt của đoạn đường đang chạy (node.y đã grade trong
    // generator). Trước đây truyền hằng 0 → lên/xuống dốc không có lực cản/trợ.
    const road = roadSegmentInfo(phys);
    const gradeRad = road.gradeRad;

    const forces = computeVehicleForces(
        phys.speed, throttle, brake, phys.gear, isReverse,
        massInfo, gradeRad, PHYSICS_STATE.surfaceWet || false, PHYSICS_STATE.tireGrip || 1.0,
        phys.engineRPM, PHYSICS_STATE.lateralAccel || 0 // friction ellipse — lực ngang hiện tại
    );

    // Traction clamp now lives INSIDE computeVehicleForces (single source of truth).
    // Previously main.js modified forces.netForce as a side-effect after return.

    const accel = forces.netForce / Math.max(1, massInfo.mass);
    phys.speed += accel * dt;

    if (phys.speed > phys.maxSpeed) phys.speed = phys.maxSpeed;
    if (phys.speed < phys.maxReverseSpeed) phys.speed = phys.maxReverseSpeed;
    // Chốt đứng yên CHỈ KHI THẢ hết ga/phanh — nếu snapshot điểm 0 vô điều kiện
    // thì mỗi bước xe nhích 0.0067 m/s bị xóa về 0 mãi, xe không bao giờ khởi
    // động được từ v=0 (lỗi "đạp ga đứng yên vĩnh viễn").
    const driveIntent = throttle > 0 || brake > 0;
    if (Math.abs(phys.speed) < 0.02 && !driveIntent) {
        phys.speed = 0;
        phys.isReversing = false;
    } else {
        phys.isReversing = phys.speed < 0;
    }

    // RPM/Số do chính computeVehicleForces tính (một nguồn duy nhất — không
    // còn model RPM song song trong physics_step).
    phys.engineRPM = forces.engineRPM;
    phys.engineLoad = Math.min(1, forces.engineTorque / 800);
    phys.engineTorque = forces.engineTorque;
    phys.enginePowerKW = computeEnginePower(forces.engineTorque, forces.engineRPM);

    // Cập nhật currentSpeedKmh (km/h) từ phys.speed (m/s) — được dùng bởi
    // steering limit, HUD, audio, travelClock. Without this, currentSpeedKmh
    // stays at 0 and the bus never steers correctly.
    phys.currentSpeedKmh = phys.speed * 3.6;

    const speedKmh = Math.abs(phys.currentSpeedKmh);
    // Smoother steering limit: more gradual reduction at high speeds
    const speedSteerLimit = 1 - Math.min(0.85, Math.pow(speedKmh / 180, 1.5));
    
    // Check for actual key press (not ghost keys from IME)
    const isSteeringLeft = keysPressed.has("KeyA");
    const isSteeringRight = keysPressed.has("KeyD");
    
    // Keep A/D aligned with the driver's perceived left/right directions.
    if (isSteeringLeft && !isSteeringRight) steerTarget = 0.5 * speedSteerLimit;
    else if (isSteeringRight && !isSteeringLeft) steerTarget = -0.5 * speedSteerLimit;
    else if (mobileInput.steer !== 0) steerTarget = 0.5 * speedSteerLimit * mobileInput.steer;
    else steerTarget = 0;
    
    // Smoother steering interpolation with speed-dependent response
    // ĐỘ NHẠY BÀN PHÍM (setting): nhân tố phản hồi lái. Không đụng logic
    // resolve phím/UniKey — chỉ tốc độ quay vô-lăng.
    const keySens = Math.max(0.3, Math.min(3, gameSettings.keySens || 1));
    const steerResponseRate = (steerTarget === 0)
        ? (3.5 + speedKmh * 0.02) * keySens
        : (2.5 + speedKmh * 0.01) * keySens;
    if (steerTarget === 0) steerAngle += (0 - steerAngle) * Math.min(1, dt * steerResponseRate);
    else steerAngle += (steerTarget - steerAngle) * Math.min(1, dt * (steerResponseRate * 0.7));
    
    // Prevent ghost steering when no input - additional safety check
    if (!keysPressed.has("KeyA") && !keysPressed.has("KeyD") && mobileInput.steer === 0) {
        steerTarget = 0;
    }
    
    // VÔ-LĂNG + BÁNH TRƯỚC quay theo góc lái THẬT (Mục G).
    // Trước đây bus.setSteering KHÔNG được gọi ở đâu cả → bánh trước và vô
    // lăng trong cabin đứng im dù xe đang đánh lái.
    bus.setSteering?.(steerAngle);
    bus.setCockpitSteering?.(steerAngle);

    // D-02: xoay thân theo MỘT mô hình kinematic bicycle (chung với
    // physics_step qua computeYawRate) thay vì công thức rời rạc
    // steerAngle*dt*1.5*sign(speed) — trước đây thân xe xoay khác hoàn toàn
    // gia tốc ngang dùng để tính roll.
    const yawRate = computeYawRate(phys.speed, steerAngle);
    PHYSICS_STATE.roadGradeRad = gradeRad;
    if (yawRate !== 0) bus.group.rotation.y += yawRate * dt;
    
    if (Math.abs(phys.speed) > 0.001) {
        const forward = phys.forwardVector.set(0, 0, 1).applyQuaternion(bus.group.quaternion);
        const moveDistance = phys.speed * dt;
        // ===== NHIÊN LIỆU: tiêu hao theo quãng đường di chuyển (0.30 L/km) =====
        // Trừ RAM ngay (rẻ), ghi localStorage qua flushFuel() định kỳ ở updateHUD.
        if (moveDistance !== 0) consumeFuel(Math.abs(moveDistance) / 1000 * FUEL_PER_KM);
        const oldX = bus.group.position.x, oldZ = bus.group.position.z;
        const newX = oldX + forward.x * moveDistance;
        const newZ = oldZ + forward.z * moveDistance;

        // ===== VA CHẠM — MTV + TRƯỢT + ĐẨY TỰ THÁO (BUG "2 xe va nhau dính cứng") =====
        // Broad phase hình tròn (r = 10.1 + r_object) -> narrow phase SAT MTV cho
        // từng object (bus = OBB, nhà = hộp xoay, cây = hình tròn).
        // Khi chạm: khối lượng chuyển động đi CÀO VÀO mặt chạm bị bỏ, phần còn
        // lại cho phép chạy — xe TRƯỢT theo thân nhau thoát khỏi va chạm thay vì
        // khóa tọa độ chết (deadlock "2 xe dính cứng" — nguyên nhân đã đo).
        // Chạm trực diện (trượt về 0) trong >2s khi người
        // chơi còn giữ ga/thắng: được ĐẨY NHẸ theo trục xâm nhập nhỏ nhất
        // (≤0.35 m/s, ≤ depth) — thoát khỏi dữ kiện chồng lấn mà không teleport.
        let contactMtv = null;
        let moveDx = newX - oldX, moveDz = newZ - oldZ;
        if (window.collisionSystem) {
            // Broad phase hinh tron (r = 10.1 + 3.0 = 13.1m du bao phu vung
            // 2 OBB 12.8x2.53 co the cham) -> narrow phase SAT MTV loc lai.
            // Truyen y/height de khong bao va cham voi xe dang o tang khac (cau/viaduct).
            const hit = window.collisionSystem.check(
                newX, newZ, PLAYER_HITBOX_QUERY_R, playerColId,
                ['static', 'npc'], bus.group.position.y, 4.0,
                (c) => {
                    const m = mtvForHit(newX, newZ, bus.group.rotation.y, c);
                    if (m && !contactMtv) contactMtv = m;
                    return !!m;
                }
            );
            if (hit && contactMtv) {
                const into = moveDx * contactMtv.nx + moveDz * contactMtv.nz;
                if (into < 0) {
                    // cào vào mặt chạm: bỏ thành phần cào -> trượt dọc mặt
                    moveDx -= contactMtv.nx * into;
                    moveDz -= contactMtv.nz * into;
                    // VA CHẠM THẬT -> physics_step.registerImpact: rung camera +
                    // gằn chấn theo cường độ xâm thực (tốc độ tiếp cận m/s /25)
                    registerImpact(Math.min(1, (Math.abs(into) / Math.max(1e-3, dt)) / 25));
                    // Realistic collision response: stop instead of bouncing back
                    if (Math.abs(phys.speed) > 5 * KMH_TO_MS) {   // > 5 km/h = va đủ mạnh
                        phys.speed = 0; // Hard stop at high speed
                    } else {
                        phys.speed *= 0.2; // Gentle slowdown at low speed
                    }
                    // XÓA BUG KHÓA ĐÔI: không còn set hit.data.ai.speed = 0 mỗi frame.
                    // NPC có logic hãm riêng (_checkCollision trong TrafficManager);
                    // việc zeroing liên tục khiến 2 xe ghim vào nhau thành deadlock.
                }
            }
        }

        // BÁNH QUAY theo quãng đường THẬT đã đi (trước đây không ai gọi
        // setWheelRotation → bánh đứng im dù xe chạy). ω = v/R, cộng dồn góc.
        wheelSpinAngle += (phys.speed / (bus.wheelRadius || 0.525)) * dt;
        bus.setWheelRotation?.(wheelSpinAngle);

        if (Math.abs(moveDx) > 1e-6 || Math.abs(moveDz) > 1e-6) {
            bus.group.position.x += moveDx;
            bus.group.position.z += moveDz;
            playerStuckT = 0;
        } else if (contactMtv) {
            // bị chặn hoàn toàn (chạm trực diện) -> đếm thời kẹt.
            // D-09: trước đây ngay sau khối này có `playerStuckT = 0;` vô điều
            // kiện -> bộ đếm bị xóa mỗi frame, không bao giờ đạt 2s nên phần
            // đẩy nhẹ + auto-rescue bên dưới là code chết. Chỉ reset khi xe
            // THOÁT được (nhánh if phía trên).
            playerStuckT += dt;
            if (playerStuckT > 2.0 && (isAccel || isBrake)) {
                // đẩy nhẹ tách 2 khối; vẫn bounded bởi depth → hết chồng là dừng
                const push = Math.min(0.35 * dt, contactMtv.depth);
                bus.group.position.x += contactMtv.nx * push;
                bus.group.position.z += contactMtv.nz * push;
            }
            // Kẹt cứng > 3.5s mà vẫn giữ ga/thắng -> cứu hộ về đường gần nhất
            if (playerStuckT > 3.5 && (isAccel || isBrake)
                && typeof rescuePlayerToNearestRoad === 'function') {
                playerStuckT = 0;
                rescuePlayerToNearestRoad();
            }
        }
        } else {
            if (keysPressed.has("KeyW") || keysPressed.has("KeyS") || mobileInput.accel !== 0 || mobileInput.brake !== 0) {
                playerStuckT += dt;
                if (playerStuckT > 1.5 && (isAccel || isBrake)) {
                    // Auto-rescue attempt gently
                    if (playerStuckT > 3.0) {
                        playerStuckT = 0;
                        // Try rescue if available
                        if (typeof rescuePlayerToNearestRoad === 'function') {
                            rescuePlayerToNearestRoad();
                        }
                    }
                }
            } else {
                playerStuckT = 0;
            }
        }
    
    // ĐỊA HÌNH PHẲNG TUYỆT ĐỐI - KHÔNG RAYCAST
    // /P42: truyền `yHint` = cao độ xe ĐANG ở. Không có nó thì thuật toán
    // mặt trên cùng phải chọn theo "cao nhất" ⇒ đi ngang dưới cầu vượt là
    // nhảy lên cầu. Có `yHint` thì nó bám đúng mặt xe đang đứng trên đó, và
    // đi lên ramp/cầu vượt vẫn leo được vì cao độ thay đổi liên tục.
    const yHint = bus.group.position.y;
    let terrainH = map ? map.getTerrainHeight(bus.group.position.x, bus.group.position.z, yHint) : null;
    if (!Number.isFinite(terrainH)) {
        // MAP-000: getTerrainHeight trả null (ngoài lưới chunk đã dựng, vd điểm
        // spawn sân bến chưa stream). Trước đây cộng null -> NaN -> xe "chết"
        // và trả về sớm. Nay: giữ cao độ hiện tại (không rơi, không bịa) và
        // báo 1 lần để còn chẩn đoán.
        if (!_terrainNullWarned) {
            _terrainNullWarned = true;
            console.warn('[tree] getTerrainHeight = null tại', bus.group.position.x.toFixed(1), bus.group.position.z.toFixed(1), '— giữ cao độ hiện tại');
        }
        terrainH = yHint;
    }
    const targetY = terrainH + 0.5;

    // Bám mặt đường MƯỢT mà vẫn không rơi khỏi mặt: giới hạn tốc độ đổi
    // cao độ mỗi frame. Chặn trên là bám (mượt), nhưng vẫn cho xe đuổi kịp
    // khi cầu dốc — nếu cứ khóa cứng thì xe bám trụ trên mặt cầu.
    const maxStep = 0.9 + Math.abs(speedKmh) * 0.06;
    let ny = targetY;
    if (targetY > yHint + maxStep) ny = yHint + maxStep;
    else if (targetY < yHint - maxStep) ny = yHint - maxStep;
    bus.group.position.y = ny;
    
    // Nghiêng/CHÚI thân xe MO PHỎNG GIÁC NHÌN VIA physics_step.js (setBodyMotion
    // chạy trong updateWorld trên MOTION GROUP — phần thân nghiêng, bánh giữ
    // trên root nên KHÔNG chôn lấp xuống asphalt). Block pitch/roll tĩnh gán
    // trực tiếp lên bus.group đã GỠ: kèm BUG DẤU cũ (phanh => đầu ngẩng ngược
    // thực tế) và nghiêng kép khi có motion group.
    
    if (window.collisionSystem) window.collisionSystem.update(playerColId, bus.group.position.x, bus.group.position.z, bus.group.position.y);
    bus.group.updateMatrixWorld(true);
}

// ===== PHÍM CỨU HỘ (R) — đưa xe về điểm ĐƯỜNG HỢP LỆ gần nhất =====
// Dùng khi cơ chế trượt/đẩy tự thoát không đủ (xe ghim giữa các vật cản).
// An toàn: chỉ chọn điểm NẰM TRÊN một segment roadGraph (không bridge/tunnel/
// alley), loại điểm có xe khác / vật môi trường chạm theo kiểm tra SAT, giữ
// nguyên trạng thái chuyến (hành khách/đồng hồ/camera/xe — chỉ dịch vị trí).
function rescuePlayerToNearestRoad() {
    if (!bus?.group || !map?.getRoadGraph) return;
    const g = map.getRoadGraph();
    if (!g || !g.segmentsNear) { ui?.toast("[icon:x] Cứu hộ: road graph chưa sẵn sàng!", true); return; }
    const px = bus.group.position.x, pz = bus.group.position.z;

    // Quét đoạn trong 400m; loại cầu/hầm/ngõ (nền cao độ khác / hẹp chuyên dụng)
    const segs = g.segmentsNear(px, pz, 400, (s) => !s.bridge && s.class !== "TUNNEL" && s.class !== "ALLEY");
    if (!segs.length) { ui?.toast("[icon:x] Cứu hộ: không tìm thấy đường hợp lệ trong 400m", true); return; }

    // Ứng viên = điểm CHIẾU VỤT gần nhất trên mỗi đoạn (không phải tâm — để xe
    // luôn rơi về mặt đường đang chảy qua đúng vị trí người chơi).
    const cands = [];
    for (const s of segs) {
        const a = g._nodeMap.get(s.from), b = g._nodeMap.get(s.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const l2 = dx * dx + dz * dz || 1;
        let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const ex = px - (a.x + dx * t), ez = pz - (a.z + dz * t);
        const ay = (a.y !== undefined) ? a.y : 0;
        const by = (b.y !== undefined) ? b.y : ay;
        cands.push({
            d2: ex * ex + ez * ez,
            x: a.x + dx * t, z: a.z + dz * t, y: ay + (by - ay) * t,
            dx, dz
        });
    }
    cands.sort((p, q) => p.d2 - q.d2);

    // Chọn ứng viên KHÔNG có xe khác/material chạm (loại "đặt vào xe khác")
    const PLAYER_BODY_R = Math.hypot(OBB_HALF_LEN, OBB_HALF_W);
    let chosen = null;
    for (let i = 0; i < cands.length && i < 8; i++) {
        const c = cands[i];
        if (window.collisionSystem) {
            const blocked = window.collisionSystem.check(
                c.x, c.z, PLAYER_BODY_R * 0.85, playerColId, ['static', 'npc'], c.y, 4.0,
                (col) => {
                    // cố tình chừa xa hơn 0.35m cho mỗi bên để không đặt đè đề
                    const m = mtvForHit(c.x, c.z, bus.group.rotation.y, col);
                    return !!m;
                }
            );
            if (blocked) continue;
        }
        chosen = c;
        break;
    }
    if (!chosen) { ui?.toast("[icon:x] Cứu hộ: mọi chỗ gần nhất đều có vật cản, thử lùi lại", true); return; }

    // Xoay theo đoạn — chọn chiều gần với hướng xe hiện tại (giữ cảm giác lái)
    const cur = bus.group.rotation.y;
    const th1 = Math.atan2(chosen.dx, chosen.dz);
    const th2 = th1 + Math.PI;
    const wrap = (a) => { let d = (a - cur) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
    const target = wrap(th1) < wrap(th2) ? th1 : th2;

    bus.group.position.set(chosen.x, chosen.y, chosen.z);   // node.y = mặt đường (contract BUS_AXLE=0.5)
    bus.group.rotation.y = target;
    vehiclePhysics.speed = 0;
    playerStuckT = 0;
    if (window.collisionSystem) window.collisionSystem.update(playerColId, chosen.x, chosen.z, chosen.y);
    ui?.toast("[icon:wrench] Cứu hộ: đã đưa xe về đường hợp lệ gần nhất");
}

let inputHooked = false;
function initInput() {
    // Neu retry sau loi load, initInput chay lai -> listener kep -> phim bam 2 lan.
    if (inputHooked) return;
    inputHooked = true;

    window.addEventListener("keydown", (e) => {
        const code = resolveEventCode(e);
        // Dang gop chu (IME) van cho phep nhan phim dieu khien, nhung khong
        // preventDefault de khong lam nghen giao dien gop chu cua IME.
        const composing = e.isComposing === true || e.keyCode === 229;
        keyDiagPush("D", e);

        if (isConsoleOpen) {
            // Dang mo console: chi Enter/Escape, con lai de nguyen cho o gõ text.
            if (code === "Enter" || code === "NumpadEnter") {
                const cmd = ui.els.consoleInput.value.trim();
                handleCommand(cmd);
            } else if (code === "Escape") {
                isConsoleOpen = false;
                ui.hideConsole();
            }
            return;
        }
        // Dang focus vao o input/textarea/contenteditable (settings, UV skin...)
        // -> nhuong het cho UI, khong dua phim vao keysPressed.
        if (isEditableTarget(e.target)) return;

        if (code === "Slash" && !composing && !e.shiftKey) {
            e.preventDefault();
            isConsoleOpen = true;
            clearPressedKeys();
            ui.showConsole();
            return;
        }
        // ESC xử lý ở handler document (setupMenuEvents) — KHÔNG xử lý ở đây
        // để tránh 2 listener cùng bắt ESC (sẽ toggle 2 lần = không đổi).
        // F3: bat/tat panel debug giao thong (khong anh huong gameplay)
        if (code === "F3") { e.preventDefault(); if (trafficDebug) trafficDebug.toggle(); return; }
        if (gameState !== "playing" || paused) return;
        if (!code) return;   // khong resolve duoc -> bo qua, khong bia phim ao

        const _now = performance.now();

        const _physCode = (typeof e.code === "string" && e.code.length > 0 && e.code !== "Unidentified") ? e.code : null;

        const hasPhysicalEvidence = !!(_physCode || legacyKeyCodeToCode(e));
        if (code === "KeyA" || code === "KeyD") {
            if (keysPressed.has(code) && !steerReleaseAt.has(code) && !hasPhysicalEvidence && !e.repeat) return;
            if (hasPhysicalEvidence) {
                physicalSteerKeys.add(code);
                imeSteerKeys.delete(code);
                imeSteerRefreshUntil.delete(code);
            } else {
                imeSteerKeys.add(code);
                imeSteerRefreshUntil.set(code, _now + IME_STEER_REFRESH_MS);
            }
        }

        steerReleaseAt.delete(code);
        keysPressed.set(code, _now);
        if (imeSteerKeys.has(code)) imeSteerRefreshUntil.set(code, _now + IME_STEER_REFRESH_MS);
        for (const k of keysPressed.keys()) {
            if (k === "KeyA" || k === "KeyD") {
                // Giữ A/D sống khi phím KHÁC được bấm — kể cả phím đó bị IME
                // nuốt code ( UniKey xuất "ư" cho W ). Chỉ bỏ qua nếu A/D
                // không còn bằng chứng vật lý/IME → đúng ghost cần dọn.
                if (physicalSteerKeys.has(k) ||
                    (imeSteerKeys.has(k) && _now < (imeSteerRefreshUntil.get(k) || 0))) keysPressed.set(k, _now);
                continue;
            }
            keysPressed.set(k, _now);
        }
        // LÁI: phím vừa bấm giành quyền, xóa phím đối xứng -> A và D không bao giờ
        // cùng sống trong map. Phím lái ma bị xóa NGAY khi người chơi bấm hướng còn
        // lại, nên lỗi "bấm lái phải không có tác dụng" không thể xảy ra — đây là
        // phân quyền input (last-press wins), không phải khóa hay ép steering = 0.
        if (code === "KeyA") {
            keysPressed.delete("KeyD");
            steerReleaseAt.delete("KeyD");
            physicalSteerKeys.delete("KeyD");
            imeSteerKeys.delete("KeyD");
            imeSteerRefreshUntil.delete("KeyD");
        } else if (code === "KeyD") {
            keysPressed.delete("KeyA");
            steerReleaseAt.delete("KeyA");
            physicalSteerKeys.delete("KeyA");
            imeSteerKeys.delete("KeyA");
            imeSteerRefreshUntil.delete("KeyA");
        }
        if (keysPressed.has("KeyA") && keysPressed.has("KeyD")) {
            keysPressed.delete("KeyA");
            keysPressed.delete("KeyD");
            steerReleaseAt.delete("KeyA");
            steerReleaseAt.delete("KeyD");
            physicalSteerKeys.delete("KeyA");
            physicalSteerKeys.delete("KeyD");
            imeSteerKeys.delete("KeyA");
            imeSteerKeys.delete("KeyD");
            imeSteerRefreshUntil.delete("KeyA");
            imeSteerRefreshUntil.delete("KeyD");
        }
        // Shift/Alt không auto-repeat khi phím khác được nhấn -> sync từ state vật lý.
        // e.shiftKey/e.altKey vẫn đúng khi IME đang gộp chữ, nên KHÔNG bỏ qua
        // block này lúc composing — nếu không Shift+W+A mất boost ngay khi bật UniKey.
        if (e.shiftKey) {
            if (!keysPressed.has("ShiftLeft") && !keysPressed.has("ShiftRight")) keysPressed.set("ShiftLeft", _now);
        } else if (!code.startsWith("Shift")) {
            keysPressed.delete("ShiftLeft"); keysPressed.delete("ShiftRight");
        }
        if (e.altKey) {
            if (!keysPressed.has("AltLeft") && !keysPressed.has("AltRight")) keysPressed.set("AltLeft", _now);
        } else if (!code.startsWith("Alt")) {
            keysPressed.delete("AltLeft"); keysPressed.delete("AltRight");
        }
        if (!composing && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "AltLeft", "AltRight"].includes(code)) e.preventDefault();
        if (e.repeat) return;   // phim tac vu chi xu ly khi VUA bam, khong khi nhan giu

        // R: cứu hộ thủ công khi xe bị ghim giữa các vật cản (one-shot, cooldown 1.5s)
        if (code === "KeyR" && performance.now() - lastRescuePress > 1500 && bus && gameState === "playing") {
            lastRescuePress = performance.now();
            rescuePlayerToNearestRoad();
        }

        if (code === "KeyF" && performance.now() - lastFPressTime > 150 && bus) {
            // F = công tắc đèn pha + đèn xe (đuôi). LED nội thất đi riêng qua L.
            lastFPressTime = performance.now();
            bus.areLightsOn = !bus.areLightsOn;
            bus.setHeadlights?.(bus.areLightsOn);
            bus.setTaillights?.(bus.areLightsOn);
            ui?.toast(`[icon:light] Đèn ${bus.areLightsOn ? 'BẬT' : 'TẮT'}`);
        }
        if (code === "KeyK" && bus) {
            doorTarget = doorTarget === 0 ? 1 : 0;
            bus.doorOpen = false;
            doorServiceStarted = false;
            ui?.toast(`[icon:door] Cửa ${doorTarget === 1 ? 'MỞ' : 'ĐÓNG'}`);
        }
        if (code === "KeyL" && bus) {
            const heldDigit = LED_GROUP_NAMES.findIndex((_, i) => keysPressed.has(`Digit${i + 1}`));
            if (heldDigit >= 0) {
                toggleLedGroup(heldDigit);
            } else {
                bus.setInteriorLed?.(!bus.interiorLedOn);
                ui?.toast(`[icon:light] LED xe ${bus.interiorLedOn ? 'BẬT' : 'TẮT'}`);
            }
        }
        if (/^Digit[1-4]$/.test(code) && bus && keysPressed.has("KeyL")) {
            toggleLedGroup(Number(code.slice(-1)) - 1);
        }
        if (code === "KeyT" && bus) {
            toggleSeatTv();
        }
        if (code === "KeyH" && performance.now() - lastHornPressTime > 300) {
            lastHornPressTime = performance.now();
            audioSystem?.horn(0.45);     // còi xe THẬT (WebAudio)
            ui?.toast("[icon:horn] Bim bim!");
        }
        if (code === "KeyC" && performance.now() - lastCameraPressTime > 200 && cameraSystem) {
            lastCameraPressTime = performance.now();
            cameraSystem.cycleNext();
        }
    });

    window.addEventListener("keyup", (e) => {
        const code = resolveEventCode(e);
        keyDiagPush("U", e);
        if (code) {
            const upTime = performance.now();
            if (code === "KeyA" || code === "KeyD") {
                physicalSteerKeys.delete(code);
                imeSteerKeys.delete(code);
                imeSteerRefreshUntil.delete(code);
                if (keysPressed.has(code)) steerReleaseAt.set(code, upTime + STEER_KEY_MIN_HOLD_MS);
            } else {
                keysPressed.delete(code);
                steerReleaseAt.delete(code);
            }
            return;
        }

        const imeSwallow = (e.isComposing === true || e.keyCode === 229 || (!e.code && !e.key));
        const upPhys = typeof e.code === "string" && e.code.length > 0 && e.code !== "Unidentified";
        if ((imeSwallow || !upPhys) && (keysPressed.has("KeyA") || keysPressed.has("KeyD"))) {
            const releaseAt = performance.now() + STEER_KEY_MIN_HOLD_MS;
            for (const k of ["KeyA", "KeyD"]) {
                if (keysPressed.has(k)) {
                    steerReleaseAt.set(k, releaseAt);
                    physicalSteerKeys.delete(k);
                    imeSteerKeys.delete(k);
                    imeSteerRefreshUntil.delete(k);
                }
            }
        }
    });

    window.addEventListener("blur", clearPressedKeys);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearPressedKeys(); });
}

const LED_GROUP_NAMES = ["ceiling", "trim", "exterior", "body"];
const LED_GROUP_LABELS = ["trần", "viền/lối đi", "ngoại thất", "thân xe"];

function ledLevelText(level) {
    if (level === 0) return 'TẮT';
    return level >= 1 ? 'SÁNG MẠNH' : 'SÁNG YẾU';
}

function toggleLedGroup(index) {
    const name = LED_GROUP_NAMES[index];
    if (!name || !bus?.cycleLedGroup) return;
    const state = bus.cycleLedGroup(name);
    ui?.toast(`[icon:light] LED ${LED_GROUP_LABELS[index]} ${ledLevelText(state[name])}`);
}

function toggleSeatTv() {
    if (!bus?.togglePassengerTv) return;
    const mode = cameraSystem?.modes?.[cameraSystem.currentIndex] || '';
    const m = /^seat_(\d+)$/.exec(mode);
    if (!m || !interior?.paxTv) {
        bus.togglePassengerTv('all');
        ui?.toast('[icon:check] TV giường: bật/tắt tất cả');
        return;
    }
    const seat = cameraSystem.seats?.[Number(m[1])]?.localPos;
    if (!seat) return;
    const positions = interior.paxTv.positions;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const d = (p.x - seat.x) ** 2 + (p.y - seat.y) ** 2 + (p.z - seat.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    bus.togglePassengerTv(best);
    ui?.toast(`[icon:check] TV giường ${best + 1} ${bus.getPassengerTvState?.()[best] ? 'BẬT' : 'TẮT'}`);
}

function handleCommand(cmd) {
    const parts = cmd.split(" ");
    if (parts[0] === "keys") {
        // DIAG phím: "keys" lần 1 = BẬT ghi, "keys" lần 2 = TẮT + in dump.
        keyDiagOn = !keyDiagOn;
        if (keyDiagOn) {
            keyDiagLog.length = 0;
            ui.toast("[icon:check] Đang GHI phím — bật UniKey bấm thử W/A/S/D, rồi gõ lại lệnh: keys");
        } else {
            keyDiagDump();
        }
        return;
    }
    if (parts[0] === "tv") {
        const state = bus?.getPassengerTvState?.() || [];
        const sub = (parts[1] || "").toLowerCase();
        const val = (parts[2] || "").toLowerCase();
        if (sub === "list") {
            ui.toast(`[icon:check] TV giường: ${state.filter(Boolean).length}/${state.length} đang bật`);
        } else if (sub === "all" || sub === "") {
            if (val === "on" || val === "off") bus?.setPassengerTv?.('all', val === 'on');
            else bus?.togglePassengerTv?.('all');
            ui.toast(`[icon:check] TV giường: ${bus?.getPassengerTvState?.().filter(Boolean).length || 0}/${state.length} đang bật`);
        } else {
            const idx = Number(sub) - 1;
            if (!Number.isInteger(idx) || idx < 0 || idx >= state.length) {
                ui.toast(`[icon:x] Cú pháp: tv <1-${state.length}> [on|off] | tv all [on|off]`, true);
            } else {
                if (val === "on" || val === "off") bus?.setPassengerTv?.(idx, val === 'on');
                else bus?.togglePassengerTv?.(idx);
                ui.toast(`[icon:check] TV giường ${idx + 1}: ${bus?.getPassengerTvState?.()[idx] ? 'BẬT' : 'TẮT'}`);
            }
        }
    } else if (parts[0] === "led") {
        const sub = (parts[1] || "").toLowerCase();
        const val = (parts[2] || "").toLowerCase();
        if (sub === "all" || sub === "") {
            if (val === "on" || val === "off") bus?.setInteriorLed?.(val === 'on');
            else bus?.setInteriorLed?.(!bus?.interiorLedOn);
            ui.toast(`[icon:light] LED xe ${bus?.interiorLedOn ? 'BẬT' : 'TẮT'}`);
        } else {
            const idx = Number(sub) - 1;
            if (idx < 0 || idx >= LED_GROUP_NAMES.length) {
                ui.toast(`[icon:x] Cú pháp: led <1-${LED_GROUP_NAMES.length}> [on|off] | led all [on|off]`, true);
            } else {
                const name = LED_GROUP_NAMES[idx];
                if (val === "on") bus?.setLedGroup?.(name, true);
                else if (val === "off") bus?.setLedGroup?.(name, false);
                else toggleLedGroup(idx);
                const level = bus?.getLedLevels?.()?.[name];
                ui.toast(`[icon:light] LED ${LED_GROUP_LABELS[idx]} ${ledLevelText(level)}`);
            }
        }
    } else if (parts[0] === "time" && parts[1]) {
        const tp = parts[1].split("/");
        if (tp.length === 2) {
            const h = parseInt(tp[0]), m = parseInt(tp[1]);
            if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                lighting.setGameTime(h * 60 + m);
                ui.toast(`[icon:check] Đã đặt thời gian thành ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
            } else { ui.toast("[icon:x] Thời gian không hợp lệ!", true); }
        } else { ui.toast("[icon:x] Cú pháp: time HH/MM", true); }
    } else if (parts[0] === "traffic") {
        // Lệnh debug giao thông: traffic | traffic check | traffic spawn <n> | traffic info
        const sub = (parts[1] || "").toLowerCase();
        if (!trafficManager) {
            ui.toast("[icon:x] Chưa vào game / chưa có traffic manager!", true);
        } else if (sub === "check") {
            if (!trafficDebug) { ui.toast("[icon:x] Thiếu TrafficDebug!", true); }
            else {
                const r = trafficDebug.runSelfCheck();
                if (!trafficDebug.enabled) trafficDebug.toggle(true);
                ui.toast(r.pass
                    ? `[icon:check] SELF-CHECK PASS: ${r.checked} xe đều đi bên phải, đúng chiều`
                    : `[icon:x] SELF-CHECK FAIL: sai lề ${r.wrongSide}, sai hướng ${r.wrongHeading}, lều mép ${r.offRoad}`, !r.pass);
            }
        } else if (sub === "spawn") {
            const n = parseInt(parts[2]);
            if (isNaN(n) || n < 0 || n > 60) { ui.toast("[icon:x] Cú pháp: traffic spawn <0-60>", true); }
            else {
                trafficManager.maxVehicles = n;
                gameSettings.npcDensity = n;
                ui.toast(`[icon:check] Mật độ NPC = ${n} (preset cho phép ${trafficManager.graphics.settings.maxActiveTraffic})`);
            }
        } else if (sub === "info") {
            const i = trafficManager.getDebugInfo();
            ui.toast(`NPC ${i.active}/${i.max} · đang chạy ${i.moving} · pool ${i.pooled} · spawn ${i.spawnDistance}m · despawn ${i.despawnDistance}m`);
        } else {
            const on = trafficDebug ? trafficDebug.toggle() : false;
            ui.toast(on ? "[icon:check] Traffic debug: ON (nhấn F3 để tắt)" : "Traffic debug: OFF");
        }
    } else if (parts[0] === "surface") {
        // DEBUG: "Xe rơi ở đâu?" — road segment + collision box
        // + transform tại vị trí xe hiện tại
        if (!map || !bus?.group) {
            ui.toast("[icon:x] Chưa vào game!", true);
        } else {
            const info = map.debugSurfaceAt(
                bus.group.position.x, bus.group.position.z, bus.group.position.y);
            if (!info) ui.toast("[icon:dot] Ngoài mặt đường — đang ở terrain", true);
            else ui.toast(
                `[icon:road] ${info.roadType} · ${info.roadId} · seg ${info.segId}` +
                ` · box #${info.collisionId}` +
                ` · Y=${info.surfaceY.toFixed(2)}m` +
                ` · lệch tâm ${info.offsetFromCenter.toFixed(1)}m`);
        }
    } else { ui.toast("[icon:x] Lệnh không xác định!", true); }
    isConsoleOpen = false;
    ui.hideConsole();
}

function togglePause() {
    // BUG CU: `if (gameState === "playing") paused = true;` luon chay khi dang
    // choi, nen `else if (paused)` KHONG BAO GIO duoc thuc thi -> nhan Escape
    // lan 1 pause, lan 2 van pause, lan 3 van pause... game bi khoa pause, chunk
    // khong load (loadedChunks = 0), xe khong di duoc.
    if (gameState !== "playing") return;
    togglePauseMenu();
}

// ===== QUẢN LÝ GIAO DIỆN: MENU TẠM DỪNG (ESC) + POPUP =====
let pauseMenuOpen = false;
let settingsDirty = false;     // người chơi đã sửa setting nhưng chưa Lưu
let audioSystem = null;
let musicPlayer = null;
let csgtManager = null;        // HUD giới hạn tốc độ + cảnh báo CSGT (js/csgt.js)
const interfaceAnimations = new WeakMap();

function setAnimatedVisibility(element, visible, display = "block") {
    if (!element) return;
    interfaceAnimations.get(element)?.cancel();
    interfaceAnimations.delete(element);

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || typeof element.animate !== "function") {
        element.style.display = visible ? display : "none";
        element.style.pointerEvents = "";
        return;
    }

    if (visible) {
        element.style.display = display;
        element.style.pointerEvents = "";
    } else {
        if (element.style.display === "none") return;
        element.style.pointerEvents = "none";
    }

    const animation = element.animate(
        visible
            ? [{ opacity: 0, translate: "0 16px" }, { opacity: 1, translate: "0 0" }]
            : [{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 16px" }],
        { duration: visible ? 220 : 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "forwards" }
    );
    interfaceAnimations.set(element, animation);
    animation.onfinish = () => {
        if (interfaceAnimations.get(element) !== animation) return;
        interfaceAnimations.delete(element);
        element.style.opacity = "";
        element.style.translate = "";
        if (!visible) element.style.display = "none";
        element.style.pointerEvents = "";
    };
}

function closeAllPanels() {
    const backdrop = document.getElementById("panel-backdrop");
    const settingsPanel = document.getElementById("settings-panel");
    const uvPanel = document.getElementById("uv-skin-panel");
    setAnimatedVisibility(backdrop, false);
    setAnimatedVisibility(settingsPanel, false);
    setAnimatedVisibility(uvPanel, false);
    document.body.style.overflow = '';
    canvas?.focus?.();          // trả focus về game (ô nhập không giữ focus)
}

function togglePauseMenu(force) {
    if (gameState !== "playing") return;
    const next = (typeof force === 'boolean') ? force : !pauseMenuOpen;
    pauseMenuOpen = next;
    const el = document.getElementById("pause-menu");
    setAnimatedVisibility(el, next, "flex");
    if (next) {
        paused = true;                     // game DỪNG thật khi menu mở
        clearPressedKeys();
    } else {
        paused = false;
        clock.getDelta();                  // reset delta, không bù physics nhảy lớn
    }
    lastTime = performance.now();
}

/** ESC tuỳ trạng thái giao diện: console -> popup -> menu tạm dừng. */
function handleEscape() {
    if (gameState !== "playing" && routePickerOpen) {
        resetMenuToHome();
        return;
    }
    // Hộp thoại xác nhận đang mở -> ESC đóng nó (không đụng trạng thái game)
    const dlg = document.getElementById('confirm-dialog');
    if (dlg && dlg.style.display === 'flex') { closeConfirmDialog(); return; }
    if (isConsoleOpen) {
        isConsoleOpen = false;
        ui.hideConsole();
        lastTime = performance.now();
        return;
    }
    // Panel SETTINGS đang mở -> hỏi thay đổi chưa lưu (NHẤT QUÁN với nút ✕)
    const sp = document.getElementById('settings-panel');
    if (sp && sp.style.display === 'block') { requestCloseSettings(); return; }
    // Panel UV Skin đang mở -> đóng thẳng (không có setting nào bên trong)
    const up = document.getElementById('uv-skin-panel');
    if (up && up.style.display === 'block') { closeAllPanels(); return; }
    togglePauseMenu();
}

// ===== ĐỒNG BỘ UI SETTINGS =====
/** Đưa giá trị đang LƯU vào các control của panel Settings (1 nguồn duy nhất
 *  cho cả 2 nơi mở: Main Menu và Menu ESC). */
function syncSettingsUI() {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const txt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('setting-graphics', gameSettings.graphics);
    set('setting-lighting', gameSettings.lightingQuality.toLowerCase());
    set('setting-godrays', gameSettings.godRays);
    set('setting-interior', gameSettings.interior);
    set('setting-npc-density', gameSettings.npcDensity); txt('val-npc-density', gameSettings.npcDensity);
    set('setting-cam-sens', gameSettings.camSens); txt('val-cam-sens', gameSettings.camSens);
    set('setting-fov', gameSettings.fov); txt('val-fov', gameSettings.fov);
    set('setting-render-dist', gameSettings.renderDist); txt('val-render-dist', gameSettings.renderDist);
    set('setting-key-sens', gameSettings.keySens); txt('val-key-sens', Number(gameSettings.keySens).toFixed(1));
    set('setting-audio-volume', Math.round(gameSettings.audioVolume * 100));
    txt('val-audio-volume', Math.round(gameSettings.audioVolume * 100) + '%');
    const mute = document.getElementById('setting-audio-mute');
    if (mute) mute.checked = !!gameSettings.audioMute;
}

// ===== ĐỔI CẤU HÌNH NỘI THẤT (20 phòng <-> 34 giường) =====
function applyInteriorConfig(configId) {
    if (!bus?.group) return;
    const want = (configId === 'BED34') ? 'BED34' : 'BED20';
    if (interior && interior.configId === want) return;   // đang dùng cấu hình này

    const oldInterior = interior;
    // 1) Tạo cấu hình MỚI trước (chỉ 1 cấu hình tồn tại ở mỗi thời điểm)
    const newInt = (want === 'BED34') ? createBusInterior34() : createBusInterior();
    newInt.configId = want;
    // 2) Chuyển COCKPIT (màn/đồng hồ/nút) từ interior cũ sang mới TRƯỚC khi
    //    giải phóng geometry cũ — nếu không, màn hình tài xế biến mất sau khi
    //    đổi cấu hình (bus.js gắn cockpit vào GỐC của interior).
    const moved = migrateInteriorCockpit(oldInterior, newInt);
    // 3) Gỡ + giải phóng cấu hình cũ
    if (oldInterior) {
        (bus.motionGroup || bus.group).remove(oldInterior);
        oldInterior.traverse((o) => {
            if (o.isMesh && o.geometry) o.geometry.dispose();
        });
    }
    // 4) Gắn cấu hình mới
    interior = newInt;
    (bus.motionGroup || bus.group).add(interior);
    bus.setInteriorReference?.(interior);
    // 5) Camera: bộ ghế hành khách theo cấu hình (tọa độ riêng, không chép
    //    nguyên của cấu hình kia). Nếu đang ở ghế hành khách mà cấu hình mới
    //    không còn ghế đó -> về 'driver' (góc nhìn an toàn, không nằm trong giường).
    if (cameraSystem) {
        cameraSystem.setSeatList(want === 'BED34' ? PASSENGER_SEATS_34 : PASSENGER_SEATS);
    }
    // 6) Gộp đèn: 38 -> 16 PointLight trong scene (shader nhẹ hơn ~58% trên N5000)
    optimizeInteriorLights(interior);
    // Giữ nguyên trạng thái từng nhóm LED khi dựng interior mới.
    bus.reapplyLedState?.();
    if (moved > 0) console.log(`[interior] chuyen ${want}: giu ${moved} mesh cockpit`);
}

// ===== ÁP DỤNG + LƯU CÀI ĐẶT =====
function applySettingsToGame() {
    if (cameraSystem) {
        cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        cameraSystem.settings.fov = gameSettings.fov;
        camera.fov = gameSettings.fov;
        camera.updateProjectionMatrix();
    }
    if (map) map.renderRadius = gameSettings.renderDist;
    if (renderer) {
        renderer.toneMapping = (gameSettings.graphics === 'low')
            ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    }
    if (lighting) {
        lighting.setQuality(gameSettings.lightingQuality);
        lighting.atmosphereSystem?.toggleGodRays(gameSettings.godRays !== 'off');
    }
    if (trafficManager) trafficManager.maxVehicles = gameSettings.npcDensity;
    applyInteriorConfig(gameSettings.interior);
    if (audioSystem) {
        audioSystem.setVolume(gameSettings.audioVolume);
        audioSystem.setMuted(gameSettings.audioMute);
    }
    musicPlayer?.setVolume(gameSettings.audioVolume);
}

function saveSettingsToStorage() {
    try {
        localStorage.setItem('busdrivevn_settings', JSON.stringify(gameSettings));
        return true;
    } catch (e) {
        return false;
    }
}

// ===== HỘP THOẠI XÁC NHẬN (dùng chung) =====
// Trả về Promise<'save'|'discard'|'cancel'>. Hộp thoại nằm ở z-index 1200
// (trên mọi lớp) nên không bị che; có 3 nút rõ ràng, đóng được bằng Esc.
let _confirmResolver = null;
function askConfirm(message, labels) {
    const dlg = document.getElementById('confirm-dialog');
    const msg = document.getElementById('confirm-message');
    if (!dlg) return Promise.resolve('cancel');
    if (msg) msg.textContent = message || 'Bạn đã thay đổi cài đặt nhưng chưa lưu.';
    // Nhãn nút tuỳ chọn (mặc định: lưu / bỏ / tiếp tục chỉnh sửa)
    const btnSave = document.getElementById('confirm-save');
    const btnDiscard = document.getElementById('confirm-discard');
    const btnCancel = document.getElementById('confirm-cancel');
    if (btnSave) btnSave.textContent = (labels && labels.yes) || '[icon:save] Lưu thay đổi';
    if (btnDiscard) btnDiscard.textContent = (labels && labels.no) || '[icon:trash] Bỏ thay đổi';
    if (btnCancel) btnCancel.textContent = (labels && labels.cancel) || '[icon:back] Tiếp tục chỉnh sửa';
    dlg.style.display = 'flex';
    const finish = (choice) => {
        dlg.style.display = 'none';
        const r = _confirmResolver;
        _confirmResolver = null;
        if (r) r(choice);
    };
    const onYes = () => finish('save');
    const onNo = () => finish('discard');
    const onCancel = () => finish('cancel');
    document.getElementById('confirm-save')?.addEventListener('click', onYes, { once: true });
    document.getElementById('confirm-discard')?.addEventListener('click', onNo, { once: true });
    document.getElementById('confirm-cancel')?.addEventListener('click', onCancel, { once: true });
    return new Promise((res) => { _confirmResolver = res; });
}
function closeConfirmDialog() {
    const dlg = document.getElementById('confirm-dialog');
    if (dlg) dlg.style.display = 'none';
    const r = _confirmResolver;
    _confirmResolver = null;
    if (r) r('cancel');
}

/** Đóng panel Settings: nếu có thay đổi chưa lưu -> hỏi rõ ràng. */
async function requestCloseSettings() {
    const dlg = document.getElementById('confirm-dialog');
    if (dlg && dlg.style.display === 'flex') return;   // đang hỏi rồi, không hỏi lại
    if (!settingsDirty) { closeAllPanels(); return; }
    const choice = await askConfirm('Bạn đã thay đổi cài đặt nhưng chưa lưu. Lưu thay đổi hay bỏ qua?');
    if (choice === 'save') {
        document.getElementById('btn-apply-settings')?.click();
    } else if (choice === 'discard') {
        settingsDirty = false;
        closeAllPanels();
        // Nạp lại giá trị đã lưu vào UI (người chơi thấy đúng trạng thái đang chạy)
        applySettingsToGame();
    } else {
        // 'cancel' -> giữ panel mở, tiếp tục chỉnh sửa
    }
}

let hudTimer = 0;
let fuelFlushTimer = 0;   // đếm thời gian giữa các lần flushFuel() xuống localStorage
let strandedT = 0;         // đếm thời gian xe hết xăng + đứng yên liên tục
let lowFuelWarned = false; // tránh spam cảnh báo sắp hết nhiên liệu
function handleResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(isLowEnd ? 0.8 : 1.0);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
}

function initRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    renderer.setClearColor(0x87ceeb, 1);
    renderer.setPixelRatio(isLowEnd ? 0.8 : 1.0);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    // Texture input đã ở linear (xem bus.js); output phải encode sRGB lại cho khớp.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // LightingSystem controls shadow updates
    renderer.domElement.addEventListener("webglcontextlost", (e) => {
        // GPU context lost: preventDefault() là điều kiện để browser ĐƯỢC PHÉP
        // khôi phục GL context. Cũ: alert chặn MAIN THREAD + set flag rồi im
        // lặng, KHÔNG có handler restore → máy yếu mất context là đứng hình
        // vô hạn (đúng hiện tượng "treo cứng, không tự phục hồi").
        e.preventDefault();
        webglLost = true;
        console.warn("[render] WebGL context lost — chờ browser khôi phục; >15s không hồi thì F5.");
        ui?.toast?.("GPU quá tải — đang chờ khôi phục (15s không hồi hãy F5)");
        setTimeout(() => {
            if (webglLost) ui?.toast?.("Chưa hồi phục — bấm F5 tải lại (không tự reload để giữ nguyên trạng thái của bạn)");
        }, 15000);
    }, false);
    renderer.domElement.addEventListener("webglcontextrestored", () => {
        // Context hồi phục: Three.js tự re-upload pipeline/texture; reset đồng
        // hồ frame để không bù delta khổng lồ, render tiếp frame tới.
        webglLost = false;
        lastTime = performance.now();
        accumulator = 0;
        console.log("[render] WebGL context restored — chạy lại bình thường.");
    }, false);
    window.addEventListener('resize', handleResize);
}

async function boot() {
    ui = createUI({ map: null });
    // Menu chính hiện số dư THẬT ngay từ đầu (trước đây là chữ tĩnh trong HTML).
    ui.setMoney(getMoney());
    musicPlayer = createMusicPlayer({ volume: gameSettings.audioVolume });
    if (isMobile || isLowEnd) { ui.saveSettings(); }
    ui.showMainMenu();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 150, 800);
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 30000);
    canvas = document.getElementById('game-canvas');
    window.collisionSystem = new CollisionSystem(50);
    initEndermanEasterEgg();
    await new Promise(r => setTimeout(r, 200));
    initRenderer();
    setupMenuEvents();
    window.requestAnimationFrame(loop);
}

// ---- LUỒNG MENU CHÍNH ----
// Menu chính chỉ có 3 nút (LÁI XE / THÊM UV SKIN / CÀI ĐẶT).
// Chọn tuyến (chiều chạy) CHỈ hiện sau khi bấm LÁI XE; bấm CHƠI NGAY mới tải game.
let routePickerOpen = false;

function updatePrimaryMenuButton() {
    const btn = document.getElementById('btn-new-game');
    if (btn) btn.textContent = '[icon:bus] LÁI XE';
}

function highlightDirectionButton(dir) {
    document.querySelectorAll('.dir-btn').forEach(b => {
        const on = b.dataset.dir === dir;
        b.style.borderColor = on ? '#22d3ee'
            : (b.dataset.dir === 'north' ? '#3b82f6' : '#ef4444');
        b.style.boxShadow = on
            ? '0 0 0 3px rgba(34,211,238,0.4), 0 6px 20px rgba(34,211,238,0.3)'
            : (b.dataset.dir === 'north'
                ? '0 4px 14px rgba(59,130,246,0.3)'
                : '0 4px 14px rgba(239,68,68,0.3)');
        b.style.transform = on ? 'scale(1.02)' : 'scale(1)';
    });
}

/** Bấm LÁI XE để mở giao diện chọn tuyến. */
function onPrimaryMenuButton() {
    openRoutePicker();
}

function openRoutePicker() {
    // CHỐT state machine: nút #btn-new-game vẫn nằm trong DOM sau khi vào game;
    // mà không guard thì click ẩn/bot khi đã playing mở picker đè lên gameplay.
    // Người thật không click được nút ẩn, nhưng rà lỗi phải chặn ở gốc.
    if (startingGame || gameState === "playing") return;
    routePickerOpen = true;
    ui.hideMainMenu();
    const picker = document.getElementById('route-picker-panel');
    if (picker) {
        setAnimatedVisibility(picker, true);
        picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    highlightDirectionButton(currentDirection);
    updatePrimaryMenuButton();
}

/** Đưa menu về trạng thái ban đầu (3 nút, chưa mở chọn tuyến). */
function resetMenuToHome() {
    routePickerOpen = false;
    const picker = document.getElementById('route-picker-panel');
    setAnimatedVisibility(picker, false);
    ui.showMainMenu();
    updatePrimaryMenuButton();
}

function setupMenuEvents() {
    document.getElementById("btn-new-game")?.addEventListener("click", onPrimaryMenuButton);
    document.getElementById("btn-play-now")?.addEventListener("click", () => {
        if (routePickerOpen) startGameFromMenu();
    });
    document.getElementById("btn-close-route-picker")?.addEventListener("click", resetMenuToHome);
    document.getElementById("btn-back-to-menu")?.addEventListener("click", resetMenuToHome);
    
    const backdrop = document.getElementById('panel-backdrop');
    const settingsPanel = document.getElementById('settings-panel');
    const uvPanel = document.getElementById('uv-skin-panel');
    
    const btnSettings = document.getElementById('btn-settings-main');
    const btnUvSkin = document.getElementById('btn-uv-skin');
    
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnCloseUvSkin = document.getElementById('btn-close-uv-skin');
    const btnApplySettings = document.getElementById('btn-apply-settings');
    const btnResetSettings = document.getElementById('btn-reset-settings');
    
    const rngNpc = document.getElementById('setting-npc-density');
    const valNpc = document.getElementById('val-npc-density');
    const rngCamSens = document.getElementById('setting-cam-sens');
    const valCamSens = document.getElementById('val-cam-sens');
    const rngFov = document.getElementById('setting-fov');
    const valFov = document.getElementById('val-fov');
    const rngRenderDist = document.getElementById('setting-render-dist');
    const valRenderDist = document.getElementById('val-render-dist');
    
    // Live update value displays
    rngNpc?.addEventListener('input', () => { if(valNpc) valNpc.textContent = rngNpc.value; settingsDirty = true; });
    rngCamSens?.addEventListener('input', () => { if(valCamSens) valCamSens.textContent = rngCamSens.value; settingsDirty = true; });
    rngFov?.addEventListener('input', () => { if(valFov) valFov.textContent = rngFov.value; settingsDirty = true; });
    rngRenderDist?.addEventListener('input', () => { if(valRenderDist) valRenderDist.textContent = rngRenderDist.value; settingsDirty = true; });
    // Tùy chọn mới
    document.getElementById('setting-key-sens')?.addEventListener('input', (e) => {
        const v = document.getElementById('val-key-sens');
        if (v) v.textContent = Number(e.target.value).toFixed(1);
        settingsDirty = true;
    });
    document.getElementById('setting-audio-volume')?.addEventListener('input', (e) => {
        const v = document.getElementById('val-audio-volume');
        if (v) v.textContent = e.target.value + '%';
        settingsDirty = true;
    });
    document.getElementById('setting-interior')?.addEventListener('change', () => { settingsDirty = true; });
    document.getElementById('setting-graphics')?.addEventListener('change', () => { settingsDirty = true; });
    document.getElementById('setting-lighting')?.addEventListener('change', () => { settingsDirty = true; });
    document.getElementById('setting-godrays')?.addEventListener('change', () => { settingsDirty = true; });
    document.getElementById('setting-audio-mute')?.addEventListener('change', () => { settingsDirty = true; });

    // Chọn chiều chạy — chỉ hiện sau khi bấm "LÁI XE"
    document.querySelectorAll('.dir-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDirection = btn.dataset.dir;
            setTravelDirection(currentDirection);
            highlightDirectionButton(currentDirection);
            updatePrimaryMenuButton();
        });
    });
    // Khôi phục chiều đã lưu (KHÔNG .click(): click sẽ đổi nút thành CHƠI NGAY
    // ngay khi vừa vào menu, làm bỏ qua bước chọn tuyến).
    const savedDir = getTravelDirection();
    if (savedDir === 'north' || savedDir === 'south') currentDirection = savedDir;
    highlightDirectionButton(currentDirection);
    updatePrimaryMenuButton();

    // Helper to open panel with backdrop
    function openPanel(panel) {
        setAnimatedVisibility(backdrop, true);
        setAnimatedVisibility(panel, true);
        document.body.style.overflow = 'hidden';
    }
    // closeAllPanels: dùng bản GLOBAL (đã trả focus về game) — không khai
    // báo lại ở đây để tránh 2 hàm cùng tên (bản local che mất bản global).

    // Settings panel
    btnSettings?.addEventListener("click", () => {
        openPanel(settingsPanel);
        syncSettingsUI();      // dong bo TAT CA gia tri dang luu (ke ca noi that 20/34)
    });
    
    // UV status: marker [icon:name] -> span SVG/CSS, text vẫn là text node.
    function setUvStatus(el, text, color) {
        if (!el) return;
        el.replaceChildren();
        const m = String(text).match(/^\[icon:([a-z-]+)\]\s*/i);
        if (m) {
            const span = document.createElement('span');
            span.className = `ui-icon ui-icon--${m[1]}`;
            span.style.marginRight = '8px';
            el.appendChild(span);
        }
        el.appendChild(document.createTextNode(m ? text.slice(m[0].length) : text));
        if (color) el.style.color = color;
    }

    // UV Skin panel
    btnUvSkin?.addEventListener('click', () => {
        openPanel(uvPanel);
        const uvStatus = document.getElementById('uv-skin-status');
        const uvDownload = document.getElementById('uv-skin-download');
        const uvPreview = document.getElementById('uv-skin-preview');
        if(uvStatus) uvStatus.innerHTML = '';
        if(uvDownload) uvDownload.style.display = 'none';
        if(uvPreview) uvPreview.style.display = 'none';
    });

    // Close handlers — panel Settings hỏi khi có thay đổi chưa lưu; panel UV
    // Skin đóng thẳng (không có setting nào trong đó).
    btnCloseSettings?.addEventListener('click', () => { requestCloseSettings(); });
    btnCloseUvSkin?.addEventListener('click', closeAllPanels);
    backdrop?.addEventListener('click', () => { requestCloseSettings(); });
    
    // ESC key to close — DÙNG CHUNG handler với game (handleEscape) để không
    // có 2 listener ESC cạnh tranh (listener document cũ đóng panel nhưng
    // không cập nhật trạng thái pause).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.repeat) handleEscape();
    });

    // Apply settings — đọc TẤT CẢ giá trị từ UI, áp dụng thật rồi LƯU.
    btnApplySettings?.addEventListener("click", () => {
        const selGraphics = document.getElementById('setting-graphics');
        if (selGraphics) gameSettings.graphics = selGraphics.value;

        const selLighting = document.getElementById('setting-lighting');
        if (selLighting) gameSettings.lightingQuality = selLighting.value.toUpperCase();

        const selGodRays = document.getElementById('setting-godrays');
        if (selGodRays) gameSettings.godRays = selGodRays.value;

        const selInterior = document.getElementById('setting-interior');
        if (selInterior) gameSettings.interior = selInterior.value;

        if (rngNpc) gameSettings.npcDensity = parseInt(rngNpc.value);
        if (rngCamSens) gameSettings.camSens = parseInt(rngCamSens.value);
        if (rngFov) gameSettings.fov = parseInt(rngFov.value);
        if (rngRenderDist) gameSettings.renderDist = parseInt(rngRenderDist.value);

        const rngKeySens = document.getElementById('setting-key-sens');
        if (rngKeySens) gameSettings.keySens = parseFloat(rngKeySens.value);

        const rngAudioVol = document.getElementById('setting-audio-volume');
        if (rngAudioVol) gameSettings.audioVolume = parseInt(rngAudioVol.value) / 100;
        const chkAudioMute = document.getElementById('setting-audio-mute');
        if (chkAudioMute) gameSettings.audioMute = !!chkAudioMute.checked;

        applySettingsToGame();                    // áp dụng thật vào game
        const saved = saveSettingsToStorage();     // lưu bền vững
        settingsDirty = false;
        if (!bus?.group && gameSettings.interior) {
            // Đang ở Main Menu: chưa có xe để đổi ngay — cấu hình sẽ áp dụng
            // lúc vào game. Nói rõ để người chơi không tưởng setting bị bỏ qua.
            ui?.toast(saved
                ? `[icon:save] Đã lưu — nội thất ${gameSettings.interior === 'BED34' ? '34 giường VIP' : '20 phòng VIP'} sẽ áp dụng khi vào game`
                : "[icon:warn] Đã áp dụng nhưng không lưu được (localStorage bị chặn)");
        } else {
            ui?.toast(saved ? "[icon:check] Đã áp dụng & lưu cài đặt!" : "[icon:warn] Đã áp dụng nhưng không lưu được (localStorage bị chặn)");
        }
        closeAllPanels();
    });

    // Reset settings to defaults
    btnResetSettings?.addEventListener("click", () => {
        // BUG-010: bản cũ đặt gameSettings = object tạm THIẾU KHÓA (interior/
        // keySens/audioVolume/audioMute) rồi cập nhật UI TỪ OBJECT ĐÓ trước khi
        // gán DEFAULT_SETTINGS -> select "Cấu hình nội thất" hiện TRỐNG sau khi
        // bấm ĐẶT LẠI (value=undefined), phải đóng-mở panel mới đồng bộ lại.
        // Fix gốc: 1 nguồn duy nhất (DEFAULT_SETTINGS), áp dụng + LƯU + đồng bộ
        // UI bằng syncSettingsUI (bản sync đầy đủ dùng chung cho cả 2 cửa mở).
        gameSettings = { ...DEFAULT_SETTINGS };
        applySettingsToGame();
        saveSettingsToStorage();
        syncSettingsUI();
        settingsDirty = false;
        ui?.toast("[icon:back] Đã đặt lại mặc định!");
    });

    // ===== MENU TẠM DỪNG (ESC) — 4 NÚT BẮT BUỘC =====
    const btnPauseResume = document.getElementById('btn-pause-resume');
    const btnPauseUvSkin = document.getElementById('btn-pause-uvskin');
    const btnPauseSettings = document.getElementById('btn-pause-settings');
    const btnPauseMenu = document.getElementById('btn-pause-menu');

    // Tiếp tục: đóng menu + game chạy lại (input trở lại bình thường)
    btnPauseResume?.addEventListener('click', () => {
        closeAllPanels();
        togglePauseMenu(false);
        canvas?.focus?.();
        ui?.toast("[icon:play] Tiếp tục lái xe");
    });

    // Chọn UV Skin: mở popup (KHÔNG tạo bản sao popup) — giữ nguyên pause
    btnPauseUvSkin?.addEventListener('click', () => {
        openPanel(uvPanel);
        const uvStatus = document.getElementById('uv-skin-status');
        const uvDownload = document.getElementById('uv-skin-download');
        const uvPreview = document.getElementById('uv-skin-preview');
        if (uvStatus) uvStatus.innerHTML = '';
        if (uvDownload) uvDownload.style.display = 'none';
        if (uvPreview) uvPreview.style.display = 'none';
    });

    // Cài đặt: mở popup, vẫn giữ game tạm dừng
    btnPauseSettings?.addEventListener('click', () => {
        openPanel(settingsPanel);
        syncSettingsUI();          // dong bo gia tri dang luu vao UI
    });

    // Về Menu chính: xác nhận vì có thể mất tiến trình trong phiên chơi
    btnPauseMenu?.addEventListener('click', async () => {
        const choice = await askConfirm(
            'Về Menu chính? Tiến trình chuyến đi hiện tại sẽ không được lưu.',
            { yes: '[icon:home] Về Menu chính', no: '[icon:x] Ở lại', cancel: '[icon:back] Quay lại menu' }
        );
        if (choice !== 'save') return;   // chỉ "Về Menu chính" mới thoát
        closeAllPanels();
        togglePauseMenu(false);
        gameState = 'menu';
        paused = false;
        csgtManager?.reset();
        resetMenuToHome();
        document.getElementById('hud').style.display = 'none';
        ui.showMainMenu();
    });

    // UV Skin handlers
    const btnChooseSkin = document.getElementById('btn-choose-skin');
    const uvInput = document.getElementById('uv-skin-input');
    const uvStatus = document.getElementById('uv-skin-status');
    const uvDownload = document.getElementById('uv-skin-download');
    const uvPreview = document.getElementById('uv-skin-preview');
    const uvPreviewImg = document.getElementById('uv-skin-preview-img');
    const dropzone = document.getElementById('uv-skin-dropzone');

    btnChooseSkin?.addEventListener('click', () => { if(uvInput) uvInput.click(); });
    
    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt => {
        dropzone?.addEventListener(evt, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropzone.classList.add('drag-over');
        });
    });
    ['dragleave', 'drop'].forEach(evt => {
        dropzone?.addEventListener(evt, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropzone.classList.remove('drag-over');
        });
    });
    dropzone?.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) handleSkinFile(file);
    });

    uvInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleSkinFile(file);
    });

    function handleSkinFile(file) {
        if(uvStatus) { uvStatus.textContent = 'Đang kiểm tra...'; uvStatus.style.color = '#fff'; }
        if(uvDownload) uvDownload.style.display = 'none';
        if(uvPreview) uvPreview.style.display = 'none';
        
        if (!file.type.match('image/png') && !file.name.toLowerCase().endsWith('.png')) {
            setUvStatus(uvStatus, '[icon:x] File phải là PNG', '#f87171');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUvStatus(uvStatus, '[icon:x] File quá lớn (max 5MB)', '#f87171');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            const arr = new Uint8Array(ev.target.result);
            const isPng = arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47;
            if (!isPng) {
                setUvStatus(uvStatus, '[icon:x] File không phải PNG hợp lệ', '#f87171');
                return;
            }
            const img = new Image();
            img.onload = () => {
                if (img.width !== 2048 || img.height !== 1024) {
                    setUvStatus(uvStatus, `[icon:x] Kích thước sai. Yêu cầu: 2048×1024. File: ${img.width}×${img.height}`, '#f87171');
                    return;
                }
                setUvStatus(uvStatus, '[icon:check] UV Skin hợp lệ', '#34d399');
                const objUrl = URL.createObjectURL(file);
                if(uvPreview && uvPreviewImg) {
                    uvPreviewImg.src = objUrl;
                    uvPreview.style.display = 'block';
                }
                if(uvDownload) {
                    uvDownload.href = objUrl;
                    uvDownload.style.display = 'block';
                }
                // ===== ÁP DỤNG SKIN LÊN XE NGƯỜI CHƠI THẬT =====
                // bus.setSkin() tồn tại từ trước nhưng KHÔNG nơi nào gọi ->
                // popup chỉ tải file về chứ xe không đổi. Gọi ở đây (ảnh đã
                // kiểm tra đúng kích thước) nên texture đúng chuẩn UV.
                if (bus?.setSkin) {
                    try {
                        bus.setSkin(objUrl);
                        setUvStatus(uvStatus, '[icon:check] UV Skin hợp lệ — đã áp dụng lên xe', '#34d399');
                    } catch (e) {
                        console.warn("[uv-skin] setSkin that bai:", e);
                        setUvStatus(uvStatus, '[icon:warn] Không áp dụng được lên xe (xe chưa sẵn sàng)', '#f87171');
                    }
                }
            };
            img.onerror = () => setUvStatus(uvStatus, '[icon:x] Lỗi đọc file', '#f87171');
            img.src = URL.createObjectURL(file);
        };
        reader.readAsArrayBuffer(file);
    }
}

// CHỐNG BẤM NÚT NHIỀU LẦN: bấm đúp "Lái xe thôi" hoặc bấm lúc đang tải sẽ
// chạy init 2 lần song song -> biến null (roadGraph/bus) -> crash
// "Cannot read properties of null (reading 'pois')".
let startingGame = false;
async function startGameFromMenu() {
    if (startingGame) return;
    if (gameState === "playing") return;
    startingGame = true;
    routePickerOpen = false;
    const routePicker = document.getElementById('route-picker-panel');
    setAnimatedVisibility(routePicker, false);
    ui.hideMainMenu();
    ui.setLoading("Đang tải...", 0.1);
    // ÂM THANH: tạo + khởi động NGAY TRONG click (user gesture) — trình duyệt
    // chặn AudioContext nếu khởi động sau await (chính sách autoplay).
    if (!audioSystem) audioSystem = createAudioSystem();
    audioSystem.setVolume(gameSettings.audioVolume);
    audioSystem.setMuted(gameSettings.audioMute);
    audioSystem.startEngine();
    await new Promise(r => setTimeout(r, 100));
    try {
        ui.setLoading("Ánh sáng...", 0.2);
        // timeScale KHÔNG đặt cứng ở đây. `TravelClock` (dựng ở dưới, ngay
        // sau khi có roadGraph) sẽ thay nó mỗi tick bằng tốc độ thực, độ dốc,
        // loại đường, số giao lộ, ùn tắc và thời gian đứng bến. Ở đây chỉ khởi
        // tạo với giá tru ngang (xe đứng yên -> đồng hồ gần như đứng).
        lighting = new LightingSystem(renderer, scene, camera, { 
            timeScale: 0.12, 
            initialMinutes: 1080,  // 18:00
            quality: gameSettings.lightingQuality 
        });
        // Apply god rays setting
        if (lighting.atmosphereSystem) {
            const val = gameSettings.godRays;
            if (val === 'off') lighting.atmosphereSystem.toggleGodRays(false);
            else lighting.atmosphereSystem.toggleGodRays(true);
        }
        lighting.update(0.1);
        await new Promise(r => setTimeout(r, 300));
        
        // Apply camera FOV
        if (camera) { camera.fov = gameSettings.fov; camera.updateProjectionMatrix(); }
        
        ui.setLoading("Đang tải dữ liệu bản đồ (JSON)...", 0.4);
        await new Promise(r => setTimeout(r, 50));
        map = new MapLoader(scene);
        // Apply render distance
        map.renderRadius = gameSettings.renderDist;
        const success = await map.loadInitialData();
        if (!success) throw new Error("Không thể tải dữ liệu bản đồ JSON. Vui lòng chạy Python generator trước.");
        ui.setupMinimap(map);
        // Nap vi tri cot den cho street lights pool (chi thuc hien MOT LAN, truoc
        // frame render dau tien -> numPointLights co dinh, khong recompile shader).
        lighting.setStreetLamps(collectStreetLampPositions(scene));
        await new Promise(r => setTimeout(r, 100));
        
        ui.setLoading("Xe khách 3D...", 0.6);
        bus = createBus();
        // Geometry thật của xe (texture) là nguồn duy nhất cho physics:
        // wheelbase ~6.25m, bán kính bánh 0.525m, track từ halfTrack.
        configureVehicleGeometry({
            wheelbase: bus.dimensions.frontAxleZ - bus.dimensions.rearAxleZ,
            wheelRadius: bus.dimensions.wheelRadius,
            trackWidth: bus.dimensions.halfTrack * 2,
        });
        // Cấu hình nội thất theo setting (20 phòng / 34 giường) — dựng 1
        // cấu hình duy nhất, không dựng song song 2 bản.
        interior = (gameSettings.interior === 'BED34') ? createBusInterior34() : createBusInterior();
        interior.configId = (gameSettings.interior === 'BED34') ? 'BED34' : 'BED20';
        if (!interior?.isObject3D) interior = new THREE.Group();
        // Nội thất vào MOTION GROUP (nghiêng cùng thân xe; bám camera PHẦN 10.5)
        (bus.motionGroup || bus.group).add(interior);
        // GỘP ĐÈN cabin: 31 PointLight (20 phòng) -> 9 (giữ nguyên mesh dải
        // LED). Mỗi PointLight là 1 vòng lặp trong shader của MỌI vật liệu;
        // 38 đèn trong scene = frame ~1.1s trên iGPU N5000 (đo được) ->
        // "không load vào game". Gọi 1 lần lúc khởi động (trước frame đầu).
        optimizeInteriorLights(interior);
        // Cockpit tài xế (Windows Update/BSOD/speedo, nút phân màu) được gán
        // RUNTIME lên mesh dashboard có sẵn — bus.setInteriorReference là hook hiện có.
        bus.setInteriorReference?.(interior);
    // Pass physics to camera for vibration
    if (cameraSystem) {
        cameraSystem.setMotionSource(PHYSICS_STATE);
    }
    // Ensure steering/cockpit sync on init
    bus.setSteering?.(0);
    bus.setCockpitSteering?.(0);
    bus.setDriverTelemetry?.(vehiclePhysics.currentSpeedKmh || 0, vehiclePhysics.engineRPM || 800, 1, 0);
    if (PHYSICS_STATE) {
        PHYSICS_STATE.surfaceRoughness = 0.15;
        PHYSICS_STATE.tireGrip = 1.0;
        PHYSICS_STATE.impactIntensity = 0;
    }
        scene.add(bus.group);
        const spawn = map.getSpawnPoint(currentDirection);
        bus.group.position.set(spawn.x, spawn.y, spawn.z);
        bus.group.rotation.y = (spawn.heading || 0) + Math.PI / 2;
        bus.group.name = 'player_bus';
        // (window.__busvn.renderer.info.render.calls). Không ảnh hưởng logic.
        window.__busvn = {
            THREE,
            get renderer() { return renderer; },
            get scene() { return scene; },
            get camera() { return camera; },
            get map() { return map; },
            get bus() { return bus; },
            get npc() { return npc; },
            // Trạng thái chạy thật của xe (speed m/s, RPM, gear) — để test
            // Phase 1 so sánh đồng hồ ↔ quãng đường thật.
            get vehiclePhysics() { return vehiclePhysics; },
            get physicsState() { return PHYSICS_STATE; },
            get passengerSystem() { return passengerSystem; },
            get traffic() { return trafficManager; },
            get trafficDebug() { return trafficDebug; },
            // He thong chieu sang + thoi gian. Cho phep doi gio trong ngay de test
            // ban ngay/buoi toi (vd: __busvn.lighting.setGameTime(14 * 60)).
            get lighting() { return lighting; },
            // HUD cảnh báo CSGT + giới hạn tốc độ (js/csgt.js) — để test
            get csgt() { return csgtManager; },
            // Dựng 1 khung hình thủ công (tab bị ẩn thì requestAnimationFrame
            // bị treo -> không test được). Dùng để đo FPS/draw call thật.
            tick: (times = 1) => { for (let i = 0; i < times; i++) loop(); },
            // Chay N buoc mo phong CO DINH (FIXED_STEP) khong phu thuoc FPS cua
            // trinh duyet — dung cho test CDP headless: trang an/khong focus thi
            // requestAnimationFrame bi dung, nhung logic game van phai kiem duoc.
            manualStep: (n = 1) => {
                for (let i = 0; i < n; i++) { updateWorld(FIXED_STEP); updateHUD(FIXED_STEP); }
                renderer?.render(scene, camera);
            },
            // DEBUG: cac phim dieu khien dang duoc nhan (dung de test IME/UniKey)
            pressedKeys: () => [...keysPressed.keys()],
            resolveKey: (ev) => resolveEventCode(ev),
            state: () => ({ gameState, paused, webglLost, renderRadius: map?.renderRadius })
        };
        if (window.collisionSystem) playerColId = window.collisionSystem.register(bus.group.position.x, bus.group.position.z, 4.0, 'player');
        cameraSystem = new CameraSystem(camera, bus.group, {
            seats: (gameSettings.interior === 'BED34') ? PASSENGER_SEATS_34 : PASSENGER_SEATS
        });
        cameraSystem.setMode("driver");
        cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        cameraSystem.settings.fov = gameSettings.fov;
        // Camera dán cùng chuyển động thân (PHẦN 10.5 — không rung khi vô nguyên do)
        cameraSystem.setMotionSource(PHYSICS_STATE);
        // Passenger system đọc window.PHYSICS_STATE để phản hồi chuyển động xe
        window.PHYSICS_STATE = PHYSICS_STATE;
        await new Promise(r => setTimeout(r, 300));
        
        ui.setLoading("Giao thông & Hành khách...", 0.8);
        await loadNpcSkinList();
        const roadGraph = map.getRoadGraph();
        if (!roadGraph) throw new Error("Road graph chưa sẵn sàng — loadInitialData() lỗi?");
        // HUD tốc độ + CSGT: giới hạn đọc từ seg.speed của dữ liệu đường.
        csgtManager?.dispose();
        csgtManager = createCSGTManager({
            roadGraph,
            stationsData: map.getStationsData?.() || []
        });
        // Chốt CSGT THẬT trong thế giới (dựng tại trạm thu phí — js/map.js).
        // HUD chỉ cảnh báo quanh các chốt này, không cảnh báo "ma".
        csgtManager.addCheckpoints?.(map.getCSGTCheckpoints?.() || []);
        // Phase 6: giờ game suy từ lái xe thật. Độ dốc lấy từ `node.y` của
        // đoạn đường đứng (đã gồm ROAD_LIFT); `getHeight` chỉ dùng khi xe
        // chạy ngoài đường — lúc đó mới quy về địa hình.
        travelClock = new TravelClock({
            roadGraph,
            getHeight: (x, z) => map.getHeight(x, z)
        });
        npc = createNPC({
            scene, map, seed: 2027, playerBus: bus, direction: currentDirection,
            playerSpawnPos: { x: spawn.x, z: spawn.z }
        });
        trafficManager = createTrafficManager({ scene, roadGraph: roadGraph, playerRef: bus, maxVehicles: gameSettings.npcDensity || 5 });
        // NPC "học sinh cá biệt GDCD" (spawn hiếm) mở mồm qua HUD toast.
        trafficManager.onDialogue = (t) => ui?.toast(t);
        // GỘP HAI HỆ THỐNG: npc.js trước đây tự spawn 15 xe không AI (bản song
        // song). Giờ TrafficManager là NGUỒN DUY NHẤT của xe đang chạy; npc.js
        // giữ nguyên API nhưng ủy quyền số liệu về đây.
        npc.setTrafficManager?.(trafficManager);
        // Xe người chơi đậu ngay một baySlots: đăng ký vào registry chung TRƯỚC
        // khi queue bến chạy, nếu không xe tĩnh sẽ đỗ đè đúng tọa độ spawn.
        trafficManager.markBayBusy(spawn.x, spawn.z);
        trafficDebug = new TrafficDebug({
            scene, camera, traffic: trafficManager, roadGraph,
            getPlayerPos: () => (bus && bus.group ? bus.group.position : null)
        });
        
        // Setup station traffic from POIs
        if (roadGraph && roadGraph.pois) {
            for (const poi of roadGraph.pois) {
                if (poi.type === 'BUS_STATION' || poi.type === 'MAJOR_BUS_TERMINAL' || poi.type === 'REST_AREA' || poi.type === 'FUEL_STATION') {
                    trafficManager.setupStationTraffic(poi);
                }
            }
        }
        
        passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui, interiorType: gameSettings.interior });
        await new Promise(r => setTimeout(r, 10));
        
        ui.setLoading("Hoàn tất...", 1.0);
        await new Promise(r => setTimeout(r, 100));
        ui.hideLoading();
        // ÁP DỤNG toàn bộ cài đặt đã lưu (nội thất, âm lượng, mật độ NPC,
        // chất lượng đồ hoạ...) — 1 nơi duy nhất để không lệch với nhau.
        applySettingsToGame();
        gameState = "playing";
        paused = false;
        document.getElementById("hud").style.display = "block";
        initInput();
        canvas?.focus?.();
        clock.start();
        lastTime = performance.now();
    } catch (error) {
        console.error("❌ Lỗi chi tiết:", error);
        alert("Lỗi tải game:\n" + error.message + "\n\nStack: " + error.stack);
        resetMenuToHome();
        ui.showMainMenu();
    } finally {
        startingGame = false;   // cho phép thử lại nếu lần trước lỗi
    }
}

function updateWorld(delta) {
    pruneStaleKeys(performance.now());
    if (!lighting) return;
    // --- Phase 6: giờ game suy từ lái xe thật ---
    // TravelClock trả về timeScale (theo tốc độ/độ dốc/loại đường) và
    // delayMinutes (giao lộ + ùn tắc + dừng bến). Đồng hồ nhận timeScale
    // qua field sẵn có của LightingSystem nên không phải sửa contract
    // getGameTime(); delay cộng qua addGameMinutes().
    if (travelClock && bus?.group) {
        const r = travelClock.update(delta, {
            x: bus.group.position.x,
            z: bus.group.position.z,
            speedKmh: vehiclePhysics.currentSpeedKmh
        });
        lighting.timeScale = r.timeScale;
        if (r.delayMinutes > 0) lighting.addGameMinutes(r.delayMinutes);
    }
    // Pass busGroup for shadow cascade updates
    lighting.update(delta, bus?.group || null);
    if (bus && bus.setDoor) {
        doorProgress += (doorTarget - doorProgress) * Math.min(1, 3.0 * delta);
        bus.setDoor?.(doorProgress);
        bus.doorOpen = doorTarget === 1 && doorProgress >= 0.98;
        if (bus.doorOpen && !doorServiceStarted) {
            doorServiceStarted = true;
            if (passengerSystem &&
                !passengerSystem.dropOffAtRouteDestination?.()) {
                const picked = passengerSystem.pickUpPassengers();
                // Doanh thu vé: thu khi khách lên xe (như phụ xe thu tiền mặt).
                if (picked > 0) {
                    const revenue = picked * FARE_PER_PASSENGER;
                    addMoney(revenue);
                    ui?.setMoney?.(getMoney());
                    ui?.toast?.(`[icon:money] +${formatMoney(revenue)} (${picked} vé)`);
                }
            }
        } else if (doorTarget === 0) {
            doorServiceStarted = false;
        }
    }
    // === VẬT LÝ CẢM GIÁC (physics_step.js) — nhận TRẠNG THÁI THẬT ===
    updateVehiclePhysics(delta);
    // main.js giữ nguồn lái/tốc/phanh (có settings keySens); physics_step chỉ
    // tính đại lượng cho camera/nội thất/âm thanh: roll/pitch/heave/sway,
    // nhíp 4 bánh, RPM/hộp số — KHÔNG chạy hệ lái thứ hai song song.
    const accelActivePhys = keysPressed.has("KeyW") || mobileInput.accel > 0;
    const boostActivePhys = (keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight")) && accelActivePhys;
    const throttleVal = boostActivePhys ? 1 : (accelActivePhys ? 0.3 : 0);
    const brakeVal = keysPressed.has("Space") ? -1 :
        (keysPressed.has("KeyS") || mobileInput.brake > 0 || keysPressed.has("AltLeft") || keysPressed.has("AltRight") ? -0.75 : 0);
    // Tải xe theo số hành khách THẬT (nguồn duy nhất: hệ hành khách)
    const paxInfo = passengerSystem?.getPassengerCount?.();
    if (paxInfo && PHYSICS_STATE) {
        PHYSICS_STATE.passengerCount = paxInfo.onboard || 0;
        PHYSICS_STATE.massFactor = 1.0 + (paxInfo.onboard || 0) / (paxInfo.max || 20) * 0.33;
    }
    // PHASE 3 — Lấy mẫu cao độ mặt đường dưới 4 bánh (dữ liệu THẬT từ map qua
    // getTerrainHeight — road surface boxes / địa hình; KHÔNG suy diễn).
    let wheelSurface = null;
    if (map?.getTerrainHeight && bus?.group) {
      const p = bus.group.position, yaw = bus.group.rotation.y;
      const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
      const d = BUS_DIMENSIONS;
      const halfTrack = d.halfTrack ?? (d.width / 2 - 0.13);
      const faZ = d.frontAxleZ ?? 3.65, raZ = d.rearAxleZ ?? -2.60;
      const sample = (lx, lz) => {
        const wx = p.x + lx * cosY + lz * sinY;
        const wz = p.z - lx * sinY + lz * cosY;
        const h = map.getTerrainHeight(wx, wz, p.y);
        return Number.isFinite(h) ? h : null;
      };
      const ref = map.getTerrainHeight(p.x, p.z, p.y);
      // fl/fr là trước-TRÁI/trước-PHẢI (+x bus local = bên PHẢI theo hệ bus)
      const fl = sample(-halfTrack, faZ), fr = sample(halfTrack, faZ);
      const rl = sample(-halfTrack, raZ),  rr = sample(halfTrack, raZ);
      if ([ref, fl, fr, rl, rr].every(Number.isFinite)) wheelSurface = { fl, fr, rl, rr, ref };
    }
    const physState = updatePhysicsState(delta, vehiclePhysics.currentSpeedKmh || 0, steerAngle, throttleVal, brakeVal, vehiclePhysics.engineRPM, vehiclePhysics.gear, vehiclePhysics.massInfo || null, wheelSurface);
    // Thân xe nghiêng/chúi/nhún qua motion group (bánh + đèn ngoài giữ root)
    bus.setBodyMotion?.(physState.pitch, physState.roll, physState.heave, physState.sway);
    // Nhíp 4 bánh nén/giãn theo tải (PHẦN 9.4/9.6)
    bus.setWheelSuspension?.(physState.suspension);
    // Road surface simulation — D-08: mô hình rung xác định theo quãng đường
    // (physics_step.updateRoadRoughness), không còn Math.random() mỗi frame.
    // PHASE 3: Surface properties from segment class/type (procedural, no map JSON change)
    if (PHYSICS_STATE) {
        // Bề mặt đã được cập nhật mỗi BƯỚC VẬT LÝ trong updateVehiclePhysics
        // (cùng chỗ có đoạn đường đang chạy + độ dốc). Trước đây quét lưới
        // segmentsNear ở đây mỗi bước (60 Hz) = cấp phát mảng vô ích.
        updateRoadRoughness(delta, vehiclePhysics.speed);
        // Grip is set by applySurfaceFromSegment on segment change (single source).
        // No per-frame drift — that was a bug that slowly moved grip away from
        // the correct surface value.
    }
    // bus.update trước đây KHÔNG được gọi → đèn xi nhan/blink chết. Nối lại,
    // đồng thời là chu kỳ redraw cockpit (script update/BSOD 1s/lần).
    bus.update?.(delta);
    // tốc độ xe thật (kmh có dấu) → đồng hồ tài xế
    bus.setDriverTelemetry?.(vehiclePhysics.currentSpeedKmh, vehiclePhysics.engineRPM, vehiclePhysics.isReversing ? -1 : vehiclePhysics.gear, vehiclePhysics.enginePowerKW);
    // Tiếng máy bám TUA + TẢI thật (physics_step) — js/audio.js
    if (audioSystem?.isStarted()) audioSystem.setSpeed(vehiclePhysics.currentSpeedKmh, PHYSICS_STATE.engineRPM, PHYSICS_STATE.engineLoad);
    cameraSystem?.update(delta);
    if (bus?.group && map) {
        const t0 = performance.now();
        map.updateChunks(bus.group.position.x, bus.group.position.z, delta, null, camera);
        perfSection.chunk += performance.now() - t0;
    }
    if (npc) npc.update(delta, 0);
    if (trafficManager) {
        const t0 = performance.now();
        trafficManager.update(delta, { x: bus.group.position.x, z: bus.group.position.z });
        perfSection.traffic += performance.now() - t0;
    }
    if (passengerSystem) passengerSystem.update(delta);
    if (bus?.group && camera && lighting) updateEnderman(scene, camera, lighting, { x: bus.group.position.x, z: bus.group.position.z }, bus.group.rotation.y, delta);
}

function updateHUD(delta) {
    hudTimer += delta;
    if (hudTimer < 0.1) return;
    hudTimer = 0;
    if (gameState !== "playing" || !bus || !ui) return;
    const zones = passengerSystem?.getActiveZones?.() || [];    if (!window._npcZonesCache) window._npcZonesCache = [];
    const npcZones = window._npcZonesCache;
    npcZones.length = 0;
    if (trafficManager?.aiVehicles) {
        for (let i = 0; i < trafficManager.aiVehicles.length; i++) {
            const c = trafficManager.aiVehicles[i].collider;
            if (c) npcZones.push(c);
        }
    }
    // Giới hạn tốc độ + CSGT (lấy seg.speed thật của đoạn đường đang chạy)
    csgtManager?.update(0.1, {
        x: bus.group.position.x,
        z: bus.group.position.z,
        speedKmh: vehiclePhysics.currentSpeedKmh
    });
    // ===== HỆ THỐNG NHIÊN LIỆU (B) =====
    // 1) Flush mức xăng xuống localStorage định kỳ (tránh ghi mỗi tick 30Hz).
    fuelFlushTimer += delta;
    if (fuelFlushTimer >= 5) { fuelFlushTimer = 0; flushFuel(); }
    const fuelNow = getFuel();
    // 2) Cảnh báo sắp hết (chỉ 1 lần / ngưỡng; reset khi >20% bình).
    if (fuelNow > 0 && fuelNow <= FUEL_CAPACITY * 0.2 && !lowFuelWarned) {
        lowFuelWarned = true;
        ui.toast(`[icon:warn] Nhiên liệu sắp hết (${Math.floor(fuelNow)}L) — còn vài chục km nữa là hết`, true);
    } else if (fuelNow > FUEL_CAPACITY * 0.2) {
        lowFuelWarned = false;
    }
    // 3) Hết xăng + xe đứng yên > 30s liên tục -> cứu hộ về trạm gần nhất.
    if (fuelNow <= 0) {
        if (Math.abs(vehiclePhysics.speed) < 0.5) {
            strandedT += delta;
            if (strandedT >= 30) {
                strandedT = 0;
                const g = map?.getRoadGraph?.();
                const pois = g?.pois;
                let target = null;
                let bestD2 = Infinity;
                if (pois) {
                    for (let i = 0; i < pois.length; i++) {
                        const p = pois[i];
                        if (p.type !== 'FUEL_STATION') continue;
                        const dx = p.position.x - bus.group.position.x;
                        const dz = p.position.z - bus.group.position.z;
                        const d2 = dx * dx + dz * dz;
                        if (d2 < bestD2) { bestD2 = d2; target = p; }
                    }
                }
                if (target) {
                    const fee = Math.min(RESCUE_FEE, getMoney());  // không trả dư: nợ trần 1 bình
                    if (fee > 0) addMoney(-fee);
                    bus.group.position.set(target.position.x, target.position.y ?? bus.group.position.y, target.position.z);
                    bus.group.rotation.y = Math.atan2(target.position.z - bus.group.position.z, target.position.x - bus.group.position.x);
                    vehiclePhysics.speed = 0;
                    playerStuckT = 0;
                    if (window.collisionSystem) window.collisionSystem.update(playerColId, bus.group.position.x, bus.group.position.z, bus.group.position.y);
                    flushFuel();
                    ui.toast(`[icon:tow] Hết xăng! Cứu hộ về trạm gần nhất (${target.name}) — phí ${formatMoney(fee)}`);
                }
            }
        } else {
            strandedT = 0;
        }
    } else {
        strandedT = 0;
    }
    // 4) Đổ xăng tự động khi trong bán kính 35 m của trạm xăng (FUEL_STATION).
    if (fuelNow < FUEL_CAPACITY - 0.5) {
        const g = map?.getRoadGraph?.();
        const pois = g?.pois;
        if (pois) {
            const bx = bus.group.position.x, bz = bus.group.position.z;
            for (let i = 0; i < pois.length; i++) {
                const p = pois[i];
                if (p.type !== 'FUEL_STATION') continue;
                const dx = p.position.x - bx, dz = p.position.z - bz;
                if (dx * dx + dz * dz > 35 * 35) continue;
                const need = FUEL_CAPACITY - fuelNow;
                const cost = Math.round(need * FUEL_PRICE);
                const paid = Math.min(cost, getMoney());   // hết tiền -> đổ tới khi hết tiền (không softlock)
                const litres = Math.max(0, paid / FUEL_PRICE);
                if (litres > 0) { addMoney(-paid); addFuel(litres); }
                flushFuel();
                lowFuelWarned = false;
                ui.toast(`[icon:fuel] Đã đổ ${Math.floor(litres)}L tại ${p.name} — ${formatMoney(paid)}`);
                break;
            }
        }
    }

    const passengerCount = passengerSystem?.getPassengerCount?.();
    ui.update({
        fps: 1/delta,
        speedKmh: vehiclePhysics.currentSpeedKmh,
        speedLimit: csgtManager?.getLimitKmh() ?? null,
        passengers: passengerCount?.onboard || 0,
        passengerCapacity: passengerCount?.max || 24,
        money: getMoney(),
        fuel: getFuel(),
        timeMinutes: lighting?.getGameTime() || 0,
        x: bus.group.position.x,
        z: bus.group.position.z,
        heading: bus.group.rotation.y,
        passengerZones: zones,
        npcZones: npcZones,
        // số liệu hành trình do TravelClock đo, không phải đồng hồ đếm sẵn
        trip: travelClock ? travelClock.getStats() : null
    });
}

const FIXED_STEP = 1/30;
// D-07 — chống "thời gian mô phỏng trôi" (time dilation).
// Trước đây: rawDelta bị kẹp 0.1s, chạy tối đa 2 bước, rồi `accumulator = 0`
// → phần thời gian dư bị XOÁ, mô phỏng chạy chậm hơn thực tế (đo được 8 bước
// trong 7 s khi tab bị throttle). Nay: giữ accumulator có biên, chạy tối đa
// MAX_SUBSTEPS bước/frame, không xoá sạch phần dư.
const MAX_FRAME_DELTA = 0.25;   // tab ẩn/breakpoint: không nhảy quá 250ms
// Máy chậm (Pentium N5000 + iGPU): frame có thể tới 500-2000ms.
// MAX_SUBSTEPS=4 cũ chỉ chạy 0.133s sim mỗi frame → sim chạy 1/4 đến 1/15 real-time
// → xe gần như đứng yên. Tăng lên 15: ở 2 FPS xe vẫn chạy real-time; máy nhanh vẫn
// chỉ dùng 1 substep/frame (accumulator không bao giờ đầy).
const MAX_SUBSTEPS = 15;        // 15 × 33.3ms = 0.5s mô phỏng/frame (đủ cho 2 FPS)
const MAX_FRAME_TIME = 50; // ms - if frame takes longer, log warning
let accumulator = 0;
let frameTimeHistory = new Array(60);
let frameTimeIndex = 0;
let frameTimeCount = 0;
const MAX_HISTORY = 60;
// Thống kê spike theo cửa sổ 10s (xem loop() — KHÔNG warn từng frame nữa)
let perfWindowStart = performance.now();
let perfWindowSum = 0, perfWindowCount = 0;
let perfSpikeCount = 0, perfPeakMs = 0, perfMaxMs = 0;
// Instrumentation chi tiết từng section (ms accumulated trong cửa sổ 10s)
const perfSection = { physics: 0, traffic: 0, chunk: 0, shadow: 0, render: 0, other: 0 };

function loop() {
    try {
        if (webglLost) return;
        const frameStart = performance.now();
        if (webglLost) return;
        const now = performance.now();
        let rawDelta = (now - lastTime) / 1000;
        lastTime = now;
        if (rawDelta > MAX_FRAME_DELTA) rawDelta = MAX_FRAME_DELTA;
        if (gameState === "playing" && !paused && !isConsoleOpen) {
            accumulator += rawDelta;
            // Giữ backlog có biên (không xoá sạch → không mất thời gian mô phỏng)
            const maxAccum = FIXED_STEP * MAX_SUBSTEPS;
            if (accumulator > maxAccum) accumulator = maxAccum;
            let steps = 0;
            while (accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
                const t0 = performance.now();
                updateWorld(FIXED_STEP);
                perfSection.physics += performance.now() - t0;
                accumulator -= FIXED_STEP;
                steps++;
            }
            if (accumulator < 0) accumulator = 0;
        }
        if (trafficDebug && trafficDebug.enabled) trafficDebug.update(rawDelta);
        
        // Render shadows BEFORE main scene render
        if (lighting && gameState === "playing") {
            const t0 = performance.now();
            lighting.renderShadows(bus?.group || null);
            perfSection.shadow += performance.now() - t0;
        }
        
        if (renderer && scene && camera) {
            const t0 = performance.now();
            renderer.render(scene, camera);
            if (gameState === "playing" && lighting?.atmosphereSystem) {
                lighting.atmosphereSystem.renderGodRays(renderer, scene, camera);
            }
            perfSection.render += performance.now() - t0;
        }
        if (gameState === "playing") updateHUD(rawDelta);
        
        // Frame time monitoring
        const frameTime = performance.now() - frameStart;
        frameTimeHistory[frameTimeIndex] = frameTime;
        frameTimeIndex = (frameTimeIndex + 1) % MAX_HISTORY;
        if (frameTimeCount < MAX_HISTORY) frameTimeCount++;

        // [PERF] frame spike — GOM THỐNG KÊ thay vì warn từng frame.
        // Trước đây: mỗi frame >50ms in 1 dòng warn -> máy N5000 (mọi frame đều
        // >50ms) spam console liên tục, mỗi dòng còn kèm stack trace. Cách mới:
        // đếm spike trong cửa sổ 10s, chỉ in 1 dòng tổng hợp mỗi cửa sổ (giữ đủ
        // thông tin chẩn đoán: đỉnh, trung bình, % spike). Cảnh báo vẫn ilgilen
        // hoạt động — không tắt hệ thống đo, chỉ bỏ lặp vô nghĩa.
        perfWindowSum += frameTime;
        perfWindowCount++;
        if (frameTime > MAX_FRAME_TIME) {
            perfSpikeCount++;
            if (frameTime > perfPeakMs) perfPeakMs = frameTime;
        }
        perfMaxMs = Math.max(perfMaxMs, frameTime);
        const nowLoop = performance.now();
        if (nowLoop - perfWindowStart >= 10000) {
            if (perfSpikeCount > 0) {
                const avg = perfWindowSum / Math.max(1, perfWindowCount);
                const n = Math.max(1, perfWindowCount);
                const s = perfSection;
                console.warn(`[PERF] Spikes ${perfSpikeCount}/${perfWindowCount} frame trong 10s — đỉnh ${perfMaxMs.toFixed(1)}ms, TB ${avg.toFixed(1)}ms`
                    + ` | updateWorld ${(s.physics / n).toFixed(1)}ms (chunk ${(s.chunk / n).toFixed(1)}, traffic ${(s.traffic / n).toFixed(1)})`
                    + ` · shadow ${(s.shadow / n).toFixed(1)}ms · render ${(s.render / n).toFixed(1)}ms`);
            }
            perfWindowStart = nowLoop;
            perfWindowSum = 0; perfWindowCount = 0; perfSpikeCount = 0; perfPeakMs = 0; perfMaxMs = 0;
            perfSection.physics = 0; perfSection.traffic = 0; perfSection.chunk = 0;
            perfSection.shadow = 0; perfSection.render = 0; perfSection.other = 0;
        }
    } catch (e) {
        console.error("Loop Error:", e);
    }
    window.requestAnimationFrame(loop);
}

boot();
