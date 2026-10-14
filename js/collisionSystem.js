// js/collisionSystem.js
// Hai loại collider:
//   circle (register) — vật thể tròn (player / NPC): check theo khoảng cách.
//   box    (registerBox) — hộp định hướng (mặt đường DRIVEABLE SURFACE
//     derive từ road graph): check theo tọa độ cục bộ của box.
// Box collider dùng type "road" — KHÔNG nằm trong danh sách types mặc
// định của check() (['static','npc'] / ['npc','static','player']) nên
// mặt đường không bao giờ CHẶN chuyển động: nó là SÀN, không phải vật
// cản. Vai trò của box: registry + height query + debug ("xe rơi ở đâu").
export class CollisionSystem {
    constructor(cellSize = 50) {
        this.cellSize = cellSize;
        this.grid = new Map();
        this.colliders = new Map();
        this.nextId = 1;
    }
    
    _key(cx, cz) { return `${cx},${cz}`; }
    
    _addToGrid(c) {
        const minCX = Math.floor((c.x - c.r) / this.cellSize);
        const maxCX = Math.floor((c.x + c.r) / this.cellSize);
        const minCZ = Math.floor((c.z - c.r) / this.cellSize);
        const maxCZ = Math.floor((c.z + c.r) / this.cellSize);
        
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const k = this._key(cx, cz);
                if (!this.grid.has(k)) this.grid.set(k, []);
                this.grid.get(k).push(c);
            }
        }
    }
    
    _removeFromGrid(c) {
        const minCX = Math.floor((c.x - c.r) / this.cellSize);
        const maxCX = Math.floor((c.x + c.r) / this.cellSize);
        const minCZ = Math.floor((c.z - c.r) / this.cellSize);
        const maxCZ = Math.floor((c.z + c.r) / this.cellSize);
        
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const k = this._key(cx, cz);
                const cell = this.grid.get(k);
                if (cell) {
                    const idx = cell.indexOf(c);
                    if (idx !== -1) cell.splice(idx, 1);
                    if (cell.length === 0) this.grid.delete(k);
                }
            }
        }
    }
    
    register(x, z, r, type = 'static', data = null, y = 0, height = 10) {
        const id = this.nextId++;
        const c = { id, kind: 'circle', x, y, z, r, height, type, data };
        this.colliders.set(id, c);
        this._addToGrid(c);
        return id;
    }

    // Hộp định hướng (driveable surface). heading = atan2(dx, dz)
    // (góc đo từ +Z — đúng convention của road graph/map.js).
    // `halfWidth` = nửa bề rộng (ngang), `halfLength` = nửa chiều
    // dài (dọc trục đường), `height` = bề dày hộp theo Y.
    // Grid dùng AABB bảo thủ (bán kính = nửa đường chéo) nên
    // _addToGrid/_removeFromGrid KHÔNG cần biết loại collider.
    registerBox(x, y, z, halfWidth, halfLength, height, heading = 0, type = 'static', data = null) {
        const id = this.nextId++;
        const cos = Math.cos(heading), sin = Math.sin(heading);
        const ex = halfWidth * Math.abs(cos) + halfLength * Math.abs(sin);
        const ez = halfWidth * Math.abs(sin) + halfLength * Math.abs(cos);
        const c = {
            id, kind: 'box', x, y, z,
            hw: halfWidth, hl: halfLength, height,
            heading, cos, sin,
            r: Math.hypot(ex, ez),   // bán kính grid bảo thủ
            type, data
        };
        this.colliders.set(id, c);
        this._addToGrid(c);
        return id;
    }
    
    update(id, x, z, y = null) {
        const c = this.colliders.get(id);
        if (!c) return;
        
        const movedXZ = Math.abs(c.x - x) > 0.1 || Math.abs(c.z - z) > 0.1;
        if (movedXZ) {
            this._removeFromGrid(c);
            c.x = x;
            c.z = z;
            if (y !== null) c.y = y;
            this._addToGrid(c);
        } else if (y !== null) {
            c.y = y;
        }
    }
    
    remove(id) {
        const c = this.colliders.get(id);
        if (!c) return;
        this._removeFromGrid(c);
        this.colliders.delete(id);
    }
    
    check(x, z, r, excludeId = -1, types = ['static', 'npc'], y = null, height = 10) {
        const minCX = Math.floor((x - r) / this.cellSize);
        const maxCX = Math.floor((x + r) / this.cellSize);
        const minCZ = Math.floor((z - r) / this.cellSize);
        const maxCZ = Math.floor((z + r) / this.cellSize);
        
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const cell = this.grid.get(this._key(cx, cz));
                if (cell) {
                    for (const c of cell) {
                        if (c.id === excludeId || !types.includes(c.type)) continue;

                        const dx = x - c.x;
                        const dz = z - c.z;
                        let hit;
                        if (c.kind === 'box') {
                            // điểm (có bán kính query r) trong hộp định hướng:
                            // trục dọc = (sin, cos), ngang = (cos, -sin)
                            const lAlong = dx * c.sin + dz * c.cos;
                            const lLat = dx * c.cos - dz * c.sin;
                            hit = Math.abs(lAlong) <= c.hl + r &&
                                  Math.abs(lLat) <= c.hw + r;
                        } else {
                            const distSq = dx * dx + dz * dz;
                            const radSum = r + c.r;
                            hit = distSq < radSum * radSum;
                        }

                        if (hit) {
                            // 3D Y/Height Check (cho cầu/viaduct)
                            if (y !== null && c.y !== undefined && c.height !== undefined) {
                                const yMin1 = y - height / 2;
                                const yMax1 = y + height / 2;
                                const yMin2 = c.y - c.height / 2;
                                const yMax2 = c.y + c.height / 2;
                                
                                if (yMax1 < yMin2 || yMin1 > yMax2) continue; // Không chồng lấn Y
                            }
                            return c;
                        }
                    }
                }
            }
        }
        return null;
    }
}