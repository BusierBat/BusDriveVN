// js/lighting.js - FULL FEATURES & SMOOTH TIME
import * as THREE from "three";

export class LightingSystem {
    constructor(scene) {
        if (!scene) scene = new THREE.Scene();
        this.scene = scene;
        this.gameTimeMinutes = 360; // Bắt đầu lúc 6:00 sáng
        this.timeScale = 1; // 1 giây thực = 1 phút game (1 ngày game = 24 phút thực). Có thể chỉnh thành 0.5 nếu muốn chậm hơn.
        
        this.lights = {};
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
    
    // Hàm nội suy màu sắc mượt mà (Không nhảy số đột ngột)
    _lerpColor(c1, c2, t) {
        const col1 = new THREE.Color(c1);
        const col2 = new THREE.Color(c2);
        return col1.lerp(col2, t);
    }
    
    update(deltaTime) {
        if (!deltaTime) return;
        // Game time dựa trên deltaTime, hoàn toàn độc lập với FPS
        this.gameTimeMinutes += deltaTime * this.timeScale;
        if (this.gameTimeMinutes >= 1440) this.gameTimeMinutes -= 1440;
        this._updateTimeOfDay();
    }
    
    _updateTimeOfDay() {
        const hours = this.gameTimeMinutes / 60;
        const angle = (hours / 24) * Math.PI * 2 - Math.PI / 2;
        
        // Mặt trời và mặt trăng di chuyển liên tục trên quỹ đạo
        this.lights.sun.position.set(Math.cos(angle) * 200, Math.sin(angle) * 200, 50);
        this.lights.moon.position.set(-Math.cos(angle) * 200, -Math.sin(angle) * 200, 50);
        
        let skyColor = new THREE.Color(0x87CEEB);
        let sunInt = 0, moonInt = 0, ambInt = 0.2;
        let sunCol = new THREE.Color(0xffffff);
        
        // Các giai đoạn chuyển tiếp mượt mà
        if (hours >= 5 && hours < 7) { // Bình minh
            const t = (hours - 5) / 2;
            skyColor = this._lerpColor(0x0a0a1a, 0xff7e5f, t);
            sunInt = t * 0.8; ambInt = 0.2 + t * 0.3;
            sunCol = this._lerpColor(0xff0000, 0xffccaa, t);
        } else if (hours >= 7 && hours < 17) { // Ban ngày
            skyColor = new THREE.Color(0x87CEEB);
            sunInt = 1.0; ambInt = 0.5;
        } else if (hours >= 17 && hours < 19) { // Hoàng hôn
            const t = (hours - 17) / 2;
            skyColor = this._lerpColor(0xff7e5f, 0x0a0a1a, t);
            sunInt = 0.8 - t * 0.8; ambInt = 0.5 - t * 0.3;
            sunCol = this._lerpColor(0xffccaa, 0xff0000, t);
        } else { // Ban đêm
            skyColor = new THREE.Color(0x0a0a1a);
            sunInt = 0; moonInt = 0.3; ambInt = 0.2;
        }
        
        this.scene.background = skyColor;
        this.scene.fog.color = skyColor;
        this.lights.sun.intensity = sunInt;
        this.lights.moon.intensity = moonInt;
        this.lights.ambient.intensity = ambInt;
        this.lights.sun.color = sunCol;
    }
    
    getGameTime() { return this.gameTimeMinutes; }
    setGameTime(m) { this.gameTimeMinutes = m % 1440; this._updateTimeOfDay(); }
    setRayTracingEnabled(e) { /* mock cho settings */ }
}