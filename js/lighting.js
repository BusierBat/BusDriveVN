// js/lighting.js - FULL FEATURES & SMOOTH TIME (OPTIMIZED)
import * as THREE from "three";
export class LightingSystem {
    constructor(sceneOrOptions = new THREE.Scene()) {
        const options = sceneOrOptions && typeof sceneOrOptions === 'object' && !('isScene' in sceneOrOptions) && !('type' in sceneOrOptions)
            ? sceneOrOptions
            : { scene: sceneOrOptions };
        const scene = options.scene || options;
        if (!scene || typeof scene.add !== 'function') {
            this.scene = new THREE.Scene();
        } else {
            this.scene = scene;
        }
        this.gameTimeMinutes = options.initialMinutes ?? 360;
        this.timeScale = options.timeScale ?? 1;
        this.lights = {};
        this._lightUpdateTimer = 0;
        // CACHE COLORS TO AVOID GC ALLOCATION
        this._tmpCol1 = new THREE.Color();
        this._tmpCol2 = new THREE.Color();
        this._tmpSky = new THREE.Color(0x87CEEB);
        this._initLights();
        this._updateTimeOfDay();
    }
    _initLights() {
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 200, 4000);
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(this.lights.ambient);
        this.lights.sun = new THREE.DirectionalLight(0xffffff, 1.0);
        this.scene.add(this.lights.sun);
        this.lights.moon = new THREE.DirectionalLight(0x6699cc, 0.2);
        this.scene.add(this.lights.moon);
        this.lights.hemisphere = new THREE.HemisphereLight(0x87CEEB, 0x362d1b, 0.5);
        this.scene.add(this.lights.hemisphere);
    }
    // HÀM LERP TỐI ƯU: DÙNG OBJECT CACHED, KHÔNG TẠO NEW
    _lerpColor(c1, c2, t) {
        this._tmpCol1.setHex(c1);
        this._tmpCol2.setHex(c2);
        return this._tmpCol1.lerp(this._tmpCol2, t);
    }
    update(deltaTime) {
        if (!deltaTime) return;
        this.gameTimeMinutes += deltaTime * this.timeScale;
        if (this.gameTimeMinutes >= 1440) this.gameTimeMinutes -= 1440;
        
        // THROTTLE: Chỉ update ánh sáng 2 lần/giây (2Hz) thay vì 60Hz
        this._lightUpdateTimer += deltaTime;
        if (this._lightUpdateTimer < 0.5) return;
        this._lightUpdateTimer = 0;
        
        this._updateTimeOfDay();
    }
    _updateTimeOfDay() {
        const hours = this.gameTimeMinutes / 60;
        const angle = (hours / 24) * Math.PI * 2 - Math.PI / 2;
        this.lights.sun.position.set(Math.cos(angle) * 200, Math.sin(angle) * 200, 50);
        this.lights.moon.position.set(-Math.cos(angle) * 200, -Math.sin(angle) * 200, 50);
        
        let skyColor = this._tmpSky.setHex(0x87CEEB);
        let sunInt = 0, moonInt = 0, ambInt = 0.2;
        let sunCol = this._tmpCol1.setHex(0xffffff);
        
        if (hours >= 5 && hours < 7) {
            const t = (hours - 5) / 2;
            skyColor = this._lerpColor(0x0a0a1a, 0xff7e5f, t);
            sunInt = t * 0.8; ambInt = 0.2 + t * 0.3;
            sunCol = this._lerpColor(0xff0000, 0xffccaa, t);
        } else if (hours >= 7 && hours < 17) {
            skyColor = this._tmpSky.setHex(0x87CEEB);
            sunInt = 1.0; ambInt = 0.5;
        } else if (hours >= 17 && hours < 19) {
            const t = (hours - 17) / 2;
            skyColor = this._lerpColor(0xff7e5f, 0x0a0a1a, t);
            sunInt = 0.8 - t * 0.8; ambInt = 0.5 - t * 0.3;
            sunCol = this._lerpColor(0xffccaa, 0xff0000, t);
        } else {
            skyColor = this._tmpSky.setHex(0x0a0a1a);
            sunInt = 0; moonInt = 0.3; ambInt = 0.2;
        }
        
        this.scene.background.copy(skyColor);
        this.scene.fog.color.copy(skyColor);
        this.lights.sun.intensity = sunInt;
        this.lights.moon.intensity = moonInt;
        this.lights.ambient.intensity = ambInt;
        this.lights.sun.color.copy(sunCol);
    }
    getGameTime() { return this.gameTimeMinutes; }
    setGameTime(m) { this.gameTimeMinutes = m % 1440; this._updateTimeOfDay(); }
}