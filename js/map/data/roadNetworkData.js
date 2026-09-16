// js/map/data/roadNetworkData.js
// REBUILD 100% - 3D World Graph Engine & Real Network Topology

export const roadProfiles = {
    urban: { lanes: 4, width: 20, median: false, shoulder: false },
    ql1a: { lanes: 4, width: 24, median: true, medianType: 'green', shoulder: false },
    expressway: { lanes: 4, width: 28, median: true, medianType: 'barrier', shoulder: true, guardrail: true },
    mountain_pass: { lanes: 2, width: 12, median: false, shoulder: false },
    highway_ramp: { lanes: 2, width: 14, median: false, shoulder: false },
    bus_station_road: { lanes: 2, width: 16, median: false, shoulder: false },
    local: { lanes: 2, width: 10, median: false, shoulder: false },
    industrial: { lanes: 2, width: 16, median: false, shoulder: true }
};

// Internal Graph State (Single Source of Truth)
const _graphState = {
    nodes: new Map(),
    segments: new Map(),
    pois: new Map(),
    regions: new Map(),
    routeIds: [],
    initialized: false
};

// World Builder: Verified Route & Real Network Topology
function buildWorldGraph() {
    if (_graphState.initialized) return;
    
    const addNode = (id, type, x, y, z, name, region, extra = {}) => {
        _graphState.nodes.set(id, { 
            id, type, position: { x, y, z }, name, region,
            connections: new Set(), 
            ...extra 
        });
        if (!_graphState.regions.has(region)) _graphState.regions.set(region, { id: region, nodes: new Set() });
        _graphState.regions.get(region).nodes.add(id);
    };
    
    const addSegment = (id, from, to, type, twoWay = true) => {
        const seg = { id, from, to, type, twoWay };
        _graphState.segments.set(id, seg);
        const fNode = _graphState.nodes.get(from);
        const tNode = _graphState.nodes.get(to);
        if (fNode && tNode) {
            fNode.connections.add(id);
            if (twoWay) tNode.connections.add(id);
        }
    };

    // === PHÚ YÊN (Region: phu_yen) ===
    // Y=10.0 (Phẳng, ổn định cho gameplay lái xe đô thị)
    addNode('py_st', 'bus_station', 500, 10.0, 1000, 'Bến xe Nam Tuy Hòa', 'phu_yen', { size: { width: 200, depth: 150 }, parkingSlots: 15 });
    addNode('py_st_exit', 'junction', 450, 10.0, 1000, 'Lối ra Bến xe', 'phu_yen');
    addNode('py_st_entry', 'junction', 550, 10.0, 1000, 'Lối vào Bến xe', 'phu_yen');
    addNode('py_u1', 'intersection', 400, 10.0, 900, 'Ngã tư Trung tâm Tuy Hòa', 'phu_yen');
    addNode('py_u2', 'intersection', 350, 10.0, 700, 'Ngã tư Lê Duẩn', 'phu_yen');
    addNode('py_u3', 'intersection', 450, 10.0, 800, 'Ngã tư Hùng Vương', 'phu_yen');
    addNode('py_u4', 'roundabout', 300, 10.0, 850, 'Vòng xoay Trần Phú', 'phu_yen');
    addNode('py_u5', 'intersection', 400, 10.0, 600, 'Ngã tư Nguyễn Huệ', 'phu_yen');
    addNode('py_res1', 'residential', 500, 10.0, 600, 'KDC Phú Lâm', 'phu_yen');
    addNode('py_res2', 'residential', 250, 10.0, 900, 'KDC Phú Đông', 'phu_yen');
    addNode('py_res3', 'residential', 600, 10.0, 800, 'KDC Tân Đập', 'phu_yen');
    addNode('py_out', 'highway_junction', 400, 10.0, 400, 'Cổng Nam Phú Yên', 'phu_yen');
    addNode('py_coast_1', 'junction', 200, 10.0, 300, 'Đường ven biển', 'phu_yen');
    addNode('py_indus_1', 'industrial', 550, 10.0, 500, 'KCN Hòa Hiệp', 'phu_yen');
    
    addSegment('s_py_st_exit', 'py_st', 'py_st_exit', 'bus_station_road', false);
    addSegment('s_py_st_entry', 'py_st_entry', 'py_st', 'bus_station_road', false);
    addSegment('s_py_exit_u1', 'py_st_exit', 'py_u1', 'urban');
    addSegment('s_py_u1_st_entry', 'py_u1', 'py_st_entry', 'urban');
    addSegment('s_py_u1_u2', 'py_u1', 'py_u2', 'urban');
    addSegment('s_py_u1_u3', 'py_u1', 'py_u3', 'urban');
    addSegment('s_py_u1_u4', 'py_u1', 'py_u4', 'urban');
    addSegment('s_py_u2_u5', 'py_u2', 'py_u5', 'urban');
    addSegment('s_py_u3_u5', 'py_u3', 'py_u5', 'local');
    addSegment('s_py_u3_res1', 'py_u3', 'py_res1', 'local');
    addSegment('s_py_u3_res3', 'py_u3', 'py_res3', 'local');
    addSegment('s_py_u4_res2', 'py_u4', 'py_res2', 'local');
    addSegment('s_py_u4_coast1', 'py_u4', 'py_coast_1', 'local');
    addSegment('s_py_u2_out', 'py_u2', 'py_out', 'urban');
    addSegment('s_py_coast1_out', 'py_coast_1', 'py_out', 'local');
    addSegment('s_py_u5_indus1', 'py_u5', 'py_indus_1', 'industrial');

    // === ĐẠI LÃNH & ĐÈO CẢ (Region: khanh_hoa_mountain) ===
    // Y tăng dần nhưng có giới hạn để không phá physics lái xe
    addNode('dl_junc', 'junction', 400, 15.0, 0, 'Ngã ba Đại Lãnh', 'khanh_hoa_mountain');
    addNode('dc_rest', 'rest_area', 450, 20.0, -50, 'Trạm dừng Đèo Cả', 'khanh_hoa_mountain', { size: { width: 150, depth: 100 }, parkingSlots: 8 });
    addNode('dc_pass_n', 'mountain_pass', 400, 40.0, -300, 'Đỉnh đèo Cả', 'khanh_hoa_mountain');
    addNode('dc_tunnel_in', 'tunnel_node', 400, 35.0, -500, 'Hầm Đèo Cả (Lối vào)', 'khanh_hoa_mountain');
    addNode('dc_tunnel_out', 'tunnel_node', 400, 30.0, -700, 'Hầm Đèo Cả (Lối ra)', 'khanh_hoa_mountain');
    addNode('dc_pass_s', 'mountain_pass', 400, 20.0, -900, 'Nam Đèo Cả', 'khanh_hoa_mountain');
    addNode('dc_bridge', 'bridge', 450, 12.0, -1100, 'Cầu Đà Rằng', 'khanh_hoa_mountain');
    addNode('dc_village_1', 'residential', 300, 25.0, -400, 'Làng chân đèo', 'khanh_hoa_mountain');
    
    addSegment('s_py_out_dl', 'py_out', 'dl_junc', 'ql1a');
    addSegment('s_dl_rest', 'dl_junc', 'dc_rest', 'local');
    addSegment('s_dl_pass_n', 'dl_junc', 'dc_pass_n', 'mountain_pass');
    addSegment('s_pass_n_tun', 'dc_pass_n', 'dc_tunnel_in', 'mountain_pass');
    addSegment('s_tun_in_out', 'dc_tunnel_in', 'dc_tunnel_out', 'tunnel', false);
    addSegment('s_tun_out_pass_s', 'dc_tunnel_out', 'dc_pass_s', 'mountain_pass');
    addSegment('s_pass_s_bridge', 'dc_pass_s', 'dc_bridge', 'ql1a');
    addSegment('s_dl_village1', 'dl_junc', 'dc_village_1', 'local');
    addSegment('s_village1_pass_n', 'dc_village_1', 'dc_pass_n', 'local'); // Cycle/Alternative

    // === KHÁNH HÒA (Region: khanh_hoa) ===
    // Y=10.0 (Trở lại đồng bằng)
    addNode('kh_u1', 'intersection', 400, 10.0, -1500, 'Ngã tư Nha Trang', 'khanh_hoa');
    addNode('kh_u2', 'junction', 450, 10.0, -1700, 'Ngã ba Vạn Ninh', 'khanh_hoa');
    addNode('kh_res1', 'residential', 500, 10.0, -1800, 'KDC Ninh Hòa', 'khanh_hoa');
    addNode('kh_u3', 'intersection', 400, 10.0, -2000, 'Ngã tư Cam Lâm', 'khanh_hoa');
    addNode('kh_gas', 'fuel_station', 450, 10.0, -2100, 'Cây xăng Cam Lâm', 'khanh_hoa', { size: { width: 150, depth: 100 }, parkingSlots: 5 });
    addNode('kh_u4', 'roundabout', 400, 10.0, -2300, 'Vòng xoay Cam Ranh', 'khanh_hoa');
    addNode('kh_u5', 'intersection', 450, 10.0, -2500, 'Ngã tư Phan Rang', 'khanh_hoa');
    addNode('kh_res2', 'residential', 500, 10.0, -2600, 'KDC Phan Rang', 'khanh_hoa');
    addNode('kh_res3', 'residential', 300, 10.0, -1600, 'KDC Vĩnh Hải', 'khanh_hoa');
    addNode('kh_indus_1', 'industrial', 350, 10.0, -2400, 'KCN Cam Ranh', 'khanh_hoa');
    
    addSegment('s_bridge_kh1', 'dc_bridge', 'kh_u1', 'ql1a');
    addSegment('s_kh1_kh2', 'kh_u1', 'kh_u2', 'ql1a');
    addSegment('s_kh2_res1', 'kh_u2', 'kh_res1', 'local');
    addSegment('s_kh1_kh3', 'kh_u1', 'kh_u3', 'ql1a');
    addSegment('s_kh3_gas', 'kh_u3', 'kh_gas', 'local');
    addSegment('s_kh3_kh4', 'kh_u3', 'kh_u4', 'ql1a');
    addSegment('s_kh4_kh5', 'kh_u4', 'kh_u5', 'ql1a');
    addSegment('s_kh5_res2', 'kh_u5', 'kh_res2', 'local');
    addSegment('s_kh1_res3', 'kh_u1', 'kh_res3', 'local');
    addSegment('s_kh4_indus1', 'kh_u4', 'kh_indus_1', 'industrial');
    addSegment('s_kh2_kh4', 'kh_u2', 'kh_u4', 'local'); // Alternative route loop

    // === BÌNH THUẬN (Region: binh_thuan) ===
    addNode('bt_u1', 'junction', 450, 10.0, -3000, 'Ngã ba Phan Thiết', 'binh_thuan');
    addNode('bt_res1', 'residential', 500, 10.0, -3100, 'KDC Hàm Thuận', 'binh_thuan');
    addNode('bt_u2', 'intersection', 400, 10.0, -3500, 'Ngã tư Bắc Bình', 'binh_thuan');
    addNode('bt_res2', 'residential', 300, 10.0, -3200, 'KDC La Gi', 'binh_thuan');
    
    addSegment('s_kh5_bt1', 'kh_u5', 'bt_u1', 'ql1a');
    addSegment('s_bt1_res1', 'bt_u1', 'bt_res1', 'local');
    addSegment('s_bt1_bt2', 'bt_u1', 'bt_u2', 'ql1a');
    addSegment('s_bt1_res2', 'bt_u1', 'bt_res2', 'local');
    addSegment('s_bt_res2_bt2', 'bt_res2', 'bt_u2', 'local'); // Loop

    // === ĐỒNG NAI (Region: dong_nai) ===
    addNode('dn_u1', 'highway_junction', 400, 10.0, -4000, 'Nút giao Dầu Giây', 'dong_nai');
    addNode('dn_u2', 'intersection', 450, 10.0, -4200, 'Ngã tứ Long Khánh', 'dong_nai');
    addNode('dn_indus', 'industrial', 500, 10.0, -4300, 'KCN Đồng Nai', 'dong_nai');
    addNode('dn_u3', 'intersection', 400, 10.0, -4500, 'Ngã tứ Biên Hòa', 'dong_nai');
    addNode('dn_u4', 'junction', 450, 10.0, -4800, 'Ngã ba Thủ Đức', 'dong_nai');
    addNode('dn_res1', 'residential', 300, 10.0, -4100, 'KDC Long Khánh', 'dong_nai');
    
    addSegment('s_bt2_dn1', 'bt_u2', 'dn_u1', 'ql1a');
    addSegment('s_dn1_dn2', 'dn_u1', 'dn_u2', 'urban');
    addSegment('s_dn2_indus', 'dn_u2', 'dn_indus', 'industrial');
    addSegment('s_dn2_dn3', 'dn_u2', 'dn_u3', 'urban');
    addSegment('s_dn3_dn4', 'dn_u3', 'dn_u4', 'urban');
    addSegment('s_dn1_res1', 'dn_u1', 'dn_res1', 'local');

    // === TP.HCM (Region: hcmc) ===
    addNode('sg_u1', 'intersection', 400, 10.0, -5500, 'Ngã tư Xa Lộ Hà Nội', 'hcmc');
    addNode('sg_u2', 'intersection', 450, 10.0, -5800, 'Ngã tứ Hoàng Hữu Nam', 'hcmc');
    addNode('sg_u3', 'roundabout', 400, 10.0, -6000, 'Vòng xoay Long Bình', 'hcmc');
    addNode('sg_u4', 'junction', 450, 10.0, -6200, 'Ngã ba Miền Đông', 'hcmc');
    addNode('sg_md_entry', 'junction', 400, 10.0, -6300, 'Cổng vào Miền Đông', 'hcmc');
    addNode('sg_md', 'bus_station', 450, 10.0, -6500, 'Bến xe Miền Đông Mới', 'hcmc', { size: { width: 500, depth: 350 }, parkingSlots: 50 });
    addNode('sg_md_exit', 'junction', 500, 10.0, -6700, 'Cổng ra Miền Đông', 'hcmc');
    addNode('sg_res1', 'residential', 300, 10.0, -5600, 'KDC Linh Trung', 'hcmc');
    addNode('sg_res2', 'residential', 500, 10.0, -5900, 'KDC Long Bình', 'hcmc');
    
    addSegment('s_dn4_sg1', 'dn_u4', 'sg_u1', 'urban');
    addSegment('s_sg1_sg2', 'sg_u1', 'sg_u2', 'urban');
    addSegment('s_sg2_sg3', 'sg_u2', 'sg_u3', 'urban');
    addSegment('s_sg3_sg4', 'sg_u3', 'sg_u4', 'urban');
    addSegment('s_sg4_md_entry', 'sg_u4', 'sg_md_entry', 'urban');
    addSegment('s_md_entry_md', 'sg_md_entry', 'sg_md', 'bus_station_road', false);
    addSegment('s_md_md_exit', 'sg_md', 'sg_md_exit', 'bus_station_road', false);
    addSegment('s_md_exit_continued', 'sg_md_exit', 'sg_continued', 'urban');
    addSegment('s_sg1_res1', 'sg_u1', 'sg_res1', 'local');
    addSegment('s_sg2_res2', 'sg_u2', 'sg_res2', 'local');
    addSegment('s_sg3_sg1', 'sg_u3', 'sg_u1', 'local'); // Loop

    // === FUTURE EXPANSION ARCHITECTURE (BÌNH DƯƠNG) ===
    addNode('sg_continued', 'intersection', 500, 10.0, -7000, 'Kết nối TP.HCM -> Bình Dương', 'hcmc');
    addNode('bdy_entry', 'highway_junction', 550, 10.0, -7500, 'Cổng vào Bình Dương (Future)', 'binh_duong_future');
    addNode('bdy_phu_chanh', 'industrial', 600, 10.0, -8000, 'CCN Phú Chánh (Future)', 'binh_duong_future');
    addNode('future_end', 'junction', 650, 10.0, -8500, 'Ranh giới mở rộng', 'binh_duong_future');

    addSegment('s_continued_bdy1', 'sg_continued', 'bdy_entry', 'expressway');
    addSegment('s_bdy1_phu_chanh', 'bdy_entry', 'bdy_phu_chanh', 'industrial');
    addSegment('s_phu_chanh_end', 'bdy_phu_chanh', 'future_end', 'local');

    // POIs Setup
    _graphState.nodes.forEach(n => {
        if (n.type === 'bus_station' || n.type === 'fuel_station' || n.type === 'rest_area' || n.type === 'toll_station') {
            _graphState.pois.set(n.id, n);
        }
    });

    _graphState.routeIds = [
        'py_st', 'py_st_exit', 'py_u1', 'py_u2', 'py_out', 'dl_junc', 
        'dc_pass_n', 'dc_tunnel_in', 'dc_tunnel_out', 'dc_pass_s', 'dc_bridge',
        'kh_u1', 'kh_u3', 'kh_u4', 'kh_u5', 'bt_u1', 'bt_u2', 'dn_u1', 'dn_u2', 
        'dn_u3', 'dn_u4', 'sg_u1', 'sg_u2', 'sg_u3', 'sg_u4', 'sg_md_entry', 'sg_md'
    ];

    _graphState.initialized = true;
}

// === API CONTRACT LAYER ===
export const roadNetwork = {
    get nodes() { 
        buildWorldGraph(); 
        return Array.from(_graphState.nodes.values()).map(n => ({ 
            ...n, 
            connections: Array.from(n.connections) 
        })); 
    },
    get segments() { 
        buildWorldGraph(); 
        return Array.from(_graphState.segments.values()); 
    },
    get pois() { 
        buildWorldGraph(); 
        return Array.from(_graphState.pois.values()); 
    },
    get route() { 
        buildWorldGraph(); 
        return _graphState.routeIds; 
    },
    get regions() {
        buildWorldGraph();
        return _graphState.regions;
    }
};

// Dijkstra Pathfinding Algorithm
export function findPath(startNodeId, endNodeId) {
    buildWorldGraph();
    if (!_graphState.nodes.has(startNodeId) || !_graphState.nodes.has(endNodeId)) return null;

    const distances = new Map();
    const previous = new Map();
    const queue = new Set();

    for (const nodeId of _graphState.nodes.keys()) {
        distances.set(nodeId, Infinity);
        previous.set(nodeId, null);
        queue.add(nodeId);
    }
    distances.set(startNodeId, 0);

    while (queue.size > 0) {
        let currentNode = null;
        let minDist = Infinity;
        for (const nodeId of queue) {
            const dist = distances.get(nodeId);
            if (dist < minDist) {
                minDist = dist;
                currentNode = nodeId;
            }
        }

        if (currentNode === null || currentNode === endNodeId) break;
        queue.delete(currentNode);

        const nodeObj = _graphState.nodes.get(currentNode);
        if (!nodeObj) continue;

        for (const segId of nodeObj.connections) {
            const seg = _graphState.segments.get(segId);
            if (!seg) continue;

            const neighborId = seg.from === currentNode ? seg.to : (seg.to === currentNode && seg.twoWay ? seg.from : null);
            if (!neighborId || !queue.has(neighborId)) continue;

            const fromPos = _graphState.nodes.get(currentNode).position;
            const toPos = _graphState.nodes.get(neighborId).position;
            const weight = Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y, toPos.z - fromPos.z);
            const alt = distances.get(currentNode) + weight;

            if (alt < distances.get(neighborId)) {
                distances.set(neighborId, alt);
                previous.set(neighborId, currentNode);
            }
        }
    }

    const path = [];
    let curr = endNodeId;
    while (previous.get(curr) !== null) {
        path.unshift(curr);
        curr = previous.get(curr);
    }
    if (path.length > 0 || startNodeId === endNodeId) {
        path.unshift(startNodeId);
        return path;
    }
    return null;
}

export function getNode(id) {
    buildWorldGraph();
    const n = _graphState.nodes.get(id);
    return n ? { ...n, connections: Array.from(n.connections) } : undefined;
}

export function getRouteNodes() {
    return roadNetwork.route.map(id => getNode(id)).filter(Boolean);
}

export function getRouteSegments() {
    const segments = [];
    const routeArr = roadNetwork.route;
    for (let i = 0; i < routeArr.length - 1; i++) {
        const fromId = routeArr[i], toId = routeArr[i+1];
        const seg = Array.from(_graphState.segments.values()).find(s => 
            (s.from === fromId && s.to === toId) || (s.from === toId && s.to === fromId && s.twoWay)
        );
        if (seg) segments.push(seg);
    }
    return segments;
}

export function getPOIs() { return roadNetwork.pois; }

export function getSpawnPoint() { 
    return { x: 500.4, y: 10.5, z: 1000.1, heading: -Math.PI / 2 }; 
}

export function getRouteWaypoints() { 
    return getRouteNodes().map(n => ({ id: n.id, x: n.position.x, y: n.position.y, z: n.position.z })); 
}

export function getMinimapData() {
    return {
        segments: roadNetwork.segments.map(s => {
            const f = getNode(s.from), t = getNode(s.to);
            return { from: { x: f.position.x, z: f.position.z }, to: { x: t.position.x, z: t.position.z } };
        }),
        route: getRouteWaypoints().map(w => ({ x: w.x, z: w.z })),
        pois: getPOIs().map(p => ({ x: p.position.x, z: p.position.z }))
    };
}

export function getWorldBounds() { return { minX: 0, maxX: 100000, minZ: -100000, maxZ: 10000 }; }

export function getJunctions() {
    buildWorldGraph();
    return roadNetwork.nodes.filter(n => n.connections && n.connections.length > 1);
}

export function getSegmentsByRoadType(type) {
    if (!type) return roadNetwork.segments;
    return roadNetwork.segments.filter(s => s.type === type);
}