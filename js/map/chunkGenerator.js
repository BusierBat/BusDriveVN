// js/map/chunkGenerator.js - KHÔI PHỤC SHARE GROUND & VEGETATION
import * as THREE from "three";
import { generateBuildings } from "./buildingGenerator.js";
import { createRoadMeshForChunk } from "./roadGenerator.js";
import { roadNetwork } from "./data/roadNetworkData.js";

// KHÔI PHỤC: Share Geometry cho Ground và Cây
const sharedGroundGeo = new THREE.PlaneGeometry(256, 256);
const sharedTrunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 4, 6);
const sharedLeavesGeo = new THREE.SphereGeometry(2.5, 8, 8);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 });

// ĐỔI MÀU TERRAIN SÁNG HƠN
const terrainMat = new THREE.MeshStandardMaterial({ color: 0x6b9b36, roughness: 1 });

export function generateChunk({ chunkX, chunkZ, worldSeed, chunkSize, parkingSlots }) {
    const group = new THREE.Group();
    group.name = `chunk_${chunkX}_${chunkZ}`;
    
    let seed = worldSeed + chunkX * 73856093 ^ chunkZ * 19349663;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    const ground = new THREE.Mesh(sharedGroundGeo, terrainMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(chunkX * chunkSize + chunkSize / 2, 0, chunkZ * chunkSize + chunkSize / 2);
    group.add(ground);

    const roadMesh = createRoadMeshForChunk(roadNetwork, chunkX, chunkZ, chunkSize);
    group.add(roadMesh);

    const colliders = [];
    const buildings = generateBuildings({ chunkX, chunkZ, chunkSize, random, colliders });
    group.add(buildings);

    const nodes = new Map(roadNetwork.nodes.map(n => [n.id, n]));
    
    // TỐI ƯU: Lọc segment theo Bounding Box của chunk thay vì map toàn bộ
    const chunkMinX = chunkX * chunkSize;
    const chunkMaxX = chunkMinX + chunkSize;
    const chunkMinZ = chunkZ * chunkSize;
    const chunkMaxZ = chunkMinZ + chunkSize;
    
    const segments = [];
    for (const s of roadNetwork.segments) {
        const f = nodes.get(s.from);
        const t = nodes.get(s.to);
        if (!f?.position || !t?.position) continue;
        
        const p1x = f.position.x, p1z = f.position.z;
        const p2x = t.position.x, p2z = t.position.z;
        
        const segMinX = Math.min(p1x, p2x);
        const segMaxX = Math.max(p1x, p2x);
        const segMinZ = Math.min(p1z, p2z);
        const segMaxZ = Math.max(p1z, p2z);
        
        if (segMaxX < chunkMinX || segMinX > chunkMaxX || segMaxZ < chunkMinZ || segMinZ > chunkMaxZ) continue;
        
        segments.push({
            p1: new THREE.Vector3(p1x, 0, p1z),
            p2: new THREE.Vector3(p2x, 0, p2z),
            width: 24
        });
    }

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const treeCount = Math.floor(random() * 15) + 5;
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