// js/map/stationGenerator.js

import * as THREE from "three";
import { getAsphaltMaterial } from "./roadGenerator.js";

const stationMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.9 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 });
const tollMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.5 });
const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
const fenceMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9, metalness: 0.5 });
const signMat = new THREE.MeshStandardMaterial({ color: 0x0000ff, emissive: 0x0000ff, emissiveIntensity: 0.5 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 });
const benchMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 });

const lampPoleGeo = new THREE.CylinderGeometry(0.2, 0.2, 8);
const lampHeadGeo = new THREE.SphereGeometry(0.5, 8, 8);
const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 1 });
const sharedTreeTrunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 4, 6);
const sharedTreeLeavesGeo = new THREE.SphereGeometry(2.5, 8, 8);
const benchGeo = new THREE.BoxGeometry(2, 0.5, 0.8);

function addLamp(group, x, z) {
    const pole = new THREE.Mesh(lampPoleGeo, pillarMat);
    pole.position.set(x, 4, z);
    group.add(pole);
    const head = new THREE.Mesh(lampHeadGeo, lightMat);
    head.position.set(x, 8, z);
    group.add(head);
}

function addFence(group, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const angle = Math.atan2(dz, dx);
    const fenceGeo = new THREE.BoxGeometry(len, 2, 0.2);
    const fence = new THREE.Mesh(fenceGeo, fenceMat);
    fence.position.set((x1+x2)/2, 1, (z1+z2)/2);
    fence.rotation.y = -angle;
    group.add(fence);
    for (let i = 0; i <= len; i += 4) {
        const px = x1 + (dx / len) * i;
        const pz = z1 + (dz / len) * i;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.5), pillarMat);
        pillar.position.set(px, 1.25, pz);
        group.add(pillar);
    }
}

function addSign(group, x, z, name, rotY = 0) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6), pillarMat);
    pole.position.set(x, 3, z);
    group.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 0.2), signMat);
    board.position.set(x, 7, z);
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
    textPlane.position.set(x, 7, z + 0.15);
    textPlane.rotation.y = rotY;
    group.add(textPlane);
}

export function createBusStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Bus Station";
    const yardW = 120, yardD = 100;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(yardW, yardD), getAsphaltMaterial());
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(yard);

    const bldW = 50, bldH = 15, bldD = 20;
    const building = new THREE.Mesh(new THREE.BoxGeometry(bldW, bldH, bldD), glassMat);
    building.position.set(poi.position.x, bldH / 2, poi.position.z - yardD / 2 + bldD / 2);
    group.add(building);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(bldW + 10, 1, bldD + 5), roofMat);
    roof.position.set(poi.position.x, bldH + 1, poi.position.z - yardD / 2 + bldD / 2);
    group.add(roof);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(yardW * 0.8, 1, 10), roofMat);
    canopy.position.set(poi.position.x, 6, poi.position.z - 15);
    group.add(canopy);
    for (let i = -3; i <= 3; i++) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6), pillarMat);
        pillar.position.set(poi.position.x + i * 15, 3, poi.position.z - 19);
        group.add(pillar);
    }

    const numSlots = poi.parkingSlots || 15;
    poi._parkingTransforms = [];
    const slotStartX = poi.position.x - (numSlots * 3);
    for (let i = 0; i < numSlots; i++) {
        const slotX = slotStartX + i * 6;
        const slotZ = poi.position.z + 20;
        poi._parkingTransforms.push({ x: slotX, z: slotZ, heading: 0 });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(5, 2), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(slotX, 0.15, slotZ);
        group.add(line);
    }

    const halfW = yardW / 2, halfD = yardD / 2;
    addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - 5, poi.position.z - halfD);
    addFence(group, poi.position.x + 5, poi.position.z - halfD, poi.position.x + halfW, poi.position.z - halfD);
    addFence(group, poi.position.x - halfW, poi.position.z + halfD, poi.position.x + halfW, poi.position.z + halfD);
    addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - halfW, poi.position.z + halfD);
    addFence(group, poi.position.x + halfW, poi.position.z - halfD, poi.position.x + halfW, poi.position.z + halfD);
    addSign(group, poi.position.x, poi.position.z - halfD - 2, poi.name, 0);

    addLamp(group, poi.position.x - yardW/2 + 5, poi.position.z + 10);
    addLamp(group, poi.position.x + yardW/2 - 5, poi.position.z + 10);
    addLamp(group, poi.position.x, poi.position.z - 10);
    parentGroup.add(group);
}

export function createRestStop(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Rest Stop";
    const yardW = 60, yardD = 50;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(yardW, yardD), getAsphaltMaterial());
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(yard);
    const bldW = 20, bldH = 10, bldD = 15;
    const building = new THREE.Mesh(new THREE.BoxGeometry(bldW, bldH, bldD), stationMat);
    building.position.set(poi.position.x, bldH / 2, poi.position.z - yardD/2 + bldD/2);
    group.add(building);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(yardW * 0.6, 1, 8), roofMat);
    canopy.position.set(poi.position.x, 6, poi.position.z + 5);
    group.add(canopy);
    poi._parkingTransforms = [];
    for (let i = 0; i < 5; i++) {
        const slotX = poi.position.x - 10 + i * 5;
        const slotZ = poi.position.z + 15;
        poi._parkingTransforms.push({ x: slotX, z: slotZ, heading: 0 });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(slotX, 0.15, slotZ);
        group.add(line);
    }
    const halfW = yardW / 2, halfD = yardD / 2;
    addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - 5, poi.position.z - halfD);
    addFence(group, poi.position.x + 5, poi.position.z - halfD, poi.position.x + halfW, poi.position.z - halfD);
    addFence(group, poi.position.x - halfW, poi.position.z + halfD, poi.position.x + halfW, poi.position.z + halfD);
    addFence(group, poi.position.x - halfW, poi.position.z - halfD, poi.position.x - halfW, poi.position.z + halfD);
    addFence(group, poi.position.x + halfW, poi.position.z - halfD, poi.position.x + halfW, poi.position.z + halfD);
    addSign(group, poi.position.x, poi.position.z - halfD - 2, poi.name, 0);
    addLamp(group, poi.position.x - 20, poi.position.z);
    addLamp(group, poi.position.x + 20, poi.position.z);
    parentGroup.add(group);
}

export function createGasStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Gas Station";
    const yardW = 50, yardD = 40;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(yardW, yardD), getAsphaltMaterial());
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(yard);
    const shop = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 10), stationMat);
    shop.position.set(poi.position.x, 4, poi.position.z - 10);
    group.add(shop);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 15), roofMat);
    canopy.position.set(poi.position.x, 7, poi.position.z + 5);
    group.add(canopy);
    for (let i = -1; i <= 1; i++) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7), pillarMat);
        pillar.position.set(poi.position.x + i * 10, 3.5, poi.position.z + 5);
        group.add(pillar);
        const pump = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 1), tollMat);
        pump.position.set(poi.position.x + i * 10, 0.75, poi.position.z + 2);
        group.add(pump);
    }
    poi._parkingTransforms = [];
    for (let i = 0; i < 5; i++) {
        const slotX = poi.position.x - 15 + i * 6;
        const slotZ = poi.position.z + 15;
        poi._parkingTransforms.push({ x: slotX, z: slotZ, heading: 0 });
    }
    addSign(group, poi.position.x, poi.position.z - 20, poi.name, 0);
    addLamp(group, poi.position.x - 15, poi.position.z + 10);
    addLamp(group, poi.position.x + 15, poi.position.z + 10);
    parentGroup.add(group);
}

export function createTollStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Toll Station";
    const w = poi.size?.width || 100, d = poi.size?.depth || 40;
    const platform = new THREE.Mesh(new THREE.PlaneGeometry(w, d), getAsphaltMaterial());
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(platform);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d * 1.5), roofMat);
    roof.position.set(poi.position.x, 8, poi.position.z);
    group.add(roof);
    const numLanes = Math.floor(w / 5);
    for (let i = 0; i < numLanes; i++) {
        const boothX = poi.position.x - (w / 2) + 2.5 + (i * 5);
        const booth = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), tollMat);
        booth.position.set(boothX, 2, poi.position.z - d / 4);
        group.add(booth);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 0.2), tollMat);
        bar.position.set(boothX, 3.5, poi.position.z);
        bar.rotation.y = Math.PI / 2;
        group.add(bar);
    }
    addSign(group, poi.position.x, poi.position.z - d/2 - 2, poi.name, 0);
    parentGroup.add(group);
}

export function createPark(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Park";
    const w = poi.size?.width || 60;
    const d = poi.size?.depth || 60;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(w, d), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(grass);
    for (let i = 0; i < 5; i++) {
        const px = poi.position.x - w/2 + 10 + i*10;
        const pz = poi.position.z - 5;
        const bench = new THREE.Mesh(benchGeo, benchMat);
        bench.position.set(px, 0.25, pz);
        bench.rotation.y = Math.PI / 2;
        group.add(bench);
        const treeX = px + 5;
        const treeZ = pz + 10;
        const trunk = new THREE.Mesh(sharedTreeTrunkGeo, trunkMat);
        trunk.position.set(treeX, 2, treeZ);
        group.add(trunk);
        const leaves = new THREE.Mesh(sharedTreeLeavesGeo, leavesMat);
        leaves.position.set(treeX, 5, treeZ);
        group.add(leaves);
    }
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3, w * 0.8), getAsphaltMaterial());
    path.rotation.x = -Math.PI / 2;
    path.position.set(poi.position.x, 0.12, poi.position.z);
    group.add(path);
    parentGroup.add(group);
}
