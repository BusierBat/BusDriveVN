// js/lighting.js - CHU KỲ NGÀY ĐÊM ĐẦY ĐỦ (BÌNH MINH, NGÀY, HOÀNG HÔN, ĐÊM)
import * as THREE from "three";

export class LightingSystem {
    constructor({ scene, timeScale = 1440 / 3600, initialMinutes = 390 }) {
        this.scene = scene;
        this.timeScale = timeScale;
        this.gameMinutes = initialMinutes;

        // Ánh sáng
        this.hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x3a4a3a, 0.8);
        this.sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
        this.sun.position.set(500, 800, 300);
        this.sun.target.position.set(0, 0, 0);
        this.ambient = new THREE.AmbientLight(0xffffff, 0.5);

        this.scene.add(this.hemisphere, this.sun, this.sun.target, this.ambient);

        // Fog
        this.fog = new THREE.Fog(0x87ceeb, 100, 2000);
        this.scene.fog = this.fog;
        this.scene.background = new THREE.Color(0x87ceeb);

        this.stars = this._createStars();
        this.scene.add(this.stars);
        this.streetLightMaterials = [];

        // Ray tracing (mặc định OFF)
        this.rayTracingEnabled = false;
        this.reflectionCube = null;

        // Đặt thời gian ban đầu là 06:30 (sáng)
        this.setGameTime(390);
    }

    _createStars() {
        const count = 3000;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 1000 + Math.random() * 500;
            pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
            pos[i * 3 + 1] = Math.abs(Math.sin(phi) * Math.sin(theta) * r) * 0.5 + 100;
            pos[i * 3 + 2] = Math.cos(phi) * r;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        return new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xffffff, size: 1.5, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
    }

    update(dt) {
        // Chạy thời gian
        this.gameMinutes += dt * this.timeScale;
        if (this.gameMinutes >= 1440) this.gameMinutes -= 1440;

        const hour = this.gameMinutes / 60;

        // === TÍNH TOÁN CÁC GIÁ TRỊ ÁNH SÁNG ===
        let sunIntensity, ambientIntensity, hemisphereIntensity;
        let skyColor = new THREE.Color();
        let starOpacity = 0;
        let streetLightIntensity = 0;

        // Pha 1: Bình minh (5:00 - 6:30)
        if (hour >= 5 && hour < 6.5) {
            const p = (hour - 5) / 1.5; // 0->1
            sunIntensity = 0.1 + p * 1.1;
            ambientIntensity = 0.15 + p * 0.35;
            hemisphereIntensity = 0.2 + p * 0.6;
            skyColor.set(0x0a0f22).lerp(new THREE.Color(0x87ceeb), p);
            starOpacity = 1.0 - p;
            streetLightIntensity = 1.0 - p;
        }
        // Pha 2: Ban ngày (6:30 - 17:00)
        else if (hour >= 6.5 && hour < 17) {
            sunIntensity = 1.2;
            ambientIntensity = 0.5;
            hemisphereIntensity = 0.8;
            skyColor.set(0x87ceeb);
            starOpacity = 0;
            streetLightIntensity = 0;
        }
        // Pha 3: Hoàng hôn (17:00 - 19:00)
        else if (hour >= 17 && hour < 19) {
            const p = (hour - 17) / 2; // 0->1
            sunIntensity = 1.2 - p * 1.0;
            ambientIntensity = 0.5 - p * 0.3;
            hemisphereIntensity = 0.8 - p * 0.5;
            skyColor.set(0x87ceeb).lerp(new THREE.Color(0xff6633), p);
            starOpacity = p * 0.3;
            streetLightIntensity = p * 0.5;
        }
        // Pha 4: Ban đêm (19:00 - 5:00)
        else {
            sunIntensity = 0.1;
            ambientIntensity = 0.15;
            hemisphereIntensity = 0.2;
            skyColor.set(0x0a0f22);
            starOpacity = 1.0;
            streetLightIntensity = 1.0;
        }

        // Áp dụng
        this.sun.intensity = sunIntensity;
        this.ambient.intensity = ambientIntensity;
        this.hemisphere.intensity = hemisphereIntensity;
        this.scene.background = skyColor;
        this.fog.color = skyColor;
        this.stars.material.opacity = starOpacity;

        // Vị trí mặt trời
        const sunAngle = ((hour - 6) / 12) * Math.PI;
        this.sun.position.set(
            Math.cos(sunAngle) * 600,
            Math.max(50, Math.sin(sunAngle) * 800),
            300
        );

        // Đèn đường
        for (const mat of this.streetLightMaterials) {
            if (mat.emissiveIntensity !== undefined) {
                mat.emissiveIntensity = streetLightIntensity * 2.0;
            }
        }
    }

    // Ray Tracing (tùy chọn)
    setRayTracingEnabled(enabled) {
        this.rayTracingEnabled = enabled;
        if (enabled) {
            this.sun.intensity = 1.5;
            this.ambient.intensity = 0.3;
            // Tạo reflection mapping (giả)
            if (!this.reflectionCube) {
                // Dùng canvas texture để giả lập
                const canvas = document.createElement('canvas');
                canvas.width = 256; canvas.height = 256;
                const ctx = canvas.getContext('2d');
                const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
                gradient.addColorStop(0, 'rgba(200, 220, 255, 1)');
                gradient.addColorStop(0.5, 'rgba(100, 150, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(50, 80, 150, 0.5)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, 256, 256);
                const texture = new THREE.CanvasTexture(canvas);
                this.reflectionCube = texture;
            }
        } else {
            this.sun.intensity = 1.2;
            this.ambient.intensity = 0.5;
        }
    }

    registerStreetLightMaterial(mat) {
        if (mat && !this.streetLightMaterials.includes(mat)) {
            this.streetLightMaterials.push(mat);
        }
    }

    getGameTime() { return this.gameMinutes; }
    setGameTime(m) {
        this.gameMinutes = ((m % 1440) + 1440) % 1440;
    }
    getTimeScale() { return this.timeScale; }
    setTimeScale(s) { this.timeScale = s; }
}