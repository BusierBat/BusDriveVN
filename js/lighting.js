// js/lighting.js - DAY/NIGHT CYCLE & WEATHER SYSTEM
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
        this._tmpCol1 = new THREE.Color();
        this._tmpCol2 = new THREE.Color();
        this._tmpSky = new THREE.Color();
        this._tmpSunCol = new THREE.Color();
        this.isRaining = false;
        this.rainParticles = null;
        this._initLights();
        this._initRain();
        this._updateTimeOfDay();
        this._updateStreetLights();
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

    _initRain() {
        const rainGeo = new THREE.BufferGeometry();
        const rainCount = 3000;
        const positions = new Float32Array(rainCount * 3);
        for (let i = 0; i < rainCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 300;
            positions[i * 3 + 1] = Math.random() * 100;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 300;
        }
        rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const rainMat = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.2, transparent: true, opacity: 0.6 });
        this.rainParticles = new THREE.Points(rainGeo, rainMat);
        this.rainParticles.visible = false;
        this.scene.add(this.rainParticles);
    }

    _lerp(targetColor, c1, c2, t) {
        this._tmpCol1.setHex(c1);
        this._tmpCol2.setHex(c2);
        targetColor.copy(this._tmpCol1).lerp(this._tmpCol2, t);
    }

    update(deltaTime) {
        if (!deltaTime) return;
        this.gameTimeMinutes += deltaTime * this.timeScale;
        if (this.gameTimeMinutes >= 1440) this.gameTimeMinutes -= 1440;
        
        this._lightUpdateTimer += deltaTime;
        if (this._lightUpdateTimer < 0.5) return;
        this._lightUpdateTimer = 0;
        
        this._updateTimeOfDay();
        this._updateStreetLights();
        this._updateWeather(deltaTime);
    }

    _updateTimeOfDay() {
        const hours = this.gameTimeMinutes / 60;
        const angle = (hours / 24) * Math.PI * 2 - Math.PI / 2;
        this.lights.sun.position.set(Math.cos(angle) * 200, Math.sin(angle) * 200, 50);
        this.lights.moon.position.set(-Math.cos(angle) * 200, -Math.sin(angle) * 200, 50);
        
        let sunInt = 0, moonInt = 0, ambInt = 0.2;
        
        if (hours >= 5 && hours < 7) {
            const t = (hours - 5) / 2;
            this._lerp(this._tmpSky, 0x0a0a1a, 0xff7e5f, t);
            sunInt = t * 0.8; ambInt = 0.2 + t * 0.3;
            this._lerp(this._tmpSunCol, 0xff0000, 0xffccaa, t);
        } else if (hours >= 7 && hours < 17) {
            this._tmpSky.setHex(0x87CEEB);
            sunInt = 1.0; ambInt = 0.5;
            this._tmpSunCol.setHex(0xffffff);
        } else if (hours >= 17 && hours < 19) {
            const t = (hours - 17) / 2;
            this._lerp(this._tmpSky, 0xff7e5f, 0x0a0a1a, t);
            sunInt = 0.8 - t * 0.8; ambInt = 0.5 - t * 0.3;
            this._lerp(this._tmpSunCol, 0xffccaa, 0xff0000, t);
        } else {
            this._tmpSky.setHex(0x0a0a1a);
            sunInt = 0; moonInt = 0.3; ambInt = 0.2;
        }
        
        if (this.isRaining) {
            sunInt *= 0.3;
            ambInt *= 0.5;
            this._tmpSky.multiplyScalar(0.5);
        }

        this.scene.background.copy(this._tmpSky);
        this.scene.fog.color.copy(this._tmpSky);
        this.lights.sun.intensity = sunInt;
        this.lights.moon.intensity = moonInt;
        this.lights.ambient.intensity = ambInt;
        this.lights.sun.color.copy(this._tmpSunCol);
    }
    
    _updateStreetLights() {
        const hours = this.gameTimeMinutes / 60;
        const isNight = hours >= 18 || hours <= 5;
        
        this.scene.traverse(object => {
            if (object.isPointLight && object.userData.isStreetLight) {
                object.visible = isNight;
            }
        });
    }

    _updateWeather(dt) {
        if (Math.random() < 0.001) {
            this.isRaining = !this.isRaining;
        }
        
        if (this.isRaining) {
            this.rainParticles.visible = true;
            const positions = this.rainParticles.geometry.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 1] -= 40 * dt;
                if (positions[i + 1] < 0) {
                    positions[i + 1] = 100;
                    positions[i] = (Math.random() - 0.5) * 300;
                    positions[i + 2] = (Math.random() - 0.5) * 300;
                }
            }
            this.rainParticles.geometry.attributes.position.needsUpdate = true;
        } else {
            this.rainParticles.visible = false;
        }
    }
    
    getGameTime() { return this.gameTimeMinutes; }
    setGameTime(m) { 
        this.gameTimeMinutes = m % 1440; 
        this._updateTimeOfDay(); 
        this._updateStreetLights(); 
    }
}