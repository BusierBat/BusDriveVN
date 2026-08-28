// js/main.js - COACHVN OPTIMIZED PERFORMANCE EDITION (FULL FIXED)
// Target: low-end hardware / Intel UHD-class iGPU / 4GB RAM
// Focus: stable FPS, low CPU overhead, low GPU overhead

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

import {
    saveGameState,
    loadGameState,
    hasGameState
} from "./save.js";

const MAIN_VERSION = 13;

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
let cameraSystem = null;

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
    passengerLowFPSInterval: 0.033
};

let renderScale = 1.0;
let performanceTimer = 0;
let hudTimer = 0;
let trafficTimer = 0;
let npcTimer = 0;
let passengerTimer = 0;
let lowPerformanceMode = false;

// ============================================================================
// VEHICLE PHYSICS
// ============================================================================

const WORLD_UNITS_PER_KMH = 0.15;

const vehiclePhysics = {
    speed: 0,
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

// ============================================================================
// INPUT
// ============================================================================

const keysPressed = new Set();
let lastFPressTime = 0;
let lastCameraPressTime = 0;
let lastHornPressTime = 0;

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
// VEHICLE PHYSICS UPDATE (Space = dừng gấp)
// ============================================================================

function updateVehiclePhysics(deltaTime) {
    if (!bus?.group) return;

    const phys = vehiclePhysics;
    const dt = deltaTime;

    if (keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight")) {
        if (keysPressed.has("KeyW")) {
            phys.speed += phys.shiftAcceleration * dt;
            phys.speed = Math.min(phys.speed, phys.maxSpeed);
        }
    } else if (keysPressed.has("KeyW")) {
        phys.speed += phys.acceleration * dt;
        phys.speed = Math.min(phys.speed, phys.maxSpeed);
        phys.isReversing = false;
    } else if (keysPressed.has("KeyS")) {
        if (phys.speed > 0) {
            phys.speed -= phys.braking * dt;
            phys.speed = Math.max(phys.speed, 0);
            phys.isReversing = false;
        } else {
            phys.isReversing = true;
            phys.speed -= phys.reverseAcceleration * dt;
            phys.speed = Math.max(phys.speed, phys.maxReverseSpeed);
        }
    } else if (keysPressed.has("Space")) {
        phys.speed = 0;
        phys.isReversing = false;
    } else {
        if (phys.speed > 0) {
            phys.speed -= phys.drag * dt;
            phys.speed = Math.max(phys.speed, 0);
        } else if (phys.speed < 0) {
            phys.speed += phys.drag * dt;
            phys.speed = Math.min(phys.speed, 0);
        }
    }

    if (Math.abs(phys.speed) < 0.001) {
        phys.speed = 0;
        phys.isReversing = false;
    }

    phys.currentSpeedKmh = phys.speed / WORLD_UNITS_PER_KMH;

    if (Math.abs(phys.speed) > 0.001) {
        const forward = phys.forwardVector;
        forward.set(0, 0, 1);
        forward.applyQuaternion(bus.group.quaternion);
        const moveDistance = phys.speed * dt;
        bus.group.position.x += forward.x * moveDistance;
        bus.group.position.y += forward.y * moveDistance;
        bus.group.position.z += forward.z * moveDistance;
    }

    const steerSpeed = 0.8;
    const speedKmh = Math.abs(phys.currentSpeedKmh);
    const speedFactor = Math.min(1, speedKmh / 80);

    if (keysPressed.has("KeyA")) {
        bus.group.rotation.y += steerSpeed * dt * speedFactor;
    }
    if (keysPressed.has("KeyD")) {
        bus.group.rotation.y -= steerSpeed * dt * speedFactor;
    }
}

// ============================================================================
// INPUT SYSTEM
// ============================================================================

function initInput() {
    window.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "/" || e.code === "Slash") {
                e.preventDefault();
                consoleOpen = !consoleOpen;
                toggleConsole();
                return;
            }

            if (consoleOpen) return;

            if (gameState !== "playing") {
                if (e.code === "Escape") {
                    togglePause();
                }
                return;
            }

            keysPressed.add(e.code);

            if (
                e.code === "Space" ||
                e.code === "ArrowUp" ||
                e.code === "ArrowDown" ||
                e.code === "ArrowLeft" ||
                e.code === "ArrowRight"
            ) {
                e.preventDefault();
            }

            // Headlights
            if (e.code === "KeyF") {
                const now = performance.now();
                if (now - lastFPressTime > 150 && bus) {
                    lastFPressTime = now;
                    const currentLight = bus.areLightsOn || false;
                    bus.setHeadlights?.(!currentLight);
                    bus.setTaillights?.(!currentLight);
                    bus.areLightsOn = !currentLight;
                    ui?.toast(
                        bus.areLightsOn ? "💡 Bật đèn" : "💡 Tắt đèn"
                    );
                }
            }

            // Door
            if (e.code === "KeyK" && bus) {
                if (bus.setDoor) {
                    const isOpen = !bus.doorOpen;
                    bus.setDoor(isOpen ? 1 : 0);
                    bus.doorOpen = isOpen;
                    ui?.toast(isOpen ? "🚪 Mở cửa" : "🚪 Đóng cửa");
                }
            }

            // Interior LED
            if (e.code === "KeyL" && bus) {
                if (bus.setInteriorLed) {
                    const isOn = !bus.interiorLedOn;
                    bus.setInteriorLed(isOn);
                    bus.interiorLedOn = isOn;
                    ui?.toast(isOn ? "💡 LED ON" : "💡 LED OFF");
                }
            }

            // Horn
            if (e.code === "KeyH") {
                const now = performance.now();
                if (now - lastHornPressTime > 300) {
                    lastHornPressTime = now;
                    ui?.toast("📯 Bim bim!");
                }
            }

            // Camera
            if (e.code === "KeyC") {
                const now = performance.now();
                if (now - lastCameraPressTime > 200 && cameraSystem) {
                    lastCameraPressTime = now;
                    cameraSystem.cycleNext();
                    ui?.toast(`📷 ${cameraSystem.getCurrentModeName()}`);
                }
            }

            // Fly mode
            if (e.code === "KeyP") {
                flyMode = !flyMode;
                ui?.toast(flyMode ? "✈️ Fly mode ON" : "✈️ Fly mode OFF");
            }

            // Pause
            if (e.code === "Escape") {
                togglePause();
            }
        },
        { passive: false }
    );

    window.addEventListener(
        "keyup",
        (e) => {
            keysPressed.delete(e.code);
        }
    );

    window.addEventListener(
        "blur",
        () => {
            keysPressed.clear();
        }
    );
}

// ============================================================================
// CONSOLE
// ============================================================================

function toggleConsole() {
    let consoleEl = document.getElementById("command-console");
    if (!consoleEl) {
        createConsole();
        consoleEl = document.getElementById("command-console");
    }
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
                    <span>📟 Command Console</span>
                    <button class="btn-close" id="btn-close-console">✕</button>
                </div>
                <div class="console-body">
                    <div id="console-output" class="console-output"></div>
                    <input type="text" id="command-input" class="console-input" placeholder="Nhập lệnh..." autocomplete="off" />
                </div>
                <div class="console-help">
                    Gõ "help" để xem danh sách lệnh | Enter để thực thi | Esc hoặc / để đóng
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", consoleHTML);

    const input = document.getElementById("command-input");
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            executeCommand(input.value);
            input.value = "";
        }
        if (e.key === "Escape") {
            consoleOpen = false;
            document.getElementById("command-console")?.classList.remove("visible");
        }
    });
    document.getElementById("btn-close-console")?.addEventListener("click", () => {
        consoleOpen = false;
        document.getElementById("command-console")?.classList.remove("visible");
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
            executed = true;
            break;

        case "clear":
            document.getElementById("console-output").innerHTML = "";
            executed = true;
            break;

        case "version":
            appendToConsole(`🚌 CoachVN v${MAIN_VERSION}`);
            executed = true;
            break;

        case "teleport":
            if (map && bus) {
                const spawn = map.getSpawnPoint();
                bus.group.position.set(spawn.x, spawn.y, spawn.z);
                bus.group.rotation.y = spawn.heading || 0;
                vehiclePhysics.speed = 0;
                vehiclePhysics.currentSpeedKmh = 0;
                appendToConsole("✅ Đã teleport về điểm xuất phát");
            } else {
                appendToConsole("❌ Map hoặc Bus chưa sẵn sàng");
            }
            executed = true;
            break;

        default:
            if (command.startsWith("time ")) {
                const timeStr = command.split(/\s+/)[1];
                const parts = timeStr ? timeStr.split(":") : [];
                if (parts.length === 2) {
                    const hours = parseInt(parts[0], 10);
                    const minutes = parseInt(parts[1], 10);
                    if (!Number.isNaN(hours) && !Number.isNaN(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                        const totalMinutes = hours * 60 + minutes;
                        if (lighting) {
                            lighting.setGameTime(totalMinutes);
                            lighting.update(0);
                            appendToConsole(`⏰ Đã chuyển thời gian thành: ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
                        } else {
                            appendToConsole("❌ Lighting System không hoạt động");
                        }
                    } else {
                        appendToConsole("❌ Giờ/phút không hợp lệ");
                    }
                } else {
                    appendToConsole("❌ Sai cú pháp: time HH:MM");
                }
                executed = true;
            } else if (command.startsWith("speed ")) {
                const val = parseFloat(command.split(/\s+/)[1]);
                if (!Number.isNaN(val)) {
                    const safeSpeed = Math.max(0, Math.min(val, vehiclePhysics.maxSpeedKmh));
                    vehiclePhysics.currentSpeedKmh = safeSpeed;
                    vehiclePhysics.speed = safeSpeed * WORLD_UNITS_PER_KMH;
                    appendToConsole(`🚍 Tốc độ: ${safeSpeed} km/h`);
                }
                executed = true;
            } else if (command.startsWith("fuel ")) {
                const val = parseFloat(command.split(/\s+/)[1]);
                if (!Number.isNaN(val) && val >= 0 && val <= 100) {
                    appendToConsole(`⛽ Nhiên liệu: ${val}%`);
                }
                executed = true;
            } else if (command.startsWith("money ")) {
                const val = parseInt(command.split(/\s+/)[1], 10);
                if (!Number.isNaN(val)) {
                    appendToConsole(`💰 Tiền: ${formatMoney(val)}`);
                }
                executed = true;
            }
    }
    if (!executed) {
        appendToConsole("❌ Lệnh không hợp lệ");
    }
}

// ============================================================================
// MENU
// ============================================================================

function showMainMenu() {
    gameState = "menu";
    paused = false;

    const mainMenu = document.getElementById("main-menu");
    if (mainMenu) {
        mainMenu.style.display = "flex";
        mainMenu.classList.add("visible");
    }

    const hud = document.getElementById("hud");
    hud?.classList.add("hidden");

    const pauseMenu = document.getElementById("pause-menu");
    if (pauseMenu) {
        pauseMenu.style.display = "none";
        pauseMenu.classList.remove("visible");
    }

    const continueBtn = document.getElementById("btn-continue");
    const continueHint = document.getElementById("continue-hint");
    const hasSave = hasGameState();

    if (continueBtn) {
        continueBtn.disabled = !hasSave;
    }
    if (continueHint) {
        continueHint.textContent = hasSave ? "Có dữ liệu lưu" : "Không có dữ liệu lưu";
    }
}

function startGame() {
    gameState = "playing";
    paused = false;

    document.getElementById("main-menu")?.classList.remove("visible");
    const mainMenu = document.getElementById("main-menu");
    if (mainMenu) {
        mainMenu.style.display = "none";
    }

    const pauseMenu = document.getElementById("pause-menu");
    if (pauseMenu) {
        pauseMenu.style.display = "none";
        pauseMenu.classList.remove("visible");
    }

    document.getElementById("hud")?.classList.remove("hidden");

    canvas?.focus();
    clock.getDelta();
}

function togglePause() {
    if (gameState === "playing") {
        gameState = "paused";
        paused = true;
        const pauseMenu = document.getElementById("pause-menu");
        if (pauseMenu) {
            pauseMenu.style.display = "flex";
            pauseMenu.classList.add("visible");
        }
    } else if (gameState === "paused") {
        gameState = "playing";
        paused = false;
        const pauseMenu = document.getElementById("pause-menu");
        if (pauseMenu) {
            pauseMenu.classList.remove("visible");
            pauseMenu.style.display = "none";
        }
        canvas?.focus();
        clock.getDelta();
    }
}

// ============================================================================
// RENDERER
// ============================================================================

function initRenderer() {
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: "high-performance",
        stencil: false,
        depth: true,
        preserveDrawingBuffer: false
    });

    renderer.setPixelRatio(PERFORMANCE.maxPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
}

// ============================================================================
// ADAPTIVE RESOLUTION
// ============================================================================

function applyRenderScale() {
    if (!renderer) return;
    const width = Math.max(1, Math.floor(window.innerWidth * renderScale));
    const height = Math.max(1, Math.floor(window.innerHeight * renderScale));
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
}

function updateAdaptivePerformance(delta) {
    performanceTimer += delta;
    if (performanceTimer < PERFORMANCE.sampleTime) return;
    performanceTimer = 0;

    const fps = fpsAverage.value || 60;
    const previousScale = renderScale;

    if (fps < 25) {
        renderScale = Math.max(PERFORMANCE.minRenderScale, renderScale - 0.10);
        lowPerformanceMode = true;
    } else if (fps < 35) {
        renderScale = Math.max(PERFORMANCE.minRenderScale, renderScale - 0.05);
        lowPerformanceMode = true;
    } else if (fps < 45) {
        renderScale = Math.max(PERFORMANCE.minRenderScale, renderScale - 0.02);
    } else if (fps > 58) {
        renderScale = Math.min(PERFORMANCE.maxRenderScale, renderScale + 0.02);
        if (renderScale >= 0.95) {
            lowPerformanceMode = false;
        }
    }

    if (Math.abs(renderScale - previousScale) > 0.005) {
        applyRenderScale();
        console.log(`🎮 Adaptive resolution: ${(renderScale * 100).toFixed(0)}% | FPS: ${fps.toFixed(1)}`);
    }
}

// ============================================================================
// BOOT
// ============================================================================

async function boot() {
    try {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(
            gameSettings.fov,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );

        ui = createUI({ map: null, callbacks: {} });
        ui.setLoading("Renderer...", 0.1);
        await new Promise(r => setTimeout(r, 50));
        initRenderer();

        ui.setLoading("Ánh sáng...", 0.2);
        lighting = new LightingSystem({ scene, timeScale: 1440 / 3600, initialMinutes: 390 });
        window.lighting = lighting;
        await new Promise(r => setTimeout(r, 50));

        ui.setLoading("Bản đồ...", 0.3);
        map = createMap({ scene, seed: 2026, lighting });
        await new Promise(r => setTimeout(r, 50));

        ui.setLoading("Xe của bạn...", 0.5);
        bus = createBus();

        try {
            interior = createBusInterior();
            if (!interior || !interior.isObject3D) {
                console.warn("Interior không hợp lệ");
                interior = new THREE.Group();
            }
        } catch (error) {
            console.error("Lỗi tạo interior:", error);
            interior = new THREE.Group();
        }

        bus.group.add(interior);
        // ===== FIX: GÁN INTERIOR REF CHO BUS ĐỂ LED BẬT/TẮT ĐỒNG BỘ =====
        if (bus.setInteriorReference && interior) {
            bus.setInteriorReference(interior);
        }

        scene.add(bus.group);

        // ================================================================
        // PLAYER SPAWN
        // ================================================================

        const spawn = map.getSpawnPoint();
        const parkingSlots = map.getParkingSlots ? map.getParkingSlots() : [];
        let playerSlot = null;

        if (parkingSlots.length > 0) {
            for (const slot of parkingSlots) {
                if (!slot.occupied) {
                    playerSlot = slot;
                    break;
                }
            }
            if (!playerSlot) {
                playerSlot = parkingSlots[0];
                bus.group.position.set(
                    playerSlot.position.x + 2,
                    0.5,
                    playerSlot.position.z + 2
                );
                bus.group.rotation.y = playerSlot.rotation || 0;
            } else {
                bus.group.position.set(
                    playerSlot.position.x,
                    0.5,
                    playerSlot.position.z
                );
                bus.group.rotation.y = playerSlot.rotation || 0;
            }
        } else {
            bus.group.position.set(spawn.x, spawn.y, spawn.z);
            bus.group.rotation.y = spawn.heading || 0;
        }

        await new Promise(r => setTimeout(r, 50));

        // ================================================================
        // CAMERA
        // ================================================================

        ui.setLoading("Camera...", 0.6);
        cameraSystem = new CameraSystem(camera, bus.group);
        cameraSystem.setMode("driver");
        await new Promise(r => setTimeout(r, 50));

        // ================================================================
        // NPC + TRAFFIC
        // ================================================================

        ui.setLoading("Traffic & NPC...", 0.7);
        await loadNpcSkinList();

        const playerSpawnPos = {
            x: bus.group.position.x,
            z: bus.group.position.z
        };

        npc = createNPC({
            scene,
            map,
            seed: 2027,
            playerBus: bus,
            playerSpawnPos
        });

        const roadGraph = roadDataSegments || [];
        trafficManager = createTrafficManager({
            scene,
            roadGraph,
            busSlots: map.getBusSlots ? map.getBusSlots() : [],
            playerRef: bus,
            maxVehicles: 10
        });
        await new Promise(r => setTimeout(r, 50));

        // ================================================================
        // PASSENGERS
        // ================================================================

        ui.setLoading("Hành khách...", 0.8);
        passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui });
        await new Promise(r => setTimeout(r, 50));

        // ================================================================
        // EVENTS
        // ================================================================

        initInput();
        setupMenuEvents();
        window.addEventListener("resize", onResize, { passive: true });

        ui.hideLoading();
        // FIX: gọi hideLoading dự phòng
        setTimeout(() => {
            if (ui && typeof ui.hideLoading === 'function') {
                ui.hideLoading();
            }
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
                loadingScreen.style.opacity = '0';
            }
        }, 500);

        setTimeout(() => showMainMenu(), 300);

        clock.start();
        renderer.setAnimationLoop(loop);

        console.log("✅ COACHVN boot completed");
    } catch (error) {
        console.error("❌ Lỗi khởi động:", error);
        alert("Game lỗi: " + error.message);
    }
}

// ============================================================================
// MENU EVENTS
// ============================================================================

function setupMenuEvents() {
    document.getElementById("btn-continue")?.addEventListener("click", () => {
        if (hasGameState()) {
            const save = loadGameState();
            if (save.ok && save.state.camera) {
                bus.group.position.set(save.state.camera.x, save.state.camera.y, save.state.camera.z);
            }
            startGame();
        }
    });

    document.getElementById("btn-new-game")?.addEventListener("click", () => {
        startGame();
    });

    document.getElementById("btn-load")?.addEventListener("click", () => {
        const save = loadGameState();
        if (save.ok) {
            ui.toast("✅ Đã load game");
            if (save.state.camera) {
                bus.group.position.set(save.state.camera.x, save.state.camera.y, save.state.camera.z);
            }
            startGame();
        } else {
            ui.toast("❌ Không có dữ liệu lưu");
        }
    });

    document.getElementById("btn-settings")?.addEventListener("click", () => {
        document.getElementById("settings-panel")?.classList.add("visible");
    });

    document.getElementById("btn-help")?.addEventListener("click", () => {
        ui.toast("📖 W: Ga | SHIFT+W: Tăng tốc | S: Phanh/Lùi | Space: Phanh | A/D: Lái | C: Camera | F: Đèn | K: Cửa | P: Bay | /: Console");
    });

    document.getElementById("btn-exit")?.addEventListener("click", () => {
        if (confirm("Bạn có chắc muốn thoát?")) {
            window.close();
            document.body.innerHTML = `
                        <div style="color:white;text-align:center;padding:50px;">
                            <h1>Cảm ơn đã chơi CoachVN!</h1>
                        </div>
                        `;
        }
    });

    document.getElementById("theme-toggle")?.addEventListener("click", () => {
        const body = document.body;
        if (body.classList.contains("light-mode")) {
            body.classList.remove("light-mode");
            gameSettings.theme = "dark";
        } else {
            body.classList.add("light-mode");
            gameSettings.theme = "light";
        }
    });

    document.getElementById("btn-close-settings")?.addEventListener("click", () => {
        document.getElementById("settings-panel")?.classList.remove("visible");
    });

    document.getElementById("btn-apply-settings")?.addEventListener("click", () => {
        applySettings();
        document.getElementById("settings-panel")?.classList.remove("visible");
        ui.toast("✅ Đã áp dụng cài đặt");
    });

    document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            document.querySelectorAll(".settings-content").forEach(c => c.classList.remove("active"));
            document.getElementById(`settings-${tab.dataset.tab}`)?.classList.add("active");
        });
    });

    document.querySelectorAll(".theme-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".theme-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const theme = btn.dataset.theme;
            gameSettings.theme = theme;
            if (theme === "light") {
                document.body.classList.add("light-mode");
            } else {
                document.body.classList.remove("light-mode");
            }
        });
    });

    const sliders = [
        { id: "cam-sensitivity", valueId: "cam-sens-value", key: "cameraSensitivity", suffix: "" },
        { id: "fov-slider", valueId: "fov-value", key: "fov", suffix: "°" },
        { id: "outside-distance", valueId: "outside-dist-value", key: "outsideDistance", suffix: "m" }
    ];

    sliders.forEach(({ id, valueId, key, suffix }) => {
        const slider = document.getElementById(id);
        const valueEl = document.getElementById(valueId);
        if (slider && valueEl) {
            slider.addEventListener("input", e => {
                const val = parseInt(e.target.value, 10);
                valueEl.textContent = val + suffix;
                gameSettings[key] = val;
            });
        }
    });

    document.getElementById("invert-x")?.addEventListener("change", e => {
        gameSettings.invertX = e.target.checked;
    });

    document.getElementById("invert-y")?.addEventListener("change", e => {
        gameSettings.invertY = e.target.checked;
    });

    document.getElementById("btn-resume")?.addEventListener("click", () => {
        if (gameState === "paused") {
            togglePause();
        }
    });

    document.getElementById("btn-restart")?.addEventListener("click", () => {
        vehiclePhysics.speed = 0;
        vehiclePhysics.currentSpeedKmh = 0;
        vehiclePhysics.isReversing = false;
        const spawn = map.getSpawnPoint();
        bus.group.position.set(spawn.x, spawn.y, spawn.z);
        bus.group.rotation.y = spawn.heading || 0;
        cameraSystem.setMode("driver");
        gameState = "playing";
        paused = false;
        const pauseMenu = document.getElementById("pause-menu");
        if (pauseMenu) {
            pauseMenu.classList.remove("visible");
            pauseMenu.style.display = "none";
        }
        ui.toast("🔄 Đã restart game");
    });

    document.getElementById("btn-save")?.addEventListener("click", () => {
        const state = {
            camera: {
                x: bus.group.position.x,
                y: bus.group.position.y,
                z: bus.group.position.z
            },
            clock: {
                minutes: lighting.getGameTime(),
                day: 1
            },
            gameState: {
                money: 500000,
                fuel: 0.8,
                passengers: 0,
                passengerCapacity: 24
            }
        };
        const result = saveGameState(state);
        ui.toast(result.ok ? "✅ Đã lưu game" : "❌ Lỗi khi lưu");
    });

    document.getElementById("btn-main-menu")?.addEventListener("click", () => {
        showMainMenu();
    });

    const rtToggle = document.getElementById("ray-tracing-toggle");
    if (rtToggle) {
        rtToggle.addEventListener("change", e => {
            const enabled = e.target.checked;
            window.lighting?.setRayTracingEnabled(enabled);
            try {
                localStorage.setItem("coachvn_raytracing", enabled ? "1" : "0");
            } catch (_) { }
        });

        try {
            const saved = localStorage.getItem("coachvn_raytracing");
            if (saved === "1") {
                rtToggle.checked = true;
                window.lighting?.setRayTracingEnabled(true);
            }
        } catch (_) { }
    }
}

// ============================================================================
// SETTINGS
// ============================================================================

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
// FLY MODE
// ============================================================================

function updateFlyMode(delta) {
    if (!camera) return;
    const flySpeed = 20 * delta;
    if (keysPressed.has("KeyW")) camera.translateZ(-flySpeed);
    if (keysPressed.has("KeyS")) camera.translateZ(flySpeed);
    if (keysPressed.has("KeyA")) camera.translateX(-flySpeed);
    if (keysPressed.has("KeyD")) camera.translateX(flySpeed);
    if (keysPressed.has("Space")) camera.position.y += flySpeed;
    if (keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight")) {
        camera.position.y -= flySpeed;
    }
}

// ============================================================================
// WORLD SYSTEMS
// ============================================================================

function updateWorld(delta, nowSeconds) {
    if (!lighting) return;
    lighting.update(delta);

    if (flyMode) {
        updateFlyMode(delta);
        return;
    }

    updateVehiclePhysics(delta);
    cameraSystem?.update(delta);

    if (bus?.group && map) {
        map.setPlayerPosition(bus.group.position.x, bus.group.position.z);
    }

    // NPC
    npcTimer += delta;
    const npcInterval = lowPerformanceMode
        ? PERFORMANCE.npcLowFPSInterval
        : PERFORMANCE.npcNormalInterval;
    if (npc && npcTimer >= npcInterval) {
        npcTimer = 0;
        npc.update(delta, nowSeconds);
    }

    // TRAFFIC
    trafficTimer += delta;
    const trafficInterval = lowPerformanceMode
        ? PERFORMANCE.trafficLowFPSInterval
        : PERFORMANCE.trafficNormalInterval;
    if (trafficManager && trafficTimer >= trafficInterval) {
        const trafficDelta = trafficTimer;
        trafficTimer = 0;
        trafficManager.update(trafficDelta, {
            x: bus.group.position.x,
            z: bus.group.position.z
        });
    }

    // PASSENGERS
    passengerTimer += delta;
    const passengerInterval = lowPerformanceMode
        ? PERFORMANCE.passengerLowFPSInterval
        : PERFORMANCE.passengerNormalInterval;
    if (passengerSystem && passengerTimer >= passengerInterval) {
        const passengerDelta = passengerTimer;
        passengerTimer = 0;
        passengerSystem.update(passengerDelta);
    }
}

// ============================================================================
// HUD
// ============================================================================

function updateHUD(delta) {
    hudTimer += delta;
    if (hudTimer < PERFORMANCE.hudInterval) return;
    hudTimer = 0;

    if (
        gameState !== "playing" ||
        !bus ||
        !passengerSystem ||
        !cameraSystem ||
        !lighting
    ) return;

    ui.update({
        fps: fpsAverage.value,
        speedKmh: vehiclePhysics.currentSpeedKmh,
        fuel: 0.8,
        money: 500000,
        passengers: passengerSystem.onboardPassengers.length,
        passengerCapacity: 24,
        timeMinutes: lighting.getGameTime(),
        day: 1,
        x: bus.group.position.x,
        z: bus.group.position.z,
        heading: bus.group.rotation.y,
        areaName: "Quốc lộ 1A",
        routeHint: "Hướng về Sài Gòn",
        cameraMode: cameraSystem.getCurrentModeName()
    });
}

// ============================================================================
// MAIN LOOP
// ============================================================================

let smoothDelta = 1 / 60;
const SMOOTH_FACTOR = 0.10;

function loop() {
    const rawDelta = Math.min(clock.getDelta(), 0.1);
    smoothDelta += (rawDelta - smoothDelta) * SMOOTH_FACTOR;
    const delta = Math.max(0.001, Math.min(0.05, smoothDelta));
    const nowSeconds = performance.now() / 1000;

    fpsAverage.add(1 / Math.max(rawDelta, 0.001));

    updateAdaptivePerformance(delta);

    if (gameState === "playing" && !paused) {
        updateWorld(delta, nowSeconds);
    }

    renderer.render(scene, camera);
    updateHUD(delta);
}

// ============================================================================
// RESIZE
// ============================================================================

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