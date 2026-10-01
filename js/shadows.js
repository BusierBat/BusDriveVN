// js/shadows.js
// Hệ thống cascaded shadow maps tập trung quanh player - tối ưu cho world lớn 100km
import * as THREE from "three";
import { clamp } from "./utils.js";

export const SHADOW_QUALITY = {
    LOW: { resolution: 512, cascades: 2, distances: [30, 120], bias: 0.0005, normalBias: 0.02 },
    MEDIUM: { resolution: 1024, cascades: 3, distances: [25, 80, 250], bias: 0.0003, normalBias: 0.015 },
    HIGH: { resolution: 2048, cascades: 4, distances: [20, 60, 150, 400], bias: 0.0001, normalBias: 0.01 },
};

export const DEFAULT_QUALITY = "MEDIUM";

export class ShadowSystem {
    constructor(renderer, scene, options = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.quality = options.quality || DEFAULT_QUALITY;
        this.config = SHADOW_QUALITY[this.quality];

        // Sun light (main shadow caster)
        this.sunLight = null;
        this.moonLight = null;

        // Cascade data
        this.cascades = [];
        this.cascadeCount = this.config.cascades;
        this.shadowCameras = [];
        this.shadowMaps = [];
        this.splitDepths = [];
        this.splitMatrices = [];

        // Player position tracking
        this.playerPosition = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3(0, 0, -1);
        this.cameraRef = null;

        // Frustum splitting (PSSM)
        this.lambda = 0.92; // 0 = uniform, 1 = logarithmic
        this.farPlane = 500; // sẽ cập nhật theo cascade cuối

        // Temporary matrices/vectors
        this._tmpMat4 = new THREE.Matrix4();
        this._tmpVec3 = new THREE.Vector3();
        this._tmpVec4 = new THREE.Vector4();
        this._lightViewMatrix = new THREE.Matrix4();
        this._lightProjMatrix = new THREE.Matrix4();
        this._frustumCorners = new Array(8).fill().map(() => new THREE.Vector3());

        // Debug
        this.debugHelpers = [];
        this.showDebug = false;

        this._initShadowLights();
        this._initCascades();
    }

    _initShadowLights() {
        // Sun directional light với shadow
        this.sunLight = new THREE.DirectionalLight(0xFFFFFF, 1);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.bias = this.config.bias;
        this.sunLight.shadow.normalBias = this.config.normalBias;
        this.sunLight.shadow.mapSize.set(this.config.resolution, this.config.resolution);
        this.scene.add(this.sunLight);

        // Moon light (weak shadow at night)
        this.moonLight = new THREE.DirectionalLight(0x6688CC, 0.15);
        this.moonLight.castShadow = true;
        this.moonLight.shadow.bias = this.config.bias * 2;
        this.moonLight.shadow.normalBias = this.config.normalBias * 1.5;
        this.moonLight.shadow.mapSize.set(512, 512); // Moon shadow luôn thấp hơn
        this.moonLight.shadow.camera.near = 10;
        this.moonLight.shadow.camera.far = 300;
        this.moonLight.shadow.camera.left = -100;
        this.moonLight.shadow.camera.right = 100;
        this.moonLight.shadow.camera.top = 100;
        this.moonLight.shadow.camera.bottom = -100;
        this.scene.add(this.moonLight);
    }

    _initCascades() {
        const res = this.config.resolution;
        this.cascades = [];
        this.shadowCameras = [];
        this.shadowMaps = [];

        for (let i = 0; i < this.cascadeCount; i++) {
            // Tạo shadow map cho mỗi cascade
            const shadowMap = new THREE.WebGLRenderTarget(res, res, {
                type: THREE.FloatType,
                format: THREE.DepthFormat,
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                generateMipmaps: false,
                depthBuffer: true,
                stencilBuffer: false,
            });
            shadowMap.texture.name = `SunShadowMap_Cascade${i}`;
            this.shadowMaps.push(shadowMap);

            // Camera cho cascade này
            const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
            this.shadowCameras.push(cam);

            this.cascades.push({
                map: shadowMap,
                camera: cam,
                splitDepth: 0,
                viewProjMatrix: new THREE.Matrix4(),
                splitMatrix: new THREE.Matrix4(),
            });
        }
    }

    // Cập nhật quality preset
    setQuality(quality) {
        if (SHADOW_QUALITY[quality] && quality !== this.quality) {
            this.quality = quality;
            this.config = SHADOW_QUALITY[quality];
            this._rebuildCascades();
            this._applyLightSettings();
        }
    }

    _rebuildCascades() {
        // Dispose old
        for (const rt of this.shadowMaps) {
            rt.dispose();
        }
        this.cascadeCount = this.config.cascades;
        this._initCascades();
        this._applyLightSettings();
    }

    _applyLightSettings() {
        if (this.sunLight) {
            this.sunLight.shadow.bias = this.config.bias;
            this.sunLight.shadow.normalBias = this.config.normalBias;
            this.sunLight.shadow.mapSize.set(this.config.resolution, this.config.resolution);
        }
    }

    // Gọi khi renderer.resize()
    onResize() {
        // Shadow maps không phụ thuộc screen size
    }

    // Cập nhật player position để căn chỉnh cascade
    setPlayerPosition(position, direction, camera) {
        this.playerPosition.copy(position);
        if (direction) this.playerDirection.copy(direction);
        this.cameraRef = camera;
    }

    // Cập nhật sun direction từ TimeSystem
    updateSunDirection(direction, intensity) {
        if (this.sunLight) {
            this.sunLight.position.copy(direction).multiplyScalar(-1).normalize();
            this.sunLight.target.position.copy(this.playerPosition);
            this.sunLight.intensity = intensity;
            this._updateCascades();
        }
    }

    // Cập nhật moon direction
    updateMoonDirection(direction, intensity) {
        if (this.moonLight) {
            this.moonLight.position.copy(direction).multiplyScalar(-1).normalize();
            this.moonLight.target.position.copy(this.playerPosition);
            this.moonLight.intensity = intensity;
        }
    }

    // Core: cập nhật cascade split depths và view-projection matrices
    _updateCascades() {
        if (!this.cameraRef) return;

        const camera = this.cameraRef;
        const lightDir = this.sunLight.position.clone().normalize();
        const distances = this.config.distances;
        const far = distances[distances.length - 1];
        const near = camera.near;
        const farPlane = camera.far;

        // Tính split depths (PSSM: Practical Split Scheme)
        for (let i = 0; i < this.cascadeCount; i++) {
            const id = i / (this.cascadeCount - 1);
            const uniform = near + (far - near) * id;
            const logarithmic = near * Math.pow(far / near, id);
            this.splitDepths[i] = THREE.MathUtils.lerp(uniform, logarithmic, this.lambda);
        }
        this.splitDepths[this.cascadeCount] = far;

        // Lấy frustum corners của camera
        this._getFrustumCorners(camera);

        // Tính view-projection cho từng cascade
        for (let i = 0; i < this.cascadeCount; i++) {
            const cascade = this.cascades[i];
            const splitNear = i === 0 ? near : this.splitDepths[i];
            const splitFar = this.splitDepths[i + 1];

            this._fitCascadeToFrustumSlice(cascade, lightDir, splitNear, splitFar);

            // View-projection matrix cho shader
            cascade.viewProjMatrix.multiplyMatrices(cascade.camera.projectionMatrix, cascade.camera.matrixWorldInverse);
            cascade.splitMatrix.copy(cascade.viewProjMatrix);
        }

        // Cập nhật sunLight.shadow.camera cho cascade đầu (fallback)
        this.sunLight.shadow.camera.copy(this.cascades[0].camera);
    }

    _getFrustumCorners(camera) {
        const proj = camera.projectionMatrix;
        const view = camera.matrixWorldInverse;
        const viewProj = this._tmpMat4.multiplyMatrices(proj, view);
        // Three r160: Matrix4.getInverse() đã bị XOÁ -> dùng invert() tại chỗ
        // (viewProj chính là _tmpMat4, và sau này chỉ dùng invViewProj nên an toàn)
        const invViewProj = this._tmpMat4.invert();

        // 8 corners của NDC cube
        const corners = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], // near
            [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],  // far
        ];

        for (let i = 0; i < 8; i++) {
            const c = corners[i];
            this._tmpVec4.set(c[0], c[1], c[2], 1).applyMatrix4(invViewProj);
            const w = this._tmpVec4.w;
            this._frustumCorners[i].set(
                this._tmpVec4.x / w,
                this._tmpVec4.y / w,
                this._tmpVec4.z / w
            );
        }
    }

    _fitCascadeToFrustumSlice(cascade, lightDir, splitNear, splitFar) {
        const camera = this.cameraRef;
        if (!camera) return;

        // Lấy 8 corners của frustum slice này
        const sliceCorners = [];
        for (let i = 0; i < 8; i++) {
            const corner = this._frustumCorners[i].clone();
            // Interpolate giữa near/far plane
            const t = i < 4 ? 0 : 1;
            const z = THREE.MathUtils.lerp(splitNear, splitFar, t);
            corner.z = -z; // camera space: -Z là forward
            // Convert từ camera space sang world space
            corner.applyMatrix4(camera.matrixWorld);
            sliceCorners.push(corner);
        }

        // Tính bounding sphere của slice corners trong light space
        const lightView = this._lightViewMatrix;
        lightView.lookAt(this.playerPosition, this.playerPosition.clone().add(lightDir), new THREE.Vector3(0, 1, 0));

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const corner of sliceCorners) {
            this._tmpVec3.copy(corner).applyMatrix4(lightView);
            minX = Math.min(minX, this._tmpVec3.x);
            maxX = Math.max(maxX, this._tmpVec3.x);
            minY = Math.min(minY, this._tmpVec3.y);
            maxY = Math.max(maxY, this._tmpVec3.y);
            minZ = Math.min(minZ, this._tmpVec3.z);
            maxZ = Math.max(maxZ, this._tmpVec3.z);
        }

        // Padding để tránh shadow acne ở mép
        const padding = 10;
        minX -= padding; maxX += padding;
        minY -= padding; maxY += padding;
        minZ -= padding; maxZ += padding;

        // Orthographic camera cho cascade
        const cam = cascade.camera;
        cam.left = minX;
        cam.right = maxX;
        cam.top = maxY;
        cam.bottom = minY;
        cam.near = -maxZ;
        cam.far = -minZ;
        cam.updateProjectionMatrix();

        // World matrix của light camera
        cam.matrixWorld.copy(lightView).invert();
        cam.matrixWorldInverse.copy(lightView);
        cascade.splitDepth = splitFar;
    }

    // Render shadow maps (gọi trước render scene chính)
    renderShadows() {
        if (!this.sunLight || this.sunLight.intensity <= 0) return;

        const renderer = this.renderer;
        const scene = this.scene;
        const prevAutoClear = renderer.autoClear;
        const prevRenderTarget = renderer.getRenderTarget();
        const prevShadowAutoUpdate = this.sunLight.shadow.autoUpdate;

        renderer.autoClear = true;
        this.sunLight.shadow.autoUpdate = false;

        // Render từng cascade
        for (let i = 0; i < this.cascadeCount; i++) {
            const cascade = this.cascades[i];
            const cam = cascade.camera;

            // Set render target
            renderer.setRenderTarget(cascade.map);
            renderer.clearDepth();

            // Render scene từ góc nhìn light
            // Override material cho shadow pass
            const prevOverride = scene.overrideMaterial;
            scene.overrideMaterial = this._createShadowMaterial(cam.near, cam.far);

            renderer.render(scene, cam);

            scene.overrideMaterial = prevOverride;
        }

        // Restore
        renderer.setRenderTarget(prevRenderTarget);
        renderer.autoClear = prevAutoClear;
        this.sunLight.shadow.autoUpdate = prevShadowAutoUpdate;
    }

    _createShadowMaterial(near, far) {
        // Material depth-only cho shadow pass
        const material = new THREE.MeshDepthMaterial({
            depthPacking: THREE.RGBADepthPacking,
            map: null,
            alphaTest: 0.5,
        });
        material.userData.isShadowMaterial = true;
        return material;
    }

    // Moon shadow (single cascade, simple)
    renderMoonShadow() {
        if (!this.moonLight || this.moonLight.intensity <= 0.01) return;

        const renderer = this.renderer;
        const scene = this.scene;
        const prevRT = renderer.getRenderTarget();

        renderer.setRenderTarget(this.moonLight.shadow.map);
        renderer.clearDepth();

        const prevOverride = scene.overrideMaterial;
        scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        renderer.render(scene, this.moonLight.shadow.camera);
        scene.overrideMaterial = prevOverride;

        renderer.setRenderTarget(prevRT);
    }

    // Lấy dữ liệu cascade cho shader
    getCascadeData() {
        return {
            counts: this.cascadeCount,
            splits: this.splitDepths.slice(0, this.cascadeCount),
            matrices: this.cascades.map(c => c.viewProjMatrix),
            maps: this.cascades.map(c => c.map.texture),
            sunDirection: this.sunLight.position.clone().normalize(),
            sunColor: this.sunLight.color.clone(),
            sunIntensity: this.sunLight.intensity,
        };
    }

    getMoonShadowData() {
        return {
            map: this.moonLight.shadow.map.texture,
            matrix: new THREE.Matrix4().multiplyMatrices(
                this.moonLight.shadow.camera.projectionMatrix,
                this.moonLight.shadow.camera.matrixWorldInverse
            ),
            direction: this.moonLight.position.clone().normalize(),
            color: this.moonLight.color.clone(),
            intensity: this.moonLight.intensity,
        };
    }

    // Debug helpers
    toggleDebug(show) {
        this.showDebug = show;
        if (show) {
            this._createDebugHelpers();
        } else {
            this._removeDebugHelpers();
        }
    }

    _createDebugHelpers() {
        this._removeDebugHelpers();
        for (let i = 0; i < this.cascadeCount; i++) {
            const cascade = this.cascades[i];
            const helper = new THREE.CameraHelper(cascade.camera);
            helper.visible = true;
            this.scene.add(helper);
            this.debugHelpers.push(helper);
        }
        // Sun light helper
        const sunHelper = new THREE.DirectionalLightHelper(this.sunLight, 100);
        this.scene.add(sunHelper);
        this.debugHelpers.push(sunHelper);
    }

    _removeDebugHelpers() {
        for (const h of this.debugHelpers) {
            this.scene.remove(h);
            if (h.dispose) h.dispose();
        }
        this.debugHelpers = [];
    }

    // Contact shadow (screen-space, cheap)
    // Trả về config cho contact shadow shader
    getContactShadowConfig() {
        return {
            enabled: true,
            opacity: 0.4,
            radius: 4, // pixels
            bias: 0.02,
            fadeDistance: 50,
        };
    }

    dispose() {
        for (const rt of this.shadowMaps) {
            rt.dispose();
        }
        if (this.moonLight?.shadow?.map) {
            this.moonLight.shadow.map.dispose();
        }
        this._removeDebugHelpers();
        if (this.sunLight) this.scene.remove(this.sunLight);
        if (this.moonLight) this.scene.remove(this.moonLight);
    }
}

// Contact Shadow Shader (screen-space)
// Dùng cho bánh xe, thân xe, vật thể gần ground
export const ContactShadowShader = {
    uniforms: {
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 2000 },
        lightDirection: { value: new THREE.Vector3() },
        lightColor: { value: new THREE.Color(0x000000) },
        opacity: { value: 0.4 },
        radius: { value: 4 },
        bias: { value: 0.02 },
        fadeDistance: { value: 50 },
        resolution: { value: new THREE.Vector2() },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec3 lightDirection;
        uniform vec3 lightColor;
        uniform float opacity;
        uniform int radius;
        uniform float bias;
        uniform float fadeDistance;
        uniform vec2 resolution;
        varying vec2 vUv;

        float readDepth(vec2 uv) {
            vec4 packed = texture2D(tDepth, uv);
            return packed.r + packed.g * (1.0/255.0) + packed.b * (1.0/65025.0) + packed.a * (1.0/16581375.0);
        }

        float linearizeDepth(float d) {
            return (2.0 * cameraNear) / (cameraFar + cameraNear - d * (cameraFar - cameraNear));
        }

        void main() {
            float centerDepth = linearizeDepth(readDepth(vUv));
            float shadow = 0.0;
            vec2 texel = 1.0 / resolution;

            for (int x = -2; x <= 2; x++) {
                for (int y = -2; y <= 2; y++) {
                    vec2 offset = vec2(float(x), float(y)) * texel * float(radius) * 0.5;
                    float sampleDepth = linearizeDepth(readDepth(vUv + offset));
                    float diff = sampleDepth - centerDepth - bias;
                    if (diff > 0.0) {
                        shadow += smoothstep(0.0, 0.1, diff);
                    }
                }
            }

            shadow /= 25.0;
            shadow = 1.0 - shadow;
            shadow = pow(shadow, 2.0);

            // Fade với distance
            float fade = smoothstep(0.0, fadeDistance, centerDepth);
            shadow *= fade;

            gl_FragColor = vec4(lightColor * (1.0 - shadow) * opacity, opacity * (1.0 - shadow));
        }
    `,
};