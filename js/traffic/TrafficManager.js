// js/traffic/TrafficManager.js
import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "../bus.js";
import { TrafficAI, AI_STATE } from "./TrafficAI.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { createSeededRandom } from "../utils.js";

export class TrafficManager {
    constructor({ scene, roadGraph, maxVehicles = 60, playerRef = null }) {
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
        
        // Xe buýt chạy đường dài: phải THẤY xe khi đang lái, không phải 1-2
        // xe sát đuôi. Spawn trong cửa sổ 110-340m, despawn ở 720m. Số xe
        // đồng thời vẫn bị chặn bởi maxActive (không tăng tải máy yếu).
        this.spawnDistance = 340;
        this.despawnDistance = 720;
        this.spawnTimer = 0;
        this.spawnInterval = 0.5;
        this.maxSpawnPerFrame = 2;
        this.lastPlayerPos = { x: 0, z: 0 };
        
        // Kiểm tra xem roadGraph có cấu trúc nodes và segments không
        this.isGraphMode = (roadGraph && Array.isArray(roadGraph.segments) && (Array.isArray(roadGraph.nodes) || roadGraph._nodeMap));
        this._validSegsCache = null;
        this.MIN_TRAFFIC_SPAWN_DISTANCE = 50;
        
        this.stationSpawnQueue = [];
        this.stationSpawnTimer = 0;
    }

    // Loc segment hop le de spawn (bo qua nghin doan khong dung class/lo):
    // bo qua ham, duong noi bo ben xe, ramp cao toc, ngo cut.
    _segOk(s) {
        if (!s) return false;
        if (s.type === 'tunnel' || s.type === 'bus_station_road' || s.type === 'highway_ramp') return false;
        if (s.class === 'TUNNEL' || s.class === 'RAMP' || s.class === 'INTERNAL' ||
            s.class === 'SERVICE' || s.class === 'STATION_ACCESS' || s.class === 'ALLEY') return false;
        const f = this.roadGraph.getNode(s.from);
        const t = this.roadGraph.getNode(s.to);
        if (!f || !t) return false;
        return Math.hypot(t.x - f.x, t.z - f.z) > 12;
    }

    _spawnVehicle() {
        if (!this.isGraphMode) return null;
        const px = this.lastPlayerPos.x, pz = this.lastPlayerPos.z;

        // CHI boc trong ban kinh quanh nguoi choi. Truoc day boc ngau nhien tren
        // toan bo ~10k doan duong (rai khap 500km) roi moi loai xe phai nam
        // trong 100-200m => ve co xac suat 0, thuc te game khong co xe nao.
        const near = (typeof this.roadGraph.segmentsNear === 'function')
            ? this.roadGraph.segmentsNear(px, pz, this.spawnDistance * 2.2, s => this._segOk(s))
            : null;
        let pool = near;
        if (!pool || pool.length === 0) {
            if (!this._validSegsCache) {
                this._validSegsCache = this.roadGraph.segments.filter(s => this._segOk(s));
            }
            if (!this._validSegsCache.length) return null;
            pool = this._validSegsCache;
        }

        let candidate = null;
        for (let i = 0; i < 20; i++) {
            const seg = pool[Math.floor(this.random() * pool.length)];
            if (!seg) continue;
            const dir = seg.twoWay ? Math.floor(this.random() * 2) : 0;
            const f = this.roadGraph.getNode(seg.from);
            const t = this.roadGraph.getNode(seg.to);
            
            // FIX LỖI CRASH: Kiểm tra undefined trước khi truy cập thuộc tính
            if (!f || !t) continue; 
            
            const p0 = dir === 0 ? f : t;
            const p1 = dir === 0 ? t : f;
            
            const progress = 0.2 + this.random() * 0.6;
            const x = p0.x + (p1.x - p0.x) * progress;
            const z = p0.z + (p1.z - p0.z) * progress;
            const distPlayer = Math.hypot(x - this.lastPlayerPos.x, z - this.lastPlayerPos.z);
            
            if (distPlayer < this.spawnDistance * 0.5 || distPlayer > this.spawnDistance) continue;
            
            let tooClose = false;
            for (const other of this.aiVehicles) {
                if (Math.hypot(x - other.collider.x, z - other.collider.z) < this.MIN_TRAFFIC_SPAWN_DISTANCE) {
                    tooClose = true; break;
                }
            }
            if (tooClose) continue;
            
            candidate = { seg, dir, progress, x, z };
            break;
        }
        
        if (!candidate) return null;

        let vehicle = this.pool.pop();
        if (!vehicle) {
            vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
            this.scene.add(vehicle.group);
        }
        
        const personalities = ['CAREFUL', 'NORMAL', 'AGGRESSIVE', 'BUS_DRIVER'];
        const personality = personalities[Math.floor(this.random() * personalities.length)];
        const ai = new TrafficAI({
            vehicle, roadGraph: this.roadGraph, personality,
            seed: this.seed + this.aiVehicles.length
        });
        
        ai.currentSegmentId = candidate.seg.id;
        ai.direction = candidate.dir;
        ai.progress = candidate.progress;
        ai.laneOffset = ai.targetLaneOffset;
        ai._updatePositionFromSegment();
        ai.heading = ai._getSegmentHeading();
        ai.targetHeading = ai.heading;
        ai.speed = 10 + this.random() * 10;
        ai.targetSpeed = ai.speed;
        ai.setActive(true);
        
        // Đăng ký collider 3D (có Y và Height)
        if (window.collisionSystem) {
            ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai }, ai.collider.y, 4.0);
        }
        
        this.aiVehicles.push(ai);
        this.activeCount++;
        return ai;
    }

    setupStationTraffic(stationNode) {
        // Cập nhật để đọc busBays từ POI object mới
        if (!stationNode || !stationNode.busBays || stationNode.busBays.length === 0) return;
        for (const bay of stationNode.busBays) {
            this.stationSpawnQueue.push({ transform: bay });
        }
    }

    processStationQueue(deltaTime) {
        if (this.stationSpawnQueue.length === 0) return;
        this.stationSpawnTimer += deltaTime;
        if (this.stationSpawnTimer < 0.2) return;
        this.stationSpawnTimer = 0;
        
        const req = this.stationSpawnQueue.shift();
        let vehicle = this.pool.pop();
        if (!vehicle) {
            vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
            this.scene.add(vehicle.group);
        }
        
        const ai = new TrafficAI({
            vehicle, roadGraph: this.roadGraph, personality: 'BUS_DRIVER',
            seed: this.seed + this.aiVehicles.length, isStatic: true
        });
        
        ai.collider.x = req.transform.x;
        ai.collider.z = req.transform.z;
        ai.collider.y = req.transform.y || 0; // Lấy Y từ transform
        ai.heading = req.transform.heading;
        ai.targetHeading = ai.heading;
        
        ai.vehicle.group.position.set(ai.collider.x, ai.collider.y, ai.collider.z);
        ai.vehicle.group.rotation.y = ai.heading;
        ai.setActive(true);
        
        // Đăng ký collider 3D
        if (window.collisionSystem) {
            ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai }, ai.collider.y, 4.0);
        }
        
        this.aiVehicles.push(ai);
        this.activeCount++;
    }

    update(deltaTime, playerPos) {
        if (!playerPos || !this.isGraphMode) return;
        this.lastPlayerPos = playerPos;
        this.processStationQueue(deltaTime);
        
        const maxActive = Math.min(this.graphics.settings.maxActiveTraffic || 10, this.maxVehicles);
        
        for (let i = this.aiVehicles.length - 1; i >= 0; i--) {
            const ai = this.aiVehicles[i];
            if (ai.isStatic) continue;
            
            const dist = Math.hypot(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);
            if (dist > this.despawnDistance) {
                ai.setActive(false);
                this.pool.push(ai.vehicle);
                if (window.collisionSystem && ai.colId) window.collisionSystem.remove(ai.colId);
                this.aiVehicles.splice(i, 1);
                this.activeCount--;
                continue;
            }
            
            if (dist < 150) ai.setAILevel('NEAR');
            else if (dist < 300) ai.setAILevel('MID');
            else ai.setAILevel('FAR');
            
            ai.update(Math.min(deltaTime, 0.1), playerPos, this.aiVehicles);
            
            // Cập nhật Y cho collider khi NPC di chuyển
            if (window.collisionSystem && ai.colId) {
                window.collisionSystem.update(ai.colId, ai.collider.x, ai.collider.z, ai.collider.y);
            }
            this._checkCollision(ai);
        }
        
        this.spawnTimer += deltaTime;
        if (this.activeCount < maxActive && this.spawnTimer > this.spawnInterval) {
            this.spawnTimer = 0;
            for (let i = 0; i < this.maxSpawnPerFrame; i++) {
                if (this.activeCount >= maxActive) break;
                this._spawnVehicle();
            }
        }
    }

    _checkCollision(ai) {
        if (!window.collisionSystem || ai.isStatic) return;
        const hit = window.collisionSystem.check(ai.collider.x, ai.collider.z, ai.collider.r, ai.colId, ['npc', 'static'], ai.collider.y, 4.0);
        if (hit) {
            if (hit.data?.ai) {
                const other = hit.data.ai;
                const dx = other.collider.x - ai.collider.x;
                const dz = other.collider.z - ai.collider.z;
                const dist = Math.hypot(dx, dz);
                if (dist > 0.01 && dist < 4.0) {
                    const push = (4.0 - dist) * 0.5;
                    ai.collider.x -= (dx / dist) * push;
                    ai.collider.z -= (dz / dist) * push;
                    ai.speed *= 0.5;
                }
            } else {
                ai.speed *= 0.3;
            }
        }
    }

    _onSettingsChanged() { 
        this.maxVehicles = this.graphics.settings.maxActiveTraffic * 1.5; 
    }
    
    getActiveVehicles() { 
        return this.aiVehicles.filter(ai => ai.active); 
    }
    
    dispose() { 
        this.aiVehicles.forEach(ai => ai.dispose()); 
        this.aiVehicles = []; 
        this.pool = []; 
        this.activeCount = 0; 
    }
}

export function createTrafficManager(options) { 
    return new TrafficManager(options); 
}