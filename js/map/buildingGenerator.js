// js/map/buildingGenerator.js - DIVERSE HOUSES, ROOFS, SIGNAGES & EASTER EGG
import * as THREE from "three";
import { roadNetwork, roadProfiles, getPOIs } from "./data/roadNetworkData.js";

const sharedHouseBodyGeo = new THREE.BoxGeometry(1, 1, 1);
const sharedRoofConeGeo = new THREE.ConeGeometry(0.8, 0.6, 4);
const sharedRoofFlatGeo = new THREE.BoxGeometry(1.05, 0.2, 1.05);
const sharedTreeTrunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 4, 6);
const sharedTreeLeavesGeo = new THREE.SphereGeometry(2.5, 8, 8);
const benchGeo = new THREE.BoxGeometry(2, 0.5, 0.8);

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 });
const benchMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 });
const industrialMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8, metalness: 0.3 });

const roofMats = [
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.9 })
];

const wallColors = [0xeeeeee, 0xcccccc, 0xfffacd, 0x87ceeb, 0xf0e68c];
const houseTextures = [];

function createHouseTexture(wallColor, doorColor, windowColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + wallColor.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#' + doorColor.toString(16).padStart(6, '0');
    ctx.fillRect(50, 70, 28, 58); 
    ctx.fillStyle = '#' + windowColor.toString(16).padStart(6, '0');
    ctx.fillRect(15, 80, 25, 25); ctx.fillRect(88, 80, 25, 25); 
    ctx.fillRect(15, 30, 25, 25); ctx.fillRect(88, 30, 25, 25); ctx.fillRect(50, 30, 28, 25); 
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

for (let i = 0; i < 10; i++) {
    const wall = wallColors[Math.floor(Math.random() * wallColors.length)];
    const door = [0x8b4513, 0x333333, 0x800000][Math.floor(Math.random() * 3)];
    const window = [0x87ceeb, 0xffff00, 0xfffacd][Math.floor(Math.random() * 3)];
    houseTextures.push({
        tex: createHouseTexture(wall, door, window),
        mat: new THREE.MeshStandardMaterial({ map: createHouseTexture(wall, door, window), roughness: 0.8 })
    });
}

const shopNames = ["Tạp Hóa", "Văn Tèo", "Cô Ba", "Minh Anh", "Thành Công", "Sáu Phước", "Góc Phố", "Hoàng Long", "Bà Năm", "Điện Máy"];
const shopTextures = shopNames.map(name => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'][Math.floor(Math.random()*4)];
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 64);
    return new THREE.CanvasTexture(canvas);
});

const tgddTex = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffcc00'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#000000'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText("THẾ GIỚI DI ĐỘNG", 128, 64);
    return new THREE.CanvasTexture(canvas);
})();

const tgddMat = new THREE.MeshStandardMaterial({ map: tgddTex, roughness: 0.6 });

const trustMeBroHouseTex = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText("ĐỊT MẸ MÀY", 128, 64);
    return new THREE.CanvasTexture(canvas);
})();

let trustMeBroSignPlaced = false;
let trustMeBroHousePlaced = false;

export function generateBuildings({ chunkX, chunkZ, chunkSize, random, colliders }) {
    const group = new THREE.Group();
    group.name = "buildings";
    
    const nodes = new Map(roadNetwork.nodes.map(n => [n.id, n]));
    
    const chunkMinX = chunkX * chunkSize;
    const chunkMaxX = chunkMinX + chunkSize;
    const chunkMinZ = chunkZ * chunkSize;
    const chunkMaxZ = chunkMinZ + chunkSize;
    
    const segments = [];
    for (const s of roadNetwork.segments) {
        const f = nodes.get(s.from);
        const t = nodes.get(s.to);
        if (!f?.position || !t?.position) continue;
        
        const p1x = f.position.x, p1z = f.position.z;
        const p2x = t.position.x, p2z = t.position.z;
        
        const segMinX = Math.min(p1x, p2x);
        const segMaxX = Math.max(p1x, p2x);
        const segMinZ = Math.min(p1z, p2z);
        const segMaxZ = Math.max(p1z, p2z);
        
        if (segMaxX < chunkMinX || segMinX > chunkMaxX || segMaxZ < chunkMinZ || segMinZ > chunkMaxZ) continue;
        
        const profile = roadProfiles[s.type] || { width: 12 };
        segments.push({
            p1: new THREE.Vector3(p1x, 0, p1z),
            p2: new THREE.Vector3(p2x, 0, p2z),
            width: profile.width || 12,
            type: s.type
        });
    }

    if (segments.length === 0) return group;

    const pois = getPOIs();
    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const zCenter = startZ + chunkSize / 2;
    let density = 5; let zone = 'rural';
    if (zCenter > -1000) { density = 5; zone = 'urban'; }
    else if (zCenter > -4500) { density = 3; zone = 'rural'; }
    else if (zCenter < -13000 && zCenter > -14000) { density = 5; zone = 'industrial'; } 
    else { density = 15; zone = 'hcm'; }

    const buildingCount = Math.floor(random() * density) + 3;

    for (let i = 0; i < buildingCount; i++) {
        if (segments.length === 0) break;
        const seg = segments[Math.floor(random() * segments.length)];
        if (!seg || !seg.p1 || !seg.p2) continue;
        
        if (seg.type === 'expressway' || seg.type === 'highway_ramp' || seg.type === 'toll_road') continue;
        
        const segDir = new THREE.Vector3().subVectors(seg.p2, seg.p1);
        const segLen = segDir.length();
        if (segLen === 0) continue;
        segDir.normalize();
        
        const t = random();
        const posOnSeg = seg.p1.clone().addScaledVector(segDir, segLen * t);
        
        const rightDir = new THREE.Vector3(-segDir.z, 0, segDir.x);
        const side = random() > 0.5 ? 1 : -1;
        const buffer = 15 + random() * 20;
        const spawnPos = posOnSeg.clone().addScaledVector(rightDir, side * (seg.width / 2 + buffer));
        
        if (spawnPos.x < startX || spawnPos.x > startX + chunkSize || spawnPos.z < startZ || spawnPos.z > startZ + chunkSize) continue;

        let tooCloseToStation = false;
        for (const poi of pois) {
            const poiPos = new THREE.Vector3(poi.position.x, 0, poi.position.z);
            if (spawnPos.distanceTo(poiPos) < 40) { tooCloseToStation = true; break; }
        }
        if (tooCloseToStation) continue;

        const width = 8 + random() * 8;
        const depth = 8 + random() * 8;
        let height = 6 + random() * 6;
        let isShop = false;
        let isTall = false;
        let bodyMat;

        if (zone === 'industrial') {
            height = 15 + random() * 10;
            bodyMat = industrialMat;
        } else if (zone === 'hcm' && random() > 0.6) {
            height = 25 + random() * 30; isTall = true;
            bodyMat = houseTextures[Math.floor(random() * houseTextures.length)].mat;
        } else {
            if (random() > 0.7) isShop = true;
            if (random() > 0.95) bodyMat = tgddMat; 
            else bodyMat = isShop ? new THREE.MeshStandardMaterial({ map: shopTextures[Math.floor(random() * shopTextures.length)], roughness: 0.8 }) : houseTextures[Math.floor(random() * houseTextures.length)].mat;
        }

        const body = new THREE.Mesh(sharedHouseBodyGeo, bodyMat);
        body.position.copy(spawnPos);
        body.position.y = height / 2;
        body.scale.set(width, height, depth);
        body.updateMatrix();
        group.add(body);

        if (!isTall && zone !== 'industrial') {
            const roof = new THREE.Mesh(sharedRoofConeGeo, roofMats[Math.floor(random() * roofMats.length)]);
            roof.position.copy(spawnPos);
            roof.position.y = height + 0.3;
            const roofScale = Math.max(width, depth) * 0.75;
            roof.scale.set(roofScale, 1, roofScale);
            roof.rotation.y = Math.PI / 4;
            roof.updateMatrix();
            group.add(roof);
        } else {
            const roof = new THREE.Mesh(sharedRoofFlatGeo, roofMats[0]);
            roof.position.copy(spawnPos);
            roof.position.y = height + 0.1;
            roof.scale.set(width, 1, depth);
            roof.updateMatrix();
            group.add(roof);
        }

        if (colliders) colliders.push({ x: spawnPos.x, z: spawnPos.z, r: Math.max(width, depth) / 2, type: 'static', chunkKey: `${chunkX},${chunkZ}` });
    }

    if (!trustMeBroSignPlaced && chunkX === 0 && chunkZ === 0) {
        const signMat = new THREE.MeshBasicMaterial({ map: trustMeBroHouseTex, transparent: true, side: THREE.DoubleSide });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), signMat);
        sign.position.set(0, 5, 0);
        sign.rotation.y = Math.PI / 2;
        group.add(sign);
        trustMeBroSignPlaced = true;
    }
    
    if (!trustMeBroHousePlaced && random() > 0.95) {
        const houseMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
        const house = new THREE.Mesh(sharedHouseBodyGeo, houseMat);
        house.position.set(startX + chunkSize/2, 3, startZ + chunkSize/2);
        house.scale.set(10, 6, 10);
        group.add(house);
        
        const signMat = new THREE.MeshBasicMaterial({ map: trustMeBroHouseTex, transparent: true, side: THREE.DoubleSide });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), signMat);
        sign.position.set(house.position.x, 6, house.position.z + 5);
        group.add(sign);
        trustMeBroHousePlaced = true;
    }

    for (const poi of pois) {
        if (poi.type === 'park' && poi.position.x >= startX && poi.position.x <= startX + chunkSize && poi.position.z >= startZ && poi.position.z <= startZ + chunkSize) {
            const parkW = poi.size?.width || 60;
            const parkD = poi.size?.depth || 60;
            const grass = new THREE.Mesh(new THREE.PlaneGeometry(parkW, parkD), grassMat);
            grass.rotation.x = -Math.PI / 2; grass.position.set(poi.position.x, 0.1, poi.position.z);
            group.add(grass);
            for(let i=0; i<5; i++) {
                const px = poi.position.x - parkW/2 + 10 + i*10;
                const pz = poi.position.z - 5;
                const bench = new THREE.Mesh(benchGeo, benchMat);
                bench.position.set(px, 0.25, pz);
                bench.rotation.y = Math.PI / 2;
                group.add(bench);
                const treeX = px + 5;
                const treeZ = pz + 10;
                const trunk = new THREE.Mesh(sharedTreeTrunkGeo, trunkMat);
                trunk.position.set(treeX, 2, treeZ); group.add(trunk);
                const leaves = new THREE.Mesh(sharedTreeLeavesGeo, leavesMat);
                leaves.position.set(treeX, 5, treeZ); group.add(leaves);
            }
        }
    }

    return group;
}