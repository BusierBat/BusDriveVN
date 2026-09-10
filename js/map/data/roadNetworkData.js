// js/map/data/roadNetworkData.js - LOGICAL & EXPANDABLE ROAD NETWORK
export const roadProfiles = {
    urban: { lanes: 4, width: 20, median: false, shoulder: false, env: 'urban' },
    ql1a: { lanes: 4, width: 24, median: true, medianType: 'green', shoulder: false, env: 'mixed' },
    mountain_pass: { lanes: 2, width: 12, median: false, shoulder: false, env: 'mountain' },
    highway_ramp: { lanes: 2, width: 14, median: false, shoulder: false, env: 'highway' },
    expressway: { lanes: 4, width: 28, median: true, medianType: 'barrier', shoulder: true, guardrail: true, env: 'highway' },
    bus_station_road: { lanes: 2, width: 16, median: false, shoulder: false, env: 'station' },
    local: { lanes: 2, width: 10, median: false, shoulder: false, env: 'residential' }
};

export const roadNetwork = {
    nodes: [
        // 1. BẾN XE PHÚ YÊN & NỘI ĐÔ
        { id: 'py_st', type: 'bus_station', position: { x: 67, z: 105 }, name: 'Bến xe Phú Yên', size: { width: 200, depth: 150 }, parkingSlots: 15 },
        { id: 'py_st_exit', type: 'junction', position: { x: 0, z: 105 }, name: 'Lối ra Bến xe' },
        { id: 'py_u1', type: 'intersection', position: { x: 0, z: 0 }, name: 'Ngã tư Trung tâm' },
        { id: 'py_u2', type: 'intersection', position: { x: -20, z: -150 }, name: 'Ngã tư Lê Duẩn' },
        { id: 'py_out', type: 'highway_junction', position: { x: 50, z: -400 }, name: 'Cổng Nam Phú Yên' },

        // 2. ĐẠI LÃNH & ĐÈO CẢ
        { id: 'dl_junc', type: 'junction', position: { x: 50, z: -800 }, name: 'Ngã ba Đại Lãnh' },
        { id: 'dc_rest', type: 'rest_area', position: { x: 120, z: -850 }, name: 'Trạm dừng Đèo Cả', size: { width: 150, depth: 100 }, parkingSlots: 5 },
        { id: 'dc_pass_n', type: 'mountain_pass', position: { x: 80, z: -1100 } },
        { id: 'dc_tunnel_in', type: 'tunnel_node', position: { x: 100, z: -1400 } },
        { id: 'dc_tunnel_out', type: 'tunnel_node', position: { x: 100, z: -1700 } },
        { id: 'dc_pass_s', type: 'mountain_pass', position: { x: 120, z: -1900 } },
        { id: 'dc_bridge', type: 'bridge', position: { x: 150, z: -2100 }, name: 'Cầu Đà Rằng' },

        // 3. ĐƯỜNG DẪN & TRẠM THU PHÍ BẮC
        { id: 'hwy_ramp_n', type: 'highway_ramp', position: { x: 200, z: -2300 }, name: 'Đường dẫn CT Bắc' },
        { id: 'toll_n', type: 'toll_station', position: { x: 250, z: -2500 }, name: 'Trạm thu phí Bắc', size: { width: 100, depth: 40 } },

        // 4. CAO TỐC (Tách biệt hoàn toàn)
        { id: 'exp_1', type: 'highway_junction', position: { x: 300, z: -2700 } },
        { id: 'exp_gas_junc', type: 'highway_ramp', position: { x: 350, z: -3000 }, name: 'Nút ra Cây xăng CT' },
        { id: 'exp_gas', type: 'fuel_station', position: { x: 400, z: -3000 }, name: 'Cây xăng Petrolimex CT', size: { width: 200, depth: 150 }, parkingSlots: 5 },
        { id: 'exp_2', type: 'highway_junction', position: { x: 350, z: -3300 } },
        
        // 5. TRẠM THU PHÍ NAM & NÚT GIAO DẦU GIÂY
        { id: 'toll_s', type: 'toll_station', position: { x: 400, z: -3700 }, name: 'Trạm thu phí Nam', size: { width: 100, depth: 40 } },
        { id: 'hwy_ramp_s', type: 'highway_ramp', position: { x: 450, z: -3900 } },
        { id: 'sg_out', type: 'highway_junction', position: { x: 500, z: -4100 }, name: 'Nút giao Dầu Giây' },

        // 6. ĐÔ THỊ SÀI GÒN
        { id: 'sg_u1', type: 'intersection', position: { x: 550, z: -4400 }, name: 'Ngã tư Xa Lộ Hà Nội' },
        { id: 'sg_u2', type: 'intersection', position: { x: 600, z: -4700 }, name: 'Ngã tư Hoàng Hữu Nam' },
        { id: 'sg_md_entry', type: 'junction', position: { x: 650, z: -5000 }, name: 'Cổng vào Miền Đông' },
        
        // 7. BẾN XE MIỀN ĐÔNG
        { id: 'sg_md', type: 'bus_station', position: { x: 700, z: -5200 }, name: 'Bến xe Miền Đông Mới', size: { width: 500, depth: 350 }, parkingSlots: 50 },
        { id: 'sg_md_exit', type: 'junction', position: { x: 750, z: -5400 }, name: 'Cổng ra Miền Đông' },
        
        // 8. WORLD TIẾP TỤC (Không kết thúc ở bến xe)
        { id: 'sg_u3', type: 'intersection', position: { x: 800, z: -5600 }, name: 'Ngã tư Long Bình' },
        { id: 'sg_continued', type: 'intersection', position: { x: 850, z: -6000 }, name: 'Đi tiếp Trung tâm SG' }
    ],
    segments: [
        { id: 's_py_st_exit', from: 'py_st', to: 'py_st_exit', type: 'bus_station_road', twoWay: false },
        { id: 's_py_exit_u1', from: 'py_st_exit', to: 'py_u1', type: 'urban', twoWay: true },
        { id: 's_py_u1_u2', from: 'py_u1', to: 'py_u2', type: 'urban', twoWay: true },
        { id: 's_py_u2_out', from: 'py_u2', to: 'py_out', type: 'urban', twoWay: true },
        { id: 's_py_out_dl', from: 'py_out', to: 'dl_junc', type: 'ql1a', twoWay: true },
        { id: 's_dl_rest', from: 'dl_junc', to: 'dc_rest', type: 'local', twoWay: true },
        { id: 's_dl_pass_n', from: 'dl_junc', to: 'dc_pass_n', type: 'mountain_pass', twoWay: true },
        { id: 's_pass_n_tun', from: 'dc_pass_n', to: 'dc_tunnel_in', type: 'mountain_pass', twoWay: true },
        { id: 's_tun_in_out', from: 'dc_tunnel_in', to: 'dc_tunnel_out', type: 'tunnel', twoWay: false },
        { id: 's_tun_out_pass_s', from: 'dc_tunnel_out', to: 'dc_pass_s', type: 'mountain_pass', twoWay: true },
        { id: 's_pass_s_bridge', from: 'dc_pass_s', to: 'dc_bridge', type: 'ql1a', twoWay: true },
        { id: 's_bridge_ramp_n', from: 'dc_bridge', to: 'hwy_ramp_n', type: 'ql1a', twoWay: true },
        { id: 's_ramp_n_toll_n', from: 'hwy_ramp_n', to: 'toll_n', type: 'highway_ramp', twoWay: true },
        { id: 's_toll_n_exp1', from: 'toll_n', to: 'exp_1', type: 'expressway', twoWay: true },
        { id: 's_exp1_gas_j', from: 'exp_1', to: 'exp_gas_junc', type: 'expressway', twoWay: true },
        { id: 's_gas_j_gas', from: 'exp_gas_junc', to: 'exp_gas', type: 'highway_ramp', twoWay: true },
        { id: 's_gas_j_exp2', from: 'exp_gas_junc', to: 'exp_2', type: 'expressway', twoWay: true },
        { id: 's_exp2_toll_s', from: 'exp_2', to: 'toll_s', type: 'expressway', twoWay: true },
        { id: 's_toll_s_ramp_s', from: 'toll_s', to: 'hwy_ramp_s', type: 'highway_ramp', twoWay: true },
        { id: 's_ramp_s_sg_out', from: 'hwy_ramp_s', to: 'sg_out', type: 'highway_ramp', twoWay: true },
        { id: 's_sg_out_u1', from: 'sg_out', to: 'sg_u1', type: 'urban', twoWay: true },
        { id: 's_sg_u1_u2', from: 'sg_u1', to: 'sg_u2', type: 'urban', twoWay: true },
        { id: 's_sg_u2_md_entry', from: 'sg_u2', to: 'sg_md_entry', type: 'urban', twoWay: true },
        { id: 's_md_entry_md', from: 'sg_md_entry', to: 'sg_md', type: 'bus_station_road', twoWay: false },
        { id: 's_md_md_exit', from: 'sg_md', to: 'sg_md_exit', type: 'bus_station_road', twoWay: false },
        { id: 's_md_exit_u3', from: 'sg_md_exit', to: 'sg_u3', type: 'urban', twoWay: true },
        { id: 's_u3_continued', from: 'sg_u3', to: 'sg_continued', type: 'urban', twoWay: true }
    ],
    pois: [
        { id: 'py_st', type: 'bus_station', position: { x: 67, z: 105 }, name: 'Bến xe Phú Yên', size: { width: 200, depth: 150 }, parkingSlots: 15 },
        { id: 'dc_rest', type: 'rest_area', position: { x: 120, z: -850 }, name: 'Trạm dừng Đèo Cả', size: { width: 150, depth: 100 }, parkingSlots: 5 },
        { id: 'toll_n', type: 'toll_station', position: { x: 250, z: -2500 }, name: 'Trạm thu phí Bắc', size: { width: 100, depth: 40 } },
        { id: 'exp_gas', type: 'fuel_station', position: { x: 400, z: -3000 }, name: 'Cây xăng Cao tốc', size: { width: 200, depth: 150 }, parkingSlots: 5 },
        { id: 'toll_s', type: 'toll_station', position: { x: 400, z: -3700 }, name: 'Trạm thu phí Nam', size: { width: 100, depth: 40 } },
        { id: 'sg_md', type: 'bus_station', position: { x: 700, z: -5200 }, name: 'Bến xe Miền Đông Mới', size: { width: 500, depth: 350 }, parkingSlots: 50 }
    ],
    route: [ 'py_st', 'py_st_exit', 'py_u1', 'py_u2', 'py_out', 'dl_junc', 'dc_pass_n', 'dc_tunnel_in', 'dc_tunnel_out', 'dc_pass_s', 'dc_bridge', 'hwy_ramp_n', 'toll_n', 'exp_1', 'exp_gas_junc', 'exp_2', 'toll_s', 'hwy_ramp_s', 'sg_out', 'sg_u1', 'sg_u2', 'sg_md_entry', 'sg_md' ]
};

function buildGraph() {
    const nodeMap = new Map(roadNetwork.nodes.map(n => [n.id, n]));
    for (const node of roadNetwork.nodes) node.connections = [];
    for (const seg of roadNetwork.segments) {
        const f = nodeMap.get(seg.from), t = nodeMap.get(seg.to);
        if (f && t) {
            if (!f.connections.includes(seg.id)) f.connections.push(seg.id);
            if (seg.twoWay && !t.connections.includes(seg.id)) t.connections.push(seg.id);
        }
    }
}
buildGraph();

export function getNode(id) { return roadNetwork.nodes.find(n => n.id === id); }
export function getRouteNodes() { return roadNetwork.route.map(id => getNode(id)).filter(Boolean); }
export function getRouteSegments() {
    const segments = [];
    for (let i = 0; i < roadNetwork.route.length - 1; i++) {
        const fromId = roadNetwork.route[i], toId = roadNetwork.route[i+1];
        const seg = roadNetwork.segments.find(s => s.from === fromId && s.to === toId) || roadNetwork.segments.find(s => s.from === toId && s.to === fromId && s.twoWay);
        if (seg) segments.push(seg);
    }
    return segments;
}
export function getPOIs() { return roadNetwork.pois; }
export function getSpawnPoint() { return { x: 67.4, z: 105.1, y: 0.5, heading: -Math.PI / 2 }; }
export function getRouteWaypoints() { return getRouteNodes().map(n => ({ id: n.id, x: n.position.x, y: 0, z: n.position.z })); }
export function getMinimapData() { return { segments: roadNetwork.segments.map(s => { const f = getNode(s.from), t = getNode(s.to); return { from: f.position, to: t.position }; }), route: getRouteWaypoints().map(w => ({ x: w.x, z: w.z })), pois: getPOIs().map(p => p.position) }; }
export function getWorldBounds() { return { minX: -1000, maxX: 1000, minZ: -7000, maxZ: 1000 }; }
export function getJunctions() { return roadNetwork.nodes.filter(n => n.connections && n.connections.length > 1); }