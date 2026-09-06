// js/traffic/TrafficManager.js - LOW END SURVIVAL (PROGRESSIVE SPAWN)
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
        this.spawnInterval = 10; // TỐI ƯU: Spawn cực chậm (10s/lần) để không gây lag
        this.lastPlayerPos = { x: 0, z: 0 };
        this.lastPlayerHeading = 0;
        this.isGraphMode = (roadGraph && Array.isArray(roadGraph.segments) && Array.isArray(roadGraph.nodes));
        if (!this.isGraphMode) console.warn("⚠️ TrafficManager: roadGraph không hợp lệ");
        this._nodeMap = new Map();
        this._validSegsCache = null;
        // TỐI ƯU: KHÔNG SPAWN GÌ KHI VÀO GAME, ĐỂ NGƯỜI CHƠI CHẠY ĐƯỢC TRƯỚC
    }
    _spawnInitialTraffic() { /* ĐÃ TẮT */ }
    _getSegmentPoints(seg) {
        if (!seg || !this.isGraphMode) return null;
        if (this._nodeMap.size === 0 && this.roadGraph.nodes) {
            if (this.roadGraph.nodes instanceof Map) {
                this._nodeMap = this.roadGraph.nodes;
            } else {
                for (const n of this.roadGraph.nodes) {
                    this._nodeMap.set(n.id, n);
                }
            }
        }
        const fromNode = this._nodeMap.get(seg.from);
        const toNode = this._nodeMap.get(seg.to);
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
        if (!this._validSegsCache) {
            this._validSegsCache = this.roadGraph.segments.filter(s => {
                if (!s) return false;
                if (s.type === 'tunnel' || s.type === 'bus_station_road') return false;
                return this._getSegmentPoints(s) !== null;
            });
        }
        const validSegs = this._validSegsCache;
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
        const maxActive = settings.maxActiveTraffic || 5; // TỐI ƯU: GIỚI HẠN TỐI ĐA 5 XE AI
        const spawnDist = settings.spawnDistance || 200;
        const despawnDist = settings.despawnDistance || 400;
        const toRemove = [];
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const ai = this.aiVehicles[i];
            const dist = Math.hypot(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);
            if (dist > despawnDist) { toRemove.push(i); continue; }
            const updateDelta = dist > spawnDist * 0.6 ? deltaTime * 0.5 : deltaTime;
            ai.update(updateDelta, playerPos, this.aiVehicles);
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
        if (!window.collisionSystem) return;
        const hit = window.collisionSystem.check(ai.collider.x, ai.collider.z, ai.collider.r, ai.colId, ['npc']);
        if (hit && hit.data?.ai) {
            const other = hit.data.ai;
            const dx = other.collider.x - ai.collider.x;
            const dz = other.collider.z - ai.collider.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.01 && dist < 2.5) {
                const push = (2.5 - dist) * 0.5;
                ai.collider.x -= (dx / dist) * push; 
                ai.collider.z -= (dz / dist) * push;
                other.collider.x += (dx / dist) * push; 
                other.collider.z += (dz / dist) * push;
                ai.speed *= 0.8;
            }
        }
    }
    _onSettingsChanged() {
        const s = this.graphics.settings;
        this.maxVehicles = s.maxActiveTraffic * 1.5;
        this.spawnInterval = 10 / (s.trafficDensity + 0.1);
    }
    getActiveVehicles() { return this.aiVehicles.filter(ai => ai.active); }
    getColliders() { return this.aiVehicles.map(ai => ai.collider); }
    getVehicleCount() { return this.aiVehicles.length; }
    getActiveCount() { return this.activeCount; }
    dispose() { this.aiVehicles.forEach(ai => ai.dispose()); this.aiVehicles = []; this.pool = []; this.activeCount = 0; }
}
export function createTrafficManager(options) { return new TrafficManager(options); }