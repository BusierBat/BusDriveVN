// js/map/vegetationGenerator.js
import * as THREE from "three";
import { createSeededRandom } from "../utils.js";
import { roadDataSegments } from "./data/routeData.js";

function getRoadPoints(chunkX, chunkZ, worldX, worldZ, chunkSize) {
  const half = chunkSize / 2;
  const minX = worldX - half;
  const maxX = worldX + half;
  const minZ = worldZ - half;
  const maxZ = worldZ + half;
  const points = [];
  for (const seg of roadDataSegments) {
    const pts = seg.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      if (p0.x < minX && p1.x < minX) continue;
      if (p0.x > maxX && p1.x > maxX) continue;
      if (p0.z < minZ && p1.z < minZ) continue;
      if (p0.z > maxZ && p1.z > maxZ) continue;
      const steps = Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = p0.x + (p1.x - p0.x) * t;
        const z = p0.z + (p1.z - p0.z) * t;
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
          points.push({ x, z, dirX: (p1.x - p0.x) || 1, dirZ: (p1.z - p0.z) || 0 });
        }
      }
    }
  }
  return points;
}

export function generateVegetationForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed }) {
  const group = new THREE.Group();
  const rand = createSeededRandom(seed + 1234);
  const roadPoints = getRoadPoints(chunkX, chunkZ, worldX, worldZ, chunkSize);
  if (roadPoints.length === 0) return group;

  const count = Math.max(2, Math.floor(roadPoints.length * 0.08 * (0.5 + rand() * 0.5)));
  const indices = [];
  for (let i = 0; i < roadPoints.length; i++) indices.push(i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x4d8f35 });

  let placed = 0;
  for (let idx of indices) {
    if (placed >= count) break;
    const p = roadPoints[idx];
    const side = (rand() > 0.5) ? 1 : -1;
    const len = Math.hypot(p.dirX, p.dirZ) || 1;
    const nx = -p.dirZ / len;
    const nz = p.dirX / len;
    const dist = 6 + rand() * 6;
    const x = p.x + nx * side * dist;
    const z = p.z + nz * side * dist;
    if (x < -5000 || x > 15000 || z < -20000 || z > 1000) continue;

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.8, 4), trunkMat);
    trunk.position.set(x, 0.4, z);
    trunk.matrixAutoUpdate = false;
    trunk.updateMatrix();
    group.add(trunk);

    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5 + rand() * 0.2, 5, 5), leafMat);
    leaf.position.set(x, 1.0 + rand() * 0.2, z);
    leaf.matrixAutoUpdate = false;
    leaf.updateMatrix();
    group.add(leaf);
    placed++;
  }
  return group;
}
