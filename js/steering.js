// js/steering.js

import * as THREE from "three";


export const STEERING_CONFIG = {
    wheelbase: 6.5,
    trackWidth: 2.05,
    frontOverhang: 2.2,
    rearOverhang: 3.3,

    maxSteerAngle: 0.55,
    minSteerAngle: -0.55,

    steeringSpeed: 2.8,
    steeringReturn: 4.5,
    steeringDamping: 0.85,

    lowSpeedSteerFactor: 1.0,
    highSpeedSteerFactor: 0.25,
    highSpeedThreshold: 25.0,

    slipAngle: 0.08,
    centrifugalFactor: 0.15,
    maxLateralAccel: 4.5,

    brakeSteerReduction: 0.7,

    reverseSteerFactor: 0.8,

    straightLineDamping: 0.02,
    wobbleThreshold: 0.005,
};


export class SteeringSystem {
    constructor(config = {}) {
        this.config = { ...STEERING_CONFIG, ...config };

        this.steerAngle = 0;
        this.targetSteerAngle = 0;
        this.steerVelocity = 0;

        this.heading = 0;
        this.angularVelocity = 0;
        this.turningRadius = Infinity;

        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.speed = 0;

        this.lateralSlip = 0;
        this.stabilityFactor = 1.0;

        this.wheelRotation = 0;

        this.debug = {
            showTrajectory: false,
            showTurningRadius: false,
        };
    }



    update(deltaTime, speedInput, steerInput, braking = false) {
        const cfg = this.config;
        const dt = Math.min(deltaTime, 0.05);

        this.speed = speedInput;
        const absSpeed = Math.abs(this.speed);

        const speedFactor = this._calculateSpeedFactor(absSpeed);

        const brakeFactor = braking ? cfg.brakeSteerReduction : 1.0;

        const isReversing = this.speed < -0.1;
        const reverseFactor = isReversing ? cfg.reverseSteerFactor : 1.0;

        this.targetSteerAngle = steerInput * cfg.maxSteerAngle * speedFactor * brakeFactor;

        this.targetSteerAngle = Math.max(
            cfg.minSteerAngle,
            Math.min(cfg.maxSteerAngle, this.targetSteerAngle)
        );

        this._updateSteeringDynamics(dt, steerInput);

        this._calculateTurningGeometry(dt);

        this._updateVehiclePose(dt);

        this._updateWheelRotation(dt);

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



    _calculateSpeedFactor(absSpeed) {
        const cfg = this.config;

        if (absSpeed <= 5.0) {
            return cfg.lowSpeedSteerFactor;
        }

        const t = Math.min(1.0, (absSpeed - 5.0) / (cfg.highSpeedThreshold - 5.0));

        const eased = 1.0 - Math.pow(t, 1.5);

        return cfg.lowSpeedSteerFactor +
               (cfg.highSpeedSteerFactor - cfg.lowSpeedSteerFactor) * (1.0 - eased);
    }


    _updateSteeringDynamics(dt, steerInput) {
        const cfg = this.config;

        const angleDiff = this.targetSteerAngle - this.steerAngle;

        if (Math.abs(steerInput) > 0.01) {
            this.steerVelocity += angleDiff * cfg.steeringSpeed * dt;
        } else {
            this.steerVelocity += (-this.steerAngle) * cfg.steeringReturn * dt;
        }

        this.steerVelocity *= cfg.steeringDamping;

        const maxSteerVel = cfg.steeringSpeed;
        this.steerVelocity = Math.max(-maxSteerVel, Math.min(maxSteerVel, this.steerVelocity));

        this.steerAngle += this.steerVelocity * dt;

        this.steerAngle = Math.max(
            cfg.minSteerAngle,
            Math.min(cfg.maxSteerAngle, this.steerAngle)
        );

        if (Math.abs(this.steerAngle) < cfg.wobbleThreshold &&
            Math.abs(steerInput) < 0.01) {
            this.steerAngle = 0;
            this.steerVelocity = 0;
        }
    }


    _calculateTurningGeometry(dt) {
        const cfg = this.config;
        const absSpeed = Math.abs(this.speed);

        if (Math.abs(this.steerAngle) < 0.001 || absSpeed < 0.01) {
            this.turningRadius = Infinity;
            this.angularVelocity = 0;
            return;
        }

        this.turningRadius = cfg.wheelbase / Math.tan(Math.abs(this.steerAngle));

        const direction = Math.sign(this.steerAngle);
        const speedSign = Math.sign(this.speed);

        const effectiveDirection = speedSign < 0 ? -direction : direction;

        this.angularVelocity = (absSpeed / this.turningRadius) * effectiveDirection;

        const slipEffect = 1.0 - (cfg.slipAngle * (absSpeed / cfg.highSpeedThreshold));
        this.angularVelocity *= Math.max(0.5, slipEffect);

        const lateralAccel = Math.abs(this.angularVelocity * absSpeed);
        if (lateralAccel > cfg.maxLateralAccel) {
            const scale = cfg.maxLateralAccel / lateralAccel;
            this.angularVelocity *= scale;
            this.lateralSlip = lateralAccel / cfg.maxLateralAccel;
        } else {
            this.lateralSlip = 0;
        }
    }


    _updateVehiclePose(dt) {
        const absSpeed = Math.abs(this.speed);

        if (absSpeed < 0.001) {
            return;
        }

        if (Math.abs(this.angularVelocity) < 0.0001) {
            const forward = new THREE.Vector3(
                Math.sin(this.heading),
                0,
                Math.cos(this.heading)
            );

            const moveDist = this.speed * dt;
            this.position.x += forward.x * moveDist;
            this.position.z += forward.z * moveDist;

        } else {
            this.heading += this.angularVelocity * dt;

            this.heading = this._normalizeAngle(this.heading);

            const R = Math.abs(this.turningRadius);
            const arcAngle = Math.abs(this.angularVelocity * dt);
            const direction = Math.sign(this.angularVelocity);

            const centerX = this.position.x - Math.cos(this.heading) * R * direction;
            const centerZ = this.position.z + Math.sin(this.heading) * R * direction;

            const cosA = Math.cos(arcAngle * direction);
            const sinA = Math.sin(arcAngle * direction);

            const relX = this.position.x - centerX;
            const relZ = this.position.z - centerZ;

            this.position.x = centerX + relX * cosA - relZ * sinA;
            this.position.z = centerZ + relX * sinA + relZ * cosA;
        }
    }


    _updateWheelRotation(dt) {
        const absSpeed = Math.abs(this.speed);

        const wheelCircumference = 2 * Math.PI * 0.55;
        if (wheelCircumference > 0) {
            this.wheelRotation += (this.speed / wheelCircumference) * dt * Math.PI * 2;
        }
    }


    _updateStability(dt) {
        const cfg = this.config;

        if (this.lateralSlip > 0) {
            this.stabilityFactor = Math.max(0.3, 1.0 - this.lateralSlip);
        } else {
            this.stabilityFactor += (1.0 - this.stabilityFactor) * dt * 2.0;
        }
    }


    _normalizeAngle(angle) {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }



    getForwardVector() {
        return new THREE.Vector3(
            Math.sin(this.heading),
            0,
            Math.cos(this.heading)
        );
    }


    getFrontAxlePosition() {
        const forward = this.getForwardVector();
        return new THREE.Vector3(
            this.position.x + forward.x * this.config.wheelbase / 2,
            this.position.y,
            this.position.z + forward.z * this.config.wheelbase / 2
        );
    }


    getRearAxlePosition() {
        const forward = this.getForwardVector();
        return new THREE.Vector3(
            this.position.x - forward.x * this.config.wheelbase / 2,
            this.position.y,
            this.position.z - forward.z * this.config.wheelbase / 2
        );
    }


    getInnerWheelAngle() {
        const cfg = this.config;
        if (Math.abs(this.steerAngle) < 0.001) return 0;

        const R = cfg.wheelbase / Math.tan(Math.abs(this.steerAngle));
        const innerR = R - cfg.trackWidth / 2;
        return Math.atan(cfg.wheelbase / innerR) * Math.sign(this.steerAngle);
    }


    getOuterWheelAngle() {
        const cfg = this.config;
        if (Math.abs(this.steerAngle) < 0.001) return 0;

        const R = cfg.wheelbase / Math.tan(Math.abs(this.steerAngle));
        const outerR = R + cfg.trackWidth / 2;
        return Math.atan(cfg.wheelbase / outerR) * Math.sign(this.steerAngle);
    }


    isTurning() {
        return Math.abs(this.steerAngle) > 0.02 && Math.abs(this.speed) > 0.1;
    }


    getTurnDirection() {
        if (this.steerAngle > 0.02) return 'left';
        if (this.steerAngle < -0.02) return 'right';
        return 'straight';
    }


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


    setPose(x, z, heading) {
        this.position.set(x, 0, z);
        this.heading = heading;
        this.steerAngle = 0;
        this.angularVelocity = 0;
        this.steerVelocity = 0;
    }


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



export function createSteeringDebugHelper(scene, steeringSystem) {
    const group = new THREE.Group();
    group.name = "steering-debug";
    scene.add(group);

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

    const arrowGeometry = new THREE.ConeGeometry(0.3, 1.5, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const headingArrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    group.add(headingArrow);

    function update() {
        const pos = steeringSystem.position;

        if (steeringSystem.turningRadius !== Infinity && steeringSystem.turningRadius < 100) {
            turningCircle.visible = true;
            const R = steeringSystem.turningRadius;
            turningCircle.scale.set(R, R, 1);

            const direction = Math.sign(steeringSystem.angularVelocity);
            const centerX = pos.x - Math.cos(steeringSystem.heading) * R * direction;
            const centerZ = pos.z + Math.sin(steeringSystem.heading) * R * direction;
            turningCircle.position.set(centerX, 0.1, centerZ);
        } else {
            turningCircle.visible = false;
        }

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
