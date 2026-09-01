// js/minimap.js - CIRCULAR MINIMAP SYSTEM
export class MinimapSystem {
    constructor({ map, bus, scene }) {
        this.map = map;
        this.bus = bus;
        this.scene = scene;
        
        this.canvas = document.createElement('canvas');
        this.canvas.width = 200;
        this.canvas.height = 200;
        this.canvas.style.cssText = 'position:fixed; top:20px; right:20px; width:200px; height:200px; border:2px solid #3b82f6; border-radius:50%; overflow:hidden; z-index:50; pointer-events:none; background:#1e293b;';
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        
        this.roadData = [];
        this.routeData = [];
        this.npcPositions = [];
    }

    setData(roads, route, dest) {
        this.roadData = roads;
        this.routeData = route;
        this.destination = dest;
    }

    updateNPCs(positions) {
        this.npcPositions = positions;
    }

    draw() {
        if (!this.ctx || !this.bus?.group) return;
        const ctx = this.ctx;
        const px = this.bus.group.position.x;
        const pz = this.bus.group.position.z;
        const scale = 0.05; // Zoom level
        
        ctx.clearRect(0, 0, 200, 200);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 200, 200);
        
        // Vẽ Roads (màu xám)
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        for (const seg of this.roadData) {
            const x1 = 100 + (seg.points[0].x - px) * scale;
            const y1 = 100 + (seg.points[0].z - pz) * scale;
            const x2 = 100 + (seg.points[1].x - px) * scale;
            const y2 = 100 + (seg.points[1].z - pz) * scale;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        
        // Vẽ Route (màu xanh dậm, nét to)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 4;
        for (const seg of this.routeData) {
             const x1 = 100 + (seg.points[0].x - px) * scale;
             const y1 = 100 + (seg.points[0].z - pz) * scale;
             const x2 = 100 + (seg.points[1].x - px) * scale;
             const y2 = 100 + (seg.points[1].z - pz) * scale;
             ctx.beginPath();
             ctx.moveTo(x1, y1);
             ctx.lineTo(x2, y2);
             ctx.stroke();
        }

        // Vẽ NPC vehicles (chấm đỏ)
        ctx.fillStyle = '#ef4444';
        for (const npc of this.npcPositions) {
            const x = 100 + (npc.x - px) * scale;
            const y = 100 + (npc.z - pz) * scale;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Vẽ Player (mũi tên trắng)
        ctx.save();
        ctx.translate(100, 100);
        ctx.rotate(-this.bus.group.rotation.y);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-4, 4);
        ctx.lineTo(4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}