// js/collision.js

import * as THREE from "three";


export const COLLISION_CONFIG = {
    hashCellSize: 50,
    maxCollidersPerCell: 100,

    nearRange: 100,
    mediumRange: 200,
    farRange: 400,

    collisionCooldown: 0.5,
    maxPushForce: 3.0,
    speedReductionFactor: 0.8,
    cameraShakeIntensity: 0.15,

    playerBusLength: 12.0,
    playerBusWidth: 2.4,

    treeColliderRadius: 0.8,
    barrierColliderWidth: 0.3,
    signColliderRadius: 0.5,

    debugMode: false,
};


export const COLLIDER_TYPES = {
    PLAYER: 'player',
    TRAFFIC: 'traffic',
    NPC: 'npc',
    ENVIRONMENT: 'environment',
    STATIC: 'static',
};



class BoxCollider {
    constructor(x, z, width, length, rotation = 0, type = COLLIDER_TYPES.STATIC) {
        this.type = type;
        this.x = x;
        this.z = z;
        this.width = width;
        this.length = length;
        this.rotation = rotation;
        this.active = true;

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

        this.staticHash = new SpatialHash(this.config.hashCellSize);

        this.playerCollider = null;
        this.trafficColliders = [];

        this.collisionCooldown = 0;
        this.lastCollisionTime = 0;
        this.collisionHistory = [];

        this.environmentColliders = [];

        this.debugGroup = null;
        if (this.config.debugMode) {
            this.debugGroup = new THREE.Group();
            this.debugGroup.name = "collision-debug";
            scene.add(this.debugGroup);
        }

        this._initPlayerCollider();

        this._initEnvironmentColliders();

        console.log("💥 CollisionSystem initialized");
    }


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

        this._addMedianTreeColliders();

        this._addBarrierColliders();
    }


    _addMedianTreeColliders() {
        if (!this.map?.getRoadGraph) return;

        const roadGraph = this.map.getRoadGraph();
        if (!roadGraph || !roadGraph.edges) return;

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


    _addBarrierColliders() {
        if (!this.map?.getRoadGraph) return;

        const roadGraph = this.map.getRoadGraph();
        if (!roadGraph || !roadGraph.edges) return;

        for (const edge of roadGraph.edges) {
            if (edge.hasMedian && edge.medianWidth > 0) {
                const halfWidth = edge.medianWidth / 2;
                const length = edge.length || 100;

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


    update(deltaTime, playerPos) {
        if (!this.playerCollider || !playerPos) return;

        this.collisionCooldown -= deltaTime;

        this.playerCollider.update(
            playerPos.x,
            playerPos.z,
            this.playerBus?.group?.rotation?.y || 0
        );

        this.trafficColliders = this._getTrafficColliders();

        this._checkPlayerVsTraffic();
        this._checkPlayerVsEnvironment(playerPos);

        this._checkTrafficVsTraffic(playerPos);

        if (this.config.debugMode) {
            this._updateDebugVisuals();
        }
    }



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


    _checkPlayerVsTraffic() {
        if (this.collisionCooldown > 0) return;

        const player = this.playerCollider;
        if (!player) return;

        for (const traffic of this.trafficColliders) {
            const dx = traffic.x - player.x;
            const dz = traffic.z - player.z;
            const distSq = dx * dx + dz * dz;

            const maxDist = traffic.radius + Math.max(player.halfWidth, player.halfLength);
            if (distSq > maxDist * maxDist) continue;

            const collision = this._checkCircleVsBox(
                traffic.x, traffic.z, traffic.radius,
                player
            );

            if (collision) {
                this._handlePlayerCollision(traffic, collision);
                break;
            }
        }
    }


    _checkPlayerVsEnvironment(playerPos) {
        if (this.collisionCooldown > 0) return;

        const player = this.playerCollider;
        if (!player) return;

        const nearby = this.staticHash.query(
            playerPos.x,
            playerPos.z,
            this.config.nearRange
        );

        for (const envCollider of nearby) {
            const dx = envCollider.x - player.x;
            const dz = envCollider.z - player.z;
            const distSq = dx * dx + dz * dz;

            const maxDist = 20;
            if (distSq > maxDist * maxDist) continue;

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


    _checkTrafficVsTraffic(playerPos) {
        if (this.trafficColliders.length < 2) return;

        const checkRange = 50;

        for (let i = 0; i < this.trafficColliders.length; i++) {
            for (let j = i + 1; j < this.trafficColliders.length; j++) {
                const a = this.trafficColliders[i];
                const b = this.trafficColliders[j];

                const distToPlayerA = Math.hypot(a.x - playerPos.x, a.z - playerPos.z);
                const distToPlayerB = Math.hypot(b.x - playerPos.x, b.z - playerPos.z);

                if (distToPlayerA > checkRange || distToPlayerB > checkRange) continue;

                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const distSq = dx * dx + dz * dz;
                const minDist = a.radius + b.radius;

                if (distSq < minDist * minDist) {
                    this._handleTrafficVsTraffic(a, b);
                }
            }
        }
    }



    _checkCircleVsBox(circleX, circleZ, circleRadius, box) {
        const closestX = Math.max(box.x - box.halfWidth,
                          Math.min(circleX, box.x + box.halfWidth));
        const closestZ = Math.max(box.z - box.halfLength,
                          Math.min(circleZ, box.z + box.halfLength));

        const dx = circleX - closestX;
        const dz = circleZ - closestZ;
        const distSq = dx * dx + dz * dz;

        return distSq < (circleRadius * circleRadius);
    }


    _checkBoxVsBox(boxA, boxB) {
        return (
            boxA.x - boxA.halfWidth < boxB.x + boxB.halfWidth &&
            boxA.x + boxA.halfWidth > boxB.x - boxB.halfWidth &&
            boxA.z - boxA.halfLength < boxB.z + boxB.halfLength &&
            boxA.z + boxA.halfLength > boxB.z - boxB.halfLength
        );
    }



    _handlePlayerCollision(traffic, collisionInfo) {
        if (this.collisionCooldown > 0) return;
        this.collisionCooldown = this.config.collisionCooldown;

        const player = this.playerCollider;
        const playerPos = this.playerBus.group.position;

        const dx = playerPos.x - traffic.x;
        const dz = playerPos.z - traffic.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.001) {
            const angle = Math.random() * Math.PI * 2;
            var pushX = Math.sin(angle);
            var pushZ = Math.cos(angle);
        } else {
            var pushX = dx / dist;
            var pushZ = dz / dist;
        }

        const speed = Math.abs(this.playerBus?.speed || 0);
        const intensity = Math.min(1.0, speed / 20.0);

        const pushForce = this.config.maxPushForce * intensity;
        playerPos.x += pushX * pushForce * 0.1;
        playerPos.z += pushZ * pushForce * 0.1;

        if (this.playerBus?.speed !== undefined) {
            this.playerBus.speed *= (1 - intensity * this.config.speedReductionFactor);
        }

        this.collisionHistory.push({
            time: Date.now(),
            type: 'traffic',
            intensity: intensity,
            position: { x: playerPos.x, z: playerPos.z }
        });

        if (this.collisionHistory.length > 20) {
            this.collisionHistory.shift();
        }

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


    _handleEnvironmentCollision(envCollider) {
        if (this.collisionCooldown > 0) return;
        this.collisionCooldown = this.config.collisionCooldown;

        const playerPos = this.playerBus.group.position;

        const dx = playerPos.x - envCollider.x;
        const dz = playerPos.z - envCollider.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.001) {
            const pushX = dx / dist;
            const pushZ = dz / dist;

            const pushForce = this.config.maxPushForce * 0.5;
            playerPos.x += pushX * pushForce * 0.1;
            playerPos.z += pushZ * pushForce * 0.1;
        }

        if (this.playerBus?.speed !== undefined) {
            this.playerBus.speed *= 0.3;
        }

        this.collisionHistory.push({
            time: Date.now(),
            type: 'environment',
            intensity: 0.8,
            position: { x: playerPos.x, z: playerPos.z }
        });

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


    _handleTrafficVsTraffic(a, b) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minDist = a.radius + b.radius;

        if (dist < minDist && dist > 0.001) {
            const pushDist = (minDist - dist) / 2;
            const pushX = (dx / dist) * pushDist;
            const pushZ = (dz / dist) * pushDist;

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



    addStaticCollider(collider) {
        this.environmentColliders.push(collider);
        this.staticHash.insert(collider);
    }


    addBoxCollider(x, z, width, length, rotation = 0) {
        const collider = new BoxCollider(x, z, width, length, rotation, COLLIDER_TYPES.ENVIRONMENT);
        this.addStaticCollider(collider);
        return collider;
    }


    addSphereCollider(x, z, radius) {
        const collider = new SphereCollider(x, z, radius, COLLIDER_TYPES.ENVIRONMENT);
        this.addStaticCollider(collider);
        return collider;
    }


    getCollisionHistory() {
        return this.collisionHistory;
    }


    hasRecentCollision(timeWindow = 5000) {
        const now = Date.now();
        return this.collisionHistory.some(c => now - c.time < timeWindow);
    }


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


    _updateDebugVisuals() {
        if (!this.debugGroup) return;

        while (this.debugGroup.children.length > 0) {
            const child = this.debugGroup.children[0];
            this.debugGroup.remove(child);
        }

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


export function createCollisionSystem(options) {
    return new CollisionSystem(options);
}
