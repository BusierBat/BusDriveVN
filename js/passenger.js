// js/passenger.js
import * as THREE from "three";

export function createPassengerSystem({ scene, map, npc, bus, ui }) {
  const passengerGroup = new THREE.Group();
  passengerGroup.name = "passengers";
  scene.add(passengerGroup);

  let waitingPassengers = [];
  let onboardPassengers = [];
  const MAX_PASSENGERS = 24;
  const PICKUP_RANGE = 10;
  
  // Màu sắc ngẫu nhiên cho hành khách
  const SKIN_COLORS = [0xe8c9a0, 0xd4a574, 0xc4956a, 0xf5d6b8];
  const CLOTH_COLORS = [0x4a6fa5, 0xd64545, 0x2d7d46, 0x8b6b4a, 0x5d7f9c, 0x7c5f8f];
  
  // Hiệu ứng glow
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  const gctx = glowCanvas.getContext('2d');
  const gradient = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0, 200, 255, 0.8)');
  gradient.addColorStop(0.3, 'rgba(0, 180, 255, 0.4)');
  gradient.addColorStop(1, 'rgba(0, 150, 255, 0)');
  gctx.fillStyle = gradient;
  gctx.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    depthWrite: false,
    color: 0x00ccff
  });

  // Tạo model hành khách
  function createPassengerModel(color1, color2) {
    const group = new THREE.Group();
    
    // Thân
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.14, 0.25, 4, 6),
      new THREE.MeshStandardMaterial({ color: color1 || 0x4a6fa5, roughness: 0.8 })
    );
    body.position.y = 0.25;
    group.add(body);
    
    // Đầu
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshStandardMaterial({ color: color2 || 0xe8c9a0, roughness: 0.7 })
    );
    head.position.y = 0.6;
    group.add(head);
    
    // Va li
    const luggage = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.12, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 })
    );
    luggage.position.set(0.15, 0.08, 0);
    group.add(luggage);
    
    return group;
  }

  // Tạo glow sprite cho mỗi hành khách
  function createGlow() {
    const sprite = new THREE.Sprite(glowMaterial.clone());
    sprite.scale.set(3, 3, 1);
    sprite.renderOrder = 2;
    return sprite;
  }

  // Load hành khách từ NPC waiting
  function loadPassengers() {
    const waiting = npc.getWaitingPassengers ? npc.getWaitingPassengers() : [];
    const currentIds = new Set(waitingPassengers.map(p => p.id));
    
    for (const w of waiting) {
      if (currentIds.has(w.id)) continue;
      if (waitingPassengers.length >= 50) break;
      
      const skinColor = pickRandom(SKIN_COLORS);
      const clothColor = pickRandom(CLOTH_COLORS);
      const model = createPassengerModel(clothColor, skinColor);
      model.position.set(w.x, w.y, w.z);
      model.rotation.y = Math.random() * Math.PI * 2;
      
      const glow = createGlow();
      glow.position.set(w.x, w.y + 1.5, w.z);
      
      passengerGroup.add(model);
      passengerGroup.add(glow);
      
      waitingPassengers.push({
        id: w.id,
        model: model,
        glow: glow,
        x: w.x,
        z: w.z,
        y: w.y,
        picked: false,
        destination: w.destination || null,
        glowIntensity: 0,
        inRange: false
      });
    }
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Cập nhật trạng thái hành khách
  function updatePassengers(busPos, busHeading) {
    const now = Date.now() / 1000;
    let nearCount = 0;
    
    for (const p of waitingPassengers) {
      if (p.picked) continue;
      
      const dx = p.x - busPos.x;
      const dz = p.z - busPos.z;
      const dist = Math.hypot(dx, dz);
      
      // Kiểm tra hành khách trong phạm vi đón
      const inRange = dist < PICKUP_RANGE;
      p.inRange = inRange;
      
      // Hiệu ứng glow nhấp nháy khi ở gần
      if (inRange) {
        p.glowIntensity = Math.sin(now * 3) * 0.3 + 0.7;
        p.glow.material.opacity = p.glowIntensity * 0.8;
        p.glow.scale.set(3 + Math.sin(now * 2) * 0.5, 3 + Math.sin(now * 2) * 0.5, 1);
        nearCount++;
        
        // Hiển thị indicator trên UI
        if (dist < 5) {
          ui?.toast(`🚶 Có khách chờ! Nhấn K để đón (${nearCount} người)`);
        }
      } else {
        p.glow.material.opacity = 0.1;
        p.glow.scale.set(2, 2, 1);
      }
    }
    
    // Cập nhật hành khách trên xe
    for (const p of onboardPassengers) {
      // Hành khách ngồi trên giường (hoặc đứng)
      if (p.model) {
        p.model.position.lerp(
          new THREE.Vector3(p.targetX || 0, p.targetY || 0.5, p.targetZ || 0),
          0.05
        );
      }
    }
  }

  // Đón khách
  function pickUpPassengers() {
    const busPos = bus.group.position;
    let picked = 0;
    
    // Tìm hành khách trong phạm vi
    const inRange = waitingPassengers.filter(p => !p.picked && p.inRange);
    
    // Giới hạn số lượng
    const available = Math.min(inRange.length, MAX_PASSENGERS - onboardPassengers.length);
    
    for (let i = 0; i < available && i < inRange.length; i++) {
      const p = inRange[i];
      p.picked = true;
      
      // Ẩn glow
      p.glow.visible = false;
      
      // Chuyển hành khách lên xe
      const bedIndex = onboardPassengers.length % 20; // 20 giường
      const side = (Math.floor(bedIndex / 10) % 2 === 0) ? 1 : -1;
      const bayZ = [2.7, 0.9, -0.9, -2.7, -4.5];
      const tier = (bedIndex % 10) < 5 ? 0.67 : 1.67;
      const zIndex = (bedIndex % 10) % 5;
      
      // Vị trí trên xe (tương đối)
      const localPos = new THREE.Vector3(
        side * 0.75,
        tier + 0.1,
        bayZ[zIndex]
      );
      bus.group.localToWorld(localPos);
      
      p.model.position.copy(localPos);
      p.model.rotation.y = Math.random() * Math.PI * 2;
      
      // Scale nhỏ lại khi ở trên xe
      p.model.scale.set(0.6, 0.6, 0.6);
      
      onboardPassengers.push({
        id: p.id,
        model: p.model,
        destination: p.destination,
        targetX: localPos.x,
        targetY: localPos.y,
        targetZ: localPos.z
      });
      
      picked++;
    }
    
    if (picked > 0) {
      ui?.toast(`✅ Đã đón ${picked} khách! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
    } else if (inRange.length === 0) {
      ui?.toast("❌ Không có khách ở gần!");
    } else {
      ui?.toast(`⚠️ Xe đã đầy! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
    }
    
    return picked;
  }

  // Trả khách tại điểm đến
  function dropOffPassengers(destination) {
    let dropped = 0;
    const remaining = [];
    
    for (const p of onboardPassengers) {
      if (p.destination === destination) {
        // Trả khách xuống
        const busPos = bus.group.position;
        const dropPos = new THREE.Vector3(
          busPos.x + (Math.random() - 0.5) * 4,
          0.5,
          busPos.z + (Math.random() - 0.5) * 4
        );
        dropPos.y = map.getHeight(dropPos.x, dropPos.z) + 0.1;
        
        p.model.position.copy(dropPos);
        p.model.scale.set(1, 1, 1);
        p.model.rotation.y = Math.random() * Math.PI * 2;
        
        // Xóa khỏi danh sách sau 1 giây
        setTimeout(() => {
          if (p.model.parent) {
            passengerGroup.remove(p.model);
          }
        }, 1000);
        
        dropped++;
      } else {
        remaining.push(p);
      }
    }
    
    onboardPassengers = remaining;
    
    if (dropped > 0) {
      ui?.toast(`✅ Đã trả ${dropped} khách tại ${destination}!`);
    }
    
    return dropped;
  }

  // Cập nhật hành khách chờ từ NPC
  function refreshWaiting() {
    loadPassengers();
  }

  // Lấy số lượng hành khách
  function getPassengerCount() {
    return {
      waiting: waitingPassengers.filter(p => !p.picked).length,
      onboard: onboardPassengers.length,
      max: MAX_PASSENGERS
    };
  }

  // Khởi tạo
  loadPassengers();

  // Update loop
  function update(dt) {
    const busPos = bus.group.position;
    updatePassengers(busPos, bus.group.rotation.y);
  }

  // Cleanup
  function dispose() {
    scene.remove(passengerGroup);
    while(passengerGroup.children.length) {
      passengerGroup.remove(passengerGroup.children[0]);
    }
  }

  return {
    update,
    pickUpPassengers,
    dropOffPassengers,
    refreshWaiting,
    getPassengerCount,
    dispose,
    passengerGroup,
    waitingPassengers,
    onboardPassengers
  };
}