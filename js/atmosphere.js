// js/atmosphere.js
// Hệ thống atmospheric effects: fog, haze, god rays, sky rendering
import * as THREE from "three";
import { clamp, lerp, smoothstep } from "./utils.js";

export class AtmosphereSystem {
    constructor(renderer, scene, camera, options = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = options.quality || "MEDIUM";

        // Time system reference (set externally)
        this.timeSystem = null;

        // Sky dome
        this.skyMesh = null;
        this.skyMaterial = null;
        this.skyRadius = 50000;

        // Fog parameters
        this.fogColor = new THREE.Color(0x87CEEB);
        this.fogNear = 260;
        this.fogFar = 1450;
        this.fogDensity = 0.00015;

        // Haze (atmospheric scattering approximation)
        this.hazeDensity = 0;
        this.hazeColor = new THREE.Color(0xFFFFFF);
        this.hazeHeightFalloff = 0.0001;

        // God rays / Light shafts
        this.godRaysEnabled = false;
        this.godRaysMaterial = null;
        this.godRaysMesh = null;
        this.godRaysIntensity = 0;
        this.godRaysColor = new THREE.Color(0xFFF5E0);
        this.godRaysResolution = 512;
        this.godRaysRenderTarget = null;

        // Stars (night sky)
        this.starsMesh = null;
        this.starsMaterial = null;
        this.starCount = 3000;

        // Sun/Moon discs
        this.sunMesh = null;
        this.moonMesh = null;
        this.celestialMaterial = null;

        // Weather blending
        this.weatherState = "CLEAR";
        this.weatherTransition = 0;
        this.targetWeather = "CLEAR";
        this.weatherParams = {
            CLEAR: { fogMul: 1.0, hazeMul: 1.0, sunMul: 1.0, exposure: 1.0 },
            CLOUDY: { fogMul: 1.5, hazeMul: 2.0, sunMul: 0.5, exposure: 0.8 },
            RAIN: { fogMul: 3.0, hazeMul: 4.0, sunMul: 0.2, exposure: 0.6 },
            HEAVY_RAIN: { fogMul: 5.0, hazeMul: 6.0, sunMul: 0.1, exposure: 0.4 },
            FOG: { fogMul: 8.0, hazeMul: 10.0, sunMul: 0.15, exposure: 0.5 },
        };

        // Temp objects
        this._tmpColor = new THREE.Color();
        this._tmpVec3 = new THREE.Vector3();

        this._initSky();
        this._initStars();
        this._initCelestialBodies();
        this._initGodRays();
    }

    setTimeSystem(timeSystem) {
        this.timeSystem = timeSystem;
    }

    setQuality(quality) {
        if (["LOW", "MEDIUM", "HIGH"].includes(quality)) {
            this.quality = quality;
            this._rebuildQualityDependent();
        }
    }

    _rebuildQualityDependent() {
        if (this.godRaysRenderTarget) {
            this.godRaysRenderTarget.dispose();
        }
        const res = this.quality === "HIGH" ? 1024 : this.quality === "MEDIUM" ? 512 : 256;
        this.godRaysResolution = res;
        this._initGodRays();
    }

    // ===== SKY DOME =====
    _initSky() {
        // Large sphere enclosing the world
        const geometry = new THREE.SphereGeometry(this.skyRadius, 64, 32);
        geometry.scale(-1, 1, 1); // Inside view

        this.skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
                uSunColor: { value: new THREE.Color(0xFFFFFF) },
                uSunIntensity: { value: 1.0 },
                uSkyColor: { value: new THREE.Color(0x87CEEB) },
                uHorizonColor: { value: new THREE.Color(0xE0E0FF) },
                uZenithColor: { value: new THREE.Color(0x004488) },
                uNightColor: { value: new THREE.Color(0x050515) },
                uGroundColor: { value: new THREE.Color(0x362D1B) },
                uMieCoefficient: { value: 0.005 },
                uRayleighCoefficient: { value: 0.003 },
                uExposure: { value: 1.0 },
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                void main() {
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    vNormal = normalize(normalMatrix * normal);
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position.z = gl_Position.w; // Force to far plane
                }
            `,
            fragmentShader: `
                uniform vec3 uSunDirection;
                uniform vec3 uSunColor;
                uniform float uSunIntensity;
                uniform vec3 uSkyColor;
                uniform vec3 uHorizonColor;
                uniform vec3 uZenithColor;
                uniform vec3 uNightColor;
                uniform vec3 uGroundColor;
                uniform float uMieCoefficient;
                uniform float uRayleighCoefficient;
                uniform float uExposure;
                uniform float uTime;
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying vec2 vUv;

                // Atmospheric scattering (simplified Preetham/SEA)
                vec3 atmosphereScattering(vec3 viewDir, vec3 sunDir, float altitude) {
                    float cosTheta = dot(viewDir, sunDir);
                    float phaseRayleigh = 0.75 * (1.0 + cosTheta * cosTheta);
                    float phaseMie = 1.5 * pow(max(0.0, cosTheta), 200.0) / (4.0 * 3.14159);

                    float density = exp(-altitude * 0.0001);
                    vec3 rayleighColor = vec3(0.6, 0.7, 1.0) * uRayleighCoefficient;
                    vec3 mieColor = vec3(1.0, 0.9, 0.8) * uMieCoefficient;

                    return (rayleighColor * phaseRayleigh + mieColor * phaseMie) * density * uSunIntensity;
                }

                void main() {
                    vec3 viewDir = normalize(vWorldPosition - cameraPosition);
                    float altitude = vWorldPosition.y;

                    // Base sky gradient
                    float horizonFade = smoothstep(-500.0, 5000.0, altitude);
                    vec3 skyBase = mix(uGroundColor, uSkyColor, horizonFade);

                    // Zenith/horizon blend
                    float zenith = max(0.0, viewDir.y);
                    skyBase = mix(uHorizonColor, uZenithColor, pow(zenith, 0.5)) * (1.0 - horizonFade * 0.5) + skyBase * horizonFade * 0.5;

                    // Night blend
                    float sunAltitude = uSunDirection.y;
                    float nightFactor = smoothstep(0.1, -0.1, sunAltitude);
                    skyBase = mix(uNightColor, skyBase, nightFactor);

                    // Atmospheric scattering
                    vec3 scatter = atmosphereScattering(viewDir, uSunDirection, altitude);

                    // Sun disc
                    float sunAngularRadius = 0.00465;
                    float sunDisc = 1.0 - smoothstep(sunAngularRadius, sunAngularRadius * 1.5, acos(max(-1.0, min(1.0, dot(viewDir, uSunDirection)))));
                    vec3 sunGlow = uSunColor * sunDisc * uSunIntensity * 50.0 * nightFactor;

                    // Moon (handled by separate mesh)

                    vec3 finalColor = skyBase + scatter + sunGlow;
                    finalColor = pow(finalColor * uExposure, vec3(1.0/2.2)); // Gamma correction

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: true,
            fog: false, // Quan trọng: tránh Three.js áp fog lên sky dome
        });

        this.skyMesh = new THREE.Mesh(geometry, this.skyMaterial);
        this.skyMesh.renderOrder = -1000; // Render first
        this.scene.add(this.skyMesh);
    }

    // ===== STARS =====
    _initStars() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.starCount * 3);
        const colors = new Float32Array(this.starCount * 3);
        const sizes = new Float32Array(this.starCount);

        for (let i = 0; i < this.starCount; i++) {
            // Random point on sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = this.skyRadius * 0.95;

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Star color variation
            const temp = Math.random();
            if (temp < 0.4) { // Red/orange
                colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.8 + Math.random() * 0.2; colors[i * 3 + 2] = 0.6 + Math.random() * 0.2;
            } else if (temp < 0.7) { // Yellow/white
                colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;
            } else { // Blue/white
                colors[i * 3] = 0.8 + Math.random() * 0.2; colors[i * 3 + 1] = 0.9 + Math.random() * 0.1; colors[i * 3 + 2] = 1.0;
            }

            sizes[i] = 0.5 + Math.random() * 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.starsMaterial = new THREE.PointsMaterial({
            size: 100,
            vertexColors: true,
            transparent: true,
            opacity: 0,
            sizeAttenuation: false,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            fog: false, // Tránh fog làm mờ sao
        });

        this.starsMesh = new THREE.Points(geometry, this.starsMaterial);
        this.starsMesh.renderOrder = -999;
        this.scene.add(this.starsMesh);
    }

    // ===== SUN / MOON DISCS =====
    _initCelestialBodies() {
        const discGeometry = new THREE.PlaneGeometry(1, 1);
        discGeometry.scale(-1, 1, 1);

        this.celestialMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xFFFFFF) },
                uGlowColor: { value: new THREE.Color(0xFFF5E0) },
                uAngularSize: { value: 0.00465 },
                uIntensity: { value: 1.0 },
                uCameraPos: { value: new THREE.Vector3() },
                uPosition: { value: new THREE.Vector3() },
            },
            vertexShader: `
                uniform vec3 uCameraPos;
                uniform vec3 uPosition;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    // Always face camera, at fixed world position
                    vec3 pos = uPosition + position.xyz * 1000.0;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform vec3 uGlowColor;
                uniform float uAngularSize;
                uniform float uIntensity;
                varying vec2 vUv;

                void main() {
                    vec2 center = vUv - 0.5;
                    float dist = length(center);
                    float radius = 0.5;

                    // Soft disc with glow
                    float disc = smoothstep(radius, radius - 0.02, dist);
                    float glow = smoothstep(radius * 3.0, radius, dist) * 0.3;

                    vec3 color = mix(uGlowColor, uColor, disc) * uIntensity;
                    float alpha = disc + glow;

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            fog: false, // Tránh fog làm mờ mặt trời/mặt trăng
            side: THREE.DoubleSide,
        });

        this.sunMesh = new THREE.Mesh(discGeometry, this.celestialMaterial);
        this.sunMesh.renderOrder = -998;
        this.scene.add(this.sunMesh);

        this.moonMesh = new THREE.Mesh(discGeometry, this.celestialMaterial.clone());
        this.moonMesh.renderOrder = -998;
        this.scene.add(this.moonMesh);
    }

    // ===== GOD RAYS (Light Shafts) =====
    _initGodRays() {
        // Screen-space god rays using radial blur
        const res = this.godRaysResolution;
        this.godRaysRenderTarget = new THREE.WebGLRenderTarget(res, res, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: false,
        });
        this.godRaysRenderTarget.texture.name = "GodRaysRT";

        // Fullscreen quad for god rays
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.godRaysMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                uSunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
                uIntensity: { value: 0 },
                uColor: { value: new THREE.Color(0xFFF5E0) },
                uExposure: { value: 1.0 },
                uSamples: { value: 32 },
                uDensity: { value: 1.0 },
                uWeight: { value: 0.85 },
                uDecay: { value: 0.95 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec2 uSunScreenPos;
                uniform float uIntensity;
                uniform vec3 uColor;
                uniform float uExposure;
                uniform int uSamples;
                uniform float uDensity;
                uniform float uWeight;
                uniform float uDecay;
                varying vec2 vUv;

                void main() {
                    vec2 delta = vUv - uSunScreenPos;
                    vec2 deltaStep = delta * (1.0 / float(uSamples)) * uDensity;

                    vec3 color = vec3(0.0);
                    float illuminationDecay = 1.0;

                    for (int i = 0; i < 64; i++) {
                        if (i >= uSamples) break;
                        vec2 sampleUv = vUv - deltaStep * float(i);
                        if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;

                        vec3 sample = texture2D(tDiffuse, sampleUv).rgb;
                        sample *= illuminationDecay * uWeight;
                        color += sample;
                        illuminationDecay *= uDecay;
                    }

                    color *= uIntensity * uExposure;
                    gl_FragColor = vec4(color * uColor, 1.0);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
        });

        this.godRaysMesh = new THREE.Mesh(geometry, this.godRaysMaterial);
        this.godRaysMesh.renderOrder = 999; // Render last (post-process)
        // Don't add to scene - we'll render manually
    }

    // ===== UPDATE =====
    update(deltaTime) {
        if (!this.timeSystem) return;

        const time = this.timeSystem;
        const sunAlt = time.getSunAltitude();
        const sunDeg = (sunAlt * 180) / Math.PI;
        const sunDir = time.getSunDirection();
        const moonDir = time.getMoonDirection();
        const sunIntensity = time.getSunIntensity();
        const moonIntensity = time.getMoonIntensity();
        const exposure = time.getExposure();

        // Update sky material
        if (this.skyMaterial) {
            this.skyMaterial.uniforms.uSunDirection.value.copy(sunDir);
            this.skyMaterial.uniforms.uSunColor.value.copy(time.getSunColor());
            this.skyMaterial.uniforms.uSunIntensity.value = sunIntensity;
            this.skyMaterial.uniforms.uSkyColor.value.copy(time.getSkyColor());
            this.skyMaterial.uniforms.uExposure.value = exposure;

            // Horizon/zenith colors based on time
            if (sunDeg > 10) {
                this.skyMaterial.uniforms.uHorizonColor.value.setHSL(0.55, 0.3, 0.85);
                this.skyMaterial.uniforms.uZenithColor.value.setHSL(0.55, 0.7, 0.5);
            } else if (sunDeg > 0) {
                const t = sunDeg / 10;
                this.skyMaterial.uniforms.uHorizonColor.value.setHSL(lerp(0.04, 0.55, t), lerp(0.6, 0.3, t), lerp(0.6, 0.85, t));
                this.skyMaterial.uniforms.uZenithColor.value.setHSL(0.55, lerp(0.4, 0.7, t), lerp(0.4, 0.5, t));
            } else if (sunDeg > -6) {
                const t = (sunDeg + 6) / 6;
                this.skyMaterial.uniforms.uHorizonColor.value.setHSL(lerp(0.02, 0.04, t), lerp(0.8, 0.6, t), lerp(0.3, 0.6, t));
                this.skyMaterial.uniforms.uZenithColor.value.setHSL(0.62, 0.4, lerp(0.2, 0.4, t));
            } else {
                this.skyMaterial.uniforms.uHorizonColor.value.setHSL(0.65, 0.2, 0.1);
                this.skyMaterial.uniforms.uZenithColor.value.setHSL(0.65, 0.25, 0.05);
            }
        }

        // Update stars visibility
        if (this.starsMesh && this.starsMaterial) {
            if (sunDeg < -6) {
                const t = clamp((-sunDeg - 6) / 12, 0, 1);
                const moonFactor = Math.max(0, Math.sin(time.getMoonPhase())) * 0.5 + 0.5;
                this.starsMaterial.opacity = lerp(0, 1, t) * (1.0 - moonFactor * 0.5);
            } else {
                this.starsMaterial.opacity = 0;
            }
        }

        // Update sun disc
        if (this.sunMesh) {
            this.sunMesh.material.uniforms.uPosition.value.copy(time.getSunPosition());
            this.sunMesh.material.uniforms.uCameraPos.value.copy(this.camera.position);
            this.sunMesh.material.uniforms.uColor.value.copy(time.getSunColor());
            this.sunMesh.material.uniforms.uGlowColor.value.copy(time.getSunColor()).multiplyScalar(0.8);
            this.sunMesh.material.uniforms.uIntensity.value = sunIntensity > 0 ? 1.0 : 0;
            this.sunMesh.visible = sunIntensity > 0.01;
        }

        // Update moon disc
        if (this.moonMesh) {
            this.moonMesh.material.uniforms.uPosition.value.copy(time.getMoonPosition());
            this.moonMesh.material.uniforms.uCameraPos.value.copy(this.camera.position);
            this.moonMesh.material.uniforms.uColor.value.copy(time.getMoonColor());
            this.moonMesh.material.uniforms.uGlowColor.value.copy(time.getMoonColor()).multiplyScalar(0.5);
            const moonPhase = Math.max(0, Math.sin(time.getMoonPhase()));
            this.moonMesh.material.uniforms.uIntensity.value = moonIntensity > 0 ? moonPhase : 0;
            this.moonMesh.visible = moonIntensity > 0.01;
        }

        // Update fog
        this.fogColor.copy(time.getFogColor());
        this.fogNear = time.getFogNear();
        this.fogFar = time.getFogFar();
        this.hazeDensity = time.getHazeDensity();

        // Apply weather modulation
        this._applyWeather();

        // Update scene fog
        if (this.scene.fog) {
            this.scene.fog.color.copy(this.fogColor);
            this.scene.fog.near = this.fogNear;
            this.scene.fog.far = this.fogFar;
        }

        // God rays intensity
        if (sunDeg > -2 && sunDeg < 30 && sunIntensity > 0.3) {
            this.godRaysEnabled = true;
            this.godRaysIntensity = clamp(sunIntensity * (1.0 - sunDeg / 30) * 0.5, 0, 0.4);
            this.godRaysColor.copy(time.getSunColor());
        } else {
            this.godRaysEnabled = false;
            this.godRaysIntensity = 0;
        }
    }

    _applyWeather() {
        const params = this.weatherParams[this.weatherState] || this.weatherParams.CLEAR;

        // Smooth transition
        this.weatherTransition += (1 - this.weatherTransition) * 0.02;
        if (this.weatherState !== this.targetWeather) {
            this.weatherTransition = 0;
            this.weatherState = this.targetWeather;
        }

        const p = this.weatherParams[this.weatherState];
        this.fogNear *= p.fogMul;
        this.fogFar = Math.min(this.fogFar * p.fogMul, 3000);
        this.hazeDensity *= p.hazeMul;
    }

    // Public API for weather
    setWeather(weather) {
        if (this.weatherParams[weather]) {
            this.targetWeather = weather;
        }
    }

    getWeather() { return this.weatherState; }

    // Render god rays (call after main render, before tone mapping)
    renderGodRays(renderer, scene, camera, sunScreenPos) {
        if (!this.godRaysEnabled || !this.godRaysMaterial) return;

        const prevRT = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;

        // Render scene to god rays RT (only sun-affected objects)
        // Simplified: render a masked version
        renderer.setRenderTarget(this.godRaysRenderTarget);
        renderer.clear();

        // For now, skip full implementation - would need occlusion mask
        // This is a placeholder for the radial blur pass

        renderer.setRenderTarget(prevRT);
        renderer.autoClear = prevAutoClear;
    }

    // Compose god rays onto screen (post-process)
    composeGodRays(targetRT) {
        if (!this.godRaysEnabled) return;

        const renderer = this.renderer;
        const prevRT = renderer.getRenderTarget();

        this.godRaysMaterial.uniforms.tDiffuse.value = this.godRaysRenderTarget.texture;
        this.godRaysMaterial.uniforms.uIntensity.value = this.godRaysIntensity;
        this.godRaysMaterial.uniforms.uColor.value.copy(this.godRaysColor);
        this.godRaysMaterial.uniforms.uExposure.value = this.timeSystem ? this.timeSystem.getExposure() : 1.0;

        renderer.setRenderTarget(targetRT);
        renderer.render(this.godRaysMesh, this.camera);
        renderer.setRenderTarget(prevRT);
    }

    // Getters for external use
    getFogColor() { return this.fogColor.clone(); }
    getFogNear() { return this.fogNear; }
    getFogFar() { return this.fogFar; }
    getHazeDensity() { return this.hazeDensity; }
    getSkyColor() { return this.skyMaterial?.uniforms.uSkyColor.value.clone() || new THREE.Color(0x87CEEB); }

    // Debug
    toggleGodRays(enabled) { this.godRaysEnabled = enabled; }

    dispose() {
        if (this.skyMesh) {
            this.scene.remove(this.skyMesh);
            this.skyMesh.geometry.dispose();
            this.skyMaterial.dispose();
        }
        if (this.starsMesh) {
            this.scene.remove(this.starsMesh);
            this.starsMesh.geometry.dispose();
            this.starsMaterial.dispose();
        }
        if (this.sunMesh) {
            this.scene.remove(this.sunMesh);
        }
        if (this.moonMesh) {
            this.scene.remove(this.moonMesh);
        }
        if (this.celestialMaterial) {
            this.celestialMaterial.dispose();
        }
        if (this.godRaysRenderTarget) {
            this.godRaysRenderTarget.dispose();
        }
        if (this.godRaysMaterial) {
            this.godRaysMaterial.dispose();
        }
    }
}

// Screen-space atmospheric scattering post-process (optional, for HIGH quality)
export const AtmosphericPostProcess = {
    uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 2000 },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xFFFFFF) },
        uSunIntensity: { value: 1.0 },
        uHazeDensity: { value: 0.00015 },
        uHazeColor: { value: new THREE.Color(0xFFFFFF) },
        uExposure: { value: 1.0 },
        uResolution: { value: new THREE.Vector2() },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform float uHazeDensity;
        uniform vec3 uHazeColor;
        uniform float uExposure;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float readDepth(vec2 uv) {
            vec4 packed = texture2D(tDepth, uv);
            return packed.r + packed.g * (1.0/255.0) + packed.b * (1.0/65025.0) + packed.a * (1.0/16581375.0);
        }

        float linearizeDepth(float d) {
            return (2.0 * uCameraNear) / (uCameraFar + uCameraNear - d * (uCameraFar - uCameraNear));
        }

        vec3 atmosphericScattering(vec3 viewDir, float depth) {
            float cosSun = dot(viewDir, uSunDirection);
            float phase = 0.75 * (1.0 + cosSun * cosSun); // Rayleigh
            float miePhase = 1.5 * pow(max(0.0, cosSun), 100.0) / (4.0 * 3.14159); // Mie

            float density = exp(-depth * uHazeDensity * 0.01);
            vec3 scatter = (uSunColor * (phase * 0.003 + miePhase * 0.005) + uHazeColor * 0.001) * density * uSunIntensity;

            return scatter * depth * 0.01;
        }

        void main() {
            vec4 baseColor = texture2D(tDiffuse, vUv);
            float depth = linearizeDepth(readDepth(vUv));
            vec3 viewDir = normalize(vec3((vUv - 0.5) * 2.0, -1.0));

            vec3 scatter = atmosphericScattering(viewDir, depth);
            vec3 finalColor = baseColor.rgb + scatter;
            finalColor = pow(finalColor * uExposure, vec3(1.0/2.2));

            gl_FragColor = vec4(finalColor, baseColor.a);
        }
    `,
};