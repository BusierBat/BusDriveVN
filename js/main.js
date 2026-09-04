// js/main.js - COACHVN OPTIMIZED PERFORMANCE EDITION (FULL FIXED & LOW-END SAFE)
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
import { roadNetwork } from "./map/data/roadNetworkData.js";
import { initEndermanEasterEgg, updateEnderman } from "./enderman.js";
import { CollisionSystem } from "./collisionSystem.js";

let renderer, scene, camera, canvas, map, lighting, npc, bus, interior, passengerSystem, trafficManager, ui, cameraSystem;
const clock = new THREE.Clock();
let fpsAverage = createMovingAverage(30);
let gameState = "menu", paused = false, flyMode = false;
let doorProgress = 0, doorTarget = 0;
let playerColId = -1;
let lastTime = performance.now();
let lKeyTimer = 0;
let lastCameraProbeTime = 0;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency || 4) <= 4;
let gameSettings = { graphics: 'medium', renderDist: 8, npcDensity: 15, camSens: 30, fov: 70 };
let mobileInput = { steer: 0, accel: 0, brake: 0 };

const vehiclePhysics = {
  speed: 0, maxSpeedKmh: 160, maxSpeed: 160 * 0.28, maxReverseSpeed: -40 * 0.28,
  acceleration: 10.0 * 0.28, shiftAcceleration: 18.0 * 0.28, drag: 1.2 * 0.28, braking: 25.0 * 0.28,
  currentSpeedKmh: 0, isReversing: false, forwardVector: new THREE.Vector3()
};
let steerAngle = 0, steerTarget = 0;
const keysPressed = new Set();
let lastFPressTime = 0, lastCameraPressTime = 0, lastHornPressTime = 0;
const _camRay = new THREE.Raycaster();
const _camDir = new THREE.Vector3();

function updateVehiclePhysics(dt) {
  if (!bus?.group) return;
  const phys = vehiclePhysics;
  const speedRatio = Math.abs(phys.currentSpeedKmh) / phys.maxSpeedKmh;
  const accelMult = 1 - speedRatio * 0.6;
  const isAccel = keysPressed.has("KeyW") || mobileInput.accel > 0;
  const isBrake = keysPressed.has("KeyS") || mobileInput.brake > 0;
  const isShift = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight");

  if (isShift && isAccel) { phys.speed += phys.shiftAcceleration * dt * accelMult; phys.speed = Math.min(phys.speed, phys.maxSpeed); }
  else if (isAccel) { phys.speed += phys.acceleration * dt * accelMult; phys.speed = Math.min(phys.speed, phys.maxSpeed); phys.isReversing = false; }
  else if (isBrake) {
    if (phys.speed > 0) { phys.speed -= phys.braking * dt; phys.speed = Math.max(phys.speed, 0); }
    else { phys.isReversing = true; phys.speed -= 4.0 * 0.28 * dt; phys.speed = Math.max(phys.speed, phys.maxReverseSpeed); }
  } else if (keysPressed.has("Space")) { phys.speed = 0; }
  else { phys.speed = phys.speed > 0 ? Math.max(phys.speed - phys.drag * dt, 0) : Math.min(phys.speed + phys.drag * dt, 0); }

  if (Math.abs(phys.speed) < 0.001) { phys.speed = 0; }
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
    if (e.code === "Escape") { togglePause(); return; }
    if (gameState !== "playing" || paused) return;
    keysPressed.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();

    if (e.code === "KeyF" && performance.now() - lastFPressTime > 150 && bus) {
      lastFPressTime = performance.now(); bus.areLightsOn = !bus.areLightsOn;
      bus.setHeadlights?.(bus.areLightsOn); bus.setTaillights?.(bus.areLightsOn); ui?.toast(bus.areLightsOn ? "💡 Bật đèn" : "💡 Tắt đèn");
    }
    if (e.code === "KeyK" && bus) {
      doorTarget = doorTarget === 0 ? 1 : 0; bus.doorOpen = doorTarget === 1;
      ui?.toast(bus.doorOpen ? "🚪 Mở cửa" : "🚪 Đóng cửa");
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

function togglePause() {
  if (gameState === "playing") { paused = true; ui.showPauseMenu(); } 
  else if (paused) { paused = false; ui.hidePauseMenu(); clock.getDelta(); }
}

let renderScale = 1.0, performanceTimer = 0, hudTimer = 0, trafficTimer = 0, npcTimer = 0, passengerTimer = 0, lowPerformanceMode = false;
function handleResize() {
  if (!renderer || !camera) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const maxRatio = isMobile ? 1.25 : 1.5;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio) * renderScale);
  renderer.setSize(width, height, false);
}
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: isMobile ? "low-power" : "default", stencil: false, depth: true, failIfMajorPerformanceCaveat: false });
  renderer.setClearColor(0x87ceeb, 1);
  const maxRatio = isMobile ? 1.25 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio) * renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (gameSettings.graphics === 'low' || isLowEnd) {
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false;
  } else {
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = (gameSettings.graphics === 'high');
  }
  window.addEventListener('resize', handleResize);
}
function applyRenderScale() { if (!renderer) return; const maxRatio = isMobile ? 1.25 : 1.5; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio) * renderScale); renderer.setSize(window.innerWidth, window.innerHeight, false); }
function updateAdaptivePerformance(delta) {
  performanceTimer += delta; if (performanceTimer < 1.0) return;
  performanceTimer = 0; const fps = fpsAverage.value || 60, prev = renderScale;
  if (fps < 22) { renderScale = Math.max(0.8, renderScale - 0.06); lowPerformanceMode = true; }
  else if (fps < 35) { renderScale = Math.max(0.9, renderScale - 0.03); lowPerformanceMode = true; }
  else if (fps > 55) { renderScale = Math.min(1.0, renderScale + 0.03); if (renderScale >= 0.98) lowPerformanceMode = false; }
  if (Math.abs(renderScale - prev) > 0.005) applyRenderScale();
}

async function boot() {
  try {
    ui = createUI({ map: null });
    let loaded = ui.loadSettings();
    if ((isMobile || isLowEnd) && !loaded.graphics) {
      gameSettings = { graphics: 'low', renderDist: 4, npcDensity: 10, camSens: 30, fov: 70 };
      ui.saveSettings();
    } else { gameSettings = loaded; }
    
    if (isMobile) document.getElementById('mobile-controls').style.display = 'block';
    ui.showMainMenu();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    camera = new THREE.PerspectiveCamera(gameSettings.fov || 70, window.innerWidth / window.innerHeight, 0.1, 20000);
    canvas = document.getElementById('game-canvas');
    if (!canvas) throw new Error('Không tìm thấy canvas game');
    
    window.collisionSystem = new CollisionSystem(50);
    initEndermanEasterEgg();
    
    await new Promise(r => setTimeout(r, 200));
    initRenderer();
    
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => console.log(err));
      else document.exitFullscreen();
    });
    
    setupMobileControls();
    setupMenuEvents(); 
    renderer.setAnimationLoop(loop);
  } catch (e) { console.error("Lỗi init:", e); alert("Không thể khởi tạo WebGL."); }
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
    steerWheel.addEventListener('touchstart', (e) => { e.preventDefault(); const r = steerWheel.getBoundingClientRect(); centerX = r.left + r.width / 2; centerY = r.top + r.height / 2; touchId = e.changedTouches[0].identifier; handleSteer(e.changedTouches[0]); });
    steerWheel.addEventListener('touchmove', (e) => { e.preventDefault(); for (let t of e.touches) if (t.identifier === touchId) handleSteer(t); });
    steerWheel.addEventListener('touchend', (e) => { e.preventDefault(); touchId = null; mobileInput.steer = 0; wheelKnob.style.transform = `translateX(-50%) rotate(0deg)`; });
    const setupPedal = (id, key) => { const btn = document.getElementById(id); btn.addEventListener('touchstart', (e) => { e.preventDefault(); mobileInput[key] = 1; }); btn.addEventListener('touchend', (e) => { e.preventDefault(); mobileInput[key] = 0; }); };
    setupPedal('m-gas', 'accel'); setupPedal('m-brake', 'brake');
    const simulateKey = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 100); };
    document.getElementById('m-horn').addEventListener('touchstart', (e) => { e.preventDefault(); simulateKey('KeyH'); });
    document.getElementById('m-light').addEventListener('touchstart', (e) => { e.preventDefault(); simulateKey('KeyF'); });
    document.getElementById('m-door').addEventListener('touchstart', (e) => { e.preventDefault(); simulateKey('KeyK'); });
}

async function startGameFromMenu() {
  ui.hideMainMenu(); ui.setLoading("Đang tải...", 0.1); await new Promise(r => setTimeout(r, 200));
  try {
    ui.setLoading("Ánh sáng...", 0.2); lighting = new LightingSystem({ scene, timeScale: 1, initialMinutes: 390 }); lighting.update(0.1); await new Promise(r => setTimeout(r, 200));
    ui.setLoading("Bản đồ...", 0.4); map = createMap({ scene, seed: 2026, lighting }); ui.setupMinimap(map); await new Promise(r => setTimeout(r, 200));
    
    ui.setLoading("Xe khách...", 0.6); bus = createBus(); interior = createBusInterior(); if (!interior?.isObject3D) interior = new THREE.Group(); bus.group.add(interior); if (bus.setInteriorReference) bus.setInteriorReference(interior); scene.add(bus.group);
    
    const spawn = map.getSpawnPoint();
    bus.group.position.set(spawn.x, 0.5, spawn.z);
    bus.group.rotation.y = (spawn.heading || 0) + Math.PI / 2; 
    bus.group.updateMatrixWorld(true); 
    
    if (window.collisionSystem) playerColId = window.collisionSystem.register(bus.group.position.x, bus.group.position.z, 4.0, 'player');
    
    cameraSystem = new CameraSystem(camera, bus.group); cameraSystem.setMode("driver");
    cameraSystem.settings.cameraSensitivity = (gameSettings.camSens || 30) / 5000; await new Promise(r => setTimeout(r, 200));
    ui.setLoading("Giao thông...", 0.8); await loadNpcSkinList(); npc = createNPC({ scene, map, seed: 2027, playerBus: bus, playerSpawnPos: { x: spawn.x, z: spawn.z } }); trafficManager = createTrafficManager({ scene, roadGraph: roadNetwork, playerRef: bus, maxVehicles: gameSettings.npcDensity || 15 }); passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui }); await new Promise(r => setTimeout(r, 200));
    ui.setLoading("Hoàn tất...", 1.0); await new Promise(r => setTimeout(r, 250)); ui.hideLoading();
    gameState = "playing"; paused = false; document.getElementById("hud").style.display = "block"; initInput(); clock.start(); lastTime = performance.now();
  } catch (error) { console.error("❌ Lỗi:", error); alert("Lỗi tải game: " + error.message); ui.showMainMenu(); }
}

function setupMenuEvents() {
  document.getElementById("btn-new-game")?.addEventListener("click", startGameFromMenu);
  document.getElementById("btn-settings-main")?.addEventListener("click", () => ui.showSettings());
  document.getElementById("btn-settings-pause")?.addEventListener("click", () => ui.showSettings());
  document.getElementById("btn-close-settings")?.addEventListener("click", () => ui.hideSettings());
  
  document.getElementById("btn-apply-settings")?.addEventListener("click", () => {
    const s = ui.saveSettings(); gameSettings = s;
    if (camera) { camera.fov = gameSettings.fov; camera.updateProjectionMatrix(); }
    if (renderer) { renderer.toneMapping = (gameSettings.graphics === 'low') ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = (gameSettings.graphics === 'high'); }
    if (trafficManager) { trafficManager.maxVehicles = gameSettings.npcDensity; if (trafficManager.graphics?.settings) trafficManager.graphics.settings.maxActiveTraffic = gameSettings.npcDensity * 2; }
    if (cameraSystem) { cameraSystem.settings.cameraSensitivity = (gameSettings.camSens || 30) / 5000; }
    if (map && gameSettings.renderDist) map.renderDistance = gameSettings.renderDist;
    ui.toast("⚙ Đã áp dụng!"); ui.hideSettings();
  });
  
  document.getElementById("btn-resume")?.addEventListener("click", togglePause);
  document.getElementById("btn-main-menu")?.addEventListener("click", () => { gameState = "menu"; paused = false; ui.hidePauseMenu(); ui.showMainMenu(); });

  const uvPanel = document.getElementById('uv-skin-panel');
  const uvInput = document.getElementById('uv-skin-input');
  const uvStatus = document.getElementById('uv-skin-status');
  const uvDownload = document.getElementById('uv-skin-download');
  document.getElementById('btn-uv-skin')?.addEventListener('click', () => { uvPanel.style.display = 'block'; uvStatus.innerHTML = ''; uvDownload.style.display = 'none'; });
  document.getElementById('btn-close-uv-skin')?.addEventListener('click', () => uvPanel.style.display = 'none');
  document.getElementById('btn-choose-skin')?.addEventListener('click', () => uvInput.click());
  uvInput?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    uvStatus.textContent = '⏳ ĐANG KIỂM TRA...'; uvDownload.style.display = 'none';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const arr = new Uint8Array(ev.target.result);
      const isPng = arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47 && arr[4] === 0x0D && arr[5] === 0x0A && arr[6] === 0x1A && arr[7] === 0x0A;
      if (!isPng) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = '❌ FILE KHÔNG PHẢI PNG HỢP LỆ'; return; }
      const img = new Image();
      img.onload = () => {
        if (img.width !== 2048 || img.height !== 1024) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = `❌ UV SKIN KHÔNG HỢP LỆ<br>Yêu cầu: 2048 × 1024<br>File: ${img.width} × ${img.height}`; return; }
        try { const tex = new THREE.Texture(img); tex.needsUpdate = true; if (!tex.image || tex.image.width === 0) throw new Error(); tex.dispose(); uvStatus.style.color = '#00ff99'; uvStatus.innerHTML = `✅ UV SKIN HỢP LỆ<br>Kích thước: ${img.width} × ${img.height}`; const url = URL.createObjectURL(file); uvDownload.href = url; uvDownload.download = 'bus_final.png'; uvDownload.style.display = 'block'; } catch (err) { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = '❌ TEXTURE KHÔNG HỢP LỆ'; }
      };
      img.onerror = () => { uvStatus.style.color = '#ff4d4d'; uvStatus.innerHTML = '❌ KHÔNG THỂ ĐỌC FILE'; };
      img.src = URL.createObjectURL(file);
    };
    reader.readAsArrayBuffer(file);
  });
}

function updateWorld(delta) {
  if (!lighting) return; lighting.update(delta);
  if (bus && bus.setDoor) { doorProgress += (doorTarget - doorProgress) * 2.0 * delta; bus.setDoor(doorProgress); }
  if (flyMode) { updateVehiclePhysics(delta); cameraSystem?.update(delta); if (keysPressed.has("Space")) bus.group.position.y += 5 * delta; if (keysPressed.has("ShiftLeft")) bus.group.position.y -= 5 * delta; return; }
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
  if (trafficManager?.aiVehicles) { for (let i = 0; i < trafficManager.aiVehicles.length; i++) { const c = trafficManager.aiVehicles[i].collider; if (c) npcZones.push({ x: c.x, z: c.z }); } }
  ui.update({ fps: fpsAverage.value, speedKmh: vehiclePhysics.currentSpeedKmh, passengers: passengerSystem?.onboardPassengers?.length || 0, timeMinutes: lighting?.getGameTime() || 0, x: bus.group.position.x, z: bus.group.position.z, heading: bus.group.rotation.y, passengerZones: zones, npcZones: npcZones, warning: bus.doorOpen ? "⚠ CỬA ĐANG MỞ" : null });
}

function loop() {
  try {
    const now = performance.now();
    const rawDelta = (now - lastTime) / 1000;
    lastTime = now;
    const delta = Math.min(rawDelta, 0.1);
    fpsAverage.add(1 / Math.max(rawDelta, 0.001));
    updateAdaptivePerformance(delta);
    
    if (gameState === "playing" && !paused) updateWorld(delta);
    if (renderer && scene && camera) renderer.render(scene, camera);
    if (gameState === "playing") updateHUD(delta);

    if (cameraSystem && bus?.group && performance.now() - lastCameraProbeTime > 250) {
      lastCameraProbeTime = performance.now();
      const currentMode = cameraSystem.modes[cameraSystem.currentIndex];
      if (currentMode !== 'outside') {
        camera.getWorldDirection(_camDir);
        _camRay.set(camera.position, _camDir);
        _camRay.far = 0.6;
        const intersects = _camRay.intersectObjects(bus.group.children, true);
        if (intersects.length > 0) {
          cameraSystem.setMode('outside');
        }
      }
    }
  } catch (e) { console.error("Loop Error:", e); }
}

boot();
