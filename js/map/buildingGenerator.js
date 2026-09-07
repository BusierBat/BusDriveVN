// js/map/buildingGenerator.js - DIVERSE BUILDINGS (SAFE & TALL)
import * as THREE from "three";
import { roadNetwork } from "./data/roadNetworkData.js";

const sharedHouseBodyGeo = new THREE.BoxGeometry(1, 1, 1);
const sharedHouseRoofGeo = new THREE.BoxGeometry(1.1, 0.5, 1.1);

export function generateBuildings({ chunkX, chunkZ, chunkSize, random, colliders }) {
    const group = new THREE.Group();
    group.name = "buildings";
    
    const buildingMaterials = [
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x88aabb, roughness: 0.6 })
    ];
    const roofMaterials = [
        new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 })
    ];

    // Lấy danh sách road segments an toàn
    const nodes = new Map(roadNetwork.nodes.map(n => [n.id, n]));
    const segments = [];
    for (const s of roadNetwork.segments) {
        if (!s || !s.from || !s.to) continue;
        const f = nodes.get(s.from);
        const t = nodes.get(s.to);
        if (f?.position && t?.position) {
            segments.push({
                p1: new THREE.Vector3(f.position.x, 0, f.position.z),
                p2: new THREE.Vector3(t.position.x, 0, t.position.z),
                width: 24,
                type: s.type
            });
        }
    }

    if (segments.length === 0) return group; // FIX LỖI: Trả về rỗng nếu không có đường

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const buildingCount = Math.floor(random() * 10) + 5;

    for (let i = 0; i < buildingCount; i++) {
        const seg = segments[Math.floor(random() * segments.length)];
        if (!seg || !seg.p1 || !seg.p2) continue; // FIX LỖI: Kiểm tra an toàn tuyệt đối
        
        const segDir = new THREE.Vector3().subVectors(seg.p2, seg.p1);
        const segLen = segDir.length();
        if (segLen === 0) continue;
        segDir.normalize();
        
        const t = random();
        const posOnSeg = seg.p1.clone().addScaledVector(segDir, segLen * t);
        
        const rightDir = new THREE.Vector3(-segDir.z, 0, segDir.x);
        const side = random() > 0.5 ? 1 : -1;
        const offset = seg.width / 2 + 15 + random() * 20;
        const spawnPos = posOnSeg.clone().addScaledVector(rightDir, side * offset);
        
        if (spawnPos.x < startX || spawnPos.x > startX + chunkSize || spawnPos.z < startZ || spawnPos.z > startZ + chunkSize) continue;

        const width = 8 + random() * 12;
        const depth = 8 + random() * 12;
        
        // Logic nhà cao tầng vs nhà lùn
        const isCityRoad = seg.type === 'Urban';
        const height = isCityRoad ? (random() > 0.7 ? 30 + random() * 30 : 8 + random() * 15) : (6 + random() * 10);

        const body = new THREE.Mesh(sharedHouseBodyGeo, buildingMaterials[Math.floor(random() * buildingMaterials.length)]);
        body.position.copy(spawnPos);
        body.position.y = height / 2;
        body.scale.set(width, height, depth);
        body.updateMatrix();
        group.add(body);

        const roof = new THREE.Mesh(sharedHouseRoofGeo, roofMaterials[Math.floor(random() * roofMaterials.length)]);
        roof.position.copy(spawnPos);
        roof.position.y = height + 0.25;
        roof.scale.set(width, 1, depth);
        roof.updateMatrix();
        group.add(roof);

        if (colliders) {
            colliders.push({ x: spawnPos.x, z: spawnPos.z, r: Math.max(width, depth) / 2, type: 'static', chunkKey: `${chunkX},${chunkZ}` });
        }
    }
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