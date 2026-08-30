// js/steering.js - ACKERMANN STEERING SYSTEM CHO COACHVN
// Mô phỏng xe thật: bánh trước quyết định hướng, thân xe follow quỹ đạo
// Đuôi xe cắt cua tự nhiên, có steering lag, speed-sensitive

import * as THREE from "three";

// ============================================================
// CẤU HÌNH STEERING
// ============================================================

export const STEERING_CONFIG = {
    // === GEOMETRY (meters) ===
    wheelbase: 6.5,              // Khoảng cách trục trước - trục sau
    trackWidth: 2.05,            // Chiều rộng trục xe (2 bánh)
    frontOverhang: 2.2,          // Phần nhô phía trước trục trước
    rearOverhang: 3.3,           // Phần nhô phía sau trục sau
    
    // === STEERING LIMITS ===
    maxSteerAngle: 0.55,         // Max steering angle (radians) ≈ 31.5°
    minSteerAngle: -0.55,        // Min steering angle
    
    // === STEERING DYNAMICS ===
    steeringSpeed: 2.8,          // Tốc độ đánh lái (rad/s)
    steeringReturn: 4.5,         // Tốc độ trả lái về 0 (rad/s)
    steeringDamping: 0.85,       // Damping factor (0-1)
    
    // === SPEED SENSITIVITY ===
    // Steering giảm khi tốc độ tăng để tránh lật xe
    lowSpeedSteerFactor: 1.0,    // Full steering khi đứng yên/chậm
    highSpeedSteerFactor: 0.25,  // Chỉ 25% steering khi max speed
    highSpeedThreshold: 25.0,    // Tốc độ bắt đầu giảm steering (m/s = 90 km/h)
    
    // === TURNING PHYSICS ===
    slipAngle: 0.08,             // Góc trượt (understeer effect)
    centrifugalFactor: 0.15,     // Lực hướng tâm ảnh hưởng
    maxLateralAccel: 4.5,        // Max lateral acceleration (m/s²)
    
    // === BRAKING EFFECTS ===
    brakeSteerReduction: 0.7,    // Giảm steering khi phanh
    
    // === REVERSE STEERING ===
    reverseSteerFactor: 0.8,     // Steering khi lùi (80% bình thường)
    
    // === STABILITY ===
    straightLineDamping: 0.02,   // Tự động thẳng khi thả lái
    wobbleThreshold: 0.005,      // Ngưỡng dao động
};

// ============================================================
// STEERING STATE
// ============================================================

export class SteeringSystem {
    constructor(config = {}) {
        // Merge với default config
        this.config = { ...STEERING_CONFIG, ...config };
        
        // === STATE ===
        this.steerAngle = 0;           // Current steering angle (rad)
        this.targetSteerAngle = 0;     // Target từ input
        this.steerVelocity = 0;        // Steering angular velocity
        
        // Vehicle state
        this.heading = 0;              // Current heading (rad)
        this.angularVelocity = 0;      // Current angular velocity (rad/s)
        this.turningRadius = Infinity; // Current turning radius (m)
        
        // Position tracking (rear axle)
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.speed = 0;                // Current speed (m/s, có dấu)
        
        // Stability
        this.lateralSlip = 0;          // Lateral slip amount
        this.stabilityFactor = 1.0;    // 1 = stable, <1 = sliding
        
        // Wheel rotation for animation
        this.wheelRotation = 0;
        
        // Debug
        this.debug = {
            showTrajectory: false,
            showTurningRadius: false,
        };
    }
    
    // ============================================================
    // UPDATE - ĐƯỢC GỌI MỖI FRAME
    // ============================================================
    
    /**
     * Update steering system
     * @param {number} deltaTime - Thời gian frame (seconds)
     * @param {number} speedInput - Tốc độ hiện tại (m/s, có dấu)
     * @param {number} steerInput - Input lái (-1 to 1, trái = +1, phải = -1)
     * @param {boolean} braking - Có đang phanh không
     * @returns {object} - Kết quả update
     */
    update(deltaTime, speedInput, steerInput, braking = false) {
        const cfg = this.config;
        const dt = Math.min(deltaTime, 0.05); // Cap dt để tránh spike
        
        // ===== 1. UPDATE SPEED =====
        this.speed = speedInput;
        const absSpeed = Math.abs(this.speed);
        
        // ===== 2. CALCULATE EFFECTIVE STEERING =====
        // Steering giảm khi tốc độ cao
        const speedFactor = this._calculateSpeedFactor(absSpeed);
        
        // Giảm steering khi phanh
        const brakeFactor = braking ? cfg.brakeSteerReduction : 1.0;
        
        // Steering khi lùi (đảo chiều hiệu ứng)
        const isReversing = this.speed < -0.1;
        const reverseFactor = isReversing ? cfg.reverseSteerFactor : 1.0;
        
        // Target steering angle
        this.targetSteerAngle = steerInput * cfg.maxSteerAngle * speedFactor * brakeFactor;
        
        // Clamp target
        this.targetSteerAngle = Math.max(
            cfg.minSteerAngle,
            Math.min(cfg.maxSteerAngle, this.targetSteerAngle)
        );
        
        // ===== 3. STEERING DYNAMICS (lag + damping) =====
        this._updateSteeringDynamics(dt, steerInput);
        
        // ===== 4. CALCULATE TURNING GEOMETRY =====
        this._calculateTurningGeometry(dt);
        
        // ===== 5. UPDATE VEHICLE POSITION & HEADING =====
        this._updateVehiclePose(dt);
        
        // ===== 6. UPDATE WHEEL ANIMATION =====
        this._updateWheelRotation(dt);
        
        // ===== 7. STABILITY CHECKS =====
        this._updateStability(dt);
        
        return {
            steerAngle: this.steerAngle,
            heading: this.heading,
            angularVelocity: this.angularVelocity,
            turningRadius: this.turningRadius,
            position: this.position,
            speed: this.speed,
            isTurning: Math.abs(this.steerAngle) > 0.02,
            turningDirection: this.steerAngle > 0 ? 'left' : (this.steerAngle < 0 ? 'right' : 'none'),
            stabilityFactor: this.stabilityFactor,
        };
    }
    
    // ============================================================
    // PRIVATE METHODS
    // ============================================================
    
    /**
     * Tính speed factor cho steering
     * Speed cao → steering giảm để tránh lật
     */
    _calculateSpeedFactor(absSpeed) {
        const cfg = this.config;
        
        if (absSpeed <= 5.0) {
            // Tốc độ rất thấp: full steering
            return cfg.lowSpeedSteerFactor;
        }
        
        // Linear interpolation từ low speed đến high speed
        const t = Math.min(1.0, (absSpeed - 5.0) / (cfg.highSpeedThreshold - 5.0));
        
        // Ease-out curve cho tự nhiên hơn
        const eased = 1.0 - Math.pow(t, 1.5);
        
        return cfg.lowSpeedSteerFactor + 
               (cfg.highSpeedSteerFactor - cfg.lowSpeedSteerFactor) * (1.0 - eased);
    }
    
    /**
     * Update steering dynamics với lag và damping
     */
    _updateSteeringDynamics(dt, steerInput) {
        const cfg = this.config;
        
        // Tính steering velocity
        const angleDiff = this.targetSteerAngle - this.steerAngle;
        
        // Nếu có input → tăng tốc steering
        if (Math.abs(steerInput) > 0.01) {
            this.steerVelocity += angleDiff * cfg.steeringSpeed * dt;
        } else {
            // Không input → trả lái về 0
            this.steerVelocity += (-this.steerAngle) * cfg.steeringReturn * dt;
        }
        
        // Apply damping
        this.steerVelocity *= cfg.steeringDamping;
        
        // Clamp velocity
        const maxSteerVel = cfg.steeringSpeed;
        this.steerVelocity = Math.max(-maxSteerVel, Math.min(maxSteerVel, this.steerVelocity));
        
        // Update angle
        this.steerAngle += this.steerVelocity * dt;
        
        // Clamp angle
        this.steerAngle = Math.max(
            cfg.minSteerAngle,
            Math.min(cfg.maxSteerAngle, this.steerAngle)
        );
        
        // Dead zone
        if (Math.abs(this.steerAngle) < cfg.wobbleThreshold && 
            Math.abs(steerInput) < 0.01) {
            this.steerAngle = 0;
            this.steerVelocity = 0;
        }
    }
    
    /**
     * Tính toán turning geometry (bicycle model)
     */
    _calculateTurningGeometry(dt) {
        const cfg = this.config;
        const absSpeed = Math.abs(this.speed);
        
        // Nếu không steering hoặc không di chuyển → đi thẳng
        if (Math.abs(this.steerAngle) < 0.001 || absSpeed < 0.01) {
            this.turningRadius = Infinity;
            this.angularVelocity = 0;
            return;
        }
        
        // ===== BICYCLE MODEL =====
        // Turning radius từ wheelbase và steer angle
        // R = wheelbase / tan(steerAngle)
        this.turningRadius = cfg.wheelbase / Math.tan(Math.abs(this.steerAngle));
        
        // Angular velocity: ω = v / R
        // Dấu của steerAngle quyết định chiều quay
        const direction = Math.sign(this.steerAngle);
        const speedSign = Math.sign(this.speed);
        
        // Khi lùi, chiều quay ngược lại
        const effectiveDirection = speedSign < 0 ? -direction : direction;
        
        this.angularVelocity = (absSpeed / this.turningRadius) * effectiveDirection;
        
        // ===== APPLY SLIP ANGLE (understeer) =====
        // Xe thật không quay đúng như lý thuyết
        const slipEffect = 1.0 - (cfg.slipAngle * (absSpeed / cfg.highSpeedThreshold));
        this.angularVelocity *= Math.max(0.5, slipEffect);
        
        // ===== CENTRIFUGAL FORCE LIMIT =====
        // Giới hạn lateral acceleration để tránh lật
        const lateralAccel = Math.abs(this.angularVelocity * absSpeed);
        if (lateralAccel > cfg.maxLateralAccel) {
            const scale = cfg.maxLateralAccel / lateralAccel;
            this.angularVelocity *= scale;
            // Xe bắt đầu trượt
            this.lateralSlip = lateralAccel / cfg.maxLateralAccel;
        } else {
            this.lateralSlip = 0;
        }
    }
    
    /**
     * Update vị trí và hướng xe
     */
    _updateVehiclePose(dt) {
        const absSpeed = Math.abs(this.speed);
        
        // Nếu không di chuyển
        if (absSpeed < 0.001) {
            return;
        }
        
        if (Math.abs(this.angularVelocity) < 0.0001) {
            // ===== ĐI THẲNG =====
            const forward = new THREE.Vector3(
                Math.sin(this.heading),
                0,
                Math.cos(this.heading)
            );
            
            const moveDist = this.speed * dt;
            this.position.x += forward.x * moveDist;
            this.position.z += forward.z * moveDist;
            
        } else {
            // ===== ĐI THEO CUNG TRÒN =====
            // Update heading
            this.heading += this.angularVelocity * dt;
            
            // Normalize heading
            this.heading = this._normalizeAngle(this.heading);
            
            // Tính vị trí mới theo cung
            // Sử dụng arc-based movement cho chính xác
            const R = Math.abs(this.turningRadius);
            const arcAngle = Math.abs(this.angularVelocity * dt);
            const direction = Math.sign(this.angularVelocity);
            
            // Tính displacement
            // Phương pháp: rotate position quanh center of turning circle
            const centerX = this.position.x - Math.cos(this.heading) * R * direction;
            const centerZ = this.position.z + Math.sin(this.heading) * R * direction;
            
            // Rotate quanh center
            const cosA = Math.cos(arcAngle * direction);
            const sinA = Math.sin(arcAngle * direction);
            
            const relX = this.position.x - centerX;
            const relZ = this.position.z - centerZ;
            
            this.position.x = centerX + relX * cosA - relZ * sinA;
            this.position.z = centerZ + relX * sinA + relZ * cosA;
        }
    }
    
    /**
     * Update wheel rotation cho animation
     */
    _updateWheelRotation(dt) {
        const absSpeed = Math.abs(this.speed);
        
        // Wheel rotation cho animation
        const wheelCircumference = 2 * Math.PI * 0.55; // Bán kính bánh ~0.55m
        if (wheelCircumference > 0) {
            this.wheelRotation += (this.speed / wheelCircumference) * dt * Math.PI * 2;
        }
    }
    
    /**
     * Update stability factors
     */
    _updateStability(dt) {
        const cfg = this.config;
        
        // Stability giảm khi có lateral slip
        if (this.lateralSlip > 0) {
            this.stabilityFactor = Math.max(0.3, 1.0 - this.lateralSlip);
        } else {
            // Recovery
            this.stabilityFactor += (1.0 - this.stabilityFactor) * dt * 2.0;
        }
    }
    
    /**
     * Normalize angle về [-π, π]
     */
    _normalizeAngle(angle) {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }
    
    // ============================================================
    // PUBLIC GETTERS
    // ============================================================
    
    /**
     * Lấy hướng forward hiện tại
     */
    getForwardVector() {
        return new THREE.Vector3(
            Math.sin(this.heading),
            0,
            Math.cos(this.heading)
        );
    }
    
    /**
     * Lấy vị trí trục trước
     */
    getFrontAxlePosition() {
        const forward = this.getForwardVector();
        return new THREE.Vector3(
            this.position.x + forward.x * this.config.wheelbase / 2,
            this.position.y,
            this.position.z + forward.z * this.config.wheelbase / 2
        );
    }
    
    /**
     * Lấy vị trí trục sau
     */
    getRearAxlePosition() {
        const forward = this.getForwardVector();
        return new THREE.Vector3(
            this.position.x - forward.x * this.config.wheelbase / 2,
            this.position.y,
            this.position.z - forward.z * this.config.wheelbase / 2
        );
    }
    
    /**
     * Lấy góc steering của bánh trước trái (Ackermann inner wheel)
     */
    getInnerWheelAngle() {
        const cfg = this.config;
        if (Math.abs(this.steerAngle) < 0.001) return 0;
        
        const R = cfg.wheelbase / Math.tan(Math.abs(this.steerAngle));
        const innerR = R - cfg.trackWidth / 2;
        return Math.atan(cfg.wheelbase / innerR) * Math.sign(this.steerAngle);
    }
    
    /**
     * Lấy góc steering của bánh trước phải (Ackermann outer wheel)
     */
    getOuterWheelAngle() {
        const cfg = this.config;
        if (Math.abs(this.steerAngle) < 0.001) return 0;
        
        const R = cfg.wheelbase / Math.tan(Math.abs(this.steerAngle));
        const outerR = R + cfg.trackWidth / 2;
        return Math.atan(cfg.wheelbase / outerR) * Math.sign(this.steerAngle);
    }
    
    /**
     * Kiểm tra có đang turning không
     */
    isTurning() {
        return Math.abs(this.steerAngle) > 0.02 && Math.abs(this.speed) > 0.1;
    }
    
    /**
     * Lấy chiều turning
     */
    getTurnDirection() {
        if (this.steerAngle > 0.02) return 'left';
        if (this.steerAngle < -0.02) return 'right';
        return 'straight';
    }
    
    /**
     * Reset về trạng thái ban đầu
     */
    reset() {
        this.steerAngle = 0;
        this.targetSteerAngle = 0;
        this.steerVelocity = 0;
        this.heading = 0;
        this.angularVelocity = 0;
        this.turningRadius = Infinity;
        this.position.set(0, 0, 0);
        this.velocity.set(0, 0, 0);
        this.speed = 0;
        this.lateralSlip = 0;
        this.stabilityFactor = 1.0;
        this.wheelRotation = 0;
    }
    
    /**
     * Set vị trí và hướng (khi load game hoặc teleport)
     */
    setPose(x, z, heading) {
        this.position.set(x, 0, z);
        this.heading = heading;
        this.steerAngle = 0;
        this.angularVelocity = 0;
        this.steerVelocity = 0;
    }
    
    /**
     * Lấy debug info
     */
    getDebugInfo() {
        return {
            steerAngle: THREE.MathUtils.radToDeg(this.steerAngle).toFixed(1) + '°',
            targetSteerAngle: THREE.MathUtils.radToDeg(this.targetSteerAngle).toFixed(1) + '°',
            heading: THREE.MathUtils.radToDeg(this.heading).toFixed(1) + '°',
            turningRadius: this.turningRadius === Infinity ? '∞' : this.turningRadius.toFixed(1) + 'm',
            angularVelocity: this.angularVelocity.toFixed(3) + ' rad/s',
            speed: this.speed.toFixed(2) + ' m/s',
            lateralSlip: this.lateralSlip.toFixed(3),
            stabilityFactor: this.stabilityFactor.toFixed(3),
            isTurning: this.isTurning(),
            turnDirection: this.getTurnDirection(),
        };
    }
}

// ============================================================
// UTILITY: TẠO VISUAL DEBUG HELPER
// ============================================================

/**
 * Tạo visual debug cho steering (tùy chọn)
 */
export function createSteeringDebugHelper(scene, steeringSystem) {
    const group = new THREE.Group();
    group.name = "steering-debug";
    scene.add(group);
    
    // Turning circle visual
    const circleGeometry = new THREE.RingGeometry(0.98, 1.0, 64);
    const circleMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    const turningCircle = new THREE.Mesh(circleGeometry, circleMaterial);
    turningCircle.rotation.x = -Math.PI / 2;
    group.add(turningCircle);
    
    // Heading arrow
    const arrowGeometry = new THREE.ConeGeometry(0.3, 1.5, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const headingArrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    group.add(headingArrow);
    
    function update() {
        const pos = steeringSystem.position;
        
        // Update turning circle
        if (steeringSystem.turningRadius !== Infinity && steeringSystem.turningRadius < 100) {
            turningCircle.visible = true;
            const R = steeringSystem.turningRadius;
            turningCircle.scale.set(R, R, 1);
            
            // Position at turning center
            const direction = Math.sign(steeringSystem.angularVelocity);
            const centerX = pos.x - Math.cos(steeringSystem.heading) * R * direction;
            const centerZ = pos.z + Math.sin(steeringSystem.heading) * R * direction;
            turningCircle.position.set(centerX, 0.1, centerZ);
        } else {
            turningCircle.visible = false;
        }
        
        // Update heading arrow
        headingArrow.position.set(
            pos.x + Math.sin(steeringSystem.heading) * 2,
            1.5,
            pos.z + Math.cos(steeringSystem.heading) * 2
        );
        headingArrow.rotation.z = -steeringSystem.heading + Math.PI / 2;
    }
    
    function dispose() {
        scene.remove(group);
        circleGeometry.dispose();
        circleMaterial.dispose();
        arrowGeometry.dispose();
        arrowMaterial.dispose();
    }
    
    return { update, dispose, group };
}