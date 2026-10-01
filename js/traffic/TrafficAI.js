// js/traffic/TrafficAI.js
// =====================================================================
// AI giao thông NPC — lane-aware, đi bên phải, không xuyên xe.
// NGUYÊN TẮC CỐT LÕI
//  - Lateral: lane 0 = làn ngoài cùng BÊN PHẢI hướng di chuyển (VN đi bên
//    phải). Mọi offset tính theo vector PHẢI của hướng đi (rx,rz)=(-uz,ux)
//    offset áp theo vector (cos,-sin)=PHẢI nhưng `_getLaneOffset` đảo dấu
//    theo direction -> direction 0 lái tay trái, 2 chiều chạy cùng một bên).
//  - Longitudinal: IDM (Intelligent Driver Model). Khoảng cách theo vận
//    tốc TƯƠNG ĐỐI + TTC -> không xuyên xe; xe đứng trong kẹt xe vẫn đứng
//    (không ai teleport).
//  - Đổi làn/vượt: FSM CHECK (trước + sau + TTC + không gần ngã) ->
//    COMMIT -> COMPLETE, có cooldown/hysteresis -> không lắc lư trái-phải.
//  - Tấp lề: PULL_OVER -> PARKED (~20s) -> MERGE_CHECK (chờ khe an toàn,
//    KHÔNG bao giờ lao ra khi bị chặn) -> MERGE_IN. Không teleport.
//  - Personality + hành vi VN "không hoàn hảo nhưng tin được" theo xác
//    suất, luôn nằm trong giới hạn vật lý.
//  - LOD (NEAR/MID/FAR) chỉ giảm TẦN SUẤT RA QUYẾT ĐỊNH; DI CHUYỂN luôn
//    tích phân mỗi frame -> xe ở xa không đóng băng, không pop.
// API GIỮ NGUYÊN: constructor, setActive, setAILevel, setGoal,
// update, dispose, collider, laneOffset, targetLaneOffset,
// currentSegmentId, direction, progress, heading, AI_STATE.
// =====================================================================
import * as THREE from "three";
import { createSeededRandom, lerpAngle, clamp } from "../utils.js";
import { deriveLaneMeta } from "../RuntimeRoadGraph.js";
import { BUS_DIMENSIONS } from "../bus.js";

const TWO_PI = Math.PI * 2;
const BUS_LEN = (BUS_DIMENSIONS && BUS_DIMENSIONS.length) || 12.8;
const BUS_W = (BUS_DIMENSIONS && BUS_DIMENSIONS.width) || 2.5;
const HALF_LEN = BUS_LEN * 0.5;
const HALF_W = BUS_W * 0.5;

const LOOKAHEAD = 90;        // m: quét xe quanh xe (trước + sau)
const EMERGENCY_TTC = 0.8;   // s: TTC dưới mức này -> phanh khẩn cấp
// Nhường ngã tư: xe khác KHÁC chiều trong bán kính này quanh node đầu đoạn
// -> xe mình dừng ở vạch cách node JUNCTION_STOP_M. Đường vượt tầng (chênh
// cao độ > JUNCTION_Y_EPS) KHÔNG tính — không phải giao cắt mặt phẳng.
const JUNCTION_BOX = 10;
const JUNCTION_STOP_M = 8;
const JUNCTION_Y_EPS = 3;
const YIELD_TIMEOUT = 8;     // s: chờ nhường quá lâu -> xe kia bị kẹt, mình đi
const ENTRY_WAIT_MAX = 5;    // s: chờ cửa ra segment mới bị xe chiếm quá lâu -> vào anyway
const DECIDE_NEAR = 1 / 30;  // s: ra quyết định mỗi frame ở cự ly gần
const DECIDE_MID = 1 / 12;
const DECIDE_FAR = 1 / 4;

// Nhân cách tài xế. Đơn vị: m, m/s, s.
//   speedFactor      : hệ số trên tốc độ giới hạn của đoạn đường
//   followingDistance: s0 — khoảng cách tối thiểu (bumper) theo mét
//   timeGap          : T — headway theo giây (khoảng cách tăng theo tốc độ)
//   overtakeChance   : xác suất mỗi giây được CÂN NHẮC vượt
//   laneChangeAggro  : 0..1 — cắt giảm khoảng cách cần cho đổi làn
//   recklessChance   : xác suất hành vi VN "hơi thiếu chuẩn" (vẫn hợp lý)
//   roadsideStopChance: xác suất mỗi giây được CÂN NHẮC tấp lề
const DRIVER_TYPES = {
    CAUTIOUS: { speedFactor: 0.80, followingDistance: 14, timeGap: 1.3, acceleration: 2.4, deceleration: 5.5, emergencyDecel: 8.0, reactionTime: 0.45, overtakeChance: 0.05, laneChangeAggro: 0.15, recklessChance: 0.02, roadsideStopChance: 0.006, yieldProbability: 0.9, isBus: false },
    NORMAL: { speedFactor: 0.95, followingDistance: 10, timeGap: 1.1, acceleration: 3.2, deceleration: 6.0, emergencyDecel: 9.0, reactionTime: 0.30, overtakeChance: 0.15, laneChangeAggro: 0.40, recklessChance: 0.06, roadsideStopChance: 0.004, yieldProbability: 0.5, isBus: false },
    FAST: { speedFactor: 1.08, followingDistance: 7, timeGap: 0.95, acceleration: 4.5, deceleration: 7.0, emergencyDecel: 10.0, reactionTime: 0.22, overtakeChance: 0.40, laneChangeAggro: 0.65, recklessChance: 0.15, roadsideStopChance: 0.002, yieldProbability: 0.25, isBus: false },
    AGGRESSIVE: { speedFactor: 1.15, followingDistance: 5, timeGap: 0.85, acceleration: 5.5, deceleration: 8.0, emergencyDecel: 11.0, reactionTime: 0.18, overtakeChance: 0.60, laneChangeAggro: 0.85, recklessChance: 0.28, roadsideStopChance: 0.001, yieldProbability: 0.2, isBus: false },
    BUS_DRIVER: { speedFactor: 0.88, followingDistance: 12, timeGap: 1.2, acceleration: 2.6, deceleration: 5.5, emergencyDecel: 9.0, reactionTime: 0.32, overtakeChance: 0.10, laneChangeAggro: 0.30, recklessChance: 0.05, roadsideStopChance: 0.012, yieldProbability: 0.7, isBus: true, busStopProbability: 0.3 }
};
// Tên cũ (CAREFUL) vẫn chạy được — TrafficManager/ngoài kia có thể gọi tới.
DRIVER_TYPES.CAREFUL = DRIVER_TYPES.CAUTIOUS;

export const AI_STATE = {
    // Bộ trạng thái chính
    CRUISING: 'CRUISING', FOLLOWING: 'FOLLOWING', BRAKING: 'BRAKING',
    ACCELERATING: 'ACCELERATING', OVERTAKING: 'OVERTAKING',
    LANE_CHANGING: 'LANE_CHANGING', STOPPING: 'STOPPING', MERGING: 'MERGING',
    EMERGENCY_BRAKING: 'EMERGENCY_BRAKING',
    // Trạng thái phụ
    PARKED: 'PARKED', TURNING: 'TURNING', YIELDING: 'YIELDING',
    STOPPED: 'STOPPED', RECOVERING: 'RECOVERING',
    // Alias cũ (API đọc ngoài: AI_STATE.DRIVING / SLOWING / ...) trỏ về tên mới
    DRIVING: 'CRUISING', SLOWING: 'ACCELERATING', CHANGING_LANE: 'LANE_CHANGING',
    BUS_STOPPING: 'STOPPING', BUS_MERGING: 'MERGING'
};

export class TrafficAI {
    constructor({ vehicle, roadGraph, personality = 'NORMAL', seed = null, isStatic = false, isParked = false, parkTimer = 0 }) {
        this.vehicle = vehicle;
        this.roadGraph = roadGraph;
        this.seed = seed || Math.random() * 999999;
        this.random = createSeededRandom(this.seed);

        const base = DRIVER_TYPES[personality] || DRIVER_TYPES.NORMAL;
        const variance = 0.9 + this.random() * 0.2;   // mỗi tài xế 1 kiểu
        this.personality = DRIVER_TYPES[personality] ? personality : 'NORMAL';
        this.profile = {
            speedFactor: base.speedFactor * variance,
            followingDistance: base.followingDistance * (0.9 + this.random() * 0.2),
            timeGap: base.timeGap,
            acceleration: base.acceleration * (0.95 + this.random() * 0.1),
            deceleration: base.deceleration,
            emergencyDecel: base.emergencyDecel,
            reactionTime: base.reactionTime * (0.85 + this.random() * 0.3),
            overtakeChance: base.overtakeChance,
            laneChangeAggro: base.laneChangeAggro,
            recklessChance: base.recklessChance,
            roadsideStopChance: base.roadsideStopChance,
            yieldProbability: base.yieldProbability,
            isBus: base.isBus,
            busStopProbability: base.busStopProbability || 0
        };

        this.isStatic = isStatic;
        this.state = isParked ? AI_STATE.PARKED : AI_STATE.CRUISING;
        this.parkTimer = parkTimer;
        this.speed = 0;
        this.targetSpeed = 0;        // v0 mong muốn (m/s)
        this.accel = 0;              // gia tốc hiện tại (m/s^2)
        this.heading = 0;
        this.targetHeading = 0;
        this.oldHeading = 0;
        this.laneOffset = 0;         // khoảng cách từ tâm đường về PHẢI hướng đi (m)
        this.targetLaneOffset = 0;
        this.lane = 0;               // chỉ số làn (0 = ngoài cùng bên phải)
        this.currentSegmentId = null;
        this.direction = 0;
        this.progress = 0;
        // Sàn progress: khi sang đoạn mới, phân rã lại toạ độ có thể ra tiến
        // ÂM (xe chưa vượt hết node trong khung mới) — không cho clamp(0) nuốt
        // mất phần đó (nuốt là vị trí nhảy cóc). Tự về 0 khi progress >= 0.
        this._progFloor = 0;
        this.turning = false;
        this.turnTimer = 0;
        this.followTarget = null;    // xe dẫn đường (debug/compat)
        this.overtakeTarget = null;
        this.busStopNode = null;
        this.busStopTimer = 0;
        this.reactTimer = 0;        // phản xạ trễ khi phanh (dùng trong _decide/_updateAccel)

        this.collider = { x: 0, y: 0.5, z: 0, r: HALF_W + 0.6 };
        this.active = true;
        this.colId = -1;
        this.aiLevel = 'NEAR';
        this.updateInterval = DECIDE_NEAR;
        this.decTimer = 0;
        this.lastUpdateTime = 0;

        this.pathNodes = [];
        this.currentPathIndex = 0;
        this.goalNodeId = null;      // rule 57: xe luôn có đích để A* nối đường

        // --- FSM đổi làn (REQUEST/CHECK/COMMIT/COMPLETE + cooldown) ---
        this.lc = { phase: 'IDLE', kind: null, targetLane: 0, target: null, timer: 0, badT: 0, holdTimer: 0, cooldown: 0 };
        this.overtakeCooldown = 0;
        this._emergencyTimer = 0;
        // --- FSM tấp lề (PULL_OVER/PARKED/MERGE_CHECK/MERGE_IN) ---
        this.stop = { phase: 'IDLE', timer: 0, hold: 0, offset: 0 };
        // --- Hành vi VN theo xác suất (traffic memory: cooldown thật) ---
        this.vn = { tailgateTimer: 0, boostTimer: 0 };
        this._brakePending = false;
        this._lastVehicles = null;
        this._frame = null;
        this._frameSegId = null;
        this._frameDir = -1;
        this.meta = null;
        this._pathFails = 0;
        this._recoverCount = 0;
        this._yieldTimer = 0;      // thời gian chờ nhường ngã tư liên tục (s)
        this._stuckT = 0;          // thời gian xe chồng nhau/leaderGap<0 liên tục (s)
        this._stuckCreep = false;  // đang "trườn ra" giải cứu kẹt cùng chiều
        this._entryWait = 0;       // thời gian chờ cửa ra segment mới bị chiếm (s)

        // kết quả quét giao thông (dùng cho AI + debug, không cấp phát mới/frame)
        this.scan = {
            leader: null, leaderGap: Infinity, leaderSpeed: 0,
            rear: null, rearGap: Infinity, rearSpeed: 0,
            candFrontGap: Infinity, candFrontSpeed: 0,
            candRearGap: Infinity, candRearSpeed: 0,
            nearestFrontGap: Infinity, ttc: Infinity, junctionBlocked: false
        };
        this._scanLane = -1;

        if (!isStatic && !isParked) { this._initPosition(); this._retarget(); }
        if (isParked) { this.speed = 0; this.targetSpeed = 0; }
    }

    _getSegment(id) { return this.roadGraph.getSegment(id); }
    _getNode(id) { return this.roadGraph.getNode(id); }

    // ---------------------------------------------------------- metadata
    _refreshMeta() {
        const seg = this._getSegment(this.currentSegmentId);
        let meta = null;
        if (seg && this.roadGraph.getLaneMeta) meta = this.roadGraph.getLaneMeta(seg);
        if (!meta && seg) meta = deriveLaneMeta(seg);
        this.meta = meta;
        if (meta) {
            this.lane = clamp(this.lane | 0, 0, meta.lanesPerDir - 1);
            this.targetLaneOffset = clamp(this.targetLaneOffset, this._minOffset(), this._maxOffset());
        }
        return meta;
    }

    // Giới hạn offset để không vượt mép đường và KHÔNG LỌT QUA ĐƯỜNG
    // TRỤNG (hai chiều: tâm đường = 0, xe không được có offset âm).
    _minOffset() { return 0.15; }
    _maxOffset() {
        if (!this.meta) return 6;
        return Math.max(this._minOffset(), this.meta.half - HALF_W * 0.9);
    }

    _laneCenter(lane) {
        if (!this.meta) return 1.75;
        return clamp(this.meta.laneCenter(lane), this._minOffset(), this._maxOffset());
    }

    // ---------------------------------------------------------- hình học
    // Khung toạ độ của đoạn hiện tại: p0 -> p1 theo `direction`,
    // u = đơn vị hướng đi, r = vector PHẢI (-uz, ux).
    _updateFrame() {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) { this._frame = null; return false; }
        const a = this._getNode(this.direction === 0 ? seg.from : seg.to);
        const b = this._getNode(this.direction === 0 ? seg.to : seg.from);
        if (!a || !b) { this._frame = null; return false; }
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (!(len > 0.5)) { this._frame = null; return false; }
        const ux = dx / len, uz = dz / len;
        this._frame = { seg, p0: a, p1: b, len, ux, uz, rx: -uz, rz: ux };
        this._frameSegId = this.currentSegmentId;
        this._frameDir = this.direction;
        if (!this.meta || this.meta.seg !== seg) this._refreshMeta();
        return true;
    }

    _getSegmentPoints() {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) return null;
        const f = this._getNode(seg.from);
        const t = this._getNode(seg.to);
        if (!f || !t) return null;
        return this.direction === 0 ? { p0: f, p1: t } : { p0: t, p1: f };
    }

    _getSegmentHeading() {
        const f = this._frame;
        if (f) return Math.atan2(f.ux, f.uz);
        const pts = this._getSegmentPoints();
        if (!pts) return 0;
        return Math.atan2(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z);
    }

    // Đặt vị trí trên đường theo làn PHẢI (lane 0 = sát lề phải).
    _updatePositionFromSegment() {
        const f = this._frame;
        if (!f) return;
        const t = clamp(this.progress, Math.min(this._progFloor, 0), 1);
        const cx = f.p0.x + f.ux * (t * f.len);
        const cz = f.p0.z + f.uz * (t * f.len);
        const cy = f.p0.y + (f.p1.y - f.p0.y) * t;
        this.collider.x = cx + f.rx * this.laneOffset;
        this.collider.z = cz + f.rz * this.laneOffset;
        this.collider.y = cy + 0.5;
    }

    // API cũ (dir không còn đổi dấu nữa — vector PHẢI đã mang dấu theo hướng đi).
    _getLaneOffset(seg, dir, laneIndex) {
        const meta = (seg && seg === (this.meta && this.meta.seg)) ? this.meta
            : (this.roadGraph.getLaneMeta ? this.roadGraph.getLaneMeta(seg) : null) || deriveLaneMeta(seg);
        if (!meta) return (laneIndex + 0.5) * 3.5;
        return meta.laneCenter(laneIndex);
    }
    _getRightLaneOffset(seg, dir) { return this._getLaneOffset(seg, dir, 0); }
    _getLeftLaneOffset(seg, dir) { return this._getLaneOffset(seg, dir, 1); }
    _hasMultipleLanes(seg) {
        const meta = (this.meta && this.meta.seg === seg) ? this.meta : deriveLaneMeta(seg);
        return meta ? meta.lanesPerDir >= 2 : false;
    }
    _isLaneChangeComplete(targetOffset) { return Math.abs(this.laneOffset - targetOffset) < 0.1; }

    // ---------------------------------------------------------- spawn
    _initPosition() {
        if (!this.roadGraph.segments?.length) return;
        const validSegs = this.roadGraph.segments.filter(s => s.type !== 'tunnel' && s.type !== 'bus_station_road');
        const seg = validSegs[Math.floor(this.random() * validSegs.length)] || this.roadGraph.segments[0];
        this.direction = seg.twoWay ? Math.floor(this.random() * 2) : 0;
        this.placeOnSegment(seg.id, this.direction, 0.1 + this.random() * 0.3, null);
    }

    // Đặt xe lên đoạn đường theo làn 0 (phải). speed = null -> suy từ meta.
    placeOnSegment(segId, dir, progress, speed) {
        this.currentSegmentId = segId;
        this.direction = dir;
        this.progress = clamp(progress, 0.001, 0.999);
        this.lane = 0;
        if (!this._updateFrame()) return false;
        const meta = this.meta;
        this.laneOffset = this._laneCenter(0);
        this.targetLaneOffset = this.laneOffset;
        this.speed = (speed === null || speed === undefined)
            ? (meta ? meta.speedMs * (0.65 + this.random() * 0.3) : 8)
            : Math.max(0, speed);
        this.targetSpeed = this.speed;
        this.accel = 0;
        this.heading = this._getSegmentHeading();
        this.targetHeading = this.heading;
        this.oldHeading = this.heading;
        this.turning = false;
        this.turnTimer = 0;
        this.lc.phase = 'IDLE'; this.lc.kind = null; this.lc.cooldown = 0;
        this.stop.phase = 'IDLE'; this.stop.hold = 0;
        this.pathNodes = []; this.currentPathIndex = 0; this._pathFails = 0;
        this._updatePositionFromSegment();
        this._updateVehicle();
        return true;
    }

    // ---------------------------------------------------------- quét xe
    // Một vòng quét duy nhất cho cả leader/rear/làn đích. O(N), không
    // raycast, không cấp phát bộ nhớ (mảng kết quả dùng lại).
    _scan(allVehicles) {
        const s = this.scan;
        s.leader = null; s.leaderGap = Infinity; s.leaderSpeed = 0;
        s.rear = null; s.rearGap = Infinity; s.rearSpeed = 0;
        s.candFrontGap = Infinity; s.candFrontSpeed = 0;
        s.candRearGap = Infinity; s.candRearSpeed = 0;
        s.nearestFrontGap = Infinity; s.ttc = Infinity;
        const f = this._frame;
        if (!f || !allVehicles || !allVehicles.length) {
            this.followTarget = null; this.scan.junctionBlocked = false; return s;
        }

        const meta = this.meta;
        const laneW = meta ? meta.laneW : 3.5;
        const sameLat = laneW * 0.6;                       // cùng làn
        // Cửa cứng = tổng bề rộng xe + 0.3m: xe LÁT qua làn mình, xe cản
        // ở làn kế (cách 3.5m) KHÔNG bị coi là xe dẫn -> vượt mới làm được.
        const hardLat = BUS_W + 0.3;
        const candLat = laneW * 0.6;
        const mine = this.laneOffset;
        const candCenter = (this._scanLane >= 0 && meta) ? meta.laneCenter(this._scanLane) : null;
        const ux = f.ux, uz = f.uz, rx = f.rx, rz = f.rz;
        const look2 = LOOKAHEAD * LOOKAHEAD;

        // --- nhường ngã tư: node sắp tới của đoạn này ---
        // Xe KHÁC ĐƯỜNG (ngược chiều, hoặc cùng chiều nhưng trên đoạn KHÁC =
        // nhánh rẽ/cắt/merge) đang đứng trong hộp ngã (≤ JUNCTION_BOX quanh
        // node) -> mình coi như có vật cản đứng yên ở vạch dừng (cách node
        // JUNCTION_STOP_M). Xe CÙNG đoạn cùng chiều = xe dẫn theo đúng đường
        // mình, IDM lo. Xe trong hộp LUÔN thắng xe còn ở ngoài vạch.
        const nodeX = f.p1.x, nodeZ = f.p1.z;
        const distToEnd = f.len - this.progress * f.len;    // tâm xe -> node
        const checkJunction = distToEnd < LOOKAHEAD;
        const box2 = JUNCTION_BOX * JUNCTION_BOX;
        const myY = this.collider.y;
        let junctionBlock = false;
        s.junctionBlocked = false;

        for (let i = 0; i < allVehicles.length; i++) {
            const o = allVehicles[i];
            if (!o || o === this || !o.collider) continue;
            const dx = o.collider.x - this.collider.x;
            const dz = o.collider.z - this.collider.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > look2) continue;
            const t = dx * ux + dz * uz;              // >0: trước mặt, <0: sau lưng
            const lat = dx * rx + dz * rz;            // lệch ngang tương đối
            const oCenter = mine + lat;               // khoảng cách tâm đường của xe kia
            const latDiff = Math.abs(oCenter - mine);
            const oSpeed = o.speed || 0;
            const sameDir = (typeof o.heading !== 'number') ? true
                : (Math.sin(o.heading) * ux + Math.cos(o.heading) * uz) > 0.1;

            if (checkJunction && t > 0 &&
                (!sameDir || o.currentSegmentId !== this.currentSegmentId) &&
                Math.abs(o.collider.y - myY) < JUNCTION_Y_EPS) {
                const dnx = o.collider.x - nodeX, dnz = o.collider.z - nodeZ;
                const dn2 = dnx * dnx + dnz * dnz;
                if (dn2 <= box2) {
                    const oD = Math.sqrt(dn2);
                    let pri;
                    if (distToEnd > JUNCTION_STOP_M - 2) {
                        // Mình còn ở NGOÀI vạch mà đã có xe khác đường trong
                        // hộp -> nhường (xe trong hộp = xe ĐÃ vào trước).
                        pri = 1;
                    } else if (oD < distToEnd - 0.5) pri = 1;    // cả 2 đều trong vùng: xe gần tâm hơn
                    else if (distToEnd < oD - 0.5) pri = 0;
                    else {                                          // sát nút: đúng 1 xe nhường
                        const kO = o.id != null ? o.id : 0;
                        const kM = this.id != null ? this.id : 0;
                        pri = (kO !== kM) ? (kO < kM ? 1 : 0)
                            : (oSpeed > this.speed + 0.05 ? 1 : 0);
                    }
                    if (pri) junctionBlock = true;
                }
            }

            if (t > 0) {
                const gap = t - BUS_LEN;              // khoảng cách bumper->bumper
                if (gap < s.nearestFrontGap) s.nearestFrontGap = gap;
                const inLane = latDiff < sameLat && sameDir;
                const hard = latDiff < hardLat && gap < 20;     // lấn làn / ngược chiều / player
                // Xe đang ở LÀN MÌH SẮP VỀ (offset mình còn dịch dở qua ngã
                // hay đang đổi làn): nó trên đường đi của mình dù chưa cùng
                // laneOffset thật. Không có gate này, xe vừa rẽ vào (offset
                // theo trục cũ) MÙ leader ở ngay trước đầu -> IDM không phanh
                // -> đè đuôi xe đang đứng trên làn đích.
                const inTargetLane = sameDir &&
                    Math.abs(oCenter - this.targetLaneOffset) < sameLat;
                if ((inLane || inTargetLane || hard) && gap < s.leaderGap) {
                    s.leader = o; s.leaderGap = Math.max(gap, -BUS_LEN);
                    // Xe ngược chiều tiệm cận với vận tốc RELATIVE = v_mình +
                    // |v_nó|. IDM tính dv = v - leaderSpeed -> phải để SỐ ÂM
                    // (đang lái vào mặt nhau), nếu không sẽ trừ ngược ra
                    // v - |vo| = phanh thiếu, lao chồng lên nhau rồi kẹt.
                    s.leaderSpeed = sameDir ? oSpeed : -oSpeed;
                }
                if (candCenter !== null && Math.abs(oCenter - candCenter) < candLat && gap < s.candFrontGap) {
                    s.candFrontGap = gap; s.candFrontSpeed = oSpeed;
                }
            } else {
                const gapBack = -t - BUS_LEN;
                if (latDiff < sameLat && sameDir && gapBack < s.rearGap) {
                    s.rear = o; s.rearGap = gapBack; s.rearSpeed = oSpeed;
                }
                if (candCenter !== null && Math.abs(oCenter - candCenter) < candLat && gapBack < s.candRearGap) {
                    s.candRearGap = gapBack; s.candRearSpeed = oSpeed;
                }
            }
        }
        // Vật cản ảo ở vạch dừng: ghi đè gap nếu nó gần hơn xe dẫn thật.
        if (junctionBlock) {
            // Chốt liveness: chờ nhường quá YIELD_TIMEOUT -> xe trong hộp đang
            // bị kẹt (chờ hàng của nó), không việc gì mình đứng chết đạo.
            this._yieldTimer += this.updateInterval;
            if (this._yieldTimer > YIELD_TIMEOUT) junctionBlock = false;
        } else {
            this._yieldTimer = 0;
        }
        if (junctionBlock) {
            const gap = distToEnd - HALF_LEN - JUNCTION_STOP_M;   // bumper -> vạch
            if (gap < s.leaderGap) {
                s.leaderGap = Math.max(gap, -BUS_LEN);
                s.leaderSpeed = 0;
                s.junctionBlocked = true;
            }
        }
        this.followTarget = s.leader;
        if (s.leaderGap < Infinity && s.leader) {
            const rel = this.speed - s.leaderSpeed;
            s.ttc = rel > 0.2 ? s.leaderGap / rel : Infinity;
        }
        return s;
    }

    // Khoảng cách cần có để vào làn/khe an toàn (có tính nhân cách).
    _gapOk(frontGap, rearGap, rearSpeed) {
        const aggro = this.profile.laneChangeAggro;
        const needF = Math.max(22, 12 + this.speed * 0.9) * (1 - 0.25 * aggro);
        const closing = Math.max(0, (rearSpeed || 0) - this.speed);
        const needR = Math.max(24, 14 + closing * 2.2) * (1 - 0.2 * aggro);
        return frontGap >= needF && rearGap >= needR;
    }

    // ---------------------------------------------------------- quyết định
    _decide(dt, allVehicles) {
        const f = this._frame;
        if (!f || !this.meta) return;
        const meta = this.meta;

        this.reactTimer -= dt;
        if (this.lc.cooldown > 0) this.lc.cooldown -= dt;
        if (this.overtakeCooldown > 0) this.overtakeCooldown -= dt;
        if (this.vn.tailgateTimer > 0) this.vn.tailgateTimer -= dt;
        if (this.vn.boostTimer > 0) this.vn.boostTimer -= dt;

        // làn cần kiểm khi đổi làn / nhập lại từ lề
        this._scanLane = (this.lc.phase === 'CHECK') ? this.lc.targetLane
            : (this.stop.phase === 'MERGE_CHECK' || this.stop.phase === 'MERGE_IN') ? 0 : -1;
        this._scan(allVehicles);
        this._vnBehavior(dt);

        // 1) nguyện vọng tốc độ (đường + tính cách + góc cua)
        this._updateDesiredSpeed();

        // 2) FSM tấp lề / FSM đổi làn
        if (this.stop.phase !== 'IDLE') {
            this._stopFSM(dt);
        } else {
            if (this.lc.phase !== 'IDLE') this._laneChangeFSM(dt);
            else this._considerLaneChange(dt);
            // Không FSM nào đang giữ target (ngoại trừ COMMIT vừa tự set làn
            // đích trong tick này) -> ghim về tâm làn hiện tại. applyAvoidance
            // xích lệch target mỗi lần va chạm (+/-0.6m) nhưng không ai đưa
            // về lại: tích tụ nhiều lần = xe trôi hẳn ra giữa đường/ghé sát
            // xe ngược chiều -> 2 xe chồng nhau, mỗi xe coi xe kia là leader
            // -> deadlock đứng vĩnh viễn. Ghim ở đây để lệch làn chỉ tạm thời.
            if (this.lc.phase !== 'COMMIT' && this.stop.phase === 'IDLE') {
                this.targetLaneOffset = this._laneCenter(this.lane);
            }
            this._maybeRequestStop(dt);
        }

        // 2b) giải cứu xe đã CHỒNG nhau (leaderGap < 0 mà đứng im mãi): IDM
        // chỉ phanh nên không bao giờ tự gỡ -> phải tự tách (ưu tiên CAO hơn
        // re-center ở trên).
        this._updateStuckEscape(dt);

        // 3) điều khiển dọc (IDM)
        this._updateAccel(dt);

        // 4) nhãn trạng thái cho debug/HUD
        this._updateStateLabel();
    }

    // v0 = tốc độ giới hạn của đoạn * nhân cách (không vượt 1.2 lần limit).
    _updateDesiredSpeed() {
        const meta = this.meta;
        let v0 = meta ? meta.speedMs * this.profile.speedFactor : 8;
        if (this.vn.boostTimer > 0) v0 *= 1.12;
        if (meta) v0 = Math.min(v0, meta.speedMs * 1.2);

        const f = this._frame;
        if (this.turning) {
            v0 *= 0.35;                              // ôm cua / rẽ
        } else if (f) {
            const remain = f.len - this.progress * f.len;
            if (remain < 25 && this._endNodeDegree() >= 3) {
                v0 *= 0.55 + 0.45 * clamp(remain / 25, 0, 1);   // chậm lại trước ngã
            }
        }
        this.targetSpeed = Math.max(0, v0);
    }

    _endNodeDegree() {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) return 0;
        const nodeId = this.direction === 0 ? seg.to : seg.from;
        const node = this._getNode(nodeId);
        return node && node.connections ? node.connections.length : 0;
    }

    // Xe đã chồng nhau/nhìn nhau mà cả 2 cùng đứng im -> không FSM nào tự
    // gỡ: IDM chỉ phanh, không bao giờ tăng ga. Sau 4s chồng nhau, tự tách:
    //  - leader NGƯỢC CHIỀU: ép sát lề PHẢI tối đa (target = maxOffset) ->
    //    2 xe đẩy sang 2 bên, hết hard-leader thì mỗi xe chạy tiếp;
    //  - leader CÙNG CHIỀU giao cắt (lệch ngang > 1.2m): "trườn" ra thật
    //    chậm (_stuckCreep, ≤1.5 m/s) để thoát khỏi giao điểm.
    _updateStuckEscape(dt) {
        const s = this.scan, f = this._frame;
        const overlapped = s.leader && s.leaderGap < 0.5 && !s.junctionBlocked &&
            this.stop.phase === 'IDLE';
        if (!overlapped || !f) {
            this._stuckT = 0;
            this._stuckCreep = false;
            return;
        }
        this._stuckT += dt;
        if (this._stuckT < 4) return;                 // chưa kẹt lâu -> để IDM lo

        const L = s.leader;
        let lat = 0, oncoming = false;
        if (L.collider) {
            const dx = L.collider.x - this.collider.x;
            const dz = L.collider.z - this.collider.z;
            lat = Math.abs(dx * f.rx + dz * f.rz);
            oncoming = typeof L.heading === 'number' &&
                (Math.sin(L.heading) * f.ux + Math.cos(L.heading) * f.uz) <= 0.1;
        }
        if (oncoming) {
            this.targetLaneOffset = this._maxOffset();   // ép sát lề phải = tách 2 bên
        } else if (this.speed < 0.6 && this._stuckT > 5 && lat > 1.2) {
            // CHỈ trườn khi 2 xe giao cắt lệch ngang thật sự (lộ ra giao
            // điểm). Đụng xe cùng làn đứng trước (lat≈0) mà trườn là đẩy
            // xe sau vào hẳn trong xe trước (gap thành -12m, chồng kim),
            // creep không tắt được vì gap không bao giờ hở ra.
            this._stuckCreep = true;
        }
    }

    _updateAccel(dt) {
        const p = this.profile;
        const v0 = Math.max(0, this.targetSpeed);
        const v = this.speed;
        const s = this.scan;

        if (v0 <= 0.05 && v < 0.05) { this.speed = 0; this.accel = 0; this._brakePending = false; return; }

        // Đang trườn ra giải cứu kẹt: IDM bị gác (khoảng cách vẫn âm -> IDM
        // chỉ phanh mãi), giữ tốc độ trườn ≤1.5 m/s tới khi hở ra là
        // _updateStuckEscape tự tắt.
        if (this._stuckCreep) {
            this.accel = v < 1.5 ? 1.2 : -3;
            this._brakePending = false;
            this._emergencyTimer = 0;
            return;
        }

        let want;
        if (s.leaderGap === Infinity || s.leaderGap > LOOKAHEAD) {
            want = v >= v0 ? -Math.min(p.deceleration, (v - v0) * 2 + 0.5)
                : clamp(p.acceleration * (1 - Math.pow(clamp(v / Math.max(v0, 0.1), 0, 2), 4)),
                    -p.deceleration, p.acceleration);
        } else {
            const s0 = p.followingDistance * (this.vn.tailgateTimer > 0 ? 0.55 : 1);
            const dv = v - s.leaderSpeed;
            const sStar = s0 + Math.max(0,
                v * p.timeGap + (v * dv) / (2 * Math.sqrt(p.acceleration * p.deceleration)));
            const gap = Math.max(s.leaderGap, 0.5);
            want = clamp(p.acceleration *
                (1 - Math.pow(clamp(v / Math.max(v0, 0.1), 0, 2), 4) - (sStar / gap) * (sStar / gap)),
                -p.emergencyDecel * 0.9, p.acceleration);
        }

        // Phanh khẩn cấp: TTC thấp hoặc đã gần chạm -> bỏ qua phản xạ trễ.
        const rel = v - s.leaderSpeed;
        const ttc = (rel > 0.2 && s.leaderGap < Infinity) ? s.leaderGap / rel : Infinity;
        s.ttc = ttc;
        if (s.leaderGap < p.followingDistance * 0.45 || ttc < EMERGENCY_TTC) {
            this.accel = -p.emergencyDecel;
            this._brakePending = false;
            this._emergencyTimer = 0.3;
            return;
        }
        if (this._emergencyTimer > 0) this._emergencyTimer -= dt;

        // Phản xạ trễ thật (reactionTime) khi MỚI CẦN phanh.
        if (want < this.accel - 0.4) {
            if (!this._brakePending) { this._brakePending = true; this.reactTimer = p.reactionTime; }
            if (this.reactTimer > 0 && this._emergencyTimer <= 0) return;   // giữ pha cũ thêm reactionTime
            this.accel = want;
        } else {
            this._brakePending = false;
            this.accel = want;
        }
    }

    _updateStateLabel() {
        if (this.stop.phase !== 'IDLE') return;      // FSM tấp lề tự giữ nhãn
        if (this.turning) { this.state = AI_STATE.TURNING; return; }
        if (this.lc.phase === 'COMMIT') { this.state = AI_STATE.LANE_CHANGING; return; }
        if (this.lc.phase === 'OVERTAKING') { this.state = AI_STATE.OVERTAKING; return; }
        if (this._emergencyTimer > 0) { this.state = AI_STATE.EMERGENCY_BRAKING; return; }
        if (this.scan.junctionBlocked) { this.state = AI_STATE.YIELDING; return; }

        const p = this.profile, s = this.scan;
        if (s.leaderGap === Infinity || s.leaderGap > LOOKAHEAD) {
            this.state = this.accel > 0.5 ? AI_STATE.ACCELERATING : AI_STATE.CRUISING;
            return;
        }
        const rel = this.speed - s.leaderSpeed;
        const ttc = rel > 0.2 ? s.leaderGap / rel : Infinity;
        if (ttc < 2.2 || s.leaderGap < p.followingDistance * 0.8 || this.accel < -1.5) {
            this.state = AI_STATE.BRAKING;
        } else if (s.leaderGap < p.followingDistance * 3.5) {
            this.state = AI_STATE.FOLLOWING;
        } else {
            this.state = this.accel > 0.5 ? AI_STATE.ACCELERATING : AI_STATE.CRUISING;
        }
    }

    // ------------------------------------------------- FSM đổi làn / vượt
    _considerLaneChange(dt) {
        const meta = this.meta, f = this._frame, lc = this.lc;
        if (!meta || !f || !meta.laneChangeAllowed) return;
        if (this.turning || this.lane >= meta.lanesPerDir) return;
        if (lc.cooldown > 0 || this.overtakeCooldown > 0) return;
        // Không đổi làn khi còn <30m là tới hai đầu đoạn (gần ngã/ramp)
        const myT = this.progress * f.len, remain = f.len - myT;
        if (myT < 30 || remain < 30) return;

        const p = this.profile;

        // 1) CÂN NHẮC vượt: đang bị giữ tốc độ dưới mong muốn, xe dẫn chặn
        //    trước mặt và còn làn bên trái
        if (this.lane < meta.lanesPerDir - 1 &&
            this.speed < this.targetSpeed - 2 &&
            this.scan.leaderGap < p.followingDistance * 2.5 + this.speed * 1.6 &&
            this.random() < p.overtakeChance * dt) {
            this._beginLaneChange('OVERTAKING_MOVE', this.lane + 1);
            return;
        }

        // 2) GIỮ BÊN PHẢI: đường trống -> về làn 0 (hysteresis qua cooldown)
        if (this.lane > 0 &&
            (this.scan.leaderGap === Infinity || this.scan.leaderGap > 65) &&
            this.random() < 0.6 * dt) {
            this._beginLaneChange('KEEP_RIGHT', this.lane - 1);
        }
    }

    _beginLaneChange(kind, targetLane) {
        const meta = this.meta;
        if (!meta) return;
        const lc = this.lc;
        lc.phase = 'CHECK';
        lc.kind = kind;
        lc.targetLane = clamp(targetLane, 0, meta.lanesPerDir - 1);
        lc.target = (kind === 'OVERTAKING_MOVE') ? this.scan.leader : null;
        lc.timer = 0;
        lc.badT = 0;
        this.overtakeTarget = lc.target;
    }

    _laneChangeFSM(dt) {
        const meta = this.meta, lc = this.lc;
        if (!meta) { lc.phase = 'IDLE'; return; }
        // Không giữ trạng thái đổi làn qua giao lộ: còn <12m tới node mà
        // đang CHECK/COMMIT -> về làn hiện tại (tránh ôm cua ngay giữa ngã).
        const fNow = this._frame;
        if ((lc.phase === 'CHECK' || lc.phase === 'COMMIT') && fNow &&
            fNow.len - this.progress * fNow.len < 12) {
            this._abortLaneChange();
            return;
        }

        if (lc.phase === 'CHECK') {
            lc.timer += dt;
            // quét lại với làn đích (đã set _scanLane trước khi _scan trong _decide)
            const ok = this._gapOk(this.scan.candFrontGap, this.scan.candRearGap, this.scan.candRearSpeed);
            if (ok && lc.timer >= 0.15) {
                lc.phase = 'COMMIT';
                this.targetLaneOffset = this._laneCenter(lc.targetLane);
                this.state = AI_STATE.LANE_CHANGING;
            } else if (!ok) {
                lc.badT += dt;
                if (lc.badT > 0.6 || lc.timer > 2.0) this._abortLaneChange();
            } else if (lc.timer > 2.5) {
                this._abortLaneChange();
            }
            return;
        }

        if (lc.phase === 'COMMIT') {
            this.state = AI_STATE.LANE_CHANGING;
            this.targetLaneOffset = this._laneCenter(lc.targetLane);
            if (Math.abs(this.laneOffset - this.targetLaneOffset) < 0.1) {
                this.lane = lc.targetLane;
                if (lc.kind === 'OVERTAKING_MOVE') {
                    lc.phase = 'OVERTAKING';
                    lc.holdTimer = 3 + this.random() * 3;      // giữ làn vượt 3-6s
                    this.overtakeTarget = this.scan.leader;
                    this.state = AI_STATE.OVERTAKING;
                } else {
                    this._finishLaneChange();
                }
            }
            return;
        }

        if (lc.phase === 'OVERTAKING') {
            lc.holdTimer -= dt;
            this.state = AI_STATE.OVERTAKING;
            // "Đã vượt xong" = xe bị vượt đã hẳn SAO LƯNG (t < -độ dài xe -
            // 8m), KHÔNG phải vì nó lệch làn (lúc đó nó lệch 3.5m và bị coi
            // là xe làn kế -> cắt về sẽ cắt đầu xe kia).
            const passed = this._overtakePassed();
            if (passed && lc.holdTimer <= 0 && this.lane > 0 && lc.cooldown <= 0) {
                this._beginLaneChange('KEEP_RIGHT', this.lane - 1);
            }
            return;
        }
        lc.phase = 'IDLE';
    }

    _overtakePassed() {
        const tg = this.lc.target;
        const f = this._frame;
        if (!tg || !tg.collider) return true;
        if (tg.active === false) return true;          // xe kia đã despawn
        if (!f) return false;
        const dx = tg.collider.x - this.collider.x;
        const dz = tg.collider.z - this.collider.z;
        const t = dx * f.ux + dz * f.uz;               // >0: trước mặt
        if (t > 0) return false;                       // vẫn còn phía trước
        // thêm khe an toàn khi cắt về
        return (-t - BUS_LEN) > 8 && (this.scan.leaderGap === Infinity || this.scan.leaderGap > 40);
    }

    _abortLaneChange() {
        const lc = this.lc;
        lc.phase = 'IDLE';
        lc.kind = null;
        lc.target = null;
        lc.cooldown = 5 + this.random() * 6;      // hysteresis: không lắc lư
        this.overtakeCooldown = lc.cooldown;
        if (this.meta) this.targetLaneOffset = this._laneCenter(this.lane);
        this.overtakeTarget = null;
    }

    _finishLaneChange() {
        const lc = this.lc;
        lc.phase = 'IDLE';
        lc.kind = null;
        lc.target = null;
        lc.cooldown = 2 + this.random() * 3;
        this.overtakeCooldown = lc.cooldown;
        this.overtakeTarget = null;
    }

    // ------------------------------------------------- FSM tấp lề (lề đường)
    _maybeRequestStop(dt) {
        const meta = this.meta, f = this._frame;
        if (!meta || !f) return;
        if (!meta.shoulderAllowed) return;
        if (this.lane !== 0 || this.turning) return;
        if (this.lc.phase !== 'IDLE') return;
        const myT = this.progress * f.len, remain = f.len - myT;
        if (myT < 40 || remain < 40) return;                 // tránh giao lộ/cuối đoạn
        if (!(this.scan.leaderGap === Infinity || this.scan.leaderGap > 40)) return;
        // Có xe bám sát phía sau -> đừng tấp: nó sẽ xếp hàng sau mình và khe
        // nhập lại (MERGE_CHECK) không bao giờ mở -> deadlock nguyên con dốc.
        if (!(this.scan.rearGap === Infinity || this.scan.rearGap > 20)) return;
        if (this.speed < 3) return;
        // BUS_DRIVER: ưu tiên dừng gần bến (node bus_station phía trước)
        let nearStation = false;
        if (this.profile.isBus && remain < 120) {
            const node = this._getNode(this.direction === 0 ? f.seg.to : f.seg.from);
            if (node && node.type === 'bus_station') nearStation = true;
        }
        const chance = nearStation ? Math.max(0.25 * dt, this.profile.roadsideStopChance * dt)
            : this.profile.roadsideStopChance * dt;
        if (this.random() > chance) return;

        const parkOffset = Math.max(this._laneCenter(0) + 0.4, meta.half - Math.max(0.9, HALF_W));
        this.stop.phase = 'PULL_OVER';
        this.stop.offset = clamp(parkOffset, this._laneCenter(0), this._maxOffset());
        this.stop.timer = 0;
        this.stop.hold = 0;
        this.targetLaneOffset = this.stop.offset;
        this.targetSpeed = 0;
        this.state = AI_STATE.STOPPING;
        if (nearStation) this.busStopNode = this._getNode(this.direction === 0 ? f.seg.to : f.seg.from);
    }

    _stopFSM(dt) {
        const st = this.stop, meta = this.meta;
        if (!meta) { st.phase = 'IDLE'; return; }

        if (st.phase === 'PULL_OVER') {
            this.state = AI_STATE.STOPPING;
            this.targetLaneOffset = st.offset;
            this.targetSpeed = 0;
            if (this.scan.leaderGap < 12 && this.speed > 6) {
                // Bị xe khác chắn lối ra -> bỏ ý định, về làn (không lao ra)
                st.phase = 'IDLE';
                this.targetLaneOffset = this._laneCenter(this.lane);
                return;
            }
            if (this.speed < 0.4) {
                this.speed = 0; this.accel = 0;
                st.phase = 'PARKED';
                st.timer = 15 + this.random() * 10;       // ~20 giây
                this.state = AI_STATE.PARKED;
                this.parkTimer = st.timer;
            }
            return;
        }

        if (st.phase === 'PARKED') {
            this.speed = 0; this.accel = 0;
            this.targetSpeed = 0;
            this.state = AI_STATE.PARKED;
            st.timer -= dt;
            this.parkTimer = st.timer;
            if (st.timer <= 0) {
                st.phase = 'MERGE_CHECK';
                st.timer = 0; st.hold = 0;
                this.state = AI_STATE.MERGING;
            }
            return;
        }

        if (st.phase === 'MERGE_CHECK') {
            this.state = AI_STATE.MERGING;
            this.targetSpeed = 0;
            this.targetLaneOffset = st.offset;
            st.timer += dt;
            const ok = this._gapOk(this.scan.candFrontGap, this.scan.candRearGap, this.scan.candRearSpeed);
            // Nhập "trườn": xe sau ĐÃ DỪNG mà còn đủ chỗ (>=8m). Khe chuẩn
            // (24m) không bao giờ tới khi hàng xe đã dựng sau lưng mình — chờ
            // mãi = chặn nguyên đoạn đường. Xe sau đứng yên nên vào làn an toàn.
            const creep = this.scan.candFrontGap >= 6 &&
                this.scan.candRearGap >= 8 && this.scan.candRearSpeed <= 1.5;
            // Chốt thời gian (liveness): >15s mà vẫn kẹt thì vào khi có tối
            // thiểu chỗ; >25s chỉ cần xe sau chậm (đủ để không bị húc đuôi).
            const desperate = st.timer > 15 && this.scan.candFrontGap >= 6 &&
                this.scan.candRearSpeed <= 3 && (st.timer > 25 || this.scan.candRearGap >= 4);
            st.hold = (ok || creep || desperate) ? st.hold + dt : 0;
            if (st.hold > 0.25) {
                st.phase = 'MERGE_IN';
                this.targetLaneOffset = this._laneCenter(0);
                this.targetSpeed = (this.meta ? this.meta.speedMs * this.profile.speedFactor : 6) * 0.6;
            }
            // Không an toàn -> CHỜ (vẫn có nhánh creep/desperate ở trên để
            // không bao giờ chờ vĩnh viễn).
            return;
        }

        if (st.phase === 'MERGE_IN') {
            this.state = AI_STATE.MERGING;
            this.targetLaneOffset = this._laneCenter(0);
            if (this.scan.leaderGap < 8 && this.scan.leaderGap > -BUS_LEN && this.speed < 4) {
                // xe trước chắn ngay đầu làn -> đứng chờ lại
                this.targetSpeed = 0;
                return;
            }
            this.targetSpeed = (this.meta ? this.meta.speedMs * this.profile.speedFactor : 6) * 0.7;
            if (Math.abs(this.laneOffset - this.targetLaneOffset) < 0.15 &&
                this.speed > this.targetSpeed * 0.5) {
                st.phase = 'IDLE'; st.hold = 0;
                this.lane = 0;
                this.state = AI_STATE.CRUISING;
            }
        }
    }

    // Hành vi VN "không hoàn hảo nhưng tin được" — chỉ theo xác suất,
    // mọi thứ vẫn nằm trong vật lý (giãn cách/tốc độ hợp lý).
    _vnBehavior(dt) {
        if (this.aiLevel === 'FAR') return;
        const p = this.profile;
        if (this.vn.tailgateTimer <= 0 && this.random() < p.recklessChance * dt * 0.15) {
            this.vn.tailgateTimer = 4 + this.random() * 6;      // bám gần hơn 1 chút
        }
        if (this.vn.boostTimer <= 0 && this.random() < p.recklessChance * dt * 0.2) {
            this.vn.boostTimer = 3 + this.random() * 5;         // vượt nhẹ giới hạn
        }
    }

    // ---------------------------------------------------------- tích phân
    // Chạy MỖI FRAME bất kể LOD -> xe không đóng băng / không nhảy cóc.
    _integrate(dt) {
        if (!this._frame && !this._updateFrame()) return;

        if (this.stop.phase === 'PARKED') { this.speed = 0; this.accel = 0; }

        this.speed = Math.max(0, this.speed + this.accel * dt);
        if (this.targetSpeed <= 0.05 && this.speed < 0.2 && this.accel <= 0) { this.speed = 0; this.accel = 0; }

        // chuyển dịch ngang: đổi làn giữ vận tốc ngang ~1.6-3.2 m/s (mượt).
        // Lệch > 4m = vừa thoát ngã (phân rã lại toạ độ theo trục mới) ->
        // nhập làn nhanh hơn (5 m/s) để thời gian "ngoài làn" ngắn nhất.
        // ⚠ Giữ ngưỡng 4m: hạ xuống 1.5 từng làm xe rẽ ngang 5m/s (quỹ
        // đạo chéo) cắt qua xe đang đứng ở làn đích -> overlap nghìn frame.
        const diff = this.targetLaneOffset - this.laneOffset;
        if (Math.abs(diff) > 0.002) {
            const rate = (this.lc.phase === 'COMMIT')
                ? clamp(1.6 + this.speed * 0.08, 1.6, 3.2)
                : (Math.abs(diff) > 4 ? 5 : 2.4);
            const step = Math.min(Math.abs(diff), rate * dt);
            this.laneOffset += (diff > 0 ? step : -step);
        } else {
            this.laneOffset = this.targetLaneOffset;
        }

        const f = this._frame;
        this.progress += (this.speed / f.len) * dt;
        // _entryWait > 0: đang giữ xe tại node chờ cửa ra — vẫn phải vào
        // junction mỗi frame để đếm timeout, kể cả khi speed về 0 (progress
        // không tăng nên < 1.0).
        if (this.progress >= 1.0 || this._entryWait > 0) {
            this._handleJunction(dt);
            if (!this._frame && !this._updateFrame()) return;
        }
        this.progress = clamp(this.progress, Math.min(this._progFloor, 0), 0.9999);
        if (this.progress >= 0 && this._progFloor < 0) this._progFloor = 0;
        this._updatePositionFromSegment();
        this._updateHeading(dt);
    }

    // ---------------------------------------------------------- junction
    _handleJunction(dt = 0) {
        const seg = this._getSegment(this.currentSegmentId);
        if (!seg) { this._recover(); return; }
        const curId = this.direction === 0 ? seg.to : seg.from;
        const node = this._getNode(curId);
        if (!node?.connections?.length) { this._uTurn(); return; }

        // Đã tới đích -> chọn đích mới (rule 57: xe PHẢI có đường đi)
        if (this.goalNodeId && curId === this.goalNodeId) this._retarget();

        // 1) đi theo path đã lên kế hoạch
        if (this.pathNodes.length > 0 && this.currentPathIndex < this.pathNodes.length - 1) {
            const nextNodeId = this.pathNodes[this.currentPathIndex + 1];
            const nextSeg = node.connections.find(id => {
                const s = this._getSegment(id);
                return s && (s.from === nextNodeId || s.to === nextNodeId);
            });
            if (nextSeg) {
                if (this._enterNewSegment(nextSeg, curId, dt)) this.currentPathIndex++;
                return;
            }
            this.pathNodes = [];            // path hỏng -> tính lại
        }

        // 2) hết path -> tính lại A* (1 lần, không phải mỗi ngã)
        if (this.goalNodeId && this.pathNodes.length === 0) {
            const from2 = this._curNodeId();
            if (from2 && from2 !== this.goalNodeId &&
                typeof this.roadGraph.findPath === "function") {
                const p2 = this.roadGraph.findPath(from2, this.goalNodeId, this.currentSegmentId);
                if (p2 && p2.length) { this.pathNodes = p2; this.currentPathIndex = 0; this._pathFails = 0; }
                else {
                    // A* thất bại (đích bị cô lập) -> đổi đích sau 2 lần liên tiếp
                    this._pathFails++;
                    if (this._pathFails >= 2) { this._retarget(); this._pathFails = 0; }
                }
            }
        }
        if (this.goalNodeId && this.pathNodes.length === 0 &&
            typeof this.roadGraph.nextSegmentToward === "function") {
            const nextSegId = this.roadGraph.nextSegmentToward(curId, this.goalNodeId, this.currentSegmentId);
            if (nextSegId) {
                const s2 = this._getSegment(nextSegId);
                if (s2) { this._enterNewSegment(s2, curId, dt); return; }
            }
        }

        // 3) chưa có đích -> rẻ nhất, cấm U-turn tại ngã
        const outs = typeof this.roadGraph.neighbors === "function"
            ? this.roadGraph.neighbors(curId)
            : node.connections.map(id => ({ seg: id, to: null, cost: 1, len: 1 }));
        const cand = outs.filter(c => c.seg !== this.currentSegmentId);
        if (cand.length === 0) { this._uTurn(); return; }
        let best = cand[0];
        for (const c of cand) {
            if ((c.cost / (c.len || 1)) < (best.cost / (best.len || 1))) best = c;
        }
        const nextSeg = this._getSegment(best.seg);
        if (!nextSeg) { this._uTurn(); return; }
        this._enterNewSegment(nextSeg, curId, dt);
    }

    // Vào segment mới CHỈ KHI cửa ra chưa bị xe cùng chiều chiếm. 2 xe cùng
    // rẽ vào 1 đoạn lúc này từng chồng prog ~0.1 lên nhau (đứng chết stack).
    // Bị chặn -> giữ xe tại node (progress gần 1, giảm tốc), đếm timeout:
    // quá ENTRY_WAIT_MAX mà xe trong cửa ra vẫn đứng đó (nó cũng kẹt) thì
    // vào anyway để không chết đạo — sau đó IDM + collision avoidance lo.
    _enterNewSegment(nextSeg, curId, dt) {
        if (this._entryOccupied(nextSeg, curId)) {
            this._entryWait += dt || (1 / 30);
            if (this._entryWait < ENTRY_WAIT_MAX) {
                this.progress = Math.min(this.progress, 0.9999);
                if (this.speed > 1.5) { this.speed = 1.5; }
                this.accel = Math.min(this.accel, -3);
                return false;
            }
        }
        this._entryWait = 0;
        this._setNewSegment(nextSeg, curId);
        return true;
    }

    // Xe khác đang đứng trong vùng cửa ra (0 -> BUS_LEN+14m) của segment đích,
    // cùng chiều -> chặn. O(N) với N = số xe active, chỉ chạy khi tới ngã.
    _entryOccupied(nextSeg, curId) {
        const vehs = this._lastVehicles;
        if (!vehs || !vehs.length) return false;
        const dir = nextSeg.from === curId ? 0 : 1;
        const a = this._getNode(dir === 0 ? nextSeg.from : nextSeg.to);
        const b = this._getNode(dir === 0 ? nextSeg.to : nextSeg.from);
        if (!a || !b) return false;
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const win = BUS_LEN + 14;
        for (let i = 0; i < vehs.length; i++) {
            const o = vehs[i];
            if (!o || o === this || !o.collider || o.isStatic) continue;
            if (o.currentSegmentId !== nextSeg.id) continue;
            if (typeof o.direction === 'number' && o.direction !== dir) continue;
            const t = (o.collider.x - a.x) * ux + (o.collider.z - a.z) * uz;
            // t âm = vừa rẽ vào, tâm xe chưa vượt điểm đầu segment (progr-
            // ess decompose ra số âm khi cua). Mở tới -BUS_LEN để bắt cả
            // xe đứng sờ sờ ngay cửa với prog -0.03 (trước đó window -2m
            // để lọt -> xe thứ 2 ùa vào đè lên).
            if (t >= -BUS_LEN && t < win) return true;
        }
        return false;
    }

    // Đích mới. Ưu tiên POI thật (bến/trạm nghỉ/cây xăng) gần, không có
    // thì chọn node đường lớn 0.4-2.5km. Đích phải CÙNG thành phần liên
    // thông với xe, nếu không A* không ra đường.
    // ⚠ CHỈ CHẠY A* MỘT LẦN ở đây. Các ngã khác đi theo pathNodes; chỉ
    // khi hết path / path hỏng mới tính lại (N5000: A* 40ms là cấm mỗi ngã).
    setGoal(nodeId) {
        this.goalNodeId = nodeId || null;
        this.pathNodes = [];
        this.currentPathIndex = 0;
        this._pathFails = 0;
        const from = this._curNodeId();
        if (!this.goalNodeId || !from) return;
        if (typeof this.roadGraph.findPath !== "function") return;
        const p = this.roadGraph.findPath(from, this.goalNodeId, this.currentSegmentId);
        if (p && p.length) {
            this.pathNodes = p;
            this.currentPathIndex = 0;
        }
    }

    // API cũ từng là stub -> nối thẳng vào setGoal (không còn placeholder).
    setDestination(endNodeId) { this.setGoal(endNodeId); }

    _curNodeId() {
        const s = this._getSegment(this.currentSegmentId);
        if (!s) return null;
        return this.direction === 0 ? s.to : s.from;
    }

    _retarget() {
        const rg = this.roadGraph;
        if (!rg || typeof rg.neighbors !== "function") { this.goalNodeId = null; return; }
        const hereId = this._curNodeId();
        const here = hereId ? rg.getNode(hereId) : null;
        if (!here) { this.goalNodeId = null; return; }
        const ox = here.x, oz = here.z;

        // 1) POI thật trong 350m-6km
        if (rg.pois && rg.pois.length && this.random() < 0.55) {
            const cand = [];
            for (const p of rg.pois) {
                const d = Math.hypot(p.position.x - ox, p.position.z - oz);
                if (d < 350 || d > 6000) continue;
                cand.push(p);
            }
            if (cand.length) {
                const pick = cand[Math.floor(this.random() * cand.length)];
                const n = rg.nearestNode(pick.position.x, pick.position.z);
                if (n && rg.canReach(hereId, n.id)) { this.setGoal(n.id); return; }
            }
        }
        // 2) node đường lớn ngẫu nhiên 0.4-2.5km
        const BIG = new Set(["NATIONAL", "EXPRESSWAY", "ARTERIAL", "COLLECTOR", "PROVINCIAL_ROAD"]);
        for (let tries = 0; tries < 8; tries++) {
            const n = rg.nodes[Math.floor(this.random() * rg.nodes.length)];
            if (!n) break;
            const d = Math.hypot(n.x - ox, n.z - oz);
            if (d < 400 || d > 2500) continue;
            if (!rg.neighbors(n.id).some(e => BIG.has(e.cls))) continue;
            this.setGoal(n.id);
            return;
        }
        this.goalNodeId = null;   // không có đích -> tự bám đường lớn (bước 3)
    }

    // Giữ NGUYÊN vị trí vật lý khi đổi khung đoạn: phân rã lại toạ độ (tiến,
    // ngang) trong khung MỚI thay vì đặt progress = 0 rồi giữ nguyên laneOffset.
    // vuông góc MỚI đảo chiều -> tâm xe nhảy ngang tới 2×offset (10.8m với làn
    // 5.63m) trong 1 frame. Phân rã là DUY NHẤT nên có thể ra tiến/lệch ÂM —
    // đó là vị trí thật trong hộp ngã, xe sẽ từ từ về làn phải.
    // Yêu cầu: _frame đã cập nhật cho segment/direction mới.
    _adoptWorldPos(wx, wz) {
        const f = this._frame;
        if (!f) return;
        const sx = wx - f.p0.x, sz = wz - f.p0.z;
        this.progress = (sx * f.ux + sz * f.uz) / f.len;
        this.laneOffset = sx * f.rx + sz * f.rz;
        this._progFloor = Math.min(0, this.progress);
    }

    _setNewSegment(nextSeg, curId) {
        const wx = this.collider.x, wz = this.collider.z;   // vị trí trước khi đổi khung
        if (nextSeg.from === curId) this.direction = 0;
        else if (nextSeg.to === curId) this.direction = 1;
        else { this._uTurn(); return; }
        this.oldHeading = this.heading;
        this.currentSegmentId = nextSeg.id;
        this.progress = 0;
        this._entryWait = 0;
        // Qua ngã: hủy mọi FSM dở dang (không đổi làn/tấp lề qua giao lộ)
        this.lc.phase = 'IDLE'; this.lc.kind = null;
        this.stop.phase = 'IDLE'; this.stop.hold = 0;
        this._updateFrame();
        if (this.meta) this.lane = clamp(this.lane, 0, this.meta.lanesPerDir - 1);
        this.targetLaneOffset = this._laneCenter(this.lane);
        this.targetHeading = this._getSegmentHeading();
        // đoạn mới (đường thẳng tắp cũng vậy) đều bật turning -> speed *= 0.35
        // mỗi đoạn -> xe giật cục giảm tốc liên tục. Góc nhỏ: heading tự mượt
        // qua lerpAngle trong _updateHeading (nhánh không turning).
        let hd = this.targetHeading - this.oldHeading;
        while (hd > Math.PI) hd -= TWO_PI;
        while (hd < -Math.PI) hd += TWO_PI;
        if (Math.abs(hd) > 0.30) {                     // ~17 độ: thật sự rẽ
            this.turning = true;
            this.turnTimer = 0;
            this.state = AI_STATE.TURNING;
        } else {
            this.turning = false;
            this.turnTimer = 0;
        }
        this._adoptWorldPos(wx, wz);        // không nhảy cóc qua ngã
        this._updatePositionFromSegment();
    }

    _uTurn() {
        // Quay đầu TẠI ĐƯỜNG CÙNG (chỉ xảy ra ở đường cụt): phân rã lại toạ
        // độ trong khung chiều mới -> xe đứng yên tại chỗ, rồi từ từ trôi về
        // làn phải của chiều mới (offset âm = đang ở bên trái, hợp lý khi vừa
        // quay xong).
        const wx = this.collider.x, wz = this.collider.z;
        this.direction = 1 - this.direction;
        this._entryWait = 0;
        this.oldHeading = this.heading;
        this.targetHeading = this.heading + Math.PI;
        this.lane = 0;
        this.lc.phase = 'IDLE';
        this.stop.phase = 'IDLE';
        this.turning = true;
        this.turnTimer = 0;
        this.state = AI_STATE.TURNING;
        if (!this._updateFrame()) { this.progress = 0; return; }
        this.targetLaneOffset = this._laneCenter(0); // rồi trôi về làn phải
        this._adoptWorldPos(wx, wz);
        this._updatePositionFromSegment();
    }

    _recover() {
        this.state = AI_STATE.RECOVERING;
        this._recoverCount++;
        this._entryWait = 0;
        if (!this.roadGraph.segments?.length) return;
        const seg = this.roadGraph.segments[Math.floor(this.random() * this.roadGraph.segments.length)];
        const dir = seg.twoWay ? Math.floor(this.random() * 2) : 0;
        // Không teleport về chỗ random khi GRAPH còn lành lặn — chỉ đặt lại
        // khi thực sự mất đoạn hiện tại (frame không tính được).
        this.placeOnSegment(seg.id, dir, 0.1 + this.random() * 0.3, null);
        this.state = AI_STATE.CRUISING;
    }

    // ---------------------------------------------------------- chuyển động
    _updateHeading(dt) {
        if (this.turning) {
            this.turnTimer += dt;
            const turnDuration = this.profile.isBus ? 2.5 : 1.5;
            const p = Math.min(1, this.turnTimer / turnDuration);
            const smooth = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            let diff = this.targetHeading - this.oldHeading;
            while (diff > Math.PI) diff -= TWO_PI;
            while (diff < -Math.PI) diff += TWO_PI;
            this.heading = this.oldHeading + diff * smooth;
            if (p >= 1) {
                this.turning = false;
                this.heading = this.targetHeading;
                if (this.state === AI_STATE.TURNING) this.state = AI_STATE.CRUISING;
            }
            return;
        }
        // Nghiêng lái nhẹ theo chuyển dịch ngang (yaw sai số khi đổi làn)
        const yawBias = clamp((this.targetLaneOffset - this.laneOffset) * -0.05, -0.16, 0.16);
        const segHeading = this._getSegmentHeading() + yawBias;
        this.heading = lerpAngle(this.heading, segHeading, Math.min(1, dt * 1.5));
    }

    _updateVehicle() {
        if (!this.vehicle) return;
        this.vehicle.group.position.set(this.collider.x, this.collider.y, this.collider.z);
        this.vehicle.group.rotation.y = this.heading;
        const pts = this._getSegmentPoints();
        if (pts) {
            const dy = pts.p1.y - pts.p0.y;
            const dxz = Math.hypot(pts.p1.x - pts.p0.x, pts.p1.z - pts.p0.z) || 1;
            const pitch = Math.atan2(dy, dxz) * (this.direction === 0 ? -1 : 1);
            this.vehicle.group.rotation.x = THREE.MathUtils.lerp(this.vehicle.group.rotation.x, pitch * 0.5, 0.1);
        }
    }

    // ---------------------------------------------------------- vòng đời
    update(deltaTime, playerPos, allVehicles) {
        if (!this.active || this.isStatic) return;
        const dt = Math.min(deltaTime, 0.1);
        if (allVehicles) this._lastVehicles = allVehicles;
        if (!this._updateFrame()) { this._recover(); this._updateVehicle(); return; }

        this.decTimer -= dt;
        if (this.decTimer <= 0) {
            this.decTimer = this.updateInterval;
            this._decide(this.updateInterval, this._lastVehicles);
        }
        this._integrate(dt);
        this._updateVehicle();
        this.lastUpdateTime = 0;
    }

    // Gọi từ TrafficManager khi va chạm -> CHỈ chỉnh vận tốc/độ lệch làn
    // trong giới hạn đường (không dịch chuyển toạ độ: vị trí luôn suy ra
    // từ làn -> không có kiểu "đẩy xuyên xe").
    applyAvoidance(dx, dz, strength = 1) {
        if (this.isStatic) return;
        const f = this._frame;
        const lat = f ? (dx * f.rx + dz * f.rz) : 0;
        const push = clamp(-lat, -1, 1) * 0.6 * strength;
        this.targetLaneOffset = clamp(this.targetLaneOffset + push, this._minOffset(), this._maxOffset());
        this.laneOffset = clamp(this.laneOffset + push * 0.5, this._minOffset(), this._maxOffset());
        this.speed = Math.max(0, this.speed - 3 * strength);
        this.accel = Math.min(this.accel, -1.5);
    }

    setAILevel(level) {
        this.aiLevel = level;
        this.updateInterval = level === 'NEAR' ? DECIDE_NEAR
            : level === 'MID' ? DECIDE_MID : DECIDE_FAR;
    }

    setActive(a) {
        this.active = a;
        if (this.vehicle?.group) this.vehicle.group.visible = a;
    }

    dispose() {
        if (this.vehicle?.group?.parent) this.vehicle.group.parent.remove(this.vehicle.group);
        this.active = false;
    }
}
