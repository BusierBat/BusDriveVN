// js/map/data/roadNetworkData.js - MASSIVE ROAD NETWORK GENERATOR
export const roadProfiles = {
    QL1A: { speed: 80, lanes: 4, width: 24, median: true, shoulder: true, environment: "rural" },
    Expressway: { speed: 120, lanes: 4, width: 28, median: true, shoulder: false, environment: "highway" },
    Urban: { speed: 60, lanes: 4, width: 14, median: false, shoulder: false, environment: "urban" },
    Residential: { speed: 30, lanes: 2, width: 8, median: false, shoulder: false, environment: "residential" },
    StationRoad: { speed: 20, lanes: 1, width: 14, median: false, shoulder: false, environment: "urban" }
};

const rawNodes = [];
const rawSegments = [];

// Helper function to add nodes
function addNode(id, type, x, z, name, size, parkingSlots) {
    rawNodes.push({ id, type, position: { x, z }, name, size, parkingSlots });
}
function addSeg(id, from, to, type, twoWay = true) {
    rawSegments.push({ id, from, to, type, twoWay });
}

// ==========================================
// 1. TUY HÒA CITY GRID (8x8 intersections)
// ==========================================
addNode('th_st', 'bus_station', 0, 0, 'Bến xe Nam Tuy Hòa', { width: 200, height: 50, depth: 150 }, 15);
addNode('th_st_exit', 'junction', 0, -80);
addSeg('s0', 'th_st', 'th_st_exit', 'StationRoad', false);
addSeg('s1', 'th_st_exit', 'th_0_0', 'StationRoad', false);

for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
        addNode(`th_${i}_${j}`, 'intersection', i * 150, -j * 150);
    }
}
// Connect Tuy Hoa grid
for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
        if (i < 7) addSeg(`th_h_${i}_${j}`, `th_${i}_${j}`, `th_${i+1}_${j}`, 'Urban');
        if (j < 7) addSeg(`th_v_${i}_${j}`, `th_${i}_${j}`, `th_${i}_${j+1}`, 'Urban');
    }
}
addNode('th_gas', 'fuel_station', 850, -850, 'Petrolimex Tuy Hòa', { width: 200, height: 40, depth: 100 }, 3);
addSeg('th_gas_1', 'th_5_5', 'th_gas', 'StationRoad');
addNode('th_out', 'highway_junction', 0, -1300, 'Cổng ra Tuy Hòa');
addSeg('th_out_1', 'th_0_8', 'th_out', 'Urban'); // th_0_8 exists from loop (j=8? no, j<8 so max 7. Let's fix)
// Manual fix for grid edge
addNode('th_0_8', 'intersection', 0, -1200);
addSeg('th_v_0_7', 'th_0_7', 'th_0_8', 'Urban');
addSeg('th_out_2', 'th_0_8', 'th_out', 'Urban');

// ==========================================
// 2. QL1A & CAO TỐC (Long Highway)
// ==========================================
let hZ = -1500;
for (let i = 1; i <= 20; i++) {
    let x = Math.sin(i * 0.5) * 200; // Winding road
    addNode(`h_${i}`, 'highway_junction', x, hZ, `QL1A Node ${i}`);
    if (i > 1) addSeg(`h_seg_${i}`, `h_${i-1}`, `h_${i}`, 'QL1A');
    hZ -= 200;
}

// Branch to Expressway
addNode('ct_start', 'highway_junction', 0, -5500, 'Nút giao Cao tốc');
addSeg('h_ct', 'h_20', 'ct_start', 'QL1A');

for (let i = 1; i <= 10; i++) {
    addNode(`ct_${i}`, 'highway_junction', 0, -5500 - (i * 300), `Cao tốc Node ${i}`);
    if (i > 1) addSeg(`ct_seg_${i}`, `ct_${i-1}`, `ct_${i}`, 'Expressway');
}

// Tunnel
addNode('tun_in', 'tunnel_node', 0, -8800, 'Hầm Tuy An (Vào)');
addNode('tun_out', 'tunnel_node', 0, -9000, 'Hầm Tuy An (Ra)');
addSeg('ct_tun1', 'ct_10', 'tun_in', 'Expressway');
addSeg('tun_seg', 'tun_in', 'tun_out', 'Expressway');

// Bridge
addNode('bridge', 'bridge', 0, -9500, 'Cầu Đà Rằng');
addSeg('tun_bridge', 'tun_out', 'bridge', 'QL1A');

// ==========================================
// 3. HCM CITY GRID (10x10 intersections)
// ==========================================
addNode('hcm_in', 'highway_junction', 0, -10500, 'Cổng vào TP.HCM');
addSeg('bridge_hcm', 'bridge', 'hcm_in', 'QL1A');

for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
        addNode(`hcm_${i}_${j}`, 'intersection', i * 120, -10500 - j * 120);
    }
}
// Connect HCM grid
for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
        if (i < 9) addSeg(`hcm_h_${i}_${j}`, `hcm_${i}_${j}`, `hcm_${i+1}_${j}`, 'Urban');
        if (j < 9) addSeg(`hcm_v_${i}_${j}`, `hcm_${i}_${j}`, `hcm_${i}_${j+1}`, 'Urban');
    }
}
addNode('mien_dong_st', 'bus_station', 600, -11700, 'Bến xe Miền Đông mới', { width: 800, height: 150, depth: 600 }, 50);
addSeg('hcm_md', 'hcm_5_5', 'mien_dong_st', 'StationRoad', false);

// ==========================================
// AUTO-GENERATE CONNECTIONS FOR PATHFINDING
// ==========================================
const nodes = rawNodes.map(n => ({ ...n, connections: [] }));
const nodeMap = new Map(nodes.map(n => [n.id, n]));
for (const seg of rawSegments) {
    if (nodeMap.has(seg.from)) nodeMap.get(seg.from).connections.push(seg.id);
    if (seg.twoWay && nodeMap.has(seg.to)) nodeMap.get(seg.to).connections.push(seg.id);
}

export const roadNetwork = { nodes, segments: rawSegments, route: ['th_st', 'th_st_exit', 'th_0_0', 'th_0_8', 'th_out', 'h_1', 'h_20', 'ct_start', 'ct_1', 'ct_10', 'tun_in', 'tun_out', 'bridge', 'hcm_in', 'hcm_0_0', 'hcm_5_5', 'mien_dong_st'] };

export function getNode(id) { return roadNetwork.nodes.find(n => n.id === id); }
export function getRouteNodes() { return roadNetwork.route.map(id => getNode(id)).filter(Boolean); }
export function getRouteSegments() { const r = new Set(roadNetwork.route); return roadNetwork.segments.filter(s => r.has(s.from) && r.has(s.to)); }
export function getJunctions() { return roadNetwork.nodes.filter(n => n.type === 'highway_junction' || n.type === 'intersection' || n.type === 'junction'); }
export function getPOIs() { return roadNetwork.nodes.filter(n => n.type === 'bus_station' || n.type === 'rest_area' || n.type === 'fuel_station' || n.type === 'tunnel_node' || n.type === 'bridge'); }
export function getSpawnPoint() { const st = getNode('th_st'); return { x: st.position.x, z: st.position.z - 50, y: 0.5, heading: 0 }; }
export function getRouteWaypoints() { return getRouteNodes().map(n => ({ id: n.id, x: n.position.x, y: 0, z: n.position.z })); }
export function getMinimapData() { return { segments: roadNetwork.segments.map(s => { const f = getNode(s.from), t = getNode(s.to); return { from: f.position, to: t.position }; }), route: getRouteWaypoints().map(w => ({ x: w.x, z: w.z })), pois: getPOIs().map(p => p.position) }; }
export function getWorldBounds() { return { minX: -2000, maxX: 2000, minZ: -14000, maxZ: 1000 }; }