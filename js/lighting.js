// js/lighting.js
// LightingSystem chính - tích hợp TimeSystem, ShadowSystem, AtmosphereSystem
import * as THREE from "three";
import { TimeSystem, getTimeOfDayLabel } from "./time_system.js";
import { ShadowSystem, SHADOW_QUALITY, ContactShadowShader } from "./shadows.js";
import { AtmosphereSystem, AtmosphericPostProcess } from "./atmosphere.js";
import { clamp, lerp } from "./utils.js";

export const LIGHTING_QUALITY_PRESETS = {
    LOW: {
        shadows: "LOW",
        atmosphere: "LOW",
        godRays: false,
        contactShadows: false,
        atmosphericPostProcess: false,
        skyResolution: 32,
        starCount: 500,
    },
    MEDIUM: {
        shadows: "MEDIUM",
        atmosphere: "MEDIUM",
        godRays: true,
        contactShadows: true,
        atmosphericPostProcess: false,
        skyResolution: 64,
        starCount: 2000,
    },
    HIGH: {
        shadows: "HIGH",
        atmosphere: "HIGH",
        godRays: true,
        contactShadows: true,
        atmosphericPostProcess: true,
        skyResolution: 128,
        starCount: 4000,
    },
};

export class LightingSystem {
    constructor(renderer, scene, camera, options = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // Quality settings
        this.quality = options.quality || "MEDIUM";
        this.preset = LIGHTING_QUALITY_PRESETS[this.quality];

        // Subsystems
        this.timeSystem = null;
        this.shadowSystem = null;
        this.atmosphereSystem = null;

        // Game time (synced with TimeSystem)
        this.gameTimeMinutes = options.initialMinutes ?? 360;
        this.timeScale = options.timeScale ?? 1.0;

        // Light references (for backward compatibility)
        this.lights = {
            ambient: null,
            sun: null,
            moon: null,
            hemisphere: null,
        };

        // Bus headlight system
        this.headlightEnabled = false;
        this.headlightLeft = null;
        this.headlightRight = null;
        this.headlightTargetLeft = null;
        this.headlightTargetRight = null;
        this.taillightGlow = null;

        // Debug
        this.debug = {
            enabled: false,
            showSunDirection: false,
            showMoonDirection: false,
            showShadowCascades: false,
            showLightHelpers: false,
            showFPS: false,
        };

        // Stats
        this._frameCount = 0;
        this._lastFpsTime = performance.now();
        this._currentFPS = 60;

        // Temp
        this._tmpVec3 = new THREE.Vector3();

        this._init();
    }

    _init() {
        // 1. Time System (core)
        this.timeSystem = new TimeSystem({
            initialMinutes: this.gameTimeMinutes,
            timeScale: this.timeScale,
        });

        // 2. Shadow System
        this.shadowSystem = new ShadowSystem(this.renderer, this.scene, {
            quality: this.preset.shadows,
        });

        // 3. Atmosphere System
        this.atmosphereSystem = new AtmosphereSystem(this.renderer, this.scene, this.camera, {
            quality: this.preset.atmosphere,
        });
        this.atmosphereSystem.setTimeSystem(this.timeSystem);

        // 4. Backward-compatible lights (Ambient, Hemisphere)
        this._initCompatLights();

        // 5. Headlights
        this._initHeadlights();

        // 6. Apply initial state
        this.timeSystem.updateTimeOfDay();
        this._syncLightsFromTimeSystem();

        // Enable renderer shadows
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = false; // We control it
    }

    _initCompatLights() {
        // Ambient light (base fill)
        this.lights.ambient = new THREE.AmbientLight(0xFFFFFF, 0.5);
        this.scene.add(this.lights.ambient);

        // Hemisphere light (sky/ground bounce)
        this.lights.hemisphere = new THREE.HemisphereLight(0x87CEEB, 0x362D1B, 0.5);
        this.scene.add(this.lights.hemisphere);

        // Sun/Moon directional lights are managed by ShadowSystem
        this.lights.sun = this.shadowSystem.sunLight;
        this.lights.moon = this.shadowSystem.moonLight;
    }

    _initHeadlights() {
        // Left headlight
        this.headlightLeft = new THREE.SpotLight(0xFFF3CF, 0, 120, Math.PI / 5, 0.3, 1.0);
        this.headlightLeft.position.set(-0.78, 1.05, 0);
        this.headlightTargetLeft = new THREE.Object3D();
        this.headlightTargetLeft.position.set(-0.78, 0, 25);
        this.headlightLeft.target = this.headlightTargetLeft;
        this.headlightLeft.castShadow = false; // Performance: no shadow from headlights
        this.scene.add(this.headlightLeft);
        this.scene.add(this.headlightTargetLeft);

        // Right headlight
        this.headlightRight = new THREE.SpotLight(0xFFF3CF, 0, 120, Math.PI / 5, 0.3, 1.0);
        this.headlightRight.position.set(0.78, 1.05, 0);
        this.headlightTargetRight = new THREE.Object3D();
        this.headlightTargetRight.position.set(0.78, 0, 25);
        this.headlightRight.target = this.headlightTargetRight;
        this.headlightRight.castShadow = false;
        this.scene.add(this.headlightRight);
        this.scene.add(this.headlightTargetRight);

        // Taillight glow
        this.taillightGlow = new THREE.PointLight(0xFF2020, 0, 7, 1.8);
        this.taillightGlow.position.set(0, 1.1, 0);
        this.scene.add(this.taillightGlow);
    }

    // ===== MAIN UPDATE =====
    update(deltaTime, busGroup = null) {
        if (!deltaTime) return;

        // Sync timeScale from TravelClock (main.js sets lighting.timeScale directly)
        this.timeSystem.timeScale = this.timeScale;

        // Update FPS counter
        this._updateFPS();

        // 1. Update time
        this.timeSystem.update(deltaTime);
        this.gameTimeMinutes = this.timeSystem.gameTimeMinutes;

        // 2. Update atmosphere (sky, fog, celestial bodies)
        this.atmosphereSystem.update(deltaTime);

        // 3. Sync sun/moon to shadow system
        this._syncLightsFromTimeSystem();

        // 4. Update shadow cascades (if player moving)
        if (busGroup) {
            this.shadowSystem.setPlayerPosition(
                busGroup.position,
                this._getForwardVector(busGroup),
                this.camera
            );
        }
        this.shadowSystem.updateSunDirection(
            this.timeSystem.getSunDirection(),
            this.timeSystem.getSunIntensity()
        );
        this.shadowSystem.updateMoonDirection(
            this.timeSystem.getMoonDirection(),
            this.timeSystem.getMoonIntensity()
        );

        // 5. Update headlights position if bus exists
        if (busGroup) {
            this._updateHeadlights(busGroup);
        }

        // 6. Update compat lights
        this._updateCompatLights();

        // 7. Render shadow maps (call this in main loop BEFORE scene render)
        // this.renderShadows(); // Called separately from main.js
    }

    _updateFPS() {
        this._frameCount++;
        const now = performance.now();
        if (now - this._lastFpsTime >= 1000) {
            this._currentFPS = Math.round(this._frameCount * 1000 / (now - this._lastFpsTime));
            this._frameCount = 0;
            this._lastFpsTime = now;
        }
    }

    getFPS() { return this._currentFPS; }

    _syncLightsFromTimeSystem() {
        const time = this.timeSystem;

        // Sun light (managed by shadow system)
        if (this.shadowSystem.sunLight) {
            this.shadowSystem.sunLight.color.copy(time.getSunColor());
            this.shadowSystem.sunLight.intensity = time.getSunIntensity();
        }

        // Moon light
        if (this.shadowSystem.moonLight) {
            this.shadowSystem.moonLight.color.copy(time.getMoonColor());
            this.shadowSystem.moonLight.intensity = time.getMoonIntensity();
        }
    }

    _updateCompatLights() {
        const time = this.timeSystem;
        const sunInt = time.getSunIntensity();
        const moonInt = time.getMoonIntensity();
        const ambInt = time.getAmbientIntensity();

        // Ambient
        if (this.lights.ambient) {
            this.lights.ambient.intensity = ambInt;
            this.lights.ambient.color.copy(time.getSkyColor()).multiplyScalar(0.5 + 0.5 * sunInt);
        }

        // Hemisphere
        if (this.lights.hemisphere) {
            this.lights.hemisphere.intensity = ambInt * 0.8;
            this.lights.hemisphere.color.copy(time.getSkyColor());
            this.lights.hemisphere.groundColor.copy(time.getFogColor()).multiplyScalar(0.5);
        }

        // Scene background & fog (handled by AtmosphereSystem, but keep sync)
        this.scene.background.copy(time.getSkyColor());
        if (this.scene.fog) {
            this.scene.fog.color.copy(time.getFogColor());
            this.scene.fog.near = time.getFogNear();
            this.scene.fog.far = time.getFogFar();
        }

        // Renderer tone mapping exposure
        this.renderer.toneMappingExposure = time.getExposure();
    }

    _getForwardVector(object) {
        this._tmpVec3.set(0, 0, 1).applyQuaternion(object.quaternion);
        return this._tmpVec3;
    }

    _updateHeadlights(busGroup) {
        if (!this.headlightLeft || !this.headlightRight) return;

        // Update headlight positions to follow bus
        const busPos = busGroup.position;
        const busQuat = busGroup.quaternion;

        // Left headlight
        this._tmpVec3.set(-0.78, 1.05, 0).applyQuaternion(busQuat).add(busPos);
        this.headlightLeft.position.copy(this._tmpVec3);

        this._tmpVec3.set(-0.78, 0, 25).applyQuaternion(busQuat).add(busPos);
        this.headlightTargetLeft.position.copy(this._tmpVec3);

        // Right headlight
        this._tmpVec3.set(0.78, 1.05, 0).applyQuaternion(busQuat).add(busPos);
        this.headlightRight.position.copy(this._tmpVec3);

        this._tmpVec3.set(0.78, 0, 25).applyQuaternion(busQuat).add(busPos);
        this.headlightTargetRight.position.copy(this._tmpVec3);

        // Taillight
        this._tmpVec3.set(0, 1.1, -12).applyQuaternion(busQuat).add(busPos);
        this.taillightGlow.position.copy(this._tmpVec3);
    }

    // ===== SHADOW RENDERING =====
    // Gọi từ main.js TRƯỚC renderer.render(scene, camera)
    renderShadows() {
        if (this.shadowSystem) {
            this.shadowSystem.renderShadows();
            // Moon shadow at night
            if (this.timeSystem.getSunIntensity() < 0.1) {
                this.shadowSystem.renderMoonShadow();
            }
        }
    }

    // ===== HEADLIGHT CONTROL =====
    setHeadlights(on) {
        this.headlightEnabled = on;
        const intensity = on ? 250 : 0;
        if (this.headlightLeft) this.headlightLeft.intensity = intensity;
        if (this.headlightRight) this.headlightRight.intensity = on ? 150 : 0;
        if (this.taillightGlow) this.taillightGlow.intensity = on ? 6 : 0;
    }

    setTaillights(on) {
        if (this.taillightGlow) this.taillightGlow.intensity = on ? 6 : 0;
    }

    // ===== TIME API (backward compatible) =====
    getGameTime() { return this.gameTimeMinutes; }

    setGameTime(minutes) {
        this.timeSystem.setGameTime(minutes);
        this.gameTimeMinutes = this.timeSystem.gameTimeMinutes;
    }

    addGameMinutes(minutes) {
        this.timeSystem.addGameMinutes(minutes);
        this.gameTimeMinutes = this.timeSystem.gameTimeMinutes;
    }

    getTimeScale() { return this.timeScale; }
    setTimeScale(scale) {
        this.timeScale = scale;
        this.timeSystem.timeScale = scale;
    }

    getTimeString() { return this.timeSystem.getTimeString(); }
    getTimeOfDayLabel() { return getTimeOfDayLabel(this.timeSystem); }

    // ===== QUALITY SETTINGS =====
    setQuality(quality) {
        if (!LIGHTING_QUALITY_PRESETS[quality]) return;
        this.quality = quality;
        this.preset = LIGHTING_QUALITY_PRESETS[quality];

        // Update subsystems
        this.shadowSystem.setQuality(this.preset.shadows);
        this.atmosphereSystem.setQuality(this.preset.atmosphere);
        this.atmosphereSystem.toggleGodRays(this.preset.godRays);

        // Recreate headlights with shadow setting
        // (Headlights don't cast shadows in any preset for performance)
    }

    getQuality() { return this.quality; }

    // ===== DEBUG =====
    setDebug(options) {
        Object.assign(this.debug, options);

        if (this.debug.showShadowCascades) {
            this.shadowSystem.toggleDebug(true);
        } else {
            this.shadowSystem.toggleDebug(false);
        }

        if (this.debug.showLightHelpers) {
            this._createLightHelpers();
        } else {
            this._removeLightHelpers();
        }
    }

    _createLightHelpers() {
        if (this._lightHelpers) return;
        this._lightHelpers = [];
        if (this.lights.sun) {
            const h = new THREE.DirectionalLightHelper(this.lights.sun, 100);
            this.scene.add(h);
            this._lightHelpers.push(h);
        }
        if (this.lights.hemisphere) {
            const h = new THREE.HemisphereLightHelper(this.lights.hemisphere, 100);
            this.scene.add(h);
            this._lightHelpers.push(h);
        }
    }

    _removeLightHelpers() {
        if (!this._lightHelpers) return;
        for (const h of this._lightHelpers) {
            this.scene.remove(h);
            h.dispose();
        }
        this._lightHelpers = null;
    }

    // ===== CONTACT SHADOWS (for bus, nearby objects) =====
    // Returns config for contact shadow pass
    getContactShadowConfig() {
        return this.shadowSystem.getContactShadowConfig();
    }

    // ===== WEATHER =====
    setWeather(weather) {
        this.atmosphereSystem.setWeather(weather);
    }

    getWeather() { return this.atmosphereSystem.getWeather(); }

    // ===== CLEANUP =====
    dispose() {
        if (this.shadowSystem) this.shadowSystem.dispose();
        if (this.atmosphereSystem) this.atmosphereSystem.dispose();
        if (this.timeSystem) this.timeSystem = null;

        // Remove compat lights
        for (const key in this.lights) {
            if (this.lights[key] && this.lights[key].parent) {
                this.scene.remove(this.lights[key]);
            }
        }

        // Remove headlights
        if (this.headlightLeft) this.scene.remove(this.headlightLeft);
        if (this.headlightRight) this.scene.remove(this.headlightRight);
        if (this.headlightTargetLeft) this.scene.remove(this.headlightTargetLeft);
        if (this.headlightTargetRight) this.scene.remove(this.headlightTargetRight);
        if (this.taillightGlow) this.scene.remove(this.taillightGlow);

        this._removeLightHelpers();
    }
}

// Factory function for easy creation
export function createLightingSystem(renderer, scene, camera, options = {}) {
    return new LightingSystem(renderer, scene, camera, options);
}