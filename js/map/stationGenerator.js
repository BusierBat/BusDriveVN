// js/map/stationGenerator.js
import * as THREE from "three";
import { getAsphaltMaterial } from "./roadGenerator.js";

const _mats = {
    station: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 }),
    toll: new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.5 }),
    line: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 }),
    fence: new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9, metalness: 0.5 }),
    sign: new THREE.MeshStandardMaterial({ color: 0x0000ff, emissive: 0x0000ff, emissiveIntensity: 0.5 }),
    grass: new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 }),
    bench: new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 }),
    light: new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 1 })
};

const _geos = {
    lampPole: new THREE.CylinderGeometry(0.2, 0.2, 8),
    lampHead: new THREE.SphereGeometry(0.5, 8, 8),
    treeTrunk: new THREE.CylinderGeometry(0.5, 0.5, 4, 6),
    treeLeaves: new THREE.SphereGeometry(2.5, 8, 8),
    bench: new THREE.BoxGeometry(2, 0.5, 0.8)
};

function _addLamp(group, x, y, z) {
    const pole = new THREE.Mesh(_geos.lampPole, _mats.pillar);
    pole.position.set(x, y + 4, z);
    group.add(pole);
    const head = new THREE.Mesh(_geos.lampHead, _mats.light);
    head.position.set(x, y + 8, z);
    group.add(head);
}

function _addFence(group, x1, z1, x2, z2, y = 0) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const angle = Math.atan2(dz, dx);
    const fenceGeo = new THREE.BoxGeometry(len, 2, 0.2);
    const fence = new THREE.Mesh(fenceGeo, _mats.fence);
    fence.position.set((x1+x2)/2, y + 1, (z1+z2)/2);
    fence.rotation.y = -angle;
    group.add(fence);
    for (let i = 0; i <= len; i += 4) {
        const px = x1 + (dx / len) * i;
        const pz = z1 + (dz / len) * i;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.5), _mats.pillar);
        pillar.position.set(px, y + 1.25, pz);
        group.add(pillar);
    }
}

function _addSign(group, x, y, z, name, rotY = 0) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6), _mats.pillar);
    pole.position.set(x, y + 3, z);
    group.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 0.2), _mats.sign);
    board.position.set(x, y + 7, z);
    group.add(board);
    
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 256, 64);
    
    const tex = new THREE.CanvasTexture(canvas);
    const textMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), textMat);
    textPlane.position.set(x, y + 7, z + 0.15);
    textPlane.rotation.y = rotY;
    group.add(textPlane);
}

export function createBusStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Bus Station Complex";
    const yardW = 160, yardD = 120; 
    
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(yardW, yardD), getAsphaltMaterial());
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(poi.position.x, poi.position.y + 0.1, poi.position.z);
    group.add(yard);
    
    const bldW = 60, bldH = 20, bldD = 30;
    const building = new THREE.Mesh(new THREE.BoxGeometry(bldW, bldH, bldD), _mats.glass);
    building.position.set(poi.position.x, poi.position.y + bldH / 2, poi.position.z - yardD / 2 + bldD / 2);
    group.add(building);
    
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(yardW * 0.9, 1, 15), _mats.roof);
    canopy.position.set(poi.position.x, poi.position.y + 8, poi.position.z - 20);
    group.add(canopy);
    for (let i = -5; i <= 5; i++) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 8), _mats.pillar);
        pillar.position.set(poi.position.x + i * 12, poi.position.y + 4, poi.position.z - 25);
        group.add(pillar);
    }
    
    const numSlots = poi.parkingSlots || 15;
    poi._parkingTransforms = [];
    const slotStartX = poi.position.x - (numSlots * 4);
    for (let i = 0; i < numSlots; i++) {
        const slotX = slotStartX + i * 8; 
        const slotZ = poi.position.z + 30;
        poi._parkingTransforms.push({ x: slotX, y: poi.position.y, z: slotZ, heading: 0 });
        
        const line = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), _mats.line);
        line.rotation.x = -Math.PI / 2;
        line.position.set(slotX, poi.position.y + 0.15, slotZ);
        group.add(line);
    }
    
    const halfW = yardW / 2, halfD = yardD / 2;
    _addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - 10, poi.position.z - halfD, poi.position.y);
    _addFence(group, poi.position.x + 10, poi.position.z - halfD, poi.position.x + halfW, poi.position.z - halfD, poi.position.y);
    _addFence(group, poi.position.x - halfW, poi.position.z + halfD, poi.position.x + halfW, poi.position.z + halfD, poi.position.y);
    _addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - halfW, poi.position.z + halfD, poi.position.y);
    _addFence(group, poi.position.x + halfW, poi.position.z - halfD, poi.position.x + halfW, poi.position.z + halfD, poi.position.y);
    
    _addSign(group, poi.position.x, poi.position.y, poi.position.z - halfD - 2, poi.name, 0);
    _addLamp(group, poi.position.x - yardW/2 + 5, poi.position.y, poi.position.z + 10);
    _addLamp(group, poi.position.x + yardW/2 - 5, poi.position.y, poi.position.z + 10);
    _addLamp(group, poi.position.x, poi.position.y, poi.position.z - 10);
    
    parentGroup.add(group);
}

export function createRestStop(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Rest Stop Complex";
    const yardW = 80, yardD = 60;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(yardW, yardD), getAsphaltMaterial());
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(poi.position.x, poi.position.y + 0.1, poi.position.z);
    group.add(yard);
    
    const bldW = 30, bldH = 12, bldD = 20;
    const building = new THREE.Mesh(new THREE.BoxGeometry(bldW, bldH, bldD), _mats.station);
    building.position.set(poi.position.x, poi.position.y + bldH / 2, poi.position.z - yardD/2 + bldD/2);
    group.add(building);
    
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(yardW * 0.6, 1, 8), _mats.roof);
    canopy.position.set(poi.position.x, poi.position.y + 6, poi.position.z + 5);
    group.add(canopy);
    
    const numSlots = 8; 
    poi._parkingTransforms = [];
    for (let i = 0; i < numSlots; i++) {
        const slotX = poi.position.x - 15 + i * 5;
        const slotZ = poi.position.z + 15;
        poi._parkingTransforms.push({ x: slotX, y: poi.position.y, z: slotZ, heading: 0 });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), _mats.line);
        line.rotation.x = -Math.PI / 2;
        line.position.set(slotX, poi.position.y + 0.15, slotZ);
        group.add(line);
    }
    
    const halfW = yardW / 2, halfD = yardD / 2;
    _addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - 5, poi.position.z - halfD, poi.position.y);
    _addFence(group, poi.position.x + 5, poi.position.z - halfD, poi.position.x + halfW, poi.position.z - halfD, poi.position.y);
    _addFence(group, poi.position.x - halfW, poi.position.z + halfD, poi.position.x + halfW, poi.position.z + halfD, poi.position.y);
    _addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - halfW, poi.position.z + halfD, poi.position.y);
    _addFence(group, poi.position.x + halfW, poi.position.z - halfD, poi.position.x + halfW, poi.position.z + halfD, poi.position.y);
    
    _addSign(group, poi.position.x, poi.position.y, poi.position.z - halfD - 2, poi.name, 0);
    _addLamp(group, poi.position.x - 20, poi.position.y, poi.position.z);
    _addLamp(group, poi.position.x + 20, poi.position.y, poi.position.z);
    
    parentGroup.add(group);
}

export function createGasStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Gas Station Complex";
    const yardW = 60, yardD = 50;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(yardW, yardD), getAsphaltMaterial());
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(poi.position.x, poi.position.y + 0.1, poi.position.z);
    group.add(yard);
    
    const shop = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 12), _mats.station);
    shop.position.set(poi.position.x, poi.position.y + 5, poi.position.z - 15);
    group.add(shop);
    
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 20), _mats.roof);
    canopy.position.set(poi.position.x, poi.position.y + 8, poi.position.z + 5);
    group.add(canopy);
    
    for (let i = -1; i <= 1; i++) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 8), _mats.pillar);
        pillar.position.set(poi.position.x + i * 12, poi.position.y + 4, poi.position.z + 5);
        group.add(pillar);
        const pump = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 1), _mats.toll);
        pump.position.set(poi.position.x + i * 12, poi.position.y + 0.75, poi.position.z + 2);
        group.add(pump);
    }
    
    const numSlots = poi.parkingSlots || 5;
    poi._parkingTransforms = [];
    for (let i = 0; i < numSlots; i++) {
        const slotX = poi.position.x - 15 + i * 6;
        const slotZ = poi.position.z + 15;
        poi._parkingTransforms.push({ x: slotX, y: poi.position.y, z: slotZ, heading: 0 });
    }
    
    _addSign(group, poi.position.x, poi.position.y, poi.position.z - 20, poi.name, 0);
    _addLamp(group, poi.position.x - 15, poi.position.y, poi.position.z + 10);
    _addLamp(group, poi.position.x + 15, poi.position.y, poi.position.z + 10);
    
    parentGroup.add(group);
}

export function createTollStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Toll Station";
    const w = poi.size?.width || 120, d = poi.size?.depth || 50;
    const platform = new THREE.Mesh(new THREE.PlaneGeometry(w, d), getAsphaltMaterial());
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(poi.position.x, poi.position.y + 0.1, poi.position.z);
    group.add(platform);
    
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d * 1.5), _mats.roof);
    roof.position.set(poi.position.x, poi.position.y + 8, poi.position.z);
    group.add(roof);
    
    for (let i = -3; i <= 3; i++) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 8), _mats.pillar);
        pillar.position.set(poi.position.x + i * 18, poi.position.y + 4, poi.position.z);
        group.add(pillar);
        const booth = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), _mats.station);
        booth.position.set(poi.position.x + i * 18, poi.position.y + 2, poi.position.z);
        group.add(booth);
    }
    
    parentGroup.add(group);
}

export function createPark(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Park";
    const w = poi.size?.width || 100, d = poi.size?.depth || 100;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), _mats.grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(poi.position.x, poi.position.y + 0.1, poi.position.z);
    group.add(ground);
    
    for (let i = 0; i < 15; i++) { 
        const x = poi.position.x + (Math.random() - 0.5) * w * 0.8;
        const z = poi.position.z + (Math.random() - 0.5) * d * 0.8;
        const trunk = new THREE.Mesh(_geos.treeTrunk, _mats.trunk);
        trunk.position.set(x, poi.position.y + 2, z);
        group.add(trunk);
        const leaves = new THREE.Mesh(_geos.treeLeaves, _mats.leaves);
        leaves.position.set(x, poi.position.y + 5, z);
        group.add(leaves);
    }
    
    parentGroup.add(group);
}