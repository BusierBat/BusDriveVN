// js/map/data/roadNetworkData.js

export const roadProfiles = {
    urban: { lanes: 4, width: 20, median: false, shoulder: false },
    ql1a: { lanes: 4, width: 24, median: true, medianType: 'green', shoulder: false },
    mountain_pass: { lanes: 2, width: 12, median: false, shoulder: false },
    highway_ramp: { lanes: 2, width: 14, median: false, shoulder: false },
    expressway: { lanes: 4, width: 28, median: true, medianType: 'barrier', shoulder: true, guardrail: true },
    bus_station_road: { lanes: 2, width: 16, median: false, shoulder: false },
    local: { lanes: 2, width: 10, median: false, shoulder: false },
    industrial: { lanes: 2, width: 16, median: false, shoulder: true }
};

export const roadNetwork = {
    nodes: [
        // PHÚ YÊN
        { id: 'py_st', type: 'bus_station', position: { x: 67, z: 105 }, name: 'Bến xe Nam Tuy Hòa', size: { width: 200, depth: 150 }, parkingSlots: 15 },
        { id: 'py_st_exit', type: 'junction', position: { x: 0, z: 105 }, name: 'Lối ra Bến xe' },
        { id: 'py_st_entry', type: 'junction', position: { x: 100, z: 105 }, name: 'Lối vào Bến xe' },
        { id: 'py_u1', type: 'intersection', position: { x: 0, z: 0 }, name: 'Ngã tư Trung tâm' },
        { id: 'py_u2', type: 'intersection', position: { x: -20, z: -150 }, name: 'Ngã tư Lê Duẩn' },
        { id: 'py_u3', type: 'intersection', position: { x: 150, z: -50 }, name: 'Ngã tư Hùng Vương' },
        { id: 'py_u4', type: 'roundabout', position: { x: -150, z: -50 }, name: 'Vòng xoay Trần Phú' },
        { id: 'py_u5', type: 'intersection', position: { x: 50, z: -250 }, name: 'Ngã tư Nguyễn Huệ' },
        { id: 'py_res1', type: 'residential', position: { x: 250, z: -250 }, name: 'KDC Phú Lâm' },
        { id: 'py_res2', type: 'residential', position: { x: -250, z: 250 }, name: 'KDC Phú Đông' },
        { id: 'py_out', type: 'highway_junction', position: { x: 50, z: -400 }, name: 'Cổng Nam Phú Yên' },

        // BÌNH ĐỊNH
        { id: 'bd_u1', type: 'intersection', position: { x: 100, z: -1500 }, name: 'Ngã tư Quy Nhơn' },
        { id: 'bd_u2', type: 'junction', position: { x: 150, z: -1800 }, name: 'Ngã ba Tuy Phước' },
        { id: 'bd_res1', type: 'residential', position: { x: 200, z: -2000 }, name: 'KDC An Nhơn' },
        { id: 'bd_u3', type: 'intersection', position: { x: 80, z: -2200 }, name: 'Ngã tư Phù Cát' },
        { id: 'bd_gas', type: 'fuel_station', position: { x: 120, z: -2300 }, name: 'Cây xăng Phù Cát', size: { width: 150, depth: 100 }, parkingSlots: 5 },

        // ĐẠI LÃNH & ĐÈO CẢ
        { id: 'dl_junc', type: 'junction', position: { x: 50, z: -3000 }, name: 'Ngã ba Đại Lãnh' },
        { id: 'dc_rest', type: 'rest_area', position: { x: 120, z: -3100 }, name: 'Trạm dừng Đèo Cả', size: { width: 150, depth: 100 }, parkingSlots: 8 },
        { id: 'dc_pass_n', type: 'mountain_pass', position: { x: 80, z: -3400 } },
        { id: 'dc_tunnel_in', type: 'tunnel_node', position: { x: 100, z: -3700 } },
        { id: 'dc_tunnel_out', type: 'tunnel_node', position: { x: 100, z: -4000 } },
        { id: 'dc_pass_s', type: 'mountain_pass', position: { x: 120, z: -4200 } },
        { id: 'dc_bridge', type: 'bridge', position: { x: 150, z: -4500 }, name: 'Cầu Đà Rằng' },

        // KHÁNH HÒA
        { id: 'kh_u1', type: 'intersection', position: { x: 200, z: -5000 }, name: 'Ngã tư Nha Trang' },
        { id: 'kh_u2', type: 'junction', position: { x: 250, z: -5500 }, name: 'Ngã ba Vạn Ninh' },
        { id: 'kh_res1', type: 'residential', position: { x: 300, z: -5700 }, name: 'KDC Ninh Hòa' },
        { id: 'kh_u3', type: 'intersection', position: { x: 200, z: -6000 }, name: 'Ngã tư Cam Lâm' },
        { id: 'kh_gas', type: 'fuel_station', position: { x: 280, z: -6200 }, name: 'Cây xăng Cam Lâm', size: { width: 150, depth: 100 }, parkingSlots: 5 },
        { id: 'kh_u4', type: 'roundabout', position: { x: 220, z: -6500 }, name: 'Vòng xoay Cam Ranh' },
        { id: 'kh_u5', type: 'intersection', position: { x: 250, z: -7000 }, name: 'Ngã tư Phan Rang' },
        { id: 'kh_res2', type: 'residential', position: { x: 320, z: -7300 }, name: 'KDC Phan Rang' },

        // BÌNH THUẬN
        { id: 'bt_u1', type: 'junction', position: { x: 230, z: -8000 }, name: 'Ngã ba Phan Thiết' },
        { id: 'bt_res1', type: 'residential', position: { x: 300, z: -8200 }, name: 'KDC Hàm Thuận' },
        { id: 'bt_u2', type: 'intersection', position: { x: 240, z: -9000 }, name: 'Ngã tư Bắc Bình' },

        // ĐỒNG NAI
        { id: 'dn_u1', type: 'highway_junction', position: { x: 300, z: -10000 }, name: 'Nút giao Dầu Giây' },
        { id: 'dn_u2', type: 'intersection', position: { x: 350, z: -10500 }, name: 'Ngã tư Long Khánh' },
        { id: 'dn_indus', type: 'industrial', position: { x: 400, z: -10800 }, name: 'KCN Đồng Nai' },
        { id: 'dn_u3', type: 'intersection', position: { x: 320, z: -11000 }, name: 'Ngã tư Biên Hòa' },
        { id: 'dn_u4', type: 'junction', position: { x: 350, z: -11500 }, name: 'Ngã ba Thủ Đức' },

        // CAO TỐC
        { id: 'hwy_ramp_n', type: 'highway_ramp', position: { x: 400, z: -4500 }, name: 'Đường dẫn CT Bắc' },
        { id: 'toll_n', type: 'toll_station', position: { x: 450, z: -4800 }, name: 'Trạm thu phí Bắc', size: { width: 100, depth: 40 } },
        { id: 'exp_1', type: 'highway_junction', position: { x: 500, z: -5000 } },
        { id: 'exp_gas_junc', type: 'highway_ramp', position: { x: 550, z: -5500 }, name: 'Nút ra Cây xăng CT' },
        { id: 'exp_gas', type: 'fuel_station', position: { x: 600, z: -5500 }, name: 'Cây xăng Petrolimex CT', size: { width: 200, depth: 150 }, parkingSlots: 5 },
        { id: 'exp_2', type: 'highway_junction', position: { x: 550, z: -5800 } },
        { id: 'toll_s', type: 'toll_station', position: { x: 600, z: -6000 }, name: 'Trạm thu phí Nam', size: { width: 100, depth: 40 } },
        { id: 'hwy_ramp_s', type: 'highway_ramp', position: { x: 650, z: -6200 } },

        // TP.HCM
        { id: 'sg_u1', type: 'intersection', position: { x: 400, z: -12500 }, name: 'Ngã tư Xa Lộ Hà Nội' },
        { id: 'sg_u2', type: 'intersection', position: { x: 450, z: -13000 }, name: 'Ngã tư Hoàng Hữu Nam' },
        { id: 'sg_u3', type: 'roundabout', position: { x: 500, z: -13500 }, name: 'Vòng xoay Long Bình' },
        { id: 'sg_u4', type: 'junction', position: { x: 480, z: -14000 }, name: 'Ngã ba Miền Đông' },
        { id: 'sg_md_entry', type: 'junction', position: { x: 520, z: -14200 }, name: 'Cổng vào Miền Đông' },
        { id: 'sg_md', type: 'bus_station', position: { x: 550, z: -14500 }, name: 'Bến xe Miền Đông Mới', size: { width: 500, depth: 350 }, parkingSlots: 50 },
        { id: 'sg_md_exit', type: 'junction', position: { x: 580, z: -14800 }, name: 'Cổng ra Miền Đông' },
        { id: 'sg_continued', type: 'intersection', position: { x: 600, z: -15500 }, name: 'Đi tiếp Trung tâm SG' }
    ],
    segments: [
        // PHÚ YÊN
        { id: 's_py_st_exit', from: 'py_st', to: 'py_st_exit', type: 'bus_station_road', twoWay: false },
        { id: 's_py_st_entry', from: 'py_st_entry', to: 'py_st', type: 'bus_station_road', twoWay: false },
        { id: 's_py_exit_u1', from: 'py_st_exit', to: 'py_u1', type: 'urban', twoWay: true },
        { id: 's_py_u1_st_entry', from: 'py_u1', to: 'py_st_entry', type: 'urban', twoWay: true },
        { id: 's_py_u1_u2', from: 'py_u1', to: 'py_u2', type: 'urban', twoWay: true },
        { id: 's_py_u1_u3', from: 'py_u1', to: 'py_u3', type: 'urban', twoWay: true },
        { id: 's_py_u1_u4', from: 'py_u1', to: 'py_u4', type: 'urban', twoWay: true },
        { id: 's_py_u2_u5', from: 'py_u2', to: 'py_u5', type: 'urban', twoWay: true },
        { id: 's_py_u3_u5', from: 'py_u3', to: 'py_u5', type: 'local', twoWay: true },
        { id: 's_py_u3_res1', from: 'py_u3', to: 'py_res1', type: 'local', twoWay: true },
        { id: 's_py_u4_res2', from: 'py_u4', to: 'py_res2', type: 'local', twoWay: true },
        { id: 's_py_u2_out', from: 'py_u2', to: 'py_out', type: 'urban', twoWay: true },

        // BÌNH ĐỊNH
        { id: 's_py_out_bd1', from: 'py_out', to: 'bd_u1', type: 'ql1a', twoWay: true },
        { id: 's_bd1_bd2', from: 'bd_u1', to: 'bd_u2', type: 'ql1a', twoWay: true },
        { id: 's_bd2_res1', from: 'bd_u2', to: 'bd_res1', type: 'local', twoWay: true },
        { id: 's_bd1_bd3', from: 'bd_u1', to: 'bd_u3', type: 'ql1a', twoWay: true },
        { id: 's_bd3_gas', from: 'bd_u3', to: 'bd_gas', type: 'local', twoWay: true },
        { id: 's_bd3_dl', from: 'bd_u3', to: 'dl_junc', type: 'ql1a', twoWay: true },

        // ĐẠI LÃNH & ĐÈO CẢ
        { id: 's_dl_rest', from: 'dl_junc', to: 'dc_rest', type: 'local', twoWay: true },
        { id: 's_dl_pass_n', from: 'dl_junc', to: 'dc_pass_n', type: 'mountain_pass', twoWay: true },
        { id: 's_pass_n_tun', from: 'dc_pass_n', to: 'dc_tunnel_in', type: 'mountain_pass', twoWay: true },
        { id: 's_tun_in_out', from: 'dc_tunnel_in', to: 'dc_tunnel_out', type: 'tunnel', twoWay: false },
        { id: 's_tun_out_pass_s', from: 'dc_tunnel_out', to: 'dc_pass_s', type: 'mountain_pass', twoWay: true },
        { id: 's_pass_s_bridge', from: 'dc_pass_s', to: 'dc_bridge', type: 'ql1a', twoWay: true },

        // KHÁNH HÒA
        { id: 's_bridge_kh1', from: 'dc_bridge', to: 'kh_u1', type: 'ql1a', twoWay: true },
        { id: 's_kh1_kh2', from: 'kh_u1', to: 'kh_u2', type: 'ql1a', twoWay: true },
        { id: 's_kh2_res1', from: 'kh_u2', to: 'kh_res1', type: 'local', twoWay: true },
        { id: 's_kh1_kh3', from: 'kh_u1', to: 'kh_u3', type: 'ql1a', twoWay: true },
        { id: 's_kh3_gas', from: 'kh_u3', to: 'kh_gas', type: 'local', twoWay: true },
        { id: 's_kh3_kh4', from: 'kh_u3', to: 'kh_u4', type: 'ql1a', twoWay: true },
        { id: 's_kh4_kh5', from: 'kh_u4', to: 'kh_u5', type: 'ql1a', twoWay: true },
        { id: 's_kh5_res2', from: 'kh_u5', to: 'kh_res2', type: 'local', twoWay: true },
        { id: 's_kh5_bt1', from: 'kh_u5', to: 'bt_u1', type: 'ql1a', twoWay: true },

        // BÌNH THUẬN
        { id: 's_bt1_res1', from: 'bt_u1', to: 'bt_res1', type: 'local', twoWay: true },
        { id: 's_bt1_bt2', from: 'bt_u1', to: 'bt_u2', type: 'ql1a', twoWay: true },
        { id: 's_bt2_dn1', from: 'bt_u2', to: 'dn_u1', type: 'ql1a', twoWay: true },

        // ĐỒNG NAI
        { id: 's_dn1_dn2', from: 'dn_u1', to: 'dn_u2', type: 'urban', twoWay: true },
        { id: 's_dn2_indus', from: 'dn_u2', to: 'dn_indus', type: 'industrial', twoWay: true },
        { id: 's_dn2_dn3', from: 'dn_u2', to: 'dn_u3', type: 'urban', twoWay: true },
        { id: 's_dn3_dn4', from: 'dn_u3', to: 'dn_u4', type: 'urban', twoWay: true },
        { id: 's_dn4_sg1', from: 'dn_u4', to: 'sg_u1', type: 'urban', twoWay: true },

        // CAO TỐC
        { id: 's_bridge_ramp_n', from: 'dc_bridge', to: 'hwy_ramp_n', type: 'highway_ramp', twoWay: true },
        { id: 's_ramp_n_toll_n', from: 'hwy_ramp_n', to: 'toll_n', type: 'highway_ramp', twoWay: true },
        { id: 's_toll_n_exp1', from: 'toll_n', to: 'exp_1', type: 'expressway', twoWay: true },
        { id: 's_exp1_gas_j', from: 'exp_1', to: 'exp_gas_junc', type: 'expressway', twoWay: true },
        { id: 's_gas_j_gas', from: 'exp_gas_junc', to: 'exp_gas', type: 'highway_ramp', twoWay: true },
        { id: 's_gas_j_exp2', from: 'exp_gas_junc', to: 'exp_2', type: 'expressway', twoWay: true },
        { id: 's_exp2_toll_s', from: 'exp_2', to: 'toll_s', type: 'expressway', twoWay: true },
        { id: 's_toll_s_ramp_s', from: 'toll_s', to: 'hwy_ramp_s', type: 'highway_ramp', twoWay: true },
        { id: 's_ramp_s_dn1', from: 'hwy_ramp_s', to: 'dn_u1', type: 'highway_ramp', twoWay: true },

        // TP.HCM
        { id: 's_sg1_sg2', from: 'sg_u1', to: 'sg_u2', type: 'urban', twoWay: true },
        { id: 's_sg2_sg3', from: 'sg_u2', to: 'sg_u3', type: 'urban', twoWay: true },
        { id: 's_sg3_sg4', from: 'sg_u3', to: 'sg_u4', type: 'urban', twoWay: true },
        { id: 's_sg4_md_entry', from: 'sg_u4', to: 'sg_md_entry', type: 'urban', twoWay: true },
        { id: 's_md_entry_md', from: 'sg_md_entry', to: 'sg_md', type: 'bus_station_road', twoWay: false },
        { id: 's_md_md_exit', from: 'sg_md', to: 'sg_md_exit', type: 'bus_station_road', twoWay: false },
        { id: 's_md_exit_continued', from: 'sg_md_exit', to: 'sg_continued', type: 'urban', twoWay: true }
    ],
    pois: [
        { id: 'py_st', type: 'bus_station', position: { x: 67, z: 105 }, name: 'Bến xe Nam Tuy Hòa', size: { width: 200, depth: 150 }, parkingSlots: 15 },
        { id: 'dc_rest', type: 'rest_area', position: { x: 120, z: -3100 }, name: 'Trạm dừng Đèo Cả', size: { width: 150, depth: 100 }, parkingSlots: 8 },
        { id: 'toll_n', type: 'toll_station', position: { x: 450, z: -4800 }, name: 'Trạm thu phí Bắc', size: { width: 100, depth: 40 } },
        { id: 'exp_gas', type: 'fuel_station', position: { x: 600, z: -5500 }, name: 'Cây xăng Cao tốc', size: { width: 200, depth: 150 }, parkingSlots: 5 },
        { id: 'toll_s', type: 'toll_station', position: { x: 600, z: -6000 }, name: 'Trạm thu phí Nam', size: { width: 100, depth: 40 } },
        { id: 'bd_gas', type: 'fuel_station', position: { x: 120, z: -2300 }, name: 'Cây xăng Phù Cát', size: { width: 150, depth: 100 }, parkingSlots: 5 },
        { id: 'kh_gas', type: 'fuel_station', position: { x: 280, z: -6200 }, name: 'Cây xăng Cam Lâm', size: { width: 150, depth: 100 }, parkingSlots: 5 },
        { id: 'sg_md', type: 'bus_station', position: { x: 550, z: -14500 }, name: 'Bến xe Miền Đông Mới', size: { width: 500, depth: 350 }, parkingSlots: 50 }
    ],
    route: [
        'py_st', 'py_st_exit', 'py_u1', 'py_u2', 'py_out', 'bd_u1', 'bd_u3', 'dl_junc', 'dc_pass_n', 'dc_tunnel_in', 'dc_tunnel_out', 'dc_pass_s', 'dc_bridge',
        'kh_u1', 'kh_u3', 'kh_u4', 'kh_u5', 'bt_u1', 'bt_u2', 'dn_u1', 'dn_u2', 'dn_u3', 'dn_u4', 'sg_u1', 'sg_u2', 'sg_u3', 'sg_u4', 'sg_md_entry', 'sg_md'
    ]
};

let _graphInitialized = false;
function buildGraph() {
    if (_graphInitialized) return;
    const nodeMap = new Map(roadNetwork.nodes.map(n => [n.id, n]));
    for (const node of roadNetwork.nodes) node.connections = new Set();
    for (const seg of roadNetwork.segments) {
        const f = nodeMap.get(seg.from), t = nodeMap.get(seg.to);
        if (f && t) {
            f.connections.add(seg.id);
            if (seg.twoWay) t.connections.add(seg.id);
        }
    }
    for (const node of roadNetwork.nodes) {
        node.connections = Array.from(node.connections);
    }
    _graphInitialized = true;
}

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
export function getMinimapData() {
    return {
        segments: roadNetwork.segments.map(s => {
            const f = getNode(s.from), t = getNode(s.to);
            return { from: f.position, to: t.position };
        }),
        route: getRouteWaypoints().map(w => ({ x: w.x, z: w.z })),
        pois: getPOIs().map(p => p.position)
    };
}
export function getWorldBounds() { return { minX: -1000, maxX: 1500, minZ: -16000, maxZ: 1000 }; }
export function getJunctions() {
    if (!_graphInitialized) buildGraph();
    return roadNetwork.nodes.filter(n => n.connections && n.connections.length > 1);
}
export function getSegmentsByRoadType(type) {
    if (!type) return roadNetwork.segments;
    return roadNetwork.segments.filter(s => s.type === type);
}