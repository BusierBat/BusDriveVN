// js/traffic/BusTrafficAI.js
import * as THREE from "three";

export const BUS_AI_CONFIG = {
    maxSpeed: 110,
    cruiseSpeed: 80,
    acceleration: 15,
    deceleration: 30,
    laneOffset: 3.5,
    safetyDistance: 25,
    emergencyBrakeDist: 12
};

const _tmpDir = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpTarget = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();
const _tmpForward = new THREE.Vector3();

export class BusTrafficAI {
    constructor(mesh, roadGraph, options = {}) {
        this.mesh = mesh;
        this.roadGraph = roadGraph;

        this.currentSpeed = 0;
        this.maxSpeed = options.maxSpeed || BUS_AI_CONFIG.maxSpeed;
        this.cruiseSpeed = options.cruiseSpeed || BUS_AI_CONFIG.cruiseSpeed;
        this.acceleration = options.acceleration || BUS_AI_CONFIG.acceleration;
        this.deceleration = options.deceleration || BUS_AI_CONFIG.deceleration;

        this.currentSegmentIndex = options.startSegment || 0;

        this.laneOffset = options.laneOffset || BUS_AI_CONFIG.laneOffset;

        this.targetPoint = new THREE.Vector3();

        this.safetyDistance = BUS_AI_CONFIG.safetyDistance;
        this.emergencyBrakeDist = BUS_AI_CONFIG.emergencyBrakeDist;
    }

    update(dt, allVehicles) {
        if (!this.mesh || !this.roadGraph || this.roadGraph.length === 0) return;

        const segment = this.roadGraph[this.currentSegmentIndex];
        if (!segment) return;

        const p1 = segment.points[0];
        const p2 = segment.points[1];

        _tmpDir.set(p2.x - p1.x, 0, p2.z - p1.z);
        const segLength = _tmpDir.length();
        _tmpDir.normalize();

        _tmpRight.set(_tmpDir.z, 0, -_tmpDir.x).normalize();

        _tmpVec.set(this.mesh.position.x - p1.x, 0, this.mesh.position.z - p1.z);
        let proj = _tmpVec.dot(_tmpDir);

        if (proj > segLength) {
            this.currentSegmentIndex = (this.currentSegmentIndex + 1) % this.roadGraph.length;
            return;
        }
        if (proj < 0) proj = 0;

        const lookAhead = 20 + (this.currentSpeed * 0.1);
        let targetProj = proj + lookAhead;
        let targetSegIndex = this.currentSegmentIndex;
        let targetSeg = segment;

        if (targetProj > segLength) {
            targetSegIndex = (this.currentSegmentIndex + 1) % this.roadGraph.length;
            targetSeg = this.roadGraph[targetSegIndex];
            const nextP1 = targetSeg.points[0];
            const nextP2 = targetSeg.points[1];
            _tmpDir.set(nextP2.x - nextP1.x, 0, nextP2.z - nextP1.z).normalize();
            _tmpRight.set(_tmpDir.z, 0, -_tmpDir.x).normalize();
            const remain = targetProj - segLength;
            _tmpTarget.set(nextP1.x + _tmpDir.x * remain, 0, nextP1.z + _tmpDir.z * remain);
        } else {
            _tmpTarget.set(p1.x + _tmpDir.x * targetProj, 0, p1.z + _tmpDir.z * targetProj);
        }

        _tmpTarget.x += _tmpRight.x * this.laneOffset;
        _tmpTarget.z += _tmpRight.z * this.laneOffset;

        this.targetPoint.copy(_tmpTarget);

        _tmpVec.subVectors(this.targetPoint, this.mesh.position);
        _tmpVec.y = 0;
        _tmpVec.normalize();

        const targetAngle = Math.atan2(_tmpVec.x, _tmpVec.z);
        let currentAngle = this.mesh.rotation.y;
        let angleDiff = targetAngle - currentAngle;

        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const maxSteer = 1.5 * dt;
        const steer = THREE.MathUtils.clamp(angleDiff, -maxSteer, maxSteer);
        this.mesh.rotation.y += steer;

        let targetSpeed = this.cruiseSpeed;

        const cornerFactor = Math.abs(angleDiff);
        if (cornerFactor > 0.1) {
            targetSpeed = this.cruiseSpeed * (1 - Math.min(cornerFactor / 1.0, 0.6));
        }

        _tmpForward.set(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y));
        let vehicleAhead = null;
        let minDist = Infinity;

        for (const v of allVehicles) {
            if (v === this || !v.mesh) continue;
            const dx = v.mesh.position.x - this.mesh.position.x;
            const dz = v.mesh.position.z - this.mesh.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            if (dist > 80) continue;

            const dot = dx * _tmpForward.x + dz * _tmpForward.z;
            if (dot > 0) {
                const rightX = _tmpForward.z;
                const rightZ = -_tmpForward.x;
                const latDist = Math.abs(dx * rightX + dz * rightZ);
                if (latDist < 4.0 && dist < minDist) {
                    minDist = dist;
                    vehicleAhead = v;
                }
            }
        }

        if (vehicleAhead) {
            if (minDist < this.safetyDistance) {
                targetSpeed = Math.min(targetSpeed, vehicleAhead.currentSpeed * (minDist / this.safetyDistance));
            }
            if (minDist < this.emergencyBrakeDist) {
                targetSpeed = 0;
            }
        }

        if (this.currentSpeed < targetSpeed) {
            this.currentSpeed += this.acceleration * dt;
            if (this.currentSpeed > targetSpeed) this.currentSpeed = targetSpeed;
        } else {
            this.currentSpeed -= this.deceleration * dt;
            if (this.currentSpeed < targetSpeed) this.currentSpeed = targetSpeed;
        }

        const moveDist = this.currentSpeed * 0.15 * dt;

        const moveX = Math.sin(this.mesh.rotation.y) * moveDist;
        const moveZ = Math.cos(this.mesh.rotation.y) * moveDist;

        this.mesh.position.x += moveX;
        this.mesh.position.z += moveZ;
    }
}
