// js/passenger.js - Hệ thống hành khách hoàn chỉnh
import * as THREE from "three";
import { hypot2, clamp } from "./utils.js";

const _tmpLerpTarget = new THREE.Vector3();
let _passengerUpdateTimer = 0;
let _passengerScanTimer = 0;

export function createPassengerSystem({ scene, map, npc, bus, ui, interiorType = "BED20" }) {
    if (!scene || !bus || !npc) {
        console.error("PassengerSystem thiếu dependency quan trọng!");
        return { update: () => {}, pickUpPassengers: () => 0, dropOffPassengers: () => 0, getActiveZones: () => [], onboardPassengers: [] };
    }

    const passengerGroup = new THREE.Group();
    passengerGroup.name = "passengers";
    scene.add(passengerGroup);

    let waitingPassengers = [];
    let onboardPassengers = [];

    // Dung lượng xe theo cấu hình thực tế: xe 20 chỗ <= 20 khách, xe 34 chỗ <= 34 khách
    const isBed34 = interiorType === "BED34" || (window.gameSettings && window.gameSettings.interior === "BED34");
    const MAX_PASSENGERS = isBed34 ? 34 : 20;
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

    const _pGeo = {
        torso: new THREE.BoxGeometry(0.34, 0.47, 0.17),
        neck: new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6),
        head: new THREE.SphereGeometry(0.105, 10, 8),
        hair: new THREE.SphereGeometry(0.11, 8, 7),
        upperArm: new THREE.CapsuleGeometry(0.05, 0.28, 3, 4),
        forearm: new THREE.CapsuleGeometry(0.043, 0.26, 3, 4),
        hand: new THREE.BoxGeometry(0.06, 0.08, 0.04),
        thigh: new THREE.CapsuleGeometry(0.07, 0.37, 3, 4),
        calf: new THREE.CapsuleGeometry(0.055, 0.36, 3, 4),
        foot: new THREE.BoxGeometry(0.075, 0.05, 0.16)
    };
    const _pMatCache = new Map();
    function pMat(color, rough) {
        const k = color + "_" + rough;
        let m = _pMatCache.get(k);
        if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough }); _pMatCache.set(k, m); }
        return m;
    }

    function createHumanoidModel(color1, color2) {
        const g = new THREE.Group();
        const skinMat = pMat(color2 || 0xe8c9a0, 0.65);
        const clothMat = pMat(color1 || 0x4a6fa5, 0.85);
        const pantsMat = pMat(0x333333, 0.9);
        const shoeMat = pMat(0x222222, 0.7);
        const hairMat = pMat(0x1a1a1a, 0.9);

        // TORSO
        const torso = new THREE.Mesh(_pGeo.torso, clothMat);
        torso.position.y = 0.78 + 0.47 * 0.5; g.add(torso);
        // NECK
        const neck = new THREE.Mesh(_pGeo.neck, skinMat);
        neck.position.y = 0.78 + 0.47 + 0.025; g.add(neck);
        // HEAD
        const head = new THREE.Mesh(_pGeo.head, skinMat);
        head.scale.y = 1.12;
        head.position.y = 0.78 + 0.47 + 0.05 + 0.105 * 1.12; g.add(head);
        // HAIR
        const hair = new THREE.Mesh(_pGeo.hair, hairMat);
        hair.scale.y = 1.15; hair.position.y = head.position.y + 0.03; g.add(hair);

        // ARMS
        const shoulderY = 0.78 + 0.47 * 0.88;
        function arm(side) {
            const ag = new THREE.Group();
            ag.position.set(side * 0.19, shoulderY, 0);
            const upper = new THREE.Mesh(_pGeo.upperArm, clothMat);
            upper.position.y = -0.19; ag.add(upper);
            const fore = new THREE.Mesh(_pGeo.forearm, skinMat);
            fore.position.y = -0.28 - 0.155; ag.add(fore);
            const hand = new THREE.Mesh(_pGeo.hand, skinMat);
            hand.position.y = -0.28 - 0.26 - 0.05; ag.add(hand);
            g.add(ag);
            return ag;
        }
        arm(-1); arm(1);

        // LEGS
        function leg(side) {
            const lg = new THREE.Group();
            lg.position.set(side * 0.08, 0.78, 0);
            const thigh = new THREE.Mesh(_pGeo.thigh, pantsMat);
            thigh.position.y = -0.185; lg.add(thigh);
            const calf = new THREE.Mesh(_pGeo.calf, pantsMat);
            calf.position.y = -0.37 - 0.18; lg.add(calf);
            const foot = new THREE.Mesh(_pGeo.foot, shoeMat);
            foot.position.set(0, -0.37 - 0.36 - 0.02, 0.035); lg.add(foot);
            g.add(lg);
            return lg;
        }
        leg(-1); leg(1);

        g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        return g;
    }

    function createGlow() {
        const grp = new THREE.Group();
        const mat = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(4, 4, 1);
        sprite.position.y = 2.2;
        grp.add(sprite);

        const beamMat = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.28, color: 0x33bbff });
        const beam = new THREE.Sprite(beamMat);
        beam.scale.set(1.1, 3.0, 1);
        beam.position.y = 1.5;
        grp.add(beam);

        grp.userData.sprite = sprite;
        grp.userData.beam = beam;
        return grp;
    }

    function loadPassengers() {
        const waiting = npc.getWaitingPassengers ? npc.getWaitingPassengers() : [];
        const currentIds = new Set(waitingPassengers.map(p => p.id));
        for (const w of waiting) {
            if (currentIds.has(w.id)) continue;
            if (waitingPassengers.length >= 60) break;
            const model = createHumanoidModel(CLOTH_COLORS[Math.floor(Math.random()*CLOTH_COLORS.length)], SKIN_COLORS[Math.floor(Math.random()*SKIN_COLORS.length)]);
            model.position.set(w.x, w.y, w.z);
            model.rotation.y = Math.random() * Math.PI * 2;
            const glow = createGlow();
            glow.position.set(w.x, w.y, w.z);
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
            const dist = hypot2(dx, dz);
            const inRange = dist < PICKUP_RANGE;
            p.inRange = inRange;
            if (inRange) {
                p.state = 'IN_PICKUP_ZONE';
                p.glowIntensity = Math.sin(now * 3) * 0.3 + 0.7;
                const fade = clamp(1 - dist / 180, 0.15, 1);
                const sp = p.glow.userData.sprite, bm = p.glow.userData.beam;
                if (sp) sp.material.opacity = p.glowIntensity * 0.8 * fade;
                if (bm) bm.material.opacity = 0.28 * fade + Math.sin(now * 2) * 0.06;
            } else {
                p.state = 'WAITING';
                const fade = clamp(1 - dist / 180, 0.15, 1);
                const sp = p.glow.userData.sprite, bm = p.glow.userData.beam;
                if (sp) sp.material.opacity = 0.55 * fade;
                if (bm) bm.material.opacity = 0.22 * fade;
            }
        }
        for (const p of onboardPassengers) {
            if (p.model) {
                _tmpLerpTarget.set(p.targetX || 0, p.targetY || 0.5, p.targetZ || 0);
                p.model.position.lerp(_tmpLerpTarget, 0.05);
            }
        }
    }

    function calculateSeatPosition(index) {
        if (isBed34) {
            // Cấu hình 34 giường VIP: 3 dãy (trái 10, giữa 14, phải 10)
            // 7 vị trí Z: [2.5, 1.1, -0.3, -1.7, -3.1, -4.5, -5.9]
            const zRows = [2.5, 1.1, -0.3, -1.7, -3.1, -4.5, -5.9];
            const tier = (index % 2 === 0) ? 0.67 : 1.67;
            const pairIdx = Math.floor(index / 2); // 0..16
            
            let lx = 0, lz = 0;
            if (pairIdx < 5) {
                // Dãy trái (5 khoang)
                lx = -0.87;
                lz = zRows[pairIdx];
            } else if (pairIdx < 12) {
                // Dãy giữa (7 khoang)
                lx = 0.0;
                lz = zRows[pairIdx - 5];
            } else {
                // Dãy phải (5 khoang)
                lx = 0.87;
                lz = zRows[pairIdx - 12];
            }
            return new THREE.Vector3(lx, tier + 0.1, lz);
        } else {
            // Cấu hình 20 phòng VIP: 2 dãy bên (mỗi bên 5 khoang x 2 tầng)
            const bedIndex = index % 20;
            const side = (Math.floor(bedIndex / 10) % 2 === 0) ? 1 : -1;
            const bayZ = [2.7, 0.9, -0.9, -2.7, -4.5];
            const tier = (bedIndex % 10) < 5 ? 0.67 : 1.67;
            const zIndex = (bedIndex % 10) % 5;
            return new THREE.Vector3(side * 0.75, tier + 0.1, bayZ[zIndex]);
        }
    }

    function pickUpPassengers() {
        if (!bus || !bus.doorOpen) {
            ui?.toast("❌ Phải mở cửa (K) để đón khách!");
            return 0;
        }
        let picked = 0;
        const inRange = waitingPassengers.filter(p => !p.picked && p.inRange);
        const available = Math.min(inRange.length, MAX_PASSENGERS - onboardPassengers.length);
        
        for (let i = 0; i < available && i < inRange.length; i++) {
            const p = inRange[i];
            p.picked = true; p.state = 'ON_BUS'; p.glow.visible = false;
            
            const localPos = calculateSeatPosition(onboardPassengers.length);
            passengerGroup.remove(p.model);
            bus.group.add(p.model);
            p.model.position.copy(localPos);
            p.model.rotation.y = Math.random() * Math.PI * 2;
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
        if (picked > 0) ui?.toast(`✅ Đón ${picked} khách! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
        else if (inRange.length === 0) ui?.toast("❌ Không có khách ở gần!");
        else ui?.toast(`⚠️ Xe đã đầy! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
        return picked;
    }

    function dropOffPassengers(destination) {
        if (!bus || !bus.doorOpen || typeof destination !== "string" || !destination) return 0;
        let dropped = 0;
        const remaining = [];
        for (const p of onboardPassengers) {
            // Trả nếu đúng destination hoặc nếu là trả toàn bộ ở bến đích
            if (destination === "ALL" || p.destination === destination) {
                const dropPos = bus.group.localToWorld(new THREE.Vector3(2.2, 0, 0));
                bus.group.remove(p.model);
                passengerGroup.add(p.model);
                p.model.position.copy(dropPos);
                p.model.scale.set(1, 1, 1);
                p.state = "DROPPED_OFF";
                setTimeout(() => { if (p.model.parent) passengerGroup.remove(p.model); }, 1500);
                dropped++;
            } else {
                remaining.push(p);
            }
        }
        onboardPassengers.length = 0;
        onboardPassengers.push(...remaining);
        if (dropped > 0) ui?.toast(`✅ Đã trả ${dropped} khách!`);
        return dropped;
    }

    function dropOffAtRouteDestination() {
        if (!bus?.group || !onboardPassengers.length) return 0;
        const destination = onboardPassengers[0].destination;
        const graph = map?.getRoadGraph?.();
        const node = graph?.getNode?.(destination);
        if (!node) return 0;
        const dx = node.x - bus.group.position.x;
        const dz = node.z - bus.group.position.z;
        return hypot2(dx, dz) <= PICKUP_RANGE ? dropOffPassengers(destination) : 0;
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
        _passengerUpdateTimer += dt;
        if (_passengerUpdateTimer >= 0.1) {
            _passengerUpdateTimer = 0;
            updatePassengers(bus.group.position, bus.group.rotation.y);
        }
        // Quét bổ sung khách định kỳ
        _passengerScanTimer += dt;
        if (_passengerScanTimer >= 4.0) {
            _passengerScanTimer = 0;
            loadPassengers();
        }
    }

    function dispose() {
        for (const p of onboardPassengers) {
            if (p.model?.parent) p.model.parent.remove(p.model);
        }
        scene.remove(passengerGroup);
        while (passengerGroup.children.length) passengerGroup.remove(passengerGroup.children[0]);
        waitingPassengers.length = 0;
        onboardPassengers.length = 0;
    }

    return {
        update, pickUpPassengers, dropOffPassengers, dropOffAtRouteDestination, getPassengerCount, dispose, passengerGroup,
        waitingPassengers, onboardPassengers, getActiveZones: () => waitingPassengers.filter(p => !p.picked)
    };
}
