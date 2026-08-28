// js/npc.js - INFINITE TRAFFIC + RESPAWN + OBJECT POOL + OLD_GRUMPY
import * as THREE from "three";
import { clamp, randomFloat, pick, createSeededRandom, disposeObject3D } from "./utils.js";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "./bus.js";

const TWO_PI = Math.PI * 2;

function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; return d; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function lerpAngle(a, b, t) { let diff = b - a; while (diff > Math.PI) diff -= TWO_PI; while (diff < -Math.PI) diff += TWO_PI; return a + diff * clamp(t, 0, 1); }

// ===== DANH SÁCH LỜI THOẠI CHO TÀI XẾ U70 =====
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

// ===== QUẢN LÝ BẾN XE (STATIC) =====
export class BusStationManager {
    constructor(scene, map, parkingSlots, playerSpawnPos) {
        this.scene = scene;
        this.map = map;
        this.parkingSlots = parkingSlots || [];
        this.playerSpawnPos = playerSpawnPos || null;
        this.stationBuses = [];
        this.busGroup = new THREE.Group();
        this.scene.add(this.busGroup);
        this.spawnStationBuses();
    }

    spawnStationBuses() {
        let isPhuYen = false;
        if (this.parkingSlots.length > 0) {
            const firstSlot = this.parkingSlots[0];
            if (Math.abs(firstSlot.position.x) < 100 && Math.abs(firstSlot.position.z) < 100) {
                isPhuYen = true;
            }
        }

        const availableSlots = this.parkingSlots.filter(s => !s.occupied);
        let baseFillRate = 0.50 + Math.random() * 0.10;
        if (isPhuYen) {
            baseFillRate = Math.min(0.25, baseFillRate * 0.3);
        }
        const fillRate = Math.max(0.15, Math.min(0.65, baseFillRate));
        const count = Math.floor(availableSlots.length * fillRate);
        const shuffled = availableSlots.sort(() => Math.random() - 0.5);
        let selectedSlots = shuffled.slice(0, count);

        if (this.playerSpawnPos) {
            const spawnX = this.playerSpawnPos.x;
            const spawnZ = this.playerSpawnPos.z;
            selectedSlots = selectedSlots.filter(slot => {
                const dx = slot.position.x - spawnX;
                const dz = slot.position.z - spawnZ;
                return Math.hypot(dx, dz) > 7.0;
            });
        }
        if (selectedSlots.length < 2) {
            selectedSlots = shuffled.slice(0, Math.min(4, shuffled.length));
        }

        for (const slot of selectedSlots) {
            this._spawnBus(slot.position.x, slot.position.z, slot.rotation || 0);
            slot.occupied = true;
        }

        let basePos = { x: 0, z: 0 };
        if (this.parkingSlots.length > 0) {
            basePos.x = this.parkingSlots[0].position.x;
            basePos.z = this.parkingSlots[0].position.z;
        }

        const extraCountBase = Math.floor(availableSlots.length * 0.08);
        const extraCount = isPhuYen ? Math.min(2, Math.floor(extraCountBase * 0.3)) : Math.min(4, extraCountBase);
        const extraPositions = [];
        const directions = [
            { dx: 1, dz: 0 },
            { dx: -1, dz: 0 },
            { dx: 0, dz: 1 },
            { dx: 0, dz: -1 }
        ];

        for (let i = 0; i < extraCount && i < directions.length * 2; i++) {
            const dirIdx = i % directions.length;
            const dir = directions[dirIdx];
            const dist = 10 + Math.random() * 5;
            const x = basePos.x + dir.dx * dist + (Math.random() - 0.5) * 1.5;
            const z = basePos.z + dir.dz * dist + (Math.random() - 0.5) * 1.5;

            if (this.playerSpawnPos) {
                const dx = x - this.playerSpawnPos.x;
                const dz = z - this.playerSpawnPos.z;
                if (Math.hypot(dx, dz) < 10.0) continue;
            }

            let overlap = false;
            for (const slot of selectedSlots) {
                const dx = slot.position.x - x;
                const dz = slot.position.z - z;
                if (Math.hypot(dx, dz) < 5.0) { overlap = true; break; }
            }
            for (const pos of extraPositions) {
                const dx = pos.x - x;
                const dz = pos.z - z;
                if (Math.hypot(dx, dz) < 5.0) { overlap = true; break; }
            }
            if (!overlap) {
                const rot = Math.atan2(dir.dx, dir.dz) + (Math.random() - 0.5) * 0.3;
                extraPositions.push({ x, z, rot });
            }
        }

        for (const pos of extraPositions) {
            this._spawnBus(pos.x, pos.z, pos.rot);
        }
    }

    _spawnBus(x, z, rot) {
        const skin = pickNpcSkinPath();
        const ledColor = pickLedColor();
        const bus = createNpcBus({ skinPath: skin, ledColor: ledColor });
        bus.group.position.set(x, 0.5, z);
        bus.group.rotation.y = rot;
        bus.setDoor(0);
        bus.setInteriorLed(false);
        bus.setHeadlights(false);
        this.busGroup.add(bus.group);

        this.stationBuses.push({
            bus: bus,
            state: 'PARKED',
            timer: Math.random() * 10,
            targetPos: new THREE.Vector3(x, 0.5, z),
            targetRot: rot,
            speed: 0,
            skin: skin,
            ledColor: ledColor,
            isStatic: true
        });
    }

    update(deltaTime) {
        // Chỉ làm hiệu ứng nhẹ, không AI
        for (const busData of this.stationBuses) {
            if (Math.random() > 0.995) {
                // Không làm gì nhiều
            }
        }
    }

    getColliders() {
        const colliders = [];
        for (const busData of this.stationBuses) {
            if (busData.bus.group.visible) {
                colliders.push({
                    x: busData.bus.group.position.x,
                    z: busData.bus.group.position.z,
                    r: 1.5,
                    isStatic: true
                });
            }
        }
        return colliders;
    }

    dispose() {
        this.scene.remove(this.busGroup);
    }
}

// ============================================================
// TRAFFIC SPAWN MANAGER – vô hạn + respawn + object pool
// ============================================================
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

        // Khởi tạo một vài xe ban đầu
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

        const dir = this.random() < 0.8 ? 1 : -1;
        const laneOffset = 0.3 * edge.width;
        const s = this.random() * 0.8 * path.total + 0.1 * path.total;

        let vehicleData = this.pooledBuses.pop();
        let bus;
        if (vehicleData) {
            bus = vehicleData.bus;
            bus.group.visible = true;
        } else {
            const skin = pickNpcSkinPath();
            const ledColor = pickLedColor();
            bus = createNpcBus({ skinPath: skin, ledColor: ledColor });
            this.group.add(bus.group);
        }

        // Random personality (có thêm OLD_GRUMPY 8%)
        const personality = this._randomPersonality();

        const v = {
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
            // Thêm thuộc tính cho OLD_GRUMPY
            isGrumpy: personality === 'OLD_GRUMPY',
            complaintCooldown: 0,
            _targetPos: new THREE.Vector3(),
            _targetLook: new THREE.Vector3()
        };

        this._samplePose(v, v.s, v.laneOffset);
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
        return 'OLD_GRUMPY'; // 8%
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

    // Lời thoại cho U70
    _getDialogue(eventType) {
        const list = GRUMPY_DIALOGUES[eventType] || GRUMPY_DIALOGUES.stuck;
        return list[Math.floor(this.random() * list.length)];
    }

    _triggerComplaint(v, eventType) {
        if (!v.isGrumpy) return;
        if (v.complaintCooldown > 0) return;
        const msg = this._getDialogue(eventType);
        // Hiển thị toast hoặc log (cosmetic)
        if (typeof window.showToast === 'function') {
            window.showToast(`🧓 ${msg}`);
        } else {
            console.log(`🧓 [U70]: ${msg}`);
        }
        v.complaintCooldown = 5 + this.random() * 4; // cooldown 5-9 giây
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
        bus.group.position.set(v.collider.x, 0.5, v.collider.z);
        bus.group.rotation.y = v.heading;
        bus.setDoor(0);
        bus.setHeadlights(false);
        bus.setInteriorLed(false);
        if (bus.setWheelRotation) bus.setWheelRotation(0);
        if (bus.setSteering) bus.setSteering(0);
    }

    _despawnVehicle(v) {
        v.active = false;
        v.bus.group.visible = false;
        this.pooledBuses.push({ bus: v.bus });
        const idx = this.activeBuses.indexOf(v);
        if (idx !== -1) this.activeBuses.splice(idx, 1);
    }

    update(dt, playerPos) {
        if (playerPos) {
            this.setPlayerPos(playerPos.x, playerPos.z);
        }

        const px = this._playerPos.x;
        const pz = this._playerPos.z;
        const toRemove = [];
        for (let i = 0; i < this.activeBuses.length; i++) {
            const v = this.activeBuses[i];
            const dx = v.collider.x - px;
            const dz = v.collider.z - pz;
            const dist = Math.hypot(dx, dz);
            if (dist > this.despawnDistance) {
                toRemove.push(i);
            }
        }
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const idx = toRemove[i];
            const v = this.activeBuses[idx];
            this._despawnVehicle(v);
        }

        this._spawnTimer += dt;
        if (this._spawnTimer > this._spawnInterval) {
            this._spawnTimer = 0;
            const currentCount = this.activeBuses.length;
            if (currentCount < this.targetActive) {
                const toSpawn = Math.min(this.targetActive - currentCount, 3);
                for (let i = 0; i < toSpawn; i++) {
                    this._spawnNewVehicle();
                }
            }
        }

        const allVehicles = this.activeBuses;
        for (const v of this.activeBuses) {
            if (!v.active) continue;
            this._updateAI(v, dt, allVehicles);
            // Giảm cooldown complaint
            if (v.complaintCooldown !== undefined) {
                v.complaintCooldown = Math.max(0, v.complaintCooldown - dt);
            }
        }
    }

    // ============================================================
    // AI LOGIC (có bổ sung cho OLD_GRUMPY)
    // ============================================================
    _updateAI(v, dt, allVehicles) {
        const personality = this._getPersonalityFactor(v.personality);
        const maxSpd = v.maxSpeed * personality.speedMul;

        // Phát hiện xe phía trước
        const ahead = this._getVehicleAhead(v, allVehicles);
        let desiredSpeed = maxSpd;
        let following = false;

        if (ahead) {
            const dx = ahead.collider.x - v.collider.x;
            const dz = ahead.collider.z - v.collider.z;
            const dist = Math.hypot(dx, dz);
            const safeDist = personality.followDist + v.speed * 0.5;
            if (dist < safeDist) {
                // Nếu là U70 và bị chặn, có thể chửi
                if (v.isGrumpy && dist < 8 && v.complaintCooldown <= 0) {
                    this._triggerComplaint(v, 'blocked');
                }
                if (dist < 3.0) {
                    desiredSpeed = 0;
                    v.aiState = 'BRAKING';
                } else if (dist < 6.0) {
                    desiredSpeed = Math.max(0, (dist - 3) * 1.5);
                    v.aiState = 'FOLLOWING';
                } else {
                    desiredSpeed = ahead.speed * 0.9;
                    v.aiState = 'FOLLOWING';
                }
                following = true;
            }
        }

        // Xử lý vượt nếu aggressive hoặc U70 bị chặn quá lâu
        const shouldOvertake = (v.personality === 'AGGRESSIVE' || (v.isGrumpy && v.aiState === 'FOLLOWING' && this.random() < 0.15));
        if (shouldOvertake && following && v.overtakeCooldown <= 0) {
            if (this.random() < personality.overtakeProb) {
                const canOvertake = this._canOvertake(v, allVehicles);
                if (canOvertake) {
                    v.aiState = 'OVERTAKING';
                    v.isLaneChanging = true;
                    v.laneTarget = v.laneOffset + 0.6 * (this.random() > 0.5 ? 1 : -1);
                    v.laneChangeTimer = 0;
                    v.overtakeCooldown = 10 + this.random() * 5;
                    desiredSpeed = maxSpd * 1.2;
                    if (v.isGrumpy) this._triggerComplaint(v, 'overtaking');
                }
            }
        }
        v.overtakeCooldown = Math.max(0, v.overtakeCooldown - dt);

        // Xử lý dừng 20 giây
        if (v.shouldStop && v.aiState !== 'STOPPED' && v.aiState !== 'STOPPING') {
            if (v.speed < 0.5 && v.aiState === 'CRUISING') {
                v.aiState = 'STOPPING';
                v.stopTimer = 0;
                v.stopDuration = 18 + this.random() * 4;
                if (v.isGrumpy) this._triggerComplaint(v, 'stopping');
            }
        }

        if (v.aiState === 'STOPPED') {
            v.stopTimer += dt;
            if (v.stopTimer > v.stopDuration) {
                v.aiState = 'CRUISING';
                v.shouldStop = false;
                desiredSpeed = maxSpd * 0.6;
                if (v.isGrumpy) this._triggerComplaint(v, 'start');
            } else {
                desiredSpeed = 0;
            }
        }

        if (v.aiState === 'STOPPING') {
            desiredSpeed = Math.max(0, desiredSpeed - 2 * dt);
            if (desiredSpeed < 0.1) {
                v.aiState = 'STOPPED';
                v.stopTimer = 0;
                desiredSpeed = 0;
            }
        }

        if (v.aiState === 'OVERTAKING') {
            if (v.isLaneChanging) {
                v.laneChangeTimer += dt;
                const progress = clamp(v.laneChangeTimer / 1.2, 0, 1);
                v.laneCurrent = lerpAngle(v.laneOffset, v.laneTarget, easeInOut(progress));
                if (progress >= 1) {
                    v.isLaneChanging = false;
                    v.laneOffset = v.laneTarget;
                    v.laneCurrent = v.laneTarget;
                    v.aiState = 'RECOVERING';
                }
            } else {
                if (!ahead || Math.hypot(ahead.collider.x - v.collider.x, ahead.collider.z - v.collider.z) > 15) {
                    v.aiState = 'RECOVERING';
                }
            }
            desiredSpeed = maxSpd * 1.1;
        }

        if (v.aiState === 'RECOVERING') {
            const targetLane = 0.3 * this.edges[v.edgeIndex].width;
            v.laneCurrent += (targetLane - v.laneCurrent) * 0.02;
            if (Math.abs(v.laneCurrent - targetLane) < 0.1) {
                v.laneCurrent = targetLane;
                v.laneOffset = targetLane;
                v.aiState = 'CRUISING';
            }
            desiredSpeed = maxSpd * 0.8;
        }

        // Lane change bình thường cho NORMAL, AGGRESSIVE, và đôi khi U70
        if (v.aiState === 'CRUISING' && (v.personality === 'NORMAL' || v.personality === 'AGGRESSIVE' || v.isGrumpy)) {
            let prob = personality.laneChangeProb;
            if (v.isGrumpy) prob *= 1.2; // U70 hơi hay đổi làn hơn tí
            if (this.random() < prob * dt) {
                if (!v.isLaneChanging) {
                    const newLane = v.laneOffset + (this.random() > 0.5 ? 0.6 : -0.6);
                    const canChange = this._canChangeLane(v, allVehicles, newLane);
                    if (canChange) {
                        v.isLaneChanging = true;
                        v.laneTarget = newLane;
                        v.laneChangeTimer = 0;
                        v.aiState = 'LANE_CHANGE';
                    }
                }
            }
        }

        if (v.aiState === 'LANE_CHANGE') {
            v.laneChangeTimer += dt;
            const progress = clamp(v.laneChangeTimer / 1.2, 0, 1);
            v.laneCurrent = lerpAngle(v.laneOffset, v.laneTarget, easeInOut(progress));
            if (progress >= 1) {
                v.isLaneChanging = false;
                v.laneOffset = v.laneTarget;
                v.laneCurrent = v.laneTarget;
                v.aiState = 'CRUISING';
            }
        }

        // Nếu U70 bị tạt đầu (tức có xe cắt ngang trước mặt) – giả lập bằng cách kiểm tra có xe vừa nhập lane không
        if (v.isGrumpy && v.aiState === 'CRUISING' && this.random() < 0.005) {
            // Giả sử có xe tạt đầu
            this._triggerComplaint(v, 'cutOff');
        }

        // Nếu kẹt xe (tốc độ thấp lâu) thì U70 càm ràm
        if (v.isGrumpy && v.speed < 1.0 && v.aiState === 'FOLLOWING' && this.random() < 0.002) {
            this._triggerComplaint(v, 'stuck');
        }

        // Điều chỉnh tốc độ
        v.speed += clamp(desiredSpeed - v.speed, -4 * dt, 2.5 * dt);
        v.speed = Math.max(0, v.speed);

        // Cập nhật vị trí
        v.s += v.speed * dt;
        const edgePath = this.edgePaths[v.edgeIndex];
        if (v.s >= edgePath.total - 0.3) {
            this._chooseNextEdge(v);
            v.s = 0.1;
        }

        this._samplePose(v, v.s, v.laneCurrent !== undefined ? v.laneCurrent : v.laneOffset);
        this._applyVehicleState(v);
    }

    _getVehicleAhead(v, allVehicles) {
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
        v.laneOffset = 0.3 * this.edges[newIdx].width;
        v.laneCurrent = v.laneOffset;
        v.laneTarget = v.laneOffset;
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

// ============================================================
// HÀM TẠO NPC CHÍNH (giữ nguyên)
// ============================================================
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
            getTrafficSpawnManager: () => null
        };
    }

    const random = createSeededRandom(seed);
    const group = new THREE.Group();
    group.name = "npc";

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

    let playerRef = playerBus || null;
    const playerScratch = { x: 0, z: 0 };

    function getPlayerPos() {
        if (!playerRef && scene) {
            for (const c of scene.children)
                if (c.name === "bus") { playerRef = c; break; }
        }
        if (playerRef && playerRef.position) {
            playerScratch.x = playerRef.position.x;
            playerScratch.z = playerRef.position.z;
            return true;
        }
        return false;
    }

    function update(dt, t = 0) {
        const hasPlayer = getPlayerPos();
        if (hasPlayer) {
            spawnManager.update(dt, { x: playerScratch.x, z: playerScratch.z });
        } else {
            spawnManager.update(dt, null);
        }

        if (stationManager) {
            stationManager.update(dt);
        }
    }

    function getColliders() {
        const all = spawnManager.getColliders();
        if (stationManager) {
            for (const bus of stationManager.stationBuses) {
                if (bus.bus.group.visible) {
                    all.push({ x: bus.bus.group.position.x, z: bus.bus.group.position.z, r: 1.5, isStatic: true });
                }
            }
        }
        return all;
    }

    function dispose() {
        if (scene) scene.remove(group);
        disposeObject3D(group);
        spawnManager.dispose();
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
        getTrafficSpawnManager: () => spawnManager
    };
}