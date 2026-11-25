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
        this.godRaysResolution = this.quality === "HIGH" ? 512 : this.quality === "LOW" ? 128 : 256;
        this.godRaysRenderTarget = null;
        this.godRaysBlurTarget = null;
        this.godRaysOcclusionMaterial = null;
        this.godRaysCompositeMaterial = null;
        this.godRaysBlurScene = null;
        this.godRaysCompositeScene = null;
        this.godRaysMaskScene = null;
        this.godRaysMaskMesh = null;
        this._godRaysTargetWidth = 0;
        this._godRaysTargetHeight = 0;
        this._godRaysFrame = 0;
        this._godRaysHasResult = false;

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
        this.targetWeather = "CLEAR";
        this.weatherParams = {
            CLEAR: { fogMul: 1.0, hazeMul: 1.0, sunMul: 1.0, exposure: 1.0 },
            CLOUDY: { fogMul: 1.5, hazeMul: 2.0, sunMul: 0.5, exposure: 0.8 },
            RAIN: { fogMul: 3.0, hazeMul: 4.0, sunMul: 0.2, exposure: 0.6 },
            HEAVY_RAIN: { fogMul: 5.0, hazeMul: 6.0, sunMul: 0.1, exposure: 0.4 },
            FOG: { fogMul: 8.0, hazeMul: 10.0, sunMul: 0.15, exposure: 0.5 },
        };
        this.weatherMix = { fogMul: 1, hazeMul: 1, sunMul: 1, exposure: 1 };

        // Temp objects
        this._tmpColor = new THREE.Color();
        this._tmpVec3 = new THREE.Vector3();
        this._tmpVec2 = new THREE.Vector2();
        this._tmpSunScreenPosition = new THREE.Vector3();
        this._godRaysClearColor = new THREE.Color();

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

    /** God Rays có setting RIÊNG (off/low/high), không được đi theo nhầm
     *  chất lượng lighting: low = 256px/16 sample, high = 512px/32 sample.
     *  setQuality() có thể dựng lại material -> so sánh cả giá trị thực trước
     *  khi return để luôn khôi phục đúng lựa chọn của người chơi. */
    setGodRaysQuality(level) {
        const high = level === 'high';
        const resolution = high ? 512 : 256;
        const samples = high ? 32 : 16;
        const appliedSamples = this.godRaysMaterial?.uniforms?.uSamples?.value;
        if (this.godRaysQuality === level && this.godRaysResolution === resolution && appliedSamples === samples) return;
        this.godRaysQuality = level;
        this.godRaysResolution = resolution;
        this._godRaysHasResult = false;
        this._initGodRays();
        if (this.godRaysMaterial?.uniforms?.uSamples) {
            this.godRaysMaterial.uniforms.uSamples.value = samples;
        }
    }

    _rebuildQualityDependent() {
        this.godRaysResolution = this.quality === "HIGH" ? 512 : this.quality === "MEDIUM" ? 256 : 128;
        this._godRaysHasResult = false;
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
                // Night factor theo GIỜ (1 - sunIntensity), không theo sunAltitude:
                // lúc 18:00 mặt trời vẫn còn +2.8° trên chân trời (mùa hè VN)
                // nhưng lighting đã chuyển đêm -> nếu dùng altitude, trời vẫn xanh.
                uNightFactor: { value: 0.0 },
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
                uniform float uNightFactor;
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

                    // Night blend theo same clock với lighting/TimeSystem.
                    // Dùng altitude ở đây từng làm trời sáng xanh lúc 18:00 dù
                    // mọi đèn đã chuyển chế độ đêm (sun altitude vẫn dương ở VN).
                    float dayFactor = 1.0 - clamp(uNightFactor, 0.0, 1.0);
                    skyBase = mix(uNightColor, skyBase, dayFactor);

                    // Đêm: không để giá trị nào đẩy trời xám lại lên.
                    if (uNightFactor > 0.5) {
                        skyBase = min(skyBase, vec3(0.02));
                    }

                    // Atmospheric scattering
                    vec3 scatter = atmosphereScattering(viewDir, uSunDirection, altitude);

                    // Sun disc - reduced intensity to prevent white sky
                    float sunAngularRadius = 0.00465;
                    float sunDisc = 1.0 - smoothstep(sunAngularRadius, sunAngularRadius * 1.5, acos(max(-1.0, min(1.0, dot(viewDir, uSunDirection)))));
                    // Further reduced sun glow intensity and removed nightFactor multiplier for sun (sun shouldn't glow at night)
                    vec3 sunGlow = uSunColor * sunDisc * uSunIntensity * 12.0;  // Reduced from 25.0 to 12.0

                    // Moon (handled by separate mesh)

                    vec3 finalColor = skyBase + scatter + sunGlow;
                    // NO exposure/gamma here - renderer handles tone mapping (ACESFilmic)
                    // Clamp to prevent over-exposure (white sky) before tone mapping
                    finalColor = min(finalColor, vec3(1.0));
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

        // sizeAttenuation:false dùng gl_PointSize theo pixel cố định; attribute size
        // không được PointsMaterial đọc. Giữ điểm 3px để sao không thành ô vuông lớn ở góc màn hình.
        this.starsMaterial = new THREE.PointsMaterial({
            size: 3,
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
        this._disposeGodRays();

        this.godRaysRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: true,
        });
        this.godRaysRenderTarget.texture.name = "GodRaysOcclusion";
        this.godRaysBlurTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: false,
        });
        this.godRaysBlurTarget.texture.name = "GodRaysBlur";

        const geometry = new THREE.PlaneGeometry(2, 2);
        this.godRaysMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                uSunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
                uIntensity: { value: 0 },
                uColor: { value: new THREE.Color(0xFFF5E0) },
                uExposure: { value: 1.0 },
                uSamples: { value: this.quality === "HIGH" ? 32 : this.quality === "MEDIUM" ? 20 : 12 },
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

                    color *= uIntensity * uExposure / float(uSamples);
                    gl_FragColor = vec4(color * uColor, 1.0);
                }
            `,
            transparent: true,
            blending: THREE.NoBlending,
            depthWrite: false,
            depthTest: false,
            toneMapped: false,
        });

        this.godRaysMesh = new THREE.Mesh(geometry, this.godRaysMaterial);
        this.godRaysBlurScene = new THREE.Scene();
        this.godRaysBlurScene.add(this.godRaysMesh);
        this.godRaysCompositeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: this.godRaysBlurTarget.texture },
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
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(tDiffuse, vUv);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            toneMapped: false,
        });
        const compositeMesh = new THREE.Mesh(geometry, this.godRaysCompositeMaterial);
        this.godRaysCompositeScene = new THREE.Scene();
        this.godRaysCompositeScene.add(compositeMesh);

        this.godRaysOcclusionMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        this.godRaysMaskScene = new THREE.Scene();
        this.godRaysMaskMesh = new THREE.Mesh(
            this.sunMesh.geometry,
            new THREE.ShaderMaterial({
                uniforms: { uPosition: { value: new THREE.Vector3() } },
                vertexShader: `
                    uniform vec3 uPosition;
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        vec3 pos = uPosition + position.xyz * 1000.0;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec2 vUv;
                    void main() {
                        float radius = 0.5;
                        float disc = 1.0 - smoothstep(radius - 0.02, radius, length(vUv - 0.5));
                        gl_FragColor = vec4(vec3(disc), 1.0);
                    }
                `,
                side: THREE.DoubleSide,
                depthTest: true,
                depthWrite: false,
                toneMapped: false,
            })
        );
        this.godRaysMaskMesh.visible = false;
        this.godRaysMaskScene.add(this.godRaysMaskMesh);
        this._resizeGodRaysTargets();
    }

    _resizeGodRaysTargets() {
        if (!this.renderer || !this.godRaysRenderTarget || !this.godRaysBlurTarget) return;

        this.renderer.getDrawingBufferSize(this._tmpVec2);
        const scale = this.godRaysResolution / Math.max(this._tmpVec2.x, this._tmpVec2.y, 1);
        const width = Math.max(1, Math.round(this._tmpVec2.x * Math.min(scale, 1)));
        const height = Math.max(1, Math.round(this._tmpVec2.y * Math.min(scale, 1)));
        if (width === this._godRaysTargetWidth && height === this._godRaysTargetHeight) return;

        this.godRaysRenderTarget.setSize(width, height);
        this.godRaysBlurTarget.setSize(width, height);
        this._godRaysTargetWidth = width;
        this._godRaysTargetHeight = height;
        this._godRaysHasResult = false;
    }

    _disposeGodRays() {
        this.godRaysRenderTarget?.dispose();
        this.godRaysBlurTarget?.dispose();
        this.godRaysMaterial?.dispose();
        this.godRaysCompositeMaterial?.dispose();
        this.godRaysOcclusionMaterial?.dispose();
        this.godRaysMaskMesh?.material.dispose();
        this.godRaysMesh?.geometry.dispose();

        this.godRaysBlurScene?.remove(this.godRaysMesh);

        this.godRaysRenderTarget = null;
        this.godRaysBlurTarget = null;
        this.godRaysMaterial = null;
        this.godRaysCompositeMaterial = null;
        this.godRaysOcclusionMaterial = null;
        this.godRaysBlurScene = null;
        this.godRaysMaskScene = null;
        this.godRaysMaskMesh = null;
        this.godRaysCompositeScene = null;
        this.godRaysMesh = null;
        this._godRaysTargetWidth = 0;
        this._godRaysTargetHeight = 0;
        this._godRaysFrame = 0;
        this._godRaysHasResult = false;
    }

    // ===== UPDATE =====
    update(deltaTime) {
        if (!this.timeSystem) return;

        const time = this.timeSystem;
        const sunAlt = time.getSunAltitude();
        const sunDeg = (sunAlt * 180) / Math.PI;
        const sunDir = time.getSunDirection();
        const moonDir = time.getMoonDirection();
        const sunIntensity = time.getSunIntensity() * this.weatherMix.sunMul;
        const moonIntensity = time.getMoonIntensity();
        // exposure no longer needed in sky shader - renderer handles tone mapping

        // Update sky material
        if (this.skyMaterial) {
            this.skyMaterial.uniforms.uSunDirection.value.copy(sunDir);
            this.skyMaterial.uniforms.uSunColor.value.copy(time.getSunColor());
            this.skyMaterial.uniforms.uSunIntensity.value = sunIntensity;
            this.skyMaterial.uniforms.uNightFactor.value = 1 - Math.min(1, Math.max(0, sunIntensity));
            this.skyMaterial.uniforms.uSkyColor.value.copy(time.getSkyColor());
            this.skyMaterial.uniforms.uExposure.value = time.getExposure() * this.weatherMix.exposure;

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
                // Đêm: bầu trời đen thui. Chỉ giữ chút sắc xanh tím ở chân trời
                // để ranh giới trời/đất không bị đen đặc một khối.
                this.skyMaterial.uniforms.uHorizonColor.value.setHSL(0.70, 0.40, 0.012);
                this.skyMaterial.uniforms.uZenithColor.value.setHSL(0.72, 0.45, 0.004);
                this.skyMaterial.uniforms.uNightColor.value.setHSL(0.71, 0.42, 0.004);
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

        if (this.godRaysEnabled && sunDeg > -2 && sunDeg < 30 && sunIntensity > 0.3) {
            this.godRaysIntensity = clamp(sunIntensity * (1.0 - sunDeg / 30) * 0.5, 0, 0.4);
            this.godRaysColor.copy(time.getSunColor());
        } else {
            this.godRaysIntensity = 0;
        }
    }

    _applyWeather() {
        const target = this.weatherParams[this.targetWeather] || this.weatherParams.CLEAR;
        for (const key of ["fogMul", "hazeMul", "sunMul", "exposure"]) {
            this.weatherMix[key] += (target[key] - this.weatherMix[key]) * 0.02;
        }
        this.weatherState = this.targetWeather;
        this.fogNear *= this.weatherMix.fogMul;
        this.fogFar = Math.min(this.fogFar * this.weatherMix.fogMul, 3000);
        this.hazeDensity *= this.weatherMix.hazeMul;
    }

    // Public API for weather
    setWeather(weather) {
        if (this.weatherParams[weather]) {
            this.targetWeather = weather;
        }
    }

    getWeather() { return this.weatherState; }

    renderGodRays(renderer = this.renderer, scene = this.scene, camera = this.camera) {
        if (!this.godRaysEnabled || this.godRaysIntensity <= 0 || !this.godRaysMaterial ||
            !this.sunMesh?.visible || !renderer || !scene || !camera) return;

        const sunPosition = this.sunMesh.material.uniforms.uPosition.value;
        this._tmpSunScreenPosition.copy(sunPosition).project(camera);
        if (this._tmpSunScreenPosition.z < -1 || this._tmpSunScreenPosition.z > 1 ||
            Math.abs(this._tmpSunScreenPosition.x) > 1 || Math.abs(this._tmpSunScreenPosition.y) > 1) return;

        this._resizeGodRaysTargets();
        this._godRaysFrame++;
        const updateRays = !this._godRaysHasResult ||
            this._godRaysFrame % (this.quality === "HIGH" ? 1 : 2) === 0;

        const previousRenderTarget = renderer.getRenderTarget();
        const previousAutoClear = renderer.autoClear;
        const previousOverrideMaterial = scene.overrideMaterial;
        const previousBackground = scene.background;
        const previousClearAlpha = renderer.getClearAlpha();
        const previousShadowAutoUpdate = renderer.shadowMap?.autoUpdate;
        const skyVisible = this.skyMesh?.visible;
        const starsVisible = this.starsMesh?.visible;
        const sunVisible = this.sunMesh.visible;
        const moonVisible = this.moonMesh?.visible;
        renderer.getClearColor(this._godRaysClearColor);

        try {
            renderer.autoClear = false;
            if (updateRays) {
                this.godRaysMaterial.uniforms.tDiffuse.value = this.godRaysRenderTarget.texture;
                this.godRaysMaterial.uniforms.uSunScreenPos.value.set(
                    (this._tmpSunScreenPosition.x + 1) * 0.5,
                    (this._tmpSunScreenPosition.y + 1) * 0.5
                );
                this.godRaysMaterial.uniforms.uIntensity.value = this.godRaysIntensity;
                this.godRaysMaterial.uniforms.uColor.value.copy(this.godRaysColor);
                this.godRaysMaterial.uniforms.uExposure.value = this.timeSystem ? this.timeSystem.getExposure() : 1.0;
                this.godRaysMaskMesh.material.uniforms.uPosition.value.copy(sunPosition);
                this.godRaysMaskMesh.visible = true;
                renderer.setClearColor(0x000000, 1);
                if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;

                renderer.setRenderTarget(this.godRaysRenderTarget);
                renderer.clear(true, true, true);
                scene.background = null;
                scene.overrideMaterial = this.godRaysOcclusionMaterial;
                if (this.skyMesh) this.skyMesh.visible = false;
                if (this.starsMesh) this.starsMesh.visible = false;
                this.sunMesh.visible = false;
                if (this.moonMesh) this.moonMesh.visible = false;
                renderer.render(scene, camera);

                scene.overrideMaterial = previousOverrideMaterial;
                scene.background = previousBackground;
                if (this.skyMesh) this.skyMesh.visible = skyVisible;
                if (this.starsMesh) this.starsMesh.visible = starsVisible;
                this.sunMesh.visible = sunVisible;
                if (this.moonMesh) this.moonMesh.visible = moonVisible;
                renderer.render(this.godRaysMaskScene, camera);

                renderer.setRenderTarget(this.godRaysBlurTarget);
                renderer.clear(true, true, true);
                renderer.render(this.godRaysBlurScene, camera);
                this._godRaysHasResult = true;
            }

            renderer.setRenderTarget(previousRenderTarget);
            renderer.render(this.godRaysCompositeScene, camera);
        } finally {
            scene.overrideMaterial = previousOverrideMaterial;
            scene.background = previousBackground;
            if (this.skyMesh) this.skyMesh.visible = skyVisible;
            if (this.starsMesh) this.starsMesh.visible = starsVisible;
            this.sunMesh.visible = sunVisible;
            if (this.moonMesh) this.moonMesh.visible = moonVisible;
            this.godRaysMaskMesh.visible = false;
            renderer.setRenderTarget(previousRenderTarget);
            renderer.autoClear = previousAutoClear;
            renderer.setClearColor(this._godRaysClearColor, previousClearAlpha);
            if (renderer.shadowMap && previousShadowAutoUpdate !== undefined) {
                renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
            }
        }
    }

    // Getters for external use
    getFogColor() { return this.fogColor.clone(); }
    getFogNear() { return this.fogNear; }
    getFogFar() { return this.fogFar; }
    getHazeDensity() { return this.hazeDensity; }
    getWeatherMix() { return this.weatherMix; }
    getSkyColor() { return this.skyMaterial?.uniforms.uSkyColor.value.clone() || new THREE.Color(0x87CEEB); }

    // Debug
    toggleGodRays(enabled) {
        this.godRaysEnabled = Boolean(enabled);
        if (!this.godRaysEnabled) this.godRaysIntensity = 0;
    }

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
            this.sunMesh.geometry.dispose();
            this.sunMesh.material.dispose();
        }
        if (this.moonMesh) {
            this.scene.remove(this.moonMesh);
            this.moonMesh.material.dispose();
        }
        if (this.celestialMaterial) {
            this.celestialMaterial.dispose();
        }
        this._disposeGodRays();
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