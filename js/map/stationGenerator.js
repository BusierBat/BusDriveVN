// js/map/stationGenerator.js - GENERATE STATIONS & GAS CANOPY
import * as THREE from "three";
import { getAsphaltMaterial } from "./roadGenerator.js";

const stationMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 });
const canopyMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.5 }); // Đỏ Petrolimex
const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });

export function createBusStation(poi, parentGroup, parkingSlotsArray) {
    const group = new THREE.Group();
    group.name = poi.name || "Bus Station";
    const w = Math.min((poi.size?.width || 500) / 20, 50);
    const h = Math.min((poi.size?.height || 50) / 5, 15);
    const d = Math.min((poi.size?.depth || 400) / 20, 40);

    const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stationMat);
    building.position.set(poi.position.x, h / 2, poi.position.z - d/2);
    group.add(building);

    const platform = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, d * 2), getAsphaltMaterial());
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(platform);

    const numSlots = poi.parkingSlots || 5;
    poi._parkingTransforms = [];
    for (let i = 0; i < numSlots; i++) {
        const slotX = poi.position.x - (w / 2) + 5 + (i * 6);
        const slotZ = poi.position.z + (d / 2) + 10;
        poi._parkingTransforms.push({ x: slotX, z: slotZ, heading: Math.PI });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(5, 2), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(slotX, 0.15, slotZ);
        group.add(line);
        if (parkingSlotsArray) parkingSlotsArray.push({ x: slotX, z: slotZ, rotation: Math.PI, occupied: true });
    }
    parentGroup.add(group);
}

export function createRestStop(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Rest Stop";
    const w = 30, h = 10, d = 20;
    const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stationMat);
    building.position.set(poi.position.x, h / 2, poi.position.z - d/2);
    group.add(building);
    const platform = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, d * 2), getAsphaltMaterial());
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(platform);
    parentGroup.add(group);
}

// HÀM MỚI: TẠO CÂY XĂNG
export function createGasStation(poi, parentGroup) {
    const group = new THREE.Group();
    group.name = poi.name || "Gas Station";
    const w = Math.min((poi.size?.width || 200) / 20, 20);
    const d = Math.min((poi.size?.depth || 100) / 20, 10);

    // Nền
    const platform = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, d * 3), getAsphaltMaterial());
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(poi.position.x, 0.1, poi.position.z);
    group.add(platform);

    // Cửa hàng (Shop)
    const shop = new THREE.Mesh(new THREE.BoxGeometry(w, 5, d), stationMat);
    shop.position.set(poi.position.x, 2.5, poi.position.z - d);
    group.add(shop);

    // Má che máy bơm (Canopy)
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(w * 1.5, 0.5, d * 1.5), canopyMat);
    canopy.position.set(poi.position.x, 6, poi.position.z + 2);
    group.add(canopy);

    // Cột chống mái
    for(let i=-1; i<=1; i+=2) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6), stationMat);
        pillar.position.set(poi.position.x + (w/2)*i, 3, poi.position.z + 2);
        group.add(pillar);
    }

    // Parking slots
    const numSlots = poi.parkingSlots || 3;
    poi._parkingTransforms = [];
    for (let i = 0; i < numSlots; i++) {
        const slotX = poi.position.x - 5 + (i * 5);
        const slotZ = poi.position.z + d + 5;
        poi._parkingTransforms.push({ x: slotX, z: slotZ, heading: 0 });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(slotX, 0.15, slotZ);
        group.add(line);
    }

    parentGroup.add(group);
}