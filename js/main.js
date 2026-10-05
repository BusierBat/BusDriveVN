// js/main.js
import * as THREE from "three";
import { MapLoader } from "./map.js";
import { createUI } from "./ui.js";
import { createNPC } from "./npc.js";
import { createBus, loadNpcSkinList } from "./bus.js";
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
let lastTime = performance.now();
let webglLost = false;
let isConsoleOpen = false;
let speedCameraFlashTimer = 0;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
let gameSettings = { graphics: 'low', renderDist: 2, npcDensity: 5, camSens: 30, fov: 70, lightingQuality: 'MEDIUM', godRays: 'high' };

// Load settings from localStorage
try {
    const saved = localStorage.getItem('busdrivevn_settings');
    if (saved) {
        const parsed = JSON.parse(saved);
        gameSettings = { ...gameSettings, ...parsed };
    }
} catch(e) {}

if (isMobile || isLowEnd) { 
    gameSettings.renderDist = 1; 
    gameSettings.npcDensity = 3; 
}

let mobileInput = { steer: 0, accel: 0, brake: 0 };

const SPEED_CONVERSION = 0.4;
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

const KEY_HOLD_TIMEOUT_MS = 5000;
// Chống phím kẹt khi IME nuốt keyup. 5000ms an toàn cho cả Windows repeat chậm nhất
// (delay <= 1s + interval <= 0.5s) nên phím đang giữ thật không bị nhả nhầm.
//
// PHÍM LÁI A/D dùng timeout NÀY nhưng với quy tắc refresh khác: chỉ keydown
// CỦA CHÚNG mới làm mới timestamp (ga/thắng KHÔNG được refresh giùm). Nhờ vậy
// phím lái "ma" luôn tự hết hạn trong 5s kể từ lần bấm cuối, kể cả người chơi
// đang giữ ga -> xe không thể tự quẹo vĩnh viễn vì một keyup bị IME nuốt.
// Xem vòng lặp refresh trong initInput().

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
        if (now - last > KEY_HOLD_TIMEOUT_MS) keysPressed.delete(code);
    }
}

function clearPressedKeys() { keysPressed.clear(); }

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
    const speedSteerLimit = 1 - Math.min(0.7, speedKmh / 160);
    
    if (keysPressed.has("KeyA")) steerTarget = 0.5 * speedSteerLimit;
    else if (keysPressed.has("KeyD")) steerTarget = -0.5 * speedSteerLimit;
    else if (mobileInput.steer !== 0) steerTarget = 0.5 * speedSteerLimit * mobileInput.steer;
    else steerTarget = 0;
    
    if (steerTarget === 0) steerAngle += (0 - steerAngle) * Math.min(1, dt * 3.5);
    else steerAngle += (steerTarget - steerAngle) * Math.min(1, dt * 2.5);
    
    if (Math.abs(phys.speed) > 0.1) bus.group.rotation.y += steerAngle * dt * 1.5 * Math.sign(phys.speed);
    
    if (Math.abs(phys.speed) > 0.001) {
        const forward = phys.forwardVector.set(0, 0, 1).applyQuaternion(bus.group.quaternion);
        const moveDistance = phys.speed * dt;
        const newX = bus.group.position.x + forward.x * moveDistance;
        const newZ = bus.group.position.z + forward.z * moveDistance;
        
        let canMove = true;
        if (window.collisionSystem) {
            const hit = window.collisionSystem.check(newX, newZ, 4.0, playerColId);
            if (hit) {
                phys.speed *= -0.5;
                canMove = false;
                if (hit.type === 'npc' && hit.data?.ai) hit.data.ai.speed = 0;
            }
        }
        
        if (canMove) {
            bus.group.position.x = newX;
            bus.group.position.z = newZ;
        }
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
        if (code) keysPressed.delete(code);
        // khong resolve duoc -> pruneStaleKeys se don sau toi da 5s (va truoc do,
        // phim lai ma da bi xoa ngay boi phim lai doi xung khi nguoi choi bam no)
    });

    window.addEventListener("blur", clearPressedKeys);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearPressedKeys(); });
}

function handleCommand(cmd) {
    const parts = cmd.split(" ");
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
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // LightingSystem controls shadow updates
    renderer.domElement.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        webglLost = true;
        alert("GPU quá tải, vui lòng F5!");
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
        gameSettings = { graphics: 'low', renderDist: 2, npcDensity: 5, camSens: 30, fov: 70, lightingQuality: 'MEDIUM', godRays: 'high' };
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
        await new Promise(r => setTimeout(r, 100));
        
        ui.setLoading("Xe khách 3D...", 0.6);
        bus = createBus();
        interior = createBusInterior();
        if (!interior?.isObject3D) interior = new THREE.Group();
        bus.group.add(interior);
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
    cameraSystem?.update(delta);
    if (bus?.group && map) map.updateChunks(bus.group.position.x, bus.group.position.z, delta);
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
let accumulator = 0;
function loop() {
    try {
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
            lighting.renderShadows();
        }
        
        if (renderer && scene && camera) renderer.render(scene, camera);
        if (gameState === "playing") updateHUD(rawDelta);
    } catch (e) {
        console.error("Loop Error:", e);
    }
    window.requestAnimationFrame(loop);
}

boot();
