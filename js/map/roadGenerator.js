// js/map/roadGenerator.js - Sinh Road Mesh 3D bám theo Graph, Asphalt đen đồng nhất
import * as THREE from "three";

// Shared Materials (Tối ưu performance)
let asphaltMaterial = null;
let lineMaterial = null;
let medianMaterial = null;
let guardrailMaterial = null;

export function getAsphaltMaterial() {
    if (!asphaltMaterial) {
        asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.0 });
    }
    return asphaltMaterial;
}

function getLineMaterial() {
    if (!lineMaterial) lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    return lineMaterial;
}

function getMedianMaterial() {
    if (!medianMaterial) medianMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.8 });
    return medianMaterial;
}

function getGuardrailMaterial() {
    if (!guardrailMaterial) guardrailMaterial = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5, metalness: 0.5 });
    return guardrailMaterial;
}

export function createRoadSegmentMesh(seg, fromPos, toPos) {
    const group = new THREE.Group();
    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) return group;
    
    const angle = Math.atan2(dx, dz);
    const midX = (fromPos.x + toPos.x) / 2;
    const midZ = (fromPos.z + toPos.z) / 2;
    
    // 1. Mặt đường (Asphalt Đen)
    const roadGeo = new THREE.BoxGeometry(seg.width, 0.1, length);
    const roadMesh = new THREE.Mesh(roadGeo, getAsphaltMaterial());
    roadMesh.position.set(midX, 0.05, midZ);
    roadMesh.rotation.y = angle;
    group.add(roadMesh);
    
    // 2. Vạch kẻ sơn & Median
    const edgeOffset = seg.width / 2 - 0.3;
    const edgeGeo = new THREE.BoxGeometry(0.2, 0.11, length);
    
    // Vạch mép đường (Trắng)
    const edge1 = new THREE.Mesh(edgeGeo, getLineMaterial());
    edge1.position.set(midX, 0.11, midZ);
    edge1.rotation.y = angle;
    edge1.translateX(edgeOffset);
    group.add(edge1);
    
    const edge2 = new THREE.Mesh(edgeGeo, getLineMaterial());
    edge2.position.set(midX, 0.11, midZ);
    edge2.rotation.y = angle;
    edge2.translateX(-edgeOffset);
    group.add(edge2);
    
    // Vạch giữa đường / Median
    if (seg.twoWay) {
        const centerGeo = new THREE.BoxGeometry(0.3, 0.12, length);
        const centerMat = (seg.type === 'highway' || seg.type === 'expressway') ? getMedianMaterial() : getLineMaterial();
        const centerMesh = new THREE.Mesh(centerGeo, centerMat);
        centerMesh.position.set(midX, 0.12, midZ);
        centerMesh.rotation.y = angle;
        group.add(centerMesh);
    }
    
    // 3. Guardrail (Lan can) cho cao tốc
    if (seg.type === 'highway' || seg.type === 'expressway') {
        const railGeo = new THREE.BoxGeometry(0.1, 0.5, length);
        const rail1 = new THREE.Mesh(railGeo, getGuardrailMaterial());
        rail1.position.set(midX, 0.3, midZ);
        rail1.rotation.y = angle;
        rail1.translateX(seg.width / 2 + 0.2);
        group.add(rail1);
        
        const rail2 = new THREE.Mesh(railGeo, getGuardrailMaterial());
        rail2.position.set(midX, 0.3, midZ);
        rail2.rotation.y = angle;
        rail2.translateX(-(seg.width / 2 + 0.2));
        group.add(rail2);
    }

        // ĐÈN ĐƯỜNG: Thêm cột đèn và emissive dọc 2 bên lề (tối ưu không tạo PointLight)
    if (seg.type !== 'tunnel') {
        const numLights = Math.floor(length / 30); // Cứ 30m 1 đèn
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 0 });
        
        for (let i = 0; i < numLights; i++) {
            const t = (i + 0.5) / numLights;
            const x = fromPos.x + (toPos.x - fromPos.x) * t;
            const z = fromPos.z + (toPos.z - fromPos.z) * t;
            
            const rx = Math.cos(angle); // Right vector
            const rz = -Math.sin(angle);
            const offset = seg.width / 2 + 1;
            
            // Đèn bên trái
            const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7), poleMat);
            poleL.position.set(x + rx * offset, 3.5, z + rz * offset);
            group.add(poleL);
            const lampL = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), lampMat);
            lampL.position.set(x + rx * offset, 7, z + rz * offset);
            group.add(lampL);
            
            // Đèn bên phải
            const poleR = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7), poleMat);
            poleR.position.set(x - rx * offset, 3.5, z - rz * offset);
            group.add(poleR);
            const lampR = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), lampMat);
            lampR.position.set(x - rx * offset, 7, z - rz * offset);
            group.add(lampR);
        }
    }
    
    return group;
}

export function createRoadNetworkMesh(roadNetwork) {
    const group = new THREE.Group();
    group.name = "road_network";
    
    for (const seg of roadNetwork.segments) {
        const fromNode = roadNetwork.nodes.find(n => n.id === seg.from);
        const toNode = roadNetwork.nodes.find(n => n.id === seg.to);
        if (!fromNode?.position || !toNode?.position) continue;
        
        const segMesh = createRoadSegmentMesh(seg, fromNode.position, toNode.position);
        group.add(segMesh);
    }
    
    return group;
}