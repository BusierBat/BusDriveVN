// js/passenger.js - HỆ THỐNG HÀNH KHÁCH (OPTIMIZED NO GC)
import * as THREE from "three";
const _tmpLerpTarget = new THREE.Vector3();
let _passengerUpdateTimer = 0;

export function createPassengerSystem({ scene, map, npc, bus, ui }) {
    const passengerGroup = new THREE.Group();
    passengerGroup.name = "passengers";
    scene.add(passengerGroup);
    let waitingPassengers = [];
    let onboardPassengers = [];
    const MAX_PASSENGERS = 24;
    const PICKUP_RANGE = 25;
    const SKIN_COLORS = [0xe8c9a0, 0xd4a574, 0xc4956a, 0xf5d6b8];
    const CLOTH_COLORS = [0x4a6fa5, 0xd64545, 0x2d7d46, 0x8b6b4a, 0x5d7f9c, 0x7c5f8f];
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256; glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    const gradient = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(0, 200, 255, 0.7)');
    gradient.addColorStop(0.4, 'rgba(0, 180, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 150, 255, 0)');
    gctx.fillStyle = gradient;
    gctx.fillRect(0, 0, 256, 256);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    function createHumanoidModel(color1, color2) {
        const g = new THREE.Group();
        const skinMat = new THREE.MeshStandardMaterial({ color: color2 || 0xe8c9a0, roughness: 0.7 });
        const clothMat = new THREE.MeshStandardMaterial({ color: color1 || 0x4a6fa5, roughness: 0.8 });
        const pantsMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.2), clothMat);
        torso.position.y = 1.1; g.add(torso);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), skinMat);
        head.position.y = 1.5; g.add(head);
        const armGeo = new THREE.CapsuleGeometry(0.06, 0.4, 4, 4);
        const leftArm = new THREE.Mesh(armGeo, skinMat);
        leftArm.position.set(-0.28, 1.1, 0); leftArm.rotation.z = 0.1; g.add(leftArm);
        const rightArm = new THREE.Mesh(armGeo, skinMat);
        rightArm.position.set(0.28, 1.1, 0); rightArm.rotation.z = -0.1; g.add(rightArm);
        const legGeo = new THREE.CapsuleGeometry(0.08, 0.6, 4, 4);
        const leftLeg = new THREE.Mesh(legGeo, pantsMat);
        leftLeg.position.set(-0.12, 0.4, 0); g.add(leftLeg);
        const rightLeg = new THREE.Mesh(legGeo, pantsMat);
        rightLeg.position.set(0.12, 0.4, 0); g.add(rightLeg);
        return g;
    }
    function createGlow() {
        const mat = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(12, 12, 1);
        return sprite;
    }
    function loadPassengers() {
        const waiting = npc.getWaitingPassengers ? npc.getWaitingPassengers() : [];
        const currentIds = new Set(waitingPassengers.map(p => p.id));
        for (const w of waiting) {
            if (currentIds.has(w.id)) continue;
            if (waitingPassengers.length >= 50) break;
            const model = createHumanoidModel(CLOTH_COLORS[Math.floor(Math.random()*CLOTH_COLORS.length)], SKIN_COLORS[Math.floor(Math.random()*SKIN_COLORS.length)]);
            model.position.set(w.x, w.y, w.z);
            model.rotation.y = Math.random() * Math.PI * 2;
            const glow = createGlow();
            glow.position.set(w.x, w.y + 0.5, w.z);
            passengerGroup.add(model);
            passengerGroup.add(glow);
            waitingPassengers.push({
                id: w.id, model, glow,
                x: w.x, z: w.z, y: w.y,
                picked: false, destination: w.destination,
                glowIntensity: 0, inRange: false,
                state: 'WAITING'
            });
        }
    }
    function updatePassengers(busPos, busHeading) {
        const now = Date.now() / 1000;
        for (const p of waitingPassengers) {
            if (p.picked) continue;
            const dx = p.x - busPos.x;
            const dz = p.z - busPos.z;
            const dist = Math.hypot(dx, dz);
            const inRange = dist < PICKUP_RANGE;
            p.inRange = inRange;
            if (inRange) {
                p.state = 'IN_PICKUP_ZONE';
                p.glowIntensity = Math.sin(now * 3) * 0.3 + 0.7;
                p.glow.material.opacity = p.glowIntensity * 0.8;
            } else {
                p.state = 'WAITING';
                p.glow.material.opacity = 0.5;
            }
        }
        for (const p of onboardPassengers) {
            if (p.model) {
                _tmpLerpTarget.set(p.targetX || 0, p.targetY || 0.5, p.targetZ || 0);
                p.model.position.lerp(_tmpLerpTarget, 0.05);
            }
        }
    }
    function pickUpPassengers() {
        if (!bus || !bus.doorOpen) {
            ui?.toast("❌ Phải mở cửa (K) để đón khách!");
            return 0;
        }
        const busPos = bus.group.position;
        let picked = 0;
        const inRange = waitingPassengers.filter(p => !p.picked && p.inRange);
        const available = Math.min(inRange.length, MAX_PASSENGERS - onboardPassengers.length);
        for (let i = 0; i < available && i < inRange.length; i++) {
            const p = inRange[i];
            p.picked = true; p.state = 'ON_BUS'; p.glow.visible = false;
            const bedIndex = onboardPassengers.length % 20;
            const side = (Math.floor(bedIndex / 10) % 2 === 0) ? 1 : -1;
            const bayZ = [2.7, 0.9, -0.9, -2.7, -4.5];
            const tier = (bedIndex % 10) < 5 ? 0.67 : 1.67;
            const zIndex = (bedIndex % 10) % 5;
            const localPos = new THREE.Vector3(side * 0.75, tier + 0.1, bayZ[zIndex]);
            bus.group.localToWorld(localPos);
            p.model.position.copy(localPos);
            p.model.rotation.y = Math.random() * Math.PI * 2;
            p.model.scale.set(0.6, 0.6, 0.6);
            onboardPassengers.push({ id: p.id, model: p.model, destination: p.destination, targetX: localPos.x, targetY: localPos.y, targetZ: localPos.z });
            picked++;
        }
        if (picked > 0) ui?.toast(`✅ Đón ${picked} khách! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
        else if (inRange.length === 0) ui?.toast("❌ Không có khách ở gần!");
        else ui?.toast(`⚠️ Xe đã đầy! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
        return picked;
    }
    function dropOffPassengers(destination) {
        let dropped = 0;
        const remaining = [];
        const busPos = bus.group.position;
        for (const p of onboardPassengers) {
            if (p.destination === destination) {
                const dropPos = new THREE.Vector3(busPos.x + (Math.random() - 0.5) * 4, 0.5, busPos.z + (Math.random() - 0.5) * 4);
                p.model.position.copy(dropPos);
                p.model.scale.set(1, 1, 1);
                setTimeout(() => { if (p.model.parent) passengerGroup.remove(p.model); }, 1000);
                dropped++;
            } else remaining.push(p);
        }
        onboardPassengers = remaining;
        if (dropped > 0) ui?.toast(`✅ Đã trả ${dropped} khách tại ${destination}!`);
        return dropped;
    }
    function getPassengerCount() {
        return {
            waiting: waitingPassengers.filter(p => !p.picked).length,
            onboard: onboardPassengers.length,
            max: MAX_PASSENGERS
        };
    }
    loadPassengers();
    function update(dt) {
        if (!bus?.group) return;
        // TỐI ƯU: 10Hz update là đủ cho passenger
        _passengerUpdateTimer += dt;
        if (_passengerUpdateTimer >= 0.1) {
            _passengerUpdateTimer = 0;
            updatePassengers(bus.group.position, bus.group.rotation.y);
        }
    }
    function dispose() { scene.remove(passengerGroup); while (passengerGroup.children.length) passengerGroup.remove(passengerGroup.children[0]); }
    return {
        update, pickUpPassengers, dropOffPassengers, getPassengerCount, dispose, passengerGroup,
        waitingPassengers, onboardPassengers, getActiveZones: () => waitingPassengers.filter(p => !p.picked)
    };
}