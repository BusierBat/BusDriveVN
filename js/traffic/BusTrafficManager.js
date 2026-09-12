// js/traffic/BusTrafficManager.js

import * as THREE from "three";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList, BUS_DIMENSIONS } from "../bus.js";
import { BusTrafficAI, BUS_AI_CONFIG } from "./BusTrafficAI.js";
import { createSeededRandom } from "../utils.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";


export const BUS_TRAFFIC_CONFIG = {
    vehicleTypeWeights: {
        BUS: 60,
        TRUCK: 15,
        CAR: 15,
        MOTORCYCLE: 10,
    },

    maxActiveBuses: 20,
    maxActiveOthers: 10,

    spawnInterval: 3.0,
    spawnAheadBias: 0.7,

    poolSize: 30,
    poolEnabled: true,

    despawnDistance: 350,

    minSpawnDistanceFromPlayer: 120,
    minSpawnDistanceFromOther: 25,
    maxSpawnAttempts: 10,
};


export class BusTrafficManager {
    constructor({
        scene,
        roadGraph,
        playerRef = null,
        config = {},
    }) {
        this.scene = scene;
        this.roadGraph = roadGraph;
        this.playerRef = playerRef;
        this.config = { ...BUS_TRAFFIC_CONFIG, ...config };

        this.busAIVehicles = [];

        this.busPool = [];

        this.spawnTimer = 0;

        this.seed = Date.now();
        this.random = createSeededRandom(this.seed);

        this.graphics = getGraphicsSettings();
        this.graphics.onChange(() => this._onSettingsChanged());

        this.skinsLoaded = false;
        this.skinsLoading = false;

        this._initSkins();

        console.log("🚌 BusTrafficManager initialized (waiting for skins...)");
    }


    async _initSkins() {
        if (this.skinsLoading || this.skinsLoaded) return;
        this.skinsLoading = true;

        try {
            await loadNpcSkinList();
            this.skinsLoaded = true;
            this.skinsLoading = false;

            console.log("✅ NPC skins loaded! Spawning initial traffic...");
            this._spawnInitialTraffic();

        } catch (err) {
            console.warn("⚠️ Failed to load NPC skins:", err);
            this.skinsLoaded = true;
            this.skinsLoading = false;
            this._spawnInitialTraffic();
        }
    }


    update(deltaTime, playerPos) {
        if (!playerPos) return;

        if (!this.skinsLoaded) return;

        this._updateBusAI(deltaTime, playerPos);

        this._checkDespawn(playerPos);

        this.spawnTimer += deltaTime;
        if (this.spawnTimer >= this.config.spawnInterval) {
            this.spawnTimer = 0;
            this._trySpawnTraffic(playerPos);
        }
    }

    _updateBusAI(deltaTime, playerPos) {
        const allVehicles = [...this.busAIVehicles];

        for (const ai of this.busAIVehicles) {
            ai.update(deltaTime, playerPos, allVehicles);
        }
    }


    _spawnInitialTraffic() {
        const initialBuses = Math.min(
            8,
            Math.floor(this.config.maxActiveBuses * 0.4)
        );

        for (let i = 0; i < initialBuses; i++) {
            this._spawnBusVehicle(true);
        }

        console.log(`🚌 Spawned ${initialBuses} initial NPC buses`);
    }

    _trySpawnTraffic(playerPos) {
        const activeBuses = this.busAIVehicles.length;

        if (activeBuses >= this.config.maxActiveBuses) {
            return;
        }

        const vehicleType = this._chooseVehicleType();

        if (vehicleType === 'BUS') {
            this._spawnBusVehicle(false, playerPos);
        }
    }

    _chooseVehicleType() {
        const weights = this.config.vehicleTypeWeights;
        const total = Object.values(weights).reduce((a, b) => a + b, 0);

        let roll = this.random() * total;

        for (const [type, weight] of Object.entries(weights)) {
            roll -= weight;
            if (roll <= 0) return type;
        }

        return 'BUS';
    }

    _spawnBusVehicle(initialSpawn = false, playerPos = null) {
        if (!this.skinsLoaded) {
            console.warn("⚠️ Cannot spawn: skins not loaded yet");
            return null;
        }

        let busVehicle = this._getBusFromPool();

        if (!busVehicle) {
            const skinPath = pickNpcSkinPath();
            busVehicle = createNpcBus({
                skinPath: skinPath,
                ledColor: pickLedColor()
            });

            if (!busVehicle) {
                console.warn("Failed to create NPC bus");
                return null;
            }

            this.scene.add(busVehicle.group);
        }

        const spawnLocation = this._findSpawnLocation(playerPos, initialSpawn);
        if (!spawnLocation) {
            this._returnBusToPool(busVehicle);
            return null;
        }

        const ai = new BusTrafficAI({
            vehicle: busVehicle,
            roadGraph: this.roadGraph,
            seed: this.random() * 999999,
            config: BUS_AI_CONFIG
        });

        ai.currentSegmentIndex = spawnLocation.segmentIndex;
        ai.progress = spawnLocation.progress;
        ai._setLaneForSegment(this.roadGraph[spawnLocation.segmentIndex]);
        ai._updatePositionFromSegment();
        ai._applyToVehicle();

        ai.speed = ai.maxSpeed * (0.6 + this.random() * 0.3);
        ai.targetSpeed = ai.maxSpeed * 0.8;

        this.busAIVehicles.push(ai);

        return ai;
    }

    _findSpawnLocation(playerPos, initialSpawn = false) {
        if (!this.roadGraph || this.roadGraph.length === 0) return null;

        for (let attempt = 0; attempt < this.config.maxSpawnAttempts; attempt++) {
            const segIndex = Math.floor(this.random() * this.roadGraph.length);
            const seg = this.roadGraph[segIndex];

            if (!seg || !seg.points) continue;

            const progress = 0.2 + this.random() * 0.6;

            const p0 = seg.points[0];
            const p1 = seg.points[1];
            const x = p0.x + (p1.x - p0.x) * progress;
            const z = p0.z + (p1.z - p0.z) * progress;

            if (playerPos) {
                const distToPlayer = Math.hypot(x - playerPos.x, z - playerPos.z);

                if (initialSpawn) {
                    if (distToPlayer < 80) continue;
                } else {
                    if (distToPlayer < this.config.minSpawnDistanceFromPlayer) continue;
                    if (distToPlayer > this.config.despawnDistance * 0.8) continue;
                }
            }

            let tooClose = false;
            for (const ai of this.busAIVehicles) {
                const otherPos = ai.vehicle.group.position;
                const dist = Math.hypot(x - otherPos.x, z - otherPos.z);

                if (dist < this.config.minSpawnDistanceFromOther) {
                    tooClose = true;
                    break;
                }
            }

            if (tooClose) continue;

            return {
                segmentIndex: segIndex,
                progress: progress,
                x: x,
                z: z
            };
        }

        return null;
    }


    _getBusFromPool() {
        if (!this.config.poolEnabled || this.busPool.length === 0) {
            return null;
        }

        const bus = this.busPool.pop();
        if (bus?.group) {
            bus.group.visible = true;
            if (bus.setDoor) bus.setDoor(0);
            if (bus.setHeadlights) bus.setHeadlights(false);
        }
        return bus;
    }

    _returnBusToPool(busVehicle) {
        if (!busVehicle) return;

        if (this.config.poolEnabled && this.busPool.length < this.config.poolSize) {
            busVehicle.group.visible = false;
            this.busPool.push(busVehicle);
        } else {
            this._disposeBus(busVehicle);
        }
    }

    _disposeBus(busVehicle) {
        if (!busVehicle) return;
        this.scene.remove(busVehicle.group);
        if (busVehicle.dispose) {
            busVehicle.dispose();
        }
    }


    _checkDespawn(playerPos) {
        for (let i = this.busAIVehicles.length - 1; i >= 0; i--) {
            const ai = this.busAIVehicles[i];

            if (ai.shouldDespawn(playerPos)) {
                this._despawnBus(i);
                continue;
            }

            if (ai.state === 'STOPPED' && ai.speed === 0 && ai.distanceToAhead === Infinity) {
                this._despawnBus(i);
            }
        }
    }

    _despawnBus(index) {
        const ai = this.busAIVehicles[index];
        if (!ai) return;

        ai.collider.active = false;
        ai.dispose();
        this._returnBusToPool(ai.vehicle);
        this.busAIVehicles.splice(index, 1);
    }


    getColliders() {
        const colliders = [];

        for (const ai of this.busAIVehicles) {
            if (ai.collider.active && ai.vehicle?.group?.visible) {
                colliders.push({
                    x: ai.collider.x,
                    z: ai.collider.z,
                    r: ai.collider.r,
                    width: ai.collider.width,
                    length: ai.collider.length,
                    rotation: ai.collider.rotation,
                    type: 'BUS_NPC',
                    ai: ai
                });
            }
        }

        return colliders;
    }

    getActiveBusCount() {
        return this.busAIVehicles.length;
    }

    getBusAIVehicles() {
        return this.busAIVehicles;
    }


    _onSettingsChanged() {
        const settings = this.graphics.settings;

        if (settings.trafficDensity !== undefined) {
            this.config.maxActiveBuses = Math.floor(
                BUS_TRAFFIC_CONFIG.maxActiveBuses * settings.trafficDensity
            );
        }
    }


    getDebugInfo() {
        return {
            activeBuses: this.busAIVehicles.length,
            poolSize: this.busPool.length,
            skinsLoaded: this.skinsLoaded,
            spawnTimer: this.spawnTimer.toFixed(2),
            maxActiveBuses: this.config.maxActiveBuses,
        };
    }


    dispose() {
        for (const ai of this.busAIVehicles) {
            ai.dispose();
        }
        this.busAIVehicles = [];

        for (const bus of this.busPool) {
            this._disposeBus(bus);
        }
        this.busPool = [];

        console.log("🚌 BusTrafficManager disposed");
    }
}
