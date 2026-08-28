// js/map/buildingGenerator.js
import * as THREE from "three";
import { createSeededRandom } from "../utils.js";
import { roadDataSegments } from "./data/routeData.js";

function isNearRoad(x, z, safeDist = 8) {
  for (const seg of roadDataSegments) {
    const p0 = seg.points[0];
    const p1 = seg.points[1];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const t = ((x - p0.x) * dx + (z - p0.z) * dz) / (len * len);
    const tClamped = Math.max(0, Math.min(1, t));
    const projX = p0.x + tClamped * dx;
    const projZ = p0.z + tClamped * dz;
    const dist = Math.hypot(x - projX, z - projZ);
    if (dist < safeDist) return true;
  }
  return false;
}

export function generateBuildingsForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed }) {
  const group = new THREE.Group();
  const rand = createSeededRandom(seed + 5678);
  const half = chunkSize / 2;
  const minX = worldX - half;
  const maxX = worldX + half;
  const minZ = worldZ - half;
  const maxZ = worldZ + half;

  // Lấy các điểm trên đường trong chunk
  const roadPoints = [];
  for (const seg of roadDataSegments) {
    const p0 = seg.points[0];
    const p1 = seg.points[1];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const steps = Math.ceil(len / 4);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = p0.x + dx * t;
      const z = p0.z + dz * t;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
        roadPoints.push({ x, z, dirX: dx / len, dirZ: dz / len });
      }
    }
  }
  if (roadPoints.length === 0) return group;

  // Chỉ xây nhà trên các đoạn urban và highway (nhưng highway thì ít hơn)
  const urbanSegments = roadDataSegments.filter(s => s.type === 'urban' || s.type === 'highway');
  // Lọc lại roadPoints chỉ lấy những điểm thuộc urban/highway
  const urbanRoadPoints = [];
  for (const p of roadPoints) {
    // Kiểm tra xem điểm này có nằm trên segment urban/highway không
    for (const seg of urbanSegments) {
      const p0 = seg.points[0];
      const p1 = seg.points[1];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const t = ((p.x - p0.x) * dx + (p.z - p0.z) * dz) / (len * len);
      if (t >= 0 && t <= 1) {
        urbanRoadPoints.push(p);
        break;
      }
    }
  }

  if (urbanRoadPoints.length === 0) return group;

  const count = Math.max(2, Math.floor(urbanRoadPoints.length * 0.12 * (0.3 + rand() * 0.4)));
  const usedPositions = [];
  // Xáo trộn
  for (let i = urbanRoadPoints.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [urbanRoadPoints[i], urbanRoadPoints[j]] = [urbanRoadPoints[j], urbanRoadPoints[i]];
  }

  let placed = 0;
  for (const p of urbanRoadPoints) {
    if (placed >= count) break;
    const side = (rand() > 0.5) ? 1 : -1;
    const nx = -p.dirZ;
    const nz = p.dirX;
    const distFromRoad = 12 + rand() * 8;
    const x = p.x + nx * side * distFromRoad;
    const z = p.z + nz * side * distFromRoad;
    if (x < minX + 2 || x > maxX - 2 || z < minZ + 2 || z > maxZ - 2) continue;
    if (isNearRoad(x, z, 8)) continue;
    let overlap = false;
    for (const pos of usedPositions) {
      if (Math.hypot(x - pos.x, z - pos.z) < 6) { overlap = true; break; }
    }
    if (overlap) continue;
    usedPositions.push({ x, z });

    const w = 2.5 + rand() * 2.5;
    const h = 3 + rand() * 2.5;
    const d = 2.5 + rand() * 2.5;
    const color = new THREE.Color().setHSL(0.08, 0.2, 0.6 + rand() * 0.2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, h / 2, z);
    mesh.rotation.y = Math.atan2(p.dirX, p.dirZ) + (rand() - 0.5) * 0.5;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);

    const roofColor = new THREE.Color().setHSL(0.05, 0.5, 0.3 + rand() * 0.15);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.6, h * 0.3, 4), new THREE.MeshLambertMaterial({ color: roofColor }));
    roof.position.set(x, h + 0.05, z);
    roof.rotation.y = mesh.rotation.y + Math.PI / 4;
    roof.matrixAutoUpdate = false;
    roof.updateMatrix();
    group.add(roof);
    placed++;
  }
  return group;
}