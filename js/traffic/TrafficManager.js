// js/traffic/TrafficManager.js
// =====================================================================
// Quản lý vòng đời giao thông NPC: spawn / despawn / LOD / pool / index.
// - SPAWN: bám vào road network (segment -> chi? -> làn), CHỈ trong cửa sổ
//   quanh người chơi, có FOV gate (không nhổ xe trước mũi), spacing theo
//   làn + Euclidean, trọng số theo MẬT ĐỘ của loại đường (getLaneMeta.density).
// - DESPAWN: bán kính lớn hơn hẳn cửa sổ spawn (dead-band 180m+) -> không
//   flicker (học ALiVE: spawn radius < despawn radius).
// - LOD: NEAR/MID/FAR có hysteresis ±20m, quyết định tần suất AI suy nghĩ;
//   xe DI CHUYỂN luôn tích phân mỗi frame (xem TrafficAI._integrate).
// - POOL: tái sử dụng mesh NPC (createNpcBus rất nặng -> không tạo mới liên tục).
// - INDEX: bySeg Map (O(1) tra xe cùng đoạn) cho spawn check + debug.
// - Người chơi được đưa vào danh sách "participant" để NPC nhường/đi theo.
// API GIỮ NGUYÊN: createTrafficManager, setupStationTraffic,
// processStationQueue, update, getActiveVehicles, aiVehicles, maxVehicles.
// =====================================================================
import { createNpcBus, pickNpcSkinPath, pickLedColor, loadNpcSkinList } from "../bus.js";
import { TrafficAI, AI_STATE } from "./TrafficAI.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { hypot2 } from "../utils.js";
import { createSeededRandom, clamp } from "../utils.js";
import {
    NPC_VEHICLE_KIND, NPC_VEHICLE_SPECS, createNpcVehicle, pickVehicleColor
} from "../npc_vehicles.js";

const BUS_LEN_APPROX = 12.8;   // xe NPC dùng chung mesh bus (bus.js BUS_DIMENSIONS)
const BUS_W_APPROX = 2.53;

// ===== PHÂN BỔ LOẠI XE NPC =====
// Giao thông đường VN thực tế: xe khách liên tỉnh + ô tô con chạy xe buýt,
// van 16 chỗ đưa rước, xe tải thùng kín và đầu kéo container chạy QL/cao
// tốc. Tỉ lệ dưới đây CHỈ quyết định hình dáng + kích thước (xe nào hay
// chạy trên loại đường nào) — không can thiệp vào luật giao thông của AI.
const VEHICLE_TYPE_TABLE = [
    { kind: NPC_VEHICLE_KIND.BUS, w: 0.36 },
    { kind: NPC_VEHICLE_KIND.CAR, w: 0.24 },
    { kind: NPC_VEHICLE_KIND.VAN16, w: 0.14 },
    { kind: NPC_VEHICLE_KIND.TRUCK, w: 0.15 },
    { kind: NPC_VEHICLE_KIND.SEMI, w: 0.11 }
];
const VEHICLE_TYPE_TOTAL = VEHICLE_TYPE_TABLE.reduce((a, b) => a + b.w, 0);

// Nhân cách lái xe theo loại xe: xe tải/đầu kéo nặng -> chậm hơn, ô tô con
// nhanh + bám sát. speedFactor nhân thêm cho xe tải (đường VN: xe tải chạy
// 60-70 km/h trên QL, container 50-60).
const VEHICLE_DRIVER = {
    [NPC_VEHICLE_KIND.BUS]: { personality: null, speedScale: 1.0 },
    [NPC_VEHICLE_KIND.CAR]: { personality: 'FAST', speedScale: 1.06 },
    [NPC_VEHICLE_KIND.VAN16]: { personality: 'NORMAL', speedScale: 0.94 },
    [NPC_VEHICLE_KIND.TRUCK]: { personality: 'CAUTIOUS', speedScale: 0.82 },
    [NPC_VEHICLE_KIND.SEMI]: { personality: 'CAUTIOUS', speedScale: 0.70 }
};

// ===== Bug 8 hệ lụy: static colliders (nhà/cây/cột/guardrail/xe bãi) =====
// Broad-phase của collisionSystem là HÌNH TRÒN — r xe NPC 3 + r static tới 7 —
// quá rộng so với khối thật: guardrail dài 8m, TÂM hộp cách tới 4m DỌC; xe NPC
// chạy làn sát lề sẽ "hit" liên tục rồi phanh ảo, kẹt cả dòng xe phía sau.
// Fix: narrow-phase SAT thật giữa OBB xe NPC (12.8×2.53 theo ai.heading) và
// khối hit trước khi hãm — cùng convention trục với rectContact() của main.js:
// hướng tới = (sin, cos), pháp tuyến = (cos, −sin). Chỉ tính khi broad-phase
// trúng (hiếm) nên chi phí gần như bằng 0, dùng mảng tĩnh không cấp phát.
//   * data.ai (xe bãi tĩnh của npc.js, chỉ có heading): OBB xe đúng chuẩn.
//   * {hl, hw, rot} (nhà/guardrail): SAT đủ 4 trục.
//   * tròn {r} (cây/cột): coi như hộp hl=hw=r — hl=hw thì bán kính hình chiếu
//     hằng số theo mọi trục -> vẫn đúng khối tròn.
//   * player: collisionSystem đăng ký r=4 KHÔNG data (chỉ là broad-phase);
//     khối tròn r=4 quá rộng ngang (1.265+4+0.12 ≈ 5.4m) -> NPC phanh ảo ở
//     làn kề. Dùng OBB xe thật theo heading hiện hành của playerActor.
const _SAT_AXES_NPC = new Float64Array(8);
function _narrowOverlap(ai, hit, playerRot) {
    const d = hit.data;
    let bhl, bhw, bRot;
    // Thân xe NPC: dùng KÍCH THƯỚC THẬT của xe đó (bus 12.8x2.53, ô tô con
    // 4.5x1.74, đầu kéo 16.5x2.5) — không dùng hằng số xe khách cho mọi loại.
    const ahl = ai.vehHalfLen, ahw = ai.vehHalfWid;
    if (d && d.ai) {
        bhl = (d.ai.vehLen || BUS_LEN_APPROX) * 0.5;
        bhw = (d.ai.vehWid || BUS_W_APPROX) * 0.5;
        bRot = typeof d.ai.heading === 'number' ? d.ai.heading : 0;
    } else if (!d && hit.type === 'player' && typeof playerRot === 'number') {
        bhl = BUS_LEN_APPROX * 0.5;
        bhw = BUS_W_APPROX * 0.5;
        bRot = playerRot;
    } else {
        bhl = d && typeof d.hl === 'number' ? d.hl : hit.r;
        bhw = d && typeof d.hw === 'number' ? d.hw : bhl;
        bRot = d && typeof d.rot === 'number' ? d.rot : 0;
    }
    const aFx = Math.sin(ai.heading), aFz = Math.cos(ai.heading);
    const bFx = Math.sin(bRot), bFz = Math.cos(bRot);
    const dx = hit.x - ai.collider.x, dz = hit.z - ai.collider.z;
    const axes = _SAT_AXES_NPC;
    axes[0] = aFx; axes[1] = aFz; axes[2] = aFz; axes[3] = -aFx;
    axes[4] = bFx; axes[5] = bFz; axes[6] = bFz; axes[7] = -bFx;
    for (let i = 0; i < 4; i++) {
        const nx = axes[i * 2], nz = axes[i * 2 + 1];
        const required =
              ahl * Math.abs(aFx * nx + aFz * nz)
            + ahw * Math.abs(aFz * nx - aFx * nz)
            + bhl * Math.abs(bFx * nx + bFz * nz)
            + bhw * Math.abs(bFz * nx - bFx * nz)
            + 0.12;   // nghe OBB_MARGIN của main.js: hãm hơi sớm hơn chút, đỡ lún
        if (Math.abs(dx * nx + dz * nz) > required) return false;   // trục phân ly
    }
    return true;
}

// Lấy LOOKAHEAD từ TrafficAI (tránh duplicate constant)
const LOOKAHEAD = 90;

// Phân bố nhân cách (VN: phần lớn bình thường, thỉnh thoảng có ông thần).
// GDCD_SKIPPER ~3%: "học sinh cá biệt trốn tiết thực hành GDCD" — hiếm,
// mỗi con lưng lục đúng 1 tình huống (hit-run / vượt bất chấp / "đường
// bố tao xây"). Không cộng dồn thành "hàng loạt tai nạn" — spawn cả làng.
const PERSONALITY_TABLE = [
    { p: 'CAUTIOUS', w: 0.18 },
    { p: 'NORMAL', w: 0.35 },
    { p: 'FAST', w: 0.17 },
    { p: 'AGGRESSIVE', w: 0.10 },
    { p: 'BUS_DRIVER', w: 0.10 },
    { p: 'GDCD_SKIPPER', w: 0.10 }
];
const PERSONALITY_TOTAL = PERSONALITY_TABLE.reduce((a, b) => a + b.w, 0);

export class TrafficManager {
    constructor({ scene, roadGraph, maxVehicles = 60, playerRef = null }) {
        this.scene = scene;
        this.roadGraph = roadGraph;
        this.playerRef = playerRef;
        this.maxVehicles = maxVehicles;
        this.aiVehicles = [];
        this.pool = [];
        this.activeCount = 0;
        // XE TĨNH (xe đỗ trong bãi bến, `isStatic`) KHÔNG được tính vào ngân
        // sách "xe đang chạy". Trước đây `activeCount` gộp cả hai, trong khi
        // spawn gate dùng nó -> 223 xe đỗ bến làm `activeCount=224` vượt
        // `maxActive=3` => slider "Mật độ NPC" chết, xe cộ không còn chạy.
        // Số đếm tách riêng để gate chỉ nhìn số xe CHẠY.
        this.staticCount = 0;
        this.seed = Date.now();
        this.random = createSeededRandom(this.seed);
        this.graphics = getGraphicsSettings();
        this.graphics.onChange(() => this._onSettingsChanged());
        loadNpcSkinList();

        // Cửa sổ spawn/despawn suy từ preset đồ hoạ (máy yếu = vòng nhỏ hơn)
        // nhưng luôn giữ dead-band >= 180m để xe không bị hút ra/đẩy vào.
        this.spawnDistance = 340;
        this.despawnDistance = 720;
        this.spawnTimer = 0;
        this.spawnInterval = 0.5;
        this.maxSpawnPerFrame = 2;
        this.lastPlayerPos = { x: 0, z: 0 };

        this.isGraphMode = (roadGraph && Array.isArray(roadGraph.segments) && (Array.isArray(roadGraph.nodes) || roadGraph._nodeMap));
        this._validSegsCache = null;
        this.MIN_TRAFFIC_SPAWN_DISTANCE = 50;   // chặn xe chồng nhau (mốc cũ, vẫn giữ)

        this.stationSpawnQueue = [];
        this.stationSpawnTimer = 0;
        // Thoại NPC ("học sinh cá biệt GDCD"): main.js gán onDialogue
        // (t) => ui.toast(t). Throttle trong _emitDialogue để không spam HUD.
        this.onDialogue = null;
        this._dlgT = 0;
        // vị trí bãi ĐÃ đỗ — chung với BusStationManager (npc.js), xem
        // `isBayFree`/`markBayBusy` ở dưới.
        this._bayBusy = [];

        // --- participant = NPC + người chơi (NPC PHẢI nhường xe của player) ---
        this._participants = [];
        this.playerActor = {
            collider: { x: 0, y: 0, z: 0, r: 2.6 },
            speed: 0, heading: 0, isPlayer: true, active: true
        };
        this._prevPlayer = { x: 0, z: 0, valid: false };

        this._bySeg = new Map();      // segId -> AI[] (tái dùng mảng, stamp _f)
        this._frameNo = 0;            // đếm frame: reset mảng reuse đúng 1 lần/frame
        
        // SPATIAL GRID cho tìm xe gần (O(1) query thay vì O(N))
        // Dùng cho TrafficAI._scan để chỉ quét xe trong bán kính LOOKAHEAD
        this._vehicleGrid = new Map();
        this._vehicleGridCellSize = 100; // 100m cells

        // Throttle A* retarget: A* trên graph ~10k nodes có thể tốn 10-40ms.
        // Nếu nhiều xe cùng retarget cùng lúc (sau spawn) → frame spike.
        // Giới hạn: tối đa 1 retarget mỗi 0.5s, các xe khác chờ frame sau.
        this._retargetThrottle = 0; // timestamp (ms) lần retarget cuối

        this._nextAiId = 1;
        this._onSettingsChanged();
    }

    // ---------------------------------------------------------------- settings
    _onSettingsChanged() {
        const s = this.graphics.settings;
        const gSpawn = s.spawnDistance || 200;
        const gDespawn = s.despawnDistance || 400;
        this.spawnDistance = clamp(Math.round(gSpawn * 1.7), 200, 340);
        this.despawnDistance = Math.max(Math.round(gDespawn * 1.6), this.spawnDistance + 180);
        // maxVehicles KHÔNG bị override ở đây: nó là thanh "Mật độ NPC" của
        // người chơi (main.js gán). Trước đây settings đổi là density người
        // chơi bị reset.
    }

    // ---------------------------------------------------------------- helpers
    _segOk(s) {
        if (!s) return false;
        // Chỉ spawn NPC trên đường lớn, không spawn trên ramp/hầm/đường nội bộ/sân bến/hẻm
        const blocked = new Set(['TUNNEL', 'RAMP', 'INTERNAL', 'SERVICE', 'STATION_ACCESS', 'ALLEY',
            'AGRICULTURAL', 'RESIDENTIAL']); // tránh spawn trong hẻm/đường nông nghiệp/đường dân cư
        if (blocked.has(s.class)) return false;
        if (s.type === 'tunnel' || s.type === 'bus_station_road' || s.type === 'highway_ramp') return false;
        const f = this.roadGraph.getNode(s.from);
        const t = this.roadGraph.getNode(s.to);
        if (!f || !t) return false;
        return hypot2(t.x - f.x, t.z - f.z) > 12;
    }

    _densityOf(s) {
        if (!s) return 0;
        const meta = (this.roadGraph.getLaneMeta) ? this.roadGraph.getLaneMeta(s) : null;
        return meta ? meta.density : 0.4;
    }

    // --- ZONE CAP: số xe cho phép KHÁC NHAU theo khu vực ---
    // `_densityOf` (DENSITY_BY_CLASS) trước đây chỉ phân bổ VỊ TRÍ spawn — tức là
    // "xe hay xuất hiện trên đường lớn hơn", nhưng con số `maxActive` vẫn là cap
    // TOÀN CỤC nên phố và đường làng lúc nào cũng giống hệt nhau. Yêu cầu của lỗi:
    //   - đường đô thị/QL/cao tốc phải ĐÔNG hơn khi phù hợp,
    //   - đường nông thôn được ít hơn NHƯNG thế giới không được trống rỗng.
    // Cách làm: mỗi ~0.5s lấy trung bình density của các đoạn đường quanh người
    // chơi rồi nhân vào cap, có chặn trên là baseMax*2 — KHÔNG tăng xe bừa bãi,
    // KHÔNG giảm xe đang chạy (chỉ đổi cửa spawn), và KHÔNG đụng thuật toán lái,
    // va chạm hay tải skin NPC.
    _updateZoneCap(dt, px, pz) {
        this._zoneTimer = (this._zoneTimer || 0) + dt;
        if (this._zoneTimer < 0.5) return;
        this._zoneTimer = 0;
        if (!this.isGraphMode || typeof this.roadGraph.segmentsNear !== 'function') {
            this._zoneDensity = -1;
            return;
        }
        const near = this.roadGraph.segmentsNear(px, pz, this.spawnDistance, s => this._segOk(s));
        if (!near || !near.length) { this._zoneDensity = -1; return; }
        let sum = 0, n = 0;
        for (let i = 0; i < near.length; i++) {
            const d = this._densityOf(near[i]);
            if (d > 0) { sum += d; n++; }
        }
        this._zoneDensity = n ? (sum / n) : -1;
    }

    _zoneCapFor(baseMax) {
        if (!(this._zoneDensity >= 0) || baseMax <= 0) return baseMax;
        // density 0.20 (ruong/ALLEY)  -> 0.60x
        // density 0.50 (duong lang)   -> 1.05x
        // density 1.00 (QL1A/cao toc)  -> 1.50x
        const f = 0.6 + 0.9 * Math.min(1, this._zoneDensity);
        return Math.max(1, Math.min(Math.round(baseMax * f), baseMax * 2));
    }

    _pickPersonality() {
        let r = this.random() * PERSONALITY_TOTAL;
        for (const row of PERSONALITY_TABLE) {
            r -= row.w;
            if (r <= 0) return row.p;
        }
        return 'NORMAL';
    }

    // ---------------------------------------------------------------- spawn
    _spawnVehicle() {
        if (!this.isGraphMode) return null;
        const px = this.lastPlayerPos.x, pz = this.lastPlayerPos.z;

        // CHỈ bốc trong bán kính quanh người chơi (grid 256m của graph).
        const near = (typeof this.roadGraph.segmentsNear === 'function')
            ? this.roadGraph.segmentsNear(px, pz, this.spawnDistance * 2.2, s => this._segOk(s))
            : null;
        let pool = near;
        if (!pool || pool.length === 0) {
            if (!this._validSegsCache) {
                this._validSegsCache = this.roadGraph.segments.filter(s => this._segOk(s));
            }
            if (!this._validSegsCache.length) return null;
            pool = this._validSegsCache;
        }

        // Hướng nhìn người chơi (forward = (sin h, cos h) — khớp bus.group)
        const busGroup = this.playerRef && this.playerRef.group;
        const playerHeading = busGroup ? busGroup.rotation.y : 0;
        const fwdX = Math.sin(playerHeading), fwdZ = Math.cos(playerHeading);

        let candidate = null;
        for (let i = 0; i < 40; i++) {
            const seg = pool[Math.floor(this.random() * pool.length)];
            if (!seg) continue;
            // trọng số mật độ: đường ít xe bị loại với xác suất (1 - density)
            if (this.random() > this._densityOf(seg)) continue;

            const dir = seg.twoWay ? Math.floor(this.random() * 2) : 0;
            const f = this.roadGraph.getNode(seg.from);
            const t = this.roadGraph.getNode(seg.to);
            if (!f || !t) continue;

            const p0 = dir === 0 ? f : t;
            const p1 = dir === 0 ? t : f;
            const progress = 0.15 + this.random() * 0.7;
            const x = p0.x + (p1.x - p0.x) * progress;
            const z = p0.z + (p1.z - p0.z) * progress;

            const distPlayer = hypot2(x - px, z - pz);
            // Lệch tối đa giữa tâm đường và vị trí THẬT sau placeOnSegment
            // (xe nằm ở làn, không ở centerline) -> cổng spawn phải trừ hao
            // chừng đó, nếu không xe vẫn lọt vào vùng cấm theo toạ độ thật.
            const meta = this.roadGraph.getLaneMeta ? this.roadGraph.getLaneMeta(seg) : null;
            const drift = (meta ? meta.half : 7) + 0.5;
            // không nhổ xe quá gần / quá xa (theo vị trí thật)...
            if (distPlayer < this.spawnDistance * 0.5 + drift ||
                distPlayer > this.spawnDistance - drift) continue;
            // ...và KHÔNG nhổ trước camera trong bán kính thấy rõ
            const dot = (x - px) * fwdX + (z - pz) * fwdZ;
            if (dot > -drift && distPlayer < 260 + drift) continue;

            if (!this._spawnSpotFree(seg.id, dir, progress, x, z)) continue;

            candidate = { seg, dir, progress, x, z };
            break;
        }
        if (!candidate) return null;

        // Chọn loại xe (hình dáng + kích thước) rồi lấy mesh từ pool.
        const kind = this._pickVehicleType(candidate.seg);
        const colorIndex = kind === NPC_VEHICLE_KIND.BUS
            ? -1                                   // xe khách dùng skin texture riêng
            : pickVehicleColor(kind, this.random);
        let vehicle = this._takePooledVehicle(kind, colorIndex);
        if (!vehicle) {
            if (kind === NPC_VEHICLE_KIND.BUS) {
                vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
            } else {
                vehicle = createNpcVehicle(kind, colorIndex);
            }
            this.scene.add(vehicle.group);
        }

        // Nhân cách lái xe theo loại xe (xe tải chậm hơn, ô tô con nhanh hơn).
        const drv = VEHICLE_DRIVER[kind] || VEHICLE_DRIVER[NPC_VEHICLE_KIND.BUS];
        const personality = drv.personality || this._pickPersonality();

        const ai = new TrafficAI({
            vehicle, roadGraph: this.roadGraph,
            personality,
            seed: this.seed + this._nextAiId
        });
        ai.id = this._nextAiId++;
        ai.vehicleKind = kind;
        ai.vehicleColorIndex = colorIndex;
        if (drv.speedScale !== 1.0) ai.profile.speedFactor *= drv.speedScale;
        ai.speak = (t) => this._emitDialogue(t);   // NPC GDCD mở mồm qua HUD
        if (!ai.placeOnSegment(candidate.seg.id, candidate.dir, candidate.progress, null)) {
            this._retireToPool(vehicle, kind, colorIndex);   // không đặt được -> trả pool
            return null;
        }
        ai.setActive(true);

        if (window.collisionSystem) {
            ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai }, ai.collider.y, 4.0);
        }

        this.aiVehicles.push(ai);
        this.activeCount++;
        return ai;
    }

    // Chọn loại xe NPC theo loại đường: xe tải/đầu kéo container chạy đường
    // lớn (QL/cao tốc) nhiều hơn, đường nhỏ/đô thị nhiều ô tô con.
    _pickVehicleType(seg) {
        const cls = seg && seg.class;
        const bigRoad = (cls === "NATIONAL" || cls === "EXPRESSWAY" || cls === "ARTERIAL" ||
            cls === "PROVINCIAL_ROAD" || cls === "COLLECTOR");
        let r = this.random() * VEHICLE_TYPE_TOTAL;
        for (const row of VEHICLE_TYPE_TABLE) {
            // Xe nặng (tải/đầu kéo) chỉ xuất hiện trên đường lớn.
            const heavy = (row.kind === NPC_VEHICLE_KIND.TRUCK || row.kind === NPC_VEHICLE_KIND.SEMI);
            if (heavy && !bigRoad) continue;
            r -= row.w;
            if (r <= 0) return row.kind;
        }
        return NPC_VEHICLE_KIND.BUS;
    }

    // Lấy mesh đã dùng trong pool (khớp loại + màu) -> không tạo mới liên tục.
    _takePooledVehicle(kind, colorIndex) {
        const pool = this.pool;
        for (let i = 0; i < pool.length; i++) {
            const e = pool[i];
            if (e.kind === kind && e.colorIndex === colorIndex) {
                pool.splice(i, 1);
                return e.vehicle;
            }
        }
        return null;
    }

    _retireToPool(vehicle, kind, colorIndex) {
        this.pool.push({ vehicle, kind, colorIndex });
    }

    // Kiểm tra khoảng trống tại điểm spawn: cùng đoạn theo TRỤC ĐƯỜNG
    // (chồng đầu-đuôi) + Euclidean với mọi xe quanh (dùng spatial grid O(1)).
    _spawnSpotFree(segId, dir, progress, x, z) {
        const sameSeg = this._bySeg.get(segId);
        if (sameSeg && sameSeg.length) {
            const seg = this.roadGraph.getSegment(segId);
            const f = seg ? this.roadGraph.getNode(seg.from) : null;
            const t = seg ? this.roadGraph.getNode(seg.to) : null;
            const len = (f && t) ? hypot2(t.x - f.x, t.z - f.z) : 100;
            for (const o of sameSeg) {
                if (o.direction !== dir) continue;
                if (Math.abs(o.progress - progress) * len < BUS_LEN_APPROX * 1.7) return false;
            }
        }
        // Dùng spatial grid để tìm xe gần (O(1) thay vì O(N))
        const nearby = this._getNearbyVehicles(x, z, 20);
        for (let i = 0; i < nearby.length; i++) {
            const o = nearby[i];
            const d = hypot2(o.collider.x - x, o.collider.z - z);
            if (d < 18) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- station
    setupStationTraffic(stationNode) {
        if (!stationNode || !stationNode.busBays || stationNode.busBays.length === 0) return;
        for (const bay of stationNode.busBays) {
            this.stationSpawnQueue.push({ transform: bay });
        }
    }

    // ------------------------------------------------- bãi đỗ: 1 slot = 1 xe
    // HAI HỆ THỐNG cùng đỗ một bãi: BusStationManager (npc.js) và queue
    // `setupStationTraffic` này. Trước đây mỗi bên chỉ nhìn danh sách của
    // MÌNH (cái này chỉ so `aiVehicles`, cái kia chỉ so `slot.occupied` của
    // một mảng copy khác) -> đo được 10/15 slot có 2 xe chồng nhau đúng một
    // vị trí. Một registry chung => mỗi slot đúng 1 xe, cả hai API giữ nguyên.
    isBayFree(x, z, r = 7) {
        const busy = this._bayBusy || [];
        for (const b of busy) if (hypot2(b.x - x, b.z - z) < r) return false;
        // Dùng spatial grid O(1)
        const nearby = this._getNearbyVehicles(x, z, r + 5);
        for (const v of nearby) {
            if (hypot2(v.collider.x - x, v.collider.z - z) < r) return false;
        }
        return true;
    }

    markBayBusy(x, z) {
        if (!this._bayBusy) this._bayBusy = [];
        this._bayBusy.push({ x, z });
    }

    processStationQueue(deltaTime) {
        if (this.stationSpawnQueue.length === 0) return;
        this.stationSpawnTimer += deltaTime;
        if (this.stationSpawnTimer < 0.2) return;
        this.stationSpawnTimer = 0;

        const req = this.stationSpawnQueue.shift();
        const tx = req.transform.x, tz = req.transform.z;
        // slot này đã có người đỗ (BusStationManager hoặc một xe khác) -> bỏ,
        // không spawn chồng lên. Trả về chứ không `continue` là đúng: shift()
        // đã lấy mất yêu cầu, mà lý do bỏ chính là "đã có xe ở đó".
        if (!this.isBayFree(tx, tz, 7)) return;
        this.markBayBusy(tx, tz);

        // Xe đỗ bến LUÔN là xe khách (BUS_DRIVER) — lấy từ pool nếu có sẵn.
        let vehicle = this._takePooledVehicle(NPC_VEHICLE_KIND.BUS, -1);
        if (!vehicle) {
            vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
            this.scene.add(vehicle.group);
        }

        const ai = new TrafficAI({
            vehicle, roadGraph: this.roadGraph, personality: 'BUS_DRIVER',
            seed: this.seed + this._nextAiId, isStatic: true
        });
        ai.id = this._nextAiId++;
        ai.vehicleKind = NPC_VEHICLE_KIND.BUS;
        ai.vehicleColorIndex = -1;
        ai.collider.x = tx;
        ai.collider.z = tz;
        ai.collider.y = req.transform.y || 0;
        // heading CỦA GENERATOR (baySlots[].heading = rot ± PI/2) khác quy ước
        // rotation.y mà TrafficAI đang dùng (`_getSegmentHeading` =
        // atan2(ux,uz)) đúng 90°. main.js:616 đã cộng `+ Math.PI/2` cho xe
        // player; đây là chỗ duy nhất quên. Hệ quả đo được: xe bãi nằm DỌC
        // hàng (AABB 8.4 x 12.9) thay vì xoay mũi vào (12.6 x 7.8), trong khi
        // khe bãi chỉ 11m cho xe dài 12.8m -> xe chồng lên nhau.
        const bayHeading = (req.transform.heading || 0) + Math.PI / 2;
        ai.heading = bayHeading;
        ai.targetHeading = bayHeading;
        ai.vehicle.group.position.set(ai.collider.x, ai.collider.y, ai.collider.z);
        ai.vehicle.group.rotation.y = bayHeading;
        ai.setActive(true);

        if (window.collisionSystem) {
            ai.colId = window.collisionSystem.register(ai.collider.x, ai.collider.z, 3.0, 'npc', { ai }, ai.collider.y, 4.0);
        }

        this.aiVehicles.push(ai);
        this.activeCount++;
        this.staticCount++;          // xe dap ben: khong tru ngan sach xe chay
    }

    // ---------------------------------------------------------------- player
    // Player không phải AI nhưng là "participant": NPC cần biết tốc độ và
    // hướng của player để nhường / không cắt mặt. Tốc độ ước đo từ quãng
    // đường mỗi frame (không đụng vào vehiclePhysics nội bộ của main.js).
    _updatePlayerActor(deltaTime) {
        const g = this.playerRef && this.playerRef.group;
        if (!g) return;
        const x = g.position.x, z = g.position.z;
        const a = this.playerActor;
        a.collider.x = x; a.collider.z = z; a.collider.y = g.position.y;
        a.heading = g.rotation.y;
        if (this._prevPlayer.valid) {
            const d = hypot2(x - this._prevPlayer.x, z - this._prevPlayer.z);
            const dt = Math.max(0.016, Math.min(deltaTime, 0.1));
            const inst = d / dt;
            const smoothed = (inst > 60 || inst < 0) ? 0 : inst;   // chống spike khi reset/spawn
            a.speed = a.speed * 0.5 + smoothed * 0.5;
        }
        this._prevPlayer.x = x; this._prevPlayer.z = z; this._prevPlayer.valid = true;
    }

    // ---------------------------------------------------------------- update
    update(deltaTime, playerPos) {
        if (!playerPos || !this.isGraphMode) return;
        this.lastPlayerPos = playerPos;
        const dt = Math.min(deltaTime, 0.1);
        this._frameNo++;                    // stamp cho các mảng reuse mỗi frame
        this._updatePlayerActor(deltaTime);
        this.processStationQueue(deltaTime);

        const baseMax = Math.max(0, Math.min(this.graphics.settings.maxActiveTraffic || 10, this.maxVehicles || 0));
        // ZONE CAP: cap dong theo khu vuc xung quanh nguoi choi — pho/QL/cao toc duoc
        // dong hon, duong lang/ruong duoc it hon (xem _updateZoneCap / _zoneCapFor).
        // No chi thay doi CUA SPAWN, khong giam so xe dang chay, khong dot FPS.
        this._updateZoneCap(deltaTime, playerPos ? playerPos.x : 0, playerPos ? playerPos.z : 0);
        const maxActive = this._zoneCapFor(baseMax);

        // SPATIAL GRID: cập nhật vị trí xe cho query O(1) trong _scan
        this._updateVehicleGrid();

        // danh sách participant (dùng lại mảng, không cấp phát mỗi frame)
        const parts = this._participants;
        parts.length = 0;
        for (let i = 0; i < this.aiVehicles.length; i++) parts.push(this.aiVehicles[i]);
        parts.push(this.playerActor);

        // index theo segment (spawn check + debug) — TÁI DÙNG MẢNG thay vì
        // clear() + cấp phát mới mỗi frame (churn GC trực tiếp nhức đầu trên
        // máy yếu). Pre-pass reset mọi arr frame cũ: segment frame trước có xe
        // mà frame này không -> phải RỖNG, không để "ghost xe" chặn spawn.
        const frameNo = this._frameNo;
        for (const a of this._bySeg.values()) {
            if (a._f !== frameNo) a.length = 0;
        }
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const ai = this.aiVehicles[i];
            const key = ai.currentSegmentId;
            if (!key) continue;
            let arr = this._bySeg.get(key);
            if (!arr) { arr = []; arr._f = frameNo; this._bySeg.set(key, arr); }
            else if (arr._f !== frameNo) { arr.length = 0; arr._f = frameNo; }
            arr.push(ai);
        }
        if (this._bySeg.size > 512) {   // key của seg xa xưa: quét lười khi to
            for (const [k, a] of this._bySeg) if (a._f !== frameNo) this._bySeg.delete(k);
        }

        for (let i = this.aiVehicles.length - 1; i >= 0; i--) {
            const ai = this.aiVehicles[i];
            if (ai.isStatic) continue;

            const dist = hypot2(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);

            // --- TRỐN HIỆN TRƯỞNG (GDCD case 1): despawn SỚM = "biến mất",
            // chạy đủ xa (0.8*spawn) hoặc hết TTL 12-18s -> xoá, không đợi
            // dead-band despawnDistance ~720m.
            if (ai.fleeing) {
                ai.fleeT -= dt;
                if (ai.fleeT <= 0 || dist > Math.max(400, this.spawnDistance * 1.2)) {
                    this._retireVehicle(i, ai);
                    continue;
                }
            }
            // --- despawn thường (dead-band: spawn max 340 < despawn >= 520) ---
            else if (dist > this.despawnDistance) {
                this._retireVehicle(i, ai);
                continue;
            }

            // --- LOD có hysteresis (không lật liên tục ở vùng chuyển) ---
            const lvl = ai.aiLevel;
            let next = lvl;
            if (lvl === 'NEAR') { if (dist > 170) next = 'MID'; }
            else if (lvl === 'MID') { if (dist < 150) next = 'NEAR'; else if (dist > 320) next = 'FAR'; }
            else { if (dist < 300) next = 'MID'; }
            if (next !== lvl) ai.setAILevel(next);

            // Throttle A* retarget: chỉ cho phép 1 xe retarget mỗi 0.5s
            // Xe không được retarget sẽ giữ goal cũ (hoặc không goal) — an toàn
            // vì _handleJunction có fallback nextSegmentToward khi không có path
            const now = performance.now();
            if (now - this._retargetThrottle > 500) {
                this._retargetThrottle = now;
                ai._canRetarget = true;
            } else {
                ai._canRetarget = false;
            }

            // Lấy chỉ xe gần cho _scan (tối ưu O(1) thay vì O(N))
            // Thêm playerActor để AI nhận diện xe người chơi
            const nearbyVehicles = this._getNearbyVehicles(ai.collider.x, ai.collider.z, LOOKAHEAD);
            nearbyVehicles.push(this.playerActor);
            ai.update(dt, playerPos, nearbyVehicles);

            if (window.collisionSystem && ai.colId) {
                window.collisionSystem.update(ai.colId, ai.collider.x, ai.collider.z, ai.collider.y);
            }
            this._checkCollision(ai);
        }

        // --- spawn từng bước (tối đa maxSpawnPerFrame/lần, không kẹt frame) ---
        // CỬA SPAWN PHẢI DÙNG SỐ XE ĐANG CHẠY, không dùng `activeCount` (đang
        // gộp cả xe đỗ trong bến). Xe `isStatic` không bao giờ despawn (vòng
        // lặp `if (ai.isStatic) continue`), nên khi chúng vượt ngưỡng thì
        // `activeCount` luôn >= maxActive -> cửa đóng vĩnh viễn, slider "Mật
        // độ NPC" mất hiệu lực và xe không còn chạy trên đường.
        let movingCount = this.activeCount - this.staticCount;
        this.spawnTimer += dt;
        if (movingCount < maxActive && this.spawnTimer >= this.spawnInterval) {
            this.spawnTimer = 0;
            for (let i = 0; i < this.maxSpawnPerFrame; i++) {
                if (movingCount >= maxActive) break;
                if (!this._spawnVehicle()) break;      // không có spot hợp lệ -> thôi
                movingCount++;                          // _spawnVehicle chỉ sinh xe chạy
            }
        }
    }

    _retireVehicle(index, ai) {
        ai.setActive(false);
        this._retireToPool(ai.vehicle, ai.vehicleKind || NPC_VEHICLE_KIND.BUS,
            ai.vehicleColorIndex != null ? ai.vehicleColorIndex : -1);
        if (window.collisionSystem && ai.colId) {
            window.collisionSystem.remove(ai.colId);
            ai.colId = -1;
        }
        this.aiVehicles.splice(index, 1);
        this.activeCount--;
        if (ai.isStatic) this.staticCount--;
    }

    // Va chạm còn sót (do spawn sai / xe tĩnh): CHỈ giảm tốc + xích lệch làn
    // trong giới hạn đường. Vị trí luôn suy ra từ làn -> không có "đẩy toạ độ".
    // QUAN TRỌNG: collider hệ thống là HÌNH TRÒN bán kính 3m (mạng lưới 50m),
    // nên 2 xe song song cách 3.5m cũng "chạm". Phải kiểm lại bằng HỘP ĐỊNH
    // HƯỚNG (dọc theo trục xe) — nếu không NPC sẽ phanh ảo khi có xe ở làn kế,
    // làm hỏng hết vụ vượt. Với STATIC (nhà/guardrail/xe bãi — Bug 8) dùng
    // _narrowOverlap() SAT thật: broad-phase hình tròn quá rộng so với khối.
    _checkCollision(ai) {
        if (!window.collisionSystem || ai.isStatic) return;
        const hit = window.collisionSystem.check(ai.collider.x, ai.collider.z, ai.collider.r, ai.colId, ['npc', 'static', 'player'], ai.collider.y, 4.0);
        if (!hit) return;

        const hx = hit.x - ai.collider.x;
        const hz = hit.z - ai.collider.z;

        if (hit.data && hit.data.ai && hit.data.ai.vehicle) {
            // Xe NPC động: 2 OBB — tâm gần nhau khi thật sự chồng. Kiểm nhanh
            // theo khung xe, giữ nguyên applyAvoidance (không đụng _uTurn).
            let ux = 1, uz = 0, rx = 0, rz = 1;
            const f = ai._frame;
            if (f) { ux = f.ux; uz = f.uz; rx = f.rx; rz = f.rz; }
            const along = Math.abs(hx * ux + hz * uz);
            const side = Math.abs(hx * rx + hz * rz);
            // Ngưỡng chồng phải theo KÍCH THƯỚC CẢ HAI XE (xe con 4.5m vs
            // xe khách 12.8m vs đầu kéo 16.5m). Dùng hằng số của xe khách
            // cho mọi loại -> xe con cach 8m phía sau cũng bị coi là "chồng"
            // -> phanh ảo hàng loạt.
            const other = hit.data.ai;
            const oLen = (other.vehLen || BUS_LEN_APPROX);
            const oWid = (other.vehWid || BUS_W_APPROX);
            const maxAlong = (ai.vehLen + oLen) * 0.5 * 0.95;
            const maxSide = (ai.vehWid + oWid) * 0.5 * 1.05;
            if (along > maxAlong || side > maxSide) return;   // không thực sự chồng
            if (ai._stuckT > 4) return;   // đang tự giải cứu: applyAvoidance sẽ giằng lại
            ai.applyAvoidance(hx, hz, 1);
            this._gdcdTryHitRun(ai);      // va chạm THẬT -> "học sinh cá biệt" có thể chạy trốn
            return;
        }

        // xe tĩnh (xe bãi) / môi trường / xe của player: hãm tới khi hết chồng
        // (không dịch toạ độ) — CHỈ khi SAT khẳng định khối thật sự chồng.
        // Player: dùng heading THẬT từ playerActor (đã refresh ngay đầu update).
        const pRot = hit.type === 'player' ? this.playerActor.heading : undefined;
        if (!_narrowOverlap(ai, hit, pRot)) return;
        ai.speed = Math.max(0, ai.speed * 0.5);
        ai.accel = Math.min(ai.accel, -2);
        this._gdcdTryHitRun(ai);          // gây tai nạn (nhà/tĩnh/player) -> "Tao không biết gì hết!"
    }

    // Va chạm THẬT vừa được narrow-phase xác nhận: nếu ai là "học sinh cá
    // biệt GDCD" tình huống 1 -> kích trốn chạy. gdcdHitRun tự chặn lặp
    // (fleeing 1 lần/đời xe) và tự no-op cho personality thường.
    _gdcdTryHitRun(ai) {
        if (ai.isStatic || ai.fleeing) return;
        ai.gdcdHitRun?.();
    }

    // Thoại NPC -> HUD (main.js gán this.onDialogue). Throttle 1.5s giữa các
    // lần để nhiều con GDCD cùng hiện không dồn thành chợ mở phiên.
    _emitDialogue(text) {
        if (!this.onDialogue) return;
        const now = performance.now();
        if (now - this._dlgT < 1500) return;
        this._dlgT = now;
        this.onDialogue(text);
    }

    // ---------------------------------------------------------------- debug
    // Ảnh chụp nhanh cho TrafficDebug (F3) — không cấp phát ngoài việc toArray.
    getDebugInfo() {
        const list = [];
        for (const ai of this.aiVehicles) {
            const m = ai.meta;
            list.push({
                id: ai.id || 0,
                isStatic: !!ai.isStatic,
                x: ai.collider.x, y: ai.collider.y, z: ai.collider.z,
                speed: ai.speed,
                speedKmh: ai.speed * 3.6,
                targetSpeed: ai.targetSpeed,
                state: ai.state,
                personality: ai.personality,
                gdcdCase: ai.gdcdCase || 0,
                fleeing: !!ai.fleeing,
                seg: ai.currentSegmentId,
                segClass: m ? m.cls : '?',
                lane: ai.lane,
                lanesPerDir: m ? m.lanesPerDir : 1,
                dir: ai.direction,
                progress: ai.progress,
                lod: ai.aiLevel,
                targetLane: ai.lc ? ai.lc.targetLane : 0,
                lcPhase: ai.lc ? ai.lc.phase : 'IDLE',
                stopPhase: ai.stop ? ai.stop.phase : 'IDLE',
                leaderGap: ai.scan ? ai.scan.leaderGap : Infinity,
                ttc: ai.scan ? ai.scan.ttc : Infinity,
                rearGap: ai.scan ? ai.scan.rearGap : Infinity,
                laneOffset: ai.laneOffset,
                goal: ai.goalNodeId,
                routeLen: ai.pathNodes ? ai.pathNodes.length : 0
            });
        }
        return {
            active: this.activeCount,
            max: Math.max(0, Math.min(this.graphics.settings.maxActiveTraffic || 10, this.maxVehicles || 0)),
            moving: this.activeCount - this.staticCount,
            spawnDistance: this.spawnDistance,
            despawnDistance: this.despawnDistance,
            pooled: this.pool.length,
            list
        };
    }

    // Số xe đang chạy (npc.js getMovingVehicleCount ủy quyền về đây)
    getMovingCount() {
        let n = 0;
        for (const ai of this.aiVehicles) if (!ai.isStatic) n++;
        return n;
    }

    getActiveVehicles() {
        return this.aiVehicles.filter(ai => ai.active);
    }

    dispose() {
        this.aiVehicles.forEach(ai => {
            if (window.collisionSystem && ai.colId) window.collisionSystem.remove(ai.colId);
            ai.dispose();
        });
        this.aiVehicles = [];
        this.pool = [];
        this._bySeg.clear();
        this._vehicleGrid.clear();
        this.activeCount = 0;
        this.staticCount = 0;
    }

    // SPATIAL GRID: cập nhật vị trí xe vào grid 100m — TÁI DÙNG MẢNG (stamp _f)
    // thay vì clear() + cấp phát mới mỗi frame. Pre-pass reset các cell frame
    // cũ: cell frame trước có xe mà frame này không -> phải RỖNG, không để
    // "ghost xe" trong query trên trục cạnh. Grid chỉ bị ĐỌC (copy sang mảng
    // out riêng trong _getNearbyVehicles) trong cùng frame, không giữ tham
    // chiếu qua đêm -> an toàn khi tái sử dụng.
    _updateVehicleGrid() {
        const frameNo = this._frameNo;
        for (const a of this._vehicleGrid.values()) {
            if (a._f !== frameNo) a.length = 0;
        }
        const cellSize = this._vehicleGridCellSize;
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const ai = this.aiVehicles[i];
            if (!ai.active || !ai.collider) continue;
            const cx = Math.floor(ai.collider.x / cellSize);
            const cz = Math.floor(ai.collider.z / cellSize);
            const key = cx + ',' + cz;
            let arr = this._vehicleGrid.get(key);
            if (!arr) { arr = []; arr._f = frameNo; this._vehicleGrid.set(key, arr); }
            else if (arr._f !== frameNo) { arr.length = 0; arr._f = frameNo; }
            arr.push(ai);
        }
        if (this._vehicleGrid.size > 1024) {   // cell lái qua lâu rồi: quét lười
            for (const [k, a] of this._vehicleGrid) if (a._f !== frameNo) this._vehicleGrid.delete(k);
        }
    }

    // Lấy xe trong bán kính (O(1) query qua grid)
    _getNearbyVehicles(x, z, radius) {
        const cellSize = this._vehicleGridCellSize;
        const rCells = Math.ceil(radius / cellSize);
        const cx0 = Math.floor(x / cellSize);
        const cz0 = Math.floor(z / cellSize);
        const out = [];
        for (let dx = -rCells; dx <= rCells; dx++) {
            for (let dz = -rCells; dz <= rCells; dz++) {
                const key = (cx0 + dx) + ',' + (cz0 + dz);
                const arr = this._vehicleGrid.get(key);
                if (arr) out.push(...arr);
            }
        }
        return out;
    }
}

export function createTrafficManager(options) {
    return new TrafficManager(options);
}
