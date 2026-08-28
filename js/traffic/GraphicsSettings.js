// js/traffic/GraphicsSettings.js - Quản lý graphics settings + render distance
import { createSeededRandom } from "../utils.js";

export const GRAPHICS_PRESETS = {
    VERY_LOW: {
        label: 'Rất thấp',
        renderDistance: 4,        // chunks
        objectDistance: 150,       // units
        trafficDensity: 0.15,
        maxActiveTraffic: 8,
        spawnDistance: 100,
        despawnDistance: 200,
        shadows: false,
        bloom: false,
        antialiasing: false,
        textureQuality: 0.5,
        lodBias: 2,
    },
    LOW: {
        label: 'Thấp',
        renderDistance: 6,
        objectDistance: 200,
        trafficDensity: 0.3,
        maxActiveTraffic: 15,
        spawnDistance: 150,
        despawnDistance: 300,
        shadows: false,
        bloom: false,
        antialiasing: false,
        textureQuality: 0.7,
        lodBias: 1.5,
    },
    MEDIUM: {
        label: 'Trung bình',
        renderDistance: 10,
        objectDistance: 300,
        trafficDensity: 0.5,
        maxActiveTraffic: 25,
        spawnDistance: 200,
        despawnDistance: 400,
        shadows: true,
        bloom: true,
        antialiasing: true,
        textureQuality: 1.0,
        lodBias: 1.0,
    },
    HIGH: {
        label: 'Cao',
        renderDistance: 15,
        objectDistance: 450,
        trafficDensity: 0.7,
        maxActiveTraffic: 40,
        spawnDistance: 300,
        despawnDistance: 600,
        shadows: true,
        bloom: true,
        antialiasing: true,
        textureQuality: 1.0,
        lodBias: 0.7,
    },
    VERY_HIGH: {
        label: 'Rất cao',
        renderDistance: 20,
        objectDistance: 600,
        trafficDensity: 1.0,
        maxActiveTraffic: 60,
        spawnDistance: 400,
        despawnDistance: 800,
        shadows: true,
        bloom: true,
        antialiasing: true,
        textureQuality: 1.0,
        lodBias: 0.5,
    },
};

export class GraphicsSettings {
    constructor() {
        this.currentPreset = 'MEDIUM';
        this.settings = { ...GRAPHICS_PRESETS.MEDIUM };
        this.callbacks = [];
        
        // Load từ localStorage nếu có
        this.load();
    }

    get(key) {
        return this.settings[key];
    }

    setPreset(preset) {
        if (!GRAPHICS_PRESETS[preset]) return;
        this.currentPreset = preset;
        this.settings = { ...GRAPHICS_PRESETS[preset] };
        this.save();
        this._notify();
    }

    set(key, value) {
        this.settings[key] = value;
        this.save();
        this._notify();
    }

    save() {
        try {
            localStorage.setItem('coachvn_graphics', JSON.stringify({
                preset: this.currentPreset,
                settings: this.settings
            }));
        } catch (e) {}
    }

    load() {
        try {
            const raw = localStorage.getItem('coachvn_graphics');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.preset && GRAPHICS_PRESETS[data.preset]) {
                this.currentPreset = data.preset;
                this.settings = { ...GRAPHICS_PRESETS[data.preset] };
                // Override với settings đã lưu nếu có
                if (data.settings) {
                    Object.assign(this.settings, data.settings);
                }
            }
        } catch (e) {}
    }

    onChange(callback) {
        this.callbacks.push(callback);
    }

    _notify() {
        for (const cb of this.callbacks) {
            cb(this.settings, this.currentPreset);
        }
    }

    // Helper để áp dụng vào renderer
    applyToRenderer(renderer, scene) {
        const dist = this.get('renderDistance') * 16; // chunkSize = 16
        if (scene.fog) {
            scene.fog.far = dist * 2.5;
            scene.fog.near = dist * 0.4;
        }
        if (renderer) {
            renderer.shadowMap.enabled = this.get('shadows');
            renderer.setPixelRatio(this.get('textureQuality') * 1.5);
        }
    }

    // Helper để lấy traffic density
    getTrafficDensity() {
        return this.get('trafficDensity');
    }

    getMaxActiveTraffic() {
        return this.get('maxActiveTraffic');
    }

    getSpawnDistance() {
        return this.get('spawnDistance');
    }

    getDespawnDistance() {
        return this.get('despawnDistance');
    }

    getRenderDistance() {
        return this.get('renderDistance');
    }
}

// Singleton
let instance = null;
export function getGraphicsSettings() {
    if (!instance) {
        instance = new GraphicsSettings();
    }
    return instance;
}