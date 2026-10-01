// js/npc.js
import * as THREE from "three";
import { clamp, randomFloat, pick, createSeededRandom, disposeObject3D } from "./utils.js";
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "./bus.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TWO_PI = Math.PI * 2;
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; return d; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function lerpAngle(a, b, t) { let diff = b - a; while (diff > Math.PI) diff -= TWO_PI; while (diff < -Math.PI) diff += TWO_PI; return a + diff * clamp(t, 0, 1); }

// ============================================================================
// HỆ THỐNG NPC CON NGƯỜI (humanoid pedestrian)
// Model low-poly, animation procedual, pool + LOD. Tích hợp ngay trong
// createNPC() để không phá API — main.js gọi npc.update(dt, t) như cũ.
// ============================================================================

// ---- Chiều cao + tỷ lệ Việt Nam ----
const NPC_HEIGHTS = [1.50, 1.55, 1.60, 1.65, 1.70, 1.75];
const SKIN_COLORS = [0xf5d6b8, 0xe8c9a0, 0xd4a574, 0xc4956a, 0xb8865a, 0xdea987, 0xd19872];
const HAIR_COLORS = [0x1a1a1a, 0x1a1a1a, 0x1a1a1a, 0x2d2d2d, 0x3d3d3d, 0x4a3d2e, 0x5c4a3a];
const SHIRT_COLORS = [0x1a1a1a, 0xffffff, 0x3a7bc8, 0xc0392b, 0x2e8641, 0xf39c12, 0x8b7355,
    0x5c5c5c, 0x2c5f8a, 0x6c3483, 0xd64545, 0x1e5128, 0xe0e0e0, 0x4a235a, 0xf7dc6f, 0x1e3a5f];
const PANT_COLORS = [0x1a1a1a, 0x2d2d2d, 0x3d3d3d, 0x1e3a5f, 0x4a4a4a, 0x3b5998, 0x2c3e50, 0x5c4a3a];

// Shared geometry cache — tạo 1 lần, mọi NPC dùng chung
let _geoCache = null;
function getGeo() {
    if (_geoCache) return _geoCache;
    _geoCache = {
        head: new THREE.SphereGeometry(1, 10, 8),
        hair: new THREE.SphereGeometry(1.04, 8, 7),
        hairLong: new THREE.SphereGeometry(1.1, 8, 7),
        neck: new THREE.CylinderGeometry(1, 1, 1, 6),
        torso: new THREE.BoxGeometry(1, 1, 1),
        shirt: new THREE.BoxGeometry(1.04, 1.04, 1.04),
        upperArm: new THREE.CapsuleGeometry(1, 1, 3, 4),
        forearm: new THREE.CapsuleGeometry(1, 1, 3, 4),
        hand: new THREE.BoxGeometry(1, 1, 1),
        thigh: new THREE.CapsuleGeometry(1, 1, 3, 4),
        calf: new THREE.CapsuleGeometry(1, 1, 3, 4),
        foot: new THREE.BoxGeometry(1, 1, 1),
        bag: new THREE.BoxGeometry(1, 1, 1),
        phone: new THREE.BoxGeometry(1, 1, 1)
    };
    return _geoCache;
}

// MATERIAL DUY NHẤT cho toàn bộ NPC: vertex colors thay cho material-per-color
// => 1 program, 1 material, batching thân thiện. Màu nằm trong geometry.
let _vertexMat = null;
function getVertexMat() {
    if (!_vertexMat) {
        _vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.02 });
    }
    return _vertexMat;
}

// ---- Merge nhiều part (khác màu) thành 1 geometry + ghi lại range màu ----
function _bakeParts(parts) {
    // parts: [{ geo, color, pos:[x,y,z]?, scale:[x,y,z]? }] — transform theo s=1
    const gs = [], ranges = [];
    let offset = 0;
    for (const p of parts) {
        const g = p.geo.clone();
        g.applyMatrix4(new THREE.Matrix4().compose(
            new THREE.Vector3(p.pos ? p.pos[0] : 0, p.pos ? p.pos[1] : 0, p.pos ? p.pos[2] : 0),
            new THREE.Quaternion(),
            new THREE.Vector3(p.scale ? p.scale[0] : 1, p.scale ? p.scale[1] : 1, p.scale ? p.scale[2] : 1)
        ));
        g.clearGroups();
        const n = g.attributes.position.count;
        ranges.push({ color: p.color, start: offset, count: n });
        offset += n;
        gs.push(g);
    }
    let merged = null;
    try {
        merged = mergeGeometries(gs, false);
    } catch (e) {
        merged = null;
    }
    gs.forEach(g => g.dispose());
    if (!merged) return null;
    return { geo: merged, ranges, totalVerts: offset };
}

// Geometry MỚI (chia sẻ attribute position/normal/uv với base) + color attribute
function _coloredGeo(base) {
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(base.geo.attributes)) g.setAttribute(name, base.geo.attributes[name]);
    if (base.geo.index) g.setIndex(base.geo.index);
    const arr = new Float32Array(base.totalVerts * 3);
    const c = new THREE.Color();
    for (const r of base.ranges) {
        c.set(r.color);
        for (let i = 0; i < r.count; i++) {
            const o = (r.start + i) * 3;
            arr[o] = c.r; arr[o + 1] = c.g; arr[o + 2] = c.b;
        }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
}

// Cache geometry theo SHAPE variant (64 key max: hairShort/shorts/sleeves/accessory)
const _variantCache = new Map();
function _variantKey(longHair, hasShorts, hasSleeves, acc) {
    return (longHair ? 1 : 0) + "" + (hasShorts ? 1 : 0) + "" + (hasSleeves ? 1 : 0) + "" + acc;
}

// ---- Tạo 1 NPC humanoid đầy đủ (head/neck/torso/arms/hands/legs/feet) ----
// Mọi kích thước tính ở s=1 (mốc 1.60m), chiều cao NPC = root.scale = h/naturalH.
// Mỗi NPC chỉ 7 mesh (head/torso/2arm/2leg/static) thay vì 17.
export function createHumanoidNPC(seed, opts = {}) {
    const rnd = createSeededRandom(seed);
    const h = opts.height || pick(rnd, NPC_HEIGHTS);
    const g = getGeo();
    const gender = opts.gender || (rnd() > 0.5 ? "m" : "f");

    const skin = pick(rnd, SKIN_COLORS);
    const shirtC = pick(rnd, SHIRT_COLORS);
    const pantC = pick(rnd, PANT_COLORS);
    const hairC = pick(rnd, HAIR_COLORS);
    const longHair = gender === "f" && rnd() > 0.35;
    const hasShorts = rnd() > 0.82;
    const hasSleeves = rnd() > 0.45;
    const accRoll = rnd();
    const accessory = accRoll < 0.40 ? "backpack" : accRoll < 0.65 ? "handbag"
        : accRoll < 0.82 ? "hat" : accRoll < 0.97 ? "phone" : "luggage";
    const accColor = accRoll < 0.40 ? 0x333333 : accRoll < 0.65 ? 0x8b4513
        : accRoll < 0.82 ? 0xc0392b : accRoll < 0.97 ? 0x111111 : 0x555566;

    // --- kích thước thành phần (s=1, mốc 1.60m; tính từ ĐẤT LÊN) ---
    const headR = 0.105;
    const neckH = 0.05;
    const footH = 0.05;
    const calfL = 0.40, thighL = 0.42;
    const hipY = footH + calfL + thighL;                 // 0.87
    const torsoH = 0.46, torsoW = 0.34, torsoD = 0.17;
    const torsoTopY = hipY + torsoH;                     // 1.33
    const neckTopY = torsoTopY + neckH;
    const headCenterY = neckTopY + headR * 1.12;
    const armLen = 0.28, foreLen = 0.26, handS = 0.06;
    const footL = 0.16;
    const shoulderX = torsoW * 0.55, hipX = torsoW * 0.24;
    // Capsule(1,1) tổng cao = length + 2*radius = 3 -> scale.y phải chia 3
    const CAP = 1 / 3;
    const pantColor = hasShorts ? 0x888888 : pantC;

    // ---- geometry theo variant (cache) ----
    const vkey = _variantKey(longHair, hasShorts, hasSleeves, accessory);
    let variant = _variantCache.get(vkey);
    if (!variant) {
        // HEAD: đầu + tóc [+ mũ]
        const headParts = [
            { geo: g.head, color: skin, scale: [headR, headR * 1.12, headR * 0.95] },
            { geo: longHair ? g.hairLong : g.hair, color: hairC,
              pos: [0, headR * 0.35, 0], scale: [headR * 1.05, headR * (longHair ? 1.6 : 1.15), headR * 1.05] }
        ];
        if (accessory === "hat") headParts.push({ geo: g.hair, color: accColor, pos: [0, headR * 0.75, 0], scale: [headR * 1.15, headR * 0.7, headR * 1.15] });

        // TORSO: thân + áo
        const torsoParts = [
            { geo: g.torso, color: skin, pos: [0, torsoH * 0.5, 0], scale: [torsoW, torsoH, torsoD] },
            { geo: g.shirt, color: shirtC, pos: [0, torsoH * (hasSleeves ? 0.62 : 0.72), 0],
              scale: [torsoW * (hasSleeves ? 1.02 : 1), torsoH * (hasSleeves ? 0.98 : 0.72), torsoD * 1.04] }
        ];

        // ARM: tay trên [+ tay dưới + bàn tay + điện thoại]
        function armParts(side) {
            const parts = [
                { geo: g.upperArm, color: hasSleeves ? shirtC : skin, pos: [0, -armLen * 0.5, 0], scale: [0.05, armLen * CAP, 0.05] },
                { geo: g.forearm, color: skin, pos: [0, -armLen - foreLen * 0.5, 0], scale: [0.043, foreLen * CAP, 0.043] },
                { geo: g.hand, color: skin, pos: [0, -armLen - foreLen - handS * 0.6, 0], scale: [handS, handS * 1.3, handS * 0.7] }
            ];
            if (side === "r" && accessory === "phone") parts.push({ geo: g.phone, color: accColor, pos: [0, -armLen - foreLen + 0.02, 0.06], scale: [0.04, 0.08, 0.01] });
            return parts;
        }

        // LEG: đùi + cẳng chân + bàn chân [+ da đùi nếu short]
        function legParts() {
            const thighTop = hasShorts ? thighL * 0.5 : thighL;
            const parts = [
                { geo: g.thigh, color: pantColor, pos: [0, -thighTop * 0.5, 0], scale: [0.07, thighTop * CAP, 0.07] },
                { geo: g.calf, color: hasShorts ? skin : pantColor, pos: [0, -thighL - calfL * 0.5, 0], scale: [0.055, calfL * CAP, 0.055] },
                { geo: g.foot, color: 0x222222, pos: [0, -thighL - calfL - footH * 0.5, footL * 0.22], scale: [0.075, footH, footL] }
            ];
            if (hasShorts) parts.push({ geo: g.thigh, color: skin, pos: [0, -thighL * 0.5, 0], scale: [0.062, thighL * CAP, 0.062] });
            return parts;
        }

        // STATIC: cổ + phụ kiện mang theo thân
        const staticParts = [{ geo: g.neck, color: skin, pos: [0, torsoTopY + neckH * 0.5, 0], scale: [0.05, neckH, 0.05] }];
        if (accessory === "backpack") staticParts.push({ geo: g.bag, color: accColor, pos: [0, hipY + torsoH * 0.55, torsoD * 0.7], scale: [0.3, 0.36, 0.14] });
        if (accessory === "handbag") staticParts.push({ geo: g.bag, color: accColor, pos: [shoulderX + 0.1, hipY + torsoH * 0.1, 0], scale: [0.16, 0.2, 0.08] });
        if (accessory === "luggage") staticParts.push({ geo: g.bag, color: accColor, pos: [-shoulderX - 0.12, footH + 0.2, 0.05], scale: [0.22, 0.35, 0.15] });

        variant = {
            head: _bakeParts(headParts),
            torso: _bakeParts(torsoParts),
            armL: _bakeParts(armParts("l")),
            armR: _bakeParts(armParts("r")),
            legL: _bakeParts(legParts()),
            legR: _bakeParts(legParts()),
            body: _bakeParts(staticParts),
            naturalH: 0
        };
        _variantCache.set(vkey, variant);
    }
    if (!variant.head) return null;   // merge lỗi (không bao giờ xảy ra với geometry chuẩn)

    // ---- dựng group (7 mesh) ----
    const root = new THREE.Group();
    root.name = "npc_h";
    const mat = getVertexMat();

    const headG = new THREE.Group(); headG.name = "head";
    headG.position.y = headCenterY;
    headG.add(new THREE.Mesh(_coloredGeo(variant.head), mat));
    root.add(headG);

    const torsoG = new THREE.Group(); torsoG.name = "torso";
    torsoG.position.y = hipY;
    torsoG.add(new THREE.Mesh(_coloredGeo(variant.torso), mat));
    root.add(torsoG);

    function armGroup(name, base) {
        const ag = new THREE.Group(); ag.name = name;
        ag.position.set(name === "lArm" ? -shoulderX : shoulderX, hipY + torsoH * 0.88, 0);
        ag.add(new THREE.Mesh(_coloredGeo(base), mat));
        root.add(ag);
        return ag;
    }
    const armL = armGroup("lArm", variant.armL);
    const armR = armGroup("rArm", variant.armR);

    function legGroup(name, base) {
        const lg = new THREE.Group(); lg.name = name;
        lg.position.set(name === "lLeg" ? -hipX : hipX, hipY, 0);
        lg.add(new THREE.Mesh(_coloredGeo(base), mat));
        root.add(lg);
        return lg;
    }
    const legL = legGroup("lLeg", variant.legL);
    const legR = legGroup("rLeg", variant.legR);

    root.add(new THREE.Mesh(_coloredGeo(variant.body), mat));

    // ---- auto-fit chiều cao = h (đo 1 lần/variant, gồm tóc/mũ đội thêm) ----
    if (!variant.naturalH) {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        variant.naturalH = (box.max.y - box.min.y) || 1.6;
    }
    root.scale.setScalar(h / variant.naturalH);

    root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = true; } });

    return {
        group: root, height: h, gender,
        parts: { head: headG, torso: torsoG, armL, armR, legL, legR },
        seed
    };
}

// ---- Animation state per-NPC (procedural, không AnimationMixer nặng) ----
const ANIM_STATES = ["IDLE", "WALK", "RUN", "SIT", "LOOK_AROUND", "PHONE", "TALK", "WAIT"];
export function animateNPC(npc, state, time) {
    const p = npc.parts;
    const t = time + (npc.seed % 100) * 0.1; // phase offset, không đồng bộ
    const bt = p.torso, hd = p.head;
    // Reset TOÀN BỘ kênh trước mỗi state — tránh sót tư thế từ state cũ
    // (SIT nghiêng torso, PHONE giỗ tay... sẽ còn sót khi chuyển sang WALK).
    p.legL.rotation.x = 0; p.legR.rotation.x = 0;
    p.legL.rotation.y = 0; p.legR.rotation.y = 0;
    p.armL.rotation.x = 0; p.armR.rotation.x = 0;
    p.armL.rotation.y = 0; p.armR.rotation.y = 0;
    p.armL.rotation.z = 0.04; p.armR.rotation.z = -0.04;
    bt.rotation.x = 0; bt.rotation.y = 0; bt.rotation.z = 0;
    hd.rotation.x = 0; hd.rotation.y = 0; hd.rotation.z = 0;
    const legAmp = state === "WALK" ? 0.55 : state === "RUN" ? 0.85 : 0;
    const legSpd = state === "WALK" ? 6.0 : state === "RUN" ? 9.5 : 0;

    if (state === "WALK" || state === "RUN") {
        const ph = t * legSpd;
        p.legL.rotation.x = Math.sin(ph) * legAmp;
        p.legR.rotation.x = Math.sin(ph + Math.PI) * legAmp;
        p.armL.rotation.x = Math.sin(ph + Math.PI) * legAmp * 0.7;
        p.armR.rotation.x = Math.sin(ph) * legAmp * 0.7;
        bt.position.y = bt.userData.baseY + Math.abs(Math.sin(ph)) * 0.02;
        bt.rotation.z = Math.sin(ph) * 0.03;
        hd.rotation.x = Math.sin(ph * 2) * 0.02;
        hd.rotation.y = Math.sin(t * 0.5) * 0.1;
    } else if (state === "SIT") {
        p.legL.rotation.x = -1.35; p.legR.rotation.x = -1.35;
        p.armL.rotation.x = -0.5; p.armR.rotation.x = -0.5;
        bt.rotation.x = 0.1;
    } else if (state === "PHONE") {
        p.armR.rotation.x = -1.5; p.armR.rotation.z = -0.4;
        p.armL.rotation.x = -1.3; p.armL.rotation.z = 0.4;
        hd.rotation.x = 0.35;
        p.legL.rotation.x = 0; p.legR.rotation.x = 0;
    } else if (state === "TALK") {
        const g = Math.sin(t * 4) * 0.3;
        p.armR.rotation.x = -0.6 + g; p.armR.rotation.z = -0.2;
        p.armL.rotation.x = -0.3 - g * 0.5;
        hd.rotation.y = Math.sin(t * 1.5) * 0.2;
        p.legL.rotation.x = 0; p.legR.rotation.x = 0;
    } else if (state === "LOOK_AROUND") {
        hd.rotation.y = Math.sin(t * 0.7) * 0.7;
        hd.rotation.x = Math.sin(t * 0.4) * 0.1;
        bt.rotation.y = Math.sin(t * 0.3) * 0.08;
        p.legL.rotation.x = 0; p.legR.rotation.x = 0;
        p.armL.rotation.x = 0; p.armR.rotation.x = 0;
    } else if (state === "WAIT") {
        // đạp chân nhẹ + nhìn quanh thỉnh thoảng
        p.legL.rotation.x = Math.sin(t * 1.2) * 0.04;
        p.legR.rotation.x = -Math.sin(t * 1.2) * 0.04;
        p.armL.rotation.x = 0; p.armR.rotation.x = 0;
        hd.rotation.y = Math.sin(t * 0.5) * 0.4;
        bt.position.y = bt.userData.baseY + Math.sin(t * 1.1) * 0.006;
    } else { // IDLE
        p.legL.rotation.x = 0; p.legR.rotation.x = 0;
        p.armL.rotation.x = Math.sin(t * 1.1) * 0.05;
        p.armR.rotation.x = -Math.sin(t * 1.1) * 0.05;
        p.armL.rotation.z = 0.04; p.armR.rotation.z = -0.04;
        bt.position.y = bt.userData.baseY + Math.sin(t * 1.6) * 0.008;
        bt.rotation.y = Math.sin(t * 0.4) * 0.04;
        hd.rotation.y = Math.sin(t * 0.45) * 0.3;
        hd.rotation.x = Math.sin(t * 0.8) * 0.03;
    }
}
function setBaseY(npc) {
    // Chỉ set MỘT LẦN (userData.baseY sống qua pool reuse). Nếu đọc lại
    // position.y khi respawn thì sẽ bắt đúng giá trị đang dính bob动画 ±0.02m
    // -> drift tích lũy qua nhiều lần reuse (NPC dần bay lên/sụp xuống).
    if (npc.parts.torso.userData.baseY === undefined) {
        npc.parts.torso.userData.baseY = npc.parts.torso.position.y;
    }
}

export class BusStationManager {
    constructor(scene, map, parkingSlots, playerSpawnPos) {
        this.scene = scene; this.map = map; this.parkingSlots = parkingSlots || [];
        this.playerSpawnPos = playerSpawnPos || null;
        this.stationBuses = [];
        this.busGroup = new THREE.Group();
        this.scene.add(this.busGroup);
        this.maxStaticBuses = 12;
        this.spawnTimer = 0;
        this.spawnQueue = [];
        // ref TrafficManager — dùng để hỏi bãi CHUNG (isBayFree/markBayBusy).
        // main.js gán sau khi createNPC() xong, nên `traffic` còn null lúc
        // constructor chạy.
        this.traffic = null;
        this.prepareStationSpawns();
    }

    setTrafficManager(tm) { this.traffic = tm || null; }
    prepareStationSpawns() {
        const availableSlots = this.parkingSlots.filter(s => !s.occupied);
        let selectedSlots = availableSlots.slice(0, this.maxStaticBuses);
        if (this.playerSpawnPos) {
            const spawnX = this.playerSpawnPos.x, spawnZ = this.playerSpawnPos.z;
            selectedSlots = selectedSlots.filter(slot => Math.hypot(slot.position.x - spawnX, slot.position.z - spawnZ) > 20);
        }
        for (const slot of selectedSlots) { this.spawnQueue.push(slot); }
        // KHÔNG xả hàng ngay tại đây: lúc constructor chạy thì main.js chưa
        // gọi `setTrafficManager()` -> không hỏi được bãi chung với
        // TrafficManager, và 3 xe đầu sẽ đâm thẳng vào xe queue kia (đo được
        // 10/15 slot có 2 xe chồng nhau). Hàng đợi xả ở lần update() sau.
    }
    _spawnOneBus(slot) {
        if (!slot) return;
        // Không chồng lên xe TrafficManager đã đỗ đúng slot này. Hai hệ thống
        // giờ cùng một registry -> mỗi slot đúng 1 xe.
        if (this.traffic) {
            if (!this.traffic.isBayFree(slot.position.x, slot.position.z, 7)) {
                slot.occupied = true;
                return;
            }
            this.traffic.markBayBusy(slot.position.x, slot.position.z);
        }
        const bus = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
        // Y lấy từ data (generator/MapLoader) để xe tĩnh bám mặt sân bến thật
        const sy = (slot.position && typeof slot.position.y === "number") ? slot.position.y : 0.5;
        bus.group.position.set(slot.position.x, sy, slot.position.z);
        // slot.rotation là heading CỦA GENERATOR (baySlots[].heading), khác
        // quy ước rotation.y đúng 90° — cùng chỗ thiếu `+ Math.PI/2` như
        // TrafficManager. Xe không cộng sẽ nằm dọc hàng rồi chồng lên nhau.
        bus.group.rotation.y = (slot.rotation || 0) + Math.PI / 2;
        slot.occupied = true;
        this.busGroup.add(bus.group);
        this.stationBuses.push({ bus, state: 'PARKED' });
    }
    update(dt) {
        if (this.spawnQueue.length > 0) {
            this.spawnTimer += dt;
            if (this.spawnTimer >= 0.5) { this.spawnTimer = 0; this._spawnOneBus(this.spawnQueue.shift()); }
        }
    }
    dispose() { if (this.busGroup.parent) this.busGroup.parent.remove(this.busGroup); }
}

export class TrafficSpawnManager {
    constructor({ scene, edges, edgePaths, random, group, targetActive, maxActive, spawnDistance, despawnDistance, seed }) {
        this.scene = scene; this.edges = edges; this.edgePaths = edgePaths;
        this.random = random; this.group = group; this.targetActive = targetActive;
        this.maxActive = maxActive; this.spawnDistance = spawnDistance;
        this.despawnDistance = despawnDistance; this.seed = seed;
        this.activeVehicles = []; this.pool = [];
        this._spawnInitial();
    }
    _spawnInitial() { for (let i = 0; i < this.targetActive; i++) this._spawn(null, null); }
    _spawn(playerPos, playerHeading) {
        let vehicle = this.pool.pop();
        if (!vehicle) { vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() }); this.group.add(vehicle.group); }
        for (let attempt = 0; attempt < 5; attempt++) {
            const edge = this.edges[Math.floor(this.random() * this.edges.length)];
            if (!edge || !edge.points) continue;
            if (edge.type === 'bus_station_road' && this.random() > 0.1) continue;
            const path = edge.points; const progress = this.random(); const pos = this._getPosOnPath(path, progress);
            if (playerPos) {
                const dx = pos.x - playerPos.x, dz = pos.z - playerPos.z, distToPlayer = Math.hypot(dx, dz);
                if (distToPlayer < 150) continue;
                if (playerHeading) { const forwardX = Math.sin(playerHeading), forwardZ = Math.cos(playerHeading); if (dx * forwardX + dz * forwardZ > 0 && distToPlayer < 300) continue; }
            }
            let overlap = false;
            for (let i = 0; i < this.activeVehicles.length; i++) { if (Math.hypot(pos.x - this.activeVehicles[i].vehicle.group.position.x, pos.z - this.activeVehicles[i].vehicle.group.position.z) < 25) { overlap = true; break; } }
            if (overlap) continue;
            vehicle.group.position.set(pos.x, pos.y, pos.z); vehicle.group.rotation.y = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
            this.activeVehicles.push({ vehicle, edge, progress, speed: 10 + this.random() * 10 }); return true;
        }
        this.pool.push(vehicle); return false;
    }
    _getPosOnPath(path, t) { const idx = Math.min(path.length - 2, Math.floor(t * (path.length - 1))); const localT = t * (path.length - 1) - idx; const a = path[idx], b = path[idx + 1]; return { x: a.x + (b.x - a.x) * localT, y: (typeof a.y === "number" ? a.y + ((b.y || a.y) - a.y) * localT : 0.5), z: a.z + (b.z - a.z) * localT }; }
    update(dt, playerPos, playerHeading) {
        const toRemove = [];
        for (let i = 0; i < this.activeVehicles.length; i++) {
            const v = this.activeVehicles[i]; if (!v || !v.vehicle) { toRemove.push(i); continue; }
            if (playerPos) { const dist = Math.hypot(v.vehicle.group.position.x - playerPos.x, v.vehicle.group.position.z - playerPos.z); if (dist > this.despawnDistance) { toRemove.push(i); continue; } }
            v.progress += (v.speed * dt) / (this.edgePaths.find(e => e === v.edge)?.total || 1000); if (v.progress >= 1) v.progress = 0;
            const pos = this._getPosOnPath(v.edge.points, v.progress); v.vehicle.group.position.x = pos.x; v.vehicle.group.position.z = pos.z;
        }
        for (let i = toRemove.length - 1; i >= 0; i--) { const v = this.activeVehicles[toRemove[i]]; if (v && v.vehicle) { v.vehicle.group.visible = false; this.pool.push(v.vehicle); } this.activeVehicles.splice(toRemove[i], 1); }
        while (this.activeVehicles.length < this.targetActive) if (!this._spawn(playerPos, playerHeading)) break;
    }
    getActiveCount() { return this.activeVehicles.length; }
    dispose() { this.activeVehicles.forEach(v => { if (v.vehicle?.group?.parent) v.vehicle.group.parent.remove(v.vehicle.group); }); }
}

export function createNPC({ scene, map, seed = 2027, playerBus = null, playerSpawnPos = null }) {
    if (!scene || !map) return { update() {}, dispose() {}, getWaitingPassengers: () => [] };
    const random = createSeededRandom(seed);
    const group = new THREE.Group(); group.name = "npc"; scene.add(group);
    
    // Sử dụng RuntimeRoadGraph từ MapLoader
    const graph = map.getRoadGraph();
    if (!graph) return { update() {}, dispose() {}, getWaitingPassengers: () => [] };
    
    const edges = graph.segments.map(s => {
        const f = graph.getNode(s.from);
        const t = graph.getNode(s.to);
        return f && t ? { from: s.from, to: s.to, points: [{x:f.x, y:f.y, z:f.z}, {x:t.x, y:t.y, z:t.z}], width: 24, type: s.roadType, twoWay: s.twoWay } : null;
    }).filter(Boolean);
    const edgePaths = edges.map((e) => { const cum = new Float32Array(e.points.length); let total = 0; for (let i = 1; i < e.points.length; i++) { total += Math.hypot(e.points[i].x - e.points[i-1].x, e.points[i].z - e.points[i-1].z); cum[i] = total; } return { cum, total: total || 1 }; });
    // GỘP HỆ THỐNG SONG SONG: TrafficSpawnManager từng tự spawn 15 xe chạy
    // nhưng KHÔNG CÓ AI (bản sao của TrafficManager -> 2 nguồn xe cùng lúc).
    // Giờ TrafficManager là NGUỒN DUY NHẤT của xe đang chạy; manager này
    // giữ nguyên API/vehicle pool nhưng targetActive = 0 -> không sinh trùng.
    // getMovingVehicleCount ủy quyền sang TrafficManager qua setTrafficManager()
    // (main.js gọi sau khi tạo trafficManager).
    const spawnManager = new TrafficSpawnManager({ scene, edges, edgePaths, random, group, targetActive: 0, maxActive: 0, spawnDistance: 350, despawnDistance: 550, seed: seed + 999 });
    let trafficManagerRef = null;
    
    let stationManager = null;
    const parkingSlots = (map.getParkingSlots && map.getParkingSlots()) || [];
    if (parkingSlots.length > 0) { try { stationManager = new BusStationManager(scene, map, parkingSlots, playerSpawnPos); } catch (e) {} }
    
    let playerRef = playerBus || null;
    const playerScratch = { x: 0, z: 0 };
    function getPlayerPos() { if (!playerRef && scene) { for (const c of scene.children) if (c.name === "bus") { playerRef = c; break; } } if (playerRef && playerRef.group && playerRef.group.position) { playerScratch.x = playerRef.group.position.x; playerScratch.z = playerRef.group.position.z; return true; } return false; }

    let waitingPassengers = [];
    function generateWaitingPassengers() {
        waitingPassengers = [];
        const waypoints = graph.getRouteWaypoints();
        if (waypoints.length === 0) return;
        const stationNode = waypoints[0];
        // Y theo terrain thật (map.getTerrainHeight) => hành khách đứng đúng mặt đất
        const groundY = map.getTerrainHeight ? map.getTerrainHeight(stationNode.x, stationNode.z) : 0.5;
        for (let i = 0; i < 10; i++) {
            waitingPassengers.push({ id: `pass_station_${i}`, x: stationNode.x + (random() - 0.5) * 15, z: stationNode.z + (random() - 0.5) * 15, y: groundY, destination: waypoints[waypoints.length - 1].id });
        }
        for (let i = 1; i < waypoints.length - 1; i++) {
            if (i > 10) break;
            const p1 = waypoints[i-1];
            const p2 = waypoints[i];
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const len = Math.hypot(dx, dz);
            if (len === 0) continue;
            const rx = dz / len;
            const rz = -dx / len;
            const offset = 15 + random() * 5;
            const side = random() > 0.5 ? 1 : -1;
            const x = p1.x + dx * 0.5 + rx * offset * side + (random() - 0.5) * 3;
            const z = p1.z + dz * 0.5 + rz * offset * side + (random() - 0.5) * 3;
            waitingPassengers.push({ id: `pass_road_${i}`, x, z, y: map.getTerrainHeight ? map.getTerrainHeight(x, z) : 0.5, destination: waypoints[waypoints.length - 1].id });
        }
    }
    generateWaitingPassengers();

    // ===== PEDESTRIAN NPC SYSTEM (người đi bộ) =====
    // Spawn quanh player theo context, pool + LOD, không phá API cũ.
    const PED_CONTEXTS = [
        { id: "BUS_STATION", density: 0.30, states: ["WAIT", "PHONE", "TALK", "WALK", "LOOK_AROUND"] },
        { id: "SIDEWALK", density: 0.25, states: ["WALK", "PHONE", "IDLE", "LOOK_AROUND"] },
        { id: "ROAD_SIDE", density: 0.15, states: ["IDLE", "LOOK_AROUND", "WAIT"] },
        { id: "RESTAURANT", density: 0.12, states: ["SIT", "TALK", "IDLE"] },
        { id: "RESIDENTIAL", density: 0.10, states: ["IDLE", "WALK", "TALK"] },
        { id: "RURAL", density: 0.08, states: ["WALK", "IDLE"] }
    ];

    const MAX_ACTIVE_PEDS = 60;
    const PED_SPAWN_RADIUS = 160;
    const PED_DESPAWN_RADIUS = 200;
    const pedGroup = new THREE.Group(); pedGroup.name = "npc_pedestrians"; scene.add(pedGroup);
    const pedPool = [];       // NPC đã tạo, tái sử dụng
    const activePeds = [];    // NPC đang hiển thị
    let pedIdCounter = 0;
    const pedRandom = createSeededRandom(seed + 777);

    function spawnPedestrian() {
        if (activePeds.length >= MAX_ACTIVE_PEDS) return false;
        if (!getPlayerPos()) return false;
        const px = playerScratch.x, pz = playerScratch.z;
        // Chọn context theo proximity: gần graph → station/sidewalk, xa → rural
        const ctx = PED_CONTEXTS[Math.floor(pedRandom() * PED_CONTEXTS.length)];
        if (pedRandom() > ctx.density * 4) return false;

        // Spawn position: bán kính quanh player, tránh quá gần
        const angle = pedRandom() * TWO_PI;
        const dist = 40 + pedRandom() * (PED_SPAWN_RADIUS - 40);
        const sx = px + Math.sin(angle) * dist;
        const sz = pz + Math.cos(angle) * dist;
        // Trùng vị trí với ped đang active → bỏ qua
        for (const p of activePeds) {
            if (Math.hypot(p.group.position.x - sx, p.group.position.z - sz) < 6) return false;
        }

        const npc = pedPool.pop() || createHumanoidNPC(seed + (pedIdCounter++));
        if (!npc) return false;
        const gy = map.getTerrainHeight ? map.getTerrainHeight(sx, sz) : 0.5;
        npc.group.position.set(sx, gy, sz);
        npc.group.rotation.y = pedRandom() * TWO_PI;
        npc.group.visible = true;
        setBaseY(npc);

        // Chọn state ban đầu
        const state = pick(pedRandom, ctx.states);
        npc.state = state;
        npc.context = ctx.id;
        npc.speed = 0.6 + pedRandom() * 0.9; // 0.6–1.5 m/s
        npc.walkDir = new THREE.Vector3(Math.sin(npc.group.rotation.y), 0, Math.cos(npc.group.rotation.y));
        npc.stateTimer = 2 + pedRandom() * 6;
        npc.lod = 0;
        npc.animPhase = pedRandom() * 10;
        npc.animTime = 0;     // phase tích lũy riêng cho LOD interpolation
        npc.animSkip = 0;

        pedGroup.add(npc.group);
        activePeds.push(npc);
        return true;
    }

    function despawnPedestrian(npc) {
        npc.group.visible = false;
        pedGroup.remove(npc.group);
        pedPool.push(npc);
    }

    // Giữ 1 số ped cố định quanh điểm spawn (bến xe) — spawn ngay đầu
    function spawnInitialPeds() {
        for (let i = 0; i < 12; i++) spawnPedestrian();
    }
    spawnInitialPeds();

    let pedSpawnAccum = 0;
    let pedClock = 0;          // clock nội bộ — main.js truyền t=0 nên không dùng t ngoài
    function updatePedestrians(dt) {
        if (!getPlayerPos()) return;
        pedClock += dt;
        const t = pedClock;
        const px = playerScratch.x, pz = playerScratch.z;

        // Spawn/Despawn (throttle mỗi 0.4s)
        pedSpawnAccum += dt;
        if (pedSpawnAccum > 0.4) {
            pedSpawnAccum = 0;
            // Despawn xa
            for (let i = activePeds.length - 1; i >= 0; i--) {
                const d = Math.hypot(activePeds[i].group.position.x - px, activePeds[i].group.position.z - pz);
                if (d > PED_DESPAWN_RADIUS) { despawnPedestrian(activePeds[i]); activePeds.splice(i, 1); }
            }
            // Spawn gần
            if (activePeds.length < MAX_ACTIVE_PEDS * 0.7) spawnPedestrian();
        }

        // Cập nhật từng ped
        for (const npc of activePeds) {
            const d = Math.hypot(npc.group.position.x - px, npc.group.position.z - pz);
            // LOD: 0 near (<40m) → full anim, 1 mid (<90m) → anim giảm, 2 far → anim rất chậm
            npc.lod = d < 40 ? 0 : d < 90 ? 1 : 2;

            // State timer — đổi hành vi định kỳ
            npc.stateTimer -= dt;
            if (npc.stateTimer <= 0) {
                const ctx = PED_CONTEXTS.find(c => c.id === npc.context) || PED_CONTEXTS[0];
                npc.state = pick(pedRandom, ctx.states);
                npc.stateTimer = 3 + pedRandom() * 8;
            }

            // Di chuyển nếu WALK/RUN
            if (npc.state === "WALK" || npc.state === "RUN") {
                const spd = npc.state === "RUN" ? npc.speed * 2.2 : npc.speed;
                npc.group.position.x += npc.walkDir.x * spd * dt;
                npc.group.position.z += npc.walkDir.z * spd * dt;
                if (map.getTerrainHeight) {
                    npc.group.position.y = map.getTerrainHeight(npc.group.position.x, npc.group.position.z);
                }
                // Đổi hướng ngẫu nhiên
                if (pedRandom() < dt * 0.3) {
                    npc.group.rotation.y += (pedRandom() - 0.5) * 1.5;
                    npc.walkDir.set(Math.sin(npc.group.rotation.y), 0, Math.cos(npc.group.rotation.y));
                }
            }

            // LOD animation: 60/30/15 fps update (spec: 60/30/10–15fps).
            // Phase tích lũy LIÊN TỤC với rate giảm -> mượt, không nhảy pha.
            // (Bản cũ t*0.33 làm animation CHẠY NHANH ×3 ở xa — sai ý nghĩa.)
            const rate = npc.lod === 0 ? 1 : npc.lod === 1 ? 0.5 : 0.25;
            npc.animTime = (npc.animTime || 0) + dt * rate;
            if (npc.lod > 0) {
                npc.animSkip = (npc.animSkip || 0) + 1;
                if (npc.animSkip % (npc.lod === 1 ? 2 : 3) !== 0) continue; // bỏ 1-2 frame
            }
            animateNPC(npc, npc.state, npc.animTime);
        }
    }

    function update(dt, t = 0) {
        const hasPlayer = getPlayerPos(); let heading = 0;
        if (hasPlayer && playerRef && playerRef.group) heading = playerRef.group.rotation.y;
        spawnManager.update(dt, hasPlayer ? { x: playerScratch.x, z: playerScratch.z } : null, heading);
        if (stationManager) stationManager.update(dt);
        updatePedestrians(dt);
    }
    
    function dispose() {
        if (scene) scene.remove(group);
        if (scene) scene.remove(pedGroup);
        disposeObject3D(group);
        disposeObject3D(pedGroup);
        activePeds.length = 0;
        pedPool.length = 0;
        spawnManager.dispose();
        if (stationManager) stationManager.dispose();
    }
    
    return {
        group, update, dispose, getWaitingPassengers: () => waitingPassengers,
        pickUpPassenger: (id) => { const idx = waitingPassengers.findIndex(p => p.id === id); if (idx !== -1) { waitingPassengers.splice(idx, 1); return true; } return false; },
        getMovingVehicleCount: () => (trafficManagerRef ? trafficManagerRef.getMovingCount() : spawnManager.getActiveCount()),
        setTrafficManager(tm) {
            trafficManagerRef = tm || null;
            // BusStationManager cũng cần ref để kiểm tra bãi CHUNG — không
            // thì hai bên vẫn đỗ chồng lên nhau dù có isBayFree().
            if (stationManager) stationManager.setTrafficManager(trafficManagerRef);
        },
        setPlayerBus(b) { playerRef = b; }
    };
}