// js/main.js - ULTRA STABLE & STATION TRAFFIC INIT
import * as THREE from "three";
import { createMovingAverage, formatTime } from "./utils.js";
import { createMap } from "./map.js";
import { createUI } from "./ui.js";
import { createNPC } from "./npc.js";
import { createBus, loadNpcSkinList } from "./bus.js";
import { createBusInterior } from "./interior.js";
import { CameraSystem } from "./camera.js";
import { LightingSystem } from "./lighting.js";
import { createPassengerSystem } from "./passenger.js";
import { createTrafficManager } from "./traffic/TrafficManager.js";
import { roadNetwork, getNode } from "./map/data/roadNetworkData.js";
import { initEndermanEasterEgg, updateEnderman } from "./enderman.js";
import { CollisionSystem } from "./collisionSystem.js";

let renderer, scene, camera, canvas, map, lighting, npc, bus, interior, passengerSystem, trafficManager, ui, cameraSystem;
const clock = new THREE.Clock();
let gameState = "menu", paused = false;
let doorProgress = 0, doorTarget = 0;
let playerColId = -1;
let lastTime = performance.now();
let lastCameraProbeTime = 0;
let webglLost = false;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4;
let gameSettings = { graphics: 'low', renderDist: 1, npcDensity: 10, camSens: 30, fov: 70 };
let mobileInput = { steer: 0, accel: 0, brake: 0 };

const vehiclePhysics = {
    speed: 0, maxSpeedKmh: 160, maxSpeed: 160 * 0.28, maxReverseSpeed: -40 * 0.28,
    acceleration: 10.0 * 0.28, braking: 25.0 * 0.28, drag: 1.2 * 0.28,
    currentSpeedKmh: 0, isReversing: false, forwardVector: new THREE.Vector3()
};
let steerAngle = 0, steerTarget = 0;
const keysPressed = new Set();
let isConsoleOpen = false;
let lastFPressTime = 0, lastCameraPressTime = 0, lastHornPressTime = 0;
let lKeyTimer = 0;

function updateVehiclePhysics(dt) {
    if (!bus?.group) return;
    const phys = vehiclePhysics;
    const isAccel = keysPressed.has("KeyW") || mobileInput.accel > 0;
    const isBrake = keysPressed.has("KeyS") || mobileInput.brake > 0;
    const isShift = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight");

    if (isShift && isAccel) {
        phys.speed += phys.acceleration * dt; phys.speed = Math.min(phys.speed, phys.maxSpeed); phys.isReversing = false;
    } else if (isAccel && !isShift) {
        if (phys.speed < 0) { phys.speed += phys.braking * dt; if (phys.speed > 0) phys.speed = 0; }
        else if (phys.speed === 0) { phys.speed += phys.acceleration * dt; phys.speed = Math.min(phys.speed, 20 * 0.28); }
    } else if (isBrake) {
        if (phys.speed > 0) { phys.speed -= phys.braking * dt; if (phys.speed < 0) phys.speed = 0; }
        else { phys.isReversing = true; phys.speed -= phys.acceleration * dt; phys.speed = Math.max(phys.speed, phys.maxReverseSpeed); }
    } else if (keysPressed.has("Space")) { phys.speed = 0; }
    else { phys.speed = phys.speed > 0 ? Math.max(phys.speed - phys.drag * dt, 0) : Math.min(phys.speed + phys.drag * dt, 0); }

    phys.currentSpeedKmh = phys.speed / 0.28;
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
            if (hit) { canMove = false; phys.speed = 0; if (hit.type === 'npc' && hit.data?.ai) hit.data.ai.speed = 0; }
        }
        if (canMove) { bus.group.position.x = newX; bus.group.position.y += forward.y * moveDistance; bus.group.position.z = newZ; }
    }
    if (window.collisionSystem) window.collisionSystem.update(playerColId, bus.group.position.x, bus.group.position.z);
    bus.group.updateMatrixWorld(true);
}

function initInput() {
    window.addEventListener("keydown", (e) => {
        if (e.key === "/" && !isConsoleOpen) { e.preventDefault(); isConsoleOpen = true; keysPressed.clear(); ui.showConsole(); return; }
        if (isConsoleOpen) {
            if (e.code === "Enter") { const cmd = ui.els.consoleInput.value.trim(); handleCommand(cmd); }
            else if (e.code === "Escape") { isConsoleOpen = false; ui.hideConsole(); }
            return;
        }
        if (e.code === "Escape") { togglePause(); return; }
        if (gameState !== "playing" || paused) return;
        keysPressed.add(e.code);
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
        
        if (e.code === "KeyF" && performance.now() - lastFPressTime > 150 && bus) {
            lastFPressTime = performance.now(); bus.areLightsOn = !bus.areLightsOn;
            bus.setHeadlights?.(bus.areLightsOn); bus.setTaillights?.(bus.areLightsOn); ui?.toast(`💡 Đèn ${bus.areLightsOn ? 'BẬT' : 'TẮT'}`);
        }
        if (e.code === "KeyK" && bus) {
            doorTarget = doorTarget === 0 ? 1 : 0; bus.doorOpen = doorTarget === 1;
            ui?.toast(`🚪 Cửa ${bus.doorOpen ? 'MỞ' : 'ĐÓNG'}`);
            if (bus.doorOpen && passengerSystem) passengerSystem.pickUpPassengers();
        }
        if (e.code === "KeyL") { lKeyTimer = performance.now(); }
        if (e.code.startsWith("Digit") && performance.now() - lKeyTimer < 1000) {
            const group = parseInt(e.code.replace("Digit", ""));
            if (group >= 1 && group <= 4 && interior) {
                interior.userData.ledGroups = interior.userData.ledGroups || {};
                interior.userData.ledGroups[group] = !interior.userData.ledGroups[group];
                interior.setInteriorLedGroup?.(group, interior.userData.ledGroups[group]);
                ui?.toast(`💡 Nhóm đèn ${group}: ${interior.userData.ledGroups[group] ? "ON" : "OFF"}`);
                lKeyTimer = 0;
            }
        }
        if (e.code === "KeyH" && performance.now() - lastHornPressTime > 300) { lastHornPressTime = performance.now(); ui?.toast("📯 Bim bim!"); }
        if (e.code === "KeyC" && performance.now() - lastCameraPressTime > 200 && cameraSystem) { lastCameraPressTime = performance.now(); cameraSystem.cycleNext(); }
    });
    window.addEventListener("keyup", (e) => keysPressed.delete(e.code));
    window.addEventListener("blur", () => keysPressed.clear());
}

function handleCommand(cmd) {
    const parts = cmd.split(" ");
    if (parts[0] === "time" && parts[1]) {
        const timeParts = parts[1].split("/");
        if (timeParts.length === 2) {
            const h = parseInt(timeParts[0]); const m = parseInt(timeParts[1]);
            if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                lighting.setGameTime(h * 60 + m);
                ui.toast(`✓ Đã đặt thời gian thành ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
            } else { ui.toast("✕ Thời gian không hợp lệ!", true); }
        } else { ui.toast("✕ Cú pháp: time HH/MM", true); }
    } else { ui.toast("✕ Lệnh không xác định!", true); }
    isConsoleOpen = false; ui.hideConsole();
}

function togglePause() {
    if (gameState === "playing") { paused = true; ui.showPauseMenu(); }
    else if (paused) { paused = false; ui.hidePauseMenu(); clock.getDelta(); }
}

let hudTimer = 0;
function handleResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(0.8);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
}
function initRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power", stencil: false, depth: true });
    renderer.setClearColor(0x87ceeb, 1);
    renderer.setPixelRatio(0.8);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; 
    renderer.shadowMap.enabled = false;
    renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); webglLost = true; }, false);
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

async function startGameFromMenu() {
    ui.hideMainMenu(); ui.setLoading("Đang tải...", 0.1); await new Promise(r => setTimeout(r, 100));
    try {
        ui.setLoading("Ánh sáng...", 0.2); lighting = new LightingSystem({ scene, timeScale: 1, initialMinutes: 390 }); lighting.update(0.1); await new Promise(r => setTimeout(r, 300));
        ui.setLoading("Bản đồ...", 0.4); map = createMap({ scene, seed: 2026, lighting }); ui.setupMinimap(map); await new Promise(r => setTimeout(r, 500));
        ui.setLoading("Xe khách...", 0.6); bus = createBus(); interior = createBusInterior(); if (!interior?.isObject3D) interior = new THREE.Group(); bus.group.add(interior); scene.add(bus.group);
        const spawn = map.getSpawnPoint();
        bus.group.position.set(spawn.x, 0.5, spawn.z);
        bus.group.rotation.y = (spawn.heading || 0) + Math.PI / 2;
        if (window.collisionSystem) playerColId = window.collisionSystem.register(bus.group.position.x, bus.group.position.z, 4.0, 'player');
        cameraSystem = new CameraSystem(camera, bus.group); cameraSystem.setMode("driver");
        cameraSystem.settings.cameraSensitivity = 0.006; await new Promise(r => setTimeout(r, 300));
        ui.setLoading("Giao thông...", 0.8); await loadNpcSkinList(); npc = createNPC({ scene, map, seed: 2027, playerBus: bus, playerSpawnPos: { x: spawn.x, z: spawn.z } }); 
        trafficManager = createTrafficManager({ scene, roadGraph: roadNetwork, playerRef: bus, maxVehicles: gameSettings.npcDensity || 10 }); 
        
        trafficManager.setupStationTraffic(getNode('th_st'), 15); 
        trafficManager.setupStationTraffic(getNode('mien_dong_st'), 50);
        trafficManager.setupStationTraffic(getNode('rest_dai_phu'), 5);
        trafficManager.setupStationTraffic(getNode('gas_petrolimex_133'), 5);
        trafficManager.setupStationTraffic(getNode('th_gas'), 5);

        passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui }); await new Promise(r => setTimeout(r, 300));
        ui.setLoading("Hoàn tất...", 1.0); await new Promise(r => setTimeout(r, 100)); ui.hideLoading();
        gameState = "playing"; paused = false; document.getElementById("hud").style.display = "block"; initInput(); clock.start(); lastTime = performance.now();
    } catch (error) { 
        console.error("❌ Lỗi chi tiết:", error); 
        alert("Lỗi tải game:\n" + error.message + "\n\nStack: " + error.stack); 
        ui.showMainMenu(); 
    }
}
function setupMenuEvents() { document.getElementById("btn-new-game")?.addEventListener("click", startGameFromMenu); }

function updateWorld(delta) {
    if (!lighting) return; lighting.update(delta);
    if (bus && bus.setDoor) { doorProgress += (doorTarget - doorProgress) * 2.0 * delta; bus.setDoor(doorProgress); }
    updateVehiclePhysics(delta); cameraSystem?.update(delta);
    if (bus?.group && map) map.setPlayerPosition(bus.group.position.x, bus.group.position.z);
    if (npc) npc.update(delta, 0);
    if (trafficManager) trafficManager.update(delta, { x: bus.group.position.x, z: bus.group.position.z });
    if (passengerSystem) passengerSystem.update(delta);
}

function updateHUD(delta) {
    hudTimer += delta;
    if (hudTimer < 0.1) return;
    hudTimer = 0;
    if (gameState !== "playing" || !bus || !ui) return;
    const zones = passengerSystem?.getActiveZones?.() || [];
    const npcZones = [];
    if (trafficManager?.aiVehicles) { for (let i = 0; i < trafficManager.aiVehicles.length; i++) { const c = trafficManager.aiVehicles[i].collider; if (c) npcZones.push(c); } }
    ui.update({ fps: 1/delta, speedKmh: vehiclePhysics.currentSpeedKmh, passengers: passengerSystem?.onboardPassengers?.length || 0, timeMinutes: lighting?.getGameTime() || 0, x: bus.group.position.x, z: bus.group.position.z, heading: bus.group.rotation.y, passengerZones: zones, npcZones: npcZones });
}

// FIXED TIMESTEP AN TOÀN: CHỐNG TELEPORT KHI LAG
const FIXED_STEP = 1/30; 
let accumulator = 0;

function loop() {
    try {
        if (webglLost) return;
        const now = performance.now();
        let rawDelta = (now - lastTime) / 1000;
        lastTime = now;
        
        // CLAMP DELTATIME: Nếu game bị khựng 3 giây, chỉ lấy tối đa 0.1s để tránh teleport
        if (rawDelta > 0.1) rawDelta = 0.1; 

        if (gameState === "playing" && !paused && !isConsoleOpen) {
            accumulator += rawDelta;
            let steps = 0;
            while (accumulator >= FIXED_STEP && steps < 2) {
                updateWorld(FIXED_STEP);
                accumulator -= FIXED_STEP;
                steps++;
            }
            if (steps >= 2) accumulator = 0; // Xóa tích lũy nếu quá nặng
        }

        if (renderer && scene && camera) renderer.render(scene, camera);
        if (gameState === "playing") updateHUD(rawDelta);
    } catch (e) { console.error("Loop Error:", e); }
    window.requestAnimationFrame(loop);
}
boot();