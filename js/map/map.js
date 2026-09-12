// js/map/map.js

import * as THREE from "three";
import { generateChunk } from "./chunkGenerator.js";
import { createRoadNetworkMesh } from "./roadGenerator.js";
import { createBusStation, createRestStop, createGasStation, createTollStation, createPark } from "./stationGenerator.js";
import { getSpawnPoint as getRouteSpawn, getRouteWaypoints, getMinimapData, getWorldBounds, getPOIs } from "./data/routeData.js";
import { roadNetwork } from "./data/roadNetworkData.js";

const CHUNK_SIZE = 256;
const RENDER_DISTANCE_CHUNKS = 2;
const WORLD_SEED = 20260817;

export function createMap({ scene, seed = WORLD_SEED, lighting } = {}) {
    const group = new THREE.Group();
    group.name = "map";
    scene.add(group);
    const roadMesh = createRoadNetworkMesh(roadNetwork);
    group.add(roadMesh);
    
    const pois = getPOIs();
    const parkingSlots = [];
    for (const poi of pois) {
        if (poi.type === 'bus_station') createBusStation(poi, group, parkingSlots);
        else if (poi.type === 'rest_area') createRestStop(poi, group);
        else if (poi.type === 'fuel_station') createGasStation(poi, group);
        else if (poi.type === 'toll_station') createTollStation(poi, group);
        else if (poi.type === 'park') createPark(poi, group);
    }
    
    const chunks = new Map();
    const staticColliders = [];
    const chunkBuildQueue = [];
    const worldSeed = seed;
    let chunkBuildTimer = 0;

    function buildChunk(cx, cz) {
        const key = `${cx},${cz}`;
        if (chunks.has(key)) return;
        
        const chunkGroup = generateChunk({ chunkX: cx, chunkZ: cz, worldSeed, chunkSize: CHUNK_SIZE, parkingSlots });
        if (chunkGroup) {
            group.add(chunkGroup);
            const chunkColliders = chunkGroup.userData.colliders || [];
            
            const regIds = [];
            for (const c of chunkColliders) {
                if (window.collisionSystem) {
                    const id = window.collisionSystem.register(c.x, c.z, c.r, 'static');
                    regIds.push(id);
                }
            }
            
            chunks.set(key, { group: chunkGroup, x: cx, z: cz, colliderIds: regIds });
            staticColliders.push(...chunkColliders);
        }
    }

    function unloadChunk(cx, cz) {
        const key = `${cx},${cz}`;
        const entry = chunks.get(key);
        if (!entry) return;
        
        group.remove(entry.group);
        entry.group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
        });
        
        if (window.collisionSystem) {
            for (const id of entry.colliderIds) window.collisionSystem.remove(id);
        }
        
        if (entry.colliderIds.length > 0) {
            const removeSet = new Set(entry.colliderIds);
            for (let i = staticColliders.length - 1; i >= 0; i--) {
                if (removeSet.has(staticColliders[i])) staticColliders.splice(i, 1);
            }
        }
        chunks.delete(key);
    }

    let lastPlayerChunkX = null, lastPlayerChunkZ = null;
    function updateChunks(playerX, playerZ) {
        const cx = Math.floor(playerX / CHUNK_SIZE);
        const cz = Math.floor(playerZ / CHUNK_SIZE);
        if (cx === lastPlayerChunkX && cz === lastPlayerChunkZ) return;
        lastPlayerChunkX = cx; lastPlayerChunkZ = cz;
        
        const needed = new Set();
        const dist = RENDER_DISTANCE_CHUNKS;
        for (let dx = -dist; dx <= dist; dx++) {
            for (let dz = -dist; dz <= dist; dz++) {
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d <= dist + 0.5) needed.add(`${cx + dx},${cz + dz}`);
            }
        }
        
        for (const [key, entry] of chunks) if (!needed.has(key)) unloadChunk(entry.x, entry.z);
        
        chunkBuildQueue.length = 0;
        for (const key of needed) {
            if (!chunks.has(key)) {
                const parts = key.split(",");
                chunkBuildQueue.push({ x: parseInt(parts[0]), z: parseInt(parts[1]) });
            }
        }
    }

    const spawn = getRouteSpawn();
    const cx0 = Math.floor(spawn.x / CHUNK_SIZE);
    const cz0 = Math.floor(spawn.z / CHUNK_SIZE);
    
    buildChunk(cx0, cz0);
    
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            chunkBuildQueue.push({ x: cx0 + dx, z: cz0 + dz });
        }
    }
    updateChunks(spawn.x, spawn.z);

    function processQueue() {
        chunkBuildTimer++;
        if (chunkBuildTimer < 10) return;
        chunkBuildTimer = 0;
        
        if (chunkBuildQueue.length > 0) {
            const next = chunkBuildQueue.shift();
            buildChunk(next.x, next.z);
        }
    }

    return {
        group,
        bounds: getWorldBounds(),
        ready: Promise.resolve(),
        setPlayerPosition: (x, z) => {
            updateChunks(x, z);
            processQueue();
        },
        getHeight: () => 0,
        getRoadHeightAt: () => 0.1,
        getSpawnPoint: () => getRouteSpawn(),
        getRouteWaypoints,
        getMinimapData,
        getNearbyColliders: (x, z, r=50) => staticColliders.filter(c => Math.hypot(c.x - x, c.z - z) < r),
        getRoadGraph: (() => {
            let _cached = null;
            return () => {
                if (!_cached) {
                    const nodeMap = new Map();
                    roadNetwork.nodes.forEach(n => nodeMap.set(n.id, { x: n.position.x, z: n.position.z }));
                    const edges = roadNetwork.segments.map(s => {
                        const f = nodeMap.get(s.from), t = nodeMap.get(s.to);
                        return f && t ? { from: s.from, to: s.to, points: [{x:f.x,z:f.z}, {x:t.x,z:t.z}], width: 24, type: s.type, twoWay: s.twoWay } : null;
                    }).filter(Boolean);
                    _cached = { nodes: nodeMap, edges };
                }
                return _cached;
            };
        })(),
        getPOIs: () => getPOIs(),
        getParkingSlots: () => parkingSlots,
        dispose: () => {
            for (const entry of chunks.values()) {
                group.remove(entry.group);
                entry.group.traverse(child => { if (child.geometry) child.geometry.dispose(); });
            }
            chunks.clear();
            scene.remove(group);
        }
    };
}