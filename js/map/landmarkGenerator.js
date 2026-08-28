// js/map/landmarkGenerator.js
import * as THREE from 'three';
import { getPOIs } from './data/routeData.js';
import { createBusStation, createRestStop, createGasStation } from './stationGenerator.js';

export function generateLandmarksForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed, parkingSlots }) {
  const group = new THREE.Group();
  const half = chunkSize / 2;
  const padding = 300;
  const minX = worldX - half - padding;
  const maxX = worldX + half + padding;
  const minZ = worldZ - half - padding;
  const maxZ = worldZ + half + padding;

  const pois = getPOIs();
  for (const poi of pois) {
    if (poi.position.x >= minX && poi.position.x <= maxX &&
        poi.position.z >= minZ && poi.position.z <= maxZ) {
      if (poi.type === 'bus_station') {
        createBusStation(poi, group, parkingSlots);
      } else if (poi.type === 'rest_stop') {
        createRestStop(poi, group);
      } else if (poi.type === 'gas_station') {
        createGasStation(poi, group);
      }
    }
  }
  return group;
}