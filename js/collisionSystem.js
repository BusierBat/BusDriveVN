// js/collisionSystem.js
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
        const c = { id, x, y, z, r, height, type, data };
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
                        const distSq = dx * dx + dz * dz;
                        const radSum = r + c.r;
                        
                        if (distSq < radSum * radSum) {
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