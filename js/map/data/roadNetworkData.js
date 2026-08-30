// js/map/data/roadNetworkData.js
// ⚠️ KHÔNG IMPORT ROAD_TYPES Ở ĐÂY
// roadType trong segments là STRING (vd: 'QL1A'), không phải object

export const roadNetwork = {
    nodes: [
        // ========== PHÚ YÊN ==========
        { id: 'phuyen_station', type: 'bus_station', position: { x: 0, z: 0 }, name: 'Bến xe Nam Tuy Hòa', size: { width: 180, height: 20, depth: 120 }, parkingSlots: 40 },
        { id: 'phuyen_exit', type: 'junction', position: { x: 80, z: -100 }, name: 'Ngã ba ra QL1A' },
        { id: 'phuyen_entrance', type: 'junction', position: { x: -60, z: -100 }, name: 'Ngã ba vào bến' },
        
        // Đoạn ven biển Phú Yên - QL1A 4 LÀN
        { id: 'ql1a_1', type: 'highway_node', position: { x: 120, z: -400 }, name: 'QL1A đoạn 1' },
        { id: 'ql1a_1_5', type: 'highway_node', position: { x: 160, z: -600 }, name: 'QL1A uốn cong 1' },
        { id: 'ql1a_2', type: 'highway_node', position: { x: 180, z: -800 }, name: 'QL1A đoạn 2' },
        { id: 'ql1a_2_5', type: 'highway_node', position: { x: 200, z: -1000 }, name: 'QL1A uốn cong 2' },
        
        // ========== ĐẠI LÃNH - NGÃ BA ==========
        { id: 'dai_lanh_junction', type: 'junction', position: { x: 220, z: -1200 }, name: 'Ngã ba Đại Lãnh' },
        { id: 'dai_lanh_entrance', type: 'rest_stop_entrance', position: { x: 190, z: -1250 }, name: 'Đường vào trạm Đại Lãnh' },
        { id: 'dai_lanh_stop', type: 'rest_stop', position: { x: 150, z: -1300 }, name: 'Trạm dừng chân Đại Lãnh', size: { width: 120, height: 12, depth: 70 }, parkingSlots: 15 },
        { id: 'dai_lanh_exit', type: 'rest_stop_exit', position: { x: 190, z: -1350 }, name: 'Đường ra QL1A' },
        { id: 'dai_lanh_beach', type: 'junction', position: { x: 250, z: -1250 }, name: 'Rẽ ra biển Đại Lãnh' },
        
        // ========== ĐÈO CẢ (ĐƯỜNG NÚI 2 LÀN) ==========
        { id: 'deoca_start', type: 'mountain_node', position: { x: 260, z: -1500 }, name: 'Đầu đèo Cả' },
        { id: 'deoca_curve1', type: 'mountain_node', position: { x: 280, z: -1600 }, name: 'Đèo Cả cua 1' },
        { id: 'tunnel_entrance', type: 'tunnel_node', position: { x: 300, z: -1700 }, name: 'Cổng hầm đèo Cả' },
        { id: 'tunnel_exit', type: 'tunnel_node', position: { x: 340, z: -1900 }, name: 'Cổng hầm đèo Cả (hướng Khánh Hòa)' },
        { id: 'deoca_curve2', type: 'mountain_node', position: { x: 360, z: -2000 }, name: 'Đèo Cả cua 2' },
        { id: 'deoca_end', type: 'mountain_node', position: { x: 380, z: -2100 }, name: 'Cuối đèo Cả' },
        
        // ========== KHÁNH HÒA (QL1A 4 LÀN) ==========
        { id: 'khanhhoa_1', type: 'highway_node', position: { x: 420, z: -2500 }, name: 'QL1A qua Khánh Hòa' },
        { id: 'khanhhoa_1_5', type: 'highway_node', position: { x: 450, z: -2750 }, name: 'QL1A uốn cong 3' },
        { id: 'khanhhoa_2', type: 'highway_node', position: { x: 480, z: -3000 }, name: 'QL1A - Ninh Thuận' },
        
        // ========== PHAN RANG - NGÃ TƯ ==========
        { id: 'phanrang_junction', type: 'junction', position: { x: 520, z: -3400 }, name: 'Ngã tư Phan Rang' },
        { id: 'phanrang_entrance', type: 'rest_stop_entrance', position: { x: 490, z: -3450 }, name: 'Đường vào trạm Phan Rang' },
        { id: 'phanrang_stop', type: 'rest_stop', position: { x: 450, z: -3500 }, name: 'Trạm dừng Phan Rang', size: { width: 130, height: 14, depth: 80 }, parkingSlots: 18 },
        { id: 'phanrang_exit', type: 'rest_stop_exit', position: { x: 490, z: -3550 }, name: 'Đường ra QL1A' },
        { id: 'phanrang_center', type: 'urban_node', position: { x: 480, z: -3700 }, name: 'Trung tâm Phan Rang' },
        { id: 'phanrang_beach', type: 'junction', position: { x: 550, z: -3500 }, name: 'Rẽ ra biển Ninh Thuận' },
        
        // ========== NINH THUẬN - BÌNH THUẬN (QL1A) ==========
        { id: 'binhthuan_1', type: 'highway_node', position: { x: 560, z: -4000 }, name: 'QL1A qua Bình Thuận' },
        { id: 'binhthuan_1_5', type: 'highway_node', position: { x: 590, z: -4300 }, name: 'QL1A uốn cong 4' },
        { id: 'binhthuan_2', type: 'highway_node', position: { x: 620, z: -4600 }, name: 'QL1A đoạn giữa Bình Thuận' },
        
        // ========== PETROLIMEX - NGÃ BA ==========
        { id: 'petrolimex_junction', type: 'junction', position: { x: 660, z: -5000 }, name: 'Ngã ba Petrolimex' },
        { id: 'petrolimex_entrance', type: 'gas_station_entrance', position: { x: 630, z: -5050 }, name: 'Đường vào cây xăng' },
        { id: 'petrolimex_station', type: 'gas_station', position: { x: 590, z: -5100 }, name: 'Cây xăng Petrolimex Bình Thuận', size: { width: 70, height: 10, depth: 40 }, parkingSlots: 10 },
        { id: 'petrolimex_exit', type: 'gas_station_exit', position: { x: 630, z: -5150 }, name: 'Đường ra QL1A' },
        { id: 'petrolimex_industrial', type: 'urban_node', position: { x: 700, z: -5100 }, name: 'Khu công nghiệp' },
        
        // ========== CAO TỐC PHAN THIẾT - DẦU GIÂY ==========
        { id: 'caotoc_start', type: 'highway_node', position: { x: 700, z: -5500 }, name: 'Đầu cao tốc Phan Thiết - Dầu Giây' },
        { id: 'caotoc_1', type: 'highway_node', position: { x: 800, z: -6200 }, name: 'Cao tốc đoạn 1' },
        { id: 'caotoc_1_5', type: 'highway_node', position: { x: 850, z: -6550 }, name: 'Cao tốc uốn cong 1' },
        { id: 'caotoc_2', type: 'highway_node', position: { x: 900, z: -6900 }, name: 'Cao tốc đoạn 2' },
        { id: 'caotoc_2_5', type: 'highway_node', position: { x: 950, z: -7250 }, name: 'Cao tốc uốn cong 2' },
        { id: 'caotoc_3', type: 'highway_node', position: { x: 1000, z: -7600 }, name: 'Cao tốc đoạn 3' },
        
        // ========== TRẠM THU PHÍ ==========
        { id: 'toll_station', type: 'toll_station', position: { x: 1050, z: -8000 }, name: 'Trạm thu phí Dầu Giây', size: { width: 80, height: 12, depth: 30 } },
        
        // ========== SÀI GÒN ==========
        { id: 'saigon_entrance', type: 'junction', position: { x: 1100, z: -8500 }, name: 'Ngã ba vào Sài Gòn' },
        { id: 'saigon_station', type: 'bus_station', position: { x: 1200, z: -9000 }, name: 'Bến xe Miền Đông', size: { width: 200, height: 25, depth: 150 }, parkingSlots: 60 },
    ],
    
    // ===== SEGMENTS: roadType là STRING ID =====
    segments: [
        // === PHÚ YÊN: Bến xe nội bộ ===
        { from: 'phuyen_station', to: 'phuyen_exit', type: 'bus_station_road', roadType: 'STATION_ROAD', width: 8, speed: 20 },
        
        // === QL1A: Phú Yên → Đại Lãnh (4 LÀN) ===
        { from: 'phuyen_exit', to: 'ql1a_1', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'ql1a_1', to: 'ql1a_1_5', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'ql1a_1_5', to: 'ql1a_2', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'ql1a_2', to: 'ql1a_2_5', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'ql1a_2_5', to: 'dai_lanh_junction', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        
        // === ĐẠI LÃNH: Junction + Trạm dừng ===
        { from: 'dai_lanh_junction', to: 'dai_lanh_entrance', type: 'rest_stop_entrance', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        { from: 'dai_lanh_entrance', to: 'dai_lanh_stop', type: 'rest_stop_road', roadType: 'STATION_ROAD', width: 8, speed: 20 },
        { from: 'dai_lanh_stop', to: 'dai_lanh_exit', type: 'rest_stop_exit', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        { from: 'dai_lanh_exit', to: 'dai_lanh_junction', type: 'rest_stop_exit', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        
        // Rẽ ra biển
        { from: 'dai_lanh_junction', to: 'dai_lanh_beach', type: 'road', roadType: 'NORMAL_ROAD', width: 7, speed: 50 },
        
        // === QL1A: Đại Lãnh → Đèo Cả ===
        { from: 'dai_lanh_junction', to: 'deoca_start', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        
        // === ĐÈO CẢ: Đường núi 2 LÀN ===
        { from: 'deoca_start', to: 'deoca_curve1', type: 'mountain', roadType: 'NORMAL_ROAD', width: 7, speed: 40 },
        { from: 'deoca_curve1', to: 'tunnel_entrance', type: 'mountain', roadType: 'NORMAL_ROAD', width: 7, speed: 40 },
        { from: 'tunnel_entrance', to: 'tunnel_exit', type: 'tunnel', roadType: 'NORMAL_ROAD', width: 8, speed: 60 },
        { from: 'tunnel_exit', to: 'deoca_curve2', type: 'mountain', roadType: 'NORMAL_ROAD', width: 7, speed: 40 },
        { from: 'deoca_curve2', to: 'deoca_end', type: 'mountain', roadType: 'NORMAL_ROAD', width: 7, speed: 40 },
        
        // === QL1A: Đèo Cả → Khánh Hòa (4 LÀN) ===
        { from: 'deoca_end', to: 'khanhhoa_1', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'khanhhoa_1', to: 'khanhhoa_1_5', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'khanhhoa_1_5', to: 'khanhhoa_2', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        
        // === PHAN RANG: Junction + Trạm dừng ===
        { from: 'khanhhoa_2', to: 'phanrang_junction', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'phanrang_junction', to: 'phanrang_entrance', type: 'rest_stop_entrance', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        { from: 'phanrang_entrance', to: 'phanrang_stop', type: 'rest_stop_road', roadType: 'STATION_ROAD', width: 8, speed: 20 },
        { from: 'phanrang_stop', to: 'phanrang_exit', type: 'rest_stop_exit', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        { from: 'phanrang_exit', to: 'phanrang_junction', type: 'rest_stop_exit', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        
        // Rẽ vào trung tâm Phan Rang
        { from: 'phanrang_junction', to: 'phanrang_center', type: 'urban', roadType: 'MAJOR_ROAD', width: 14, speed: 50 },
        
        // Rẽ ra biển Ninh Thuận
        { from: 'phanrang_junction', to: 'phanrang_beach', type: 'road', roadType: 'NORMAL_ROAD', width: 7, speed: 50 },
        
        // === QL1A: Phan Rang → Bình Thuận ===
        { from: 'phanrang_junction', to: 'binhthuan_1', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'binhthuan_1', to: 'binhthuan_1_5', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'binhthuan_1_5', to: 'binhthuan_2', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        
        // === PETROLIMEX: Cây xăng ===
        { from: 'binhthuan_2', to: 'petrolimex_junction', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        { from: 'petrolimex_junction', to: 'petrolimex_entrance', type: 'gas_station_entrance', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        { from: 'petrolimex_entrance', to: 'petrolimex_station', type: 'gas_station_road', roadType: 'STATION_ROAD', width: 8, speed: 20 },
        { from: 'petrolimex_station', to: 'petrolimex_exit', type: 'gas_station_exit', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        { from: 'petrolimex_exit', to: 'petrolimex_junction', type: 'gas_station_exit', roadType: 'ACCESS_ROAD', width: 7, speed: 30 },
        
        // Rẽ vào khu công nghiệp
        { from: 'petrolimex_junction', to: 'petrolimex_industrial', type: 'urban', roadType: 'MAJOR_ROAD', width: 14, speed: 50 },
        
        // === QL1A → CAO TỐC ===
        { from: 'petrolimex_junction', to: 'caotoc_start', type: 'highway', roadType: 'QL1A', width: 21, speed: 80 },
        
        // === CAO TỐC: Phan Thiết - Dầu Giây ===
        { from: 'caotoc_start', to: 'caotoc_1', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        { from: 'caotoc_1', to: 'caotoc_1_5', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        { from: 'caotoc_1_5', to: 'caotoc_2', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        { from: 'caotoc_2', to: 'caotoc_2_5', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        { from: 'caotoc_2_5', to: 'caotoc_3', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        
        // === TRẠM THU PHÍ ===
        { from: 'caotoc_3', to: 'toll_station', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        
        // === SÀI GÒN ===
        { from: 'toll_station', to: 'saigon_entrance', type: 'highway', roadType: 'HIGHWAY', width: 22, speed: 120 },
        { from: 'saigon_entrance', to: 'saigon_station', type: 'urban', roadType: 'MAJOR_ROAD', width: 14, speed: 50 },
    ],
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getNode(nodeId) {
    return roadNetwork.nodes.find(n => n.id === nodeId) || null;
}

export function getSegment(fromId, toId) {
    return roadNetwork.segments.find(s =>
        (s.from === fromId && s.to === toId) ||
        (s.from === toId && s.to === fromId)
    ) || null;
}

export function getRouteNodes() {
    const routeIds = [
        'phuyen_station', 'phuyen_exit',
        'ql1a_1', 'ql1a_1_5', 'ql1a_2', 'ql1a_2_5',
        'dai_lanh_junction',
        'deoca_start', 'deoca_curve1', 'tunnel_entrance', 'tunnel_exit', 'deoca_curve2', 'deoca_end',
        'khanhhoa_1', 'khanhhoa_1_5', 'khanhhoa_2',
        'phanrang_junction',
        'binhthuan_1', 'binhthuan_1_5', 'binhthuan_2',
        'petrolimex_junction',
        'caotoc_start', 'caotoc_1', 'caotoc_1_5', 'caotoc_2', 'caotoc_2_5', 'caotoc_3',
        'toll_station',
        'saigon_entrance', 'saigon_station'
    ];
    return routeIds.map(id => getNode(id)).filter(n => n !== null);
}

export function getRouteSegments() {
    const routeNodes = getRouteNodes();
    const segments = [];
    for (let i = 0; i < routeNodes.length - 1; i++) {
        const seg = getSegment(routeNodes[i].id, routeNodes[i + 1].id);
        if (seg) segments.push(seg);
    }
    return segments;
}

export function getTotalRouteLength() {
    const routeSegments = getRouteSegments();
    let total = 0;
    for (const seg of routeSegments) {
        const fromNode = getNode(seg.from);
        const toNode = getNode(seg.to);
        if (fromNode && toNode) {
            total += Math.hypot(
                toNode.position.x - fromNode.position.x,
                toNode.position.z - fromNode.position.z
            );
        }
    }
    return total;
}

export function getPOIs() {
    return roadNetwork.nodes.filter(node =>
        node.type === 'bus_station' ||
        node.type === 'rest_stop' ||
        node.type === 'gas_station' ||
        node.type === 'toll_station'
    );
}

export function getSegmentsByRoadType(roadType) {
    return roadNetwork.segments.filter(s => s.roadType === roadType);
}

export function getJunctions() {
    const junctions = [];
    const nodeConnections = new Map();

    for (const seg of roadNetwork.segments) {
        if (!nodeConnections.has(seg.from)) {
            nodeConnections.set(seg.from, []);
        }
        nodeConnections.get(seg.from).push(seg.to);

        if (!nodeConnections.has(seg.to)) {
            nodeConnections.set(seg.to, []);
        }
        nodeConnections.get(seg.to).push(seg.from);
    }

    for (const [nodeId, connections] of nodeConnections) {
        if (connections.length >= 3) {
            const node = getNode(nodeId);
            if (node) {
                junctions.push({
                    ...node,
                    connections: connections
                });
            }
        }
    }

    return junctions;
}