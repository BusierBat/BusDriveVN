// js/main.js - COACHVN ULTRA STABLE & FULL INTEGRATION
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
let webglLost = false;
let isConsoleOpen = false;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
let gameSettings = { graphics: 'low', renderDist: 2, npcDensity: 5, camSens: 30, fov: 70 };
if (isMobile || isLowEnd) { gameSettings.renderDist = 1; gameSettings.npcDensity = 3; }

let mobileInput = { steer: 0, accel: 0, brake: 0 };
const vehiclePhysics = {
    speed: 0, maxSpeedKmh: 160, maxSpeed: 160 * 0.28, maxReverseSpeed: -40 * 0.28,
    acceleration: 10.0 * 0.28, braking: 25.0 * 0.28, drag: 1.2 * 0.28,
    currentSpeedKmh: 0, isReversing: false, forwardVector: new THREE.Vector3()
};
let steerAngle = 0, steerTarget = 0;
const keysPressed = new Set();
let lKeyTimer = 0, lastFPressTime = 0, lastCameraPressTime = 0, lastHornPressTime = 0;

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
        const tp = parts[1].split("/");
        if (tp.length === 2) {
            const h = parseInt(tp[0]), m = parseInt(tp[1]);
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
    renderer.setPixelRatio(isLowEnd ? 0.8 : 1.0);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
}

function initRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power", stencil: false, depth: true });
    renderer.setClearColor(0x87ceeb, 1);
    renderer.setPixelRatio(isLowEnd ? 0.8 : 1.0);
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; 
    renderer.shadowMap.enabled = false;
    renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); webglLost = true; alert("GPU quá tải, vui lòng F5!"); }, false);
    window.addEventListener('resize', handleResize);
}

async function boot() {
    ui = createUI({ map: null });
    if (isMobile || isLowEnd) { ui.saveSettings(); }
    ui.showMainMenu();
    scene = new THREE.Scene(); // KHỞI TẠO SCENE Ở ĐÂY
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 150, 800);
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 30000);
    canvas = document.getElementById('game-canvas');
    window.collisionSystem = new CollisionSystem(50);
    initEndermanEasterEgg();
    await new Promise(r => setTimeout(r, 200));
    initRenderer();
    setupMenuEvents();
    setupMobileControls();
    window.requestAnimationFrame(loop);
}

function setupMobileControls() {
    const steerWheel = document.getElementById('steering-wheel');
    const wheelKnob = document.getElementById('wheel-knob');
    let touchId = null, centerX = 0, centerY = 0;
    const handleSteer = (t) => {
        const dx = t.clientX - centerX, dy = t.clientY - centerY;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI - 90;
        if (angle > 180) angle -= 360; if (angle < -180) angle += 360;
        let clamp = Math.max(-90, Math.min(90, angle));
        mobileInput.steer = clamp / 90;
        wheelKnob.style.transform = `translateX(-50%) rotate(${clamp}deg)`;
    };
    steerWheel?.addEventListener('touchstart', (e) => { e.preventDefault(); const r = steerWheel.getBoundingClientRect(); centerX = r.left + r.width / 2; centerY = r.top + r.height / 2; touchId = e.changedTouches[0].identifier; handleSteer(e.changedTouches[0]); });
    steerWheel?.addEventListener('touchmove', (e) => { e.preventDefault(); for (let t of e.touches) if (t.identifier === touchId) handleSteer(t); });
    steerWheel?.addEventListener('touchend', (e) => { e.preventDefault(); touchId = null; mobileInput.steer = 0; wheelKnob.style.transform = `translateX(-50%) rotate(0deg)`; });
    
    const setupPedal = (id, key) => { const btn = document.getElementById(id); btn?.addEventListener('touchstart', (e) => { e.preventDefault(); mobileInput[key] = 1; }); btn?.addEventListener('touchend', (e) => { e.preventDefault(); mobileInput[key] = 0; }); };
    setupPedal('m-gas', 'accel'); setupPedal('m-brake', 'brake');
    const simulateKey = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 100); };
    document.getElementById('m-horn')?.addEventListener('touchstart', (e) => { e.preventDefault(); simulateKey('KeyH'); });
    document.getElementById('m-light')?.addEventListener('touchstart', (e) => { e.preventDefault(); simulateKey('KeyF'); });
    document.getElementById('m-door')?.addEventListener('touchstart', (e) => { e.preventDefault(); simulateKey('KeyK'); });
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
        trafficManager = createTrafficManager({ scene, roadGraph: roadNetwork, playerRef: bus, maxVehicles: gameSettings.npcDensity || 5 }); 
        
        // KHỞI TẠO NPC BẾN XE (STATIC COACHES)
        const thSt = getNode('py_st'); if (thSt) trafficManager.setupStationTraffic(thSt);
        const mdSt = getNode('sg_md'); if (mdSt) trafficManager.setupStationTraffic(mdSt);
        const restStop = getNode('dc_rest'); if (restStop) trafficManager.setupStationTraffic(restStop);
        const gasStation = getNode('exp_gas'); if (gasStation) trafficManager.setupStationTraffic(gasStation);

        // KHỞI TẠO PASSENGER SYSTEM (Đã có scene hợp lệ)
        passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui }); 
        await new Promise(r => setTimeout(r, 300));
        
        ui.setLoading("Hoàn tất...", 1.0); await new Promise(r => setTimeout(r, 100)); ui.hideLoading();
        gameState = "playing"; paused = false; document.getElementById("hud").style.display = "block"; initInput(); clock.start(); lastTime = performance.now();
    } catch (error) { 
        console.error("❌ Lỗi chi tiết:", error); 
        alert("Lỗi tải game:\n" + error.message + "\n\nStack: " + error.stack); 
        ui.showMainMenu(); 
    }
}

function setupMenuEvents() {
    document.getElementById("btn-new-game")?.addEventListener("click", startGameFromMenu);
    
    // --- LOGIC SETTINGS PANEL THẬT ---
    const settingsPanel = document.getElementById('settings-panel');
    const btnSettings = document.getElementById('btn-settings-main');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnApplySettings = document.getElementById('btn-apply-settings');
    
    btnSettings?.addEventListener("click", () => { if (settingsPanel) settingsPanel.style.display = 'flex'; });
    btnCloseSettings?.addEventListener("click", () => { if (settingsPanel) settingsPanel.style.display = 'none'; });
    btnApplySettings?.addEventListener("click", () => {
        const selGraphics = document.getElementById('setting-graphics');
        const rngNpc = document.getElementById('setting-npc-density');
        const rngCamSens = document.getElementById('setting-cam-sens');
        
        // Lưu và áp dụng setting thật
        gameSettings.graphics = selGraphics ? selGraphics.value : 'low';
        gameSettings.npcDensity = rngNpc ? parseInt(rngNpc.value) : 5;
        gameSettings.camSens = rngCamSens ? parseInt(rngCamSens.value) : 30;
        
        if (cameraSystem) cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        if (renderer) {
            renderer.toneMapping = (gameSettings.graphics === 'low') ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        }
        ui?.toast("⚙ Đã áp dụng cài đặt!");
        if (settingsPanel) settingsPanel.style.display = 'none';
    });

    // --- LOGIC UV SKIN THẬT ---
    const uvPanel = document.getElementById('uv-skin-panel');
    const uvInput = document.getElementById('uv-skin-input') || document.getElementById('btn-choose-skin');
    const uvStatus = document.getElementById('uv-skin-status');
    const uvDownload = document.getElementById('uv-skin-download');

    document.getElementById('btn-uv-skin')?.addEventListener('click', () => { 
        if (uvPanel) uvPanel.style.display = 'flex'; 
        if (uvStatus) uvStatus.innerHTML = ''; 
        if (uvDownload) uvDownload.style.display = 'none'; 
    });
    document.getElementById('btn-close-uv-skin')?.addEventListener('click', () => { if (uvPanel) uvPanel.style.display = 'none'; });
    
    uvInput?.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (uvStatus) { uvStatus.textContent = '⏳ ĐANG KIỂM TRA...'; uvStatus.style.color = '#fff'; }
        if (uvDownload) uvDownload.style.display = 'none';
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            const arr = new Uint8Array(ev.target.result);
            // Kiểm tra PNG signature
            const isPng = arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47 && arr[4] === 0x0D && arr[5] === 0x0A && arr[6] === 0x1A && arr[7] === 0x0A;
            if (!isPng) { 
                if (uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = '❌ FILE KHÔNG PHẢI PNG HỢP LỆ'; }
                return; 
            }
            const img = new Image();
            img.onload = () => {
                // Kiểm tra kích thước 2048x1024
                if (img.width !== 2048 || img.height !== 1024) { 
                    if (uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = `❌ UV SKIN KHÔNG HỢP LỆ\nYêu cầu: 2048×1024\nFile: ${img.width}×${img.height}`; }
                    return; 
                }
                try { 
                    const tex = new THREE.Texture(img); 
                    tex.needsUpdate = true; 
                    if (!tex.image || tex.image.width === 0) throw new Error(); 
                    tex.dispose(); // Dọn dẹp test
                    if (uvStatus) { uvStatus.style.color = '#00ff99'; uvStatus.innerHTML = `✅ UV SKIN HỢP LỆ\nKích thước: ${img.width} × ${img.height}`; } 
                    const url = URL.createObjectURL(file); 
                    if (uvDownload) { uvDownload.href = url; uvDownload.download = 'bus_final.png'; uvDownload.style.display = 'block'; }
                } catch (err) { 
                    if (uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = '❌ TEXTURE KHÔNG HỢP LỆ'; } 
                }
            };
            img.onerror = () => { if (uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = '❌ KHÔNG THỂ ĐỌC FILE'; } };
            img.src = URL.createObjectURL(file);
        };
        reader.readAsArrayBuffer(file);
    });
}

function updateWorld(delta) {
    if (!lighting) return; lighting.update(delta);
    if (bus && bus.setDoor) { doorProgress += (doorTarget - doorProgress) * 2.0 * delta; bus.setDoor(doorProgress); }
    updateVehiclePhysics(delta); cameraSystem?.update(delta);
    if (bus?.group && map) map.setPlayerPosition(bus.group.position.x, bus.group.position.z);
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
    const npcZones = window._npcZonesCache; npcZones.length = 0;
    if (trafficManager?.aiVehicles) { for (let i = 0; i < trafficManager.aiVehicles.length; i++) { const c = trafficManager.aiVehicles[i].collider; if (c) npcZones.push(c); } }
    ui.update({ fps: 1/delta, speedKmh: vehiclePhysics.currentSpeedKmh, passengers: passengerSystem?.onboardPassengers?.length || 0, timeMinutes: lighting?.getGameTime() || 0, x: bus.group.position.x, z: bus.group.position.z, heading: bus.group.rotation.y, passengerZones: zones, npcZones: npcZones });
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

        if (renderer && scene && camera) renderer.render(scene, camera);
        if (gameState === "playing") updateHUD(rawDelta);
    } catch (e) { console.error("Loop Error:", e); }
    window.requestAnimationFrame(loop);
}
boot();