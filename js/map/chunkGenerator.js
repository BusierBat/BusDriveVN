// js/map/chunkGenerator.js - DIVERSE ENVIRONMENT & PERFORMANCE
import * as THREE from "three";
import { generateBuildings } from "./buildingGenerator.js";
import { createRoadMeshForChunk } from "./roadGenerator.js";
import { roadNetwork } from "./data/roadNetworkData.js";

const sharedGroundGeo = new THREE.PlaneGeometry(256, 256);
const sharedTrunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 4, 6);
const sharedLeavesGeo = new THREE.SphereGeometry(2.5, 8, 8);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 });
const terrainMat = new THREE.MeshStandardMaterial({ color: 0x3a5f0b, roughness: 1 });

export function generateChunk({ chunkX, chunkZ, worldSeed, chunkSize, parkingSlots }) {
    const group = new THREE.Group();
    group.name = `chunk_${chunkX}_${chunkZ}`;
    
    let seed = worldSeed + chunkX * 73856093 ^ chunkZ * 19349663;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    // 1. TERRAIN
    const ground = new THREE.Mesh(sharedGroundGeo, terrainMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(chunkX * chunkSize + chunkSize / 2, 0, chunkZ * chunkSize + chunkSize / 2);
    group.add(ground);

    // 2. ROAD
    const roadMesh = createRoadMeshForChunk(roadNetwork, chunkX, chunkZ, chunkSize);
    group.add(roadMesh);

    // 3. BUILDINGS
    const colliders = [];
    const buildings = generateBuildings({ chunkX, chunkZ, chunkSize, random, colliders });
    group.add(buildings);

    // 4. VEGETATION (Giảm số lượng để tăng FPS)
    const nodes = new Map(roadNetwork.nodes.map(n => [n.id, n]));
    const segments = roadNetwork.segments.map(s => {
        const f = nodes.get(s.from); const t = nodes.get(s.to);
        return f && t ? { p1: new THREE.Vector3(f.position.x, 0, f.position.z), p2: new THREE.Vector3(t.position.x, 0, t.position.z), width: 24 } : null;
    }).filter(Boolean);

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const treeCount = Math.floor(random() * 15) + 5; // Giảm từ 30 xuống 15
    for (let i = 0; i < treeCount; i++) {
        const x = startX + random() * chunkSize;
        const z = startZ + random() * chunkSize;
        const p = new THREE.Vector3(x, 0, z);
        
        let tooCloseToRoad = false;
        for (const seg of segments) {
            const dist = distanceToSegment(p, seg.p1, seg.p2);
            if (dist < seg.width / 2 + 5) { tooCloseToRoad = true; break; }
        }
        if (tooCloseToRoad) continue;

        const trunk = new THREE.Mesh(sharedTrunkGeo, trunkMat);
        trunk.position.set(x, 2, z);
        group.add(trunk);
        
        const leaves = new THREE.Mesh(sharedLeavesGeo, leavesMat);
        leaves.position.set(x, 5, z);
        group.add(leaves);
    }

    group.userData.colliders = colliders;
    return group;
}

function distanceToSegment(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return p.distanceTo(v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.z - v.z) * (w.z - v.z)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = new THREE.Vector3(v.x + t * (w.x - v.x), 0, v.z + t * (w.z - v.z));
    return p.distanceTo(proj);
}