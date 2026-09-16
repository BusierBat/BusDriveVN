// js/map/roadGenerator.js
import * as THREE from "three";
import { roadProfiles } from "./data/roadNetworkData.js";

const _sharedMaterials = {
    asphalt: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 }),
    line: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    medianGreen: new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 }),
    medianBarrier: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
    guardrail: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.8 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 1 })
};

const _sharedGeometries = {
    pole: new THREE.CylinderGeometry(0.2, 0.2, 8),
    lamp: new THREE.SphereGeometry(0.5, 8, 8)
};

export function getAsphaltMaterial() { return _sharedMaterials.asphalt; }

function lerp(a, b, t) { return a + (b - a) * t; }

export function createRoadMeshForChunk(graph, chunkX, chunkZ, chunkSize) {
    const group = new THREE.Group();
    group.name = `roads_chunk_${chunkX}_${chunkZ}`;
    
    if (!graph || !graph.segments) return group;
    
    const chunkMinX = chunkX * chunkSize;
    const chunkMaxX = chunkMinX + chunkSize;
    const chunkMinZ = chunkZ * chunkSize;
    const chunkMaxZ = chunkMinZ + chunkSize;
    
    for (const seg of graph.segments) {
        if (!seg.from || !seg.to) continue;
        
        const p1 = new THREE.Vector3(seg.from.x, seg.from.y, seg.from.z);
        const p2 = new THREE.Vector3(seg.to.x, seg.to.y, seg.to.z);
        
        // AABB Spatial Filter
        const segMinX = Math.min(p1.x, p2.x);
        const segMaxX = Math.max(p1.x, p2.x);
        const segMinZ = Math.min(p1.z, p2.z);
        const segMaxZ = Math.max(p1.z, p2.z);
        if (segMaxX < chunkMinX || segMinX > chunkMaxX || segMaxZ < chunkMinZ || segMinZ > chunkMaxZ) continue;
        
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const length = dir.length();
        if (length === 0) continue;
        dir.normalize();
        
        const profile = roadProfiles[seg.type] || roadProfiles.local;
        const width = profile.width;
        const halfWidth = width / 2;
        
        // === ROAD SURFACE 3D (Solid Box để chống raycast miss) ===
        const roadGeo = new THREE.BoxGeometry(width, 0.2, length);
        const roadMesh = new THREE.Mesh(roadGeo, _sharedMaterials.asphalt);
        roadMesh.position.copy(p1).addScaledVector(dir, length / 2);
        
        // Xác định Y trung bình và xoay mesh để bám dốc
        const midY = (p1.y + p2.y) / 2;
        roadMesh.position.y = midY + 0.1; // Hơi nâng lên để không z-fight với terrain
        roadMesh.lookAt(p2);
        group.add(roadMesh);
        
        // === MEDIAN & GUARDRAILS 3D ===
        if (profile.median) {
            const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            mid.y = midY + 0.1;
            if (profile.medianType === 'green') {
                const medianGeo = new THREE.BoxGeometry(2, 0.5, length);
                const medianMesh = new THREE.Mesh(medianGeo, _sharedMaterials.medianGreen);
                medianMesh.position.copy(mid);
                medianMesh.lookAt(p2);
                group.add(medianMesh);
            } else if (profile.medianType === 'barrier') {
                const barrierGeo = new THREE.BoxGeometry(1, 1, length);
                const barrierMesh = new THREE.Mesh(barrierGeo, _sharedMaterials.medianBarrier);
                barrierMesh.position.copy(mid);
                barrierMesh.lookAt(p2);
                group.add(barrierMesh);
                
                const guardrailGeo = new THREE.BoxGeometry(0.2, 1, length);
                const rightDir = new THREE.Vector3(-dir.z, 0, dir.x);
                
                const leftGuardrail = new THREE.Mesh(guardrailGeo, _sharedMaterials.guardrail);
                leftGuardrail.position.copy(mid).addScaledVector(rightDir, halfWidth + 0.5);
                leftGuardrail.lookAt(new THREE.Vector3().copy(mid).addScaledVector(rightDir, halfWidth + 0.5).addScaledVector(dir, 10));
                group.add(leftGuardrail);
                
                const rightGuardrail = new THREE.Mesh(guardrailGeo, _sharedMaterials.guardrail);
                rightGuardrail.position.copy(mid).addScaledVector(rightDir, -(halfWidth + 0.5));
                rightGuardrail.lookAt(new THREE.Vector3().copy(mid).addScaledVector(rightDir, -(halfWidth + 0.5)).addScaledVector(dir, 10));
                group.add(rightGuardrail);
            }
        }
        
        // === STREET LIGHTS 3D ===
        if (seg.type !== 'tunnel' && seg.type !== 'highway_ramp') {
            const numLights = Math.floor(length / 40);
            for (let i = 0; i < numLights; i++) {
                const t = (i + 0.5) / numLights;
                const lightPos = p1.clone().addScaledVector(dir, length * t);
                if (lightPos.x < chunkMinX || lightPos.x > chunkMaxX || lightPos.z < chunkMinZ || lightPos.z > chunkMaxZ) continue;
                
                const pole = new THREE.Mesh(_sharedGeometries.pole, _sharedMaterials.pole);
                pole.position.copy(lightPos);
                pole.position.y = lerp(p1.y, p2.y, t) + 4;
                group.add(pole);
                
                const lamp = new THREE.Mesh(_sharedGeometries.lamp, _sharedMaterials.lamp);
                lamp.position.copy(lightPos);
                lamp.position.y = lerp(p1.y, p2.y, t) + 8;
                group.add(lamp);
            }
        }
    }
    return group;
}

export function createRoadNetworkMesh(roadNetwork) { return new THREE.Group(); }