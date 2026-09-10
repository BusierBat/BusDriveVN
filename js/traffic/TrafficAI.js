// js/traffic/TrafficAI.js - RIGHT-HAND TRAFFIC & STATION AVOIDANCE
import * as THREE from "three";
import { createSeededRandom, lerpAngle, clamp } from "../utils.js";
const TWO_PI = Math.PI * 2;

export const DRIVER_PERSONALITY = {
  NORMAL: { speedFactor: 0.8, followDistance: 8, acceleration: 4, deceleration: 8 },
  CAREFUL: { speedFactor: 0.65, followDistance: 12, acceleration: 2.5, deceleration: 10 },
  AGGRESSIVE: { speedFactor: 1.1, followDistance: 4, acceleration: 8, deceleration: 12 }
};
export const AI_STATE = { DRIVING: 'DRIVING', FOLLOWING: 'FOLLOWING', STOPPING: 'STOPPING', TURNING: 'TURNING', PARKED: 'PARKED', DEPARTING: 'DEPARTING' };

export class TrafficAI {
  constructor({ vehicle, roadGraph, personality = 'NORMAL', seed = null, isStatic = false, isParked = false, parkTimer = 0 }) {
    this.vehicle = vehicle;
    this.roadGraph = roadGraph;
    this.seed = seed || Math.random() * 999999;
    this.random = createSeededRandom(this.seed);
    this.personality = DRIVER_PERSONALITY[personality] || DRIVER_PERSONALITY.NORMAL;
    this.isStatic = isStatic; // Xe tĩnh trong bến
    this.state = isParked ? AI_STATE.PARKED : AI_STATE.DRIVING;
    this.parkTimer = parkTimer;
    this.speed = 0; this.targetSpeed = 0;
    this.maxSpeed = 20 + this.random() * 10;
    this.heading = 0; this.targetHeading = 0; this.oldHeading = 0;
    this.laneOffset = 0; this.targetLaneOffset = 0;
    this.currentSegmentId = null; this.direction = 0; this.progress = 0;
    this.turning = false; this.turnTimer = 0; this.followTarget = null;
    this.followDistance = this.personality.followDistance;
    this.collider = { x: 0, z: 0, r: 1.4 };
    this.active = true; this.colId = -1;
    if (!isStatic && !isParked) this._initPosition();
  }

  _getSegment(id) {
    if (!this.roadGraph?._segMapCache) {
      this.roadGraph._segMapCache = new Map();
      if (Array.isArray(this.roadGraph.segments)) for (const s of this.roadGraph.segments) this.roadGraph._segMapCache.set(s.id, s);
    }
    return this.roadGraph._segMapCache.get(id);
  }
  _getNode(id) {
    if (!this.roadGraph?._nodeMapCache) {
      this.roadGraph._nodeMapCache = new Map();
      if (Array.isArray(this.roadGraph.nodes)) for (const n of this.roadGraph.nodes) this.roadGraph._nodeMapCache.set(n.id, n);
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
    if (dir === 1) return -3.5; 
    return 3.5;               
  }
  _getSegmentPoints() {
    const seg = this._getSegment(this.currentSegmentId); if (!seg) return null;
    const f = this._getNode(seg.from), t = this._getNode(seg.to); if (!f?.position || !t?.position) return null;
    return this.direction === 0 ? { p0: f.position, p1: t.position } : { p0: t.position, p1: f.position };
  }
  _getSegmentHeading() { const pts = this._getSegmentPoints(); if (!pts) return 0; return Math.atan2(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z); }
  _updatePositionFromSegment() { const pts = this._getSegmentPoints(); if (!pts) return; this.collider.x = pts.p0.x + (pts.p1.x - pts.p0.x) * this.progress; this.collider.z = pts.p0.z + (pts.p1.z - pts.p0.z) * this.progress; const angle = this._getSegmentHeading(); this.collider.x += Math.cos(angle) * this.laneOffset; this.collider.z += -Math.sin(angle) * this.laneOffset; }

  update(deltaTime, playerPos, allVehicles) {
    if (!this.active) return;
    if (this.isStatic) return; // Xe tĩnh không chạy AI
    const dt = Math.min(deltaTime, 0.1);
    if (this.state === AI_STATE.PARKED) {
        this.parkTimer -= dt;
        if (this.parkTimer <= 0) { this.state = AI_STATE.DEPARTING; this.targetSpeed = this.maxSpeed * 0.5; }
        return;
    }
    this._findFollowTarget(allVehicles); this._updateState(dt); this._updateSpeed(dt); this._updatePosition(dt); this._updateHeading(dt); this._updateVehicle();
  }
  _findFollowTarget(allVehicles) {
    this.followTarget = null; if (!allVehicles?.length) return; let closest = Infinity;
    for (const o of allVehicles) {
      if (o === this || !o.collider || o.isStatic) continue;
      const dx = o.collider.x - this.collider.x, dz = o.collider.z - this.collider.z; const dist = Math.hypot(dx, dz);
      if (dist > 50 || dist < 0.1) continue;
      if (dx * Math.sin(this.heading) + dz * Math.cos(this.heading) < 0) continue; 
      if (dist < closest) { closest = dist; this.followTarget = o; }
    }
  }
  _updateState(dt) {
    if (this.followTarget) {
      const dist = Math.hypot(this.followTarget.collider.x - this.collider.x, this.followTarget.collider.z - this.collider.z);
      const followDist = this.followDistance + (this.followTarget.speed || 0) * 0.5;
      if (dist < followDist * 0.5) { this.state = AI_STATE.STOPPING; this.targetSpeed = 0; }
      else if (dist < followDist * 0.8) { this.state = AI_STATE.FOLLOWING; this.targetSpeed = Math.min((this.followTarget.speed||0)*0.9, this.maxSpeed*0.7); }
      else { this.state = AI_STATE.DRIVING; this.targetSpeed = this.maxSpeed*this.personality.speedFactor; }
    } else { this.state = AI_STATE.DRIVING; this.targetSpeed = this.maxSpeed*this.personality.speedFactor; }
    this.laneOffset += (this.targetLaneOffset - this.laneOffset) * Math.min(1, dt * 2);
  }
  _updateSpeed(dt) {
    if (this.speed < this.targetSpeed) { this.speed += this.personality.acceleration * dt; if (this.speed > this.targetSpeed) this.speed = this.targetSpeed; }
    else if (this.speed > this.targetSpeed) { this.speed -= this.personality.deceleration * dt; if (this.speed < this.targetSpeed) this.speed = this.targetSpeed; }
    this.speed = Math.max(0, this.speed);
  }
  _updatePosition(dt) {
    const pts = this._getSegmentPoints(); if (!pts) return;
    const len = Math.hypot(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z); if (len === 0) return;
    this.progress += (this.speed / len) * dt;
    if (this.progress >= 1.0) this._handleJunction();
    this.progress = Math.max(0, Math.min(1, this.progress)); this._updatePositionFromSegment();
  }
  _handleJunction() {
    const seg = this._getSegment(this.currentSegmentId); if (!seg) return;
    const curId = this.direction === 0 ? seg.to : seg.from; const node = this._getNode(curId);
    if (!node?.connections?.length) { this._uTurn(); return; }
    const nextSegs = node.connections.filter(id => id !== this.currentSegmentId);
    if (nextSegs.length === 0) { this._uTurn(); return; }
    const nextSeg = this._getSegment(nextSegs[Math.floor(this.random() * nextSegs.length)]);
    if (!nextSeg) { this._uTurn(); return; }
    if (nextSeg.from === curId) this.direction = 0; else if (nextSeg.to === curId) this.direction = 1; else { this._uTurn(); return; }
    this.oldHeading = this.heading; this.currentSegmentId = nextSeg.id; this.progress = 0;
    this.targetLaneOffset = this._calcLaneOffset(nextSeg, this.direction); this.targetHeading = this._getSegmentHeading();
    this.turning = true; this.turnTimer = 0;
  }
  _uTurn() { this.direction = 1 - this.direction; this.progress = 0; this.oldHeading = this.heading; this.targetHeading = this.heading + Math.PI; this.turning = true; this.turnTimer = 0; }
  _updateHeading(dt) {
    if (this.turning) {
      this.turnTimer += dt; const p = Math.min(1, this.turnTimer / 1.5);
      const smooth = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2; let diff = this.targetHeading - this.oldHeading;
      while (diff > Math.PI) diff -= TWO_PI; while (diff < -Math.PI) diff += TWO_PI;
      this.heading = this.oldHeading + diff * smooth;
      if (p >= 1) { this.turning = false; this.heading = this.targetHeading; if (this.state === AI_STATE.TURNING) this.state = AI_STATE.DRIVING; }
    } else { this.heading = lerpAngle(this.heading, this._getSegmentHeading(), Math.min(1, dt * 1.5)); }
  }
  _updateVehicle() { if (!this.vehicle) return; this.vehicle.group.position.set(this.collider.x, 0.5, this.collider.z); this.vehicle.group.rotation.y = this.heading; }
  setActive(a) { this.active = a; if (this.vehicle?.group) this.vehicle.group.visible = a; }
  dispose() { if (this.vehicle?.group?.parent) this.vehicle.group.parent.remove(this.vehicle.group); this.active = false; }
}