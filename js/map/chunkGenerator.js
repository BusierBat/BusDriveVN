// js/map/chunkGenerator.js
import * as THREE from "three";
import { generateTerrainForChunk } from "./terrainGenerator.js";
import { generateRoadForChunk } from "./roadGenerator.js";
import { generateBuildingsForChunk } from "./buildingGenerator.js";
import { generateVegetationForChunk } from "./vegetationGenerator.js";
import { generateLandmarksForChunk } from "./landmarkGenerator.js";
import { getChunkSeed } from "./data/routeData.js";

export function generateChunk({ chunkX, chunkZ, worldSeed, chunkSize, parkingSlots }) {
    const group = new THREE.Group();
    group.name = `chunk_${chunkX}_${chunkZ}`;
    const worldX = chunkX * chunkSize;
    const worldZ = chunkZ * chunkSize;
    const seed = getChunkSeed(chunkX, chunkZ, worldSeed);

    const terrain = generateTerrainForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed });
    if (terrain) group.add(terrain);

    const road = generateRoadForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed });
    if (road) group.add(road);

    const buildings = generateBuildingsForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed });
    if (buildings) group.add(buildings);

    const veg = generateVegetationForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed });
    if (veg) group.add(veg);

    const landmarks = generateLandmarksForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed, parkingSlots });
    if (landmarks) group.add(landmarks);

    return group;
}