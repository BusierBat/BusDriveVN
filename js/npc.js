// js/npc.js
import * as THREE from "three";
import { clamp, randomFloat, pick, createSeededRandom, disposeObject3D } from "./utils.js";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "./bus.js";

const TWO_PI = Math.PI * 2;
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; return d; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function lerpAngle(a, b, t) { let diff = b - a; while (diff > Math.PI) diff -= TWO_PI; while (diff < -Math.PI) diff += TWO_PI; return a + diff * clamp(t, 0, 1); }

export class BusStationManager {
    constructor(scene, map, parkingSlots, playerSpawnPos) {
        this.scene = scene; this.map = map; this.parkingSlots = parkingSlots || [];
        this.playerSpawnPos = playerSpawnPos || null;
        this.stationBuses = [];
        this.busGroup = new THREE.Group();
        this.scene.add(this.busGroup);
        this.maxStaticBuses = 7;
        this.spawnTimer = 0;
        this.spawnQueue = [];
        this.prepareStationSpawns();
    }
    prepareStationSpawns() {
        const availableSlots = this.parkingSlots.filter(s => !s.occupied);
        let selectedSlots = availableSlots.slice(0, this.maxStaticBuses);
        if (this.playerSpawnPos) {
            const spawnX = this.playerSpawnPos.x, spawnZ = this.playerSpawnPos.z;
            selectedSlots = selectedSlots.filter(slot => Math.hypot(slot.position.x - spawnX, slot.position.z - spawnZ) > 20);
        }
        for (const slot of selectedSlots) { this.spawnQueue.push(slot); }
        for (let i = 0; i < Math.min(3, this.spawnQueue.length); i++) { this._spawnOneBus(this.spawnQueue.shift()); }
    }
    _spawnOneBus(slot) {
        if (!slot) return;
        const bus = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
        bus.group.position.set(slot.position.x, 0.5, slot.position.z);
        bus.group.rotation.y = slot.rotation || 0;
        slot.occupied = true;
        this.busGroup.add(bus.group);
        this.stationBuses.push({ bus, state: 'PARKED' });
    }
    update(dt) {
        if (this.spawnQueue.length > 0) {
            this.spawnTimer += dt;
            if (this.spawnTimer >= 0.5) { this.spawnTimer = 0; this._spawnOneBus(this.spawnQueue.shift()); }
        }
    }
    dispose() { if (this.busGroup.parent) this.busGroup.parent.remove(this.busGroup); }
}

export class TrafficSpawnManager {
    constructor({ scene, edges, edgePaths, random, group, targetActive, maxActive, spawnDistance, despawnDistance, seed }) {
        this.scene = scene; this.edges = edges; this.edgePaths = edgePaths;
        this.random = random; this.group = group; this.targetActive = targetActive;
        this.maxActive = maxActive; this.spawnDistance = spawnDistance;
        this.despawnDistance = despawnDistance; this.seed = seed;
        this.activeVehicles = []; this.pool = [];
        this._spawnInitial();
    }
    _spawnInitial() { for (let i = 0; i < this.targetActive; i++) this._spawn(null, null); }
    _spawn(playerPos, playerHeading) {
        let vehicle = this.pool.pop();
        if (!vehicle) { vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() }); this.group.add(vehicle.group); }
        for (let attempt = 0; attempt < 5; attempt++) {
            const edge = this.edges[Math.floor(this.random() * this.edges.length)];
            if (!edge || !edge.points) continue;
            if (edge.type === 'bus_station_road' && this.random() > 0.1) continue;
            const path = edge.points; const progress = this.random(); const pos = this._getPosOnPath(path, progress);
            if (playerPos) {
                const dx = pos.x - playerPos.x, dz = pos.z - playerPos.z, distToPlayer = Math.hypot(dx, dz);
                if (distToPlayer < 150) continue;
                if (playerHeading) { const forwardX = Math.sin(playerHeading), forwardZ = Math.cos(playerHeading); if (dx * forwardX + dz * forwardZ > 0 && distToPlayer < 300) continue; }
            }
            let overlap = false;
            for (let i = 0; i < this.activeVehicles.length; i++) { if (Math.hypot(pos.x - this.activeVehicles[i].vehicle.group.position.x, pos.z - this.activeVehicles[i].vehicle.group.position.z) < 25) { overlap = true; break; } }
            if (overlap) continue;
            vehicle.group.position.set(pos.x, 0.5, pos.z); vehicle.group.rotation.y = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
            this.activeVehicles.push({ vehicle, edge, progress, speed: 10 + this.random() * 10 }); return true;
        }
        this.pool.push(vehicle); return false;
    }
    _getPosOnPath(path, t) { const idx = Math.min(path.length - 2, Math.floor(t * (path.length - 1))); const localT = t * (path.length - 1) - idx; return { x: path[idx].x + (path[idx + 1].x - path[idx].x) * localT, z: path[idx].z + (path[idx + 1].z - path[idx].z) * localT }; }
    update(dt, playerPos, playerHeading) {
        const toRemove = [];
        for (let i = 0; i < this.activeVehicles.length; i++) {
            const v = this.activeVehicles[i]; if (!v || !v.vehicle) { toRemove.push(i); continue; }
            if (playerPos) { const dist = Math.hypot(v.vehicle.group.position.x - playerPos.x, v.vehicle.group.position.z - playerPos.z); if (dist > this.despawnDistance) { toRemove.push(i); continue; } }
            v.progress += (v.speed * dt) / (this.edgePaths.find(e => e === v.edge)?.total || 1000); if (v.progress >= 1) v.progress = 0;
            const pos = this._getPosOnPath(v.edge.points, v.progress); v.vehicle.group.position.x = pos.x; v.vehicle.group.position.z = pos.z;
        }
        for (let i = toRemove.length - 1; i >= 0; i--) { const v = this.activeVehicles[toRemove[i]]; if (v && v.vehicle) { v.vehicle.group.visible = false; this.pool.push(v.vehicle); } this.activeVehicles.splice(toRemove[i], 1); }
        while (this.activeVehicles.length < this.targetActive) if (!this._spawn(playerPos, playerHeading)) break;
    }
    getActiveCount() { return this.activeVehicles.length; }
    dispose() { this.activeVehicles.forEach(v => { if (v.vehicle?.group?.parent) v.vehicle.group.parent.remove(v.vehicle.group); }); }
}

export function createNPC({ scene, map, seed = 2027, playerBus = null, playerSpawnPos = null }) {
    if (!scene || !map) return { update() {}, dispose() {}, getWaitingPassengers: () => [] };
    const random = createSeededRandom(seed);
    const group = new THREE.Group(); group.name = "npc"; scene.add(group);
    
    // Sử dụng RuntimeRoadGraph từ MapLoader
    const graph = map.getRoadGraph();
    if (!graph) return { update() {}, dispose() {}, getWaitingPassengers: () => [] };
    
    const edges = graph.segments.map(s => {
        const f = graph.getNode(s.from);
        const t = graph.getNode(s.to);
        return f && t ? { from: s.from, to: s.to, points: [{x:f.x,z:f.z}, {x:t.x,z:t.z}], width: 24, type: s.roadType, twoWay: s.twoWay } : null;
    }).filter(Boolean);
    const edgePaths = edges.map((e) => { const cum = new Float32Array(e.points.length); let total = 0; for (let i = 1; i < e.points.length; i++) { total += Math.hypot(e.points[i].x - e.points[i-1].x, e.points[i].z - e.points[i-1].z); cum[i] = total; } return { cum, total: total || 1 }; });
    const spawnManager = new TrafficSpawnManager({ scene, edges, edgePaths, random, group, targetActive: 15, maxActive: 25, spawnDistance: 350, despawnDistance: 550, seed: seed + 999 });
    
    let stationManager = null;
    const parkingSlots = (map.getParkingSlots && map.getParkingSlots()) || [];
    if (parkingSlots.length > 0) { try { stationManager = new BusStationManager(scene, map, parkingSlots, playerSpawnPos); } catch (e) {} }
    
    let playerRef = playerBus || null;
    const playerScratch = { x: 0, z: 0 };
    function getPlayerPos() { if (!playerRef && scene) { for (const c of scene.children) if (c.name === "bus") { playerRef = c; break; } } if (playerRef && playerRef.group && playerRef.group.position) { playerScratch.x = playerRef.group.position.x; playerScratch.z = playerRef.group.position.z; return true; } return false; }

    let waitingPassengers = [];
    function generateWaitingPassengers() {
        waitingPassengers = [];
        const waypoints = graph.getRouteWaypoints();
        if (waypoints.length === 0) return;
        const stationNode = waypoints[0];
        for (let i = 0; i < 10; i++) {
            waitingPassengers.push({ id: `pass_station_${i}`, x: stationNode.x + (random() - 0.5) * 15, z: stationNode.z + (random() - 0.5) * 15, y: 0.5, destination: waypoints[waypoints.length - 1].id });
        }
        for (let i = 1; i < waypoints.length - 1; i++) {
            if (i > 10) break;
            const p1 = waypoints[i-1];
            const p2 = waypoints[i];
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const len = Math.hypot(dx, dz);
            if (len === 0) continue;
            const rx = dz / len;
            const rz = -dx / len;
            const offset = 15 + random() * 5;
            const side = random() > 0.5 ? 1 : -1;
            const x = p1.x + dx * 0.5 + rx * offset * side + (random() - 0.5) * 3;
            const z = p1.z + dz * 0.5 + rz * offset * side + (random() - 0.5) * 3;
            waitingPassengers.push({ id: `pass_road_${i}`, x, z, y: 0.5, destination: waypoints[waypoints.length - 1].id });
        }
    }
    generateWaitingPassengers();
    
    function update(dt, t = 0) {
        const hasPlayer = getPlayerPos(); let heading = 0;
        if (hasPlayer && playerRef && playerRef.group) heading = playerRef.group.rotation.y;
        spawnManager.update(dt, hasPlayer ? { x: playerScratch.x, z: playerScratch.z } : null, heading);
        if (stationManager) stationManager.update(dt);
    }
    
    function dispose() { if (scene) scene.remove(group); disposeObject3D(group); spawnManager.dispose(); if (stationManager) stationManager.dispose(); }
    
    return {
        group, update, dispose, getWaitingPassengers: () => waitingPassengers,
        pickUpPassenger: (id) => { const idx = waitingPassengers.findIndex(p => p.id === id); if (idx !== -1) { waitingPassengers.splice(idx, 1); return true; } return false; },
        getMovingVehicleCount: () => spawnManager.getActiveCount(), setPlayerBus(b) { playerRef = b; }
    };
}