// js/main.js - COACHVN OPTIMIZED PERFORMANCE EDITION (FULL FIXED)
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
const WORLD_UNITS_PER_KMH = 0.4;
const vehiclePhysics = {
speed: 0,
maxSpeedKmh: 120,
maxSpeed: 120 * WORLD_UNITS_PER_KMH,
maxReverseSpeed: -30 * WORLD_UNITS_PER_KMH,
acceleration: 20.0 * WORLD_UNITS_PER_KMH,
shiftAcceleration: 30.0 * WORLD_UNITS_PER_KMH,
drag: 0.8 * WORLD_UNITS_PER_KMH,
braking: 15.0 * WORLD_UNITS_PER_KMH,
reverseAcceleration: 8.0 * WORLD_UNITS_PER_KMH,
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
graphicsQuality: "medium",
renderDistance: 8,
shadows: false,
bloom: false,
outsideDistance: 8,
npcDensity: 2
};
// ============================================================================
// VEHICLE PHYSICS UPDATE
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
// INPUT SYSTEM (event.code for UniKey compatibility)
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

// ===== FIX BUG 4: Chặn toàn bộ phím gameplay để UniKey không ăn input =====
const gameCodes = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight", "KeyF", "KeyJ", "KeyK", "KeyL", "KeyH", "KeyC", "KeyP", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
if (gameCodes.includes(e.code)) {
e.preventDefault();
keysPressed.add(e.code);
} else if (e.code === "Escape") {
e.preventDefault();
togglePause();
}

// Headlights (F)
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
// Door open/close (J)
if (e.code === "KeyJ" && bus) {
if (bus.setDoor) {
const isOpen = !bus.doorOpen;
bus.setDoor(isOpen ? 1 : 0);
bus.doorOpen = isOpen;
ui?.toast(isOpen ? "🚪 Mở cửa" : "🚪 Đóng cửa");
}
}
// Passenger pickup (K)
if (e.code === "KeyK" && bus && passengerSystem) {
const picked = passengerSystem.pickUpPassengers();
}
// Interior LED (L)
if (e.code === "KeyL" && bus) {
if (bus.setInteriorLed) {
const isOn = !bus.interiorLedOn;
bus.setInteriorLed(isOn);
bus.interiorLedOn = isOn;
ui?.toast(isOn ? "💡 LED ON" : "💡 LED OFF");
}
}
// Horn (H)
if (e.code === "KeyH") {
const now = performance.now();
if (now - lastHornPressTime > 300) {
lastHornPressTime = now;
ui?.toast("📯 Bim bim!");
}
}
// Camera (C)
if (e.code === "KeyC") {
const now = performance.now();
if (now - lastCameraPressTime > 200 && cameraSystem) {
lastCameraPressTime = now;
cameraSystem.cycleNext();
ui?.toast(`📷 ${cameraSystem.getCurrentModeName()}`);
}
}
// Fly mode (P)
if (e.code === "KeyP") {
flyMode = !flyMode;
ui?.toast(flyMode ? "✈️ Fly mode ON" : "✈️ Fly mode OFF");
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
<input type="text" id="command-input" class="console-input" placeholder="Gõ 'help' để xem lệnh..." />
</div>
<div class="console-help">Enter để thực thi | Esc hoặc / để đóng</div>
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
const val = parseFloat(command.split(/\s+/)[1]);
if (!Number.isNaN(val)) {
appendToConsole(`💰 Tiền: ${val}₫`);
}
executed = true;
}
break;
}
if (!executed) {
appendToConsole("❌ Lệnh không hợp lệ. Gõ 'help' để xem danh sách.");
}
}
// ============================================================================
// RENDERER
// ============================================================================
function initRenderer() {
renderer = new THREE.WebGLRenderer({
canvas,
antialias: false,
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
// GAME STATE FUNCTIONS
// ============================================================================
function startGame() {
if (ui) ui.hideMainMenu();
gameState = "playing";
paused = false;
}
function showMainMenu() {
if (ui) ui.showMainMenu();
gameState = "menu";
}
function togglePause() {
if (gameState === "playing") {
gameState = "paused";
paused = true;
if (ui) ui.showPauseMenu();
} else if (gameState === "paused") {
gameState = "playing";
paused = false;
if (ui) ui.hidePauseMenu();
}
}
// ============================================================================
// APPLY SETTINGS (Actually affects game systems)
// ============================================================================
function applySettingsToGame(settings) {
// Camera settings
if (cameraSystem) {
const camSens = settings.cameraSensitivity / 30000;
const clampedCamSens = Math.max(0.0001, Math.min(0.01, camSens));
const mouseSens = settings.mouseSensitivity / 30000;
const clampedMouseSens = Math.max(0.0001, Math.min(0.01, mouseSens));
cameraSystem.updateSettings({
cameraSensitivity: clampedCamSens,
mouseSensitivity: clampedMouseSens,
invertX: settings.invertX,
invertY: settings.invertY,
fov: settings.fov,
outsideDistance: settings.outsideDistance
});
}
// UI scale
document.documentElement.style.setProperty("--ui-scale", settings.uiScale / 100);
// Render distance (affects map chunk loading)
if (map && typeof map.setRenderDistance === 'function') {
map.setRenderDistance(settings.renderDistance);
}
// NPC traffic density
if (trafficManager) {
const densityLevels = ['off', 'low', 'medium', 'high', 'ultra'];
const densityLevel = densityLevels[settings.npcDensity] || 'medium';
trafficManager.setDensity(densityLevel);
}
// Graphics quality
applyGraphicsQuality(settings.graphicsQuality);
// Ray tracing
if (window.lighting) {
window.lighting.setRayTracingEnabled(settings.rayTracing || false);
}
// Shadows
if (renderer) {
renderer.shadowMap.enabled = settings.shadows || false;
}
// Theme
if (settings.theme === 'light') {
document.body.classList.add('light-mode');
} else {
document.body.classList.remove('light-mode');
}
console.log('⚙️ Settings applied:', settings);
}
function applyGraphicsQuality(quality) {
if (!renderer) return;
const qualities = {
'low': { pixelRatio: 0.7, shadowMap: false },
'medium': { pixelRatio: 1.0, shadowMap: false },
'high': { pixelRatio: 1.0, shadowMap: true },
'ultra': { pixelRatio: 1.5, shadowMap: true }
};
const q = qualities[quality] || qualities.medium;
renderer.setPixelRatio(q.pixelRatio);
renderer.shadowMap.enabled = q.shadowMap;
if (renderer.shadowMap.enabled) {
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
ui = createUI({
map: null,
callbacks: {
onSettingsApplied: (settings) => {
applySettingsToGame(settings);
}
}
});
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
if (bus.setInteriorReference && interior) {
bus.setInteriorReference(interior);
}
scene.add(bus.group);
// PLAYER SPAWN
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
// CAMERA
ui.setLoading("Camera...", 0.6);
cameraSystem = new CameraSystem(camera, bus.group);
cameraSystem.setMode("driver");
await new Promise(r => setTimeout(r, 50));
// NPC + TRAFFIC
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
maxVehicles: 21 // PATCH: +40% (was 15)
});
await new Promise(r => setTimeout(r, 50));
// PASSENGERS
ui.setLoading("Hành khách...", 0.8);
passengerSystem = createPassengerSystem({ scene, map, npc, bus, ui });
await new Promise(r => setTimeout(r, 50));
// EVENTS
initInput();
setupMenuEvents();
window.addEventListener("resize", onResize, { passive: true });
// Load and apply saved settings
const savedSettings = ui.loadSettings();
if (savedSettings) {
Object.assign(gameSettings, savedSettings);
applySettingsToGame(savedSettings);
}
ui.hideLoading();
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
ui.toast("📖 W: Ga | SHIFT+W: Tăng tốc | S: Phanh | Space: Phanh gấp | A/D: Lái | C: Camera | F: Đèn | J: Cửa | K: Đón khách | P: Bay | /: Console");
});
document.getElementById("btn-exit")?.addEventListener("click", () => {
if (confirm("Bạn có chắc muốn thoát?")) {
window.close();
document.body.innerHTML = `
<div style="text-align:center;padding:40px;font-family:sans-serif;">
<h1>🚌 Cảm ơn đã chơi CoachVN!</h1>
<p>CoachVN v${MAIN_VERSION}</p>
</div>
`;
}
});
document.getElementById("btn-resume")?.addEventListener("click", () => {
togglePause();
});
document.getElementById("btn-quit")?.addEventListener("click", () => {
if (confirm("Bạn có chắc muốn thoát?")) {
window.close();
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
const settings = ui.applySettings();
if (settings) {
Object.assign(gameSettings, settings);
applySettingsToGame(settings);
}
document.getElementById("settings-panel")?.classList.remove("visible");
ui.toast("✅ Đã áp dụng cài đặt");
});
document.getElementById("btn-reset-settings")?.addEventListener("click", () => {
// Reset to defaults
const defaults = {
cameraSensitivity: 30,
mouseSensitivity: 30,
fov: 70,
outsideDistance: 12,
renderDistance: 8,
npcDensity: 2,
graphicsQuality: 'medium',
invertX: false,
invertY: false,
rayTracing: false,
uiScale: 100,
theme: 'dark'
};
const camSens = document.getElementById('cam-sensitivity');
if (camSens) camSens.value = defaults.cameraSensitivity;
const camSensVal = document.getElementById('cam-sens-value');
if (camSensVal) camSensVal.textContent = defaults.cameraSensitivity;
const mouseSens = document.getElementById('mouse-sensitivity');
if (mouseSens) mouseSens.value = defaults.mouseSensitivity;
const mouseSensVal = document.getElementById('mouse-sens-value');
if (mouseSensVal) mouseSensVal.textContent = defaults.mouseSensitivity;
const fov = document.getElementById('fov-slider');
if (fov) fov.value = defaults.fov;
const fovVal = document.getElementById('fov-value');
if (fovVal) fovVal.textContent = defaults.fov + '°';
const rd = document.getElementById('render-distance');
if (rd) rd.value = defaults.renderDistance;
const rdVal = document.getElementById('render-dist-value');
if (rdVal) rdVal.textContent = defaults.renderDistance;
const nd = document.getElementById('npc-density');
if (nd) nd.value = defaults.npcDensity;
const ndVal = document.getElementById('npc-density-value');
if (ndVal) ndVal.textContent = defaults.npcDensity;
const gq = document.getElementById('graphics-quality');
if (gq) gq.value = defaults.graphicsQuality;
const od = document.getElementById('outside-distance');
if (od) od.value = defaults.outsideDistance;
const odVal = document.getElementById('outside-dist-value');
if (odVal) odVal.textContent = defaults.outsideDistance + 'm';
const us = document.getElementById('ui-scale');
if (us) us.value = defaults.uiScale;
const usVal = document.getElementById('ui-scale-value');
if (usVal) usVal.textContent = defaults.uiScale + '%';
const ix = document.getElementById('invert-x');
if (ix) ix.checked = defaults.invertX;
const iy = document.getElementById('invert-y');
if (iy) iy.checked = defaults.invertY;
const rt = document.getElementById('ray-tracing-toggle');
if (rt) rt.checked = defaults.rayTracing;
ui.toast("✅ Đã khôi phục mặc định");
});
// Settings tabs
document.querySelectorAll(".settings-tab").forEach(tab => {
tab.addEventListener("click", () => {
document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
tab.classList.add("active");
document.querySelectorAll(".settings-content").forEach(c => c.classList.remove("active"));
document.getElementById(`settings-${tab.dataset.tab}`)?.classList.add("active");
});
});
// Settings sliders - live update display values
const sliderConfigs = [
{ id: "cam-sensitivity", valueId: "cam-sens-value", suffix: "" },
{ id: "mouse-sensitivity", valueId: "mouse-sens-value", suffix: "" },
{ id: "fov-slider", valueId: "fov-value", suffix: "°" },
{ id: "ui-scale", valueId: "ui-scale-value", suffix: "%" },
{ id: "render-distance", valueId: "render-dist-value", suffix: "" },
{ id: "npc-density", valueId: "npc-density-value", suffix: "" },
{ id: "outside-distance", valueId: "outside-dist-value", suffix: "m" }
];
sliderConfigs.forEach(s => {
const slider = document.getElementById(s.id);
const valueEl = document.getElementById(s.valueId);
if (slider && valueEl) {
slider.addEventListener("input", () => {
const val = parseInt(slider.value);
valueEl.textContent = val + s.suffix;
});
}
});
// Save button
document.getElementById("btn-save")?.addEventListener("click", () => {
const state = {
camera: {
x: bus.group.position.x,
y: bus.group.position.y,
z: bus.group.position.z
},
clock: {
minutes: lighting ? lighting.getGameTime() : 360,
day: 1
},
gameState: {
money: 500000,
fuel: 0.8,
passengers: passengerSystem ? passengerSystem.getPassengerCount().onboard : 0,
passengerCapacity: 24
}
};
const result = saveGameState(state);
ui.toast(result.ok ? "✅ Đã lưu game" : "❌ Lỗi khi lưu");
});
document.getElementById("btn-main-menu")?.addEventListener("click", () => {
showMainMenu();
});
// Ray tracing toggle
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
// PATCH: Update bus (door animation, signal blinking)
if (bus && typeof bus.update === 'function') {
bus.update(delta);
}
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
const pCount = passengerSystem.getPassengerCount();
ui.update({
fps: fpsAverage.value,
speedKmh: vehiclePhysics.currentSpeedKmh,
fuel: 0.8,
money: 500000,
passengers: pCount.onboard,
passengerCapacity: pCount.max,
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