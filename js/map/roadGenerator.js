// js/map/roadGenerator.js - REAL ROAD GENERATOR (QL1A, EXPRESSWAY, MEDIAN, LIGHTS)
import * as THREE from "three";
import { roadProfiles } from "./data/roadNetworkData.js";

export const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
const medianMaterial = new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 }); // Màu xanh lá cây

// Đèn đường (Share Geo)
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

        const profile = roadProfiles[seg.type] || roadProfiles.Residential;
        const width = profile.width;
        const halfWidth = width / 2;

        // 1. MẶT ĐƯỜNG
        const roadGeo = new THREE.PlaneGeometry(width, length);
        const roadMesh = new THREE.Mesh(roadGeo, asphaltMaterial);
        roadMesh.rotation.x = -Math.PI / 2;
        roadMesh.position.copy(p1).addScaledVector(dir, length / 2);
        roadMesh.position.y = 0.15;
        roadMesh.rotation.z = Math.atan2(dir.x, dir.z);
        group.add(roadMesh);

        // 2. DẢI PHÂN CÁCH XANH (MEDIAN)
        if (profile.median) {
            const medianGeo = new THREE.BoxGeometry(2, 0.5, length);
            const medianMesh = new THREE.Mesh(medianGeo, medianMaterial);
            medianMesh.position.copy(roadMesh.position);
            medianMesh.position.y = 0.4;
            medianMesh.rotation.y = Math.atan2(dir.x, dir.z);
            group.add(medianMesh);
        }

        // 3. VẠCH KẺ ĐƯỜNG
        if (seg.twoWay && !profile.median) {
            const lineGeo = new THREE.PlaneGeometry(0.2, length);
            const lineMesh = new THREE.Mesh(lineGeo, lineMaterial);
            lineMesh.rotation.x = -Math.PI / 2;
            lineMesh.position.copy(roadMesh.position);
            lineMesh.position.y = 0.16;
            lineMesh.rotation.z = Math.atan2(dir.x, dir.z);
            group.add(lineMesh);
        }

        // 4. ĐÈN ĐƯỜNG TRÊN MEDIAN (Chiếu 2 bên)
        if (profile.median && seg.type !== 'tunnel') {
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

                // TỐI ƯU: Đèn thật chiếu xuống đường (PointLight)
                const pl = new THREE.PointLight(0xffffaa, 1.5, 30, 2);
                pl.position.copy(lightPos);
                pl.position.y = 8;
                group.add(pl);
            }
        }
    }
    return group;
}

export function createRoadNetworkMesh(roadNetwork) { return new THREE.Group(); }