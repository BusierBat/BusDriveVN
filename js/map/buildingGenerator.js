// js/map/buildingGenerator.js - Sinh nhà lề đường + mái (TĂNG MẬT ĐỘ)
import * as THREE from "three";

const buildingMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.8 })
];
const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.3, metalness: 0.5 });

export function generateBuildingsForChunk(chunkX, chunkZ, chunkSize, roadNetwork) {
    const group = new THREE.Group();
    const colliders = [];
    const minX = chunkX * chunkSize;
    const minZ = chunkZ * chunkSize;
    const maxX = minX + chunkSize;
    const maxZ = minZ + chunkSize;
    
    const segsInChunk = [];
    for (const seg of roadNetwork.segments) {
        const from = roadNetwork.nodes.find(n => n.id === seg.from).position;
        const to = roadNetwork.nodes.find(n => n.id === seg.to).position;
        // Mở rộng box check để tranh bị miss đoạn đường cắt biên chunk
        if ((from.x >= minX && from.x <= maxX && from.z >= minZ && from.z <= maxZ) ||
            (to.x >= minX && to.x <= maxX && to.z >= minZ && to.z <= maxZ)) {
            segsInChunk.push({ seg, from, to });
        }
    }
    
    if (segsInChunk.length === 0) return group;
    
    for (const item of segsInChunk) {
        const dx = item.to.x - item.from.x;
        const dz = item.to.z - item.from.z;
        const len = Math.hypot(dx, dz);
        if (len === 0) continue;
        
        const angle = Math.atan2(dx, dz);
        const rx = dz / len; // Right vector
        const rz = -dx / len;
        const w = item.seg.width || 20;
        
        // TĂNG MẬT ĐỘ: Spawn 3-5 nhà mỗi segment
        const numHouses = 3 + Math.floor(Math.random() * 3); 
        for (let i = 0; i < numHouses; i++) {
            const t = Math.random();
            const px = item.from.x + dx * t;
            const pz = item.from.z + dz * t;
            const side = Math.random() > 0.5 ? 1 : -1;
            const offset = w / 2 + 6 + Math.random() * 15; // Cách mặt đường 6-21m
            
            const x = px + rx * offset * side;
            const z = pz + rz * offset * side;
            
            if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
            
            const h = 4 + Math.random() * 6;
            const wH = 8 + Math.random() * 4;
            const dH = 8 + Math.random() * 4;
            
            const body = new THREE.Mesh(new THREE.BoxGeometry(wH, h, dH), buildingMaterials[Math.floor(Math.random() * buildingMaterials.length)]);
            body.position.set(x, h/2, z);
            body.rotation.y = angle;
            group.add(body);
            
            const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(wH, dH) * 0.8, h * 0.4, 4), roofMat);
            roof.position.set(x, h + h * 0.2, z);
            roof.rotation.y = angle;
            group.add(roof);
            
            const winGeo = new THREE.PlaneGeometry(1.5, 1.5);
            const win1 = new THREE.Mesh(winGeo, windowMat);
            win1.position.set(x, h/2, z);
            win1.position.x += Math.sin(angle) * (wH/2 + 0.01);
            win1.position.z += Math.cos(angle) * (wH/2 + 0.01);
            win1.rotation.y = angle;
            group.add(win1);
            
            colliders.push({ x, z, r: Math.max(wH, dH) / 2 });
        }
    }
    
    group.userData.colliders = colliders;
    return group;
}