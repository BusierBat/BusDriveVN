// js/map/data/roadNetworkData.js - TUYẾN PHÚ YÊN → SÀI GÒN (CÓ NGÃ BA, NGÃ TƯ, ĐƯỜNG PHỤ)
export const roadNetwork = {
nodes: [
// ========== PHÚ YÊN ==========
{ id: 'phuyen_station', type: 'bus_station', position: { x: 0, z: 0 }, name: 'Bến xe Nam Tuy Hòa', size: { width: 180, height: 20, depth: 120 }, parkingSlots: 40 },
{ id: 'phuyen_exit', type: 'junction', position: { x: 80, z: -100 }, name: 'Ngã ba ra QL1A' },
{ id: 'phuyen_entrance', type: 'junction', position: { x: -60, z: -100 }, name: 'Ngã ba vào bến' },
// Đoạn ven biển Phú Yên
{ id: 'ql1a_1', type: 'highway_node', position: { x: 120, z: -400 }, name: 'QL1A đoạn 1' },
{ id: 'ql1a_1_5', type: 'highway_node', position: { x: 160, z: -600 }, name: 'QL1A uốn cong 1' },
{ id: 'ql1a_2', type: 'highway_node', position: { x: 180, z: -800 }, name: 'QL1A đoạn 2' },
{ id: 'ql1a_2_5', type: 'highway_node', position: { x: 200, z: -1000 }, name: 'QL1A uốn cong 2' },
// ========== ĐẠI LÃNH - NGÃ BA ==========
{ id: 'dai_lanh_junction', type: 'junction', position: { x: 220, z: -1200 }, name: 'Ngã ba Đại Lãnh' },
{ id: 'dai_lanh_entrance', type: 'rest_stop_entrance', position: { x: 190, z: -1250 }, name: 'Đường vào trạm Đại Lãnh' },
{ id: 'dai_lanh_stop', type: 'rest_stop', position: { x: 150, z: -1300 }, name: 'Trạm dừng chân Đại Lãnh', size: { width: 120, height: 12, depth: 70 }, parkingSlots: 15 },
{ id: 'dai_lanh_exit', type: 'rest_stop_exit', position: { x: 190, z: -1350 }, name: 'Đường ra QL1A' },
// Rẽ nhánh ra biển (giả lập)
{ id: 'dai_lanh_beach', type: 'junction', position: { x: 250, z: -1250 }, name: 'Rẽ ra biển Đại Lãnh' },
// ========== ĐÈO CẢ ==========
{ id: 'deoca_start', type: 'mountain_node', position: { x: 260, z: -1500 }, name: 'Đầu đèo Cả' },
{ id: 'deoca_curve1', type: 'mountain_node', position: { x: 280, z: -1600 }, name: 'Đèo Cả cua 1' },
{ id: 'tunnel_entrance', type: 'tunnel_node', position: { x: 300, z: -1700 }, name: 'Cổng hầm đèo Cả' },
{ id: 'tunnel_exit', type: 'tunnel_node', position: { x: 340, z: -1900 }, name: 'Cổng hầm đèo Cả (hướng Khánh Hòa)' },
{ id: 'deoca_curve2', type: 'mountain_node', position: { x: 360, z: -2000 }, name: 'Đèo Cả cua 2' },
{ id: 'deoca_end', type: 'mountain_node', position: { x: 380, z: -2100 }, name: 'Cuối đèo Cả' },
// ========== KHÁNH HÒA ==========
{ id: 'khanhhoa_1', type: 'highway_node', position: { x: 420, z: -2500 }, name: 'QL1A qua Khánh Hòa' },
{ id: 'khanhhoa_1_5', type: 'highway_node', position: { x: 450, z: -2750 }, name: 'QL1A uốn cong 3' },
{ id: 'khanhhoa_2', type: 'highway_node', position: { x: 480, z: -3000 }, name: 'QL1A - Ninh Thuận' },
// ========== PHAN RANG - NGÃ TƯ ==========
{ id: 'phanrang_junction', type: 'junction', position: { x: 520, z: -3300 }, name: 'Ngã tư Phan Rang' },
{ id: 'phanrang_entrance', type: 'rest_stop_entrance', position: { x: 500, z: -3350 }, name: 'Đường vào trạm Phan Rang' },
{ id: 'phanrang_stop', type: 'rest_stop', position: { x: 470, z: -3400 }, name: 'Trạm dừng Phan Rang', size: { width: 80, height: 10, depth: 50 } },
{ id: 'phanrang_exit', type: 'rest_stop_exit', position: { x: 500, z: -3450 }, name: 'Đường ra QL1A' },
// Rẽ vào trung tâm Phan Rang
{ id: 'phanrang_center', type: 'urban_node', position: { x: 580, z: -3300 }, name: 'Trung tâm Phan Rang' },
// Rẽ ra biển
{ id: 'phanrang_beach', type: 'urban_node', position: { x: 520, z: -3200 }, name: 'Bãi biển Phan Rang' },
// ========== BÌNH THUẬN ==========
{ id: 'binhthuan_1', type: 'highway_node', position: { x: 620, z: -3800 }, name: 'QL1A Bình Thuận' },
{ id: 'binhthuan_1_5', type: 'highway_node', position: { x: 650, z: -4100 }, name: 'QL1A uốn cong 4' },
{ id: 'binhthuan_2', type: 'highway_node', position: { x: 680, z: -4400 }, name: 'QL1A Bình Thuận 2' },
// ========== PETROLIMEX - NGÃ BA ==========
{ id: 'petrolimex_junction', type: 'junction', position: { x: 700, z: -4700 }, name: 'Ngã ba Petrolimex' },
{ id: 'petrolimex_entrance', type: 'gas_station_entrance', position: { x: 680, z: -4750 }, name: 'Đường vào cây xăng' },
{ id: 'petrolimex_station', type: 'gas_station', position: { x: 650, z: -4800 }, name: 'Cây xăng Petrolimex', size: { width: 45, height: 8, depth: 30 } },
{ id: 'petrolimex_exit', type: 'gas_station_exit', position: { x: 680, z: -4850 }, name: 'Đường ra QL1A' },
// ========== ĐỒNG NAI ==========
{ id: 'dongnai_1', type: 'highway_node', position: { x: 720, z: -5200 }, name: 'QL1A Đồng Nai' },
{ id: 'dongnai_2', type: 'highway_node', position: { x: 750, z: -5600 }, name: 'QL1A Đồng Nai 2' },
{ id: 'dongnai_junction', type: 'junction', position: { x: 780, z: -6000 }, name: 'Ngã ba Đồng Nai' },
// Đường phụ vào khu dân cư
{ id: 'dongnai_residential', type: 'urban_node', position: { x: 820, z: -6050 }, name: 'Khu dân cư Đồng Nai' },
// ========== SÀI GÒN ==========
{ id: 'saigon_approach', type: 'urban_node', position: { x: 800, z: -6400 }, name: 'Khu vực Sài Gòn' },
{ id: 'saigon_junction', type: 'junction', position: { x: 820, z: -6800 }, name: 'Ngã tư Sài Gòn' },
// Đường phụ Sài Gòn
{ id: 'saigon_street1', type: 'urban_node', position: { x: 850, z: -6850 }, name: 'Đường Lê Lợi' },
{ id: 'saigon_street2', type: 'urban_node', position: { x: 790, z: -6850 }, name: 'Đường Nguyễn Huệ' },
{ id: 'saigon_roundabout', type: 'junction', position: { x: 820, z: -7000 }, name: 'Bùng binh Sài Gòn' },
// Bến xe Miền Đông
{ id: 'miendong_entrance', type: 'bus_station_entrance', position: { x: 820, z: -7200 }, name: 'Đường vào bến xe Miền Đông' },
{ id: 'miendong_station', type: 'bus_station', position: { x: 820, z: -7500 }, name: 'Bến xe Miền Đông (Sài Gòn)', size: { width: 300, height: 25, depth: 200 }, parkingSlots: 120 },
],
segments: [
// ===== PHÚ YÊN =====
{ id: 'seg_phuyen_station_to_exit', from: 'phuyen_station', to: 'phuyen_exit', type: 'bus_station_road', width: 10, speed: 20 },
{ id: 'seg_phuyen_exit_to_ql1a1', from: 'phuyen_exit', to: 'ql1a_1', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_ql1a1_to_ql1a1_5', from: 'ql1a_1', to: 'ql1a_1_5', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_ql1a1_5_to_ql1a2', from: 'ql1a_1_5', to: 'ql1a_2', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_ql1a2_to_ql1a2_5', from: 'ql1a_2', to: 'ql1a_2_5', type: 'highway', width: 20, speed: 80 },
// ===== ĐẠI LÃNH =====
{ id: 'seg_ql1a2_5_to_dailanh_junction', from: 'ql1a_2_5', to: 'dai_lanh_junction', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_dailanh_junction_to_entrance', from: 'dai_lanh_junction', to: 'dai_lanh_entrance', type: 'rest_stop_road', width: 10, speed: 30 },
{ id: 'seg_dailanh_entrance_to_stop', from: 'dai_lanh_entrance', to: 'dai_lanh_stop', type: 'rest_stop_road', width: 10, speed: 20 },
{ id: 'seg_dailanh_stop_to_exit', from: 'dai_lanh_stop', to: 'dai_lanh_exit', type: 'rest_stop_road', width: 10, speed: 20 },
{ id: 'seg_dailanh_exit_to_junction', from: 'dai_lanh_exit', to: 'dai_lanh_junction', type: 'rest_stop_road', width: 10, speed: 30 },
// Rẽ ra biển
{ id: 'seg_dailanh_junction_to_beach', from: 'dai_lanh_junction', to: 'dai_lanh_beach', type: 'urban', width: 14, speed: 50 },
// ===== ĐÈO CẢ =====
{ id: 'seg_dailanh_junction_to_deoca_start', from: 'dai_lanh_junction', to: 'deoca_start', type: 'mountain', width: 14, speed: 40 },
{ id: 'seg_deoca_start_to_curve1', from: 'deoca_start', to: 'deoca_curve1', type: 'mountain', width: 14, speed: 40 },
{ id: 'seg_deoca_curve1_to_tunnel_entrance', from: 'deoca_curve1', to: 'tunnel_entrance', type: 'mountain', width: 14, speed: 40 },
{ id: 'seg_tunnel_entrance_to_tunnel_exit', from: 'tunnel_entrance', to: 'tunnel_exit', type: 'tunnel', width: 14, speed: 60 },
{ id: 'seg_tunnel_exit_to_deoca_curve2', from: 'tunnel_exit', to: 'deoca_curve2', type: 'mountain', width: 14, speed: 40 },
{ id: 'seg_deoca_curve2_to_deoca_end', from: 'deoca_curve2', to: 'deoca_end', type: 'mountain', width: 14, speed: 40 },
// ===== KHÁNH HÒA =====
{ id: 'seg_deoca_end_to_khanhhoa1', from: 'deoca_end', to: 'khanhhoa_1', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_khanhhoa1_to_khanhhoa1_5', from: 'khanhhoa_1', to: 'khanhhoa_1_5', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_khanhhoa1_5_to_khanhhoa2', from: 'khanhhoa_1_5', to: 'khanhhoa_2', type: 'highway', width: 20, speed: 80 },
// ===== PHAN RANG - NGÃ TƯ =====
{ id: 'seg_khanhhoa2_to_phanrang_junction', from: 'khanhhoa_2', to: 'phanrang_junction', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_phanrang_junction_to_entrance', from: 'phanrang_junction', to: 'phanrang_entrance', type: 'rest_stop_road', width: 10, speed: 30 },
{ id: 'seg_phanrang_entrance_to_stop', from: 'phanrang_entrance', to: 'phanrang_stop', type: 'rest_stop_road', width: 10, speed: 20 },
{ id: 'seg_phanrang_stop_to_exit', from: 'phanrang_stop', to: 'phanrang_exit', type: 'rest_stop_road', width: 10, speed: 20 },
{ id: 'seg_phanrang_exit_to_junction', from: 'phanrang_exit', to: 'phanrang_junction', type: 'rest_stop_road', width: 10, speed: 30 },
// Rẽ vào trung tâm Phan Rang
{ id: 'seg_phanrang_junction_to_center', from: 'phanrang_junction', to: 'phanrang_center', type: 'urban', width: 14, speed: 50 },
// Rẽ ra biển
{ id: 'seg_phanrang_junction_to_beach', from: 'phanrang_junction', to: 'phanrang_beach', type: 'urban', width: 14, speed: 50 },
// ===== BÌNH THUẬN =====
{ id: 'seg_phanrang_junction_to_binhthuan1', from: 'phanrang_junction', to: 'binhthuan_1', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_binhthuan1_to_binhthuan1_5', from: 'binhthuan_1', to: 'binhthuan_1_5', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_binhthuan1_5_to_binhthuan2', from: 'binhthuan_1_5', to: 'binhthuan_2', type: 'highway', width: 20, speed: 80 },
// ===== PETROLIMEX - NGÃ BA =====
{ id: 'seg_binhthuan2_to_petrolimex_junction', from: 'binhthuan_2', to: 'petrolimex_junction', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_petrolimex_junction_to_entrance', from: 'petrolimex_junction', to: 'petrolimex_entrance', type: 'gas_station_road', width: 10, speed: 30 },
{ id: 'seg_petrolimex_entrance_to_station', from: 'petrolimex_entrance', to: 'petrolimex_station', type: 'gas_station_road', width: 10, speed: 20 },
{ id: 'seg_petrolimex_station_to_exit', from: 'petrolimex_station', to: 'petrolimex_exit', type: 'gas_station_road', width: 10, speed: 20 },
{ id: 'seg_petrolimex_exit_to_junction', from: 'petrolimex_exit', to: 'petrolimex_junction', type: 'gas_station_road', width: 10, speed: 30 },
// ===== ĐỒNG NAI =====
{ id: 'seg_petrolimex_junction_to_dongnai1', from: 'petrolimex_junction', to: 'dongnai_1', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_dongnai1_to_dongnai2', from: 'dongnai_1', to: 'dongnai_2', type: 'highway', width: 20, speed: 80 },
{ id: 'seg_dongnai2_to_dongnai_junction', from: 'dongnai_2', to: 'dongnai_junction', type: 'highway', width: 20, speed: 80 },
// Đường phụ vào khu dân cư
{ id: 'seg_dongnai_junction_to_residential', from: 'dongnai_junction', to: 'dongnai_residential', type: 'urban', width: 14, speed: 50 },
// ===== SÀI GÒN =====
{ id: 'seg_dongnai_junction_to_saigon_approach', from: 'dongnai_junction', to: 'saigon_approach', type: 'urban', width: 14, speed: 50 },
{ id: 'seg_saigon_approach_to_junction', from: 'saigon_approach', to: 'saigon_junction', type: 'urban', width: 14, speed: 50 },
// Đường phố Sài Gòn
{ id: 'seg_saigon_junction_to_street1', from: 'saigon_junction', to: 'saigon_street1', type: 'urban', width: 14, speed: 40 },
{ id: 'seg_saigon_junction_to_street2', from: 'saigon_junction', to: 'saigon_street2', type: 'urban', width: 14, speed: 40 },
{ id: 'seg_saigon_street1_to_roundabout', from: 'saigon_street1', to: 'saigon_roundabout', type: 'urban', width: 14, speed: 40 },
{ id: 'seg_saigon_street2_to_roundabout', from: 'saigon_street2', to: 'saigon_roundabout', type: 'urban', width: 14, speed: 40 },
{ id: 'seg_saigon_roundabout_to_miendong_entrance', from: 'saigon_roundabout', to: 'miendong_entrance', type: 'urban', width: 14, speed: 40 },
{ id: 'seg_miendong_entrance_to_station', from: 'miendong_entrance', to: 'miendong_station', type: 'bus_station_road', width: 10, speed: 20 },
],
route: [
'phuyen_station',
'phuyen_exit',
'ql1a_1',
'ql1a_1_5',
'ql1a_2',
'ql1a_2_5',
'dai_lanh_junction',
'deoca_start',
'deoca_curve1',
'tunnel_entrance',
'tunnel_exit',
'deoca_curve2',
'deoca_end',
'khanhhoa_1',
'khanhhoa_1_5',
'khanhhoa_2',
'phanrang_junction',
'binhthuan_1',
'binhthuan_1_5',
'binhthuan_2',
'petrolimex_junction',
'dongnai_1',
'dongnai_2',
'dongnai_junction',
'saigon_approach',
'saigon_junction',
'saigon_roundabout',
'miendong_entrance',
'miendong_station'
],
pois: [
{ id: 'phuyen_station', type: 'bus_station', name: 'Bến xe Nam Tuy Hòa', position: { x: 0, z: 0 }, size: { width: 180, height: 20, depth: 120 }, parkingSlots: 40 },
{ id: 'dai_lanh_stop', type: 'rest_stop', name: 'Trạm dừng chân Đại Lãnh', position: { x: 150, z: -1300 }, size: { width: 120, height: 12, depth: 70 }, parkingSlots: 15 },
{ id: 'phanrang_stop', type: 'rest_stop', name: 'Trạm dừng Phan Rang', position: { x: 470, z: -3400 }, size: { width: 80, height: 10, depth: 50 } },
{ id: 'petrolimex_station', type: 'gas_station', name: 'Cây xăng Petrolimex', position: { x: 650, z: -4800 }, size: { width: 45, height: 8, depth: 30 } },
{ id: 'miendong_station', type: 'bus_station', name: 'Bến xe Miền Đông (Sài Gòn)', position: { x: 820, z: -7500 }, size: { width: 300, height: 25, depth: 200 }, parkingSlots: 120 },
]
};
export function getNode(id) {
return roadNetwork.nodes.find(n => n.id === id);
}
export function getSegment(fromId, toId) {
return roadNetwork.segments.find(s => (s.from === fromId && s.to === toId) || (s.from === toId && s.to === fromId));
}
// Lấy danh sách các node theo tuyến đường
export function getRouteNodes() {
return roadNetwork.route.map(id => getNode(id)).filter(n => n);
}
// Lấy danh sách segment theo tuyến đường
export function getRouteSegments() {
const segs = [];
const routeIds = roadNetwork.route;
for (let i = 0; i < routeIds.length - 1; i++) {
const seg = getSegment(routeIds[i], routeIds[i+1]);
if (seg) segs.push(seg);
}
return segs;
}
// Lấy danh sách POI
export function getPOIs() {
return roadNetwork.pois;
}
// Tính tổng chiều dài tuyến đường (theo đoạn thẳng giữa các node)
export function getTotalRouteLength() {
const nodes = getRouteNodes();
let total = 0;
for (let i = 0; i < nodes.length - 1; i++) {
const p1 = nodes[i].position;
const p2 = nodes[i+1].position;
total += Math.hypot(p2.x - p1.x, p2.z - p1.z);
}
return total;
}