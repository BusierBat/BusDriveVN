// js/map/stationGenerator.js - Bến xe cổng rào biển sáng
import * as THREE from 'three';
import { getAsphaltMaterial } from './roadGenerator.js';

export function createBusStation(poi, parentGroup, parkingSlotsArray) {
    const group = new THREE.Group();
    group.name = poi.id;
    group.position.set(poi.position.x, 0, poi.position.z);
    const w = poi.size.width, h = poi.size.height, d = poi.size.depth;
    
    const groundMat = getAsphaltMaterial();
    const ground = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), groundMat);
    ground.position.y = 0.1;
    group.add(ground);
    
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.2 });
    const mainBuilding = new THREE.Mesh(new THREE.BoxGeometry(w * 0.35, h, d * 0.3), buildingMat);
    mainBuilding.position.set(0, h/2, -d * 0.15);
    group.add(mainBuilding);
    
    // Hàng rào & Cổng
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    const fenceHeight = 2;
    const fenceGeo = new THREE.BoxGeometry(0.2, fenceHeight, d * 0.8);
    
    const fenceL = new THREE.Mesh(fenceGeo, fenceMat);
    fenceL.position.set(-w/2 + 1, fenceHeight/2, d * 0.4);
    group.add(fenceL);
    const fenceR = new THREE.Mesh(fenceGeo, fenceMat);
    fenceR.position.set(w/2 - 1, fenceHeight/2, d * 0.4);
    group.add(fenceR);
    
    // Biển tên phát sáng
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#001f3f';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#00ff99';
    ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(poi.name, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    
    const signMat = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveIntensity: 1.5, emissiveMap: texture, side: THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, 3), signMat);
    sign.position.set(0, h + 2, d * 0.4);
    group.add(sign);
    
    // Đèn chiếu sáng biển
    const signLight = new THREE.PointLight(0x00ff99, 10, 30, 2);
    signLight.position.set(0, h + 2, d * 0.4 + 1);
    group.add(signLight);
    
    // Vạch đỗ xe
    const slotCount = poi.parkingSlots || 20;
    const spacing = 4.5;
    const slotBaseZ = d * 0.3;
    const halfSlots = Math.floor(slotCount / 2);
    for (let i = 0; i < slotCount; i++) {
        const x = (i - halfSlots) * spacing;
        const z = slotBaseZ;
        const slotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
        const slotMesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 5.5), slotMat);
        slotMesh.position.set(x, 0.15, z);
        group.add(slotMesh);
        
        if (parkingSlotsArray) {
            parkingSlotsArray.push({
                position: new THREE.Vector3(poi.position.x + x, 0, poi.position.z + z),
                rotation: 0, width: 2.8, length: 5.5, occupied: false, type: 'coach', index: i, station: poi.id
            });
        }
    }
    
    parentGroup.add(group);
    return group;
}

export function createRestStop(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.id;
    group.position.set(poi.position.x, 0, poi.position.z);
    const w = poi.size.width, h = poi.size.height, d = poi.size.depth;
    const ground = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), getAsphaltMaterial());
    ground.position.y = 0.1; group.add(ground);
    parentGroup.add(group);
    return group;
}