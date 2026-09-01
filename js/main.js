// js/main.js - COACHVN OPTIMIZED PERFORMANCE EDITION (FULL FIXED)
// Target: low-end hardware / Intel UHD-class iGPU / 4GB RAM
import * as THREE from "three";
import {
    clamp,
    createMovingAverage,
    formatTime,
    formatMoney,
    formatNumber
} from "./utils.js";
import { createMap } from "./map.js";
import { createUI } from "./ui.js";
import { createNPC } from "./npc.js";
import { createBus, loadNpcSkinList } from "./bus.js";
import { createBusInterior } from "./interior.js";
import { CameraSystem } from "./camera.js";
import { LightingSystem } from "./lighting.js";
import { createPassengerSystem } from "./passenger.js";
import { createTrafficManager } from "./traffic/TrafficManager.js";
import { roadDataSegments } from "./map/data/roadData.js";
import { HUDSystem } from "./hud.js";
import { SteeringSystem } from "./steering.js";
import { CollisionSystem } from "./collision.js";
import { MinimapSystem } from "./minimap.js";
import {
    saveGameState,
    loadGameState,
    hasGameState
} from "./save.js";

const MAIN_VERSION = 14.2;
console.log(
    `%c🚌 COACHVN v${MAIN_VERSION} - PERFORMANCE EDITION`,
    "color:#00ff99;font-weight:bold"
);

// ============================================================================
// GLOBAL
// ============================================================================
let renderer = null;
let scene = null;
let camera = null;
let canvas = document.getElementById("game-canvas");
let map = null;
let lighting = null;
let npc = null;
let bus = null;
let interior = null;
let passengerSystem = null;
let trafficManager = null;
let ui = null;
let hud = null;
let cameraSystem = null;
let steering = null;
let collision = null;
let minimap = null;

const clock = new THREE.Clock();
let fpsAverage = createMovingAverage(30);
let gameState = "loading";
let paused = false;
let flyMode = false;
let consoleOpen = false;

// ============================================================================
// PERFORMANCE CONFIG
// ============================================================================
const PERFORMANCE = {
    targetFPS: 50,
    maxPixelRatio: 1.0,
    minRenderScale: 0.65,
    maxRenderScale: 1.0,
    sampleTime: 1.0,
    hudInterval: 0.15,
    trafficNormalInterval: 0,
    trafficLowFPSInterval: 0.033,
    npcNormalInterval: 0,
    npcLowFPSInterval: 0.025,
    passengerNormalInterval: 0,
    passengerLowFPSInterval: 0.033,
    minimapInterval: 0.05
};
let renderScale = 1.0;
let performanceTimer = 0;
let hudTimer = 0;
let trafficTimer = 0;
let npcTimer = 0;
let passengerTimer = 0;
let minimapTimer = 0;
let lowPerformanceMode = false;

// ============================================================================
// GAME SETTINGS
// ============================================================================
let gameSettings = {
    cameraSensitivity: 30,
    mouseSensitivity: 30,
    invertX: false,
    invertY: false,
    fov: 70,
    theme: "dark",
    uiScale: 100,
    masterVolume: 80,
    musicVolume: 60,
    sfxVolume: 70,
    graphicsQuality: "low",
    renderDistance: 8,
    shadows: false,
    bloom: false,
    outsideDistance: 8
};

// ============================================================================
// INPUT
// ============================================================================
const keysPressed = new Set();
let lastFPressTime = 0;
let lastCameraPressTime = 0;
let lastHornPressTime = 0;

// ============================================================================
// VEHICLE PHYSICS (FIXED W/S/A/D REAL DYNAMICS & FORWARD VECTOR)
// ============================================================================
const WORLD_UNITS_PER_KMH = 0.15;
const vehiclePhysics = {
    speed: 0, // Vận tốc có dấu: + là Tiến, - là Lùi
    maxSpeedKmh: 120,
    maxSpeed: 120 * WORLD_UNITS_PER_KMH,
    maxReverseSpeed: -30 * WORLD_UNITS_PER_KMH,
    acceleration: 40.0 * WORLD_UNITS_PER_KMH,
    shiftAcceleration: 60.0 * WORLD_UNITS_PER_KMH,
    drag: 1.5 * WORLD_UNITS_PER_KMH,
    braking: 35.0 * WORLD_UNITS_PER_KMH,
    reverseAcceleration: 12.0 * WORLD_UNITS_PER_KMH,
    currentSpeedKmh: 0,
    isReversing: false,
    forwardVector: new THREE.Vector3()
};

function updateVehiclePhysics(deltaTime) {
    if (!bus?.group) return;
    const phys = vehiclePhysics;
    const dt = deltaTime;
    
    const isW = keysPressed.has("KeyW");
    const isS = keysPressed.has("KeyS");
    const isShift = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight");
    
    // 1. LOGIC THROTTLE (W) VÀ BRAKE/REVERSE (S)
    if (isW && !isS) {
        // W: Tiến về phía trước
        const targetSpeed = isShift ? phys.maxSpeed : phys.maxSpeed * 0.8;
        const accel = isShift ? phys.shiftAcceleration : phys.acceleration;
        
        if (phys.speed < targetSpeed) {
            phys.speed += accel * dt;
            if (phys.speed > targetSpeed) phys.speed = targetSpeed;
        }
        phys.isReversing = false;
    } else if (isS && !isW) {
        // S: Phanh hoặc Lùi
        if (phys.speed > 0.1) { 
            // Đang tiến -> Phanh
            phys.speed -= phys.braking * dt;
        } else { 
            // Đã dừng -> Lùi (speed âm)
            phys.speed -= phys.reverseAcceleration * dt;
            phys.speed = Math.max(phys.speed, phys.maxReverseSpeed);
            phys.isReversing = true;
        }
    } else {
        // Không bấm W hay S -> Đổ trượt (Drag)
        if (Math.abs(phys.speed) > 0.01) {
            phys.speed -= phys.drag * dt * Math.sign(phys.speed);
        } else {
            phys.speed = 0;
        }
    }
    
    // 2. PHANH KHẨN CẤP (Space hoặc phím V để test)
    if (keysPressed.has("Space") || keysPressed.has("KeyV")) {
        if (Math.abs(phys.speed) > 0.1) {
            phys.speed -= phys.braking * 2 * dt * Math.sign(phys.speed);
        } else {
            phys.speed = 0; // Dừng hẳn, không lùi
        }
    }
    phys.currentSpeedKmh = Math.abs(phys.speed) / WORLD_UNITS_PER_KMH;

    // 3. LOGIC LÁI XE (A / D)
    let steerInput = 0;
    if (keysPressed.has("KeyA")) steerInput += 1;
    if (keysPressed.has("KeyD")) steerInput -= 1;
    
    const turnRate = steerInput * 1.5 * (phys.speed / phys.maxSpeed);
    bus.group.rotation.y += turnRate * dt;
    
    // 4. DI CHUYỂN THẬT
    const angle = bus.group.rotation.y;
    const forwardX = Math.sin(angle); 
    const forwardZ = Math.cos(angle); 
    
    bus.group.position.x += forwardX * phys.speed * dt;
    bus.group.position.z += forwardZ * phys.speed * dt;
    phys.forwardVector.set(forwardX, 0, forwardZ);
}

// ============================================================================
// DOOR ANIMATION (FIX J KEY - CỬA TRƯỢT THẬT)
// ============================================================================
let doorMeshes = [];
function findDoorMeshes() {
    doorMeshes = [];
    if (!bus?.group) return;
    bus.group.traverse((obj) => {
        if (obj.isMesh && obj.name && (obj.name.toLowerCase().includes("door") || obj.name.toLowerCase().includes("cua"))) {
            doorMeshes.push(obj);
        }
    });
}

function updateDoorAnimation(dt) {
    if (!bus || doorMeshes.length === 0) return;
    // Đầu xe +Z, phía sau là -Z. Cửa trượt ra sau -> targetZ = -1.5
    const targetZ = bus.doorOpen ? -1.5 : 0; 
    for (let mesh of doorMeshes) {
        mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, targetZ, dt * 5);
    }
}

// ============================================================================
// MINIMAP INTEGRATION
// ============================================================================
function initMinimap() {
    minimap = new MinimapSystem({ map, bus, scene });
    // Lấy dữ liệu road segments và destination từ map data
    if (roadDataSegments && roadDataSegments.length > 0) {
        minimap.setData(roadDataSegments, roadDataSegments, { x: 1230, z: -10500 });
    }
}

// ============================================================================
// INPUT INIT
// ============================================================================
function initInput() {
    window.addEventListener("keydown", (e) => {
        if (consoleOpen && e.code !== "Escape" && e.code !== "Slash" && e.code !== "Enter") return;
        if (e.code === "Slash") { e.preventDefault(); consoleOpen = !consoleOpen; toggleConsole(); return; }
        if (e.code === "Escape") { togglePause(); return; }
        
        keysPressed.add(e.code);
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
        
        if (gameState !== "playing") return;

        if (e.code === "KeyF" && bus) {
            const now = performance.now();
            if (now - lastFPressTime > 150) {
                lastFPressTime = now;
                bus.areLightsOn = !bus.areLightsOn;
                bus.setHeadlights?.(bus.areLightsOn);
                bus.setTaillights?.(bus.areLightsOn);
                hud.toast(`💡 ${bus.areLightsOn ? 'Bật đèn' : 'Tắt đèn'}`);
            }
        }
        if (e.code === "KeyJ" && bus) {
            bus.doorOpen = !bus.doorOpen;
            bus.setDoor?.(bus.doorOpen ? 1 : 0);
            hud.toast(`🚪 ${bus.doorOpen ? 'Mở cửa' : 'Đóng cửa'}`);
        }
        if (e.code === "KeyK" && passengerSystem) {
            if (typeof passengerSystem.pickUpPassengers === "function") {
                passengerSystem.pickUpPassengers();
            }
        }
        if (e.code === "KeyL" && bus) {
            bus.interiorLedOn = !bus.interiorLedOn;
            bus.setInteriorLed?.(bus.interiorLedOn);
            hud.toast(`💡 LED ${bus.interiorLedOn ? 'ON' : 'OFF'}`);
        }
        if (e.code === "KeyH") {
            const now = performance.now();
            if (now - lastHornPressTime > 300) {
                lastHornPressTime = now;
                hud.toast("📯 Bim bim!");
            }
        }
        if (e.code === "KeyC" && cameraSystem) {
            const now = performance.now();
            if (now - lastCameraPressTime > 200) {
                lastCameraPressTime = now;
                cameraSystem.cycleNext();
                hud.toast(`📷 ${cameraSystem.getCurrentModeName()}`);
            }
        }
        if (e.code === "KeyP") {
            flyMode = !flyMode;
            hud.toast(`✈️ Fly mode ${flyMode ? 'ON' : 'OFF'}`);
        }
    });
    
    window.addEventListener("keyup", (e) => keysPressed.delete(e.code));
    window.addEventListener("blur", () => keysPressed.clear());
    
    canvas?.addEventListener("click", () => {
        if (gameState === "playing" && !paused) canvas.requestPointerLock?.();
    });
}

// ============================================================================
// CONSOLE SYSTEM
// ============================================================================
function toggleConsole() {
    let consoleEl = document.getElementById("command-console");
    if (!consoleEl) { createConsole(); consoleEl = document.getElementById("command-console"); }
    if (!consoleEl) return;
    if (consoleOpen) {
        consoleEl.classList.add("visible");
        setTimeout(() => document.getElementById("command-input")?.focus(), 30);
    } else {
        consoleEl.classList.remove("visible");
    }
}

function createConsole() {
    const consoleHTML = `
    <div id="command-console" class="overlay">
        <div class="console-panel">
            <div class="console-header">
                📟 Command Console
                <div class="btn-close" id="btn-close-console">✕</div>
            </div>
            <div class="console-body">
                <div id="console-output" class="console-output"></div>
                <input id="command-input" type="text" class="console-input" placeholder="Gõ lệnh..." />
                <div class="console-help">Gõ "help" để xem danh sách lệnh | Enter để thực thi | Esc hoặc / để đóng</div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML("beforeend", consoleHTML);
    const input = document.getElementById("command-input");
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { executeCommand(input.value); input.value = ""; }
        if (e.key === "Escape") { consoleOpen = false; document.getElementById("command-console")?.classList.remove("visible"); }
    });
    document.getElementById("btn-close-console")?.addEventListener("click", () => {
        consoleOpen = false; document.getElementById("command-console")?.classList.remove("visible");
    });
}

function appendToConsole(text, type = "msg") {
    const outputEl = document.getElementById("console-output");
    if (!outputEl) return;
    const el = document.createElement("div");
    el.className = type === "cmd" ? "console-cmd" : "console-msg";
    el.textContent = text;
    outputEl.appendChild(el);
    outputEl.scrollTop = outputEl.scrollHeight;
}

function executeCommand(cmd) {
    const command = cmd.trim().toLowerCase();
    appendToConsole(`> ${cmd}`, "cmd");
    let executed = false;
    switch (command) {
        case "help":
            appendToConsole(`📋 Danh sách lệnh:
• help - Hiển thị trợ giúp
• time [HH:MM] - Đặt thời gian
• speed [number] - Tốc độ
• fuel [0-100] - Nhiên liệu
• money [amount] - Tiền
• teleport - Về bến xuất phát
• clear - Xóa màn hình
• version - Phiên bản game`);
            executed = true; break;
        case "clear": document.getElementById("console-output").innerHTML = ""; executed = true; break;
        case "version": appendToConsole(`🚌 CoachVN v${MAIN_VERSION}`); executed = true; break;
        case "teleport":
            if (map) { const spawn = map.getSpawnPoint(); bus.group.position.set(spawn.x, spawn.y, spawn.z); appendToConsole("✅ Đã dịch chuyển"); }
            executed = true; break;
    }
    if (!executed && command.startsWith("time ")) {
        const val = command.split(/\s+/)[1];
        if (lighting) { const [h, m] = val.split(":").map(Number); lighting.setGameTime(h * 60 + m); appendToConsole(`🕒 Thời gian: ${val}`); }
        executed = true;
    } else if (!executed && command.startsWith("speed ")) {
        const val = parseFloat(command.split(/\s+/)[1]);
        if (!Number.isNaN(val)) { vehiclePhysics.speed = val * WORLD_UNITS_PER_KMH; appendToConsole(`🚍 Tốc độ: ${val} km/h`); }
        executed = true;
    } else if (!executed && command.startsWith("money ")) {
        const val = parseInt(command.split(/\s+/)[1], 10);
        if (!Number.isNaN(val)) appendToConsole(`💰 Tiền: ${formatMoney(val)}`);
        executed = true;
    } else if (!executed && command.startsWith("fuel ")) {
        const val = parseFloat(command.split(/\s+/)[1]);
        if (!Number.isNaN(val)) appendToConsole(`⛽ Nhiên liệu: ${val}%`);
        executed = true;
    }
    if (!executed) appendToConsole("❌ Lệnh không hợp lệ");
}

// ============================================================================
// MENU & SETTINGS
// ============================================================================
function showMainMenu() {
    gameState = "menu"; paused = false;
    ui?.showMainMenu(); hud?.hide();
    document.exitPointerLock?.();
    const continueBtn = document.getElementById("btn-continue");
    if (continueBtn) continueBtn.disabled = !hasGameState();
}

function startGame() {
    gameState = "playing"; paused = false;
    ui?.hideMainMenu(); hud?.show();
    canvas?.focus(); canvas.requestPointerLock?.();
    clock.getDelta();
}

function togglePause() {
    if (gameState === "playing") {
        gameState = "paused"; paused = true;
        ui?.showPauseMenu(); document.exitPointerLock?.();
    } else if (gameState === "paused") {
        gameState = "playing"; paused = false;
        ui?.hidePauseMenu(); canvas?.focus(); canvas.requestPointerLock?.();
        clock.getDelta();
    }
}

function applySettings() {
    if (cameraSystem) {
        const sens = gameSettings.cameraSensitivity / 30000;
        const clampedSens = Math.max(0.0001, Math.min(0.01, sens));
        cameraSystem.updateSettings({
            cameraSensitivity: clampedSens,
            invertX: gameSettings.invertX,
            invertY: gameSettings.invertY,
            fov: gameSettings.fov,
            outsideDistance: gameSettings.outsideDistance
        });
    }
    document.documentElement.style.setProperty("--ui-scale", gameSettings.uiScale / 100);
}

// ============================================================================
// RENDERER & PERFORMANCE
// ============================================================================
function initRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    renderer.setPixelRatio(PERFORMANCE.maxPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
}

function applyRenderScale() {
    if (!renderer) return;
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(1, Math.floor(window.innerWidth * renderScale)), Math.max(1, Math.floor(window.innerHeight * renderScale)), false);
}

function updateAdaptivePerformance(delta) {
    performanceTimer += delta;
    if (performanceTimer < PERFORMANCE.sampleTime) return;
    performanceTimer = 0;
    const fps = fpsAverage.value || 60;
    if (fps < 25) { renderScale = Math.max(PERFORMANCE.minRenderScale, renderScale - 0.10); lowPerformanceMode = true; }
    else if (fps > 58) { renderScale = Math.min(PERFORMANCE.maxRenderScale, renderScale + 0.02); if (renderScale >= 0.95) lowPerformanceMode = false; }
    if (Math.abs(renderScale - (renderer?.getPixelRatio() || 1)) > 0.005) applyRenderScale();
}

// ============================================================================
// BOOT
// ============================================================================
async function boot() {
    try {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(gameSettings.fov, window.innerWidth / window.innerHeight, 0.1, 5000);
        
        ui = createUI({ map: null, callbacks: {} });
        ui.setLoading("Renderer...", 0.1); await new Promise(r => setTimeout(r, 50)); initRenderer();

        ui.setLoading("Ánh sáng...", 0.2);
        lighting = new LightingSystem(scene);
        window.lighting = lighting;
        await new Promise(r => setTimeout(r, 50));

        ui.setLoading("Bản đồ...", 0.3);
        map = createMap({ scene, seed: 2026, lighting });
        await new Promise(r => setTimeout(r, 50));

        ui.setLoading("Xe của bạn...", 0.5);
        bus = createBus();
        try { interior = createBusInterior(); if (!interior?.isObject3D) interior = new THREE.Group(); } catch (e) { interior = new THREE.Group(); }
        bus.group.add(interior);
        bus.setInteriorReference?.(interior);
        scene.add(bus.group);

        const spawn = map.getSpawnPoint();
        const pSlots = map.getParkingSlots ? map.getParkingSlots() : [];
        if (pSlots.length > 0) { bus.group.position.set(pSlots[0].position.x, 0.5, pSlots[0].position.z); bus.group.rotation.y = pSlots[0].rotation || 0; }
        else { bus.group.position.set(spawn.x, spawn.y, spawn.z); bus.group.rotation.y = spawn.heading || 0; }
        
        findDoorMeshes();
        await new Promise(r => setTimeout(r, 50));

        ui.setLoading("Camera...", 0.6);
        cameraSystem = new CameraSystem(camera, bus.group);
        cameraSystem.setMode("driver");
        
        hud = new HUDSystem(); hud.hide();
        initMinimap();

        ui.setLoading("Traffic & NPC...", 0.7);
        await Promise.race([ loadNpcSkinList(), new Promise(r => setTimeout(r, 8000)) ]).catch(e => console.warn("Skin lỗi:", e));
        try { npc = createNPC({ scene, map, seed: 2027, playerBus: bus, playerSpawnPos: bus.group.position }); } catch (e) { npc = null; }
        try { trafficManager = createTrafficManager({ scene, roadGraph: roadDataSegments || [], busSlots: map.getBusSlots?.() || [], playerRef: bus, maxVehicles: 10 }); } catch (e) { trafficManager = null; }
        await new Promise(r => setTimeout(r, 50));

        ui.setLoading("Hành khách...", 0.8);
        try { passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui }); } catch (e) { passengerSystem = { update() {}, pickUpPassengers() {} }; }
        await new Promise(r => setTimeout(r, 50));

        initInput();
        setupMenuEvents();
        window.addEventListener("resize", onResize, { passive: true });

        if (ui && typeof ui.hideLoading === 'function') ui.hideLoading();
        document.querySelectorAll('[id="loading-screen"], .loading-overlay').forEach(el => { el.style.display = 'none'; el.style.opacity = '0'; });

        setTimeout(() => showMainMenu(), 300);
        clock.start();
        renderer.setAnimationLoop(loop);
        console.log("✅ COACHVN boot completed");
    } catch (error) {
        console.error("❌ Lỗi khởi động:", error);
        alert("Game lỗi: " + error.message);
    }
}

function setupMenuEvents() {
    document.getElementById("btn-continue")?.addEventListener("click", () => {
        if (hasGameState()) {
            const save = loadGameState();
            if (save.ok && save.state.camera) bus.group.position.set(save.state.camera.x, save.state.camera.y, save.state.camera.z);
            startGame();
        }
    });
    document.getElementById("btn-new-game")?.addEventListener("click", startGame);
    document.getElementById("btn-exit")?.addEventListener("click", () => { if (confirm("Thoát game?")) window.close(); });
    document.getElementById("btn-resume")?.addEventListener("click", togglePause);
    document.getElementById("btn-restart")?.addEventListener("click", () => { if (confirm("Khởi động lại?")) location.reload(); });
    document.getElementById("btn-main-menu")?.addEventListener("click", showMainMenu);
    document.getElementById("btn-save")?.addEventListener("click", () => {
        saveGameState({ camera: bus.group.position, clock: { minutes: lighting.getGameTime() }, gameState: { money: 500000, fuel: 0.8 } });
        ui.toast("✅ Đã lưu game");
    });
    document.getElementById("btn-settings")?.addEventListener("click", () => hud.toast("⚙️ Coming Soon..."));
    document.getElementById("btn-help")?.addEventListener("click", () => hud.toast("📖 Coming Soon..."));
    document.getElementById("btn-close-settings")?.addEventListener("click", () => document.getElementById("settings-panel")?.classList.remove("visible"));
    document.getElementById("btn-apply-settings")?.addEventListener("click", () => { applySettings(); document.getElementById("settings-panel")?.classList.remove("visible"); });
}

// ============================================================================
// WORLD SYSTEMS
// ============================================================================
function updateWorld(delta, nowSeconds) {
    if (!lighting) return;
    try {
        if (gameState === "playing" && !paused) lighting.update(delta);
        if (flyMode) { updateFlyMode(delta); return; }
        if (gameState === "playing" && !paused) {
            updateVehiclePhysics(delta);
            updateDoorAnimation(delta);
            if (collision && collision.update) collision.update(delta);
        }
    } catch (e) { console.error("Lỗi Vật lý/Time:", e); }

    try { cameraSystem?.update(delta); } catch (e) { console.error("Lỗi Camera:", e); }

    try {
        if (bus?.group && map) map.setPlayerPosition(bus.group.position.x, bus.group.position.z);
        if (gameState === "playing" && !paused) {
            trafficTimer += delta;
            if (trafficTimer > (lowPerformanceMode ? PERFORMANCE.trafficLowFPSInterval : PERFORMANCE.trafficNormalInterval)) {
                trafficManager?.update?.(trafficTimer, { x: bus.group.position.x, z: bus.group.position.z });
                trafficTimer = 0;
            }
            npcTimer += delta;
            if (npcTimer > (lowPerformanceMode ? PERFORMANCE.npcLowFPSInterval : PERFORMANCE.npcNormalInterval)) {
                npc?.update?.(npcTimer, nowSeconds);
                npcTimer = 0;
            }
            passengerTimer += delta;
            if (passengerTimer > 0.033) {
                if (passengerSystem) {
                    if (typeof passengerSystem.update === "function") passengerSystem.update(bus.group.position, bus.group.rotation.y);
                    else if (typeof passengerSystem.updatePassengers === "function") passengerSystem.updatePassengers(bus.group.position, bus.group.rotation.y);
                }
                passengerTimer = 0;
            }
            minimapTimer += delta;
            if (minimapTimer > PERFORMANCE.minimapInterval) {
                let npcPos = [];
                if (trafficManager && trafficManager.vehicles) {
                    for (const v of trafficManager.vehicles) {
                        if (v.mesh) npcPos.push({ x: v.mesh.position.x, z: v.mesh.position.z });
                    }
                }
                minimap?.updateNPCs(npcPos);
                minimap?.draw();
                minimapTimer = 0;
            }
        }
    } catch (e) { console.error("Lỗi cập nhật thế giới:", e); }
}

function updateFlyMode(delta) {
    if (!camera) return;
    const s = 20 * delta;
    if (keysPressed.has("KeyW")) camera.translateZ(-s);
    if (keysPressed.has("KeyS")) camera.translateZ(s);
    if (keysPressed.has("KeyA")) camera.translateX(-s);
    if (keysPressed.has("KeyD")) camera.translateX(s);
    if (keysPressed.has("Space")) camera.position.y += s;
    if (keysPressed.has("ShiftLeft")) camera.position.y -= s;
}

// ============================================================================
// HUD
// ============================================================================
function updateHUD(delta) {
    hudTimer += delta;
    if (hudTimer < PERFORMANCE.hudInterval) return;
    hudTimer = 0;
    if (gameState !== "playing" || !bus || !hud) return;
    hud.update({
        fps: Math.round(fpsAverage.value || 60),
        speedKmh: vehiclePhysics.currentSpeedKmh,
        fuel: 0.8, money: 500000,
        passengers: passengerSystem?.onboardPassengers?.length || 0,
        passengerCapacity: 24,
        timeMinutes: lighting.getGameTime ? lighting.getGameTime() : 360,
        nextStop: "Trạm Đại Lãnh", nextStopDistance: 2.4,
        doorOpen: !!bus.doorOpen
    });
}

// ============================================================================
// MAIN LOOP
// ============================================================================
let smoothDelta = 1 / 60;
function loop() {
    try {
        const rawDelta = Math.min(clock.getDelta(), 0.1);
        smoothDelta += (rawDelta - smoothDelta) * 0.10;
        const delta = Math.max(0.001, Math.min(0.05, smoothDelta));
        const now = performance.now() / 1000;
        fpsAverage.add(1 / Math.max(rawDelta, 0.001));
        updateAdaptivePerformance(delta);
        updateWorld(delta, now);
        renderer.render(scene, camera);
        updateHUD(delta);
    } catch (e) {
        console.error("⚠️ Lỗi vòng lặp game:", e);
        paused = true;
    }
}

function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyRenderScale();
}

// ============================================================================
// START
// ============================================================================
boot();