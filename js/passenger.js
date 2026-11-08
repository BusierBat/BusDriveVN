import * as THREE from "three";
import { hypot2, clamp } from "./utils.js";

const _tmpV = new THREE.Vector3();

export function createPassengerSystem({ scene, map, npc, bus, ui, interiorType = "BED20" }) {
    if (!scene || !bus || !npc) {
        console.error("PassengerSystem thiếu dependency quan trọng!");
        return { update: () => {}, pickUpPassengers: () => 0, dropOffPassengers: () => 0, getPassengerCount: () => ({ waiting: 0, onboard: 0, max: 0 }), getLoadDistribution: () => null, savePassengers: () => false, restorePassengers: () => 0, snapshotPassengers: () => ({ on: [], v: 1 }), getActiveZones: () => [], onboardPassengers: [] };
    }

    const passengerGroup = new THREE.Group();
    passengerGroup.name = "passengers";
    scene.add(passengerGroup);

    // PHASE 4: Passenger physical feedback — body reacts to vehicle motion.
    // Not rigid body physics; subtle lean/shift that makes passengers feel
    // "attached" to the vehicle. Uses PHYSICS_STATE for accel/cornering/roll.
    function applyPassengerFeedback(p, dt) {
        const ps = window.PHYSICS_STATE;
        if (!ps) return;
        const pitch = Number.isFinite(ps.pitch) ? ps.pitch : 0;
        const roll = Number.isFinite(ps.roll) ? ps.roll : 0;
        const lateralAccel = Number.isFinite(ps.lateralAccel) ? ps.lateralAccel : 0;
        const heave = Number.isFinite(ps.heave) ? ps.heave : 0;
        const sway = Number.isFinite(ps.sway) ? ps.sway : 0;
        const impact = Number.isFinite(ps.impactIntensity) ? ps.impactIntensity : 0;
        const speedKmh = Number.isFinite(ps.speedKmh) ? ps.speedKmh : 0;
        const accelLong = Number.isFinite(ps.accelLong) ? ps.accelLong : 0;

        const isMoving = Math.abs(speedKmh) > 1.0;
        if (!isMoving && impact < 0.01) return; // đứng yên → không phản ứng

        const model = p.model;
        if (!model) return;

        // Lean theo pitch (phanh → nghiêng về phía trước; tăng tốc → ngẩng)
        // Lean theo roll (nghiêng xe → hành khách nghiêng theo)
        // Nod theo GIA TỐC DỌC THẬT (_accLong đã lọc): phanh gấp → người đổ về
        // trước rõ rệt; tăng tốc → ngả lưng. Cộng dồn với lean theo pitch.
        // Dùng rotation offset nhỏ — không được làm mất tư thế ngồi
        const nodTarget = Math.max(-0.12, Math.min(0.15, -accelLong * 0.012));
        const targetRotX = -pitch * 0.8 + nodTarget;   // pitch dương (chúi) → nghiêng trước
        const targetRotZ = roll * 0.6;     // roll dương → nghiêng theo xe
        const targetRotY = -Math.sign(lateralAccel) * Math.min(0.2, Math.abs(lateralAccel) * 0.04);

        // Smooth interpolation — không giật
        model.rotation.x += (targetRotX - model.rotation.x) * Math.min(1, dt * 8);
        model.rotation.z += (targetRotZ - model.rotation.z) * Math.min(1, dt * 8);
        model.rotation.y += (targetRotY - model.rotation.y) * Math.min(1, dt * 6);

        // Heave/sway — dịch chuyển nhỏ theo thân xe
        // Lưu ý: baseX/Y/Z CÓ THỂ chính xác 0 (giường giữa BED34) — dùng
        // undefined-check, KHÔNG dùng || (0 || x → lấy x → offset cộng dồn,
        // hành khách trôi dần khỏi giường sau vài giây).
        const baseX = p.baseX !== undefined ? p.baseX : model.position.x;
        const baseY = p.baseY !== undefined ? p.baseY : model.position.y;
        const baseZ = p.baseZ !== undefined ? p.baseZ : model.position.z;
        const targetOffsetX = sway * 0.3;
        const targetOffsetY = -heave * 0.4;
        const targetOffsetZ = impact * 0.05 * Math.sin((ps.roughPhase || 0) * 60);

        model.position.x = baseX + targetOffsetX * 0.3;
        model.position.y = baseY + targetOffsetY * 0.3;
        model.position.z = baseZ + targetOffsetZ * 0.3;

        // Clamp rotation để không mất tư thế
        model.rotation.x = Math.max(-0.25, Math.min(0.25, model.rotation.x));
        model.rotation.z = Math.max(-0.15, Math.min(0.15, model.rotation.z));
    }

    let waitingPassengers = [];
    let onboardPassengers = [];

    // =====================================================================
    // HỆ THỐNG GIƯỜNG (berth) — khớp hình học THẬT trong interior.js
    // BED20: 6 hàng z × 2 bên (±0.75) × 2 tầng; hành khách dùng 5 hàng đầu
    //        (hàng -5.15 giữ cho hành lý) = 20 giường đúng sức chứa.
    // BED34: 5 hàng bên (±0.87) × 2 bên × 2 tầng = 20 + 7 dãy giữa × 2 tầng
    //        = 34 giường đúng cấu hình.
    // =====================================================================
    const isBed34 = interiorType === "BED34" || (window.gameSettings && window.gameSettings.interior === "BED34");
    const MAX_PASSENGERS = isBed34 ? 34 : 20;
    const PICKUP_RANGE = 25;
    const BED20_Z = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
    const BED34_SIDE_Z = [3.00, 1.00, -1.00, -3.00, -5.00];
    const BED34_MID_Z = [3.30, 1.88, 0.46, -0.96, -2.38, -3.80, -5.22];
    const SIDE_X_BED20 = 0.75, SIDE_X_BED34 = 0.87;
    // Khớp LOWER_BED_Y/UPPER_BED_Y của js/interior.js (tái cấu trúc 2 tầng)
    const TIER_LOW = 1.62, TIER_HIGH = 2.70;
    const berthOccupied = new Array(MAX_PASSENGERS).fill(null);
    const berthLocalPosition = (i) => {
        if (isBed34) {
            if (i < 20) {
                const row = Math.floor(i / 4), tier = i % 2, side = Math.floor((i % 4) / 2) ? -1 : 1;
                return new THREE.Vector3(side * SIDE_X_BED34, tier ? TIER_HIGH : TIER_LOW, BED34_SIDE_Z[row]);
            }
            const j = i - 20, row = Math.floor(j / 2), tier = j % 2;
            return new THREE.Vector3(0, tier ? TIER_HIGH : TIER_LOW, BED34_MID_Z[row]);
        }
        const row = Math.floor(i / 4), tier = i % 2, side = Math.floor((i % 4) / 2) ? -1 : 1;
        return new THREE.Vector3(side * SIDE_X_BED20, tier ? TIER_HIGH : TIER_LOW, BED20_Z[row]);
    };
    const claimBerth = () => {
        for (let i = 0; i < berthOccupied.length; i++) if (berthOccupied[i] === null) { berthOccupied[i] = true; return i; }
        return -1;
    };
    const claimSpecificBerth = (i) => (i >= 0 && i < berthOccupied.length && berthOccupied[i] === null) ? (berthOccupied[i] = true, i) : claimBerth();
    const releaseBerth = (i) => { if (i >= 0 && i < berthOccupied.length) berthOccupied[i] = null; };

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
        g.userData.armL = arm(-1); g.userData.armR = arm(1);

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
        g.userData.legL = leg(-1); g.userData.legR = leg(1);

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
            if (waitingPassengers.length >= 80) break;
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
                state: 'WAITING',
                path: []
            });
        }
    }

    function updatePassengers(busPos, busHeading, udt = 0.033) {
        const motionDt = Number.isFinite(udt) && udt > 0 ? udt : 0.033;
        const now = Date.now() / 1000;
        const dt = motionDt;   // dt thật của bước cập nhật — state machine dùng nó để di chuyển ổn định
        for (const p of waitingPassengers) {
            if (p.picked) continue;
            // Nhân vật "sống": thở nhẹ + đảo mắt quan sát — không đứng như tượng
            const tNow = now * 1.6 + (p.x || 0) * 0.013 + (p.z || 0) * 0.017;
            if (p.baseRotY === undefined) p.baseRotY = p.model.rotation.y;
            p.model.rotation.y = p.baseRotY + Math.sin(tNow * 0.7) * 0.4;
            p.model.position.y = p.y + Math.sin(tNow * 2.1) * 0.012;
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
        // =====================================================================
        // PHASE 5 — STATE MACHINE LÊN/XUỐNG XE (bus-local, distance-based)
        // Hình học: cửa bên phải phía trước (x dương), sàn lái thấp hơn sàn khách.
        // Hành khách đi TỪNG ĐIỂM: hàng đợi → bậc cửa → sàn → lối đi → giường.
        // Không teleport, không đi xuyên cửa đóng, không pathfinding mỗi frame
        // (đường đi do state machine quyết định cục bộ; chỉ check chướng ngại
        // trong lối đi — O(n²) với n ≤ 34, chấp nhận được ở 30 Hz).
        // =====================================================================
        const DOOR_STEP1 = new THREE.Vector3(-1.45, 0.28, 5.45);   // bậc 1
        const DOOR_ENTRY = new THREE.Vector3(-0.95, 0.82, 5.10);   // bậc 2 → sàn lái
        const AISLE_Y = 1.05;                                     // sàn khách
        const STAGING_BASE = { x: -2.4, y: 0, z: 5.4 };             // điểm xếp hàng ngoài cửa
        const DROP_OFF_POINT = new THREE.Vector3(-3.2, 0, 4.8);     // điểm ra ngoài (bốc hẳn đi)
        const aisleXFor = (tx) => isBed34 ? (tx < 0 ? -0.44 : 0.44) : 0.0;
        const faceAlong = (p, dx, dz) => { p.model.rotation.y = Math.atan2(dx, dz); };
        const moveToward = (p, target, speed, dt) => {
            const m = p.model.position;
            const dx = target.x - m.x, dy = target.y - m.y, dz = target.z - m.z;
            const dist = Math.hypot(dx, dy, dz);
            if (dist < 0.12) { animateWalk(p, false, dt); return true; }
            const step = Math.min(dist, speed * dt);
            m.x += (dx / dist) * step; m.y += (dy / dist) * step; m.z += (dz / dist) * step;
            faceAlong(p, dx, dz);
            p.walkPhase = (p.walkPhase || 0) + step * 4.2;
            animateWalk(p, true, dt);
            return false;
        };
        const animateWalk = (p, moving, dt) => {
            const u = p.model?.userData;
            if (!u || !u.legL || !u.legR) return;
            p.limbAmp = (p.limbAmp ?? 0) + ((moving ? 0.55 : 0) - (p.limbAmp ?? 0)) * Math.min(1, dt * 6);
            const a = p.limbAmp;
            const s = Math.sin(p.walkPhase || 0);
            u.legL.rotation.x = s * a;
            u.legR.rotation.x = -s * a;
            if (u.armL && u.armR) { u.armL.rotation.x = -s * a * 0.6; u.armR.rotation.x = s * a * 0.6; }
            // Nhún nhẹ theo nhịp bước (chỉ khi đang đi) — hoàn trả bob cũ trước
            // khi cộng bob mới để không tích lũy trôi Y.
            const bob = moving ? Math.abs(Math.sin(p.walkPhase || 0)) * 0.03 * (a / 0.55) : 0;
            if (p.model) {
                p.model.position.y = p.model.position.y - (p._bobPrev || 0) + bob;
                p._bobPrev = bob;
            }
        };
        const aisleBlocked = (p, dirSign) => {
            for (const q of onboardPassengers) {
                if (q === p || !q.model) continue;
                const qm = q.model.position, pm = p.model.position;
                if (Math.sign(qm.x || 1) !== Math.sign(pm.x || 1)) continue;   // khác lối đi
                const ahead = (qm.z - pm.z) * dirSign;                          // cùng chiều tiến
                if (ahead > 0.1 && ahead < 1.1 && Math.abs(qm.x - pm.x) < 0.5) return true;
            }
            return false;
        };

        for (const p of [...onboardPassengers]) {
            if (!p.model) continue;
            const m = p.model.position;
            const state = p.state;
            const doorOpen = !!bus.doorOpen;

            // ---- BOARDING ----
            if (state === 'QUEUED') {
                const mySlotX = STAGING_BASE.x - p.queueSlot * 0.8;
                // Pipeline: chỉ 1 người ở vùng cửa; người trước đã vào ENTERING/CLIMBING
                // thì người kế tiếp được bước (nhiều người đi trong lối đi cùng lúc,
                // không chen lấn tại cửa).
                const frontQ = onboardPassengers
                    .filter(q => q.state === 'QUEUED' || q.state === 'APPROACHING_BUS')
                    .sort((a, b) => a.queueSlot - b.queueSlot)[0];
                const doorBusy = onboardPassengers.some(q =>
                    q.state === 'ENTERING' || q.state === 'CLIMBING_STEPS' ||
                    q.state === 'DESCENDING_STEPS' || q.state === 'LEAVING_BUS');
                if (p !== frontQ || !doorOpen || doorBusy) {
                    // Đứng chờ trong hàng — không tự ý vào xe khi cửa đóng / cửa bận
                    moveToward(p, _tmpV.set(mySlotX, STAGING_BASE.y, STAGING_BASE.z), 1.0, dt);
                    continue;
                }
                p.state = 'APPROACHING_BUS';
                continue;
            }
            if (state === 'APPROACHING_BUS') {
                if (!doorOpen) { p.state = 'QUEUED'; continue; }
                if (moveToward(p, DOOR_STEP1, p.walkSpeed || 1.5, dt)) p.state = 'ENTERING';
                continue;
            }
            if (state === 'ENTERING') {
                if (!doorOpen) { p.state = 'QUEUED'; continue; }
                p.climbIdx=0; if (moveToward(p, DOOR_STEP1, 0.95, dt)) p.state = 'CLIMBING_STEPS';
                continue;
            }
            if (state === 'CLIMBING_STEPS') {
                const ax = -0.78;
                const pts = [_tmpV.set(ax,0.30,5.46),_tmpV.set(ax,0.49,5.27),_tmpV.set(ax,0.68,5.08),_tmpV.set(ax,0.86,4.89),_tmpV.set(ax,AISLE_Y,4.62)];
                p.climbIdx = p.climbIdx|0;
                if (moveToward(p, pts[Math.min(p.climbIdx,pts.length-1)], 0.78, dt)) { p.climbIdx++; if (p.climbIdx>=pts.length){p.climbIdx=0;p.state='WALKING_AISLE';} }
                continue;
            }
            if (state === 'WALKING_AISLE') {
                const ax = aisleXFor(p.targetX);
                const dirSign = Math.sign(p.targetZ - m.z) || -1;
                if (Math.abs(m.z - p.targetZ) > 0.15 && aisleBlocked(p, dirSign)) { animateWalk(p, false, dt); continue; }
                if (moveToward(p, _tmpV.set(ax, AISLE_Y, p.targetZ), 1.1, dt)) p.state = 'APPROACHING_BERTH';
                continue;
            }
            if (state === 'APPROACHING_BERTH') {
                // Tầng dưới: bước thẳng vào giường; tầng trên: đứng lối đi, leo thẳng lên
                // (SITTING sẽ đưa x vào giường khi đã vượt mép đệm tầng dưới — không
                // xuyên mesh). Cùng một đường cho cả hai tầng, dễ kiểm tra.
                const tx = aisleXFor(p.targetX);
                if (moveToward(p, _tmpV.set(tx, AISLE_Y, p.targetZ), 0.7, dt)) {
                    p.sitFromY = m.y; p.sitFromX = m.x;
                    p.sitT = 0;
                    p.model.rotation.y = tx < 0 ? Math.PI / 2 : -Math.PI / 2;   // mặt về lối đi
                    p.state = 'SITTING';
                }
                continue;
            }
            if (state === 'SITTING') {
                p.sitT = (p.sitT || 0) + dt;
                const t = Math.min(1, p.sitT / 0.8);
                const fromY = Number.isFinite(p.sitFromY) ? p.sitFromY : AISLE_Y;
                const fromX = Number.isFinite(p.sitFromX) ? p.sitFromX : m.x;
                m.y = fromY + (p.targetY - fromY) * t;
                m.x = fromX + (p.targetX - fromX) * t;   // tuck ngang khi leo — không xuyên đệm
                animateWalk(p, false, dt);
                if (t >= 1) { p.state = 'SEATED'; p.sitT = 0; }
                continue;
            }

            // ---- ALIGHTING ----
            if (state === 'STANDING_UP') {
                if (!Number.isFinite(p.standFromX)) p.standFromX = m.x;
                if (!Number.isFinite(p.standFromY)) p.standFromY = m.y;
                p.standT = (p.standT || 0) + dt;
                const t = Math.min(1, p.standT / 0.5);
                const aisleX = aisleXFor(p.targetX);
                m.y = p.standFromY + (AISLE_Y - p.standFromY) * t;
                m.x = p.standFromX + (aisleX - p.standFromX) * t;   // rút ra lối đi khi đứng dậy
                animateWalk(p, false, dt);
                if (t >= 1) { p.standT = 0; p.standFromX = undefined; p.standFromY = undefined; p.state = 'COLLECTING_LUGGAGE'; }
                continue;
            }
            if (state === 'COLLECTING_LUGGAGE') {
                p.luggageT = (p.luggageT || 0) + dt;   // 0.25s đứng lấy đồ (chưa có dữ liệu hành lý)
                if (p.luggageT >= 0.25) { p.luggageT = 0; p.state = 'WALKING_TO_EXIT'; }
                continue;
            }
            if (state === 'WALKING_TO_EXIT') {
                const ax = aisleXFor(p.targetX);
                const dirSign = Math.sign(4.25 - m.z) || 1;
                if (Math.abs(m.z - 4.25) > 0.15 && aisleBlocked(p, dirSign)) { animateWalk(p, false, dt); continue; }
                if (moveToward(p, _tmpV.set(ax, AISLE_Y, 4.55), 1.1, dt)) p.state = 'DESCENDING_STEPS';
                continue;
            }
            if (state === 'DESCENDING_STEPS') {
                const ax = -0.78;
                const pts=[_tmpV.set(ax,0.86,4.89),_tmpV.set(ax,0.68,5.08),_tmpV.set(ax,0.49,5.27),_tmpV.set(ax,0.30,5.46)];
                p.climbIdx=p.climbIdx|0;
                if (moveToward(p, pts[Math.min(p.climbIdx,pts.length-1)], 0.78, dt)) { p.climbIdx++; if (p.climbIdx>=pts.length){p.climbIdx=0;p.state='LEAVING_BUS';} }
                continue;
            }
            if (state === 'LEAVING_BUS') {
                p.climbIdx=0; if (moveToward(p, DOOR_STEP1, 0.9, dt)) p.state = 'DROPPING_OFF';
                continue;
            }
            if (state === 'DROPPING_OFF') {
                if (moveToward(p, DROP_OFF_POINT, 1.5, dt)) {
                    releaseBerth(p.berthIndex);
                    p.state = 'DROPPED_OFF';
                }
                continue;
            }
            if (state === 'DROPPED_OFF') {
                // Xóa khỏi thế giới — khách đã tự bước ra ngoài + đi đủ xa,
                // KHÔNG dùng timer xóa model khi chưa tới nơi.
                if (p.model?.parent) p.model.parent.remove(p.model);
                const idx = onboardPassengers.indexOf(p);
                if (idx >= 0) onboardPassengers.splice(idx, 1);
                continue;
            }
            // SEATED: không có gì để làm ở đây — applyPassengerFeedback lo phần lean
        }
    }

    // Vị trí giường theo CHỈ SỐ ĐÃ CLAIM (không phụ thuộc thứ tự lên xe nữa).
    // Giữ tên calculateSeatPosition để API nội bộ ổn định — caller không đổi.
    function calculateSeatPosition(index) {
        if (index >= 0 && index < MAX_PASSENGERS) return berthLocalPosition(index).add(new THREE.Vector3(0, 0.05, 0));
        return new THREE.Vector3(0, 0.72, 3.0);
    }

    function pickUpPassengers() {
        if (!bus || !bus.doorOpen) {
            ui?.toast("❌ Phải mở cửa (K) để đón khách!");
            return 0;
        }
        let picked = 0;
        // Tự tính khoảng cách — KHÔNG tin p.inRange cache (cache chỉ được cập
        // nhật trong update(), khi bầm phím K sớm có thể chưa kịp refresh).
        const inRange = waitingPassengers
            .filter(p => {
                if (p.picked) return false;
                return hypot2(p.x - bus.group.position.x, p.z - bus.group.position.z) < PICKUP_RANGE;
            })
            .sort((a, b) => {
                const da = hypot2(a.x - bus.group.position.x, a.z - bus.group.position.z);
                const db = hypot2(b.x - bus.group.position.x, b.z - bus.group.position.z);
                return da - db;
            });

        for (const p of inRange) {
            if (onboardPassengers.length >= MAX_PASSENGERS) break;
            const berth = claimBerth();
            if (berth < 0) break;
            p.picked = true;
            p.state = 'QUEUED';
            p.queueSlot = picked;          // thứ tự vào xe
            p.berthIndex = berth;
            p.walkPhase = 0;
            p.walkSpeed = 1.5;
            p.glow.visible = false;
            const localPos = calculateSeatPosition(berth);
            const bodySpace = bus.motionGroup || bus.group;
            passengerGroup.remove(p.model);
            bodySpace.add(p.model);
            // Bắt đầu từ đúng vị trí đứng ngoài cửa (bus-local: x dương = phải + ngoài)
            p.model.position.set(-2.4 - picked * 0.8, 0, 5.4);
            p.model.rotation.y = -Math.PI / 2;  // đối mặt cửa -x
            p.model.scale.set(0.78, 0.78, 0.78);
            onboardPassengers.push({
                id: p.id,
                model: p.model,
                destination: p.destination,
                berthIndex: berth,
                queueSlot: picked,
                targetX: localPos.x,
                targetY: localPos.y,
                targetZ: localPos.z,
                state: 'QUEUED',
                walkPhase: 0,
                baseX: null, baseY: null, baseZ: null,
                lastProgress: 0
            });
            picked++;
        }
        if (picked > 0) ui?.toast(`✅ Đón ${picked} khách! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
        else if (inRange.length === 0) ui?.toast("❌ Không có khách ở gần!");
        else ui?.toast("⚠️ Xe đã đầy! (không còn giường trống)");
        return picked;
    }

    function dropOffPassengers(destination) {
        if (!bus || !bus.doorOpen || typeof destination !== "string" || !destination) return 0;
        let released = 0;
        for (const p of onboardPassengers) {
            // Chỉ đưa vào pipeline xuống khi đang ngồi/đứng yên trong xe —
            // khách đang lối đi tự hoàn thành đường đi của mình trước.
            if (destination === "ALL" || p.destination === destination) {
                if (p.state === 'SEATED' || p.state === 'SITTING') {
                    p.state = 'STANDING_UP';
                    p.sitFromY = Number.isFinite(p.model.position.y) ? p.model.position.y : p.targetY;
                    p.standT = 0;
                    released++;
                }
            }
        }
        if (released > 0) ui?.toast(`✅ Cho ${released} khách xuống xe`);
        return released;
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

    // Phân bố tải trọng THẬT của hành khách đang trên xe (bus-local, z>0 = đầu xe).
    // Dùng cho vật lý: CG dọc/ngang/cao + tải từng trục (computeVehicleMass).
    function getLoadDistribution() {
        const n = onboardPassengers.length;
        if (!n) return null;
        let sx = 0, sy = 0, sz = 0, upper = 0;
        for (const p of onboardPassengers) {
            const x = Number.isFinite(p.targetX) ? p.targetX : 0;
            const y = Number.isFinite(p.targetY) ? p.targetY : 0;
            const z = Number.isFinite(p.targetZ) ? p.targetZ : 0;
            sx += x; sy += y; sz += z;
            if (y > 1.2) upper++;
        }
        return {
            meanX: sx / n, meanY: sy / n, meanZ: sz / n,
            upperDeckFraction: upper / n, count: n
        };
    }

    function getPassengerCount() {
        return {
            waiting: waitingPassengers.filter(p => !p.picked).length,
            onboard: onboardPassengers.length,
            max: MAX_PASSENGERS
        };
    }

    // =====================================================================
    // SAVE / LOAD HÀNH KHÁCH — snapshot localStorage (không mất khách khi
    // reload, không nhân đôi, không mất giường). Chỉ lưu DỮ LIỆU NHỎ:
    // { id, berth, dest }; targetX/Y/Z suy lại từ berth (một nguồn sự thật).
    // Các state dở dang (đang đi giữa lối đi) khôi phục thành SEATED — giới
    // hạn đã biết, ghi rõ ở báo cáo.
    // =====================================================================
    const SAVE_KEY = 'busdrivevn_passengers';
    function snapshotPassengers() {
        return { on: onboardPassengers.map(p => ({ id: p.id, berth: p.berthIndex, dest: p.destination })), v: 1 };
    }
    function savePassengers() {
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshotPassengers())); return true; }
        catch { return false; }
    }
    function restorePassengers() {
        let raw = null;
        try { raw = localStorage.getItem(SAVE_KEY); } catch { return 0; }
        if (!raw) return 0;
        try { localStorage.removeItem(SAVE_KEY); } catch {}
        let data = null;
        try { data = JSON.parse(raw); } catch { return 0; }
        const saved = Array.isArray(data?.on) ? data.on : [];
        let restored = 0;
        for (const rec of saved) {
            if (onboardPassengers.length >= MAX_PASSENGERS) break;
            const berth = claimSpecificBerth(Number.isFinite(rec?.berth) ? Math.trunc(rec.berth) : -1);
            if (berth < 0) break;
            const c1 = SKIN_COLORS[restored % SKIN_COLORS.length];
            const c2 = CLOTH_COLORS[(restored * 5 + 2) % CLOTH_COLORS.length];
            const model = createHumanoidModel(c1, c2);
            const target = calculateSeatPosition(berth);
            const bodySpace = bus?.motionGroup || bus?.group;
            if (!bodySpace) { releaseBerth(berth); continue; }
            bodySpace.add(model);
            model.position.copy(target);
            model.scale.set(0.78, 0.78, 0.78);
            model.rotation.y = target.x < 0 ? Math.PI / 2 : -Math.PI / 2;
            onboardPassengers.push({
                id: typeof rec?.id === 'string' ? rec.id : `restored_${restored}`,
                model, destination: typeof rec?.dest === 'string' ? rec.dest : '',
                berthIndex: berth, queueSlot: -1,
                targetX: target.x, targetY: target.y, targetZ: target.z,
                state: 'SEATED', walkPhase: 0,
                baseX: target.x, baseY: target.y, baseZ: target.z,
            });
            restored++;
        }
        return restored;
    }
    window.addEventListener('beforeunload', savePassengers);

    loadPassengers();
    restorePassengers();

    let _passengerUpdateTimer = 0;
    let _passengerScanTimer = 0;

    function update(dt) {
        if (!bus?.group) return;
        _passengerUpdateTimer += dt;
        if (_passengerUpdateTimer >= 0.033) {   // ~30 Hz — mượt cho đi bộ, rẻ với ≤34 người
            const udt = _passengerUpdateTimer;
            _passengerUpdateTimer = 0;
            updatePassengers(bus.group.position, bus.group.rotation.y, udt);
        }
        // Quét bổ sung khách định kỳ
        _passengerScanTimer += dt;
        if (_passengerScanTimer >= 4.0) {
            _passengerScanTimer = 0;
            loadPassengers();
        }
        // PHASE 4: Passenger physical feedback — body reacts to vehicle motion
        for (const p of onboardPassengers) {
            if (p.state === 'SEATED' && p.model) {
                // Save base position on first call
                if (p.baseX === undefined) {
                    p.baseX = p.model.position.x;
                    p.baseY = p.model.position.y;
                    p.baseZ = p.model.position.z;
                }
                applyPassengerFeedback(p, dt);
            }
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
        update, pickUpPassengers, dropOffPassengers, dropOffAtRouteDestination, getPassengerCount, getLoadDistribution,
        savePassengers, restorePassengers, snapshotPassengers,
        dispose, passengerGroup,
        waitingPassengers, onboardPassengers, getActiveZones: () => waitingPassengers.filter(p => !p.picked)
    };
}
