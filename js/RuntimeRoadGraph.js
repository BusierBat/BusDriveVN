// js/RuntimeRoadGraph.js
//
// SOURCE OF TRUTH của road network (rule 56): world render, minimap, NPC
// routing, audit đều đọc từ đây. KHÔNG có bản song song.
//
// Ngoài API cũ (nodes/segments/routes/pois) có thêm ĐỒ THỊ ĐỒ N HƯỚNG + A*
// (rule 57). Routing phải hiểu node / edge / direction / junction — chọn nhánh
// NGẪU NHIÊN ở ngã ba là cách NPC đi lung tung trong map, không phải lái xe.
export class RuntimeRoadGraph {
    constructor(data) {
        this.nodes = [];
        this.segments = [];
        this.routes = [];
        this.pois = [];

        this._nodeMap = new Map();
        this._segMap = new Map();
        this._adj = new Map();

        if (data) {
            this.build(data);
        }
    }

    build(data) {
        this.nodes = data.roads.nodes || [];
        this._nodeMap = new Map(this.nodes.map(n => [n.id, n]));

        this.segments = data.roads.segments || [];
        this._segMap = new Map(this.segments.map(s => [s.id, s]));

        this.routes = data.routes || [];

        if (data.stations) {
            this.pois = data.stations.map(s => ({
                id: s.id,
                type: s.type,
                name: s.name,
                position: { x: s.x, y: s.y, z: s.z },
                size: { width: s.w, depth: s.d },
                busBays: s.buses || []
            }));
        }
        this._buildAdjacency();
        this._buildSegGrid();
    }

    // LUOI O segment (cell 256m) - tim doan duong GAN mot diem trong O(1)
    // thay vi quet 10k segment. Khong co cai nay thi NPC khong bao gio spawn:
    // boc ngau nhien tren 10k doan rai khap 500km roi doi xe phai nam trong
    // 100-200m cua nguoi choi => xac suat ~0 (do duoc: 0 xe sau 400 frame).
    _buildSegGrid(cell = 256) {
        this._segCell = cell;
        this._segGrid = new Map();
        for (const s of this.segments) {
            const a = this._nodeMap.get(s.from), b = this._nodeMap.get(s.to);
            if (!a || !b) continue;
            const hw = (s.width || 12) * 0.5;
            const c0x = Math.floor((Math.min(a.x, b.x) - hw) / cell);
            const c1x = Math.floor((Math.max(a.x, b.x) + hw) / cell);
            const c0z = Math.floor((Math.min(a.z, b.z) - hw) / cell);
            const c1z = Math.floor((Math.max(a.z, b.z) + hw) / cell);
            for (let cx = c0x; cx <= c1x; cx++) {
                for (let cz = c0z; cz <= c1z; cz++) {
                    const k = cx + "," + cz;
                    let arr = this._segGrid.get(k);
                    if (!arr) { arr = []; this._segGrid.set(k, arr); }
                    arr.push(s.id);
                }
            }
        }
    }

    // Cac segment nam trong ban kinh r quanh (x,z). accept = loc them.
    segmentsNear(x, z, r = 400, accept = null) {
        if (!this._segGrid) return [];
        const c = this._segCell;
        const r2 = r * r;
        const out = [];
        const seen = new Set();
        const c0x = Math.floor((x - r) / c), c1x = Math.floor((x + r) / c);
        const c0z = Math.floor((z - r) / c), c1z = Math.floor((z + r) / c);
        for (let cx = c0x; cx <= c1x; cx++) {
            for (let cz = c0z; cz <= c1z; cz++) {
                const arr = this._segGrid.get(cx + "," + cz);
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) {
                    const id = arr[i];
                    if (seen.has(id)) continue;
                    seen.add(id);
                    const s = this._segMap.get(id);
                    if (!s) continue;
                    if (accept && !accept(s)) continue;
                    const a = this._nodeMap.get(s.from), b = this._nodeMap.get(s.to);
                    if (!a || !b) continue;
                    const dx = b.x - a.x, dz = b.z - a.z;
                    const l2 = dx * dx + dz * dz || 1;
                    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
                    t = t < 0 ? 0 : t > 1 ? 1 : t;
                    const ex = x - (a.x + dx * t), ez = z - (a.z + dz * t);
                    if (ex * ex + ez * ez <= r2) out.push(s);
                }
            }
        }
        return out;
    }

    // ------------------------------------------------------------ adjacency
    // Mỗi cạnh 2 CHIỀU (xe chạy được cả 2 chiều trên cùng mặt đường).
    // cost = chiều dài * hệ số class: đi ngõ tốn hơn đi QL, nên AI tự bám
    // đường lớn thay vì rẽ vào ngõ cụt ở mỗi ngã ba.
    _buildAdjacency() {
        this._adj.clear();
        for (const n of this.nodes) this._adj.set(n.id, []);
        for (const s of this.segments) {
            const a = this._nodeMap.get(s.from), b = this._nodeMap.get(s.to);
            if (!a || !b) continue;
            const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const cls = s.class || "";
            const f = cls === "EXPRESSWAY" || cls === "RAMP" ? 0.75
                : cls === "NATIONAL" ? 0.85
                : cls === "ARTERIAL" ? 1.0
                : cls === "COLLECTOR" ? 1.25
                : (cls === "LOCAL" || cls === "RURAL_LOCAL") ? 1.9
                : cls === "ALLEY" ? 3.4
                : (cls === "INTERNAL" || cls === "SERVICE" || cls === "STATION_ACCESS") ? 2.6
                : 1.5;
            const cost = len * f;
            const ta = this._adj.get(s.from), tb = this._adj.get(s.to);
            if (ta) ta.push({ seg: s.id, to: s.to, len, cost, w: s.width || 12, cls });
            if (tb) tb.push({ seg: s.id, to: s.from, len, cost, w: s.width || 12, cls });
        }
    }

    // danh sách cạnh đi ra từ 1 node
    neighbors(nodeId) { return this._adj.get(nodeId) || []; }

    // node gần (x,z); accept = hàm lọc (dùng để chỉ chọn node trên đường lớn)
    nearestNode(x, z, accept = null, maxNodes = 1200) {
        let best = null, bestD = Infinity;
        const step = Math.max(1, Math.floor(this.nodes.length / maxNodes));
        for (let i = 0; i < this.nodes.length; i += step) {
            const n = this.nodes[i];
            if (accept && !accept(n)) continue;
            const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
            if (d < bestD) { bestD = d; best = n; }
        }
        return best;
    }

    // node nào CHẠC được tới đích (nằm trong cùng thành phần liên thông)
    canReach(fromId, toId) {
        if (!this._adj.has(fromId) || !this._adj.has(toId)) return false;
        const seen = new Set([fromId]);
        const stack = [fromId];
        while (stack.length) {
            const c = stack.pop();
            if (c === toId) return true;
            for (const e of this._adj.get(c)) {
                if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ A*
    // Đường đi từ `fromId` tới `toId`, trả mảng node id (không gồm fromId).
    // `avoidUturnFrom` = seg vừa đi tới: cấm quay đầu tại ngã (rule 57).
    findPath(fromId, toId, avoidUturnFrom = null) {
        if (fromId === toId) return [];
        if (!this._adj.has(fromId) || !this._adj.has(toId)) return null;
        const goal = this._nodeMap.get(toId);
        if (!goal) return null;
        const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
        const gScore = new Map([[fromId, 0]]);
        const came = new Map();
        const open = new Set([fromId]);
        const fScore = new Map([[fromId, h(this._nodeMap.get(fromId))]]);
        let guard = 0;
        while (open.size > 0 && guard++ < 40000) {
            let cur = null, curF = Infinity;
            for (const id of open) {
                const f = fScore.get(id);
                if (f !== undefined && f < curF) { curF = f; cur = id; }
            }
            if (cur === null) break;
            if (cur === toId) {
                const out = [];
                let k = cur;
                while (k !== undefined && k !== fromId) { out.push(k); k = came.get(k); }
                return out.reverse();
            }
            open.delete(cur);
            const gc = gScore.get(cur) || 0;
            const outs = this._adj.get(cur);
            for (let i = 0; i < outs.length; i++) {
                const e = outs[i];
                if (e.to === fromId && e.seg === avoidUturnFrom) continue;
                const ng = gc + e.cost;
                if (gScore.has(e.to) && gScore.get(e.to) <= ng) continue;
                came.set(e.to, cur);
                gScore.set(e.to, ng);
                fScore.set(e.to, ng + h(this._nodeMap.get(e.to)));
                open.add(e.to);
            }
        }
        return null;
    }

    // Nhánh đi tiếp tại node theo hướng về đích (rule 57).
    nextSegmentToward(nodeId, goalId, fromSegId) {
        if (!goalId || goalId === nodeId) return null;
        const outs = this._adj.get(nodeId);
        if (!outs || !outs.length) return null;
        const path = this.findPath(nodeId, goalId, fromSegId);
        if (path && path.length) {
            const nx = path[0];
            let e = null;
            for (const c of outs) if (c.to === nx && c.seg !== fromSegId) { e = c; break; }
            if (!e) for (const c of outs) if (c.to === nx) { e = c; break; }
            if (e) return e.seg;
        }
        // Không có path (đích bị cắt khỏi thành phần này) -> đi nhánh RẺ nhất
        // để bám đường lớn, tuyệt đối không U-turn tại ngã ba.
        let best = null;
        for (const c of outs) {
            if (c.seg === fromSegId) continue;
            if (!best || c.cost / (c.len || 1) < best.cost / (best.len || 1)) best = c;
        }
        return best ? best.seg : null;
    }

    getNode(id) { return this._nodeMap.get(id); }
    getSegment(id) { return this._segMap.get(id); }

    getSegmentsAtNode(nodeId) {
        const node = this.getNode(nodeId);
        if (!node) return [];
        return (node.connections || []).map(id => this.getSegment(id)).filter(Boolean);
    }

    getRouteWaypoints() {
        if (this.routes.length === 0) return [];
        const mainRoute = this.routes[0];
        return (mainRoute.nodes || []).map(id => {
            const node = this.getNode(id);
            return node ? { id: node.id, x: node.x, y: node.y, z: node.z } : null;
        }).filter(Boolean);
    }

    getMinimapData() {
        return {
            segments: this.segments.map(s => {
                const f = this.getNode(s.from);
                const t = this.getNode(s.to);
                if (!f || !t) return null;
                return { from: { x: f.x, z: f.z }, to: { x: t.x, z: t.z } };
            }).filter(Boolean),
            route: this.getRouteWaypoints().map(w => ({ x: w.x, z: w.z })),
            pois: this.pois.map(p => ({ x: p.position.x, z: p.position.z }))
        };
    }

    getSpawnPoint() {
        // Spawn tại Bến xe Nam Tuy Hòa
        if (this.pois.length > 0) {
            const st = this.pois[0];
            return { x: st.position.x + 50, y: st.position.y + 0.5, z: st.position.z + 50, heading: 0 };
        }
        if (this.nodes.length > 0) {
            const firstNode = this.nodes[0];
            return { x: firstNode.x, y: firstNode.y + 0.5, z: firstNode.z, heading: 0 };
        }
        return { x: 0, y: 10, z: 0, heading: 0 };
    }
}
