// js/collision.js - COLLISION SYSTEM CHO COACHVN
// Hoạt động độc lập với AI - nếu AI lỗi, collision vẫn hoạt động
// Tối ưu: Spatial hash, chỉ check gần player, simplified colliders

import * as THREE from "three";

// ============================================================
// COLLISION CONFIG
// ============================================================

export const COLLISION_CONFIG = {
    // === SPATIAL HASH ===
    hashCellSize: 50,              // Kích thước cell (meters)
    maxCollidersPerCell: 100,      // Max colliders mỗi cell
    
    // === DETECTION RANGES ===
    nearRange: 100,                // Full collision check (meters)
    mediumRange: 200,              // Simplified check
    farRange: 400,                 // Minimal check
    
    // === RESPONSE ===
    collisionCooldown: 0.5,        // Cooldown giữa các collision (seconds)
    maxPushForce: 3.0,             // Max push force
    speedReductionFactor: 0.8,     // Giảm tốc khi va chạm
    cameraShakeIntensity: 0.15,    // Camera shake intensity
    
    // === PLAYER COLLIDER ===
    playerBusLength: 12.0,         // Chiều dài xe
    playerBusWidth: 2.4,           // Chiều rộng xe
    
    // === ENVIRONMENT COLLIDERS ===
    treeColliderRadius: 0.8,       // Bán kính collider cây
    barrierColliderWidth: 0.3,     // Chiều rộng collider lan can
    signColliderRadius: 0.5,       // Bán kính collider biển báo
    
    // === DEBUG ===
    debugMode: false,              // Hiển thị collider boxes
};

// ============================================================
// COLLIDER TYPES
// ============================================================

export const COLLIDER_TYPES = {
    PLAYER: 'player',
    TRAFFIC: 'traffic',
    NPC: 'npc',
    ENVIRONMENT: 'environment',
    STATIC: 'static',
};

// ============================================================
// COLLIDER CLASSES
// ============================================================

/**
 * Box Collider (cho xe, building)
 */
class BoxCollider {
    constructor(x, z, width, length, rotation = 0, type = COLLIDER_TYPES.STATIC) {
        this.type = type;
        this.x = x;
        this.z = z;
        this.width = width;
        this.length = length;
        this.rotation = rotation;
        this.active = true;
        
        // Pre-calculate half extents with rotation
        this.updateBounds();
    }
    
    updateBounds() {
        const cos = Math.abs(Math.cos(this.rotation));
        const sin = Math.abs(Math.sin(this.rotation));
        this.halfWidth = (this.length * cos + this.width * sin) / 2;
        this.halfLength = (this.length * sin + this.width * cos) / 2;
    }
    
    update(x, z, rotation = null) {
        this.x = x;
        this.z = z;
        if (rotation !== null) {
            this.rotation = rotation;
        }
        this.updateBounds();
    }
    
    containsPoint(px, pz) {
        return Math.abs(px - this.x) <= this.halfWidth &&
               Math.abs(pz - this.z) <= this.halfLength;
    }
    
    getAABB() {
        return {
            minX: this.x - this.halfWidth,
            maxX: this.x + this.halfWidth,
            minZ: this.z - this.halfLength,
            maxZ: this.z + this.halfLength
        };
    }
}

/**
 * Sphere Collider (cho cây, biển báo, NPC)
 */
class SphereCollider {
    constructor(x, z, radius, type = COLLIDER_TYPES.STATIC) {
        this.type = type;
        this.x = x;
        this.z = z;
        this.radius = radius;
        this.active = true;
    }
    
    update(x, z) {
        this.x = x;
        this.z = z;
    }
    
    containsPoint(px, pz) {
        const dx = px - this.x;
        const dz = pz - this.z;
        return (dx * dx + dz * dz) <= (this.radius * this.radius);
    }
    
    getAABB() {
        return {
            minX: this.x - this.radius,
            maxX: this.x + this.radius,
            minZ: this.z - this.radius,
            maxZ: this.z + this.radius
        };
    }
}

// ============================================================
// SPATIAL HASH GRID
// ============================================================

class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }
    
    _getCellKey(x, z) {
        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        return `${cellX},${cellZ}`;
    }
    
    insert(collider) {
        const aabb = collider.getAABB();
        const minCellX = Math.floor(aabb.minX / this.cellSize);
        const maxCellX = Math.floor(aabb.maxX / this.cellSize);
        const minCellZ = Math.floor(aabb.minZ / this.cellSize);
        const maxCellZ = Math.floor(aabb.maxZ / this.cellSize);
        
        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                const key = `${cx},${cz}`;
                if (!this.cells.has(key)) {
                    this.cells.set(key, []);
                }
                this.cells.get(key).push(collider);
            }
        }
    }
    
    query(x, z, range) {
        const results = [];
        const minCellX = Math.floor((x - range) / this.cellSize);
        const maxCellX = Math.floor((x + range) / this.cellSize);
        const minCellZ = Math.floor((z - range) / this.cellSize);
        const maxCellZ = Math.floor((z + range) / this.cellSize);
        
        const seen = new Set();
        
        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                const key = `${cx},${cz}`;
                const cell = this.cells.get(key);
                if (cell) {
                    for (const collider of cell) {
                        if (!seen.has(collider) && collider.active) {
                            seen.add(collider);
                            results.push(collider);
                        }
                    }
                }
            }
        }
        
        return results;
    }
    
    clear() {
        this.cells.clear();
    }
}

// ============================================================
// MAIN COLLISION SYSTEM
// ============================================================

export class CollisionSystem {
    constructor({
        scene,
        playerBus,
        trafficManager = null,
        npcManager = null,
        map = null,
        onCollision = null,
        config = {}
    }) {
        this.scene = scene;
        this.playerBus = playerBus;
        this.trafficManager = trafficManager;
        this.npcManager = npcManager;
        this.map = map;
        this.onCollision = onCollision;
        this.config = { ...COLLISION_CONFIG, ...config };
        
        // Spatial hash cho static colliders
        this.staticHash = new SpatialHash(this.config.hashCellSize);
        
        // Dynamic colliders (updated mỗi frame)
        this.playerCollider = null;
        this.trafficColliders = [];
        
        // Collision state
        this.collisionCooldown = 0;
        this.lastCollisionTime = 0;
        this.collisionHistory = [];
        
        // Environment colliders (đăng ký một lần)
        this.environmentColliders = [];
        
        // Debug visualization
        this.debugGroup = null;
        if (this.config.debugMode) {
            this.debugGroup = new THREE.Group();
            this.debugGroup.name = "collision-debug";
            scene.add(this.debugGroup);
        }
        
        // Initialize player collider
        this._initPlayerCollider();
        
        // Initialize environment colliders
        this._initEnvironmentColliders();
        
        console.log("💥 CollisionSystem initialized");
    }
    
    // ============================================================
    // INITIALIZATION
    // ============================================================
    
    _initPlayerCollider() {
        if (!this.playerBus?.group) return;
        
        const pos = this.playerBus.group.position;
        const rot = this.playerBus.group.rotation.y;
        
        this.playerCollider = new BoxCollider(
            pos.x,
            pos.z,
            this.config.playerBusWidth,
            this.config.playerBusLength,
            rot,
            COLLIDER_TYPES.PLAYER
        );
    }
    
    _initEnvironmentColliders() {
        if (!this.map) return;
        
        // Lấy colliders từ map nếu có
        const mapColliders = this.map.getColliders?.() || [];
        
        for (const col of mapColliders) {
            if (col.type === 'box') {
                const collider = new BoxCollider(
                    col.x, col.z, col.width, col.length, col.rotation || 0,
                    COLLIDER_TYPES.ENVIRONMENT
                );
                this.environmentColliders.push(collider);
                this.staticHash.insert(collider);
            } else if (col.type === 'sphere') {
                const collider = new SphereCollider(
                    col.x, col.z, col.radius,
                    COLLIDER_TYPES.ENVIRONMENT
                );
                this.environmentColliders.push(collider);
                this.staticHash.insert(collider);
            }
        }
        
        // Thêm colliders cho cây xanh trong median
        this._addMedianTreeColliders();
        
        // Thêm colliders cho lan can
        this._addBarrierColliders();
    }
    
    /**
     * Thêm colliders cho cây trong median
     */
    _addMedianTreeColliders() {
        if (!this.map?.getRoadGraph) return;
        
        const roadGraph = this.map.getRoadGraph();
        if (!roadGraph || !roadGraph.edges) return;
        
        // Chỉ thêm colliders cho cây trong QL1A segments
        for (const edge of roadGraph.edges) {
            if (edge.roadType === 'QL1A' && edge.hasMedian && edge.medianElements?.trees) {
                const spacing = edge.medianElements.treeSpacing || 30;
                const length = edge.length || 100;
                const treeCount = Math.floor(length / spacing);
                
                for (let i = 0; i < treeCount; i++) {
                    const t = (i + 0.5) / treeCount;
                    const x = edge.startX + (edge.endX - edge.startX) * t;
                    const z = edge.startZ + (edge.endZ - edge.startZ) * t;
                    
                    const collider = new SphereCollider(
                        x, z, this.config.treeColliderRadius,
                        COLLIDER_TYPES.ENVIRONMENT
                    );
                    this.environmentColliders.push(collider);
                    this.staticHash.insert(collider);
                }
            }
        }
    }
    
    /**
     * Thêm colliders cho lan can
     */
    _addBarrierColliders() {
        if (!this.map?.getRoadGraph) return;
        
        const roadGraph = this.map.getRoadGraph();
        if (!roadGraph || !roadGraph.edges) return;
        
        for (const edge of roadGraph.edges) {
            // Lan can hai bên đường
            if (edge.hasMedian && edge.medianWidth > 0) {
                // Lan can median
                const halfWidth = edge.medianWidth / 2;
                const length = edge.length || 100;
                
                // Lan can trái
                const leftCollider = new BoxCollider(
                    edge.midX - halfWidth * Math.cos(edge.angle),
                    edge.midZ + halfWidth * Math.sin(edge.angle),
                    this.config.barrierColliderWidth,
                    length,
                    edge.angle,
                    COLLIDER_TYPES.ENVIRONMENT
                );
                this.environmentColliders.push(leftCollider);
                this.staticHash.insert(leftCollider);
                
                // Lan can phải
                const rightCollider = new BoxCollider(
                    edge.midX + halfWidth * Math.cos(edge.angle),
                    edge.midZ - halfWidth * Math.sin(edge.angle),
                    this.config.barrierColliderWidth,
                    length,
                    edge.angle,
                    COLLIDER_TYPES.ENVIRONMENT
                );
                this.environmentColliders.push(rightCollider);
                this.staticHash.insert(rightCollider);
            }
        }
    }
    
    // ============================================================
    // UPDATE (MỖI FRAME)
    // ============================================================
    
    update(deltaTime, playerPos) {
        if (!this.playerCollider || !playerPos) return;
        
        // Update cooldown
        this.collisionCooldown -= deltaTime;
        
        // ===== 1. UPDATE PLAYER COLLIDER =====
        this.playerCollider.update(
            playerPos.x,
            playerPos.z,
            this.playerBus?.group?.rotation?.y || 0
        );
        
        // ===== 2. GET TRAFFIC COLLIDERS =====
        this.trafficColliders = this._getTrafficColliders();
        
        // ===== 3. CHECK COLLISIONS =====
        this._checkPlayerVsTraffic();
        this._checkPlayerVsEnvironment(playerPos);
        
        // ===== 4. TRAFFIC VS TRAFFIC (chỉ gần player) =====
        this._checkTrafficVsTraffic(playerPos);
        
        // ===== 5. UPDATE DEBUG VISUALS =====
        if (this.config.debugMode) {
            this._updateDebugVisuals();
        }
    }
    
    // ============================================================
    // COLLISION CHECKS
    // ============================================================
    
    /**
     * Lấy colliders từ traffic manager
     */
    _getTrafficColliders() {
        const colliders = [];
        
        if (this.trafficManager?.aiVehicles) {
            for (const ai of this.trafficManager.aiVehicles) {
                if (ai?.collider && ai?.vehicle?.group?.visible) {
                    colliders.push({
                        x: ai.collider.x,
                        z: ai.collider.z,
                        radius: ai.collider.r || 1.5,
                        type: COLLIDER_TYPES.TRAFFIC,
                        vehicle: ai
                    });
                }
            }
        }
        
        // NPC station buses
        if (this.npcManager?.getColliders) {
            const npcColliders = this.npcManager.getColliders();
            for (const col of npcColliders) {
                colliders.push({
                    x: col.x,
                    z: col.z,
                    radius: col.r || 1.5,
                    type: COLLIDER_TYPES.NPC,
                    isStatic: col.isStatic
                });
            }
        }
        
        return colliders;
    }
    
    /**
     * Check player vs traffic collision
     */
    _checkPlayerVsTraffic() {
        if (this.collisionCooldown > 0) return;
        
        const player = this.playerCollider;
        if (!player) return;
        
        for (const traffic of this.trafficColliders) {
            // Quick distance check
            const dx = traffic.x - player.x;
            const dz = traffic.z - player.z;
            const distSq = dx * dx + dz * dz;
            
            // Skip nếu quá xa
            const maxDist = traffic.radius + Math.max(player.halfWidth, player.halfLength);
            if (distSq > maxDist * maxDist) continue;
            
            // Detailed check (AABB vs Circle)
            const collision = this._checkCircleVsBox(
                traffic.x, traffic.z, traffic.radius,
                player
            );
            
            if (collision) {
                this._handlePlayerCollision(traffic, collision);
                break; // Chỉ xử lý 1 collision mỗi frame
            }
        }
    }
    
    /**
     * Check player vs environment collision
     */
    _checkPlayerVsEnvironment(playerPos) {
        if (this.collisionCooldown > 0) return;
        
        const player = this.playerCollider;
        if (!player) return;
        
        // Query spatial hash cho colliders gần player
        const nearby = this.staticHash.query(
            playerPos.x,
            playerPos.z,
            this.config.nearRange
        );
        
        for (const envCollider of nearby) {
            // Quick distance check
            const dx = envCollider.x - player.x;
            const dz = envCollider.z - player.z;
            const distSq = dx * dx + dz * dz;
            
            // Skip nếu quá xa
            const maxDist = 20; // Max reasonable distance
            if (distSq > maxDist * maxDist) continue;
            
            // Check collision based on collider type
            let collision = false;
            
            if (envCollider instanceof SphereCollider) {
                collision = this._checkCircleVsBox(
                    envCollider.x, envCollider.z, envCollider.radius,
                    player
                );
            } else if (envCollider instanceof BoxCollider) {
                collision = this._checkBoxVsBox(envCollider, player);
            }
            
            if (collision) {
                this._handleEnvironmentCollision(envCollider);
                break;
            }
        }
    }
    
    /**
     * Check traffic vs traffic (đơn giản, chỉ gần player)
     */
    _checkTrafficVsTraffic(playerPos) {
        // Chỉ check nếu có nhiều xe
        if (this.trafficColliders.length < 2) return;
        
        const checkRange = 50; // Chỉ check trong 50m quanh player
        
        for (let i = 0; i < this.trafficColliders.length; i++) {
            for (let j = i + 1; j < this.trafficColliders.length; j++) {
                const a = this.trafficColliders[i];
                const b = this.trafficColliders[j];
                
                // Skip nếu quá xa player
                const distToPlayerA = Math.hypot(a.x - playerPos.x, a.z - playerPos.z);
                const distToPlayerB = Math.hypot(b.x - playerPos.x, b.z - playerPos.z);
                
                if (distToPlayerA > checkRange || distToPlayerB > checkRange) continue;
                
                // Check circle-circle collision
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const distSq = dx * dx + dz * dz;
                const minDist = a.radius + b.radius;
                
                if (distSq < minDist * minDist) {
                    // Xử lý collision giữa 2 xe traffic
                    this._handleTrafficVsTraffic(a, b);
                }
            }
        }
    }
    
    // ============================================================
    // COLLISION DETECTION HELPERS
    // ============================================================
    
    /**
     * Check Circle vs AABB collision
     */
    _checkCircleVsBox(circleX, circleZ, circleRadius, box) {
        // Tìm điểm gần nhất trên box đến tâm circle
        const closestX = Math.max(box.x - box.halfWidth, 
                          Math.min(circleX, box.x + box.halfWidth));
        const closestZ = Math.max(box.z - box.halfLength, 
                          Math.min(circleZ, box.z + box.halfLength));
        
        // Tính khoảng cách
        const dx = circleX - closestX;
        const dz = circleZ - closestZ;
        const distSq = dx * dx + dz * dz;
        
        return distSq < (circleRadius * circleRadius);
    }
    
    /**
     * Check Box vs Box collision (AABB)
     */
    _checkBoxVsBox(boxA, boxB) {
        return (
            boxA.x - boxA.halfWidth < boxB.x + boxB.halfWidth &&
            boxA.x + boxA.halfWidth > boxB.x - boxB.halfWidth &&
            boxA.z - boxA.halfLength < boxB.z + boxB.halfLength &&
            boxA.z + boxA.halfLength > boxB.z - boxB.halfLength
        );
    }
    
    // ============================================================
    // COLLISION RESPONSE
    // ============================================================
    
    /**
     * Xử lý va chạm player vs traffic
     */
    _handlePlayerCollision(traffic, collisionInfo) {
        if (this.collisionCooldown > 0) return;
        this.collisionCooldown = this.config.collisionCooldown;
        
        const player = this.playerCollider;
        const playerPos = this.playerBus.group.position;
        
        // Calculate push direction
        const dx = playerPos.x - traffic.x;
        const dz = playerPos.z - traffic.z;
        const dist = Math.hypot(dx, dz);
        
        if (dist < 0.001) {
            // Trùng vị trí - push theo hướng ngẫu nhiên
            const angle = Math.random() * Math.PI * 2;
            var pushX = Math.sin(angle);
            var pushZ = Math.cos(angle);
        } else {
            var pushX = dx / dist;
            var pushZ = dz / dist;
        }
        
        // Calculate intensity based on speed
        const speed = Math.abs(this.playerBus?.speed || 0);
        const intensity = Math.min(1.0, speed / 20.0); // Max intensity ở 20 m/s
        
        // Apply push force
        const pushForce = this.config.maxPushForce * intensity;
        playerPos.x += pushX * pushForce * 0.1;
        playerPos.z += pushZ * pushForce * 0.1;
        
        // Reduce speed
        if (this.playerBus?.speed !== undefined) {
            this.playerBus.speed *= (1 - intensity * this.config.speedReductionFactor);
        }
        
        // Record collision
        this.collisionHistory.push({
            time: Date.now(),
            type: 'traffic',
            intensity: intensity,
            position: { x: playerPos.x, z: playerPos.z }
        });
        
        // Limit history
        if (this.collisionHistory.length > 20) {
            this.collisionHistory.shift();
        }
        
        // Callback
        if (this.onCollision) {
            this.onCollision({
                type: 'traffic',
                intensity: intensity,
                position: { x: playerPos.x, z: playerPos.z },
                otherVehicle: traffic.vehicle || null
            });
        }
        
        console.log(`💥 Traffic collision! Intensity: ${(intensity * 100).toFixed(0)}%`);
    }
    
    /**
     * Xử lý va chạm player vs environment
     */
    _handleEnvironmentCollision(envCollider) {
        if (this.collisionCooldown > 0) return;
        this.collisionCooldown = this.config.collisionCooldown;
        
        const playerPos = this.playerBus.group.position;
        
        // Calculate push direction
        const dx = playerPos.x - envCollider.x;
        const dz = playerPos.z - envCollider.z;
        const dist = Math.hypot(dx, dz);
        
        if (dist > 0.001) {
            const pushX = dx / dist;
            const pushZ = dz / dist;
            
            // Environment collision thường nhẹ hơn traffic
            const pushForce = this.config.maxPushForce * 0.5;
            playerPos.x += pushX * pushForce * 0.1;
            playerPos.z += pushZ * pushForce * 0.1;
        }
        
        // Reduce speed mạnh hơn (environment collision)
        if (this.playerBus?.speed !== undefined) {
            this.playerBus.speed *= 0.3; // Giảm 70% tốc độ
        }
        
        // Record
        this.collisionHistory.push({
            time: Date.now(),
            type: 'environment',
            intensity: 0.8,
            position: { x: playerPos.x, z: playerPos.z }
        });
        
        // Callback
        if (this.onCollision) {
            this.onCollision({
                type: 'environment',
                intensity: 0.8,
                position: { x: playerPos.x, z: playerPos.z },
                colliderType: envCollider.type
            });
        }
        
        console.log(`💥 Environment collision! Type: ${envCollider.type}`);
    }
    
    /**
     * Xử lý va chạm traffic vs traffic
     */
    _handleTrafficVsTraffic(a, b) {
        // Đơn giản: tách 2 xe ra
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minDist = a.radius + b.radius;
        
        if (dist < minDist && dist > 0.001) {
            const pushDist = (minDist - dist) / 2;
            const pushX = (dx / dist) * pushDist;
            const pushZ = (dz / dist) * pushDist;
            
            // Update positions nếu có vehicle reference
            if (a.vehicle?.group) {
                a.vehicle.group.position.x -= pushX;
                a.vehicle.group.position.z -= pushZ;
                a.x -= pushX;
                a.z -= pushZ;
            }
            if (b.vehicle?.group) {
                b.vehicle.group.position.x += pushX;
                b.vehicle.group.position.z += pushZ;
                b.x += pushX;
                b.z += pushZ;
            }
        }
    }
    
    // ============================================================
    // PUBLIC API
    // ============================================================
    
    /**
     * Thêm static collider thủ công
     */
    addStaticCollider(collider) {
        this.environmentColliders.push(collider);
        this.staticHash.insert(collider);
    }
    
    /**
     * Thêm box collider
     */
    addBoxCollider(x, z, width, length, rotation = 0) {
        const collider = new BoxCollider(x, z, width, length, rotation, COLLIDER_TYPES.ENVIRONMENT);
        this.addStaticCollider(collider);
        return collider;
    }
    
    /**
     * Thêm sphere collider
     */
    addSphereCollider(x, z, radius) {
        const collider = new SphereCollider(x, z, radius, COLLIDER_TYPES.ENVIRONMENT);
        this.addStaticCollider(collider);
        return collider;
    }
    
    /**
     * Lấy collision history
     */
    getCollisionHistory() {
        return this.collisionHistory;
    }
    
    /**
     * Check có collision gần đây không
     */
    hasRecentCollision(timeWindow = 5000) {
        const now = Date.now();
        return this.collisionHistory.some(c => now - c.time < timeWindow);
    }
    
    /**
     * Get debug info
     */
    getDebugInfo() {
        return {
            playerCollider: this.playerCollider ? {
                x: this.playerCollider.x.toFixed(2),
                z: this.playerCollider.z.toFixed(2),
                width: this.playerCollider.width,
                length: this.playerCollider.length
            } : null,
            trafficColliders: this.trafficColliders.length,
            environmentColliders: this.environmentColliders.length,
            recentCollisions: this.collisionHistory.filter(
                c => Date.now() - c.time < 10000
            ).length,
            cooldown: this.collisionCooldown.toFixed(2)
        };
    }
    
    /**
     * Toggle debug mode
     */
    toggleDebug() {
        this.config.debugMode = !this.config.debugMode;
        
        if (this.config.debugMode && !this.debugGroup) {
            this.debugGroup = new THREE.Group();
            this.debugGroup.name = "collision-debug";
            this.scene.add(this.debugGroup);
        } else if (!this.config.debugMode && this.debugGroup) {
            this.scene.remove(this.debugGroup);
            this.debugGroup = null;
        }
        
        return this.config.debugMode;
    }
    
    /**
     * Update debug visuals
     */
    _updateDebugVisuals() {
        if (!this.debugGroup) return;
        
        // Clear old visuals
        while (this.debugGroup.children.length > 0) {
            const child = this.debugGroup.children[0];
            this.debugGroup.remove(child);
        }
        
        // Player collider
        if (this.playerCollider) {
            const geo = new THREE.BoxGeometry(
                this.playerCollider.width, 0.5, this.playerCollider.length
            );
            const mat = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: 0.3
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(this.playerCollider.x, 0.5, this.playerCollider.z);
            mesh.rotation.y = this.playerCollider.rotation;
            this.debugGroup.add(mesh);
        }
        
        // Traffic colliders
        for (const tc of this.trafficColliders) {
            const geo = new THREE.SphereGeometry(tc.radius, 8, 8);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.3
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(tc.x, 0.5, tc.z);
            this.debugGroup.add(mesh);
        }
    }
    
    /**
     * Dispose
     */
    dispose() {
        if (this.debugGroup) {
            this.scene.remove(this.debugGroup);
        }
        this.staticHash.clear();
        this.environmentColliders = [];
        this.trafficColliders = [];
        this.collisionHistory = [];
    }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

export function createCollisionSystem(options) {
    return new CollisionSystem(options);
}