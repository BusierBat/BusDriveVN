// js/map/roadGenerator.js
import * as THREE from "three";
import { roadDataSegments } from "./data/routeData.js";

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
if ((p0.x < minX && p1.x < minX) || (p0.x > maxX && p1.x > maxX) ||
(p0.z < minZ && p1.z < minZ) || (p0.z > maxZ && p1.z > maxZ)) {
continue;
}

const midX = (p0.x + p1.x) / 2;
const midZ = (p0.z + p1.z) / 2;
const length = Math.hypot(p1.x - p0.x, p1.z - p0.z);
const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
const width = seg.width || 10;
const type = seg.type || 'highway';

// PATCH: Mặt đường màu đen asphalt tối
let roadColor = 0x1a1a1a; 
let shoulderColor = 0x2a2a2a;
let stripeColor = 0xffffff; // Vạch trắng

if (type === 'highway' || type === 'highway_entrance' || type === 'highway_exit') {
roadColor = 0x0a0a0a; // Đen nhánh cho cao tốc
shoulderColor = 0x333333;
stripeColor = 0xffff00; // Vàng cho highway
} else if (type === 'urban') {
roadColor = 0x1a1a1a;
stripeColor = 0xffffff;
} else if (type === 'mountain') {
roadColor = 0x2a2a2a;
stripeColor = 0xcccccc;
} else if (type === 'tunnel') {
roadColor = 0x000000;
stripeColor = 0x888888;
} else if (type.includes('road')) {
roadColor = 0x222222;
stripeColor = 0xffffff;
}

// Mặt đường
const roadMat = new THREE.MeshStandardMaterial({ color: roadColor, roughness: 0.9 });
const road = new THREE.Mesh(new THREE.BoxGeometry(width, 0.2, length), roadMat);
road.position.set(midX, 0.1, midZ);
road.rotation.y = angle;
road.receiveShadow = true;
group.add(road);

// Vạch kẻ giữa (chỉ cho đường 2 chiều)
if (type !== 'bus_station_road' && type !== 'rest_stop_road' && type !== 'gas_station_road') {
const stripeMat = new THREE.MeshStandardMaterial({ color: stripeColor });
const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, length - 1), stripeMat);
stripe.position.set(midX, 0.21, midZ);
stripe.rotation.y = angle;
group.add(stripe);
}

// Làn khẩn cấp cho highway
if ((type === 'highway' || type === 'highway_entrance' || type === 'highway_exit') && width > 16) {
const shoulderMat = new THREE.MeshStandardMaterial({ color: shoulderColor, roughness: 0.9 });
const shoulderWidth = 1.2;
const shoulderOffset = width/2 - shoulderWidth/2;
const shoulderGeo = new THREE.BoxGeometry(shoulderWidth, 0.2, length);
const shoulderL = new THREE.Mesh(shoulderGeo, shoulderMat);
shoulderL.position.set(midX - shoulderOffset * Math.sin(-angle), 0.1, midZ + shoulderOffset * Math.cos(-angle));
shoulderL.rotation.y = angle;
group.add(shoulderL);
const shoulderR = new THREE.Mesh(shoulderGeo, shoulderMat);
shoulderR.position.set(midX + shoulderOffset * Math.sin(-angle), 0.1, midZ - shoulderOffset * Math.cos(-angle));
shoulderR.rotation.y = angle;
group.add(shoulderR);
}
}
return group;
}