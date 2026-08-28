// js/map/data/roadNetworkData.js - TUYẾN PHÚ YÊN → SÀI GÒN (CÓ NGÃ BA, NGÃ TƯ)
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
    { id: 'phanrang_junction', type: 'junction', position: { x: 520, z: -3400 }, name: 'Ngã tư Phan Rang' },
    { id: 'phanrang_entrance', type: 'rest_stop_entrance', position: { x: 490, z: -3450 }, name: 'Đường vào trạm Phan Rang' },
    { id: 'phanrang_stop', type: 'rest_stop', position: { x: 450, z: -3500 }, name: 'Trạm dừng Phan Rang', size: { width: 130, height: 14, depth: 80 }, parkingSlots: 18 },
    { id: 'phanrang_exit', type: 'rest_stop_exit', position: { x: 490, z: -3550 }, name: 'Đường ra QL1A' },
    // Rẽ vào trung tâm Phan Rang
    { id: 'phanrang_center', type: 'urban_node', position: { x: 480, z: -3700 }, name: 'Trung tâm Phan Rang' },
    // Rẽ ra biển Ninh Thuận
    { id: 'phanrang_beach', type: 'junction', position: { x: 550, z: -3500 }, name: 'Rẽ ra biển Ninh Thuận' },
    // ========== NINH THUẬN - BÌNH THUẬN ==========
    { id: 'binhthuan_1', type: 'highway_node', position: { x: 560, z: -4000 }, name: 'QL1A qua Bình Thuận' },
    { id: 'binhthuan_1_5', type: 'highway_node', position: { x: 590, z: -4300 }, name: 'QL1A uốn cong 4' },
    { id: 'binhthuan_2', type: 'highway_node', position: { x: 620, z: -4600 }, name: 'QL1A đoạn giữa Bình Thuận' },
    // ========== PETROLIMEX - NGÃ BA ==========
    { id: 'petrolimex_junction', type: 'junction', position: { x: 660, z: -5000 }, name: 'Ngã ba Petrolimex' },
    { id: 'petrolimex_entrance', type: 'gas_station_entrance', position: { x: 630, z: -5050 }, name: 'Đường vào cây xăng' },
    { id: 'petrolimex_station', type: 'gas_station', position: { x: 590, z: -5100 }, name: 'Cây xăng Petrolimex Bình Thuận', size: { width: 70, height: 10, depth: 40 }, parkingSlots: 10 },
    { id: 'petrolimex_exit', type: 'gas_station_exit', position: { x: 630, z: -5150 }, name: 'Đường ra QL1A' },
    // Rẽ vào khu công nghiệp
    { id: 'petrolimex_industrial', type: 'urban_node', position: { x: 700, z: -5100 }, name: 'Khu công nghiệp' },
    // ========== CAO TỐC PHAN THIẾT - DẦU GIÂY ==========
    { id: 'caotoc_start', type: 'highway_node', position: { x: 700, z: -5500 }, name: 'Đầu cao tốc Phan Thiết - Dầu Giây' },
    { id: 'caotoc_1', type: 'highway_node', position: { x: 800, z: -6200 }, name: 'Cao tốc đoạn 1' },
    { id: 'caotoc_1_5', type: 'highway_node', position: { x: 850, z: -6550 }, name: 'Cao tốc uốn cong 1' },
    { id: 'caotoc_2', type: 'highway_node', position: { x: 900, z: -6900 }, name: 'Cao tốc đoạn 2' },
    { id: 'caotoc_2_5', type: 'highway_node', position: { x: 950, z: -7250 }, name: 'Cao tốc uốn cong 2' },
    { id: 'caotoc_3', type: 'highway_node', position: { x: 1000, z: -7600 }, name: 'Cao tốc đoạn 3' },
    // ========== TRẠM DỪNG CAO TỐC - NGÃ BA ==========
    { id: 'caotoc_stop_junction', type: 'junction', position: { x: 1050, z: -8000 }, name: 'Ngã ba trạm dừng cao tốc' },
    { id: 'caotoc_stop_entrance', type: 'rest_stop_entrance', position: { x: 1020, z: -8050 }, name: 'Đường vào trạm dừng cao tốc' },
    { id: 'caotoc_stop', type: 'rest_stop', position: { x: 980, z: -8100 }, name: 'Trạm dừng cao tốc (Km47+500)', size: { width: 140, height: 15, depth: 90 }, parkingSlots: 25 },
    { id: 'caotoc_stop_exit', type: 'rest_stop_exit', position: { x: 1020, z: -8150 }, name: 'Đường ra cao tốc' },
    // Rẽ vào khu dịch vụ
    { id: 'caotoc_service', type: 'urban_node', position: { x: 1100, z: -8100 }, name: 'Khu dịch vụ cao tốc' },
    // ========== CAO TỐC TP.HCM ==========
    { id: 'caotoc_hcm_start', type: 'highway_node', position: { x: 1100, z: -8500 }, name: 'Kết nối cao tốc TP.HCM' },
    { id: 'caotoc_hcm_1', type: 'highway_node', position: { x: 1180, z: -9200 }, name: 'Cao tốc TP.HCM đoạn 1' },
    { id: 'caotoc_hcm_1_5', type: 'highway_node', position: { x: 1220, z: -9550 }, name: 'Cao tốc TP.HCM uốn cong' },
    { id: 'caotoc_hcm_2', type: 'highway_node', position: { x: 1260, z: -9900 }, name: 'Cao tốc TP.HCM đoạn 2' },
    // ========== BẾN XE MIỀN ĐÔNG - NGÃ TƯ ==========
    { id: 'mien_dong_junction', type: 'junction', position: { x: 1300, z: -10400 }, name: 'Ngã tư vào bến xe Miền Đông' },
    { id: 'mien_dong_entrance', type: 'bus_station_entrance', position: { x: 1270, z: -10450 }, name: 'Đường vào bến xe' },
    { id: 'mien_dong_station', type: 'bus_station', position: { x: 1230, z: -10500 }, name: 'Bến xe Miền Đông (Sài Gòn)', size: { width: 400, height: 30, depth: 250 }, parkingSlots: 200 },
    { id: 'mien_dong_exit', type: 'bus_station_exit', position: { x: 1270, z: -10550 }, name: 'Đường ra' },
    // Rẽ vào trung tâm Sài Gòn
    { id: 'saigon_center', type: 'urban_node', position: { x: 1350, z: -10600 }, name: 'Trung tâm Sài Gòn' },
    // Rẽ ra sân bay Tân Sơn Nhất (giả)
    { id: 'tan_son_nhat', type: 'urban_node', position: { x: 1250, z: -10800 }, name: 'Sân bay Tân Sơn Nhất' },
    { id: 'end', type: 'end_node', position: { x: 1300, z: -10600 }, name: 'Kết thúc tuyến' }
  ],

  segments: [
    // ===== PHÚ YÊN =====
    { id: 'seg_phuyen_station_to_exit', from: 'phuyen_station', to: 'phuyen_exit', type: 'bus_station_road', width: 12, speed: 30 },
    { id: 'seg_phuyen_entrance_to_station', from: 'phuyen_entrance', to: 'phuyen_station', type: 'bus_station_road', width: 12, speed: 30 },
    { id: 'seg_phuyen_exit_to_ql1a1', from: 'phuyen_exit', to: 'ql1a_1', type: 'highway', width: 20, speed: 80 },
    { id: 'seg_ql1a1_to_ql1a1_5', from: 'ql1a_1', to: 'ql1a_1_5', type: 'highway', width: 20, speed: 80 },
    { id: 'seg_ql1a1_5_to_ql1a2', from: 'ql1a_1_5', to: 'ql1a_2', type: 'highway', width: 20, speed: 80 },
    { id: 'seg_ql1a2_to_ql1a2_5', from: 'ql1a_2', to: 'ql1a_2_5', type: 'highway', width: 20, speed: 80 },
    // ===== ĐẠI LÃNH - NGÃ BA =====
    { id: 'seg_ql1a2_5_to_dailanh_junction', from: 'ql1a_2_5', to: 'dai_lanh_junction', type: 'highway', width: 20, speed: 80 },
    { id: 'seg_dailanh_junction_to_entrance', from: 'dai_lanh_junction', to: 'dai_lanh_entrance', type: 'rest_stop_road', width: 10, speed: 30 },
    { id: 'seg_dailanh_entrance_to_stop', from: 'dai_lanh_entrance', to: 'dai_lanh_stop', type: 'rest_stop_road', width: 10, speed: 20 },
    { id: 'seg_dailanh_stop_to_exit', from: 'dai_lanh_stop', to: 'dai_lanh_exit', type: 'rest_stop_road', width: 10, speed: 20 },
    { id: 'seg_dailanh_exit_to_junction', from: 'dai_lanh_exit', to: 'dai_lanh_junction', type: 'rest_stop_road', width: 10, speed: 30 },
    // Rẽ ra biển
    { id: 'seg_dailanh_junction_to_beach', from: 'dai_lanh_junction', to: 'dai_lanh_beach', type: 'urban', width: 12, speed: 40 },
    // ===== ĐÈO CẢ =====
    { id: 'seg_dailanh_junction_to_deoca_start', from: 'dai_lanh_junction', to: 'deoca_start', type: 'highway', width: 18, speed: 60 },
    { id: 'seg_deoca_start_to_deoca_curve1', from: 'deoca_start', to: 'deoca_curve1', type: 'mountain', width: 14, speed: 40 },
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
    // Rẽ vào khu công nghiệp
    { id: 'seg_petrolimex_junction_to_industrial', from: 'petrolimex_junction', to: 'petrolimex_industrial', type: 'urban', width: 14, speed: 50 },
    // ===== CAO TỐC PHAN THIẾT - DẦU GIÂY =====
    { id: 'seg_petrolimex_junction_to_caotoc_start', from: 'petrolimex_junction', to: 'caotoc_start', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc_start_to_caotoc1', from: 'caotoc_start', to: 'caotoc_1', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc1_to_caotoc1_5', from: 'caotoc_1', to: 'caotoc_1_5', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc1_5_to_caotoc2', from: 'caotoc_1_5', to: 'caotoc_2', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc2_to_caotoc2_5', from: 'caotoc_2', to: 'caotoc_2_5', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc2_5_to_caotoc3', from: 'caotoc_2_5', to: 'caotoc_3', type: 'highway', width: 24, speed: 100 },
    // ===== TRẠM DỪNG CAO TỐC - NGÃ BA =====
    { id: 'seg_caotoc3_to_caotoc_stop_junction', from: 'caotoc_3', to: 'caotoc_stop_junction', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc_stop_junction_to_entrance', from: 'caotoc_stop_junction', to: 'caotoc_stop_entrance', type: 'rest_stop_road', width: 12, speed: 30 },
    { id: 'seg_caotoc_stop_entrance_to_stop', from: 'caotoc_stop_entrance', to: 'caotoc_stop', type: 'rest_stop_road', width: 12, speed: 20 },
    { id: 'seg_caotoc_stop_to_exit', from: 'caotoc_stop', to: 'caotoc_stop_exit', type: 'rest_stop_road', width: 12, speed: 20 },
    { id: 'seg_caotoc_stop_exit_to_junction', from: 'caotoc_stop_exit', to: 'caotoc_stop_junction', type: 'rest_stop_road', width: 12, speed: 30 },
    // Rẽ vào khu dịch vụ
    { id: 'seg_caotoc_stop_junction_to_service', from: 'caotoc_stop_junction', to: 'caotoc_service', type: 'urban', width: 14, speed: 50 },
    // ===== CAO TỐC TP.HCM =====
    { id: 'seg_caotoc_stop_junction_to_caotoc_hcm_start', from: 'caotoc_stop_junction', to: 'caotoc_hcm_start', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc_hcm_start_to_caotoc_hcm1', from: 'caotoc_hcm_start', to: 'caotoc_hcm_1', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc_hcm1_to_caotoc_hcm1_5', from: 'caotoc_hcm_1', to: 'caotoc_hcm_1_5', type: 'highway', width: 24, speed: 100 },
    { id: 'seg_caotoc_hcm1_5_to_caotoc_hcm2', from: 'caotoc_hcm_1_5', to: 'caotoc_hcm_2', type: 'highway', width: 24, speed: 100 },
    // ===== BẾN XE MIỀN ĐÔNG - NGÃ TƯ =====
    { id: 'seg_caotoc_hcm2_to_mien_dong_junction', from: 'caotoc_hcm_2', to: 'mien_dong_junction', type: 'highway', width: 20, speed: 80 },
    { id: 'seg_mien_dong_junction_to_entrance', from: 'mien_dong_junction', to: 'mien_dong_entrance', type: 'bus_station_road', width: 14, speed: 30 },
    { id: 'seg_mien_dong_entrance_to_station', from: 'mien_dong_entrance', to: 'mien_dong_station', type: 'bus_station_road', width: 14, speed: 20 },
    { id: 'seg_mien_dong_station_to_exit', from: 'mien_dong_station', to: 'mien_dong_exit', type: 'bus_station_road', width: 14, speed: 20 },
    { id: 'seg_mien_dong_exit_to_junction', from: 'mien_dong_exit', to: 'mien_dong_junction', type: 'bus_station_road', width: 14, speed: 30 },
    // Rẽ vào trung tâm Sài Gòn
    { id: 'seg_mien_dong_junction_to_saigon_center', from: 'mien_dong_junction', to: 'saigon_center', type: 'urban', width: 16, speed: 50 },
    // Rẽ ra sân bay
    { id: 'seg_mien_dong_junction_to_tan_son_nhat', from: 'mien_dong_junction', to: 'tan_son_nhat', type: 'urban', width: 16, speed: 50 },
    // Kết thúc
    { id: 'seg_mien_dong_junction_to_end', from: 'mien_dong_junction', to: 'end', type: 'urban', width: 16, speed: 50 }
  ],

  pois: [
    { id: 'phuyen_station', type: 'bus_station', position: { x: 0, z: 0 }, name: 'Bến xe Nam Tuy Hòa', size: { width: 180, height: 20, depth: 120 }, parkingSlots: 40 },
    { id: 'dai_lanh_stop', type: 'rest_stop', position: { x: 150, z: -1300 }, name: 'Trạm dừng Đại Lãnh', size: { width: 120, height: 12, depth: 70 }, parkingSlots: 15 },
    { id: 'phanrang_stop', type: 'rest_stop', position: { x: 450, z: -3500 }, name: 'Trạm dừng Phan Rang', size: { width: 130, height: 14, depth: 80 }, parkingSlots: 18 },
    { id: 'petrolimex_station', type: 'gas_station', position: { x: 590, z: -5100 }, name: 'Cây xăng Petrolimex', size: { width: 70, height: 10, depth: 40 }, parkingSlots: 10 },
    { id: 'caotoc_stop', type: 'rest_stop', position: { x: 980, z: -8100 }, name: 'Trạm dừng cao tốc Km47+500', size: { width: 140, height: 15, depth: 90 }, parkingSlots: 25 },
    { id: 'mien_dong_station', type: 'bus_station', position: { x: 1230, z: -10500 }, name: 'Bến xe Miền Đông (Sài Gòn)', size: { width: 400, height: 30, depth: 250 }, parkingSlots: 200 }
  ],

  route: [
    'phuyen_station', 'phuyen_exit',
    'ql1a_1', 'ql1a_1_5', 'ql1a_2', 'ql1a_2_5',
    'dai_lanh_junction',
    'dai_lanh_entrance', 'dai_lanh_stop', 'dai_lanh_exit', 'dai_lanh_junction',
    'deoca_start', 'deoca_curve1', 'tunnel_entrance', 'tunnel_exit', 'deoca_curve2', 'deoca_end',
    'khanhhoa_1', 'khanhhoa_1_5', 'khanhhoa_2',
    'phanrang_junction',
    'phanrang_entrance', 'phanrang_stop', 'phanrang_exit', 'phanrang_junction',
    'binhthuan_1', 'binhthuan_1_5', 'binhthuan_2',
    'petrolimex_junction',
    'petrolimex_entrance', 'petrolimex_station', 'petrolimex_exit', 'petrolimex_junction',
    'caotoc_start', 'caotoc_1', 'caotoc_1_5', 'caotoc_2', 'caotoc_2_5', 'caotoc_3',
    'caotoc_stop_junction',
    'caotoc_stop_entrance', 'caotoc_stop', 'caotoc_stop_exit', 'caotoc_stop_junction',
    'caotoc_hcm_start', 'caotoc_hcm_1', 'caotoc_hcm_1_5', 'caotoc_hcm_2',
    'mien_dong_junction',
    'mien_dong_entrance', 'mien_dong_station', 'mien_dong_exit', 'mien_dong_junction',
    'end'
  ]
};

// Hàm getNode, getSegment, getRouteNodes, getRouteSegments, getPOIs, getTotalRouteLength giữ nguyên như trước
// ...

// Các hàm getNode, getSegment, getRouteNodes, getRouteSegments, getPOIs, getTotalRouteLength giữ nguyên

// Hàm tiện ích lấy node theo id
export function getNode(id) {
  return roadNetwork.nodes.find(n => n.id === id);
}

// Hàm lấy segment giữa hai node
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