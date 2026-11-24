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
        // Dùng Number.isFinite: base CÓ THỂ là 0 (giường giữa), NHƯNG pickup khởi
        // tạo baseX/Y/Z = null. Check `!== undefined` trước đây để null lọt qua →
        // model.position = null + offset = 0 → khách ngồi bị kéo ra khỏi giường,
        // đứng chặn lối đi (đo được SEATED z=0 dù targetZ=1.85).
        const baseX = Number.isFinite(p.baseX) ? p.baseX : model.position.x;
        const baseY = Number.isFinite(p.baseY) ? p.baseY : model.position.y;
        const baseZ = Number.isFinite(p.baseZ) ? p.baseZ : model.position.z;
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
    // Tâm giường dãy giữa — PHẢI khớp CFG34 trong interior.js
    // (Z_CENTER_FIRST 3.11, Z_CENTER_STEP 1.39; xem comment ở CFG34).
    const BED34_MID_Z = [3.11, 1.72, 0.33, -1.06, -2.45, -3.84, -5.23];
    const SIDE_X_BED20 = 0.75, SIDE_X_BED34 = 0.87;
    // Khớp LOWER_BED_Y/UPPER_BED_Y của js/interior.js (sàn đi bộ = tầng 1)
    const TIER_LOW = 1.76, TIER_HIGH = 2.70;
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
    // Neo hình học cửa/cầu thang (bus-local, dùng chung cho boarding/alighting)
    // Cầu thang 3 bậc + chiếu nghỉ, NẰM TRONG XE: tiến thẳng vào trong (+X).
    // Đường đi thực tế z 5.50 (lòng thang z 5.24..5.97, khớp interior.js) — lùi
    // 0.16 so với tâm lòng thang để thân người (bán kính 0.17) không chạm mặt bệ
    // kính trước (z 5.76, cao 2.258..2.308): 5.50 + 0.17 = 5.67 < 5.76.
    const STAIR_Z = 5.50;
    const STAIR_X_TOP = -0.30;                                // điểm đứng trên chiếu nghỉ
    const DOOR_STEP1 = new THREE.Vector3(-1.18, 0.33, STAIR_Z); // ngưỡng trong cửa, sát bậc dưới
    const AISLE_Y = 1.69;                                     // sàn khách (FLOOR_Y + 0.05)
    const STAGING_BASE = { x: -1.8, y: 0, z: STAIR_Z };       // xếp hàng ngoài cửa, sát xe
    const DROP_OFF_POINT = new THREE.Vector3(-2.2, 0, STAIR_Z); // ra ngoài cửa (trục cửa -x)
    // Waypoint 3 bậc + chiếu nghỉ (leo vào: -X -> +X, lên cao; xuống ngược lại).
    // Nhịp đều 0.3275 m, khớp stepTops trong interior.js (0.6575 / 0.985 / 1.3125).
    // Mỗi điểm đặt ĐÚNG MÉP NGOÀI của mặt bậc kế tiếp và đã ở cao độ mặt bậc đó:
    //   mép bậc 1 x -1.1401, bậc 2 x -0.9334, bậc 3 x -0.7267 (xInner -0.52 trừ
    //   0.2067 mỗi bậc), chiếu nghỉ x -0.52.
    // Nhờ vậy đoạn dốc lên luôn nằm TRÊN mặt bậc dưới (chân không lún vào khối
    // bậc). Nếu đặt waypoint ở TÂM mặt bậc như trước, đoạn nối từ tâm bậc dưới
    // tới tâm bậc trên cắt qua khối bậc kế → chân lún tới 0.20 m (đo bằng raycast).
    const CLIMB_PTS = [
        new THREE.Vector3(-1.1401, 0.6575, STAIR_Z),   // mép ngoài bậc 1
        new THREE.Vector3(-0.9334, 0.9850, STAIR_Z),   // mép ngoài bậc 2
        new THREE.Vector3(-0.7267, 1.3125, STAIR_Z),   // mép ngoài bậc 3
        new THREE.Vector3(-0.5200, AISLE_Y, STAIR_Z),  // mép chiếu nghỉ (xInner)
        new THREE.Vector3(STAIR_X_TOP, AISLE_Y, STAIR_Z)
    ];
    const DESCEND_PTS = [
        new THREE.Vector3(-0.5200, AISLE_Y, STAIR_Z),  // mép chiếu nghỉ
        new THREE.Vector3(-0.7267, 1.3125, STAIR_Z),
        new THREE.Vector3(-0.9334, 0.9850, STAIR_Z),
        new THREE.Vector3(-1.1401, 0.6575, STAIR_Z)
    ];
    const aisleXFor = (tx) => isBed34 ? (tx < 0 ? -0.44 : 0.44) : 0.0;
    // Lối vào lối đi (dọn hình học khu cửa/cầu thang):
    // Trước đây khách đi THẲNG từ đỉnh thang (-0.76, 5.66) tới (aisleX, targetZ)
    // nên cắt chéo qua rèm (x -0.33), giường và tựa lưng ghế phụ (z 4.21..4.33).
    // Nay: vào khe giữa hai ghế (ghế phụ tới x -0.125, ghế tài từ x 0.40) rồi
    // mới rẽ ngang vào làn (xem AISLE_PASS_Z bên dưới).
    const COCKPIT_GAP_X = 0.15;                       // tâm khe giữa ghế tài (+x) và ghế phụ (-x)
    const AISLE_ENTRY_Z = 4.62;                       // mức hai ghế — từ chiếu nghỉ vào khe
    // Sau lưng hai ghế (z 4.21..4.29) MỚI được toả ngang: đệm tựa lưng ghế tài
    // x 0.40..0.90 và ghế phụ x -0.575..-0.125 chỉ chừa đúng khe giữa
    // x -0.125..0.40 (0.525m, vừa thân người bán kính 0.17).
    // 34P: lối vào làn là khe giữa vách đầu hàng giường giữa (z <= 3.815 sau khi
    // rút giường giữa còn 1.37) và lưng ghế tài/phụ (z 4.21). Khe rộng 0.395 m
    // → thân người (bán kính 0.17) lọt với ~0.027 m mỗi bên khi rẽ ngang ở
    // z 4.01. Trước đây vách tới z 4.02 nên khe chỉ 0.19 m, thân người lấn
    // xuyên vách 0.08 m.
    const AISLE_PASS_Z = isBed34 ? 4.01 : 4.02;       // z đã qua khỏi lưng hai ghế
    const AISLE_TURN_Z = AISLE_PASS_Z;                // giữ tên cũ cho caller/test
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
        // PHASE 8 — túi xách dùng chung cho mọi khách (12 triangles, không asset).
        luggage: new THREE.BoxGeometry(0.14, 0.17, 0.08),
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
            ag.userData.hand = hand;   // PHASE 8 — mốc để tính vị trí nhặt túi
            g.add(ag);
            return ag;
        }
        g.userData.armL = arm(-1); g.userData.armR = arm(1);

        // PHASE 8 — túi nằm DƯỚI SÀN cạnh chân phải (child của model, KHÔNG phải
        // của tay). ẨN mặc định; chỉ hiện khi khách cúi nhặt trong COLLECTING_LUGGAGE.
        // Lúc nhặt xong mới attach vào armR để đi theo cẳng tay. Dùng chung geo +
        // material cache → +1 draw/khách, không asset/file mới.
        const bag = new THREE.Mesh(_pGeo.luggage, pMat(0x5a4636, 0.85));
        bag.position.set(0.24, 0.10, 0.04);   // sàn, cạnh chân phải (local model)
        bag.castShadow = false; bag.receiveShadow = false;
        bag.visible = false;
        g.add(bag);
        g.userData.luggage = bag;
        g.userData.luggageFloor = bag.position.clone();

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
        // Neo theo HÌNH HỌC THẬT của buildEntryStaircase (interior.js):
        // cầu thang cửa -x đi thẳng vào trong (+X) tại STAIR_Z=5.50, 3 bậc nhịp
        // 0.3275 (x -1.14..-0.52) + chiếu nghỉ 1.64, sàn khách FLOOR_Y=1.64
        // (AISLE_Y=1.69). Waypoint bậc/đích đi lấy từ CLIMB_PTS, DESCEND_PTS,
        // DOOR_STEP1, STAIR_X_TOP để đồng bộ mesh–chuyển động.
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
            if (u.armL && u.armR) {
                u.armL.rotation.x = -s * a * 0.6;
                // PHASE 8 — sau khi lấy túi, tay phải giữ tư thế cầm đồ (không vung
                // theo nhịp bước); tay trái vẫn đánh bình thường.
                u.armR.rotation.x = p.luggageHeld ? -0.55 : s * a * 0.6;
            }
            // Nhún nhẹ theo nhịp bước (chỉ khi đang đi) — hoàn trả bob cũ trước
            // khi cộng bob mới để không tích lũy trôi Y.
            const bob = moving ? Math.abs(Math.sin(p.walkPhase || 0)) * 0.03 * (a / 0.55) : 0;
            if (p.model) {
                p.model.position.y = p.model.position.y - (p._bobPrev || 0) + bob;
                p._bobPrev = bob;
            }
        };
        // Lối đi xe giường nằm chỉ đủ 1 người. Khi khách lên (đi vào trong) gặp
        // khách xuống (đi ra cửa), CẢ HAI cùng thấy người kia "ở trước" → đứng
        // hình vĩnh viễn (đã đo: WALKING_TO_EXIT kẹt 40s ở z=1.2). Thêm đồng hồ
        // nhường: quá 1.5s (xuống xe) / 3s (lên xe) thì coi như đã né → đi tiếp.
        // Ưu tiên người xuống xe như phụ xe bến thực tế.
        const ALIGHTING_STATES = new Set([
            'STANDING_UP', 'COLLECTING_LUGGAGE', 'WALKING_TO_EXIT',
            'DESCENDING_STEPS', 'LEAVING_BUS', 'DROPPING_OFF'
        ]);
        const aisleBlocked = (p, dirSign, dt = 0) => {
            const pAlighting = ALIGHTING_STATES.has(p.state);
            let blocked = false;
            for (const q of onboardPassengers) {
                if (q === p || !q.model) continue;
                // Ưu tiên TUYỆT ĐỐI người xuống xe: phụ xe bến thực tế dừng đón
                // khách mới cho khách cũ xuống xong. Không ưu tiên → khách xuống
                // bị 6 người đang lên chặn từng nhịp, đi 2.5m mất >40s.
                if (pAlighting && !ALIGHTING_STATES.has(q.state)) continue;
                const qm = q.model.position, pm = p.model.position;
                if (Math.sign(qm.x || 1) !== Math.sign(pm.x || 1)) continue;   // khác lối đi
                const ahead = (qm.z - pm.z) * dirSign;                          // cùng chiều tiến
                if (ahead > 0.1 && ahead < 1.1 && Math.abs(qm.x - pm.x) < 0.5) { blocked = true; break; }
            }
            if (!blocked) { p._blockedT = 0; return false; }
            p._blockedT = (p._blockedT || 0) + (Number.isFinite(dt) ? Math.max(0, dt) : 0);
            const limit = ALIGHTING_STATES.has(p.state) ? 1.5 : 3.0;
            if (p._blockedT >= limit) { p._blockedT = 0; return false; }
            return true;
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
                // Bậc thật (interior.js) sau nâng sàn FLOOR_Y 1.64m: kéo dài cầu thang
                const pts = CLIMB_PTS;
                p.climbIdx = p.climbIdx|0;
                if (moveToward(p, pts[Math.min(p.climbIdx,pts.length-1)], 0.78, dt)) { p.climbIdx++; if (p.climbIdx>=pts.length){p.climbIdx=0;p.aisleStep=0;p.state='WALKING_AISLE';} }
                continue;
            }
            if (state === 'WALKING_AISLE') {
                const ax = aisleXFor(p.targetX);
                const dirSign = Math.sign(p.targetZ - m.z) || -1;
                if (Math.abs(m.z - p.targetZ) > 0.15 && aisleBlocked(p, dirSign, dt)) { animateWalk(p, false, dt); continue; }
                // 0: vào khe giữa hai ghế → 1: đi dọc khe qua khỏi lưng ghế →
                // 2: toả ngang vào làn → 3: đi dọc lối đi tới giường.
                const step = p.aisleStep | 0;
                if (step === 0) {
                    if (moveToward(p, _tmpV.set(COCKPIT_GAP_X, AISLE_Y, AISLE_ENTRY_Z), 1.0, dt)) p.aisleStep = 1;
                    continue;
                }
                if (step === 1) {
                    if (moveToward(p, _tmpV.set(COCKPIT_GAP_X, AISLE_Y, AISLE_PASS_Z), 0.9, dt)) p.aisleStep = 2;
                    continue;
                }
                if (step === 2) {
                    if (moveToward(p, _tmpV.set(ax, AISLE_Y, AISLE_PASS_Z), 0.9, dt)) p.aisleStep = 3;
                    continue;
                }
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
                if (t >= 1) {
                    // Chốt base SAU khi ngồi xong để applyPassengerFeedback không
                    // lấy nhầm null (pickup) hay vị trí lối đi làm gốc.
                    p.baseX = p.targetX; p.baseY = p.targetY; p.baseZ = p.targetZ;
                    p.state = 'SEATED'; p.sitT = 0;
                }
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
                // PHASE 8 — lấy hành lý THẬT (không bật visibility ở tay):
                // túi nằm DƯỚI SÀN ngay từ đầu → tay cúi xuống (0→-1.05) →
                // túi lerp từ sàn lên đúng bàn tay → attach vào armR → nâng tay
                // (-1.05→-0.55). Mọi toạ độ tính qua world matrix nên đúng cả
                // khi model đang đứng trong bus đã xoay/dịch.
                p.luggageT = (p.luggageT || 0) + dt;
                const t = Math.min(1, p.luggageT / 0.6);
                const u = p.model?.userData;
                if (u?.armR) {
                    u.armR.rotation.x = t < 0.5
                        ? -1.05 * (t / 0.5)                       // cúi xuống
                        : -1.05 + 0.50 * ((t - 0.5) / 0.5);       // nâng lên -0.55
                    const bag = u.luggage;
                    if (bag) {
                        // Hiện túi NGAY từ frame đầu state (nằm ở sàn) — không dùng
                        // cửa sổ t<0.05 dễ trễ nhịp sample/frameInitialization.
                        bag.visible = true;
                        if (t < 0.05) {
                            // Vừa bắt đầu: đảm bảo túi ở đúng vị trí sàn.
                            bag.position.copy(u.luggageFloor);
                        } else if (!p.luggageHeld) {
                            // Tay cúi xong (t≥0.45) → túi rời sàn, bay tới bàn tay.
                            const hand = u.armR.userData.hand;
                            if (hand) {
                                p.model.updateMatrixWorld(true);
                                const hw = hand.getWorldPosition(_tmpV);
                                const hl = p.model.worldToLocal(hw);
                                const k = Math.max(0, Math.min(1, (t - 0.45) / 0.45));
                                bag.position.lerpVectors(u.luggageFloor, hl, k);
                            }
                        }
                    }
                }
                if (t >= 1) {
                    // Gắn túi vào tay (giữ world transform) rồi nâng tay lên -0.55.
                    const u2 = p.model?.userData;
                    if (u2?.armR && u2.luggage && u2.luggage.parent !== u2.armR) {
                        p.model.updateMatrixWorld(true);
                        u2.armR.attach(u2.luggage);
                    }
                    p.luggageT = 0; p.luggageHeld = true;
                    p.exitStep = 0; p.state = 'WALKING_TO_EXIT';
                }
                continue;
            }
            if (state === 'WALKING_TO_EXIT') {
                const ax = aisleXFor(p.targetX);
                const dirSign = Math.sign(STAIR_Z - m.z) || 1;
                if (Math.abs(m.z - STAIR_Z) > 0.15 && aisleBlocked(p, dirSign, dt)) { animateWalk(p, false, dt); continue; }
                // Ngược chiều lúc lên: đi dọc làn → toả về khe hai ghế → ra đỉnh thang.
                const step = p.exitStep | 0;
                if (step === 0) {
                    if (moveToward(p, _tmpV.set(ax, AISLE_Y, AISLE_PASS_Z), 1.0, dt)) p.exitStep = 1;
                    continue;
                }
                if (step === 1) {
                    if (moveToward(p, _tmpV.set(COCKPIT_GAP_X, AISLE_Y, AISLE_PASS_Z), 0.9, dt)) p.exitStep = 2;
                    continue;
                }
                if (step === 2) {
                    if (moveToward(p, _tmpV.set(COCKPIT_GAP_X, AISLE_Y, AISLE_ENTRY_Z), 0.9, dt)) p.exitStep = 3;
                    continue;
                }
                if (moveToward(p, _tmpV.set(STAIR_X_TOP, AISLE_Y, STAIR_Z), 1.0, dt)) p.state = 'DESCENDING_STEPS';
                continue;
            }
            if (state === 'DESCENDING_STEPS') {
                // Xuống ngược bậc thật (interior): đỉnh thang (STAIR_X_TOP, AISLE_Y, STAIR_Z) -> ra ngoài (-X)
                const pts = DESCEND_PTS;
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
                // PHASE 8 — trả state túi về sàn/phòng khi model được pool lại.
                p.luggageHeld = false;
                const u = p.model?.userData;
                if (u?.luggage) {
                    if (u.luggage.parent !== p.model) p.model.attach(u.luggage);
                    u.luggage.position.copy(u.luggageFloor);
                    u.luggage.visible = false;
                }
                if (u?.armR) u.armR.rotation.x = 0;
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
            ui?.toast("[icon:x] Phải mở cửa (K) để đón khách!");
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
            // Bắt đầu từ đúng vị trí đứng ngoài cửa (bus-local), xếp hàng sát trục cầu thang/cửa -x
            p.model.position.set(STAGING_BASE.x - picked * 0.8, STAGING_BASE.y, STAGING_BASE.z);
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
        if (picked > 0) ui?.toast(`[icon:check] Đón ${picked} khách! (${onboardPassengers.length}/${MAX_PASSENGERS})`);
        else if (inRange.length === 0) ui?.toast("[icon:x] Không có khách ở gần!");
        else ui?.toast("[icon:warn] Xe đã đầy! (không còn giường trống)");
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
        if (released > 0) ui?.toast(`[icon:check] Cho ${released} khách xuống xe`);
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
            // Phân tầng bằng TRUNG ĐIỂM giữa giường dưới (1.76) và trên (2.70).
            // Ngưỡng 1.2 cũ đếm NHẦM cả giường dưới là tầng trên → upper=1 dù
            // 10 khách thực ra 5 dưới / 5 trên (đo được meanY=2.28).
            if (y > (TIER_LOW + TIER_HIGH) / 2) upper++;
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
        window.removeEventListener('beforeunload', savePassengers);
        passengerGroup.traverse(o => { if (o.isSprite && o.material) o.material.dispose(); });
        for (const p of onboardPassengers) {
            if (p.model?.parent) p.model.parent.remove(p.model);
        }
        scene.remove(passengerGroup);
        while (passengerGroup.children.length) passengerGroup.remove(passengerGroup.children[0]);
        waitingPassengers.length = 0;
        onboardPassengers.length = 0;
        for (const g of Object.values(_pGeo)) g.dispose?.();
        for (const m of _pMatCache.values()) m.dispose?.();
        glowTexture.dispose();
    }

    return {
        update, pickUpPassengers, dropOffPassengers, dropOffAtRouteDestination, getPassengerCount, getLoadDistribution,
        savePassengers, restorePassengers, snapshotPassengers,
        dispose, passengerGroup,
        waitingPassengers, onboardPassengers, getActiveZones: () => waitingPassengers.filter(p => !p.picked)
    };
}
