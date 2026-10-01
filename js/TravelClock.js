// js/TravelClock.js
// =====================================================================
// GIỜ TRONG GAME SUY RA TỪ LÁI XE THẬT — KHÔNG HARD-CODE LỊCH TRÌNH.
//
// Trước đây `LightingSystem.gameTimeMinutes += dt * timeScale` với
// `timeScale` hằng số => giờ chạy 1:1 với thời gian thực, xe đứng đáy bến
// vẫn trôi giờ, xe chạy 90 km/h trên cao tốc Vành đai 3 vẫn trôi y hệt khi
// bò 8 km/h trong phố Tân Vạn. Đó không phải mô phỏng, đó là đồng hồ.
//
// Module này ƯỚC LƯỢNG thời gian hành trình từ 7 nhóm đại lượng đo được
// trong runtime, không có bảng giờ tuyến nào cả:
//
//   1. DISTANCE      quãng đường đã đi (m) -> cơ sở của mọi thứ khác
//   2. ROAD TYPE     speedKmh thiết kế của đoạn (getLaneMeta — cùng nguồn
//                    với TrafficAI, KHÔNG bảng tra riêng)
//   3. SPEED         tốc độ thực tế của xe
//   4. TERRAIN       độ dốc mặt đường (hệ số sức cản xe khách khi leo)
//   5. INTERSECTION  số lần đi qua nút giao, dừng chờ theo cấp đường
//   6. URBAN DELAY   ùn tắc (vận tốc < ngưỡng trong khu đông, ngoài bến)
//   7. STATION DELAY đứng đỗ tại bến/trạm, thời gian dựng khách suy từ
//                    số bến (baySlots) chứ không gõ số phút
//
// HỢP ĐỒNG: module KHÔNG tự sở hữu đồng hồ. Nó trả về `timeScale` và
// `delayMinutes`; `main.js` đẩy vào `LightingSystem` (thêm hàm
// `addGameMinutes`). Nhờ vậy `getGameTime()` của LightingSystem giữ nguyên
// API contract.
// =====================================================================

// --- HẰNG SỐ ĐỊNH NGHĨA (mọi con số đều có lý do vật lý, không phải lịch) ---

// Tốc độ tham chiếu của xe khách trên hành lang (km/h): trung bình giữa
// đoạn cao tốc 90 và đoạn phố 25, có tính cả đoạn núi Đèo Cả / Vĩnh Hảo.
// Dùng làm MỐC so sánh, không dùng để nhân thời gian.
export const REF_SPEED_KMH = 62;

// 1 giây thực ăn bao nhiêu phút game khi xe chạy đúng tốc độ tham chiếu.
// 0.9 => tuyến 636 km mất ~636/62 h thực ≈ 10.3 h, đồng hồ chạy ~9.2 h.
export const BASE_SCALE = 0.9;

// Sức cản leo dốc của xe khách tải trọng (giảm tốc độ trên 1% dốc).
// speedFactor = 1 / (1 + CLIMB_K * doDoc%)  -> dốc 10% còn 64% tốc độ.
export const CLIMB_K = 0.055;
// Xuống dốc: xe phải hãm, tốc độ giảm nhẹ (kẹp trống, nhiệt phanh).
export const DESCEND_K = 0.018;

// Chạy ngoài mặt đường (đất, ruộng): tốc độ và độ bám đều tụt.
export const OFFROAD_FACTOR = 0.35;
export const OFFROAD_KMH = 25;

// Ngưỡng coi là "kẹt". Dưới mức này ngoài bến = ùn tắc giao thông.
export const CONGEST_KMH = 5;
// Phút game cộng thêm cho mỗi giây thực bị kẹt.
export const CONGEST_MIN_PER_S = 0.28;

// Dừng chờ tại nút giao, tính theo cấp đường CAO NHẤT tại nút (giây).
// Nút 3 nhánh trên QL chờ ít; ngã tư phố chờ nhiều. Suy từ quy tắc giao thông
// (giảm tốc ở giao lộ phức tạp), không phải bảng số theo tên địa danh.
export const JUNCTION_DWELL_S = {
    EXPRESSWAY: 6, TUNNEL: 4, RAMP: 3,
    NATIONAL: 14, PROVINCIAL_ROAD: 12, ARTERIAL: 16, COLLECTOR: 14,
    INTER_VILLAGE: 9, INDUSTRIAL_ACCESS: 8, COMMERCIAL: 18,
    LOCAL: 10, RURAL_LOCAL: 8, RESIDENTIAL: 12,
    STATION_ACCESS: 4, SERVICE: 8, ALLEY: 6, INTERNAL: 4,
    AGRICULTURAL: 8, OFFROAD: 4
};

// Dừng đỗ tại bến: phút game / giây thực đang đứng trong vùng bến.
export const STATION_MIN_PER_S = 1.0;
// Cộng thêm 1 lần khi rời bến: thời gian chốt hành lý + lập bảng chạy.
// Tính theo QUY MÔ bến (số bến đỗ), không gõ sẵn theo tên bến.
export const STATION_DEPART_MIN_PER_BAY = 0.35;
export const STATION_BASE_DEPART_MIN = 2.0;

// Bán kính coi là "đã đi qua nút giao" (m) và bán kính vùng bến (m).
export const JUNCTION_HIT_R = 16;

// Chu kỳ lấy trung bình độ mượt (giây) — tránh timeScale nhảy theo từng frame.
const SPEED_EMA_TAU = 1.2;
const GRADE_EMA_TAU = 2.5;
// Quãng đường tối thiểu trước khi cập nhật độ dốc (m) — mẫu quá gần thì
// nhiễu do mặt đường gợn sóng, không phải đèo.
const GRADE_SAMPLE_M = 14;

export class TravelClock {
    /**
     * @param {object} o
     * @param {import("./RuntimeRoadGraph.js").RuntimeRoadGraph} o.roadGraph
     * @param {(x:number,z:number)=>number} o.getHeight  cao độ mặt đường
     */
    constructor({ roadGraph, getHeight, baseScale = BASE_SCALE, refSpeedKmh = REF_SPEED_KMH } = {}) {
        this.graph = roadGraph || null;
        this.getHeight = typeof getHeight === "function" ? getHeight : null;
        this.baseScale = baseScale;
        this.refSpeedKmh = refSpeedKmh;
        this.reset();
        this._buildJunctionIndex();
    }

    reset() {
        this.distanceM = 0;
        this.realSeconds = 0;
        this.gameMinutes = 0;
        this.junctionsPassed = 0;
        this.stationsServed = 0;
        this.timeScale = this.baseScale;
        this.roadClass = "OFFROAD";
        this.designKmh = OFFROAD_KMH;
        this.gradePct = 0;
        this.achieveRatio = 0;
        this.dwellReason = "";
        this._last = null;          // { x, z, y }
        this._gradeAcc = { y: 0, dist: 0 };
        this._gradeEma = 0;
        this._speedEma = 0;
        this._prevNodeId = null;
        this._hitCooldown = 0;
        this._stalledS = 0;
        this._inStation = null;     // poi đang đứng
        this._stationEntered = false;
    }

    /**
     * Lưới toạ độ CHỈ chứa nút giao (bậc >= 3). Số nút nhỏ hơn nodes nhiều,
     * tra cứu O(1) mỗi tick thay vì quét 8000 node.
     * KHÔNG phải hệ thống song song: đây là chỉ mục tra cứu nội bộ, dữ liệu
     * gốc vẫn là `graph.nodes` + `graph.segments`.
     */
    _buildJunctionIndex(cell = 256) {
        this._jcell = cell;
        this._jgrid = new Map();
        this._jdeg = new Map();
        if (!this.graph) return;
        const deg = new Map();
        for (const s of this.graph.segments) {
            deg.set(s.from, (deg.get(s.from) || 0) + 1);
            deg.set(s.to, (deg.get(s.to) || 0) + 1);
        }
        this._nodeClass = new Map();     // node -> class đường cao nhất chạm
        for (const s of this.graph.segments) {
            const c = s.class || "LOCAL";
            const a = this._nodeClass.get(s.from);
            const b = this._nodeClass.get(s.to);
            if (a === undefined || c > a) this._nodeClass.set(s.from, c);
            if (b === undefined || c > b) this._nodeClass.set(s.to, c);
        }
        for (const [nid, d] of deg) {
            this._jdeg.set(nid, d);
            if (d < 3) continue;
            const n = this.graph.getNode(nid);
            if (!n) continue;
            const k = Math.floor(n.x / cell) + "," + Math.floor(n.z / cell);
            let arr = this._jgrid.get(k);
            if (!arr) { arr = []; this._jgrid.set(k, arr); }
            arr.push(nid);
        }
    }

    /** Đoạn đường gần (x,z) nhất trong bán kính r, kèm khoảng cách (m). */
    _nearestSegment(x, z, r) {
        if (!this.graph || !this.graph.segmentsNear) return null;
        const list = this.graph.segmentsNear(x, z, r);
        let best = null, bestD = Infinity;
        for (const s of list) {
            const a = this.graph.getNode(s.from), b = this.graph.getNode(s.to);
            if (!a || !b) continue;
            const dx = b.x - a.x, dz = b.z - a.z;
            const l2 = dx * dx + dz * dz || 1;
            let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = x - (a.x + dx * t), ez = z - (a.z + dz * t);
            const d2 = ex * ex + ez * ez;
            if (d2 < bestD) {
                bestD = d2;
                // `roadY` = cao độ mặt đường tại đúng điểm chiếu (node.y đã
                // gồm ROAD_LIFT). Cầu/hầm cũng lấy từ node.y => đúng độ dốc
                // mà xe thực sự chạy, không phải độ dốc địa hình bên dưới.
                const ay = (a.y !== undefined ? a.y : 0);
                const by = (b.y !== undefined ? b.y : 0);
                best = { seg: s, dist: Math.sqrt(d2), roadY: ay + (by - ay) * t };
            }
        }
        return best;
    }

    /** Nút giao gần nhất (bậc >= 3) trong bán kính r, kèm khoảng cách. */
    _nearestJunction(x, z, r) {
        if (!this._jgrid) return null;
        const c = this._jcell, r2 = r * r;
        const c0x = Math.floor((x - r) / c), c1x = Math.floor((x + r) / c);
        const c0z = Math.floor((z - r) / c), c1z = Math.floor((z + r) / c);
        let best = null, bestD = Infinity;
        for (let cx = c0x; cx <= c1x; cx++) {
            for (let cz = c0z; cz <= c1z; cz++) {
                const arr = this._jgrid.get(cx + "," + cz);
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) {
                    const nid = arr[i];
                    const n = this.graph.getNode(nid);
                    if (!n) continue;
                    const d2 = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
                    if (d2 < bestD) { bestD = d2; best = { id: nid, dist: Math.sqrt(d2) }; }
                }
            }
        }
        return bestD <= r2 ? best : null;
    }

    /** Điểm (x,z) có nằm trong hình chữ nhật xoay của POI không? */
    _insidePoi(poi, x, z) {
        const dx = x - poi.position.x, dz = z - poi.position.z;
        const hw = Math.max(6, (poi.size?.width || 20) * 0.5);
        const hd = Math.max(6, (poi.size?.depth || 20) * 0.5);
        // mở rộng 6m: lề sân bến + đường nội bộ cũng tính là "đang ở bến"
        const rot = poi.rotation || 0;
        const c = Math.cos(-rot), s = Math.sin(-rot);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        return Math.abs(lx) <= hw + 6 && Math.abs(lz) <= hd + 6;
    }

    /**
     * Cập nhật 1 tick.
     * @param {number} dt   thời gian thực (giây)
     * @param {{x:number,z:number,speedKmh:number}} ctx
     * @returns {{timeScale:number, delayMinutes:number}}
     */
    update(dt, ctx) {
        if (!dt || !ctx) return { timeScale: this.timeScale, delayMinutes: 0 };
        this.realSeconds += dt;
        const x = ctx.x, z = ctx.z;
        const speedKmh = Math.abs(ctx.speedKmh || 0);

        // ---------------- 2. ROAD TYPE (trước DISTANCE: cần y của mặt đường) ----
        // `r` = 26m là đủ cho xe khách lấn sang làn phụ mà vẫn là "trên mặt
        // đường"; ngoài bán kính này coi như chạy đất.
        const near = this._nearestSegment(x, z, 26);
        const onRoad = !!(near && near.dist <= (near.seg.width || 12) * 0.5 + 6);
        let y;
        if (onRoad) {
            this.roadClass = near.seg.class || "LOCAL";
            const meta = this.graph ? this.graph.getLaneMeta(near.seg) : null;
            this.designKmh = (meta && meta.speedKmh) || OFFROAD_KMH;
            // cao độ MẶT ĐƯỜNG = nội suy y hai node đầu (node.y đã gồm
            // ROAD_LIFT của generator). Dùng terrain thay vì node.y thì lấy
            // phải gợn sóng của địa hình -> "độ dốc" toàn tín hiệu nhiễu và
            // đồng hồ rung theo sóng cát.
            y = near.roadY;
        } else {
            this.roadClass = "OFFROAD";
            this.designKmh = OFFROAD_KMH;
            y = this.getHeight ? this.getHeight(x, z) : 0;
        }

        // ---------------- 1. DISTANCE ----------------
        let stepM = 0;
        if (this._last) {
            stepM = Math.hypot(x - this._last.x, z - this._last.z);
            // rung tay ga/số lùi làm bước nhỏ -> coi như đứng yên
            if (stepM < 0.02) stepM = 0;
            this.distanceM += stepM;
        }
        this._last = { x, z, y };

        // ---------------- 3. + 4. SPEED x TERRAIN ----------------
        // độ dốc: lấy mẫu trên mặt đường (node.y / getHeight trả cao độ
        // đường), chống nhiễu bằng cách chỉ cập nhật sau GRADE_SAMPLE_M.
        if (this._gradeAcc.dist >= GRADE_SAMPLE_M) {
            const raw = (y - this._gradeAcc.y) / Math.max(1e-3, this._gradeAcc.dist);
            const a = Math.min(1, this._gradeAcc.dist / 40);
            this._gradeEma = this._gradeEma * (1 - a) + raw * a;
            this._gradeAcc.y = y;
            this._gradeAcc.dist = 0;
        } else {
            this._gradeAcc.dist += stepM;
        }
        this.gradePct = this._gradeEma * 100;
        const up = Math.max(0, this.gradePct), down = Math.max(0, -this.gradePct);
        const gradeFactor = 1 / (1 + CLIMB_K * up + DESCEND_K * down);

        // hệ số "đạt được" = vận tốc thực / vận tốc thiết kế của loại đường.
        // đây chính là biến URBAN DELAY: kẹt xe trong phố -> tỉ lệ ~0.1,
        // chạy êm trên QL -> ~0.95.
        const ratioRaw = onRoad ? speedKmh / Math.max(5, this.designKmh) : 0;
        const aS = Math.min(1, dt / SPEED_EMA_TAU);
        this._speedEma = this._speedEma * (1 - aS) + ratioRaw * aS;
        this.achieveRatio = this._speedEma;

        const surface = onRoad ? 1 : OFFROAD_FACTOR;
        const vEff = speedKmh * gradeFactor * surface;

        // đồng hồ: càng đi nhanh càng trôi nhanh. Chặn hai đầu để kẹt xe
        // 30 phút không làm đồng hồ đứng yên, và bùng nổ tốc độ không làm
        // nhảy sang đêm.
        const rawScale = this.baseScale * (vEff / this.refSpeedKmh);
        this.timeScale = Math.max(0.12, Math.min(3.0, rawScale));

        // ---------------- 5. INTERSECTION ----------------
        let delayMinutes = 0;
        let dwellReason = "";
        this._hitCooldown = Math.max(0, this._hitCooldown - dt);
        const jn = this._nearestJunction(x, z, JUNCTION_HIT_R);
        if (jn && jn.id !== this._prevNodeId && this._hitCooldown <= 0) {
            const cls = this._nodeClass.get(jn.id) || this.roadClass;
            const dwellS = JUNCTION_DWELL_S[cls] !== undefined
                ? JUNCTION_DWELL_S[cls] : JUNCTION_DWELL_S.LOCAL;
            // nút 4-5 nhánh tốn lâu hơn nút 3 nhánh
            const deg = this._jdeg.get(jn.id) || 3;
            const busy = Math.min(2.2, 1 + (deg - 3) * 0.3);
            delayMinutes += (dwellS * busy) / 60;
            this.junctionsPassed++;
            dwellReason = `giao lộ ${cls.toLowerCase()} (${deg} nhánh)`;
            this._hitCooldown = 1.0;   // chống đếm 1 lần cho nhiều frame
        }
        if (jn) this._prevNodeId = jn.id;

        // ---------------- 6. URBAN DELAY (kẹt xe) ----------------
        // đứng yên NGOÀI bến mà tốc độ < ngưỡng => ùn tắc, cộng phút.
        // Trong bến thì phần này giao cho mục 7, tránh cộng hai lần.
        const station = this._findStation(x, z);
        const stopped = speedKmh < CONGEST_KMH;
        if (stopped && !station) {
            this._stalledS += dt;
            // 2 giây đầu là do phanh/đỗi, chưa tính là kẹt
            if (this._stalledS > 2.0) {
                const w = Math.min(4, densityWeight(this.roadClass));
                delayMinutes += CONGEST_MIN_PER_S * dt * w;
                dwellReason = `kẹt xe ${this.roadClass.toLowerCase()}`;
            }
        } else {
            this._stalledS = 0;
        }

        // ---------------- 7. STATION DELAY ----------------
        if (station) {
            if (!this._stationEntered) {
                this._stationEntered = true;
                this.stationsServed++;
                const bays = Math.max(1, station.busBays?.length || station.bays || 1);
                // điều kiện hoàn tất dỡ/chất: đứng >= thời gian dựng
                // tương đương số bến, KHÔNG phải số phút gõ sẵn.
                this._stationNeedS = Math.min(
                    12, STATION_BASE_DEPART_MIN * 60 / STATION_MIN_PER_S +
                    bays * STATION_DEPART_MIN_PER_BAY * 60 / STATION_MIN_PER_S);
                this._stationBays = bays;
                this._stationHeldS = 0;
            }
            if (stopped) {
                this._stationHeldS += dt;
                delayMinutes += STATION_MIN_PER_S * dt;
                dwellReason = `đứng tại ${station.name || station.id}` +
                    ` (${this._stationBays} bến)`;
            }
            if (this._stationHeldS >= this._stationNeedS) {
                // cộng một lần lúc rời bến, tính theo quy mô bến
                delayMinutes += STATION_BASE_DEPART_MIN +
                    STATION_DEPART_MIN_PER_BAY * this._stationBays;
                dwellReason = `rời ${station.name || station.id}`;
                this._stationEntered = false;
                this._stationHeldS = 0;
            }
        } else if (this._stationEntered && !stopped) {
            // rời bến khi đã đứng đủ -> kết thúc phiên bến (không cộng thêm,
            // vì phần rời bến đã cộng ở nhánh trên khi đủ thời gian).
            this._stationEntered = false;
            this._stationHeldS = 0;
        }

        this.dwellReason = dwellReason;
        this.gameMinutes += dt * this.timeScale + delayMinutes;
        return { timeScale: this.timeScale, delayMinutes };
    }

    /** POI bến / trạm / điểm dừng mà (x,z) đang nằm trong. */
    _findStation(x, z) {
        const pois = this.graph?.pois;
        if (!pois || !pois.length) return null;
        if (!this._stationIdx) {
            // chỉ những POI thật sự làm xe phải DỪNG ĐỖ, không phải bảng
            // hiệu dẫn đường. SCHOOL/MARKET/HOSPITAL là mốc địa lý, xe chạy
            // qua chứ không ghé.
            const DWELL = new Set(["BUS_STATION", "MAJOR_BUS_TERMINAL",
                "BUS_STOP", "REST_AREA", "FUEL_STATION", "TOLL"]);
            this._stationIdx = [];
            for (const p of pois) {
                if (!DWELL.has(p.type)) continue;
                this._stationIdx.push({
                    id: p.id, type: p.type, name: p.name,
                    position: p.position, size: p.size, rotation: p.rotation,
                    busBays: p.busBays, bays: p.bays
                });
            }
        }
        for (const p of this._stationIdx) {
            if (this._insidePoi(p, x, z)) return p;
        }
        return null;
    }

    /** Thống kê hành trình — dùng cho HUD và để kiểm chứng.
     *
     *  PHÂN BIỆT HAI "GIỜ" (đo được nhầm lẫn rất dễ):
     *   - `avgKmh`     = quãng đường / GIỜ THỰC. Đây là tốc độ bình quân mà
     *                   người chơi tự kiểm được bằng đồng hồ dừng, nên đây mới
     *                   là con số ghi "km/h" trên HUD.
     *   - `gameAvgKmh` = quãng đường / GIỜ GAME. Vì đồng hồ game chạy nhanh
     *                   hơn thực (~0.9-1.0 phút/giây) nên con số này NHỎ HƠN
     *                   nhiều lần. Bản trước gộp 2 cái này làm, dán nhãn
     *                   "km/h", ra số nhỏ hơn 60 lần và trông như xe đứng.
     */
    getStats() {
        const realH = this.realSeconds / 3600;
        const gameH = this.gameMinutes / 60;
        return {
            distanceKm: this.distanceM / 1000,
            elapsedRealS: this.realSeconds,
            gameMinutes: this.gameMinutes,
            avgKmh: realH > 1e-6 ? (this.distanceM / 1000) / realH : 0,
            gameAvgKmh: gameH > 1e-6 ? (this.distanceM / 1000) / gameH : 0,
            timeScale: this.timeScale,
            roadClass: this.roadClass,
            designKmh: this.designKmh,
            gradePct: this.gradePct,
            achieveRatio: this.achieveRatio,
            junctionsPassed: this.junctionsPassed,
            stationsServed: this.stationsServed,
            dwellReason: this.dwellReason
        };
    }
}

// Mật độ giao thông làm kẹt nặng hơn — cùng logic với DENSITY_BY_CLASS của
// RuntimeRoadGraph nhưng chỉ lấy THỨ HẠNG, không nhân bản bảng tốc độ.
function densityWeight(cls) {
    switch (cls) {
        case "EXPRESSWAY": case "NATIONAL": case "ARTERIAL": return 1.0;
        case "COLLECTOR": case "PROVINCIAL_ROAD": case "COMMERCIAL": return 1.1;
        case "RAMP": case "TUNNEL": return 0.6;
        case "LOCAL": case "RESIDENTIAL": return 1.3;
        case "INTER_VILLAGE": case "RURAL_LOCAL": return 0.9;
        case "SERVICE": case "INDUSTRIAL_ACCESS": return 0.8;
        case "ALLEY": case "AGRICULTURAL": case "OFFROAD": return 0.4;
        default: return 0.7;
    }
}
