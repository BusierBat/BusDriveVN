// js/map/chunkGenerator.js - Sinh Ground (cỏ tươi) & Buildings, không sinh road nữa
import * as THREE from "three";
import { generateBuildingsForChunk } from "./buildingGenerator.js";
import { roadNetwork } from "./data/roadNetworkData.js";

export function generateChunk({ chunkX, chunkZ, worldSeed, chunkSize, parkingSlots }) {
    const group = new THREE.Group();
    group.name = `chunk_${chunkX}_${chunkZ}`;
    
    // 1. Ground (Mặt đất cỏ xanh tươi)
    const groundGeo = new THREE.PlaneGeometry(chunkSize, chunkSize);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 1.0 }); // Xanh tươi
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(chunkX * chunkSize + chunkSize/2, 0, chunkZ * chunkSize + chunkSize/2);
    group.add(ground);
    
    // 2. Buildings (Nhà cửa)
    const buildings = generateBuildingsForChunk(chunkX, chunkZ, chunkSize, roadNetwork);
    group.add(buildings);
    
    return group;
}