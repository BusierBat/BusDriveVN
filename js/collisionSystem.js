// js/collisionSystem.js - Hệ thống Collision trung tâm dùng Spatial Grid
export class CollisionSystem {
  constructor(cellSize = 50) {
    this.cellSize = cellSize;
    this.grid = new Map(); // key: "cx,cz" -> array of colliders
    this.colliders = new Map(); // id -> collider
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

  register(x, z, r, type = 'static', data = null) {
    const id = this.nextId++;
    const c = { id, x, z, r, type, data };
    this.colliders.set(id, c);
    this._addToGrid(c);
    return id;
  }

  update(id, x, z) {
    const c = this.colliders.get(id);
    if (!c) return;
    if (Math.abs(c.x - x) > 0.1 || Math.abs(c.z - z) > 0.1) {
      this._removeFromGrid(c);
      c.x = x; c.z = z;
      this._addToGrid(c);
    }
  }

  remove(id) {
    const c = this.colliders.get(id);
    if (!c) return;
    this._removeFromGrid(c);
    this.colliders.delete(id);
  }

  check(x, z, r, excludeId = -1, types = ['static', 'npc']) {
    const minCX = Math.floor((x - r) / this.cellSize);
    const maxCX = Math.floor((x + r) / this.cellSize);
    const minCZ = Math.floor((z - r) / this.cellSize);
    const maxCZ = Math.floor((z + r) / this.cellSize);
    
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const cell = this.grid.get(this._key(cx, cz));
        if (cell) {
          for (const c of cell) {
            if (c.id === excludeId) continue;
            if (!types.includes(c.type)) continue;
            const dx = x - c.x;
            const dz = z - c.z;
            const distSq = dx*dx + dz*dz;
            const radSum = r + c.r;
            if (distSq < radSum * radSum) return c;
          }
        }
      }
    }
    return null;
  }
}