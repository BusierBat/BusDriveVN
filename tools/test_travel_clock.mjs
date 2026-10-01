// tools/test_travel_clock.mjs
// =====================================================================
// KIỂM CHỨNG js/TravelClock.js — chạy NGOÀI trình duyệt, đọc đúng file
// generator vừa sinh ra (generated/maps/*.json). Không dùng dữ liệu giả.
//
// Chạy: node tools/test_travel_clock.mjs
//
// Mục đích: TravelClock là logic thời gian game. Nếu chỉ nhìn code thì không
// biết đồng hồ có thật sự chạy nhanh hơn trên cao tốc, chậm hơn khi leo đèo,
// và cộng phút khi dừng bến. Script lái một "xe ảo" theo graph THẬT, in ra số
// đo, và FAIL nếu số đo vô lý.
//
// KHÔNG dùng try/except để nuốt lỗi: mọi assert phải in ra và exit 1.
// Dùng template literal, KHÔNG printf-style: `console.log` của Node tự ăn
// `%s`/`%d` trong tham số đầu, và `"x %s" % y` trong JS ra `NaN`.
// =====================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const MAPS = path.join(ROOT, "generated", "maps");

const { RuntimeRoadGraph } = await import(
    pathToFileURL(path.join(ROOT, "js", "RuntimeRoadGraph.js")).href);
const { TravelClock } = await import(
    pathToFileURL(path.join(ROOT, "js", "TravelClock.js")).href);

const j = (f) => JSON.parse(readFileSync(path.join(MAPS, f), "utf8"));
const roads = j("roads.json");
const stations = j("stations.json");

const graph = new RuntimeRoadGraph({
    roads: roads,
    stations: stations,
    routes: j("routes.json")
});

console.log("=== TEST TRAVEL CLOCK ===");
console.log(`  nodes=${graph.nodes.length} segs=${graph.segments.length} ` +
    `pois=${graph.pois.length}`);

const fails = [];
const ok = (cond, msg) => {
    console.log(`  [${cond ? " OK " : "FAIL"}] ${msg}`);
    if (!cond) fails.push(msg);
};
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// ---------------------------------------------------------------- 1. dựng
const clock = new TravelClock({ roadGraph: graph, getHeight: () => 0 });
ok(!!clock, "TravelClock dựng được với road graph thật");
ok(graph.pois.length > 0, "có POI để kiểm tra station delay");

// ------------------------------------------------- 2. tìm một đoạn theo class
function segByClass(cls) {
    return graph.segments.find((s) => s.class === cls);
}
function midpointOf(seg) {
    const a = graph.getNode(seg.from), b = graph.getNode(seg.to);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, a, b };
}

// Dọc đường dọc 1 đoạn rồi ĐẢO CHIỀU (ping-pong) — KHÔNG quay về đầu cũ.
// Nếu `% len` thì xe "dịch chuyển tức thời" giữa 2 đầu đoạn, TravelClock đếm
// bước nhảy vài trăm mét là đi được mấy km -> phép so sánh sai hết.
function drive(segId, seconds, speedKmh) {
    const seg = graph.getSegment(segId);
    const a = graph.getNode(seg.from), b = graph.getNode(seg.to);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dt = 1 / 30;
    const n = Math.round(seconds / dt);
    const speed = speedKmh / 3.6;              // m/s
    let travelled = 0, dir = 1, minutes = 0;
    for (let i = 0; i < n; i++) {
        travelled += speed * dt * dir;
        if (travelled >= len) { travelled = len - 1e-3; dir = -1; }
        else if (travelled <= 0) { travelled = 1e-3; dir = 1; }
        const t = travelled / len;
        const r = clock.update(dt, {
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            speedKmh
        });
        minutes += dt * r.timeScale + r.delayMinutes;
    }
    return minutes;
}

// Đoạn phẳng nhất trong graph — mốc so sánh cho đoạn dốc.
function flattestSegment(minRun = 20) {
    let best = null, bestSlope = Infinity;
    for (const s of graph.segments) {
        const a = graph.getNode(s.from), b = graph.getNode(s.to);
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        if (run < minRun) continue;
        const sl = Math.abs((b.y - a.y) / run);
        if (sl < bestSlope) { bestSlope = sl; best = s; }
    }
    return { seg: best, slope: bestSlope };
}
function steepestSegment(minRun = 5) {
    let best = null, bestSlope = 0;
    for (const s of graph.segments) {
        const a = graph.getNode(s.from), b = graph.getNode(s.to);
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        if (run < minRun) continue;
        const sl = Math.abs((b.y - a.y) / run);
        if (sl > bestSlope) { bestSlope = sl; best = s; }
    }
    return { seg: best, slope: bestSlope };
}

// ---------------------------------------------------------- 3. CAO TOC > LOCAL
console.log("\n  -- 60s chạy ở TỐC ĐỘ THIẾT KẾ của từng loại đường --");
const tests = [
    ["EXPRESSWAY", 88],
    ["NATIONAL", 66],
    ["ARTERIAL", 45],
    ["LOCAL", 28],
    ["RURAL_LOCAL", 28],
    ["ALLEY", 18],
    ["STATION_ACCESS", 24],
    ["INTER_VILLAGE", 33],
    ["INDUSTRIAL_ACCESS", 42],
    ["RESIDENTIAL", 24],
    ["COMMERCIAL", 33],
    ["AGRICULTURAL", 24]
];
const perClass = {};
for (const [cls, kmh] of tests) {
    const seg = segByClass(cls);
    if (!seg) { console.log(`  [SKIP] không có segment ${cls}`); continue; }
    clock.reset();
    const min = drive(seg.id, 60, kmh);
    perClass[cls] = min;
    console.log(`  ${cls.padEnd(18)} ${String(kmh).padStart(5)} km/h ` +
        `-> ${f2(min).padStart(8)} phút game / 60s thực`);
}
ok((perClass.EXPRESSWAY || 0) > (perClass.NATIONAL || 0),
    `cao toc (${f2(perClass.EXPRESSWAY || 0)}') nhanh hon QL1 ` +
    `(${f2(perClass.NATIONAL || 0)}')`);
ok((perClass.NATIONAL || 0) > (perClass.LOCAL || 0),
    `QL1 (${f2(perClass.NATIONAL || 0)}') nhanh hon duong pho ` +
    `(${f2(perClass.LOCAL || 0)}')`);
ok((perClass.LOCAL || 0) > (perClass.ALLEY || 0),
    `duong pho (${f2(perClass.LOCAL || 0)}') nhanh hon ngo ` +
    `(${f2(perClass.ALLEY || 0)}')`);

// ---------------------------------------- 4. DUNG: cung tai toc, gio chay lai
console.log("\n  -- cùng 60s thực, cùng đoạn đường, 2 mức tốc độ --");
{
    const seg = segByClass("NATIONAL");
    clock.reset();
    const fast = drive(seg.id, 60, 70);
    clock.reset();
    const slow = drive(seg.id, 60, 25);
    console.log(`  70 km/h -> ${f2(fast)}' | 25 km/h -> ${f2(slow)}'`);
    ok(fast > slow * 2,
        "chạy nhanh gấp đôi => đồng hồ chạy gấp đôi (không phải 1:1)");
}

// ------------------------------------------------- 5. ĐỨNG YÊN => đồng hồ đứng
console.log("\n  -- 60s đứng yên GIỮA ĐƯỜNG QL1 --");
{
    const seg = segByClass("NATIONAL");
    const mid = midpointOf(seg);
    clock.reset();
    const dt = 1 / 30;
    let minutes = 0;
    for (let i = 0; i < 30 * 60; i++) {
        const r = clock.update(dt, { x: mid.x, z: mid.z, speedKmh: 0 });
        minutes += dt * r.timeScale + r.delayMinutes;
    }
    console.log(`  class khi đứng = ${clock.roadClass} | scale=${f2(clock.timeScale)}` +
        ` | 60s thực -> ${f2(minutes)}' game | lý do: ${clock.dwellReason}`);
    ok(clock.roadClass === "NATIONAL",
        `xe đứng giữa QL1 phải nhận ra class NATIONAL (thấy ${clock.roadClass})`);
    ok(minutes < 25,
        `đứng yên 1 phút thực không đốt hơn 25 phút game (đang ${f2(minutes)})`);
    ok(/kẹt xe/.test(clock.dwellReason),
        `đứng yên ngoài bến phải bị tính là URBAN DELAY (kẹt xe): ` +
        clock.dwellReason);
}

// -------------------------------------------------------- 6. DỪNG BẾN có tính
console.log("\n  -- dừng 40s trong sân bến xe --");
{
    const st = graph.pois.find((p) => p.type === "BUS_STATION");
    if (!st) ok(false, "không tìm thấy BUS_STATION để test");
    else {
        clock.reset();
        const dt = 1 / 30;
        let minutes = 0;
        for (let i = 0; i < 30 * 40; i++) {
            const r = clock.update(dt, {
                x: st.position.x, z: st.position.z, speedKmh: 0
            });
            minutes += dt * r.timeScale + r.delayMinutes;
        }
        console.log(`  bến '${st.name}' (${st.busBays.length} bay): 40s đứng -> ` +
            `${f2(minutes)}' game | lý do: ${clock.dwellReason}`);
        ok(minutes > 30,
            "đứng 40s trong bến phải cộng hơn 30 phút game (dựng khách)");
        ok(/đứng tại|rời/.test(clock.dwellReason),
            "lý do dừng phải nhắc bến: " + clock.dwellReason);
    }
}

// --------------------------------------------- 6b. BẾN XOAY: hộp phải xoay
console.log("\n  -- bến có góc quay: phải nhận ra khi đứng lệch sang góc --");
{
    const rotated = graph.pois.filter((p) => p.type === "BUS_STATION"
        && Math.abs(p.rotation) > 0.3);
    if (rotated.length === 0) {
        ok(true, "không có bến nào xoay >0.3 rad (bỏ qua bước này)");
    } else {
        const st = rotated[0];
        clock.reset();
        clock.update(1 / 30, { x: st.position.x, z: st.position.z, speedKmh: 0 });
        const insideAtCentre = /đứng tại|rời/.test(clock.dwellReason);
        // điểm ở GÓC hộp xoay: nằm trong hộp nếu không xoay, ngoài hộp nếu
        // dùng hộp không xoay -> phải KHÔNG nhận là đang ở bến
        const hw = st.size.width / 2, hd = st.size.depth / 2;
        const c = Math.cos(st.rotation), s = Math.sin(st.rotation);
        const cornerLocal = [hw * 0.9, hd * 0.9];
        clock.reset();
        for (let i = 0; i < 5; i++) {
            clock.update(1 / 30, {
                x: st.position.x + cornerLocal[0] * c - cornerLocal[1] * s,
                z: st.position.z + cornerLocal[0] * s + cornerLocal[1] * c,
                speedKmh: 0
            });
        }
        const insideAtCorner = /đứng tại|rời/.test(clock.dwellReason);
        console.log(`  bến '${st.name}' rot=${st.rotation.toFixed(2)} rad: ` +
            `ở tâm=${insideAtCentre} | ở góc hộp xoay=${insideAtCorner}`);
        ok(insideAtCentre, "đứng đúng tâm sân bến phải nhận ra đang ở bến");
        ok(insideAtCorner, "đứng ở góc sân xoay vẫn phải nhận ra đang ở bến");
    }
}

// ---------------------------------------------------------- 7. GIAO LỘ tính
console.log("\n  -- đi qua một nút giao thật (bậc >= 3) --");
{
    const deg = new Map();
    for (const s of graph.segments) {
        deg.set(s.from, (deg.get(s.from) || 0) + 1);
        deg.set(s.to, (deg.get(s.to) || 0) + 1);
    }
    let target = null;
    for (const s of graph.segments) {
        if ((deg.get(s.from) || 0) >= 3) { target = s; break; }
    }
    if (!target) ok(false, "không tìm thấy node bậc >=3");
    else {
        const n = graph.getNode(target.from);
        clock.reset();
        const dt = 1 / 30;
        const before = clock.junctionsPassed;
        const a = graph.getNode(target.from), b = graph.getNode(target.to);
        const dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        const ux = dx / l, uz = dz / l;
        for (let i = 0; i < 30 * 4; i++) {
            const dist = -40 + i * 0.02 * 22;
            clock.update(dt, { x: a.x + ux * dist, z: a.z + uz * dist, speedKmh: 80 });
        }
        console.log(`  node ${target.from} (bậc ${deg.get(target.from)}): ` +
            `giao lộ đã qua ${clock.junctionsPassed} (trước ${before}) | ` +
            `lý do: ${clock.dwellReason}`);
        ok(clock.junctionsPassed > before,
            "đi qua nút giao phải được đếm + cộng phút chờ");
    }
}

// --------------------------------------------------------- 8. ĐỘ DỐC có ảnh
console.log("\n  -- độ dốc đo được (đèo) --");
{
    const hill = steepestSegment();
    const flat = flattestSegment();
    if (!hill.seg || !flat.seg) ok(false, "không tìm thấy đoạn để so sánh dốc/bằng");
    else {
        const pct = hill.slope * 100;
        const flatPct = flat.slope * 100;
        console.log(`  dốc nhất ${hill.seg.id}: ${f2(pct)}% | ` +
            `bằng nhất ${flat.seg.id}: ${f2(flatPct)}%`);
        ok(pct > 0.5,
            `map phải có đoạn dốc thật (>0.5%) để đo được (đang ${f2(pct)}%)`);

        // CÙNG tốc độ, CÙNG thời gian thực. Đoạn dốc phải "đốt" ít phút game
        // hơn đoạn bằng, vì đồng hồ chạy theo tốc độ hiệu dụng sau đèo.
        clock.reset();
        const flatMin = drive(flat.seg.id, 60, 70);
        const flatScale = clock.timeScale;
        clock.reset();
        const hillMin = drive(hill.seg.id, 60, 70);
        const hillScale = clock.timeScale;
        console.log(`  70km/h trong 60s: dốc ${f2(pct)}% -> ${f2(hillMin)}' ` +
            `(scale ${f2(hillScale)}) | bằng ${f2(flatPct)}% -> ${f2(flatMin)}' ` +
            `(scale ${f2(flatScale)})`);
        ok(hillScale < flatScale,
            `leo dốc ${hill.seg.id} phải làm đồng hồ chạy CHẬM hơn đoạn bằng ${flat.seg.id}`);
        ok(hillMin < flatMin,
            `cùng 60s thực, đoạn dốc đốt ít phút game hơn (${f2(hillMin)} < ${f2(flatMin)})`);
    }
}

// --------------------------------------------------- 9. thống kê hành trình
console.log("\n  -- getStats(): GIỜ THỰC và GIỜ GAME phải tách biệt --");
{
    clock.reset();
    const seg = segByClass("NATIONAL");
    const min = drive(seg.id, 60, 70);
    const st = clock.getStats();
    console.log(`  distanceKm=${f2(st.distanceKm)} elapsedRealS=${f2(st.elapsedRealS)}` +
        ` gameMinutes=${f2(st.gameMinutes)}\n` +
        `  avgKmh(THỰC)=${f2(st.avgKmh)} gameAvgKmh(GAME)=${f2(st.gameAvgKmh)}` +
        ` class=${st.roadClass} design=${st.designKmh} junctions=${st.junctionsPassed}`);
    ok(Math.abs(st.distanceKm - clock.distanceM / 1000) < 1e-6,
        "distanceKm phải bằng distanceM/1000");
    ok(Math.abs(st.elapsedRealS - 60) < 0.2,
        `elapsedRealS phải bằng 60s (đang ${f2(st.elapsedRealS)})`);
    ok(Math.abs(st.gameMinutes - min) < 1e-6,
        "gameMinutes phải khớp tổng phút đã đo trong vòng chạy");
    // BUG ĐÃ GẶP: avgKmh chia cho GIỜ GAME thay vì GIỜ THỰC -> 1.1 km/h
    // trong khi xe chạy 70 km/h. Chặn lại bằng assert số.
    ok(Math.abs(st.avgKmh - 70) < 12,
        `avgKmh phải là tốc độ THỰC (~70 km/h, đang ${f2(st.avgKmh)})`);
    ok(st.gameAvgKmh < st.avgKmh,
        `gameAvgKmh phải NHỎ hơn avgKmh vì đồng hồ game chạy nhanh thực ` +
        `(${f2(st.gameAvgKmh)} < ${f2(st.avgKmh)})`);
    ok(st.gameAvgKmh > 0 && st.gameAvgKmh < 200,
        `gameAvgKmh phải hợp lệ (đang ${f2(st.gameAvgKmh)})`);
}

// ---------------------------------------------------------------- 10. KẾT LUẬN
console.log("");
if (fails.length === 0) {
    console.log("TRAVEL CLOCK: PASS");
    process.exit(0);
} else {
    console.log(`TRAVEL CLOCK: FAIL (${fails.length})`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
}