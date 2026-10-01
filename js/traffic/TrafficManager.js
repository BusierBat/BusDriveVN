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
import { TrafficAI } from "./TrafficAI.js";
import { getGraphicsSettings } from "./GraphicsSettings.js";
import { createSeededRandom, clamp } from "../utils.js";

const BUS_LEN_APPROX = 12.8;   // xe NPC dùng chung mesh bus (bus.js BUS_DIMENSIONS)
const BUS_W_APPROX = 2.53;

// Phân bố nhân cách (VN: phần lớn bình thường, thỉnh thoảng có ông thần)
const PERSONALITY_TABLE = [
    { p: 'CAUTIOUS', w: 0.18 },
    { p: 'NORMAL', w: 0.45 },
    { p: 'FAST', w: 0.17 },
    { p: 'AGGRESSIVE', w: 0.10 },
    { p: 'BUS_DRIVER', w: 0.10 }
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

        this._bySeg = new Map();      // segId -> AI[] (cập nhật mỗi frame)
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
        return Math.hypot(t.x - f.x, t.z - f.z) > 12;
    }

    _densityOf(s) {
        if (!s) return 0;
        const meta = (this.roadGraph.getLaneMeta) ? this.roadGraph.getLaneMeta(s) : null;
        return meta ? meta.density : 0.4;
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

            const distPlayer = Math.hypot(x - px, z - pz);
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

        let vehicle = this.pool.pop();
        if (!vehicle) {
            vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
            this.scene.add(vehicle.group);
        }

        const ai = new TrafficAI({
            vehicle, roadGraph: this.roadGraph,
            personality: this._pickPersonality(),
            seed: this.seed + this._nextAiId
        });
        ai.id = this._nextAiId++;
        if (!ai.placeOnSegment(candidate.seg.id, candidate.dir, candidate.progress, null)) {
            this.pool.push(vehicle);          // không đặt được lên đường -> trả pool
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

    // Kiểm tra khoảng trống tại điểm spawn: cùng đoạn theo TRỤC ĐƯỜNG
    // (chồng đầu-đuôi) + Euclidean với mọi xe quanh.
    _spawnSpotFree(segId, dir, progress, x, z) {
        const sameSeg = this._bySeg.get(segId);
        if (sameSeg && sameSeg.length) {
            const seg = this.roadGraph.getSegment(segId);
            const f = seg ? this.roadGraph.getNode(seg.from) : null;
            const t = seg ? this.roadGraph.getNode(seg.to) : null;
            const len = (f && t) ? Math.hypot(t.x - f.x, t.z - f.z) : 100;
            for (const o of sameSeg) {
                if (o.direction !== dir) continue;
                if (Math.abs(o.progress - progress) * len < BUS_LEN_APPROX * 1.7) return false;
            }
        }
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const o = this.aiVehicles[i];
            const d = Math.hypot(o.collider.x - x, o.collider.z - z);
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
        for (const b of busy) if (Math.hypot(b.x - x, b.z - z) < r) return false;
        for (const v of this.aiVehicles) {
            if (Math.hypot(v.collider.x - x, v.collider.z - z) < r) return false;
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

        let vehicle = this.pool.pop();
        if (!vehicle) {
            vehicle = createNpcBus({ skinPath: pickNpcSkinPath(), ledColor: pickLedColor() });
            this.scene.add(vehicle.group);
        }

        const ai = new TrafficAI({
            vehicle, roadGraph: this.roadGraph, personality: 'BUS_DRIVER',
            seed: this.seed + this._nextAiId, isStatic: true
        });
        ai.id = this._nextAiId++;
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
            const d = Math.hypot(x - this._prevPlayer.x, z - this._prevPlayer.z);
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
        this._updatePlayerActor(deltaTime);
        this.processStationQueue(deltaTime);

        const maxActive = Math.max(0, Math.min(this.graphics.settings.maxActiveTraffic || 10, this.maxVehicles || 0));

        // danh sách participant (dùng lại mảng, không cấp phát mỗi frame)
        const parts = this._participants;
        parts.length = 0;
        for (let i = 0; i < this.aiVehicles.length; i++) parts.push(this.aiVehicles[i]);
        parts.push(this.playerActor);

        // index theo segment (spawn check + debug)
        this._bySeg.clear();
        for (let i = 0; i < this.aiVehicles.length; i++) {
            const ai = this.aiVehicles[i];
            const key = ai.currentSegmentId;
            if (!key) continue;
            let arr = this._bySeg.get(key);
            if (!arr) { arr = []; this._bySeg.set(key, arr); }
            arr.push(ai);
        }

        for (let i = this.aiVehicles.length - 1; i >= 0; i--) {
            const ai = this.aiVehicles[i];
            if (ai.isStatic) continue;

            const dist = Math.hypot(ai.collider.x - playerPos.x, ai.collider.z - playerPos.z);

            // --- despawn (dead-band: spawn max 340 < despawn >= 520) ---
            if (dist > this.despawnDistance) {
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

            ai.update(dt, playerPos, parts);

            if (window.collisionSystem && ai.colId) {
                window.collisionSystem.update(ai.colId, ai.collider.x, ai.collider.z, ai.collider.y);
            }
            this._checkCollision(ai);
        }

        // --- spawn từng bước (tối đa maxSpawnPerFrame/lần, không kẹt frame) ---
        this.spawnTimer += dt;
        if (this.activeCount < maxActive && this.spawnTimer >= this.spawnInterval) {
            this.spawnTimer = 0;
            for (let i = 0; i < this.maxSpawnPerFrame; i++) {
                if (this.activeCount >= maxActive) break;
                if (!this._spawnVehicle()) break;      // không có spot hợp lệ -> thôi
            }
        }
    }

    _retireVehicle(index, ai) {
        ai.setActive(false);
        this.pool.push(ai.vehicle);
        if (window.collisionSystem && ai.colId) {
            window.collisionSystem.remove(ai.colId);
            ai.colId = -1;
        }
        this.aiVehicles.splice(index, 1);
        this.activeCount--;
    }

    // Va chạm còn sót (do spawn sai / xe tĩnh): CHỈ giảm tốc + xích lệch làn
    // trong giới hạn đường. Vị trí luôn suy ra từ làn -> không có "đẩy toạ độ".
    // QUAN TRỌNG: collider hệ thống là HÌNH TRÒN bán kính 3m (mạng lưới 50m),
    // nên 2 xe song song cách 3.5m cũng "chạm". Phải kiểm lại bằng HỘP ĐỊNH
    // HƯỚNG (dọc theo trục xe) — nếu không NPC sẽ phanh ảo khi có xe ở làn kế,
    // làm hỏng hết vụ vượt.
    _checkCollision(ai) {
        if (!window.collisionSystem || ai.isStatic) return;
        const hit = window.collisionSystem.check(ai.collider.x, ai.collider.z, ai.collider.r, ai.colId, ['npc', 'static', 'player'], ai.collider.y, 4.0);
        if (!hit) return;

        const hx = hit.x - ai.collider.x;
        const hz = hit.z - ai.collider.z;
        let ux = 1, uz = 0, rx = 0, rz = 1;
        const f = ai._frame;
        if (f) { ux = f.ux; uz = f.uz; rx = f.rx; rz = f.rz; }
        const along = Math.abs(hx * ux + hz * uz);
        const side = Math.abs(hx * rx + hz * rz);
        if (along > BUS_LEN_APPROX * 0.95 || side > BUS_W_APPROX * 1.05) return;   // không thực sự chồng

        if (hit.data && hit.data.ai) {
            // Đang tự giải cứu xe chồng nhau (_stuckT): applyAvoidance sẽ xích
            // target lệch rồi bị re-center giằng lại -> xe bị GHIM ở một bên,
            // không tách ra được. Bỏ qua để escape tự xử lý.
            if (ai._stuckT > 4) return;
            ai.applyAvoidance(hx, hz, 1);
        } else {
            // xe tĩnh / xe của player: hãm tới khi hết chồng (không dịch toạ độ)
            ai.speed = Math.max(0, ai.speed * 0.5);
            ai.accel = Math.min(ai.accel, -2);
        }
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
            moving: this.activeCount - this.aiVehicles.filter(a => a.isStatic).length,
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
        this.activeCount = 0;
    }
}

export function createTrafficManager(options) {
    return new TrafficManager(options);
}
