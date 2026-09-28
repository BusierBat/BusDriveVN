// js/main.js
import * as THREE from "three";
import { MapLoader } from "./map.js";
import { createUI } from "./ui.js";
import { createNPC } from "./npc.js";
import { createBus, loadNpcSkinList } from "./bus.js";
import { createBusInterior } from "./interior.js";
import { CameraSystem } from "./camera.js";
import { LightingSystem } from "./lighting.js";
import { createPassengerSystem } from "./passenger.js";
import { createTrafficManager } from "./traffic/TrafficManager.js";
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
let speedCameraFlashTimer = 0;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
let gameSettings = { graphics: 'low', renderDist: 2, npcDensity: 5, camSens: 30, fov: 70 };

if (isMobile || isLowEnd) { 
    gameSettings.renderDist = 1; 
    gameSettings.npcDensity = 3; 
}

let mobileInput = { steer: 0, accel: 0, brake: 0 };

const SPEED_CONVERSION = 0.4;
const vehiclePhysics = {
    speed: 0,
    maxSpeedKmh: 160,
    maxSpeed: 160 * SPEED_CONVERSION,
    maxReverseSpeed: -40 * SPEED_CONVERSION,
    acceleration: 20.0 * SPEED_CONVERSION,
    braking: 40.0 * SPEED_CONVERSION,
    drag: 2.0 * SPEED_CONVERSION,
    currentSpeedKmh: 0,
    isReversing: false,
    forwardVector: new THREE.Vector3()
};

let steerAngle = 0, steerTarget = 0;
const keysPressed = new Set();
let lKeyTimer = 0, lastFPressTime = 0, lastCameraPressTime = 0, lastHornPressTime = 0;

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
    const phys = vehiclePhysics;
    const isAccel = keysPressed.has("KeyW") || mobileInput.accel > 0;
    const isBrake = keysPressed.has("KeyS") || mobileInput.brake > 0;
    const isShift = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight");
    
    if (isShift && isAccel) {
        phys.speed += phys.acceleration * dt;
        phys.speed = Math.min(phys.speed, phys.maxSpeed);
        phys.isReversing = false;
    } else if (isAccel && !isShift) {
        if (phys.speed < 0) {
            phys.speed += phys.braking * dt;
            if (phys.speed > 0) phys.speed = 0;
        } else {
            // BUG CU: `else if (phys.speed === 0)` -> chi tang toc O MOT FRAME.
            // speed len >0 roi khong con nhanh nao khop `isAccel` nua, ga chet
            // o 1 km/h ma cam ga. Chi can `else` la ga thuong chay duoc.
            // Tran 30 km/h: speed la m/s, SPEED_CONVERSION = 0.2777 m/s/km/h
            // => 30 * SPEED_CONVERSION = 8.33 m/s. (KHONG chia, se ra 388 km/h)
            phys.speed += phys.acceleration * dt;
            phys.speed = Math.min(phys.speed, 30 * SPEED_CONVERSION);
        }
    } else if (isBrake) {
        if (phys.speed > 0) {
            phys.speed -= phys.braking * dt;
            if (phys.speed < 0) phys.speed = 0;
        } else {
            phys.isReversing = true;
            phys.speed -= phys.acceleration * dt;
            phys.speed = Math.max(phys.speed, phys.maxReverseSpeed);
        }
    } else if (keysPressed.has("Space")) {
        phys.speed = 0;
    } else {
        phys.speed = phys.speed > 0 ? Math.max(phys.speed - phys.drag * dt, 0) : Math.min(phys.speed + phys.drag * dt, 0);
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
    //
    // P41/P42: truyền `yHint` = cao độ xe ĐANG ở. Không có nó thì thuật toán
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
    const pitchAngle = isBrake ? -0.04 : (isAccel ? 0.02 : 0);
    const targetRoll = -steerAngle * 0.03 * (speedKmh / 60);
    bus.group.rotation.x = THREE.MathUtils.lerp(bus.group.rotation.x, pitchAngle, dt * 4);
    bus.group.rotation.z = THREE.MathUtils.lerp(bus.group.rotation.z, targetRoll, dt * 3);
    
    if (window.collisionSystem) window.collisionSystem.update(playerColId, bus.group.position.x, bus.group.position.z, bus.group.position.y);
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
            lastFPressTime = performance.now();
            bus.areLightsOn = !bus.areLightsOn;
            bus.setHeadlights?.(bus.areLightsOn);
            bus.setTaillights?.(bus.areLightsOn);
            ui?.toast(`💡 Đèn ${bus.areLightsOn ? 'BẬT' : 'TẮT'}`);
        }
        if (e.code === "KeyK" && bus) {
            doorTarget = doorTarget === 0 ? 1 : 0;
            bus.doorOpen = doorTarget === 1;
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
        if (e.code === "KeyH" && performance.now() - lastHornPressTime > 300) {
            lastHornPressTime = performance.now();
            ui?.toast("📯 Bim bim!");
        }
        if (e.code === "KeyC" && performance.now() - lastCameraPressTime > 200 && cameraSystem) {
            lastCameraPressTime = performance.now();
            cameraSystem.cycleNext();
        }
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
    renderer.shadowMap.enabled = false;
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
    const settingsPanel = document.getElementById('settings-panel');
    const btnSettings = document.getElementById('btn-settings-main');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnApplySettings = document.getElementById('btn-apply-settings');
    const rngNpc = document.getElementById('setting-npc-density');
    const valNpc = document.getElementById('val-npc-density');
    const rngCamSens = document.getElementById('setting-cam-sens');
    const valCamSens = document.getElementById('val-cam-sens');
    rngNpc?.addEventListener('input', () => { if(valNpc) valNpc.textContent = rngNpc.value; });
    rngCamSens?.addEventListener('input', () => { if(valCamSens) valCamSens.textContent = rngCamSens.value; });
    btnSettings?.addEventListener("click", () => { if(settingsPanel) settingsPanel.style.display = 'flex'; });
    btnCloseSettings?.addEventListener("click", () => { if(settingsPanel) settingsPanel.style.display = 'none'; });
    btnApplySettings?.addEventListener("click", () => {
        const selGraphics = document.getElementById('setting-graphics');
        if(selGraphics) gameSettings.graphics = selGraphics.value;
        if(rngNpc) gameSettings.npcDensity = parseInt(rngNpc.value);
        if(rngCamSens) gameSettings.camSens = parseInt(rngCamSens.value);
        if(cameraSystem) cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        if(renderer) renderer.toneMapping = (gameSettings.graphics === 'low') ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        if(trafficManager) trafficManager.maxVehicles = gameSettings.npcDensity;
        ui?.toast("Da ap dung cai dat!");
        if(settingsPanel) settingsPanel.style.display = 'none';
    });
    const uvPanel = document.getElementById('uv-skin-panel');
    const btnUvSkin = document.getElementById('btn-uv-skin');
    const btnCloseUvSkin = document.getElementById('btn-close-uv-skin');
    const btnChooseSkin = document.getElementById('btn-choose-skin');
    const uvInput = document.getElementById('uv-skin-input');
    const uvStatus = document.getElementById('uv-skin-status');
    const uvDownload = document.getElementById('uv-skin-download');
    btnUvSkin?.addEventListener('click', () => {
        if(uvPanel) uvPanel.style.display = 'flex';
        if(uvStatus) uvStatus.innerHTML = '';
        if(uvDownload) uvDownload.style.display = 'none';
    });
    btnCloseUvSkin?.addEventListener('click', () => { if(uvPanel) uvPanel.style.display = 'none'; });
    btnChooseSkin?.addEventListener('click', () => { if(uvInput) uvInput.click(); });
    uvInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if(uvStatus) { uvStatus.textContent = 'Dang kiem tra...'; uvStatus.style.color = '#fff'; }
        if(uvDownload) uvDownload.style.display = 'none';
        const reader = new FileReader();
        reader.onload = (ev) => {
            const arr = new Uint8Array(ev.target.result);
            const isPng = arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47;
            if (!isPng) {
                if(uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = 'File khong phai PNG'; }
                return;
            }
            const img = new Image();
            img.onload = () => {
                if (img.width !== 2048 || img.height !== 1024) {
                    if(uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = `Kich thuoc sai. Yeu cau: 2048x1024. File: ${img.width}x${img.height}`; }
                    return;
                }
                if(uvStatus) { uvStatus.style.color = '#00ff99'; uvStatus.innerHTML = 'UV Skin hop le'; }
                const url = URL.createObjectURL(file);
                if(uvDownload) { uvDownload.href = url; uvDownload.download = 'bus_final.png'; uvDownload.style.display = 'block'; }
            };
            img.onerror = () => { if(uvStatus) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = 'Loi doc file'; } };
            img.src = URL.createObjectURL(file);
        };
        reader.readAsArrayBuffer(file);
    });
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
        lighting = new LightingSystem({ scene, timeScale: 1, initialMinutes: 390 });
        lighting.update(0.1);
        await new Promise(r => setTimeout(r, 300));
        
        ui.setLoading("Đang tải dữ liệu bản đồ (JSON)...", 0.4);
        await new Promise(r => setTimeout(r, 50));
        map = new MapLoader(scene);
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
        // DEBUG HOOK: đo FPS / draw call / instance thật từ console
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
            // Dựng 1 khung hình thủ công (tab bị ẩn thì requestAnimationFrame
            // bị treo -> không test được). Dùng để đo FPS/draw call thật.
            tick: (times = 1) => { for (let i = 0; i < times; i++) loop(); },
            state: () => ({ gameState, paused, webglLost, renderRadius: map?.renderRadius })
        };
        if (window.collisionSystem) playerColId = window.collisionSystem.register(bus.group.position.x, bus.group.position.z, 4.0, 'player');
        cameraSystem = new CameraSystem(camera, bus.group);
        cameraSystem.setMode("driver");
        cameraSystem.settings.cameraSensitivity = gameSettings.camSens / 5000;
        await new Promise(r => setTimeout(r, 300));
        
        ui.setLoading("Giao thông & Hành khách...", 0.8);
        await loadNpcSkinList();
        const roadGraph = map.getRoadGraph();
        if (!roadGraph) throw new Error("Road graph chưa sẵn sàng — loadInitialData() lỗi?");
        npc = createNPC({ scene, map, seed: 2027, playerBus: bus, playerSpawnPos: { x: spawn.x, z: spawn.z } });
        trafficManager = createTrafficManager({ scene, roadGraph: roadGraph, playerRef: bus, maxVehicles: gameSettings.npcDensity || 5 });
        
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
    lighting.update(delta);
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
        npcZones: npcZones
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
        if (renderer && scene && camera) renderer.render(scene, camera);
        if (gameState === "playing") updateHUD(rawDelta);
    } catch (e) {
        console.error("Loop Error:", e);
    }
    window.requestAnimationFrame(loop);
}

boot();