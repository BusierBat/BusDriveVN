// js/camera.js - FIXED: Tăng smooth factor để camera không bị lùi khi xe tăng tốc
import * as THREE from "three";

const BED_Z_POSITIONS = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
const BED_Y_TIERS = [0.67, 1.67];
const BED_LENGTH = 1.7;
const BED_WIDTH = 0.7;
const X_OFFSET = 0.75;

export const PASSENGER_SEATS = [];
let seatId = 1;
for (let row = 0; row < BED_Z_POSITIONS.length; row++) {
    const bedZ = BED_Z_POSITIONS[row];
    for (let tier = 0; tier < BED_Y_TIERS.length; tier++) {
        const bedY = BED_Y_TIERS[tier];
        const camY = bedY + 0.4;
        const camZ = bedZ + 0.2;
        PASSENGER_SEATS.push({
            id: `Seat_${seatId}`,
            localPos: new THREE.Vector3(-X_OFFSET, camY, camZ),
            side: 'left',
            row: row + 1,
            tier: tier + 1,
            bedY: bedY,
            hasWall: true
        });
        seatId++;
        PASSENGER_SEATS.push({
            id: `Seat_${seatId}`,
            localPos: new THREE.Vector3(X_OFFSET, camY, camZ),
            side: 'right',
            row: row + 1,
            tier: tier + 1,
            bedY: bedY,
            hasWall: true
        });
        seatId++;
    }
}

export class CameraSystem {
    constructor(camera, busGroup) {
        this.camera = camera;
        this.busGroup = busGroup;

        this.settings = {
            cameraSensitivity: 0.005,
            mouseSensitivity: 0.005,
            invertX: false,
            invertY: false,
            fov: 70,
            outsideDistance: 12,
            outsideMinDistance: 5,
            outsideMaxDistance: 20
        };

        this.camera.fov = this.settings.fov;
        this.camera.updateProjectionMatrix();

        this.modes = [
            'driver',
            'copilot',
            'cabin',
            'outside',
            ...PASSENGER_SEATS.map((_, i) => `seat_${i}`)
        ];
        this.currentIndex = 0;

        this.isMouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;

        this.orbitYaw = Math.PI;
        this.orbitPitch = 0.2;
        this.orbitDistance = this.settings.outsideDistance;

        this.bedLookYaw = 0;
        this.bedLookPitch = 0;
        this.cabinYaw = 0;
        this.cabinPitch = 0;

        this.targetPos = new THREE.Vector3();
        this.targetLook = new THREE.Vector3();
        this.currentPos = new THREE.Vector3();
        this.currentLook = new THREE.Vector3();

        this.isPointerLocked = false;

        this._onMouseDown = (e) => {
            if (e.button === 0) {
                this.isMouseDown = true;
            }
        };
        this._onMouseUp = () => { this.isMouseDown = false; };
        this._onMouseMove = (e) => this.onMouseMove(e);
        this._onWheel = (e) => this.onWheel(e);

        document.addEventListener('mousedown', this._onMouseDown);
        document.addEventListener('mouseup', this._onMouseUp);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('wheel', this._onWheel);

        this.setMode(this.modes[0]);
    }

    onMouseMove(e) {
        if (!this.isMouseDown) return;
        const mode = this.modes[this.currentIndex];
        const moveX = Math.max(-100, Math.min(100, e.movementX || 0));
        const moveY = Math.max(-100, Math.min(100, e.movementY || 0));

        const baseSensX = this.settings.invertX ? -this.settings.cameraSensitivity : this.settings.cameraSensitivity;
        const baseSensY = this.settings.invertY ? -this.settings.cameraSensitivity : this.settings.cameraSensitivity;
        const clampedSensX = Math.max(-0.05, Math.min(0.05, baseSensX));
        const clampedSensY = Math.max(-0.05, Math.min(0.05, baseSensY));
        const sensX = clampedSensX * moveX;
        const sensY = clampedSensY * moveY;

        if (isNaN(sensX) || isNaN(sensY) || !isFinite(sensX) || !isFinite(sensY)) return;

        if (mode === 'outside') {
            this.orbitYaw -= sensX;
            this.orbitPitch += sensY;
            this.orbitPitch = Math.max(-Math.PI / 1.5, Math.min(Math.PI / 1.5, this.orbitPitch));
        } else if (mode.startsWith('seat_')) {
            this.bedLookYaw -= sensX;
            this.bedLookPitch += sensY;
            this.bedLookYaw = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, this.bedLookYaw));
            this.bedLookPitch = Math.max(-Math.PI / 1.5, Math.min(Math.PI / 1.5, this.bedLookPitch));
        } else {
            this.cabinYaw -= sensX;
            this.cabinPitch += sensY;
            this.cabinPitch = Math.max(-Math.PI / 1.5, Math.min(Math.PI / 1.5, this.cabinPitch));
        }
    }

    onWheel(e) {
        if (this.modes[this.currentIndex] !== 'outside') return;
        this.orbitDistance += e.deltaY * 0.01;
        this.orbitDistance = Math.max(this.settings.outsideMinDistance, Math.min(this.settings.outsideMaxDistance, this.orbitDistance));
    }

    setMode(mode) {
        this.mouseX = 0;
        this.mouseY = 0;
        this.bedLookYaw = 0;
        this.bedLookPitch = 0;
        this.cabinYaw = 0;
        this.cabinPitch = 0;

        if (mode === 'driver') {
            this.targetPos.set(0.65, 1.5, 4.5);
            this.targetLook.set(-0.35, 1.5, 10);
        } else if (mode === 'copilot') {
            this.targetPos.set(-0.35, 1.5, 4.5);
            this.targetLook.set(0.65, 1.5, 10);
        } else if (mode === 'cabin') {
            this.targetPos.set(0, 1.75, 4.0);
            this.targetLook.set(0, 1.75, 10);
        } else if (mode === 'outside') {
            this.orbitYaw = Math.PI;
            this.orbitPitch = 0.2;
            this.orbitDistance = this.settings.outsideDistance;
        } else if (mode.startsWith('seat_')) {
            const idx = parseInt(mode.split('_')[1]);
            const seat = PASSENGER_SEATS[idx % PASSENGER_SEATS.length];
            this.targetPos.copy(seat.localPos);
            const yaw = seat.side === 'left' ? 0.8 : -0.8;
            const pitch = -0.15;
            this.bedLookYaw = yaw;
            this.bedLookPitch = pitch;
        }
    }

    cycleNext() {
        this.currentIndex = (this.currentIndex + 1) % this.modes.length;
        this.setMode(this.modes[this.currentIndex]);
    }

    getCurrentModeName() {
        const mode = this.modes[this.currentIndex];
        if (mode === 'driver') return "Tài xế";
        if (mode === 'copilot') return "Ghế phụ";
        if (mode === 'cabin') return "Cabin";
        if (mode === 'outside') return "Ngoài xe";
        if (mode.startsWith('seat_')) {
            const idx = parseInt(mode.split('_')[1]);
            const seat = PASSENGER_SEATS[idx % PASSENGER_SEATS.length];
            return `Ghế ${seat.id} (Tầng ${seat.tier}, Hàng ${seat.row})`;
        }
        return mode;
    }

    update(deltaTime) {
        this.busGroup.updateMatrixWorld(true);
        const busWorldMatrix = this.busGroup.matrixWorld;
        const mode = this.modes[this.currentIndex];

        let worldTargetPos, worldTargetLook;

        if (mode === 'outside') {
            const x = this.orbitDistance * Math.cos(this.orbitPitch) * Math.sin(this.orbitYaw);
            const y = this.orbitDistance * Math.sin(this.orbitPitch);
            const z = this.orbitDistance * Math.cos(this.orbitPitch) * Math.cos(this.orbitYaw);

            const localTarget = new THREE.Vector3(0, 1.5, 0);
            const localCamPos = new THREE.Vector3(x, y + 1.5, z);

            worldTargetPos = localCamPos.clone().applyMatrix4(busWorldMatrix);
            worldTargetLook = localTarget.clone().applyMatrix4(busWorldMatrix);
        } else if (mode.startsWith('seat_')) {
            const lookDistance = 4.5;
            const localCamPos = this.targetPos.clone();
            const localLookAt = new THREE.Vector3(
                localCamPos.x + lookDistance * Math.cos(this.bedLookPitch) * Math.sin(this.bedLookYaw),
                localCamPos.y + lookDistance * Math.sin(this.bedLookPitch),
                localCamPos.z + lookDistance * Math.cos(this.bedLookPitch) * Math.cos(this.bedLookYaw)
            );
            worldTargetPos = localCamPos.clone().applyMatrix4(busWorldMatrix);
            worldTargetLook = localLookAt.clone().applyMatrix4(busWorldMatrix);
        } else {
            const lookDistance = 5;
            const localCamPos = this.targetPos.clone();
            const localLookAt = new THREE.Vector3(
                localCamPos.x + lookDistance * Math.cos(this.cabinPitch) * Math.sin(this.cabinYaw),
                localCamPos.y + lookDistance * Math.sin(this.cabinPitch),
                localCamPos.z + lookDistance * Math.cos(this.cabinPitch) * Math.cos(this.cabinYaw)
            );
            worldTargetPos = localCamPos.clone().applyMatrix4(busWorldMatrix);
            worldTargetLook = localLookAt.clone().applyMatrix4(busWorldMatrix);
        }

        // ===== FIX CAMERA LÙI: tăng smoothFactor từ 15 lên 30 =====
        const smoothFactor = Math.min(1, 30 * deltaTime); // trước là 15
        this.currentPos.lerp(worldTargetPos, smoothFactor);
        this.currentLook.lerp(worldTargetLook, smoothFactor);

        this.camera.position.copy(this.currentPos);
        this.camera.lookAt(this.currentLook);
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
        if (settings.fov !== undefined) {
            this.camera.fov = settings.fov;
            this.camera.updateProjectionMatrix();
        }
        if (settings.outsideDistance !== undefined) {
            this.orbitDistance = settings.outsideDistance;
        }
    }

    dispose() {
        document.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('mouseup', this._onMouseUp);
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('wheel', this._onWheel);
    }
}