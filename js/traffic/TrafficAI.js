// js/traffic/TrafficAI.js - AI x666 (Nhận thức, Junction, Human Behavior, Bus Stop, Collision) - OPTIMIZED
import * as THREE from "three";
import { createSeededRandom, lerpAngle, clamp } from "../utils.js";

const TWO_PI = Math.PI * 2;

export const DRIVER_PERSONALITY = {
  NORMAL: { label: 'Bình thường', speedFactor: 0.8, followDistance: 8, acceleration: 4, deceleration: 8, overtakeChance: 0.05, aggressiveFactor: 0.0 },
  CAREFUL: { label: 'Cẩn thận', speedFactor: 0.65, followDistance: 12, acceleration: 2.5, deceleration: 10, overtakeChance: 0.0, aggressiveFactor: -0.3 },
  AGGRESSIVE: { label: 'Ẩu', speedFactor: 1.1, followDistance: 4, acceleration: 8, deceleration: 12, overtakeChance: 0.25, aggressiveFactor: 0.6 },
  RANDOM: { label: 'Ngẫu nhiên', speedFactor: 0.9, followDistance: 7, acceleration: 5, deceleration: 9, overtakeChance: 0.1, aggressiveFactor: 0.2 }
};

export const AI_STATE = {
  DRIVING: 'DRIVING', FOLLOWING: 'FOLLOWING', SLOWING: 'SLOWING', STOPPING: 'STOPPING',
  WAITING: 'WAITING', TURNING: 'TURNING', OVERTAKING: 'OVERTAKING',
  BUS_STOPPING: 'BUS_STOPPING', BUS_WAITING: 'BUS_WAITING'
};

export class TrafficAI {
  constructor({ vehicle, roadGraph, personality = 'NORMAL', seed = null }) {
    this.vehicle = vehicle;
    this.roadGraph = roadGraph;
    this.seed = seed || Math.random() * 999999;
    this.random = createSeededRandom(this.seed);

    const p = DRIVER_PERSONALITY[personality] || DRIVER_PERSONALITY.NORMAL;
    this.personality = {
      ...p,
      speedFactor: p.speedFactor * (0.9 + this.random() * 0.2),
      followDistance: p.followDistance * (0.8 + this.random() * 0.4)
    };

    this.state = AI_STATE.DRIVING;
    this.speed = 0; this.targetSpeed = 0;
    this.maxSpeed = 20 + this.random() * 10;
    this.heading = 0; this.targetHeading = 0; this.oldHeading = 0;
    this.laneOffset = 0; this.targetLaneOffset = 0;

    this.currentSegmentId = null; this.direction = 0; this.progress = 0;
    this.turning = false; this.turnTimer = 0;
    
    this.followTarget = null; this.followDistance = this.personality.followDistance;
    this.overtaking = false; this.overtakeTimer = 0; this.overtakeDirection = 1;
    
    this.isBus = vehicle?.group?.name?.includes('bus') || false;
    this.stopCooldown = this.random() * 30; 
    this.stopTimer = 0;

    this.collider = { x: 0, z: 0, r: 1.4 };
    this.wheelSpin = 0; this.steerAngle = 0;
    this.active = true; this.lastUpdateTime = 0; this.updateInterval = 1 / 30;
    this.colId = -1; 

    this._initPosition();
  }

  _getSegment(id) {
    if (!this.roadGraph) return null;
    if (!this.roadGraph._segMapCache) {
      this.roadGraph._segMapCache = new Map();
      if (Array.isArray(this.roadGraph.segments)) {
        for (const s of this.roadGraph.segments) this.roadGraph._segMapCache.set(s.id, s);
      }
    }
    return this.roadGraph._segMapCache.get(id);
  }
  
  _getNode(id) {
    if (!this.roadGraph) return null;
    if (!this.roadGraph._nodeMapCache) {
      this.roadGraph._nodeMapCache = new Map();
      if (Array.isArray(this.roadGraph.nodes)) {
        for (const n of this.roadGraph.nodes) this.roadGraph._nodeMapCache.set(n.id, n);
      }
    }
    return this.roadGraph._nodeMapCache.get(id);
  }

  _initPosition() {
    if (!this.roadGraph?.segments?.length) return;
    const seg = this.roadGraph.segments[Math.floor(this.random() * this.roadGraph.segments.length)];
    this.currentSegmentId = seg.id;
    this.direction = seg.twoWay ? Math.floor(this.random() * 2) : 0;
    this.progress = 0.1 + this.random() * 0.3;
    this.laneOffset = this._calcLaneOffset(seg, this.direction);
    this._updatePositionFromSegment();
    this.heading = this._getSegmentHeading(); this.targetHeading = this.heading;
    this.vehicle.group.position.set(this.collider.x, 0.5, this.collider.z);
    this.vehicle.group.rotation.y = this.heading;
  }

  _calcLaneOffset(seg, dir) {
    const laneWidth = 3.5;
    const lanesPerDir = seg.twoWay ? Math.max(1, seg.lanes / 2) : seg.lanes;
    const laneIndex = Math.floor(this.random() * lanesPerDir);
    let offset = (laneIndex + 0.5) * laneWidth;
    if (seg.twoWay && dir === 1) offset = -offset; 
    return offset;
  }

  _getSegmentPoints() {
    const seg = this._getSegment(this.currentSegmentId);
    if (!seg) return null;
    const f = this._getNode(seg.from), t = this._getNode(seg.to);
    if (!f?.position || !t?.position) return null;
    return this.direction === 0 ? { p0: f.position, p1: t.position } : { p0: t.position, p1: f.position };
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
    const angle = this._getSegmentHeading();
    this.collider.x += Math.cos(angle) * this.laneOffset;
    this.collider.z += -Math.sin(angle) * this.laneOffset;
  }

  update(deltaTime, playerPos, allVehicles) {
    if (!this.active) return;
    
    let distToPlayer = 0;
    if (playerPos) {
      distToPlayer = Math.hypot(this.collider.x - playerPos.x, this.collider.z - playerPos.z);
      this.updateInterval = distToPlayer > 300 ? 1/10 : distToPlayer > 150 ? 1/20 : 1/30;
    }
    
    this.lastUpdateTime += deltaTime;
    if (this.lastUpdateTime < this.updateInterval) return;
    const dt = this.lastUpdateTime; this.lastUpdateTime = 0;

    // TỐI ƯU LOD: Xe ở xa (>200m) chỉ cập nhật đơn giản, bỏ qua AI nặng
    if (distToPlayer > 200) {
      this._updatePosition(dt);
      this._updateHeading(dt);
      this._updateVehicle();
      return;
    }

    if (this.isBus && this.stopCooldown <= 0 && this.state === AI_STATE.DRIVING) {
      if (this.random() < 0.001) {
        this.state = AI_STATE.BUS_STOPPING;
        this.targetSpeed = 0;
      }
    } else if (this.stopCooldown > 0) {
      this.stopCooldown -= dt;
    }

    if (this.state === AI_STATE.BUS_WAITING) {
      this.stopTimer -= dt;
      if (this.stopTimer <= 0) {
        this.state = AI_STATE.DRIVING;
        this.stopCooldown = 20 + this.random() * 30; 
        this.targetSpeed = this.maxSpeed * this.personality.speedFactor;
        if (this.vehicle.setDoor) this.vehicle.setDoor(0);
      }
    } else {
      this._findFollowTarget(allVehicles);
      this._updateState(dt, allVehicles); 
      this._updateSpeed(dt);
      this._updatePosition(dt);
      this._updateHeading(dt);
    }
    this._updateVehicle();
  }

  _findFollowTarget(allVehicles) {
    this.followTarget = null;
    if (!allVehicles?.length) return;
    let closest = Infinity;
    const myAngle = this.heading;
    for (const o of allVehicles) {
      if (o === this || !o.collider) continue;
      const dx = o.collider.x - this.collider.x, dz = o.collider.z - this.collider.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 50) continue;
      if (dx * Math.sin(myAngle) + dz * Math.cos(myAngle) < 0) continue; 
      if (Math.abs(-dx * Math.cos(myAngle) + dz * Math.sin(myAngle)) > 5.25) continue; 
      if (dist < closest) { closest = dist; this.followTarget = o; }
    }
  }

  _updateState(dt, allVehicles) {
    if (!this._getSegment(this.currentSegmentId)) return;
    if (this.followTarget) {
      const dx = this.followTarget.collider.x - this.collider.x, dz = this.followTarget.collider.z - this.collider.z;
      const dist = Math.hypot(dx, dz), followDist = this.followDistance + (this.followTarget.speed || 0) * 0.5;
      if (dist < followDist * 0.5) { this.state = AI_STATE.STOPPING; this.targetSpeed = 0; }
      else if (dist < followDist * 0.8) { this.state = AI_STATE.FOLLOWING; this.targetSpeed = Math.min((this.followTarget.speed||0)*0.9, this.maxSpeed*0.7); }
      else if (dist > followDist * 1.5) { if (this.state !== AI_STATE.TURNING) { this.state = AI_STATE.DRIVING; this.targetSpeed = this.maxSpeed*this.personality.speedFactor; } }
      else { if (this.state !== AI_STATE.TURNING) { this.state = AI_STATE.FOLLOWING; this.targetSpeed = (this.followTarget.speed||0)*0.95; } }
    } else {
      if (this.state !== AI_STATE.TURNING && this.state !== AI_STATE.STOPPING && this.state !== AI_STATE.BUS_STOPPING) { 
        this.state = AI_STATE.DRIVING; this.targetSpeed = this.maxSpeed*this.personality.speedFactor; 
      }
    }
    
    if (this.personality.aggressiveFactor > 0.2 && this.state === AI_STATE.FOLLOWING && this.followTarget?.speed < this.speed*0.7 && !this.overtaking) {
      if (this.random() < this.personality.overtakeChance * 0.5) {
        let canOvertake = true;
        const seg = this._getSegment(this.currentSegmentId);
        if (seg?.twoWay) {
          for (const o of allVehicles || []) {
             if (!o.collider || o === this) continue;
             const dx = o.collider.x - this.collider.x, dz = o.collider.z - this.collider.z;
             const dist = Math.hypot(dx, dz);
             if (dist < 80 && dx * Math.sin(this.heading) + dz * Math.cos(this.heading) < 0) { canOvertake = false; break; }
          }
        }
        if (canOvertake) {
          this.overtaking = true; this.overtakeTimer = 0; this.overtakeDirection = this.random() > 0.5 ? 1 : -1;
          this.state = AI_STATE.OVERTAKING; this.targetLaneOffset = -this.overtakeDirection * 2.5;
        }
      }
    }
    if (this.overtaking) {
      this.overtakeTimer += dt;
      if (this.overtakeTimer > 2.0) { this.overtaking = false; this.targetLaneOffset = 0; this.state = AI_STATE.DRIVING; this.targetSpeed = this.maxSpeed*this.personality.speedFactor; }
    }
    this.laneOffset += (this.targetLaneOffset - this.laneOffset) * Math.min(1, dt * 2);
  }

  _updateSpeed(dt) {
    if (this.state === AI_STATE.BUS_STOPPING && this.speed > 0.1) {
      this.speed -= this.personality.deceleration * dt;
      if (this.speed < 0.1) { 
        this.speed = 0; this.state = AI_STATE.BUS_WAITING; this.stopTimer = 15 + this.random() * 10; 
        if (this.vehicle.setDoor) this.vehicle.setDoor(1);
      }
      return;
    }

    if (this.speed < this.targetSpeed) { this.speed += this.personality.acceleration * dt; if (this.speed > this.targetSpeed) this.speed = this.targetSpeed; }
    else if (this.speed > this.targetSpeed) { this.speed -= this.personality.deceleration * dt; if (this.speed < this.targetSpeed) this.speed = this.targetSpeed; }
    this.speed = Math.max(0, this.speed);
  }

  _updatePosition(dt) {
    const pts = this._getSegmentPoints();
    if (!pts) return;
    const len = Math.hypot(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z);
    if (len === 0) return;
    this.progress += (this.speed / len) * dt;
    if (this.progress >= 1.0) this._handleJunction();
    this.progress = Math.max(0, Math.min(1, this.progress));
    this._updatePositionFromSegment();
  }

  _handleJunction() {
    const seg = this._getSegment(this.currentSegmentId);
    if (!seg) return;
    const curId = this.direction === 0 ? seg.to : seg.from;
    const node = this._getNode(curId);
    if (!node?.connections?.length) { this._uTurn(); return; }
    const nextSegs = node.connections.filter(id => id !== this.currentSegmentId);
    if (nextSegs.length === 0) { this._uTurn(); return; }
    const nextSeg = this._getSegment(nextSegs[Math.floor(this.random() * nextSegs.length)]);
    if (!nextSeg) { this._uTurn(); return; }
    if (nextSeg.from === curId) this.direction = 0;
    else if (nextSeg.to === curId) this.direction = 1;
    else { this._uTurn(); return; }
    this.oldHeading = this.heading;
    this.currentSegmentId = nextSeg.id;
    this.progress = 0;
    this.targetLaneOffset = this._calcLaneOffset(nextSeg, this.direction);
    this.targetHeading = this._getSegmentHeading();
    this.turning = true; this.turnTimer = 0;
  }

  _uTurn() {
    this.direction = 1 - this.direction; this.progress = 0;
    this.oldHeading = this.heading; this.targetHeading = this.heading + Math.PI;
    this.turning = true; this.turnTimer = 0;
  }

  _updateHeading(dt) {
    if (this.turning) {
      this.turnTimer += dt;
      const p = Math.min(1, this.turnTimer / (1.2 + (1 - this.personality.aggressiveFactor) * 0.8));
      const smooth = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;
      let diff = this.targetHeading - this.oldHeading;
      while (diff > Math.PI) diff -= TWO_PI;
      while (diff < -Math.PI) diff += TWO_PI;
      this.heading = this.oldHeading + diff * smooth;
      if (p >= 1) { this.turning = false; this.heading = this.targetHeading; if (this.state === AI_STATE.TURNING) { this.state = AI_STATE.DRIVING; this.targetSpeed = this.maxSpeed*this.personality.speedFactor; } }
    } else {
      this.heading = lerpAngle(this.heading, this._getSegmentHeading(), Math.min(1, dt * 1.5));
    }
  }

  _updateVehicle() {
    if (!this.vehicle) return;
    this.vehicle.group.position.set(this.collider.x, 0.5, this.collider.z);
    this.vehicle.group.rotation.y = this.heading;
    this.wheelSpin += (this.speed / 0.5) * this.lastUpdateTime;
    this.vehicle.setWheelRotation?.(this.wheelSpin);
    const steer = this.turning ? Math.sin(this.turnTimer * 2) * 0.3 : 0;
    this.steerAngle += (steer - this.steerAngle) * Math.min(1, this.lastUpdateTime * 3);
    this.vehicle.setSteering?.(this.steerAngle);
    
    if (this.state === AI_STATE.BUS_WAITING) this.vehicle.setHeadlights?.(true);
    else this.vehicle.setHeadlights?.(false);
    
    if (window.collisionSystem) {
      const hit = window.collisionSystem.check(this.collider.x, this.collider.z, this.collider.r, this.colId, ['static']);
      if (hit) {
        this.speed *= 0.5; 
      }
    }
  }

  getPosition() { return { x: this.collider.x, z: this.collider.z }; }
  getSpeed() { return this.speed; }
  getHeading() { return this.heading; }
  isActive() { return this.active; }
  setActive(a) { this.active = a; if (this.vehicle?.group) this.vehicle.group.visible = a; }
  dispose() { if (this.vehicle?.group?.parent) this.vehicle.group.parent.remove(this.vehicle.group); this.active = false; }
}