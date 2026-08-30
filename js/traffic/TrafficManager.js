// js/traffic/TrafficManager.js - SỬA: TÍCH HỢP BUS TRAFFIC MANAGER
// BusTrafficManager xử lý NPC bus (chủ yếu)
// TrafficManager cũ xử lý vehicle types khác

import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "../bus.js";
import { TrafficAI, DRIVER_PERSONALITY, AI_STATE } from "./TrafficAI.js";
import { BusTrafficManager, BUS_TRAFFIC_CONFIG } from "./BusTrafficManager.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { createSeededRandom } from "../utils.js";

export class TrafficManager {
    constructor({
        scene,
        roadGraph,
        busSlots = [],
        maxVehicles = 60,
        playerRef = null,
    }) {
        this.scene = scene;
        this.roadGraph = roadGraph;
        this.busSlots = busSlots;
        this.playerRef = playerRef;
        this.maxVehicles = maxVehicles;
        
        // ===== BUS TRAFFIC MANAGER (MỚI) =====
        // Xử lý NPC bus - ưu tiên cao nhất
        this.busTrafficManager = new BusTrafficManager({
            scene: scene,
            roadGraph: roadGraph,
            playerRef: playerRef,
            config: {
                ...BUS_TRAFFIC_CONFIG,
                maxActiveBuses: Math.floor(maxVehicles * 0.7), // 70% là bus
                maxActiveOthers: Math.floor(maxVehicles * 0.3), // 30% khác
            }
        });
        
        // ===== OLD SYSTEM (cho vehicle types khác) =====
        this.aiVehicles = []; // Other vehicle types (car, truck, motorcycle)
        this.pool = [];
        this.activeCount = 0;
        this.seed = Date.now();
        this.random = createSeededRandom(this.seed);
        
        // Graphics settings
        this.graphics = getGraphicsSettings();
        this.graphics.onChange(() => this._onSettingsChanged());
        
        // Load skins
        loadNpcSkinList();
        
        // Spawn initial traffic (non-bus)
        this._spawnInitialTraffic();
        
        // Update timer
        this.spawnTimer = 0;
        this.spawnInterval = 4; // Interval dài hơn vì bus đã spawn riêng
        this.lastPlayerPos = { x: 0, z: 0 };
        
        console.log("🚦 TrafficManager initialized (with BusTrafficManager)");
    }
    
    // ====== UPDATE ======
    update(deltaTime, playerPos) {
        if (!playerPos) return;
        this.lastPlayerPos = playerPos;
        
        // 1. Update Bus Traffic Manager (NPC bus)
        this.busTrafficManager.update(deltaTime, playerPos);
        
        // 2. Update other vehicles
        this._updateOtherVehicles(deltaTime, playerPos);
        
        // 3. Spawn other vehicles (thỉnh thoảng)
        this.spawnTimer += deltaTime;
        if (this.spawnTimer > this.spawnInterval) {
            this.spawnTimer = 0;
            this._trySpawnOtherVehicle(playerPos);
        }
    }
    
    _updateOtherVehicles(deltaTime, playerPos) {
        const settings = this.graphics.settings;
        const maxActive = Math.floor(settings.maxActiveTraffic * 0.3); // Chỉ 30% cho non-bus
        const despawnDist = settings.despawnDistance || 400;
        
        const toRemove = [];
        
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const ai = this.aiVehicles[i];
            const dist = Math.hypot(
                ai.collider.x - playerPos.x,
                ai.collider.z - playerPos.z
            );
            
            // Despawn nếu quá xa
            if (dist > despawnDist) {
                toRemove.push(i);
                continue;
            }
            
            // LOD: giảm update khi xa
            if (dist > 200) {
                ai.update(deltaTime * 0.5, playerPos, this.aiVehicles);
            } else {
                ai.update(deltaTime, playerPos, this.aiVehicles);
            }
            
            // Collision check đơn giản
            this._checkCollision(ai);
        }
        
        // Remove despawned
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const idx = toRemove[i];
            const ai = this.aiVehicles[idx];
            ai.setActive(false);
            this.pool.push(ai.vehicle);
            this.aiVehicles.splice(idx, 1);
            this.activeCount--;
        }
    }
    
    _trySpawnOtherVehicle(playerPos) {
        const settings = this.graphics.settings;
        const maxActive = Math.floor((settings.maxActiveTraffic || 30) * 0.3);
        
        if (this.aiVehicles.length >= maxActive) return;
        
        // Chỉ spawn nếu density cho phép
        const spawnChance = (settings.trafficDensity || 0.5) * 0.3;
        if (this.random() > spawnChance) return;
        
        this._spawnVehicle();
    }
    
    // ====== SPAWN (Other Vehicles) ======
    _spawnInitialTraffic() {
        // Chỉ spawn vài xe ban đầu (bus đã spawn riêng)
        const count = Math.min(3, Math.floor(this.maxVehicles * 0.05));
        for (let i = 0; i < count; i++) {
            this._spawnVehicle();
        }
    }
    
    _spawnVehicle(options = {}) {
        // Get from pool hoặc create mới
        let vehicle = this.pool.pop();
        if (!vehicle) {
            const skin = pickNpcSkinPath() || null;
            const ledColor = pickLedColor();
            vehicle = createNpcBus({ skinPath: skin, ledColor });
            this.scene.add(vehicle.group);
        }
        
        // Chọn segment
        const segIndex = Math.floor(this.random() * this.roadGraph.length);
        const seg = this.roadGraph[segIndex];
        if (!seg) {
            this.pool.push(vehicle);
            return null;
        }
        
        // Personality
        const personalities = ['NORMAL', 'CAREFUL', 'AGGRESSIVE', 'RANDOM'];
        const personality = personalities[Math.floor(this.random() * personalities.length)];
        
        // Tạo AI
        const ai = new TrafficAI({
            vehicle: vehicle,
            roadGraph: this.roadGraph,
            personality: personality,
            seed: this.seed + this.aiVehicles.length,
        });
        
        // Set vị trí
        ai.currentSegmentIndex = segIndex;
        ai.progress = 0.1 + this.random() * 0.8;
        ai._updatePositionFromSegment();
        ai.heading = ai._getSegmentHeading(segIndex);
        ai.targetHeading = ai.heading;
        ai.speed = (3 + this.random() * 5) * (0.5 + this.random() * 0.5);
        ai.targetSpeed = ai.speed;
        
        // Lane offset
        ai.laneOffset = (this.random() - 0.5) * 1.5;
        ai.targetLaneOffset = ai.laneOffset;
        
        // Save
        this.aiVehicles.push(ai);
        this.activeCount++;
        
        return ai;
    }
    
    _checkCollision(ai) {
        // Đơn giản: check với các xe khác trong aiVehicles
        for (const other of this.aiVehicles) {
            if (other === ai) continue;
            
            const dx = ai.collider.x - other.collider.x;
            const dz = ai.collider.z - other.collider.z;
            const distSq = dx * dx + dz * dz;
            const minDist = ai.collider.r + other.collider.r;
            
            if (distSq < minDist * minDist) {
                // Simple push apart
                const dist = Math.sqrt(distSq) || 0.01;
                const pushX = (dx / dist) * (minDist - dist) * 0.5;
                const pushZ = (dz / dist) * (minDist - dist) * 0.5;
                
                ai.vehicle.group.position.x += pushX;
                ai.vehicle.group.position.z += pushZ;
                other.vehicle.group.position.x -= pushX;
                other.vehicle.group.position.z -= pushZ;
            }
        }
    }
    
    _onSettingsChanged() {
        // Update bus traffic manager settings
        if (this.busTrafficManager) {
            this.busTrafficManager._onSettingsChanged();
        }
        
        // Update other vehicle settings
        const settings = this.graphics.settings;
        console.log(`🚦 Traffic settings updated. Max: ${settings.maxActiveTraffic}`);
    }
    
    // ====== API ======
    
    /**
     * Get ALL colliders (bus + other) cho collision system
     */
    getColliders() {
        const colliders = [];
        
        // Bus colliders (từ BusTrafficManager)
        const busColliders = this.busTrafficManager.getColliders();
        colliders.push(...busColliders);
        
        // Other vehicle colliders
        for (const ai of this.aiVehicles) {
            if (ai.collider && ai.vehicle?.group?.visible) {
                colliders.push({
                    x: ai.collider.x,
                    z: ai.collider.z,
                    r: ai.collider.r,
                    type: 'OTHER',
                    ai: ai
                });
            }
        }
        
        return colliders;
    }
    
    /**
     * Get bus traffic manager (để access trực tiếp)
     */
    getBusTrafficManager() {
        return this.busTrafficManager;
    }
    
    /**
     * Get debug info
     */
    getDebugInfo() {
        const busInfo = this.busTrafficManager.getDebugInfo();
        
        return {
            buses: busInfo,
            otherVehicles: this.aiVehicles.length,
            total: this.aiVehicles.length + busInfo.activeBuses
        };
    }
    
    /**
     * Dispose
     */
    dispose() {
        // Dispose bus traffic manager
        if (this.busTrafficManager) {
            this.busTrafficManager.dispose();
        }
        
        // Dispose other vehicles
        for (const ai of this.aiVehicles) {
            ai.dispose();
        }
        this.aiVehicles = [];
        
        // Dispose pool
        for (const vehicle of this.pool) {
            this.scene.remove(vehicle.group);
            if (vehicle.dispose) vehicle.dispose();
        }
        this.pool = [];
        
        console.log("🚦 TrafficManager disposed");
    }
}

// ============================================================
// FACTORY FUNCTION - THÊM VÀO CUỐI FILE
// ============================================================

export function createTrafficManager(options) {
    return new TrafficManager(options);
}