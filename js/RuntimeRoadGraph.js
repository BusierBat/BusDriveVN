// js/RuntimeRoadGraph.js
export class RuntimeRoadGraph {
    constructor(data) {
        this.nodes = [];
        this.segments = [];
        this.routes = [];
        this.pois = [];
        
        this._nodeMap = new Map();
        this._segMap = new Map();
        
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
                if(!f || !t) return null;
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