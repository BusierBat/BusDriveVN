// js/lighting.js - FIXED VERSION
import * as THREE from "three";

export class LightingSystem {
    constructor(scene) {
        // ✅ NULL CHECK - Tránh crash nếu scene undefined
        if (!scene) {
            console.warn("⚠️ LightingSystem: scene is undefined, creating empty scene");
            scene = new THREE.Scene();
        }
        
        this.scene = scene;
        this.quality = "medium";
        this.lights = {};
        
        this._initLights();
    }
    
    _initLights() {
        // Ambient light
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.lights.ambient);
        
        // Directional light (sun)
        this.lights.sun = new THREE.DirectionalLight(0xffffff, 1.0);
        this.lights.sun.position.set(100, 200, 100);
        this.lights.sun.castShadow = false;
        this.scene.add(this.lights.sun);
        
        // Hemisphere light
        this.lights.hemisphere = new THREE.HemisphereLight(
            0x87CEEB, // sky color
            0x362d1b, // ground color
            0.5
        );
        this.scene.add(this.lights.hemisphere);
    }
    
    setQuality(quality) {
        this.quality = quality;
        
        switch (quality) {
            case "low":
                this.lights.sun.intensity = 0.8;
                this.lights.ambient.intensity = 0.7;
                this.lights.sun.castShadow = false;
                break;
            case "medium":
                this.lights.sun.intensity = 1.0;
                this.lights.ambient.intensity = 0.6;
                break;
            case "high":
                this.lights.sun.intensity = 1.2;
                this.lights.ambient.intensity = 0.5;
                this.lights.sun.castShadow = true;
                this.lights.sun.shadow.mapSize.width = 2048;
                this.lights.sun.shadow.mapSize.height = 2048;
                break;
        }
    }
    
    update(deltaTime, elapsedTime) {
        // Optional: day/night cycle
        // const angle = elapsedTime * 0.01;
        // this.lights.sun.position.set(
        //     Math.cos(angle) * 100,
        //     Math.sin(angle) * 100 + 50,
        //     Math.sin(angle) * 100
        // );
    }
    
    setTimeOfDay(hours) {
        // 0-24
        const normalizedTime = (hours / 24) * Math.PI * 2;
        const sunHeight = Math.sin(normalizedTime);
        
        if (sunHeight > 0) {
            // Day
            this.lights.sun.intensity = 0.5 + sunHeight * 0.7;
            this.lights.sun.position.set(
                Math.cos(normalizedTime) * 100,
                sunHeight * 150 + 20,
                Math.sin(normalizedTime) * 100
            );
        } else {
            // Night
            this.lights.sun.intensity = 0.1;
        }
    }
    
    dispose() {
        for (const key in this.lights) {
            if (this.lights[key] && this.scene) {
                this.scene.remove(this.lights[key]);
            }
        }
        this.lights = {};
    }
}