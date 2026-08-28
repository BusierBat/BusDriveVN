// js/traffic/TrafficManager.js - Quản lý traffic streaming theo player
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
        maxVehicles = 60,
        playerRef = null,
    }) {
        this.scene = scene;
        this.roadGraph = roadGraph;
        this.busSlots = busSlots;
        this.playerRef = playerRef;
        this.maxVehicles = maxVehicles;
        this.aiVehicles = [];
        this.pool = []; // Object pool cho xe đã tạo nhưng không dùng
        this.activeCount = 0;
        this.seed = Date.now();
        this.random = createSeededRandom(this.seed);
        
        // Graphics settings
        this.graphics = getGraphicsSettings();
        this.graphics.onChange(() => this._onSettingsChanged());
        
        // Load skins
        loadNpcSkinList();
        
        // Spawn initial traffic
        this._spawnInitialTraffic();
        
        // Update timer
        this.spawnTimer = 0;
        this.spawnInterval = 2;
        this.lastPlayerPos = { x: 0, z: 0 };
    }

    // ====== SPAWN ======
    _spawnInitialTraffic() {
        const count = Math.min(8, this.graphics.getMaxActiveTraffic() * 0.3);
        for (let i = 0; i < count; i++) {
            this._spawnVehicle();
        }
    }

    _spawnVehicle(options = {}) {
        // Lấy xe từ pool hoặc tạo mới
        let vehicle = this.pool.pop();
        if (!vehicle) {
            const skin = pickNpcSkinPath() || null;
            const ledColor = pickLedColor();
            vehicle = createNpcBus({ skinPath: skin, ledColor });
            this.scene.add(vehicle.group);
        }
        
        // Chọn segment ngẫu nhiên
        const segIndex = Math.floor(this.random() * this.roadGraph.length);
        const seg = this.roadGraph[segIndex];
        if (!seg) {
            this.pool.push(vehicle);
            return null;
        }
        
        // Personality ngẫu nhiên
        const personalities = ['NORMAL', 'CAREFUL', 'AGGRESSIVE', 'RANDOM'];
        const personality = personalities[Math.floor(this.random() * personalities.length)];
        
        // Tạo AI
        const ai = new TrafficAI({
            vehicle: vehicle,
            roadGraph: this.roadGraph,
            personality: personality,
            seed: this.seed + this.aiVehicles.length,
        });
        
        // Set vị trí trên segment
        ai.currentSegmentIndex = segIndex;
        ai.progress = 0.1 + this.random() * 0.8;
        ai._updatePositionFromSegment();
        ai.heading = ai._getSegmentHeading(segIndex);
        ai.targetHeading = ai.heading;
        ai.speed = (3 + this.random() * 5) * (0.5 + this.random() * 0.5);
        ai.targetSpeed = ai.speed;
        
        // Lane offset ngẫu nhiên
        ai.laneOffset = (this.random() - 0.5) * 1.5;
        ai.targetLaneOffset = ai.laneOffset;
        
        // Lưu
        this.aiVehicles.push(ai);
        this.activeCount++;
        
        return ai;
    }

    // ====== UPDATE ======
    update(deltaTime, playerPos) {
        if (!playerPos) return;
        
        this.lastPlayerPos = playerPos;
        const settings = this.graphics.settings;
        const maxActive = settings.maxActiveTraffic || 30;
        const spawnDist = settings.spawnDistance || 200;
        const despawnDist = settings.despawnDistance || 400;
        
        // 1. Cập nhật AI
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
            if (dist > spawnDist * 0.6) {
                // Chỉ update vị trí, không AI chi tiết
                ai.update(deltaTime * 0.5, playerPos, this.aiVehicles);
            } else {
                ai.update(deltaTime, playerPos, this.aiVehicles);
            }
            
            // Kiểm tra collision với các xe khác (đơn giản)
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
            const spawnChance = settings.trafficDensity * 0.1;
            if (this.random() < spawnChance) {
                this._spawnVehicle();
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
                // Push ra khỏi nhau
                const push = (minDist - dist) * 0.5;
                const nx = dx / dist;
                const nz = dz / dist;
                ai.collider.x -= nx * push;
                ai.collider.z -= nz * push;
                other.collider.x += nx * push;
                other.collider.z += nz * push;
                // Giảm tốc
                ai.speed *= 0.8;
            }
        }
    }

    // ====== SETTINGS ======
    _onSettingsChanged() {
        const settings = this.graphics.settings;
        this.maxVehicles = settings.maxActiveTraffic * 1.5;
        this.spawnInterval = 2 / (settings.trafficDensity + 0.1);
        
        // Cập nhật active status cho tất cả
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