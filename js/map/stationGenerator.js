// js/map/stationGenerator.js
import * as THREE from 'three';

// Tạo bến xe
export function createBusStation(poi, parentGroup, parkingSlotsArray) {
  const group = new THREE.Group();
  group.name = poi.id;
  group.position.set(poi.position.x, 0, poi.position.z);

  const w = poi.size.width;
  const h = poi.size.height;
  const d = poi.size.depth;

  // Sân bê tông
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), groundMat);
  ground.position.y = 0.15;
  group.add(ground);

  // Nhà ga chính
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.2 });
  const mainBuilding = new THREE.Mesh(new THREE.BoxGeometry(w * 0.35, h, d * 0.3), buildingMat);
  mainBuilding.position.set(0, h/2, -d * 0.15);
  group.add(mainBuilding);

  // Mái che
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.7 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.3, d * 0.5), roofMat);
  roof.position.set(0, h * 0.85, 0);
  group.add(roof);

  // Cột trụ
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.8 });
  for (let x = -w * 0.25; x <= w * 0.25; x += w * 0.2) {
    for (let z = -d * 0.2; z <= d * 0.2; z += d * 0.2) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, h * 0.8, 6), pillarMat);
      pillar.position.set(x, h * 0.4, z);
      group.add(pillar);
    }
  }

  // Vạch đỗ xe
  const slotCount = poi.parkingSlots || 20;
  const spacing = 4.5;
  const slotBaseZ = d * 0.3;
  const halfSlots = Math.floor(slotCount / 2);
  for (let i = 0; i < slotCount; i++) {
    const x = (i - halfSlots) * spacing;
    const z = slotBaseZ;
    const slotMesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 5.5), new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 }));
    slotMesh.position.set(x, 0.2, z);
    group.add(slotMesh);
    // Lưu slot vào mảng parkingSlotsArray để NPC đỗ
    if (parkingSlotsArray) {
      parkingSlotsArray.push({
        position: new THREE.Vector3(poi.position.x + x, 0, poi.position.z + z),
        rotation: 0,
        width: 2.8,
        length: 5.5,
        occupied: false,
        type: 'coach',
        index: i,
        station: poi.id
      });
    }
  }

  // Biển hiệu
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#003366';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(poi.name, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sign.position.set(0, h + 3, 0);
  sign.scale.set(w * 0.6, 3.5, 1);
  group.add(sign);

  parentGroup.add(group);
  return group;
}

// Tạo trạm dừng
export function createRestStop(poi, parentGroup) {
  const group = new THREE.Group();
  group.name = poi.id;
  group.position.set(poi.position.x, 0, poi.position.z);

  const w = poi.size.width;
  const h = poi.size.height;
  const d = poi.size.depth;

  // Sân
  const ground = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.9 }));
  ground.position.y = 0.1;
  group.add(ground);

  // Nhà hàng / quán ăn
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0xddccbb, roughness: 0.7 });
  const building = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, h, d * 0.5), buildingMat);
  building.position.set(0, h/2, -d * 0.1);
  group.add(building);

  // Mái
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xcc5533, roughness: 0.6 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.3, d * 0.6), roofMat);
  roof.position.set(0, h * 0.8, 0);
  group.add(roof);

  // Biển
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cc5533';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(poi.name, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sign.position.set(0, h + 2, 0);
  sign.scale.set(w * 0.5, 3, 1);
  group.add(sign);

  parentGroup.add(group);
}

// Tạo cây xăng
export function createGasStation(poi, parentGroup) {
  const group = new THREE.Group();
  group.name = poi.id;
  group.position.set(poi.position.x, 0, poi.position.z);

  const w = poi.size.width;
  const h = poi.size.height;
  const d = poi.size.depth;

  // Sân
  const ground = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.9 }));
  ground.position.y = 0.1;
  group.add(ground);

  // Mái che
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.5 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.3, d * 0.6), roofMat);
  roof.position.set(0, h, 0);
  group.add(roof);

  // Cột trụ
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xa4b36b, roughness: 0.6 });
  const positions = [[-w*0.25, -d*0.2], [w*0.25, -d*0.2], [-w*0.25, d*0.2], [w*0.25, d*0.2]];
  for (const pos of positions) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, h, 6), pillarMat);
    pillar.position.set(pos[0], h/2, pos[1]);
    group.add(pillar);
  }

  // Trụ bơm
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.5 });
  for (let i = -1; i <= 1; i++) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 0.7), pumpMat);
    pump.position.set(i*3, 0.75, 0);
    group.add(pump);
  }

  // Biển
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cc3333';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(poi.name, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sign.position.set(0, h + 2, 0);
  sign.scale.set(w * 0.5, 3, 1);
  group.add(sign);

  parentGroup.add(group);
}