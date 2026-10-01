// js/traffic/TrafficDebug.js
// =====================================================================
// Chế độ debug giao thông (F3 hoặc lệnh console "traffic").
// 1) PANEL DOM: ID, tốc độ/tốc độ mong muốn, trạng thái, đoạn đường + class,
//    làn (lane/lanesPerDir/chiều), LOD AI, đích + độ dài route, khe trước/sau,
//    TTC, làn đích + phase FSM đổi làn/tấp lề.
// 2) VẼ TRONG SCENE (THREE.LineSegments/LineLoop, tối ưu lại bộ đệm):
//    - làn đường (tim đường, vạch làn, mép đường) quanh người chơi
//    - vòng spawn (xanh) / despawn (đỏ)
//    - route của xe đang chọn + khoảng cách xe dẫn/xe sau
// 3) SELF-CHECK: kiểm lại ĐỘC LẬP toạ độ (không đọc laneOffset của AI) —
//    xe có nằm bên phải tâm đường không, heading có khớp chiều đi không,
//    có lều mép đường không. Dùng cho Test 1/2/12.
// Không ảnh hưởng gameplay: bật/tắt tức thì, dispose dọn sạch object.
// =====================================================================
import * as THREE from "three";

const MAX_LANE_VERTS = 12000;   // ~800 đoạn vạch
const CIRCLE_SEGMENTS = 64;

export class TrafficDebug {
    constructor({ scene, camera, traffic, roadGraph, getPlayerPos }) {
        this.scene = scene;
        this.camera = camera;
        this.traffic = traffic;
        this.roadGraph = roadGraph;
        this.getPlayerPos = getPlayerPos || (() => null);

        this.enabled = false;
        this._panel = null;
        this._rows = null;
        this._summary = null;
        this._selfCheckEl = null;
        this._acc = 0;
        this._selectedId = null;
        this._group = null;
        this._built = false;
        this.lastSelfCheck = null;
    }

    // ------------------------------------------------------------------ UI
    _ensurePanel() {
        if (this._panel) return;
        const panel = document.createElement('div');
        panel.id = 'traffic-debug-panel';
        panel.style.cssText = [
            'position:fixed', 'top:8px', 'right:8px', 'width:430px', 'maxHeight:72vh',
            'overflow:auto', 'z-index:9999', 'pointer-events:auto',
            'background:rgba(4,10,16,0.86)', 'color:#cfe9ff', 'font:11px/1.45 Consolas,monospace',
            'padding:8px 10px', 'border:1px solid #1d4d6b', 'border-radius:6px',
            'white-space:pre', 'display:none', 'user-select:text'
        ].join(';');

        const head = document.createElement('div');
        head.textContent = 'TRAFFIC DEBUG  [F3]  —  "traffic" trong console';
        head.style.cssText = 'color:#ffd166;font-weight:bold;margin-bottom:6px;';

        this._summary = document.createElement('div');
        this._summary.style.cssText = 'color:#9be7ff;margin-bottom:6px;';

        const hdr = document.createElement('div');
        hdr.textContent = ' #  ID  SPD/TGT   STATE         SEG(CL)     LANE DIR  LOD   FR    TTC   RR   LC/STOP';
        hdr.style.cssText = 'color:#6ea8c6;border-bottom:1px solid #1d4d6b;margin-bottom:3px;';

        this._rows = document.createElement('div');

        this._selfCheckEl = document.createElement('div');
        this._selfCheckEl.style.cssText = 'margin-top:6px;color:#8effc1;';

        panel.append(head, this._summary, hdr, this._rows, this._selfCheckEl);
        document.body.appendChild(panel);
        this._panel = panel;
    }

    _ensureSceneObjects() {
        if (this._built) return;
        const mk = (color, count, type) => {
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setDrawRange(0, 0);
            const mat = new THREE.LineBasicMaterial({
                color, transparent: true, opacity: 0.9, depthTest: false, fog: false
            });
            const obj = type === 'loop' ? new THREE.LineLoop(geo, mat)
                : type === 'line' ? new THREE.Line(geo, mat)
                    : new THREE.LineSegments(geo, mat);
            obj.frustumCulled = false;
            obj.renderOrder = 999;
            return { obj, geo, pos, mat, count };
        };
        this._lanes = mk(0x33ddff, MAX_LANE_VERTS, 'seg');
        this._spawnRing = mk(0x33ff88, CIRCLE_SEGMENTS, 'loop');
        this._despawnRing = mk(0xff5544, CIRCLE_SEGMENTS, 'loop');
        this._route = mk(0xffe066, 4096, 'line');      // polyline route (Line)
        this._gaps = mk(0xff8c33, 8, 'seg');            // khe trước/sau

        this._group = new THREE.Group();
        this._group.name = 'traffic-debug';
        this._group.add(this._lanes.obj, this._spawnRing.obj, this._despawnRing.obj, this._route.obj, this._gaps.obj);
        this.scene.add(this._group);
        this._built = true;
    }

    toggle(force) {
        const next = (force === undefined) ? !this.enabled : !!force;
        if (next === this.enabled) return this.enabled;
        this.enabled = next;
        if (next) {
            this._ensurePanel();
            this._ensureSceneObjects();
            this._panel.style.display = 'block';
            this._group.visible = true;
            this.refresh();
        } else {
            if (this._panel) this._panel.style.display = 'none';
            if (this._group) this._group.visible = false;
        }
        return this.enabled;
    }

    // ------------------------------------------------------------- vòng lặp
    update(dt) {
        if (!this.enabled || !this.traffic) return;
        this._acc += dt;
        this._drawScene();
        if (this._acc < 0.1) return;
        this._acc = 0;
        this._renderPanel();
    }

    _distToPlayer(v) {
        const p = this.getPlayerPos();
        if (!p) return 0;
        return Math.hypot(v.x - p.x, v.z - p.z);
    }

    _renderPanel() {
        const info = this.traffic.getDebugInfo();
        const list = info.list.filter(v => !v.isStatic);
        list.sort((a, b) => this._distToPlayer(a) - this._distToPlayer(b));

        this._summary.textContent =
            `active ${info.active}/${info.max}  moving ${info.moving}  pool ${info.pooled}  ` +
            `spawn ${info.spawnDistance}m  despawn ${info.despawnDistance}m`;

        const fmtGap = (g) => (g === Infinity || !isFinite(g)) ? '  -' : (g > 999 ? '999' : g.toFixed(0).padStart(3));
        const fmtTtc = (t) => (t === Infinity || !isFinite(t)) ? '  -' : (t > 99 ? '99' : t.toFixed(1));

        const rows = [];
        const maxRows = 14;
        for (let i = 0; i < list.length && i < maxRows; i++) {
            const v = list[i];
            const id = String(v.id).padStart(3, ' ');
            const spd = `${v.speedKmh.toFixed(0).padStart(3)}/${Math.round(v.targetSpeed * 3.6)}`;
            const state = (v.state || '?').padEnd(13).slice(0, 13);
            const seg = `${v.seg}(${v.segClass})`.slice(-11).padStart(11);
            const lane = `${v.lane}/${v.lanesPerDir}`.padStart(4);
            const dir = `d${v.dir}`;
            const lod = v.lod.padEnd(4).slice(0, 4);
            const lc = v.stopPhase !== 'IDLE' ? v.stopPhase.slice(0, 8) : v.lcPhase.slice(0, 8);
            const route = `r${v.routeLen}`;
            rows.push(
                `${String(i).padStart(2)}  ${id}  ${spd}  ${state} ${seg} ${lane} ${dir}  ${lod} ` +
                `${fmtGap(v.leaderGap)}  ${fmtTtc(v.ttc)}  ${fmtGap(v.rearGap)}  ${lc}/${route}  dest:${v.goal ?? '-'}`
            );
        }
        this._rows.textContent = rows.length ? rows.join('\n') : '(không có xe NPC đang chạy)';

        const sc = this.lastSelfCheck;
        if (sc) {
            const mark = sc.pass ? 'PASS' : 'FAIL';
            this._selfCheckEl.style.color = sc.pass ? '#8effc1' : '#ff8f8f';
            this._selfCheckEl.textContent =
                `SELF-CHECK [${mark}] xe=${sc.checked}  sai-lề=${sc.wrongSide}  ` +
                `sai-hướng=${sc.wrongHeading}  lều-mép=${sc.offRoad}` +
                (sc.bad && sc.bad.length ? `\n${sc.bad.slice(0, 6).join('\n')}` : '');
        } else {
            this._selfCheckEl.textContent = 'SELF-CHECK: chạy lệnh "traffic check"';
        }
    }

    // --------------------------------------------------------------- vẽ 3D
    _drawScene() {
        if (!this._built || !this.roadGraph) return;
        const p = this.getPlayerPos();
        if (!p) return;

        // Vòng spawn/despawn + route đổi theo frame (rẻ). Vẽ isn đường nặng
        // hơn (tra grid) nên chỉ tính lại 7 lần/giây — debug không cần 60fps.
        this._laneAcc = (this._laneAcc || 0) + 1;
        if (this._laneAcc >= 5) { this._laneAcc = 0; this._drawLanes(p); }
        this._drawRings(p);
        this._drawSelectedRoute();
    }

    _drawLanes(p) {
        const rg = this.roadGraph;
        const pos = this._lanes.pos;
        let n = 0;
        const push = (x1, y1, z1, x2, y2, z2) => {
            if (n + 2 > this._lanes.count) return false;
            pos[n * 3] = x1; pos[n * 3 + 1] = y1; pos[n * 3 + 2] = z1; n++;
            pos[n * 3] = x2; pos[n * 3 + 1] = y2; pos[n * 3 + 2] = z2; n++;
            return true;
        };

        const segs = (typeof rg.segmentsNear === 'function')
            ? rg.segmentsNear(p.x, p.z, 170, s => s.type !== 'tunnel')
            : [];
        const seen = new Set();
        for (const seg of segs) {
            if (seen.has(seg.id)) continue;
            seen.add(seg.id);
            const a = rg.getNode(seg.from), b = rg.getNode(seg.to);
            if (!a || !b) continue;
            const dx = b.x - a.x, dz = b.z - a.z;
            const len = Math.hypot(dx, dz);
            if (len < 1) continue;
            const ux = dx / len, uz = dz / len;
            const rx = -uz, rz = ux;                       // vector PHẢI của chiều from->to
            const meta = rg.getLaneMeta ? rg.getLaneMeta(seg) : null;
            const half = meta ? meta.half : (seg.width || 12) * 0.5;
            const laneW = meta ? meta.laneW : 3.5;
            const lanesPerDir = meta ? meta.lanesPerDir : 1;
            const twoWay = meta ? meta.twoWay : seg.twoWay !== false;
            const y = Math.max(a.y, b.y) + 1.2;

            const line = (offset) => push(
                a.x + rx * offset, y, a.z + rz * offset,
                b.x + rx * offset, y, b.z + rz * offset
            );
            if (!line(0)) break;                            // tim đường
            if (!line(half)) break;
            if (!line(-half)) break;
            for (let k = 1; k < lanesPerDir; k++) {         // vạch phân làn mỗi chiều
                const off = half - k * laneW;
                if (!line(off)) break;
                if (twoWay && !line(-off)) break;
            }
        }
        this._lanes.geo.attributes.position.needsUpdate = true;
        this._lanes.geo.setDrawRange(0, n);
    }

    _circle(target, cx, cz, r, y) {
        const pos = target.pos;
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
            const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
            pos[i * 3] = cx + Math.cos(a) * r;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = cz + Math.sin(a) * r;
        }
        target.geo.attributes.position.needsUpdate = true;
        target.geo.setDrawRange(0, CIRCLE_SEGMENTS);
    }

    _drawRings(p) {
        // đọc trực tiếp field (getDebugInfo() dựng mảng -> không gọi mỗi frame)
        const y = (p.y || 0) + 1.5;
        this._circle(this._spawnRing, p.x, p.z, this.traffic.spawnDistance, y);
        this._circle(this._despawnRing, p.x, p.z, this.traffic.despawnDistance, y);
    }

    // Xe được chọn = xe NPC gần người chơi nhất (đổi sang xe khác khi nó ra xa)
    _pickSelected() {
        const list = this.traffic.aiVehicles.filter(a => !a.isStatic);
        if (!list.length) return null;
        const p = this.getPlayerPos();
        let best = null, bestD = Infinity;
        for (const a of list) {
            const d = p ? Math.hypot(a.collider.x - p.x, a.collider.z - p.z) : 0;
            if (d < bestD) { bestD = d; best = a; }
        }
        return best;
    }

    _drawSelectedRoute() {
        const ai = this._pickSelected();
        const route = this._route, gaps = this._gaps;
        if (!ai || !ai.pathNodes || !ai.pathNodes.length) {
            route.geo.setDrawRange(0, 0);
            gaps.geo.setDrawRange(0, 0);
            return;
        }
        const rg = this.roadGraph;
        const pos = route.pos;
        let n = 0;
        const y = ai.collider.y + 3;
        // điểm xuất phát = vị trí xe hiện tại
        pos[n * 3] = ai.collider.x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = ai.collider.z; n++;
        for (let i = ai.currentPathIndex; i < ai.pathNodes.length && n < route.count; i++) {
            const node = rg.getNode(ai.pathNodes[i]);
            if (!node) continue;
            pos[n * 3] = node.x; pos[n * 3 + 1] = y + 1; pos[n * 3 + 2] = node.z; n++;
        }
        route.geo.attributes.position.needsUpdate = true;
        route.geo.setDrawRange(0, n);

        // khe xe dẫn (đỏ) / xe sau (cam)
        const gp = gaps.pos;
        let g = 0;
        const seg = (from, to) => {
            if (g + 2 > gaps.count) return;
            gp[g * 3] = from.x; gp[g * 3 + 1] = from.y + 1; gp[g * 3 + 2] = from.z; g++;
            gp[g * 3] = to.x; gp[g * 3 + 1] = to.y + 1; gp[g * 3 + 2] = to.z; g++;
        };
        if (ai.scan.leader && ai.scan.leader.collider) seg(ai.collider, ai.scan.leader.collider);
        if (ai.scan.rear && ai.scan.rear.collider) seg(ai.collider, ai.scan.rear.collider);
        gaps.geo.attributes.position.needsUpdate = true;
        gaps.geo.setDrawRange(0, g);
    }

    // ------------------------------------------------------------ self-check
    // Kiểm ĐỘC LẬP: tính lại toạ độ trên đường từ segment + progress, so với
    // vị trí thật của xe. KHÔNG đọc laneOffset -> nếu AI đặt nhầm làn vẫn lộ.
    runSelfCheck() {
        const rg = this.roadGraph, traffic = this.traffic;
        const res = { checked: 0, wrongSide: 0, wrongHeading: 0, offRoad: 0, pass: false, bad: [] };
        if (!rg || !traffic) { this.lastSelfCheck = res; return res; }

        for (const ai of traffic.aiVehicles) {
            if (ai.isStatic) continue;
            const seg = rg.getSegment(ai.currentSegmentId);
            if (!seg) continue;
            const a = rg.getNode(ai.direction === 0 ? seg.from : seg.to);
            const b = rg.getNode(ai.direction === 0 ? seg.to : seg.from);
            if (!a || !b) continue;
            const dx = b.x - a.x, dz = b.z - a.z;
            const len = Math.hypot(dx, dz);
            if (len < 1) continue;
            const ux = dx / len, uz = dz / len;
            const rx = -uz, rz = ux;
            const cx = a.x + ux * (ai.progress * len);
            const cz = a.z + uz * (ai.progress * len);
            // khoảng cách thật tới tâm đường (dương = bên phải theo chiều đi)
            const s = (ai.collider.x - cx) * rx + (ai.collider.z - cz) * rz;
            const half = (seg.width || 12) * 0.5;

            res.checked++;
            if (s < -0.3) {
                res.wrongSide++;
                if (res.bad.length < 12) res.bad.push(`#${ai.id} SAI LỀ (s=${s.toFixed(2)}m, dir=${ai.direction})`);
            } else if (s > half + 0.6) {
                res.offRoad++;
                if (res.bad.length < 12) res.bad.push(`#${ai.id} LỀ MÉP (s=${s.toFixed(2)}m > half=${half})`);
            }
            if (!ai.turning) {
                const dot = Math.sin(ai.heading) * ux + Math.cos(ai.heading) * uz;
                if (dot < 0.7) {
                    res.wrongHeading++;
                    if (res.bad.length < 12) res.bad.push(`#${ai.id} SAI HƯỚNG (dot=${dot.toFixed(2)})`);
                }
            }
        }
        res.pass = res.checked > 0 && res.wrongSide === 0 && res.wrongHeading === 0 && res.offRoad === 0;
        this.lastSelfCheck = res;
        if (this.enabled) this._renderPanel();
        return res;
    }

    refresh() {
        if (!this.enabled) return;
        this._renderPanel();
        this._drawScene();
    }

    dispose() {
        if (this._group) {
            if (this._group.parent) this._group.parent.remove(this._group);
            this._group.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
            this._group = null;
        }
        if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
        this._panel = null;
        this._rows = null;
        this._summary = null;
        this._selfCheckEl = null;
        this._built = false;
        this.enabled = false;
    }
}

export function createTrafficDebug(options) {
    return new TrafficDebug(options);
}
