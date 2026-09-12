// js/map/roadGenerator.js - QL1A vs HIGHWAY VISUALS
import * as THREE from "three";
import { roadProfiles } from "./data/roadNetworkData.js";

export const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
const medianGreenMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 });
const medianBarrierMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
const guardrailMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.8 });

const streetLightPoleGeo = new THREE.CylinderGeometry(0.2, 0.2, 8);
const streetLightLampGeo = new THREE.SphereGeometry(0.5, 8, 8);
const streetLightPoleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
const streetLightLampMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 1 });

export function getAsphaltMaterial() { return asphaltMaterial; }

export function createRoadMeshForChunk(roadNetwork, chunkX, chunkZ, chunkSize) {
    const group = new THREE.Group();
    group.name = `roads_chunk_${chunkX}_${chunkZ}`;
    
    const chunkMinX = chunkX * chunkSize;
    const chunkMaxX = chunkMinX + chunkSize;
    const chunkMinZ = chunkZ * chunkSize;
    const chunkMaxZ = chunkMinZ + chunkSize;

    const nodeMap = new Map(roadNetwork.nodes.map(n => [n.id, n]));

    for (const seg of roadNetwork.segments) {
        const fromNode = nodeMap.get(seg.from);
        const toNode = nodeMap.get(seg.to);
        if (!fromNode || !toNode) continue;

        const p1 = new THREE.Vector3(fromNode.position.x, 0.15, fromNode.position.z);
        const p2 = new THREE.Vector3(toNode.position.x, 0.15, toNode.position.z);

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

        const roadGeo = new THREE.PlaneGeometry(width, length);
        const roadMesh = new THREE.Mesh(roadGeo, asphaltMaterial);
        roadMesh.rotation.x = -Math.PI / 2;
        roadMesh.position.copy(p1).addScaledVector(dir, length / 2);
        roadMesh.position.y = 0.15;
        roadMesh.rotation.z = Math.atan2(dir.x, dir.z);
        group.add(roadMesh);

        if (profile.median) {
            const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            if (profile.medianType === 'green') {
                const medianGeo = new THREE.BoxGeometry(2, 0.5, length);
                const medianMesh = new THREE.Mesh(medianGeo, medianGreenMat);
                medianMesh.position.copy(mid);
                medianMesh.position.y = 0.4;
                medianMesh.rotation.y = Math.atan2(dir.x, dir.z);
                group.add(medianMesh);
            } else if (profile.medianType === 'barrier') {
                const barrierGeo = new THREE.BoxGeometry(1, 1, length);
                const barrierMesh = new THREE.Mesh(barrierGeo, medianBarrierMat);
                barrierMesh.position.copy(mid);
                barrierMesh.position.y = 0.6;
                barrierMesh.rotation.y = Math.atan2(dir.x, dir.z);
                group.add(barrierMesh);
                
                const guardrailGeo = new THREE.BoxGeometry(0.2, 1, length);
                const rightDir = new THREE.Vector3(-dir.z, 0, dir.x);
                const leftGuardrail = new THREE.Mesh(guardrailGeo, guardrailMat);
                leftGuardrail.position.copy(mid).addScaledVector(rightDir, halfWidth + 0.5);
                leftGuardrail.position.y = 0.5;
                leftGuardrail.rotation.y = Math.atan2(dir.x, dir.z);
                group.add(leftGuardrail);
                
                const rightGuardrail = new THREE.Mesh(guardrailGeo, guardrailMat);
                rightGuardrail.position.copy(mid).addScaledVector(rightDir, -(halfWidth + 0.5));
                rightGuardrail.position.y = 0.5;
                rightGuardrail.rotation.y = Math.atan2(dir.x, dir.z);
                group.add(rightGuardrail);
            }
        }

        if (seg.type !== 'tunnel') {
            const numLights = Math.floor(length / 40);
            for (let i = 0; i < numLights; i++) {
                const t = (i + 0.5) / numLights;
                const lightPos = p1.clone().addScaledVector(dir, length * t);
                if (lightPos.x < chunkMinX || lightPos.x > chunkMaxX || lightPos.z < chunkMinZ || lightPos.z > chunkMaxZ) continue;

                const pole = new THREE.Mesh(streetLightPoleGeo, streetLightPoleMat);
                pole.position.copy(lightPos);
                pole.position.y = 4;
                group.add(pole);
                
                const lamp = new THREE.Mesh(streetLightLampGeo, streetLightLampMat);
                lamp.position.copy(lightPos);
                lamp.position.y = 8;
                group.add(lamp);

                const pl = new THREE.PointLight(0xffffaa, 1.5, 30, 2);
                pl.position.copy(lightPos);
                pl.position.y = 8;
                pl.userData.isStreetLight = true;
                group.add(pl);
            }
        }
    }
    return group;
}

export function createRoadNetworkMesh(roadNetwork) { return new THREE.Group(); }