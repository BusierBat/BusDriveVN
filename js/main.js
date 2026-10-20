// js/main.js
import * as THREE from "three";
import { MapLoader } from "./map.js";
import { createUI } from "./ui.js";
import { createNPC } from "./npc.js";
import { createBus, loadNpcSkinList, BUS_DIMENSIONS } from "./bus.js";
import { createBusInterior } from "./interior.js";
import { CameraSystem } from "./camera.js";
import { LightingSystem, LIGHTING_QUALITY_PRESETS } from "./lighting.js";
import { TravelClock } from "./TravelClock.js";
import { createPassengerSystem } from "./passenger.js";
import { createTrafficManager } from "./traffic/TrafficManager.js";
import { TrafficDebug } from "./traffic/TrafficDebug.js";
import { initEndermanEasterEgg, updateEnderman } from "./enderman.js";
import { CollisionSystem } from "./collisionSystem.js";

let renderer, scene, camera, canvas, map, lighting, npc, bus, interior, passengerSystem, trafficManager, trafficDebug, ui, cameraSystem;
let travelClock = null;   // ước lượng giờ game từ lái xe thật (js/TravelClock.js)
const clock = new THREE.Clock();
let gameState = "menu", paused = false;
let doorProgress = 0, doorTarget = 0;
let playerColId = -1;
let playerStuckT = 0;   // đếm thời gian bị chặn hoàn toàn liên tục (Bug "dính cứng")
let lastRescuePress = 0;
let lastTime = performance.now();
let webglLost = false;
let isConsoleOpen = false;
let speedCameraFlashTimer = 0;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
let gameSettings = { graphics: 'low', renderDist: 2, npcDensity: 15, camSens: 30, fov: 70, lightingQuality: 'MEDIUM', godRays: 'high' };
// npcDensity = "so xe NPC toi da" (maxVehicles). Zone cap = npcDensity x 0.6..1.5
// theo mat do duong (TrafficManager._zoneCapFor): QL1A/cao toc (density 0.8-1.0)
// -> cap ~ x1.34. npcDensity=5 cu -> chi ~7 xe chay (do duoc = 6-7 xe).
// YEU CAU x3 so xe dang hoat dong (6-7 -> ~18-21) => npcDensity 5 -> 15
// (cap ~ 20 o duong lon). Graphics preset MEDIUM/HIGH van cho phep (25/40).

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

// Chi ep renderDist cho may yeu/di dong. KHONG ep npcDensity nua.
// BUG 3 - "xe NPC qua thua": truoc do co `gameSettings.npcDensity = 3;` o day.
// Vi thu tu la: (1) load localStorage -> (2) ep isLowEnd = 3, nen lan nao cung bi
// ve 3, bo qua ca default (5) lan ca slider nguoi dung da chon. Do duoc runtime:
//   maxVehicles = 3 -> moving = 3 xe chay tren ca mang duong (spawnDistance 340m),
//   trong khi static = 60, stationSpawnQueue = 286 xe cho xong ma khong duoc ra.
// isLowEnd = hardwareConcurrency<=4 || deviceMemory<=4 -> Pentium N5000 4GB luon bi ep.
// Yeu cau sua ro rang: "Khong giam so xe NPC dang hoat dong de dat muc tieu toi uu FPS"
// va "Khong giam hieu nang nen" -> giu nguyen renderDist (cham do chunk), bo npcDensity.
if (isMobile || isLowEnd) {
    gameSettings.renderDist = 1;
    // Máy yếu/di động: chất lượng ánh sáng mặc định MEDIUM = 3 cascade shadow
    // 1024² + contact shadows + god rays + sky 64 — đo trên iGPU yếu (UHD 605)
    // đây là khoản GPU TO NHẤT mỗi frame; GPU nghẽn làm compositor trình duyệt
    // đứng theo ("lag cả trình duyệt"). Ép LOW: shadow 512² × 2 cascade +
    // update cách frame, tắt contact/god rays, sky 32. Vẫn chỉnh lại được
    // trong Settings như renderDist (đổi là áp dụng ngay).
    gameSettings.lightingQuality = 'LOW';
}

let mobileInput = { steer: 0, accel: 0, brake: 0 };

const SPEED_CONVERSION = 0.4;

// ===== BUG "HITBOX VA CHAM ẢO" - PHAN NHAP (NARROW PHASE) OBB =====
// Truoc do main.js kiem tra bang HINH TRON r=4.0, NPC dang ky r=3.0 ->
// 4.0 + 3.0 = 7.0m tam-den-tam moi bao va cham, trong khi be rong THAT cua
// xe chi 2.5268m:
//   * Xe o lan ke (tam cach 3.5m, ke hong that 0.97m, KHONG cham) van bi
//     bao va cham -> phys.speed = 0 khi vuot xe / chay song song.
//   * Nguoc lai hinh tron lai QUA NGAN theo chieu dai: cham dau-duoi can
//     tam cach 12.8m, nhung vung do chi 7.0m -> xe cung cham hon 5.8m vao
//     duoi xe kia moi phat hien.
// -> Giu hinh tron lam BROAD PHASE (grid), them SAT 2 OBB 12.8 x 2.5268
// dung HUONG XE THAT lam narrow phase. Chi bao va cham khi 2 hop THAT SU
// cham/chan nhau (cong 0.12m de khong cho xuyen nhau o toc do cao).
const OBB_HALF_LEN = BUS_DIMENSIONS.length * 0.5;   // 6.4024m
const OBB_HALF_W   = BUS_DIMENSIONS.width * 0.5;     // 1.2634m
const OBB_MARGIN   = 0.12;   // cung mức “cham som 12cm” mà filter NPC đang dùng
// Tam XA nhat ma 2 OBB van co the cham = 2 * ban kinh duong chep (6.5259*2 =
// 13.06m). NPC dang ky r=3.0 -> ban kinh query can 13.06 - 3.0 = 10.06m
// (truoc day 4.0 -> cham dau-duoi khong bao gio bat duoc som).
const PLAYER_HITBOX_QUERY_R = 10.1;

// SAT 2D TỔNG QUÁT cho 2 hình chữ nhật xo bất kỳ (mtv = Minimum Translation
// Vector). Trả null khi KHÔNG chồng (kể cả margin). Khi chồng trả
// { depth, nx, nz } — depth = độ xâm nhập nhỏ nhất (m); (nx, nz) = hướng ĐẨY
// A KHỎI B dọc trục xâm nhập nhỏ nhất (vector đơn vị 2D).
// DÙNG CHUNG cho: bus player (OBB 12.8×2.53), xe NPC (cùng OBB), vật thể môi
// trường tĩnh (nhà = hộp xoay, cây = hình tròn hl=hw=r). main.js dùng MTV để
// cho xe TRƯỢT dọc bề mặt chạm thay vì khóa tọa độ — 2 xe va chạm không còn
// "dính cứng" (mọi ngay va chạm cũng có hướng thoát).
// Mảng tĩnh cho 4 trục SAT (chống alloc mỗi frame)
const _SAT_AXES = new Float64Array(8);
function rectContact(ax, az, aRot, ahl, ahw, bx, bz, bRot, bhl, bhw) {
    const aFx = Math.sin(aRot), aFz = Math.cos(aRot);   // hướng tới của A
    const bFx = Math.sin(bRot), bFz = Math.cos(bRot);
    const dx = bx - ax, dz = bz - az;
    // 4 trục cạnh: (hướng tới, pháp tuyến) của A rồi của B (mảng tĩnh).
    // Cho mỗi trục, required = bán kính hình chiếu của A + của B + margin.
    // |chiếu d| > required -> trục phân ly -> KHÔNG chạm.
    let bestPen = Infinity, bestNx = 0, bestNz = 0, bestSign = 1;
    const axes = _SAT_AXES;
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
            + OBB_MARGIN;
        if (absProj > required) return null;
        const pen = required - absProj;
        if (pen < bestPen) {
            bestPen = pen;
            bestNx = nx; bestNz = nz;
            bestSign = proj >= 0 ? -1 : 1;
        }
    }
    return { depth: bestPen, nx: bestSign > 0 ? bestNx : -bestNx, nz: bestSign > 0 ? bestNz : -bestNz };
}

// Bọc cũ cho xe↔xe (2 bus OBB), giữ tên cho các nơi gọi cũ
function obbContact(ax, az, aRot, bx, bz, bRot) {
    return rectContact(ax, az, aRot, OBB_HALF_LEN, OBB_HALF_W, bx, bz, bRot, OBB_HALF_LEN, OBB_HALF_W);
}

// MTV giữa xe người chơi và 1 collider bất kỳ của collisionSystem:
//  - NPC (có hướng thật, thân xe OBB): nhét vào SAT với kích thước xe.
//  - Mọi thứ còn lại (tĩnh/môi trường): coi là HỘP xoay với kích thước
//    { hl, hw, rot } lưu trong c.data (hộp nhà), hoặc hình tròn hl=hw=c.r
//    (cây/cột — SAT với hình tròn = kiểm chỉ theo 2 trục của player, vẫn hình
//    đúng vì hl=hw => bán kính hình chiếu hằng số theo mọi trục).
// Bắc Y đã lọc trong check(); hàm này chỉ làm 2D narrow-phase.
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
    maxSpeedKmh: 200,
    maxSpeed: 200 * SPEED_CONVERSION,
    maxReverseSpeed: -40 * SPEED_CONVERSION,
    acceleration: 20.0 * SPEED_CONVERSION,
    braking: 40.0 * SPEED_CONVERSION,
    drag: 4.0 * SPEED_CONVERSION,
    currentSpeedKmh: 0,
    isReversing: false,
    forwardVector: new THREE.Vector3()
};

let steerAngle = 0, steerTarget = 0;

// ===== INPUT: sống được với UniKey / IME tiếng Việt =====
// VẤN ĐỀ CŨ: game đọc KeyboardEvent.code thẳng. Nhưng khi bộ gõ tiếng Việt
// (UniKey / IME Windows) ở chế độ VI, nó can thiệp vào stream phím:
//   - có khi nuốt luôn event (code === "" ),
//   - có khi bơm ký tự đã gõ thay cho phím vật lý: W -> "ư", D -> "đ", A -> "á"...
// Ket qua: keysPressed.add("") -> WASD khong con ten -> phai chuyen EN moi lai duoc.
// CACH FIX: resolve event ve ma phim VẬT LÝ theo 3 lớp, lớp nào chắc nhất dùng lớp đó:
//   1) e.code      -> chuẩn nhất (KeyW/KeyA/KeyS/KeyD), ko phụ thuộc gõ gì.
//   2) e.key       -> ký tự/tên phím, map ngược lại mã vật lý (kể cả chữ tiếng Việt).
//   3) e.which/kc  -> UniKey hay bơm sự kiện theo VK (W=87, A=65...).
// Không resolve được -> bỏ qua, KHÔNG bịa phím ảo.
// Quy tắc an toàn: keyup dùng CÙNG bộ resolve (nếu không thì phím kẹt vĩnh viễn),
// và không bao giờ đụng tới khi đang gõ trong ô input (text/UI vẫn gõ bình thường).

const KEY_BY_NAME = new Map();
const LEGACY_BY_KEYCODE = new Map();
const keysPressed = new Map();   // code -> timestamp keydown gần nhất (chống phím kẹt)

// == DIAG UniKey: lệnh console "keys" bật/tắt GHI nhận phím (tối đa 200 event
// gần nhất). MẶC ĐỊNH TẮT — chỉ lưu khi bật, KHÔNG tốn công nào trong game.
// Dùng để xác định UniKey VI thực sự nhả event gì (code/key/kc/comp) thay vì
// đoán — khi user paste lại "keys" dump sẽ fix chính xác đường resolve.
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
const STEER_KEY_HOLD_TIMEOUT_MS = 800; // Thời gian timeout ngắn hơn cho phím lái (A/D) để tránh "ghost steering" do IME nuốt keyup
// Chống phím kẹt khi IME nuốt keyup. 5000ms an toàn cho cả Windows repeat chậm nhất
// (delay <= 1s + interval <= 0.5s) nên phím đang giữ thật không bị nhả nhầm.
//
// PHÍM LÁI A/D dùng timeout RIÊNG (STEER_KEY_HOLD_TIMEOUT_MS = 800ms) ngắn hơn để tránh "ghost steering"
// do IME nuốt keyup. Chỉ keydown CỦA CHÚNG mới làm mới timestamp (ga/thắng KHÔNG được refresh giùm).
// Nhờ vậy phím lái "ma" luôn tự hết hạn trong 0.8s kể từ lần bấm cuối, tránh xe tự quẹo khi ga.

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
        const timeout = (code === "KeyA" || code === "KeyD") ? STEER_KEY_HOLD_TIMEOUT_MS : KEY_HOLD_TIMEOUT_MS;
        if (now - last > timeout) keysPressed.delete(code);
    }
}

function clearPressedKeys() { keysPressed.clear(); }

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

// js/main.js - Chỉ phần updateVehiclePhysics được thay đổi

function updateVehiclePhysics(dt) {
    if (!bus?.group) return;
    pruneStaleKeys(performance.now());
    const phys = vehiclePhysics;
    const isAccel = keysPressed.has("KeyW") || mobileInput.accel > 0;
    const isBrake = keysPressed.has("KeyS") || mobileInput.brake > 0;
    const isShift = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight");
    const isAlt = keysPressed.has("AltLeft") || keysPressed.has("AltRight");
    
    if (keysPressed.has("Space")) {
        // Space: thắng gấp — dừng ngay lập tức
        phys.speed = 0;
        phys.isReversing = false;
    } else if (isShift && isAccel) {
        // Shift+W: LUÔN tăng tốc từ từ đến giới hạn 200 km/h, không bao giờ tụt
        phys.speed += phys.acceleration * 0.5 * dt;
        phys.speed = Math.min(phys.speed, phys.maxSpeed);
        phys.isReversing = false;
    } else if (isBrake) {
        // S: giảm tốc từ từ, khi về 0 thì lùi
        if (phys.speed > 0) {
            phys.speed = Math.max(phys.speed - phys.braking * dt, 0);
        } else {
            phys.isReversing = true;
            phys.speed = Math.max(phys.speed - phys.acceleration * dt, phys.maxReverseSpeed);
        }
    } else if (isAlt) {
        // Alt: thắng (không gấp) — giảm từ từ, dừng tại 0, KHÔNG lùi
        phys.speed = phys.speed > 0
            ? Math.max(phys.speed - phys.braking * dt, 0)
            : Math.min(phys.speed + phys.braking * dt, 0);
        if (phys.speed === 0) phys.isReversing = false;
    } else if (isAccel) {
        // W: giữ nguyên tốc độ — không tăng không giảm
        if (phys.speed < 0) {
            // Đang lùi mà bấm W → thắng dần về 0 rồi giữ
            phys.speed = Math.min(phys.speed + phys.braking * dt, 0);
        }
    } else {
        // Thả W / Shift+W: giảm tốc từ từ (drag), dừng hẳn khi về 0
        phys.speed = phys.speed > 0
            ? Math.max(phys.speed - phys.drag * dt, 0)
            : Math.min(phys.speed + phys.drag * dt, 0);
        if (phys.speed === 0) phys.isReversing = false;
    }
    
    phys.currentSpeedKmh = phys.speed / SPEED_CONVERSION;
    const speedKmh = Math.abs(phys.currentSpeedKmh);
    // Smoother steering limit: more gradual reduction at high speeds
    const speedSteerLimit = 1 - Math.min(0.85, Math.pow(speedKmh / 180, 1.5));
    
    // Check for actual key press (not ghost keys from IME)
    const isSteeringLeft = keysPressed.has("KeyA");
    const isSteeringRight = keysPressed.has("KeyD");
    
    if (isSteeringLeft && !isSteeringRight) steerTarget = 0.5 * speedSteerLimit;
    else if (isSteeringRight && !isSteeringLeft) steerTarget = -0.5 * speedSteerLimit;
    else if (mobileInput.steer !== 0) steerTarget = 0.5 * speedSteerLimit * mobileInput.steer;
    else steerTarget = 0;
    
    // Smoother steering interpolation with speed-dependent response
    const steerResponseRate = steerTarget === 0 ? (3.5 + speedKmh * 0.02) : (2.5 + speedKmh * 0.01);
    if (steerTarget === 0) steerAngle += (0 - steerAngle) * Math.min(1, dt * steerResponseRate);
    else steerAngle += (steerTarget - steerAngle) * Math.min(1, dt * (steerResponseRate * 0.7));
    
    // Prevent ghost steering when no input - additional safety check
    if (!keysPressed.has("KeyA") && !keysPressed.has("KeyD") && mobileInput.steer === 0) {
        steerTarget = 0;
    }
    
    if (Math.abs(phys.speed) > 0.1) bus.group.rotation.y += steerAngle * dt * 1.5 * Math.sign(phys.speed);
    
    if (Math.abs(phys.speed) > 0.001) {
        const forward = phys.forwardVector.set(0, 0, 1).applyQuaternion(bus.group.quaternion);
        const moveDistance = phys.speed * dt;
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
                    // Realistic collision response: stop instead of bouncing back
                    if (Math.abs(phys.speed) > 5 * SPEED_CONVERSION) {
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

        if (Math.abs(moveDx) > 1e-6 || Math.abs(moveDz) > 1e-6) {
            bus.group.position.x += moveDx;
            bus.group.position.z += moveDz;
            playerStuckT = 0;
        } else if (contactMtv) {
            // bị chặn hoàn toàn (chạm trực diện) -> đếm thời kẹt
            playerStuckT += dt;
            if (playerStuckT > 2.0 && (isAccel || isBrake)) {
                // đẩy nhẹ tách 2 khối; vẫn bounded bởi depth → hết chồng là dừng
                const push = Math.min(0.35 * dt, contactMtv.depth);
                bus.group.position.x += contactMtv.nx * push;
                bus.group.position.z += contactMtv.nz * push;
            }
        }
    } else {
        playerStuckT = 0;
    }
    
    // ĐỊA HÌNH PHẲNG TUYỆT ĐỐI - KHÔNG RAYCAST
    // /P42: truyền `yHint` = cao độ xe ĐANG ở. Không có nó thì thuật toán
    // mặt trên cùng phải chọn theo "cao nhất" ⇒ đi ngang dưới cầu vượt là
    // nhảy lên cầu. Có `yHint` thì nó bám đúng mặt xe đang đứng trên đó, và
    // đi lên ramp/cầu vượt vẫn leo được vì cao độ thay đổi liên tục.
    const yHint = bus.group.position.y;
    const targetY = map
        ? map.getTerrainHeight(bus.group.position.x, bus.group.position.z, yHint) + 0.5
        : 10.5;

    // Bám mặt đường MƯỢT mà vẫn không rơi khỏi mặt: giới hạn tốc độ đổi
    // cao độ mỗi frame. Chặn trên là bám (mượt), nhưng vẫn cho xe đuổi kịp
    // khi cầu dốc — nếu cứ khóa cứng thì xe bám trụ trên mặt cầu.
    const maxStep = 0.9 + Math.abs(speedKmh) * 0.06;
    let ny = targetY;
    if (targetY > yHint + maxStep) ny = yHint + maxStep;
    else if (targetY < yHint - maxStep) ny = yHint - maxStep;
    bus.group.position.y = ny;
    
    // Visual Pitch/Roll
    const pitchAngle = (isBrake || isAlt) ? -0.04 : (isAccel ? 0.02 : 0);
    const targetRoll = -steerAngle * 0.03 * (speedKmh / 60);
    bus.group.rotation.x = THREE.MathUtils.lerp(bus.group.rotation.x, pitchAngle, dt * 4);
    bus.group.rotation.z = THREE.MathUtils.lerp(bus.group.rotation.z, targetRoll, dt * 3);
    
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
    if (!g || !g.segmentsNear) { ui?.toast("✕ Cứu hộ: road graph chưa sẵn sàng!", true); return; }
    const px = bus.group.position.x, pz = bus.group.position.z;

    // Quét đoạn trong 400m; loại cầu/hầm/ngõ (nền cao độ khác / hẹp chuyên dụng)
    const segs = g.segmentsNear(px, pz, 400, (s) => !s.bridge && s.class !== "TUNNEL" && s.class !== "ALLEY");
    if (!segs.length) { ui?.toast("✕ Cứu hộ: không tìm thấy đường hợp lệ trong 400m", true); return; }

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
    if (!chosen) { ui?.toast("✕ Cứu hộ: mọi chỗ gần nhất đều có vật cản, thử lùi lại", true); return; }

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
    ui?.toast("🔧 Cứu hộ: đã đưa xe về đường hợp lệ gần nhất");
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
        if (code === "Escape") { togglePause(); return; }
        // F3: bat/tat panel debug giao thong (khong anh huong gameplay)
        if (code === "F3") { e.preventDefault(); if (trafficDebug) trafficDebug.toggle(); return; }
        if (gameState !== "playing" || paused) return;
        if (!code) return;   // khong resolve duoc -> bo qua, khong bia phim ao

        const _now = performance.now();

        const _physCode = (typeof e.code === "string" && e.code.length > 0 && e.code !== "Unidentified") ? e.code : null;

        // BUG UniKey VI — SỬA LẠI GUARD "BUG 7/BUG 8" cho đúng:
        // ----------------------------------------------------------------
        // TRIỆU CHỨNG MỚI: bật UniKey chế độ tiếng Việt -> A/D KHÔNG đánh lái
        // (kể cả bấm một lần); chuyển EN thì lái được lại.
        // NGUYÊN NHÂN: hai guard BUG-7/BUG-8 cũ chặn MỌI keydown A/D không có
        // chứng cứ vật lý (e.code / legacy VK). Nhưng UniKey VI bơm sự kiện theo
        // KÝ TỰ ("đ", "a", "à"...) với e.code rỗng — đúng dạng bị chặn — trong
        // khi resolveEventCode vẫn suy ra "KeyA"/"KeyD" từ bộ chữ VI_FAMILIES.
        // Kết quả: phím lái không bao giờ được set ở chế độ VI = mất lái hoàn toàn.
        // CÁCH SỬA (giữ anti-ghost của BUG 7/8, chỉ mở đúng chỗ cần mở):
        //   • LẦN BẤM MỚI (phím chưa đang giữ): CHẤP NHẬN kể cả bằng ký tự IME.
        //     Rủi ro "junk revival" còn lại bị chặn bởi auto-expire 800ms của
        //     STEER_KEY_HOLD_TIMEOUT_MS (pruneStaleKeys): chấp nhận sai chỉ tốn
        //     tối đa 0.8s quẹo nhầm — rẻ hơn nhiều so với mất lái hẳn chế độ VI.
        //   • REFRESH khi phím ĐANG GIỮ (keysPressed.has): 2 đường hợp lệ —
        //     (a) chứng cứ vật lý (e.code / legacy VK) như trước,
        //     (b) e.repeat=true: auto-repeat của phím đang giữ bị IME nuốt code
        //         vẫn phải làm mới timestamp, nếu không giữ A/D ở chế độ VI sẽ
        //         chết sau 0.8s dù tay vẫn giữ phím.
        //     Không thuộc cả hai -> từ chối (phím ma không được sống thêm).
        // keyup vẫn dùng bộ resolve chung + xóa A/D khi IME nuốt keyup (giữ nguyên).
        if (code === "KeyA" || code === "KeyD") {
            const hasEvidence = _physCode || legacyKeyCodeToCode(e);
            if (keysPressed.has(code) && !hasEvidence && !e.repeat) {
                return;
            }
            // lần bấm mới không chứng cứ (ký tự IME) đi tiếp tới keysPressed.set
        }

        keysPressed.set(code, _now);
        // Windows chỉ auto-repeat phím được nhấn SAU CÙNG. Giữ Shift+W rồi bấm A/D
        // để rẽ -> Shift+W ngừng repeat -> pruneStaleKeys xóa -> xe giảm tốc oan.
        // Fix: refresh timestamp TẤT CẢ phím đang giữ khi có keydown bất kỳ.
        //
        // TRỪ A/D (xem KEY_HOLD_TIMEOUT_MS): phím lái chỉ sống bằng keydown CỦA CHÚNG.
        // Nếu ga/thắng refresh giùm thì khi keyup của A bị IME/jank nuốt (event
        // không resolve được -> không xóa nổi), phím lái ma đó sẽ không bao giờ hết
        // hạn trong lúc giữ ga -> xe tự quẹo trái, mà A vẫn đứng đầu if/else nên
        // bấm D vô tác dụng. Vẫn refresh W/S/Shift/Alt/Space để không tái mở bug cũ
        // "giữ Shift+W rồi lái là xe giảm tốc".
        for (const k of keysPressed.keys()) {
            if (k === "KeyA" || k === "KeyD") continue;
            keysPressed.set(k, _now);
        }
        // LÁI: phím vừa bấm giành quyền, xóa phím đối xứng -> A và D không bao giờ
        // cùng sống trong map. Phím lái ma bị xóa NGAY khi người chơi bấm hướng còn
        // lại, nên lỗi "bấm lái phải không có tác dụng" không thể xảy ra — đây là
        // phân quyền input (last-press wins), không phải khóa hay ép steering = 0.
        if (code === "KeyA") keysPressed.delete("KeyD");
        else if (code === "KeyD") keysPressed.delete("KeyA");
        
        // Additional safety: if both A and D are somehow pressed, cancel both (neutral)
        if (keysPressed.has("KeyA") && keysPressed.has("KeyD")) {
            keysPressed.delete("KeyA");
            keysPressed.delete("KeyD");
        }
        // Shift/Alt không auto-repeat khi phím khác được nhấn -> sync từ state vật lý.
        if (!composing) {
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
        }
        if (!composing && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "AltLeft", "AltRight"].includes(code)) e.preventDefault();
        if (e.repeat) return;   // phim tac vu chi xu ly khi VUA bam, khong khi nhan giu

        // R: cứu hộ thủ công khi xe bị ghim giữa các vật cản (one-shot, cooldown 1.5s)
        if (code === "KeyR" && performance.now() - lastRescuePress > 1500 && bus && gameState === "playing") {
            lastRescuePress = performance.now();
            rescuePlayerToNearestRoad();
        }

        if (code === "KeyF" && performance.now() - lastFPressTime > 150 && bus) {
            lastFPressTime = performance.now();
            bus.areLightsOn = !bus.areLightsOn;
            bus.setHeadlights?.(bus.areLightsOn);
            bus.setTaillights?.(bus.areLightsOn);
            ui?.toast(`💡 Đèn ${bus.areLightsOn ? 'BẬT' : 'TẮT'}`);
        }
        if (code === "KeyK" && bus) {
            doorTarget = doorTarget === 0 ? 1 : 0;
            bus.doorOpen = doorTarget === 1;
            ui?.toast(`🚪 Cửa ${bus.doorOpen ? 'MỞ' : 'ĐÓNG'}`);
            if (bus.doorOpen && passengerSystem) passengerSystem.pickUpPassengers();
        }
        if (code === "KeyL" && bus && interior) {
            // L: Bật/tắt TẤT CẢ đèn cùng lúc (pha + đuôi + interior)
            const allLightsOn = !bus.areLightsOn;
            bus.areLightsOn = allLightsOn;
            bus.setHeadlights?.(allLightsOn);
            bus.setTaillights?.(allLightsOn);
            interior.setInteriorLed?.(allLightsOn);
            ui?.toast(`💡 Tất cả đèn ${allLightsOn ? 'BẬT' : 'TẮT'}`);
        }
        if (code === "KeyH" && performance.now() - lastHornPressTime > 300) {
            lastHornPressTime = performance.now();
            ui?.toast("📯 Bim bim!");
        }
        if (code === "KeyC" && performance.now() - lastCameraPressTime > 200 && cameraSystem) {
            lastCameraPressTime = performance.now();
            cameraSystem.cycleNext();
        }
    });

    // keyup dung CUNG bo resolve: keydown ra code "KeyW" ma keyup bi IME bien
    // thanh key "ư" (code rong) thi van phai xoa duoc, khong thi xe lai ve moi.
    window.addEventListener("keyup", (e) => {
        const code = resolveEventCode(e);
        keyDiagPush("U", e);
        if (code) { keysPressed.delete(code); return; }

        // BUG 7 FIX — xe tu quẹo trai du khong bam A:
        // keyup bi IME/UniKey nuot hoan toan (e.code = '' VA e.key = '') nen
        // resolveEventCode tra null -> khong xoa duoc "KeyA" da set tu keydown
        // truoc do. Phim lai ma do song lai toi da STEER_KEY_HOLD_TIMEOUT_MS
        // (800ms); o 80~100 km/h va steerAngle day du, 800ms = khoang 20 do lai
        // OAN — dung hop la "xe tu quẹo trai", va vi A dung dau if/else nen nguoi
        // choi phai bam D (keyup cua D xoa ngay KeyA) de keo lai.
        //
        // A va D tuyet doi doc nhan trong keysPressed (keydown cua phim nao xua
        // phim doi xung, va ca hai cung song -> huy ca hai, xem 433-440), nen keyup
        // rong mang dau hieu IME nay gan nhu chac chan la su nhac CHINH phim lai ->
        // xoa ngay thay vi cho 800ms. Neu la su nhac phim khac trong luc dang giu lai
        // thi chi mat phim lai tam thong (bam A lai la du) — thap hon nhieu so voi
        // vi tri lai oan 20 do o toc do cao.
        //
        // Dieu kien "imei swallow" du dieu kien: IME dang hoat dong, hoac su kien
        // khong co bat ky thong tin nao (code rong + key rong). Keyup binh thuong
        // (co e.code) van di vao nhanh o tren ma khong cham vao day.
        const imeSwallow = (e.isComposing === true || e.keyCode === 229 ||
            (!e.code && !e.key));
        // BUG 8 FIX — mo rong: moi keyup khong co e.code vat ly ma resolve khong
        // duoc (vd key="ä"/"Process"/ky tu la tu doan IME cuoi cung) van xoa ca
        // A/D NGAY, khong cho 800ms ghost nua. Keyup vat ly that (co e.code) luon
        // resolve o dong `if (code)` o tren -> khong bao gio roi vao day, nen khong
        // the xoa nham phim khi nguoi choi dang giu lai; keyup legacy Unikey (VK)
        // cung resolve o tren. Con lai (neu co) van don pruneStaleKeys (800ms).
        const _upPhys = (typeof e.code === "string" && e.code.length > 0 && e.code !== "Unidentified");
        
        // Chi xoa A/D neu thuc su la keyup cua phim lai (khong xoa lung tung khi nha phim khac).
        // Neu khong chac chan, de pruneStaleKeys (800ms) tu tu xoa -> tranh mat lai.
        const wasHoldingSteer = keysPressed.has("KeyA") || keysPressed.has("KeyD");
        if ((imeSwallow || !_upPhys) && wasHoldingSteer) {
            keysPressed.delete("KeyA");
            keysPressed.delete("KeyD");
        }
    });

    window.addEventListener("blur", clearPressedKeys);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearPressedKeys(); });
}

function handleCommand(cmd) {
    const parts = cmd.split(" ");
    if (parts[0] === "keys") {
        // DIAG phím: "keys" lần 1 = BẬT ghi, "keys" lần 2 = TẮT + in dump.
        keyDiagOn = !keyDiagOn;
        if (keyDiagOn) {
            keyDiagLog.length = 0;
            ui.toast("✓ Đang GHI phím — bật UniKey bấm thử W/A/S/D, rồi gõ lại lệnh: keys");
        } else {
            keyDiagDump();
        }
        return;
    }
    if (parts[0] === "time" && parts[1]) {
        const tp = parts[1].split("/");
        if (tp.length === 2) {
            const h = parseInt(tp[0]), m = parseInt(tp[1]);
            if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                lighting.setGameTime(h * 60 + m);
                ui.toast(`✓ Đã đặt thời gian thành ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
            } else { ui.toast("✕ Thời gian không hợp lệ!", true); }
        } else { ui.toast("✕ Cú pháp: time HH/MM", true); }
    } else if (parts[0] === "traffic") {
        // Lệnh debug giao thông: traffic | traffic check | traffic spawn <n> | traffic info
        const sub = (parts[1] || "").toLowerCase();
        if (!trafficManager) {
            ui.toast("✕ Chưa vào game / chưa có traffic manager!", true);
        } else if (sub === "check") {
            if (!trafficDebug) { ui.toast("✕ Thiếu TrafficDebug!", true); }
            else {
                const r = trafficDebug.runSelfCheck();
                if (!trafficDebug.enabled) trafficDebug.toggle(true);
                ui.toast(r.pass
                    ? `✓ SELF-CHECK PASS: ${r.checked} xe đều đi bên phải, đúng chiều`
                    : `✕ SELF-CHECK FAIL: sai lề ${r.wrongSide}, sai hướng ${r.wrongHeading}, lều mép ${r.offRoad}`, !r.pass);
            }
        } else if (sub === "spawn") {
            const n = parseInt(parts[2]);
            if (isNaN(n) || n < 0 || n > 60) { ui.toast("✕ Cú pháp: traffic spawn <0-60>", true); }
            else {
                trafficManager.maxVehicles = n;
                gameSettings.npcDensity = n;
                ui.toast(`✓ Mật độ NPC = ${n} (preset cho phép ${trafficManager.graphics.settings.maxActiveTraffic})`);
            }
        } else if (sub === "info") {
            const i = trafficManager.getDebugInfo();
            ui.toast(`NPC ${i.active}/${i.max} · đang chạy ${i.moving} · pool ${i.pooled} · spawn ${i.spawnDistance}m · despawn ${i.despawnDistance}m`);
        } else {
            const on = trafficDebug ? trafficDebug.toggle() : false;
            ui.toast(on ? "✓ Traffic debug: ON (nhấn F3 để tắt)" : "Traffic debug: OFF");
        }
    } else if (parts[0] === "surface") {
        // DEBUG: "Xe rơi ở đâu?" — road segment + collision box
        // + transform tại vị trí xe hiện tại
        if (!map || !bus?.group) {
            ui.toast("✕ Chưa vào game!", true);
        } else {
            const info = map.debugSurfaceAt(
                bus.group.position.x, bus.group.position.z, bus.group.position.y);
            if (!info) ui.toast("⚫ Ngoài mặt đường — đang ở terrain", true);
            else ui.toast(
                `🛣 ${info.roadType} · ${info.roadId} · seg ${info.segId}` +
                ` · box #${info.collisionId}` +
                ` · Y=${info.surfaceY.toFixed(2)}m` +
                ` · lệch tâm ${info.offsetFromCenter.toFixed(1)}m`);
        }
    } else { ui.toast("✕ Lệnh không xác định!", true); }
    isConsoleOpen = false;
    ui.hideConsole();
}

function togglePause() {
    // BUG CU: `if (gameState === "playing") paused = true;` luon chay khi dang
    // choi, nen `else if (paused)` KHONG BAO GIO duoc thuc thi -> nhan Escape
    // lan 1 pause, lan 2 van pause, lan 3 van pause... game bi khoa pause, chunk
    // khong load (loadedChunks = 0), xe khong di duoc.
    if (gameState !== "playing") return;
    paused = !paused;
    if (!paused) clock.getDelta();   // reset delta, khong cho physics nhy lon sau pause
}

let hudTimer = 0;
function handleResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(isLowEnd ? 0.8 : 1.0);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
}

function initRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power", stencil: false, depth: true });
    renderer.setClearColor(0x87ceeb, 1);
    renderer.setPixelRatio(isLowEnd ? 0.8 : 1.0);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    // BUG FIX: truoc do la THREE.LinearSRGBColorSpace ("srgb-linear").
    // Three.js tinh toan lighting trong khong gian linear (dung), nhung buoc encode
    // linear ->sRGB khi dua ra framebuffer bi BO QUA. Hau qua: buffer chua gia tri linear
    // ma man hinh doc nhu sRGB -> toan bo game toi hon rat nhieu o moi tone giua/dam.
    // CUNG CHUNG NGUYEN G voi loi "dem qua toi / vat the thanh khoi den" vi luc do
    // ambient la nguon sang duy nhat va no cung bi lam toi.
    // Bang chung do duoc (sky `#b1deef` = [177,222,239], pixel render duoc [112,187,219]):
    //   177/255 = 0.694 -> linear 0.4396 -> 112   (khop)
    //   222/255 = 0.871 -> linear 0.7310 -> 186   (khop)
    //   239/255 = 0.937 -> linear 0.8626 -> 220   (khop)
    // Texture van dung THREE.SRGBColorSpace luc load (xem bus.js) -> input da duoc
    // linear dung, nen output PHAI encode lai thi moi khop voi nhap lieu.
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

function setupMenuEvents() {
    document.getElementById("btn-new-game")?.addEventListener("click", startGameFromMenu);
    
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
    rngNpc?.addEventListener('input', () => { if(valNpc) valNpc.textContent = rngNpc.value; });
    rngCamSens?.addEventListener('input', () => { if(valCamSens) valCamSens.textContent = rngCamSens.value; });
    rngFov?.addEventListener('input', () => { if(valFov) valFov.textContent = rngFov.value; });
    rngRenderDist?.addEventListener('input', () => { if(valRenderDist) valRenderDist.textContent = rngRenderDist.value; });

    // Helper to open panel with backdrop
    function openPanel(panel) {
        if (backdrop) backdrop.style.display = 'block';
        if (panel) panel.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
    function closeAllPanels() {
        if (backdrop) backdrop.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (uvPanel) uvPanel.style.display = 'none';
        document.body.style.overflow = '';
    }

    // Settings panel
    btnSettings?.addEventListener("click", () => { 
        openPanel(settingsPanel);
        // Sync dropdown values with current settings
        const selGraphics = document.getElementById('setting-graphics');
        const selLighting = document.getElementById('setting-lighting');
        const selGodRays = document.getElementById('setting-godrays');
        if(selGraphics) selGraphics.value = gameSettings.graphics;
        if(selLighting) selLighting.value = gameSettings.lightingQuality.toLowerCase();
        if(selGodRays) selGodRays.value = gameSettings.godRays;
        if(rngFov) rngFov.value = gameSettings.fov;
        if(valFov) valFov.textContent = gameSettings.fov;
        if(rngRenderDist) rngRenderDist.value = gameSettings.renderDist;
        if(valRenderDist) valRenderDist.textContent = gameSettings.renderDist;
    });
    
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

    // Close handlers
    [btnCloseSettings, btnCloseUvSkin, backdrop].forEach(btn => {
        btn?.addEventListener('click', closeAllPanels);
    });
    
    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllPanels();
    });

    // Apply settings
    btnApplySettings?.addEventListener("click", () => {
        const selGraphics = document.getElementById('setting-graphics');
        if(selGraphics) gameSettings.graphics = selGraphics.value;
        
        const selLighting = document.getElementById('setting-lighting');
        if(selLighting) {
            gameSettings.lightingQuality = selLighting.value.toUpperCase();
            if(lighting) lighting.setQuality(gameSettings.lightingQuality);
        }
        
        const selGodRays = document.getElementById('setting-godrays');
        if(selGodRays) {
            gameSettings.godRays = selGodRays.value;
            if(lighting && lighting.atmosphereSystem) {
                const val = selGodRays.value;
                if (val === 'off') lighting.atmosphereSystem.toggleGodRays(false);
                else lighting.atmosphereSystem.toggleGodRays(true);
            }
        }
        
        if(rngNpc) gameSettings.npcDensity = parseInt(rngNpc.value);
        if(rngCamSens) gameSettings.camSens = parseInt(rngCamSens.value);
        if(rngFov) {
            gameSettings.fov = parseInt(rngFov.value);
            if(camera) { camera.fov = gameSettings.fov; camera.updateProjectionMatrix(); }
            if(cameraSystem) cameraSystem.settings.fov = gameSettings.fov;
        }
        if(rngRenderDist) {
            gameSettings.renderDist = parseInt(rngRenderDist.value);
            if(map) map.renderRadius = gameSettings.renderDist;
        }
        
        if(cameraSystem) cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        if(renderer) renderer.toneMapping = (gameSettings.graphics === 'low') ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        if(trafficManager) trafficManager.maxVehicles = gameSettings.npcDensity;
        
        // Save to localStorage
        try { localStorage.setItem('busdrivevn_settings', JSON.stringify(gameSettings)); } catch(e) {}
        
        ui?.toast("✅ Đã áp dụng & lưu cài đặt!");
        closeAllPanels();
    });

    // Reset settings to defaults
    btnResetSettings?.addEventListener("click", () => {
        gameSettings = { graphics: 'low', renderDist: 2, npcDensity: 15, camSens: 30, fov: 70, lightingQuality: 'MEDIUM', godRays: 'high' };
        // Update UI
        const selGraphics = document.getElementById('setting-graphics');
        const selLighting = document.getElementById('setting-lighting');
        const selGodRays = document.getElementById('setting-godrays');
        if(selGraphics) selGraphics.value = gameSettings.graphics;
        if(selLighting) selLighting.value = gameSettings.lightingQuality.toLowerCase();
        if(selGodRays) selGodRays.value = gameSettings.godRays;
        if(rngNpc) { rngNpc.value = gameSettings.npcDensity; if(valNpc) valNpc.textContent = gameSettings.npcDensity; }
        if(rngCamSens) { rngCamSens.value = gameSettings.camSens; if(valCamSens) valCamSens.textContent = gameSettings.camSens; }
        if(rngFov) { rngFov.value = gameSettings.fov; if(valFov) valFov.textContent = gameSettings.fov; }
        if(rngRenderDist) { rngRenderDist.value = gameSettings.renderDist; if(valRenderDist) valRenderDist.textContent = gameSettings.renderDist; }
        ui?.toast("↩ Đã khôi phục mặc định!");
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
            if(uvStatus) { uvStatus.style.color = '#f87171'; uvStatus.innerHTML = '❌ File phải là PNG'; }
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            if(uvStatus) { uvStatus.style.color = '#f87171'; uvStatus.innerHTML = '❌ File quá lớn (max 5MB)'; }
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            const arr = new Uint8Array(ev.target.result);
            const isPng = arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47;
            if (!isPng) {
                if(uvStatus) { uvStatus.style.color = '#f87171'; uvStatus.innerHTML = '❌ File không phải PNG hợp lệ'; }
                return;
            }
            const img = new Image();
            img.onload = () => {
                if (img.width !== 2048 || img.height !== 1024) {
                    if(uvStatus) { uvStatus.style.color = '#f87171'; uvStatus.innerHTML = `❌ Kích thước sai. Yêu cầu: 2048×1024. File: ${img.width}×${img.height}`; }
                    return;
                }
                if(uvStatus) { uvStatus.style.color = '#34d399'; uvStatus.innerHTML = '✅ UV Skin hợp lệ'; }
                if(uvPreview && uvPreviewImg) {
                    uvPreviewImg.src = URL.createObjectURL(file);
                    uvPreview.style.display = 'block';
                }
                if(uvDownload) {
                    uvDownload.href = URL.createObjectURL(file);
                    uvDownload.style.display = 'block';
                }
            };
            img.onerror = () => { if(uvStatus) { uvStatus.style.color = '#f87171'; uvStatus.innerHTML = '❌ Lỗi đọc file'; } };
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
    ui.hideMainMenu();
    ui.setLoading("Đang tải...", 0.1);
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
        interior = createBusInterior();
        if (!interior?.isObject3D) interior = new THREE.Group();
        bus.group.add(interior);
        // Cockpit tài xế (Windows Update/BSOD/speedo, nút phân màu) được gán
        // RUNTIME lên mesh dashboard có sẵn — bus.setInteriorReference là hook hiện có.
        bus.setInteriorReference?.(interior);
        scene.add(bus.group);
        const spawn = map.getSpawnPoint();
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
            get traffic() { return trafficManager; },
            get trafficDebug() { return trafficDebug; },
            // He thong chieu sang + thoi gian. Cho phep doi gio trong ngay de test
            // ban ngay/buoi toi (vd: __busvn.lighting.setGameTime(14 * 60)).
            get lighting() { return lighting; },
            // Dựng 1 khung hình thủ công (tab bị ẩn thì requestAnimationFrame
            // bị treo -> không test được). Dùng để đo FPS/draw call thật.
            tick: (times = 1) => { for (let i = 0; i < times; i++) loop(); },
            // DEBUG: cac phim dieu khien dang duoc nhan (dung de test IME/UniKey)
            pressedKeys: () => [...keysPressed.keys()],
            resolveKey: (ev) => resolveEventCode(ev),
            state: () => ({ gameState, paused, webglLost, renderRadius: map?.renderRadius })
        };
        if (window.collisionSystem) playerColId = window.collisionSystem.register(bus.group.position.x, bus.group.position.z, 4.0, 'player');
        cameraSystem = new CameraSystem(camera, bus.group);
        cameraSystem.setMode("driver");
        cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        cameraSystem.settings.fov = gameSettings.fov;
        await new Promise(r => setTimeout(r, 300));
        
        ui.setLoading("Giao thông & Hành khách...", 0.8);
        await loadNpcSkinList();
        const roadGraph = map.getRoadGraph();
        if (!roadGraph) throw new Error("Road graph chưa sẵn sàng — loadInitialData() lỗi?");
        // Phase 6: giờ game suy từ lái xe thật. Độ dốc lấy từ `node.y` của
        // đoạn đường đứng (đã gồm ROAD_LIFT); `getHeight` chỉ dùng khi xe
        // chạy ngoài đường — lúc đó mới quy về địa hình.
        travelClock = new TravelClock({
            roadGraph,
            getHeight: (x, z) => map.getHeight(x, z)
        });
        npc = createNPC({ scene, map, seed: 2027, playerBus: bus, playerSpawnPos: { x: spawn.x, z: spawn.z } });
        trafficManager = createTrafficManager({ scene, roadGraph: roadGraph, playerRef: bus, maxVehicles: gameSettings.npcDensity || 5 });
        // NPC "học sinh cá biệt GDCD" (spawn hiếm) mở mồm qua HUD toast.
        trafficManager.onDialogue = (t) => ui?.toast(t);
        // GỘP HAI HỆ THỐNG: npc.js trước đây tự spawn 15 xe không AI (bản song
        // song). Giờ TrafficManager là NGUỒN DUY NHẤT của xe đang chạy; npc.js
        // giữ nguyên API nhưng ủy quyền số liệu về đây.
        npc.setTrafficManager?.(trafficManager);
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
        
        passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui });
        await new Promise(r => setTimeout(r, 10));
        
        ui.setLoading("Hoàn tất...", 1.0);
        await new Promise(r => setTimeout(r, 100));
        ui.hideLoading();
        gameState = "playing";
        paused = false;
        document.getElementById("hud").style.display = "block";
        initInput();
        clock.start();
        lastTime = performance.now();
    } catch (error) {
        console.error("❌ Lỗi chi tiết:", error);
        alert("Lỗi tải game:\n" + error.message + "\n\nStack: " + error.stack);
        ui.showMainMenu();
    } finally {
        startingGame = false;   // cho phép thử lại nếu lần trước lỗi
    }
}

function updateWorld(delta) {
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
        doorProgress += (doorTarget - doorProgress) * 2.0 * delta;
        bus.setDoor(doorProgress);
    }
    updateVehiclePhysics(delta);
    // bus.update trước đây KHÔNG được gọi → đèn xi nhan/blink chết. Nối lại,
    // đồng thời là chu kỳ redraw cockpit (script update/BSOD 1s/lần).
    bus.update?.(delta);
    // tốc độ xe thật (kmh có dấu) → đồng hồ tài xế
    bus.setDriverTelemetry?.(vehiclePhysics.currentSpeedKmh);
    cameraSystem?.update(delta);
    if (bus?.group && map) map.updateChunks(bus.group.position.x, bus.group.position.z, delta, null, camera);
    if (npc) npc.update(delta, 0);
    if (trafficManager) trafficManager.update(delta, { x: bus.group.position.x, z: bus.group.position.z });
    if (passengerSystem) passengerSystem.update(delta);
    if (bus?.group && camera && lighting) updateEnderman(scene, camera, lighting, { x: bus.group.position.x, z: bus.group.position.z }, bus.group.rotation.y, delta);
}

function updateHUD(delta) {
    hudTimer += delta;
    if (hudTimer < 0.1) return;
    hudTimer = 0;
    if (gameState !== "playing" || !bus || !ui) return;
    const zones = passengerSystem?.getActiveZones?.() || [];
    if (!window._npcZonesCache) window._npcZonesCache = [];
    const npcZones = window._npcZonesCache;
    npcZones.length = 0;
    if (trafficManager?.aiVehicles) {
        for (let i = 0; i < trafficManager.aiVehicles.length; i++) {
            const c = trafficManager.aiVehicles[i].collider;
            if (c) npcZones.push(c);
        }
    }
    ui.update({
        fps: 1/delta,
        speedKmh: vehiclePhysics.currentSpeedKmh,
        passengers: passengerSystem?.onboardPassengers?.length || 0,
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

function loop() {
    try {
        if (webglLost) return;
        const frameStart = performance.now();
        if (webglLost) return;
        const now = performance.now();
        let rawDelta = (now - lastTime) / 1000;
        lastTime = now;
        if (rawDelta > 0.1) rawDelta = 0.1;
        if (gameState === "playing" && !paused && !isConsoleOpen) {
            accumulator += rawDelta;
            let steps = 0;
            while (accumulator >= FIXED_STEP && steps < 2) {
                updateWorld(FIXED_STEP);
                accumulator -= FIXED_STEP;
                steps++;
            }
            if (steps >= 2) accumulator = 0;
        }
        if (trafficDebug && trafficDebug.enabled) trafficDebug.update(rawDelta);
        
        // Render shadows BEFORE main scene render
        if (lighting && gameState === "playing") {
            lighting.renderShadows(bus?.group || null);
        }
        
        if (renderer && scene && camera) renderer.render(scene, camera);
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
                console.warn(`[PERF] Spikes ${perfSpikeCount}/${perfWindowCount} frame trong 10s — đỉnh ${perfMaxMs.toFixed(1)}ms, TB ${avg.toFixed(1)}ms`);
            }
            perfWindowStart = nowLoop;
            perfWindowSum = 0; perfWindowCount = 0; perfSpikeCount = 0; perfPeakMs = 0; perfMaxMs = 0;
        }
    } catch (e) {
        console.error("Loop Error:", e);
    }
    window.requestAnimationFrame(loop);
}

boot();
