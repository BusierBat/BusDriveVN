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

// ===== DEN DUONG (STREET LIGHT POOL) =====
// Mo phong den duong boi mot POOL PointLight CO DINH, khong phai moi cot mot den.
// Luc nay trong the gioi co 341 cot den (188 mesh, phan lon instanced) — neu moi cot
// mot PointLight thi Three.js se dua vao numPointLights -> shader cua MOI
// Material trong ca scene phai loop 341 lan -> Pentium N5000 se chet.
// Thay vao do: N den co dinh, moi khoang 0.2s duoc "gan" vi tri cua N cot den
// GAN NGUOI CHOI nhat. Nguoi choi di chuyen -> pool di theo -> den duong sang
// liet ke cac cot, va sang yeu dan theo khoang cach (decay + distance).
const STREET_LIGHT_POOL = 6;             // so den trong pool (gioi han cho may yeu)
const STREET_LIGHT_RANGE = 42;           // met — vung anh sang toi da, ngoai do = toi
const STREET_LIGHT_DECAY = 2;            // giam dan tuyen tuy (physical) -> anh sang
                                         // GIAM DAN theo khoang cach, khong chieu vo han
const STREET_LIGHT_INTENSITY = 380;      // candela tai ban dem (dieu chinh sau do test)
const STREET_LIGHT_AWAKEN_RADIUS = 180;  // met — cot nao gan hon moi duoc "day len"
const STREET_LIGHT_REFRESH = 0.2;        // giay — tan suat chon lai cot gan nhat

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

        // Shadow update throttling
        this._shadowFrameCounter = 0;
        this._shadowUpdateInterval = 1; // 1 = every frame, 2 = every other frame
        this._lastShadowPlayerPos = new THREE.Vector3();
        this._shadowPosThreshold = 5; // meters - update shadows if player moved this much

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

        // 5b. Den duong (street lights pool) — tao TRUOC khi render frame dau tien
        // de numPointLights co dinh tu dau, khong gay recompile shader.
        this._initStreetLights();

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
        // Left headlight - increased distance to 400m, tighter angle for better range
        this.headlightLeft = new THREE.SpotLight(0xFFF3CF, 0, 400, Math.PI / 5, 0.05, 1.0);
        this.headlightLeft.position.set(-0.78, 1.05, 0);
        this.headlightTargetLeft = new THREE.Object3D();
        this.headlightTargetLeft.position.set(-0.78, 0, 100);
        this.headlightLeft.target = this.headlightTargetLeft;
        this.headlightLeft.castShadow = false; // Performance: no shadow from headlights
        this.scene.add(this.headlightLeft);
        this.scene.add(this.headlightTargetLeft);

        // Right headlight
        this.headlightRight = new THREE.SpotLight(0xFFF3CF, 0, 400, Math.PI / 5, 0.05, 1.0);
        this.headlightRight.position.set(0.78, 1.05, 0);
        this.headlightTargetRight = new THREE.Object3D();
        this.headlightTargetRight.position.set(0.78, 0, 100);
        this.headlightRight.target = this.headlightTargetRight;
        this.headlightRight.castShadow = false;
        this.scene.add(this.headlightRight);
        this.scene.add(this.headlightTargetRight);

        // Taillight glow
        this.taillightGlow = new THREE.PointLight(0xFF2020, 0, 20, 2.5);
        this.taillightGlow.position.set(0, 1.1, 0);
        this.scene.add(this.taillightGlow);
    }

    _initStreetLights() {
        this.streetLamps = null;          // [{x,y,z}] — duoc nap boi setStreetLamps()
        this.streetLights = [];
        this._streetLampTimer = STREET_LIGHT_REFRESH;   // buoc chon cot ngay lan dau
        this._streetNightFactor = 0;
        for (let i = 0; i < STREET_LIGHT_POOL; i++) {
            const pl = new THREE.PointLight(0xFFD9A0, 0, STREET_LIGHT_RANGE, STREET_LIGHT_DECAY);
            pl.castShadow = false;        // hieu nang: den duong khong doi chieu
            // LUON giu visible = true, chi doi `intensity`. Doi `.visible` cua mot
            // PointLight se doi `numPointLights` trong program cache key cua
            // Three.js -> lights.state.version tang -> needsProgramChange = true
            // cho TOAN BO MeshStandardMaterial -> gl.linkProgram() dong bo ngay frame
            // do -> game dot (chinh la loi F/L dang bam da sua truoc do).
            pl.visible = true;
            pl.userData.lampIdx = -1;
            this.scene.add(pl);
            this.streetLights.push(pl);
        }
    }

    // Nhap danh sach cot den (toa do theo WORLD) — goi MOT LAN sau khi map xay xong.
    setStreetLamps(positions) {
        this.streetLamps = (Array.isArray(positions) && positions.length) ? positions : [];
        this._streetLampTimer = STREET_LIGHT_REFRESH;   // chon lai cot ngay
    }

    _updateStreetLights(busGroup, dt) {
        const lamps = this.streetLamps;
        if (!lamps || !lamps.length || !busGroup) return;

        // Den duong chi sang ban dem. sunInt ~ 0 khi toi, lon khi ban ngay.
        const sunInt = this.timeSystem.getSunIntensity();
        const nf = 1 - Math.min(1, Math.max(0, sunInt / 0.25));   // 0 = ngay, 1 = dem
        this._streetNightFactor = nf;

        const N = this.streetLights.length;
        const px = busGroup.position.x, pz = busGroup.position.z;

        this._streetLampTimer += dt;
        const refresh = this._streetLampTimer >= STREET_LIGHT_REFRESH;
        if (refresh) this._streetLampTimer = 0;

        if (!refresh) {
            // Van giu vi tri cu, chi cap nhat do sang (de binh minh/hoang hon chuyen
            // tich lien tuong, khong can doi cot).
            for (let k = 0; k < N; k++) {
                const pl = this.streetLights[k];
                pl.intensity = (pl.userData.lampIdx >= 0) ? STREET_LIGHT_INTENSITY * nf : 0;
            }
            return;
        }

        // Chon N cot gan nhat. O(lamps * N) voi N = 6 -> trivial, khong can spatial index.
        const bestD = new Array(N).fill(Infinity);
        const bestI = new Array(N).fill(-1);
        const maxD2 = STREET_LIGHT_AWAKEN_RADIUS * STREET_LIGHT_AWAKEN_RADIUS;
        for (let i = 0; i < lamps.length; i++) {
            const L = lamps[i];
            const dx = L.x - px, dz = L.z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 > maxD2 || d2 >= bestD[N - 1]) continue;
            let j = N - 1;
            while (j > 0 && bestD[j - 1] > d2) { bestD[j] = bestD[j - 1]; bestI[j] = bestI[j - 1]; j--; }
            bestD[j] = d2; bestI[j] = i;
        }

        for (let k = 0; k < N; k++) {
            const pl = this.streetLights[k];
            const li = bestI[k];
            if (li < 0) {
                // Khong co cot gan -> tat di. Van giu visible = true (xem tren),
                // intensity = 0 la khong chieu gi ca, nhung light count khong doi.
                pl.userData.lampIdx = -1;
                pl.intensity = 0;
                continue;
            }
            const L = lamps[li];
            pl.userData.lampIdx = li;
            pl.position.set(L.x, L.y, L.z);
            pl.intensity = STREET_LIGHT_INTENSITY * nf;
        }
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

        // 6b. Den duong (street lights pool) — chi ghep N cot den gan nhat, va chi
        // sang khi toi. Anh sang co `distance` + `decay` nen giam dan theo khoang
        // cach; ngoai vung nay van toi.
        this._updateStreetLights(busGroup, deltaTime);

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
            // BUG FIX: truoc do la `color.copy(getSkyColor()).multiplyScalar(0.5 + 0.5 * sunInt)`.
            // Ban dem sky color da toi (#2e2f3c) roi con bi nhan them 0.5 nua -> mau gan nhu den
            // thuan, nen intensity 0.3 x mau ~0.09 = irradiance ~0.027 -> xe bus khong thay gi.
            // Sky color chi duoc dung lam TINT (giu sac do xanh/lan), con do sang do
            // ambient.intensity quyet dinh. Ban ngay multiplier cu = 1.0 va sky dat near-peak
            // nen normalize khong doi gi — chi sua ban dem.
            const skyTint = time.getSkyColor();
            const peak = Math.max(skyTint.r, skyTint.g, skyTint.b, 1e-3);
            this.lights.ambient.color.copy(skyTint).multiplyScalar(1 / peak);
        }

        // Hemisphere - at night, use moonlight color for sky and slightly brighter ground for fill
        if (this.lights.hemisphere) {
            const isNight = sunInt < 0.1;
            this.lights.hemisphere.intensity = isNight ? Math.max(ambInt * 0.6, 0.08) : ambInt * 0.8;  // Reduced min intensity at night
            if (isNight) {
                // At night: sky color from moonlight, ground color slightly brighter for ambient bounce
                this.lights.hemisphere.color.copy(time.getMoonColor()).multiplyScalar(0.25);  // Reduced multiplier
                this.lights.hemisphere.groundColor.setHSL(0.6, 0.1, 0.1);  // Darker ground bounce
            } else {
                this.lights.hemisphere.color.copy(time.getSkyColor());
                this.lights.hemisphere.groundColor.copy(time.getFogColor()).multiplyScalar(0.5);
            }
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

        this._tmpVec3.set(-0.78, 0, 100).applyQuaternion(busQuat).add(busPos);
        this.headlightTargetLeft.position.copy(this._tmpVec3);

        // Right headlight
        this._tmpVec3.set(0.78, 1.05, 0).applyQuaternion(busQuat).add(busPos);
        this.headlightRight.position.copy(this._tmpVec3);

        this._tmpVec3.set(0.78, 0, 100).applyQuaternion(busQuat).add(busPos);
        this.headlightTargetRight.position.copy(this._tmpVec3);

        // Taillight
        this._tmpVec3.set(0, 1.1, -12).applyQuaternion(busQuat).add(busPos);
        this.taillightGlow.position.copy(this._tmpVec3);
    }

    // ===== SHADOW RENDERING =====
    // Gọi từ main.js TRƯỚC renderer.render(scene, camera)
    renderShadows(busGroup = null) {
        if (!this.shadowSystem || !this.shadowSystem.sunLight || this.shadowSystem.sunLight.intensity <= 0) return;

        // Throttle shadow updates based on quality and player movement
        this._shadowFrameCounter++;
        
        // On LOW quality, update shadows every 2 frames
        if (this.quality === "LOW" && this._shadowFrameCounter % 2 !== 0) {
            return;
        }
        
        // On MEDIUM/HIGH, throttle based on player movement (update every 3-5 frames if player stationary)
        if (this.quality !== "LOW" && busGroup) {
            const dx = busGroup.position.x - this._lastShadowPlayerPos.x;
            const dz = busGroup.position.z - this._lastShadowPlayerPos.z;
            const distMoved = Math.sqrt(dx * dx + dz * dz);
            const throttleFrames = this.quality === "HIGH" ? 5 : 3;
            
            if (distMoved < this._shadowPosThreshold && this._shadowFrameCounter % throttleFrames !== 0) {
                return;
            }
            this._lastShadowPlayerPos.copy(busGroup.position);
        }
        
        // On MEDIUM/HIGH without busGroup, fall back to frame counter
        if (this.quality !== "LOW" && !busGroup && this._shadowFrameCounter % 3 !== 0) {
            return;
        }

        this.shadowSystem.renderShadows();
        
        // Moon shadow at night - only render if moon is visible and has intensity
        if (this.timeSystem.getSunIntensity() < 0.1 && this.timeSystem.getMoonIntensity() > 0.5) {
            this.shadowSystem.renderMoonShadow();
        }
    }

    // ===== HEADLIGHT CONTROL =====
    setHeadlights(on) {
        this.headlightEnabled = on;
        const intensity = on ? 500 : 0;
        if (this.headlightLeft) this.headlightLeft.intensity = intensity;
        if (this.headlightRight) this.headlightRight.intensity = on ? 300 : 0;
        if (this.taillightGlow) this.taillightGlow.intensity = on ? 10 : 0;
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

        // Adjust shadow update interval based on quality
        this._shadowUpdateInterval = quality === "LOW" ? 2 : 1;

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