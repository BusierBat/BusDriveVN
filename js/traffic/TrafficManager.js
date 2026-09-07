// js/traffic/TrafficManager.js - SMART SPAWN & EXACT PARKING (NULL-SAFE)
import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "../bus.js";
import { TrafficAI, DRIVER_PERSONALITY, AI_STATE } from "./TrafficAI.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { createSeededRandom } from "../utils.js";

export class TrafficManager {
    constructor({ scene, roadGraph, busSlots = [], maxVehicles = 60, playerRef = null }) {
        this.scene = scene;
        this.roadGraph = roadGraph;
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
        this.isGraphMode = (roadGraph && Array.isArray(roadGraph.segments) && Array.isArray(roadGraph.nodes));
        this._nodeMap = new Map();
        this._validSegsCache = null;
        this.MIN_TRAFFIC_SPAWN_DISTANCE = 50;
        this.stationSpawnQueue = []; 
    }
    
    _getSegmentPoints(seg) {
        if (!seg || !this.isGraphMode) return null;
        if (this._nodeMap.size === 0 && this.roadGraph.nodes) {
            if (this.roadGraph.nodes instanceof Map) this._nodeMap = this.roadGraph.nodes;
            else for (const n of this.roadGraph.nodes) this._nodeMap.set(n.id, n);
        }
        const f = this._nodeMap.get(seg.from), t = this._nodeMap.get(seg.to);
        if (f?.position?.x !== undefined && t?.position?.x !== undefined) return { p0: f.position, p1: t.position };
        return null;
    }
    
    _spawnVehicle() {
        if (!this.isGraphMode) return null;
        let vehicle = this.pool.pop();
        if (!vehicle) { vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() }); this.scene.add(vehicle.group); }
        
        if (!this._validSegsCache) {
            this._validSegsCache = this.roadGraph.segments.filter(s => {
                if (!s || s.type === 'tunnel' || s.type === 'bus_station_road') return false;
                return this._getSegmentPoints(s) !== null;
            });
        }
        if (this._validSegsCache.length === 0) return null;
        
        let candidate = null;
        for (let i = 0; i < 15; i++) {
            const seg = this._validSegsCache[Math.floor(this.random() * this._validSegsCache.length)];
            const dir = seg.twoWay ? Math.floor(this.random() * 2) : 0;
            const pts = this._getSegmentPoints(seg); if (!pts) continue;
            const p0 = dir === 0 ? pts.p0 : pts.p1, p1 = dir === 0 ? pts.p1 : pts.p0;
            const progress = 0.2 + this.random() * 0.6;
            const x = p0.x + (p1.x - p0.x) * progress, z = p0.z + (p1.z - p0.z) * progress;
            const distPlayer = Math.hypot(x - this.lastPlayerPos.x, z - this.lastPlayerPos.z);
            if (distPlayer < 150 || distPlayer > 500) continue;
            let tooClose = false;
            for (const other of this.aiVehicles) { if (Math.hypot(x - other.collider.x, z - other.collider.z) < this.MIN_TRAFFIC_SPAWN_DISTANCE) { tooClose = true; break; } }
            if (tooClose) continue;
            candidate = { seg, dir, progress, x, z }; break;
        }
        if (!candidate) return null;
        
        const ai = new TrafficAI({ vehicle, roadGraph: this.roadGraph, personality: ['NORMAL', 'CAREFUL', 'AGGRESSIVE'][Math.floor(this.random() * 3)], seed: this.seed + this.aiVehicles.length });
        ai.currentSegmentId = candidate.seg.id; ai.direction = candidate.dir; ai.progress = candidate.progress;
        ai.laneOffset = ai._calcLaneOffset(candidate.seg, candidate.dir); ai._updatePositionFromSegment();
        ai.heading = ai._getSegmentHeading(); ai.targetHeading = ai.heading;
        ai.speed = 10 + this.random() * 10; ai.targetSpeed = ai.speed; ai.setActive(true);
        if (window.collisionSystem) ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai: ai });
        this.aiVehicles.push(ai); this.activeCount++; return ai;
    }
    
    // SMART STATION SPAWN: Kiểm tra null an toàn tuyệt đối
    setupStationTraffic(stationNode) {
        if (!stationNode || !stationNode._parkingTransforms || stationNode._parkingTransforms.length === 0) {
            console.warn("⚠️ Station node không hợp lệ hoặc không có parking transforms:", stationNode?.id);
            return;
        }
        for (const t of stationNode._parkingTransforms) {
            this.stationSpawnQueue.push({ transform: t, parkTimer: 5 + Math.random() * 30 });
        }
    }
    
    processStationQueue() {
        if (this.stationSpawnQueue.length === 0) return;
        const batchSize = Math.min(2, this.stationSpawnQueue.length);
        for (let i = 0; i < batchSize; i++) {
            const req = this.stationSpawnQueue.shift();
            let vehicle = this.pool.pop();
            if (!vehicle) { vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() }); this.scene.add(vehicle.group); }
            
            const ai = new TrafficAI({ vehicle, roadGraph: this.roadGraph, personality: 'NORMAL', seed: this.seed + this.aiVehicles.length, isParked: true, parkTimer: req.parkTimer });
            ai.collider.x = req.transform.x; ai.collider.z = req.transform.z;
            ai.heading = req.transform.heading; ai.targetHeading = ai.heading;
            ai.vehicle.group.position.set(ai.collider.x, 0.5, ai.collider.z);
            ai.vehicle.group.rotation.y = ai.heading;
            ai.setActive(true);
            if (window.collisionSystem) ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai: ai });
            this.aiVehicles.push(ai); this.activeCount++;
        }
    }
    
    update(deltaTime, playerPos) {
        if (!playerPos || !this.isGraphMode) return;
        this.lastPlayerPos = playerPos;
        const settings = this.graphics.settings;
        const maxActive = Math.min(settings.maxActiveTraffic || 10, this.maxVehicles);
        
        this.processStationQueue();
        
        const toRemove = [];
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const ai = this.aiVehicles[i];
            if (ai.state === AI_STATE.PARKED) continue;
            const dist = Math.hypot(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);
            if (dist > 600) { toRemove.push(i); continue; }
            ai.update(Math.min(deltaTime, 0.1), playerPos, this.aiVehicles);
            if (window.collisionSystem && ai.colId) window.collisionSystem.update(ai.colId, ai.collider.x, ai.collider.z);
            this._checkCollision(ai);
        }
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const idx = toRemove[i]; const ai = this.aiVehicles[idx]; ai.setActive(false); this.pool.push(ai.vehicle);
            if (window.collisionSystem && ai.colId) window.collisionSystem.remove(ai.colId);
            this.aiVehicles.splice(idx, 1); this.activeCount--;
        }
        this.spawnTimer += deltaTime;
        if (this.activeCount < maxActive && this.spawnTimer > this.spawnInterval) { this.spawnTimer = 0; this._spawnVehicle(); }
    }
    _checkCollision(ai) {
        if (!window.collisionSystem) return;
        const hit = window.collisionSystem.check(ai.collider.x, ai.collider.z, ai.collider.r, ai.colId, ['npc']);
        if (hit && hit.data?.ai) {
            const other = hit.data.ai; const dx = other.collider.x - ai.collider.x, dz = other.collider.z - ai.collider.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.01 && dist < 3.0) {
                const push = (3.0 - dist) * 0.5;
                ai.collider.x -= (dx / dist) * push; ai.collider.z -= (dz / dist) * push;
                other.collider.x += (dx / dist) * push; other.collider.z += (dz / dist) * push; ai.speed *= 0.8;
            }
        }
    }
    _onSettingsChanged() { this.maxVehicles = this.graphics.settings.maxActiveTraffic * 1.5; }
    getActiveVehicles() { return this.aiVehicles.filter(ai => ai.active); }
    getColliders() { return this.aiVehicles.map(ai => ai.collider); }
    getVehicleCount() { return this.aiVehicles.length; }
    getActiveCount() { return this.activeCount; }
    dispose() { this.aiVehicles.forEach(ai => ai.dispose()); this.aiVehicles = []; this.pool = []; this.activeCount = 0; }
}
export function createTrafficManager(options) { return new TrafficManager(options); }