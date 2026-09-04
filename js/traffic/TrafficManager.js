// js/traffic/TrafficManager.js - Smart Spawn, Spacing, LOD, Collision Integration
import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "../bus.js";
import { TrafficAI, DRIVER_PERSONALITY, AI_STATE } from "./TrafficAI.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { createSeededRandom } from "../utils.js";

export class TrafficManager {
  constructor({ scene, roadGraph, busSlots = [], maxVehicles = 60, playerRef = null }) {
    this.scene = scene;
    this.roadGraph = roadGraph;
    this.busSlots = busSlots;
    this.playerRef = playerRef;
    this.maxVehicles = maxVehicles;
    this.aiVehicles = [];
    this.pool = [];
    this.activeCount = 0;
    this.seed = Date.now();
    this.random = createSeededRandom(this.seed);

    this.graphics = getGraphicsSettings();
    this.graphics.onChange(() => this._onSettingsChanged());
    loadNpcSkinList();

    this.spawnTimer = 0;
    this.spawnInterval = 2;
    this.lastPlayerPos = { x: 0, z: 0 };
    this.lastPlayerHeading = 0;

    this.isGraphMode = (roadGraph && Array.isArray(roadGraph.segments) && Array.isArray(roadGraph.nodes));
    if (!this.isGraphMode) console.warn("⚠️ TrafficManager: roadGraph không hợp lệ");

    this._spawnInitialTraffic();
  }

  _spawnInitialTraffic() {
    if (!this.isGraphMode) return;
    const count = Math.min(8, this.graphics.getMaxActiveTraffic() * 0.3);
    for (let i = 0; i < count; i++) this._spawnVehicle();
  }

  _getSegmentPoints(seg) {
    if (!seg || !this.isGraphMode) return null;
    const fromNode = this.roadGraph.nodes.find(n => n.id === seg.from);
    const toNode = this.roadGraph.nodes.find(n => n.id === seg.to);
    if (fromNode?.position?.x !== undefined && toNode?.position?.x !== undefined) {
      return { p0: fromNode.position, p1: toNode.position };
    }
    return null;
  }

  _spawnVehicle() {
    if (!this.isGraphMode) return null;
    let vehicle = this.pool.pop();
    if (!vehicle) {
      vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
      this.scene.add(vehicle.group);
    }

    let candidate = null;
    const validSegs = this.roadGraph.segments.filter(s => {
      if (!s) return false;
      if (s.type === 'tunnel' || s.type === 'bus_station_road') return false;
      return this._getSegmentPoints(s) !== null;
    });

    if (validSegs.length === 0) { this.pool.push(vehicle); return null; }

    for (let i = 0; i < 10; i++) {
      const seg = validSegs[Math.floor(this.random() * validSegs.length)];
      const dir = seg.twoWay ? Math.floor(this.random() * 2) : 0;
      const pts = this._getSegmentPoints(seg);
      if (!pts) continue;

      const p0 = dir === 0 ? pts.p0 : pts.p1;
      const p1 = dir === 0 ? pts.p1 : pts.p0;
      const progress = 0.1 + this.random() * 0.8;
      const x = p0.x + (p1.x - p0.x) * progress;
      const z = p0.z + (p1.z - p0.z) * progress;

      const distPlayer = Math.hypot(x - this.lastPlayerPos.x, z - this.lastPlayerPos.z);
      // FIX: Spawn trên toàn tuyến (150m - 450m) thay vì chỉ gần bến
      if (distPlayer < 150 || distPlayer > 450) continue;

      const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const countOnSeg = this.aiVehicles.filter(a => a.currentSegmentId === seg.id).length;
      const maxDensity = Math.max(2, Math.floor(segLen / 100));
      if (countOnSeg >= maxDensity) continue;

      let overlap = false;
      for (const other of this.aiVehicles) {
        if (Math.hypot(x - other.collider.x, z - other.collider.z) < 25) { overlap = true; break; }
      }
      if (overlap) continue;

      candidate = { seg, dir, progress, x, z };
      break;
    }

    if (!candidate) { this.pool.push(vehicle); return null; }

    const personalities = ['NORMAL', 'CAREFUL', 'AGGRESSIVE', 'RANDOM'];
    const ai = new TrafficAI({
      vehicle, roadGraph: this.roadGraph,
      personality: personalities[Math.floor(this.random() * personalities.length)],
      seed: this.seed + this.aiVehicles.length
    });

    ai.currentSegmentId = candidate.seg.id;
    ai.direction = candidate.dir;
    ai.progress = candidate.progress;
    ai.laneOffset = ai._calcLaneOffset(candidate.seg, candidate.dir);
    ai._updatePositionFromSegment();
    ai.heading = ai._getSegmentHeading();
    ai.targetHeading = ai.heading;
    ai.speed = (3 + this.random() * 5) * (0.5 + this.random() * 0.5);
    ai.targetSpeed = ai.speed;
    ai.setActive(true);

    if (window.collisionSystem) {
      ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai: ai });
    }

    this.aiVehicles.push(ai);
    this.activeCount++;
    return ai;
  }

  update(deltaTime, playerPos) {
    if (!playerPos || !this.isGraphMode) return;
    this.lastPlayerPos = playerPos;
    if (this.playerRef?.group) this.lastPlayerHeading = this.playerRef.group.rotation.y;
    
    const settings = this.graphics.settings;
    const maxActive = settings.maxActiveTraffic || 30;
    const spawnDist = settings.spawnDistance || 200;
    const despawnDist = settings.despawnDistance || 400;

    const toRemove = [];
    for (let i = 0; i < this.aiVehicles.length; i++) {
      const ai = this.aiVehicles[i];
      const dist = Math.hypot(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);
      
      if (dist > despawnDist) { toRemove.push(i); continue; }

      // LOD: Giảm update nếu ở xa
      const updateDelta = dist > spawnDist * 0.6 ? deltaTime * 0.5 : deltaTime;
      ai.update(updateDelta, playerPos, this.aiVehicles);
      
      // CẬP NHẬT VỊ TRÍ COLLIDER NPC
      if (window.collisionSystem && ai.colId) {
        window.collisionSystem.update(ai.colId, ai.collider.x, ai.collider.z);
      }
      
      this._checkCollision(ai);
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const ai = this.aiVehicles[idx];
      ai.setActive(false);
      this.pool.push(ai.vehicle);
      // XÓA COLLIDER NPC
      if (window.collisionSystem && ai.colId) window.collisionSystem.remove(ai.colId);
      this.aiVehicles.splice(idx, 1);
      this.activeCount--;
    }

    this.spawnTimer += deltaTime;
    if (this.activeCount < maxActive && this.spawnTimer > this.spawnInterval) {
      this.spawnTimer = 0;
      if (this.random() < settings.trafficDensity * 0.1) this._spawnVehicle();
    }

    for (const ai of this.aiVehicles) {
      const dist = Math.hypot(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);
      ai.setActive(dist < settings.renderDistance * 16 * 0.8);
    }
  }

  _checkCollision(ai) {
    for (const other of this.aiVehicles) {
      if (other === ai) continue;
      const dx = other.collider.x - ai.collider.x, dz = other.collider.z - ai.collider.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.5 && dist > 0.01) {
        const push = (2.5 - dist) * 0.5;
        ai.collider.x -= (dx / dist) * push; ai.collider.z -= (dz / dist) * push;
        other.collider.x += (dx / dist) * push; other.collider.z += (dz / dist) * push;
        ai.speed *= 0.8;
      }
    }
  }

  _onSettingsChanged() {
    const s = this.graphics.settings;
    this.maxVehicles = s.maxActiveTraffic * 1.5;
    this.spawnInterval = 2 / (s.trafficDensity + 0.1);
  }

  getActiveVehicles() { return this.aiVehicles.filter(ai => ai.active); }
  getColliders() { return this.aiVehicles.map(ai => ai.collider); }
  getVehicleCount() { return this.aiVehicles.length; }
  getActiveCount() { return this.activeCount; }
  dispose() { this.aiVehicles.forEach(ai => ai.dispose()); this.aiVehicles = []; this.pool = []; this.activeCount = 0; }
}

export function createTrafficManager(options) { return new TrafficManager(options); }