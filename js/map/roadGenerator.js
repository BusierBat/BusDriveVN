// js/map/roadGenerator.js - SỬA: SỬ DỤNG LANE GENERATOR MỚI
// Giữ backward compatibility: nếu không có roadType, dùng legacy logic

import * as THREE from "three";
import { roadDataSegments } from "./data/routeData.js";
import { generateLaneRoad } from "./laneGenerator.js";
import { mapLegacyType, getRoadTypeConfig } from "./data/roadTypes.js";

export function generateRoadForChunk({ chunkX, chunkZ, worldX, worldZ, chunkSize, seed }) {
    const group = new THREE.Group();
    const half = chunkSize / 2;
    const minX = worldX - half;
    const maxX = worldX + half;
    const minZ = worldZ - half;
    const maxZ = worldZ + half;
    
    for (const seg of roadDataSegments) {
        const p0 = seg.points[0];
        const p1 = seg.points[1];
        
        // Culling: bỏ qua segment ngoài chunk
        if ((p0.x < minX && p1.x < minX) || (p0.x > maxX && p1.x > maxX) ||
            (p0.z < minZ && p1.z < minZ) || (p0.z > maxZ && p1.z > maxZ)) {
            continue;
        }
        
        // ===== XÁC ĐỊNH ROADTYPE =====
        // Ưu tiên: seg.roadType > map từ legacy type
        let roadType = seg.roadType;
        if (!roadType) {
            roadType = mapLegacyType(seg.type || 'road', seg.width || 10);
        }
        
        // ===== TẠO ĐƯỜNG BẰNG LANE GENERATOR MỚI =====
        generateLaneRoad({
            group: group,
            startX: p0.x,
            startZ: p0.z,
            endX: p1.x,
            endZ: p1.z,
            roadType: roadType,
            segmentData: seg
        });
    }
    
    return group;
}