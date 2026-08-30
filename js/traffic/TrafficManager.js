// js/traffic/TrafficManager.js - Quản lý traffic streaming + density control
import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "../bus.js";
import { TrafficAI, DRIVER_PERSONALITY, AI_STATE } from "./TrafficAI.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { createSeededRandom } from "../utils.js";

export class TrafficManager {
constructor({
scene,
roadGraph,
busSlots = [],
maxVehicles = 21, // PATCH: +40% (was 15)
playerRef = null,
}) {
this.scene = scene;
this.roadGraph = roadGraph;
this.busSlots = busSlots;
this.playerRef = playerRef;
this.baseMaxVehicles = maxVehicles; // PATCH: Store base for density scaling
this.maxVehicles = maxVehicles;
this.aiVehicles = [];
this.pool = [];
this.activeCount = 0;
this.seed = Date.now();
this.random = createSeededRandom(this.seed);
this.graphics = getGraphicsSettings();
this.graphics.onChange(() => this._onSettingsChanged());
loadNpcSkinList();
this._spawnInitialTraffic();
this.spawnTimer = 0;
this.spawnInterval = 2;
this.lastPlayerPos = { x: 0, z: 0 };
this.currentAreaType = 'highway';
// PATCH: Traffic density multiplier (1.0 = default, affected by settings)
this.densityMultiplier = 1.0;
}
// ====== DENSITY CONTROL ======
setDensity(level) {
// level: 'low', 'medium', 'high', 'ultra'
const densities = { 'low': 0.5, 'medium': 1.0, 'high': 1.5, 'ultra': 2.0 };
this.densityMultiplier = densities[level] || 1.0;
this.maxVehicles = Math.floor(this.baseMaxVehicles * this.densityMultiplier);
// Force spawn check
this.spawnTimer = this.spawnInterval;
console.log(`🚦 Traffic density set to ${level} (${this.densityMultiplier}x), maxVehicles: ${this.maxVehicles}`);
}
// ====== SPAWN ======
_spawnInitialTraffic() {
const count = Math.min(8, Math.floor(this.maxVehicles * 0.3));
for (let i = 0; i < count; i++) {
this._spawnVehicle(this.lastPlayerPos);
}
}
_spawnVehicle(playerPos) {
if (!playerPos) return null;
if (this.aiVehicles.length >= this.maxVehicles) return null;
let vehicle = this.pool.pop();
if (!vehicle) {
const skin = pickNpcSkinPath() || null;
const ledColor = pickLedColor();
vehicle = createNpcBus({ skinPath: skin, ledColor });
this.scene.add(vehicle.group);
}
const settings = this.graphics.settings;
const spawnDist = settings.spawnDistance || 200;
// 1. Tìm segments gần player
const candidates = [];
for (let i = 0; i < this.roadGraph.length; i++) {
const seg = this.roadGraph[i];
const p0 = seg.points[0];
const p1 = seg.points[1];
const cx = (p0.x + p1.x) / 2;
const cz = (p0.z + p1.z) / 2;
const dist = Math.hypot(cx - playerPos.x, cz - playerPos.z);
if (dist < spawnDist) {
candidates.push({ index: i, dist: dist, seg: seg });
}
}
if (candidates.length === 0) {
this.pool.push(vehicle);
return null;
}
// PATCH: Density theo loại segment
const personalities = ['NORMAL', 'CAREFUL', 'AGGRESSIVE', 'RANDOM'];
let ai = null;
let validSpawn = false;
// 2. Thử spawn tối đa 5 lần để tránh đè lên xe khác
for (let attempt = 0; attempt < 5; attempt++) {
const candidate = candidates[Math.floor(this.random() * candidates.length)];
const segIndex = candidate.index;
const seg = candidate.seg;
// Density theo loại segment
let densityMod = 1.0;
const segType = seg.type || 'highway';
if (segType === 'urban') densityMod = 1.5;
else if (segType === 'highway') densityMod = 1.0;
else if (segType === 'mountain') densityMod = 0.5;
else if (segType === 'tunnel') densityMod = 0.3;
else if (segType === 'bus_station_road') densityMod = 0.8;
// Apply density multiplier from settings
densityMod *= this.densityMultiplier;
// Skip if density check fails
if (this.random() > densityMod) {
continue;
}
const personality = personalities[Math.floor(this.random() * personalities.length)];
ai = new TrafficAI({
vehicle: vehicle,
roadGraph: this.roadGraph,
personality: personality,
seed: this.seed + this.aiVehicles.length + attempt,
});
ai.currentSegmentIndex = segIndex;
ai.progress = 0.1 + this.random() * 0.8;
ai.laneOffset = -0.3 * (seg.width || 10);
ai.targetLaneOffset = ai.laneOffset;
ai._updatePositionFromSegment();
// Kiểm tra overlap
let tooClose = false;
for (const other of this.aiVehicles) {
const dx = other.collider.x - ai.collider.x;
const dz = other.collider.z - ai.collider.z;
if (Math.hypot(dx, dz) < 5) {
tooClose = true;
break;
}
}
if (!tooClose) {
validSpawn = true;
break;
}
}
if (!validSpawn || !ai) {
this.pool.push(vehicle);
return null;
}
// 3. Đặt hướng và tốc độ
ai.heading = ai._getSegmentHeading(ai.currentSegmentIndex);
ai.targetHeading = ai.heading;
ai.speed = (3 + this.random() * 5) * (0.5 + this.random() * 0.5);
ai.targetSpeed = ai.speed;
this.aiVehicles.push(ai);
this.activeCount++;
return ai;
}
// ====== UPDATE ======
update(deltaTime, playerPos) {
if (!playerPos) return;
this.lastPlayerPos = playerPos;
const settings = this.graphics.settings;
const maxActive = Math.min(this.maxVehicles, settings.maxActiveTraffic || 30);
const spawnDist = settings.spawnDistance || 200;
const despawnDist = settings.despawnDistance || 400;
// Tạo collider giả cho player
const playerCollider = this.playerRef && this.playerRef.group
? { x: this.playerRef.group.position.x,
z: this.playerRef.group.position.z,
r: 1.4,
speed: 0,
collider: { x: this.playerRef.group.position.x,
z: this.playerRef.group.position.z } }
: null;
const allWithPlayer = playerCollider
? this.aiVehicles.concat(playerCollider)
: this.aiVehicles;
// 1. Cập nhật AI
const toRemove = [];
for (let i = 0; i < this.aiVehicles.length; i++) {
const ai = this.aiVehicles[i];
const dist = Math.hypot(
ai.collider.x - playerPos.x,
ai.collider.z - playerPos.z
);
if (dist > despawnDist) {
toRemove.push(i);
continue;
}
if (dist > spawnDist * 0.6) {
ai.update(deltaTime * 0.5, playerPos, allWithPlayer);
} else {
ai.update(deltaTime, playerPos, allWithPlayer);
}
this._checkCollision(ai);
}
// Xóa xe đã despawn
for (let i = toRemove.length - 1; i >= 0; i--) {
const idx = toRemove[i];
const ai = this.aiVehicles[idx];
ai.setActive(false);
this.pool.push(ai.vehicle);
this.aiVehicles.splice(idx, 1);
this.activeCount--;
}
// 2. Spawn thêm xe nếu cần
this.spawnTimer += deltaTime;
if (this.activeCount < maxActive && this.spawnTimer > this.spawnInterval) {
this.spawnTimer = 0;
const spawnChance = (settings.trafficDensity || 0.5) * 0.1 * this.densityMultiplier;
if (this.random() < spawnChance) {
this._spawnVehicle(playerPos);
}
}
// 3. Cập nhật active status
for (const ai of this.aiVehicles) {
const dist = Math.hypot(
ai.collider.x - playerPos.x,
ai.collider.z - playerPos.z
);
const active = dist < settings.renderDistance * 16 * 0.8;
ai.setActive(active);
}
}
// ====== COLLISION ======
_checkCollision(ai) {
for (const other of this.aiVehicles) {
if (other === ai) continue;
const dx = other.collider.x - ai.collider.x;
const dz = other.collider.z - ai.collider.z;
const dist = Math.hypot(dx, dz);
const minDist = 2.5;
if (dist < minDist && dist > 0.01) {
const push = (minDist - dist) * 0.5;
const nx = dx / dist;
const nz = dz / dist;
ai.collider.x -= nx * push;
ai.collider.z -= nz * push;
other.collider.x += nx * push;
other.collider.z += nz * push;
ai.speed *= 0.8;
}
}
}
// ====== SETTINGS ======
_onSettingsChanged() {
const settings = this.graphics.settings;
this.spawnInterval = 2 / ((settings.trafficDensity || 0.5) + 0.1);
if (this.lastPlayerPos) {
const dist = settings.renderDistance * 16;
for (const ai of this.aiVehicles) {
const d = Math.hypot(
ai.collider.x - this.lastPlayerPos.x,
ai.collider.z - this.lastPlayerPos.z
);
ai.setActive(d < dist * 0.8);
}
}
}
// ====== GETTERS ======
getActiveVehicles() {
return this.aiVehicles.filter(ai => ai.active);
}
getColliders() {
return this.aiVehicles.map(ai => ai.collider);
}
getVehicleCount() {
return this.aiVehicles.length;
}
getActiveCount() {
return this.activeCount;
}
getMaxVehicles() {
return this.maxVehicles;
}
// ====== CLEANUP ======
dispose() {
for (const ai of this.aiVehicles) {
ai.dispose();
}
this.aiVehicles = [];
this.pool = [];
this.activeCount = 0;
}
}
// Factory function
export function createTrafficManager(options) {
return new TrafficManager(options);
}