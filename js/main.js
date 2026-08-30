// js/main.js - COACHVN v14.0 FULL INTEGRATED
// ============================================================================
// IMPORTS (KHÔNG TRÙNG LẶP)
// ============================================================================

import * as THREE from "three";

// === UTILITIES ===
import { clamp, createMovingAverage } from "./utils.js";

// === MAP & ROAD SYSTEM ===
import { createMap } from "./map.js";
import { roadDataSegments } from "./map/data/roadData.js";
import { getRouteNodes, getNode } from "./map/data/roadNetworkData.js";

// === UI & HUD ===
import { createUI } from "./ui.js";
import { HUDSystem } from "./hud.js";        // ← CHỈ MỘT LẦN!

// === VEHICLE SYSTEMS ===
import { createBus, loadNpcSkinList } from "./bus.js";
import { createBusInterior } from "./interior.js";
import { CameraSystem } from "./camera.js";
import { LightingSystem } from "./lighting.js";
import { SteeringSystem } from "./steering.js";

// === NPC & TRAFFIC ===
import { createNPC } from "./npc.js";
import { TrafficManager } from "./traffic/TrafficManager.js";

// === GAMEPLAY SYSTEMS ===
import { createPassengerSystem } from "./passenger.js";
import { CollisionSystem } from "./collision.js";
import { MinimapSystem } from "./minimap.js";

// === SAVE SYSTEM ===
import { saveGameState, loadGameState, hasGameState } from "./save.js";

// ============================================================================
// VERSION & LOGGING
// ============================================================================

const MAIN_VERSION = 14.0;
console.log(
    `%c🚌 COACHVN v${MAIN_VERSION} - FULL INTEGRATED`,
    "color:#00ff99;font-weight:bold;font-size:14px"
);

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

// Core
let renderer = null;
let scene = null;
let camera = null;
let canvas = document.getElementById("game-canvas");

// Systems
let map = null;
let lighting = null;
let npc = null;
let bus = null;
let interior = null;
let passengerSystem = null;
let trafficManager = null;
let ui = null;
let cameraSystem = null;
let steeringSystem = null;
let collisionSystem = null;
let minimapSystem = null;
let hudSystem = null;

// Timing
const clock = new THREE.Clock();

// FPS tracking
const fpsAverage = createMovingAverage(30);
const fpsCounter = {
    frameCount: 0,
    lastTime: performance.now(),
    currentFPS: 0
};

// Game state
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
// VEHICLE PHYSICS CONFIG
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
// GAME DATA
// ============================================================================

let gameData = {
    money: 500000,
    fuel: 1.0,
    fuelCapacity: 200,        // Lít
    fuelPrice: 30000,         // VND/lít
    passengers: 0,
    passengerCapacity: 24,
    totalEarned: 0,
    currentLocation: "Bến xe Phú Yên",
    destination: "Sài Gòn",
    nextStop: "Trạm Đại Lãnh",
    nextStopDistance: 2.4,    // km
    gameTime: 360,            // Minutes (6:00 AM)
    day: 1
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
// STEERING SYSTEM INIT
// ============================================================================

function initSteering() {
    if (steeringSystem) return;
    
    steeringSystem = new SteeringSystem({
        wheelbase: 6.5,
        trackWidth: 2.05,
        maxSteerAngle: 0.55,
        steeringSpeed: 2.8,
        steeringReturn: 4.5,
        steeringDamping: 0.85,
        lowSpeedSteerFactor: 1.0,
        highSpeedSteerFactor: 0.25,
        highSpeedThreshold: 25.0,
        slipAngle: 0.08,
        centrifugalFactor: 0.15,
        maxLateralAccel: 4.5,
        brakeSteerReduction: 0.7,
        reverseSteerFactor: 0.8,
        straightLineDamping: 0.02,
        wobbleThreshold: 0.005
    });
    
    if (bus?.group) {
        const pos = bus.group.position;
        steeringSystem.setPose(pos.x, pos.z, bus.group.rotation.y);
    }
}

// ============================================================================
// VEHICLE PHYSICS UPDATE (ACKERMANN STEERING)
// ============================================================================

function updateVehiclePhysics(deltaTime) {
    if (!bus?.group) return;
    if (!steeringSystem) initSteering();
    
    const phys = vehiclePhysics;
    const dt = deltaTime;
    
    // Input
    let steerInput = 0;
    if (keysPressed.has("KeyA")) steerInput += 1;
    if (keysPressed.has("KeyD")) steerInput -= 1;
    
    const isBraking = keysPressed.has("KeyS") || keysPressed.has("Space");
    
    // Speed update
    if (keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight")) {
        if (keysPressed.has("KeyW")) {
            phys.speed += phys.shiftAcceleration * dt;
            phys.speed = Math.min(phys.speed, phys.maxSpeed);
            phys.isReversing = false;
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
    
    // Fuel consumption
    if (Math.abs(phys.speed) > 0.1) {
        const fuelConsumptionRate = 0.0001 * (Math.abs(phys.currentSpeedKmh) / 80);
        gameData.fuel = Math.max(0, gameData.fuel - fuelConsumptionRate);
    }
    
    // Steering update
    const steerResult = steeringSystem.update(dt, phys.speed, steerInput, isBraking);
    
    // Apply to bus
    bus.group.position.x = steerResult.position.x;
    bus.group.position.z = steerResult.position.z;
    bus.group.rotation.y = steerResult.heading;
    
    // Wheel animation
    if (bus.wheels && Array.isArray(bus.wheels)) {
        for (let i = 0; i < bus.wheels.length; i++) {
            const wheel = bus.wheels[i];
            if (wheel) {
                if (i < 2) {
                    const isLeft = i === 0;
                    wheel.rotation.y = isLeft
                        ? steeringSystem.getInnerWheelAngle()
                        : steeringSystem.getOuterWheelAngle();
                }
                wheel.rotation.x = steeringSystem.wheelRotation;
            }
        }
    }
    
    // Camera shake khi cua gấp
    if (Math.abs(steerResult.angularVelocity) > 0.5 && Math.abs(phys.speed) > 10) {
        if (cameraSystem?.addShake) {
            cameraSystem.addShake(0.01);
        }
    }
    
    return steerResult;
}

// ============================================================================
// INPUT SYSTEM
// ============================================================================

function initInput() {
    window.addEventListener(
        "keydown",
        (e) => {
            // Console toggle
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
            
            if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
                e.preventDefault();
            }
            
            // Headlights - F
            if (e.code === "KeyF") {
                const now = performance.now();
                if (now - lastFPressTime > 150 && bus) {
                    lastFPressTime = now;
                    const currentLight = bus.areLightsOn || false;
                    bus.setHeadlights?.(!currentLight);
                    bus.setTaillights?.(!currentLight);
                    bus.areLightsOn = !currentLight;
                    hudSystem?.toast(bus.areLightsOn ? "💡 Bật đèn" : "💡 Tắt đèn");
                }
            }
            
            // Door - K
            if (e.code === "KeyK" && bus) {
                if (bus.setDoor) {
                    const isOpen = !bus.doorOpen;
                    bus.setDoor(isOpen ? 1 : 0);
                    bus.doorOpen = isOpen;
                    hudSystem?.toast(isOpen ? "🚪 Mở cửa" : "🚪 Đóng cửa");
                }
            }
            
            // Interior LED - L
            if (e.code === "KeyL" && bus) {
                if (bus.setInteriorLed) {
                    const isOn = !bus.interiorLedOn;
                    bus.setInteriorLed(isOn);
                    bus.interiorLedOn = isOn;
                    hudSystem?.toast(isOn ? "💡 LED ON" : "💡 LED OFF");
                }
            }
            
            // Horn - H
            if (e.code === "KeyH") {
                const now = performance.now();
                if (now - lastHornPressTime > 300) {
                    lastHornPressTime = now;
                    hudSystem?.toast("📯 Bim bim!");
                }
            }
            
            // Camera - C
            if (e.code === "KeyC") {
                const now = performance.now();
                if (now - lastCameraPressTime > 200 && cameraSystem) {
                    lastCameraPressTime = now;
                    cameraSystem.cycleNext();
                    hudSystem?.toast(`📷 ${cameraSystem.getCurrentModeName()}`);
                }
            }
            
            // Fly mode - P
            if (e.code === "KeyP") {
                flyMode = !flyMode;
                hudSystem?.toast(flyMode ? "✈️ Fly mode ON" : "✈️ Fly mode OFF");
            }
            
            // Pause - ESC
            if (e.code === "Escape") {
                togglePause();
            }
        },
        { passive: false }
    );
    
    window.addEventListener("keyup", (e) => {
        keysPressed.delete(e.code);
    });
    
    window.addEventListener("blur", () => {
        keysPressed.clear();
    });
}

// ============================================================================
// CONSOLE
// ============================================================================

function toggleConsole() {
    let consoleEl = document.getElementById("command-console");
    if (!consoleEl) {
        consoleEl = document.createElement("div");
        consoleEl.id = "command-console";
        consoleEl.innerHTML = `
            <div style="padding:8px;border-bottom:1px solid #333;display:flex;justify-content:space-between;">
                <span>DEBUG CONSOLE</span>
                <button id="btn-close-console" style="background:none;border:none;color:#00ff00;cursor:pointer;">✕</button>
            </div>
            <div id="console-output" style="height:300px;overflow-y:auto;padding:8px;"></div>
            <input type="text" id="command-input" placeholder="Enter command..." 
                style="width:100%;padding:8px;background:#111;border:none;color:#00ff00;font-family:monospace;" />
        `;
        consoleEl.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 500px; max-width: 90vw; background: rgba(0,0,0,0.95);
            border: 1px solid #333; border-radius: 8px; z-index: 10000;
            font-family: monospace; color: #00ff00; display: none;
        `;
        document.body.appendChild(consoleEl);
        
        const input = consoleEl.querySelector("#command-input");
        const closeBtn = consoleEl.querySelector("#btn-close-console");
        
        closeBtn.addEventListener("click", () => {
            consoleOpen = false;
            consoleEl.style.display = "none";
        });
        
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const cmd = input.value.trim();
                if (cmd) {
                    executeCommand(cmd);
                    input.value = "";
                }
            }
            e.stopPropagation();
        });
    }
    
    consoleEl.style.display = consoleOpen ? "block" : "none";
    if (consoleOpen) {
        const input = consoleEl.querySelector("#command-input");
        if (input) input.focus();
    }
}

function executeCommand(cmd) {
    const [command, ...args] = cmd.toLowerCase().split(" ");
    
    switch (command) {
        case "help":
            appendToConsole("Commands: help, fps, pos, speed, money, fuel, tp [x] [z], fly, debug, traffic, passenger");
            break;
        case "fps":
            appendToConsole(`FPS: ${getCurrentFPS().toFixed(1)}`);
            break;
        case "pos":
            if (bus?.group) {
                appendToConsole(`Position: X=${bus.group.position.x.toFixed(2)}, Z=${bus.group.position.z.toFixed(2)}`);
            }
            break;
        case "speed":
            appendToConsole(`Speed: ${vehiclePhysics.currentSpeedKmh.toFixed(1)} km/h`);
            break;
        case "money":
            appendToConsole(`Money: ${gameData.money.toLocaleString('vi-VN')} ₫`);
            break;
        case "fuel":
            appendToConsole(`Fuel: ${(gameData.fuel * 100).toFixed(1)}%`);
            break;
        case "tp":
            if (args.length >= 2 && bus?.group) {
                const x = parseFloat(args[0]);
                const z = parseFloat(args[1]);
                if (!isNaN(x) && !isNaN(z)) {
                    bus.group.position.set(x, 0.5, z);
                    if (steeringSystem) {
                        steeringSystem.setPose(x, z, bus.group.rotation.y);
                    }
                    appendToConsole(`Teleported to: ${x}, ${z}`);
                }
            }
            break;
        case "fly":
            flyMode = !flyMode;
            appendToConsole(`Fly mode: ${flyMode ? "ON" : "OFF"}`);
            break;
        case "debug":
            window.STEERING_DEBUG = !window.STEERING_DEBUG;
            appendToConsole(`Steering debug: ${window.STEERING_DEBUG ? "ON" : "OFF"}`);
            break;
        case "traffic":
            if (trafficManager?.getDebugInfo) {
                appendToConsole(JSON.stringify(trafficManager.getDebugInfo(), null, 2));
            }
            break;
        case "passenger":
            if (passengerSystem?.getDebugInfo) {
                appendToConsole(JSON.stringify(passengerSystem.getDebugInfo(), null, 2));
            }
            break;
        default:
            appendToConsole(`Unknown command: ${command}`);
    }
}

function appendToConsole(text) {
    const output = document.getElementById("console-output");
    if (!output) return;
    
    output.innerHTML += `<div>&gt; ${text}</div>`;
    output.scrollTop = output.scrollHeight;
}

// ============================================================================
// PAUSE SYSTEM
// ============================================================================

function togglePause() {
    if (gameState === "playing") {
        paused = !paused;
        const pauseMenu = document.getElementById("pause-menu");
        if (pauseMenu) {
            pauseMenu.classList.toggle("visible", paused);
        }
        if (paused) {
            keysPressed.clear();
        }
    }
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

function getCurrentFPS() {
    return fpsCounter.currentFPS;
}

function updatePerformance(deltaTime) {
    // Update FPS counter
    fpsCounter.frameCount++;
    const now = performance.now();
    
    if (now - fpsCounter.lastTime >= 1000) {
        fpsCounter.currentFPS = fpsCounter.frameCount * 1000 / (now - fpsCounter.lastTime);
        fpsCounter.frameCount = 0;
        fpsCounter.lastTime = now;
        
        if (fpsAverage && typeof fpsAverage.add === "function") {
            fpsAverage.add(fpsCounter.currentFPS);
        }
    }
    
    // Performance monitoring
    performanceTimer += deltaTime;
    if (performanceTimer >= PERFORMANCE.sampleTime) {
        const avgFPS = getCurrentFPS();
        
        if (avgFPS < PERFORMANCE.targetFPS * 0.7) {
            renderScale = Math.max(PERFORMANCE.minRenderScale, renderScale - 0.05);
            lowPerformanceMode = true;
        } else if (avgFPS > PERFORMANCE.targetFPS * 0.95) {
            renderScale = Math.min(PERFORMANCE.maxRenderScale, renderScale + 0.005);
            lowPerformanceMode = false;
        }
        
        if (renderer) {
            renderer.setPixelRatio(
                Math.min(window.devicePixelRatio, PERFORMANCE.maxPixelRatio) * renderScale
            );
        }
        
        performanceTimer = 0;
    }
}

// js/main.js - CHỈ SỬA PHẦN INIT (phần khác giữ nguyên)

async function init() {
    console.log("🚀 Initializing CoachVN...");
    
    try {
        // ===== 1. RENDERER =====
        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: false,
            powerPreference: "low-power"
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERFORMANCE.maxPixelRatio));
        renderer.shadowMap.enabled = false;
        renderer.sortObjects = true; // Interior cần sort đúng
        
        // ===== 2. SCENE =====
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 100, 800);
        
        // ===== 3. CAMERA =====
        camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        camera.position.set(0, 10, 20);
        
        // ===== 4. LIGHTING =====
        lighting = new LightingSystem(scene);
        lighting.setQuality("low");
        console.log("✅ Lighting initialized");
        
        // ===== 5. MAP =====
        ui?.updateLoadingProgress?.(15, "Đang tạo bản đồ...");
        map = createMap({ scene, seed: 20260817, lighting });
        console.log("✅ Map initialized");
        
        // ===== 6. PLAYER BUS =====
        ui?.updateLoadingProgress?.(30, "Đang tạo xe...");
        const spawnPoint = map.getSpawnPoint();
        
        bus = createBus({
            skinPath: null,  // null → dùng BUS_TEXTURE_URL mặc định
            ledColor: 0x00aaff
        });
        
        if (!bus?.group) {
            throw new Error("Failed to create player bus!");
        }
        
        bus.group.position.set(spawnPoint.x, 0.5, spawnPoint.z);
        bus.group.rotation.y = spawnPoint.heading || 0;
        scene.add(bus.group);
        console.log("✅ Player bus created");
        
        // ===== 7. INTERIOR (SAU BUS, TRƯỚC NPC) =====
        ui?.updateLoadingProgress?.(40, "Đang tạo nội thất...");
        try {
            interior = createBusInterior(bus.group);
            
            if (interior?.group) {
                // Verify đã add thành công
                const hasInterior = bus.group.children.includes(interior.group);
                console.log("✅ Interior initialized:", {
                    added: hasInterior,
                    parts: interior.group.children.length,
                    visible: interior.group.visible
                });
            }
        } catch (e) {
            console.error("❌ Interior failed:", e);
        }
        
        // ===== 8. STEERING =====
        initSteering();
        steeringSystem.setPose(spawnPoint.x, spawnPoint.z, spawnPoint.heading || 0);
        
        // ===== 9. LOAD NPC SKINS (TRƯỚC TRAFFIC!) =====
        ui?.updateLoadingProgress?.(50, "Đang tải skins...");
        try {
            await loadNpcSkinList();
            console.log("✅ NPC skins loaded");
        } catch (e) {
            console.warn("⚠️ NPC skins failed, using fallback:", e.message);
        }
        
        // ===== 10. NPC =====
        ui?.updateLoadingProgress?.(60, "Đang tạo NPC...");
        try {
            npc = createNPC({
                scene,
                map,
                seed: 2027,
                playerBus: bus.group,
                playerSpawnPos: { x: spawnPoint.x, z: spawnPoint.z }
            });
        } catch (e) {
            console.warn("⚠️ NPC init failed:", e.message);
        }
        
        // ===== 11. TRAFFIC =====
        ui?.updateLoadingProgress?.(70, "Đang tạo giao thông...");
        try {
            trafficManager = new TrafficManager({
                scene,
                roadGraph: roadDataSegments,
                busSlots: map.getBusSlots?.() || [],
                playerRef: bus.group,
                maxVehicles: 30
            });
        } catch (e) {
            console.warn("⚠️ Traffic init failed:", e.message);
        }
        
        // ... rest of init (passengers, camera, collision, minimap, hud, input) ...
        
    } catch (error) {
        console.error("❌ CRITICAL INIT ERROR:", error);
        throw error;
    }
}

// ============================================================================
// COLLISION HANDLER
// ============================================================================

function handleCollision(collisionInfo) {
    if (!collisionInfo) return;
    
    const { type, intensity, position } = collisionInfo;
    
    if (type === "traffic") {
        vehiclePhysics.speed *= (1 - intensity * 0.8);
    } else if (type === "environment") {
        vehiclePhysics.speed *= (1 - intensity * 0.5);
    }
    
    if (cameraSystem?.addShake) {
        cameraSystem.addShake(intensity * 0.1);
    }
    
    if (hudSystem?.toast) {
        hudSystem.toast(`💥 Va chạm! (${(intensity * 100).toFixed(0)}%)`, 'error');
    }
}

// ============================================================================
// WINDOW RESIZE
// ============================================================================

function onWindowResize() {
    if (!renderer || !camera) return;
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

// ============================================================================
// SAVE/LOAD
// ============================================================================

function saveGame() {
    const saveData = {
        version: 2,
        camera: {
            x: bus?.group?.position.x || 0,
            y: bus?.group?.position.y || 0.5,
            z: bus?.group?.position.z || 0,
            yaw: bus?.group?.rotation.y || 0,
            pitch: 0
        },
        clock: { 
            minutes: gameData.gameTime, 
            day: gameData.day 
        },
        gameState: {
            money: gameData.money,
            fuel: gameData.fuel,
            passengers: passengerSystem?.getOnboardCount?.() || 0,
            passengerCapacity: gameData.passengerCapacity,
            totalEarned: gameData.totalEarned,
            currentLocation: gameData.currentLocation,
            destination: gameData.destination
        }
    };
    
    const result = saveGameState(saveData);
    if (result.ok) {
        hudSystem?.toast("💾 Đã lưu game!", 'success');
    } else {
        hudSystem?.toast("❌ Lỗi khi lưu game!", 'error');
    }
}

function loadGame() {
    const result = loadGameState();
    if (result.ok && result.state) {
        const state = result.state;
        
        // Apply camera position
        if (bus?.group && state.camera) {
            bus.group.position.set(state.camera.x, state.camera.y, state.camera.z);
            bus.group.rotation.y = state.camera.yaw || 0;
            
            if (steeringSystem) {
                steeringSystem.setPose(state.camera.x, state.camera.z, state.camera.yaw || 0);
            }
        }
        
        // Apply game data
        if (state.gameState) {
            gameData.money = state.gameState.money || 500000;
            gameData.fuel = state.gameState.fuel || 1.0;
            gameData.totalEarned = state.gameState.totalEarned || 0;
            gameData.currentLocation = state.gameState.currentLocation || "Bến xe Phú Yên";
        }
        
        hudSystem?.toast("📂 Đã load game!", 'success');
        return true;
    }
    return false;
}

// ============================================================================
// GAME LOOP
// ============================================================================

function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = clock.getDelta();
    const currentTime = clock.elapsedTime;
    
    // FPS
    updatePerformance(deltaTime);
    
    // Skip if paused
    if (paused || gameState !== "playing") {
        renderer?.render(scene, camera);
        return;
    }
    
    // Update game time
    gameData.gameTime += deltaTime * (1 / 60); // 1 real second = 1 game minute
    
    // Update vehicle
    updateVehiclePhysics(deltaTime);
    
    // Update camera
    if (cameraSystem) {
        cameraSystem.update(deltaTime);
    }
    
    // Fly mode
    if (flyMode && camera) {
        const flySpeed = 20;
        if (keysPressed.has("KeyW")) camera.position.z -= flySpeed * deltaTime;
        if (keysPressed.has("KeyS")) camera.position.z += flySpeed * deltaTime;
        if (keysPressed.has("KeyA")) camera.position.x -= flySpeed * deltaTime;
        if (keysPressed.has("KeyD")) camera.position.x += flySpeed * deltaTime;
        if (keysPressed.has("KeyQ")) camera.position.y -= flySpeed * deltaTime;
        if (keysPressed.has("KeyE")) camera.position.y += flySpeed * deltaTime;
    }
    
    // Update map
    if (map && bus?.group) {
        const pos = bus.group.position;
        map.setPlayerPosition?.(pos.x, pos.z);
    }
    
    // Update NPC (throttled)
    npcTimer += deltaTime;
    const npcInterval = lowPerformanceMode 
        ? PERFORMANCE.npcLowFPSInterval 
        : PERFORMANCE.npcNormalInterval;
    
    if (npcTimer >= npcInterval && npc) {
        npc.update(deltaTime, currentTime);
        npcTimer = 0;
    }
    
    // Update traffic (throttled)
    trafficTimer += deltaTime;
    const trafficInterval = lowPerformanceMode 
        ? PERFORMANCE.trafficLowFPSInterval 
        : PERFORMANCE.trafficNormalInterval;
    
    if (trafficTimer >= trafficInterval && trafficManager) {
        const playerPos = bus?.group?.position;
        if (playerPos) {
            trafficManager.update(deltaTime, playerPos);
        }
        trafficTimer = 0;
    }
    
    // Update passengers (throttled)
    passengerTimer += deltaTime;
    const passengerInterval = lowPerformanceMode 
        ? PERFORMANCE.passengerLowFPSInterval 
        : PERFORMANCE.passengerNormalInterval;
    
    if (passengerTimer >= passengerInterval && passengerSystem) {
        const busPos = bus?.group?.position;
        const busHeading = bus?.group?.rotation.y || 0;
        if (busPos) {
            passengerSystem.updatePassengers(busPos, busHeading);
        }
        passengerTimer = 0;
    }
    
    // Update collision
    if (collisionSystem && bus?.group) {
        collisionSystem.update(deltaTime, bus.group.position);
    }
    
    // Update lighting
    if (lighting) {
        lighting.update(deltaTime, currentTime);
    }
    
    // Update minimap
    if (minimapSystem && bus?.group) {
        minimapSystem.update(deltaTime, bus.group.position, bus.group.rotation.y);
    }
    
    // Update HUD (throttled)
    hudTimer += deltaTime;
    if (hudTimer >= PERFORMANCE.hudInterval) {
        updateHUD();
        hudTimer = 0;
    }
    
    // Render
    renderer.render(scene, camera);
}

// ============================================================================
// HUD UPDATE
// ============================================================================

function updateHUD() {
    const speed = vehiclePhysics.currentSpeedKmh;
    const pos = bus?.group?.position;
    
    // Calculate next stop distance (simplified)
    const nextStopDistance = calculateNextStopDistance(pos);
    
    const hudData = {
        speed: Math.abs(speed),
        gear: speed > 0.5 ? "D" : (speed < -0.5 ? "R" : "N"),
        fuel: gameData.fuel,
        doorOpen: bus?.doorOpen || false,
        money: gameData.money + (passengerSystem?.getTotalEarned?.() || 0),
        passengers: passengerSystem?.getOnboardCount?.() || 0,
        passengerCapacity: gameData.passengerCapacity,
        time: formatGameTime(gameData.gameTime),
        currentLocation: gameData.currentLocation,
        nextStop: gameData.nextStop,
        nextStopDistance: nextStopDistance,
        destination: gameData.destination
    };
    
    if (hudSystem) {
        hudSystem.update(hudTimer, hudData);
    }
}

function calculateNextStopDistance(pos) {
    // Simplified distance calculation
    // In real implementation, would calculate from route data
    if (!pos) return 0;
    
    // Get next stop node position and calculate distance
    const nextStopNode = getNode('dai_lanh_stop');
    if (nextStopNode) {
        const dx = nextStopNode.position.x - pos.x;
        const dz = nextStopNode.position.z - pos.z;
        const distanceKm = Math.hypot(dx, dz) / 1000; // Assume 1000 units = 1km
        return distanceKm;
    }
    
    return 0;
}

function formatGameTime(minutes) {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// ============================================================================
// UI CALLBACKS
// ============================================================================

function setupUICallbacks() {
    if (!ui) return;
    
    ui.onNewGame = () => {
        const mainMenu = document.getElementById("main-menu");
        if (mainMenu) mainMenu.classList.remove("visible");
        gameState = "playing";
        hudSystem?.toast("🚌 Bắt đầu chuyến mới!", 'success');
    };
    
    ui.onContinue = () => {
        if (loadGame()) {
            const mainMenu = document.getElementById("main-menu");
            if (mainMenu) mainMenu.classList.remove("visible");
            gameState = "playing";
        }
    };
    
    ui.onSave = () => saveGame();
    ui.onLoad = () => loadGame();
    
    ui.onResume = () => {
        paused = false;
        const pauseMenu = document.getElementById("pause-menu");
        if (pauseMenu) pauseMenu.classList.remove("visible");
    };
    
    ui.onMainMenu = () => {
        paused = false;
        gameState = "menu";
        const pauseMenu = document.getElementById("pause-menu");
        const mainMenu = document.getElementById("main-menu");
        if (pauseMenu) pauseMenu.classList.remove("visible");
        if (mainMenu) mainMenu.classList.add("visible");
    };
}

// ============================================================================
// START
// ============================================================================

// Create UI first
ui = createUI({ map: null, callbacks: {} });
setupUICallbacks();

// Initialize game
init().catch(error => {
    console.error("❌ FATAL: Failed to initialize CoachVN:", error);
});

// Debug export
window.COACHVN = {
    version: MAIN_VERSION,
    get gameState() { return gameState; },
    get vehiclePhysics() { return vehiclePhysics; },
    get gameData() { return gameData; },
    get steeringSystem() { return steeringSystem; },
    get collisionSystem() { return collisionSystem; },
    get bus() { return bus; },
    get map() { return map; },
    get trafficManager() { return trafficManager; },
    get passengerSystem() { return passengerSystem; },
    get minimapSystem() { return minimapSystem; },
    get hudSystem() { return hudSystem; },
    getCurrentFPS,
    saveGame,
    loadGame,
    togglePause
};