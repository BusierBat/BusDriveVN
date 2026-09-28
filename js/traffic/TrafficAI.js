// js/traffic/TrafficAI.js
import * as THREE from "three";
import { createSeededRandom, lerpAngle, clamp } from "../utils.js";

const TWO_PI = Math.PI * 2;
const DRIVER_TYPES = {
    CAREFUL: { speedFactor: 0.65, followingDistance: 12, acceleration: 2.5, deceleration: 10, overtakeProbability: 0.05, yieldProbability: 0.9, reactionTime: 0.4, isBus: false },
    NORMAL: { speedFactor: 0.8, followingDistance: 8, acceleration: 4, deceleration: 8, overtakeProbability: 0.2, yieldProbability: 0.5, reactionTime: 0.25, isBus: false },
    AGGRESSIVE: { speedFactor: 1.1, followingDistance: 5, acceleration: 7, deceleration: 11, overtakeProbability: 0.5, yieldProbability: 0.2, reactionTime: 0.15, isBus: false },
    BUS_DRIVER: { speedFactor: 0.7, followingDistance: 10, acceleration: 3, deceleration: 7, overtakeProbability: 0.08, yieldProbability: 0.7, reactionTime: 0.3, isBus: true, busStopProbability: 0.3 }
};

export const AI_STATE = {
    DRIVING: 'DRIVING', FOLLOWING: 'FOLLOWING', SLOWING: 'SLOWING', BRAKING: 'BRAKING',
    STOPPED: 'STOPPED', TURNING: 'TURNING', CHANGING_LANE: 'CHANGING_LANE',
    OVERTAKING: 'OVERTAKING', MERGING: 'MERGING', YIELDING: 'YIELDING',
    BUS_STOPPING: 'BUS_STOPPING', PARKED: 'PARKED', BUS_MERGING: 'BUS_MERGING', RECOVERING: 'RECOVERING'
};

export class TrafficAI {
    constructor({ vehicle, roadGraph, personality = 'NORMAL', seed = null, isStatic = false, isParked = false, parkTimer = 0 }) {
        this.vehicle = vehicle;
        this.roadGraph = roadGraph;
        this.seed = seed || Math.random() * 999999;
        this.random = createSeededRandom(this.seed);
        
        const base = DRIVER_TYPES[personality] || DRIVER_TYPES.NORMAL;
        const variance = 0.9 + this.random() * 0.2;
        this.profile = {
            speedFactor: base.speedFactor * variance,
            followingDistance: base.followingDistance * variance,
            acceleration: base.acceleration,
            deceleration: base.deceleration,
            overtakeProbability: base.overtakeProbability,
            yieldProbability: base.yieldProbability,
            reactionTime: base.reactionTime,
            isBus: base.isBus,
            busStopProbability: base.busStopProbability || 0
        };
        
        this.isStatic = isStatic;
        this.state = isParked ? AI_STATE.PARKED : AI_STATE.DRIVING;
        this.parkTimer = parkTimer;
        this.speed = 0;
        this.targetSpeed = 0;
        this.maxSpeed = 20 + this.random() * 10;
        this.heading = 0;
        this.targetHeading = 0;
        this.oldHeading = 0;
        this.laneOffset = 0;
        this.targetLaneOffset = 0;
        this.currentSegmentId = null;
        this.direction = 0;
        this.progress = 0;
        this.turning = false;
        this.turnTimer = 0;
        this.followTarget = null;
        this.overtakeTarget = null;
        this.busStopNode = null;
        this.busStopTimer = 0;
        this.reactionTimer = 0;
        
        this.collider = { x: 0, y: 0.5, z: 0, r: 1.4 };
        this.active = true;
        this.colId = -1;
        this.aiLevel = 'NEAR';
        this.updateInterval = 1 / 30;
        this.lastUpdateTime = 0;
        
        this.pathNodes = [];
        this.currentPathIndex = 0;
        this.goalNodeId = null;   // rule 57: xe luon co dich de A* noi duong
        
        if (!isStatic && !isParked) { this._initPosition(); this._retarget(); }
    }

    _getSegment(id) { return this.roadGraph.getSegment(id); }
    _getNode(id) { return this.roadGraph.getNode(id); }

    _initPosition() {
        if (!this.roadGraph.segments?.length) return;
        const validSegs = this.roadGraph.segments.filter(s => s.type !== 'tunnel' && s.type !== 'bus_station_road');
        const seg = validSegs[Math.floor(this.random() * validSegs.length)] || this.roadGraph.segments[0];
        this.currentSegmentId = seg.id;
        this.direction = seg.twoWay ? Math.floor(this.random() * 2) : 0;
        this.progress = 0.1 + this.random() * 0.3;
        this.laneOffset = this._getRightLaneOffset(seg, this.direction);
        this.targetLaneOffset = this.laneOffset;
        this._updatePositionFromSegment();
        this.heading = this._getSegmentHeading();
        this.targetHeading = this.heading;
        this.vehicle.group.position.set(this.collider.x, this.collider.y, this.collider.z);
        this.vehicle.group.rotation.y = this.heading;
    }

    _getLaneOffset(seg, dir, laneIndex) {
        const laneWidth = 3.5;
        const lanesPerDir = seg.twoWay ? Math.max(1, (seg.lanes || 2) / 2) : (seg.lanes || 2);
        const offset = (laneIndex + 0.5) * laneWidth;
        if (dir === 1) return -offset;
        return offset;
    }

    _getRightLaneOffset(seg, dir) { return this._getLaneOffset(seg, dir, 0); }
    _getLeftLaneOffset(seg, dir) {
        const lanesPerDir = seg.twoWay ? Math.max(1, (seg.lanes || 2) / 2) : (seg.lanes || 2);
        if (lanesPerDir < 2) return null;
        return this._getLaneOffset(seg, dir, 1);
    }

    _hasMultipleLanes(seg) {
        const lanesPerDir = seg.twoWay ? Math.max(1, (seg.lanes || 2) / 2) : (seg.lanes || 2);
        return lanesPerDir >= 2;
    }

    _isLaneChangeComplete(targetOffset) { return Math.abs(this.laneOffset - targetOffset) < 1.0; }

    _calculateLaneChangeSpeed(currentOffset, targetOffset, dt, steeringSpeed = 2) {
        const diff = targetOffset - currentOffset;
        const maxStep = steeringSpeed * dt;
        if (Math.abs(diff) < maxStep) return targetOffset;
        return currentOffset + Math.sign(diff) * maxStep;
    }

    _getSegmentPoints() {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) return null;
        const f = this._getNode(seg.from);
        const t = this._getNode(seg.to);
        if (!f || !t) return null;
        return this.direction === 0 ? { p0: f, p1: t } : { p0: t, p1: f };
    }

    _getSegmentHeading() {
        const pts = this._getSegmentPoints();
        if (!pts) return 0;
        return Math.atan2(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z);
    }

    _updatePositionFromSegment() {
        const pts = this._getSegmentPoints();
        if (!pts) return;
        this.collider.x = pts.p0.x + (pts.p1.x - pts.p0.x) * this.progress;
        this.collider.z = pts.p0.z + (pts.p1.z - pts.p0.z) * this.progress;
        this.collider.y = pts.p0.y + (pts.p1.y - pts.p0.y) * this.progress;
        
        const angle = this._getSegmentHeading();
        this.collider.x += Math.cos(angle) * this.laneOffset;
        this.collider.z -= Math.sin(angle) * this.laneOffset;
        this.collider.y += 0.5;
    }

    update(deltaTime, playerPos, allVehicles) {
        if (!this.active || this.isStatic) return;
        this.lastUpdateTime += deltaTime;
        if (this.aiLevel !== 'NEAR' && this.lastUpdateTime < this.updateInterval) {
            this._updateVehicle();
            return;
        }
        this.lastUpdateTime = 0;
        const dt = Math.min(deltaTime, 0.1);
        
        if (this.state === AI_STATE.PARKED || this.state === AI_STATE.BUS_STOPPING || this.state === AI_STATE.BUS_MERGING) {
            this._updateBusStop(dt, allVehicles);
            this._updateSpeed(dt);
            this._updateVehicle();
            return;
        }
        
        this._checkBusStop();
        this._findFollowTarget(allVehicles);
        this._tryVietnameseBehavior(dt, allVehicles);
        this._updateState(dt, allVehicles);
        this._updateSpeed(dt);
        this._updatePosition(dt);
        this._updateHeading(dt);
        this._updateVehicle();
    }

    _checkBusStop() {
        if (!this.profile.isBus || this.state === 'PARKED' || this.state === 'BUS_STOPPING') return;
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) return;
        const nextNodeId = this.direction === 0 ? seg.to : seg.from;
        const node = this._getNode(nextNodeId);
        if (node && (node.type === 'bus_station' || (node.type === 'junction' && Math.random() < 0.01))) {
            const distToNode = 1.0 - this.progress;
            if (distToNode < 0.1 && distToNode > 0.01 && this.random() < this.profile.busStopProbability) {
                this.state = AI_STATE.BUS_STOPPING;
                this.targetSpeed = 0;
                this.busStopTimer = 0;
                this.busStopNode = node;
            }
        }
    }

    _updateBusStop(dt, allVehicles) {
        if (this.state === 'BUS_STOPPING') {
            if (this.speed < 0.5) {
                this.state = AI_STATE.PARKED;
                this.busStopTimer = 20;
                this.speed = 0;
                this.targetSpeed = 0;
            }
            return;
        }
        if (this.state === 'PARKED') {
            this.busStopTimer -= dt;
            if (this.busStopTimer <= 0) {
                this.state = AI_STATE.BUS_MERGING;
                this.targetSpeed = this.maxSpeed * 0.5;
            }
            return;
        }
        if (this.state === 'BUS_MERGING') {
            this.targetSpeed = this.maxSpeed * this.profile.speedFactor;
            if (this.speed > this.maxSpeed * 0.4) {
                this.state = AI_STATE.DRIVING;
                this.busStopNode = null;
            }
        }
    }

    _findFollowTarget(allVehicles) {
        this.followTarget = null;
        if (!allVehicles?.length) return;
        let closest = Infinity;
        const forward = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
        for (const o of allVehicles) {
            if (o === this || !o.collider || o.isStatic) continue;
            const dx = o.collider.x - this.collider.x;
            const dz = o.collider.z - this.collider.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 60 || dist < 0.1) continue;
            const dotForward = dx * forward.x + dz * forward.z;
            if (dotForward < 0) continue;
            const offsetDiff = Math.abs(o.laneOffset - this.laneOffset);
            if (offsetDiff > 4) continue;
            if (dist < closest) { closest = dist; this.followTarget = o; }
        }
    }

    _tryVietnameseBehavior(dt, allVehicles) {
        if (this.aiLevel !== 'NEAR') return;
        if (Math.random() < 0.005) {
            const seg = this._getSegment(this.currentSegmentId);
            if (seg) {
                const rightOffset = this._getRightLaneOffset(seg, this.direction);
                this.targetLaneOffset = rightOffset + (Math.random() - 0.5) * 1.5;
            }
        }
        if (this.followTarget && this.followTarget.vehicle?.group?.name === 'player_bus') {
            const dist = Math.hypot(this.followTarget.collider.x - this.collider.x, this.followTarget.collider.z - this.collider.z);
            if (dist < 15 && this.speed > this.followTarget.speed * 1.2) {
                if (Math.random() < 0.1) {
                    this.state = AI_STATE.BRAKING;
                    this.targetSpeed = 0;
                }
            }
        }
    }

    _updateState(dt, allVehicles) {
        this.reactionTimer -= dt;
        if (this.followTarget) {
            const dist = Math.hypot(this.followTarget.collider.x - this.collider.x, this.followTarget.collider.z - this.collider.z);
            const followDist = this.profile.followingDistance + (this.followTarget.speed || 0) * 0.5;
            if (dist < followDist * 0.4) {
                this.state = AI_STATE.BRAKING;
                this.targetSpeed = 0;
                this._tryOvertake(allVehicles);
            } else if (dist < followDist * 0.7) {
                this.state = AI_STATE.FOLLOWING;
                this.targetSpeed = Math.min((this.followTarget.speed || 0) * 0.9, this.maxSpeed * this.profile.speedFactor);
                if (this.reactionTimer <= 0 && this.random() < this.profile.overtakeProbability * dt) {
                    this._tryOvertake(allVehicles);
                    this.reactionTimer = this.profile.reactionTime;
                }
            } else {
                this.state = AI_STATE.DRIVING;
                this.targetSpeed = this.maxSpeed * this.profile.speedFactor;
            }
        } else {
            this.state = AI_STATE.DRIVING;
            this.targetSpeed = this.maxSpeed * this.profile.speedFactor;
        }
        if (this.state === AI_STATE.OVERTAKING) this._updateOvertaking(dt, allVehicles);
        this.laneOffset = this._calculateLaneChangeSpeed(this.laneOffset, this.targetLaneOffset, dt);
    }

    _tryOvertake(allVehicles) {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg || !this._hasMultipleLanes(seg)) return;
        const leftOffset = this._getLeftLaneOffset(seg, this.direction);
        if (leftOffset === null) return;
        if (this._calculateOvertakeRisk('left', allVehicles) > 0.4) return;
        this.state = AI_STATE.OVERTAKING;
        this.targetLaneOffset = leftOffset;
        this.overtakeTarget = this.followTarget;
    }

    _updateOvertaking(dt, allVehicles) {
        if (!this.overtakeTarget) { this._finishOvertake(); return; }
        const dx = this.overtakeTarget.collider.x - this.collider.x;
        const dz = this.overtakeTarget.collider.z - this.collider.z;
        const dist = Math.hypot(dx, dz);
        const forward = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
        const dotForward = dx * forward.x + dz * forward.z;
        if (dotForward < 0 && dist > 8) { this._finishOvertake(); return; }
        if (this._calculateOvertakeRisk('left', allVehicles) > 0.6) this._finishOvertake();
    }

    _finishOvertake() {
        const seg = this._getSegment(this.currentSegmentId);
        if (seg) this.targetLaneOffset = this._getRightLaneOffset(seg, this.direction);
        this.state = AI_STATE.MERGING;
        this.overtakeTarget = null;
    }

    _calculateOvertakeRisk(targetLane, allVehicles) {
        let risk = 0;
        const pos = this.collider;
        const forward = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
        const right = { x: forward.z, z: -forward.x };
        for (const other of allVehicles) {
            if (other === this || other.isStatic) continue;
            const dx = other.collider.x - pos.x;
            const dz = other.collider.z - pos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 80) continue;
            const dotForward = dx * forward.x + dz * forward.z;
            const dotRight = dx * right.x + dz * right.z;
            const inTargetLane = (targetLane === 'left' && dotRight > 0) || (targetLane === 'right' && dotRight < 0);
            if (!inTargetLane) continue;
            if (dotForward > 0) { if (dist < 25) risk += 0.4; else if (dist < 50) risk += 0.15; }
            else { if (dist < 20) risk += 0.5; else if (dist < 40) risk += 0.2; }
            const relSpeed = Math.abs(this.speed - other.speed);
            if (relSpeed > 15 && dist < 40) risk += 0.2;
        }
        return Math.min(1.0, risk);
    }

    _updateSpeed(dt) {
        if (this.state === AI_STATE.BRAKING || this.state === AI_STATE.BUS_STOPPING) {
            this.speed -= this.profile.deceleration * dt;
        } else if (this.speed < this.targetSpeed) {
            this.speed += this.profile.acceleration * dt;
            if (this.speed > this.targetSpeed) this.speed = this.targetSpeed;
        } else if (this.speed > this.targetSpeed) {
            this.speed -= this.profile.deceleration * dt;
            if (this.speed < this.targetSpeed) this.speed = this.targetSpeed;
        }
        this.speed = Math.max(0, this.speed);
        if (this.state === AI_STATE.MERGING && this._isLaneChangeComplete(this.targetLaneOffset)) this.state = AI_STATE.DRIVING;
    }

    _updatePosition(dt) {
        const pts = this._getSegmentPoints();
        if (!pts) { this._recover(); return; }
        const len = Math.hypot(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z);
        if (len === 0) { this._recover(); return; }
        this.progress += (this.speed / len) * dt;
        if (this.progress >= 1.0) this._handleJunction();
        this.progress = Math.max(0, Math.min(1, this.progress));
        this._updatePositionFromSegment();
    }

    _handleJunction() {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) { this._recover(); return; }
        const curId = this.direction === 0 ? seg.to : seg.from;
        const node = this._getNode(curId);
        if (!node?.connections?.length) { this._uTurn(); return; }

        // --- DA TOI DICH -> chon dich moi (rule 57: xe phai CO duong di) ---
        if (this.goalNodeId && curId === this.goalNodeId) this._retarget();

        // 1) di theo path da len ke hoach
        if (this.pathNodes.length > 0 && this.currentPathIndex < this.pathNodes.length - 1) {
            const nextNodeId = this.pathNodes[this.currentPathIndex + 1];
            const nextSeg = node.connections.find(id => {
                const s = this._getSegment(id);
                return s && (s.from === nextNodeId || s.to === nextNodeId);
            });
            if (nextSeg) {
                this._setNewSegment(nextSeg, curId);
                this.currentPathIndex++;
                return;
            }
            this.pathNodes = [];          // path hong -> tinh lai
        }

        // 2) het path -> gan lai dich (A* chay 1 lan, khong phai moi nga)
        if (this.goalNodeId && this.pathNodes.length === 0) {
            const from2 = this._curNodeId();
            if (from2 && from2 !== this.goalNodeId) {
                if (typeof this.roadGraph.findPath === "function") {
                    const p2 = this.roadGraph.findPath(from2, this.goalNodeId, this.currentSegmentId);
                    if (p2 && p2.length) { this.pathNodes = p2; this.currentPathIndex = 0; }
                }
            }
        }
        if (this.goalNodeId && this.pathNodes.length === 0 &&
            typeof this.roadGraph.nextSegmentToward === "function") {
            const nextSegId = this.roadGraph.nextSegmentToward(curId, this.goalNodeId, this.currentSegmentId);
            if (nextSegId) {
                const s2 = this._getSegment(nextSegId);
                if (s2) { this._setNewSegment(s2, curId); return; }
            }
        }

        // 3) chua gan dich -> nhanh RE nhat, cam U-turn tai nga
        const outs = typeof this.roadGraph.neighbors === "function"
            ? this.roadGraph.neighbors(curId)
            : node.connections.map(id => ({ seg: id, to: null, cost: 1, len: 1 }));
        const cand = outs.filter(c => c.seg !== this.currentSegmentId);
        if (cand.length === 0) { this._uTurn(); return; }
        let best = cand[0];
        for (const c of cand) {
            if ((c.cost / (c.len || 1)) < (best.cost / (best.len || 1))) best = c;
        }
        const nextSeg = this._getSegment(best.seg);
        if (!nextSeg) { this._uTurn(); return; }
        this._setNewSegment(nextSeg, curId);
    }

    // Gan dich moi. Uu tien POI that (ben / tram nghi / cay xang) gan, neu
    // khong co thi chon node duong lon 0.4-2.5km. Dich phai CUNG thanh phan
    // lien thong voi xe, neu khong A* se khong ra duong.
    //
    // ⚠ CHI CHAY A* MOT LAN o day. Truoc do _handleJunction goi A* o MOI nga
    // (do 40ms x 10 xe = 12% CPU tren N5000). Bay len duong 1 lan roi di theo
    // pathNodes; khi het path hoac path hong moi tinh lai.
    setGoal(nodeId) {
        this.goalNodeId = nodeId || null;
        this.pathNodes = [];
        this.currentPathIndex = 0;
        const from = this._curNodeId();
        if (!this.goalNodeId || !from) return;
        if (typeof this.roadGraph.findPath !== "function") return;
        const p = this.roadGraph.findPath(from, this.goalNodeId, this.currentSegmentId);
        if (p && p.length) {
            this.pathNodes = p;
            this.currentPathIndex = 0;
        }
    }

    _curNodeId() {
        const s = this._getSegment(this.currentSegmentId);
        if (!s) return null;
        return this.direction === 0 ? s.to : s.from;
    }

    _retarget() {
        const rg = this.roadGraph;
        if (!rg || typeof rg.neighbors !== "function") { this.goalNodeId = null; return; }
        const hereId = this._curNodeId();
        const here = hereId ? rg.getNode(hereId) : null;
        if (!here) { this.goalNodeId = null; return; }
        const ox = here.x, oz = here.z;

        // 1) POI that trong 350m-6km
        if (rg.pois && rg.pois.length && this.random() < 0.55) {
            const cand = [];
            for (const p of rg.pois) {
                const d = Math.hypot(p.position.x - ox, p.position.z - oz);
                if (d < 350 || d > 6000) continue;
                cand.push(p);
            }
            if (cand.length) {
                const pick = cand[Math.floor(this.random() * cand.length)];
                const n = rg.nearestNode(pick.position.x, pick.position.z);
                if (n && rg.canReach(hereId, n.id)) { this.setGoal(n.id); return; }
            }
        }
        // 2) node duong lon ngau nhien 0.4-2.5km
        const BIG = new Set(["NATIONAL", "EXPRESSWAY", "ARTERIAL", "COLLECTOR"]);
        for (let tries = 0; tries < 8; tries++) {
            const n = rg.nodes[Math.floor(this.random() * rg.nodes.length)];
            const d = Math.hypot(n.x - ox, n.z - oz);
            if (d < 400 || d > 2500) continue;
            if (!rg.neighbors(n.id).some(e => BIG.has(e.cls))) continue;
            this.setGoal(n.id);
            return;
        }
        this.goalNodeId = null;
    }
    
    _setNewSegment(nextSeg, curId) {
        if (nextSeg.from === curId) this.direction = 0;
        else if (nextSeg.to === curId) this.direction = 1;
        else { this._uTurn(); return; }
        this.oldHeading = this.heading;
        this.currentSegmentId = nextSeg.id;
        this.progress = 0;
        this.targetLaneOffset = this._getRightLaneOffset(nextSeg, this.direction);
        this.targetHeading = this._getSegmentHeading();
        this.turning = true;
        this.turnTimer = 0;
        this.state = AI_STATE.TURNING;
    }

    _uTurn() {
        this.direction = 1 - this.direction;
        this.progress = 0;
        this.oldHeading = this.heading;
        this.targetHeading = this.heading + Math.PI;
        this.turning = true;
        this.turnTimer = 0;
        this.state = AI_STATE.TURNING;
    }

    _recover() {
        this.state = AI_STATE.RECOVERING;
        if (this.roadGraph.segments?.length) {
            const seg = this.roadGraph.segments[Math.floor(this.random() * this.roadGraph.segments.length)];
            this.currentSegmentId = seg.id;
            this.direction = seg.twoWay ? Math.floor(this.random() * 2) : 0;
            this.progress = 0.1 + this.random() * 0.3;
            this.laneOffset = this._getRightLaneOffset(seg, this.direction);
            this.targetLaneOffset = this.laneOffset;
            this._updatePositionFromSegment();
            this.heading = this._getSegmentHeading();
            this.state = AI_STATE.DRIVING;
        }
    }

    _updateHeading(dt) {
        if (this.turning) {
            this.turnTimer += dt;
            const turnDuration = this.profile.isBus ? 2.5 : 1.5;
            const p = Math.min(1, this.turnTimer / turnDuration);
            const smooth = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            let diff = this.targetHeading - this.oldHeading;
            while (diff > Math.PI) diff -= TWO_PI;
            while (diff < -Math.PI) diff += TWO_PI;
            this.heading = this.oldHeading + diff * smooth;
            if (p >= 1) {
                this.turning = false;
                this.heading = this.targetHeading;
                if (this.state === AI_STATE.TURNING) this.state = AI_STATE.DRIVING;
            }
        } else {
            this.heading = lerpAngle(this.heading, this._getSegmentHeading(), Math.min(1, dt * 1.5));
        }
    }

    _updateVehicle() {
        if (!this.vehicle) return;
        this.vehicle.group.position.set(this.collider.x, this.collider.y, this.collider.z);
        this.vehicle.group.rotation.y = this.heading;
        const pts = this._getSegmentPoints();
        if (pts) {
            const dy = pts.p1.y - pts.p0.y;
            const dxz = Math.hypot(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z);
            const pitch = Math.atan2(dy, dxz) * (this.direction === 0 ? -1 : 1);
            this.vehicle.group.rotation.x = THREE.MathUtils.lerp(this.vehicle.group.rotation.x, pitch * 0.5, 0.1);
        }
    }

    setDestination(endNodeId) {
        // Runtime pathfinding omitted for brevity, uses random or pre-set paths
    }

    setAILevel(level) {
        this.aiLevel = level;
        this.updateInterval = level === 'NEAR' ? 1/30 : level === 'MID' ? 1/15 : 1/5;
    }

    setActive(a) { this.active = a; if (this.vehicle?.group) this.vehicle.group.visible = a; }
    dispose() { if (this.vehicle?.group?.parent) this.vehicle.group.parent.remove(this.vehicle.group); this.active = false; }
}