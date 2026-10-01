// tools/world_probe.js — BUSDRIVEVN WORLD PROBE (rule 45/46/47)
// ---------------------------------------------------------------------------
// Cắm vào game đang chạy (window.__busvn tồn tại) để ĐO, không cần nhìn mắt:
//   1) GRINDING   — mặt đường node.y vs terrain thật vs bus.y (rule 20/35/36)
//   2) CONTINUITY — quét dọc tuyến: đoạn nào mất đường / đứt / giật cao (6/7/53/54)
//   3) JUNCTION   — node giao có bao nhiêu nhánh, có nhánh nào bay (6/12)
//   4) STRUCTURE  — bến xe có entrance/exit/internal/bay/parking (16/63)
//   5) PERF       — draw call, triangle, instance, RAM JS heap (29/66)
//   6) OCCUPANCY  — nhà/station có nằm trên đường không (14/15/22/39)
// Dùng:  await import('/tools/world_probe.js')  -> window.WP
// Rồi:    WP.probeAll() hoặc WP.driveRoute() ...
// ===========================================================================

const WP = (() => {
    const G = () => window.__busvn;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

    // ------------------------------------------------------------- helpers
    function segDist(px, pz, a, b) {
        const dx = b.x - a.x, dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        if (l2 <= 0) return Math.hypot(px - a.x, pz - a.z);
        let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
        t = clamp(t, 0, 1);
        return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    }

    // tìm đoạn đường gần nhất trong BÁN KÍCH THƯỚT (dùng _roadIdx của map.js)
    function nearestSeg(map, x, z) {
        const idx = map._roadIdx;
        if (!idx || !map.roadGraph) return null;
        const c = map._roadCell;
        const cx = Math.floor(x / c) + 524288, cz = Math.floor(z / c) + 524288;
        let best = null, bestD = Infinity;
        const seen = new Set();
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const arr = idx.get((cx + dx) * 1048576 + (cz + dz));
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) {
                    const sid = arr[i];
                    if (seen.has(sid)) continue;
                    seen.add(sid);
                    const seg = map.roadGraph.getSegment(sid);
                    if (!seg) continue;
                    const p1 = map.roadGraph.getNode(seg.from);
                    const p2 = map.roadGraph.getNode(seg.to);
                    if (!p1 || !p2) continue;
                    const d = segDist(x, z, p1, p2);
                    if (d < bestD) { bestD = d; best = { seg, p1, p2, d }; }
                }
            }
        }
        return best;
    }

    // ------------------------------------------------- 1) GRIDING (1 diem)
    // busY = getTerrainHeight + 0.5 (main.js) -> so sanh voi mat duong node.y
    function sampleAt(x, z) {
        const map = G().map;
        const ns = nearestSeg(map, x, z);
        const terrain = map.world.getElevation(x, z);
        const ground = map.getTerrainHeight(x, z);
        const onRoadHalf = ns ? ns.seg.width * 0.5 : 0;
        const roadSurface = ns ? (() => {
            const dx = ns.p2.x - ns.p1.x, dz = ns.p2.z - ns.p1.z;
            const l2 = dx * dx + dz * dz;
            let t = l2 > 0 ? ((x - ns.p1.x) * dx + (z - ns.p1.z) * dz) / l2 : 0;
            t = clamp(t, 0, 1);
            return ns.p1.y + (ns.p2.y - ns.p1.y) * t;
        })() : null;
        return {
            x: Math.round(x), z: Math.round(z),
            onRoad: !!ns && ns.d <= onRoadHalf,
            dRoad: ns ? +ns.d.toFixed(1) : null,
            roadClass: ns ? ns.seg.class : null,
            roadY: roadSurface === null ? null : +roadSurface.toFixed(2),
            terrainY: +terrain.toFixed(2),
            busY: +(ground + 0.5).toFixed(2),
            // chênh lệch giữa bánh xe (busY) và mặt đường -> 0 = bám sát
            sink: roadSurface === null ? null : +(ground + 0.5 - roadSurface).toFixed(2)
        };
    }

    // ------------------------------------------- 2) CONTINUITY (quet tuyến)
    // Bước 25m dọc polyline tuyến chính: tìm CHỖ ĐỨT / CHỖ GIẬT CAO
    function driveRoute(step = 25) {
        const map = G().map;
        const wp = map.getRouteWaypoints();
        if (!wp || wp.length < 2) return { error: "khong co route waypoints" };
        const samples = [];
        let acc = 0, total = 0;
        for (let i = 1; i < wp.length; i++) {
            const a = wp[i - 1], b = wp[i];
            const L = Math.hypot(b.x - a.x, b.z - a.z);
            if (L < 0.5) continue;
            const n = Math.max(1, Math.round(L / step));
            for (let k = 0; k < n; k++) {
                const t = k / n;
                samples.push(sampleAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
            }
            total += L;
            acc += L;
        }
        samples.push(sampleAt(wp[wp.length - 1].x, wp[wp.length - 1].z));

        // phan tich
        const gaps = [];        // khong co duong ben duong
        const offEdge = [];     // duong nhung lech qua be mat duong
        const jumps = [];       // heo mat duong > 1.2m giua 2 buoc (25m) => doc >4.8%
        const sinks = [];       // bus chim/leo duong
        const classRun = {};
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            classRun[s.roadClass || "NONE"] = (classRun[s.roadClass || "NONE"] || 0) + 1;
            if (!s.roadY) { gaps.push(s); continue; }
            if (!s.onRoad) offEdge.push(s);
            if (i > 0) {
                const p = samples[i - 1];
                if (p.roadY !== null) {
                    const d = Math.abs(s.roadY - p.roadY);
                    if (d > 1.2) jumps.push({ ...s, prevY: p.roadY, dy: +d.toFixed(2), grade: +(d / step * 100).toFixed(1) });
                }
            }
            if (Math.abs(s.sink) > 0.35) sinks.push(s);
        }
        const runMax = Math.max(0, gaps.length);
        // dai gap lon nhat (khong cat nhat)
        let run = 0, worstRun = 0, worstAt = null;
        for (let i = 0; i < samples.length; i++) {
            if (!samples[i].roadY) { run++; if (run > worstRun) { worstRun = run; worstAt = samples[i]; } }
            else run = 0;
        }
        return {
            routeKm: +(total / 1000).toFixed(1),
            samples: samples.length,
            noRoad: gaps.length,
            noRoadPct: +(gaps.length / samples.length * 100).toFixed(2),
            worstGapRun: worstRun,
            worstGapAt: worstAt ? { x: worstAt.x, z: worstAt.z } : null,
            worstGapMeters: worstRun * step,
            offEdge: offEdge.length,
            offEdgePct: +(offEdge.length / samples.length * 100).toFixed(2),
            gradeJumps: jumps.length,
            worstGrade: jumps.length ? Math.max(...jumps.map(j => j.grade)) : 0,
            jumpSamples: jumps.slice(0, 10),
            sinkSamples: sinks.length,
            sinkWorst: sinks.length ? sinks.reduce((a, b) => Math.abs(b.sink) > Math.abs(a.sink) ? b : a) : null,
            classMix: classRun
        };
    }

    // ------------------------------------------------ 3) JUNCTION (lua doi)
    function junctions(limit = 40) {
        const map = G().map;
        const rg = map.roadGraph;
        const deg = new Map();
        for (const s of rg.segments) {
            deg.set(s.from, (deg.get(s.from) || 0) + 1);
            deg.set(s.to, (deg.get(s.to) || 0) + 1);
        }
        const hist = {};
        let maxDeg = 0, maxNode = null, nJ = 0;
        for (const [nid, d] of deg) {
            hist[d] = (hist[d] || 0) + 1;
            if (d >= 3) nJ++;
            if (d > maxDeg) { maxDeg = d; maxNode = nid; }
        }
        // ngã tư 4 nhanh: trai-phai hoac thang-gap
        const quads = [];
        for (const s of rg.segments) {
            for (const nid of [s.from, s.to]) {
                if (quads.some(q => q.node === nid)) continue;
                const arr = [];
                for (const s2 of rg.segments) {
                    if (s2.from === nid) arr.push(s2);
                    else if (s2.to === nid) arr.push(s2);
                }
                if (arr.length < 4) continue;
                const angles = arr.map(s2 => {
                    const a = rg.getNode(s2.from === nid ? s2.to : s2.from);
                    const p = rg.getNode(nid);
                    return Math.atan2(a.x - p.x, a.z - p.z) * 180 / Math.PI;
                }).sort((x, y) => x - y);
                // khoang goc giua 2 nhanh ke nhau
                let minGap = 999;
                for (let k = 0; k < angles.length; k++) {
                    let g = angles[(k + 1) % angles.length] - angles[k];
                    if (g < 0) g += 360;
                    minGap = Math.min(minGap, g);
                }
                quads.push({ node: nid, branches: arr.length, minAngleGap: +minGap.toFixed(1),
                             classes: arr.map(s2 => s2.class).sort() });
            }
        }
        // nhanh bay > 45m (khong cham node nao trong 45m) = nhanh khong noi
        const flown = [];
        for (const s of rg.segments) {
            if (s.class === "EXPRESSWAY" || s.class === "RAMP" || s.class === "ARTERIAL" ||
                s.class === "NATIONAL" || s.class === "COLLECTOR") continue;
            const p1 = rg.getNode(s.from), p2 = rg.getNode(s.to);
            if (!p1 || !p2) continue;
            const L = Math.hypot(p2.x - p1.x, p2.z - p1.z);
            if (L > 420) flown.push({ id: s.id, cls: s.class, len: +L.toFixed(0), name: s.name });
        }
        return { degreeHist: hist, junctions: nJ, maxDegree: maxDeg, maxDegreeNode: maxNode,
                 fourWay: quads.slice(0, limit), fourWayCount: quads.length, flownBranches: flown.length,
                 flownSamples: flown.slice(0, 10) };
    }

    // ----------------------------------------- 4) STRUCTURE (ben xe / station)
    function structures() {
        const map = G().map;
        const rg = map.roadGraph;
        const out = [];
        for (const s of map.stationsData) {
            const isBus = s.type === "BUS_STATION" || s.type === "MAJOR_BUS_TERMINAL";
            const ns = nearestSeg(map, s.x, s.z);
            // dem doan INTERNAL/STATION_ACCESS nam trong san
            let internal = 0, access = 0, reach = null;
            const R = Math.max(s.w || 180, s.d || 130);
            for (const g of rg.segments) {
                const p1 = rg.getNode(g.from), p2 = rg.getNode(g.to);
                if (!p1 || !p2) continue;
                if (g.class === "STATION_ACCESS") {
                    if (Math.hypot((p1.x + p2.x) / 2 - s.x, (p1.z + p2.z) / 2 - s.z) < R * 2.2) access++;
                } else if (g.class === "INTERNAL" || g.class === "SERVICE") {
                    if (segDist(s.x, s.z, p1, p2) < R * 0.75) internal++;
                }
            }
            // duong lon nhat gan ben -> ben co ra duong chinh khong?
            let maj = null;
            for (const g of rg.segments) {
                if (g.class !== "NATIONAL" && g.class !== "EXPRESSWAY" && g.class !== "ARTERIAL" &&
                    g.class !== "COLLECTOR") continue;
                const p1 = rg.getNode(g.from), p2 = rg.getNode(g.to);
                if (!p1 || !p2) continue;
                const d = segDist(s.x, s.z, p1, p2);
                if (!maj || d < maj.d) maj = { d: +d.toFixed(1), cls: g.class, w: g.width, name: g.name };
            }
            if (maj) reach = maj.d;
            out.push({
                id: s.id, name: s.name, type: s.type, isBus,
                bays: (s.baySlots || []).length,
                internalSeg: internal, accessSeg: access,
                dNearestRoad: ns ? +ns.d.toFixed(1) : null,
                nearestClass: ns ? ns.seg.class : null,
                dMainRoad: reach, mainClass: maj ? maj.cls : null,
                w: s.w, d: s.d,
                // vi pham rule 14: ben nam TREN duong
                onRoad: ns ? ns.d < ns.seg.width * 0.5 : false,
                // vi pham rule 11/63: khong co duong ra duong chinh
                noMainAccess: maj ? maj.d > 260 : true
            });
        }
        return out;
    }

    // ------------------------------------------------ 5) PERF (do that)
    function perf(frames = 40) {
        const b = G();
        const r = b.renderer;
        // tick thu cong: tab bi an thi rAF treo
        const t0 = performance.now();
        b.tick(frames);
        const dt = performance.now() - t0;
        const info = r.info;
        let objs = 0, insts = 0, instTotal = 0;
        b.scene.traverse(o => {
            objs++;
            if (o.isInstancedMesh) { insts++; instTotal += o.count; }
        });
        return {
            frames, msTotal: +dt.toFixed(0), msPerFrame: +(dt / frames).toFixed(2),
            fps: +(1000 / (dt / frames)).toFixed(1),
            drawCalls: info.render.calls, triangles: info.render.triangles,
            programs: info.programs ? info.programs.length : null,
            geometries: info.memory.geometries, textures: info.memory.textures,
            sceneObjects: objs, instancedMeshes: insts, instances: instTotal,
            heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
            renderRadius: b.map.renderRadius,
            loadedChunks: b.map.loadedChunks.size,
            isLowEnd: b.map.isLowEnd
        };
    }

    // ------------------------------------- 6) OCCUPANCY (nha / station tren duong)
    function occupancy(sectorKeys = null) {
        const map = G().map;
        const keys = sectorKeys || [...map._sectorCache.keys()];
        let buildings = 0, onRoad = 0, samples = [];
        for (const k of keys) {
            const sec = map._sectorCache.get(k);
            if (!sec) continue;
            for (const ck of Object.keys(sec)) {
                const ch = sec[ck];
                for (const b of (ch.buildings || [])) {
                    buildings++;
                    const ns = nearestSeg(map, b.x, b.z);
                    if (!ns) continue;
                    const half = ns.seg.width * 0.5;
                    const r = Math.max(b.w || 5, b.d || 5) * 0.5;
                    const hw = ns.seg.class === "EXPRESSWAY" ? half + 10 : half * 0.75;
                    if (ns.d < hw + r * 0.35) {
                        onRoad++;
                        if (samples.length < 12) samples.push({ type: b.type, cls: ns.seg.class,
                            d: +ns.d.toFixed(1), w: ns.seg.width, x: Math.round(b.x), z: Math.round(b.z) });
                    }
                }
            }
        }
        return { sectorsScanned: keys.length, buildings, onRoad,
                 pct: buildings ? +(onRoad / buildings * 100).toFixed(3) : 0, samples };
    }

    // ------------------------------------------------------- 8) JUNCTION PATCH
    // KIEM CHUNG HINH HOC THAT (rule 12/13) bang RAYCAST XUONG:
    //   * moi diem trong giao lo deu co mat duong  -> khong co LO
    //   * khong doan nao bi cat nga  -> do bang ty le cham
    // Ban kinh quet = kich thuoc that cua polygon giao lo.
    function junctionPatch(limit = 400) {
        const b = G();
        const map = b.map, THREE = b.THREE;
        const js = map._junctions;
        if (!js || !js.size) return { error: "khong co index giao lo" };

        const CH = 256;
        const built = new Set();
        for (const [k, e] of map.loadedChunks) if (e.built) built.add(k);

        const roadMeshes = [];
        b.scene.traverse(o => {
            if (o.isMesh && typeof o.name === "string" && o.name.startsWith("road_")) roadMeshes.push(o);
        });
        const ray = new THREE.Raycaster();
        ray.far = 4000;
        const down = new THREE.Vector3(0, -1, 0);
        const origin = new THREE.Vector3();

        // Diem CHAC CHAN o BEN TRONG da giac: centroid -> 25% / 55% toi moi dinh.
        // (Diem tren canh/duong trung gian nam ngay TREN canh => khong phai lo.)
        const ptsIn = (J) => {
            const P = J.poly, n = P.length;
            let cx = 0, cz = 0;
            for (const v of P) { cx += v[0]; cz += v[1]; }
            cx /= n; cz /= n;
            const out = [[cx, cz]];
            for (const v of P) {
                out.push([cx + (v[0] - cx) * 0.25, cz + (v[1] - cz) * 0.25]);
                out.push([cx + (v[0] - cx) * 0.55, cz + (v[1] - cz) * 0.55]);
            }
            return out;
        };
        // node co nam trong da giac cua chinh no khong (rule 12)
        const nodeIn = (P, x, z) => {
            const n = P.length;
            let pos = 0, neg = 0;
            for (let i = 0; i < n; i++) {
                const a = P[i], c = P[(i + 1) % n];
                const cr = (c[0] - a[0]) * (z - a[1]) - (c[1] - a[1]) * (x - a[0]);
                if (cr > 1e-6) pos++; else if (cr < -1e-6) neg++;
            }
            return pos === 0 || neg === 0;
        };

        let tested = 0, hits = 0, miss = 0, cand = 0, nodeOutside = 0, skipped = 0;
        const holes = [], bad = [];
        for (const [id, J] of js) {
            // CHI do junction co TAT CA chunk no cham deu da build
            let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
            for (const v of J.poly) {
                if (v[0] < mnx) mnx = v[0];
                if (v[0] > mxx) mxx = v[0];
                if (v[1] < mnz) mnz = v[1];
                if (v[1] > mxz) mxz = v[1];
            }
            let tot = 0, own = 0;
            for (let cx = Math.floor(mnx / CH); cx <= Math.floor(mxx / CH); cx++) {
                for (let cz = Math.floor(mnz / CH); cz <= Math.floor(mxz / CH); cz++) {
                    tot++; if (built.has(cx + "," + cz)) own++;
                }
            }
            if (!tot || own < tot) { skipped++; continue; }
            cand++;
            if (!nodeIn(J.poly, J.x, J.z)) {
                nodeOutside++;
                if (bad.length < 8) bad.push({ id, verts: J.poly.length });
            }
            for (const [qx, qz] of ptsIn(J)) {
                origin.set(qx, J.y + 60, qz);
                ray.set(origin, down);
                const h = ray.intersectObjects(roadMeshes, false);
                tested++;
                if (h.length) hits++;
                else {
                    miss++;
                    if (holes.length < 10) holes.push({ id, x: +qx.toFixed(1), z: +qz.toFixed(1) });
                }
            }
        }
        let trimmed = 0, maxTrim = 0, stopLines = 0, verts = 0;
        for (const J of js.values()) {
            for (const t of J.trimBySeg.values()) {
                if (t > 0) trimmed++;
                if (t > maxTrim) maxTrim = t;
            }
            stopLines += J.stopLines.length;
            verts += J.poly.length;
        }
        return {
            junctions: js.size, testedJunctions: cand, skippedNotBuilt: skipped,
            sampled: tested, surfaceHits: hits, holes: miss,
            holePct: +(miss / Math.max(1, tested) * 100).toFixed(2),
            nodeOutsidePolygon: nodeOutside, badJunctions: bad, holeSamples: holes,
            trimmedBranches: trimmed, maxTrim: +maxTrim.toFixed(1),
            stopLines, avgVerts: +(verts / js.size).toFixed(2),
            roadMeshesInScene: roadMeshes.length
        };
    }

    // ------------------------------------------------ 9) GROUNDING qua hanh trinh
    // Do bus.y so voi mat duong doc tuyen (rule 20/35/36). |sink| < 0.35m la
    // xe BAM DUONG; lon hon = xe bay hoac chim.
    function driveGrounding(step = 50) {
        const map = G().map;
        const wp = map.getRouteWaypoints();
        const bad = [];
        let ok = 0, tested = 0;
        let carry = step;
        for (let i = 1; i < wp.length; i++) {
            const A = wp[i - 1], B = wp[i];
            const L = Math.hypot(B.x - A.x, B.z - A.z);
            if (L < 1) continue;
            carry += L;
            if (carry < step) continue;
            carry = 0;
            const s = sampleAt(B.x, B.z);
            if (!s.roadY) continue;
            tested++;
            if (Math.abs(s.sink) > 0.35) bad.push(s);
            else ok++;
        }
        return { tested, ok, badGrounding: bad.length,
                 worst: bad.slice(0, 6) };
    }

    // -------------------------------------------- 7) TRAVEL (do o che do toi)
    // Teleport bus -> cho chunk load -> do cam nhan giua cac moc duong
    async function travel(points, settleMs = 900) {
        const b = G();
        const out = [];
        for (const p of points) {
            b.bus.group.position.set(p.x, 0, p.z);
            b.map.updateChunks(p.x, p.z, 1 / 30, null);
            await new Promise(r => setTimeout(r, settleMs));
            const s = sampleAt(b.bus.group.position.x, b.bus.group.position.z);
            s.chunks = b.map.loadedChunks.size;
            s.water = b.map.world.waterFactor(p.x, p.z) > 0.2;
            out.push(s);
        }
        return out;
    }

    function terrainY(x, z) { return G().map.world.getElevation(x, z); }
    function listPois() {
        return G().map.stationsData.map(s => ({
            name: s.name, type: s.type, x: Math.round(s.x), z: Math.round(s.z),
            bays: (s.baySlots || []).length
        }));
    }
    function routeWaypoints() {
        const wp = G().map.getRouteWaypoints();
        return { n: wp.length, first: wp[0], last: wp[wp.length - 1] };
    }

    async function probeAll(opts = {}) {
        return {
            perf: perf(opts.frames || 30),
            route: driveRoute(opts.step || 25),
            junctions: junctions(),
            structures: structures(),
            occupancy: occupancy(opts.sectors),
            junction: junctionPatch(opts.junctions || 80),
            grounding: driveGrounding(opts.groundStep || 50)
        };
    }

    return { sampleAt, nearestSeg, driveRoute, junctions, structures, perf,
             occupancy, travel, terrainY, listPois, routeWaypoints, probeAll,
             junctionPatch, driveGrounding };
})();

window.WP = WP;
export default WP;
