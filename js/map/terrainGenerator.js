// js/map/terrainGenerator.js
import * as THREE from "three";

export function generateTerrainForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed }) {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x4a7c3a, roughness: 0.9, metalness: 0.0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(worldX, 0, worldZ);
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
}