// js/map/chunkGenerator.js
import * as THREE from "three";
import { generateBuildings } from "./buildingGenerator.js";
import { createRoadMeshForChunk } from "./roadGenerator.js";
import { roadNetwork } from "./data/roadNetworkData.js";

const _sharedAssets = {
    groundGeo: new THREE.PlaneGeometry(256, 256, 32, 32), 
    trunkGeo: new THREE.CylinderGeometry(0.5, 0.5, 4, 6),
    leavesGeo: new THREE.SphereGeometry(2.5, 8, 8),
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 }),
    leavesMat: new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 }),
    // Đổi màu sang XANH TƯƠI như cỏ thật
    terrainMat: new THREE.MeshStandardMaterial({ color: 0x3b8e3b, roughness: 1 }) 
};

function lerp(a, b, t) { return a + (b - a) * t; }

export function generateChunk({ chunkX, chunkZ, worldSeed, chunkSize, parkingSlots }) {
    const group = new THREE.Group();
    group.name = `chunk_${chunkX}_${chunkZ}`;
    let seed = worldSeed + chunkX * 73856093 ^ chunkZ * 19349663;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    
    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    
    // === TERRAIN 3D SEAMLESS & SMOOTH GENERATION ===
    const groundGeo = _sharedAssets.groundGeo.clone();
    const positions = groundGeo.attributes.position;
    const chunkMinX = startX;
    const chunkMaxX = startX + chunkSize;
    const chunkMinZ = startZ;
    const chunkMaxZ = startZ + chunkSize;
    
    const nodes = roadNetwork.nodes;
    
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getY(i); 
        const worldX = startX + (x + 128);
        const worldZ = startZ + (-z + 128); 
        
        let nearestNode = null;
        let minDist = Infinity;
        let secondNearest = null;
        let minDist2 = Infinity;
        
        for (const n of nodes) {
            const dx = n.position.x - worldX;
            const dz = n.position.z - worldZ;
            const dist = Math.hypot(dx, dz);
            if (dist < minDist) {
                minDist2 = minDist; secondNearest = nearestNode;
                minDist = dist; nearestNode = n;
            } else if (dist < minDist2) {
                minDist2 = dist; secondNearest = n;
            }
        }
        
        let y = 10.0; 
        // FIX LỖI NaN: Chỉ nội suy nếu minDist > 0.001
        if (nearestNode && secondNearest && minDist > 0.001 && minDist2 > 0.001) {
            const w1 = 1 / minDist;
            const w2 = 1 / minDist2;
            const totalWeight = w1 + w2;
            y = (nearestNode.position.y * w1 + secondNearest.position.y * w2) / totalWeight;
        } else if (nearestNode) {
            y = nearestNode.position.y;
        }
        
        // Thêm sóng Sin để tạo đồi cuộn mượt mà, không bị góc Minecraft
        const noise = Math.sin(worldX * 0.05) * Math.cos(worldZ * 0.05) * 3.0;
        y += noise;
        
        // Đảm bảo không NaN
        if (isNaN(y) || !isFinite(y)) y = 10.0;
        
        positions.setZ(i, y); 
    }
    groundGeo.computeVertexNormals();
    
    const ground = new THREE.Mesh(groundGeo, _sharedAssets.terrainMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(startX + chunkSize / 2, 0, startZ + chunkSize / 2);
    ground.scale.set(1.05, 1.05, 1.05); 
    group.add(ground);
    
    // === ROAD MESH (3D) ===
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const graph = {
        segments: roadNetwork.segments.map(s => ({
            ...s,
            from: nodeMap.get(s.from)?.position,
            to: nodeMap.get(s.to)?.position
        })).filter(s => s.from && s.to)
    };
    const roadMesh = createRoadMeshForChunk(graph, chunkX, chunkZ, chunkSize);
    group.add(roadMesh);
    
    // === BUILDINGS & VEGETATION ===
    const colliders = []; 
    const buildings = generateBuildings({ chunkX, chunkZ, chunkSize, random, colliders });
    group.add(buildings);
    
    const segments = [];
    for (const s of graph.segments) {
        const p1x = s.from.x, p1z = s.from.z;
        const p2x = s.to.x, p2z = s.to.z;
        const segMinX = Math.min(p1x, p2x);
        const segMaxX = Math.max(p1x, p2x);
        const segMinZ = Math.min(p1z, p2z);
        const segMaxZ = Math.max(p1z, p2z);
        if (segMaxX < chunkMinX || segMinX > chunkMaxX || segMaxZ < chunkMinZ || segMinZ > chunkMaxZ) continue;
        segments.push({
            p1: new THREE.Vector3(p1x, s.from.y, p1z),
            p2: new THREE.Vector3(p2x, s.to.y, p2z),
            width: 24
        });
    }
    
    const centerPos = new THREE.Vector3(startX + chunkSize/2, 0, startZ + chunkSize/2);
    let nearestNodeForRegion = null;
    let minDistRegion = Infinity;
    for (const n of nodes) {
        const dx = n.position.x - centerPos.x;
        const dz = n.position.z - centerPos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < minDistRegion) { minDistRegion = dist; nearestNodeForRegion = n; }
    }
    
    const region = nearestNodeForRegion?.region || 'rural';
    let treeCount = Math.floor(random() * 15) + 5;
    if (region.includes('urban')) treeCount = Math.floor(random() * 5) + 1;
    else if (region.includes('rural')) treeCount = Math.floor(random() * 20) + 10;
    
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
        
        const treeY = getTerrainHeightAt(x, z, nodes);
        
        const trunk = new THREE.Mesh(_sharedAssets.trunkGeo, _sharedAssets.trunkMat);
        trunk.position.set(x, treeY + 2, z);
        group.add(trunk);
        const leaves = new THREE.Mesh(_sharedAssets.leavesGeo, _sharedAssets.leavesMat);
        leaves.position.set(x, treeY + 5, z);
        group.add(leaves);
    }
    
    group.userData.colliders = colliders; 
    return group;
}

function getTerrainHeightAt(x, z, nodes) {
    let nearest = null;
    let minDist = Infinity;
    let second = null;
    let minDist2 = Infinity;
    
    for (const n of nodes) {
        const dx = n.position.x - x;
        const dz = n.position.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist < minDist) {
            minDist2 = minDist; second = nearest;
            minDist = dist; nearest = n;
        } else if (dist < minDist2) {
            minDist2 = dist; second = n;
        }
    }
    
    let y = 10.0;
    if (nearest && second && minDist > 0.001 && minDist2 > 0.001) {
        const w1 = 1 / minDist;
        const w2 = 1 / minDist2;
        const totalWeight = w1 + w2;
        y = (nearest.position.y * w1 + second.position.y * w2) / totalWeight;
    } else if (nearest) {
        y = nearest.position.y;
    }
    
    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3.0;
    y += noise;
    
    if (isNaN(y) || !isFinite(y)) y = 10.0;
    return y;
}

function distanceToSegment(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return p.distanceTo(v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.z - v.z) * (w.z - v.z)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = new THREE.Vector3(v.x + t * (w.x - v.x), 0, v.z + t * (w.z - v.z));
    return p.distanceTo(proj);
}