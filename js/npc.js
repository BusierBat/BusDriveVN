// js/npc.js - FULL NPC SYSTEM (FIXED: NO FLYING BUSES, NO BABY PEDESTRIANS)
import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor } from "./bus.js";

// =====================================================================
// UTILITY: Seeded Random (nếu utils.js không export thì dùng cái này)
// =====================================================================
function createSeededRandom(seed) {
    let s = seed || 1234;
    return function () {
        s = (s * 16807 + 0) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
        }
    });
}

// =====================================================================
// DANH SÁCH LỜI THOẠI CHO TÀI XẾ U70 (GIỮ NGUYÊN)
// =====================================================================
const GRUMPY_DIALOGUES = {
    blocked: [
        "Xe gì mà chạy như rùa thế hả?",
        "Lên xe là lên, đừng có cà rớt!",
        "Thắng cái đít à?",
        "Chạy ẩu thế bố, ông đây chạy xe từ đời cụ tổ!",
        "Đi mà học luật giao thông đi con!",
        "Ông tránh cho, chứ ông không thắng đâu!",
    ],
    overtaking: [
        "Vượt nhanh lên, kẻo hết xăng!",
        "Ông đây vượt phát là qua, đừng có cản!",
        "Nhường đường cho người có kinh nghiệm đi!",
        "Thế mới là lái xe!",
        "Xe nó bốc, nhưng ông còn bốc hơn!",
    ],
    stopping: [
        "Dừng tí cho ông hút thuốc, đừng có sốt ruột!",
        "Khách xuống chậm như rùa, xuống nhanh lên!",
        "Ông đợi 20 giây, ai không kịp thì chạy bộ!",
        "Chén cà phê đã, rồi tính tiếp.",
        "Hít thở tí, đường dài còn chạy!",
    ],
    cutOff: [
        "Tạt đầu cái gì mà tạt, ông đây không sợ!",
        "Mày đang ở đâu thế? Có biết luật không?",
        "Rồi, lại thêm thằng thiếu não nữa.",
        "Ông mà trẻ như mày thì ông tạt lại rồi!",
        "Bố mày đây, cẩn thận kẻo ân hận!",
    ],
    stuck: [
        "Kẹt xe thế này thì ông về già mất!",
        "Đường nào cũng kẹt, trời đánh cái đám này!",
        "Bực mình! Chạy mãi chẳng tới!",
        "Thôi rồi, ông lại điền vào sổ mất!",
        "Kiểu này ông chạy đến Sài Gòn cũng không kịp cơm!",
    ],
    start: [
        "Nổ máy nào, đi thôi!",
        "Dậy nào, đường còn dài!",
        "Ông đây rồi, xe cộ nhường đường!",
        "Phú Yên… Sài Gòn, ông đến rồi đây!",
    ]
};

// =====================================================================
// TRAFFIC SPAWN MANAGER – Xe NPC ngoài đường (GIỮ NGUYÊN LOGIC GỐC)
// =====================================================================
class TrafficSpawnManager {
    constructor({
        scene,
        edges,
        edgePaths,
        random,
        group,
        targetActive = 30,
        maxActive = 50,
        spawnDistance = 350,
        despawnDistance = 550,
        seed = 1234
    }) {
        this.scene = scene;
        this.edges = edges;
        this.edgePaths = edgePaths;
        this.random = random;
        this.group = group;
        this.targetActive = targetActive;
        this.maxActive = maxActive;
        this.spawnDistance = spawnDistance;
        this.despawnDistance = despawnDistance;
        this.seed = seed;
        this.activeBuses = [];
        this.pooledBuses = [];
        this.totalSpawned = 0;
        this._tempVec = new THREE.Vector3();
        this._playerPos = { x: 0, z: 0 };
        this._spawnTimer = 0;
        this._spawnInterval = 2.0;

        for (let i = 0; i < 10; i++) {
            this._spawnNewVehicle();
        }
    }

    setPlayerPos(x, z) {
        this._playerPos.x = x;
        this._playerPos.z = z;
    }

    _spawnNewVehicle() {
        if (this.activeBuses.length >= this.maxActive) return null;
        const edgeIndex = this._findRandomEdgeNearPlayer();
        if (edgeIndex === null) return null;
        const edge = this.edges[edgeIndex];
        const path = this.edgePaths[edgeIndex];
        if (!edge || !path || edge.points.length < 2) return null;

        let v = null;
        let tooClose = false;
        let attempts = 0;

        while (attempts < 5) {
            const dir = this.random() < 0.8 ? 1 : -1;
            const laneOffset = -0.3 * edge.width;
            const s = this.random() * 0.8 * path.total + 0.1 * path.total;

            let bus;
            if (this.pooledBuses.length > 0) {
                const vehicleData = this.pooledBuses.pop();
                bus = vehicleData.bus;
                bus.group.visible = true;
            } else {
                const skin = pickNpcSkinPath();
                const ledColor = pickLedColor();
                bus = createNpcBus({ skinPath: skin, ledColor: ledColor });
                this.group.add(bus.group);
            }

            const personality = this._randomPersonality();
            v = {
                bus: bus,
                edgeIndex: edgeIndex,
                dir: dir,
                s: s,
                speed: 0,
                maxSpeed: 8 + this.random() * 6,
                laneOffset: laneOffset,
                laneCurrent: laneOffset,
                laneTarget: laneOffset,
                targetSpeed: 0,
                heading: 0,
                turning: false,
                turnProgress: 0,
                oldHeading: 0,
                targetHeading: 0,
                collider: { x: 0, z: 0, r: 1.4 },
                active: true,
                obstacleDetected: false,
                obstacleAngle: 0,
                laneChangeTimer: 0,
                isLaneChanging: false,
                aiState: 'CRUISING',
                personality: personality,
                stopTimer: 0,
                stopDuration: 0,
                shouldStop: this.random() < 0.15,
                overtakeCooldown: 0,
                aggressiveFactor: 0,
                isGrumpy: personality === 'OLD_GRUMPY',
                complaintCooldown: 0,
                _targetPos: new THREE.Vector3(),
                _targetLook: new THREE.Vector3()
            };

            this._samplePose(v, v.s, v.laneOffset);

            tooClose = false;
            for (const other of this.activeBuses) {
                const dx = other.collider.x - v.collider.x;
                const dz = other.collider.z - v.collider.z;
                if (Math.hypot(dx, dz) < 5) {
                    tooClose = true;
                    break;
                }
            }

            if (!tooClose) {
                break;
            } else {
                this.pooledBuses.push({ bus: bus });
                attempts++;
            }
        }

        if (tooClose || !v) return null;

        v.heading = v.targetHeading || 0;
        v.targetSpeed = v.maxSpeed * (0.6 + this.random() * 0.4);
        this._applyVehicleState(v);
        this.activeBuses.push(v);
        this.totalSpawned++;
        return v;
    }

    _randomPersonality() {
        const r = this.random();
        if (r < 0.20) return 'CAREFUL';
        if (r < 0.60) return 'NORMAL';
        if (r < 0.92) return 'AGGRESSIVE';
        return 'OLD_GRUMPY';
    }

    _getPersonalityFactor(personality) {
        switch (personality) {
            case 'CAREFUL':
                return { speedMul: 0.7, followDist: 12, overtakeProb: 0.02, laneChangeProb: 0.01, aggressive: 0 };
            case 'NORMAL':
                return { speedMul: 0.9, followDist: 8, overtakeProb: 0.08, laneChangeProb: 0.03, aggressive: 0.3 };
            case 'AGGRESSIVE':
                return { speedMul: 1.1, followDist: 5, overtakeProb: 0.25, laneChangeProb: 0.08, aggressive: 0.7 };
            case 'OLD_GRUMPY':
                return { speedMul: 0.85, followDist: 6, overtakeProb: 0.12, laneChangeProb: 0.04, aggressive: 0.4 };
            default:
                return { speedMul: 0.9, followDist: 8, overtakeProb: 0.05, laneChangeProb: 0.02, aggressive: 0.2 };
        }
    }

    _getDialogue(eventType) {
        const list = GRUMPY_DIALOGUES[eventType] || GRUMPY_DIALOGUES.stuck;
        return list[Math.floor(this.random() * list.length)];
    }

    _triggerComplaint(v, eventType) {
        if (!v.isGrumpy) return;
        if (v.complaintCooldown > 0) return;
        const msg = this._getDialogue(eventType);
        if (typeof window.showToast === 'function') {
            window.showToast(`🧓 ${msg}`);
        } else {
            console.log(`🧓 [U70]: ${msg}`);
        }
        v.complaintCooldown = 5 + this.random() * 4;
    }

    _findRandomEdgeNearPlayer() {
        const px = this._playerPos.x;
        const pz = this._playerPos.z;
        const candidates = [];
        for (let i = 0; i < this.edges.length; i++) {
            const e = this.edges[i];
            if (!e || !e.points || e.points.length < 2) continue;
            const minX = Math.min(e.points[0].x, e.points[1].x);
            const maxX = Math.max(e.points[0].x, e.points[1].x);
            const minZ = Math.min(e.points[0].z, e.points[1].z);
            const maxZ = Math.max(e.points[0].z, e.points[1].z);
            const cx = (minX + maxX) / 2;
            const cz = (minZ + maxZ) / 2;
            const dist = Math.hypot(cx - px, cz - pz);
            if (dist < this.spawnDistance) {
                candidates.push(i);
            }
        }
        if (candidates.length === 0) return null;
        return candidates[Math.floor(this.random() * candidates.length)];
    }

    _samplePose(v, s, lane) {
        const edge = this.edges[v.edgeIndex];
        const path = this.edgePaths[v.edgeIndex];
        if (!edge || !path || edge.points.length < 2) {
            v.collider.x = 0; v.collider.z = 0;
            v.heading = 0;
            return;
        }
        const dir = v.dir;
        const abs = dir === 1 ? s : path.total - s;
        let i = 1;
        while (i < edge.points.length - 1 && path.cum[i] < abs) i++;
        const a = edge.points[i - 1];
        const b = edge.points[i];
        const seg = path.cum[i] - path.cum[i - 1] || 1;
        const t = (abs - path.cum[i - 1]) / seg;
        let tx = (b.x - a.x) / seg;
        let tz = (b.z - a.z) / seg;
        if (dir === -1) { tx = -tx; tz = -tz; }
        const x = a.x + (b.x - a.x) * t - tz * lane;
        const z = a.z + (b.z - a.z) * t + tx * lane;
        v.collider.x = x;
        v.collider.z = z;
        v.heading = Math.atan2(tx, tz);
    }

    _applyVehicleState(v) {
        const bus = v.bus;
        // FIX: y = 0.5 để xe bám đất, KHÔNG BAY
        bus.group.position.set(v.collider.x, 0.5, v.collider.z);
        bus.group.rotation.y = v.heading;
        bus.setDoor(0);
        bus.setHeadlights(false);
        bus.setInteriorLed(false);
    }

    _findFollowTarget(v, allVehicles) {
        const maxDist = 50;
        let best = null, bestDist = maxDist;
        const vx = Math.sin(v.heading || 0);
        const vz = Math.cos(v.heading || 0);
        for (const other of allVehicles) {
            if (other === v) continue;
            const dx = other.collider.x - v.collider.x;
            const dz = other.collider.z - v.collider.z;
            const dist = Math.hypot(dx, dz);
            if (dist > maxDist) continue;
            const dot = dx * vx + dz * vz;
            if (dot < 0) continue;
            const perp = -dx * vz + dz * vx;
            const laneWidth = 1.8;
            if (Math.abs(perp) > laneWidth * 2) continue;
            if (dist < bestDist) { bestDist = dist; best = other; }
        }
        return best;
    }

    _canChangeLane(v, allVehicles, newLane) {
        const vx = Math.sin(v.heading || 0);
        const vz = Math.cos(v.heading || 0);
        const laneWidth = 1.8;
        for (const other of allVehicles) {
            if (other === v) continue;
            const dx = other.collider.x - v.collider.x;
            const dz = other.collider.z - v.collider.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 15) continue;
            const dot = dx * vx + dz * vz;
            if (dot > 0 && dot < 20) {
                const perp = -dx * vz + dz * vx;
                const laneDiff = Math.abs(perp - newLane);
                if (laneDiff < laneWidth) return false;
            }
        }
        return true;
    }

    _canOvertake(v, allVehicles) {
        const side = this.random() > 0.5 ? 1 : -1;
        const newLane = v.laneOffset + side * 0.6;
        return this._canChangeLane(v, allVehicles, newLane);
    }

    _chooseNextEdge(v) {
        const nid = this.edges[v.edgeIndex].to;
        const opts = [];
        for (let i = 0; i < this.edges.length; i++) {
            const e = this.edges[i];
            if (e.from === nid && i !== v.edgeIndex) {
                opts.push(i);
            }
        }
        if (opts.length === 0) {
            v.dir *= -1;
            v.s = 0.1;
            return;
        }
        const newIdx = opts[Math.floor(this.random() * opts.length)];
        v.edgeIndex = newIdx;
        v.dir = this.edges[newIdx].from === nid ? 1 : -1;
        v.s = 0.1;
        v.laneOffset = 0.3 * this.edges[v.edgeIndex].width;
        v.laneCurrent = v.laneOffset;
        v.laneTarget = v.laneOffset;
    }

    update(dt, playerPos) {
        if (playerPos) {
            this._playerPos.x = playerPos.x;
            this._playerPos.z = playerPos.z;
        }

        this._spawnTimer += dt;
        if (this.activeBuses.length < this.targetActive && this._spawnTimer > this._spawnInterval) {
            this._spawnTimer = 0;
            this._spawnNewVehicle();
        }

        const toRemove = [];
        const allVehicles = this.activeBuses;

        for (let i = 0; i < this.activeBuses.length; i++) {
            const v = this.activeBuses[i];

            const dx = v.collider.x - this._playerPos.x;
            const dz = v.collider.z - this._playerPos.z;
            const dist = Math.hypot(dx, dz);

            if (dist > this.despawnDistance) {
                toRemove.push(i);
                continue;
            }

            if (v.isStatic) continue;

            const target = this._findFollowTarget(v, allVehicles);
            const pFactor = this._getPersonalityFactor(v.personality);

            if (target) {
                const tDist = Math.hypot(target.collider.x - v.collider.x, target.collider.z - v.collider.z);
                if (tDist < pFactor.followDist * 0.8) {
                    v.aiState = 'FOLLOWING';
                    v.targetSpeed = Math.min(v.maxSpeed, (target.speed || 0) * 0.9);
                } else if (tDist < pFactor.followDist * 0.5) {
                    v.aiState = 'BRAKING';
                    v.targetSpeed = 0;
                } else {
                    v.aiState = 'CRUISING';
                    v.targetSpeed = v.maxSpeed * pFactor.speedMul;
                }
            } else {
                v.aiState = 'CRUISING';
                v.targetSpeed = v.maxSpeed * pFactor.speedMul;
            }

            if (v.speed < v.targetSpeed) {
                v.speed += 2.0 * dt;
                if (v.speed > v.targetSpeed) v.speed = v.targetSpeed;
            } else if (v.speed > v.targetSpeed) {
                v.speed -= 5.0 * dt;
                if (v.speed < v.targetSpeed) v.speed = v.targetSpeed;
            }
            v.speed = Math.max(0, v.speed);

            if (v.shouldStop && v.aiState === 'CRUISING' && Math.random() < 0.0005) {
                v.aiState = 'STOPPING';
                v.stopTimer = 20;
                v.speed = 0;
                v.targetSpeed = 0;
            }

            if (v.aiState === 'STOPPING') {
                v.stopTimer -= dt;
                v.targetSpeed = 0;
                if (v.speed > 0) v.speed -= 5.0 * dt;
                if (v.speed < 0) v.speed = 0;

                if (v.stopTimer <= 0) {
                    v.aiState = 'CRUISING';
                    v.shouldStop = false;
                    v.targetSpeed = v.maxSpeed * pFactor.speedMul * 0.5;
                }
            } else {
                v.s += v.speed * v.dir * dt;
                const path = this.edgePaths[v.edgeIndex];
                if (v.s > path.total) {
                    v.s = 0.1;
                    this._chooseNextEdge(v);
                } else if (v.s < 0) {
                    v.s = path.total - 0.1;
                    this._chooseNextEdge(v);
                }
            }

            if (v.aiState === 'FOLLOWING' && pFactor.overtakeProb > 0 && Math.random() < pFactor.overtakeProb * 0.05) {
                if (this._canOvertake(v, allVehicles)) {
                    v.laneTarget = v.laneOffset > 0 ? -0.3 * this.edges[v.edgeIndex].width : 0.3 * this.edges[v.edgeIndex].width;
                }
            }

            v.laneOffset += (v.laneTarget - v.laneOffset) * Math.min(1, dt * 2);

            this._samplePose(v, v.s, v.laneOffset);
            this._applyVehicleState(v);

            if (v.bus.setWheelRotation) {
                v.bus.setWheelRotation(v.speed * dt * 2);
            }

            if (v.complaintCooldown > 0) v.complaintCooldown -= dt;
        }

        for (let i = toRemove.length - 1; i >= 0; i--) {
            const idx = toRemove[i];
            const v = this.activeBuses[idx];
            v.bus.group.visible = false;
            this.pooledBuses.push(v);
            this.activeBuses.splice(idx, 1);
        }
    }

    getColliders() {
        const colliders = [];
        for (const v of this.activeBuses) {
            if (v.active) {
                colliders.push({ x: v.collider.x, z: v.collider.z, r: v.collider.r });
            }
        }
        return colliders;
    }

    getActiveCount() {
        return this.activeBuses.length;
    }

    dispose() {
        for (const v of this.activeBuses) {
            this.group.remove(v.bus.group);
        }
        this.activeBuses = [];
        this.pooledBuses = [];
    }
}

// =====================================================================
// BUS STATION MANAGER – Xe NPC ở bến, trạm dừng, cây xăng
// FIX: y = 0.5, KHÔNG BAY LÊN TRỜI
// =====================================================================
class BusStationManager {
    constructor(scene, map, parkingSlots, playerSpawnPos) {
        this.scene = scene;
        this.map = map;
        this.stationBuses = [];
        this.group = new THREE.Group();
        this.group.name = "stationBuses";
        this.scene.add(this.group);

        const slots = parkingSlots || [];
        // Bỏ qua slot đầu tiên (dành cho player)
        for (let i = 1; i < Math.min(slots.length, 6); i++) {
            const slot = slots[i];
            if (!slot || !slot.position) continue;

            const skin = pickNpcSkinPath();
            const ledColor = pickLedColor();
            const npcBus = createNpcBus({ skinPath: skin, ledColor: ledColor });

            // FIX: y = 0.5 ĐỂ XE BÁM ĐẤT, KHÔNG PHẢI 1.65 HAY 2.0
            npcBus.group.position.set(
                slot.position.x,
                0.5,
                slot.position.z
            );
            npcBus.group.rotation.y = slot.rotation || 0;
            npcBus.setHeadlights(false);
            npcBus.setTaillights(true);
            npcBus.setInteriorLed(true);
            npcBus.setDoor(0);

            this.group.add(npcBus.group);
            this.stationBuses.push({
                bus: npcBus,
                slot: slot,
                isStatic: true
            });
        }
    }

    update(dt) {
        // Xe ở bến đứng yên, không cần update vị trí
        // Chỉ update animation nhẹ (đèn blink, etc.)
        for (const sb of this.stationBuses) {
            if (sb.bus.setWheelRotation) {
                sb.bus.setWheelRotation(0);
            }
        }
    }

    getColliders() {
        const colliders = [];
        for (const sb of this.stationBuses) {
            if (sb.bus.group.visible) {
                colliders.push({
                    x: sb.bus.group.position.x,
                    z: sb.bus.group.position.z,
                    r: 1.5,
                    isStatic: true
                });
            }
        }
        return colliders;
    }

    dispose() {
        for (const sb of this.stationBuses) {
            this.group.remove(sb.bus.group);
        }
        this.stationBuses = [];
        if (this.group.parent) this.group.parent.remove(this.group);
    }
}

// =====================================================================
// PEDESTRIAN MANAGER – NPC người đi bộ
// FIX: Chiều cao 1.65m thật, KHÔNG PHẢI em bé lùn tịt
// FIX: Thêm state AVOIDING để tránh xe lao tới
// =====================================================================
class PedestrianManager {
    constructor({ scene, map, seed = 2028 }) {
        this.scene = scene;
        this.map = map;
        this.random = createSeededRandom(seed);
        this.pedestrians = [];
        this.group = new THREE.Group();
        this.group.name = "pedestrians";
        this.scene.add(this.group);
        this.playerPos = { x: 0, z: 0 };
        this.playerSpeedKmh = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 1.5;
        this.maxPedestrians = 30;
        this.despawnDistance = 120;

        // FIX: Geometry đúng tỷ lệ người thật 1.65m
        // CapsuleGeometry(radius, length, capSegments, radialSegments)
        // Tổng chiều cao = length + 2*radius = 1.25 + 0.4 = 1.65m
        this.bodyGeo = new THREE.CapsuleGeometry(0.2, 1.25, 4, 6);
        this.headGeo = new THREE.SphereGeometry(0.16, 6, 6);
        this.skinColors = [0xe8c9a0, 0xd4a574, 0xc4956a, 0xf5d6b8];
        this.clothColors = [0x4a6fa5, 0xd64545, 0x2d7d46, 0x8b6b4a, 0x5d7f9c, 0x7c5f8f];
    }

    _createPedestrian(x, z) {
        const group = new THREE.Group();
        const skinColor = this.skinColors[Math.floor(this.random() * this.skinColors.length)];
        const clothColor = this.clothColors[Math.floor(this.random() * this.clothColors.length)];

        const body = new THREE.Mesh(
            this.bodyGeo,
            new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.8 })
        );
        // FIX: Tâm capsule ở y = 0.825 để chân chạm đất (y=0)
        // Chiều cao capsule = 1.25 + 2*0.2 = 1.65m, nửa chiều cao = 0.825
        body.position.y = 0.825;
        group.add(body);

        const head = new THREE.Mesh(
            this.headGeo,
            new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 })
        );
        // FIX: Đầu ở đỉnh, y = 1.55 (gần đỉnh 1.65m)
        head.position.y = 1.55;
        group.add(head);

        group.position.set(x, 0, z);
        group.rotation.y = this.random() * Math.PI * 2;
        this.group.add(group);

        return {
            group,
            x, z,
            state: 'IDLE',
            timer: 0,
            nextAction: 2 + this.random() * 4,
            targetX: x,
            targetZ: z,
            avoidTimer: 0
        };
    }

    _spawnNearPlayer() {
        if (this.pedestrians.length >= this.maxPedestrians) return;
        const pois = this.map.getPointsOfInterest ? this.map.getPointsOfInterest() : [];
        if (pois.length === 0) return;

        let nearestPoi = null;
        let nearestDist = Infinity;
        for (const poi of pois) {
            const dx = poi.position.x - this.playerPos.x;
            const dz = poi.position.z - this.playerPos.z;
            const dist = Math.hypot(dx, dz);
            if (dist < nearestDist && dist < 80) {
                nearestDist = dist;
                nearestPoi = poi;
            }
        }
        if (!nearestPoi) return;

        let density = 1;
        if (nearestPoi.type === 'bus_station') density = 5;
        else if (nearestPoi.type === 'rest_stop') density = 3;
        else if (nearestPoi.type === 'gas_station') density = 2;

        const count = Math.floor(density * (0.5 + this.random() * 0.5));
        for (let i = 0; i < count; i++) {
            if (this.pedestrians.length >= this.maxPedestrians) break;
            const angle = this.random() * Math.PI * 2;
            const dist = 5 + this.random() * 15;
            const x = nearestPoi.position.x + Math.cos(angle) * dist;
            const z = nearestPoi.position.z + Math.sin(angle) * dist;
            const ped = this._createPedestrian(x, z);
            this.pedestrians.push(ped);
        }
    }

    update(deltaTime, playerPos, playerSpeedKmh) {
        if (playerPos) {
            this.playerPos.x = playerPos.x;
            this.playerPos.z = playerPos.z;
        }
        if (playerSpeedKmh !== undefined) {
            this.playerSpeedKmh = playerSpeedKmh;
        }

        this.spawnTimer += deltaTime;
        if (this.spawnTimer > this.spawnInterval) {
            this.spawnTimer = 0;
            this._spawnNearPlayer();
        }

        const toRemove = [];
        for (let i = 0; i < this.pedestrians.length; i++) {
            const ped = this.pedestrians[i];
            const dx = ped.x - this.playerPos.x;
            const dz = ped.z - this.playerPos.z;
            const dist = Math.hypot(dx, dz);

            if (dist > this.despawnDistance) {
                toRemove.push(i);
                continue;
            }

            // FIX: NPC THÔNG MINH - AVOIDING STATE
            // Nếu xe player lao tới quá gần (< 8m) và đang chạy nhanh (> 10 km/h)
            if (dist < 8 && this.playerSpeedKmh > 10) {
                ped.state = 'AVOIDING';
                ped.avoidTimer = 2.0;
                // Né sang bên (vuông góc với hướng xe tới)
                const avoidDirX = dx / (dist || 1);
                const avoidDirZ = dz / (dist || 1);
                ped.x += avoidDirX * 3.0 * deltaTime;
                ped.z += avoidDirZ * 3.0 * deltaTime;
                ped.group.position.x = ped.x;
                ped.group.position.z = ped.z;
                ped.group.rotation.y = Math.atan2(avoidDirX, avoidDirZ);
                continue;
            }

            // Giảm avoid timer
            if (ped.state === 'AVOIDING') {
                ped.avoidTimer -= deltaTime;
                if (ped.avoidTimer <= 0 && dist > 10) {
                    ped.state = 'IDLE';
                } else {
                    continue;
                }
            }

            ped.timer += deltaTime;
            if (ped.timer > ped.nextAction) {
                ped.timer = 0;
                ped.nextAction = 2 + this.random() * 4;
                if (ped.state === 'IDLE') {
                    ped.state = 'WALKING';
                    const angle = this.random() * Math.PI * 2;
                    const moveDist = 2 + this.random() * 4;
                    ped.targetX = ped.x + Math.cos(angle) * moveDist;
                    ped.targetZ = ped.z + Math.sin(angle) * moveDist;
                } else {
                    ped.state = 'IDLE';
                }
            }

            if (ped.state === 'WALKING') {
                const tdx = ped.targetX - ped.x;
                const tdz = ped.targetZ - ped.z;
                const tDist = Math.hypot(tdx, tdz);
                if (tDist > 0.1) {
                    const walkSpeed = 0.8; // m/s
                    ped.x += (tdx / tDist) * walkSpeed * deltaTime;
                    ped.z += (tdz / tDist) * walkSpeed * deltaTime;
                    ped.group.position.x = ped.x;
                    ped.group.position.z = ped.z;
                    ped.group.rotation.y = Math.atan2(tdx, tdz);
                } else {
                    ped.state = 'IDLE';
                }
            }
        }

        for (let i = toRemove.length - 1; i >= 0; i--) {
            const ped = this.pedestrians[toRemove[i]];
            this.group.remove(ped.group);
            this.pedestrians.splice(toRemove[i], 1);
        }
    }

    setPlayerPos(x, z) {
        this.playerPos.x = x;
        this.playerPos.z = z;
    }

    dispose() {
        this.scene.remove(this.group);
    }
}

// =====================================================================
// HÀM EXPORT CHÍNH - NAMED EXPORT CHO MAIN.JS
// =====================================================================
export function createNPC({ scene, map, seed = 2027, playerBus = null, playerSpawnPos = null } = {}) {
    if (!map || typeof map.getRoadGraph !== "function") {
        const g = new THREE.Group();
        return {
            group: g,
            update() {},
            dispose() { if (g.parent) g.parent.remove(g); },
            getWaitingPassengers: () => [],
            pickUpPassenger: () => false,
            dropOffPassenger: () => false,
            getMovingVehicleCount: () => 0,
            getColliders: () => [],
            setPlayerBus() {},
            setTrafficDensity() {},
            getBusStationManager: () => null,
            getTrafficSpawnManager: () => null,
            getPedestrianManager: () => null
        };
    }

    const random = createSeededRandom(seed);
    const group = new THREE.Group();
    group.name = "npc";
    scene.add(group);

    const graph = map.getRoadGraph();
    const edges = graph.edges;
    const nodes = graph.nodes;
    let edgePaths = [];

    function rebuildEdgePaths() {
        if (edgePaths.length === edges.length) return;
        edgePaths = edges.map((e) => {
            const cum = new Float32Array(e.points.length);
            let total = 0;
            for (let i = 1; i < e.points.length; i++) {
                total += Math.hypot(e.points[i].x - e.points[i - 1].x, e.points[i].z - e.points[i - 1].z);
                cum[i] = total;
            }
            return { cum, total: total || 1 };
        });
    }
    rebuildEdgePaths();

    const spawnManager = new TrafficSpawnManager({
        scene,
        edges,
        edgePaths,
        random,
        group,
        targetActive: 25,
        maxActive: 40,
        spawnDistance: 350,
        despawnDistance: 550,
        seed: seed + 999
    });

    let stationManager = null;
    const parkingSlots = (map.getParkingSlots && map.getParkingSlots()) || [];
    if (parkingSlots.length > 0) {
        try {
            stationManager = new BusStationManager(scene, map, parkingSlots, playerSpawnPos);
        } catch (e) {
            console.warn("BusStationManager init failed:", e);
        }
    }

    const pedestrianManager = new PedestrianManager({ scene, map, seed: seed + 1 });

    let playerRef = playerBus || null;
    const playerScratch = { x: 0, z: 0 };
    let playerSpeedKmh = 0;

    function getPlayerPos() {
        if (!playerRef && scene) {
            for (const c of scene.children) {
                if (c.name === "bus") { playerRef = c; break; }
            }
        }
        if (playerRef) {
            // Support cả playerBus là bus object (có .group) hoặc trực tiếp là group
            const pos = playerRef.group ? playerRef.group.position : playerRef.position;
            if (pos) {
                playerScratch.x = pos.x;
                playerScratch.z = pos.z;
                // Lấy tốc độ player để truyền cho pedestrian avoidance
                if (playerRef.speedKmh !== undefined) playerSpeedKmh = playerRef.speedKmh;
                else if (playerRef.currentSpeedKmh !== undefined) playerSpeedKmh = playerRef.currentSpeedKmh;
                return true;
            }
        }
        return false;
    }

    function update(dt, t = 0) {
        const hasPlayer = getPlayerPos();
        if (hasPlayer) {
            spawnManager.setPlayerPos(playerScratch.x, playerScratch.z);
            spawnManager.update(dt, { x: playerScratch.x, z: playerScratch.z });
            pedestrianManager.setPlayerPos(playerScratch.x, playerScratch.z);
            // FIX: Truyền tốc độ xe player vào để NPC biết tránh
            pedestrianManager.update(dt, { x: playerScratch.x, z: playerScratch.z }, playerSpeedKmh);
        } else {
            spawnManager.update(dt, null);
            pedestrianManager.update(dt, null, 0);
        }
        if (stationManager) {
            stationManager.update(dt);
        }
    }

    function getColliders() {
        const all = spawnManager.getColliders();
        if (stationManager) {
            const stationColliders = stationManager.getColliders();
            all.push(...stationColliders);
        }
        return all;
    }

    function dispose() {
        if (scene) scene.remove(group);
        disposeObject3D(group);
        spawnManager.dispose();
        pedestrianManager.dispose();
        if (stationManager) stationManager.dispose();
    }

    return {
        group,
        update,
        dispose,
        getWaitingPassengers: () => [],
        pickUpPassenger: () => false,
        dropOffPassenger: () => false,
        getMovingVehicleCount: () => spawnManager.getActiveCount(),
        getColliders,
        setPlayerBus(b) { playerRef = b; },
        setTrafficDensity() {},
        getBusStationManager: () => stationManager,
        getTrafficSpawnManager: () => spawnManager,
        getPedestrianManager: () => pedestrianManager
    };
}