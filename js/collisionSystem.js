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
        
        // Road collision boxes (oriented boxes for driveable surfaces)
        this.roadBoxes = new Map();
        this.roadBoxGrid = new Map();
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
    
    // `filter` (tuy chon): narrow-phase test. Tra ve false -> bo qua collider nay
    // va tiep tim hop hop le ke (dung cho SAT OBB cua xe player). Khong truyen
    // -> hanh vi cu, khong doi voi cac caller khac (NPC van goi nhu truoc).
    check(x, z, r, excludeId = -1, types = ['static', 'npc'], y = null, height = 10, filter = null) {
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
                            if (filter && !filter(c)) continue;   // narrow phase: khong cham that -> bo qua
                            return c;
                        }
                    }
                }
            }
        }
        return null;
    }
    
    // ===== ROAD COLLISION BOXES (oriented boxes for driveable surfaces) =====
    
    // Register a road segment as an oriented box collision
    registerRoadBox(segId, centerX, centerZ, centerY, halfWidth, halfLength, halfHeight, rotationY, roadType, segData = null) {
        const id = `road_${segId}`;
        const cos = Math.cos(rotationY);
        const sin = Math.sin(rotationY);
        
        // Precompute AABB for fast rejection
        const corners = [
            [-halfLength, -halfWidth], [halfLength, -halfWidth], [halfLength, halfWidth], [-halfLength, halfWidth]
        ].map(([lx, lz]) => [
            centerX + lx * cos - lz * sin,
            centerZ + lx * sin + lz * cos
        ]);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const c of corners) {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minZ) minZ = c[1];
            if (c[1] > maxZ) maxZ = c[1];
        }
        
        const box = {
            id,
            segId,
            cx: centerX,
            cy: centerY,
            cz: centerZ,
            hw: halfWidth,
            hl: halfLength,
            hh: halfHeight,
            rotY: rotationY,
            roadType,
            data: segData,
            // Precompute for faster checks
            cos, sin,
            // AABB for fast rejection
            minX, maxX, minZ, maxZ
        };
        
        this.roadBoxes.set(id, box);
        this._addRoadBoxToGrid(box);
        return id;
    }
    
    _addRoadBoxToGrid(box) {
        // Use numeric key for performance: (cx + OFFSET) * 1000000 + (cz + OFFSET)
        const OFFSET = 500000; // covers world bounds
        const gridSize = 128;
        // Use precomputed AABB from box
        const minCX = Math.floor(box.minX / gridSize);
        const maxCX = Math.floor(box.maxX / gridSize);
        const minCZ = Math.floor(box.minZ / gridSize);
        const maxCZ = Math.floor(box.maxZ / gridSize);
        
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const k = (cx + OFFSET) * 1000000 + (cz + OFFSET);
                let arr = this.roadBoxGrid.get(k);
                if (!arr) { arr = []; this.roadBoxGrid.set(k, arr); }
                arr.push(box);
            }
        }
    }
    
    // Check if point (x,z) is inside any road box, return the box with highest Y at that point
    getRoadBoxAt(x, z, yHint = null) {
        const OFFSET = 500000;
        const gridSize = 128;
        const cx = Math.floor(x / gridSize);
        const cz = Math.floor(z / gridSize);
        const k = (cx + OFFSET) * 1000000 + (cz + OFFSET);
        const boxes = this.roadBoxGrid.get(k);
        
        if (!boxes) return null;
        
        let bestBox = null;
        let bestScore = Infinity;
        
        for (const box of boxes) {
            // Fast AABB rejection before oriented box test
            if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
            
            // Transform point to box local space
            const dx = x - box.cx;
            const dz = z - box.cz;
            const lx = dx * box.cos + dz * box.sin;      // along segment
            const lz = -dx * box.sin + dz * box.cos;     // perpendicular to segment
            
            if (Math.abs(lx) <= box.hl && Math.abs(lz) <= box.hw) {
                // Point is inside the box horizontally
                // Calculate surface Y at this point - use segment data if available for accuracy
                let surfaceY;
                if (box.data && box.data.p1 && box.data.p2) {
                    const { p1, p2 } = box.data;
                    const t = (lx + box.hl) / (2 * box.hl); // 0 to 1 along segment
                    surfaceY = lerp(p1.y, p2.y, t);
                } else {
                    const t = (lx + box.hl) / (2 * box.hl); // 0 to 1 along segment
                    surfaceY = box.cy - box.hh + t * (2 * box.hh);
                }
                
                // Score based on Y continuity with yHint
                const score = yHint !== null 
                    ? Math.abs(surfaceY - yHint) + Math.abs(lx) * 0.01 + Math.abs(lz) * 0.01
                    : -surfaceY; // Prefer highest surface when no hint
                
                if (score < bestScore) {
                    bestScore = score;
                    bestBox = box;
                }
            }
        }
        
        return bestBox;
    }
    
    // Get surface Y at (x,z) from road boxes
    getRoadSurfaceY(x, z, yHint = null) {
        const box = this.getRoadBoxAt(x, z, yHint);
        if (!box) return null;
        
        // For more accurate Y, we need the actual segment data
        if (box.data && box.data.p1 && box.data.p2) {
            const { p1, p2 } = box.data;
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const l2 = dx * dx + dz * dz;
            if (l2 > 0) {
                const t = clamp(((x - p1.x) * dx + (z - p1.z) * dz) / l2, 0, 1);
                return lerp(p1.y, p2.y, t);
            }
        }
        return box.cy;
    }
    
    // Clear all road boxes
    clearRoadBoxes() {
        this.roadBoxes.clear();
        this.roadBoxGrid.clear();
    }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }