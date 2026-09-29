// js/map.js — BUSDRIVEVN WORLD RUNTIME
// =============================================================================
// Vai trò: load + stream + render world 3D (terrain thật, road network, bến xe,
//          building, vật thể dọc đường) và cung cấp API contract cho game.
//
// API CONTRACT (KHÔNG ĐƯỢC ĐỔI — main.js / npc.js / ui.js / traffic/* dùng):
//   new MapLoader(scene)            -> loadInitialData()
//   getTerrainHeight(x, z)          -> number   (main.js mỗi frame)
//   getHeight(x, z)                 -> alias của getTerrainHeight
//   getSpawnPoint()                 -> {x,y,z,heading}
//   getRoadGraph()                  -> RuntimeRoadGraph (nodes/segments/pois)
//   getMinimapData()                -> {segments, route, pois}
//   getParkingSlots()               -> [{position:{x,y,z}, rotation}]
//   getRouteWaypoints() / getPOIs()
//   updateChunks(x, z, dt?, camDir?) | setPlayerPosition(x, z, dt?, camDir?)
//   dispose()
//
// NGUỒN SỰ THẬT: tools/map_generator.py (SOURCE OF TRUTH)
//   world.json.terrain = { coast, corridor:[x,z,u], anchors, roadLift, yardLift }
//   -> getElevation() ở đây COPY NGUYÊN VĂN công thức Python, nên
//      terrain (JS) == node.y (Python) == mặt đường => XE KHÔNG BAY, KHÔNG CHÌM.
//
// LỚP Y (rule 38):
//   terrainY  = getElevation(x,z)
//   road top  = node.y + ROAD_LIFT      (nổi nhẹ -> không z-fighting)
//   yard      = node.y + YARD_LIFT
//   bus       = getTerrainHeight(x,z) + 0.5   (main.js)
//
// RULE 44: mọi fetch chunk có try/catch/finally, in-flight luôn được giải phóng.
// RULE 50: merge geometry + InstancedMesh + pooling, KHÔNG tạo mesh/segment.
//
// DỮ LIỆU CHUNK (v2): generator gom 4x4 chunk (1024m) vào 1 file "sectors/x_z.json"
//   thay vì 1 file/chunk (14k file -> ~1.9k file). world.json có
//   sectorSize + sectorIndex (tên file có sẵn) để skip 404.
//   => _fetchSector() + cache LRU 6 sector. Vẫn giữ đường chunk cũ (fallback).
//
// HỖ TRỢ ĐỊA HÌNH (mirror Python):
//   sông/hồ  : world.water -> waterFactor() khắc lòng sông + vẽ mặt nước
//   cầu      : seg.bridge -> mặt cầu + lan can + trụ
//   hầm      : seg.class === "TUNNEL" -> vỏ hầm + 2 cổng hầm
//   chi tiết : đèn đường, vạch sơn, vỉa hè, bảng hiệu + mái hiên, lan can,
//              điểm dừng xe buýt, trạm thu phí (thi trường 1 lần, không lặp)
// =============================================================================

import * as THREE from "three";
import { RuntimeRoadGraph } from "./RuntimeRoadGraph.js";

const DATA_PATH = "generated/maps/";

// ---- streaming / chunk infrastructure (chunk là HẠ TẦNG, không phải địa lý) ----
const CHUNK_SIZE = 256;
const LOAD_RADIUS = 6;
const RENDER_RADIUS_MAX = 5;   // <= fog far (1450m)
const RENDER_RADIUS_MIN = 3;
const UNLOAD_RADIUS = 9;
const MAX_LOAD_PER_TICK = 4;
const STREAM_INTERVAL = 0.2;   // throttle: không update 60 lần/s
const TERRAIN_SEG = 32;        // 32x32 quad / chunk terrain (vong gan)
const TERRAIN_SEG_LOD = 16;    // vong xa (bi fog che)
const ACC_CELL = 4096;         // cell của spatial index (mirror Python)

// ---- lớp Y (mirror Python) ----
const ROAD_LIFT = 0.12;
const YARD_LIFT = 0.10;
const BUS_AXLE = 0.5;
// P41 — BỀ DÀY THÂN ĐƯỜNG. Đường là KHỐI, không phải texture: mặt trên +
// váy bên xuống. 0.55m = bề dày nền đường sau vỉa.
const ROAD_THICK = 0.55;
// Bán kính dò mặt đường quanh xe. Rộng hơn "width*0.5+2" của
// `_nearestRoad` vì phải dò NHIỀU mặt đường (kể cả mặt thấp hơn) rồi chọn
// theo tính liên tục — không thể chỉ nhìn "cái gần nhất".
const SURFACE_REACH = 34.0;


// =============================================================================
// MATH — mirror tools/map_generator.py
// =============================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);   // phan thuc cua 1
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(e0, e1, x) {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}

function fbm(x, z) {
    return Math.sin(x * 0.000037 + z * 0.000021) * 1.00 +
           Math.sin(x * 0.000091 - z * 0.000073) * 0.55 +
           Math.sin(x * 0.000210 + z * 0.000170) * 0.30 +
           Math.sin(x * 0.000470 - z * 0.000530) * 0.16 +
           Math.sin(x * 0.001130 + z * 0.000970) * 0.08;
}

function fbmSmall(x, z) {
    return Math.sin(x * 0.0113 + z * 0.0091) * 0.6 +
           Math.sin(x * 0.0271 - z * 0.0313) * 0.4;
}

// =============================================================================
// WORLD — terrain source of truth (đọc từ world.json.terrain)
// =============================================================================
class World {
    constructor(data) {
        this.seaLevel = 0.05;
        this.seaFloor = -11;
        this.coast = [];
        this.corridor = [];
        this.anchors = [];
        this.roadLift = ROAD_LIFT;
        this.yardLift = YARD_LIFT;
        this._accCorridor = new Map();
        this._accCoast = new Map();
        // SONG / HO - mirror Python: khac terrain + render mat nuoc
        const w = data.water || {};
        this.rivers = (w.rivers || []).map(r => ({
            name: r.name, width: r.width || 100,
            poly: (r.poly || []).map(p => [p[0], p[1]])
        }));
        this.lakes = (w.lakes || []).map(l => ({
            name: l.name, x: l.x, z: l.z, rx: l.rx, rz: l.rz, rot: l.rot || 0
        }));
        this._waterAcc = new Map();
        this.load(data);
    }

    load(data) {
        if (!data) return;
        this.seaLevel = typeof data.seaLevel === "number" ? data.seaLevel : 0.05;
        this.seaFloor = typeof data.seaFloor === "number" ? data.seaFloor : -11;
        const t = data.terrain || {};
        this.coast = (t.coast || []).map(p => [p[0], p[1]]);
        // corridor dạng [x, z, u] — u là blend chỉ số anchor (như Python)
        this.corridor = t.corridor || [];
        this.anchors = t.anchors || [];
        // BẢNG u(z) + CÁC BIN MÂU THUẪN do generator export.
        // Không có 2 dòng này thì JS phải TỰ DỰNG LẠI bảng u từ corridor đã
        // làm tròn 1e-8 — tức là 2 bản độc lập của cùng 1 bảng, lệch nhau
        // 2.26m ở u => arid/mountain/urban/uplift lệch theo => cao độ lệch
        // 39.8m => XE BAY/CHÌM. Generator là nguồn duy nhất (luật 3).
        this._uzExported = Array.isArray(t.uz) ? t.uz.map(p => [p[0], p[1]]) : null;
        this._uzAmbigExported = Array.isArray(t.uzAmbig) ? new Set(t.uzAmbig) : null;
        if (typeof t.roadLift === "number") this.roadLift = t.roadLift;
        if (typeof t.yardLift === "number") this.yardLift = t.yardLift;
        this._buildAccel();
    }

    _buildAccel() {
        this._accCorridor.clear();
        this._accCoast.clear();
        for (let i = 0; i < this.corridor.length; i++) {
            const p = this.corridor[i];
            const k = this._cellKey(p[0], p[1]);
            let a = this._accCorridor.get(k);
            if (!a) { a = []; this._accCorridor.set(k, a); }
            a.push(i);
        }
        for (let i = 0; i < this.coast.length; i++) {
            const p = this.coast[i];
            const k = this._cellKey(p[0], p[1]);
            let a = this._accCoast.get(k);
            if (!a) { a = []; this._accCoast.set(k, a); }
            a.push(i);
        }
        // bảng u theo z (bin + median, đơn điệu tăng) — mirror Python._build_u_table()
        // ⚠ _buildUTable() TỰ gán this._uz bên trong và KHÔNG return giá trị.
        // Không được gán lại: `this._uz = this._buildUTable()` sẽ ghi đè bằng
        // undefined và giết bảng u => mọi điểm ngoài "bin mâu thuận" coi u = 0
        // => terrain JS lệch tới 91m so với Python => XE KHÔNG BÁM ĐƯỜNG.
        if (this._uzExported && this._uzExported.length) {
            // generator đã export sẵn bảng u + bin mâu thuận -> DÙNG THẲNG.
            this._uz = this._uzExported;
            this._uzAmbig = this._uzAmbigExported || new Set();
        } else {
            // world.json cũ chưa có `uz` -> dựng lại từ corridor (chỉ để data
            // cũ còn chạy; sau khi generator chạy lại là nhánh này chết).
            this._buildUTable();
        }
        this._buildWaterIndex();
    }

    // index nhanh cho song/ho (cell 4096) — mirror Python._build_water_index
    _buildWaterIndex() {
        this._waterAcc = new Map();
        for (let ri = 0; ri < this.rivers.length; ri++) {
            const poly = this.rivers[ri].poly;
            for (let i = 0; i < poly.length; i++) {
                const k = this._cellKey(poly[i][0], poly[i][1]);
                let a = this._waterAcc.get(k);
                if (!a) { a = []; this._waterAcc.set(k, a); }
                a.push([ri, i]);
            }
        }
        for (let li = 0; li < this.lakes.length; li++) {
            const lk = this.lakes[li];
            const k = this._cellKey(lk.x, lk.z);
            let a = this._waterAcc.get(k);
            if (!a) { a = []; this._waterAcc.set(k, a); }
            a.push([-1, li]);
        }
    }

    // 0 = ngoài nước, 1 = giữa lòng sông/hồ — mirror Python.water_factor
    waterFactor(x, z) {
        if (!this.rivers.length && !this.lakes.length) return 0;
        let best = 0;
        const cx = Math.floor(x / ACC_CELL) + 1048576;
        const cz = Math.floor(z / ACC_CELL) + 1048576;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const arr = this._waterAcc.get((cx + dx) * 2097152 + (cz + dz));
                if (!arr) continue;
                for (const [ri, i] of arr) {
                    if (ri < 0) {
                        const lk = this.lakes[i];
                        const ca = Math.cos(lk.rot), sa = Math.sin(lk.rot);
                        const ox = x - lk.x, oz = z - lk.z;
                        const uu = (ox * ca + oz * sa) / lk.rx;
                        const vv = (-ox * sa + oz * ca) / lk.rz;
                        const r = Math.sqrt(uu * uu + vv * vv);
                        if (r < 1.15) best = Math.max(best, clamp(1.15 - r, 0, 1));
                        continue;
                    }
                    const r = this.rivers[ri];
                    const poly = r.poly;
                    if (i >= poly.length - 1) continue;
                    const a = poly[i], b = poly[i + 1];
                    const dax = b[0] - a[0], daz = b[1] - a[1];
                    const l2 = dax * dax + daz * daz;
                    if (l2 <= 0) continue;
                    const t = clamp(((x - a[0]) * dax + (z - a[1]) * daz) / l2, 0, 1);
                    const ex = x - (a[0] + dax * t), ez = z - (a[1] + daz * t);
                    const d = Math.sqrt(ex * ex + ez * ez);
                    const half = r.width * 0.5;
                    if (d < half * 1.25) best = Math.max(best, clamp(1 - d / (half * 1.15), 0, 1));
                }
            }
        }
        return best;
    }

    _buildUTable(binM = 250) {
        // Median theo bin + đánh dấu bin MÂU THUẬN. KHÔNG ép đơn điệu toàn cục.
        // Cần phần "mâu thuận" vì QL.1 thật đi từ Phan Thiết sang Dầu Giây theo
        // hướng TÂY BẮC (z tăng lại) => z KHÔNG đơn điệu. Ở bin có 2 nhánh
        // corridor, bảng u(z) không quyết định được -> fallback nearest-point.
        //
        // ⚠ PARITY: bin key phải KHỚP với Python.int(math.floor(z / binM)).
        // Python int() TRUNC về 0 cho số âm, còn Math.floor() LÀM TRÒN XUỐNG.
        // Với z âm (khu Phan Thiet/Dau Giay) 2 cách ra key khác nhau ->
        // 2 bảng u khác nhau -> terrain lệch tới 91m -> XE KHÔNG BÁM ĐƯỜNG.
        // => dùng trunc về 0.
        const bins = new Map();
        for (const p of this.corridor) {
            const q = p[1] / binM;
            const k = q < 0 ? Math.ceil(q) : Math.floor(q);   // == int() cua Python
            let a = bins.get(k);
            if (!a) { a = []; bins.set(k, a); }
            a.push(p[2]);
        }
        if (bins.size === 0) { this._uz = []; this._uzAmbig = new Set(); return; }
        let loK = Infinity, hiK = -Infinity;
        for (const k of bins.keys()) { if (k < loK) loK = k; if (k > hiK) hiK = k; }
        const table = [];
        const ambig = new Set();
        let last = null;
        for (let k = loK; k <= hiK; k++) {
            const us = bins.get(k);
            let u = null;
            if (us) {
                let loU = Infinity, hiU = -Infinity;
                for (const v of us) { if (v < loU) loU = v; if (v > hiU) hiU = v; }
                if (hiU - loU > 0.6) ambig.add(k);
                us.sort((a, b) => a - b);
                u = us[Math.floor(us.length / 2)];
            } else if (last !== null) {
                // EP TANG DAN DOMAT (xem ghi chu ham): corridor di tu Phu Yen
                // (z=+7042, u=0) xuong HCM (z=-246838, u=30) => u GIAM khi z
                // TANG. Ep `u >= last` se ghim TOAN BO bang o 29.974 => 19/31
                // moc dia ly tra ve "HCM_Core_South" => terrain mat vung: khong
                // nui Deo Ca, khong kho Phan Rang, khong bien Nha Trang
                // (rule 19/20/43). Median tung bin van dung vi corridor la
                // duong 1 chi; bin nhieu nhanh da danh dau `ambig`.
                u = last;
            } else {
                continue;
            }
            table.push([k * binM + binM * 0.5, u]);
            last = u;
        }
        this._uz = table;
        this._uzAmbig = ambig;
    }

    // u theo diem corridor gan nhat, lam tron 3 diem (chong nhay o medial axis)
    _uNearest(x, z) {
        const poly = this.corridor;
        if (poly.length < 2) return 0;
        let best = Infinity, bi = 0;
        const idx = this._accNear(this._accCorridor, x, z, poly.length);
        for (let k = 0; k < idx.length; k++) {
            const i = idx[k];
            if (i >= poly.length - 1) continue;
            const a = poly[i], b = poly[i + 1];
            const dx = b[0] - a[0], dz = b[1] - a[1];
            const l2 = dx * dx + dz * dz;
            if (l2 <= 0) continue;
            const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
            const d2 = (x - (a[0] + dx * t)) ** 2 + (z - (a[1] + dz * t)) ** 2;
            if (d2 < best - 1e-6 || (Math.abs(d2 - best) <= 1e-6 && i < bi)) {
                best = d2; bi = i;
            }
        }
        let sum = 0, n = 0;
        for (let j = bi - 1; j <= bi + 1; j++) {
            if (j >= 0 && j < poly.length) { sum += poly[j][2]; n++; }
        }
        return n ? sum / n : 0;
    }

    // u = nội suy theo bảng bin-median; bin mâu thuận -> nearest-point
    _uAtZ(z, x) {
        const uz = this._uz;
        if (!uz || uz.length === 0) return 0;
        const q = z / 250;
        const kb = q < 0 ? Math.ceil(q) : Math.floor(q);   // == int() cua Python
        if (x !== undefined && this._uzAmbig && this._uzAmbig.has(kb)) {
            return this._uNearest(x, z);
        }
        if (uz.length < 2) return uz[0][1];
        let lo, hi;
        if (z <= uz[0][0]) { lo = 0; hi = 1; }
        else if (z >= uz[uz.length - 1][0]) { lo = uz.length - 2; hi = uz.length - 1; }
        else {
            lo = 0; hi = uz.length - 1;
            while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1;
                if (uz[mid][0] <= z) lo = mid; else hi = mid;
            }
        }
        const z0 = uz[lo][0], u0 = uz[lo][1];
        const z1 = uz[hi][0], u1 = uz[hi][1];
        if (z1 === z0) return u0;
        return lerp(u0, u1, (z - z0) / (z1 - z0));
    }

    // KEY SO (khong phai string): "x,z" ton ~20ns moi lan, day la ham GIOI HAN
    // cua moi truy van terrain (1089 lan/chunk). Key so ~3ns.
    _cellKey(x, z) {
        return (Math.floor(x / ACC_CELL) + 1048576) * 2097152 +
               (Math.floor(z / ACC_CELL) + 1048576);
    }

    // mirror MapGenerator._acc_near(...)
    _accNear(table, x, z, fullLen, want = 48) {
        // BANG NHO (coast 59 diem): quet thang 59 lan BIEN NHIEU hon vie tim
        // trong 169 cell roi fallback. Chi dung index khi bang lon.
        if (fullLen <= 400) {
            const all = new Array(fullLen);
            for (let i = 0; i < fullLen; i++) all[i] = i;
            return all;
        }
        const out = [];
        const cx = Math.floor(x / ACC_CELL) + 1048576;
        const cz = Math.floor(z / ACC_CELL) + 1048576;
        for (let r = 0; r <= 6 && out.length < want; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                    const a = table.get((cx + dx) * 2097152 + (cz + dz));
                    if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
                }
            }
        }
        if (out.length < want) {
            out.length = 0;
            for (let i = 0; i < fullLen; i++) out.push(i);
        }
        return out;
    }

    // > 0 = đất, < 0 = biển (đất nằm PHẢI hướng nam) — giống Python
    distToCoast(x, z) {
        const poly = this.coast;
        if (poly.length < 2) return 1e6;
        let best = Infinity, bi = 0, bt = 0;
        const idx = this._accNear(this._accCoast, x, z, poly.length);
        for (let k = 0; k < idx.length; k++) {
            const i = idx[k];
            if (i >= poly.length - 1) continue;
            const ax = poly[i][0], az = poly[i][1];
            const bx = poly[i + 1][0], bz = poly[i + 1][1];
            const dx = bx - ax, dz = bz - az;
            const l2 = dx * dx + dz * dz;
            if (l2 <= 0) continue;
            const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
            const cx = ax + dx * t, cz = az + dz * t;
            const d2 = (x - cx) ** 2 + (z - cz) ** 2;
            // tie-break chỉ số nhỏ hơn (mirror Python) — nếu không, 2 đoạn
            // kề nhau ở node chung cho cross product khác dấu => d_coast lệch
            if (d2 < best - 1e-6 || (Math.abs(d2 - best) <= 1e-6 && i < bi)) {
                best = d2; bi = i; bt = t;
            }
        }
        const ax = poly[bi][0], az = poly[bi][1];
        const bx = poly[bi + 1][0], bz = poly[bi + 1][1];
        const dx = bx - ax, dz = bz - az;
        const L = Math.sqrt(dx * dx + dz * dz) || 1;
        const cx = ax + dx * bt, cz = az + dz * bt;
        const cross = (dz * (x - cx) - dx * (z - cz)) / L;
        const d = Math.sqrt(best);
        return cross >= 0 ? d : -d;
    }

    // -> [u (blend chỉ số anchor), d (khoảng cách tới trục QL1A)]
    // u từ bảng monotonic theo z (liên tục), d từ nearest-point — mirror Python
    corridorUDist(x, z) {
        const poly = this.corridor;
        if (poly.length < 2) return [0, 1e6];
        let best = Infinity, bestIdx = poly.length;   // tie-break mirror Python
        const idx = this._accNear(this._accCorridor, x, z, poly.length);
        for (let k = 0; k < idx.length; k++) {
            const i = idx[k];
            if (i >= poly.length - 1) continue;
            const ax = poly[i][0], az = poly[i][1];
            const bx = poly[i + 1][0], bz = poly[i + 1][1];
            const dx = bx - ax, dz = bz - az;
            const l2 = dx * dx + dz * dz;
            if (l2 <= 0) continue;
            const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
            const d2 = (x - (ax + dx * t)) ** 2 + (z - (az + dz * t)) ** 2;
            if (d2 < best - 1e-6 || (Math.abs(d2 - best) <= 1e-6 && i < bestIdx)) {
                best = d2; bestIdx = i;
            }
        }
        // ⚠ PHẢI truyền cả x: bin u(z) mâu thuận (corridor đi 2 nhánh cùng z —
        // khu Phan Thiet/Dau Giay) chỉ quyết định được bằng NEAREST-POINT.
        // Thiếu x => u sai ~8 don => terrain lech 89m => XE bay/chim.
        return [this._uAtZ(z, x), Math.sqrt(best)];
    }

    // blend liên tục dọc corridor -> REGION KHÔNG PHẢI Ô VUÔNG (rule 19/20)
    regionParams(x, z) {
        return this.regionParamsWithCoast(x, z, this.distToCoast(x, z));
    }

    // regionParams nhưng tái dùng khoảng cách bờ đã tính (tiết kiệm 1 lượt quét)
    regionParamsWithCoast(x, z, dCoast) {
        const [u, d] = this.corridorUDist(x, z);
        const n = Math.max(1, this.anchors.length - 1);
        const i = clamp(Math.floor(u), 0, n);
        const j = Math.min(i + 1, this.anchors.length - 1);
        // smoothstep => tham số vùng chuyển tiếp MƯỢT, không kẹp tại anchor
        // (linear blend tạo vách đất dốc 40% ngay tại anchor) — mirror Python
        const t = smoothstep(0, 1, clamp(u - i, 0, 1));
        const A = this.anchors[i] || {}, B = this.anchors[j] || {};
        const p = {
            uplift: lerp(A.uplift || 0, B.uplift || 0, t),
            density: lerp(A.density || 0, B.density || 0, t),
            urban: lerp(A.urban || 0, B.urban || 0, t),
            arid: lerp(A.arid || 0, B.arid || 0, t),
            mountain: lerp(A.mountain || 0, B.mountain || 0, t),
            coastal: lerp(A.coastal || 0, B.coastal || 0, t),
            forest: lerp(A.forest || 0, B.forest || 0, t)
        };
        p.inland = Math.max(0, dCoast);
        p.d_corridor = d;
        p.u = u;
        p.nearest = (t < 0.5 ? A : B).name || "";
        p.size = (t < 0.5 ? A : B).size || "none";
        return p;
    }

    // NGUỒN HEIGHT DUY NHẤT — copy y hệt MapGenerator.get_elevation()
    getElevation(x, z) {
        return this.getElevationInfo(x, z).h;
    }

    // Cùng công thức, trả kèm thông tin dùng cho màu terrain (1 lần quét
    // corridor/coast thay vì 2 — quan trọng trên máy yếu).
    getElevationInfo(x, z) {
        const dCoast = this.distToCoast(x, z);
        if (dCoast <= 0) {
            return {
                h: this.seaFloor + 4.0 * fbm(x, z) * 0.5 + Math.max(-4.0, dCoast * 0.05),
                d: dCoast, p: null
            };
        }
        const p = this.regionParamsWithCoast(x, z, dCoast);

        const coastalRamp = smoothstep(0, 700, dCoast) * 2.2;
        const inlandGain = smoothstep(0, 26000, p.inland);
        let regional = p.uplift * (0.35 + 0.65 * inlandGain);

        // massif núi: sóng RỘNG + biên độ CHẶN (fbm biên ±2.09 nên phải clamp)
        // — mirror Python, nếu không đường qua Đèo Cả dốc 40% và xe bay
        if (p.mountain > 0.02) {
            const fb = clamp(fbm(x * 0.30, z * 0.30), -1, 1);
            regional += p.mountain * 150.0 * (0.55 + 0.45 * fb);
        }

        const dCorr = p.d_corridor;
        const flatten = smoothstep(2600, 450, dCorr);
        const roadLift = p.mountain * 62.0 * (1 - smoothstep(600, 1800, dCorr));
        regional = regional * (1 - flatten * 0.94) + roadLift;

        // noise địa hình TẮT gần đường (mirror Python): đường phẳng, xe không rung
        const detail = fbm(x, z) * (5.0 + regional * 0.05);
        let micro = fbmSmall(x, z) * (0.35 + regional * 0.012);
        micro *= (1 - flatten * 0.99);

        const h = (this.seaLevel + coastalRamp + regional +
                   detail * (1 - flatten * 0.985) + micro);
        // KHAAC LANG SONG/HO (mirror Python): ham xuong muc nuoc
        const wf = this.waterFactor(x, z);
        if (wf > 0) {
            const bed = this.seaLevel - 0.2 - 1.6 * wf;
            return { h: lerp(h, bed, clamp(wf * 1.35, 0, 1)), d: dCoast, p };
        }
        return { h, d: dCoast, p };
    }
}

// =============================================================================
// MATERIALS / GEOMETRY SHARED (pooling — không tạo material mỗi chunk)
// =============================================================================
function makeMaterials() {
    // side: DoubleSide cho mặt đường: quad dựng từ hình học thủ công, winding có
    // thể ngược ở vài đoạn — DoubleSide đảm bảo mặt đường LUÔN nhìn thấy từ trên.
    const roadSide = THREE.DoubleSide;
    return {
        asphalt: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.92, side: roadSide }),
        asphaltOld: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95, side: roadSide }),
        highway: new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.9, side: roadSide }),
        median: new THREE.MeshLambertMaterial({ color: 0x9a9a8a, side: roadSide }),
        shoulder: new THREE.MeshLambertMaterial({ color: 0x6b6558, side: roadSide }),
        laneLine: new THREE.MeshLambertMaterial({ color: 0xf0ead0, side: roadSide }),
        // P58: sân bến nằm trên sườn nên có cả mặt dưới; `FrontSide` làm mất
    // mặt khi nhìn từ dưới (và làm lộ tam giac nguoc chieu, P58).
    concrete: new THREE.MeshLambertMaterial({ color: 0x8a8a86, side: THREE.DoubleSide }),
        dirt: new THREE.MeshLambertMaterial({ color: 0x6b5540 }),
        tunnel: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95, side: roadSide }),
        tunnelShell: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.98, side: THREE.BackSide }),
        tunnelPortal: new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.9 }),
        water: new THREE.MeshStandardMaterial({ color: 0x1b4a63, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.86 }),
        sand: new THREE.MeshLambertMaterial({ color: 0xcbb98a }),
        // dùng chung cho InstancedMesh (màu từng instance đi qua instanceColor)
        bldBody: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        bldRoof: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        roadMajor: new THREE.MeshLambertMaterial({ color: 0x33363a, side: roadSide }),
        roadMinor: new THREE.MeshLambertMaterial({ color: 0x5c5a55, side: roadSide }),
        roadHighway: new THREE.MeshLambertMaterial({ color: 0x2f2f34, side: roadSide }),
        roadLocal: new THREE.MeshLambertMaterial({ color: 0x6b5540, side: roadSide }),
        sidewalk: new THREE.MeshLambertMaterial({ color: 0x9a9a92, side: roadSide }),
        lamp: new THREE.MeshStandardMaterial({ color: 0xfff2c0, roughness: 0.4, emissive: 0x554400, emissiveIntensity: 0.4 }),
        // bang hieu cua hang (instanceColor) + mai hien
        sign: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        awning: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        windowBand: new THREE.MeshLambertMaterial({ color: 0x2b3a4a }),
        fence: new THREE.MeshLambertMaterial({ color: 0xbfb9ab }),
        balcony: new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }),
        waterDepth: new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.18, metalness: 0.12,
            transparent: true, opacity: 0.88, side: THREE.DoubleSide
        }),
        grass: new THREE.MeshLambertMaterial({ color: 0x4a7a3a }),
        rock: new THREE.MeshLambertMaterial({ color: 0x7a7468 }),
        trunk: new THREE.MeshLambertMaterial({ color: 0x4a3524 }),
        leaves: new THREE.MeshLambertMaterial({ color: 0x2f6b32 }),
        palmLeaf: new THREE.MeshLambertMaterial({ color: 0x3f8a3a }),
        bamboo: new THREE.MeshLambertMaterial({ color: 0x7f9b3a }),
        dryBush: new THREE.MeshLambertMaterial({ color: 0x8a8348 }),
        cactus: new THREE.MeshLambertMaterial({ color: 0x4d7a4a }),
        pole: new THREE.MeshLambertMaterial({ color: 0x6b5b4a }),
        wire: new THREE.MeshLambertMaterial({ color: 0x2a2a2a }),
        rice: new THREE.MeshLambertMaterial({ color: 0x86a83c }),
        dryField: new THREE.MeshLambertMaterial({ color: 0xa8924c }),
        glass: new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.55 }),
        wall: new THREE.MeshLambertMaterial({ color: 0xe6e2d8 }),
        roof: new THREE.MeshLambertMaterial({ color: 0x3f5f7a }),
        metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.45, metalness: 0.5 }),
        paintWhite: new THREE.MeshLambertMaterial({ color: 0xf5f2e6 }),
        fuel: new THREE.MeshLambertMaterial({ color: 0xd8d8d4 }),
        fuelBrandA: new THREE.MeshLambertMaterial({ color: 0x1f6fb2 }),
        fuelBrandB: new THREE.MeshLambertMaterial({ color: 0xb22222 })
    };
}

function makeGeometries() {
    return {
        unitBox: new THREE.BoxGeometry(1, 1, 1),
        roofPyramid: new THREE.ConeGeometry(0.72, 1, 4),
        trunk: new THREE.CylinderGeometry(0.22, 0.34, 1, 5),
        canopy: new THREE.SphereGeometry(1, 7, 6),
        pine: new THREE.ConeGeometry(1, 1, 6),
        palmTrunk: new THREE.CylinderGeometry(0.16, 0.24, 1, 5),
        palmLeaf: new THREE.ConeGeometry(1, 1, 5),
        bamboo: new THREE.CylinderGeometry(0.09, 0.11, 1, 5),
        bush: new THREE.IcosahedronGeometry(1, 0),
        cactus: new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.3, 1.1, 3, 6) : new THREE.CylinderGeometry(0.3, 0.3, 1.4, 6),
        pole: new THREE.CylinderGeometry(0.12, 0.16, 1, 5),
        poleArm: new THREE.BoxGeometry(1, 0.12, 0.12),
        field: new THREE.BoxGeometry(1, 1, 1),
        tunnelBox: new THREE.BoxGeometry(1, 1, 1)
    };
}

// =============================================================================
// GEOMETRY BUILDER — gom quad theo class (thay vì 1 mesh / segment)
// =============================================================================
class MeshAccum {
    constructor() { this.pos = []; this.idx = []; this.n = 0; }
    // P58: tam giac thu hai PHAI LA (a, c, d), khong phai (b, d, c).
    // (b,d,c) nguoc chieu voi (a,b,c) ⇒ mot tam giac huong len mot tam giac
    // huong xuong ⇒ normal trung binh ~0 (do duoc: 4 dinh san be, 1 len,
    // 1 xuong, trung binh 0) va mat tam giac bi CULL tren vat lieu
    // `FrontSide`. Duong mat BAN DUOC che vi dung `DoubleSide`, nen loi nay
    // ton tai ma khong ai thay; san be thi `FrontSide` nen no lo ra ngay.
    quad(a, b, c, d) {
        const base = this.n;
        this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.n += 4;
    }
    // P58: cung loi chieu kim nhu `quad` — tam giac (a,b,d) va (b,c,d).
    strip(a, b, c, d) {
        const base = this.n;
        this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        this.idx.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
        this.n += 4;
    }
    // Triangle fan cho polygon đã clip (3..8 đỉnh).
    //
    // P59 — CHUẨN HOÁ CHIỀU KIM. Fan `(p0, pi, pi+1)` lấy chiều kim từ input,
    // nên polygon đi vào sai chiều là mặt nằm SẮP. Đo được trong game:
    //     MINOR 1 | MAJOR 1 | __LINE__ 1        (đúng)
    //     __JUNCTION__MINOR -0.99 | __JUNCTION__MAJOR -0.98
    //     __SIDEWALK__ -1 | __STOPLINE__ -0.2   (sai)
    // Mặt giao lỡ (convex hull) vừa là mảng to nhất vừa nằm giữa đường ⇒ đó
    // là thứ nhìn thấy "mảng tối" trong ảnh.
    //
    // Dấu hiệu: ap dụng trên mặt đường ĐÃ đúng — 4 đỉnh (0,hw) (L,hw)
    // (L,-hw) (0,-hw) cho normal Y = +1 và shoelace = -4·L·hw (ÂM).
    // ⇒ âm là hướng lên; ≥ 0 thì đảo danh sách.
    poly(points) {
        const n = points.length;
        if (n < 3) return;
        let sh = 0;
        for (let i = 0; i < n; i++) {
            const a = points[i], b = points[(i + 1) % n];
            sh += a[0] * b[2] - b[0] * a[2];
        }
        const base = this.n;
        if (sh < 0) {
            for (const p of points) this.pos.push(p[0], p[1], p[2]);
        } else {
            for (let i = n - 1; i >= 0; i--) {
                const p = points[i];
                this.pos.push(p[0], p[1], p[2]);
            }
        }
        for (let i = 1; i < n - 1; i++) this.idx.push(base, base + i, base + i + 1);
        this.n += n;
    }

    // P41/P51 — VÁY BÊN (+ MẶT ĐÁY): biến mặt phẳng thành KHỐI có thân.
    // `bottoms[i]` = cao độ đáy của đỉnh i: bình thường là mặt đất (váy
    // chạm tận đất, không lơ lửng); cầu vượt thì `y - ROAD_THICK` và có
    // mặt đáy để nhìn được từ dưới lên.
    //
    // P51: `bottoms` có thể kèm THỨ TƯ thứ nhất = độ lệch nghiêng ra ngoài
    // (m). Đường thật có **đối đất** (nền đắp nghiêng), không có tường đứng
    // 3m; váy thẳng đứng giữa hai đường song song tạo "hẻm tối" — đo được
    // 3.3× số tam giác mặt đường là mảng tối chồng lên nhau trong ảnh.
    skirt(points, bottoms, withBottom, outOff) {
        const n = points.length;
        if (n < 3) return;
        const base = this.n;
        // tâm hình học để tính hướng ra ngoài
        let mx = 0, mz = 0;
        for (let i = 0; i < n; i++) { mx += points[i][0]; mz += points[i][2]; }
        mx /= n; mz /= n;
        for (let i = 0; i < n; i++) {
            const p = points[i];
            const b = bottoms[i];
            if (outOff) {
                const dx = p[0] - mx, dz = p[2] - mz;
                const L = Math.hypot(dx, dz) || 1;
                this.pos.push(p[0], p[1], p[2]);                 // 2i    trên
                this.pos.push(p[0] + dx / L * outOff, b, p[2] + dz / L * outOff);
            } else {
                this.pos.push(p[0], p[1], p[2]);        // 2i    trên
                this.pos.push(p[0], bottoms[i], p[2]);  // 2i+1  dưới
            }
        }
        for (let i = 0; i < n; i++) {
            const a = base + i * 2;
            const b = base + i * 2 + 1;
            const c = base + ((i + 1) % n) * 2;
            const d = base + ((i + 1) % n) * 2 + 1;
            this.idx.push(a, c, d, a, d, b);
        }
        this.n += n * 2;
        if (!withBottom) return;
        const bb = this.n;
        for (let i = 0; i < n; i++) this.pos.push(points[i][0], bottoms[i], points[i][2]);
        for (let i = 1; i < n - 1; i++) this.idx.push(bb, bb + i + 1, bb + i);
        this.n += n;
    }
    get empty() { return this.n === 0; }
    build(material, name) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
        g.setIndex(this.idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, material);
        m.name = name || "";
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        return m;
    }
}

// ---------------------------------------------------------------------------
// GIAO LỠ — HÌNH HỌC THẬT (rule 12/13/6)
//
// VẤN ĐỀ: nếu chỉ vẽ quad từng đoạn, tại ngã giao 2 mặt đường CHỒNG LÊN NHAU
// cùng một cao độ => z-fighting lung tung, mép đường cắt ngang, vạch sơn của
// đường này nằm trên mặt đường kia. Đó chính là rule 13 cấm.
//
// CÁCH SỬA (giống hệt cách dựng giao lộ trong engine đường thật):
//   1. Mỗi node >= 3 nhánh = 1 GIAO LỠ có polygon riêng.
//   2. Polygon = CONVEX HULL của 4 miệng đường (2 đỉnh mỗi nhánh).
//   3. Mỗi nhánh được CẮT LÙI tới chỗ trục đường thoát khỏi hull  => 3 mảnh
//      (polygon giao lỡ + đoạn trước + đoạn sau) lát kín, KHÔNG chồng.
//   4. Vạch giữa đường/vỉa hè/median/lan can cũng cắt đúng theo trim đó.
//   5. Vạch dừng (stop line) cho nhánh nhỏ hơn đường ưu tiên.
//
// DÙNG HÀM này cho mọi ngã giao, kể cả bán kính 100m — không có ngoại lệ.
// ---------------------------------------------------------------------------

// CHỐT BO convex hull (monotone chain). Mỗi điểm là [x, z, y] — GIỮ y để
// cao độ mặt đường liền mạch, không bị võ ở sườn dốc.
function convexHull3(pts) {
    if (pts.length < 3) return pts.slice();
    const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const pt of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
        lower.push(pt);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
        const pt = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
        upper.push(pt);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
}

// Khoảng cách từ (ox,oz) theo hướng (dx,dz) tới ra khỏi đa giác CONVEX.
// Trả về Infinity nếu hướng không bao giờ thoát (đa giác bị vô hạn — không
// xảy ra với hull hữu hạn) — nhưng chặn cho an toàn.
function rayExitDist(poly, ox, oz, dx, dz) {
    let best = Infinity;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        // phương trình cạnh: nong · (P - A) = 0, nong = (ez, -ex) hướng vào trong
        const nx = ez, nz = -ex;
        const denom = nx * dx + nz * dz;
        if (Math.abs(denom) < 1e-9) continue;          // ray song song canh
        const t = (nx * (ox - a[0]) + nz * (oz - a[1])) / denom;
        if (t <= 1e-6) continue;
        // giao diem phai nam tren canh (nằm giữa A va B)
        const hx = ox + dx * t, hz = oz + dz * t;
        const seg = (hx - a[0]) * ex + (hz - a[1]) * ez;
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-9) continue;
        if (seg < -0.001 || seg > len2 + 0.001) continue;
        if (t < best) best = t;
    }
    return best;
}

// Cắt bỏ CÁNH HULL thừa rồi dùng chính 4 đỉnh miệng đường làm đa giác
// giao lỡ. Nhờ vậy 3 mảnh (polygon giao lỡ + đoạn trước + đoạn sau) lát kín
// chính xác tới từng đỉnh — không có khe hở, không có vết chồng.
//
// ⚠ ĐỈNH NODE PHẢI ĐƯỢC GIỮ. Khi cả 3+ nhánh nằm trong một nón < 180°,
// convex hull của các miệng đường KHÔNG chứa node => đa giác lệch hẳn sang
// một bên, node rơi ra ngoài, sàn giao lỡ hụt lỗ (đo được 17.9% lỗ ở các
// giao lỡ dạng nón). Vì vậy node được coi như một "miệng" thứ 0 và luôn giữ.
//
// Ký hiệu: hull là vòng đa giác; giữ cạnh nếu HAI đầu đều là miệng (kể cả
// node) -> các cạnh thừa bị gộp lại thành đường thẳng nối 2 miệng kề nhau,
// đúng hình dạng sàn giao lỡ thật.
function trimByMouths(hull, branches, n) {
    const N = hull.length;
    if (N < 3 || branches.length < 3) return null;

    const EPS = 0.06;
    const isMouth = new Array(N).fill(false);
    // 0) chính node
    for (let i = 0; i < N; i++) {
        if (Math.abs(hull[i][0] - n.x) < EPS && Math.abs(hull[i][1] - n.z) < EPS) {
            isMouth[i] = true;
            break;
        }
    }
    // 1) 4 miệng đường
    for (let i = 0; i < N; i++) {
        for (const b of branches) {
            const nx = -b.dz, nz = b.dx;
            for (const s of [-1, 1]) {
                const mx = n.x + b.dx * b.trim + nx * b.hw * s;
                const mz = n.z + b.dz * b.trim + nz * b.hw * s;
                if (Math.abs(mx - hull[i][0]) < EPS && Math.abs(mz - hull[i][1]) < EPS) {
                    isMouth[i] = true; break;
                }
            }
            if (isMouth[i]) break;
        }
    }
    if (!isMouth.some(Boolean)) return null;

    // giữ đỉnh nằm giữa 2 miệng kề nhau; nếu cả 2 đầu cạnh đều là miệng thì
    // giữ cả 2 (giữ liên tục, không sinh cạnh nối qua đỉnh thừa)
    const keep = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (isMouth[i] && isMouth[j]) { keep[i] = true; keep[j] = true; continue; }
        if (isMouth[i] || isMouth[j]) { keep[isMouth[i] ? i : j] = true; }
    }
    if (!keep.some(Boolean)) return null;

    let out = [];
    for (let i = 0; i < N; i++) if (keep[i]) out.push(hull[i]);
    if (out.length < 3) return null;

    // đảo chiều về CCW (chuẩn cho rayExitDist)
    let area = 0;
    for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[(i + 1) % out.length];
        area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) out.reverse();

    // ⚠ BẢO ĐẢM CHỨA NODE. Gộp cạnh hull thành đường thẳng (bước trên) có
    // thể cắt mất chính node khi các nhánh nằm trong nón hẹp: đo được 16
    // giao lỡ node nằm NGOÀI sàn của nó => lỗ 17% trong sàn giao lỡ.
    // Cách sửa: thấy node lọt ra là thêm node vào đa giác (hình lồi vẫn lồi,
    // chỉ nới ra, không phá kính lát 3 mảnh).
    if (!pointInConvex(out, n.x, n.z)) {
        out = convexHull3(out.concat([[n.x, n.z, n.y]]));
        if (out.length < 3) return null;
    }
    return out;
}

// Điểm có nằm trong đa giác LỒI (CCW) không.
function pointInConvex(poly, px, pz) {
    const n = poly.length;
    if (n < 3) return false;
    let pos = 0, neg = 0;
    for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const cr = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
        if (cr > 1e-6) pos++;
        else if (cr < -1e-6) neg++;
    }
    return pos === 0 || neg === 0;
}

// clip polygon (Sutherland–Hodgman) vào hình chữ nhật chunk
function clipRect(poly, minX, maxX, minZ, maxZ) {
    const planes = [
        (p) => p[0] - minX, (p) => maxX - p[0],
        (p) => p[1] - minZ, (p) => maxZ - p[1]
    ];
    let out = poly;
    for (let k = 0; k < 4 && out.length >= 3; k++) {
        const f = planes[k];
        const next = [];
        for (let i = 0; i < out.length; i++) {
            const cur = out[i], prv = out[(i + out.length - 1) % out.length];
            const dc = f(cur), dp = f(prv);
            if (dc >= 0) {
                if (dp < 0) {
                    const t = dp / (dp - dc);
                    next.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]);
                }
                next.push(cur);
            } else if (dp >= 0) {
                const t = dp / (dp - dc);
                next.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]);
            }
        }
        out = next;
    }
    return out;
}

// =============================================================================
// MAPLOADER — contract class cho main.js
// =============================================================================
export class MapLoader {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = "map";
        if (scene) scene.add(this.group);

        this.roadGroup = new THREE.Group(); this.roadGroup.name = "roads";
        this.chunkRoot = new THREE.Group(); this.chunkRoot.name = "chunks";
        this.stationGroup = new THREE.Group(); this.stationGroup.name = "stations";
        this.group.add(this.roadGroup, this.stationGroup, this.chunkRoot);

        this.world = null;
        this.roadGraph = null;
        this.stationsData = [];
        this.worldData = null;
        this.spawn = null;

        this.loadedChunks = new Map();
        this.inProgress = new Set();
        this.loadQueue = [];
        this._timer = 0;
        this._lastDir = { x: 0, z: -1 };
        this._segByChunk = new Map();
        this._chunkIndex = null;
        this.sectorSize = 0;
        this._sectorCache = new Map();
        this._sectorPending = new Map();
        this._sectorIndex = null;
        this._minimapCache = null;
        this._poiGroups = [];

        this._mats = makeMaterials();
        this._geos = makeGeometries();
        this._facadeMats = new Map();
        this._roofMats = new Map();
        this._terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
        this._waterGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
        this._sharedMats = new Set([...Object.values(this._mats), this._terrainMat]);
        this._sharedGeos = new Set([...Object.values(this._geos), this._waterGeo]);

        // TU DIEU CHINH CHAT LUONG THEO FPS: máy yếu (N5000) tự co tầm nhìn,
        // máy mạnh tự mở rộng. KHÔNG bỏ nội dung: chỉ giảm tầm nhìn khi cần.
        // MÁY YẾU: khởi đầu luôn ở bán kính thấp (đo thật trên UHD 605:
        // radius 5 = 730 draw call ~14fps; radius 3 = ~280 draw call).
        const lowEnd = (typeof navigator !== "undefined") &&
            ((navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4);
        this.isLowEnd = lowEnd;
        this.renderRadius = lowEnd ? RENDER_RADIUS_MIN : RENDER_RADIUS_MAX;
        this._frameAvg = 1 / 60;
        this._adaptTimer = 0;
        this._adaptCooldown = 0;
    }

    // dt (giây) của frame vừa render -> tự điều chỉnh tầm nhìn
    _adaptQuality(dt) {
        if (!(dt > 0) || dt > 1) return;
        this._frameAvg = this._frameAvg * 0.9 + dt * 0.1;
        this._adaptCooldown -= dt;
        this._adaptTimer += dt;
        if (this._adaptTimer < 2.0) return;
        this._adaptTimer = 0;
        if (this._adaptCooldown > 0) return;
        const fps = 1 / this._frameAvg;
        if (fps < 38 && this.renderRadius > RENDER_RADIUS_MIN) {
            this.renderRadius--;
            this._adaptCooldown = 3;
        } else if (fps > 56 && this.renderRadius < RENDER_RADIUS_MAX) {
            this.renderRadius++;
            this._adaptCooldown = 3;
        }
    }

    // ---------------------------------------------------------------- load
    async loadInitialData() {
        try {
            const [worldRes, roadsRes, stationsRes, routesRes] = await Promise.all([
                fetch(`${DATA_PATH}world.json`).then(r => r.json()),
                fetch(`${DATA_PATH}roads.json`).then(r => r.json()),
                fetch(`${DATA_PATH}stations.json`).then(r => r.json()),
                fetch(`${DATA_PATH}routes.json`).then(r => r.json())
            ]);

            this.worldData = worldRes;
            this.world = new World(worldRes);
            this.roadGraph = new RuntimeRoadGraph({ roads: roadsRes, routes: routesRes, stations: stationsRes });
            this.stationsData = Array.isArray(stationsRes) ? stationsRes : [];
            this.spawn = worldRes.spawn || null;
            // SECTOR: 1 file chua SECTOR_CHUNKS^2 chunk (1024m) -> giam so HTTP
            // request tu ~14k file chunk xuong ~900 file sector.
            this.sectorSize = worldRes.sectorSize || 0;
            this._sectorCache = new Map();
            this._sectorPending = new Map();
            if (Array.isArray(worldRes.sectorIndex)) this._sectorIndex = new Set(worldRes.sectorIndex);
            else this._sectorIndex = null;
            if (!this.sectorSize && Array.isArray(worldRes.chunkIndex)) {
                this._chunkIndex = new Set(worldRes.chunkIndex);
            }

            this._indexSegmentsByChunk();
            this._buildRoadIndex();
            this._buildJunctionIndex();
            this._buildRoadGroup();
            this._buildStations();
            return true;
        } catch (error) {
            console.error("[map] loadInitialData failed:", error);
            return false;
        }
    }

    // index segment theo chunk (để render/unload theo chunk -> culling tự nhiên)
    _indexSegmentsByChunk() {
        this._segByChunk.clear();
        if (!this.roadGraph) return;
        for (const seg of this.roadGraph.segments) {
            const p1 = this.roadGraph.getNode(seg.from);
            const p2 = this.roadGraph.getNode(seg.to);
            if (!p1 || !p2) continue;
            const hw = (seg.width || 12) * 0.5 + 2;
            const x0 = Math.floor((Math.min(p1.x, p2.x) - hw) / CHUNK_SIZE);
            const x1 = Math.floor((Math.max(p1.x, p2.x) + hw) / CHUNK_SIZE);
            const z0 = Math.floor((Math.min(p1.z, p2.z) - hw) / CHUNK_SIZE);
            const z1 = Math.floor((Math.max(p1.z, p2.z) + hw) / CHUNK_SIZE);
            for (let cx = x0; cx <= x1; cx++) {
                for (let cz = z0; cz <= z1; cz++) {
                    const k = cx + "," + cz;
                    let a = this._segByChunk.get(k);
                    if (!a) { a = []; this._segByChunk.set(k, a); }
                    a.push(seg.id);
                }
            }
        }
    }

    // ------------------------------------------------------------ materials
    _facadeMat(color) {
        const key = color | 0;
        let m = this._facadeMats.get(key);
        if (!m) {
            m = new THREE.MeshStandardMaterial({ color: key, roughness: 0.88 });
            this._facadeMats.set(key, m);
        }
        return m;
    }
    _roofMat(color) {
        const key = color | 0;
        let m = this._roofMats.get(key);
        if (!m) {
            m = new THREE.MeshStandardMaterial({ color: key, roughness: 0.92 });
            this._roofMats.set(key, m);
        }
        return m;
    }

    // ---------------------------------------------------------------- roads
    // bucket dùng để GOM HÌNH HỌC (giảm draw call), khác _matByClass (material)
    _roadBucket(c) {
        switch (c) {
            case "EXPRESSWAY":
            case "RAMP": return "HW";
            case "TUNNEL": return "TUNNEL";
            case "NATIONAL":
            case "ARTERIAL":
            case "STATION_ACCESS":
            case "INTERNAL": return "MAJOR";
            case "RURAL_LOCAL":
            case "SERVICE": return "DIRT";
            default: return "MINOR";
        }
    }

    _matByClass(c) {
        // GOM 4 BUCKET thay vì 12 material => it chunk chi 4-7 draw call đường.
        // Vẫn phân biệt được cao tốc / đường lớn / đường nhỏ / đường đất.
        switch (c) {
            case "EXPRESSWAY": return this._mats.roadHighway;
            case "RAMP": return this._mats.roadHighway;
            case "TUNNEL": return this._mats.tunnel;
            case "NATIONAL": return this._mats.roadMajor;
            case "ARTERIAL": return this._mats.roadMajor;
            case "STATION_ACCESS": return this._mats.roadMajor;
            case "INTERNAL": return this._mats.roadMajor;
            case "RURAL_LOCAL": return this._mats.roadLocal;
            case "SERVICE": return this._mats.roadLocal;
            case "COLLECTOR": return this._mats.roadMinor;
            default: return this._mats.roadMinor;
        }
    }

    // ---------------------------------------------------------------------
    // ROAD PROJECTION — nguồn height cho XE (rule 36: grounding > visuals)
    // ---------------------------------------------------------------------
    // node.y do _grade_roads trong Python quyết định (cut/fill, làm phẳng đường)
    // nên KHÔNG luôn bằng terrain. Xe phải bám MẶT ĐƯỜNG, không phải mặt đất:
    //   - trên đường  -> chiều cao node.y (đã grade)
    //   - ngoài đường -> terrain thật
    // main.js tính bus.y = getTerrainHeight(...) + 0.5 (0.5 = BUS_AXLE), và bánh
    // xe của model chạm đúng y=0 => getTerrainHeight phải trả node.y - 0.5 khi
    // đang trên đường, để bus.y == node.y == mặt đường.
    _buildRoadIndex() {
        this._roadIdx = new Map();
        this._roadCell = 64;
        if (!this.roadGraph) return;
        // node -> cac doan di qua: dung de ngat vach lan tai ngã tư/ngã 3
        this._nodeSegs = new Map();
        for (const seg of this.roadGraph.segments) {
            for (const nid of [seg.from, seg.to]) {
                let a = this._nodeSegs.get(nid);
                if (!a) { a = []; this._nodeSegs.set(nid, a); }
                a.push({ id: seg.id, w: seg.width || 12 });
            }
        }
        // KEY SO: string "x,z" ton ~20ns x 9 cell x moi frame x (bus + NPC +
        // hanh khach) -> key so ~3ns. Cung dung cong thuc voi terrain index.
        for (const seg of this.roadGraph.segments) {
            const p1 = this.roadGraph.getNode(seg.from);
            const p2 = this.roadGraph.getNode(seg.to);
            if (!p1 || !p2) continue;
            const hw = (seg.width || 12) * 0.5 + 3.0;
            const c = this._roadCell;
            const x0 = Math.floor((Math.min(p1.x, p2.x) - hw) / c);
            const x1 = Math.floor((Math.max(p1.x, p2.x) + hw) / c);
            const z0 = Math.floor((Math.min(p1.z, p2.z) - hw) / c);
            const z1 = Math.floor((Math.max(p1.z, p2.z) + hw) / c);
            for (let cx = x0; cx <= x1; cx++) {
                for (let cz = z0; cz <= z1; cz++) {
                    const k = (cx + 524288) * 1048576 + (cz + 524288);
                    let a = this._roadIdx.get(k);
                    if (!a) { a = []; this._roadIdx.set(k, a); }
                    a.push(seg.id);
                }
            }
        }
    }

    // -> null | { y, dist, width }  (y = chiều cao mặt đường tại điểm đó)
    _nearestRoad(x, z) {
        if (!this._roadIdx || !this.roadGraph) return null;
        const c = this._roadCell;
        const cx = Math.floor(x / c) + 524288, cz = Math.floor(z / c) + 524288;
        let best = null, bestD = Infinity;
        const seen = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const arr = this._roadIdx.get((cx + dx) * 1048576 + (cz + dz));
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) {
                    const sid = arr[i];
                    if (seen.has(sid)) continue;
                    seen.add(sid);
                    const seg = this.roadGraph.getSegment(sid);
                    if (!seg) continue;
                    const p1 = this.roadGraph.getNode(seg.from);
                    const p2 = this.roadGraph.getNode(seg.to);
                    if (!p1 || !p2) continue;
                    const ddx = p2.x - p1.x, ddz = p2.z - p1.z;
                    const l2 = ddx * ddx + ddz * ddz;
                    if (l2 <= 0) continue;
                    let t = ((x - p1.x) * ddx + (z - p1.z) * ddz) / l2;
                    t = clamp(t, 0, 1);
                    const qx = p1.x + ddx * t, qz = p1.z + ddz * t;
                    const ex = x - qx, ez = z - qz;
                    const d = Math.sqrt(ex * ex + ez * ez);
                    if (d < bestD) {
                        bestD = d;
                        const y1 = typeof p1.y === "number" ? p1.y : this.world.getElevation(p1.x, p1.z);
                        const y2 = typeof p2.y === "number" ? p2.y : this.world.getElevation(p2.x, p2.z);
                        best = { y: lerp(y1, y2, t), dist: d, width: seg.width || 12 };
                    }
                }
            }
        }
        if (!best) return null;
        if (best.dist > best.width * 0.5 + 2.0) return null;
        return best;
    }

    // P41 — MẶT TRÊN CÙNG, LIÊN TỤC THEO CAO ĐỘ XE.
    //
    // `_nearestRoad` trả đường GẦN NHẤT về mặt bằng. Ở cầu vượt / ramp
    // chạy song song đường khác, "gần nhất" là SAI: xe đang trên cầu bị kéo
    // xuống đường dưới (chui xuống) hoặc từ dưới bị kéo lên cầu (bay lên).
    // Ở đây dò MỌI mặt đường trong `SURFACE_REACH`, chọn cái nào cao độ
    // gần `yHint` nhất — tức mặt xe đang đứng trên đó.
    // Không có `yHint` (spawn / NPC) thì lấy mặt CAO NHẤT: không bao giờ
    // chui xuống dưới vật cản.
    // `maxDist`: bán kính chấp nhận (mặc định = nửa bề mặt đường + 2m, đúng
    // cho việc xe có thật trên đường). Không dùng bán kính rộng ở đây: bán
    // kính rộng nuốt cả đường ở mức khác (cầu vượt, sân) ⇒ nhảy mặt.
    _surfaceAt(x, z, yHint = null, maxDist = 0) {
        if (!this._roadIdx || !this.roadGraph) return null;
        const c = this._roadCell;
        const span = Math.ceil(Math.max(SURFACE_REACH, maxDist) / c) + 1;
        const cx = Math.floor(x / c) + 524288, cz = Math.floor(z / c) + 524288;
        let best = null, bestScore = Infinity;
        const seen = new Set();
        for (let dx = -span; dx <= span; dx++) {
            for (let dz = -span; dz <= span; dz++) {
                const arr = this._roadIdx.get((cx + dx) * 1048576 + (cz + dz));
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) {
                    const sid = arr[i];
                    if (seen.has(sid)) continue;
                    seen.add(sid);
                    const seg = this.roadGraph.getSegment(sid);
                    if (!seg) continue;
                    const p1 = this.roadGraph.getNode(seg.from);
                    const p2 = this.roadGraph.getNode(seg.to);
                    if (!p1 || !p2) continue;
                    const ddx = p2.x - p1.x, ddz = p2.z - p1.z;
                    const l2 = ddx * ddx + ddz * ddz;
                    if (l2 <= 0) continue;
                    const t = clamp(((x - p1.x) * ddx + (z - p1.z) * ddz) / l2, 0, 1);
                    const qx = p1.x + ddx * t, qz = p1.z + ddz * t;
                    const ex = x - qx, ez = z - qz;
                    const d = Math.sqrt(ex * ex + ez * ez);
                    const width = seg.width || 12;
                    const lim = maxDist > 0 ? maxDist : width * 0.5 + 2.0;
                    if (d > lim) continue;
                    const y1 = typeof p1.y === "number" ? p1.y : this.world.getElevation(p1.x, p1.z);
                    const y2 = typeof p2.y === "number" ? p2.y : this.world.getElevation(p2.x, p2.z);
                    const rawY = lerp(y1, y2, t);
                    const score = (yHint === null || yHint === undefined)
                        ? -rawY
                        : Math.abs(rawY - yHint) + d * 0.02;
                    if (score < bestScore) {
                        bestScore = score;
                        // KHÔNG `+ roadLift`: `roadLift` chỉ nâng MẶT ĐƯỜNG
                        // (hình học) để tránh z-fighting, không phải cao độ xe.
                        // Xe chạy ở `bus.y = road.y + BUS_AXLE` (đo được:
                        // 2.883 = road.y 2.383 + 0.5). Cộng roadLift ở đây
                        // làm lệch 0.12m so với `_nearestRoad` cũ.
                        best = { y: rawY, rawY, dist: d, width, sid, seg };
                    }
                }
            }
        }
        return best;
    }

    // P56: điểm có nằm trong sân bến nào không (quyết định có vẽ mặt
    // đường `INTERNAL` trong sân hay không).
    //
    // Lấy từ `stationsData` — JS KHÔNG có `stationZones` (đó là biến của
    // generator; P56 v1 tự bịa nó ⇒ hàm luôn False ⇒ vẽ đường ngoài sân, bỏ
    // hết đường trong sân — đúng ngược).
    //
    // Kiểm trong HỆ CỤC BỘ của sân (có `rot`): sân xoay khác 0, AABB không
    // xoay sẽ hoặc bỏ sót (vẽ đường trong sân) hoặc bắt nhầm (bỏ đường
    // ngoài sân).
    _insideStationYard(x, z) {
        const list = this.stationsData;
        if (!list) return false;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (s.type !== "BUS_STATION" && s.type !== "MAJOR_BUS_TERMINAL") continue;
            const r = s.rot || 0;
            const dx = x - s.x, dz = z - s.z;
            // `(lx,lz)` ở đây = `Rᵀ(rot)·(dx,dz)` = Hệ cục bộ của group bến:
            //   lx = oz (dọc theo đường chính),  lz = ox (vuông góc, vào bến).
            // Do đó ô ĐÚNG là  lx ∈ ±d/2 (chiều dọc đường),  lz ∈ ±w/2.
            // Bản cũ gán  lx ∈ ±w/2, lz ∈ ±d/2  = ĐẢO W/D ⇒ rect bị xoay 90°
            // so với sân thực tế. Đo được: 20/20 góc đường nội bộ rớt ra ngoài
            // (|lz| = hw−12 = 83 > d/2 = 70) ⇒ 3 đoạn INTERNAL chém ngang sân.
            const lx = dx * Math.cos(r) - dz * Math.sin(r);
            const lz = dx * Math.sin(r) + dz * Math.cos(r);
            if (Math.abs(lx) <= (s.d || 130) * 0.5 &&
                Math.abs(lz) <= (s.w || 180) * 0.5) return true;
        }
        return false;
    }

    _buildRoadGroup() { /* roads render theo chunk trong _loadChunk */ }

    // ---------------------------------------------------------------------
    // GIAO LỠ — index tinh, dựng 1 LẦN khi load (rule 12/13)
    //
    // Cho mỗi node >= 3 nhánh:
    //   poly      : đa giác mặt giao lỡ (convex hull, đã mang theo cao độ)
    //   trimBySeg : segId -> khoảng cắt lùi TÍNH TỪ NODE NÀY (met)
    //   stopLines : vạch dừng cho nhánh nhỏ (dưới đường ưu tiên)
    //   bucket    : nhóm material (HW / MAJOR / MINOR / DIRT)
    // Sau đó mỗi đoạn đường bị cắt lùi 2 đầu theo trim -> 3 mảnh lát kín.
    // KHÔNG còn 2 quad cùng cao độ chồng lên nhau => hết z-fighting ở ngã ba/tư.
    // ---------------------------------------------------------------------
    _buildJunctionIndex() {
        this._junctions = new Map();
        this._junctionByChunk = new Map();
        if (!this.roadGraph || !this._nodeSegs || !this.world) return;

        const HIER = {
            EXPRESSWAY: 1, RAMP: 2, TUNNEL: 2, NATIONAL: 2, ARTERIAL: 3,
            COLLECTOR: 4, LOCAL: 4, RURAL_LOCAL: 4, ALLEY: 5, SERVICE: 5,
            STATION_ACCESS: 5, INTERNAL: 5
        };
        const nodeY = (n) => (typeof n.y === "number" ? n.y : this.world.getElevation(n.x, n.z));

        for (const [nid, arr] of this._nodeSegs) {
            if (!arr || arr.length < 3) continue;
            const n = this.roadGraph.getNode(nid);
            if (!n) continue;

            const branches = [];
            for (const e of arr) {
                const seg = this.roadGraph.getSegment(e.id);
                if (!seg) continue;
                if (seg.bridge || seg.class === "TUNNEL") continue;  // cầu/hầm giữ nguyên
                const a = this.roadGraph.getNode(seg.from);
                const b = this.roadGraph.getNode(seg.to);
                if (!a || !b) continue;
                const from = (seg.from === nid) ? a : b;
                const to = (seg.from === nid) ? b : a;
                let dx = to.x - from.x, dz = to.z - from.z;
                const len = Math.hypot(dx, dz);
                if (len < 0.5) continue;
                dx /= len; dz /= len;
                const hw = (seg.width || 12) * 0.5;
                branches.push({
                    id: seg.id, len, dx, dz, hw,
                    y0: nodeY(from), y1: nodeY(to),
                    cls: seg.class, hier: HIER[seg.class] || 4,
                    trim: hw
                });
            }
            if (branches.length < 3) continue;

            const ny = nodeY(n);

            // TRẦN KÍCH THƯỚC GIAO LỠ.
            // Node nhiều nhánh (tâm đô thị, 16-32 nhánh) nếu để convex hull
            // tự do sẽ sinh tam giác giao lỡ dài hàng trăm mét — cắt lùi
            // 400m là SAI. Sân giao lỡ thật chỉ rộng cỡ 2-3 lần bề rộng
            // đường, nên trần cứng theo bề rộng nhánh lớn nhất.
            let maxHw = 0;
            for (const b of branches) if (b.hw > maxHw) maxHw = b.hw;
            const cap = maxHw * 2.0 + 5.0;

            // VÒNG LẶP hull <-> trim: hội tụ sau ~3 vòng
            let poly = null;
            for (let it = 0; it < 6; it++) {
                const pts = [[n.x, n.z, ny]];   // ⚠ node phải nằm trong hull
                for (const b of branches) {
                    const nx = -b.dz, nz = b.dx;
                    const yb = b.y0 + (b.y1 - b.y0) * (b.trim / b.len);
                    for (const s of [-1, 1]) {
                        pts.push([n.x + b.dx * b.trim + nx * b.hw * s,
                                  n.z + b.dz * b.trim + nz * b.hw * s, yb]);
                    }
                }
                poly = convexHull3(pts);
                if (poly.length < 3) { poly = null; break; }
                let moved = false;
                for (const b of branches) {
                    const t = rayExitDist(poly, n.x, n.z, b.dx, b.dz);
                    // khoang cat: >= 35% be rong, <= cap, <= 45% do dai
                    const nt = clamp(t, b.hw * 0.35, Math.min(cap, b.len * 0.45));
                    if (Math.abs(nt - b.trim) > 0.05) moved = true;
                    b.trim = nt;
                }
                if (!moved) break;
            }
            if (!poly || poly.length < 3) continue;

            // san giao lo phai phong (khong lam nut giao toan bo mat duong bien)
            // -> lui hull vao trong mot chut cho cac canh khong co mieng duong
            const trimmed = trimByMouths(poly, branches, n);
            if (!trimmed) continue;

            // material theo nhanh UU TIEN nhat tai giao lo
            let bestHier = 9, bucket = "MINOR";
            for (const b of branches) {
                if (b.hier < bestHier) { bestHier = b.hier; bucket = this._roadBucket(b.cls); }
            }
            const urban = branches.some(b => b.cls === "NATIONAL" || b.cls === "ARTERIAL" ||
                                            b.cls === "COLLECTOR" || b.cls === "INTERNAL");

            const J = {
                id: nid, x: n.x, z: n.z, y: ny,
                poly: trimmed, bucket, urban,
                trimBySeg: new Map(),
                stopLines: [],
                curbEdges: urban ? this._cornerEdges(trimmed, branches, n) : []
            };
            for (const b of branches) J.trimBySeg.set(b.id, b.trim);

            // VẠCH DỪNG (rule 12/13): nhánh YEU hon duong uu tien tai giao lo
            // phai co vach dung, vi du ngã ba duong nho vao QL.
            for (const b of branches) {
                if (b.hier <= bestHier) continue;             // duong uu tien: khong dung
                // phai co nhanh uu tien lech >= 55 do moi lai dung xe o giao lo that
                let hasMajor = false;
                for (const c of branches) {
                    if (c === b || c.hier > bestHier) continue;
                    const d = b.dx * c.dx + b.dz * c.dz;
                    if (Math.acos(clamp(d, -1, 1)) * 57.29578 >= 55) { hasMajor = true; break; }
                }
                if (!hasMajor) continue;
                const t = Math.min(b.trim + 1.4, b.len * 0.9);
                J.stopLines.push({
                    x: n.x + b.dx * t, z: n.z + b.dz * t,
                    y: b.y0 + (b.y1 - b.y0) * (t / b.len),
                    rot: Math.atan2(b.dx, b.dz),
                    hw: b.hw * 0.92
                });
            }

            this._junctions.set(nid, J);
            // gan giao lo vao cac chunk ma no cham vao (theo bounds cua polygon)
            let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
            for (const v of trimmed) {
                if (v[0] < mnx) mnx = v[0];
                if (v[0] > mxx) mxx = v[0];
                if (v[1] < mnz) mnz = v[1];
                if (v[1] > mxz) mxz = v[1];
            }
            const c0x = Math.floor(mnx / CHUNK_SIZE), c1x = Math.floor(mxx / CHUNK_SIZE);
            const c0z = Math.floor(mnz / CHUNK_SIZE), c1z = Math.floor(mxz / CHUNK_SIZE);
            for (let cx = c0x; cx <= c1x; cx++) {
                for (let cz = c0z; cz <= c1z; cz++) {
                    const k = cx + "," + cz;
                    let a = this._junctionByChunk.get(k);
                    if (!a) { a = []; this._junctionByChunk.set(k, a); }
                    a.push(nid);
                }
            }
        }
        // truy cap nhanh: 2 dau tieu/cuoi cua 1 doan co cat hay khong
        this._segTrim = new Map();
        for (const seg of this.roadGraph.segments) {
            const a = this._junctions.get(seg.from), b = this._junctions.get(seg.to);
            const ta = a ? (a.trimBySeg.get(seg.id) || 0) : 0;
            const tb = b ? (b.trimBySeg.get(seg.id) || 0) : 0;
            if (ta > 0 || tb > 0) this._segTrim.set(seg.id, [ta, tb]);
        }
    }

    // khoang cat lui 2 dau cua doan (0 neu khong cham giao lo)
    _trimOf(segId) {
        const t = this._segTrim ? this._segTrim.get(segId) : null;
        return t || [0, 0];
    }

    // cao do mat duong tai diem bat ky nam tren canh cua polygon giao lo
    _junctionEdgeY(J, p) {
        let bestY = J.y, bestD = Infinity;
        for (let k = 0; k < J.poly.length; k++) {
            const a = J.poly[k], b = J.poly[(k + 1) % J.poly.length];
            const ex = b[0] - a[0], ez = b[1] - a[1];
            const l2 = ex * ex + ez * ez;
            if (l2 < 1e-9) continue;
            let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2;
            t = clamp(t, 0, 1);
            const d = Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ez * t));
            if (d < bestD) { bestD = d; bestY = a[2] + (b[2] - a[2]) * t; }
        }
        return bestY;
    }

    // Trích các CẠNH GÓC của đa giác giao lỡ (cạnh không phải miệng đường).
    // Miệng đường = cặp 2 đỉnh là 2 miệng của CÙNG một nhánh.
    _cornerEdges(poly, branches, n) {
        const out = [];
        const N = poly.length;
        const EPS = 0.08;
        for (let i = 0; i < N; i++) {
            const a = poly[i], b = poly[(i + 1) % N];
            let isMouthEdge = false;
            for (const br of branches) {
                const nx = -br.dz, nz = br.dx;
                const m1x = n.x + br.dx * br.trim + nx * br.hw;
                const m1z = n.z + br.dz * br.trim + nz * br.hw;
                const m2x = n.x + br.dx * br.trim - nx * br.hw;
                const m2z = n.z + br.dz * br.trim - nz * br.hw;
                const hitA = (Math.abs(a[0] - m1x) < EPS && Math.abs(a[1] - m1z) < EPS) ||
                             (Math.abs(a[0] - m2x) < EPS && Math.abs(a[1] - m2z) < EPS);
                const hitB = (Math.abs(b[0] - m1x) < EPS && Math.abs(b[1] - m1z) < EPS) ||
                             (Math.abs(b[0] - m2x) < EPS && Math.abs(b[1] - m2z) < EPS);
                if (hitA && hitB) { isMouthEdge = true; break; }
            }
            if (!isMouthEdge) out.push([a, b]);
        }
        return out;
    }

    // build road geometry của 1 chunk (gộp theo class + median + shoulder + line)
    _addChunkRoads(cx, cz, parent) {
        const key = cx + "," + cz;
        const sids = this._segByChunk.get(key);
        if (!sids || sids.length === 0) return;
        const minX = cx * CHUNK_SIZE, maxX = minX + CHUNK_SIZE;
        const minZ = cz * CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
        const acc = new Map();
        const getAcc = (k) => {
            let a = acc.get(k);
            if (!a) { a = new MeshAccum(); acc.set(k, a); }
            return a;
        };

        for (const sid of sids) {
            const seg = this.roadGraph.getSegment(sid);
            if (!seg) continue;
            const p1 = this.roadGraph.getNode(seg.from);
            const p2 = this.roadGraph.getNode(seg.to);
            if (!p1 || !p2) continue;
            // P56: SÂN BẾN = 1 BẢNG BÊ TÔNG LIỀN. Đoạn `INTERNAL` nằm TRONG
            // sân không vẽ mặt đường — nếu vẽ, sân bị cắt thành dải xám chồng
            // nhau (đã thấy trong ảnh). Đường nội bộ chỉ là đườNG ĐỂ LÁI XE
            // TRÊN NGỮ CẢNH, nên bỏ VẼ chứ KHÔNG bỏ graph: `_surfaceAt` vẫn
            // trả đúng cao độ ở đó và xe vẫn chạy đúng. Sân thật ở Việt Nam là
            // bảng bê tông liền, chỉ có vạch sơn đỗ xe + nan cánh.
            // Đoạn `INTERNAL`/`STATION_ACCESS` nằm NGOÀI sân (đường vào bến)
            // thì VẪN vẽ bình thường.
            if (seg.class === "INTERNAL" || seg.class === "STATION_ACCESS") {
                if (this._insideStationYard(p1.x, p1.z) &&
                    this._insideStationYard(p2.x, p2.z)) continue;
            }
            const w = seg.width || 12;
            const dx = p2.x - p1.x, dz = p2.z - p1.z;
            const len = Math.hypot(dx, dz);
            if (len < 0.05) continue;
            const ux = dx / len, uz = dz / len;
            const nx = -uz, nz = ux;
            const hw = w * 0.5;
            const oy1 = (typeof p1.y === "number" ? p1.y : this.world.getElevation(p1.x, p1.z)) + this.world.roadLift;
            const oy2 = (typeof p2.y === "number" ? p2.y : this.world.getElevation(p2.x, p2.z)) + this.world.roadLift;

            // ---- CẮT LÙI TẠI GIAO LỠ (rule 12/13) ----------------------
            // Mặt đường bắt đầu TỪ miệng giao lỡ, không phủ lên polygon giao
            // lỡ. Không còn 2 quad cùng cao độ chồng nhau ở ngã ba/tư.
            const [t0, t1] = this._trimOf(sid);
            const ax = t0 > 0 ? p1.x + ux * t0 : p1.x;
            const az = t0 > 0 ? p1.z + uz * t0 : p1.z;
            const bx = t1 > 0 ? p2.x - ux * t1 : p2.x;
            const bz = t1 > 0 ? p2.z - uz * t1 : p2.z;
            if (t0 + t1 >= len - 0.4) continue;          // quá ngắn sau khi cắt
            const p1x = ax, p1z = az, p2x = bx, p2z = bz;
            const y1 = t0 > 0 ? lerp(oy1, oy2, t0 / len) : oy1;
            const y2 = t1 > 0 ? lerp(oy1, oy2, 1 - t1 / len) : oy2;

            // polygon 4 đỉnh (x,z) của mặt đường rồi clip vào chunk
            const corners = [
                [p1x + nx * hw, p1z + nz * hw], [p2x + nx * hw, p2z + nz * hw],
                [p2x - nx * hw, p2z - nz * hw], [p1x - nx * hw, p1z - nz * hw]
            ];
            const poly = clipRect(corners, minX, maxX, minZ, maxZ);
            if (poly.length < 3) continue;
            const pts = poly.map(([px, pz]) => {
                const t = clamp(((px - p1x) * dx + (pz - p1z) * dz) / (len * len), 0, 1);
                return [px, lerp(y1, y2, t), pz];
            });
            getAcc(this._roadBucket(seg.class)).poly(pts);

            // ---- P41: THÂN ĐƯỜNG -------------------------------------------------
            // Váy bên đi xuống tận MẶT ĐẤT, không phải một bề dày cố định
            // lơ lửng: đường đi trên sườn phải có nền đắp — đó là cách
            // người ta thấy đường trong thực tế, và cũng là thứ khiến xe
            // trông như đang lơ lửng trên một dải texture.
            // Cầu vượt thì CỐ Ý nổi: đáy = y - ROAD_THICK + mặt đáy.
            const floating = !!seg.bridge;
            const bottoms = new Array(pts.length);
            let deep = 0, shallow = 0;
            for (let i = 0; i < pts.length; i++) {
                const q = pts[i];
                if (floating) {
                    bottoms[i] = q[1] - ROAD_THICK;
                } else {
                    const g = this.world.getElevation(q[0], q[2]);
                    bottoms[i] = Math.min(q[1] - ROAD_THICK, g - 0.05);
                    const d2 = q[1] - bottoms[i];
                    if (d2 > deep) deep = d2;
                    if (d2 < 0.25) shallow++;
                }
            }
            // P51: đoạn nào mặt đường sát đất (không đủ một đỉnh sâu >0.25m)
            // thì KHÔNG vẽ váy — mặt đường đó phải nằm phẳng với đất, vẽ váy
            // chỉ là thêm mảng tối vô nghĩa.
            if (!floating && shallow >= pts.length) {
                // duong sat dat: khong ve gi
            } else {
                // P54: DOI DAT 45 DO (`outOff = deep`) + CUNG VAT LIEU voi mat
                // duong. Ban P51 dung `min(deep, hw*0.9)` nen doan duong chi
                // lech 0.3m van co doi dat rong 5.4m — ve nhu co ban le. Va
                // vat lieu `shoulder` (nau xam) khac mat duong nen doi dat
                // nhu "tam ben khac" leo vao. Do duoc trong anh aerial.
                const gSide = getAcc(this._roadBucket(seg.class) + "__BODY__");
                gSide.skirt(pts, bottoms, floating || deep > 1.2,
                            floating ? 0 : deep);
            }

            // median + shoulder cho cao tốc
            if (seg.class === "EXPRESSWAY") {
                const mw = 1.6, sw = 2.6;
                const strip = (off, halfW, yOff) => {
                    const c = [
                        [p1x + nx * (off + halfW), p1z + nz * (off + halfW)],
                        [p2x + nx * (off + halfW), p2z + nz * (off + halfW)],
                        [p2x + nx * (off - halfW), p2z + nz * (off - halfW)],
                        [p1x + nx * (off - halfW), p1z + nz * (off - halfW)]
                    ];
                    const cp = clipRect(c, minX, maxX, minZ, maxZ);
                    if (cp.length < 3) return;
                    const v = cp.map(([px, pz]) => {
                        const t = clamp(((px - p1x) * dx + (pz - p1z) * dz) / (len * len), 0, 1);
                        return [px, lerp(y1, y2, t) + yOff, pz];
                    });
                    return v;
                };
                const med = strip(0, mw, 0.02);
                if (med) getAcc("__MEDIAN__").poly(med);
                for (const s of [-1, 1]) {
                    const sh = strip(s * (hw - sw * 0.5), sw * 0.5, 0.015);
                    if (sh) getAcc("__SHOULDER__").poly(sh);
                }
            }

            // VỈA HÈ ở vùng đô thị (node có region URBAN) — chi tiết phố VN
            const urban = (p1.region === "URBAN") || (p2.region === "URBAN");
            if (urban && w >= 9) {
                const sw = 3.0;
                for (const s of [-1, 1]) {
                    const off = s * (hw + sw * 0.5);
                    const c = [
                        [p1x + nx * (off - sw * 0.5), p1z + nz * (off - sw * 0.5)],
                        [p2x + nx * (off - sw * 0.5), p2z + nz * (off - sw * 0.5)],
                        [p2x + nx * (off + sw * 0.5), p2z + nz * (off + sw * 0.5)],
                        [p1x + nx * (off + sw * 0.5), p1z + nz * (off + sw * 0.5)]
                    ];
                    const cp = clipRect(c, minX, maxX, minZ, maxZ);
                    if (cp.length >= 3) {
                        const v = cp.map(([px, pz]) => {
                            const t = clamp(((px - p1x) * dx + (pz - p1z) * dz) / (len * len), 0, 1);
                            return [px, lerp(y1, y2, t) + 0.14, pz];
                        });
                        getAcc("__SIDEWALK__").poly(v);
                    }
                }
            }

            // VẠCH LÀN GIỮA (rule 13): chạy dọc phần đường NGOÀI giao lỡ.
            // Không vẽ vạch nào bên trong polygon giao lỡ — đó là lý do phải có
            // junction patch thật thay vì chồng quad.
            if (w >= 12) {
                const lw = 0.22;
                const c = [
                    [p1x + nx * lw, p1z + nz * lw], [p2x + nx * lw, p2z + nz * lw],
                    [p2x - nx * lw, p2z - nz * lw], [p1x - nx * lw, p1z - nz * lw]
                ];
                const cp = clipRect(c, minX, maxX, minZ, maxZ);
                if (cp.length >= 3) {
                    const v = cp.map(([px, pz]) => {
                        const t = clamp(((px - p1x) * dx + (pz - p1z) * dz) / (len * len), 0, 1);
                        return [px, lerp(y1, y2, t) + 0.03, pz];
                    });
                    getAcc("__LINE__").poly(v);
                }
            }

            // CẦU: nhịp cầu + lan can 2 bên (đường cắt sông do generator đánh dấu)
            if (seg.bridge) {
                const my = (y1 + y2) * 0.5;
                const deck = new THREE.Mesh(this._geos.unitBox, this._mats.concrete);
                deck.scale.set(w + 3, 1.1, len + 1);
                deck.position.set((p1x + p2x) / 2, my - 0.75, (p1z + p2z) / 2);
                deck.rotation.y = Math.atan2(dx, dz);
                deck.updateMatrix();
                deck.matrixAutoUpdate = false;
                parent.add(deck);
                for (const sgn of [-1, 1]) {
                    const rail = new THREE.Mesh(this._geos.unitBox, this._mats.metal);
                    rail.scale.set(0.35, 1.2, len + 1);
                    rail.position.set(
                        (p1x + p2x) / 2 + nx * (w * 0.5 + 1.2) * sgn,
                        my + 0.6,
                        (p1z + p2z) / 2 + nz * (w * 0.5 + 1.2) * sgn
                    );
                    rail.rotation.y = Math.atan2(dx, dz);
                    rail.updateMatrix();
                    rail.matrixAutoUpdate = false;
                    parent.add(rail);
                }
                if (seg.pier) {
                    const pier = new THREE.Mesh(this._geos.unitBox, this._mats.concrete);
                    pier.scale.set(w * 0.5, 10, w * 0.5);
                    pier.position.set((p1x + p2x) / 2, my - 6, (p1z + p2z) / 2);
                    pier.updateMatrix();
                    pier.matrixAutoUpdate = false;
                    parent.add(pier);
                }
            }

            // hầm: vỏ hầm (Box side=BackSide) + 2 cổng hầm
            if (seg.class === "TUNNEL") {
                const shellMat = this._mats.tunnelShell;
                const shell = new THREE.Mesh(this._geos.unitBox, shellMat);
                shell.scale.set(w + 7, 13, len + 3);
                const my = (y1 + y2) * 0.5;
                shell.position.set((p1x + p2x) / 2, my + 3.5, (p1z + p2z) / 2);
                shell.rotation.y = Math.atan2(dx, dz);
                shell.updateMatrix();
                shell.matrixAutoUpdate = false;
                parent.add(shell);

                for (const [p, other] of [[p1, p2], [p2, p1]]) {
                    const g = new THREE.Mesh(this._geos.unitBox, this._mats.tunnelPortal);
                    g.scale.set(w + 6, 11, 1.4);
                    g.position.set(p.x, (typeof p.y === "number" ? p.y : 0) + 4.0, p.z);
                    g.rotation.y = Math.atan2(other.x - p.x, other.z - p.z);
                    g.updateMatrix();
                    g.matrixAutoUpdate = false;
                    parent.add(g);
                }
            }
        }

        // ---- SÂN GIAO LỠ (rule 12/13) ---------------------------------
        // 1 polygon giao lỡ thay cho N quad chồng nhau. Đây là thứ CHỐNG
        // z-fighting + chặn mép đường cắt ngang. Cùng bucket material với
        // nhánh ưu tiên nên mặt giao lỡ đồng nhất với đường chính.
        const jids = this._junctionByChunk ? this._junctionByChunk.get(key) : null;
        if (jids) {
            for (let i = 0; i < jids.length; i++) {
                const J = this._junctions.get(jids[i]);
                if (!J) continue;
                const cp = clipRect(J.poly.map(v => [v[0], v[1]]), minX, maxX, minZ, maxZ);
                if (cp.length < 3) continue;
                getAcc("__JUNCTION__" + J.bucket).poly(cp.map(p => {
                    // nội suy cao độ: gần cạnh polygon nào thì lấy y của cạnh đó
                    let bestY = J.y, bestD = Infinity;
                    for (let k = 0; k < J.poly.length; k++) {
                        const a = J.poly[k], b = J.poly[(k + 1) % J.poly.length];
                        const ex = b[0] - a[0], ez = b[1] - a[1];
                        const l2 = ex * ex + ez * ez;
                        if (l2 < 1e-9) continue;
                        let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2;
                        t = clamp(t, 0, 1);
                        const d = Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ez * t));
                        if (d < bestD) { bestD = d; bestY = a[2] + (b[2] - a[2]) * t; }
                    }
                    return [p[0], bestY, p[1]];
                }));

                // VỈA HÈ GÓC TẠI GIAO LỠ (rule 12: curb / sidewalk)
                // Cạnh nào KHÔNG phải miệng đường là cạnh "góc" -> vẽ lề
                // cao 0.14m. Không có bước này thì giao lỡ trần trụi, mất hết
                // dấu hiệu ngã giao trong phố.
                if (J.urban && J.curbEdges && J.curbEdges.length) {
                    const cacc = getAcc("__SIDEWALK__");
                    for (let k = 0; k < J.curbEdges.length; k++) {
                        const a = J.curbEdges[k][0], b2 = J.curbEdges[k][1];
                        let ex = b2[0] - a[0], ez = b2[1] - a[1];
                        const el = Math.hypot(ex, ez);
                        if (el < 0.4) continue;
                        ex /= el; ez /= el;
                        const px = -ez, pz = ex;          // vuông goc ra ngoài
                        const t2 = 0.45;                  // be rong le
                        const c = [
                            [a[0], a[1]], [b2[0], b2[1]],
                            [b2[0] + px * t2, b2[1] + pz * t2],
                            [a[0] + px * t2, a[1] + pz * t2]
                        ];
                        const sc2 = clipRect(c, minX, maxX, minZ, maxZ);
                        if (sc2.length < 3) continue;
                        cacc.poly(sc2.map(p => [p[0], this._junctionEdgeY(J, p) + 0.14, p[1]]));
                    }
                }

                // VẠCH DỪNG (rule 12): nhánh nhỏ phải dừng trước miệng giao lỡ
                for (let k = 0; k < J.stopLines.length; k++) {
                    const sl = J.stopLines[k];
                    if (sl.x < minX - 4 || sl.x > maxX + 4 || sl.z < minZ - 4 || sl.z > maxZ + 4) continue;
                    const sn = [-Math.cos(sl.rot), -Math.sin(sl.rot)];   // vuông góc hướng đi
                    const t = 0.42;
                    const c = [
                        [sl.x + sn[0] * sl.hw, sl.z + sn[1] * sl.hw],
                        [sl.x - sn[0] * sl.hw, sl.z - sn[1] * sl.hw],
                        [sl.x - sn[0] * (sl.hw - t), sl.z - sn[1] * (sl.hw - t)],
                        [sl.x + sn[0] * (sl.hw - t), sl.z + sn[1] * (sl.hw - t)]
                    ];
                    const sc = clipRect(c, minX, maxX, minZ, maxZ);
                    if (sc.length < 3) continue;
                    getAcc("__STOPLINE__").poly(sc.map(p => [p[0], sl.y + 0.035, p[1]]));
                }
            }
        }

        for (const [cls, a] of acc) {
            if (a.empty) continue;
            let mat;
            if (cls === "__MEDIAN__") mat = this._mats.median;
            else if (cls === "__SHOULDER__") mat = this._mats.shoulder;
            else if (cls === "__LINE__") mat = this._mats.laneLine;
            else if (cls === "__SIDEWALK__") mat = this._mats.sidewalk;
            else if (cls === "__STOPLINE__") mat = this._mats.laneLine;
            else if (cls.slice(-8) === "__BODY__")
                mat = this._matByClass(cls.slice(0, -8));
            else if (cls.indexOf("__JUNCTION__") === 0) mat = this._matByClass(cls.slice(12));
            else mat = this._matByClass(cls);
            parent.add(a.build(mat, `road_${cls}`));
        }
    }

    // -------------------------------------------------------------- terrain
    //
    // BENCH ĐƯỜNG — vá lỗi đường bị chôn/bị treo.
    // Mặt đường vẽ ở node.y, terrain vẽ ở getElevation(x,z). Hai nguồn đó lệch
    // nhau tới ±8m (_grade_roads cắt/đắp node.y) nên đo được 22.9% km đường
    // bị terrain phủ (chìm) và 23% bị lơ lửng. Cái này dựng một lưới cao độ
    // 8m khớp ĐÚNG lưới terrain (33x33/chunk) rồi ép terrain bám theo mặt
    // đường trong băng hẹp — đường nằm trên nền đắp/cắt như thật.
    // KHÔNG áp cho cầu/hầm (nước/đèo phải giữ nguyên).
    _buildRoadBench(cx, cz) {
        if (!this.roadGraph || !this._segByChunk) return null;
        const sids = this._segByChunk.get(cx + "," + cz);
        if (!sids || !sids.length) return null;
        const N = 33, step = CHUNK_SIZE / (N - 1);
        const x0 = cx * CHUNK_SIZE;
        const Y = new Float32Array(N * N).fill(NaN);
        const D = new Float32Array(N * N).fill(Infinity);
        const HW = new Float32Array(N * N);
        let hit = false;
        for (const sid of sids) {
            const seg = this.roadGraph.getSegment(sid);
            if (!seg || seg.bridge || seg.class === "TUNNEL") continue;
            const p1 = this.roadGraph.getNode(seg.from);
            const p2 = this.roadGraph.getNode(seg.to);
            if (!p1 || !p2) continue;
            const hw = (seg.width || 12) * 0.5;
            const reach = hw + 14.0;
            const dx = p2.x - p1.x, dz = p2.z - p1.z;
            const l2 = dx * dx + dz * dz;
            if (l2 <= 0) continue;
            const i0 = clamp(Math.floor((Math.min(p1.x, p2.x) - reach - x0) / step), 0, N - 1);
            const i1 = clamp(Math.ceil((Math.max(p1.x, p2.x) + reach - x0) / step), 0, N - 1);
            const j0 = clamp(Math.floor((Math.min(p1.z, p2.z) - reach - x0) / step), 0, N - 1);
            const j1 = clamp(Math.ceil((Math.max(p1.z, p2.z) + reach - x0) / step), 0, N - 1);
            const y1 = typeof p1.y === "number" ? p1.y : this.world.getElevation(p1.x, p1.z);
            const y2 = typeof p2.y === "number" ? p2.y : this.world.getElevation(p2.x, p2.z);
            // Đoạn lệch terrain > 12m là cầu vượt/đường trên cao (node.y do
            // _fix_bridge_heights nâng) — KHÔNG đắp nền 72m xuống đất bên dưới.
            if (Math.abs(y1 - this.world.getElevation(p1.x, p1.z)) > 12.0) continue;
            if (Math.abs(y2 - this.world.getElevation(p2.x, p2.z)) > 12.0) continue;
            for (let j = j0; j <= j1; j++) {
                const wz = x0 + j * step;
                for (let i = i0; i <= i1; i++) {
                    const wx = x0 + i * step;
                    let t = ((wx - p1.x) * dx + (wz - p1.z) * dz) / l2;
                    t = clamp(t, 0, 1);
                    const ex = wx - (p1.x + dx * t), ez = wz - (p1.z + dz * t);
                    const d = Math.sqrt(ex * ex + ez * ez);
                    if (d > reach) continue;
                    const k = j * N + i;
                    if (d < D[k]) { D[k] = d; Y[k] = lerp(y1, y2, t); HW[k] = hw; hit = true; }
                }
            }
        }
        return hit ? { Y, D, HW, N, step, x0 } : null;
    }

    _addChunkTerrain(cx, cz, parent, px, pz) {
        const originX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const originZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
        // LOD terrain: chunk gần dùng lưới 32, chunk xa dùng 16 (tiết kiệm ~60%
        // tam giac o vong ngoai). Fog che het nen KHONG mat chi tiet nhin thay.
        let seg = TERRAIN_SEG;
        if (px !== undefined && pz !== undefined) {
            const d = Math.hypot(originX - px, originZ - pz);
            if (d > 3.2 * CHUNK_SIZE) seg = TERRAIN_SEG_LOD;
        }
        const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, seg, seg);
        const pos = geo.attributes.position;
        let hasSea = false;
        const sea = this.world.seaLevel;
        // 1 vòng duy nhất: height + màu (dùng chung kết quả quét corridor/bờ)
        const colors = new Float32Array(pos.count * 3);
        const cSand = new THREE.Color(0xd8c78f);
        const cGrass = new THREE.Color(0x4d7a3c);
        const cGrass2 = new THREE.Color(0x3f6b3a);   // xanh đậm (lục)
        const cDry = new THREE.Color(0x93904f);
        const cDry2 = new THREE.Color(0xa89a5c);   // cỏ khô vàng
        const cRock = new THREE.Color(0x7d766a);
        const cDirt = new THREE.Color(0x8a6b46);
        const bench = this._buildRoadBench(cx, cz);
        const tmp = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const wx = pos.getX(i) + originX;
            const wz = pos.getY(i) + originZ;   // TRUOC rotate: plane nam trong XY
            const info = this.world.getElevationInfo(wx, wz);
            let h = info.h;
            // ép terrain bám mặt đường (xem _buildRoadBench)
            if (bench) {
                const gi = Math.round((wx - bench.x0) / bench.step);
                const gj = Math.round((wz - bench.x0) / bench.step);
                if (gi >= 0 && gi < bench.N && gj >= 0 && gj < bench.N) {
                    const k = gj * bench.N + gi;
                    const by = bench.Y[k];
                    if (by === by) {
                        const inner = bench.HW[k] + 1.5;
                        const outer = inner + 12.0;
                        const d = bench.D[k];
                        if (d <= inner) h = by;
                        else {
                            let t = (d - inner) / (outer - inner);
                            t = t * t * (3 - 2 * t);
                            h = lerp(by, h, t);
                        }
                    }
                }
            }
            pos.setZ(i, h);
            if (info.h < sea) hasSea = true;
            if (info.h < sea + 0.4) tmp.copy(cSand);
            else if (info.h > 180) tmp.copy(cRock);
            else if (info.p && info.p.arid > 0.55) {
                // pha cỏ khô 2 sắc theo noise -> đồng cỏ không bằng phẳng
                const n = fract(Math.sin(wx * 0.013 + wz * 0.021) * 43758.5453);  // noise 1 chieu
                tmp.copy(cDry).lerp(cDry2, n);
            } else if (info.d < 260) {
                const n = fract(Math.sin(wx * 0.019 + wz * 0.011) * 24634.6345);
                tmp.copy(cSand).lerp(cDirt, n * 0.55);
            } else {
                // đồng cỏ: 3 sắc xanh xen kẽ theo tần số thấp + cao
                const n1 = fract(Math.sin(wx * 0.0071 + wz * 0.0053) * 15731.743);
                const n2 = fract(Math.sin(wx * 0.031 + wz * 0.027) * 9781.13);
                tmp.copy(cGrass).lerp(cGrass2, n1 * 0.7 + n2 * 0.3);
            }
            colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
        }
        geo.rotateX(-Math.PI / 2);
        geo.computeVertexNormals();
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const mesh = new THREE.Mesh(geo, this._terrainMat);
        mesh.position.set(originX, 0, originZ);     // rule 37: đúng world position
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.name = `terrain_${cx}_${cz}`;
        parent.add(mesh);

        if (hasSea) {
            // 1 mesh/chunk, 8x8 luoi: mau theo DO SAU (nen manh -> xanh sau)
            const wg = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 8, 8);
            const wp = wg.attributes.position;
            const wc = new Float32Array(wp.count * 3);
            const shallow = new THREE.Color(0x6fc4cf);
            const mid = new THREE.Color(0x2f8ba6);
            const deep = new THREE.Color(0x14506e);
            const wtmp = new THREE.Color();
            for (let i = 0; i < wp.count; i++) {
                const gx = wp.getX(i) + originX;
                const gz = wp.getY(i) + originZ;
                const depth = Math.max(0, sea - this.world.getElevationInfo(gx, gz).h);
                if (depth < 3) wtmp.copy(shallow);
                else if (depth < 16) wtmp.copy(shallow).lerp(mid, (depth - 3) / 13);
                else wtmp.copy(mid).lerp(deep, clamp((depth - 16) / 34, 0, 1));
                wc[i * 3] = wtmp.r; wc[i * 3 + 1] = wtmp.g; wc[i * 3 + 2] = wtmp.b;
            }
            wg.setAttribute("color", new THREE.BufferAttribute(wc, 3));
            const w = new THREE.Mesh(wg, this._mats.waterDepth);
            w.rotation.x = -Math.PI / 2;
            w.position.set(originX, sea, originZ);
            w.matrixAutoUpdate = false;
            w.updateMatrix();
            w.name = `water_${cx}_${cz}`;
            parent.add(w);
        }

        this._addChunkRivers(cx, cz, parent, sea);
    }

    // Mặt nước sông/hồ trong chunk (nước đứng y = seaLevel + 0.15)
    _addChunkRivers(cx, cz, parent, sea) {
        if (!this.world.rivers.length && !this.world.lakes.length) return;
        const minX = cx * CHUNK_SIZE, maxX = minX + CHUNK_SIZE;
        const minZ = cz * CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
        const level = sea + 0.15;
        const acc = new MeshAccum();

        for (const r of this.world.rivers) {
            const poly = r.poly;
            const half = r.width * 0.5;
            for (let i = 0; i < poly.length - 1; i++) {
                const a = poly[i], b = poly[i + 1];
                const dx = b[0] - a[0], dz = b[1] - a[1];
                const L = Math.hypot(dx, dz);
                if (L < 1) continue;
                // bỏ qua đoạn nằm ngoài chunk (có padding để nước không bị cắt)
                if (Math.max(a[0], b[0]) < minX - half || Math.min(a[0], b[0]) > maxX + half) continue;
                if (Math.max(a[1], b[1]) < minZ - half || Math.min(a[1], b[1]) > maxZ + half) continue;
                const ux = dx / L, uz = dz / L;
                const nx = -uz, nz = ux;
                const corners = [
                    [a[0] + nx * half, a[1] + nz * half], [b[0] + nx * half, b[1] + nz * half],
                    [b[0] - nx * half, b[1] - nz * half], [a[0] - nx * half, a[1] - nz * half]
                ];
                const clipped = clipRect(corners, minX, maxX, minZ, maxZ);
                if (clipped.length < 3) continue;
                acc.poly(clipped.map(p => [p[0], level, p[1]]));
            }
        }
        for (const lk of this.world.lakes) {
            if (lk.x + lk.rx < minX || lk.x - lk.rx > maxX) continue;
            if (lk.z + lk.rz < minZ || lk.z - lk.rz > maxZ) continue;
            const seg = 14;
            const pts = [];
            for (let k = 0; k <= seg; k++) {
                const ang = 2 * Math.PI * k / seg;
                const ca = Math.cos(lk.rot), sa = Math.sin(lk.rot);
                const lx = Math.cos(ang) * lk.rx, lz = Math.sin(ang) * lk.rz;
                pts.push([lk.x + lx * ca - lz * sa, lk.z + lx * sa + lz * ca]);
            }
            const clipped = clipRect(pts, minX, maxX, minZ, maxZ);
            if (clipped.length >= 3) acc.poly(clipped.map(p => [p[0], level, p[1]]));
        }
        if (!acc.empty) {
            const m = acc.build(this._mats.water, `river_${cx}_${cz}`);
            m.renderOrder = 1;
            parent.add(m);
        }
    }

    // ------------------------------------------------------------ buildings
    // TOI UU: gop MOI nha trong chunk thanh 1 body + 2 roof InstancedMesh
    // (instanceColor cho mau tung nha) => 3 draw call/chunk thay vi ~10-20.
    // KHONG bo chi tiet: van 200 variation, van mau mai/facade rieng.
    _addChunkBuildings(buildings, parent) {
        if (!buildings || buildings.length === 0) return;
        // BỎ nhà trạm thu phí: generator xuất TOLL/TOLL_LANE vào chunk, nhưng
        // _addTollPlaza(POI) đã dựng trọn trạm (mái + 3 làn + gạt + nhà).
        // Vẽ cả hai => chồng hình/z-fighting. Giữ 1 nguồn duy nhất.
        const list = buildings.filter(b => b.type !== "TOLL" && b.type !== "TOLL_LANE");
        if (list.length === 0) return;
        const nP = list.length;
        const bodies = new THREE.InstancedMesh(this._geos.unitBox, this._mats.bldBody, nP);
        const flatIdx = [], pitchIdx = [];
        for (let i = 0; i < nP; i++) {
            (list[i].roof_type === "pitched" ? pitchIdx : flatIdx).push(i);
        }
        const flatMesh = flatIdx.length
            ? new THREE.InstancedMesh(this._geos.unitBox, this._mats.bldRoof, flatIdx.length) : null;
        const pitchMesh = pitchIdx.length
            ? new THREE.InstancedMesh(this._geos.roofPyramid, this._mats.bldRoof, pitchIdx.length) : null;

        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const v3 = new THREE.Vector3();
        const s3 = new THREE.Vector3();
        const col = new THREE.Color();
        let fi = 0, pi = 0;

        for (let i = 0; i < nP; i++) {
            const b = list[i];
            const w = b.w || 5, d = b.d || 5, h = b.height || 8;
            e.set(0, b.rot || 0, 0); q.setFromEuler(e);

            v3.set(b.x, b.y + h / 2, b.z);
            s3.set(w, h, d);
            m4.compose(v3, q, s3);
            bodies.setMatrixAt(i, m4);
            col.setHex(b.color || b.facade || 0xe6e2d8);
            bodies.setColorAt(i, col);

            const pitched = b.roof_type === "pitched";
            const target = pitched ? pitchMesh : flatMesh;
            const idx = pitched ? pi++ : fi++;
            if (pitched) {
                // MÁI RỘNG (nhà VN): mái nhô ra ngoài thân nhà ~15%, mái thấp
                v3.set(b.x, b.y + h + 0.95, b.z);
                const rw = Math.max(w, d) * 1.16;
                s3.set(rw, 2.5, rw);
            } else {
                v3.set(b.x, b.y + h + 0.22, b.z);
                s3.set(w * 1.10, 0.44, d * 1.10);
            }
            m4.compose(v3, q, s3);
            target.setMatrixAt(idx, m4);
            col.setHex(b.roof_color || 0x8b3a3a);
            target.setColorAt(idx, col);
        }

        bodies.instanceMatrix.needsUpdate = true;
        if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
        bodies.computeBoundingSphere();
        parent.add(bodies);
        for (const rm of [flatMesh, pitchMesh]) {
            if (!rm) continue;
            rm.instanceMatrix.needsUpdate = true;
            if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
            rm.computeBoundingSphere();
            parent.add(rm);
        }

        this._addShopFronts(list, parent);
        this._addHouseDetails(list, parent);
    }

    // CHI TIẾT NHÀ VIỆT: dải cửa sổ + hàng rào + ban công (3 InstancedMesh)
    // Quy tắc không cần field thêm: nhà thấp/mái nhip = nhà vườn (có rào),
    // nhà cao >= 3 tầng = shophouse (có ban công).
    _addHouseDetails(buildings, parent) {
        const bands = [], fences = [], balcs = [];
        for (const b of buildings) {
            const w = b.w || 5, d = b.d || 5, h = b.height || 8;
            const th = b.rot || 0;
            const sy = Math.sin(th), cy = Math.cos(th);
            const front = d * 0.5 + 0.05;
            // 1) dải cửa sổ tầng 1 (tầng trệt / cửa hàng) + tầng 2
            bands.push([b.x, b.y + 1.75, b.z, th, w * 0.86, 1.5, front, cy, sy]);
            if (h > 6.2) {
                bands.push([b.x, b.y + 5.1, b.z, th, w * 0.80, 1.15, front, cy, sy]);
            }
            if (h > 9.6) {
                bands.push([b.x, b.y + 8.3, b.z, th, w * 0.74, 1.0, front, cy, sy]);
            }
            // 2) hàng rào / tường viện trước nhà vườn (nhà 1-2 tầng, mái nhip)
            if (h <= 8.2 && b.roof_type === "pitched") {
                fences.push([b.x, b.y + 0.62, b.z, th, w * 1.05, 1.25, front + 2.6, cy, sy]);
            }
            // 3) ban công cho shophouse 3+ tầng
            if (h >= 9.6) {
                balcs.push([b.x, b.y + 6.4, b.z, th, w * 0.88, 0.16, front + 0.75, cy, sy]);
            }
        }
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const v3 = new THREE.Vector3();
        const s3 = new THREE.Vector3();

        const build = (list, mat, name, sy0) => {
            if (!list.length) return;
            const mesh = new THREE.InstancedMesh(this._geos.unitBox, mat, list.length);
            for (let i = 0; i < list.length; i++) {
                const [x, y, z, th, sw, sh, off, cy, sy] = list[i];
                e.set(0, th, 0); q.setFromEuler(e);
                v3.set(x + sy * off, y + sy0, z + cy * off);
                s3.set(sw, sh, 0.14);
                m4.compose(v3, q, s3);
                mesh.setMatrixAt(i, m4);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.name = name;
            parent.add(mesh);
        };
        build(bands, this._mats.windowBand, "house_windows", 0);
        build(fences, this._mats.fence, "house_fences", 0);
        build(balcs, this._mats.balcony, "house_balconies", 0);
    }

    // BANG HIEU + MAI HIEN: mat tien cua nha pho la mat +Z (generator quay
    // nha ve phia duong) => 2 InstancedMesh, nhieu vi tri, mau theo vi trí.
    _addShopFronts(buildings, parent) {
        const signs = [], awns = [];
        for (const b of buildings) {
            if (b.sign) signs.push(b);
            if (b.awning) awns.push(b);
        }
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const v3 = new THREE.Vector3();
        const s3 = new THREE.Vector3();
        const col = new THREE.Color();
        // bang mau cua hang Viet (do/red, xanh blue, vang yellow, trang white)
        const BRAND = [0xd32f2f, 0x1565c0, 0xfbc02d, 0xf5f5f5, 0x2e7d32, 0x6a1b9a];

        if (signs.length) {
            const mesh = new THREE.InstancedMesh(this._geos.unitBox, this._mats.sign, signs.length);
            for (let i = 0; i < signs.length; i++) {
                const b = signs[i];
                const th = b.rot || 0;
                const w = b.w || 5, d = b.d || 5, h = b.height || 8;
                const off = d * 0.5 + 0.09;
                const sy = Math.sin(th), cy = Math.cos(th);
                // bang o tang 1, sat be mat tien
                const hy = b.y + (h > 7.5 ? 4.3 : h * 0.72);
                e.set(0, th, 0); q.setFromEuler(e);
                v3.set(b.x + sy * off, hy, b.z + cy * off);
                s3.set(w * 0.86, 1.25, 0.16);
                m4.compose(v3, q, s3);
                mesh.setMatrixAt(i, m4);
                const k = Math.abs(Math.round(b.x * 0.37 + b.z * 0.61)) % BRAND.length;
                col.setHex(BRAND[k]);
                mesh.setColorAt(i, col);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.name = "signs";
            parent.add(mesh);
        }

        if (awns.length) {
            const mesh = new THREE.InstancedMesh(this._geos.unitBox, this._mats.awning, awns.length);
            for (let i = 0; i < awns.length; i++) {
                const b = awns[i];
                const th = b.rot || 0;
                const w = b.w || 5, d = b.d || 5;
                const off = d * 0.5 + 0.75;
                const sy = Math.sin(th), cy = Math.cos(th);
                e.set(0, th, -0.16); q.setFromEuler(e);   // nheo xuong nhu mai hien
                v3.set(b.x + sy * off, b.y + 3.25, b.z + cy * off);
                s3.set(w * 0.92, 0.14, 1.6);
                m4.compose(v3, q, s3);
                mesh.setMatrixAt(i, m4);
                const k = Math.abs(Math.round(b.z * 0.53 - b.x * 0.29)) % BRAND.length;
                col.setHex(BRAND[k]).multiplyScalar(0.85);
                mesh.setColorAt(i, col);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.name = "awnings";
            parent.add(mesh);
        }
    }

    // --------------------------------------------------------------- objects
    _addChunkObjects(objects, parent, lowDetail) {
        if (!objects || objects.length === 0) return;
        const buckets = new Map();
        const push = (k, geo, mat, x, y, z, sx, sy, sz, ry) => {
            let b = buckets.get(k);
            if (!b) { b = { geo, mat, list: [] }; buckets.set(k, b); }
            b.list.push([x, y, z, sx, sy, sz, ry || 0]);
        };
        const M = this._mats, G = this._geos;
        for (const o of objects) {
            // FAR-LOD: bo vat nho o chunk xa (cay/cot/bui) - fog 1450m che het
            if (lowDetail && o.type !== "RICE_FIELD" && o.type !== "DRY_FIELD") continue;
            const y = o.y || 0, x = o.x, z = o.z;
            switch (o.type) {
                case "TREE":
                    push("trunk", G.trunk, M.trunk, x, y + 1.9, z, 1, 3.8, 1, 0);
                    push("leaf", G.canopy, M.leaves, x, y + 5.0, z, 2.5, 2.1, 2.5, o.rot || 0);
                    break;
                case "PINE_TREE":
                    push("pine", G.pine, M.leaves, x, y + 4.5, z, 2.1, 8.0, 2.1, o.rot || 0);
                    break;
                case "PALM_TREE":
                    push("ptrunk", G.palmTrunk, M.trunk, x, y + 4.0, z, 1, 8.0, 1, 0);
                    push("pleaf", G.palmLeaf, M.palmLeaf, x, y + 8.2, z, 3.0, 1.6, 3.0, o.rot || 0);
                    break;
                case "CASUARINA":
                    push("trunk", G.trunk, M.trunk, x, y + 2.6, z, 1.1, 5.2, 1.1, 0);
                    push("crown", G.canopy, M.leaves, x, y + 6.0, z, 2.2, 3.0, 2.2, 0);
                    break;
                case "BAMBOO":
                    push("bamboo", G.bamboo, M.bamboo, x, y + 2.4, z, 1, 4.8, 1, 0);
                    break;
                case "CACTUS":
                    push("cactus", G.cactus, M.cactus, x, y + 0.9, z, 1, 1.2, 1, 0);
                    break;
                case "DRY_BUSH":
                    push("bush", G.bush, M.dryBush, x, y + 0.5, z, 0.8, 0.7, 0.8, o.rot || 0);
                    break;
                case "STREET_LIGHT": {
                    const rot = o.rot || 0;
                    const ax = Math.sin(rot), az = Math.cos(rot);
                    push("sl_pole", G.pole, M.pole, x, y + 4.5, z, 0.8, 9.0, 0.8, 0);
                    // cánh đèn hướng về lòng đường (offset khỏi cột, không cắm chồng)
                    push("sl_arm", G.poleArm, M.pole,
                         x + ax * 1.15, y + 8.75, z + az * 1.15, 2.5, 1, 1, rot);
                    // bóng đèn ở đầu cánh
                    push("sl_lamp", G.unitBox, M.lamp,
                         x + ax * 2.25, y + 8.5, z + az * 2.25, 0.72, 0.26, 0.46, rot);
                    break;
                }
                case "CROSSWALK": {
                    const rot = o.rot || 0;
                    const ux = Math.sin(rot), uz = Math.cos(rot);
                    for (let s = -3; s <= 3; s++) {
                        const off = s * 1.1;
                        push("cw", G.unitBox, M.paintWhite,
                             x - uz * off, y + 0.12, z + ux * off,
                             0.55, 0.06, 4.2, rot);
                    }
                    break;
                }
                case "GUARDRAIL": {
                    // 1 doan lan can 8.2m (generator dat moi 8m) -> lien mach
                    push("rail", G.unitBox, M.metal,
                         x, y + 0.28, z, 0.16, 0.42, 8.2, o.rot || 0);
                    break;
                }
                case "POLE": {
                    push("pole", G.pole, M.pole, x, y + 4.5, z, 1, 9.0, 1, 0);
                    push("arm", G.poleArm, M.pole, x, y + 8.4, z, 2.4, 1, 1, o.rot || 0);
                    break;
                }
                case "RICE_FIELD":
                case "DRY_FIELD": {
                    const mat = o.type === "RICE_FIELD" ? M.rice : M.dryField;
                    const w = o.w || 50, d = o.d || 50;
                    push("field", G.field, mat, x, y - 0.12, z, w, 0.14, d, o.rot || 0);
                    break;
                }
                default:
                    break;
            }
        }
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        const v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
        for (const b of buckets.values()) {
            const mesh = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
            for (let i = 0; i < b.list.length; i++) {
                const [x, y, z, sx, sy, sz, ry] = b.list[i];
                e.set(0, ry, 0); q.setFromEuler(e);
                v3.set(x, y, z); s3.set(sx, sy, sz);
                m4.compose(v3, q, s3);
                mesh.setMatrixAt(i, m4);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            parent.add(mesh);
        }
    }

    // ------------------------------------------------------------ facilities
    _addFacility(f, parent) {
        if (!f) return;
        const g = new THREE.Group();
        const y = f.y || 0;
        g.position.set(f.x, y, f.z);
        g.rotation.y = f.rot || 0;
        const isFuel = f.type === "FUEL_STATION";
        const W = f.w || 50, D = f.d || 40;

        // mặt sàn
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(W, D), this._mats.concrete);
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.08;
        g.add(pad);

        if (isFuel) {
            // mái che + cột bơm (Petrolimex/PVOIL)
            const canopy = new THREE.Mesh(this._geos.unitBox, this._mats.fuelBrandA);
            canopy.scale.set(W * 0.7, 0.6, D * 0.42);
            canopy.position.set(0, 6.2, 0);
            g.add(canopy);
            for (const sx of [-1, 1]) {
                const col = new THREE.Mesh(this._geos.pole, this._mats.metal);
                col.scale.set(1.3, 6.2, 1.3);
                col.position.set(sx * W * 0.28, 3.1, 0);
                g.add(col);
            }
            for (let i = 0; i < 3; i++) {
                const pump = new THREE.Mesh(this._geos.unitBox, this._mats.fuel);
                pump.scale.set(1.2, 2.0, 1.0);
                pump.position.set((i - 1) * 5, 1.0, -D * 0.1);
                g.add(pump);
            }
            const shop = new THREE.Mesh(this._geos.unitBox, this._mats.wall);
            shop.scale.set(W * 0.28, 5.5, D * 0.22);
            shop.position.set(-W * 0.3, 2.75, D * 0.28);
            g.add(shop);
        } else {
            // trạm nghỉ: nhà + bãi đỗ xe buýt
            const b = new THREE.Mesh(this._geos.unitBox, this._mats.wall);
            b.scale.set(W * 0.3, 6.5, D * 0.28);
            b.position.set(-W * 0.3, 3.25, -D * 0.25);
            g.add(b);
            const roof = new THREE.Mesh(this._geos.unitBox, this._mats.roof);
            roof.scale.set(W * 0.32, 0.4, D * 0.3);
            roof.position.set(-W * 0.3, 6.6, -D * 0.25);
            g.add(roof);
            for (let i = 0; i < 4; i++) {
                const line = new THREE.Mesh(this._geos.unitBox, this._mats.paintWhite);
                line.scale.set(16, 0.06, 0.3);
                line.position.set(W * 0.18, 0.12, (i - 1.5) * 7);
                g.add(line);
            }
            const canopy = new THREE.Mesh(this._geos.unitBox, this._mats.metal);
            canopy.scale.set(W * 0.5, 0.4, 8);
            canopy.position.set(W * 0.1, 5.4, 0);
            g.add(canopy);
            for (const sx of [-1, 1]) {
                const col = new THREE.Mesh(this._geos.pole, this._mats.metal);
                col.scale.set(1.2, 5.4, 1.2);
                col.position.set(W * 0.1 + sx * W * 0.22, 2.7, 0);
                g.add(col);
            }
        }
        parent.add(g);
    }

    // ĐIỂM DỪNG XE BUÝT dọc QL1A: mái chờ + biển bảng + ghế + vệt đường
    _addBusStop(s) {
        const M = this._mats, G = this._geos;
        const g = new THREE.Group();
        g.name = `busstop_${s.id}`;
        g.position.set(s.x, s.y, s.z);
        g.rotation.y = s.rot || 0;

        // mặt đường lõm (đứng xe khách sát mép đường)
        const bay = new THREE.Mesh(this._geos.unitBox, M.concrete);
        bay.scale.set(4.2, 0.12, 13);
        bay.position.set(0, 0.06, 0);
        g.add(bay);

        // mái chờ 4 cột + roof
        for (const sx of [-1.4, 1.4]) {
            for (const sz of [-1.9, 1.9]) {
                const col = new THREE.Mesh(G.pole, M.metal);
                col.scale.set(0.16, 2.6, 0.16);
                col.position.set(sx, 1.3, sz);
                g.add(col);
            }
        }
        const roof = new THREE.Mesh(this._geos.unitBox, M.fuelBrandA);
        roof.scale.set(3.6, 0.18, 4.8);
        roof.position.set(0, 2.7, 0);
        g.add(roof);
        const back = new THREE.Mesh(this._geos.unitBox, M.glass);
        back.scale.set(3.4, 2.0, 0.12);
        back.position.set(0, 1.4, -2.1);
        g.add(back);

        // biển bảng đứng + cột
        const signPost = new THREE.Mesh(G.pole, M.metal);
        signPost.scale.set(0.12, 3.2, 0.12);
        signPost.position.set(-2.6, 1.6, -2.0);
        g.add(signPost);
        const sign = new THREE.Mesh(this._geos.unitBox, M.paintWhite);
        sign.scale.set(1.3, 0.9, 0.1);
        sign.position.set(-2.6, 3.2, -2.0);
        g.add(sign);
        const signFace = new THREE.Mesh(this._geos.unitBox, M.fuelBrandB);
        signFace.scale.set(1.15, 0.72, 0.06);
        signFace.position.set(-2.6, 3.2, -1.92);
        g.add(signFace);

        this.stationGroup.add(g);
    }

    // TRẠM THU PHÍ: đường + 3 làn + gạt xe + nhà thu phí + mái che
    _addTollPlaza(s) {
        const M = this._mats, G = this._geos;
        const g = new THREE.Group();
        g.name = `toll_${s.id}`;
        g.position.set(s.x, s.y, s.z);
        g.rotation.y = s.rot || 0;

        // sàn trạm + 3 làn (2 vào không barie, 1 ra có barie)
        const pad = new THREE.Mesh(this._geos.unitBox, M.concrete);
        pad.scale.set(26, 0.16, 40);
        pad.position.set(0, 0.08, 0);
        g.add(pad);
        for (let i = -1; i <= 1; i++) {
            const lane = new THREE.Mesh(this._geos.unitBox, M.laneLine);
            lane.scale.set(0.25, 0.06, 34);
            lane.position.set(i * 8, 0.18, 0);
            g.add(lane);
        }
        // mái che toàn trạm
        const canopy = new THREE.Mesh(this._geos.unitBox, M.metal);
        canopy.scale.set(26, 0.5, 9);
        canopy.position.set(0, 6.2, 2);
        g.add(canopy);
        for (const sx of [-11, 11]) {
            for (const sz of [-1, 1]) {
                const col = new THREE.Mesh(G.pole, M.metal);
                col.scale.set(0.6, 6.2, 0.6);
                col.position.set(sx, 3.1, 2 + sz * 3.5);
                g.add(col);
            }
        }
        // nhà thu phí
        const office = new THREE.Mesh(this._geos.unitBox, M.wall);
        office.scale.set(10, 4.2, 7);
        office.position.set(-15, 2.1, 6);
        g.add(office);
        const officeRoof = new THREE.Mesh(this._geos.unitBox, M.roof);
        officeRoof.scale.set(10.6, 0.4, 7.6);
        officeRoof.position.set(-15, 4.35, 6);
        g.add(officeRoof);
        // gạt xe ở làn ra
        for (let i = -1; i <= 1; i++) {
            const booth = new THREE.Mesh(this._geos.unitBox, M.wall);
            booth.scale.set(1.6, 2.6, 2.2);
            booth.position.set(i * 8, 1.3, 6);
            g.add(booth);
            const bar = new THREE.Mesh(this._geos.unitBox, M.fuelBrandB);
            bar.scale.set(0.18, 0.9, 7.0);
            bar.position.set(i * 8 + 1.2, 1.0, 1.0);
            g.add(bar);
        }
        this.stationGroup.add(g);
    }

    // -------------------------------------------------------------- station
    _buildStations() {
        const M = this._mats, G = this._geos;
        // nhóm POI để cull theo khoảng cách (bến nhìn xa, điểm dừng gần)
        this._poiGroups = [];
        const track = (g, s, radius) => this._poiGroups.push(
            { g, x: s.x, z: s.z, r: radius });
        for (const s of this.stationsData) {
            if (s.type === "FUEL_STATION" || s.type === "REST_AREA") {
                this._addFacility(s, this.stationGroup);
                track(this.stationGroup.children[this.stationGroup.children.length - 1], s, 1100);
                continue;
            }
            if (s.type === "TOLL" || s.type === "TOLL_LANE") {
                this._addTollPlaza(s);
                track(this.stationGroup.children[this.stationGroup.children.length - 1], s, 1200);
                continue;
            }
            if (s.type === "BUS_STOP") {
                this._addBusStop(s);
                track(this.stationGroup.children[this.stationGroup.children.length - 1], s, 750);
                continue;
            }
            const g = new THREE.Group();
            g.name = `station_${s.id}`;
            g.position.set(s.x, s.y, s.z);
            g.rotation.y = s.rot || 0;
            const W = s.w || 180, D = s.d || 130;

            // 1) SÂN BẾN — MỘT MẶT PHẲNG CÓ THÂN (P50)
            //
            // Bản cũ (trước P44) là `PlaneGeometry` phẳng lẻ, lơ lửng trên nền.
            // Bản P44/P46 dựng lưới 16×12 bám `_surfaceAt` bán kính 160m — SAI:
            // ở mép sân, bán kính 160m nuốt cả đường NGOÀI sân ở cao độ khác,
            // các đỉnh lưới nhảy nhót ⇒ sân vỡ thành tấm vá (đã thấy trong ảnh).
            //
            // Sân là MẶT PHẲNG BÊ TÔNG: nó chỉ cần ĐÚNG CAO ĐỘ (P40 đã bảo đảm
            // `st.y` khớp đường trong sân: cả 5 bến lệch ≤ 0.011m) và CÓ THÂN.
            // Không có node hình học nào trên sân nên không thể vỡ mảnh.
            {
                const yl = this._yardLift();
                const top = new MeshAccum();
                const sideA = new MeshAccum();
                // P58: HỆ CỤC BỘ CỦA GROUP = (oz, ox), KHÔNG phải (ox, oz).
                //   w = 190 là chiều DỌC trục ox (vuông góc đường) -> ô lz (z cục bộ)
                //   d = 140 là chiều NGANG trục oz (dọc đường)     -> ô lx (x cục bộ)
                // Bản cũ đặt W lên x, D lên z = xoay sân 90° so với đường nội bộ.
                const ring = [
                    [-D / 2, 0, -W / 2], [D / 2, 0, -W / 2],
                    [D / 2, 0, W / 2], [-D / 2, 0, W / 2]
                ].map(q => [q[0], yl, q[2]]);
                // P57: chiều kim phải để pháp tuyến hướng LÊN (+Y).
                // `quad(a,b,c,d)` sinh (a,b,c)+(b,d,c); với ring theo chiều
                // kim đồng hồ từ trên xuống thì cross((b-a),(c-b)) = (0,-W*D,0)
                // ⇒ pháp tuyến hướng XUỐNG ⇒ `MeshLambertMaterial` cho sân
                // ĐEN. Đo được: `concrete` là 0x8a8a86 (xám sáng) mà sân vẫn
                // đen. Đảo chiều ở đây.
                top.quad(ring[1], ring[0], ring[3], ring[2]);
                const sa_ = Math.sin(s.rot || 0), ca_ = Math.cos(s.rot || 0);
                // P58: local -> world PHẢI theo ma trận của `g.rotation.y`:
                //   x' = lx·cos(r) + lz·sin(r) ;  z' = −lx·sin(r) + lz·cos(r)
                // Bản cũ dùng w2() của generator (phản xạ, det = −1) ⇒ mẫu
                // terrain lệch hàng chục mét ⇒ váy sân bám nhầm chỗ.
                const bots = ring.map(q => {
                    const wx = s.x + q[0] * ca_ + q[2] * sa_;
                    const wz = s.z - q[0] * sa_ + q[2] * ca_;
                    return Math.min(q[1] - ROAD_THICK,
                        this.world.getElevation(wx, wz) - 0.05);
                });
                let deep = 0;
                for (let k = 0; k < 4; k++) {
                    const d2 = ring[k][1] - bots[k];
                    if (d2 > deep) deep = d2;
                }
                sideA.skirt(ring, bots, deep > 1.2);
                const yard = top.build(M.concrete, `yard_${s.id}`);
                g.add(yard);
                if (!sideA.empty) g.add(sideA.build(M.shoulder, `yardBody_${s.id}`));
            }

            // 2) vạch ranh sân
            const edge = new THREE.Mesh(this._geos.unitBox, M.paintWhite);
            // P58: dọc đường = trục x cục bộ (chiều D), hướng vào bến = trục z (chiều W)
            edge.scale.set(D, 0.05, 0.35);
            edge.position.set(0, this.world.yardLift + 0.03, W / 2 - 2);
            g.add(edge);

            // 3) nhà ga (ticket building) — LẤY TỪ `structures` CỦA GENERATOR.
            //    stations.json ghi rõ "JS vẽ sân + nha ga + cong trinh tu data
            //    nay. Truoc day JS tu tinh lai toa do World => lech khung" — nhưng
            //    bản cũ vẫn hard-code toạ độ CỤC BỘ theo hệ (ox, oz) trong khi
            //    group bến dùng hệ (oz, ox) ⇒ toàn bộ nhà ga/utility lệch 90°.
            //    gen.w nằm trên trục ox (vào bến) -> bề DÀI cục bộ = trục z
            //    gen.d nằm trên trục oz (dọc đường) -> bề NGANG cục bộ = trục x
            const term = (s.structures || []).find(k => k.type === "TERMINAL");
            const tbOut = term ? term.d : D * 0.22;   // bề ngang cục bộ (dọc đường)
            const tbLen = term ? term.w : W * 0.34;   // bề dài cục bộ (vuông góc đường)
            const tbX = term ? term.oz : -D * 0.12;   // = oz
            const tbZ = term ? term.ox : -W * 0.28;   // = ox
            const tbH = 13;
            const tb = new THREE.Mesh(this._geos.unitBox, M.wall);
            tb.scale.set(tbOut, tbH, tbLen);
            tb.position.set(tbX, tbH / 2 + this.world.yardLift, tbZ);
            g.add(tb);
            const glassBand = new THREE.Mesh(this._geos.unitBox, M.glass);
            glassBand.scale.set(tbOut * 1.01, 3.4, tbLen * 1.01);
            glassBand.position.set(tbX, 8.6 + this.world.yardLift, tbZ);
            g.add(glassBand);
            const roof = new THREE.Mesh(this._geos.unitBox, M.roof);
            roof.scale.set(tbOut * 1.12, 0.7, tbLen * 1.15);
            roof.position.set(tbX, tbH + this.world.yardLift + 0.3, tbZ);
            g.add(roof);
            // mái đón khách — nhô về phía CỔNG (+z cục bộ = +ox = hướng đường chính)
            const awn = new THREE.Mesh(this._geos.unitBox, M.metal);
            awn.scale.set(tbOut * 0.9, 0.3, 6);
            awn.position.set(tbX, 5.2, tbZ + tbLen / 2 + 3);
            g.add(awn);

            // 4) tiện ích (kho/nhà vệ sinh/quầy) — cũng từ `structures`
            const utils = [];
            for (const k of (s.structures || [])) {
                if (k.type === "TERMINAL") continue;
                utils.push({ x: k.oz, z: k.ox, w: k.d, d: k.w, h: k.type === "WAREHOUSE" ? 6.0 : 4.5 });
            }
            for (const u of utils) {
                const b = new THREE.Mesh(this._geos.unitBox, M.wall);
                b.scale.set(u.w, u.h, u.d);
                b.position.set(u.x, u.h / 2 + this.world.yardLift, u.z);
                g.add(b);
                const r = new THREE.Mesh(this._geos.roofPyramid, M.roof);
                r.scale.set(u.w * 0.9, 2.0, u.d * 0.9);
                r.position.set(u.x, u.h + 1.0 + this.world.yardLift, u.z);
                r.rotation.y = Math.PI / 4;
                g.add(r);
            }

            // 5) mái che + nan đỗ (theo baySlots thật từ generator)
            const slots = Array.isArray(s.baySlots) ? s.baySlots : [];
            const usedX = new Set();
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                const lx = slot.x - s.x, lz = slot.z - s.z;
                // P58: world -> cục bộ phải dùng Rᵀ(rot) = ĐẢO ma trận của
                // `g.rotation.y`, tức cos(+rot)/sin(+rot). Bản cũ lấy cos(−rot)
                // = áp DUNG ma trận chuyển tiếp ⇒ xoay HAI LẦN (đo: lệch
                // 110.8 / 115.7 / 130.2 / 130.2 m ⇒ "cột, mái lung tung").
                const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
                const lxx = lx * c - lz * sn, lzz = lx * sn + lz * c;
                // nan nằm trên mặt sân tại độ cao thật của slot (sân có thể nghiêng)
                const baseY = (typeof slot.y === "number" && typeof s.y === "number")
                    ? (slot.y - s.y) : this.world.yardLift;

                const canopy = new THREE.Mesh(this._geos.unitBox, M.metal);
                // P58: mái che/nan bám TRỤC CỦA GROUP (lxx = dọc đường,
                // lzz = trục đỗ xe) — không cần xoay thêm. Bản cũ đặt
                // `rotation.y = −rot` ⇒ tổng quay = 0 (cố định theo WORLD)
                // ⇒ mái che quay lệch so với hàng bãi.
                canopy.scale.set(5.0, 0.35, 13);
                canopy.position.set(lxx, baseY + 6.0, lzz);
                g.add(canopy);

                for (const dz of [-5.5, 5.5]) {
                    const pillar = new THREE.Mesh(G.pole, M.metal);
                    pillar.scale.set(1.1, 6.0, 1.1);
                    pillar.position.set(lxx, baseY + 3.0, lzz + dz);
                    g.add(pillar);
                }

                // vạch đỗ xe (trắng) — dùng chính data slot để xe đậu đúng chỗ
                const mark = new THREE.Mesh(this._geos.unitBox, M.paintWhite);
                mark.scale.set(0.3, 0.06, 12);
                mark.position.set(lxx - 3.2, baseY + 0.06, lzz);
                g.add(mark);

                const key = Math.round(lxx / 18);
                if (!usedX.has(key)) {
                    usedX.add(key);
                    const pillar2 = new THREE.Mesh(G.pole, M.metal);
                    pillar2.scale.set(1.1, 6.0, 1.1);
                    pillar2.position.set(lxx + 3.2, baseY + 3.0, lzz);
                    g.add(pillar2);
                }
            }

            // 6) BIỂN TÊN BẾN (rule 16/24: signage) — đặt ở phía CỔNG vào
            // bến (phía đường chính) để khách nhìn thấy khi vào.
            this._addStationSign(g, s, W, D);

            // 7) ĐÈN SÂN + CÂY CẢNH (rule 16/24: lighting + landscaping)
            // Bến xe VN ban đêm sáng trắng, có hàng cây bóng mát dọc lối vào.
            this._addStationLights(g, s, W, D);

            this.stationGroup.add(g);
            track(g, s, 2600);
        }
    }

    // BIỂN TÊN BẾN — texture chữ thật (CanvasTexture), 1 cái / bến = 5 cái
    // cho cả map nên không tốn gì.
    _addStationSign(g, s, W, D) {
        const M = this._mats;
        const name = String(s.name || "BEN XE").toUpperCase();
        const cv = document.createElement("canvas");
        cv.width = 512; cv.height = 128;
        const c = cv.getContext("2d");
        c.fillStyle = "#0d4f9c"; c.fillRect(0, 0, 512, 128);
        c.fillStyle = "#ffffff"; c.fillRect(0, 0, 512, 8);
        c.fillStyle = "#f7c948"; c.fillRect(0, 120, 512, 8);
        c.fillStyle = "#ffffff";
        c.font = "bold 52px Arial, sans-serif";
        c.textAlign = "center"; c.textBaseline = "middle";
        // tự thu nhỏ chữ cho tên dài (bến xe dài tên ở VN rất phổ biến)
        let size = 52;
        while (size > 18 && c.measureText(name).width > 470) {
            size -= 2; c.font = "bold " + size + "px Arial, sans-serif";
        }
        c.fillText(name, 256, 66);
        const tex = new THREE.CanvasTexture(cv);
        tex.anisotropy = 2;
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        this._signMats = this._signMats || [];
        this._signMats.push(mat);

        // P58: trục x cục bộ = DỌC ĐƯỜNG (chiều D), trục z cục bộ = HƯỚNG ĐƯỜNG (W)
        const sw = Math.min(46, D * 0.42);
        const board = new THREE.Mesh(this._geos.unitBox, mat);
        board.scale.set(sw, sw * 0.25, 0.5);
        // CỔNG bến nằm ở phía +Z cục bộ (= +ox = hướng đường chính), đặt biển
        // ở nửa sân hướng ra đường để khách nhìn thấy khi tới.
        board.position.set(0, 9.5, W * 0.42);
        g.add(board);
        for (const sx of [-sw * 0.45, sw * 0.45]) {
            const post = new THREE.Mesh(this._geos.pole, M.metal);
            post.scale.set(1.0, 9.5, 1.0);
            post.position.set(sx, 4.75, W * 0.42);
            g.add(post);
        }
    }

    // ĐÈN SÂN BẾN + CÂY CẢNH — instanced để không nhân draw call
    _addStationLights(g, s, W, D) {
        const M = this._mats, G = this._geos;
        const y = this.world.yardLift;
        const polePos = [], lampPos = [], lampRot = [];
        const treePos = [], treeRot = [];
        // đèn dọc 2 lề dài của sân — P58: x cục bộ = dọc đường (D), z = hướng đường (W)
        for (let i = -2; i <= 2; i++) {
            const t = i / 2.5;
            for (const sx of [-1, 1]) {
                const px = t * D * 0.42, pz = sx * (W * 0.5 - 4);
                polePos.push([px, y, pz]);
                lampPos.push([px, y + 8.6, pz]);
                lampRot.push(sx > 0 ? Math.PI : 0);
            }
        }
        // cây bóng mát dọc rìa sân (không chắn nan đỗ ở giữa)
        for (let i = -3; i <= 3; i++) {
            const px = i * (D * 0.13);
            if (Math.abs(px) < D * 0.16) continue;
            treePos.push([px, y, -W * 0.5 + 6]);
            treeRot.push((i % 2) * 0.7);
        }
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
        const e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
        const add = (list, geo, mat, sx, sy, sz, useRot) => {
            if (!list.length) return;
            const mesh = new THREE.InstancedMesh(geo, mat, list.length);
            for (let i = 0; i < list.length; i++) {
                const p = list[i];
                e.set(0, useRot ? p[1] : 0, 0); q.setFromEuler(e);
                v3.set(p[0], p[1], p[2]);
                s3.set(sx, sy, sz);
                m4.compose(v3, q, s3);
                mesh.setMatrixAt(i, m4);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            g.add(mesh);
        };
        add(polePos, G.pole, M.pole, 0.8, 9.0, 0.8, false);
        add(lampPos, G.unitBox, M.lamp, 1.0, 0.26, 0.5, false);
        add(treePos.map(p => [p[0], p[1] + 2.0, p[2]]), G.trunk, M.trunk, 1.1, 4.0, 1.1, false);
        add(treePos.map(p => [p[0], p[1] + 5.4, p[2]]), G.canopy, M.leaves, 2.6, 2.2, 2.6, true);
    }

    // CULL POI: bến/trạm/điểm dừng ở xa -> ẩn group (không mất nội dung,
    // chỉ không vẽ). 78 phép so sánh, ~0.05ms/khung.
    _cullPOIs(x, z) {
        if (!this._poiGroups) return;
        for (let i = 0; i < this._poiGroups.length; i++) {
            const p = this._poiGroups[i];
            const dx = p.x - x, dz = p.z - z;
            const vis = (dx * dx + dz * dz) < (p.r * p.r);
            if (p.g.visible !== vis) p.g.visible = vis;
        }
    }

    // ------------------------------------------------------------- streaming
    updateChunks(playerX, playerZ, dt = 1 / 60, camDir = null) {
        if (!this.world) return;
        // vị trí player để getParkingSlots() chọn đúng bến đang tới (rule 40/42)
        if (!this._playerPos) this._playerPos = { x: playerX, z: playerZ };
        else { this._playerPos.x = playerX; this._playerPos.z = playerZ; }
        this._cullPOIs(playerX, playerZ);
        let dirX = 0, dirZ = -1;
        if (camDir && (camDir.x || camDir.z)) {
            dirX = camDir.x; dirZ = camDir.z;
            const l = Math.hypot(dirX, dirZ) || 1;
            dirX /= l; dirZ /= l;
        } else {
            dirX = this._lastDir.x; dirZ = this._lastDir.z;
        }
        this._lastDir.x = dirX; this._lastDir.z = dirZ;

        this._adaptQuality(dt);

        this._timer += dt;
        if (this._timer < STREAM_INTERVAL) return;
        this._timer = 0;

        // FIX LOD CHET: nho vi tri player de _tryBuildChunk dung tam thuc cu
        // nguoi choi. Truoc day _loadChunk truyen TAM CHUNK, nen
        // `hypot(chunkCenter - chunkCenter) = 0` luon nho hon renderRadius =>
        // MOI chunk vua tai deu duoc build. Do duoc: 181 chunk co geometry
        // thay vi 81, draw call 1370, 29 FPS tren may yEU. Day la ly do
        // "LOD" ton tai trong ma nhung khong hoat dong.
        if (!this._streamPos) this._streamPos = { x: playerX, z: playerZ };
        this._streamPos.x = playerX;
        this._streamPos.z = playerZ;

        const pcx = Math.floor(playerX / CHUNK_SIZE);
        const pcz = Math.floor(playerZ / CHUNK_SIZE);
        const needed = new Set();
        const candidates = [];

        for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
            for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
                const cx = pcx + dx, cz = pcz + dz;
                const key = cx + "," + cz;
                if (this.loadedChunks.has(key) || this.inProgress.has(key)) continue;
                const ccx = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
                const ccz = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
                const vx = ccx - playerX, vz = ccz - playerZ;
                const d = Math.hypot(vx, vz);
                // distance CHỦ ĐẠO, dot chỉ tie-break nhỏ (ưu tiên phía trước)
                const dot = Math.max(0, (vx * dirX + vz * dirZ) / (d || 1));
                const priority = d - dot * (CHUNK_SIZE * 0.25);
                candidates.push({ key, cx, cz, priority });
                needed.add(key);
            }
        }
        candidates.sort((a, b) => a.priority - b.priority);
        this.loadQueue = candidates;

        // unload với buffer zone (tránh load/unload liên tục)
        for (const [key, chunk] of this.loadedChunks) {
            if (needed.has(key)) continue;
            const [cx, cz] = key.split(",").map(Number);
            const ccx = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
            const ccz = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
            if (Math.hypot(ccx - playerX, ccz - playerZ) > UNLOAD_RADIUS * CHUNK_SIZE) {
                this._unloadChunk(key, chunk);
            }
        }

        let count = 0;
        while (this.loadQueue.length > 0 && count < MAX_LOAD_PER_TICK) {
            const c = this.loadQueue.shift();
            this._loadChunk(c.cx, c.cz);
            count++;
        }

        // LOD: dựng hình các chunk đã tải data mà mới vào tầm nhìn.
        // NGUYEN TAC: dựng theo NGÂN SÁCH THỜI GIAN (8ms/khung) thay vì số
        // chunk cố định -> lúc vào bến (giai đoạn tải 100+ chunk) vẫn dựng
        // nhanh mà không hitch khung hình trên N5000.
        const tBuild = performance.now();
        let built = 0;
        for (const [key, entry] of this.loadedChunks) {
            if (entry.built) continue;
            if (built >= 1 && performance.now() - tBuild > 8) break;
            const ccx = entry.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
            const ccz = entry.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
            if (Math.hypot(ccx - playerX, ccz - playerZ) > this.renderRadius * CHUNK_SIZE) continue;
            this._tryBuildChunk(entry, playerX, playerZ);
            built++;
        }
    }

    _unloadChunk(key, chunk) {
        if (!chunk) return;
        if (chunk.group) {
            this.chunkRoot.remove(chunk.group);
            chunk.group.traverse(o => {
                if (o.geometry && !this._sharedGeos.has(o.geometry)) o.geometry.dispose();
                const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
                for (const m of mats) if (!this._sharedMats.has(m)) m.dispose();
                if (o.isInstancedMesh && o.dispose) o.dispose();
            });
        }
        this.loadedChunks.delete(key);
    }

    // -----------------------------------------------------------------
    // SECTOR DATA: doc 1 file sector (SECTOR_CHUNKS^2 chunk), cache LRU nho
    // -----------------------------------------------------------------
    async _fetchSector(sx, sz) {
        // QUAN TRONG: generator ghi ten file sector theo dau "_" ("-3_2.json")
        // va sectorIndex cung dung dau "_". Dung dau "," se skip TOAN BO sector.
        const key = sx + "_" + sz;
        if (this._sectorCache.has(key)) {
            const hit = this._sectorCache.get(key);
            this._sectorCache.delete(key);
            this._sectorCache.set(key, hit);   // LRU: move to end
            return hit;
        }
        if (this._sectorIndex && !this._sectorIndex.has(key)) return null;
        if (this._sectorPending.has(key)) return this._sectorPending.get(key);
        const p = (async () => {
            try {
                const res = await fetch(`${DATA_PATH}sectors/${key}.json`);
                if (!res.ok) return null;
                const json = await res.json();
                this._sectorCache.set(key, json);
                // giu toi da 6 sector (6 MB data) -> bo keo de khong phinh RAM
                while (this._sectorCache.size > 6) {
                    const first = this._sectorCache.keys().next().value;
                    this._sectorCache.delete(first);
                }
                return json;
            } catch (e) {
                console.error(`[map] sector ${key} loi:`, e);
                return null;
            } finally {
                this._sectorPending.delete(key);
            }
        })();
        this._sectorPending.set(key, p);
        return p;
    }

    async _loadChunk(cx, cz) {
        const key = cx + "," + cz;             // key noi bo (loadedChunks)
        const dataKey = cx + "_" + cz;         // key DU LIEU (generator ghi "_")
        if (this.loadedChunks.has(key) || this.inProgress.has(key)) return;
        this.inProgress.add(key);

        let data = null;
        try {
            if (this.sectorSize) {
                // duong sector: 1 file chua nhieu chunk
                const S = this.sectorSize;
                const sx = Math.floor(cx / S), sz = Math.floor(cz / S);
                const sec = await this._fetchSector(sx, sz);
                if (sec) data = sec[dataKey] || null;
            } else {
                // duong chunk (tuong thich du lieu cu)
                const hasContent = !this._chunkIndex || this._chunkIndex.has(dataKey);
                if (hasContent) {
                    const res = await fetch(`${DATA_PATH}chunks/${cx}_${cz}.json`);
                    if (res.ok) data = await res.json();
                }
            }
        } catch (error) {
            console.error(`[map] chunk ${key} fetch loi:`, error);
        } finally {
            // rule 44: luôn giải phóng in-flight để queue không bị kẹt vĩnh viễn
            this.inProgress.delete(key);
        }

        const entry = { cx, cz, data, group: new THREE.Group(), built: false };
        entry.group.name = `chunk_${key}`;
        this.loadedChunks.set(key, entry);
        // px,pz là TOẠ ĐỘ THẾ GIỚI (m) — trước đây truyền luôn chỉ số chunk
        // khiến Math.hypot(..., cx, cz) lệch đơn vị (vài trăm mét), LOD sai.
        // dung vi tri player thuc (xem FIX LOD CHET o updateChunks). Neu chua
        // co (goi truc tiep tu code khac) thi tam chunk la du an toan.
        const sp = this._streamPos;
        if (sp) {
            this._tryBuildChunk(entry, sp.x, sp.z);
        } else {
            this._tryBuildChunk(entry,
                entry.cx * CHUNK_SIZE + CHUNK_SIZE / 2,
                entry.cz * CHUNK_SIZE + CHUNK_SIZE / 2);
        }
    }

    // Dựng hình khi chunk vào tầm nhìn (LOD): chunk ngoài RENDER_RADIUS chỉ giữ
    // data trong RAM, không tạo geometry => draw call + thời gian build giảm mạnh.
    _tryBuildChunk(entry, px, pz) {
        if (!entry || entry.built) return;
        const ccx = entry.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const ccz = entry.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
        if (Math.hypot(ccx - px, ccz - pz) > this.renderRadius * CHUNK_SIZE) return;

        const g = entry.group;
        this._addChunkTerrain(entry.cx, entry.cz, g, px, pz);
        this._addChunkRoads(entry.cx, entry.cz, g);
        if (entry.data) {
            this._addChunkBuildings(entry.data.buildings, g);
            // FAR-LOD: chunk xa > 1100m bo cay/cot/ruong (fog 1450m da che
            // ~70%, giam manh instance count -> N5000 khong bi gio)
            const ccx0 = entry.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
            const ccz0 = entry.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
            const far = Math.hypot(ccx0 - px, ccz0 - pz) > 1100;
            this._addChunkObjects(entry.data.objects, g, far);
            // facilities (tram xang/nghi) da render toan cuc 1 lan trong
            // _buildStations -> khong render lai o day (tranh nhan ban + z-fighting)
        }
        this.chunkRoot.add(g);
        entry.built = true;
    }

    // ----------------------------------------------------------------- API
    // getTerrainHeight: trên đường -> node.y - BUS_AXLE (để bus.y == mặt đường),
    // ngoài đường -> terrain thật. Đây là hàm main.js gọi MỖI FRAME.
    // P43 — `roadLift` / `yardLift` được set trên lớp `WorldTerrain`
    // (`this.world`), KHÔNG có trên `MapLoader`. Dùng `this.roadLift` ở đây
    // là `undefined` ⇒ phép cộng ra NaN ⇒ xe đứng ở NaN. Đo được:
    // `loaderRoadLift = UNDEFINED` còn `worldRoadLift = 0.12`.
    _roadLift() { return (this.world && this.world.roadLift) || ROAD_LIFT; }
    _yardLift() { return (this.world && this.world.yardLift) || YARD_LIFT; }

    // P41 — `yHint`: cao độ xe đang ở. Truy vấn mặt trên cùng LIÊN TỤC
    // để xe leo được ramp / chạy được cầu / không chui xuống đường dưới.
    getTerrainHeight(x, z, yHint = null) {
        if (!this.world) return 10;
        const road = this._surfaceAt(x, z, yHint);
        if (road) return road.y - BUS_AXLE;
        return this.world.getElevation(x, z);
    }
    getHeight(x, z) { return this.getTerrainHeight(x, z); }

    getSpawnPoint() {
        if (this.spawn && typeof this.spawn.x === "number") {
            const x = this.spawn.x, z = this.spawn.z;
            return {
                x, z,
                y: this.getTerrainHeight(x, z) + BUS_AXLE,
                heading: typeof this.spawn.heading === "number" ? this.spawn.heading : 0
            };
        }
        if (this.roadGraph) {
            const st = (this.roadGraph.pois || [])[0];
            if (st) return { x: st.position.x, y: st.position.y + BUS_AXLE, z: st.position.z, heading: 0 };
        }
        return { x: 0, y: 10.5, z: 2000, heading: 0 };
    }

    getRoadGraph() { return this.roadGraph; }
    // MINIMAP (rule 34): CÙNG source of truth với world + PHẢI vẽ POI.
    // Canvas 200px @ scale 0.05 chỉ hiện được bán kính ~2km. Trước đây
    // ui.js quét TOÀN BỘ ~5k segment mỗi lần vẽ (10 lần/s) — trên N5000
    // là một trong những thứ tốn CPU nhất, và POI thì không hề vẽ.
    // -> dựng LƯỚI Ô 1024m 1 lần, rồi chỉ trả về đoạn trong bán kính.
    getMinimapData() {
        if (!this.roadGraph) return { segments: [], route: [], pois: [] };
        if (this._minimapCache) return this._minimapCache;   // tĩnh 1 lần (ui.js cache)
        const raw = this.roadGraph.getMinimapData();
        const KEEP = new Set(["NATIONAL", "EXPRESSWAY", "ARTERIAL", "COLLECTOR",
                              "RAMP", "TUNNEL", "STATION_ACCESS"]);
        const segs = [];
        const all = this.roadGraph.segments || [];
        const nodeMap = this.roadGraph._nodeMap || new Map();
        for (const s of all) {
            if (!KEEP.has(s.class)) continue;
            const f = nodeMap.get(s.from), t = nodeMap.get(s.to);
            if (!f || !t) continue;
            if (Math.abs(f.x - t.x) + Math.abs(f.z - t.z) < 18) continue;  // đoạn quá ngắn
            segs.push({ from: { x: f.x, z: f.z }, to: { x: t.x, z: t.z } });
        }
        // KHÔNG lấy mẫu/bỏ bớt (rule 34: minimap phải phản ánh đúng world).
        // Việc lọc theo khoảng cách làm ở getMinimapNear() bên dưới.
        this._minimapGrid = null;
        this._minimapSegs = segs;
        return (this._minimapCache = { segments: segs, route: raw.route, pois: raw.pois });
    }

    // LƯỚI Ô minimap: segment -> các ô 1024m mà nó chạm qua (dựng 1 lần).
    _ensureMinimapGrid(cell = 1024) {
        if (this._minimapGrid) return this._minimapGrid;
        const grid = new Map();
        const segs = this._minimapSegs || (this.getMinimapData().segments || []);
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            const c0x = Math.floor(Math.min(s.from.x, s.to.x) / cell);
            const c1x = Math.floor(Math.max(s.from.x, s.to.x) / cell);
            const c0z = Math.floor(Math.min(s.from.z, s.to.z) / cell);
            const c1z = Math.floor(Math.max(s.from.z, s.to.z) / cell);
            for (let cx = c0x; cx <= c1x; cx++) {
                for (let cz = c0z; cz <= c1z; cz++) {
                    const k = cx + "," + cz;
                    let a = grid.get(k);
                    if (!a) { a = []; grid.set(k, a); }
                    a.push(i);
                }
            }
        }
        this._minimapGrid = grid;
        this._minimapCell = cell;
        return grid;
    }

    // Minimap theo bán kính quanh người chơi (rule 29/34/66): chỉ trả về
    // đoạn nằm trong bán kính nhìn thấy + POI ở gần. API MỚI, không phá
    // getMinimapData() cũ.
    getMinimapNear(x, z, radius = 2200) {
        const full = this.getMinimapData();
        if (!full || !this.roadGraph) return { segments: [], route: [], pois: [] };
        const cell = this._minimapCell || 1024;
        const grid = this._ensureMinimapGrid(cell);
        const segs = this._minimapSegs || [];
        const r2 = radius * radius;
        const out = [];
        const seen = new Set();
        const c0x = Math.floor((x - radius) / cell), c1x = Math.floor((x + radius) / cell);
        const c0z = Math.floor((z - radius) / cell), c1z = Math.floor((z + radius) / cell);
        for (let cx = c0x; cx <= c1x; cx++) {
            for (let cz = c0z; cz <= c1z; cz++) {
                const arr = grid.get(cx + "," + cz);
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) {
                    const idx = arr[i];
                    if (seen.has(idx)) continue;
                    seen.add(idx);
                    const s = segs[idx];
                    if (!s) continue;
                    // khoang cach goc toi doan (nhanh, du khi khong chuan xac)
                    const ddx = s.to.x - s.from.x, ddz = s.to.z - s.from.z;
                    const l2 = ddx * ddx + ddz * ddz || 1;
                    let t = ((x - s.from.x) * ddx + (z - s.from.z) * ddz) / l2;
                    t = clamp(t, 0, 1);
                    const ex = x - (s.from.x + ddx * t), ez = z - (s.from.z + ddz * t);
                    if (ex * ex + ez * ez <= r2) out.push(s);
                }
            }
        }
        // tuyến chính: chỉ giữ đoạn trong bán kính
        const rt = full.route || [];
        const rseg = [];
        for (let i = 0; i < rt.length - 1; i++) {
            const a = rt[i], b = rt[i + 1];
            const ddx = b.x - a.x, ddz = b.z - a.z;
            const l2 = ddx * ddx + ddz * ddz || 1;
            let t = ((x - a.x) * ddx + (z - a.z) * ddz) / l2;
            t = clamp(t, 0, 1);
            const ex = x - (a.x + ddx * t), ez = z - (a.z + ddz * t);
            if (ex * ex + ez * ez <= r2) rseg.push(a, b);
        }
        // POI trong bán kính (rule 34: minimap phải có bến / trạm)
        const pois = (full.pois || []).filter(p => {
            const dx = p.x - x, dz = p.z - z;
            return dx * dx + dz * dz <= r2;
        });
        return { segments: out, route: rseg, pois };
    }
    getRouteWaypoints() {
        return this.roadGraph ? this.roadGraph.getRouteWaypoints() : [];
    }
    getPOIs() { return this.stationsData; }

    // NAN ĐỖ XE TĨNH (npc.js BusStationManager dùng) — lấy từ generator.
    //
    // rule 40/42: bến lớn phải có đủ xe, và bến KHÔNG phải mép thế giới —
    // khi lái tới Bến xe Miền Đông Mới thì phải thấy bến đó có xe.
    // Trước đây chỉ nan của bến spawn trong 800m được trả về, nên 4 bến còn
    // lại luôn trống. Nay chọn theo vị trí NGƯỜI CHƠI (vẫn giới hạn 1 bến
    // mỗi lần gọi để không spawn 60 xe cùng lúc trên máy yếu).
    getParkingSlots() {
        const out = [];
        if (!this.stationsData.length) return out;
        // neo theo vị trí player vuaa stream, fallback spawn
        const p = this._playerPos || this.getSpawnPoint();
        let best = null, bestD = 1e9;
        for (const s of this.stationsData) {
            if (s.type !== "BUS_STATION" && s.type !== "MAJOR_BUS_TERMINAL") continue;
            const dd = Math.hypot(s.x - p.x, s.z - p.z);
            if (dd < bestD) { bestD = dd; best = s; }
        }
        if (!best || bestD > 900) return out;   // chưa tới bến nào -> khong spawn
        const s = best;
        const slots = Array.isArray(s.baySlots) ? s.baySlots : [];
        for (const slot of slots) {
            out.push({
                id: `${s.id}_${slot.x.toFixed(1)}_${slot.z.toFixed(1)}`,
                station: s.id,
                position: {
                    x: slot.x,
                    y: (typeof slot.y === "number" ? slot.y : (s.y || 0) + 0.5),
                    z: slot.z
                },
                rotation: typeof slot.heading === "number" ? slot.heading : (s.rot || 0),
                occupied: false
            });
        }
        return out;
    }

    setPlayerPosition(x, z, dt = 1 / 60, camDir = null) {
        this.updateChunks(x, z, dt, camDir);
    }

    dispose() {
        for (const [key, chunk] of this.loadedChunks) this._unloadChunk(key, chunk);
        this.loadedChunks.clear();
        this.inProgress.clear();
        this.loadQueue.length = 0;
        // sector cache/pending chi ton tai sau loadInitialData -> guard cho
        // dispose() goi truoc khi load xong
        if (this._sectorCache) this._sectorCache.clear();
        if (this._sectorPending) this._sectorPending.clear();
        for (const m of this._sharedMats) m.dispose?.();
        for (const g of this._sharedGeos) g.dispose?.();
        // texture biển tên bến (rule 29: không rò rỉ GPU memory khi restart)
        if (this._signMats) {
            for (const m of this._signMats) { m.map?.dispose?.(); m.dispose?.(); }
            this._signMats.length = 0;
        }
        for (const m of this._facadeMats.values()) m.dispose?.();
        for (const m of this._roofMats.values()) m.dispose?.();
        if (this.group && this.group.parent) this.group.parent.remove(this.group);
    }
}

// =============================================================================
// LEGACY FACTORY — giữ cho caller cũ dùng createMap({scene})
// =============================================================================
export function createMap(options) {
    const loader = new MapLoader(options.scene);
    const api = {
        group: loader.group,
        loader,
        ready: loader.loadInitialData(),
        setPlayerPosition: (x, z, dt, camDir) => loader.setPlayerPosition(x, z, dt, camDir),
        getHeight: (x, z) => loader.getHeight(x, z),
        getTerrainHeight: (x, z) => loader.getTerrainHeight(x, z),
        getSpawnPoint: () => loader.getSpawnPoint(),
        getRouteWaypoints: () => loader.getRouteWaypoints(),
        getMinimapData: () => loader.getMinimapData(),
        getRoadGraph: () => loader.getRoadGraph(),
        getPOIs: () => loader.getPOIs(),
        getParkingSlots: () => loader.getParkingSlots(),
        updateChunks: (x, z, dt, camDir) => loader.updateChunks(x, z, dt, camDir),
        dispose: () => loader.dispose()
    };
    return api;
}

export { World };
export default MapLoader;
