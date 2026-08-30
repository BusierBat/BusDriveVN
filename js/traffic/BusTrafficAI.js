// js/traffic/BusTrafficAI.js - AI CHO XE KHÁCH NPC
// Xe khách NPC có đặc tính riêng: dài, nặng, turning radius lớn
// Dùng chung model/skin system với player bus từ bus.js

import * as THREE from "three";
import { createSeededRandom, clamp, lerpAngle, damp, dampAngle } from "../utils.js";
import { getRoadTypeConfig, getLaneCenterOffset } from "../map/data/roadTypes.js";

// ============================================================
// BUS AI CONFIG - ĐẶC TÍNH XE KHÁCH
// ============================================================

export const BUS_AI_CONFIG = {
    // === PHYSICS - XE KHÁCH ===
    maxSpeedKmh: 80,
    maxSpeed: 80 * (1000 / 3600), // 22.22 m/s
    
    // Acceleration chậm hơn xe con
    acceleration: 1.8,         // m/s²
    comfortAccel: 1.2,         // m/s² (cho hành khách dễ chịu)
    braking: 3.5,              // m/s² (normal braking)
    emergencyBraking: 6.0,     // m/s² (emergency)
    
    // Turning - xe khách cần turning radius lớn
    maxSteerAngle: 0.35,       // rad (~20°) - ít hơn xe con
    minTurningRadius: 12.0,    // meters - xe khách cần ít nhất 12m
    turnSpeed: 0.8,            // rad/s khi rẽ
    
    // === FOLLOWING DISTANCE ===
    // Xe khách cần khoảng cách lớn hơn
    baseFollowDistance: 15.0,      // meters khi dừng
    followDistancePerSpeed: 1.2,   // thêm meters cho mỗi m/s
    minGap: 8.0,                   // gap tối thiểu
    
    // === LANE BEHAVIOR ===
    laneKeepingStrength: 2.5,      // Cường độ giữ lane
    laneChangeTime: 3.0,           // Seconds để đổi lane
    laneChangeDistance: 40,        // Distance cần thiết để đổi lane
    
    // === SPEED CONTROL ===
    speedVariation: 0.15,          // ±15% speed variation giữa các xe
    corneringSpeedFactor: 0.5,     // Giảm tốc 50% khi cua
    junctionSpeedLimit: 8.0,       // m/s khi qua junction
    
    // === SPAWN/DESPAWN ===
    despawnDistance: 350,
    spawnDistanceMin: 120,
    spawnDistanceMax: 250,
    
    // === STATES ===
    stateUpdateInterval: 0.1,      // Update state mỗi 0.1s
};

// ============================================================
// AI STATES
// ============================================================

export const BUS_AI_STATE = {
    CRUISING: 'CRUISING',
    FOLLOWING: 'FOLLOWING',
    SLOWING: 'SLOWING',
    STOPPING: 'STOPPING',
    STOPPED: 'STOPPED',
    TURNING: 'TURNING',
    LANE_CHANGING: 'LANE_CHANGING',
    APPROACHING_JUNCTION: 'APPROACHING_JUNCTION',
    IN_JUNCTION: 'IN_JUNCTION',
    ACCELERATING: 'ACCELERATING',
};

// ============================================================
// BUS TRAFFIC AI CLASS
// ============================================================

export class BusTrafficAI {
    constructor({
        vehicle,             // Instance từ createNpcBus() - dùng chung bus.js
        roadGraph,           // roadDataSegments từ routeData.js
        personality = 'NORMAL',
        seed = null,
        config = {},
    }) {
        this.vehicle = vehicle;
        this.roadGraph = roadGraph;
        this.config = { ...BUS_AI_CONFIG, ...config };
        
        // Seeded random
        this.seed = seed || Math.random() * 999999;
        this.random = createSeededRandom(this.seed);
        
        // === AI STATE ===
        this.state = BUS_AI_STATE.CRUISING;
        this.stateTimer = 0;
        
        // === MOVEMENT ===
        this.speed = 0;
        this.targetSpeed = 0;
        this.maxSpeed = this.config.maxSpeed * (0.85 + this.random() * 0.3);
        
        // Position on road graph
        this.currentSegmentIndex = 0;
        this.progress = 0; // 0-1 trên segment
        this.heading = 0;
        this.targetHeading = 0;
        
        // === LANE ===
        this.laneIndex = 0;        // Current lane (0-based)
        this.targetLaneIndex = 0;
        this.laneOffset = 0;       // Current lateral offset
        this.targetLaneOffset = 0;
        this.laneChangeTimer = 0;
        
        // === STEERING (cho xe khách) ===
        this.steerAngle = 0;
        this.targetSteerAngle = 0;
        this.angularVelocity = 0;
        this.wheelbase = 6.5;      // Từ BUS_DIMENSIONS nếu có
        
        // === JUNCTION ===
        this.junctionNode = null;
        this.junctionProgress = 0;
        this.turnDirection = 0;    // -1 trái, 0 thẳng, +1 phải
        this.approachDistToJunction = Infinity;
        
        // === FOLLOWING ===
        this.vehicleAhead = null;
        this.distanceToAhead = Infinity;
        
        // === ROUTE ===
        this.route = [];            // Array of segment indices
        this.routePosition = 0;
        
        // === LIGHTS ===
        this.brakeLightOn = false;
        this.turnSignalLeft = false;
        this.turnSignalRight = false;
        
        // === LOD (Level of Detail) ===
        this.lodLevel = 0;         // 0=near, 1=medium, 2=far
        this.lodUpdateInterval = [0.016, 0.05, 0.2]; // Update interval theo LOD
        this.lodTimer = 0;
        
        // === COLLIDER ===
        this.collider = {
            x: 0,
            z: 0,
            r: 1.5,
            width: 2.4,
            length: 12.0,
            active: true
        };
        
        // Initialize position
        this._initPosition();
    }
    
    // ============================================================
    // INITIALIZATION
    // ============================================================
    
    _initPosition() {
        if (!this.roadGraph || this.roadGraph.length === 0) return;
        
        // Chọn segment ngẫu nhiên cho spawn
        const segIndex = Math.floor(this.random() * this.roadGraph.length);
        this.currentSegmentIndex = segIndex;
        this.progress = 0.1 + this.random() * 0.8;
        
        // Set lane dựa trên road type
        const seg = this.roadGraph[segIndex];
        if (seg) {
            const roadType = getRoadTypeConfig(seg.roadType || 'NORMAL_ROAD');
            // Xe khách thường đi lane phải (slow lane)
            const forwardLanes = roadType.lanesPerDirection;
            this.laneIndex = forwardLanes - 1; // Lane phải cùng (slow)
            this.targetLaneIndex = this.laneIndex;
            
            // Calculate lane offset
            this.laneOffset = this._calculateLaneOffset(seg, this.laneIndex);
            this.targetLaneOffset = this.laneOffset;
        }
        
        // Update position
        this._updatePositionFromSegment();
        this.heading = this._getSegmentHeading(segIndex);
        this.targetHeading = this.heading;
        
        // Initial speed
        this.speed = this.maxSpeed * 0.7;
        this.targetSpeed = this.maxSpeed * 0.8;
    }
    
    // ============================================================
    // MAIN UPDATE - ĐƯỢC GỌI TỪ MANAGER
    // ============================================================
    
    update(deltaTime, playerPos, allVehicles = []) {
        // LOD check
        this._updateLOD(playerPos);
        
        // Update theo LOD interval
        this.lodTimer += deltaTime;
        if (this.lodTimer < this.lodUpdateInterval[this.lodLevel]) {
            return;
        }
        this.lodTimer = 0;
        
        const dt = Math.min(this.lodUpdateInterval[this.lodLevel], 0.1);
        
        switch (this.lodLevel) {
            case 0: // NEAR - Full AI
                this._updateFull(dt, playerPos, allVehicles);
                break;
            case 1: // MEDIUM - Simplified
                this._updateMedium(dt, playerPos, allVehicles);
                break;
            case 2: // FAR - Minimal
                this._updateFar(dt);
                break;
        }
        
        // Update collider
        this._updateCollider();
        
        // Update lights
        this._updateLights();
    }
    
    // ============================================================
    // LOD UPDATE METHODS
    // ============================================================
    
    /**
     * FULL AI - Gần player (<100m)
     */
    _updateFull(dt, playerPos, allVehicles) {
        // 1. Check vehicle ahead
        this._detectVehicleAhead(allVehicles);
        
        // 2. Check junction
        this._checkJunctionAhead();
        
        // 3. Speed control
        this._updateSpeedControl(dt);
        
        // 4. Lane keeping / lane change
        this._updateLaneBehavior(dt);
        
        // 5. Steering (Ackermann-like cho xe khách)
        this._updateSteering(dt);
        
        // 6. Move along segment
        this._updateMovement(dt);
        
        // 7. State machine
        this._updateStateMachine(dt);
    }
    
    /**
     * MEDIUM AI - Trung bình (100-250m)
     */
    _updateMedium(dt, playerPos, allVehicles) {
        // Simplified: không check lane change, chỉ speed + follow
        this._detectVehicleAhead(allVehicles);
        this._checkJunctionAhead();
        this._updateSpeedControl(dt);
        this._updateSteering(dt);
        this._updateMovement(dt);
    }
    
    /**
     * FAR AI - Xa (>250m)
     */
    _updateFar(dt) {
        // Minimal: chỉ move theo segment, không check collision
        this.targetSpeed = this.maxSpeed * 0.8;
        this._updateSpeedControl(dt);
        this._updateMovement(dt);
    }
    
    // ============================================================
    // VEHICLE DETECTION
    // ============================================================
    
    _detectVehicleAhead(allVehicles) {
        this.vehicleAhead = null;
        this.distanceToAhead = Infinity;
        
        const myPos = this.vehicle.group.position;
        const myHeading = this.heading;
        const forwardX = Math.sin(myHeading);
        const forwardZ = Math.cos(myHeading);
        
        for (const other of allVehicles) {
            if (other === this) continue;
            if (!other?.vehicle?.group?.position) continue;
            
            const otherPos = other.vehicle.group.position;
            const dx = otherPos.x - myPos.x;
            const dz = otherPos.z - myPos.z;
            
            // Check if ahead (dot product with forward vector)
            const dotProduct = dx * forwardX + dz * forwardZ;
            if (dotProduct <= 0) continue; // Behind
            
            // Check lateral distance (same lane)
            const lateralDist = Math.abs(dx * forwardZ - dz * forwardX);
            if (lateralDist > 2.5) continue; // Different lane
            
            const dist = Math.hypot(dx, dz);
            if (dist < this.distanceToAhead) {
                this.distanceToAhead = dist;
                this.vehicleAhead = other;
            }
        }
        
        // Also check player bus
        if (playerPos) {
            const dx = playerPos.x - myPos.x;
            const dz = playerPos.z - myPos.z;
            const dotProduct = dx * forwardX + dz * forwardZ;
            
            if (dotProduct > 0) {
                const lateralDist = Math.abs(dx * forwardZ - dz * forwardX);
                if (lateralDist < 2.5) {
                    const dist = Math.hypot(dx, dz);
                    if (dist < this.distanceToAhead) {
                        this.distanceToAhead = dist;
                        this.vehicleAhead = { isPlayer: true, speed: 0 };
                    }
                }
            }
        }
    }
    
    // ============================================================
    // JUNCTION DETECTION
    // ============================================================
    
    _checkJunctionAhead() {
        const seg = this.roadGraph[this.currentSegmentIndex];
        if (!seg) return;
        
        // Tính khoảng cách đến cuối segment
        const segLength = this._getSegmentLength(this.currentSegmentIndex);
        const distToEnd = segLength * (1 - this.progress);
        
        this.approachDistToJunction = distToEnd;
        
        // Check nếu node cuối là junction
        if (distToEnd < 100) {
            const endNode = this._getEndNode(seg);
            if (endNode && this._isJunctionNode(endNode)) {
                if (this.state !== BUS_AI_STATE.IN_JUNCTION) {
                    this.state = BUS_AI_STATE.APPROACHING_JUNCTION;
                    this.junctionNode = endNode;
                }
            }
        }
    }
    
    _isJunctionNode(node) {
        // Junction detection: node có 3+ connections
        const connections = this._getNodeConnections(node.id);
        return connections.length >= 3;
    }
    
    _getNodeConnections(nodeId) {
        const connections = [];
        for (const seg of this.roadGraph) {
            if (seg.from === nodeId || seg.to === nodeId) {
                connections.push(seg);
            }
        }
        return connections;
    }
    
    // ============================================================
    // SPEED CONTROL
    // ============================================================
    
    _updateSpeedControl(dt) {
        let targetSpeed = this.maxSpeed;
        
        // === 1. JUNCTION SPEED LIMIT ===
        if (this.state === BUS_AI_STATE.APPROACHING_JUNCTION) {
            const distToJunction = this.approachDistToJunction;
            if (distToJunction < 50) {
                // Giảm tốc khi tới gần junction
                const slowdownFactor = clamp(distToJunction / 50, 0, 1);
                targetSpeed = this.config.junctionSpeedLimit * slowdownFactor;
            }
        }
        
        // === 2. FOLLOWING VEHICLE ===
        if (this.vehicleAhead && this.distanceToAhead < Infinity) {
            const safeDistance = this._calculateSafeDistance();
            
            if (this.distanceToAhead < safeDistance) {
                // Quá gần → giảm tốc hoặc dừng
                if (this.distanceToAhead < safeDistance * 0.5) {
                    targetSpeed = 0; // Emergency stop
                    this.state = BUS_AI_STATE.STOPPING;
                } else {
                    // Match speed of vehicle ahead
                    const aheadSpeed = this.vehicleAhead.speed || 0;
                    targetSpeed = Math.min(targetSpeed, aheadSpeed * 0.9);
                    this.state = BUS_AI_STATE.FOLLOWING;
                }
            } else if (this.distanceToAhead < safeDistance * 1.5) {
                // Sắp tới safe distance → giảm dần
                const aheadSpeed = this.vehicleAhead.speed || 0;
                targetSpeed = Math.min(targetSpeed, aheadSpeed * 1.1);
            }
        }
        
        // === 3. TURNING SPEED ===
        if (this.state === BUS_AI_STATE.TURNING) {
            targetSpeed = this.maxSpeed * this.config.corneringSpeedFactor;
        }
        
        // === 4. LANE CHANGE SPEED ===
        if (this.state === BUS_AI_STATE.LANE_CHANGING) {
            targetSpeed = this.maxSpeed * 0.8;
        }
        
        // Apply target speed
        this.targetSpeed = targetSpeed;
        
        // === ACCELERATE/BRAKE ===
        const speedDiff = this.targetSpeed - this.speed;
        
        if (speedDiff > 0.1) {
            // Accelerate (xe khách tăng tốc chậm)
            const accel = speedDiff > 5 ? this.config.acceleration : this.config.comfortAccel;
            this.speed += accel * dt;
            this.speed = Math.min(this.speed, this.targetSpeed);
            this.brakeLightOn = false;
            
        } else if (speedDiff < -0.1) {
            // Decelerate / Brake
            const decel = Math.abs(speedDiff) > 3 ? this.config.braking : this.config.comfortAccel * 0.8;
            this.speed -= decel * dt;
            this.speed = Math.max(this.speed, this.targetSpeed);
            this.brakeLightOn = Math.abs(speedDiff) > 1.5;
            
        } else {
            this.brakeLightOn = false;
        }
        
        // Clamp speed
        this.speed = clamp(this.speed, 0, this.maxSpeed);
    }
    
    _calculateSafeDistance() {
        const baseDist = this.config.baseFollowDistance;
        const speedDist = this.speed * this.config.followDistancePerSpeed;
        const vehicleAheadSpeed = this.vehicleAhead?.speed || 0;
        const speedDiff = Math.max(0, this.speed - vehicleAheadSpeed);
        
        return Math.max(
            this.config.minGap,
            baseDist + speedDist + (speedDiff * 0.5)
        );
    }
    
    // ============================================================
    // LANE BEHAVIOR
    // ============================================================
    
    _updateLaneBehavior(dt) {
        // Lane keeping
        this._updateLaneOffset(dt);
        
        // Lane change decision (chỉ khi cần)
        if (this.state === BUS_AI_STATE.CRUISING && 
            this.distanceToAhead < this.config.laneChangeDistance &&
            this.vehicleAhead &&
            this.speed < this.vehicleAhead.speed * 0.7) {
            
            // Cố gắng đổi lane để vượt
            if (this.random() < 0.01) { // 1% chance per update
                this._initiateLaneChange();
            }
        }
    }
    
    _updateLaneOffset(dt) {
        // Smooth lane offset interpolation
        const currentOffset = this.laneOffset;
        const targetOffset = this.targetLaneOffset;
        
        if (Math.abs(currentOffset - targetOffset) > 0.05) {
            // Đang đổi lane
            const laneChangeSpeed = (this.config.laneWidth || 3.5) / this.config.laneChangeTime;
            const direction = Math.sign(targetOffset - currentOffset);
            this.laneOffset += direction * laneChangeSpeed * dt;
            
            // Clamp
            if (direction > 0 && this.laneOffset > targetOffset) {
                this.laneOffset = targetOffset;
            } else if (direction < 0 && this.laneOffset < targetOffset) {
                this.laneOffset = targetOffset;
            }
        } else {
            this.laneOffset = targetOffset;
        }
    }
    
    _initiateLaneChange() {
        const seg = this.roadGraph[this.currentSegmentIndex];
        if (!seg) return;
        
        const roadType = getRoadTypeConfig(seg.roadType || 'NORMAL_ROAD');
        
        // Xe khách ưu tiên lane phải, chỉ đổi sang lane trái để vượt
        if (this.laneIndex > 0) {
            // Có lane trái → đổi sang
            this.targetLaneIndex = this.laneIndex - 1;
            this.targetLaneOffset = this._calculateLaneOffset(seg, this.targetLaneIndex);
            this.state = BUS_AI_STATE.LANE_CHANGING;
            this.turnSignalLeft = true;
        }
    }
    
    _calculateLaneOffset(segment, laneIndex) {
        const roadType = getRoadTypeConfig(segment.roadType || 'NORMAL_ROAD');
        
        // Xe khách đi theo hướng forward (lane phải)
        // Lane 0 = lane trái nhất, lane (lanesPerDirection-1) = lane phải nhất
        const forwardLanes = roadType.lanesPerDirection;
        
        if (laneIndex < 0 || laneIndex >= forwardLanes) {
            console.warn(`Invalid laneIndex: ${laneIndex}`);
            return 0;
        }
        
        // Offset từ tâm đường
        // Forward lanes ở bên phải median
        const medianHalf = roadType.hasMedian ? roadType.medianWidth / 2 : 0;
        const firstLaneOffset = medianHalf + (roadType.laneWidth / 2);
        
        return firstLaneOffset + (laneIndex * roadType.laneWidth);
    }
    
    // ============================================================
    // STEERING - ACKERMANN-LIKE CHO XE KHÁCH
    // ============================================================
    
    _updateSteering(dt) {
        const seg = this.roadGraph[this.currentSegmentIndex];
        if (!seg) return;
        
        // Target heading từ segment
        this.targetHeading = this._getSegmentHeading(this.currentSegmentIndex);
        
        // Nếu đang junction, heading từ junction path
        if (this.state === BUS_AI_STATE.IN_JUNCTION) {
            this.targetHeading = this._getJunctionHeading();
        }
        
        // Steering angle calculation
        const headingDiff = this._normalizeAngle(this.targetHeading - this.heading);
        
        // Xe khách có steering chậm hơn
        const maxSteer = this.config.maxSteerAngle;
        this.targetSteerAngle = clamp(headingDiff * 2.0, -maxSteer, maxSteer);
        
        // Smooth steering
        this.steerAngle = damp(this.steerAngle, this.targetSteerAngle, 3.0, dt);
        
        // Angular velocity từ steering (bicycle model)
        if (Math.abs(this.steerAngle) > 0.001 && this.speed > 0.1) {
            const turningRadius = this.wheelbase / Math.tan(Math.abs(this.steerAngle));
            const direction = Math.sign(this.steerAngle);
            this.angularVelocity = (this.speed / turningRadius) * direction;
        } else {
            this.angularVelocity = 0;
        }
        
        // Update heading
        this.heading += this.angularVelocity * dt;
        this.heading = this._normalizeAngle(this.heading);
    }
    
    // ============================================================
    // MOVEMENT
    // ============================================================
    
    _updateMovement(dt) {
        if (this.speed <= 0.01) return;
        
        const seg = this.roadGraph[this.currentSegmentIndex];
        if (!seg) return;
        
        // Move along segment
        const segLength = this._getSegmentLength(this.currentSegmentIndex);
        const moveDist = this.speed * dt;
        this.progress += moveDist / segLength;
        
        // Check if need to move to next segment
        if (this.progress >= 1.0) {
            this._transitionToNextSegment();
        }
        
        // Update world position
        this._updatePositionFromSegment();
        
        // Apply to vehicle model
        this._applyToVehicle();
    }
    
    _transitionToNextSegment() {
        const currentSeg = this.roadGraph[this.currentSegmentIndex];
        if (!currentSeg) return;
        
        const endNodeId = currentSeg.to;
        const nextSegs = this._getNodeConnections(endNodeId)
            .filter(seg => seg !== currentSeg && seg.from === endNodeId);
        
        if (nextSegs.length === 0) {
            // Dead end → reverse direction hoặc despawn
            this._handleDeadEnd();
            return;
        }
        
        // Chọn segment tiếp theo (random hoặc theo route)
        let nextSeg;
        if (this.route.length > 0 && this.routePosition < this.route.length - 1) {
            // Theo route
            this.routePosition++;
            nextSeg = this.roadGraph[this.route[this.routePosition]];
        } else {
            // Random choice
            nextSeg = nextSegs[Math.floor(this.random() * nextSegs.length)];
        }
        
        // Transition
        this.currentSegmentIndex = this.roadGraph.indexOf(nextSeg);
        this.progress = 0;
        
        // Reset lane cho segment mới
        this._setLaneForSegment(nextSeg);
        
        // Nếu vừa qua junction
        if (this.state === BUS_AI_STATE.IN_JUNCTION) {
            this.state = BUS_AI_STATE.CRUISING;
            this.turnSignalLeft = false;
            this.turnSignalRight = false;
        }
    }
    
    _handleDeadEnd() {
        // Xe khách không quay đầu dễ dàng → despawn
        this.collider.active = false;
        this.state = BUS_AI_STATE.STOPPED;
    }
    
    _setLaneForSegment(segment) {
        const roadType = getRoadTypeConfig(segment.roadType || 'NORMAL_ROAD');
        const forwardLanes = roadType.lanesPerDirection;
        
        // Xe khách ưu tiên lane phải
        this.laneIndex = forwardLanes - 1;
        this.targetLaneIndex = this.laneIndex;
        this.laneOffset = this._calculateLaneOffset(segment, this.laneIndex);
        this.targetLaneOffset = this.laneOffset;
    }
    
    // ============================================================
    // STATE MACHINE
    // ============================================================
    
    _updateStateMachine(dt) {
        this.stateTimer += dt;
        
        switch (this.state) {
            case BUS_AI_STATE.CRUISING:
                if (this.distanceToAhead < this._calculateSafeDistance()) {
                    this.state = BUS_AI_STATE.FOLLOWING;
                }
                break;
                
            case BUS_AI_STATE.FOLLOWING:
                if (this.distanceToAhead > this._calculateSafeDistance() * 1.5) {
                    this.state = BUS_AI_STATE.CRUISING;
                }
                break;
                
            case BUS_AI_STATE.APPROACHING_JUNCTION:
                if (this.approachDistToJunction < 10) {
                    this.state = BUS_AI_STATE.IN_JUNCTION;
                    this._chooseJunctionDirection();
                }
                break;
                
            case BUS_AI_STATE.IN_JUNCTION:
                // Xử lý bởi _transitionToNextSegment
                break;
                
            case BUS_AI_STATE.LANE_CHANGING:
                if (Math.abs(this.laneOffset - this.targetLaneOffset) < 0.1) {
                    this.state = BUS_AI_STATE.CRUISING;
                    this.turnSignalLeft = false;
                    this.laneIndex = this.targetLaneIndex;
                }
                break;
                
            case BUS_AI_STATE.STOPPING:
                if (this.speed <= 0.1) {
                    this.state = BUS_AI_STATE.STOPPED;
                }
                break;
                
            case BUS_AI_STATE.STOPPED:
                if (this.distanceToAhead > this._calculateSafeDistance() * 2) {
                    this.state = BUS_AI_STATE.ACCELERATING;
                }
                break;
                
            case BUS_AI_STATE.ACCELERATING:
                if (this.speed > this.maxSpeed * 0.8) {
                    this.state = BUS_AI_STATE.CRUISING;
                }
                break;
        }
    }
    
    // ============================================================
    // JUNCTION HANDLING
    // ============================================================
    
    _chooseJunctionDirection() {
        const junctionNode = this.junctionNode;
        if (!junctionNode) return;
        
        const connections = this._getNodeConnections(junctionNode.id);
        const possibleSegments = connections.filter(seg => 
            seg.from === junctionNode.id && 
            seg !== this.roadGraph[this.currentSegmentIndex]
        );
        
        if (possibleSegments.length === 0) return;
        
        // Chọn hướng (ưu tiên thẳng > phải > trái)
        const currentHeading = this.heading;
        
        let bestSegment = possibleSegments[0];
        let bestScore = -Infinity;
        
        for (const seg of possibleSegments) {
            const segHeading = this._getSegmentHeadingBySegment(seg);
            const angleDiff = this._normalizeAngle(segHeading - currentHeading);
            
            // Score: thẳng (0) > phải (âm) > trái (dương)
            let score = 0;
            if (Math.abs(angleDiff) < 0.3) {
                score = 100; // Thẳng
            } else if (angleDiff < 0) {
                score = 50 - Math.abs(angleDiff); // Phải
            } else {
                score = 20 - Math.abs(angleDiff); // Trái
            }
            
            // Random factor
            score += this.random() * 10;
            
            if (score > bestScore) {
                bestScore = score;
                bestSegment = seg;
            }
        }
        
        // Set turn direction
        const segHeading = this._getSegmentHeadingBySegment(bestSegment);
        const angleDiff = this._normalizeAngle(segHeading - currentHeading);
        this.turnDirection = Math.sign(angleDiff);
        
        // Turn signal
        if (this.turnDirection > 0.1) {
            this.turnSignalLeft = true;
        } else if (this.turnDirection < -0.1) {
            this.turnSignalRight = true;
        }
    }
    
    _getJunctionHeading() {
        // Heading khi trong junction (interpolate)
        if (!this.junctionNode) return this.heading;
        
        const nextSeg = this._getNextSegmentAfterJunction();
        if (nextSeg) {
            return this._getSegmentHeadingBySegment(nextSeg);
        }
        
        return this.heading;
    }
    
    _getNextSegmentAfterJunction() {
        const connections = this._getNodeConnections(this.junctionNode.id);
        return connections.find(seg => 
            seg.from === this.junctionNode.id &&
            seg !== this.roadGraph[this.currentSegmentIndex]
        ) || null;
    }
    
    // ============================================================
    // POSITION CALCULATION
    // ============================================================
    
    _updatePositionFromSegment() {
        const seg = this.roadGraph[this.currentSegmentIndex];
        if (!seg) return;
        
        const p0 = seg.points[0];
        const p1 = seg.points[1];
        
        // Interpolate along segment
        const t = this.progress;
        let x = p0.x + (p1.x - p0.x) * t;
        let z = p0.z + (p1.z - p0.z) * t;
        
        // Apply lane offset (perpendicular to road direction)
        const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        const perpX = Math.cos(angle);
        const perpZ = -Math.sin(angle);
        
        x += this.laneOffset * perpX;
        z += this.laneOffset * perpZ;
        
        // Update collider
        this.collider.x = x;
        this.collider.z = z;
    }
    
    _applyToVehicle() {
        if (!this.vehicle?.group) return;
        
        const pos = this.vehicle.group.position;
        pos.x = this.collider.x;
        pos.z = this.collider.z;
        pos.y = 0.5; // Ground height
        
        // Apply rotation
        this.vehicle.group.rotation.y = this.heading;
    }
    
    // ============================================================
    // LIGHTS
    // ============================================================
    
    _updateLights() {
        if (!this.vehicle) return;
        
        // Brake lights
        if (this.vehicle.setBrakeLights) {
            this.vehicle.setBrakeLights(this.brakeLightOn);
        }
        
        // Turn signals
        if (this.vehicle.setTurnSignalLeft) {
            this.vehicle.setTurnSignalLeft(this.turnSignalLeft);
        }
        if (this.vehicle.setTurnSignalRight) {
            this.vehicle.setTurnSignalRight(this.turnSignalRight);
        }
        
        // Headlights (theo time of day)
        if (this.vehicle.setHeadlights) {
            // Có thể check ngày/đêm ở đây
            // this.vehicle.setHeadlights(isNight);
        }
    }
    
    // ============================================================
    // LOD SYSTEM
    // ============================================================
    
    _updateLOD(playerPos) {
        if (!playerPos || !this.vehicle?.group) {
            this.lodLevel = 2;
            return;
        }
        
        const pos = this.vehicle.group.position;
        const dist = Math.hypot(
            pos.x - playerPos.x,
            pos.z - playerPos.z
        );
        
        if (dist < 100) {
            this.lodLevel = 0; // NEAR
        } else if (dist < 250) {
            this.lodLevel = 1; // MEDIUM
        } else {
            this.lodLevel = 2; // FAR
        }
        
        // Toggle visibility của detailed parts theo LOD
        this._updateLODVisibility();
    }
    
    _updateLODVisibility() {
        if (!this.vehicle?.group) return;
        
        // Hide/show detailed parts based on LOD
        const detailedParts = this.vehicle.lodParts || [];
        
        for (const part of detailedParts) {
            if (part) {
                part.visible = this.lodLevel <= 1;
            }
        }
        
        // Interior visible chỉ khi gần
        if (this.vehicle.interiorGroup) {
            this.vehicle.interiorGroup.visible = this.lodLevel === 0;
        }
    }
    
    // ============================================================
    // COLLIDER
    // ============================================================
    
    _updateCollider() {
        if (!this.vehicle?.group) return;
        
        const pos = this.vehicle.group.position;
        this.collider.x = pos.x;
        this.collider.z = pos.z;
        
        // Update rotation trong collider
        this.collider.rotation = this.heading;
    }
    
    // ============================================================
    // HELPER METHODS
    // ============================================================
    
    _getSegmentLength(index) {
        const seg = this.roadGraph[index];
        if (!seg || !seg.points) return 100;
        
        const p0 = seg.points[0];
        const p1 = seg.points[1];
        return Math.hypot(p1.x - p0.x, p1.z - p0.z);
    }
    
    _getSegmentHeading(index) {
        const seg = this.roadGraph[index];
        if (!seg || !seg.points) return 0;
        
        const p0 = seg.points[0];
        const p1 = seg.points[1];
        return Math.atan2(p1.x - p0.x, p1.z - p0.z);
    }
    
    _getSegmentHeadingBySegment(seg) {
        if (!seg || !seg.points) return 0;
        
        const p0 = seg.points[0];
        const p1 = seg.points[1];
        return Math.atan2(p1.x - p0.x, p1.z - p0.z);
    }
    
    _getEndNode(seg) {
        // Return node object at end of segment
        // This depends on how roadNetworkData is structured
        return { id: seg.to, type: 'junction' };
    }
    
    _normalizeAngle(angle) {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }
    
    // ============================================================
    // PUBLIC API
    // ============================================================
    
    /**
     * Check có nên despawn không
     */
    shouldDespawn(playerPos) {
        if (!playerPos || !this.vehicle?.group) return false;
        
        const pos = this.vehicle.group.position;
        const dist = Math.hypot(
            pos.x - playerPos.x,
            pos.z - playerPos.z
        );
        
        return dist > this.config.despawnDistance;
    }
    
    /**
     * Get collider cho collision system
     */
    getCollider() {
        return { ...this.collider };
    }
    
    /**
     * Get current state info
     */
    getState() {
        return {
            state: this.state,
            speed: this.speed,
            targetSpeed: this.targetSpeed,
            heading: this.heading,
            laneIndex: this.laneIndex,
            segmentIndex: this.currentSegmentIndex,
            progress: this.progress,
            lodLevel: this.lodLevel,
            distanceToAhead: this.distanceToAhead,
        };
    }
    
    /**
     * Set route (optional)
     */
    setRoute(segmentIndices) {
        this.route = segmentIndices || [];
        this.routePosition = 0;
    }
    
    /**
     * Reset AI (khi respawn)
     */
    reset() {
        this.state = BUS_AI_STATE.CRUISING;
        this.speed = 0;
        this.targetSpeed = 0;
        this.progress = 0;
        this.heading = 0;
        this.laneOffset = 0;
        this.targetLaneOffset = 0;
        this.vehicleAhead = null;
        this.distanceToAhead = Infinity;
        this.junctionNode = null;
        this.brakeLightOn = false;
        this.turnSignalLeft = false;
        this.turnSignalRight = false;
    }
    
    /**
     * Dispose
     */
    dispose() {
        this.vehicle = null;
        this.roadGraph = null;
        this.route = [];
        this.vehicleAhead = null;
    }
}