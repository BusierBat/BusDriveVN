// js/map/data/roadNetworkData.js - ROAD NETWORK GRAPH (DATA-DRIVEN, DIRECTIONAL, ADVANCED)
// Scale: 1 Unit = 10 meters. Tọa độ (0,0) là Trung tâm Thành phố Phú Yên.

// ===== ROAD PROFILES (Mặc định cho các loại đường) =====
export const roadProfiles = {
    highway: { speed: 120, lanes: 4, width: 24, median: true, shoulder: true, motorcycleAllowed: false, environment: "highway", trafficDensity: 0.5 },
    expressway: { speed: 120, lanes: 4, width: 24, median: true, shoulder: true, motorcycleAllowed: false, environment: "highway", trafficDensity: 0.6 },
    national_highway: { speed: 80, lanes: 2, width: 20, median: false, shoulder: true, motorcycleAllowed: true, environment: "suburban", trafficDensity: 0.8 },
    arterial: { speed: 60, lanes: 4, width: 20, median: true, shoulder: false, motorcycleAllowed: true, environment: "urban", trafficDensity: 0.7 },
    collector: { speed: 50, lanes: 2, width: 16, median: false, shoulder: false, motorcycleAllowed: true, environment: "urban", trafficDensity: 0.6 },
    local: { speed: 40, lanes: 2, width: 12, median: false, shoulder: false, motorcycleAllowed: true, environment: "residential", trafficDensity: 0.4 },
    residential: { speed: 30, lanes: 2, width: 10, median: false, shoulder: false, motorcycleAllowed: true, environment: "residential", trafficDensity: 0.3 },
    rural: { speed: 60, lanes: 2, width: 14, median: false, shoulder: true, motorcycleAllowed: true, environment: "rural", trafficDensity: 0.35 },
    coastal: { speed: 80, lanes: 2, width: 20, median: false, shoulder: true, motorcycleAllowed: true, environment: "coastal", trafficDensity: 0.6 },
    mountain_pass: { speed: 40, lanes: 1, width: 15, median: false, shoulder: false, motorcycleAllowed: true, environment: "mountain", trafficDensity: 0.5 },
    tunnel: { speed: 60, lanes: 1, width: 15, median: false, shoulder: false, motorcycleAllowed: true, environment: "tunnel", trafficDensity: 0.7 },
    service: { speed: 30, lanes: 1, width: 8, median: false, shoulder: false, motorcycleAllowed: true, environment: "service", trafficDensity: 0.2 },
    bus_station_road: { speed: 20, lanes: 1, width: 14, median: false, shoulder: false, motorcycleAllowed: false, environment: "urban", trafficDensity: 0.8 }
};

export const roadNetwork = {
    // ===== NODES =====
    nodes: [
        // ====== THÀNH PHỐ PHÚ YÊN (Z=0) ======
        { id: 'py_c', type: 'intersection', position: { x: 0, z: 0 }, name: 'Ngã tư Trung tâm Tuy Hòa', region: 'PhuYen', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 30, yellow: 4, green: 35 }, offset: 0 } } },
        { id: 'py_n', type: 'intersection', position: { x: 0, z: -1600 }, name: 'Ngã tư Bắc', region: 'PhuYen', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 25, yellow: 3, green: 40 }, offset: 5 } } },
        { id: 'py_s', type: 'intersection', position: { x: 0, z: 1600 }, name: 'Ngã tư Nam', region: 'PhuYen', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 30, yellow: 4, green: 35 }, offset: 10 } } },
        { id: 'py_e', type: 'intersection', position: { x: 1600, z: 0 }, name: 'Ngã tư Đông', region: 'PhuYen', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 30, yellow: 4, green: 35 }, offset: 15 } } },
        { id: 'py_w', type: 'intersection', position: { x: -1600, z: 0 }, name: 'Ngã tư Tây', region: 'PhuYen', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 30, yellow: 4, green: 35 }, offset: 20 } } },
        // Vòng 1
        { id: 'py_ne', type: 'junction', position: { x: 1600, z: -1600 }, name: 'Khu NE', region: 'PhuYen', environment: 'residential' },
        { id: 'py_se', type: 'junction', position: { x: 1600, z: 1600 }, name: 'Khu SE', region: 'PhuYen', environment: 'residential' },
        { id: 'py_nw', type: 'junction', position: { x: -1600, z: -1600 }, name: 'Khu NW', region: 'PhuYen', environment: 'residential' },
        { id: 'py_sw', type: 'junction', position: { x: -1600, z: 1600 }, name: 'Khu SW', region: 'PhuYen', environment: 'residential' },
        // Vòng 2
        { id: 'py_n2', type: 'roundabout', position: { x: 0, z: -3200 }, name: 'Vòng đai Bắc', region: 'PhuYen', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'py_s2', type: 'roundabout', position: { x: 0, z: 3200 }, name: 'Vòng đai Nam', region: 'PhuYen', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'py_e2', type: 'roundabout', position: { x: 3200, z: 0 }, name: 'Vòng đai Đông', region: 'PhuYen', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'py_w2', type: 'roundabout', position: { x: -3200, z: 0 }, name: 'Vòng đai Tây', region: 'PhuYen', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        // Vòng 3
        { id: 'py_n3', type: 'city_exit', position: { x: 0, z: -4800 }, name: 'Cổng Bắc PY', region: 'PhuYen', environment: 'suburban' },
        { id: 'py_s3', type: 'city_exit', position: { x: 0, z: 4800 }, name: 'Cổng Nam PY', region: 'PhuYen', environment: 'suburban' },
        { id: 'py_e3', type: 'city_exit', position: { x: 4800, z: 0 }, name: 'Cổng Đông PY', region: 'PhuYen', environment: 'suburban' },
        { id: 'py_w3', type: 'city_exit', position: { x: -4800, z: 0 }, name: 'Cổng Tây PY', region: 'PhuYen', environment: 'suburban' },
        // Khu dân cư
        { id: 'py_res1', type: 'residential', position: { x: 2400, z: -2400 }, name: 'KDC Phú Lâm', region: 'PhuYen', environment: 'residential' },
        { id: 'py_res2', type: 'residential', position: { x: -2400, z: 2400 }, name: 'KDC Phú Đông', region: 'PhuYen', environment: 'residential' },
        { id: 'py_res3', type: 'residential', position: { x: 2400, z: 2400 }, name: 'KDC Phú Tây', region: 'PhuYen', environment: 'residential' },
        { id: 'py_res4', type: 'residential', position: { x: -2400, z: -2400 }, name: 'KDC Phú Bắc', region: 'PhuYen', environment: 'residential' },
        // Bến xe
        { id: 'py_st', type: 'bus_station', position: { x: 400, z: 800 }, name: 'Bến xe Nam Tuy Hòa', region: 'PhuYen', environment: 'urban', busStation: { platforms: 8, parkingSlots: 40, passengerSpawnRate: 0.7 } },
        { id: 'py_stj', type: 'junction', position: { x: 0, z: 800 }, name: 'Ngã ba vào Bến xe', region: 'PhuYen', environment: 'urban' },

        // ====== CAO TỐC BẮC (Z=-4000 -> -16000) ======
        { id: 'hwy_n_1', type: 'highway_junction', position: { x: 0, z: -4000 }, name: 'Nút giao CTB 1', region: 'PhuYen', environment: 'highway' },
        { id: 'hwy_n_2', type: 'highway_merge', position: { x: 800, z: -8000 }, name: 'Trạm thu phí Bắc', region: 'BinhDinh', environment: 'highway' },
        { id: 'hwy_n_3', type: 'highway_split', position: { x: 800, z: -12000 }, name: 'Nút giao CTB 2', region: 'BinhDinh', environment: 'highway' },
        { id: 'hwy_n_4', type: 'highway_junction', position: { x: 1600, z: -16000 }, name: 'Nút giao QL1A Bắc', region: 'BinhDinh', environment: 'highway' },
        { id: 'rs_n1', type: 'rest_area', position: { x: 400, z: -6000 }, name: 'Trạm dừng Bắc 1', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 15 },
        { id: 'rs_n2', type: 'rest_area', position: { x: 1200, z: -10000 }, name: 'Trạm dừng Bắc 2', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 15 },
        { id: 'res_n1', type: 'residential', position: { x: 2400, z: -6000 }, name: 'KDC Cao tốc Bắc 1', environment: 'rural' },
        { id: 'res_n2', type: 'residential', position: { x: 2400, z: -12000 }, name: 'KDC Cao tốc Bắc 2', environment: 'rural' },

        // ====== QL1A NAM -> ĐÔNG HÒA -> ĐÈO CẢ (Z=4000 -> 32000) ======
        { id: 'hwy_s_1', type: 'highway_junction', position: { x: 0, z: 4000 }, name: 'Nút giao PY Nam', region: 'PhuYen', environment: 'highway' },
        { id: 'hwy_s_2', type: 'highway_junction', position: { x: 800, z: 8000 }, name: 'Đông Hòa', region: 'PhuYen', environment: 'suburban' },
        { id: 'hwy_s_3', type: 'junction', position: { x: 1600, z: 12000 }, name: 'Vạn Ninh', region: 'KhanhHoa', environment: 'coastal' },
        { id: 'hwy_s_4', type: 'highway_junction', position: { x: 1600, z: 16000 }, name: 'Cửa Bắc Đèo Cả', region: 'KhanhHoa', environment: 'mountain' },
        { id: 'res_s1', type: 'residential', position: { x: 2400, z: 6000 }, name: 'KDC Đông Hòa 1', environment: 'rural' },
        { id: 'res_s2', type: 'residential', position: { x: 2400, z: 10000 }, name: 'KDC Vạn Ninh 1', environment: 'coastal' },
        { id: 'res_s3', type: 'residential', position: { x: 3200, z: 14000 }, name: 'KDC Vạn Ninh 2', environment: 'mountain' },
        { id: 'rs_s1', type: 'rest_area', position: { x: 400, z: 6000 }, name: 'Trạm dừng Nam 1', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 15 },
        { id: 'gs_s1', type: 'fuel_station', position: { x: 1200, z: 10000 }, name: 'Cây xăng Vạn Ninh', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },

        // ====== ĐÈO CẢ TUNNEL (Z=20000 -> 28000) ======
        { id: 'deoca_in', type: 'tunnel_node', position: { x: 1600, z: 20000 }, name: 'Hầm Đèo Cả (Vào)', region: 'KhanhHoa', environment: 'tunnel' },
        { id: 'deoca_out', type: 'tunnel_node', position: { x: 1600, z: 28000 }, name: 'Hầm Đèo Cả (Ra)', region: 'KhanhHoa', environment: 'tunnel' },
        { id: 'deoca_s', type: 'highway_junction', position: { x: 1600, z: 32000 }, name: 'Cửa Nam Đèo Cả', region: 'KhanhHoa', environment: 'mountain' },
        { id: 'rs_dc1', type: 'rest_area', position: { x: 2000, z: 30000 }, name: 'Trạm dừng sau Đèo Cả', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 20 },

        // ====== THÀNH PHỐ NHA TRANG (Z=40000) ======
        { id: 'nt_w', type: 'highway_junction', position: { x: 1600, z: 40000 }, name: 'Tây Nha Trang', region: 'KhanhHoa', environment: 'urban' },
        { id: 'nt_c', type: 'intersection', position: { x: 2400, z: 40000 }, name: 'Trung tâm Nha Trang', region: 'KhanhHoa', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 40, yellow: 5, green: 30 }, offset: 0 } } },
        { id: 'nt_e', type: 'junction', position: { x: 3200, z: 40000 }, name: 'Biển Nha Trang', region: 'KhanhHoa', environment: 'coastal' },
        { id: 'nt_n', type: 'junction', position: { x: 2400, z: 38400 }, name: 'Bắc Nha Trang', region: 'KhanhHoa', environment: 'urban' },
        { id: 'nt_s', type: 'junction', position: { x: 2400, z: 41600 }, name: 'Nam Nha Trang', region: 'KhanhHoa', environment: 'urban' },
        { id: 'nt_ne', type: 'junction', position: { x: 3200, z: 38400 }, name: 'Khu NE NT', region: 'KhanhHoa', environment: 'residential' },
        { id: 'nt_se', type: 'junction', position: { x: 3200, z: 41600 }, name: 'Khu SE NT', region: 'KhanhHoa', environment: 'residential' },
        { id: 'nt_nw', type: 'junction', position: { x: 1600, z: 38400 }, name: 'Khu NW NT', region: 'KhanhHoa', environment: 'residential' },
        { id: 'nt_sw', type: 'junction', position: { x: 1600, z: 41600 }, name: 'Khu SW NT', region: 'KhanhHoa', environment: 'residential' },
        { id: 'nt_n2', type: 'roundabout', position: { x: 2400, z: 36800 }, name: 'Vòng đai Bắc NT', region: 'KhanhHoa', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'nt_s2', type: 'roundabout', position: { x: 2400, z: 43200 }, name: 'Vòng đai Nam NT', region: 'KhanhHoa', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'nt_e2', type: 'roundabout', position: { x: 4000, z: 40000 }, name: 'Vòng đai Đông NT', region: 'KhanhHoa', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'nt_w2', type: 'roundabout', position: { x: 800, z: 40000 }, name: 'Vòng đai Tây NT', region: 'KhanhHoa', environment: 'urban', intersection: { type: 'roundabout', yield: true } },
        { id: 'nt_n3', type: 'city_exit', position: { x: 2400, z: 35200 }, name: 'Cổng Bắc NT', region: 'KhanhHoa', environment: 'suburban' },
        { id: 'nt_s3', type: 'city_exit', position: { x: 2400, z: 44800 }, name: 'Cổng Nam NT', region: 'KhanhHoa', environment: 'suburban' },
        { id: 'nt_e3', type: 'city_exit', position: { x: 4800, z: 40000 }, name: 'Cổng Đông NT', region: 'KhanhHoa', environment: 'suburban' },
        { id: 'nt_w3', type: 'city_exit', position: { x: 0, z: 40000 }, name: 'Cổng Tây NT', region: 'KhanhHoa', environment: 'suburban' },
        { id: 'nt_res1', type: 'residential', position: { x: 3200, z: 36800 }, name: 'KDC NT 1', environment: 'residential' },
        { id: 'nt_res2', type: 'residential', position: { x: 1600, z: 36800 }, name: 'KDC NT 2', environment: 'residential' },
        { id: 'nt_res3', type: 'residential', position: { x: 3200, z: 43200 }, name: 'KDC NT 3', environment: 'residential' },
        { id: 'nt_res4', type: 'residential', position: { x: 1600, z: 43200 }, name: 'KDC NT 4', environment: 'residential' },
        { id: 'nt_res5', type: 'residential', position: { x: 4000, z: 38400 }, name: 'KDC NT 5', environment: 'residential' },
        { id: 'nt_res6', type: 'residential', position: { x: 4000, z: 41600 }, name: 'KDC NT 6', environment: 'residential' },
        { id: 'nt_ra1', type: 'roundabout', position: { x: 2800, z: 39200 }, name: 'Vòng xoay NT 1', intersection: { type: 'roundabout', yield: true } },
        { id: 'nt_ra2', type: 'roundabout', position: { x: 2000, z: 40800 }, name: 'Vòng xoay NT 2', intersection: { type: 'roundabout', yield: true } },
        { id: 'gs_nt1', type: 'fuel_station', position: { x: 2800, z: 38400 }, name: 'Cây xăng NT 1', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },

        // ====== CAO TỐC NHA TRANG -> CAM LÂM -> VĨNH HẢO (Z=48000 -> 80000) ======
        { id: 'ct1', type: 'highway_junction', position: { x: 2400, z: 48000 }, name: 'IC Nha Trang', region: 'KhanhHoa', environment: 'highway' },
        { id: 'ct2', type: 'highway_junction', position: { x: 3200, z: 56000 }, name: 'Cam Lâm', region: 'KhanhHoa', environment: 'highway' },
        { id: 'ct3', type: 'highway_junction', position: { x: 3200, z: 64000 }, name: 'Cam Ranh Airport', region: 'KhanhHoa', environment: 'highway' },
        { id: 'ct4', type: 'highway_junction', position: { x: 3200, z: 80000 }, name: 'Vĩnh Hảo', region: 'NinhThuan', environment: 'highway' },
        { id: 'rs_ct1', type: 'rest_area', position: { x: 2000, z: 52000 }, name: 'Trạm dừng Cam Lâm', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct2', type: 'rest_area', position: { x: 3600, z: 60000 }, name: 'Trạm dừng Cam Ranh', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct3', type: 'rest_area', position: { x: 2000, z: 72000 }, name: 'Trạm dừng Vĩnh Hảo', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'res_ct1', type: 'residential', position: { x: 4000, z: 52000 }, name: 'KDC Cam Lâm', environment: 'rural' },
        { id: 'res_ct2', type: 'residential', position: { x: 4400, z: 60000 }, name: 'KDC Cam Ranh', environment: 'rural' },
        { id: 'res_ct3', type: 'residential', position: { x: 4000, z: 72000 }, name: 'KDC Vĩnh Hảo', environment: 'rural' },
        { id: 'gs_ct1', type: 'fuel_station', position: { x: 2800, z: 52000 }, name: 'Cây xăng Cam Lâm', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_ct2', type: 'fuel_station', position: { x: 3600, z: 64000 }, name: 'Cây xăng Cam Ranh', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'nv_in', type: 'tunnel_node', position: { x: 3200, z: 68000 }, name: 'Hầm Núi Vung (Vào)', environment: 'tunnel' },
        { id: 'nv_out', type: 'tunnel_node', position: { x: 3200, z: 72000 }, name: 'Hầm Núi Vung (Ra)', environment: 'tunnel' },

        // ====== THÀNH PHỐ PHAN RANG (Z=96000) ======
        { id: 'pr_w', type: 'highway_junction', position: { x: 3200, z: 96000 }, name: 'Tây Phan Rang', region: 'NinhThuan', environment: 'urban' },
        { id: 'pr_c', type: 'intersection', position: { x: 4000, z: 96000 }, name: 'Trung tâm Phan Rang', region: 'NinhThuan', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 35, yellow: 4, green: 30 }, offset: 0 } } },
        { id: 'pr_e', type: 'junction', position: { x: 4800, z: 96000 }, name: 'Đông Phan Rang', region: 'NinhThuan', environment: 'urban' },
        { id: 'pr_n', type: 'junction', position: { x: 4000, z: 94400 }, name: 'Bắc Phan Rang', region: 'NinhThuan', environment: 'urban' },
        { id: 'pr_s', type: 'junction', position: { x: 4000, z: 97600 }, name: 'Nam Phan Rang', region: 'NinhThuan', environment: 'urban' },
        { id: 'pr_ne', type: 'junction', position: { x: 4800, z: 94400 }, name: 'Khu NE PR', environment: 'residential' },
        { id: 'pr_se', type: 'junction', position: { x: 4800, z: 97600 }, name: 'Khu SE PR', environment: 'residential' },
        { id: 'pr_nw', type: 'junction', position: { x: 3200, z: 94400 }, name: 'Khu NW PR', environment: 'residential' },
        { id: 'pr_sw', type: 'junction', position: { x: 3200, z: 97600 }, name: 'Khu SW PR', environment: 'residential' },
        { id: 'pr_n2', type: 'roundabout', position: { x: 4000, z: 92800 }, name: 'Vòng đai Bắc PR', intersection: { type: 'roundabout', yield: true } },
        { id: 'pr_s2', type: 'roundabout', position: { x: 4000, z: 99200 }, name: 'Vòng đai Nam PR', intersection: { type: 'roundabout', yield: true } },
        { id: 'pr_res1', type: 'residential', position: { x: 4800, z: 92800 }, name: 'KDC PR 1', environment: 'residential' },
        { id: 'pr_res2', type: 'residential', position: { x: 3200, z: 92800 }, name: 'KDC PR 2', environment: 'residential' },
        { id: 'pr_res3', type: 'residential', position: { x: 4800, z: 99200 }, name: 'KDC PR 3', environment: 'residential' },
        { id: 'pr_res4', type: 'residential', position: { x: 3200, z: 99200 }, name: 'KDC PR 4', environment: 'residential' },
        { id: 'pr_ra1', type: 'roundabout', position: { x: 4400, z: 95200 }, name: 'Vòng xoay PR 1', intersection: { type: 'roundabout', yield: true } },

        // ====== CAO TỐC PHAN RANG -> PHAN THIẾT -> DẦU GIÂY (Z=100000 -> 144000) ======
        { id: 'ct5', type: 'highway_junction', position: { x: 4000, z: 104000 }, name: 'Phan Thiết', region: 'BinhThuan', environment: 'highway' },
        { id: 'ct6', type: 'highway_junction', position: { x: 4000, z: 120000 }, name: 'Nút giao PT-DG', region: 'BinhThuan', environment: 'highway' },
        { id: 'ct7', type: 'highway_junction', position: { x: 4000, z: 136000 }, name: 'Dầu Giây', region: 'DongNai', environment: 'highway' },
        { id: 'rs_ct4', type: 'rest_area', position: { x: 3200, z: 112000 }, name: 'Trạm dừng Phan Thiết', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct5', type: 'rest_area', position: { x: 4800, z: 128000 }, name: 'Trạm dừng Dầu Giây', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'gs_ct3', type: 'fuel_station', position: { x: 3200, z: 112000 }, name: 'Cây xăng Phan Thiết', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_ct4', type: 'fuel_station', position: { x: 4800, z: 128000 }, name: 'Cây xăng Dầu Giây', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'res_pt1', type: 'residential', position: { x: 4800, z: 108000 }, name: 'KDC Phan Thiết 1', environment: 'rural' },
        { id: 'res_pt2', type: 'residential', position: { x: 3200, z: 116000 }, name: 'KDC Phan Thiết 2', environment: 'rural' },
        { id: 'res_dg1', type: 'residential', position: { x: 4800, z: 124000 }, name: 'KDC Dầu Giây 1', environment: 'rural' },
        { id: 'res_dg2', type: 'residential', position: { x: 3200, z: 132000 }, name: 'KDC Dầu Giây 2', environment: 'rural' },

        // ====== THÀNH PHỐ HCM (Z=160000) ======
        { id: 'hcm_n', type: 'highway_junction', position: { x: 4000, z: 160000 }, name: 'Cổng Bắc Sài Gòn', region: 'HCM', environment: 'highway' },
        { id: 'hcm_c', type: 'intersection', position: { x: 3200, z: 160000 }, name: 'Trung tâm Sài Gòn', region: 'HCM', environment: 'urban', intersection: { type: 'four_way', trafficLight: { enabled: true, cycle: { red: 50, yellow: 5, green: 40 }, offset: 0 } } },
        { id: 'hcm_e', type: 'junction', position: { x: 2400, z: 160000 }, name: 'Khu Đông Sài Gòn', region: 'HCM', environment: 'urban' },
        { id: 'hcm_w', type: 'junction', position: { x: 4000, z: 161600 }, name: 'Khu Tây Sài Gòn', region: 'HCM', environment: 'urban' },
        { id: 'hcm_n2', type: 'junction', position: { x: 3200, z: 158400 }, name: 'Tân Bình', region: 'HCM', environment: 'urban' },
        { id: 'hcm_s', type: 'junction', position: { x: 3200, z: 161600 }, name: 'Quận 7', region: 'HCM', environment: 'urban' },
        { id: 'hcm_ne', type: 'junction', position: { x: 2400, z: 158400 }, name: 'Khu NE HCM', environment: 'residential' },
        { id: 'hcm_se', type: 'junction', position: { x: 2400, z: 161600 }, name: 'Khu SE HCM', environment: 'residential' },
        { id: 'hcm_nw', type: 'junction', position: { x: 4000, z: 158400 }, name: 'Khu NW HCM', environment: 'residential' },
        { id: 'hcm_sw', type: 'junction', position: { x: 4000, z: 161600 }, name: 'Khu SW HCM', environment: 'residential' },
        { id: 'hcm_n3', type: 'roundabout', position: { x: 3200, z: 156800 }, name: 'Vòng đai Bắc HCM', intersection: { type: 'roundabout', yield: true } },
        { id: 'hcm_s2', type: 'roundabout', position: { x: 3200, z: 163200 }, name: 'Vòng đai Nam HCM', intersection: { type: 'roundabout', yield: true } },
        { id: 'hcm_e2', type: 'roundabout', position: { x: 1600, z: 160000 }, name: 'Quận 2', intersection: { type: 'roundabout', yield: true } },
        { id: 'hcm_w2', type: 'roundabout', position: { x: 4800, z: 160000 }, name: 'Quận 6', intersection: { type: 'roundabout', yield: true } },
        { id: 'hcm_n4', type: 'city_exit', position: { x: 3200, z: 155200 }, name: 'Cổng Bắc HCM', environment: 'suburban' },
        { id: 'hcm_s3', type: 'city_exit', position: { x: 3200, z: 164800 }, name: 'Cổng Nam HCM', environment: 'suburban' },
        { id: 'hcm_e3', type: 'city_exit', position: { x: 800, z: 160000 }, name: 'Cổng Đông HCM', environment: 'suburban' },
        { id: 'hcm_w3', type: 'city_exit', position: { x: 5600, z: 160000 }, name: 'Cổng Tây HCM', environment: 'suburban' },
        { id: 'hcm_res1', type: 'residential', position: { x: 2400, z: 156800 }, name: 'KDC HCM 1', environment: 'residential' },
        { id: 'hcm_res2', type: 'residential', position: { x: 4000, z: 156800 }, name: 'KDC HCM 2', environment: 'residential' },
        { id: 'hcm_res3', type: 'residential', position: { x: 2400, z: 163200 }, name: 'KDC HCM 3', environment: 'residential' },
        { id: 'hcm_res4', type: 'residential', position: { x: 4000, z: 163200 }, name: 'KDC HCM 4', environment: 'residential' },
        { id: 'hcm_res5', type: 'residential', position: { x: 1600, z: 161600 }, name: 'KDC HCM 5', environment: 'residential' },
        { id: 'hcm_res6', type: 'residential', position: { x: 4800, z: 158400 }, name: 'KDC HCM 6', environment: 'residential' },
        { id: 'hcm_res7', type: 'residential', position: { x: 1600, z: 158400 }, name: 'KDC HCM 7', environment: 'residential' },
        { id: 'hcm_res8', type: 'residential', position: { x: 4800, z: 161600 }, name: 'KDC HCM 8', environment: 'residential' },
        { id: 'hcm_ra1', type: 'roundabout', position: { x: 3600, z: 159200 }, name: 'Vòng xoay HCM 1', intersection: { type: 'roundabout', yield: true } },
        { id: 'hcm_ra2', type: 'roundabout', position: { x: 2800, z: 160800 }, name: 'Vòng xoay HCM 2', intersection: { type: 'roundabout', yield: true } },
        { id: 'hcm_ra3', type: 'roundabout', position: { x: 3600, z: 160800 }, name: 'Vòng xoay HCM 3', intersection: { type: 'roundabout', yield: true } },
        { id: 'gs_hcm1', type: 'fuel_station', position: { x: 3600, z: 158400 }, name: 'Cây xăng HCM 1', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_hcm2', type: 'fuel_station', position: { x: 2800, z: 161600 }, name: 'Cây xăng HCM 2', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'hcm_st', type: 'bus_station', position: { x: 2800, z: 164000 }, name: 'Bến xe Miền Đông Mới', region: 'HCM', environment: 'urban', busStation: { platforms: 20, parkingSlots: 200, passengerSpawnRate: 0.9 } }
    ],

    // ===== SEGMENTS =====
    segments: [
        // ====== LƯỚI ĐƯỜNG PHÚ YÊN ======
        { id: 's_py_n_c', from: 'py_n', to: 'py_c', type: 'arterial', roadClass: 'Đô thị', twoWay: true, surface: 'asphalt', trafficDensity: 0.75, laneData: [{ id: 'l1', index: 0, direction: 'forward', type: 'normal' }, { id: 'l2', index: 1, direction: 'forward', type: 'normal' }] },
        { id: 's_py_c_s', from: 'py_c', to: 'py_s', type: 'arterial', roadClass: 'Đô thị', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_py_w_c', from: 'py_w', to: 'py_c', type: 'arterial', roadClass: 'Đô thị', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_py_c_e', from: 'py_c', to: 'py_e', type: 'arterial', roadClass: 'Đô thị', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        // Vòng 1 - Local
        { id: 's_py_n_ne', from: 'py_n', to: 'py_ne', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_e_ne', from: 'py_e', to: 'py_ne', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_s_se', from: 'py_s', to: 'py_se', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_e_se', from: 'py_e', to: 'py_se', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_n_nw', from: 'py_n', to: 'py_nw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_w_nw', from: 'py_w', to: 'py_nw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_s_sw', from: 'py_s', to: 'py_sw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_py_w_sw', from: 'py_w', to: 'py_sw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        // Vòng 2
        { id: 's_py_n_n2', from: 'py_n', to: 'py_n2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_py_s_s2', from: 'py_s', to: 'py_s2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_py_e_e2', from: 'py_e', to: 'py_e2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_py_w_w2', from: 'py_w', to: 'py_w2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        // Vòng 3
        { id: 's_py_n2_n3', from: 'py_n2', to: 'py_n3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_py_s2_s3', from: 'py_s2', to: 'py_s3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_py_e2_e3', from: 'py_e2', to: 'py_e3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_py_w2_w3', from: 'py_w2', to: 'py_w3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        // Khu dân cư PY
        { id: 's_py_ne_res1', from: 'py_ne', to: 'py_res1', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_py_sw_res2', from: 'py_sw', to: 'py_res2', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_py_se_res3', from: 'py_se', to: 'py_res3', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_py_nw_res4', from: 'py_nw', to: 'py_res4', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        // Bến xe
        { id: 's_py_c_stj', from: 'py_c', to: 'py_stj', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_py_st_stj', from: 'py_st', to: 'py_stj', type: 'bus_station_road', twoWay: false, surface: 'asphalt', trafficDensity: 0.8 },
        { id: 's_py_stj_s', from: 'py_stj', to: 'py_s', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },

        // ====== CAO TỐC BẮC ======
        { id: 's_py_n3_hwy1', from: 'py_n3', to: 'hwy_n_1', type: 'highway', roadClass: 'Cao tốc', twoWay: true, median: true, shoulder: true, trafficDensity: 0.5, laneData: [{ id: 'l1', index: 0, direction: 'forward', type: 'normal', speedLimit: 120 }, { id: 'l2', index: 1, direction: 'forward', type: 'overtake', speedLimit: 120 }] },
        { id: 's_hwy1_hwy2', from: 'hwy_n_1', to: 'hwy_n_2', type: 'highway', roadClass: 'Cao tốc', twoWay: true, median: true, shoulder: true, trafficDensity: 0.5 },
        { id: 's_hwy2_hwy3', from: 'hwy_n_2', to: 'hwy_n_3', type: 'highway', roadClass: 'Cao tốc', twoWay: true, median: true, shoulder: true, trafficDensity: 0.5 },
        { id: 's_hwy3_hwy4', from: 'hwy_n_3', to: 'hwy_n_4', type: 'highway', roadClass: 'Cao tốc', twoWay: true, median: true, shoulder: true, trafficDensity: 0.5 },
        // Rest stop Bắc
        { id: 's_hwy1_rs1', from: 'hwy_n_1', to: 'rs_n1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_hwy2_rs2', from: 'hwy_n_2', to: 'rs_n2', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Khu dân cư cao tốc Bắc
        { id: 's_hwy1_res1', from: 'hwy_n_1', to: 'res_n1', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_hwy3_res2', from: 'hwy_n_3', to: 'res_n2', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },

        // ====== QL1A NAM -> ĐÈO CẢ ======
        { id: 's_py_s3_hwy1', from: 'py_s3', to: 'hwy_s_1', type: 'highway', roadClass: 'Cao tốc', twoWay: true, median: true, shoulder: true, trafficDensity: 0.6 },
        { id: 's_hwy1_hwy2s', from: 'hwy_s_1', to: 'hwy_s_2', type: 'highway', roadClass: 'Cao tốc', twoWay: true, median: true, shoulder: true, trafficDensity: 0.6 },
        { id: 's_hwy2_hwy3s', from: 'hwy_s_2', to: 'hwy_s_3', type: 'national_highway', roadClass: 'QL1A', twoWay: true, trafficDensity: 0.8, truckDensity: 0.4 },
        { id: 's_hwy3_hwy4s', from: 'hwy_s_3', to: 'hwy_s_4', type: 'national_highway', roadClass: 'QL1A', twoWay: true, environment: 'coastal', trafficDensity: 0.7 },
        // Rest stop Nam
        { id: 's_hwy1_rss1', from: 'hwy_s_1', to: 'rs_s1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Gas station
        { id: 's_hwy3_gs1', from: 'hwy_s_3', to: 'gs_s1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Khu dân cư
        { id: 's_hwy1_res_s1', from: 'hwy_s_1', to: 'res_s1', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_hwy2_res_s2', from: 'hwy_s_2', to: 'res_s2', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_hwy3_res_s3', from: 'hwy_s_3', to: 'res_s3', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        // Đèo Cả Tunnel
        { id: 's_hwy4_dc_in', from: 'hwy_s_4', to: 'deoca_in', type: 'mountain_pass', twoWay: true, environment: 'mountain', slope: 0.08, curveIntensity: 0.6, trafficDensity: 0.5, truckDensity: 0.5, busDensity: 0.6 },
        { id: 's_dc_in_out', from: 'deoca_in', to: 'deoca_out', type: 'tunnel', twoWay: true, tunnel: { length: 4000, lighting: true, emergencyBay: true, ventilation: true, speedLimit: 60 }, trafficDensity: 0.7 },
        { id: 's_dc_out_s', from: 'deoca_out', to: 'deoca_s', type: 'mountain_pass', twoWay: true, environment: 'mountain', slope: -0.08, curveIntensity: 0.6, trafficDensity: 0.5 },
        // Rest stop sau hầm
        { id: 's_dc_s_rs', from: 'deoca_s', to: 'rs_dc1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },

        // ====== LƯỚI ĐƯỜNG NHA TRANG ======
        { id: 's_dc_s_nt_w', from: 'deoca_s', to: 'nt_w', type: 'national_highway', twoWay: true, trafficDensity: 0.8 },
        { id: 's_nt_w_c', from: 'nt_w', to: 'nt_c', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_nt_c_e', from: 'nt_c', to: 'nt_e', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.75, environment: 'coastal' },
        { id: 's_nt_c_n', from: 'nt_c', to: 'nt_n', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_nt_c_s', from: 'nt_c', to: 'nt_s', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_nt_n_ne', from: 'nt_n', to: 'nt_ne', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_e_ne', from: 'nt_e', to: 'nt_ne', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_s_se', from: 'nt_s', to: 'nt_se', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_e_se', from: 'nt_e', to: 'nt_se', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_n_nw', from: 'nt_n', to: 'nt_nw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_w_nw', from: 'nt_w', to: 'nt_nw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_s_sw', from: 'nt_s', to: 'nt_sw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_nt_w_sw', from: 'nt_w', to: 'nt_sw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        // Vòng 2 NT
        { id: 's_nt_n_n2', from: 'nt_n', to: 'nt_n2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_nt_s_s2', from: 'nt_s', to: 'nt_s2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_nt_e_e2', from: 'nt_e', to: 'nt_e2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_nt_w_w2', from: 'nt_w', to: 'nt_w2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        // Vòng 3 NT
        { id: 's_nt_n2_n3', from: 'nt_n2', to: 'nt_n3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_nt_s2_s3', from: 'nt_s2', to: 'nt_s3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_nt_e2_e3', from: 'nt_e2', to: 'nt_e3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_nt_w2_w3', from: 'nt_w2', to: 'nt_w3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        // Khu dân cư NT
        { id: 's_nt_ne_res1', from: 'nt_ne', to: 'nt_res1', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_nt_nw_res2', from: 'nt_nw', to: 'nt_res2', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_nt_se_res3', from: 'nt_se', to: 'nt_res3', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_nt_sw_res4', from: 'nt_sw', to: 'nt_res4', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        // Gas station NT
        { id: 's_nt_n_gs', from: 'nt_n', to: 'gs_nt1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },

        // ====== CAO TỐC NT -> CAM LÂM -> VĨNH HẢO ======
        { id: 's_nt_s3_ct1', from: 'nt_s3', to: 'ct1', type: 'highway_ramp', twoWay: false, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_ct1_ct2', from: 'ct1', to: 'ct2', type: 'expressway', twoWay: true, median: true, trafficDensity: 0.6 },
        { id: 's_ct2_ct3', from: 'ct2', to: 'ct3', type: 'expressway', twoWay: true, median: true, trafficDensity: 0.6 },
        { id: 's_ct3_nv_in', from: 'ct3', to: 'nv_in', type: 'highway', twoWay: true, trafficDensity: 0.6 },
        { id: 's_nv_in_out', from: 'nv_in', to: 'nv_out', type: 'tunnel', twoWay: true, tunnel: { length: 4000, lighting: true, speedLimit: 80 }, trafficDensity: 0.7 },
        { id: 's_nv_out_ct4', from: 'nv_out', to: 'ct4', type: 'expressway', twoWay: true, median: true, trafficDensity: 0.6 },
        // Rest stop
        { id: 's_ct1_rs1', from: 'ct1', to: 'rs_ct1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_ct2_rs2', from: 'ct2', to: 'rs_ct2', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_ct3_rs3', from: 'ct3', to: 'rs_ct3', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Gas station
        { id: 's_ct1_gs1', from: 'ct1', to: 'gs_ct1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_ct2_gs2', from: 'ct2', to: 'gs_ct2', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Khu dân cư
        { id: 's_ct1_res1', from: 'ct1', to: 'res_ct1', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_ct2_res2', from: 'ct2', to: 'res_ct2', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_ct4_res3', from: 'ct4', to: 'res_ct3', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },

        // ====== LƯỚI ĐƯỜNG PHAN RANG ======
        { id: 's_ct4_pr_w', from: 'ct4', to: 'pr_w', type: 'national_highway', twoWay: true, trafficDensity: 0.8 },
        { id: 's_pr_w_c', from: 'pr_w', to: 'pr_c', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_pr_c_e', from: 'pr_c', to: 'pr_e', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.75 },
        { id: 's_pr_c_n', from: 'pr_c', to: 'pr_n', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_pr_c_s', from: 'pr_c', to: 'pr_s', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_pr_n_ne', from: 'pr_n', to: 'pr_ne', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_e_ne', from: 'pr_e', to: 'pr_ne', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_s_se', from: 'pr_s', to: 'pr_se', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_e_se', from: 'pr_e', to: 'pr_se', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_n_nw', from: 'pr_n', to: 'pr_nw', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_w_nw', from: 'pr_w', to: 'pr_nw', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_s_sw', from: 'pr_s', to: 'pr_sw', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_pr_w_sw', from: 'pr_w', to: 'pr_sw', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        // Vòng 2 PR
        { id: 's_pr_n_n2', from: 'pr_n', to: 'pr_n2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_pr_s_s2', from: 'pr_s', to: 'pr_s2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        // Khu dân cư PR
        { id: 's_pr_ne_res1', from: 'pr_ne', to: 'pr_res1', type: 'residential', twoWay: true, surface: 'dirt', trafficDensity: 0.2 },
        { id: 's_pr_nw_res2', from: 'pr_nw', to: 'pr_res2', type: 'residential', twoWay: true, surface: 'dirt', trafficDensity: 0.2 },
        { id: 's_pr_se_res3', from: 'pr_se', to: 'pr_res3', type: 'residential', twoWay: true, surface: 'dirt', trafficDensity: 0.2 },
        { id: 's_pr_sw_res4', from: 'pr_sw', to: 'pr_res4', type: 'residential', twoWay: true, surface: 'dirt', trafficDensity: 0.2 },

        // ====== CAO TỐC PR -> PT -> DG ======
        { id: 's_pr_s2_ct5', from: 'pr_s2', to: 'ct5', type: 'highway_ramp', twoWay: false, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_ct5_ct6', from: 'ct5', to: 'ct6', type: 'expressway', twoWay: true, median: true, trafficDensity: 0.6 },
        { id: 's_ct6_ct7', from: 'ct6', to: 'ct7', type: 'expressway', twoWay: true, median: true, trafficDensity: 0.6 },
        // Rest stop
        { id: 's_ct5_rs4', from: 'ct5', to: 'rs_ct4', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_ct6_rs5', from: 'ct6', to: 'rs_ct5', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Gas station
        { id: 's_ct5_gs3', from: 'ct5', to: 'gs_ct3', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_ct6_gs4', from: 'ct6', to: 'gs_ct4', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Khu dân cư
        { id: 's_ct5_res_pt1', from: 'ct5', to: 'res_pt1', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_ct5_res_pt2', from: 'ct5', to: 'res_pt2', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_ct6_res_dg1', from: 'ct6', to: 'res_dg1', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },
        { id: 's_ct6_res_dg2', from: 'ct6', to: 'res_dg2', type: 'rural', twoWay: true, surface: 'gravel', trafficDensity: 0.3 },

        // ====== LƯỚI ĐƯỜNG HCM ======
        { id: 's_ct7_hcm_n', from: 'ct7', to: 'hcm_n', type: 'expressway', twoWay: true, median: true, trafficDensity: 0.8 },
        { id: 's_hcm_n_c', from: 'hcm_n', to: 'hcm_c', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.9 },
        { id: 's_hcm_c_e', from: 'hcm_c', to: 'hcm_e', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.9 },
        { id: 's_hcm_c_w', from: 'hcm_c', to: 'hcm_w', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.9 },
        { id: 's_hcm_c_n2', from: 'hcm_c', to: 'hcm_n2', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.9 },
        { id: 's_hcm_c_s', from: 'hcm_c', to: 'hcm_s', type: 'arterial', twoWay: true, surface: 'asphalt', trafficDensity: 0.9 },
        { id: 's_hcm_n_ne', from: 'hcm_n2', to: 'hcm_ne', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_e_ne', from: 'hcm_e', to: 'hcm_ne', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_s_se', from: 'hcm_s', to: 'hcm_se', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_e_se', from: 'hcm_e', to: 'hcm_se', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_n2_nw', from: 'hcm_n2', to: 'hcm_nw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_w_nw', from: 'hcm_w', to: 'hcm_nw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_s_sw', from: 'hcm_s', to: 'hcm_sw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        { id: 's_hcm_w_sw', from: 'hcm_w', to: 'hcm_sw', type: 'local', twoWay: true, surface: 'asphalt', trafficDensity: 0.4 },
        // Vòng 2 HCM
        { id: 's_hcm_n2_n3', from: 'hcm_n2', to: 'hcm_n3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_hcm_s_s2', from: 'hcm_s', to: 'hcm_s2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_hcm_e_e2', from: 'hcm_e', to: 'hcm_e2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        { id: 's_hcm_w_w2', from: 'hcm_w', to: 'hcm_w2', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.6 },
        // Vòng 3 HCM
        { id: 's_hcm_n3_n4', from: 'hcm_n3', to: 'hcm_n4', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        { id: 's_hcm_s2_s3', from: 'hcm_s2', to: 'hcm_s3', type: 'collector', twoWay: true, surface: 'asphalt', trafficDensity: 0.5 },
        // Khu dân cư HCM
        { id: 's_hcm_ne_res1', from: 'hcm_ne', to: 'hcm_res1', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_hcm_nw_res2', from: 'hcm_nw', to: 'hcm_res2', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_hcm_se_res3', from: 'hcm_se', to: 'hcm_res3', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        { id: 's_hcm_sw_res4', from: 'hcm_sw', to: 'hcm_res4', type: 'residential', twoWay: true, surface: 'concrete', trafficDensity: 0.3 },
        // Gas station HCM
        { id: 's_hcm_n2_gs1', from: 'hcm_n2', to: 'gs_hcm1', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        { id: 's_hcm_s_gs2', from: 'hcm_s', to: 'gs_hcm2', type: 'service', twoWay: false, surface: 'asphalt', trafficDensity: 0.2 },
        // Bến xe Miền Đông
        { id: 's_hcm_e_st', from: 'hcm_e', to: 'hcm_st', type: 'bus_station_road', twoWay: true, surface: 'asphalt', trafficDensity: 0.8 }
    ],

    // ===== POIs =====
    pois: [
        { id: 'py_st', type: 'bus_station', position: { x: 400, z: 800 }, name: 'Bến xe Nam Tuy Hòa', size: { width: 1440, height: 160, depth: 960 }, parkingSlots: 40 },
        { id: 'hcm_st', type: 'bus_station', position: { x: 2800, z: 164000 }, name: 'Bến xe Miền Đông Mới', size: { width: 3200, height: 240, depth: 2000 }, parkingSlots: 200 },
        { id: 'rs_n1', type: 'rest_area', position: { x: 400, z: -6000 }, name: 'Trạm dừng Bắc 1', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 15 },
        { id: 'rs_n2', type: 'rest_area', position: { x: 1200, z: -10000 }, name: 'Trạm dừng Bắc 2', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 15 },
        { id: 'rs_s1', type: 'rest_area', position: { x: 400, z: 6000 }, name: 'Trạm dừng Nam 1', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 15 },
        { id: 'rs_dc1', type: 'rest_area', position: { x: 2000, z: 30000 }, name: 'Trạm dừng sau Đèo Cả', size: { width: 800, height: 80, depth: 600 }, parkingSlots: 20 },
        { id: 'rs_ct1', type: 'rest_area', position: { x: 2000, z: 52000 }, name: 'Trạm dừng Cam Lâm', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct2', type: 'rest_area', position: { x: 3600, z: 60000 }, name: 'Trạm dừng Cam Ranh', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct3', type: 'rest_area', position: { x: 2000, z: 72000 }, name: 'Trạm dừng Vĩnh Hảo', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct4', type: 'rest_area', position: { x: 3200, z: 112000 }, name: 'Trạm dừng Phan Thiết', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'rs_ct5', type: 'rest_area', position: { x: 4800, z: 128000 }, name: 'Trạm dừng Dầu Giây', size: { width: 1000, height: 100, depth: 800 }, parkingSlots: 25 },
        { id: 'gs_s1', type: 'fuel_station', position: { x: 1200, z: 10000 }, name: 'Cây xăng Vạn Ninh', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_nt1', type: 'fuel_station', position: { x: 2800, z: 38400 }, name: 'Cây xăng NT 1', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_ct1', type: 'fuel_station', position: { x: 2800, z: 52000 }, name: 'Cây xăng Cam Lâm', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_ct2', type: 'fuel_station', position: { x: 3600, z: 64000 }, name: 'Cây xăng Cam Ranh', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_ct3', type: 'fuel_station', position: { x: 3200, z: 112000 }, name: 'Cây xăng Phan Thiết', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_ct4', type: 'fuel_station', position: { x: 4800, z: 128000 }, name: 'Cây xăng Dầu Giây', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_hcm1', type: 'fuel_station', position: { x: 3600, z: 158400 }, name: 'Cây xăng HCM 1', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 },
        { id: 'gs_hcm2', type: 'fuel_station', position: { x: 2800, z: 161600 }, name: 'Cây xăng HCM 2', size: { width: 600, height: 60, depth: 400 }, parkingSlots: 8 }
    ],

    // ===== ROUTE METADATA =====
    routeInfo: {
        name: "Phú Yên → TP.HCM",
        vehicleType: "coach",
        preferredRoadTypes: ["expressway", "national_highway", "highway"],
        avoidToll: false,
        stops: ["py_st", "hcm_st"]
    },

    // ===== ROUTE =====
    route: [
        'py_st', 'py_stj', 'py_s', 'py_s2', 'hwy_s_1', 'hwy_s_2', 'hwy_s_3', 'hwy_s_4', 
        'deoca_in', 'deoca_out', 'deoca_s', 'nt_w', 'nt_c', 'nt_s', 'nt_s2', 'ct1', 'ct2', 'ct3', 'ct4', 
        'pr_w', 'pr_c', 'pr_s', 'pr_s2', 'ct5', 'ct6', 'hcm_n', 'hcm_c', 'hcm_e', 'hcm_st'
    ]
};

// ===== CACHES (O(1) Lookups) =====
const nodeMap = new Map();
const segmentMap = new Map();
const poiMap = new Map();

function setupCaches() {
    roadNetwork.nodes.forEach(n => nodeMap.set(n.id, n));
    roadNetwork.segments.forEach(s => segmentMap.set(s.id, s));
    roadNetwork.pois.forEach(p => poiMap.set(p.id, p));
}
setupCaches();

// ===== APPLY PROFILES (Merge defaults into segments) =====
function applyProfiles() {
    roadNetwork.segments.forEach(seg => {
        const profile = roadProfiles[seg.type] || {};
        for (const key in profile) {
            if (seg[key] === undefined) {
                seg[key] = profile[key];
            }
        }
    });
}
applyProfiles();

// ===== BUILD DIRECTIONAL GRAPH =====
function buildGraph() {
    for (const node of roadNetwork.nodes) {
        node.connections = [];
    }
    for (const seg of roadNetwork.segments) {
        const fromNode = nodeMap.get(seg.from);
        const toNode = nodeMap.get(seg.to);
        if (fromNode && toNode) {
            // Forward connection
            fromNode.connections.push({ segment: seg.id, to: seg.to, direction: "forward" });
            // Reverse connection if twoWay
            if (seg.twoWay) {
                toNode.connections.push({ segment: seg.id, to: seg.from, direction: "reverse" });
            }
        }
    }
}
buildGraph();

// ===== VALIDATION =====
export function validateRoadNetwork() {
    const errors = [];
    const nodeIds = new Set();
    const segIds = new Set();
    const poiIds = new Set();

    roadNetwork.nodes.forEach(n => {
        if (nodeIds.has(n.id)) errors.push(`Duplicate Node ID: ${n.id}`);
        nodeIds.add(n.id);
        if (!n.connections || n.connections.length === 0) {
            errors.push(`Orphan Node: ${n.id}`);
        }
    });

    roadNetwork.segments.forEach(s => {
        if (segIds.has(s.id)) errors.push(`Duplicate Segment ID: ${s.id}`);
        segIds.add(s.id);
        if (!nodeMap.has(s.from)) errors.push(`Segment ${s.id} points to non-existent from: ${s.from}`);
        if (!nodeMap.has(s.to)) errors.push(`Segment ${s.id} points to non-existent to: ${s.to}`);
    });

    roadNetwork.pois.forEach(p => {
        if (poiIds.has(p.id)) errors.push(`Duplicate POI ID: ${p.id}`);
        poiIds.add(p.id);
    });

    // Check Route
    for (let i = 0; i < roadNetwork.route.length - 1; i++) {
        const fromId = roadNetwork.route[i];
        const toId = roadNetwork.route[i+1];
        const seg = roadNetwork.segments.find(s => (s.from === fromId && s.to === toId) || (s.from === toId && s.to === fromId && s.twoWay));
        if (!seg) errors.push(`Route broken between ${fromId} and ${toId}`);
    }

    if (errors.length > 0) {
        console.warn("Road Network Validation Errors:", errors);
    } else {
        console.log("✅ Road Network Validation Passed.");
    }
    return errors;
}
validateRoadNetwork();

// ===== API (Backward Compatible) =====
export function getNode(id) { return nodeMap.get(id); }
export function getSegment(id) { return segmentMap.get(id); }
export function getPOI(id) { return poiMap.get(id); }

export function getRouteNodes() {
    return roadNetwork.route.map(id => getNode(id)).filter(Boolean);
}

export function getRouteSegments() {
    const segments = [];
    for (let i = 0; i < roadNetwork.route.length - 1; i++) {
        const fromId = roadNetwork.route[i];
        const toId = roadNetwork.route[i+1];
        const seg = roadNetwork.segments.find(s => s.from === fromId && s.to === toId) || 
                    roadNetwork.segments.find(s => s.from === toId && s.to === fromId && s.twoWay);
        if (seg) segments.push(seg);
    }
    return segments;
}

export function getTotalRouteLength() {
    let total = 0;
    for (const seg of getRouteSegments()) {
        if (seg.length) {
            total += seg.length;
        } else {
            const from = getNode(seg.from).position;
            const to = getNode(seg.to).position;
            total += Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.z - from.z, 2));
        }
    }
    return total;
}

export function getPOIs() {
    return roadNetwork.pois;
}

export function getJunctions() {
    return roadNetwork.nodes.filter(n => n.connections && n.connections.length > 1);
}

export function getSegmentsByRoadType(type) {
    if (!type) return roadNetwork.segments;
    return roadNetwork.segments.filter(s => s.type === type);
}

export function getNearbySegments(x, z, radius) {
    const results = [];
    for (const seg of roadNetwork.segments) {
        const from = nodeMap.get(seg.from).position;
        const to = nodeMap.get(seg.to).position;
        const midX = (from.x + to.x) / 2;
        const midZ = (from.z + to.z) / 2;
        if (Math.hypot(midX - x, midZ - z) < radius) {
            results.push(seg);
        }
    }
    return results;
}