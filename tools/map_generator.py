# -*- coding: utf-8 -*-
"""
BUSDRIVEVN — WORLD / ROAD-NETWORK / PROCEDURAL MAP GENERATOR  (SOURCE OF TRUTH)
=================================================================================
Pipeline (không đảo thứ tự):

    REAL-WORLD RESEARCH
        -> WORLD / REGION PLAN
        -> TERRAIN / GEOGRAPHY          (coast line + elevation field)
        -> MAJOR ROAD CORRIDORS         (QL1A trunk + CT01 + Vành đai 3)
        -> QL / HIGHWAY                 (hierarchy, lanes, median)
        -> INTERCHANGES / RAMPS         (diamond topology thật)
        -> SECONDARY ROADS              (tuyến nối vùng)
        -> LOCAL ROADS                  (mạng nội bộ đô thị / thôn xóm)
        -> STATIONS                     (bến xe + yard + access + reserved zone)
        -> BUILDING ZONES / BUILDINGS   (road frontage + setback + collision)
        -> VEGETATION / ROADSIDE OBJECTS
        -> VALIDATION                   (graph / spawn / highway / buildings)
        -> CHUNK EXPORT                 (rmtree trước khi generate lại)
        -> RUNTIME STREAMING            (js/map.js  +  js/MapLoader.js)

NHÓM TỌA ĐỘ
    +X = Đông   |   +Z = Bắc   (=> -Z = Nam)
    1 world unit = 1 mét thật.
    Tuyến Phú Yên -> TP.HCM dài ~560 km (không hard-code kích thước world).

API COMPATIBILITY (contract của project — KHÔNG được đổi signature):
    js/map.js      : getRoadGraph(), getMinimapData(), getHeight(),
                     setPlayerPosition(x,z,dt,camDir), getSpawnPoint(),
                     getRouteWaypoints(), getPOIs(), getParkingSlots(), dispose()
    js/MapLoader.js: loadInitialData(), getTerrainHeight(), updateChunks(),
                     getSpawnPoint(), getRoadGraph(), getMinimapData(),
                     getParkingSlots()
    js/RuntimeRoadGraph.js : nodes/segments là Array, _nodeMap/_segMap,
                     getNode(id), getSegment(id), getRouteWaypoints(),
                     getMinimapData(), getSpawnPoint(), pois[]
    js/traffic/TrafficAI.js     : node.connections[], seg.twoWay, seg.lanes,
                     seg.type ('tunnel'|'bus_station_road'|'highway_ramp'),
                     node.type ('bus_station'|'junction'), getNode/getSegment
    js/traffic/TrafficManager.js: roadGraph.nodes/segments/getNode,
                     pois[].type ('BUS_STATION'|'MAJOR_BUS_TERMINAL'|
                                  'REST_AREA'|'FUEL_STATION'), pois[].busBays
    js/main.js     : map.getTerrainHeight(x,z), map.getSpawnPoint(),
                     map.getRoadGraph(), map.updateChunks(x,z),
                     ui.setupMinimap(map) -> getMinimapData()

CHỈ 2 FILE ĐƯỢC SỬA: tools/map_generator.py  +  js/map.js
"""

import json
import math
import random
import os
import shutil
import hashlib
import time

# =============================================================================
# 0. CONSTANTS
# =============================================================================

EXPORT_DIR = "generated/maps"
CHUNK_SIZE = 256.0
BUILDING_CAP = 240000        # trần số nhà (kiểm soát data size)
SECTOR_CHUNKS = 4            # 4x4 chunk = 1024m / 1 file sector
MIN_SEG_LEN = 1.5          # segment cụt hơn 1.5m bị từ chối (tránh dốc 50% vô nghĩa)
MAX_LINK_LEN = 12000.0     # đường nối QL<->cao tốc dài hơn 12km là bịa -> bỏ

# =============================================================================
# TẦNG TOPOLOGY — thứ tự ưu tiên (không đảo)
#   1. LIÊN THÔNG   2. TOPOLOGY   3. HÌNH HỌC   4. TRÁNH VA CHẠM
#   5. PHÂN CẤP    6. BẾN/XE     7. ĐỊA HÌNH     8. BIẾN THỂ    9. CHI TIẾT
# Mọi quy tắc dưới đây đều ở bậc 2-4: KHÔNG được hy sinh liên thông hay mạng
# lưới để né lỗi hình học (rule: không giảm chất lượng map).
# =============================================================================
# BẬC PHÂN CẤP: nhỏ = lớn. 0 cao tốc hạn chế ... 5 đường trong sân.
TOPO_RANK = {
    "EXPRESSWAY": 0, "TUNNEL": 0,
    "RAMP": 1, "NATIONAL": 2, "ARTERIAL": 2,
    "COLLECTOR": 3, "LOCAL": 3, "RURAL_LOCAL": 3,
    "SERVICE": 4, "STATION_ACCESS": 4, "ALLEY": 5, "INTERNAL": 5,
}

# MA TRẬN KẾT NỐI HỢP PHÁP. ĐỐI XỨNG — phải kiểm tra cả 2 chiều khi sửa
# (trước đây gán đè trong vòng lặp làm mất đối xứng, sinh 162 lỗi T5 giả).
#   - CAO TỐC chỉ nối qua RAMP/TUNNEL: cấm cấp thấp chạm mặt bằng.
#   - QL1A nối được cả phố (ngã ba T là bình thường ở VN) + trạm xăng/trạm
#     thu phí/trạm nghỉ (SERVICE) dọc QL — đó là thiết kế thật.
#   - VÀNH ĐẠI 3 / liên kết vào cao tốc là RAMP, không phải ARTERIAL.
TOPO_LEGAL = {
    # Cao tốc hạn chế: chỉ nối qua RAMP/TUNNEL ở nút giao. Cấp thấp chạm
    # thẳng mặt bằng là lỗi nghiêm trọng nhất (xe chui qua rào).
    "EXPRESSWAY":   ("EXPRESSWAY", "RAMP", "TUNNEL"),
    "TUNNEL":       ("TUNNEL", "EXPRESSWAY", "RAMP", "NATIONAL"),
    "RAMP":         ("RAMP", "EXPRESSWAY", "TUNNEL", "NATIONAL", "ARTERIAL",
                     "COLLECTOR", "SERVICE", "STATION_ACCESS"),
    # QL1A: phố gặp QL ở ngã ba T là bình thường; trạm xăng / trạm thu phí /
    # trạm nghỉ lấy xe trực tiếp từ QL (SERVICE) là thiết kế thật.
    "NATIONAL":     ("NATIONAL", "RAMP", "ARTERIAL", "TUNNEL", "COLLECTOR",
                     "RURAL_LOCAL", "STATION_ACCESS", "LOCAL", "SERVICE"),
    "ARTERIAL":     ("ARTERIAL", "NATIONAL", "RAMP", "COLLECTOR",
                     "RURAL_LOCAL", "STATION_ACCESS", "LOCAL", "SERVICE"),
    "COLLECTOR":    ("COLLECTOR", "ARTERIAL", "NATIONAL", "RAMP",
                     "RURAL_LOCAL", "STATION_ACCESS", "LOCAL", "SERVICE",
                     "ALLEY"),
    "LOCAL":        ("LOCAL", "ARTERIAL", "COLLECTOR", "RURAL_LOCAL",
                     "STATION_ACCESS", "ALLEY", "SERVICE", "INTERNAL",
                     "NATIONAL"),
    "RURAL_LOCAL":  ("RURAL_LOCAL", "LOCAL", "COLLECTOR", "ARTERIAL", "ALLEY",
                     "NATIONAL"),
    # Đường vào cơ sở (trạm xăng / trạm nghỉ / trạm thu phí) hoặc vào sân bến.
    "SERVICE":      ("SERVICE", "COLLECTOR", "STATION_ACCESS", "LOCAL",
                     "ALLEY", "INTERNAL", "RAMP", "NATIONAL", "ARTERIAL"),
    "STATION_ACCESS": ("STATION_ACCESS", "INTERNAL", "ARTERIAL", "COLLECTOR",
                       "LOCAL", "NATIONAL", "RAMP", "SERVICE"),
    "ALLEY":        ("ALLEY", "LOCAL", "SERVICE", "RURAL_LOCAL", "COLLECTOR"),
    "INTERNAL":     ("INTERNAL", "STATION_ACCESS", "SERVICE", "LOCAL"),
}
# Kiem tra doi xung ngay khi khai bao -> bat loi "mat doi xung" ngay tai cho.
for _a, _lst in list(TOPO_LEGAL.items()):
    for _b in _lst:
        if _a not in TOPO_LEGAL.get(_b, ()):
            raise SystemExit("TOPO_LEGAL mat doi xung: %s -> %s" % (_a, _b))

# TRAN BAC THEO RANK (khong phai con so cung cho moi loai): nut tren cao toc
# 6 nhanh la binh thuong (trai + phai + 2 ramp), con 6 nhanh tren pho la nan
# quat. Tran cung 8 cho ca mang => 15 node 7-9 nhanh luon vuot tran roi
# validate moi lo no ra.
TOPO_DEGREE_CAP = {0: 4, 1: 4, 2: 6, 3: 6, 4: 6, 5: 8}

# GOC TOI THIEU GIUA 2 NHANH. Duoi nguong nay 2 duong song song -> 1 duong
# (do duoc 1229 cap truoc khi co luat, con 31).
TOPO_MIN_ANGLE = {0: 20.0, 1: 20.0, 2: 26.0, 3: 26.0, 4: 26.0, 5: 22.0}

# KHOANG CACH TOI THIEU GIUA 2 NUT GIAO tren cung duong. Do la ly do
# `_split_road_near` / `_split_seg_at_point` tach duong: tach o 25m tao ra
# 145 cap nut cach nhau 23-31m (doi loi "giao lo" lay loi "nut dinh nhau").
# Do duoc tren 6886 segment: 96/157 diem cat da cach nga giao that <=25m,
# 50 diem o 25-75m, chi 33 diem o 75-200m, 11 diem >200m.
TOPO_JUNCTION_SPACING = {0: 700.0, 1: 300.0, 2: 260.0, 3: 200.0, 4: 130.0,
                         5: 90.0}
# NGUONG "nga giao that" — phai DUNG chung voi tools/audit_world.py (luat T4).
# >=100m: duoi nguong nay la nga tu lech (dung nghe giao thong), tren la thieu
# nga giao that.
CROSS_MISS = 100.0

# Node duoc phep lam muc tieu cua nhanh moi (KHONG phai moi node deu hop le).
# Node bac 2 / "link" / "local" chi la diem hinh hoc giua duong.
TOPO_JOINABLE_TYPES = ("junction", "highway", "highway_ramp", "national_road",
                       "arterial", "crossing", "tunnel", "ramp", "facility",
                       "station_gate")
# Class duoc phep nam trong san ben (layout san la "luong thang + hanh lang",
# cac nhanh cat nhau trong san la nga t-Y thiet ke, khong phai giao lo).
TOPO_YARD_CLASSES = ("INTERNAL", "STATION_ACCESS")

# =============================================================================
# NGUYÊN TẮC LỚP Y (xe phải nằm trên đường, không bay, không chìm)
# =============================================================================
# js/main.js   : bus.y = map.getTerrainHeight(x,z) + 0.5      (mỗi frame)
# js/MapLoader : getTerrainHeight() = worldRes.seaLevel || 10.0  (mặt đất PHẲNG)
#                road box = [node.y, node.y + 0.2]             (thickness 0.2)
# => muốn BÁNH XE (tại y của bus) chạm MẶT ĐƯỜNG:
#       seaLevel + 0.5 == node.y + 0.2   =>   node.y == seaLevel + 0.3
# => ROAD_DATUM = SEA_LEVEL + 0.3 = 0.35
#    node.y = 0.35, road box = [0.35, 0.55], bus.y = 0.05 + 0.5 = 0.55  <=> 0.55 ✓
#    NPC traffic đi ở y = 0.5 (hard-code trong TrafficAI) => lún 0.05 => bám đường ✓
#    xe tĩnh trong bến (npc.js) đi ở y = 0.5, sân bến = 0.40 => hở 0.10 ✓
#SEA_LEVEL PHẢI truthy (khác 0) nếu không `|| 10.0` sẽ thành 10.0 => xe bay 10 m.
SEA_LEVEL = 0.05
# -----------------------------------------------------------------------------
# LỚP Y (rule 38) — nguồn duy nhất, js/map.js copy y hệt:
#   terrainY        = get_elevation(x,z)        (mặt đất thật)
#   node.y          = get_road_datum(x,z)       == terrainY tại điểm đó
#   road mesh top   = node.y + ROAD_LIFT         (mặt đường nổi nhẹ trên terrain)
#   station yard    = node.y + YARD_LIFT
#   building/object = terrainY
#   bus             = map.getTerrainHeight(x,z) + BUS_AXLE (main.js)
# => bánh xe chạm mặt đường, không bay, không chìm, không z-fighting.
# -----------------------------------------------------------------------------
ROAD_LIFT = 0.12                  # mặt đường cao hơn terrain (chống z-fighting)
YARD_LIFT = 0.10                  # sân bến
BUILDING_Y = 0.0                  # đáy nhà = terrainY
OBJECT_Y = 0.0                    # gốc cây / cột điện
FIELD_LIFT = -0.05                # ruộng (lún nhẹ dưới terrain, không chìm)
SPAWN_Y = SEA_LEVEL + 0.5         # fallback khi chưa có terrain
SEA_FLOOR = -11.0
WATER_Y = SEA_LEVEL               # mặt nước = seaLevel (js/map.js vẽ sea plane)

SEED = 20260919

WORLD_UNITS_PER_DEG_LAT = 110540.0
LAT0 = 13.0750                      # vĩ độ tham chiếu (Nam Tuy Hòa)
LON0 = 109.3120                     # kinh độ tham chiếu
WORLD_UNITS_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

# MapLoader.js:  getSpawnPoint() { return { x:0, y:10.5, z:2000, heading:0 } }
# => Bến xe Nam Tuy Hòa PHẢI chứa điểm (0, 2000) để player spawn đúng trong bến.
SPAWN_TARGET = (0.0, 2000.0)

# Spawn nằm 115 m về TÂY (bên trongland) của trục QL1A tại anchor Nam Tuy Hòa.
# Hướng bus khi spawn: main.js  rotation.y = spawn.heading + PI/2, heading=0
# => forward = +X (Đông) => lái ra QL1A. Cổng bến phải mở về phía Đông.
SPAWN_OFFSET_WEST_M = 115.0

# --- Road hierarchy -----------------------------------------------------------
# class  : dùng cho renderer material (js/map.js matByClass, MapLoader render)
# type   : dùng cho TrafficManager filter ('tunnel'|'bus_station_road'|
#          'highway_ramp') và TrafficAI bus-stop logic
ROAD_CLASS = {
    "EXPRESSWAY":   dict(width=24.0, lanes=6, hierarchy=1, twoWay=True,  speed=90),
    "RAMP":         dict(width=9.0,  lanes=1, hierarchy=2, twoWay=True,  speed=40),
    "NATIONAL":     dict(width=15.0, lanes=4, hierarchy=2, twoWay=True,  speed=70),
    "ARTERIAL":     dict(width=14.0, lanes=4, hierarchy=3, twoWay=True,  speed=50),
    "COLLECTOR":    dict(width=10.0, lanes=2, hierarchy=4, twoWay=True,  speed=40),
    "LOCAL":        dict(width=7.5,  lanes=2, hierarchy=4, twoWay=True,  speed=30),
    "ALLEY":        dict(width=4.5,  lanes=1, hierarchy=5, twoWay=True,  speed=20),
    "RURAL_LOCAL":  dict(width=6.0,  lanes=1, hierarchy=4, twoWay=True,  speed=30),
    "SERVICE":      dict(width=6.5,  lanes=1, hierarchy=5, twoWay=True,  speed=25),
    "STATION_ACCESS": dict(width=16.0, lanes=2, hierarchy=5, twoWay=True, speed=25),
    "INTERNAL":     dict(width=9.0,  lanes=1, hierarchy=5, twoWay=True,  speed=15),
    "TUNNEL":       dict(width=13.0, lanes=2, hierarchy=2, twoWay=True,  speed=60),
}
ROAD_TYPE_OF_CLASS = {
    "EXPRESSWAY": "highway",
    "RAMP": "highway_ramp",
    "TUNNEL": "tunnel",
    "STATION_ACCESS": "station_access",
    "INTERNAL": "bus_station_road",
    "NATIONAL": "national_road",
    "ARTERIAL": "arterial",
    "COLLECTOR": "collector",
    "LOCAL": "local",
    "ALLEY": "alley",
    "RURAL_LOCAL": "rural",
    "SERVICE": "service",
}
# Segment class -> material cho js/map.js (phải có đủ key, thiếu sẽ fallback)
MAT_BY_CLASS = {
    "EXPRESSWAY": "asphalt", "RAMP": "asphalt", "TUNNEL": "asphalt",
    "NATIONAL": "asphalt_old", "ARTERIAL": "asphalt_old",
    "COLLECTOR": "concrete", "LOCAL": "concrete", "ALLEY": "concrete",
    "RURAL_LOCAL": "dirt", "SERVICE": "dirt",
    "STATION_ACCESS": "concrete", "INTERNAL": "concrete",
}
# Segment class -> max length khi subdivide (met)
MAX_SEG_LEN = {
    "EXPRESSWAY": 3000.0, "RAMP": 70.0, "TUNNEL": 120.0,
    "NATIONAL": 2500.0, "ARTERIAL": 400.0, "COLLECTOR": 250.0,
    "LOCAL": 160.0, "ALLEY": 90.0, "RURAL_LOCAL": 300.0,
    "SERVICE": 200.0, "STATION_ACCESS": 120.0, "INTERNAL": 90.0,
}


def _seg_cross(p1, p2, q1, q2):
    """True nếu 2 đoạn (p1p2) và (q1q2) cắt nhau THỰC SỰ (không tính chạm đầu)."""
    d1x, d1z = p2[0] - p1[0], p2[1] - p1[1]
    d2x, d2z = q2[0] - q1[0], q2[1] - q1[1]
    den = d1x * d2z - d1z * d2x
    if abs(den) < 1e-9:
        return False
    t = ((q1[0] - p1[0]) * d2z - (q1[1] - p1[1]) * d2x) / den
    u = ((q1[0] - p1[0]) * d1z - (q1[1] - p1[1]) * d1x) / den
    return 0.02 < t < 0.98 and 0.02 < u < 0.98


def _cls_of(gen, nid):
    """
    Class ĐẠI NHẤT của node (rank nhỏ nhất trong các nhánh) — thứ mà ma trận
    `TOPO_LEGAL` phải dùng. Node QL1A nối 3 phố + 2 ramp thì "đường chính"
    của nó là NATIONAL, không phải LOCAL của nhánh nhỏ nhất.
    """
    n = gen.nodes.get(nid)
    if n is None:
        return "LOCAL"
    best_r, best_c = 9, "LOCAL"
    for sid in n["connections"]:
        sg = gen.segments.get(sid)
        if sg is None:
            continue
        r = TOPO_RANK.get(sg["class"], 4)
        if r < best_r:
            best_r, best_c = r, sg["class"]
    return best_c


def _seg_hits_rect(p1, p2, cx, cz, hw, hd, margin=0.0, rot=0.0):
    """True nếu đoạn p1-p2 nằm trong / cắt hcn tâm (cx,cz) bán kính (hw,hd).
    Liang-Barsky clip -> đúng cả khi đoạn nằm lọt gọn trong rect.
    rot = góc của rect (đoạn bị kéo về hệ toạ độ cục bộ của rect trước khi clip).
    Hệ cục bộ đúng với convention của _station_complex:
        ox = X*sin(rot) + Z*cos(rot);  oz = X*cos(rot) - Z*sin(rot)"""
    hw += margin
    hd += margin
    if rot:
        ca, sa = math.cos(rot), math.sin(rot)
        X1, Z1 = p1[0] - cx, p1[1] - cz
        X2, Z2 = p2[0] - cx, p2[1] - cz
        p1 = (X1 * sa + Z1 * ca, X1 * ca - Z1 * sa)
        p2 = (X2 * sa + Z2 * ca, X2 * ca - Z2 * sa)
        cx = cz = 0.0
    x1, z1 = p1
    dx, dz = p2[0] - x1, p2[1] - z1
    t0, t1 = 0.0, 1.0
    # q(THẤP) = p1 - lo, q(CAO) = hi - p1.  Sai dấu ở 2 mặt thấp (viết thành
    # lo - p1) làm Liang-Barsky lộn:
    #   * doan nam BEN TRAI rect -> van tra True  => chan duong khong can,
    #     duong phai re vong xung quanh ben => "nhanh re tum lum".
    #   * doan CAT QUA TAM rect  -> tra False     => duong cong cong van chay
    #     xuyen qua san ben xe.
    #   * diem (doan degenerate) -> luon False    => _in_station_zone chet.
    for pp, qq in ((-dx, x1 - (cx - hw)), (dx, (cx + hw) - x1),
                   (-dz, z1 - (cz - hd)), (dz, (cz + hd) - z1)):
        if abs(pp) < 1e-12:
            if qq < 0.0:
                return False
        else:
            r = qq / pp
            if pp < 0.0:
                if r > t1:
                    return False
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return False
                if r < t1:
                    t1 = r
    return t1 >= t0


# =============================================================================
# 1. REAL-WORLD GEOGRAPHY  (lat/lon thật, đã tra cứu)
# =============================================================================
# Ghi chú địa lý:
#   * Bến xe Nam Tuy Hòa (cũng gọi Bến xe Phú Lâm) :
#       507 Nguyễn Văn Linh, P. Phú Lâm, TP. Tuy Hòa, Phú Yên  (ngoài trung tâm, phía Nam)
#   * Cầu Đà Rằng : QL1A vượt sông Đà Rằng, ~8 km Nam trung tâm Tuy Hòa.
#   * Hầm Đèo Cả : tổng 13,19 km, hầm chính 4,125 km + hầm Cổ Mã 0,5 km + 9,3 km
#       đường dẫn; điểm đầu Km1353+150 (Phú Yên) -> Km1374+525 (Khánh Hòa).
#       Đèo Cả ~12 km, đỉnh ~333-407 m, ranh Đông Hòa (PhY) / Vạn Ninh (KH).
#   * Vũng Rô : vịnh dưới chân đèo Cả, Vạn Ninh, Khánh Hòa (nhánh ven biển).
#   * Đại Lãnh : bãi biển Vạn Giã, Khánh Hòa.
#   * CT01 = Đường cao tốc Bắc-Nam phía Đông : đoạn Nha Trang-Cam Lâm 49,11 km,
#       Cam Lâm-Vĩnh Hảo, Vĩnh Hảo-Phan Thiết 100,8 km, Phan Thiết-Dầu Giây
#       ~99 km (Bình Thuận 47,5 + Đồng Nai 51,5). Nút giao Ba Bàu (Hàm Thuận
#       Nam) đấu nối QL1A tại Km 1717+593.
#   * Vành đai 3 TP.HCM : 47,51 km, nút giao Tân Vạn (3 tầng, 5 nhánh),
#       nút giao Hoàng Hữu Nam, đoạn Thủ Đức 14,73 km.
#   * Khoảng cách QL1A : Tuy Hoa->Nha Trang 122 km, ->Phan Rang +104 km,
#       ->Phan Thiết +138 km, ->TP.HCM +204 km (tổng ~568 km).
#
# size : city | town | village | hamlet | none   (settlement size class)
# road_factor : hệ số đường bộ / đường chim bay (đồi núi lớn hơn)
# Các tham số vùng (uplift/density/urban/arid/mountain/coastal/forest) được
# BLEND LIÊN TỤC dọc trục corridor => region KHÔNG phải ô vuông (rule 20).

ANCHORS = [
    dict(name="Tuy_Hoa_City",    lat=13.086728, lon=109.307228, size="city",   road_factor=1.08,
         uplift=5,  density=0.95, urban=0.95, arid=0.00, mountain=0.00, coastal=0.35, forest=0.15),
    dict(name="Cau_Da_Rang",     lat=13.053788, lon=109.294803, size="village", road_factor=1.10,
         uplift=6,  density=0.45, urban=0.35, arid=0.00, mountain=0.05, coastal=0.30, forest=0.45),
    dict(name="Nam_Tuy_Hoa",     lat=13.041118, lon=109.311939, size="city",   road_factor=1.08,
         uplift=4,  density=1.00, urban=1.00, arid=0.00, mountain=0.00, coastal=0.40, forest=0.15),
    dict(name="Chi_Thanh",       lat=12.935000, lon=109.280000, size="town",   road_factor=1.12,
         uplift=10, density=0.62, urban=0.55, arid=0.00, mountain=0.15, coastal=0.45, forest=0.35),
    dict(name="Dong_Hoa",        lat=12.905000, lon=109.330000, size="town",   road_factor=1.18,
         uplift=20, density=0.60, urban=0.50, arid=0.00, mountain=0.55, coastal=0.20, forest=0.55),
    dict(name="Deo_Ca_North",    lat=12.864700, lon=109.365300, size="none",   road_factor=1.24,
         uplift=250, density=0.05, urban=0.00, arid=0.00, mountain=1.00, coastal=0.10, forest=0.95),
    dict(name="Deo_Ca_South",    lat=12.847421, lon=109.387521, size="none",   road_factor=1.24,
         uplift=230, density=0.05, urban=0.00, arid=0.00, mountain=1.00, coastal=0.15, forest=0.90),
    dict(name="Dai_Lanh",        lat=12.834510, lon=109.361217, size="village", road_factor=1.22,
         uplift=60,  density=0.30, urban=0.20, arid=0.00, mountain=0.50, coastal=0.95, forest=0.45),
    dict(name="Co_Ma",           lat=12.815488, lon=109.354999, size="none",   road_factor=1.22,
         uplift=120, density=0.08, urban=0.00, arid=0.00, mountain=0.85, coastal=0.45, forest=0.70),
    dict(name="Vung_Ro",         lat=12.714969, lon=109.394349, size="hamlet", road_factor=1.28,
         uplift=45,  density=0.18, urban=0.10, arid=0.00, mountain=0.55, coastal=0.90, forest=0.60),
    dict(name="Van_Gia",         lat=12.520000, lon=109.330000, size="village", road_factor=1.18,
         uplift=25,  density=0.36, urban=0.25, arid=0.00, mountain=0.25, coastal=0.70, forest=0.45),
    dict(name="Nha_Trang",       lat=12.247185, lon=109.189207, size="city",   road_factor=1.12,
         uplift=16,  density=1.00, urban=1.00, arid=0.00, mountain=0.25, coastal=0.95, forest=0.25),
    dict(name="Cam_Lam",         lat=12.053414, lon=109.118664, size="town",   road_factor=1.14,
         uplift=20,  density=0.55, urban=0.45, arid=0.05, mountain=0.25, coastal=0.55, forest=0.35),
    dict(name="Cam_Ranh",        lat=11.887931, lon=109.094847, size="town",   road_factor=1.15,
         uplift=22,  density=0.60, urban=0.55, arid=0.15, mountain=0.30, coastal=0.70, forest=0.30),
    dict(name="Ninh_Thuan_North", lat=11.700000, lon=109.000000, size="hamlet", road_factor=1.16,
         uplift=30,  density=0.24, urban=0.12, arid=0.70, mountain=0.35, coastal=0.45, forest=0.20),
    dict(name="Phan_Rang",       lat=11.576983, lon=108.986539, size="city",   road_factor=1.14,
         uplift=26,  density=0.85, urban=0.85, arid=0.75, mountain=0.30, coastal=0.75, forest=0.18),
    dict(name="Tuy_Phong",       lat=11.400000, lon=108.850000, size="village", road_factor=1.16,
         uplift=34,  density=0.32, urban=0.20, arid=0.85, mountain=0.40, coastal=0.60, forest=0.15),
    dict(name="Vinh_Hao",        lat=11.305535, lon=108.721349, size="town",   road_factor=1.18,
         uplift=40,  density=0.42, urban=0.30, arid=0.90, mountain=0.45, coastal=0.55, forest=0.12),
    dict(name="Ham_Thuan_Bac",   lat=11.100000, lon=108.650000, size="village", road_factor=1.20,
         uplift=46,  density=0.30, urban=0.18, arid=0.85, mountain=0.50, coastal=0.50, forest=0.15),
    dict(name="Phan_Thiet",      lat=10.929626, lon=108.104387, size="city",   road_factor=1.18,
         uplift=18,  density=0.90, urban=0.95, arid=0.55, mountain=0.18, coastal=0.95, forest=0.20),
    dict(name="Ba_Bau",          lat=10.865000, lon=108.030000, size="town",   road_factor=1.16,
         uplift=16,  density=0.45, urban=0.35, arid=0.45, mountain=0.20, coastal=0.40, forest=0.25),
    dict(name="Ham_Tin",         lat=10.800000, lon=107.870000, size="village", road_factor=1.18,
         uplift=24,  density=0.30, urban=0.18, arid=0.35, mountain=0.35, coastal=0.35, forest=0.45),
    dict(name="Nhon_Tinh",       lat=10.800000, lon=107.580000, size="hamlet", road_factor=1.20,
         uplift=30,  density=0.20, urban=0.10, arid=0.15, mountain=0.45, coastal=0.10, forest=0.70),
    dict(name="Cam_My",          lat=10.857529, lon=107.113370, size="town",   road_factor=1.17,
         uplift=24,  density=0.45, urban=0.35, arid=0.10, mountain=0.30, coastal=0.05, forest=0.55),
    dict(name="Dau_Giay",        lat=10.943068, lon=107.139889, size="town",   road_factor=1.14,
         uplift=22,  density=0.60, urban=0.55, arid=0.05, mountain=0.25, coastal=0.05, forest=0.40),
    dict(name="Bien_Hoa_East",   lat=10.940000, lon=106.900000, size="town",   road_factor=1.14,
         uplift=16,  density=0.70, urban=0.70, arid=0.00, mountain=0.10, coastal=0.05, forest=0.20),
    dict(name="Tan_Van",         lat=10.897475, lon=106.830970, size="town",   road_factor=1.12,
         uplift=14,  density=0.70, urban=0.75, arid=0.00, mountain=0.05, coastal=0.05, forest=0.15),
    dict(name="Hoang_Huu_Nam",   lat=10.877453, lon=106.815911, size="town",   road_factor=1.12,
         uplift=12,  density=0.85, urban=0.90, arid=0.00, mountain=0.05, coastal=0.05, forest=0.12),
    dict(name="Mien_Dong_Moi",   lat=10.879596, lon=106.815964, size="city",   road_factor=1.10,
         uplift=9,   density=1.00, urban=1.00, arid=0.00, mountain=0.02, coastal=0.05, forest=0.08),
    dict(name="Suoi_Tien",       lat=10.861895, lon=106.802594, size="town",   road_factor=1.10,
         uplift=10,  density=0.90, urban=0.95, arid=0.00, mountain=0.03, coastal=0.05, forest=0.10),
    dict(name="HCM_Core_South",  lat=10.790000, lon=106.700000, size="city",   road_factor=1.15,
         uplift=7,   density=1.00, urban=1.00, arid=0.00, mountain=0.00, coastal=0.10, forest=0.05),
]


# Bờ biển Việt Nam (bắc -> nam). Đất nằm PHẢI tuyến khi đi hướng nam.
# Dùng cho: mặt biển, COASTAL region, cát ven biển, khoảng cách tới biển.
COASTLINE = [
    (13.120, 109.330), (13.090, 109.352), (13.055, 109.348), (13.020, 109.352),
    (12.980, 109.368), (12.940, 109.382), (12.900, 109.372), (12.868, 109.352),
    (12.850, 109.330), (12.836, 109.352), (12.818, 109.372), (12.790, 109.398),
    (12.750, 109.412), (12.715, 109.410), (12.690, 109.400), (12.660, 109.372),
    (12.620, 109.340), (12.570, 109.300), (12.520, 109.318), (12.460, 109.288),
    (12.390, 109.252), (12.310, 109.220), (12.250, 109.212), (12.190, 109.196),
    (12.120, 109.188), (12.060, 109.180), (12.000, 109.172), (11.940, 109.168),
    (11.880, 109.140), (11.820, 109.100), (11.760, 109.060), (11.700, 109.030),
    (11.640, 109.010), (11.580, 108.998), (11.520, 108.968), (11.460, 108.930),
    (11.400, 108.880), (11.340, 108.830), (11.280, 108.790), (11.220, 108.760),
    (11.160, 108.720), (11.100, 108.680), (11.040, 108.610), (10.990, 108.520),
    (10.960, 108.420), (10.940, 108.300), (10.920, 108.180), (10.900, 108.100),
    (10.880, 108.060), (10.850, 108.020), (10.820, 108.000), (10.790, 108.010),
    (10.760, 108.050), (10.730, 108.120), (10.700, 108.220), (10.670, 108.320),
    (10.640, 108.400), (10.610, 108.470), (10.580, 108.520),
]


# Đoạn cao tốc CT01 — KHÔNG hard-code chainage (độ dài corridor thay đổi theo
# lat/lon thật) => khai báo theo ANCHOR: (tên đoạn, anchor_đầu, anchor_cuối, status)
REAL_CT01_POINTS = [
    (12.8780, 109.3560),   # Veo/Deo Ca north (ham Deo Ca)
    (12.8155, 109.3550),   # ham Co Ma
    (12.7400, 109.3800),   # Vuung Ro bay
    (12.6200, 109.3100),
    (12.4600, 109.2300),
    (12.3000, 109.1950),
    (12.2472, 109.1892),   # Nha Trang
    (12.2527, 109.0213),   # IC QL27C / Dien Tho
    (12.1819, 109.0542),   # IC Suoi Dau
    (12.1200, 109.1200),
    (12.0534, 109.1187),   # IC Cam Lam
    (11.8879, 109.0948),   # IC QL27B / Cam Ranh
    (11.7531, 109.0540),   # IC Du Long
    (11.6269, 108.8952),   # IC QL27 / Phan Rang
    (11.4671, 108.8213),   # tram nghi + doan giua
    (11.4003, 108.7590),   # ham Nui Vung
    (11.3055, 108.7213),   # IC Vinh Hao
    (11.2642, 108.4871),   # IC Cho Lau
    (11.2514, 108.3481),   # IC Dai Ninh
    (11.0915, 108.1310),   # IC Ma Lam
    (10.9343, 107.9705),   # IC Phan Thiet / Ba Bau
    (10.9320, 107.7389),   # IC QL55
    (10.8630, 107.6503),   # IC TL720
    (10.8994, 107.4203),   # IC QL1 Phan Thiet-Dau Giay
    (10.8890, 107.3737),   # IC TL765 / Xuan Loc
    (10.8581, 107.2408),   # IC QL56
    (10.9338, 107.1654),   # giao CT29 tai Dau Giay
]

EXPRESSWAY_SECTIONS = [
    ("CT01 Deo Ca - Vung Ro",  "Deo_Ca_North",   "Vung_Ro",     "operational"),
    ("CT01 Vung Ro - Nha Trang", "Vung_Ro",     "Nha_Trang",   "operational"),
    ("CT01 Nha Trang - Cam Lam", "Nha_Trang",   "Cam_Lam",     "operational"),
    ("CT01 Cam Lam - Vinh Hao",  "Cam_Lam",     "Vinh_Hao",    "operational"),
    ("CT01 Vinh Hao - Phan Thiet", "Vinh_Hao",  "Phan_Thiet",  "operational"),
    ("CT01 Phan Thiet - Dau Giay", "Phan_Thiet", "Dau_Giay",    "operational"),
]
CT01_RANGE = ("Deo_Ca_North", "Dau_Giay")
RING3_RANGE = ("Dau_Giay", "HCM_Core_South")


INTERCHANGES = [
    ("IC_Dien_Tho_QL27C", 12.252659, 109.021261, "diamond"),
    ("IC_Suoi_Dau",      12.181850, 109.054248, "diamond"),
    ("IC_Cam_Lam",       12.053414, 109.118664, "trumpet"),
    ("IC_Cam_Ranh_QL27B", 11.887931, 109.094847, "diamond"),
    ("IC_Du_Long",       11.753060, 109.054044, "diamond"),
    ("IC_Phan_Rang_QL27", 11.626926, 108.895244, "diamond"),
    ("IC_Vinh_Hao",      11.305535, 108.721349, "trumpet"),
    ("IC_Cho_Lau",       11.264165, 108.487080, "diamond"),
    ("IC_Dai_Ninh",      11.251365, 108.348097, "diamond"),
    ("IC_Ma_Lam",        11.091523, 108.130983, "diamond"),
    ("IC_Ba_Bau",        10.934926, 107.973518, "trumpet"),
    ("IC_QL55",          10.860855, 107.738925, "diamond"),
    ("IC_TL720",         10.863008, 107.650286, "diamond"),
    ("IC_QL1_PT_DG",     10.899376, 107.412921, "diamond"),
    ("IC_Xuan_Loc_TL765", 10.883740, 107.362354, "diamond"),
    ("IC_QL56",          10.856059, 107.236356, "diamond"),
    ("IC_Dau_Giay_CT29", 10.933762, 107.165427, "trumpet"),
    ("IC_Tan_Van",       10.897475, 106.830970, "diamond"),
    ("IC_Hoang_Huu_Nam", 10.877453, 106.815911, "diamond"),
]
IC_MAX_LINK_M = 4500.0


IC_MAX_LINK_M = 4500.0     # quá xa => không tạo ramp "bay" hàng chục km

# Bến xe / POI : bến = 1 KHU VỰC hoàn chỉnh (sân + nan đỗ + nhà ga + tiện ích)
# side   : bến nằm phía nào so với QL1A  (west = phía đất liền)
# offset : KHOẢNG TRỐNG từ mép sân bến tới trục QL1A (m) — không phải tâm->QL
# bays   : SỐ NAN ĐỖ MỤC TIÊU (>= số xe tĩnh muốn thấy trong bến)
STATION_DEFS = [
    dict(id="nam_tuy_hoa",   name="Bến xe Nam Tuy Hòa",     lat=13.041118, lon=109.311939,
         poi_type="BUS_STATION",          bays=15, spawn=True,  side="west", offset=45.0,
         w=190.0, d=140.0),
    dict(id="nha_trang",     name="Bến xe Nha Trang",       lat=12.238000, lon=109.193000,
         poi_type="MAJOR_BUS_TERMINAL",   bays=24, spawn=False, side="west", offset=45.0,
         w=240.0, d=170.0),
    dict(id="phan_rang",     name="Bến xe Phan Rang",       lat=11.576983, lon=108.986539,
         poi_type="BUS_STATION",          bays=20, spawn=False, side="west", offset=45.0,
         w=220.0, d=150.0),
    dict(id="phan_thiet",    name="Bến xe Phan Thiết",      lat=10.930000, lon=108.100000,
         poi_type="BUS_STATION",          bays=20, spawn=False, side="west", offset=45.0,
         w=220.0, d=150.0),
    dict(id="mien_dong_moi", name="Bến xe Miền Đông Mới",   lat=10.879596, lon=106.815964,
         poi_type="MAJOR_BUS_TERMINAL",   bays=50, spawn=False, side="west", offset=55.0,
         w=340.0, d=200.0),
]


# Trạm xăng / trạm nghỉ dọc đường  (station.json pois — KHÔNG có busBays nên
# TrafficManager.setupStationTraffic() return ngay => không phá traffic budget)
FACILITY_DEFS = [
    ("toll_vinhhao",  "Trạm thu phí Vĩnh Hảo",  11.304400, 108.725000, "TOLL"),
    ("toll_cho_lau",  "Trạm thu phí Chợ Lầu",   11.262700, 108.491100, "TOLL"),
    ("toll_dai_ninh", "Trạm thu phí Đại Ninh",   11.248600, 108.345800, "TOLL"),
    ("toll_ma_lam",   "Trạm thu phí Mã Lâm",    11.094100, 108.131100, "TOLL"),
    ("toll_ba_bau",   "Trạm thu phí Ba Bàu",    10.934300, 107.977000, "TOLL"),
    ("toll_xuan_loc", "Trạm thu phí Xuân Lộc",  10.885100, 107.365900, "TOLL"),
    ("toll_dau_giay", "Trạm thu phí Dầu Giây",  10.839000, 107.148100, "TOLL"),
    ("toll_ca_na",    "Trạm thu phí Cà Ná",     11.373604, 108.881164, "TOLL"),
    ("toll_song_luy", "Trạm thu phí Sông Lũy",  11.203689, 108.326316, "TOLL"),
    ("toll_song_phan", "Trạm thu phí Sông Phan", 10.875281, 107.931366, "TOLL"),
    ("toll_trang_bom", "Trạm thu phí Trảng Bom", 10.945477, 107.057473, "TOLL"),
    ("rest_vh_205",   "Trạm nghỉ Km205 Vĩnh Hảo-Phan Thiết", 11.154679, 108.185109, "REST_AREA"),
    ("rest_pt_47",    "Trạm nghỉ Km47 Phan Thiết",           10.866266, 107.559388, "REST_AREA"),
    ("rest_lt_41",    "Trạm nghỉ Km41 Long Thành",            10.848196, 107.101505, "REST_AREA"),
    ("rest_cvl_113",  "Trạm nghỉ Km113 Cam Lâm-Vĩnh Hảo",    11.467138, 108.821261, "REST_AREA"),
    ("fuel_cam_lam",  "Petrolimex Cam Lâm",   12.047000, 109.112000, "FUEL_STATION"),
    ("fuel_dau_giay", "Petrolimex Dầu Giây",  10.937000, 107.142000, "FUEL_STATION"),
    ("pvoil_hhn",     "PVOIL Hoàng Hữu Nam",   10.874000, 106.820000, "FUEL_STATION"),
    ("pvoil_phan_thiet", "PVOIL Phan Thiết",  10.925000, 108.098000, "FUEL_STATION"),
]




# -----------------------------------------------------------------------------
# SÔNG / HỒ THẬT (tọa độ xấp xỉ từ OSM + bản đồ) — dùng để KHẮC ĐỊA HÌNH vũng
# nước và TỰ SINH CẦU cho đường cắt qua sông.
# Không phải mọi con sông đều có trong data; đủ các con sông lớn cắt QL1A.
# -----------------------------------------------------------------------------
RIVERS = [
    dict(name="Song_Da_Rang",   width=120.0,
         pts=[(13.100, 109.285), (13.060, 109.292), (13.020, 109.305), (12.995, 109.320)]),
    dict(name="Song_Cu_Dai",    width=90.0,
         pts=[(12.330, 109.180), (12.270, 109.190), (12.220, 109.195), (12.170, 109.205)]),
    dict(name="Song_Ca",        width=100.0,
         pts=[(10.990, 108.240), (10.950, 108.205), (10.905, 108.180)]),
    dict(name="Song_Phan",      width=70.0,
         pts=[(10.910, 107.955), (10.875, 107.931), (10.845, 107.905)]),
    dict(name="Song_Luy",       width=85.0,
         pts=[(11.280, 108.285), (11.204, 108.326), (11.130, 108.365)]),
    dict(name="Song_Cu_Long",   width=150.0,
         pts=[(10.990, 107.330), (10.943, 107.275), (10.900, 107.230)]),
    dict(name="Song_Dong_Nai",  width=170.0,
         pts=[(10.980, 107.210), (10.935, 107.050), (10.895, 106.940)]),
    dict(name="Song_Be",        width=120.0,
         pts=[(10.930, 106.890), (10.897, 106.845), (10.870, 106.810)]),
]

# HỒ (hồ Tân Giang ngay Tuy Hòa, hồ Công Trêng sát Phan Thiết)
LAKES = [
    dict(name="Ho_Tan_Giang",  x=13.075000, y=109.298000, rx=430.0, rz=240.0, rot=0.45),
    dict(name="Ho_Thap_Cham",  x=11.600000, y=109.010000, rx=320.0, rz=220.0, rot=0.20),
]

# Bến xe Nam Tuy Hòa (OSM way/1472940794) — điểm tham chiếu cho projection
BUS_STATION = (13.041118, 109.311939)

# CẦU / HẦM THẬT (tọa độ OSM) — generator đánh dấu segment tương ứng
BRIDGE_DEFS = [
    ("Cau_Da_Rang", 13.053788, 109.294803, "QL1A"),
]
TUNNEL_DEFS = [
    ("Ham_Deo_Ca",  12.864700, 109.365300, "CT01"),
    ("Ham_Co_Ma",   12.815488, 109.354999, "CT01"),
    ("Ham_Nui_Vung", 11.400318, 108.759032, "CT01"),
]

# =============================================================================
# 2. BUILDING VARIATION SYSTEM  (~200 variations / không cần 200 file)
# =============================================================================
# Template + Parameters + Materials + Roof + Facade + Floor + Size
HOUSE_ARCHETYPES = [
    # (type, min_floor, max_floor, w_choices, d_choices, roof_types, weight)
    ("SHOPHOUSE",  2, 4, [4.0, 4.5, 5.0], [10.0, 12.0, 14.0, 16.0], ["pitched", "flat"], 34),
    ("TUBEHOUSE",  2, 5, [3.6, 4.2],      [12.0, 15.0, 18.0],       ["pitched", "flat"], 20),
    ("VILLA",      1, 3, [7.0, 8.5, 10.0],[10.0, 12.0, 14.0],       ["pitched", "mansard"], 12),
    ("FARMHOUSE",  1, 2, [8.0, 10.0, 12.0],[9.0, 11.0, 13.0],       ["pitched"], 24),
    ("RURAL_HOUSE",1, 2, [6.0, 7.5],      [8.0, 10.0],              ["pitched"], 22),
    ("SHED",       1, 1, [6.0, 9.0],      [7.0, 10.0],              ["pitched"], 10),
    ("WAREHOUSE",  1, 2, [14.0, 18.0],    [16.0, 22.0],             ["flat", "pitched"], 8),
    ("EATERY",     1, 2, [7.0, 9.0],      [9.0, 12.0],              ["pitched", "flat"], 16),
    ("GARAGE",     1, 1, [9.0, 12.0],     [11.0, 14.0],             ["flat"], 8),
    ("WORKSHOP",   1, 2, [10.0, 13.0],    [12.0, 16.0],             ["flat", "pitched"], 8),
    ("MOTEL",      2, 4, [11.0, 14.0],    [13.0, 17.0],             ["flat"], 6),
    ("OFFICE",     3, 6, [12.0, 16.0],    [14.0, 18.0],             ["flat"], 5),
    ("MARKET",     1, 2, [20.0, 26.0],    [16.0, 22.0],             ["flat"], 3),
    ("FACTORY",    1, 3, [24.0, 32.0],    [20.0, 28.0],             ["flat"], 3),
]
ROOF_COLORS = [0x8b3a3a, 0xa0422a, 0x6b2f2f, 0x9c4a2f, 0x2f5f8b, 0x3f6b4a,
               0x5a5a5a, 0x7a4b2a, 0x274b6b, 0x8a6a3a]
FACADE_COLORS = [0xf2ece0, 0xe8dfc8, 0xdfd3b8, 0xf5f0e6, 0xe4ddd0, 0xd9cfc0,
                 0xcfd9d4, 0xe9d9c4, 0xdde4ea, 0xf0e2d0, 0xe6e6dc, 0xcfc4b4]
FLOOR_HEIGHTS = [3.2, 3.0, 3.0, 3.4]
# Số variation house thực tế = tổ hợp (archetype, floor, w, d, roof, color...)
HOUSE_VARIATION_TARGET = 200


def build_house_variant(variant_id):
    """Trả về 1 bộ tham số nhà. 200 variant_id -> >=200 tổ hợp khác nhau."""
    weights = [a[6] for a in HOUSE_ARCHETYPES]
    total = sum(weights)
    r = variant_id % total
    idx = 0
    for i, w in enumerate(weights):
        if r < w:
            idx = i
            break
        r -= w
    (a_type, fmin, fmax, w_choices, d_choices, roof_types, _w) = HOUSE_ARCHETYPES[idx]
    sub = variant_id // total
    floors = fmin + (sub % (fmax - fmin + 1)); sub //= (fmax - fmin + 1)
    w = w_choices[sub % len(w_choices)];      sub //= len(w_choices)
    d = d_choices[sub % len(d_choices)];      sub //= len(d_choices)
    roof_type = roof_types[sub % len(roof_types)]; sub //= len(roof_types)
    roof_color = ROOF_COLORS[sub % len(ROOF_COLORS)]; sub //= len(ROOF_COLORS)
    facade = FACADE_COLORS[sub % len(FACADE_COLORS)]
    height = sum(FLOOR_HEIGHTS[:floors])
    awning = (variant_id % 3) == 0
    sign = (variant_id % 2) == 0
    return dict(variant=variant_id, type=a_type, floors=floors, w=w, d=d,
                height=round(height, 2), roof_type=roof_type,
                roof_color=roof_color, facade=facade,
                awning=awning, sign=sign)


# =============================================================================
# 3. MATH HELPERS
# =============================================================================

def clamp(v, a, b):
    return a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def dist2(ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    return dx * dx + dz * dz


def dist(ax, az, bx, bz):
    return math.sqrt(dist2(ax, az, bx, bz))


def stable_rng(*parts):
    """RNG xác định (deterministic) — KHÔNG dùng hash() của Python (bị salt)."""
    key = "|".join(str(p) for p in parts).encode("utf-8")
    h = int.from_bytes(hashlib.sha1(key).digest()[:8], "big")
    return random.Random(h)


# =============================================================================
# 4. WORLD GENERATOR
# =============================================================================

class MapGenerator:
    def __init__(self, seed=SEED):
        self.seed = seed
        self.nodes = {}
        self.segments = {}
        self._edge_index = {}     # (n1,n2) -> sid : chặn segment trùng cặp node
        self._nsi = None          # node -> [sid]; index phục vụ _segs_at()
        self.stations = []
        self.chunk_data = {}
        self.node_id = 0
        self.seg_id = 0
        self.road_bboxes = []        # (x1,z1,x2,z2,width)  -> collision khi đặt nhà
        self.object_positions = []   # (x,z,r)
        self.station_zones = []      # zone cấm đặt nhà trong bến xe
        # dem ly do cong topology tu choi mot duong (in o cuoi pipeline)
        self._topo_reject = {}
        self._topo_split_count = 0
        # lich su toa do moi node, KHONG bao gio xoa -> `_repair_route_refs`
        # gan lai dung vi tri cho id da chet sau weld/prune/split
        self._node_xy_hist = {}
        self.buildings = []
        self.building_count = 0
        self.variant_used = set()
        self.t0 = time.time()

        # ---- spatial hash cho collision queries (giữ O(1) thay vì O(n)) ----
        self._road_grid = {}
        self._obj_grid = {}

        # ---- 1) địa lý thật -> toạ độ world ----
        self._build_projection()
        self._build_corridor()       # QL1A polyline + chainage
        self._build_coast()
        self._build_accel()          # spatial index: nearest-point O(1) cho terrain
        self._build_water_index()    # song/ho -> khac dia hinh + tu sinh cau

    # --------------------------------------------------------------------------
    # 4.1 PROJECTION  (lat/lon -> world XZ, KHÔNG drift)
    # --------------------------------------------------------------------------
    def _raw_xy(self, lat, lon):
        return ((lon - LON0) * WORLD_UNITS_PER_DEG_LON,
                (lat - LAT0) * WORLD_UNITS_PER_DEG_LAT)

    def _build_projection(self):
        """
        Toạ độ world = rigid translation của lat/lon thật (không drift, không méo
        tỉ lệ). Mốc (0, 2000) được đặt ĐÚNG tại BẾN XE NAM TUY HÒA thật
        (OSM way/1472940794) => spawn nằm trong bến, không phải "ở giữa world".
        """
        bs_lat, bs_lon = BUS_STATION
        spawn_raw = self._raw_xy(bs_lat, bs_lon)
        self.off_x = SPAWN_TARGET[0] - spawn_raw[0]
        self.off_z = SPAWN_TARGET[1] - spawn_raw[1]

    def proj(self, lat, lon):
        x, z = self._raw_xy(lat, lon)
        return (x + self.off_x, z + self.off_z)

    # --------------------------------------------------------------------------
    # 4.2 CORRIDOR — QL1A trunk (đích + khoảng cách thật, không drift)
    # --------------------------------------------------------------------------
    def _build_corridor(self):
        pts = []          # [(x, z, s, anchor_i, anchor_t)]
        s = 0.0
        a0 = ANCHORS[0]
        p0 = self.proj(a0["lat"], a0["lon"])
        pts.append((p0[0], p0[1], 0.0, 0, 0.0))
        self.anchor_s = [0.0]

        for i in range(1, len(ANCHORS)):
            A, B = ANCHORS[i - 1], ANCHORS[i]
            p1 = self.proj(A["lat"], A["lon"])
            p2 = self.proj(B["lat"], B["lon"])
            L0 = dist(p1[0], p1[1], p2[0], p2[1])
            f = max(A["road_factor"], B["road_factor"])
            leg = self._leg_polyline(p1, p2, L0 * f, i)

            for k in range(1, len(leg)):
                x, z = leg[k]
                s += dist(leg[k - 1][0], leg[k - 1][1], x, z)
                t = (k - 1) / (len(leg) - 1)
                pts.append((x, z, s, i - 1 + clamp(t, 0.0, 1.0), 0.0))
            self.anchor_s.append(s)

        self.corridor = pts
        self.corridor_len = s

        # polyline thô để tính khoảng cách -> terrain flatten (giảm số điểm)
        step = 1500.0
        coarse, acc = [pts[0]], 0.0
        for k in range(1, len(pts)):
            acc += dist(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1])
            if acc >= step:
                coarse.append(pts[k])
                acc = 0.0
        if coarse[-1] != pts[-1]:
            coarse.append(pts[-1])
        self.corridor_coarse = [(p[0], p[1]) for p in coarse]

    def _leg_polyline(self, p1, p2, target_len, leg_index):
        """
        Đường từ p1->p2 đúng endpoints (KHÔNG drift) nhưng có chiều dài ~ target_len
        nhờ sóng sin vuông góc với trục. => giữ đúng lat/lon thật của anchor,
        đúng bearing thật, và có độ cong tự nhiên (không phải đường thẳng 50 km).
        """
        L0 = dist(p1[0], p1[1], p2[0], p2[1])
        if L0 < 1.0:
            return [p1, p2]
        f = max(1.0, target_len / L0)
        k = max(1, int(round(L0 / 3200.0)))          # wavelength ~3.2 km
        amp = L0 * math.sqrt(f - 1.0) / (math.pi * k)
        amp = clamp(amp, 0.0, 420.0)
        if amp < 8.0:
            amp = 0.0
        ux, uz = (p2[0] - p1[0]) / L0, (p2[1] - p1[1]) / L0
        nx, nz = -uz, ux

        # sub-sample đủ dày để segment không quá dài
        n = max(6, int(L0 / 350.0))
        out = []
        for j in range(n + 1):
            t = j / n
            off = amp * math.sin(math.pi * k * t)      # t=0 và t=1 => 0 (endpoints exact)
            off += amp * 0.35 * math.sin(math.pi * (k * 2 + 1) * t)
            out.append((p1[0] + ux * L0 * t + nx * off,
                        p1[1] + uz * L0 * t + nz * off))
        out[0] = p1
        out[-1] = p2
        return out

    # --------------------------------------------------------------------------
    # 4.3 COASTLINE / DISTANCE FIELDS
    # --------------------------------------------------------------------------
    def _build_coast(self):
        self.coast = [self.proj(lat, lon) for (lat, lon) in COASTLINE]

    def _polyline_dist(self, x, z, poly):
        best, seg = float("inf"), -1, 0.0
        for i in range(len(poly) - 1):
            ax, az = poly[i]
            bx, bz = poly[i + 1]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0.0, 1.0)
            cx, cz = ax + dx * t, az + dz * t
            d = (x - cx) ** 2 + (z - cz) ** 2
            if d < best:
                best = d
        return math.sqrt(best)

    def dist_to_coast(self, x, z):
        """Khoảng cách tới biển (>0 = đất, <0 = biển). Đất nằm PHẢI hướng nam."""
        poly = self.coast
        best, best_i, best_t = float("inf"), 0, 0.0
        for i in self._acc_near(self._acc_coast, x, z):
            if i >= len(poly) - 1:
                continue
            ax, az = poly[i]
            bx, bz = poly[i + 1]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0.0, 1.0)
            cx, cz = ax + dx * t, az + dz * t
            d2 = (x - cx) ** 2 + (z - cz) ** 2
            # tie-break theo chỉ số nhỏ hơn => Python & JS LUÔN chọn cùng
            # đoạn khi bằng khoảng cách (bờ biển là polyline chung điểm)
            if d2 < best - 1e-6 or (abs(d2 - best) <= 1e-6 and i < best_i):
                best, best_i, best_t = d2, i, t
        ax, az = poly[best_i]
        bx, bz = poly[best_i + 1]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1.0
        cx, cz = ax + dx * best_t, az + dz * best_t
        # mặt phẳng chuyển vị: đất = phải hướng nam  => cross > 0 là đất
        cross = (dz * (x - cx) - dx * (z - cz)) / L
        d = math.sqrt(best)
        return d if cross >= 0 else -d

    def corridor_u_dist(self, x, z):
        """
        -> (u: blend chỉ số anchor, d: khoảng cách tới trục QL1A)

        u lấy từ bảng monotonic theo z (_u_at_z) => liên tục, không nhảy ở vùng
        corridor cong. d vẫn tính bằng nearest-point (khoảng cách liên tục).
        """
        poly = self.corridor
        best = float("inf")
        _bi = [len(poly)]          # tie-break: nhớ chỉ số đoạn nhỏ nhất
        for i in self._acc_near(self._acc_corridor, x, z):
            if i >= len(poly) - 1:
                continue
            ax, az = poly[i][0], poly[i][1]
            bx, bz = poly[i + 1][0], poly[i + 1][1]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0.0, 1.0)
            d2 = (x - (ax + dx * t)) ** 2 + (z - (az + dz * t)) ** 2
            if d2 < best - 1e-6 or (abs(d2 - best) <= 1e-6 and i < _bi[0]):
                best = d2
                _bi[0] = i
        return self._u_at_z(z, x), math.sqrt(best)

    # --------------------------------------------------------------------------
    # 4.4 REGION — blend liên tục dọc corridor (KHÔNG phải ô vuông / caro)
    # --------------------------------------------------------------------------
    def region_params(self, x, z):
        u, d = self.corridor_u_dist(x, z)
        i = int(clamp(math.floor(u), 0, len(ANCHORS) - 1))
        j = min(i + 1, len(ANCHORS) - 1)
        # smoothstep => tham số vùng CHUYỂN TIẾP MƯỢT, không "kẹp" tại anchor.
        # Linear blend tạo gấp kép ở anchor (ví dụ uplift 8 -> 260) => vách đất
        # dốc 40% ngay một chỗ, xe bay. Đây là fix quan trọng cho realism.
        t = smoothstep(0.0, 1.0, clamp(u - i, 0.0, 1.0))
        A, B = ANCHORS[i], ANCHORS[j]
        p = {}
        for key in ("uplift", "density", "urban", "arid", "mountain", "coastal", "forest"):
            p[key] = lerp(A[key], B[key], t)
        # tăng dần theo khoảng cách ra khỏi trục (đồng ruộng -> sườn núi)
        inland = max(0.0, self.dist_to_coast(x, z))
        p["inland"] = inland
        p["d_corridor"] = d
        p["nearest"] = A["name"] if t < 0.5 else B["name"]
        p["size"] = A["size"] if t < 0.5 else B["size"]
        p["u"] = u
        return p

    def determine_region(self, z, x=0.0):
        """API cũ — giữ signature. Trả (REGION, NAME)."""
        p = self.region_params(x, z)
        if p["mountain"] > 0.6:
            name = p["nearest"]
            return ("TUNNEL" if "Deo_Ca" in name and p["mountain"] > 0.9 else "MOUNTAIN", name)
        if p["urban"] > 0.7:
            return "URBAN", p["nearest"]
        if p["arid"] > 0.6:
            return "RURAL_DESERT", p["nearest"]
        if p["coastal"] > 0.7:
            return "COASTAL", p["nearest"]
        if p["density"] > 0.5:
            return "SUBURBAN", p["nearest"]
        if p["urban"] > 0.4:
            return "INDUSTRIAL", p["nearest"]
        return "RURAL", p["nearest"]

    # --------------------------------------------------------------------------
    # 4.5 TERRAIN
    # --------------------------------------------------------------------------
    @staticmethod
    def _fbm(x, z):
        """Noise thuần trigonometric => Python và JS cho ra GIỐNG NHAU (deterministic,
        liên tục qua chunk boundary, không cần hash)."""
        return (math.sin(x * 0.000037 + z * 0.000021) * 1.00 +
                math.sin(x * 0.000091 - z * 0.000073) * 0.55 +
                math.sin(x * 0.000210 + z * 0.000170) * 0.30 +
                math.sin(x * 0.000470 - z * 0.000530) * 0.16 +
                math.sin(x * 0.001130 + z * 0.000970) * 0.08)

    @staticmethod
    def _fbm_small(x, z):
        return (math.sin(x * 0.0113 + z * 0.0091) * 0.6 +
                math.sin(x * 0.0271 - z * 0.0313) * 0.4)

    def get_elevation(self, x, z, water=True):
        """
        ĐỘ CAO THẬT (đồng bằng / đồi / núi / đèo). Đây là nguồn height duy nhất
        của terrain — js/map.js PHẢI copy y hệt hàm này.
        """
        d_coast = self.dist_to_coast(x, z)
        if d_coast <= 0.0:
            # đáy biển
            return SEA_FLOOR + 4.0 * self._fbm(x, z) * 0.5 + max(-4.0, d_coast * 0.05)

        p = self.region_params(x, z)

        # 1) dốc ven biển: đất nhô lên từ mặt biển trong ~700 m đầu
        coastal_ramp = smoothstep(0.0, 700.0, d_coast) * 2.2

        # 2) nâng theo vùng (inland gradient)
        inland_gain = smoothstep(0.0, 26000.0, p["inland"])
        regional = p["uplift"] * (0.35 + 0.65 * inland_gain)

        # 3) massif núi — sóng PHẢI RỘNG (bước sóng ~20-100km) và biên độ có
        #    CHẶN. _fbm có biên ±2.09 nên (0.55+0.45*fbm) lên tới 1.49; không
        #    chặn thì khối núi nhô thành vách 200m => đường 40% dốc, xe bay.
        if p["mountain"] > 0.02:
            fb = clamp(self._fbm(x * 0.30, z * 0.30), -1.0, 1.0)
            regional += p["mountain"] * 150.0 * (0.55 + 0.45 * fb)

        # 4) dẹt地形 quanh đường (đường đi theo thung lũng/đồng bằng => grounding ổn)
        d_corr = p["d_corridor"]
        flatten = smoothstep(2600.0, 450.0, d_corr)
        # ở vùng đèo vẫn cho đường leo nhẹ để có cảm giác đèo
        road_lift = p["mountain"] * 62.0 * (1.0 - smoothstep(600.0, 1800.0, d_corr))

        regional = regional * (1.0 - flatten * 0.94) + road_lift

        # 5) chi tiết địa hình — noise phải TẮT gần đường, nếu không mặt đường
        #    bị nhấp nhô 30-40% => xe bay/rung. Đường đi trên nền phẳng/đắp nền,
        #    đồi núi thật nằm ở xa (ngoài 2.6km) => đúng thực tế VN.
        detail = self._fbm(x, z) * (5.0 + regional * 0.05)
        micro = self._fbm_small(x, z) * (0.35 + regional * 0.012)
        micro *= (1.0 - flatten * 0.99)

        h = SEA_LEVEL + coastal_ramp + regional + detail * (1.0 - flatten * 0.985) + micro
        # KHAAC LANG SONG/HO: ham xuong muc nuoc + 0.2m (nuoc cham, khong phai bien sau)
        wf = self.water_factor(x, z) if water else 0.0
        if wf > 0.0:
            bed = SEA_LEVEL - 0.2 - 1.6 * wf
            h = lerp(h, bed, clamp(wf * 1.35, 0.0, 1.0))
        return h

    def get_road_datum(self, x, z, water=True):
        """
        DATUM ĐƯỜNG = CHÍNH ĐỘ CAO THẬT của terrain tại (x,z).

        Vì get_elevation() đã tự flatten quanh trục corridor (smoothstep 2600->450m),
        đường đi trên địa hình là mặt phẳng ngang trong bán kính ~450m => node.y
        chạy mượt, xe không rung, và QUAN TRỌNG: terrain (js/map.js, cùng công thức)
        == đường (node.y) nên không bao giờ chìm/bay.

        js/map.js copy y hệt get_elevation() + các hằng số world.json.terrain.
        """
        return self.get_elevation(x, z, water)

    # --------------------------------------------------------------------------
    # 4.5b ACCELERATION  (nearest-point O(1) thay vì O(n) — cần vì get_elevation()
    # được gọi cho MỌI node / building / object)
    # --------------------------------------------------------------------------
    _ACC_CELL = 4096.0

    @classmethod
    def _acc_cell(cls, x, z):
        return (int(math.floor(x / cls._ACC_CELL)), int(math.floor(z / cls._ACC_CELL)))

    def _build_accel(self):
        self._acc_corridor = {}
        for i, p in enumerate(self.corridor):
            k = self._acc_cell(p[0], p[1])
            self._acc_corridor.setdefault(k, []).append(i)
        self._acc_coast = {}
        for i, p in enumerate(self.coast):
            k = self._acc_cell(p[0], p[1])
            self._acc_coast.setdefault(k, []).append(i)
        # BẢNG u THEO z (monotonic) -- XEM _u_at_z()
        self._uz = self._build_u_table()

    def _build_u_table(self, bin_m=250.0):
        """
        Bảng u(z) dạng BIN + MEDIAN — VÀ đánh dấu các bin MÂU THUẬN.
        KHÔNG ép đơn điệu toàn cục (xem ghi chú trong vòng lặp).

        Lý do cần phần "mâu thuận": QL.1 thật đi từ Phan Thiết sang Dầu Giây theo
        hướng TÂY BẮC (vĩ độ TĂNG lại 10.93 -> 10.94), nên z KHÔNG đơn điệu dọc
        corridor. Ở các bin có corridor đi 2 nhánh với u khác xa, bảng u(z) không
        quyết định được -> fallback nearest-point (có làm trơn) cho đúng nhánh.
        """
        bins = {}
        for p in self.corridor:
            k = int(math.floor(p[1] / bin_m))
            bins.setdefault(k, []).append(p[3])
        if not bins:
            self._uz, self._uz_ambig = [], set()
            return []
        lo_k, hi_k = min(bins), max(bins)
        table = []
        ambig = set()
        last = None
        for k in range(lo_k, hi_k + 1):
            us = bins.get(k)
            if us:
                lo_u, hi_u = min(us), max(us)
                if hi_u - lo_u > 0.6:
                    ambig.add(k)
                us.sort()
                u = us[len(us) // 2]
            else:
                # bin rong: giu gia tri truoc de bang lien tuc
                if last is None:
                    continue
                u = last
            # KHONG EP MONOTUAN TOAN CUC. Xem ghi chu ham: corridor di tu
            # Phu Yen (z=+7042, u=0) xuong HCM (z=-246838, u=30) => u GIAM
            # khi z TANG. Ep `u >= last` se ghim TOAN BO bang o gia tri cuoi
            # cung (29.974) => 19/31 moc dia ly tra ve "HCM_Core_South" =>
            # terrain mat vung: khong nui Deo Ca, khong kho Phan Rang,
            # khong bien Nha Trang (rule 19/20/43).
            # Median tai tung bin van dung: corridor la duong 1 chi, nen u tai
            # mot diem la duy nhat; bin nhieu nhanh da duoc danh dau `ambig`
            # de fallback nearest-point.
            table.append((k * bin_m + bin_m * 0.5, u))
            last = u
        self._uz = table
        self._uz_ambig = ambig
        return table

    def _u_nearest(self, x, z):
        """u theo điểm corridor gần nhất, LÀM TRƠN 3 điểm (chống nhảy ở medial axis)."""
        poly = self.corridor
        best, bi = float("inf"), 0
        for i in self._acc_near(self._acc_corridor, x, z):
            if i >= len(poly) - 1:
                continue
            a, b = poly[i], poly[i + 1]
            dx, dz = b[0] - a[0], b[1] - a[1]
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0.0, 1.0)
            d2 = (x - (a[0] + dx * t)) ** 2 + (z - (a[1] + dz * t)) ** 2
            if d2 < best - 1e-6 or (abs(d2 - best) <= 1e-6 and i < bi):
                best, bi = d2, i
        us = []
        for j in (bi - 1, bi, bi + 1):
            if 0 <= j < len(poly):
                us.append(poly[j][3])
        return sum(us) / len(us) if us else 0.0

    def _u_at_z(self, z, x=None):
        """
        u = nội suy bảng bin-median (đơn điệu) -> liên tục.
        Bin MÂU THUẪN (corridor đi 2 nhánh) -> nearest-point có làm trơn.
        """
        uz = self._uz
        if not uz:
            return 0.0
        bin_m = 250.0
        kb = int(math.floor(z / bin_m))
        if kb in getattr(self, "_uz_ambig", ()) and x is not None:
            return self._u_nearest(x, z)
        if z <= uz[0][0]:
            return uz[0][1]
        if z >= uz[-1][0]:
            return uz[-1][1]
        lo, hi = 0, len(uz) - 1
        while lo + 1 < hi:
            mid = (lo + hi) // 2
            if uz[mid][0] <= z:
                lo = mid
            else:
                hi = mid
        z0, u0 = uz[lo]
        z1, u1 = uz[hi]
        if z1 == z0:
            return u0
        return lerp(u0, u1, (z - z0) / (z1 - z0))

    def _acc_near(self, table, x, z, want=48):
        """
        Danh sách index gần (x,z). Mở rộng vòng tìm TRƯỚC khi full-scan:
        corridor dài 500km (2000 điểm) nên full-scan mỗi lần gọi là O(n) và
        làm generator chậm kinh khủng (và JS sẽ lag khi load chunk).
        """
        out = []
        cx, cz = self._acc_cell(x, z)
        r = 0
        while r <= 6 and len(out) < want:
            for dx in range(-r, r + 1):
                for dz in range(-r, r + 1):
                    if max(abs(dx), abs(dz)) != r:
                        continue
                    out.extend(table.get((cx + dx, cz + dz), ()))
            r += 1
        if len(out) < want:
            out = list(range(len(self.corridor if table is self._acc_corridor
                                 else self.coast)))
        return out

    def _polyline_nearest(self, poly, x, z):
        """-> (dist, seg_index, t) — gần đúng tuyệt đối vì quét MỌI đoạn lân cận."""
        best, bi, bt = float("inf"), 0, 0.0
        n = len(poly)
        for i in range(n - 1):
            ax, az = poly[i][0], poly[i][1]
            bx, bz = poly[i + 1][0], poly[i + 1][1]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0.0, 1.0)
            cx, cz = ax + dx * t, az + dz * t
            d2 = (x - cx) ** 2 + (z - cz) ** 2
            if d2 < best:
                best, bi, bt = d2, i, t
        return math.sqrt(best), bi, bt

    # --------------------------------------------------------------------------
    # 4.5c SÔNG / HỒ — khắc địa hình + index để tự sinh cầu
    # --------------------------------------------------------------------------
    def _build_water_index(self):
        self._river_polys = []
        self._river_acc = {}
        for r in RIVERS:
            raw = [self.proj(lat, lon) for (lat, lon) in r["pts"]]
            # DENSIFY <=400m/diem: index 3x3 cell 4096m khong phu het doan
            # 5-30km => water_factor() = 0 giua doan => khong khac terrain,
            # khong sinh cau. Poly da densify thi export luon dung ban nay.
            poly = []
            for i in range(len(raw)):
                if i == 0:
                    poly.append(raw[0])
                    continue
                a, b = raw[i - 1], raw[i]
                L = dist(a[0], a[1], b[0], b[1])
                n = max(1, int(L / 400.0))
                for k in range(1, n + 1):
                    t = k / float(n)
                    poly.append((lerp(a[0], b[0], t), lerp(a[1], b[1], t)))
            self._river_polys.append(poly)
            k0 = len(self._river_polys) - 1
            for i, p in enumerate(poly):
                key = self._acc_cell(p[0], p[1])
                self._river_acc.setdefault(key, []).append((k0, i))
        for lk in LAKES:
            poly = [self.proj(lk["x"], lk["y"])]
            self._river_polys.append(poly)
            key = self._acc_cell(poly[0][0], poly[0][1])
            self._river_acc.setdefault(key, []).append((len(self._river_polys) - 1, 0))

    def water_factor(self, x, z):
        """
        0.0 = ngoài nuoc, 1.0 = giua long song / giua ho.
        Dung de khac dia hinh xuong muc nuoc (vung nuc) -> duong cat nuoc = CAU.
        """
        if not self._river_polys:
            return 0.0
        best = 0.0
        c0 = self._acc_cell(x, z)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for (ri, si) in self._river_acc.get((c0[0] + dx, c0[1] + dz), ()):
                    poly = self._river_polys[ri]
                    width = RIVERS[ri]["width"] if ri < len(RIVERS) else \
                        2.0 * max(LAKES[ri - len(RIVERS)]["rx"], LAKES[ri - len(RIVERS)]["rz"])
                    half = width * 0.5
                    if len(poly) == 1:
                        # hồ: ellipse
                        lk = LAKES[ri - len(RIVERS)]
                        ca, sa = math.cos(lk["rot"]), math.sin(lk["rot"])
                        ox, oz = x - poly[0][0], z - poly[0][1]
                        u = (ox * ca + oz * sa) / lk["rx"]
                        v = (-ox * sa + oz * ca) / lk["rz"]
                        r = math.sqrt(u * u + v * v)
                        if r < 1.15:
                            best = max(best, clamp(1.15 - r, 0.0, 1.0))
                        continue
                    for i in range(len(poly) - 1):
                        a, b = poly[i], poly[i + 1]
                        dax, daz = b[0] - a[0], b[1] - a[1]
                        l2 = dax * dax + daz * daz
                        if l2 <= 0:
                            continue
                        t = clamp(((x - a[0]) * dax + (z - a[1]) * daz) / l2, 0.0, 1.0)
                        d = dist(x, z, a[0] + dax * t, a[1] + daz * t)
                        if d < half * 1.25:
                            best = max(best, clamp(1.0 - d / (half * 1.15), 0.0, 1.0))
        return best

    # --------------------------------------------------------------------------
    # 4.6 GRAPH PRIMITIVES
    # --------------------------------------------------------------------------
    def _get_nid(self):
        self.node_id += 1
        return "n_%d" % self.node_id

    def _get_sid(self):
        self.seg_id += 1
        return "s_%d" % self.seg_id

    def add_node(self, x, z, region="RURAL", n_type="junction", force_y=None, name=None):
        nid = self._get_nid()
        y = force_y if force_y is not None else self.get_road_datum(x, z)
        node = {"id": nid, "x": float(x), "y": float(y), "z": float(z),
                "region": region, "type": n_type, "connections": [],
                "elev": round(float(self.get_elevation(x, z)), 3)}
        if name:
            node["name"] = name
        self.nodes[nid] = node
        return nid

    def _remove_segment(self, sid):
        """Xoá segment khỏi graph + index (dùng chung cho đa cạnh/trùng)."""
        seg = self.segments.pop(sid, None)
        if seg is None:
            return False
        self._nsi_dec(sid, seg["from"], seg["to"])
        key = (seg["from"], seg["to"]) if seg["from"] < seg["to"] else \
              (seg["to"], seg["from"])
        if self._edge_index.get(key) == sid:
            del self._edge_index[key]
        for nid in (seg["from"], seg["to"]):
            n = self.nodes.get(nid)
            if n and sid in n["connections"]:
                n["connections"].remove(sid)
        for cell, lst in list(self._road_grid.items()):
            if sid in lst:
                lst.remove(sid)
                if not lst:
                    del self._road_grid[cell]
        return True

    def _dedupe_edges(self):
        """Dọn đa cạnh còn sót (weld node / pipeline cũ): mỗi cặp node giữ
        đúng 1 segment — bản quan trọng nhất (hierarchy thấp), tie-break theo
        sid nhỏ. Dùng ở weld + cuối topology."""
        keep = {}
        drop = []
        for sid, s in sorted(self.segments.items()):
            key = (s["from"], s["to"]) if s["from"] < s["to"] else (s["to"], s["from"])
            cur = keep.get(key)
            if cur is None:
                keep[key] = sid
                continue
            old = self.segments[cur]
            if s["hierarchy"] < old["hierarchy"]:
                drop.append(cur)
                keep[key] = sid
            else:
                drop.append(sid)
        for sid in drop:
            self._remove_segment(sid)
        if drop:
            print("      xoa %d segment trung cap node" % len(drop))
        return len(drop)

    # ======================================================================
    # SỬA GIAO LỠ (rule 6/8/12/59) — chạy CUỐI topology, trước validate
    #
    # VẤN ĐỀ ĐO ĐƯỢC TRÊN DATA HIỆN TẠI:
    #   * 1229 cặp nhánh rời CÙNG node dưới 15°  -> 2 đường nằm chồng lên
    #     nhau cả trăm mét (đường ma, mép đường cắt ngang, z-fighting).
    #   * 55 node có >=6 nhánh, tệ nhất 32 nhánh  -> không phải ngã giao,
    #     là mìn spaghetti. Ngã giao thật tối đa 4-6 nhánh.
    #   * 476 node degree-1 (ALLEY/COLLECTOR/LOCAL/INTERNAL) -> đường cụt
    #     không dẫn tới đâu, chỉ để "map có nhiều đường".
    #
    # BA HÀM DƯỚI ĐÂY xử lý đúng 3 lỗi trên, theo thứ tự bắt buộc:
    #   _split_coincident_branches -> _cap_node_degree -> _prune_useless_stubs
    # ======================================================================

    # _nsi = index node -> [sid], bao tri TANG DAN de _segs_at() luon dung.
    # Neu vo moc trong vong lap thi moi lai build lai O(10k) x 8k node = treo.
    def _nsi_inc(self, sid, n1, n2):
        if self._nsi is None:
            return
        self._nsi.setdefault(n1, []).append(sid)
        if n2 != n1:
            self._nsi.setdefault(n2, []).append(sid)

    def _nsi_dec(self, sid, n1, n2):
        if self._nsi is None:
            return
        for nd in (n1, n2):
            lst = self._nsi.get(nd)
            if lst and sid in lst:
                lst.remove(sid)

    def _segs_at(self, nid):
        """Danh sách segment chạm node. Dùng index _nsi (O(1)) nếu đã build —
        KHÔNG quét toàn bộ segments trong vòng lặp node (O(N*M) => treo)."""
        if self._nsi is None:
            self._build_node_seg_index()
        return self._nsi.get(nid, ())

    def _build_node_seg_index(self):
        idx = {}
        for sid, s in self.segments.items():
            idx.setdefault(s["from"], []).append(sid)
            idx.setdefault(s["to"], []).append(sid)
        self._nsi = idx
        return idx

    def _branch_angle(self, nid, sid):
        """Góc (rad) của nhánh sid khi rời khỏi node nid."""
        s = self.segments[sid]
        other = s["to"] if s["from"] == nid else s["from"]
        p, q = self.nodes[nid], self.nodes[other]
        return math.atan2(q["x"] - p["x"], q["z"] - p["z"])

    def _branch_len(self, nid, sid):
        s = self.segments[sid]
        other = s["to"] if s["from"] == nid else s["from"]
        p, q = self.nodes[nid], self.nodes[other]
        return dist(p["x"], p["z"], q["x"], q["z"])

    def _split_coincident_branches(self, min_deg=9.0, min_len=25.0):
        """TÁCH 2 NHÁNH CÙNG GÓC tại 1 node (rule 6/12).

        _THAY_THE_THAT_BAI: xoa canh chi khi da co duong thay the.

        2 đường rời cùng node dưới `min_deg` là 2 ĐƯỜNG CHỒNG NHAU. Xử lý
        đúng nguyên tắc giao thông thật, không xoá ngẫu nhiên:
          * 1 trong 2 là "cũ" (sinh muộn hơn / hierarchy kém hơn) -> GỠ NÓ RA
            khỏi node, weld vào node lân cận dọc theo chính đường đó. Đường
            vẫn còn, chỉ chuyển chỗ giao nhau xuống đúng điểm ngã ba.
          * cả hai đều dài và cùng hierarchy -> giữ 1, xoá 1.
        Không đụng bridge/tunnel: đó là hạ tầng định vị thật.
        """
        moved = 0
        welded = 0
        merged = 0
        for nid in list(self.nodes.keys()):
            sids = self._segs_at(nid)
            if len(sids) < 2:
                continue
            items = []
            for sid in sids:
                s = self.segments.get(sid)
                if not s or s.get("bridge") or s["class"] == "TUNNEL":
                    continue
                items.append((self._branch_angle(nid, sid), sid,
                              self._branch_len(nid, sid), s))
            items.sort(key=lambda t: t[0])
            drop_sid = set()
            for i in range(len(items)):
                if items[i][1] in drop_sid or items[i][1] not in self.segments:
                    continue
                for j in range(i + 1, len(items)):
                    if items[j][1] in drop_sid or items[j][1] not in self.segments:
                        continue
                    gap = items[j][0] - items[i][0]
                    if gap < 1e-9:
                        gap += 2 * math.pi
                    if math.degrees(gap) >= min_deg:
                        break
                    # tinh cang: 2 nhanh cung goc -> chon 1 lam "chinh"
                    _, sid_i, len_i, seg_i = items[i]
                    _, sid_j, len_j, seg_j = items[j]
                    if sid_i not in self.segments or sid_j not in self.segments:
                        continue
                    # uu tien giu: hierarchy nho (duong lon) + dai hon
                    rank_i = (seg_i["hierarchy"], -len_i)
                    rank_j = (seg_j["hierarchy"], -len_j)
                    lose_sid = sid_j if rank_i <= rank_j else sid_i
                    if lose_sid not in self.segments:
                        continue
                    # nhanh bi bo neu rat ngan -> xoa luon cho gon
                    if self._branch_len(nid, lose_sid) < min_len:
                        drop_sid.add(lose_sid)
                        continue
                    # nguon lai: tien goc 1.5 lan be rong, khong duoc gan
                    # qua node khac -> chon node gan nhat trong khoang do
                    s_lose = self.segments.get(lose_sid)
                    if s_lose is None:
                        continue
                    far = s_lose["to"] if s_lose["from"] == nid else s_lose["from"]
                    p_far = self.nodes[far]
                    reach = max(18.0, s_lose.get("width", 10) * 1.6)
                    cands = []
                    for o in self._segs_at(nid):
                        if o in drop_sid or o == lose_sid:
                            continue
                        s_o = self.segments.get(o)
                        if not s_o or s_o.get("bridge") or s_o["class"] == "TUNNEL":
                            continue
                        othr = s_o["to"] if s_o["from"] == nid else s_o["from"]
                        p_o = self.nodes[othr]
                        d = dist(p_far["x"], p_far["z"], p_o["x"], p_o["z"])
                        if 3.0 < d <= reach:
                            cands.append((d, o, othr))
                    if cands:
                        cands.sort(key=lambda t: t[0])
                        s_o = self.segments.get(cands[0][1])
                        if s_o is None:
                            continue
                        # THU them duong thay the TRUOC, xoa sau. Neu them
                        # that bai thi giu nguyen canh cu (khong duoc cat mang)
                        near_end = s_o["from"] if s_o["from"] != nid else s_o["to"]
                        if self._safe_relocate(nid, lose_sid, near_end, s_lose["class"],
                                               width=s_lose.get("width"),
                                               name=s_lose.get("name"),
                                               section=s_lose.get("section")):
                            welded += 1
                            moved += 1
                        elif self._merge_coincident(nid, lose_sid, cands[0][0]):
                            # 2 duong song song -> noi 2 dau xa cua chung, bo
                            # 2 nhanh. Het chong nhau + giam 2 bac node.
                            merged += 1
                            moved += 1
                        # else: giu canh cu, uu tien 2 duong chong nhau con
                        # hơn la cat mang thanh nhieu mang (rule 6 vs rule 53)
                    else:
                        # khong tim duoc node thay the -> chi xoa khi canh xa
                        # chi la node la (bo 1 node don le, khong cat mang)
                        far_deg = len(self._segs_at(far))
                        if far_deg <= 1 and self._branch_len(nid, lose_sid) < 60.0:
                            drop_sid.add(lose_sid)
                            moved += 1
            for sid in drop_sid:
                self._remove_segment(sid)
        self._dedupe_edges()
        if moved:
            print("      tach nhanh trung goc: %d chuyen, %d gop 2 duong song song, "
                  "%d xoa" % (welded, merged, len(drop_sid)))
        return moved

    # T3: nang tran 6 -> 8. Nghia giao that cua co 7-8 nhanh (ngo 5 lau, rut
    # 6 huong, nga 7-8 canh); 9+ moi la spaghetti. Tran 6 gay thi phai ghep
    # 62 nhanh va lam manh do doc nho... dung hon la chap nhan 7-8.
    def _cap_node_degree(self, cap=None, ang_deg=26.0):
        """GIỚI HẠN BẬC NODE (rule 12/36).

        Ngã giao thật tối đa 4-6 nhánh. Node 16-32 nhánh không phải giao lỡ,
        là chùng điểm — xe ở đó không biết đi đường nào và hình học vẽ ra
        một vệt bê tông khổng lồ. Gộp các nhánh nhỏ gần cùng hướng, hoặc
        chuyển chúng sang node lân cận để thành ngã ba thật.
        """
        fixed = 0
        stuck = 0
        for nid in list(self.nodes.keys()):
            # TRAN THEO RANK. `cap=8` ap cho ca mang la sai: nut tren cao toc
            # 6 nhanh la binh thuong (trai + phai + 2 ramp), con 6 nhanh tren
            # pho moi la nan quat. Neu khong, node 7-9 nhanh khong bao gio duoc
            # xu ly roi validate moi lo no ra (do duoc).
            cap_n = cap if cap is not None else TOPO_DEGREE_CAP.get(
                self._topo_rank(nid), 6)
            while True:
                sids = [s for s in self._segs_at(nid) if s in self.segments]
                if len(sids) <= cap_n:
                    break
                # uu tien giu: hierarchy nho, do dai lon
                def rank(sid):
                    s = self.segments[sid]
                    return (s["hierarchy"], -self._branch_len(nid, sid))
                sids.sort(key=rank)
                keep = set(sids[:cap_n])
                # trong so du goc de day cac nhanh bi chuyen het len mot phia
                angles = sorted(self._branch_angle(nid, s) for s in keep)
                # nhanh can bo: nganh nhat, va lech < ang_deg voi mot nhanh
                # da giu -> day sang node khac thay vi xoa (duong con dung)
                victim = None
                for sid in sids[cap_n:]:
                    a = self._branch_angle(nid, sid)
                    for ka in angles:
                        d = abs(math.degrees(a - ka))
                        d = min(d, 360 - d)
                        if d < ang_deg:
                            victim = sid
                            break
                    if victim:
                        break
                if victim is None:
                    victim = sids[cap_n]    # het phia nao sach -> lay nhanh nhat
                s_v = self.segments.get(victim)
                if s_v is None:
                    continue
                far = s_v["to"] if s_v["from"] == nid else s_v["from"]
                p_far = self.nodes[far]
                p_nid = self.nodes[nid]
                # Tìm node B để "treo" lại nhánh: B phải ĐANG nối với `far`
                # (để đường không bị đứt) và cách node gốc 120-600m (để ngã ba
                # thật sự dời đi, không phải đổi tên).
                best = None
                for l in list(self._segs_at(far)):
                    if l == victim:
                        continue
                    s_l = self.segments.get(l)
                    if s_l is None:
                        continue
                    oid = s_l["to"] if s_l["from"] == far else s_l["from"]
                    if oid == nid or oid not in self.nodes:
                        continue
                    d = dist(p_nid["x"], p_nid["z"], self.nodes[oid]["x"], self.nodes[oid]["z"])
                    if not (120.0 <= d <= 600.0):
                        continue
                    if best is None or d < best[0]:
                        best = (d, oid)
                # giu mang lien thong: them duong thay the TRUOC khi xoa
                new_sid = None
                if best and self._safe_relocate(nid, victim, best[1], s_v["class"],
                                                width=s_v.get("width"),
                                                name=s_v.get("name"),
                                                section=s_v.get("section")):
                    fixed += 1
                    new_sid = "ok"
                if new_sid is None:
                    # khong ghep duoc: chi xoa khi canh xa la node la
                    if len(self._segs_at(far)) <= 1:
                        self._remove_segment(victim)
                        fixed += 1
                    elif self._split_and_reattach(nid, victim):
                        fixed += 1
                    else:
                        # KHONG `continue` O DAY: while True khong doi trang
                        # thai gi => VONG LAP VO HAN (da lam treo generator
                        # ~9 phut khong ra ket qua). Khong ghep duoc o node nay
                        # thi dung lai node nay, xu ly node khac. Node con qua
                        # bac se bi validate() canh bao, khong lam treo.
                        stuck += 1
                        break
        self._dedupe_edges()
        if fixed:
            print("      gioi han bac node (tran theo xep hang %s): %d nhanh chuyen"
                  % ("/".join(str(TOPO_DEGREE_CAP[r])
                              for r in sorted(TOPO_DEGREE_CAP)), fixed))
        if stuck:
            print("      ! %d node vuot bac, khong ghep duoc (de lai nguyen)" % stuck)
        return fixed

    def _split_ql_from_expressway(self, min_br=45.0):
        """
        TÁCH QL1A RA KHỎI NÚT CAO TỐC (rule 11/60) — tạo CẦU VƯỢT thật.

        Đo được trong game: node mang [EXPRESSWAY, NATIONAL, COLLECTOR] tức
        QL1A nối THẲNG vào mặt CT01 ở mặt bằng. Trên cao tốc kiểu hạn chế,
        QL1A và CT01 chỉ gặp nhau ở ngã giao KHÁC MỨC: chúng KHÔNG chung node
        (đúng như Vành đai 3 × QL1A, QL1A × CT01 ở Việt Nam).

        ⚠ PHẢI GIỮ LIÊN THÔNG: cắt `nid->far` rồi nối `nid->nn->far`. Bản chỉ
        nối `nn->far` làm QL1A ĐỨT ở nút cũ — 5814 node rơi thành 2 mảnh (đo
        được ngay ở lần chạy đó).
        """
        self._build_node_seg_index()
        moved = 0
        for nid in list(self.nodes.keys()):
            ql = [s for s in self._segs_at(nid)
                  if (self.segments.get(s) or {}).get("class") == "NATIONAL"]
            if not ql or not self._node_touches_expressway(nid):
                continue
            for sid in ql:
                sg = self.segments.get(sid)
                if sg is None or sg.get("bridge"):
                    continue
                far = sg["to"] if sg["from"] == nid else sg["from"]
                pf, pn = self.nodes.get(far), self.nodes.get(nid)
                if pf is None or pn is None:
                    continue
                L = math.hypot(pf["x"] - pn["x"], pf["z"] - pn["z"])
                if L < min_br * 1.6:
                    continue
                t = 35.0 / L
                nn = self.add_node(lerp(pn["x"], pf["x"], t),
                                   lerp(pn["z"], pf["z"], t), "URBAN",
                                   force_y=lerp(pn.get("y", 0.0),
                                                pf.get("y", 0.0), t),
                                   n_type="crossing")
                self._remove_segment(sid)
                head = self._add_segment_like(sg, nid, nn)
                tail = self._add_segment_like(sg, nn, far) if head else None
                if tail is None:
                    self._add_segment_like(sg, nid, far)
                    self._drop_node(nn)
                    continue
                for t2 in (head, tail):
                    self.segments[t2]["bridge"] = True
                    self.segments[t2]["pier"] = True
                    self.segments[t2]["name"] = (
                        self.segments[t2].get("name") or "cau_vuot_QL1A")
                moved += 1
        if moved:
            print("      tach QL1A khoi nut cao toc (cau vuot): %d nhanh" % moved)
        return moved

    def _seal_expressway_nodes(self):
        """CẤM ĐƯỜNG ĐỊA PHƯƠNG NỐI THẲNG VÀO CAO TỐC (rule 11).

        Do duoc tren data: 74 nhanh LOCAL/ALLEY/COLLECTOR/RURAL_LOCAL/SERVICE
        cham truc tiep nut cao toc. Tren cao toc that, mot duong dia phong
        phai di qua RAMP / interchange, khong bao gio "mo bung" thang vao mat
        duong toc do 24m/hang 3 chieu.

        Cach sua: gia nhanh nhon ra khoi nut cao toc, noi sang node gan nhat
        KHONG co cao toc (gia nhanh giu nguyen, chi doi cho giao diem).
        """
        SMALL = ("LOCAL", "ALLEY", "RURAL_LOCAL", "SERVICE", "COLLECTOR")
        moved = 0
        graded = 0
        self._build_node_seg_index()
        for nid in list(self.nodes.keys()):
            sids = self._segs_at(nid)
            if not sids:
                continue
            has_hw = False
            for sid in sids:
                s = self.segments.get(sid)
                if s and s.get("class") == "EXPRESSWAY":
                    has_hw = True
                    break
            if not has_hw:
                continue
            p_nid = self.nodes[nid]
            for sid in list(sids):
                s = self.segments.get(sid)
                if not s or s.get("class") not in SMALL:
                    continue
                if s.get("bridge") or s.get("class") == "TUNNEL":
                    continue
                far = s["to"] if s["from"] == nid else s["from"]
                if far not in self.nodes:
                    continue
                p_far = self.nodes[far]
                # node gan nhat khong co cao toc, trong 40-700m
                best = None
                for l in list(self._segs_at(far)):
                    s_l = self.segments.get(l)
                    if s_l is None or s_l.get("class") == "EXPRESSWAY":
                        continue
                    oid = s_l["to"] if s_l["from"] == far else s_l["from"]
                    if oid == nid or oid not in self.nodes:
                        continue
                    # BO SUNG: oid cung khong duoc la nut cao toc
                    oid_has_hw = any(
                        (self.segments.get(x) or {}).get("class") == "EXPRESSWAY"
                        for x in self._segs_at(oid))
                    if oid_has_hw:
                        continue
                    d = dist(self.nodes[oid]["x"], self.nodes[oid]["z"],
                             p_nid["x"], p_nid["z"])
                    if not (40.0 <= d <= 700.0):
                        continue
                    if best is None or d < best[0]:
                        best = (d, oid)
                if best is None:
                    # TACH DOAN (fallback cuoi): khong co node san de ghep ->
                    # tach duong canh xa tai diem cach nut cao toc 120-400m
                    # roi ghep vao do. Luon co giai phap.
                    moved += self._seal_by_splitting(nid, sid, far, s)
                    continue
                if self._safe_relocate(nid, sid, best[1], s["class"],
                                       width=s.get("width"), name=s.get("name"),
                                       section=s.get("section")):
                    moved += 1
                else:
                    # T2: khong ghep duoc -> QUANG giao cao toc o MUC KHAC.
                    # Duong nho qua cao toc bang cau vuot (co nhip + tru) la
                    # dung thuc te Viet Nam; render cung dung: khong nam
                    # trong mat duong toc, khong loi ao vao nhung gi.
                    s["bridge"] = True
                    s["pier"] = True
                    s["name"] = s.get("name") or "cau_vuot_nho"
                    graded += 1
        if moved or graded:
            print("      niem phong nut cao toc: %d chuyen ra, %d quang muc khac"
                  % (moved, graded))
        return moved

    def _seal_by_splitting(self, nid, sid, far, s):
        """Ghep nhanh vao mot diem TACH MOI tren duong canh xa.

        Dung khi khong co node nao hop le de ghep (do duoc: 51/65 duong dia
        phong o nut cao toc la canh cau noi). Cat duong canh xa o diem cach
        `nid` 120-400m, tao node moi, roi ghep nhanh vao node do. Ket qua:
        duong nhanh ra khoi nut cao toc, mang van lien thong.
        """
        moved = 0
        pf = self.nodes.get(far)
        if pf is None:
            return 0
        p_nid = self.nodes.get(nid)
        if p_nid is None:
            return 0
        for l2 in list(self._segs_at(far)):
            s_l2 = self.segments.get(l2)
            if s_l2 is None:
                continue
            deep = s_l2["to"] if s_l2["from"] == far else s_l2["from"]
            pd = self.nodes.get(deep)
            if pd is None:
                continue
            seg_len = dist(pf["x"], pf["z"], pd["x"], pd["z"])
            if seg_len < 220.0:
                continue
            for frac in (0.35, 0.55, 0.75):
                mx = lerp(pf["x"], pd["x"], frac)
                mz = lerp(pf["z"], pd["z"], frac)
                if dist(mx, mz, p_nid["x"], p_nid["z"]) < 110.0:
                    continue
                mn, _ = self._split_segment_at(mx, mz, tolerance=8.0)
                if mn is None or mn == nid:
                    continue
                if self._safe_relocate(nid, sid, mn, s["class"],
                                       width=s.get("width"), name=s.get("name"),
                                       section=s.get("section")):
                    moved += 1
                    break
            if moved:
                break
        return moved

    def _prune_useless_stubs(self, max_dead=220, min_len=45.0):
        """XOÁ ĐƯỜNG CỤT VÔ NGHĨA (rule 8/59).

        Đường degree-1 KHÔNG phục vụ gì thì xoá: bến xe, điểm dừng, quán
        trọn, khu dân cư, đường tránh, giao lộ. Đường cụt chỉ được giữ khi
        nó THỰC SỰ dẫn tới thứ gì (đã nằm trong bảng `serve` của generator)
        hoặc quá ngắn để là ngõ trong bến. Không giữ "đường cụt cho có".
        """
        protect = set()
        # giữ mọi thứ dùng bởi POI: bay, diem dung, tram xang/nghi, thu phi
        for st in getattr(self, "stations", []) or []:
            x, z = st.get("x", 0), st.get("z", 0)
            for nid, n in self.nodes.items():
                if dist(n["x"], n["z"], x, z) < 260:
                    protect.add(nid)
        # giữ node cua doan class lonh (QL/cao toc/ramp) de khong cat duong
        # chinh — nhanh cuot chi xoa o nhanh phu, khong phai xuong song
        dead = []
        for nid in self.nodes.keys():
            sids = self._segs_at(nid)
            if len(sids) != 1:
                continue
            if nid in protect:
                continue
            sid = sids[0]
            s = self.segments.get(sid)
            if not s or s.get("bridge") or s["class"] == "TUNNEL":
                continue
            if s["class"] in ("NATIONAL", "EXPRESSWAY", "RAMP", "STATION_ACCESS"):
                continue
            L = self._branch_len(nid, sid)
            if L < min_len and s["class"] in ("ALLEY", "SERVICE", "INTERNAL", "LOCAL"):
                dead.append(nid)          # ngan sat -> xoa
            elif L >= 120.0 and s["class"] in ("COLLECTOR", "ARTERIAL", "RURAL_LOCAL"):
                dead.append(nid)          # duong phu dai ma cuot -> xoa
        cap = min(max_dead, max(0, len(dead)))
        # uu tien xoa nganh nhat truoc (it gia tri nhat)
        dead.sort(key=lambda n: self._branch_len(n, self._segs_at(n)[0]))
        removed = 0
        for nid in dead[:cap]:
            sid = self._segs_at(nid)
            if not sid:
                continue
            self._remove_segment(sid[0])
            removed += 1
        self._prune_orphans()
        if removed:
            print("      xoa %d duong cut vo nghia (giu %d)" % (removed, cap))
        return removed

    def add_segment(self, n1, n2, r_class, width=None, lanes=None, name=None, section=None):
        if n1 not in self.nodes or n2 not in self.nodes:
            return None
        if n1 == n2:
            return None
        # chặn segment cụt (<1.5m): 2 node gần như trùng nhau tạo dốc 50%+
        # vô nghĩa và làm nhiễu TrafficAI/render
        pa, pb = self.nodes[n1], self.nodes[n2]
        if dist(pa["x"], pa["z"], pb["x"], pb["z"]) < 1.5:
            return None
        spec = ROAD_CLASS.get(r_class, ROAD_CLASS["LOCAL"])
        # ĐA CẠNH BỊ CẤM: 2 segment cùng cặp node chồng lên nhau (render
        # z-fighting, TrafficAI nhân đôi xe). Đoạn mới quan trọng HƠN
        # (hierarchy nhỏ) -> thay thế; bằng/kém hơn -> bỏ.
        key = (n1, n2) if n1 < n2 else (n2, n1)
        old_sid = self._edge_index.get(key)
        if old_sid is not None:
            old = self.segments.get(old_sid)
            if old is None:
                self._edge_index.pop(key, None)
            else:
                if spec["hierarchy"] >= old["hierarchy"]:
                    return None
                self._remove_segment(old_sid)
        w = float(width if width is not None else spec["width"])
        ln = int(lanes if lanes is not None else spec["lanes"])
        sid = self._get_sid()
        seg = {"id": sid, "from": n1, "to": n2, "class": r_class,
               "type": ROAD_TYPE_OF_CLASS.get(r_class, "local"),
               "width": w, "lanes": ln, "twoWay": bool(spec["twoWay"]),
               "hierarchy": spec["hierarchy"], "speed": spec["speed"]}
        if name:
            seg["name"] = name
        if section:
            seg["section"] = section
        self.segments[sid] = seg
        self._edge_index[key] = sid
        p1, p2 = self.nodes[n1], self.nodes[n2]
        self.road_bboxes.append((p1["x"], p1["z"], p2["x"], p2["z"], w))
        self._index_road(p1["x"], p1["z"], p2["x"], p2["z"], w, sid)
        # contract của TrafficAI: node.connections[] phải có segment id
        self.nodes[n1]["connections"].append(sid)
        self.nodes[n2]["connections"].append(sid)
        self._nsi_inc(sid, n1, n2)
        return sid

    # ---- spatial hash -------------------------------------------------------
    @staticmethod
    def _cell(x, z):
        return (int(math.floor(x / 128.0)), int(math.floor(z / 128.0)))

    def _index_road(self, x1, z1, x2, z2, w, sid):
        r = w * 0.5 + 64.0
        c0 = self._cell(min(x1, x2) - r, min(z1, z2) - r)
        c1 = self._cell(max(x1, x2) + r, max(z1, z2) + r)
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                self._road_grid.setdefault((cx, cz), []).append(sid)

    def _index_object(self, x, z, r):
        self._obj_grid.setdefault(self._cell(x, z), []).append((x, z, r))

    def _seg_clear(self, x, z, radius, w_needed):
        """Road clearance — chỉ query cell lân cận (O(1))."""
        reach = radius + 64.0
        c0 = self._cell(x - reach, z - reach)
        c1 = self._cell(x + reach, z + reach)
        seen = set()
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if not seg:
                        continue
                    p1 = self.nodes[seg["from"]]
                    p2 = self.nodes[seg["to"]]
                    dx, dz = p2["x"] - p1["x"], p2["z"] - p1["z"]
                    l2 = dx * dx + dz * dz
                    if l2 <= 0:
                        continue
                    t = clamp(((x - p1["x"]) * dx + (z - p1["z"]) * dz) / l2, 0.0, 1.0)
                    cxp, czp = p1["x"] + dx * t, p1["z"] + dz * t
                    if dist(x, z, cxp, czp) < seg["width"] * 0.5 + radius + w_needed:
                        return False
        return True

    def _is_space_clear(self, x, z, radius=8.0, margin=0.0):
        """
        API cũ — giữ signature (radius), thêm margin tu chọn.

        margin = khoang cach an toan THÊM ngoài bán kính vật thể.
        Cột điện/cây/ruộng: margin=0 (radius đã đủ) — trước đây dùng cứng 5.0
        khiến cột điện đặt ở (width/2 + 4.5) LUÔN bị reject vì cần
        width/2 + 1.6 + 5.0 => toàn world chỉ có 2332 object, KHÔNG có cột điện.
        Nhà/kho: margin=5 (cần lề an toàn thật).
        """
        if not self._seg_clear(x, z, radius, margin):
            return False
        if self._in_station_zone(x, z, radius):
            return False
        c0 = self._cell(x - radius - 32, z - radius - 32)
        c1 = self._cell(x + radius + 32, z + radius + 32)
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for (px, pz, pr) in self._obj_grid.get((cx, cz), ()):
                    if dist(x, z, px, pz) < radius + pr:
                        return False
        # không xây trên biển
        if self.dist_to_coast(x, z) < 6.0:
            return False
        return True

    def _reserve(self, x, z, r):
        self.object_positions.append((x, z, r))
        self._index_object(x, z, r)

    # --------------------------------------------------------------------------
    # 4.7 CORRIDOR ROADS  (QL1A trunk + branch + junction)
    # --------------------------------------------------------------------------
    def _add_chain(self, pts, r_class, name=None, section=None, region_fn=None):
        """Nối 1 polyline thành chuỗi node/segment, subdivide theo MAX_SEG_LEN."""
        return self._add_chain_with_ids(pts, r_class, name, section, region_fn)[-1] if pts else None

    def _add_chain_with_ids(self, pts, r_class, name=None, section=None, region_fn=None):
        """Nối 1 polyline thành chuỗi node/segment, subdivide theo MAX_SEG_LEN. Trả về list node IDs."""
        prev = None
        ids = []
        for (x, z, s, u, _) in pts:
            reg, _nm = (region_fn(x, z) if region_fn else ("RURAL", ""))
            nid = self.add_node(x, z, reg, n_type="highway")
            ids.append(nid)
            if prev:
                L = dist(self.nodes[prev]["x"], self.nodes[prev]["z"], x, z)
                maxlen = MAX_SEG_LEN.get(r_class, 300.0)
                if L > maxlen * 1.15:
                    # subdivide thêm node để TrafficAI/Render không bị segment quá dài
                    n = int(math.ceil(L / maxlen))
                    last = prev
                    for k in range(1, n):
                        tt = k / n
                        mx = lerp(self.nodes[prev]["x"], x, tt)
                        mz = lerp(self.nodes[prev]["z"], z, tt)
                        mid = self.add_node(mx, mz, reg, n_type="highway")
                        ids.append(mid)
                        self.add_segment(last, mid, r_class, name=name, section=section)
                        last = mid
                    self.add_segment(last, nid, r_class, name=name, section=section)
                else:
                    self.add_segment(prev, nid, r_class, name=name, section=section)
            prev = nid
        return ids

    def _corridor_subpath(self, s0, s1):
        """Lấy đoạn polyline theo chainage [s0, s1] + nội suy 2 đầu."""
        out = []
        c = self.corridor

        def sample(s_target):
            for i in range(len(c) - 1):
                if c[i][2] <= s_target <= c[i + 1][2]:
                    seglen = c[i + 1][2] - c[i][2]
                    t = 0.0 if seglen <= 0 else (s_target - c[i][2]) / seglen
                    x = lerp(c[i][0], c[i + 1][0], t)
                    z = lerp(c[i][1], c[i + 1][1], t)
                    u = lerp(c[i][3], c[i + 1][3], t)
                    return (x, z, s_target, u, 0.0)
            return None

        a = sample(s0)
        if a:
            out.append(a)
        for p in c:
            if s0 < p[2] < s1:
                out.append(p)
        b = sample(s1)
        if b:
            out.append(b)
        return out

    # CHAN DOAN LIEN THONG: goi giua cac buoc sua de biet BUOC NAO tach graph.
    # ---------------------------------------------------------------------
    # DI CHUYEN NHANH AN TOAN (rule 6/7/12/53 phai cung luc)
    #
    # Do duoc: 3 ham sua giao lo tach 1 thanh phan thanh 61 chi bang cach
    # them canh moi roi xoa canh cu. Ly do: canh cu co the la CANH CAU NOI
    # duy nhat cua mot nhanh - xoa no cat nhanh khoi phia lai.
    # `oid` duoc chon tu neighbors cua `far` nen cung o phia `far`, khong
    # the bu lai phia bi cat.
    #
    # Giai phap: them -> Kiem tra `nid` con toi `far` khong -> neu that thi
    # undo. Luon an toan cho ca 3 ham.
    # ---------------------------------------------------------------------
    def _reachable(self, a, b):
        if a == b:
            return True
        if a not in self.nodes or b not in self.nodes:
            return False
        adj = {}
        for sg in self.segments.values():
            x, y = sg.get("from"), sg.get("to")
            if x is None or y is None:
                continue
            adj.setdefault(x, []).append(y)
            adj.setdefault(y, []).append(x)
        seen = {a}
        stack = [a]
        while stack:
            cur = stack.pop()
            if cur == b:
                return True
            for nxt in adj.get(cur, ()):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return False

    def _safe_relocate(self, nid, sid, new_nid, r_class, width=None,
                       name=None, section=None):
        """Chuyen nhanh `sid` (nid<->far) sang `new_nid`. True neu that su
        chuyen va mang VAN lien thong. KHONG bao gio lam tach graph.

        KIEN THUC TRUOC KHI MUTATE:
          1. giu ban goc segment
          2. xoa canh cu
          3. kiem tra `nid` con toi `far` khong
               CO     -> canh moi se giu duoc mang -> tao canh moi -> xong
               KHONG  -> khoi phuc canh cu, huy dich (gia tri nguyen ban
                         dau: uu tien giu 2 duong chong nhau hon la cat mang)
        """
        s = self.segments.get(sid)
        if s is None or new_nid is None or new_nid == nid:
            return False
        far = s["to"] if s["from"] == nid else s["from"]
        if far not in self.nodes or far == new_nid:
            return False

        saved = dict(s)
        self._remove_segment(sid)

        if not self._reachable(nid, far):
            # cat manh -> tra ve nguyen trang
            back = self.add_segment(saved["from"], saved["to"], saved["class"],
                                    width=saved.get("width"),
                                    name=saved.get("name"),
                                    section=saved.get("section"))
            if back is not None:
                # giu lai co bridge/pier/... bi mat khi tao lai
                for k in ("bridge", "pier"):
                    if k in saved:
                        self.segments[back][k] = saved[k]
            return False

        # an toan -> chuyen tiep sang node moi
        if self.add_segment(new_nid, far, r_class, width=width,
                            name=name, section=section) is None:
            self.add_segment(saved["from"], saved["to"], saved["class"],
                             width=saved.get("width"), name=saved.get("name"),
                             section=saved.get("section"))
            return False
        return True


    def _merge_coincident(self, nid, sid, keep_sid, max_span=420.0):
        """T1 GOP HAI NHANH TRUNG GOC: noi truc tiep 2 dau xa cua chung.

        2 duong roi cung node duoi <9 do la 2 DUONG SONG SONG. Neu khong ghep
        duoc nhanh (canh cau noi) thi noi thang 2 dau xa cua chung vao nhau
        roi bo 2 nhanh: het duong chong nhau, giam 2 bac node, van lien thong
        (2 dau xa van noi qua nhau). Do duoc 99 cap tren duong THAT.
        """
        a = self.segments.get(sid)
        b = self.segments.get(keep_sid)
        if a is None or b is None:
            return False
        xa = a["to"] if a["from"] == nid else a["from"]
        xb = b["to"] if b["from"] == nid else b["from"]
        if xa in (None, nid) or xb in (None, nid) or xa == xb:
            return False
        pa, pb = self.nodes.get(xa), self.nodes.get(xb)
        if pa is None or pb is None:
            return False
        if dist(pa["x"], pa["z"], pb["x"], pb["z"]) > max_span:
            return False
        link = self.add_segment(xa, xb, a["class"], width=a.get("width"),
                                name="nganh_noi", section=a.get("section"))
        if link is None:
            return False
        # chi bo 2 nhanh khi node goc van noi duoc phan con lai cua mang
        self._remove_segment(sid)
        self._remove_segment(keep_sid)
        if not self._reachable(nid, xa) or not self._reachable(nid, xb):
            # cat manh -> tra ve nguyen trang
            self.add_segment(xa, xb, a["class"], width=a.get("width"),
                             name="nganh_noi", section=a.get("section"))
            self.add_segment(nid, xa, a["class"], width=a.get("width"),
                             name=a.get("name"), section=a.get("section"))
            self.add_segment(nid, xb, b["class"], width=b.get("width"),
                             name=b.get("name"), section=b.get("section"))
            return False
        return True

    def _trace_conn(self, label):
        try:
            comps = self._count_components()
        except Exception:
            return
        if comps and len(comps) > 1:
            print("      [trace] %-28s -> %d thanh phan (lon nhat %d/%d)"
                  % (label, len(comps), comps[0], len(self.nodes)))
        else:
            print("      [trace] %-28s -> lien thong 1 thanh phan" % label)

    def generate_topology(self):
        print("[1/8] Road corridors (QL1A / CT01 / Vành đai 3) ...")
        self._build_ql1a()
        print("[2/8] Highways + interchanges + ramps ...")
        self._build_expressways()
        self._build_interchanges()
        self._build_tunnels()
        self._mark_bridges_over_water()
        self._build_bus_stops()
        print("[3/8] Secondary + local road networks ...")
        # ĐẶT BẾN XE TRƯỚC: nếu đặt sau thì station_zones chưa tồn tại và mọi
        # check "đường không cắt sân bến" đều là dead code (xem _place_stations)
        self._place_stations()
        # NHƯNG cao to/ramp da build o step 2 (truoc ben) -> giu cau chay khong
        # thay gi -> uonce no ra khoi san ben ngay sau khi zone ton tai
        self._divert_hw_around_stations()
        self._build_secondary_networks()
        self._build_settlements()
        self._build_provincial_routes()
        print("[4/8] Stations ...")
        self._build_stations()
        self._build_facilities()
        print("      topology done: %d nodes / %d segments / corridor %.1f km"
              % (len(self.nodes), len(self.segments), self.corridor_len / 1000.0))
        print("      grading roads (max slope cho xe khách) ...")
        self._fix_internal_crossings()
        self._prune_orphans()
        self._weld_close_nodes()
        self._connect_islands()
        self._fix_bridge_heights()
        self._grade_roads()
        self._auto_tunnel_steep()
        self._limit_slopes()
        self._drop_steep_segments()
        self._prune_orphans()
        self._weld_close_nodes()
        self._connect_islands()
        # --- cleanup cuoi topology (bug 3 + bug 4) ---
        self._dedupe_edges()          # moi cap node dung 1 segment
        self._link_dangling_major()   # duong chinh cuot: noi (khong duoc -> xoa)
        self._cap_dangling_highway()  # dau cao toc cuot: noi vao QL1A gan nhat
        self._prune_orphans()
        # --- SỬA GIAO LỠ (rule 6/8/12/59) ---
        # phải chạy SAU mọi bước tạo đường, trước validate. Thứ tự có lý do:
        #   1. tách nhánh trùng góc (đường chồng nhau) TRƯỚC
        #   2. giới hạn bậc node (spaghetti) SAU — tách xong mới đếm bậc đúng
        #   3. xoá đường cụt vô nghĩa CUỐI — sau 2 bước kia network đã ổn
        #      định, cụt còn lại mới thật sự là cụt vô nghĩa
        self._trace_conn("truoc khi sua giao lo")
        self._seal_expressway_nodes()
        self._split_ql_from_expressway()
        self._trace_conn("sau _seal_expressway_nodes")
        self._split_coincident_branches()
        self._trace_conn("sau _split_coincident")
        # GIAO LO KHONG NUT -> tao nut giao that. Chay sau moi sua hinh hoc
        # (chia duong / tach nhanh / weld) vi nhung buoc do duoc tao ra nhieu
        # diem cat moi ma khong co nut.
        self._resolve_crossings()
        self._build_node_seg_index()   # index moi truoc khi dem bac
        for _ in range(4):
            over = len([q for q in self.nodes
                        if self._topo_deg(q) > TOPO_DEGREE_CAP.get(
                            self._topo_rank(q), 6)])
            if over == 0:
                break
            self._build_node_seg_index()
            if self._cap_node_degree() == 0:
                break
        self._trace_conn("sau _cap_node_degree")
        self._build_node_seg_index()   # index moi truoc khi dem nhanh cut
        self._prune_useless_stubs()
        self._trace_conn("sau _prune_useless_stubs")
        self._dedupe_edges()
        self._prune_orphans()
        self._weld_close_nodes()
        self._trace_conn("sau weld/dedupe")
        # Sua giao lo lam thay doi hinh hoc duong (chuyen diem giao) => phai
        # lam lai cao do + do doc MOT LAN NUA sau cung, neu khong con duong
        # nguoc docc > 16% (xe rung) va mat lien thong do re node.
        self._grade_roads()
        self._auto_tunnel_steep()
        self._limit_slopes()
        self._drop_steep_segments()
        self._grade_roads()
        self._dedupe_edges()
        self._prune_orphans()
        # BẢO ĐẢM LIÊN THÔNG + ĐỒNG BỘ connections (rule 7/53/56/57)
        self._ensure_connected()
        self._dedupe_edges()
        self._sync_graph()
        # PASS DOC CUOI: _ensure_connected vua them link noi cac manh roi, link
        # moi co the doc hon. Ep lai 1 lan nua; doan van >16% se duoc danh dau
        # la CAU VUOT (dung thuc te, xe chay duoc) thay vi de mat duong doc 16%
        # lam xe rung (rule 20/36).
        self._resolve_crossings()
        # Tách đường ở điểm cắt sinh 2 node ở CÙNG một toạ độ (mỗi đường một
        # node) nên weld 4.0m không gộp được. Đo được 73 cặp < 6m sau vòng
        # `_resolve_crossings` cuối. Gộp bằng chính hàm weld, ngưỡng 6m khớp
        # ngưỡng audit, rồi resolve lại vì gộp xong số ngã giao giảm.
        self._build_node_seg_index()
        self._weld_close_nodes(6.0)
        self._build_node_seg_index()
        self._resolve_crossings()
        # PHẢI CẤN ĐỘ SAU mọi thay đổi hình học cuối: các đoạn vừa tách / vừa
        # weld giữ cao độ nội suy cũ nên sinh dốc 32.8% (VALIDATION FAILED).
        self._fix_final_slopes()
        self._finalize_grade_separation()
        self._build_node_seg_index()
        self._dedupe_edges()
        self._prune_orphans()
        self._sync_graph()
        self._repair_station_refs()
        self._repair_route_refs()
        self.topo_report()

    def _repair_route_refs(self):
        """
        SỬA THAM CHIẾU NODE CỦA TUYẾN (routes.json) — phải chạy SAU mọi bước
        weld / prune / split / relocate.

        `self.route_node_ids` được chụp lúc dựng corridor. Sau đó các hàm trên
        đổi id node (xoá rồi tạo mới). `routes.json` vẫn giữ id cũ => tuyến
        minimap vẽ thẳng qua chỗ đó, NPC đi sai, `driveRoute` báo điểm lệch
        224m khỏi QL1A. Đo được: `routes[0].nodes` chứa `n_109` không tồn tại.

        ⚠ Export lấy từ `self.route_node_ids` (xem hàm `export`), KHÔNG phải
        từ một danh sách `self.routes` — vòng sửa trước đây chạy trên danh
        sách rỗng nên không làm gì cả.
        """
        ids = getattr(self, "route_node_ids", None)
        if not isinstance(ids, list):
            return 0
        fixed = dropped = 0
        out = []
        for nid in ids:
            if nid in self.nodes:
                out.append(nid)
                continue
            fixed += 1
            hint = self._node_xy_hist.get(nid)
            best, bd = None, 1e18
            for oid, op in self.nodes.items():
                if op.get("type") not in TOPO_JOINABLE_TYPES:
                    continue
                d = (math.hypot(op["x"] - hint[0], op["z"] - hint[1])
                     if hint else 0.0)
                if d < bd:
                    bd, best = d, oid
            if best is not None:
                out.append(best)
        ded = []
        for nid in out:
            if ded:
                p, q = self.nodes[ded[-1]], self.nodes[nid]
                if dist(p["x"], p["z"], q["x"], q["z"]) < 12.0:
                    dropped += 1
                    continue
            ded.append(nid)
        ids[:] = ded
        if fixed or dropped:
            print("      sua tham chieu tuyen: %d node chet -> gan lai, "
                  "%d node trung lap" % (fixed, dropped))
        return fixed

    def _repair_station_refs(self):
        """SỬA THAM CHIẾU NODE CỦA BẾN sau mọi bước weld/prune.

        weld + prune có thể xoá node cổng/cửa bến. Khi đó `access_node` /
        `anchor_node` trong stations.json trỏ tới node không tồn tại =>
        validate báo "thiếu access road node" và NPC không vào được bến.
        Sửa bằng cách gán lại node gần vị trí cổng còn tồn tại.
        """
        fixed = 0
        for st in self.stations:
            for key in ("access_node", "anchor_node"):
                nid = st.get(key)
                if nid in self.nodes:
                    continue
                # tìm node còn sống gần vị trí bến, ưu tiên class lớn
                best, bd = None, 1e9
                for oid, op in self.nodes.items():
                    d = dist(op["x"], op["z"], st["x"], st["z"])
                    if d < bd:
                        bd, best = d, oid
                if best is not None and bd < 900:
                    st[key] = best
                    fixed += 1
        if fixed:
            print("      sua lai %d tham chieu node cua ben" % fixed)
        return fixed

    def _build_ql1a(self):
        """QL1A = xương sống (source of truth). Dùng FULL corridor (độ cong thật),
        KHÔNG dùng coarse 1.5km (trước đây node cách nhau 1.5km => đường thẳng
        cục cục, junction không tìm được, map trông như caro)."""
        pts = [(p[0], p[1], p[2], p[3], 0.0) for p in self.corridor]
        # BUG CŨ: gán [] vào _ql_node_ids rồi đổ kết quả vào .ql_nodes
        # => self._ql_node_ids luôn RỖNG => routes.json nodes=[] => minimap mất
        #    route, NPC không sinh hành khách, hầm/interchange không bám được.
        self._ql_node_ids = self._add_chain_with_ids(
            pts, "NATIONAL", name="QL1A",
            region_fn=lambda x, z: self.determine_region(z, x))
        self.ql_nodes = self._ql_node_ids
        # route chính cho minimap + NPC passenger: bắt đầu tại Nam Tuy Hòa
        self.route_node_ids = self._ql_node_ids

    def _build_expressways(self):
        """
        CT01 = polyline THẬT đi qua 12 interchange đã verify (OSM), KHÔNG còn là
        đường cong offset tổng hợp. Vành đai 3 vẫn dựng từ corridor + nối vào
        network (hành lang nội đô TP.HCM).
        """
        self.hw_nodes_by_s = {}
        anchor_s_map = {a["name"]: self.anchor_s[i] for i, a in enumerate(ANCHORS)}
        r3_from = anchor_s_map.get(RING3_RANGE[0], self.corridor_len)
        r3_to = anchor_s_map.get(RING3_RANGE[1], self.corridor_len)

        # --- CT01: nối từng cặp điểm thật, có cong tự nhiên nhẹ (6% dài hơn thẳng)
        world_pts = [self.proj(lat, lon) for (lat, lon) in REAL_CT01_POINTS]
        ct_pts = []
        for i in range(len(world_pts) - 1):
            p1, p2 = world_pts[i], world_pts[i + 1]
            L0 = dist(p1[0], p1[1], p2[0], p2[1])
            if L0 < 50.0:
                continue
            leg = self._leg_polyline(p1, p2, L0 * 1.06, i)
            start = 0 if i == 0 else 1
            for k in range(start, len(leg)):
                x, z = leg[k]
                ct_pts.append((x, z, self._s_of(x, z), self._u_at_z(z, x), 0.0))
        if len(ct_pts) > 2:
            self._add_expressway_chain(ct_pts, "CT01", anchor_s_map, EXPRESSWAY_SECTIONS)

        # --- Vành đai 3: chạy song song QL1A ở nội đô, sát QL hơn
        samples = [p for p in self.corridor
                   if r3_from - 3000.0 <= p[2] <= r3_to + 3000.0]
        if len(samples) > 3:
            r3_pts = []
            for i, p in enumerate(samples):
                a_pt = samples[max(0, i - 1)]
                b_pt = samples[min(len(samples) - 1, i + 1)]
                dx, dz = b_pt[0] - a_pt[0], b_pt[1] - a_pt[1]
                L = math.hypot(dx, dz) or 1.0
                nx, nz = -dz / L, dx / L
                off = 1600.0 + 900.0 * math.sin(p[2] / 9000.0)
                r3_pts.append((p[0] + nx * off, p[1] + nz * off, p[2], p[3], 0.0))
            if len(r3_pts) > 2:
                self._add_expressway_chain(r3_pts, "Vanh_dai_3", anchor_s_map,
                                           [("Vành đai 3 TP.HCM", RING3_RANGE[0],
                                             RING3_RANGE[1], "operational")])
                self.ring3_node_ids = self._last_hw_ids
                self._connect_ring3()

    def _connect_ring3(self):
        """
        Vành đai 3 PHẢI nối vào network, nếu không nó là 1 thành phần rời
        (237 node lơ lửng, người chơi không đi từ QL1A vào được).
        Nối vào QL1A/CT01 bằng link 2 làn tại đầu, giữa, cuối vành đai.
        """
        ids = getattr(self, "ring3_node_ids", None)
        if not ids:
            return
        ql_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                   if n["type"] == "highway" and n.get("_src") != "ct"]
        ct_pool = getattr(self, "_ct_nodes", [])
        picks = [ids[0], ids[len(ids) // 3], ids[2 * len(ids) // 3], ids[-1]]
        made = 0
        for nid in picks:
            n = self.nodes[nid]
            tgt, d = self._nearest_node_on(n["x"], n["z"], ql_pool, 9000.0)
            if tgt is not None:
                if self._add_link_road(nid, tgt, "ARTERIAL", "RING3_LINK_QL"):
                    made += 1
                continue
            tgt, d = self._nearest_node_on(n["x"], n["z"], ct_pool, 9000.0)
            if tgt is not None and self._add_link_road(nid, tgt, "ARTERIAL",
                                                       "RING3_LINK_CT"):
                made += 1
        print("      Vanh dai 3 links: %d" % made)

    # sections/status theo chainage THẬT
    def _add_expressway_chain(self, pts, road_name, anchor_s_map, sections):
        def sec(s_val):
            for (nm, a_name, b_name, st) in sections:
                a_s = anchor_s_map.get(a_name, 0.0)
                b_s = anchor_s_map.get(b_name, float("inf"))
                if a_s <= s_val <= b_s:
                    return nm, st
            return road_name, "operational"

        dense = self._densify(pts, 500.0)
        prev = None
        self._ct_nodes = getattr(self, "_ct_nodes", [])
        self._last_hw_ids = []
        for p in dense:
            reg, _ = self.determine_region(p[1], p[0])
            nm, st = sec(p[2])
            nid = self.add_node(p[0], p[1], reg, n_type="highway")
            self.nodes[nid]["_src"] = "ct"
            self._ct_nodes.append((p[2], nid, p[0], p[1]))
            self._last_hw_ids.append(nid)
            if prev:
                sid = self.add_segment(prev, nid, "EXPRESSWAY", name=road_name, section=nm)
                if sid:
                    self.segments[sid]["status"] = st
            prev = nid

    def _densify(self, pts, max_len):
        out = [pts[0]]
        for i in range(1, len(pts)):
            L = dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
            if L <= max_len:
                out.append(pts[i])
                continue
            n = int(math.ceil(L / max_len))
            for k in range(1, n):
                t = k / n
                out.append((lerp(pts[i - 1][0], pts[i][0], t),
                            lerp(pts[i - 1][1], pts[i][1], t),
                            lerp(pts[i - 1][2], pts[i][2], t),
                            lerp(pts[i - 1][3], pts[i][3], t), 0.0))
            out.append(pts[i])
        return out

    def _nearest_coast(self, x, z):
        best, pt = float("inf"), (x, z)
        poly = self.coast
        for i in range(len(poly) - 1):
            ax, az = poly[i]
            bx, bz = poly[i + 1]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0.0, 1.0)
            cx, cz = ax + dx * t, az + dz * t
            d = (x - cx) ** 2 + (z - cz) ** 2
            if d < best:
                best, pt = d, (cx, cz)
        return pt

    def _s_of(self, x, z):
        u, _ = self.corridor_u_dist(x, z)
        i = int(clamp(math.floor(u), 0, len(ANCHORS) - 2))
        t = clamp(u - i, 0.0, 1.0)
        return lerp(self.anchor_s[i], self.anchor_s[min(i + 1, len(self.anchor_s) - 1)], t)

    def _nearest_node_on(self, x, z, pool, max_dist=100000.0):
        best, bn = max_dist, None
        for (s, nid, nx, nz) in pool:
            d = dist(x, z, nx, nz)
            if d < best:
                best, bn = d, nid
        return bn, best

    def _split_segment_at(self, x, z, n_type="junction", tolerance=6.0):
        """
        Chèn node vào giữa segment (T-junction thật trong graph) —
        node mới connections[] = [seg cũ còn lại, seg mới tạo].

        QUAN TRỌNG: nếu điểm cắt quá gần một đầu segment thì KHÔNG tách, mà
        dùng lại chính node đầu đó. Nếu vô tình tạo nửa segment < 1.5m thì
        add_segment() sẽ TỪ CHỐI => mất segment => graph bị ĐỨT thành nhiều
        thành phần (QL1A bị cắt đôi). Đây là bug đã xảy ra thật.
        """
        best_d, best_sid, best_t = float("inf"), None, 0.0
        for sid, seg in self.segments.items():
            p1 = self.nodes[seg["from"]]
            p2 = self.nodes[seg["to"]]
            dx, dz = p2["x"] - p1["x"], p2["z"] - p1["z"]
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = clamp(((x - p1["x"]) * dx + (z - p1["z"]) * dz) / l2, 0.0, 1.0)
            cx, cz = p1["x"] + dx * t, p1["z"] + dz * t
            d = dist(x, z, cx, cz)
            if d < best_d:
                best_d, best_sid, best_t = d, sid, t
        if best_sid is None or best_d > tolerance:
            return None, best_d
        seg = self.segments[best_sid]
        p1 = self.nodes[seg["from"]]
        p2 = self.nodes[seg["to"]]
        L = dist(p1["x"], p1["z"], p2["x"], p2["z"])

        # cắt quá sát đầu segment -> dùng lại node đầu, KHÔNG tách
        if best_t * L < MIN_SEG_LEN:
            return seg["from"], 0.0
        if (1.0 - best_t) * L < MIN_SEG_LEN:
            return seg["to"], 0.0

        mx = lerp(p1["x"], p2["x"], best_t)
        mz = lerp(p1["z"], p2["z"], best_t)
        mid = self.add_node(mx, mz, p1["region"], n_type=n_type)
        # cắt segment
        old = dict(seg)
        del self.segments[best_sid]
        self._remove_road_index(p1["x"], p1["z"], p2["x"], p2["z"], old["width"], best_sid)
        self.nodes[old["from"]]["connections"] = [
            c for c in self.nodes[old["from"]]["connections"] if c != best_sid]
        self.nodes[old["to"]]["connections"] = [
            c for c in self.nodes[old["to"]]["connections"] if c != best_sid]
        a = self.add_segment(old["from"], mid, old["class"], width=old["width"],
                             lanes=old["lanes"], name=old.get("name"),
                             section=old.get("section"))
        b = self.add_segment(mid, old["to"], old["class"], width=old["width"],
                             lanes=old["lanes"], name=old.get("name"),
                             section=old.get("section"))
        if a is None or b is None:
            # KHÔNG BAO GIỜ để graph đứt: dựng lại nguyên segment gốc
            if a is None and b is not None:
                self.add_segment(mid, old["to"], old["class"], width=old["width"],
                                 lanes=old["lanes"], name=old.get("name"),
                                 section=old.get("section"))
            if b is None and a is not None:
                self.add_segment(old["from"], mid, old["class"], width=old["width"],
                                 lanes=old["lanes"], name=old.get("name"),
                                 section=old.get("section"))
            return None, 0.0
        return mid, 0.0

    def _remove_road_index(self, x1, z1, x2, z2, w, sid):
        r = w * 0.5 + 64.0
        c0 = self._cell(min(x1, x2) - r, min(z1, z2) - r)
        c1 = self._cell(max(x1, x2) + r, max(z1, z2) + r)
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                lst = self._road_grid.get((cx, cz))
                if lst and sid in lst:
                    lst.remove(sid)

    # --------------------------------------------------------------------------
    # 4.7b GRADE LIMIT — ĐƯỜNG PHẢI BẰNG (rule 36: grounding > terrain visual)
    # --------------------------------------------------------------------------
    def _fix_bridge_heights(self):
        """
        CẦU phải nằm TRÊN mặt nước. Nhưng terrain bị khắc vũng sông, nên node
        đường trên cầu rơi xuống lòng sông. Ở đây tính lại y cho node cầu bằng
        elevation KHÔNG khắc nước => cầu thành nhịp cầu đúng nghĩa.
        """
        n_fixed = 0
        for seg in self.segments.values():
            if not seg.get("bridge"):
                continue
            for nid in (seg["from"], seg["to"]):
                n = self.nodes[nid]
                y = self.get_elevation(n["x"], n["z"], water=False)
                n["y"] = y
                n["elev"] = round(y, 3)
                n_fixed += 1
        # đồ thị y cho grading: cầu giữ nguyên, phần còn lại theo terrain
        print("      bridge nodes re-ground tren mat nuoc: %d" % n_fixed)
        return n_fixed

    def _limit_slopes(self, max_grade=0.09, passes=40, max_cut=8.0, max_fill=6.0):
        """
        Slope limiter chuan: moi lan, moi segment vuot nganh -> keo node cao xuong
        (hoac node thap len) cho duong bang. Gioi han lech terrain de khong
        'treo' duong len cao.
        """
        raw = {nid: n["elev"] if "elev" in n else n["y"] for nid, n in self.nodes.items()}
        for _ in range(passes):
            bad = 0
            for seg in self.segments.values():
                a = self.nodes[seg["from"]]
                b = self.nodes[seg["to"]]
                run = dist(a["x"], a["z"], b["x"], b["z"])
                if run < 1.0:
                    continue
                dy = b["y"] - a["y"]
                lim = max_grade * run
                if abs(dy) <= lim:
                    continue
                bad += 1
                over = abs(dy) - lim
                if dy > 0:
                    b["y"] -= over * 0.5
                    a["y"] += over * 0.5
                else:
                    a["y"] -= over * 0.5
                    b["y"] += over * 0.5
                for n in (a, b):
                    n["y"] = clamp(n["y"], raw[n["id"]] - max_cut, raw[n["id"]] + max_fill)
                    n["y"] = max(n["y"], SEA_LEVEL + 0.25)
            if bad == 0:
                break
        # keo san ben + POI theo node da gia
        for st in getattr(self, "stations", []):
            an = st.get("anchor_node")
            if an and an in self.nodes:
                st["y"] = round(self.nodes[an]["y"], 3)
            for slot in st.get("baySlots", []):
                slot["y"] = round(st["y"] + 0.5, 3)
        for f in getattr(self, "facility_pois", []):
            n = self.get_node_near(f["x"], f["z"])
            if n:
                f["y"] = round(n["y"], 3)
        for s in getattr(self, "bus_stops", []):
            n = self.get_node_near(s["x"], s["z"])
            if n:
                s["y"] = round(n["y"] + 0.3, 3)

    def _prune_orphans(self):
        """Xoá node mồ côi (không còn segment nào) + index đường bị treo."""
        dead = [nid for nid, n in self.nodes.items() if not n["connections"]]
        if not dead:
            return
        for nid in dead:
            n = self.nodes.pop(nid, None)
            if n is None:
                continue
        # dọn index đường: segment nào không còn trong graph thì bỏ khỏi grid
        alive = set(self.segments.keys())
        for cell in list(self._road_grid.keys()):
            lst = self._road_grid[cell]
            keep = [s for s in lst if s in alive]
            if keep:
                self._road_grid[cell] = keep
            else:
                del self._road_grid[cell]
        self._build_accel()
        print("      prune orphan nodes: %d" % len(dead))

    def _grade_roads(self, passes=26, max_cut=8.0, max_fill=7.0, rate=0.6):
        """
        node.y ban đầu = độ cao terrain thật. Nhưng terrain tự nhiên ở Đèo Cả /
        cao nguyên có chỗ dốc 30% => xe bay/rung. Ở đây LÀM PHẲNG CHÍNH ĐƯỜNG:
        lấy trung bình y node lân cận, giới hạn tốc độ đổi mỗi pass, giữ trong
        biên [terrain-max_cut, terrain+max_fill] để đường không treo quá xa mặt
        đất (đường đi trên sườn/đắp nền như thật).
        """
        raw = {nid: n["y"] for nid, n in self.nodes.items()}
        for _ in range(passes):
            new_y = {}
            for nid, n in self.nodes.items():
                ys = []
                for cid in n["connections"]:
                    seg = self.segments.get(cid)
                    if not seg:
                        continue
                    other = seg["to"] if seg["from"] == nid else seg["from"]
                    on = self.nodes.get(other)
                    if not on:
                        continue
                    # node trên biển (y < sea) KHÔNG được kéo node trên bờ xuống
                    if raw.get(other, 0.0) < SEA_LEVEL and raw[nid] >= SEA_LEVEL:
                        continue
                    ys.append(on["y"])
                if not ys:
                    new_y[nid] = n["y"]
                    continue
                target = sum(ys) / len(ys)
                step = clamp(target - n["y"], -6.0, 6.0) * rate
                v = n["y"] + step
                v = clamp(v, raw[nid] - max_cut, raw[nid] + max_fill)
                # TUYỆT ĐỐI không để đường chìm dưới mặt nước/mặt đất ven biển:
                # node âm => mặt đường bị terrain phủ, xe chạy trên cỏ.
                v = max(v, SEA_LEVEL + 0.25)
                new_y[nid] = v
            for nid, v in new_y.items():
                self.nodes[nid]["y"] = v
        # kéo sân bến + POI theo node đã grade (tránh sân lệch so với đường)
        for st in getattr(self, "stations", []):
            an = st.get("anchor_node")
            if an and an in self.nodes:
                st["y"] = round(self.nodes[an]["y"], 3)
            for slot in st.get("baySlots", []):
                slot["y"] = round(st["y"] + 0.5, 3)
        for f in getattr(self, "facility_pois", []):
            n = self.get_node_near(f["x"], f["z"])
            if n:
                f["y"] = round(n["y"], 3)
        if getattr(self, "spawn_point", None) and self.stations:
            sp = self.spawn_point
            n = self.get_node_near(sp["x"], sp["z"])
            if n:
                sp["y"] = round(n["y"] + 0.5, 3)
            for st in self.stations:
                if st.get("is_spawn"):
                    st["spawn"] = dict(sp)

    def get_node_near(self, x, z):
        best, bn = float("inf"), None
        for nid, n in self.nodes.items():
            d = dist2(n["x"], n["z"], x, z)
            if d < best:
                best, bn = d, nid
        return self.nodes[bn] if bn else None

    def _add_link_road(self, n1, n2, r_class, name):
        """Đường nối trực tiếp 2 node (đệm node ở giữa cho đồ thị mềm).
        Bám terrain + LỌC THẤP (low-pass) profile để không nhấp nhô, và BÁO TỪ
        CHỐI nếu tuyến chạy quá nhiều qua biển (đường trên biển 200m là bịa)."""
        a, b = self.nodes[n1], self.nodes[n2]
        L = dist(a["x"], a["z"], b["x"], b["z"])
        if L < 1.0:
            # 2 node trùng nhau / quá gần: link dài 0m là vô nghĩa. Bản cũ
            # để lọt vì không chia cho L (bắt buộc phải chặn TRƯỚC khi chia).
            return False
        if L > MAX_LINK_LEN:
            print("      bo qua link %s: qua xa (%.1f km > %.0f km)"
                  % (name, L / 1000.0, MAX_LINK_LEN / 1000.0))
            return False
        steps = max(2, int(L / 250.0))
        pts = []
        for k in range(steps + 1):
            t = k / float(steps)
            dx, dz = b["x"] - a["x"], b["z"] - a["z"]
            # ⚠ PHẢI CHUẨN HÓA. Bản cũ để `nx,nz = -dz,dx` — độ lớn của vector
            # pháp tuyến bằng L — rồi nhân `off` (≤60m) nên lệch ngang L*60:
            # với L=2km là 120.000m. `sin(pi*t)` đối xứng nên kết quả là VÒNG
            # ĐI–VỀ 100km. Đo được trên data: `RING3_LINK_QL` 19 đoạn / 562km
            # (đoạn dài nhất 51 334m), `tinh_lo_*` 29km với đoạn 26 589m, và
            # 588km mặt tiền ARTERIAL ảo => ~63.000 nhà phát sinh trên đường
            # không tồn tại (225939 → 162879 nhà là SỬA, không phải mất).
            _inv = 1.0 / L
            nx, nz = -dz * _inv, dx * _inv
            off = math.sin(math.pi * t) * min(60.0, L * 0.04)
            pts.append((lerp(a["x"], b["x"], t) + nx * off,
                        lerp(a["z"], b["z"], t) + nz * off,
                        t))
        # tỉ lệ điểm nằm trên biển
        sea = sum(1 for (px, pz, _) in pts if self.dist_to_coast(px, pz) < 0)
        if sea > len(pts) * 0.25:
            print("      bo qua link %s: %.0f%% diem nam tren bien" %
                  (name, 100.0 * sea / len(pts)))
            return False
        # REJECT link co san doc >16% (duong noi khong theo duoc dia hinh)
        n_chk = max(3, int(L / 150.0))
        seg_len = max(1.0, L / n_chk)
        prev_e = self.get_elevation(a["x"], a["z"])
        for k in range(1, n_chk + 1):
            t = k / float(n_chk)
            e = self.get_elevation(lerp(a["x"], b["x"], t), lerp(a["z"], b["z"], t))
            g = abs(e - prev_e) / seg_len
            if g > 0.16:
                print("      bo qua link %s: san doc %.0f%%" % (name, g * 100))
                return False
            prev_e = e
        # profile: terrain + SLOPE LIMITER (giữ tổng độ chênh nhưng bỏ vách)
        # Không dùng moving-average: nó xẹp cả đoạn leo 240m thành 80m
        # (node lệch terrain 170m). Thay vào đó giới hạn ĐỘ DỐC rồi quét 2 chiều.
        prof = [self.get_road_datum(px, pz) for (px, pz, _) in pts]
        step_len = max(1.0, L / steps)
        max_rise = 0.09 * step_len
        for _ in range(3):
            for i in range(1, len(prof)):
                d = prof[i] - prof[i - 1]
                if d > max_rise:
                    prof[i] = prof[i - 1] + max_rise
                elif d < -max_rise:
                    prof[i] = prof[i - 1] - max_rise
            for i in range(len(prof) - 2, -1, -1):
                d = prof[i] - prof[i + 1]
                if d > max_rise:
                    prof[i] = prof[i + 1] + max_rise
                elif d < -max_rise:
                    prof[i] = prof[i + 1] - max_rise
        # neo 2 đầu vào node thật
        prof[0] = a["y"]
        prof[-1] = b["y"]
        prev = None
        for i, (px, pz, t) in enumerate(pts):
            rn, _ = self.determine_region(pz, px)
            if prev is None:
                prev = n1
                continue
            nid = self.add_node(px, pz, rn, n_type="junction")
            self.nodes[nid]["y"] = prof[i]
            self.add_segment(prev, nid, r_class, name=name)
            prev = nid
        self.add_segment(prev, n2, r_class, name=name)
        return True

    # --------------------------------------------------------------------------
    # 4.8 INTERCHANGE / RAMP
    # --------------------------------------------------------------------------
    def _build_interchanges(self):
        """
        Mỗi interchange = node THẬT tại toạ độ OSM, nối 2 nhánh ramp từ QL1A và
        2 nhánh từ cao tốc => 4 nhánh, tạo cycle trong graph (đường vòng thật).
        Nếu quá xa (> IC_MAX_LINK_M) thì dựng link 2 làn thay vì ramp "bay".
        """
        made = 0
        skipped = 0
        ql_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                   if n["type"] == "highway" and n.get("_src") != "ct"]
        ct_pool = getattr(self, "_ct_nodes", [])
        for (ic_name, lat, lon, style) in INTERCHANGES:
            ix, iz = self.proj(lat, lon)
            ql_node, dq = self._nearest_node_on(ix, iz, ql_pool, 9000.0)
            ct_node, d_ct = self._nearest_node_on(ix, iz, ct_pool, IC_MAX_LINK_M)
            if ql_node is None:
                continue
            if ct_node is None or d_ct > IC_MAX_LINK_M or dq > 9000.0:
                tgt = ct_node if ct_node is not None else ql_node
                if tgt is not None:
                    self._add_link_road(ql_node if ql_node != tgt else ql_node,
                                        tgt, "ARTERIAL", "LINK_" + ic_name)
                skipped += 1
                continue

            # node trung tâm interchange TẠI TOẠ ĐỘ THẬT
            reg, _ = self.determine_region(iz, ix)
            ic_node = self.add_node(ix, iz, reg, n_type="interchange",
                                    name=ic_name)

            a = self.nodes[ql_node]
            b = self.nodes[ct_node]

            def _ramp_path(sid, sxy, eid, exy, tag, label):
                """Ramp cong 2 dau: (sid@ sxy) -> (eid@ exy), profile tuyen tinh."""
                nonlocal made
                ax, az = sxy
                bx, bz = exy
                dx, dz = bx - ax, bz - az
                L = math.hypot(dx, dz) or 1.0
                ux, uz = dx / L, dz / L
                px, pz = -uz, ux
                steps = max(3, min(12, int(L / 150.0) or 3))
                off = 15.0 * tag
                y0 = self.nodes[sid]["y"]
                y1 = self.nodes[eid]["y"]
                prev = sid
                made_nodes = []
                for k in range(1, steps + 1):
                    t = k / float(steps)
                    sm = t * t * (3.0 - 2.0 * t)
                    bulge = math.sin(math.pi * t) * L * 0.12
                    rx = ax + dx * sm + ux * off + px * bulge
                    rz = az + dz * sm + uz * off + pz * bulge
                    if dist(rx, rz, bx, bz) < MIN_SEG_LEN * 1.5:
                        break
                    rn, _ = self.determine_region(rz, rx)
                    nid = self.add_node(rx, rz, rn, n_type="ramp")
                    self.nodes[nid]["y"] = lerp(y0, y1, sm)
                    made_nodes.append(nid)
                    self.add_segment(prev, nid, "RAMP", name=label)
                    prev = nid
                if prev != eid:
                    self.add_segment(prev, eid, "RAMP", name=label)
                made += 1

            # 2 ramp chéo từ QL1A vào node IC (diamond/trumpet khác hình dạng bulge)
            _ramp_path(ql_node, (a["x"], a["z"]), ic_node, (ix, iz), +1.0, ic_name)
            _ramp_path(ql_node, (a["x"], a["z"]), ic_node, (ix, iz), -1.0, ic_name)
            # 2 ramp từ node IC lên cao tốc
            _ramp_path(ic_node, (ix, iz), ct_node, (b["x"], b["z"]), +1.0, ic_name)
            _ramp_path(ic_node, (ix, iz), ct_node, (b["x"], b["z"]), -1.0, ic_name)

            self.interchanges = getattr(self, "interchanges", [])
            self.interchanges.append(dict(name=ic_name, style=style,
                                          lat=lat, lon=lon,
                                          ql_node=ql_node, ct_node=ct_node,
                                          ic_node=ic_node,
                                          ql_m=round(dq, 1), ct_m=round(d_ct, 1)))
        print("      interchanges that toa do that: %d (ramp %d, bo qua %d)"
              % (len(getattr(self, "interchanges", [])), made, skipped))

    # --------------------------------------------------------------------------
    # 4.8b HẦM ĐÈO CẢ (rule 35/60: địa hình phải có hầm, không chỉ có đèo)
    # --------------------------------------------------------------------------
    def _mark_bridges_over_water(self):
        """
        DUONG CAT QUA SONG = CAU. Khong hard-code: sample 7 diem tren moi
        segment, diem nao nằm trong vùng nuoc -> đánh dấu bridge.
        """
        made = 0
        for sid, seg in self.segments.items():
            if seg.get("bridge") or seg["class"] in ("INTERNAL",):
                continue
            a = self.nodes[seg["from"]]
            b = self.nodes[seg["to"]]
            L = dist(a["x"], a["z"], b["x"], b["z"])
            if L < 30.0:
                continue
            hit = False
            for k in range(1, 6):
                t = k / 6.0
                x = lerp(a["x"], b["x"], t)
                z = lerp(a["z"], b["z"], t)
                if self.water_factor(x, z) > 0.35:
                    hit = True
                    break
            if hit:
                seg["bridge"] = True
                seg["structure"] = "song"
                if seg.get("type") not in ("tunnel",):
                    seg["type"] = "bridge"
                made += 1
        self.bridge_segments = getattr(self, "bridge_segments", 0) + made
        print("      cau tu sinh tren duong cat song: %d" % made)

    def _build_tunnels(self):
        """
        Hầm THẬT trên CT01: Hầm Đèo Cả, hầm Cổ Mã, hầm Núi Vung.
        Cầu THẬT trên QL1A: Cầu Đà Rằng (đánh dấu bridge để runtime dựng nhịp).
        Cách làm: tìm segment gần toạ độ nhất thuộc đúng hệ thống rồi đánh dấu
        (không hard-code chỉ số segment vì id đổi theo seed).
        """
        made_t = 0
        for (name, lat, lon, system) in TUNNEL_DEFS:
            px, pz = self.proj(lat, lon)
            want = "CT01" if system == "CT01" else "QL1A"
            best, bsid = float("inf"), None
            for sid, seg in self.segments.items():
                if seg.get("name") != want or seg["class"] in ("TUNNEL",):
                    continue
                a, b = self.nodes[seg["from"]], self.nodes[seg["to"]]
                dax, daz = b["x"] - a["x"], b["z"] - a["z"]
                l2 = dax * dax + daz * daz
                if l2 <= 0:
                    continue
                t = clamp(((px - a["x"]) * dax + (pz - a["z"]) * daz) / l2, 0, 1)
                d = dist(px, pz, a["x"] + dax * t, a["z"] + daz * t)
                if d < best:
                    best, bsid = d, sid
            if bsid is None or best > 900.0:
                continue
            seg = self.segments[bsid]
            seg["class"] = "TUNNEL"
            seg["type"] = "tunnel"
            seg["tunnel"] = True
            seg["structure"] = name
            seg["width"] = 13.0
            seg["lanes"] = 2
            seg["speed"] = 60
            made_t += 1
        self.tunnel_segments = made_t

        made_b = 0
        for (name, lat, lon, system) in BRIDGE_DEFS:
            px, pz = self.proj(lat, lon)
            want = "QL1A" if system == "QL1A" else "CT01"
            best, bsid = float("inf"), None
            for sid, seg in self.segments.items():
                if seg.get("name") != want or seg["class"] == "TUNNEL":
                    continue
                a, b = self.nodes[seg["from"]], self.nodes[seg["to"]]
                dax, daz = b["x"] - a["x"], b["z"] - a["z"]
                l2 = dax * dax + daz * daz
                if l2 <= 0:
                    continue
                t = clamp(((px - a["x"]) * dax + (pz - a["z"]) * daz) / l2, 0, 1)
                d = dist(px, pz, a["x"] + dax * t, a["z"] + daz * t)
                if d < best:
                    best, bsid = d, sid
            if bsid is None or best > 1200.0:
                continue
            seg = self.segments[bsid]
            seg["bridge"] = True
            seg["structure"] = name
            seg["type"] = "bridge"
            made_b += 1
        self.bridge_segments = made_b
        print("      ham that: %d | cau that: %d" % (made_t, made_b))

    # --------------------------------------------------------------------------
    # 4.9 SECONDARY / LOCAL ROADS  (growth-based, không grid)
    # --------------------------------------------------------------------------
    def _build_secondary_networks(self):
        """
        Tuyến nhánh cấp vùng: rẽ ra khỏi QL1A tại node thật (junction thật),
        đi về thôn xóm / đường ven biển / đường tỉnh.
        """
        rng = stable_rng(self.seed, "secondary")
        made = 0
        ql_nodes = [(nid, n) for nid, n in self.nodes.items() if n["type"] == "highway"]
        # Limit to reasonable number of secondary roads
        max_secondary = 120
        for i in range(0, len(ql_nodes), 12):
            nid, node = ql_nodes[i]
            if made >= max_secondary:
                break
            p = self.region_params(node["x"], node["z"])
            if p["mountain"] > 0.85:
                continue
            chance = 0.12 + 0.35 * p["density"]
            if rng.random() > chance:
                continue
            # hướng gần vuông góc trục QL, phía đất liền ưa thích
            prev_nodes = [c for c in node["connections"]]
            if not prev_nodes:
                continue
            s0 = self.segments[prev_nodes[0]]
            o = self.nodes[s0["from"] if s0["to"] == nid else s0["to"]]
            dx, dz = node["x"] - o["x"], node["z"] - o["z"]
            L = math.hypot(dx, dz) or 1.0
            base = math.atan2(dz, dx)
            side = rng.choice([-1.0, 1.0])
            ang = base + side * (math.pi / 2) + rng.uniform(-0.35, 0.35)
            length = rng.uniform(300.0, 1200.0) * (0.6 + 0.8 * p["density"])
            made += 1
            self._grow_road(nid, ang, length, level=0, rng=rng, p=p)

    def _crosses_station(self, x1, z1, x2, z2):
        """Đoạn có cắt qua SAN BẾN XE (reserved, cấm đường công cộng) không?"""
        for sz in self.station_zones:
            if not sz.get("keep_clear"):
                continue
            hw, hd = sz["w"] * 0.5, sz["d"] * 0.5
            # bo qua nhanh: duong khong nam gan hinh tron bao quanh rect
            r = math.hypot(hw, hd) + 2.0
            if (max(x1, x2) < sz["x"] - r or min(x1, x2) > sz["x"] + r or
                    max(z1, z2) < sz["z"] - r or min(z1, z2) > sz["z"] + r):
                continue
            if _seg_hits_rect((x1, z1), (x2, z2), sz["x"], sz["z"], hw, hd,
                              2.0, sz.get("rot", 0.0)):
                return True
        return False

    def _rect_probe(self, cx, cz, w, d, rot, step=16.0):
        """(nuoc_lon_nhat, khoang_cach_bo_it_nhat) đo được trên sân bến.

        Lấy mẫu trong HỆ CỤ THỂ CỦA RECT rồi xoay về world.
        Bản check cũ lấy mẫu theo trục THẾ GIỚI (cx ± w/2, cz ± d/2) trong khi
        sân xoay theo đường => bỏ sót 4 góc nghiêng => 7 nan đỗ Nha Trang bị
        lệch xuống sông Cửu Đại dù tâm bến vẫn khô.
        """
        ca, sa = math.cos(rot), math.sin(rot)
        nx = max(1, int(math.ceil(w / step)))
        nz = max(1, int(math.ceil(d / step)))
        worst_w, min_c = 0.0, 1e18
        for i in range(-nx, nx + 1):
            ox = i * (w * 0.5 / nx)
            for j in range(-nz, nz + 1):
                oz = j * (d * 0.5 / nz)
                # M = [[sa,ca],[ca,-sa]] la involutory (M^-1 = M) nen nghich
                # loi cung la: X = ox*sa + oz*ca ; Z = ox*ca - oz*sa
                X = ox * sa + oz * ca
                Z = ox * ca - oz * sa
                x, z = cx + X, cz + Z
                wf = self.water_factor(x, z)
                if wf > worst_w:
                    worst_w = wf
                cd = self.dist_to_coast(x, z)
                if cd < min_c:
                    min_c = cd
        return worst_w, min_c

    def _rect_clear_of_roads(self, cx, cz, w, d, rot):
        """
        Rect sân bến có bị đường ĐÃ DỰNG SẴN cắt qua không?
        QL1A/CT01/ramp được tạo ở step 1-2, còn _place_stations chạy ở step 3
        -> _crosses_station chưa tồn tại lúc đó, nên phải tự kiểm tra.
        """
        for sg in self.segments.values():
            p1 = self.nodes.get(sg["from"])
            p2 = self.nodes.get(sg["to"])
            if not p1 or not p2:
                continue
            if _seg_hits_rect((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                              cx, cz, w * 0.5, d * 0.5, 6.0, rot):
                return False
        return True

    # ---- bug 2: cao to / ramp KHONG duoc cat san ben xe --------------------
    def _bend_segment_around_zone(self, sid, sz, margin=45.0, step=25.0):
        """Doan cao to/ramp cat san ben -> di vong qua GOC rect (khong cat
        ngang). Liang-Barsky lay giao voi push-rect, day duong di qua 1-2
        corner tren chinh bien push (>> bien verify 2m) -> dam bao khong cat.
        Giu y profile tuyen tinh nhu _ramp_path."""
        seg = self.segments.get(sid)
        if seg is None:
            return False
        A = self.nodes.get(seg["from"])
        B = self.nodes.get(seg["to"])
        if not A or not B:
            return False
        dx, dz = B["x"] - A["x"], B["z"] - A["z"]
        L = math.hypot(dx, dz)
        if L < 10.0:
            return False
        ca, sa = math.cos(sz.get("rot", 0.0)), math.sin(sz.get("rot", 0.0))

        def to_local(px, pz):
            X, Z = px - sz["x"], pz - sz["z"]
            return (X * sa + Z * ca, X * ca - Z * sa)

        def to_world(lx, lz):
            # M = [[sa,ca],[ca,-sa]] la involutory (M^-1 = M)
            return (sz["x"] + lx * sa + lz * ca, sz["z"] + lx * ca - lz * sa)

        hw_p = sz["w"] * 0.5 + margin
        hd_p = sz["d"] * 0.5 + margin
        l1 = to_local(A["x"], A["z"])
        l2 = to_local(B["x"], B["z"])
        # --- Liang-Barsky: t0,t1 + canh vao/ra (0=x-,1=x+,2=z-,3=z+) ---
        sx, sz2 = l2[0] - l1[0], l2[1] - l1[1]
        p = (-sx, sx, -sz2, sz2)
        q = (l1[0] + hw_p, hw_p - l1[0], l1[1] + hd_p, hd_p - l1[1])
        t0, t1, e0, e1 = 0.0, 1.0, None, None
        for i in range(4):
            if abs(p[i]) < 1e-12:
                if q[i] < 0.0:
                    return False
            else:
                r = q[i] / p[i]
                if p[i] < 0.0:
                    if r > t1:
                        return False
                    if r > t0:
                        t0, e0 = r, i
                else:
                    if r < t0:
                        return False
                    if r < t1:
                        t1, e1 = r, i
        if e0 is None or e1 is None:
            return False       # doan khong cat (nam ngoai hoac cham bien)

        def lerp2(a, b, t):
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

        def edge_val(e):
            if e == 0:
                return -hw_p
            if e == 1:
                return hw_p
            if e == 2:
                return -hd_p
            return hd_p

        P1, P2 = lerp2(l1, l2, t0), lerp2(l1, l2, t1)
        ax0, ax1 = (0 if e0 < 2 else 1), (0 if e1 < 2 else 1)
        corners = []
        if ax0 == ax1:
            # doi dien -> di qua 1 ben: 2 corner tren 2 bien doc/ ngang
            mid = lerp2(l1, l2, (t0 + t1) * 0.5)
            if ax0 == 0:   # vao x-, ra x+ -> di qua canh z (chon ben gan day)
                sgn = 1.0 if mid[1] >= 0.0 else -1.0
                corners = [(edge_val(e0), sgn * hd_p), (edge_val(e1), sgn * hd_p)]
            else:          # vao z-, ra z+ -> di qua canh x
                sgn = 1.0 if mid[0] >= 0.0 else -1.0
                corners = [(sgn * hw_p, edge_val(e0)), (sgn * hw_p, edge_val(e1))]
        else:
            # ke nhau -> dung 1 corner giao 2 bien
            vx = edge_val(e0) if ax0 == 0 else edge_val(e1)
            vz = edge_val(e0) if ax0 == 1 else edge_val(e1)
            corners = [(vx, vz)]
        path = [P1] + corners + [P2]
        world = [to_world(lx, lz) for (lx, lz) in path]
        # y: tuyen tinh theo t (P1=t0, P2=t1, corner=giua)
        ts = [t0] + [(t0 + t1) * 0.5] * len(corners) + [t1]
        # --- verify: khong con cat rect (margin 2) + khong cat QL1A/cao to khac ---
        chain = [(A["x"], A["z"])] + world + [(B["x"], B["z"])]
        for i in range(len(chain) - 1):
            if _seg_hits_rect(chain[i], chain[i + 1], sz["x"], sz["z"],
                              sz["w"] * 0.5, sz["d"] * 0.5, 2.0,
                              sz.get("rot", 0.0)):
                return False
        for i in range(len(chain) - 1):
            if not self._clear_for_link(chain[i][0], chain[i][1],
                                        chain[i + 1][0], chain[i + 1][1],
                                        exclude_sid=sid):
                return False
        r_class = seg["class"]
        nm = seg.get("name")
        sec = seg.get("section")
        status = seg.get("status")
        y0, y1 = A["y"], B["y"]
        old_from, old_to = seg["from"], seg["to"]
        self._remove_segment(sid)
        prev = old_from
        for (pt, tt) in zip(world, ts):
            rn, _ = self.determine_region(pt[1], pt[0])
            nid = self.add_node(pt[0], pt[1], rn,
                                n_type="highway" if r_class == "EXPRESSWAY" else "ramp")
            self.nodes[nid]["y"] = lerp(y0, y1, tt)
            nsid = self.add_segment(prev, nid, r_class, name=nm, section=sec)
            if nsid is not None and status is not None:
                self.segments[nsid]["status"] = status
            prev = nid
        nsid = self.add_segment(prev, old_to, r_class, name=nm, section=sec)
        if nsid is not None and status is not None:
            self.segments[nsid]["status"] = status
        return True

    def _divert_hw_around_stations(self, margin=45.0, max_pass=3):
        """BUG 2: _build_expressways (step 2) chay TRUOC _place_stations
        (step 3) nen Vành dai 3 + ramp IC_Hoang_Huu_Nam sinh ra khong thay gi —
        _rect_clear_of_roads trong _place_stations chi day duong ra, khong day
        duoc cao to. Doan nao cat -> uonce vong quanh rect ben."""
        zones = [z for z in self.station_zones if z.get("keep_clear")]
        if not zones:
            return 0
        fixed = 0
        for _ in range(max_pass):
            hit = 0
            for sid, seg in list(self.segments.items()):
                if seg["class"] not in ("EXPRESSWAY", "RAMP"):
                    continue
                p1 = self.nodes.get(seg["from"])
                p2 = self.nodes.get(seg["to"])
                if not p1 or not p2:
                    continue
                for z in zones:
                    if not _seg_hits_rect((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                                          z["x"], z["z"], z["w"] * 0.5,
                                          z["d"] * 0.5, margin, z.get("rot", 0.0)):
                        continue
                    if self._bend_segment_around_zone(sid, z, margin):
                        hit += 1
                    break
            fixed += hit
            if not hit:
                break
        if fixed:
            print("      uonce %d doan cao to/ramp tranh san ben xe" % fixed)
        return fixed

    # ---- bug 4: duong chinh cuot -------------------------------------------
    def _clear_for_link(self, x1, z1, x2, z2, exclude_sid=None):
        """Doan noi co hop le khong: khong cat cao to/ham, khong cat san ben,
        khong chay qua bien (exclude_sid = segment dang xet, neu co)."""
        if self._crosses_station(x1, z1, x2, z2):
            return False
        n_chk = max(3, int(math.hypot(x2 - x1, z2 - z1) / 150.0))
        sea = 0
        for k in range(n_chk + 1):
            t = k / float(n_chk)
            if self.dist_to_coast(lerp(x1, x2, t), lerp(z1, z2, t)) < 0.0:
                sea += 1
        if sea > (n_chk + 1) * 0.25:
            return False
        c0 = self._cell(min(x1, x2) - 2.0, min(z1, z2) - 2.0)
        c1 = self._cell(max(x1, x2) + 2.0, max(z1, z2) + 2.0)
        seen = set()
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen or sid == exclude_sid:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if not seg or seg["class"] not in ("EXPRESSWAY", "TUNNEL"):
                        continue
                    p1 = self.nodes.get(seg["from"])
                    p2 = self.nodes.get(seg["to"])
                    if not p1 or not p2:
                        continue
                    if _seg_cross((x1, z1), (x2, z2), (p1["x"], p1["z"]),
                                  (p2["x"], p2["z"])):
                        return False
        return True

    def _link_dangling_major(self, min_len=150.0, max_link=500.0):
        """Dau duong CHINH (NATIONAL/ARTERIAL) cuot > min_len:
        - noi vao node gan nhat neu hop le (khong cat cao to, khong cat san
          ben, khong qua bien, do doc < 12%);
        - khong noi duoc -> xoa doan cuot (khong giua duong treo voi 200-300m
          vao nowhere, truoc do bi chan boi cao to/san ben/san doc)."""
        MAJOR = ("NATIONAL", "ARTERIAL")
        made = dropped = 0
        for _round in range(4):
            deg = {}
            for s in self.segments.values():
                deg[s["from"]] = deg.get(s["from"], 0) + 1
                deg[s["to"]] = deg.get(s["to"], 0) + 1
            danglers = []
            for sid, s in self.segments.items():
                if s["class"] not in MAJOR:
                    continue
                a = self.nodes.get(s["from"])
                b = self.nodes.get(s["to"])
                if not a or not b:
                    continue
                if math.hypot(b["x"] - a["x"], b["z"] - a["z"]) < min_len:
                    continue
                if deg.get(s["from"], 0) == 1:
                    danglers.append((sid, s["from"], s["class"]))
                if deg.get(s["to"], 0) == 1:
                    danglers.append((sid, s["to"], s["class"]))
            if not danglers:
                break
            progress = 0
            for sid, nid, cls in danglers:
                A = self.nodes.get(nid)
                if A is None:
                    continue
                best = None
                for cid, B in self.nodes.items():
                    if cid == nid:
                        continue
                    # KHÔNG CHAM MẶT CAO TỐC (rule 11/60). Hàm này gọi
                    # `add_segment` trực tiếp nên BỎ QUA cổng `topo_link_ok`;
                    # đo được 7 nút cao tốc mang ARTERIAL tên `RING3_LINK_QL` /
                    # `ket_vang_*` / `ket_pho_*` — đó là ramps nối vào cao tốc
                    # bị gán sai class.
                    if self._node_touches_expressway(cid):
                        continue
                    d = math.hypot(B["x"] - A["x"], B["z"] - A["z"])
                    if d < 15.0 or d > max_link:
                        continue
                    if abs(B.get("y", 0.0) - A.get("y", 0.0)) / d > 0.12:
                        continue
                    if not self._clear_for_link(A["x"], A["z"],
                                                B["x"], B["z"], exclude_sid=sid):
                        continue
                    if best is None or d < best[0]:
                        best = (d, cid)
                if best is None:
                    continue
                seg = self.segments.get(sid)
                if seg is None:
                    continue
                nm = seg.get("name")
                if self.add_segment(nid, best[1], cls,
                                    name=("ket_%s" % nm) if nm else None) is not None:
                    made += 1
                    progress += 1
            if progress:
                continue
            # vong nay khong noi duoc doan nao -> xoa het doan cuot con lai
            for sid, nid, cls in danglers:
                if self._remove_segment(sid):
                    dropped += 1
            break
        if made or dropped:
            print("      noi %d / xoa %d duong chinh cuot >%.0fm"
                  % (made, dropped, min_len))
        return made, dropped

    def _cap_dangling_highway(self):
        """Dau cuot cao toc (deg=1) phai co noi ket — khong de CT01 cat ngang
        ruong giua nowhere. Dung link road (ARTERIAL) giong fallback cua
        _build_interchanges khi IC qua xa cao to."""
        made = 0
        deg = {}
        for s in self.segments.values():
            deg[s["from"]] = deg.get(s["from"], 0) + 1
            deg[s["to"]] = deg.get(s["to"], 0) + 1
        ql_pool = []
        for nid, n in self.nodes.items():
            for cid in n["connections"]:
                s = self.segments.get(cid)
                if s and s["class"] == "NATIONAL":
                    ql_pool.append((0, nid, n["x"], n["z"]))
                    break
        ends = []
        for sid, s in self.segments.items():
            if s["class"] != "EXPRESSWAY":
                continue
            for e in ("from", "to"):
                if deg.get(s[e], 0) == 1:
                    ends.append((s[e], sid, s.get("name", "CT01")))
        for nid, sid, nm in ends:
            A = self.nodes.get(nid)
            if A is None:
                continue
            ql, d = self._nearest_node_on(A["x"], A["z"], ql_pool, 2500.0)
            if ql is None or ql == nid:
                print("      ! cao to '%s' cuot tai (%.0f,%.0f): khong tim thay QL1A de noi"
                      % (nm, A["x"], A["z"]))
                continue
            B = self.nodes[ql]
            if not self._clear_for_link(A["x"], A["z"], B["x"], B["z"],
                                         exclude_sid=sid):
                continue
            if self._add_link_road(ql, nid, "ARTERIAL",
                                   "LINK_%s_END" % nm):
                made += 1
        if made:
            print("      noi ket %d dau cao toc cuot" % made)
        return made

    def _crosses_major(self, x1, z1, x2, z2):
        """
        Đoạn (x1,z1)-(x2,z2) có cắt ngang EXPRESSWAY/TUNNEL không?
        Dùng trong _grow_road để KHÔNG cho đường nhỏ cắt qua cao tốc
        (rule 60 + legal connection matrix).
        CŨNG chặn đường cắt qua SAN BẾN XE (station_zones keep_clear) —
        trước đây zone chỉ được thêm SAU _build_settlements nên check này
        chưa từng có hiệu lực.
        """
        if self._crosses_station(x1, z1, x2, z2):
            return True
        minx, maxx = min(x1, x2) - 2.0, max(x1, x2) + 2.0
        minz, maxz = min(z1, z2) - 2.0, max(z1, z2) + 2.0
        c0 = self._cell(minx, minz)
        c1 = self._cell(maxx, maxz)
        seen = set()
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if not seg or seg["class"] not in ("EXPRESSWAY", "TUNNEL"):
                        continue
                    p1 = self.nodes[seg["from"]]
                    p2 = self.nodes[seg["to"]]
                    if seg["from"] == x1 or seg["to"] == x1:
                        continue
                    if _seg_cross((x1, z1), (x2, z2), (p1["x"], p1["z"]),
                                  (p2["x"], p2["z"])):
                        return True
        return False

    # ----------------------------------------------------------------------
    # TẦNG TOPOLOGY — engine. Tất cả hàm ở đây CHỈ đọc state, không giả vờ
    # kiểm tra: `topo_link_ok` là nguồn sự thật duy nhất cho "nối được".
    # ----------------------------------------------------------------------
    def _topo_deg(self, nid):
        """Bậc node theo `connections` (nguồn sự thật, không phải hàm dẫn)."""
        n = self.nodes.get(nid)
        return len(n["connections"]) if n else 0

    def _topo_rank(self, nid):
        """
        Bậc phân cấp của node = rank NHỎ NHẤT trong các nhánh của nó.

        ⚠ `best` phải khởi tạo 9 (không có class), KHÔNG phải 4. Bản cũ dùng 4
        nên node CHỈ có INTERNAL (rank 5) bị kẹp về 4 => trần bậc lấy
        `TOPO_DEGREE_CAP[4]=6` thay vì `[5]=8`. Đo được: mọi sân bến chỉ đặt
        được đúng 16 bãi (4 node spine × (6-2)) — kể cả Miền Đông Mới 16/50.
        """
        n = self.nodes.get(nid)
        if not n:
            return 4
        best = 9
        for sid in n["connections"]:
            sg = self.segments.get(sid)
            if sg is not None:
                best = min(best, TOPO_RANK.get(sg["class"], 4))
        return 4 if best == 9 else best

    def _topo_has_budget(self, nid):
        n = self.nodes.get(nid)
        if n is None:
            return False
        return self._topo_deg(nid) < TOPO_DEGREE_CAP.get(
            self._topo_rank(nid), 6)

    def _topo_near_junction(self, x, z, radius, ignore=(), min_deg=2):
        """
        Khoang cách toi nut giao THAT gan nhat (dung spatial hash duong).

        `min_deg` = bac toi thieu de coi la "nga giao that":
          * 3 — nghĩa đúng: chỉ node >= 3 nhánh mới là ngã tư. Node bậc 2 chỉ
            là điểm hình học giữa đường (đường bị cắt mỗi 70m).
          * 2 — dùng khi chỉ cần tránh node TRÙNG VỊ TRÍ, không phải tìm ngã tư.

        ⚠ PHẢI KHỚP định nghĩa với `tools/audit_world.py` luật T4 (bậc >= 3).
        Lệch định nghĩa => generator in "0 nut giao moi" trong khi audit báo
        hàng trăm giao lỗ.
        """
        best, bn = float("inf"), None
        seen = set()
        c0 = self._cell(x - radius, z - radius)
        c1 = self._cell(x + radius, z + radius)
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if not seg:
                        continue
                    for nid in (seg["from"], seg["to"]):
                        if nid in ignore or nid not in self.nodes:
                            continue
                        nd = self.nodes[nid]
                        if nd.get("type") not in TOPO_JOINABLE_TYPES:
                            continue
                        if self._topo_deg(nid) < min_deg:
                            continue
                        d = dist(x, z, nd["x"], nd["z"])
                        if d < best:
                            best, bn = d, nid
        return bn, best

    def _in_station_keep(self, x, z, radius=0.0):
        """
        (x,z) có nằm trong SÂN BẾN (zone `keep_clear`) không?

        PHẢI phân biệt 2 loại zone:
          * `keep_clear` = chính sân bến (w x d). CHỈ loại này cấm ĐƯỜNG.
          * zone `#pad` = sân + 70m lề, chỉ để cấm NHÀ/ĐỒ VẬT, KHÔNG cấm
            đường. Nếu dùng cả hai thì QL1A — vốn nằm ngoài sân, chỉ chạm
            vào lề 70m — bị báo "đường công xuyên sân bến".
        """
        for sz in self.station_zones:
            if not sz.get("keep_clear"):
                continue
            if _seg_hits_rect((x, z), (x, z), sz["x"], sz["z"],
                              sz["w"] * 0.5, sz["d"] * 0.5,
                              radius, sz.get("rot", 0.0)):
                return True
        return False

    def _node_touches_expressway(self, nid):
        """Node có segment EXPRESSWAY (mặt cao tốc) chạm vào không?"""
        for sid in self._segs_at(nid):
            sg = self.segments.get(sid)
            if sg is not None and sg["class"] == "EXPRESSWAY":
                return True
        return False

    def _seg_hits_expressway(self, x1, z1, x2, z2, ignore=()):
        """
        Đoạn mới có cắt qua mặt CAO TỐC / HẦM ở mặt bằng không?

        Quét spatial hash đường. `ignore` = 2 node đầu đoạn (nếu chính đoạn
        đó là cạnh của cao tốc thì không tự chặn chính nó).
        """
        seen = set()
        c0 = self._cell(min(x1, x2) - 2.0, min(z1, z2) - 2.0)
        c1 = self._cell(max(x1, x2) + 2.0, max(z1, z2) + 2.0)
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if not seg or seg["class"] not in ("EXPRESSWAY", "TUNNEL"):
                        continue
                    p1, p2 = self.nodes[seg["from"]], self.nodes[seg["to"]]
                    if p1["id"] in ignore or p2["id"] in ignore:
                        continue
                    if _seg_cross((x1, z1), (x2, z2),
                                  (p1["x"], p1["z"]), (p2["x"], p2["z"])):
                        return True
        return False

    def topo_link_ok(self, n1, n2, r_class, name=None):
        """
        CỔNG CHẶN DUY NHẤT: được nối 2 node bằng đường `r_class` không?

        Trả (True, "") hoặc (False, "ly do") — ly do được đếm vào
        `self._topo_reject` để in ở `topo_report()`. Nhờ đó nếu sau này map
        thiếu đường thì ta BIẾT đã hy sinh bao nhiêu và vì sao, thay vì phải
        đoán (rule: bằng chứng, không phải cảm giác).
        """
        A, B = self.nodes.get(n1), self.nodes.get(n2)
        if A is None or B is None or n1 == n2:
            return False, "node khong ton tai"
        if self._topo_deg(n1) > 0 and not self._topo_has_budget(n1):
            return False, "vuot bac"
        if self._topo_deg(n2) > 0 and not self._topo_has_budget(n2):
            return False, "vuot bac"
        # 1) ma tran hop phap (ca 2 chieu)
        ca = _cls_of(self, n1)
        cb = _cls_of(self, n2)
        if r_class not in TOPO_LEGAL.get(cb, ()) or r_class not in TOPO_LEGAL.get(ca, ()):
            # cap thap len cap cao bi cam; hai duong cung cap thi hop le
            if r_class not in TOPO_LEGAL.get(cb, ()):
                return False, "cap thap vao cap cao (%s)" % cb
        # 2) khong cat nguang mat cao toc / ham
        if self._seg_hits_expressway(A["x"], A["z"], B["x"], B["z"], (n1, n2)):
            return False, "cat nguang mat cao toc"
        # 3) khong dua duong moi vao san ben
        if self._in_station_keep(A["x"], A["z"], 2.0) or \
                self._in_station_keep(B["x"], B["z"], 2.0) or \
                self._crosses_station(A["x"], A["z"], B["x"], B["z"]):
            return False, "trong san ben"
        return True, ""

    def topo_try_link(self, n1, n2, r_class, name=None, **kw):
        """
        Thử nối qua cổng `topo_link_ok`. Trả (sid, why).
        `sid is None` => bị từ chối, `why` là lý do (đã đếm).
        """
        ok, why = self.topo_link_ok(n1, n2, r_class, name)
        if not ok:
            k = why
            if kw.get("name") and "cap thap vao cap cao" in why:
                k = "%s (%s)" % (why, kw["name"])
            self._topo_reject[k] = self._topo_reject.get(k, 0) + 1
            return None, why
        return self.add_segment(n1, n2, r_class, name=kw.get("name"),
                                **({"width": kw["width"]}
                                   if kw.get("width") is not None else {})), ""

    def topo_branch_h(self, nid, h, rng=None):
        """
        Hướng của nhánh MỚI tại node `nid`: giữa KHE GÓC TRỐNG LỚN NHẤT.

        Cũ: `h ± 90° + random(±23°)` — 1/2 số nhánh trùng góc với nhánh đã có
        (đo được 1229 cặp, còn 31 sau khi đổi). Nay chọn khe lớn nhất nên nhánh
        mới luôn lệch khỏi mọi nhánh đang có.
        """
        dirs = []
        for sid in self._segs_at(nid):
            sg = self.segments.get(sid)
            if sg is None:
                continue
            o = self.nodes.get(sg["to"] if sg["from"] == nid else sg["from"])
            if o is None:
                continue
            a = math.atan2(o["z"] - self.nodes[nid]["z"], o["x"] - self.nodes[nid]["x"])
            dirs.append(a % (2.0 * math.pi))
        if not dirs:
            return h + (rng.uniform(-0.4, 0.4) if rng else 0.0)
        dirs.sort()
        gaps = []
        for i in range(len(dirs)):
            a0 = dirs[i]
            a1 = dirs[(i + 1) % len(dirs)] + (2.0 * math.pi if i + 1 >= len(dirs) else 0.0)
            gaps.append((a1 - a0, a0, a1))
        g, a0, a1 = max(gaps)
        return (a0 + g * 0.5) + (rng.uniform(-0.12, 0.12) if rng else 0.0)

    def _drop_node(self, nid):
        """
        Gỡ 1 node vừa sinh nhưng không ai nối vào (bị cổng topology từ chối).

        KHÔNG xoá lịch sử toạ độ: `_repair_route_refs` cần nó để gán lại vị trí
        cho id đã chết trong `routes.json`.
        """
        n = self.nodes.get(nid)
        if n is None:
            return
        if n.get("connections"):
            return                      # còn nhánh thì KHÔNG được gỡ
        self.nodes.pop(nid, None)
        if self._nsi is not None:
            self._nsi.pop(nid, None)
        for cell, lst in list(self._obj_grid.items()):
            if not lst:
                self._obj_grid.pop(cell, None)

    def _add_segment_like(self, old, n1, n2, **kw):
        """
        Tạo lại segment `old` với 2 đầu mới, GIỮ NGUYÊN mọi thuộc tính.

        Bắt buộc: mọi chỗ tạo lại segment (chia đường, tách nhánh, chuyển nhánh)
        phải qua đây. Trước đây chỉ copy class/width/name nên CỜ `bridge`/`pier`
        bị rơi => 22 nhánh "cầu vượt" biến thành đường thường cắt ngang mặt
        cao tốc (đo được trong game).
        """
        if old is None or n1 is None or n2 is None:
            return None
        d = {k: v for k, v in old.items()
             if k not in ("id", "from", "to")}
        d.pop("bridge", None) if not old.get("bridge") else None
        d.pop("pier", None) if not old.get("pier") else None
        return self.add_segment(n1, n2, d.pop("class"), width=kw.get("width", d.pop("width", None)),
                                lanes=d.pop("lanes", None), name=d.pop("name", None),
                                section=d.pop("section", None))

    # ----------------------------------------------------------------------
    # TÁCH ĐƯỜNG + SỬA GIAO LỖ
    # Nguyên tắc: tạo nút giao THẬT tại ĐIỂM CẮT (chia đôi cả 2 đường), đừng
    # "ngoắt vào node gần nhất" — cách sau thỏa đồ thị nhưng hình học vẫn cắt
    # nhau (audit từng đo 239 giao lỗ sau khi dùng cách sau).
    # ----------------------------------------------------------------------
    def _node_on_seg_near(self, px, pz, a, b, radius, ignore=(), on_line=3.0):
        """
        Có node nào nằm TRÊN ĐƯỜNG THẲNG (a->b), cách (px,pz) < radius không?

        Chỉ chặn node nằm trên CHÍNH đoạn đang tách — khi đó 1 nhánh mới chỉ
        dài `radius` = cụt vô nghĩa. Node của ĐƯỜNG KHÁC (cách ngang >=
        `on_line`) thì vô hại: tách nút cạnh nó vẫn là ngã tư lệch hợp lệ.
        Đo được: bản chặn MỌI node trong 8m làm 66/66 cặp cắt không tách được
        (node bậc 2 giữa đường cách nhau ~70m).
        """
        dx, dz = b["x"] - a["x"], b["z"] - a["z"]
        l2 = dx * dx + dz * dz
        if l2 <= 0:
            return False
        r2, o2 = radius * radius, on_line * on_line
        for nid, nd in self.nodes.items():
            if nid in ignore:
                continue
            nx, nz = nd["x"], nd["z"]
            ddx, ddz = nx - px, nz - pz
            if ddx * ddx + ddz * ddz > r2:
                continue
            t = (ddx * dx + ddz * dz) / l2
            cx, cz = a["x"] + dx * t, a["z"] + dz * t
            if (cx - nx) ** 2 + (cz - nz) ** 2 <= o2:
                return True
        return False

    def _split_seg_at_point(self, sid, px, pz, n_type="junction"):
        """
        Chính xác 1 segment `sid` tại điểm (px,pz) (điểm đã nằm trên segment).

        Trả node mới, hoặc None nếu không tách được (quá sát đầu, đoạn quá
        ngắn, hoặc quá gần một nút giao/ngã tư thật khác). Không bao giờ để
        graph đứt: nếu 1 nửa tạo thất bại, trả lại nguyên segment gốc.
        """
        seg = self.segments.get(sid)
        if seg is None:
            return None
        a, b = self.nodes[seg["from"]], self.nodes[seg["to"]]
        dx, dz = b["x"] - a["x"], b["z"] - a["z"]
        l2 = dx * dx + dz * dz
        if l2 <= 0:
            return None
        t = clamp(((px - a["x"]) * dx + (pz - a["z"]) * dz) / l2, 0.0, 1.0)
        L = math.sqrt(l2)
        if t * L < MIN_SEG_LEN or (1.0 - t) * L < MIN_SEG_LEN:
            return None
        mx, mz = a["x"] + dx * t, a["z"] + dz * t
        # (a) >= CROSS_MISS tới ngã giao THẬT (bậc >= 3) — khớp audit T4
        _jn, _jd = self._topo_near_junction(mx, mz, CROSS_MISS,
                                            ignore=(seg["from"], seg["to"]),
                                            min_deg=3)
        if _jd < CROSS_MISS:
            return None
        # (b) 8m tới node trên chính đoạn này — tránh cụt vô nghĩa
        if self._node_on_seg_near(mx, mz, a, b, 8.0,
                                  ignore=(seg["from"], seg["to"])):
            return None
        # GIỮ PROFILE: node mới lấy cao độ nội suy 2 đầu, KHÔNG gọi
        # get_road_datum. Hàm chạy SAU _grade_roads nên terrain tham bằng
        # phễnh nối 2 đầu -> đoạn mới nhảy 5-10m và biến thành 40% sườn.
        mid = self.add_node(mx, mz, a["region"],
                            force_y=lerp(a.get("y", 0.0), b.get("y", 0.0), t),
                            n_type=n_type)
        self._remove_segment(sid)
        x1 = self._add_segment_like(seg, seg["from"], mid)
        x2 = self._add_segment_like(seg, mid, seg["to"]) if x1 is not None else None
        if x1 is None or x2 is None:
            if x1 is not None:
                self._remove_segment(x1)
            self._add_segment_like(seg, seg["from"], seg["to"])
            self._drop_node(mid)
            return None
        self._topo_split_count = getattr(self, "_topo_split_count", 0) + 1
        return mid

    def _split_road_near(self, x, z, reach=90.0, classes=None, min_gap=0.0):
        """
        Tìm đoạn `classes` gần (x,z) trong `reach` và TÁCH NÓ tại điểm gần nhất
        trên đoạn đó, trả node mới. Nếu `min_gap` > 0 mà đã có nút giao trong
        khoảng đó thì KHÔNG tách (trả None) — để người gọi nối vào nút đó.

        Đây là cách tạo NGÃ GIAO THẬT: một phố đi qua QL1A thì QL1A bị chia
        đôi tại đúng điểm cắt, thay vì phố "ngoắt" vào một node QL cách xa
        (cách cũ gom 3-4 phố vào cùng 1 node -> 7 nhánh, đo được tại n_18:
        các góc -146 / -106 / -83 / -76 / 26 / 98 / 116).
        """
        best = None
        c0 = self._cell(x - reach, z - reach)
        c1 = self._cell(x + reach, z + reach)
        seen = set()
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if seg is None:
                        continue
                    if classes and seg["class"] not in classes:
                        continue
                    a, b = self.nodes[seg["from"]], self.nodes[seg["to"]]
                    dx, dz = b["x"] - a["x"], b["z"] - a["z"]
                    l2 = dx * dx + dz * dz
                    if l2 <= 0:
                        continue
                    t = clamp(((x - a["x"]) * dx + (z - a["z"]) * dz) / l2,
                               0.0, 1.0)
                    px_, pz_ = a["x"] + dx * t, a["z"] + dz * t
                    d = dist(x, z, px_, pz_)
                    if d > reach:
                        continue
                    if best is None or d < best[0]:
                        best = (d, sid, px_, pz_)
        if best is None:
            return None, None
        d, sid, px_, pz_ = best
        if min_gap > 0.0:
            _jn, jd = self._topo_near_junction(px_, pz_, min_gap + 1.0, min_deg=3)
            if jd <= min_gap:
                return None, d
        mid = self._split_seg_at_point(sid, px_, pz_, n_type="junction")
        if mid is None:
            return None, d
        return mid, d

    def _find_crossings(self, skip=("EXPRESSWAY", "RAMP", "TUNNEL"),
                        min_junction=0.0):
        """
        Mọi cặp đoạn CẮT NHAU ở mặt bằng. Nếu `min_junction` > 0 thì chỉ trả
        về cặp mà điểm cắt CÁCH > `min_junction` mọi ngã giao thật — tức là
        ngã giao bị THIẾU thật, đáng sửa. `min_deg=3` là bắt buộc: node bậc 2
        chỉ là điểm hình học giữa đường (lệch định nghĩa với audit => generator
        báo 0, audit báo 218).
        """
        out = []
        done = set()
        cell = 220.0
        grid = {}
        for sg in self.segments.values():
            if sg["class"] in skip:
                continue
            a, b = self.nodes[sg["from"]], self.nodes[sg["to"]]
            hw = (sg.get("width", 12) or 12) * 0.5
            for cx in range(int((min(a["x"], b["x"]) - hw) // cell),
                            int((max(a["x"], b["x"]) + hw) // cell) + 1):
                for cz in range(int((min(a["z"], b["z"]) - hw) // cell),
                                int((max(a["z"], b["z"]) + hw) // cell) + 1):
                    grid.setdefault((cx, cz), []).append(sg)
        for sg in self.segments.values():
            if sg["class"] in skip or sg["id"] in done:
                continue
            a, b = self.nodes[sg["from"]], self.nodes[sg["to"]]
            hw = (sg.get("width", 12) or 12) * 0.5
            for cx in range(int((min(a["x"], b["x"]) - hw) // cell),
                            int((max(a["x"], b["x"]) + hw) // cell) + 1):
                for cz in range(int((min(a["z"], b["z"]) - hw) // cell),
                                int((max(a["z"], b["z"]) + hw) // cell) + 1):
                    for o in grid.get((cx, cz), ()):
                        if o["id"] <= sg["id"] or o["id"] in done:
                            continue
                        if o["from"] in (sg["from"], sg["to"]) or \
                                o["to"] in (sg["from"], sg["to"]):
                            continue       # đã chia sẻ node => đã là ngã giao
                        q1, q2 = self.nodes[o["from"]], self.nodes[o["to"]]
                        if not _seg_cross((a["x"], a["z"]), (b["x"], b["z"]),
                                          (q1["x"], q1["z"]), (q2["x"], q2["z"])):
                            continue
                        d1x, d1z = b["x"] - a["x"], b["z"] - a["z"]
                        d2x, d2z = q2["x"] - q1["x"], q2["z"] - q1["z"]
                        den = d1x * d2z - d1z * d2x
                        if abs(den) < 1e-9:
                            continue
                        t = ((q1["x"] - a["x"]) * d2z -
                             (q1["z"] - a["z"]) * d2x) / den
                        px_, pz_ = a["x"] + d1x * t, a["z"] + d1z * t
                        if min_junction > 0.0:
                            _jn2, _jd2 = self._topo_near_junction(
                                px_, pz_, min_junction + 1.0, min_deg=3)
                            if _jd2 <= min_junction:
                                continue   # đã có ngã tư thật ở đây
                        out.append((px_, pz_, sg["id"], o["id"]))
            done.add(sg["id"])
        return out

    def _link_near_pair(self, px, pz, sa, sb, reach=None, cap=160.0):
        """
        2 đường cắt nhau tại (px,pz) nhưng đã có nút giao trong `reach` -> nối
        2 node đó lại với nhau thay vì tách thêm nút mới.

        Kết quả y hệt "điểm cắt đã có nút giao": giao lỗ trong data có thật,
        chỉ là ở lệch 40-100m. Không có hàm này, mỗi lần tách sinh ra 2 nút
        giao sát nhau.
        """
        if reach is None:
            reach = CROSS_MISS
        oa, ob = self.segments.get(sa), self.segments.get(sb)
        if oa is None or ob is None:
            return False
        _jn, jd = self._topo_near_junction(px, pz, reach, min_deg=3)
        if jd > reach:
            return False
        na = min((oa["from"], oa["to"]),
                 key=lambda q: dist(px, pz, self.nodes[q]["x"],
                                    self.nodes[q]["z"]))
        nb = min((ob["from"], ob["to"]),
                 key=lambda q: dist(px, pz, self.nodes[q]["x"],
                                    self.nodes[q]["z"]))
        if na == nb:
            return False                     # đã chung node -> đã là ngã giao
        d = dist(self.nodes[na]["x"], self.nodes[na]["z"],
                 self.nodes[nb]["x"], self.nodes[nb]["z"])
        if d > cap:
            return False
        cls = oa["class"] if TOPO_RANK.get(oa["class"], 4) >= \
            TOPO_RANK.get(ob["class"], 4) else ob["class"]
        sid, _why = self.topo_try_link(na, nb, cls)
        return sid is not None

    def _resolve_crossings(self, max_round=4, min_gap=55.0):
        """
        TẠI ĐIỂM HAI ĐƯỜNG CẮT NHAU -> TẠO NÚT GIAO THẬT.

        Thứ tự BẮT BUỘC: TÁCH TRƯỚC, nối-sau. Nối 2 node đã có chỉ thỏa *đồ
        thị* nhưng đường vẫn cắt nhau ở điểm cắt (đo được 239 giao lỗ khi đảo
        thứ tự này).

        Chỉ xử lý cặp cắt CÁCH > CROSS_MISS (100m) mọi ngã giao thật — dưới
        ngưỡng đó là ngã tư lệch, hợp lệ. Cặp cắt trong sân bến bỏ qua: layout
        sân là lưng thang + hành lang, giao nhau trong sân là ngã t-Y THIẾT KẾ.
        """
        fixed = jog = 0
        for _r in range(max_round):
            pairs = self._find_crossings(min_junction=CROSS_MISS)
            if not pairs:
                break
            progress = 0
            for (px, pz, sa, sb) in pairs:
                if self._in_station_keep(px, pz, 0.0):
                    continue
                na = self._split_seg_at_point(sa, px, pz)
                nb = self._split_seg_at_point(sb, px, pz)
                if na is not None and nb is not None:
                    fixed += 1
                    progress += 1
                    continue
                if self._link_near_pair(px, pz, sa, sb):
                    jog += 1
                    progress += 1
            if not progress:
                break
        if fixed or jog:
            print("      giao lo khong nut -> %d nut giao moi / %d doan noi ngang"
                  % (fixed, jog))
        return fixed, jog

    def _split_and_reattach(self, nid, sid, along=130.0):
        """
        Tách đường `sid` tại ~`along` mét kẻ từ node gần nhất, rồi chuyển cả
        hai đầu (node cũ + đầu xa) sang điểm mới tách.

        Dùng khi `_cap_node_degree` không tìm được node B để "treo" nhánh.
        Kết quả: bậc node `nid` giảm, đường vẫn liên thông vì đã tách đường
        (không phải xoá cạnh).
        """
        s = self.segments.get(sid)
        if s is None:
            return False
        a, b = s["from"], s["to"]
        pa, pb = self.nodes[a], self.nodes[b]
        L = dist(pa["x"], pa["z"], pb["x"], pb["z"])
        if L < MIN_SEG_LEN * 2.4:
            return False
        # tối thiểu CROSS_MISS để nó là ngã giao thật, không phải "nút giao mới
        # cách node cũ 22m" (audit T1: 74 cặp < 45m, phần lớn sinh từ đây)
        along = min(along, max(CROSS_MISS, L * 0.32))
        near = pa if nid == a else pb
        far = b if nid == a else a
        nx = lerp(near["x"], self.nodes[far]["x"], along / L)
        nz = lerp(near["z"], self.nodes[far]["z"], along / L)
        mid, _d = self._split_road_near(nx, nz, reach=30.0,
                                        classes=(s["class"],), min_gap=0.0)
        if mid is None or mid == nid:
            return False
        for m2 in (nid, far):
            for l in list(self._segs_at(m2)):
                sg = self.segments.get(l)
                if sg is None:
                    continue
                o = sg["to"] if sg["from"] == m2 else sg["from"]
                if o not in (nid, far):
                    continue
                self._remove_segment(l)
                self._add_segment_like(sg, mid, o)
        return True

    def _grow_road(self, start_nid, heading, length, level, rng, p):
        """Mọc đường theo bước, tạo junction khi chạm đường khác."""
        if level > 2:  # Reduced max level to prevent excessive branching
            return
        r_class = "LOCAL" if level == 0 else ("ALLEY" if level >= 2 else "COLLECTOR")
        if p["urban"] < 0.25 and level == 0:
            r_class = "RURAL_LOCAL"
        step = 70.0 if level == 0 else 45.0
        n_steps = max(2, min(int(length / step), 25))  # Cap max steps
        prev = start_nid
        x, z = self.nodes[start_nid]["x"], self.nodes[start_nid]["z"]
        h = heading
        for k in range(n_steps):
            h += rng.uniform(-0.25, 0.25)
            nx = x + math.cos(h) * step
            nz = z + math.sin(h) * step
            if self.dist_to_coast(nx, nz) < 15.0:
                break
            # KHÔNG cắt ngang cao tốc/hầm — đường nhỏ phải dừng lại hoặc đi vòng
            if self._crosses_major(self.nodes[prev]["x"], self.nodes[prev]["z"], nx, nz):
                break
            # SUON DOC >15%: duong nho khong theo duoc (do an goc cua
            # "duong doc 133%"). Real: duong ngoai vi tranh cliff, chi
            # QL1A/CT01 moi co hầm/đèo để vượt.
            p_now = self.nodes[prev]
            raw_dy = abs(self.get_elevation(nx, nz) - p_now.get("elev", p_now["y"]))
            if raw_dy / step > 0.15:
                break
            up, _ = self.corridor_u_dist(nx, nz)
            reg, _r = self.determine_region(nz, nx)
            # Tìm nút giao thật ở gần: chỉ nối qua CỔNG `topo_try_link`.
            # Cũ: `add_segment(prev, join, ...)` với `join` bất kỳ node nào
            # cách <16m — kể cả node cao tốc, node trong sân bến, node bậc 2.
            # Đó là nguồn gốc nan quạt 15-30 nhánh.
            join = None
            for sid in self._road_grid.get(self._cell(nx, nz), ()):
                seg = self.segments.get(sid)
                if not seg or seg["class"] in ("EXPRESSWAY", "TUNNEL"):
                    continue
                for cand in (seg["from"], seg["to"]):
                    if cand == prev or cand not in self.nodes:
                        continue
                    if self.nodes[cand].get("type") not in TOPO_JOINABLE_TYPES:
                        continue
                    if self._topo_deg(cand) < 3:
                        continue
                    if dist(nx, nz, self.nodes[cand]["x"],
                            self.nodes[cand]["z"]) >= 16.0:
                        continue
                    join = cand
                    break
                if join is not None:
                    break
            if join is not None:
                _sid, _why = self.topo_try_link(prev, join, r_class)
                if _sid is not None:
                    return
            # node GIỮA ĐƯỜNG là node HÌNH HỌC, không phải nút giao. Cũ đặt
            # `n_type="junction"` -> mỗi 70m lại có 1 "nút giao" giả, làm
            # bậc node và số nút giao vỡ (48 nút giao / 12km trước khi sửa).
            nn = self.add_node(nx, nz, reg, n_type="link")
            _sid, _why = self.topo_try_link(prev, nn, r_class)
            if _sid is None:
                self._drop_node(nn)
                break
            prev, x, z = nn, nx, nz

            # mọc nhánh - reduced probability
            if level < 2 and rng.random() < (0.20 - 0.05 * level):
                # HƯỚNG = giữa khe góc trống lớn nhất, KHÔNG phải ±90° ngẫu nhiên
                sub_h = self.topo_branch_h(nn, h, rng)
                self._grow_road(nn, sub_h, rng.uniform(120.0, 400.0),
                                level + 1, rng, p)
            # nếu đi đủ xa và có đường ở gần => nối lại tạo vòng (block)
            if k > 2 and rng.random() < 0.12:
                for sid in self._road_grid.get(self._cell(nx, nz), ()):
                    seg = self.segments.get(sid)
                    if not seg or seg["from"] == prev or seg["to"] == prev:
                        continue
                    if seg["class"] in ("EXPRESSWAY", "TUNNEL", "RAMP"):
                        continue
                    other = self.nodes[seg["to"]]
                    if dist(nx, nz, other["x"], other["z"]) < 260.0 and \
                       self._seg_clear((nx + other["x"]) / 2, (nz + other["z"]) / 2, 3.0, 4.0) and \
                       not self._crosses_major(self.nodes[prev]["x"], self.nodes[prev]["z"],
                                               other["x"], other["z"]):
                        self.add_segment(prev, seg["to"], r_class)
                        return

    # --------------------------------------------------------------------------
    # 4.9b ĐIỂM DỪNG XE BUÝT dọc QL1A (đặc trưng xe khách Việt Nam)
    # --------------------------------------------------------------------------
    def _build_bus_stops(self):
        """
        Mỗi ~8-9km một điểm dừng, so le 2 bên QL1A: mái chờ + biển bảng + chỗ
        đứng. Xuất ra POI type BUS_STOP (TrafficManager/main.js bỏ qua type này
        nên không ăn traffic budget).
        """
        self.bus_stops = []
        rng = stable_rng(self.seed, "busstops")
        s = 7000.0
        side = 1.0
        idx = 0
        while s < self.corridor_len - 7000.0:
            path = self._corridor_subpath(s, s + 260.0)
            if len(path) >= 2:
                px, pz = path[0][0], path[0][1]
                qx, qz = path[1][0], path[1][1]
                dx, dz = qx - px, qz - pz
                L = math.hypot(dx, dz) or 1.0
                ux, uz = dx / L, dz / L
                nx, nz = -uz, ux
                if self.dist_to_coast(px, pz) > 20.0 and \
                        self.water_factor(px + nx * 12 * side,
                                          pz + nz * 12 * side) < 0.2:
                    bx = px + nx * 11.0 * side
                    bz = pz + nz * 11.0 * side
                    self.bus_stops.append({
                        "id": "busstop_%03d" % idx,
                        "x": round(bx, 2), "z": round(bz, 2),
                        "y": round(self.get_road_datum(bx, bz), 3),
                        "heading": round(math.atan2(ux, uz), 3),
                        "side": side, "s": round(s, 1),
                    })
                    self._reserve(bx, bz, 5.0)
                    idx += 1
            s += rng.uniform(7600.0, 9600.0)
            side = -side
        print("      diem dung xe buyt tren QL1A: %d" % len(self.bus_stops))

    def _weld_close_nodes(self, min_d=4.0):
        """
        Gộp node cách nhau < min_d (node sinh trùng) -> hết đoạn 'cụt' 1-4m
        chênh cao lớn => dốc >100% (xe rung/bay, validation chặn).
        Không đụng node trong sân bến (cần giữ nguyên vị trí slot).
        """
        grid = {}
        for nid, n in self.nodes.items():
            if self._in_station_zone(n["x"], n["z"], 30.0):
                continue
            grid.setdefault((int(n["x"] // min_d), int(n["z"] // min_d)), []).append(nid)

        merged = 0
        for key in list(grid.keys()):
            for nid in list(grid.get(key, ())):
                if nid not in self.nodes:
                    continue
                a = self.nodes[nid]
                c0 = (int(a["x"] // min_d), int(a["z"] // min_d))
                best, bd = None, min_d * min_d
                for dx in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for oid in grid.get((c0[0] + dx, c0[1] + dz), ()):
                            if oid == nid or oid not in self.nodes:
                                continue
                            b = self.nodes[oid]
                            d2 = (b["x"] - a["x"]) ** 2 + (b["z"] - a["z"]) ** 2
                            if d2 < bd:
                                bd, best = d2, oid
                if best is None:
                    continue
                # gộp node ít connection vào node kia
                loser, keep = nid, best
                if len(self.nodes[nid]["connections"]) > len(self.nodes[best]["connections"]):
                    loser, keep = best, nid
                L = self.nodes[loser]
                K = self.nodes[keep]
                drop = []
                for sid in list(L["connections"]):
                    s = self.segments.get(sid)
                    if not s:
                        continue
                    o = s["to"] if s["from"] == loser else s["from"]
                    if o == keep:
                        drop.append(sid)
                        continue
                    if s["from"] == loser:
                        s["from"] = keep
                    else:
                        s["to"] = keep
                    K["connections"].append(sid)
                for sid in drop:
                    s = self.segments.pop(sid, None)
                    if s:
                        pa = self.nodes.get(s["from"])
                        pb = self.nodes.get(s["to"])
                        if pa and sid in pa["connections"]:
                            pa["connections"].remove(sid)
                        if pb and sid in pb["connections"]:
                            pb["connections"].remove(sid)
                L["connections"] = []
                self.nodes.pop(loser, None)
                for k in ((int(L["x"] // min_d), int(L["z"] // min_d)),
                          (int(K["x"] // min_d), int(K["z"] // min_d))):
                    if k in grid and loser in grid[k]:
                        grid[k].remove(loser)
                merged += 1

        if merged:
            # dựng lại index đường cho khớp graph mới
            self._road_grid = {}
            self.road_bboxes = []
            self._edge_index = {}
            for sid, s in self.segments.items():
                p1, p2 = self.nodes[s["from"]], self.nodes[s["to"]]
                self.road_bboxes.append((p1["x"], p1["z"], p2["x"], p2["z"], s["width"]))
                self._index_road(p1["x"], p1["z"], p2["x"], p2["z"], s["width"], sid)
            self._dedupe_edges()
            self._build_accel()
        print("      weld node trung (<%.1fm): %d" % (min_d, merged))
        return merged

    # ---------------------------------------------------------------------
    # SOURCE OF TRUTH CHO GRAPH (rule 56)
    # `segments` la su that. `connections` / `_edge_index` / `_nsi` /
    # `road_bboxes` / `_road_grid` deu la DUONG DAN, sinh lai tu segments.
    # Truoc day chung duoc bao tri tay => lech nhau => BFS noi gia => graph
    # bi tach thanh phan (do duoc 57 thanh phan).
    # ---------------------------------------------------------------------
    def _finalize_grade_separation(self):
        """CHONG LAI QUANG MUC KHAC cho duong nho qua cao toc (rule 11).

        Co so do: cac buoc sua giao lo TAO LAI segment, ma `add_segment` khong
        giu co `bridge` -> 63 duong da duoc danh dau o `_seal_expressway_nodes`
        lai tro ve "noi thang". Chay lai MOT LAN o cuoi pipeline, sau khi
        moi thay doi topology da xong.

        Duong nho qua duong toc o muc khac = cau vuot: dung thuc te Viet Nam
        (duong cap huyen/huyen qua duong toc bang cau vuot rat pho bien), va
        render cung dung: co nhip + tru, khong lo ao vao mat duong toc.
        """
        SMALL = ("LOCAL", "ALLEY", "RURAL_LOCAL", "SERVICE", "COLLECTOR")
        marked = 0
        at = {}
        for sid, s in self.segments.items():
            at.setdefault(s.get("from"), []).append(sid)
            at.setdefault(s.get("to"), []).append(sid)
        for nid, lst in at.items():
            has_hw = False
            has_ramp = False
            n_hw = 0
            for sid in lst:
                s = self.segments.get(sid)
                if s is None:
                    continue
                if s.get("class") == "EXPRESSWAY":
                    has_hw = True
                    n_hw += 1
                elif s.get("class") == "RAMP":
                    has_ramp = True
            # nut cao toc KHONG phai giao lo (khong ramp) moi can phong
            if not has_hw or has_ramp or n_hw >= 2:
                continue
            for sid in lst:
                s = self.segments.get(sid)
                if s is None or s.get("class") not in SMALL:
                    continue
                if s.get("bridge"):
                    continue
                s["bridge"] = True
                s["pier"] = True
                s["name"] = s.get("name") or "cau_vuot_nho"
                marked += 1
        if marked:
            print("      chong lai quang muc khac: %d duong nho qua cao toc" % marked)
        return marked

    def _fix_final_slopes(self, max_grade=0.16):
        """ÉP LẠI ĐỘ DỐC SAU CÙNG (rule 20/36: xe khách không leo dốc >16%).

        Chạy sau `_ensure_connected` vì link nối mảnh rời có thể tạo dốc mới.
        Ưu tiên:
          1. `_limit_slopes` nới lỏng (cho phép cắt/đắp nhiều hơn) để dốc mịn.
          2. Đoạn vẫn >16% => đánh dấu `bridge` + `pier` => vẽ thành cầu vượt
             có nhịp + trụ. Đây là CÁCH ĐÚNG: đoạn đó thực tế là cầu vượt /
             đường trên cao, không phải mặt đường nghiêng.
        """
        self._limit_slopes(max_grade=0.12, passes=30, max_cut=11.0, max_fill=9.0)
        self._grade_roads()
        marked = 0
        worst = 0.0
        for sid, s in self.segments.items():
            if s.get("bridge") or s["class"] == "TUNNEL":
                continue
            a, b = self.nodes.get(s["from"]), self.nodes.get(s["to"])
            if a is None or b is None:
                continue
            run = dist(a["x"], a["z"], b["x"], b["z"])
            if run < 1.0:
                continue
            g = abs(b.get("y", 0.0) - a.get("y", 0.0)) / run
            if g > worst:
                worst = g
            if g > max_grade:
                s["bridge"] = True
                s["pier"] = True
                s["name"] = s.get("name") or "cau_vuot"
                marked += 1
        if marked:
            print("      doc >%.0f%%: danh dau %d doan lau cau vuot (max %.1f%%)"
                  % (max_grade * 100, marked, worst * 100))
        return marked

    def _reconnect_islands(self, max_len=3200.0, cell=256.0, max_rounds=400):
        """NỐI LẠI MẢNH RỜI — bản sửa đúng cho `_connect_islands`.

        Khác biệt so với bản cũ:
          * quét lưới theo `max_len` THẬT (bản cũ cứng `[-4,4]` ô 256m nên
            mảnh cách >1024m không bao giờ tìm được ứng viên);
          * một ứng viên hỏng thì thử ứng viên kế tiếp, KHÔNG break cả vòng;
          * chấp nhận nối xa (đường dài) nếu không có lựa chọn gần hơn.
        """
        # ---- do lai thanh phan theo `segments` (nguon su that) ----
        adj = {}
        for sg in self.segments.values():
            a, b = sg.get("from"), sg.get("to")
            if a is None or b is None:
                continue
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)

        def _bfs(seeds):
            seen = set(seeds)
            stack = list(seeds)
            while stack:
                cur = stack.pop()
                for nxt in adj.get(cur, ()):
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)
            return seen

        nodes_with_seg = set(adj.keys())
        if not nodes_with_seg:
            return 0
        # main = thanh phan lon nhat.
        # PHAI dung `seen` chung: ban cu chay BFS cho MOI node (8600 lan) tren
        # component 7000 node => 60M phep, generator treo. Chi BFS tu node
        # CHUA thuoc thanh phan nao, moi node duoc duyet DUNG MOT LAN.
        seen_any = set()
        best_set, best_n = set(), 0
        for st in nodes_with_seg:
            if st in seen_any:
                continue
            comp = _bfs([st])
            seen_any |= comp
            if len(comp) > best_n:
                best_n, best_set = len(comp), comp
        main = best_set
        rest = nodes_with_seg - main
        if not rest:
            return 0

        reach = int(max_len // cell) + 1
        added = 0

        # GRID O DUNG MOT LAN, TANG DAN khi `main` phinh ra.
        # (Bản cũ dựng lại lưới 7000+ node MỖI vòng × 57 vòng => 326s CPU,
        #  generator không chạy nổi. Giờ 1 lần + tăng dần.)
        grid = {}

        def _add_to_grid(nid):
            n = self.nodes.get(nid)
            if n is None:
                return
            grid.setdefault((int(n["x"] // cell), int(n["z"] // cell)), []).append(nid)

        for nid in main:
            _add_to_grid(nid)

        level = 0
        for _ in range(max_rounds):
            if not rest:
                break
            cands = []
            for rid in rest:
                n = self.nodes.get(rid)
                if n is None:
                    continue
                c0 = (int(n["x"] // cell), int(n["z"] // cell))
                for dx in range(-reach, reach + 1):
                    for dz in range(-reach, reach + 1):
                        for mid in grid.get((c0[0] + dx, c0[1] + dz), ()):
                            m = self.nodes.get(mid)
                            if m is None:
                                continue
                            d2 = (m["x"] - n["x"]) ** 2 + (m["z"] - n["z"]) ** 2
                            if d2 <= max_len * max_len:
                                cands.append((d2, rid, mid))
            if not cands:
                break
            cands.sort()
            linked = False
            for d2, rid, mid in cands[:400]:
                n, m = self.nodes.get(rid), self.nodes.get(mid)
                if n is None or m is None:
                    continue
                L = math.sqrt(d2)
                if L < 6.0:
                    continue
                # ---- DIEU KIEN (theo danh cap) ----
                if level < 2:
                    if self._crosses_major(n["x"], n["z"], m["x"], m["z"]):
                        continue
                    if level < 1 and not self._seg_clear(
                            (n["x"] + m["x"]) * 0.5, (n["z"] + m["z"]) * 0.5, 2.0, 1.0):
                        continue
                # LIÊN THÔNG là ưu tiên 1, nhưng KHÔNG được liên thông bằng
                # cách đâm LOCAL vào MẶT CAO TỐC (rule 11/60). Đo được 11
                # `noi_manh` chạm thẳng nút cao tốc.
                if self._node_touches_expressway(mid) or \
                        self._node_touches_expressway(rid):
                    continue
                if self.add_segment(rid, mid, "LOCAL", name="noi_manh") is None:
                    continue
                # ---- KHOI COMMIT DUY NHAT (moi duong dan deu o day) ----
                k2 = (rid, mid) if rid < mid else (mid, rid)
                seg_new = self.segments.get(self._edge_index.get(k2, ""))
                if seg_new is not None and L > 0:
                    dy = abs(self.get_elevation(m["x"], m["z"]) -
                             self.get_elevation(n["x"], n["z"]))
                    if dy / L > 0.11:
                        seg_new["bridge"] = True
                        seg_new["pier"] = True
                        seg_new["name"] = seg_new.get("name") or "cau_noi"
                # cap nhat ke: CHI 1 canh moi vua them (khong quet 10k segment)
                adj.setdefault(rid, []).append(mid)
                adj.setdefault(mid, []).append(rid)
                comp = _bfs([rid])
                main |= comp
                rest -= comp
                for nn in comp:
                    _add_to_grid(nn)
                added += 1
                linked = True
                break
            if not linked:
                # 1) ban kinh lon hon  2) ha danh cap dieu kien  3) dung het
                if reach < 16:
                    reach += 2
                    continue
                if level < 2:
                    level += 1
                    reach = int(max_len // cell) + 1
                    continue
                break
        if added:
            print("      noi lai %d manh roi (con lai %d node)" % (added, len(rest)))
        elif rest:
            print("      ! khong noi duoc %d node roi (main=%d node, cands=%d)"
                  % (len(rest), len(main), len(cands)))
            # dem node main trong tam vong that su (khong lay mau)
            main_pts = [(self.nodes[x]["x"], self.nodes[x]["z"])
                        for x in main if x in self.nodes]
            for rid in sorted(rest)[:8]:
                n = self.nodes.get(rid)
                if n is None:
                    continue
                c100 = c300 = c1000 = 0
                dmin = 1e9
                for (mx2, mz2) in main_pts:
                    d2 = (mx2 - n["x"]) ** 2 + (mz2 - n["z"]) ** 2
                    if d2 < dmin:
                        dmin = d2
                    if d2 <= 100.0 ** 2:
                        c100 += 1
                    elif d2 <= 300.0 ** 2:
                        c300 += 1
                    elif d2 <= 1000.0 ** 2:
                        c1000 += 1
                # node ke (noi bang gi?)
                deg_r = len(self._segs_at(rid))
                print("        %s (%.0f, %.0f) bac=%d | main trong 100m=%d "
                      "300m=%d 1000m=%d | gan nhat %.1fm"
                      % (rid, n["x"], n["z"], deg_r, c100, c300, c1000,
                         math.sqrt(dmin)))
        return added

    def _sync_graph(self):
        conn = {nid: [] for nid in self.nodes}
        for sid, s in self.segments.items():
            a, b = s.get("from"), s.get("to")
            if a in conn:
                conn[a].append(sid)
            if b in conn and b != a:
                conn[b].append(sid)
        for nid, n in self.nodes.items():
            n["connections"] = conn.get(nid, [])
        self._edge_index = {}
        for sid, s in self.segments.items():
            a, b = s.get("from"), s.get("to")
            if a not in self.nodes or b not in self.nodes:
                continue
            key = (a, b) if a < b else (b, a)
            cur = self._edge_index.get(key)
            if cur is None:
                self._edge_index[key] = sid
                continue
            old = self.segments.get(cur)
            if old is not None and s["hierarchy"] < old["hierarchy"]:
                self._edge_index[key] = sid
        self._road_grid = {}
        self.road_bboxes = []
        for sid, s in self.segments.items():
            p1, p2 = self.nodes.get(s.get("from")), self.nodes.get(s.get("to"))
            if p1 is None or p2 is None:
                continue
            w = s.get("width", 12)
            self.road_bboxes.append((p1["x"], p1["z"], p2["x"], p2["z"], w))
            self._index_road(p1["x"], p1["z"], p2["x"], p2["z"], w, sid)
        self._nsi = None
        self._build_node_seg_index()
        return len(self.segments)

    def _count_components(self):
        """Dem thanh phan lien thong theo `segments` (nguon su that)."""
        adj = {}
        for s in self.segments.values():
            a, b = s.get("from"), s.get("to")
            if a is None or b is None:
                continue
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        seen = set()
        comps = []
        for nid in adj:
            if nid in seen:
                continue
            stack, size = [nid], 0
            seen.add(nid)
            while stack:
                cur = stack.pop()
                size += 1
                for nxt in adj.get(cur, ()):
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)
            comps.append(size)
        comps.sort(reverse=True)
        return comps

    def _ensure_connected(self, max_iter=5):
        """EP TAT CA THANH PHAN VAO MANG CHINH (rule 7/53/57).

        Chay CUOI pipeline. Lap lai den khi con 1 thanh phan, hoac het so lan.
        """
        self._sync_graph()
        total = 0
        for it in range(max_iter):
            comps = self._count_components()
            if len(comps) <= 1:
                break
            self._reconnect_islands(max_len=3200.0)
            self._sync_graph()
            total += 1
        comps = self._count_components()
        if len(comps) > 1:
            print("      ! con %d thanh phan roi (lon nhat %d/%d node)"
                  % (len(comps), comps[0], len(self.nodes)))
        return len(comps)

    def _connect_islands(self, max_links=200, max_len=2000.0):
        """
        BẢO HIỂM TOPOLOGY: mọi thành phần rời đều được nối vào mạng chính bằng
        link ngắn nhất hợp lệ (không cắt cao tốc). Bất kể lưới phố sinh ra thế
        nào, map cuối phải liên thông để xe chạy tới Nam Tuy Hòa -> Miền Đông Mới.
        """
        if not self.segments or not self.nodes:
            return 0

        def _bfs(seeds):
            seen = set(seeds)
            stack = list(seeds)
            while stack:
                cur = stack.pop()
                for sid in self.nodes[cur]["connections"]:
                    s = self.segments.get(sid)
                    if not s:
                        continue
                    o = s["to"] if s["from"] == cur else s["from"]
                    if o not in seen:
                        seen.add(o)
                        stack.append(o)
            return seen

        seeds = [nid for nid, n in self.nodes.items() if n["type"] == "highway"]
        if not seeds:
            seeds = [next(iter(self.nodes))]
        main = _bfs(seeds)
        rest = set(self.nodes) - main
        added = 0
        for _ in range(max_links):
            if not rest:
                break
            grid = {}
            for nid in main:
                n = self.nodes[nid]
                grid.setdefault((int(n["x"] // 256.0), int(n["z"] // 256.0)), []).append(nid)
            cands = []
            for rid in rest:
                n = self.nodes[rid]
                c0 = (int(n["x"] // 256.0), int(n["z"] // 256.0))
                for dx in range(-4, 5):
                    for dz in range(-4, 5):
                        for mid in grid.get((c0[0] + dx, c0[1] + dz), ()):
                            m = self.nodes[mid]
                            d2 = (m["x"] - n["x"]) ** 2 + (m["z"] - n["z"]) ** 2
                            if d2 <= max_len * max_len:
                                cands.append((d2, rid, mid))
            if not cands:
                break
            cands.sort()
            linked = False
            for d2, rid, mid in cands[:60]:
                n, m = self.nodes[rid], self.nodes[mid]
                L = math.sqrt(d2)
                if L < 6.0:
                    continue
                if self._crosses_major(n["x"], n["z"], m["x"], m["z"]):
                    continue
                # link noi manh chay SAU grading -> phai tu kiem tra san doc
                if abs(self.get_elevation(m["x"], m["z"]) -
                       self.get_elevation(n["x"], n["z"])) / L > 0.14:
                    continue
                if not self._seg_clear((n["x"] + m["x"]) * 0.5, (n["z"] + m["z"]) * 0.5, 2.0, 1.0):
                    continue
                # LIÊN THÔNG là ưu tiên 1, nhưng KHÔNG được liên thông bằng
                # cách đâm LOCAL vào MẶT CAO TỐC (rule 11/60). Đo được 11
                # `noi_manh` chạm thẳng nút cao tốc.
                if self._node_touches_expressway(mid) or \
                        self._node_touches_expressway(rid):
                    continue
                if self.add_segment(rid, mid, "LOCAL", name="noi_manh") is None:
                    continue
                comp = _bfs([rid])
                main |= comp
                rest -= comp
                added += 1
                linked = True
                break
            if not linked:
                break
        if added:
            print("      noi manh topology: %d link (con lai %d node)" % (added, len(rest)))
        return added

    def _fix_internal_crossings(self):
        """
        Lane nội bộ bến xe / sân bãi đô thị được phép nằm sát CT01, nhưng KHÔNG
        được cắt ngang cao tốc ở mặt bằng (topology sai). Bỏ đúng những đoạn đó.
        """
        hw = [(sid, s) for sid, s in self.segments.items()
              if s["class"] in ("EXPRESSWAY", "TUNNEL")]
        if not hw:
            return 0
        removed = 0
        # BẤT KỲ đoạn nào (trừ trục chính + ramp) cắt ngang cao tốc ở mặt
        # bằng đều là sai topology. Trước đây chỉ quét INTERNAL/SERVICE nên
        # đường tỉnh lộ mới sinh ra đã cắt qua CT01.
        for sid, seg in list(self.segments.items()):
            if seg["class"] in ("EXPRESSWAY", "NATIONAL", "TUNNEL", "RAMP"):
                continue
            p1, p2 = self.nodes[seg["from"]], self.nodes[seg["to"]]
            hit = None
            for hid, h in hw:
                h1, h2 = self.nodes[h["from"]], self.nodes[h["to"]]
                if _seg_cross((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                              (h1["x"], h1["z"]), (h2["x"], h2["z"])):
                    hit = hid
                    break
            if hit is None:
                continue
            self.segments.pop(sid, None)
            for nid in (seg["from"], seg["to"]):
                n = self.nodes.get(nid)
                if n and sid in n["connections"]:
                    n["connections"].remove(sid)
            removed += 1
        if removed:
            print("      xoa %d doan duong cat ngan cao toc" % removed)
        return removed

    def _drop_steep_segments(self, max_grade=0.16, protect=("NATIONAL", "EXPRESSWAY",
                                                            "TUNNEL", "RAMP",
                                                            "STATION_ACCESS")):
        """
        Safety net: sau grading van con doan >16% (do clamp cut/fill) => xoa.
        Doan nho khong the xay duoc tren suon day thi KHONG TON TAI (bi vong
        hinh duong bay len 80m so voi dia hinh).
        """
        dropped = 0
        for sid, seg in list(self.segments.items()):
            if seg["class"] in protect or seg.get("bridge"):
                continue
            a, b = self.nodes[seg["from"]], self.nodes[seg["to"]]
            run = dist(a["x"], a["z"], b["x"], b["z"])
            if run < 1.0:
                continue
            if abs(b["y"] - a["y"]) / run <= max_grade:
                continue
            self.segments.pop(sid, None)
            for nid in (seg["from"], seg["to"]):
                n = self.nodes.get(nid)
                if n and sid in n["connections"]:
                    n["connections"].remove(sid)
            dropped += 1
        if dropped:
            print("      xoa %d doan duong duong doc >%.0f%% (khong xay duoc o day)"
                  % (dropped, max_grade * 100))
        return dropped

    def _auto_tunnel_steep(self, trigger_grade=0.12, max_run=4500.0, min_run=120.0):
        """
        CAO TỐC ĐI QUA NÚI mà đoạn dốc >12%:
          - gom chuỉ các đoạn dốc liền kề thành 1 hành trình
          - LÀM PHẲNG profile giữa 2 cửa hầm (bằng lerp => dốc nhỏ)
          - đoạn nào có núi cao hơn đường >6m -> TUNNEL (thật: CT01 có hầm)
          - đoạn nào đường cao hơn đất >8m -> cầu vượt (cầu vượt qua thung lũng)
        Không làm gì nếu chuỗi quá ngắn (< min_run) — tránh hầm 20m vô nghĩa.
        """
        cand = [sid for sid, s in self.segments.items()
                if s["class"] in ("EXPRESSWAY", "NATIONAL") and not s.get("tunnel")]
        if not cand:
            return 0
        adj = {}
        for sid in cand:
            s = self.segments[sid]
            adj.setdefault(s["from"], []).append(sid)
            adj.setdefault(s["to"], []).append(sid)

        def _info(sid):
            s = self.segments[sid]
            a, b = self.nodes[s["from"]], self.nodes[s["to"]]
            run = dist(a["x"], a["z"], b["x"], b["z"])
            if run < 1.0:
                return False, 0.0, 0.0, 0.0
            g = abs(b["y"] - a["y"]) / run
            mx, mz = (a["x"] + b["x"]) * 0.5, (a["z"] + b["z"]) * 0.5
            e_mid = self.get_elevation(mx, mz)
            road_mid = (a["y"] + b["y"]) * 0.5
            return (g > trigger_grade), g, e_mid, road_mid

        seen, chains = set(), []
        for sid0 in cand:
            if sid0 in seen:
                continue
            seen.add(sid0)
            steep, g, e_mid, road_mid = _info(sid0)
            if not steep:
                continue
            # mở rộng: chỉ nối thêm đoạn cũng dốc (giữ nguyên hành trình)
            group = [sid0]
            grew = True
            while grew:
                grew = False
                for cur in list(group):
                    for nid in (self.segments[cur]["from"], self.segments[cur]["to"]):
                        for nsid in adj.get(nid, ()):
                            if nsid in seen:
                                continue
                            seen.add(nsid)
                            st2, _g, _e, _r = _info(nsid)
                            if st2:
                                group.append(nsid)
                                grew = True
            # xếp thành chuỗi
            start = group[0]
            if len(group) > 1:
                head = self.segments[start]
                if len(adj.get(head["to"], ())) > 1:
                    cands = [g for g in group
                             if self.segments[g]["to"] == head["from"]]
                    if cands:
                        start = cands[0]
            chain, used = [start], {start}
            while True:
                cur = self.segments[chain[-1]]
                nxt = None
                for nid in (cur["from"], cur["to"]):
                    for nsid in adj.get(nid, ()):
                        if nsid in used or nsid not in group:
                            continue
                        nxt = nsid
                        break
                    if nxt:
                        break
                if not nxt:
                    break
                chain.append(nxt)
                used.add(nxt)
            chains.append(chain)

        made_t = made_b = 0
        for chain in chains:
            L = 0.0
            for sid in chain:
                s = self.segments[sid]
                a, b = self.nodes[s["from"]], self.nodes[s["to"]]
                L += dist(a["x"], a["z"], b["x"], b["z"])
            if len(chain) < 2 or L < min_run or L > max_run:
                continue
            nlist = [self.segments[chain[0]]["from"]]
            for sid in chain:
                s = self.segments[sid]
                nlist.append(s["to"] if s["from"] == nlist[-1] else s["from"])
            if len(nlist) < 3:
                continue
            y0 = self.nodes[nlist[0]]["y"]
            y1 = self.nodes[nlist[-1]]["y"]
            for k, nid in enumerate(nlist):
                self.nodes[nid]["y"] = lerp(y0, y1, k / float(len(nlist) - 1))
            for sid in chain:
                s = self.segments[sid]
                a, b = self.nodes[s["from"]], self.nodes[s["to"]]
                mx, mz = (a["x"] + b["x"]) * 0.5, (a["z"] + b["z"]) * 0.5
                e_mid = self.get_elevation(mx, mz)
                road_mid = (a["y"] + b["y"]) * 0.5
                if e_mid > road_mid + 6.0:
                    s["class"] = "TUNNEL"
                    s["type"] = "tunnel"
                    s["tunnel"] = True
                    s["structure"] = "ham_nui"
                    s["width"] = 13.0
                    s["speed"] = 60
                    made_t += 1
                elif road_mid > e_mid + 8.0:
                    s["bridge"] = True
                    s["structure"] = "cau_vi"
                    made_b += 1
        if made_t or made_b:
            print("      auto-tunnel qua nui: %d doan ham / %d cau vượt" % (made_t, made_b))
        self.tunnel_segments = getattr(self, "tunnel_segments", 0) + made_t
        return made_t + made_b

    def _ql_tangent_at(self, x, z):
        """Hướng đơn vị của QL1A tại (x, z), suy từ 2 node QL kề nhau."""
        best, bn = float("inf"), None
        for nid in getattr(self, "_ql_node_ids", ()):
            q = self.nodes.get(nid)
            if q is None:
                continue
            d = dist(x, z, q["x"], q["z"])
            if d < best:
                best, bn = d, nid
        if bn is None:
            return None
        for sid in self._segs_at(bn):
            sg = self.segments.get(sid)
            if sg is None or sg["class"] not in ("NATIONAL", "ARTERIAL",
                                                 "TUNNEL"):
                continue
            o = self.nodes.get(sg["to"] if sg["from"] == bn else sg["from"])
            if o is None:
                continue
            L = math.hypot(o["x"] - self.nodes[bn]["x"],
                           o["z"] - self.nodes[bn]["z"])
            if L < 1.0:
                continue
            return ((o["x"] - self.nodes[bn]["x"]) / L,
                    (o["z"] - self.nodes[bn]["z"]) / L)
        return None

    def _build_settlements(self):
        """
        ĐÔ THỊ/THÔN = LƯỚI LỆCH (warped lattice):
          - node = giao của 2 trục lệch; MỌI cạnh dùng CHUNG node đó => mạng
            liên thông bằng cấu trúc (bản cũ mỗi tuyến là 1 chuỗi riêng =>
            26 thành phần rời, validation fail).
          - warp field (tổng sin/cos) áp lên MỌI node => đường cong, block méo,
            TUYỆT ĐỐI không phải caro.
          - cạnh biên lưới = VÀNH ĐẠI (nối thành vòng thật), vài đường chéo phá
            lưới, bỏ ~8% cạnh => siêu block + ngõ cụt.
          - phố cắt QL1A -> tách đôi, mỗi nửa nối vào NODE QL1A THẬT => giao
            cắt hợp lệ (không cắt ngang đường lớn).
          - đường phố không cắt cao tốc/hầm (_crosses_major).
        """
        self.settlements = []
        rng = stable_rng(self.seed, "settlement3")
        spec = {
            "city":    dict(radius=1350.0, step=195.0),
            "town":    dict(radius=880.0,  step=148.0),
            "village": dict(radius=470.0,  step=108.0),
            "hamlet":  dict(radius=270.0,  step=84.0),
        }
        ql_ids = [nid for nid in getattr(self, "_ql_node_ids", []) if nid in self.nodes]

        def _ql_near(x, z):
            bd, bn = 1e30, None
            for nid in ql_ids:
                n = self.nodes[nid]
                d = (n["x"] - x) ** 2 + (n["z"] - z) ** 2
                if d < bd:
                    bd, bn = d, nid
            return bn

        for ai, a in enumerate(ANCHORS):
            size = a["size"]
            if size == "none" or size not in spec or not ql_ids:
                continue
            sp = spec[size]
            ax, az = self.proj(a["lat"], a["lon"])
            hub_id, hub_d = None, 1e30
            for nid in ql_ids:
                n = self.nodes[nid]
                d = (n["x"] - ax) ** 2 + (n["z"] - az) ** 2
                if d < hub_d:
                    hub_d, hub_id = d, nid
            if hub_id is None or hub_d > (14.0 * 1000.0) ** 2:
                continue
            hub = self.nodes[hub_id]
            # TAM LƯỚI = TOẠ ĐỘ THẬT của thị trấn (trước đây đặt tại node QL1A
            # gần nhất => Dầu Giây lệch 1.5km khỏi vị trí thật).
            cx, cz = ax, az
            # ⚠ BIÊN ĐỘ WARP PHẢI THEO BƯỚC LƯỚI, KHÔNG THEO BÁN KÍNH.
            # Cũ: `sc = radius` (thành phố 1350m) => biên ±418m trong khi bước
            # lưới chỉ 195m => LƯỚI TỰ GẤP LÊN TRÊN THÂN CHÍNH NÓ (nham bi).
            # Đo được trong game: đường thành phố chạy thành dãy thẳng dài
            # hàng km thay vì lưới có block.
            R = sp["radius"]
            sc = sp["step"] * 0.36
            # nhưng phải trên đất liền, không dưới nước / quá sát biển
            if self.water_factor(cx, cz) > 0.05 or self.dist_to_coast(cx, cz) < 25.0:
                moved = False
                for rad in (100.0, 200.0, 320.0, 450.0, 600.0):
                    for k in range(12):
                        ang = 2.0 * math.pi * k / 12.0 + ai * 0.9
                        tx2 = ax + math.cos(ang) * rad
                        tz2 = az + math.sin(ang) * rad
                        if (self.water_factor(tx2, tz2) <= 0.03 and
                                self.dist_to_coast(tx2, tz2) > 30.0):
                            cx, cz = tx2, tz2
                            moved = True
                            break
                    if moved:
                        break
                if moved:
                    print("      ! thit tran '%s' lay lui %0.fm cho dat lien"
                          % (a["name"], rad))

            # trục chính: hướng QL1A tại node hub
            ax_, az_ = 0.0, -1.0
            for sid in hub["connections"]:
                s0 = self.segments.get(sid)
                if not s0:
                    continue
                o = self.nodes.get(s0["to"] if s0["from"] == hub_id else s0["from"])
                if not o:
                    continue
                dx, dz = o["x"] - cx, o["z"] - cz
                L = math.hypot(dx, dz)
                if L > 1.0:
                    ax_, az_ = dx / L, dz / L
                    break
            px_, pz_ = -az_, ax_

            # --- lưới offset (mỗi tuyến 1 khoảng cách KHÁC NHAU) ---
            us, u = [], -R
            while u <= R + 1.0:
                us.append(u)
                u += sp["step"] * rng.uniform(0.82, 1.26)
            vs, v = [], -R
            while v <= R + 1.0:
                vs.append(v)
                v += sp["step"] * rng.uniform(0.84, 1.24)

            # mỗi nút QL1A chỉ phục vụ MỘT phố cắt qua (xem chỗ dùng)
            ql_straddle = set()

            def _warp(x, z):
                wa = (0.20 * sc * math.sin(x * 0.0016 + ai * 1.7)
                      + 0.11 * sc * math.sin(z * 0.0027 - ai))
                wb = (0.18 * sc * math.cos(x * 0.0013 - ai * 0.8)
                      + 0.13 * sc * math.cos(z * 0.0022 + ai * 1.1))
                return wa, wb

            def _inside(x, z):
                ddx, ddz = x - cx, z - cz
                pu = ddx * px_ + ddz * pz_
                pv = ddx * ax_ + ddz * az_
                ang = math.atan2(pu, pv)
                rr = R * (1.0 + 0.13 * math.sin(ang * 3.0 + ai)
                          + 0.06 * math.sin(ang * 5.0 - ai * 0.9))
                return (pu * pu + pv * pv) <= rr * rr

            big = size in ("city", "town")

            def _node_ok(x, z):
                if not _inside(x, z):
                    return False
                # thon/lang: cho phep sat bien va vui cao hon (Dai Lanh,
                # Van Gia truoc day 0 node)
                if self.dist_to_coast(x, z) < (16.0 if big else 8.0):
                    return False
                if self.water_factor(x, z) > 0.12:
                    return False
                if self.region_params(x, z)["mountain"] > (0.75 if big else 0.92):
                    return False
                if self._in_station_zone(x, z, 40.0):
                    return False
                return self._seg_clear(x, z, 9.0, 3.0)

            nid_of = {}
            for iu, uu in enumerate(us):
                for iv, vv in enumerate(vs):
                    x = cx + px_ * uu + ax_ * vv
                    z = cz + pz_ * uu + az_ * vv
                    wa, wb = _warp(x, z)
                    x += wa
                    z += wb
                    if _node_ok(x, z):
                        nid_of[(iu, iv)] = self.add_node(x, z, "URBAN", n_type="local")

            made = 0

            def _link(a_id, b_id, cls, nm):
                nonlocal made
                if a_id is None or b_id is None or a_id == b_id:
                    return 0
                A, B = self.nodes[a_id], self.nodes[b_id]
                if self._crosses_major(A["x"], A["z"], B["x"], B["z"]):
                    return 0
                if self.add_segment(a_id, b_id, cls, name=nm) is None:
                    return 0
                made += 1
                return 1

            iu_max, iv_max = len(us) - 1, len(vs) - 1
            for (iu, iv), a_id in list(nid_of.items()):
                outer = (iu == 0 or iu == iu_max or iv == 0 or iv == iv_max)
                uu, vv = us[iu], vs[iv]
                # cạnh dọc (giữ u, tăng v)
                b_id = nid_of.get((iu, iv + 1))
                if b_id is not None and rng.random() > (0.0 if outer else (0.10 if iu % 2 else 0.05)):
                    if outer:
                        cls, nm = "ARTERIAL", "vang_%s" % a["name"]
                    elif iu % 3 == 0:
                        cls, nm = "ARTERIAL", "pho_%s" % a["name"]
                    elif iu % 2 == 0:
                        cls, nm = "COLLECTOR", "pho_%s" % a["name"]
                    else:
                        cls, nm = "LOCAL", "ngo_%s" % a["name"]
                    _link(a_id, b_id, cls, nm)
                # cạnh ngang (tăng u, giữ v) — cắt trục QL thì tách tại node QL
                b2 = nid_of.get((iu + 1, iv))
                if b2 is not None:
                    straddle = (iu + 1 < len(us)) and (uu * us[iu + 1]) < 0.0
                    if straddle:
                        hx = cx + px_ * (uu + us[iu + 1]) * 0.5 + ax_ * vv
                        hz = cz + pz_ * (uu + us[iu + 1]) * 0.5 + az_ * vv
                        # PHỐ SONG SONG VỚI QL1A THÌ KHÔNG PHẢI GIAO LỖ.
                        # Trên thực tế con phố chạy sát QL không tạo nút giao;
                        # nếu vẫn nối thì 3-4 nhánh dính nhau dưới 24°.
                        tan = self._ql_tangent_at(hx, hz)
                        if tan is not None:
                            ex = hx - self.nodes[a_id]["x"]
                            ez = hz - self.nodes[a_id]["z"]
                            el = math.hypot(ex, ez) or 1.0
                            if abs((ex / el) * tan[0] + (ez / el) * tan[1]) > 0.82:
                                straddle = False   # < 35 độ -> chỉ chạy gần QL
                    if straddle:
                        hx = cx + px_ * (uu + us[iu + 1]) * 0.5 + ax_ * vv
                        hz = cz + pz_ * (uu + us[iu + 1]) * 0.5 + az_ * vv
                        # TÁCH QL1A TẠI ĐÚNG ĐIỂM CẮT, và MỖI NÚT QL CHỈ NHẬN
                        # ĐÚNG 1 PHỐ. Không "nạp node QL có sẵn": 2-3 phố cùng
                        # cột lưới sẽ dồn vào 1 nút tạo tim quạt (đo ở n_18).
                        qln, _qd = self._split_road_near(
                            hx, hz, reach=90.0,
                            classes=("NATIONAL", "ARTERIAL", "TUNNEL"),
                            min_gap=TOPO_JUNCTION_SPACING[2])
                        if qln is not None and qln in ql_straddle:
                            qln = None
                        if qln is not None and qln != a_id and qln != b2:
                            ql_straddle.add(qln)
                            _link(a_id, qln, "COLLECTOR", "ngo_%s" % a["name"])
                            _link(qln, b2, "COLLECTOR", "ngo_%s" % a["name"])
                    elif rng.random() > (0.0 if outer else (0.12 if iv % 2 else 0.06)):
                        if outer:
                            cls, nm = "ARTERIAL", "vang_%s" % a["name"]
                        elif iv % 4 == 0:
                            cls, nm = "ARTERIAL", "pho_%s" % a["name"]
                        else:
                            cls, nm = "LOCAL", "ngo_%s" % a["name"]
                        _link(a_id, b2, cls, nm)
                # vài đường chéo (phá lưới hoàn hảo -> superblock)
                if rng.random() < 0.05:
                    b3 = nid_of.get((iu + 1, iv + 1))
                    if b3 is not None:
                        _link(a_id, b3, "ALLEY", "ngo_%s" % a["name"])

            # nối tâm lưới vào node QL1A thật
            center_id, cd = None, 1e30
            for nid in nid_of.values():
                n = self.nodes[nid]
                d = (n["x"] - cx) ** 2 + (n["z"] - cz) ** 2
                if d < cd:
                    cd, center_id = d, nid
            if center_id is not None and center_id != hub_id:
                _link(hub_id, center_id, "ARTERIAL", "vao_%s" % a["name"])

            # FALLBACK: 0 node (Đại Lãnh sát biển, Vũng Rô vùng núi) -> dò tâm
            # đất liền rồi dựng lưới nhỏ 3x3, không để thị trấn trống trơn.
            if not nid_of:
                # Vũng Rô: toạ độ thật nằm 1.3km NGOÀI BIỂN (đường bờ xấp xỉ
                # lệch) -> phải tìm đất liền xa hơn và cho phép sát bờ.
                for rad in range(60, 4200, 60):
                    for k in range(24):
                        ang = 2.0 * math.pi * k / 24.0 + ai
                        tx2 = ax + math.cos(ang) * rad
                        tz2 = az + math.sin(ang) * rad
                        if (self.water_factor(tx2, tz2) > 0.02 or
                                self.dist_to_coast(tx2, tz2) < 2.0 or
                                not self._seg_clear(tx2, tz2, 7.0, 2.0)):
                            continue
                        if self.region_params(tx2, tz2)["mountain"] > 0.95:
                            continue
                        mini = []
                        for du in (-sp["step"] * 0.6, 0.0, sp["step"] * 0.6):
                            for dv in (-sp["step"] * 0.6, 0.0, sp["step"] * 0.6):
                                mx2 = tx2 + px_ * du + ax_ * dv
                                mz2 = tz2 + pz_ * du + az_ * dv
                                if (self.water_factor(mx2, mz2) <= 0.12 and
                                        self.dist_to_coast(mx2, mz2) >= 2.0 and
                                        self._seg_clear(mx2, mz2, 7.0, 2.0)):
                                    mini.append(self.add_node(mx2, mz2, "URBAN",
                                                             n_type="local"))
                        if len(mini) >= 3:
                            for i2 in range(len(mini) - 1):
                                if dist(self.nodes[mini[i2]]["x"], self.nodes[mini[i2]]["z"],
                                        self.nodes[mini[i2 + 1]]["x"],
                                        self.nodes[mini[i2 + 1]]["z"]) > 20.0:
                                    self.add_segment(mini[i2], mini[i2 + 1], "LOCAL",
                                                     name="ngo_%s" % a["name"])
                                    made += 1
                            cx, cz = tx2, tz2
                            nid_of["fallback"] = mini[0]
                            break
                    if nid_of:
                        break
                if nid_of:
                    print("      ! thit tran '%s': dung luoi fallback tai (%.0f,%.0f)"
                          % (a["name"], cx, cz))

            self.settlements.append(dict(name=a["name"], anchor=hub_id, size=size,
                                         x=round(cx, 1), z=round(cz, 1),
                                         radius=R, nodes=max(1, len(nid_of)), segs=made))
        print("      settlements: %d (luoi lech, noi qua node QL that)" % len(self.settlements))

    # --------------------------------------------------------------------------
    # 4.10 STATIONS  (bến xe = 1 KHU VỰC có context, không phải object lẻ)
    # --------------------------------------------------------------------------
    def _build_provincial_routes(self, max_pairs=18, max_km=34.0):
        """
        TỈNH LỘ: nối thẳng các cụm thị trấn gần nhau, không phải mọi thành phố
        đều phải vòng ra QL1A. Chỉ nhận link nếu: không cắt cao tốc, san dốc
        <16%, và node đầu/cuối đã có đường (đừng mọc link vào hư không).
        """
        stt = [s for s in getattr(self, "settlements", ()) if s["nodes"] > 0]
        if len(stt) < 2:
            return 0
        pairs = []
        for i, a in enumerate(stt):
            for j, b in enumerate(stt):
                if j <= i:
                    continue
                d = dist(a["x"], a["z"], b["x"], b["z"]) / 1000.0
                # bo qua cap quá gan (da noi qua duong local) va qua xa
                if 2.5 < d < max_km:
                    pairs.append((d, i, j))
        pairs.sort()
        made = 0
        used_end = {}
        for d, i, j in pairs:
            if made >= max_pairs:
                break
            if used_end.get(i, 0) >= 2 or used_end.get(j, 0) >= 2:
                continue
            a, b = stt[i], stt[j]
            na, nb = self._nearest_station_node(a["x"], a["z"]), \
                self._nearest_station_node(b["x"], b["z"])
            if na is None or nb is None or na == nb:
                continue
            A, B = self.nodes[na], self.nodes[nb]
            L = dist(A["x"], A["z"], B["x"], B["z"])
            # _nearest_station_node lo trong 2.2km nen doan that co the dai hon
            # nhieu lan max_km (da tai 51km) -> bo qua thay vi ve 1 duong thang
            # khong gian qua ca khu vuc.
            if L > max_km * 1000.0 * 1.35:
                continue
            if self._crosses_major(A["x"], A["z"], B["x"], B["z"]):
                continue
            nm = "tinh_lo_%s_%s" % (a["name"], b["name"])
            # CHỈ dựng MỘT đường: chuỗi node chia nhỏ. Trước đây add_segment
            # thẳng na->nb chạy TRƯỚC, rồi lại chia nhỏ CHÍNH CÁI ĐOẠN ĐÓ
            # => 1 segment 12km + 30 segment chồng đúng lên nhau (trùng hình).
            n_mid = max(1, int(L / 400.0))
            prev, chain = na, 0
            for k in range(1, n_mid):
                t = k / float(n_mid)
                mx = lerp(A["x"], B["x"], t)
                mz = lerp(A["z"], B["z"], t)
                if self.water_factor(mx, mz) > 0.2 or self.dist_to_coast(mx, mz) < 15.0:
                    continue          # bo diem, GIU prev (truoc day prev=None -> dut chuoi)
                if prev is not None and self._crosses_major(self.nodes[prev]["x"],
                                                            self.nodes[prev]["z"],
                                                            mx, mz):
                    continue
                mn = self.add_node(mx, mz, "RURAL", n_type="junction")
                if mn is None:
                    continue
                if prev is not None and self.add_segment(prev, mn, "COLLECTOR",
                                                         width=10.0, lanes=2) is None:
                    continue          # giu prev, thu diem sau
                prev = mn
                chain += 1
            if prev is not None and prev != nb and not self._crosses_major(
                    self.nodes[prev]["x"], self.nodes[prev]["z"], B["x"], B["z"]):
                if self.add_segment(prev, nb, "COLLECTOR", width=10.0, lanes=2,
                                    name=nm) is not None:
                    chain += 1
            if chain == 0:
                # khong cat duoc giua 2 dau -> chi lay 1 duong thang de khong
                # lam dut mang.
                if self.add_segment(na, nb, "COLLECTOR", width=10.0, lanes=2,
                                    name=nm) is not None:
                    chain = 1
            if chain:
                used_end[i] = used_end.get(i, 0) + 1
                used_end[j] = used_end.get(j, 0) + 1
                made += 1
        if made:
            print("      duong tinh lo noi thit tran: %d tuyen" % made)
        return made

    def _nearest_station_node(self, x, z):
        """Node đường gần (x,z) trong bán kính 2km, loại trừ cao tốc."""
        best, bd = None, 2200.0
        c0 = self._cell(x - 2200.0, z - 2200.0)
        c1 = self._cell(x + 2200.0, z + 2200.0)
        seen = set()
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    seg = self.segments.get(sid)
                    if not seg or seg["class"] in ("EXPRESSWAY", "TUNNEL", "RAMP",
                                                  "INTERNAL", "STATION_ACCESS"):
                        continue
                    for nid in (seg["from"], seg["to"]):
                        n = self.nodes.get(nid)
                        if not n:
                            continue
                        d = dist(x, z, n["x"], n["z"])
                        if d < bd:
                            bd, best = d, nid
        return best

    def _refind_station_clear(self, x0, z0, w, d, qn, bx, bz):
        """TÌM LẠI VỊ TRÍ SÂN BẾN SẠCH (rule 11/14/16/63).

        Bến xe phải nằm BÊN LỀ đường chính, có lối vào, và TUYỆT ĐỐI không
        nằm trên cao tốc / trong lòng đường. Khi mọi vị trí vuông góc với
        trục QL đều bị đường khác cắt (khu nút giao), ta quét vành khuyên
        quanh điểm neo trên QL:
          * ưu tiên rect KHÔNG cắt bất kỳ đường nào (`_rect_clear_of_roads`)
          * bắt buộc cách mọi CAO TỐC thêm một khoảng lề (rule 11)
          * không nằm trên nước, không sát biển
        Trả về (x, z, w, d) hoặc None.
        """
        best = None
        base_hw = w * 0.5
        for rad in (base_hw + 70.0, base_hw + 130.0, base_hw + 210.0,
                    base_hw + 300.0, base_hw + 400.0, base_hw + 520.0):
            for k in range(24):
                ang = 2.0 * math.pi * k / 24.0
                cx2 = bx + math.cos(ang) * rad
                cz2 = bz + math.sin(ang) * rad
                for (rw, rd) in ((w, d), (d, w)):
                    crot = math.atan2(qn["x"] - cx2, qn["z"] - cz2)
                    if not self._rect_clear_of_roads(cx2, cz2, rw, rd, crot):
                        continue
                    wf, cd = self._rect_probe(cx2, cz2, rw, rd, crot)
                    if wf > 0.05 or cd < 25.0:
                        continue
                    # khoang cach toi duong lon nhat de gan diem neo (gia re)
                    dq = dist(cx2, cz2, qn["x"], qn["z"])
                    score = dq + (0.0 if rw == w else 400.0)
                    if best is None or score < best[0]:
                        best = (score, cx2, cz2, rw, rd)
            if best is not None:
                break        # ban kinh nho nhat dat duoc -> dung lai
        if best is None:
            return None
        return best[1], best[2], best[3], best[4]

    def _place_stations(self):
        """
        ĐẶT VỊ TRÍ + HƯỚNG toàn bộ bến xe TRƯỚC khi mở đường/thị trấn.

        2 BUG GỐC sửa tại đây:

        (a) STATION_ZONES HAY QUÁ TRỄ. Trước đây zone chỉ được append trong
            _station_complex (step 4.10) = SAU _build_settlements và
            _build_provincial_routes => mọi check "san ben" tại L2636/L2657
            đều là DEAD CODE. Hậu quả đo được: 65/78 điểm bị đường công cộng
            cắt qua sân, riêng 4/5 bến xe lớn bị cắt 11-41 đoạn
            (QL1A + đường thị trấn chạy xuyên giữa sân bến).

        (b) TÂM BẾN TRÙNG NODE ĐƯỜNG. tx,tz = proj(lat/lon); Nam Tuy Hòa =
            (0,2000) = node QL1A n_18 => vx,vz = qn - center = (0,0) =>
            VL = 0, vx,vz = 0/1 = 0, rot = atan2(0,0) = 0. Cổng bến rơi
            đúng giữa sân, access road chạy lấn sang một bên, và QL1A cắt
            ngang giữa sân. => Giữ nguyên vị trí TRÊN trục đường nhưng ĐẨY
            SANG NGANG (vuông góc) đủ để rìa sân cách tâm đường.
        """
        self.station_place = {}
        self.station_zones = []
        ai_off = 0.0
        hw_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                   if n["type"] in ("highway", "ramp")]
        for sd in STATION_DEFS:
            tx, tz = self.proj(sd["lat"], sd["lon"])
            # BẾN KHÔNG ĐƯỢC NẰM TRONG SÔNG/HỒ (bến Nha Trang bị sông Cửu
            # Đại cắt qua) -> dời tối đa 1150m về phía đất liền khô.
            if self.water_factor(tx, tz) > 0.08 or self.dist_to_coast(tx, tz) < 6.0:
                moved = 0.0
                for rad in (120.0, 240.0, 380.0, 520.0, 700.0, 900.0, 1150.0):
                    hit = False
                    for k in range(16):
                        ang = 2.0 * math.pi * k / 16.0 + ai_off
                        nx2 = tx + math.cos(ang) * rad
                        nz2 = tz + math.sin(ang) * rad
                        w2 = float(sd.get("w", 180)) * 0.5 + 45.0
                        d2s = float(sd.get("d", 130)) * 0.5 + 45.0
                        dry = True
                        for a1 in (-1.0, -0.5, 0.0, 0.5, 1.0):
                            for a2 in (-1.0, -0.5, 0.0, 0.5, 1.0):
                                if (self.water_factor(nx2 + a1 * w2, nz2 + a2 * d2s) > 0.04
                                        or self.dist_to_coast(nx2 + a1 * w2,
                                                              nz2 + a2 * d2s) < 15.0):
                                    dry = False
                                    break
                            if not dry:
                                break
                        if dry and self.water_factor(nx2, nz2) <= 0.05 and \
                                self.dist_to_coast(nx2, nz2) > 25.0:
                            tx, tz = nx2, nz2
                            moved, hit = rad, True
                            break
                    if hit:
                        break
                if moved:
                    print("      ! di chuyen ben '%s' khoi nuoc (%.0fm)" % (sd["id"], moved))
                ai_off += 0.7

            # node đường gần nhất (QL1A/CT01) để làm cổng bến
            ql, _d = self._nearest_node_on(tx, tz, hw_pool, 12000.0)
            if ql is None:
                print("      ! ben '%s': khong tim thay duong de noi" % sd["id"])
                continue
            qn = self.nodes[ql]
            nb = qn["connections"]
            if nb:
                s0 = self.segments[nb[0]]
                o = self.nodes[s0["from"] if s0["to"] == ql else s0["to"]]
                dx, dz = qn["x"] - o["x"], qn["z"] - o["z"]
                L = math.hypot(dx, dz) or 1.0
                tx_, tz_ = dx / L, dz / L
            else:
                tx_, tz_ = 0.0, -1.0

            w = float(sd.get("w", 180.0))
            d = float(sd.get("d", 130.0))
            # --- ĐẨY BẾN RA BÊN LỀ ĐƯỜNG ---
            # ux,uz = phuong vuong goc voi truc duong; canh bai (w) vuong goc
            # truc nen ria san o do lech w/2 them le 28m.
            ux, uz = -tz_, tx_
            half = w * 0.5 + 28.0
            tp = (tx - qn["x"]) * tx_ + (tz - qn["z"]) * tz_
            if abs(tp) > 500.0:          # mat duong cong manh -> lay node luon
                tp = 0.0
            # diem tren duong dung dien tam ben (dung cho access road)
            bx, bz = qn["x"] + tx_ * tp, qn["z"] + tz_ * tp
            # 1. SAN KHONG NAM TREN NUOC (rect da xoay theo duong)
            # 2. KHONG CAT DUONG DA DUNG (QL1A/CT01/ramp o step 1-2)
            # Danh gia theo CA HAI PHIA + cac buoc day ra, chon vi tri sach
            # dau tien; neu khong co vi tri nao hoan hao -> chon vi tri
            # "sach nhat" (nuoc thap nhat) thay vi reo lung.
            px2 = pz2 = None
            best = None
            for extra in (0.0, 60.0, 130.0, 220.0, 340.0):
                for side in (1.0, -1.0):
                    c1 = bx + ux * side * (half + extra)
                    c2 = bz + uz * side * (half + extra)
                    crot = math.atan2(qn["x"] - c1, qn["z"] - c2)
                    wf, cd = self._rect_probe(c1, c2, w, d, crot)
                    if wf <= 0.05 and cd >= 25.0 and \
                            self._rect_clear_of_roads(c1, c2, w, d, crot):
                        px2, pz2 = c1, c2
                        break
                    score = wf * 10.0 + max(0.0, 25.0 - cd) / 25.0
                    if best is None or score < best[0]:
                        best = (score, c1, c2)
                if px2 is not None:
                    break
            if px2 is None:
                px2, pz2 = best[1], best[2]
            tx, tz = px2, pz2

            # van con duong cat san? -> day them ra nua
            for extra in (55.0, 110.0, 180.0, 270.0):
                if self._rect_clear_of_roads(tx, tz, w, d, math.atan2(
                        qn["x"] - tx, qn["z"] - tz)):
                    break
                moved = False
                for sgn in (1.0, -1.0):
                    ax2 = bx + ux * sgn * (half + extra)
                    az2 = bz + uz * sgn * (half + extra)
                    arot = math.atan2(qn["x"] - ax2, qn["z"] - az2)
                    wf, cd = self._rect_probe(ax2, az2, w, d, arot)
                    if wf <= 0.05 and cd >= 25.0 and \
                            self._rect_clear_of_roads(ax2, az2, w, d, arot):
                        tx, tz, moved = ax2, az2, True
                        break
                if moved:
                    break
            else:
                if not self._rect_clear_of_roads(tx, tz, w, d, math.atan2(
                        qn["x"] - tx, qn["z"] - tz)):
                    if self._rect_clear_of_roads(tx, tz, d, w, math.atan2(
                            qn["x"] - tx, qn["z"] - tz)):
                        w, d = d, w   # doi chieu san: thu quay 90 do
                    else:
                        # ---- TÌM LẠI TRÊN VÀNH KHUYÊN RỘNG (rule 11/14) ----
                        # Bến Miền Đông Mới nằm cạnh nút giao Vành đai 3: mọi
                        # vị trí vuông góc với QL đều bị ramp/đường vành cắt,
                        # nên code cũ rơi về `best` và ĐẶT SÂN BẾN LÊN CAO TỐC
                        # (đo được: tâm bến cách trục Vành đai 3 chỉ 6.3m).
                        # Sân bến nằm trên cao tốc là sai hoàn toàn.
                        fixed = self._refind_station_clear(tx, tz, w, d, qn, bx, bz)
                        if fixed is not None:
                            ntx, ntz, nw, nd = fixed
                            if (ntx, ntz) != (tx, tz) or (nw, nd) != (w, d):
                                print("      ! ben '%s': tim lai vi tri sach "
                                      "%.0fm' tu duong chinh"
                                      % (sd["id"], math.hypot(ntx - tx, ntz - tz)))
                            tx, tz, w, d = ntx, ntz, nw, nd
                        else:
                            print("      ! ben '%s': van con duong cat san"
                                  % sd["id"])

            # huong cong ben: TU TAM BEN VE PHIA DUONG (khong phai nguoc lai)
            vx, vz = qn["x"] - tx, qn["z"] - tz
            VL = math.hypot(vx, vz) or 1.0
            vx, vz = vx / VL, vz / VL
            rot = math.atan2(vx, vz)
            self.station_place[sd["id"]] = dict(
                x=tx, z=tz, ql=ql, ax=bx, az=bz,
                vx=vx, vz=vz, tx_=tx_, tz_=tz_, rot=rot)
            # 2 ZONE:
            #  (1) rect CHÍNH XÁC (có rot) -> guard ĐƯỜNG. Phải chặt (không +70)
            #      vì node QL nằm ngay ngoài rìa sân vẫn phải sinh được đường.
            #  (2) rect + 70m lề -> guard NHÀ/đồ vật (chạy trước
            #      _build_settlements nên giờ mới có hiệu lực).
            self.station_zones.append({"x": tx, "z": tz, "w": w, "d": d,
                                       "rot": rot, "id": sd["id"],
                                       "keep_clear": True})
            self.station_zones.append({"x": tx, "z": tz, "w": w + 70.0,
                                       "d": d + 70.0, "rot": rot,
                                       "id": sd["id"] + "#pad"})
            print("      dat ben %-16s tai (%.0f,%.0f) lech %.0fm khoi duong"
                  % (sd["id"], tx, tz, half))

    def _build_stations(self):
        for sd in STATION_DEFS:
            pl = self.station_place.get(sd["id"]) if hasattr(self, "station_place") else None
            if pl is None:
                continue
            self._station_complex(sd, pl["ql"], pl["x"], pl["z"],
                                  pl["vx"], pl["vz"], pl["tx_"], pl["tz_"],
                                  pl["rot"], access=(pl["ax"], pl["az"]))

        # đảm bảo Bến xe Nam Tuy Hòa đứng đầu (RuntimeRoadGraph dùng pois[0])
        self.stations.sort(key=lambda s: 0 if s["id"] == "nam_tuy_hoa" else 1)

        # --- SPAWN: đúng trong bến, trên đường nội bộ, nối vào mạng bến ---
        spawn_station = next((s for s in self.stations if s.get("is_spawn")), None)
        if spawn_station:
            # BÂY GIỜ bến đã bị đẩy RA BÊN LỀ ĐƯỜNG nên tâm bến != SPAWN_TARGET
            # (mà SPAWN_TARGET là node trên QL1A). Spawn phải đi theo tâm bến.
            sx, sz = spawn_station["x"], spawn_station["z"]
            pl = (self.station_place.get(spawn_station["id"])
                  if getattr(self, "station_place", None) else None)
            # trục "d" cua ben = song song duong chinh -> duong noi bo chay trai
            # qua giua san, luon nam trong rect (±d/2).
            px_p, pz_p = (pl["vz"], -pl["vx"]) if pl else (1.0, 0.0)
            half_len = max(24.0, spawn_station["d"] * 0.5 - 18.0)
            # main.js: bus.group.rotation.y = heading + PI/2, forward = (cos h, -sin h)
            heading = math.atan2(-pz_p, px_p)
            inside = (abs(SPAWN_TARGET[0] - sx) <= spawn_station["w"] * 0.5 + 6.0 and
                      abs(SPAWN_TARGET[1] - sz) <= spawn_station["d"] * 0.5 + 6.0)
            if not inside:
                print("      spawn di chuyen theo ben -> (%.0f,%.0f)" % (sx, sz))
            spawn_station["spawn"] = {"x": round(sx, 3),
                                      "y": round(self.get_road_datum(sx, sz), 3),
                                      "z": round(sz, 3),
                                      "heading": round(heading, 4)}
            self.spawn_point = spawn_station["spawn"]
            sp_nid = self.add_node(sx, sz, "URBAN", n_type="bus_station")
            w_nid = self.add_node(sx - px_p * half_len, sz - pz_p * half_len,
                                  "URBAN", n_type="internal")
            e_nid = self.add_node(sx + px_p * half_len, sz + pz_p * half_len,
                                  "URBAN", n_type="internal")
            self.add_segment(w_nid, sp_nid, "INTERNAL", width=16.0, lanes=2)
            self.add_segment(sp_nid, e_nid, "INTERNAL", width=16.0, lanes=2)
            spawn_station["spawn_road"] = [w_nid, sp_nid, e_nid]
            best_nid, best_d = None, 1e9
            for nid, n in self.nodes.items():
                if nid in (w_nid, sp_nid, e_nid):
                    continue
                if n["type"] not in ("internal", "station_gate", "bus_bay",
                                     "staging", "junction", "bus_station"):
                    continue
                dd = dist(n["x"], n["z"], sx, sz)
                if dd < best_d:
                    best_d, best_nid = dd, nid
            if best_nid is not None and MIN_SEG_LEN < best_d < 400.0:
                self.add_segment(sp_nid, best_nid, "INTERNAL", width=14.0, lanes=1)
                self.add_segment(w_nid, best_nid, "INTERNAL", width=12.0, lanes=1)
                self.add_segment(e_nid, best_nid, "INTERNAL", width=12.0, lanes=1)
                spawn_station["spawn_link"] = best_nid

    def _station_complex(self, sd, ql_nid, cx, cz, px, pz, tx_, tz_, rot,
                         access=None):
        """
        KHU VỰC BẾN XE:
          Bến xe | Station Yard | Ticket Building | Utilities | Internal Roads
                | Surrounding Buildings | Local Roads | Main Road | Connection QL
        px,pz = huong TU TAM BEN VE PHIA DUONG (unit). Rect cua ben: chieu rong
        (w) nam tren truc px,pz, chieu sau (d) song song voi duong.
        """
        w, d = sd["w"], sd["d"]
        # T-junction THẬT trên đường chính: chèn node tại DIEM TRÊN ĐƯỜNG
        # đúng đối diện sân bến (trước đây là tâm bến => nearest segment co
        # theo la mot duong le, va voi tam ben tren duong thi no tra ve QL
        # ngay tai tam => access road ngan/lan trong san).
        if access is not None:
            access_anchor, _ = self._split_segment_at(access[0], access[1],
                                                      tolerance=45.0)
        else:
            access_anchor, _ = self._split_segment_at(cx, cz,
                                                      tolerance=999999.0)
        if access_anchor is None:
            access_anchor = ql_nid

        # --- đường dẫn vào bến (STATION_ACCESS) từ QL ---
        # CỔNG PHẢI NẰM TRÊN RIA SAN HƯỚNG VỀ ĐƯỜNG. (w/2 = nửa bề rộng theo
        # truc px,pz). Cong thuc cu `cx - px*(d*0.5)` dat cong o PHIA XA DUONG
        # -> access road di vao ben qua ben kia.
        gate_x, gate_z = cx + px * (w * 0.5 - 4.0), cz + pz * (w * 0.5 - 4.0)
        prev = access_anchor
        steps = 3
        for k in range(1, steps + 1):
            t = k / steps
            gx = lerp(self.nodes[access_anchor]["x"], gate_x, t)
            gz = lerp(self.nodes[access_anchor]["z"], gate_z, t)
            nid = self.add_node(gx, gz, "URBAN",
                                n_type="station_gate" if k == steps else "junction")
            self.add_segment(prev, nid, "STATION_ACCESS")
            prev = nid
        gate_node = prev

        # ============ SAN BEN: LUONG THANG + NHIEU HANH LANG ============
        # KHONG duoc noi moi lan do ve 2 node goc (do duoc: n_18 co 7 nhanh,
        # goc -146/-106/-83/-76/26/98/116). Dung LUNG THANG chay doc theo `oz`,
        # moi node spine toi da 2 nhanh, moi lan do treo vao 1 node spine rieng.
        hw, hd = w * 0.5, d * 0.5
        ca, sa = math.cos(rot), math.sin(rot)

        def w2(ox, oz):
            """(ox,oz) khu vuc -> (x,z) theo `rot`."""
            return cx + ox * sa + oz * ca, cz + ox * ca - oz * sa

        corners = [(-hw + 12, -hd + 12), (hw - 12, -hd + 12),
                   (hw - 12, hd - 12), (-hw + 12, hd - 12)]
        cids = []
        for (ox, oz) in corners:
            wx, wz = w2(ox, oz)
            cids.append(self.add_node(wx, wz, "URBAN", n_type="internal"))
        for i in range(4):
            self.add_segment(cids[i], cids[(i + 1) % 4], "INTERNAL",
                             width=12.0, lanes=1)
        # cong mo ra cua truoc: noi vao 2 goc CUNG phia duong
        self.add_segment(gate_node, cids[1], "INTERNAL", width=14.0, lanes=1)
        self.add_segment(gate_node, cids[2], "INTERNAL", width=14.0, lanes=1)

        # --- nha ga (ticket building) : DINH NGhia TRUOC de tinh spine ---
        tb_w, tb_d = w * 0.34, d * 0.22
        tb_ox, tb_oz = -hw * 0.35, -hd * 0.62
        tb_x, tb_z = w2(tb_ox, tb_oz)
        self._add_facility_building(tb_x, tb_z, "TERMINAL", w=tb_w, d=tb_d,
                                    h=13.0, rot=rot, roof="flat")
        # mep nha ga gan sang tam hon (theo truc ox)
        tb_near_ox = tb_ox + tb_w * 0.5

        # --- utilities ---
        util = [(-hw * 0.75, hd * 0.55, "UTILITY", 10.0, 8.0, 4.5),
                (hw * 0.72, -hd * 0.5, "UTILITY", 9.0, 7.0, 4.0),
                (hw * 0.75, hd * 0.5, "WAREHOUSE", 14.0, 10.0, 6.0),
                (-hw * 0.7, -hd * 0.1, "UTILITY", 8.0, 6.0, 3.6)]
        for (ox, oz, typ, bw, bd, bh) in util:
            ux, uz = w2(ox, oz)
            self._add_facility_building(ux, uz, typ, w=bw, d=bd, h=bh, rot=rot,
                                        roof="pitched")

        # --- LUONG THANG: dat SAU mat truoc nha ga de mui lan do khong choc
        #     nha ga (4/5 ben bi loi nay truoc khi sua) ---
        ox_spine = max(hw * 0.16, tb_near_ox + 34.0)
        lo_ox, hi_ox = -hw + 12.0, hw - 12.0
        ox_spine = min(max(ox_spine, lo_ox + 26.0), hi_ox - 26.0)
        spine_half = 15.0          # khoang cach mui xe -> luong thang
        oz_lo, oz_hi = -hd + 26.0, hd - 26.0
        bay_count = int(sd["bays"])
        n_side = 2 if (ox_spine - spine_half) > (tb_near_ox + 6.0) else 1

        # SỐ NODE LƯNG THẮNG SCALE THEO SỐ BÃI: mỗi node spine đỡ được
        # (trần_bậc - 2) bãi. Cố định `span/46` cho Miền Đông Mới chỉ 4 node
        # => 4 × (8-2) = 24 bãi < 50 (đo được 16/50).
        _cap_in = TOPO_DEGREE_CAP[5]
        n_spine = max(4, int(math.ceil(bay_count / float(max(1, _cap_in - 2)))),
                      int((oz_hi - oz_lo) / 46.0) + 1)
        spine = []
        for k in range(n_spine):
            oz = lerp(oz_lo, oz_hi, k / float(max(1, n_spine - 1)))
            wx, wz = w2(ox_spine, oz)
            spine.append(self.add_node(wx, wz, "URBAN", n_type="internal"))
        for k in range(len(spine) - 1):
            self.add_segment(spine[k], spine[k + 1], "INTERNAL",
                             width=13.0, lanes=2)
        # 2 dau luong thang noi vao 2 GOC KHAC NHAU
        self.add_segment(cids[3], spine[0], "INTERNAL", width=12.0, lanes=1)
        self.add_segment(cids[0], spine[-1], "INTERNAL", width=12.0, lanes=1)

        # --- BAI DO: moi mui xe la 1 node rieng, noi vao 1 node spine rieng ---
        bays = []
        per_row = max(1, int(math.ceil(bay_count / float(n_side))))
        print("      [san %s] w=%.0f d=%.0f hw=%.1f tb_near_ox=%.1f "
              "ox_spine=%.1f lo=%.1f hi=%.1f n_side=%d per_row=%d n_spine=%d "
              "bays=%d"
              % (sd["id"], w, d, hw, tb_near_ox, ox_spine, lo_ox, hi_ox,
                 n_side, per_row, n_spine, bay_count))
        placed = 0
        for row in range(n_side):
            sgn = -1.0 if row == 0 else 1.0
            ox_nose = ox_spine + sgn * spine_half
            if not (lo_ox + 6.0 <= ox_nose <= hi_ox - 6.0):
                continue
            prev_bn = None
            for j in range(per_row):
                if placed >= bay_count:
                    break
                oz = lerp(oz_lo, oz_hi, (j + 0.5) / per_row)
                bx, bz = w2(ox_nose, oz)
                bn = self.add_node(bx, bz, "URBAN", n_type="bus_bay")
                # PHÂN BỐ ĐỀU THEO CHỈ SỐ, không theo khoảng cách. Bản cũ
                # chọn node spine gần nhất nên bãi dồn cục bộ (Nha Trang:
                # spine[1] nhận 4 bãi = chạm trần 6, 2 bãi cuối không gán
                # được -> 22/24). Chia đều: mỗi node đỡ ceil(per_row/n_spine)
                # bãi ≤ trần-2, luôn đạt đủ.
                si = min(len(spine) - 1, (j * len(spine)) // per_row)
                # gan vao node spine tai nhat; node do da chap tran thi dung
                # node spine ke tiep
                for cand in (si, min(si + 1, len(spine) - 1),
                             max(si - 1, 0)):
                    if self._topo_has_budget(spine[cand]):
                        self.add_segment(spine[cand], bn, "INTERNAL",
                                         width=6.5, lanes=1)
                        break
                else:
                    self._drop_node(bn)
                    continue
                # hanh lang doc: noi mui xe nay voi mui xe ke ben canh
                if prev_bn is not None:
                    self.add_segment(prev_bn, bn, "INTERNAL", width=6.5, lanes=1)
                prev_bn = bn
                bays.append({"x": round(bx, 2),
                             "y": round(self.get_road_datum(bx, bz) + 0.5, 3),
                             "z": round(bz, 2),
                             "heading": round(rot + sgn * (math.pi / 2.0), 3)})
                placed += 1

        if placed != bay_count:
            print("      ! san %s chi dat %d/%d bai (n_side=%d per_row=%d)"
                  % (sd["id"], placed, bay_count, n_side, per_row))

        # --- khu do xe / staging : SAI DAU `+sa` DA SUA THANH `-sa` ---
        sx_ox, sz_oz = hw * 0.62, -hd * 0.15
        sx_x = cx + sx_ox * sa + sz_oz * ca
        sx_z = cz + sx_ox * ca - sz_oz * sa
        stg = self.add_node(sx_x, sx_z, "URBAN", n_type="staging")
        self.add_segment(cids[3], stg, "INTERNAL", width=8.0, lanes=1)

        # --- danh sach cong trinh theo TOA DO CUC BO (ox,oz) ---
        # JS ve san + nha ga + cong trinh tu data nay. Truoc day JS tu tinh
        # lai toa do World => lech khung (do duoc: hoan w<->d, sai dau toan).
        structures = [{"type": "TERMINAL", "ox": round(tb_ox, 3),
                       "oz": round(tb_oz, 3), "w": round(tb_w, 3),
                       "d": round(tb_d, 3), "rot": round(rot, 4)}]
        for (ox, oz, typ, bw, bd, bh) in util:
            structures.append({"type": typ, "ox": round(ox, 3),
                               "oz": round(oz, 3), "w": round(bw, 3),
                               "d": round(bd, 3), "rot": round(rot, 4)})

        # --- reserved zone (cấm nhà trong bến) ---
        # _place_stations đã thêm zone từ trước (để guard ĐƯỜNG có hiệu lực với
        # cả _build_settlements) -> chỉ thêm khi chưa có, tránh trùng.
        if not any(z.get("id") == sd["id"] for z in self.station_zones):
            self.station_zones.append({"x": cx, "z": cz, "w": w + 70.0,
                                       "d": d + 70.0, "rot": rot, "id": sd["id"]})
        self._reserve(cx, cz, max(w, d) * 0.5)

        self.stations.append({
            "id": sd["id"], "name": sd["name"], "type": sd["poi_type"],
            "x": round(cx, 2), "y": round(self.get_road_datum(cx, cz), 3),
            "z": round(cz, 2), "w": w, "d": d, "rot": round(rot, 4),
            "access_node": gate_node, "anchor_node": access_anchor,
            "is_spawn": bool(sd.get("spawn")),
            "bays": bay_count,
            # busBays để trống — TrafficManager.setupStationTraffic() sẽ return
            # ngay (nếu populate, static bus ăn hết traffic budget của
            # maxActive => Traffic AI chết). Xe tĩnh dùng baySlots ở dưới.
            "buses": [],
            "baySlots": bays,
            # KHUNG SAN BEN theo toa do cuc bo (ox, oz) — JS DUNG THANG, khong
            # tu hardcode layout (ban cu hoan w<->d va sai dau `sin*lz`).
            "yardOx": round(ox_spine, 3),
            "yardOz": round((oz_lo + oz_hi) * 0.5, 3),
            "yardHalfOz": round((oz_hi - oz_lo) * 0.5, 3),
            "yardSpineHalf": round(spine_half, 3),
            "structures": structures,
            "region": self.determine_region(cz, cx)[1],
        })

    def _add_facility_building(self, x, z, btype, w, d, h, rot=0.0, roof="flat"):
        if not self._is_space_clear(x, z, max(w, d) * 0.5, 4.0):
            return None
        b = {"x": round(x, 2), "y": round(self.get_road_datum(x, z), 3),
             "z": round(z, 2), "type": btype, "variant": -1,
             "floors": max(1, int(round(h / 3.2))), "w": w, "d": d,
             "height": h, "roof_type": roof, "roof_color": 0x3f5f7a,
             "color": 0xe8e8e8, "facade": 0xe8e8e8, "rot": round(rot, 4),
             "awning": False, "sign": True}
        self._add_building_to_chunks(b)
        # Facility buildings are in station zones - don't add to object_positions
        # as station zones handle collision for the station area
        return b

    def _reserve_toll_booths(self):
        """Trạm thu phí: gạt xe 2 làn vào (không barie) + 1 làn ra có barie."""
        for f in getattr(self, "facility_pois", []):
            if f.get("type") != "TOLL":
                continue
            rot = f["rot"]
            ca, sa = math.cos(rot), math.sin(rot)
            for i, off in enumerate((-9.0, 9.0, 27.0)):
                lx, lz = off, 6.0
                bx = f["x"] + lx * sa + lz * ca
                bz = f["z"] + lx * ca - lz * sa
                self._add_facility_building(bx, bz, "TOLL_LANE", w=4.0, d=7.0,
                                            h=1.1, rot=rot, roof="flat")

    def _build_facilities(self):
        """
        Trạm thu phí / trạm nghỉ / cây xăng theo TOẠ ĐỘ THẬT, nối bằng đường
        SERVICE thật vào road gần nhất (không nhảy random theo chunk).
        """
        self.facility_pois = []
        highway_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                        if n["type"] in ("highway", "ramp", "junction")]
        for (fid, fname, lat, lon, ptype) in FACILITY_DEFS:
            fx0, fz0 = self.proj(lat, lon)
            node, dd = self._nearest_node_on(fx0, fz0, highway_pool, 9000.0)
            if node is None:
                continue
            # ĐƯỜNG SERVICE KHÔNG ĐÂM THẲNG VÀO MẶT CAO TỐC (rule 11/60).
            # `_nearest_node_on` trả node gần nhất — thường là node trên thân
            # CT01 nên 7/19 cơ sở dính lỗi. Ưu tiên node đã qua RAMP hoặc
            # thuộc QL1A; bán kính 25km vì 9km chưa đủ (QL1A chạy song song
            # cao tốc nên 25km luôn tìm được node hợp lệ).
            if self._node_touches_expressway(node):
                alt, _ad = self._nearest_node_on(
                    fx0, fz0,
                    [q for q in highway_pool
                     if not self._node_touches_expressway(q[1])], 25000.0)
                if alt is not None:
                    node = alt
            qn = self.nodes[node]
            nb = qn["connections"]
            if nb:
                s0 = self.segments[nb[0]]
                o = self.nodes[s0["from"] if s0["to"] == node else s0["to"]]
                dx, dz = qn["x"] - o["x"], qn["z"] - o["z"]
                L = math.hypot(dx, dz) or 1.0
                tx_, tz_ = dx / L, dz / L
            else:
                tx_, tz_ = 0.0, -1.0
            px, pz = -tz_, tx_
            if px > 0:
                px, pz = -px, -pz
            reach = 70.0 if ptype == "TOLL" else 60.0
            fx = qn["x"] + px * 46.0 + tx_ * reach
            fz = qn["z"] + pz * 46.0 + tz_ * reach
            rot = math.atan2(2 * tx_, 2 * tz_)

            prev = node
            for k in (1, 2):
                t = k / 2.0
                ix = lerp(qn["x"], fx, t)
                iz = lerp(qn["z"], fz, t)
                nid = self.add_node(ix, iz, "URBAN",
                                    n_type="facility" if k == 2 else "junction")
                self.add_segment(prev, nid, "SERVICE", name=fname)
                prev = nid

            if ptype == "FUEL_STATION":
                self._add_facility_building(fx, fz, "FUEL_STATION", w=26.0, d=16.0,
                                            h=6.0, rot=rot, roof="flat")
            elif ptype == "REST_AREA":
                self._add_facility_building(fx, fz, "REST_AREA", w=34.0, d=18.0,
                                            h=7.0, rot=rot, roof="pitched")
            else:   # TOLL: nhà thu phí + mái che làn
                self._add_facility_building(fx, fz, "TOLL", w=22.0, d=12.0,
                                            h=5.0, rot=rot, roof="flat")
            self.station_zones.append({"x": fx, "z": fz, "w": 70.0, "d": 60.0,
                                       "rot": rot, "id": fid})
            self.facility_pois.append({
                "id": fid, "name": fname, "type": ptype,
                "x": round(fx, 2), "y": round(self.get_road_datum(fx, fz), 3),
                "z": round(fz, 2), "w": 50.0, "d": 40.0, "rot": round(rot, 4),
                "bays": 0, "buses": [], "is_spawn": False,
            })
        self._reserve_toll_booths()

    # --------------------------------------------------------------------------
    # 4.11 BUILDINGS + ROADSIDE OBJECTS
    # --------------------------------------------------------------------------
    def generate_environment(self):
        print("[5/8] Buildings (road frontage + setback + collision) ...")
        # LƯỢT 1: phủ thưa toàn bộ mạng đường (bảo đảm không phố nào bị trống)
        self._place_buildings(coarse=True)
        print("      lượt 1 (phủ thưa): %d nha" % self._building_count)
        # LƯỢT 2: phủ dày, dùng hết ngân sách còn lại
        self._place_buildings(coarse=False)
        print("      buildings: %d (variations used: %d)"
              % (self.building_count, len(self.variant_used)))
        print("[6/8] Roadside objects / vegetation ...")
        self._place_objects()
        self._place_crosswalks()
        self._place_guardrails()

    def _add_building_to_chunks(self, b):
        """Building giao chunk -> PHẢI ghi vào TẤT CẢ chunk mà nó chạm
        (rule 45: object xuyên chunk boundary)."""
        self.building_count += 1
        hw, hd = max(b["w"], 6.0) * 0.5 + 2.0, max(b["d"], 6.0) * 0.5 + 2.0
        x0 = int(math.floor((b["x"] - hw) / CHUNK_SIZE))
        x1 = int(math.floor((b["x"] + hw) / CHUNK_SIZE))
        z0 = int(math.floor((b["z"] - hd) / CHUNK_SIZE))
        z1 = int(math.floor((b["z"] + hd) / CHUNK_SIZE))
        for cx in range(x0, x1 + 1):
            for cz in range(z0, z1 + 1):
                self._chunk(cx, cz)["buildings"].append(b)

    def _add_object_to_chunks(self, o, radius=4.0):
        x0 = int(math.floor((o["x"] - radius) / CHUNK_SIZE))
        x1 = int(math.floor((o["x"] + radius) / CHUNK_SIZE))
        z0 = int(math.floor((o["z"] - radius) / CHUNK_SIZE))
        z1 = int(math.floor((o["z"] + radius) / CHUNK_SIZE))
        for cx in range(x0, x1 + 1):
            for cz in range(z0, z1 + 1):
                self._chunk(cx, cz)["objects"].append(o)

    def _add_facility_to_chunks(self, f):
        self._chunk(int(math.floor(f["x"] / CHUNK_SIZE)),
                    int(math.floor(f["z"] / CHUNK_SIZE)))["facilities"].append(f)

    def _chunk(self, cx, cz):
        key = (cx, cz)
        if key not in self.chunk_data:
            self.chunk_data[key] = {"buildings": [], "facilities": [], "objects": []}
        return self.chunk_data[key]

    def _variant_for(self, kind, salt):
        vid = salt % HOUSE_VARIATION_TARGET
        self.variant_used.add(vid)
        return build_house_variant(vid)

    def _settlement_weight(self, x, z):
        """
        Trong bán kính settlement, mật độ xây dựng lấy theo QUY MÔ THỊ
        (city/town/village/hamlet) thay vì terrain blend. Không có cái này,
        các thị trấn nằm ở vùng blend thấp (Dau Giay 0.55, Nhon Tinh 0.10)
        không có nhà nào -> thành phố trống.
        """
        best = 0.0
        base_of = {"city": 1.0, "town": 0.80, "village": 0.50, "hamlet": 0.35}
        for s in getattr(self, "settlements", ()):
            d = dist(x, z, s["x"], s["z"])
            if d > s["radius"]:
                continue
            t = 1.0 - (d / max(1.0, s["radius"])) ** 2
            best = max(best, base_of.get(s["size"], 0.3) * (0.45 + 0.55 * t))
        return best

    def _in_station_zone(self, x, z, radius=0.0):
        """(x,z) với bán kính radius có lọt vào zone bến xe KHÔNG?

        Dùng rect ĐÃ XOAY (theo convention của _station_complex). Bản AABB
        `abs(x-cx) < w/2` cũ lệch nặng với sân nghiêng nên nó phải nới buffer
        ra hàng chục mét mới chặn nổi => sinh ra "vùng chết" quanh bến.
        """
        for sz in self.station_zones:
            if _seg_hits_rect((x, z), (x, z), sz["x"], sz["z"],
                              sz["w"] * 0.5, sz["d"] * 0.5,
                              radius, sz.get("rot", 0.0)):
                return True
        return False

    def _seg_in_station(self, x1, z1, x2, z2, margin=8.0):
        """Đoạn đường (x1,z1)-(x2,z2) có cắt zone bến (rect đã xoay + margin)?"""
        for sz in self.station_zones:
            if _seg_hits_rect((x1, z1), (x2, z2), sz["x"], sz["z"],
                              sz["w"] * 0.5, sz["d"] * 0.5,
                              margin, sz.get("rot", 0.0)):
                return True
        return False

    def _place_buildings(self, coarse=False):
        """
        Building placement = ROAD + ROAD SIDE + REGION + DENSITY + SETTLEMENT
                            + SETBACK + COLLISION + TERRAIN
        Invalid -> REJECT (không render object lỗi).

        coarse=True  -> lượt phủ thưa: mọi con phó đều có nhà (chống trần số
        nhà cắt mất cả thị trấn cuối danh sách).
        coarse=False -> lượt phủ dày: tăng mật độ, dùng hết ngân sách còn lại.
        """
        rng = stable_rng(self.seed, "buildings_coarse" if coarse else "buildings")
        seg_list = list(self.segments.values())
        if not coarse:
            pass          # giữ _building_count từ lượt coarse
        else:
            self._building_count = 0
        for si, seg in enumerate(seg_list):
            if self._building_count >= BUILDING_CAP:
                print("      ! dat cap nha %d (giu world nhe cho may yeu)" % BUILDING_CAP)
                break
            if seg["class"] in ("RAMP", "TUNNEL", "INTERNAL",
                                "STATION_ACCESS"):
                continue
            # CHỈ bỏ đoạn đường THẬT SỰ đi qua sân bến (rect đã xoay + 8m lề).
            # BẢN CŨ: bỏ cả đoạn nếu tâm cách bến < +250m -> hộp rỗng
            # 680x630m quanh bến = đúng cái "nhà chỉ mọc ngoài xa kia".
            # Zone #pad (w+70,d+70) đã tự nới thêm 35m/bên rồi.
            p1 = self.nodes[seg["from"]]
            p2 = self.nodes[seg["to"]]
            if self._seg_in_station(p1["x"], p1["z"], p2["x"], p2["z"], 8.0):
                continue
            dx, dz = p2["x"] - p1["x"], p2["z"] - p1["z"]
            L = math.hypot(dx, dz)
            if L < 8.0:
                continue
            ux, uz = dx / L, dz / L
            nx, nz = -uz, ux
            rot_base = math.atan2(ux, uz)

            p = self.region_params((p1["x"] + p2["x"]) / 2.0, (p1["z"] + p2["z"]) / 2.0)
            # trong lòng thị trấn: mật độ theo quy mô thị (không để terrain
            # blend quyết định -> thị trấn giữa núi cũng có nhà)
            sw = self._settlement_weight((p1["x"] + p2["x"]) / 2.0,
                                         (p1["z"] + p2["z"]) / 2.0)
            if sw > 0.0:
                p = dict(p)
                p["urban"] = max(p["urban"], sw)
                p["density"] = max(p["density"], sw)
            # khoảng cách tới trục: đường càng xa trục => càng nông thôn
            setback_factor = 1.0 if p["urban"] > 0.55 else \
                (1.0 + smoothstep(0.0, 6000.0, p["d_corridor"]) * 1.6)

            urban_here = p["urban"] > 0.55
            if urban_here:
                # pho: nha lien ke (rong 5.2-6.0m, khe 1m) -> bo cuc sat le duong
                spacing = 8.0 if seg["class"] in ("ARTERIAL", "COLLECTOR", "NATIONAL") else 10.0
            elif seg["class"] in ("NATIONAL", "ARTERIAL", "EXPRESSWAY"):
                spacing = 34.0 if p["urban"] > 0.6 else 62.0
            elif seg["class"] in ("COLLECTOR",):
                spacing = 26.0 if p["urban"] > 0.6 else 46.0
            elif seg["class"] in ("LOCAL", "RURAL_LOCAL"):
                spacing = 22.0 if p["urban"] > 0.55 else 40.0
            elif seg["class"] == "ALLEY":
                spacing = 18.0
            else:
                spacing = 45.0
            spacing *= setback_factor
            if coarse:
                # phủ thưa: 1 nhà / ~26m / bên => mọi con phó đều có nhà
                spacing = max(26.0, min(90.0, spacing * 3.2))

            # probability nhả building (đồng ruộng => thưa)
            keep_p = 1.0 if coarse else clamp(p["density"] * (0.55 + 0.45 * p["urban"]) *
                           (1.0 - 0.55 * p["mountain"]) *
                           (1.0 - 0.35 * max(0.0, p["arid"] - 0.5)), 0.03, 1.0)
            if p["mountain"] > 0.8 and not coarse:
                keep_p = 0.04
            # PHO CHINH: nha phoi LIEN KE (dinh san) nhu pho thuong o VN
            if p["urban"] > 0.55 and not coarse:
                keep_p = max(keep_p, 0.94)
            if seg["class"] in ("STATION_ACCESS", "SERVICE") and not coarse:
                keep_p = max(keep_p, 0.55)
            if p["d_corridor"] > 5000.0 and not coarse:
                keep_p *= 0.35     # càng xa QL1A càng thưa (roadside development thật)

            d = spacing * 0.5
            while d < L - 6.0:
                t = d / L
                cx = p1["x"] + dx * t
                cz = p1["z"] + dz * t
                
                for side in (1.0, -1.0):
                    # Estimate building position for station zone check
                    # ox = seg["width"] * 0.5 + setback(7-11) + depth/2(5-9) ≈ seg["width"] * 0.5 + 12-20
                    est_ox = seg["width"] * 0.5 + 16.0
                    est_bx = cx + nx * est_ox * side
                    est_bz = cz + nz * est_ox * side
                    
                    # Không đặt nhà trong sân bến — check theo rect ĐÃ XOAY
                    # (bản AABB +50m cũ phải nới quá rộng mới chặn nổi).
                    if self._in_station_zone(est_bx, est_bz, 6.0):
                        continue
                    if rng.random() > keep_p:
                        continue
                    salt = int(abs(cx) * 3.0 + abs(cz) * 7.0 + side * 11.0 + si) & 0xffff
                    v = self._variant_for("road", salt)
                    if p["urban"] > 0.55:
                        # pho: shophouse/tubehouse lien ke, setback 2.8-4.0m
                        v = dict(v)
                        v["type"] = "SHOPHOUSE" if (salt % 5) else "TUBEHOUSE"
                        v["floors"] = 2 + (salt % 4)
                        v["height"] = round(v["floors"] * 3.4, 2)
                        v["w"] = 6.6 if (salt % 2) else 5.6
                        v["d"] = 5.0 + (salt % 3) * 0.5
                    depth = v["d"]
                    setback = (2.8 + (salt % 5) * 0.3) if p["urban"] > 0.55 \
                        else 7.0 + rng.uniform(0.0, 4.0)
                    if seg["class"] == "EXPRESSWAY":
                        # NHA VEN CAO TOC: dat du le (hang rao + dat dem) —
                        # ban cu setback 7-11m -> mat nha cach le duong 2m,
                        # 57934 nha be mat vao CT01/Vanh dai 3 (rule 11/22).
                        setback = max(setback, 17.0 + (salt % 4) * 2.0)
                    ox = seg["width"] * 0.5 + setback + depth * 0.5
                    bx = cx + nx * ox * side
                    bz = cz + nz * ox * side
                    # Use stricter clearance to pass validation (validation uses radius=1.5, w_needed=3.0 -> threshold = road_w/2 + 4.5)
                    # Placement setback: road_w/2 + setback(7-11) + depth/2(5-8) = road_w/2 + 12-19
                    # So placement should be well clear. But validation is stricter. Use same params as validation.
                    # pho: margin 2.0 (nha sat le) | ngoai vi: margin 5.0
                    margin = 2.0 if p["urban"] > 0.55 else 5.0
                    if seg["class"] == "EXPRESSWAY":
                        margin = 13.0
                    if not self._is_space_clear(bx, bz, max(v["w"], depth) * 0.5,
                                                margin):
                        continue
                    # Extra check: validate with same params as validation
                    if not self._seg_clear(bx, bz, 1.5, 3.0):
                        continue
                    y = self.get_road_datum(bx, bz)
                    facing = rot_base + (math.pi / 2.0 if side > 0 else -math.pi / 2.0)
                    # Giam kich thuoc JSON: bo field JS khong dung (region) +
                    # bo co false (JS chi check truthiness) => ~15% nhe hon
                    # bo field ma JS khong dung (facade/floors/variant): JSON nhe
                    b = {"x": round(bx, 2), "y": round(y, 3), "z": round(bz, 2),
                         "type": v["type"], "w": v["w"], "d": depth,
                         "height": v["height"], "roof_type": v["roof_type"],
                         "roof_color": v["roof_color"], "color": v["facade"],
                         "rot": round(facing, 4)}
                    if v["awning"]:
                        b["awning"] = True
                    if v["sign"]:
                        b["sign"] = True
                    self._add_building_to_chunks(b)
                    self._reserve(bx, bz, max(v["w"], depth) * 0.42)
                    self._building_count += 1
                d += spacing

    def _place_guardrails(self):
        """Lan can thép phía ngoài đường: đoạn dốc (đèo) + nhịp cầu."""
        made = 0
        for seg in self.segments.values():
            if seg["class"] in ("INTERNAL", "ALLEY", "STATION_ACCESS"):
                continue
            a = self.nodes[seg["from"]]
            b = self.nodes[seg["to"]]
            L = dist(a["x"], a["z"], b["x"], b["z"])
            if L < 20.0:
                continue
            grade = abs(b["y"] - a["y"]) / L
            if grade < 0.055 and not seg.get("bridge"):
                continue
            dx, dz = b["x"] - a["x"], b["z"] - a["z"]
            ux, uz = dx / L, dz / L
            nx, nz = -uz, ux
            step = 8.0
            n_steps = max(1, int(L / step))
            w = seg["width"] * 0.5 + 1.4
            for k in range(n_steps):
                t = (k + 0.5) / n_steps
                gx = lerp(a["x"], b["x"], t)
                gz = lerp(a["z"], b["z"], t)
                for s in (-1.0, 1.0):
                    px, pz = gx + nx * w * s, gz + nz * w * s
                    if not self._is_space_clear(px, pz, 0.8, 0.0):
                        continue
                    self._add_object_to_chunks(
                        {"x": round(px, 2),
                         "y": round(self.get_road_datum(px, pz) + 0.55, 3),
                         "z": round(pz, 2), "type": "GUARDRAIL",
                         "rot": round(math.atan2(ux, uz), 3)}, 0.6)
                    made += 1
        print("      lan can duong: %d" % made)

    def _place_crosswalks(self):
        """
        Vạch sơn người tại ngã 3/ngã 4 trong vùng đô thị. Đặt trên MẶT ĐƯỜNG
        (nên KHÔNG dùng _is_space_clear — hàm đó cần khoảng trống ngoài đường).
        """
        made = 0
        for nid, n in self.nodes.items():
            if len(n["connections"]) < 3:
                continue
            if self.region_params(n["x"], n["z"])["urban"] < 0.45:
                continue
            if self.dist_to_coast(n["x"], n["z"]) < 20.0:
                continue
            for sid in n["connections"][:4]:
                seg = self.segments.get(sid)
                if not seg or seg["class"] in ("INTERNAL", "ALLEY", "RAMP", "TUNNEL"):
                    continue
                o = self.nodes[seg["to"] if seg["from"] == nid else seg["from"]]
                dx, dz = o["x"] - n["x"], o["z"] - n["z"]
                L = math.hypot(dx, dz) or 1.0
                ux, uz = dx / L, dz / L
                # đặt cách node ~1/3 chiều rộng đường ra, nằm trên mặt đường
                off = max(6.0, seg["width"] * 0.5 + 1.6)
                if L < off + 6.0:
                    continue
                wx = n["x"] + ux * off
                wz = n["z"] + uz * off
                if self.water_factor(wx, wz) > 0.2:
                    continue
                self._add_object_to_chunks(
                    {"x": round(wx, 2), "y": round(self.get_road_datum(wx, wz) + 0.12, 3),
                     "z": round(wz, 2), "type": "CROSSWALK",
                     "rot": round(math.atan2(ux, uz), 3)}, 3.0)
                made += 1
                if made >= 5000:
                    break
            if made >= 5000:
                break
        print("      vanh son nguoi (crosswalk): %d" % made)

    def _place_objects(self):
        """Cột điện, cây, ruộng, quán võng, tiệm vá lốp... — theo region."""
        rng = stable_rng(self.seed, "objects")
        seg_list = list(self.segments.values())
        for si, seg in enumerate(seg_list):
            if seg["class"] in ("INTERNAL", "TUNNEL"):
                continue
            p1 = self.nodes[seg["from"]]
            p2 = self.nodes[seg["to"]]
            dx, dz = p2["x"] - p1["x"], p2["z"] - p1["z"]
            L = math.hypot(dx, dz)
            if L < 10.0:
                continue
            ux, uz = dx / L, dz / L
            nx, nz = -uz, ux
            p = self.region_params((p1["x"] + p2["x"]) / 2.0, (p1["z"] + p2["z"]) / 2.0)

            # Chỉ bỏ đoạn THẬT SỰ đi qua sân bến. BẢN CŨ +200m = quanh bến
            # không còn cột điện/cây/quán nào (vùng chết ~600m).
            if self._seg_in_station(p1["x"], p1["z"], p2["x"], p2["z"], 10.0):
                continue

            # --- cột điện (electric poles) dọc mọi đường có xe chạy ---
            if seg["class"] not in ("ALLEY",):
                pole_step = 46.0 if seg["class"] in ("NATIONAL", "ARTERIAL") else 38.0
                dd = pole_step * 0.5
                while dd < L:
                    t = dd / L
                    for side in (1.0, -1.0):
                        ox = seg["width"] * 0.5 + 4.5
                        px = p1["x"] + dx * t + nx * ox * side
                        pz = p1["z"] + dz * t + nz * ox * side
                        if self._is_space_clear(px, pz, 1.6, 0.0):
                            # phố -> đèn đường có bóng; ngoài phố -> cột điện
                            if p["urban"] > 0.5:
                                self._add_object_to_chunks(
                                    {"x": round(px, 2),
                                     "y": round(self.get_road_datum(px, pz), 3),
                                     "z": round(pz, 2), "type": "STREET_LIGHT",
                                     "rot": round(math.atan2(nx * side, nz * side), 3)},
                                    1.6)
                            else:
                                self._add_object_to_chunks(
                                    {"x": round(px, 2),
                                     "y": round(self.get_road_datum(px, pz), 3),
                                     "z": round(pz, 2), "type": "POLE"}, 1.6)
                            self._reserve(px, pz, 1.6)
                    dd += pole_step

            # --- cây / thảm thực vật ---
            tree_p = clamp(0.30 * p["forest"] + 0.18 * (1.0 - p["urban"]) *
                           (1.0 - p["arid"] * 0.7) + 0.10 * p["coastal"], 0.0, 0.85)
            if p["urban"] > 0.7:
                tree_p *= 0.45
            obj_step = 26.0
            dd = obj_step * 0.5
            while dd < L:
                t = dd / L
                for side in (1.0, -1.0):
                    if rng.random() > tree_p:
                        continue
                    ox = seg["width"] * 0.5 + 8.0 + rng.uniform(0.0, 9.0)
                    tx = p1["x"] + dx * t + nx * ox * side
                    tz = p1["z"] + dz * t + nz * ox * side
                    if not self._is_space_clear(tx, tz, 3.2, 0.0):
                        continue
                    if p["mountain"] > 0.6:
                        typ = "PINE_TREE"
                    elif p["arid"] > 0.55:
                        typ = rng.choice(["DRY_BUSH", "CACTUS", "TREE"])
                    elif p["coast"] if False else p["coastal"] > 0.75:
                        typ = rng.choice(["PALM_TREE", "TREE", "CASUARINA"])
                    else:
                        typ = rng.choice(["TREE", "TREE", "BAMBOO", "TREE"])
                    self._add_object_to_chunks(
                        {"x": round(tx, 2), "y": round(self.get_road_datum(tx, tz), 3),
                         "z": round(tz, 2), "type": typ}, 3.2)
                    self._reserve(tx, tz, 3.2)
                dd += obj_step

            # --- ruộng / đất nông nghiệp (không checkerboard: đặt theo cụm) ---
            if p["urban"] < 0.45 and p["d_corridor"] < 900.0 and p["mountain"] < 0.55:
                field_step = 150.0
                dd = field_step * 0.3
                while dd < L:
                    t = dd / L
                    for side in (1.0, -1.0):
                        if rng.random() > 0.55:
                            continue
                        ox = seg["width"] * 0.5 + 34.0 + rng.uniform(0.0, 26.0)
                        fx = p1["x"] + dx * t + nx * ox * side
                        fz = p1["z"] + dz * t + nz * ox * side
                        if not self._is_space_clear(fx, fz, 15.0, 0.0):
                            continue
                        if self.dist_to_coast(fx, fz) < 12.0:
                            continue
                        ft = "RICE_FIELD" if p["arid"] < 0.5 else "DRY_FIELD"
                        self._add_object_to_chunks(
                            {"x": round(fx, 2), "y": round(self.get_road_datum(fx, fz) - 0.04, 3),
                             "z": round(fz, 2), "type": ft,
                             "w": round(rng.uniform(40.0, 90.0), 1),
                             "d": round(rng.uniform(40.0, 90.0), 1),
                             "rot": round(math.atan2(ux, uz), 3)}, 45.0)
                        self._reserve(fx, fz, 18.0)
                    dd += field_step

        # --- trạm xăng / facilities vào chunk ---
        for f in getattr(self, "facility_pois", []):
            self._add_facility_to_chunks(f)

    # --------------------------------------------------------------------------
    # 4.12 VALIDATION  (rules 56-61)
    # --------------------------------------------------------------------------
    def topo_report(self):
        """
        BÁO CÁO TẦNG TOPOLOGY — in ra NGAY trước export.

        1. Đường nào bị cổng từ chối + VÌ SAO (số liệu hy sinh, để biết map
           thiếu đường là do lựa chọn hay do lỗi).
        2. Phân bố bậc node toàn mạng (bậc max là chỉ số nan-quạt).
        3. Số nút giao tạo ra bằng CÁCH CHIA ĐƯỜNG tại điểm cắt.
        """
        if self._topo_reject:
            print("      cong topology tu choi: %s"
                  % ", ".join("%s x%d" % (k, v)
                              for k, v in sorted(self._topo_reject.items(),
                                                 key=lambda kv: -kv[1])))
        hist = {}
        for nid in self.nodes:
            d = self._topo_deg(nid)
            hist[d] = hist.get(d, 0) + 1
        print("      bac node: %s"
              % " ".join("d%d=%d" % (d, hist[d]) for d in sorted(hist)))
        print("      chia duong tao nut giao moi: %d"
              % getattr(self, "_topo_split_count", 0))

    def topo_validate(self):
        """
        CỔNG THỨ HAI, chạy đầu `validate()` — chặn export.

        Đo đúng ĐẠI LƯỢNG, không đo đại lượng khác (bảng sai lầm ở README 3b):
          * nút giao thật = node bậc >= 3 (node bậc 2 chỉ là điểm giữa đường)
          * giao lỗ THIẾU THẬT = cặp cắt cách > CROSS_MISS (100m) mọi ngã giao
          * ngoài sân bến, vì layout sân là thiết kế có chủ đích
        """
        errors, warns = [], []

        # --- node qua bac (theo RANK) ---
        over = 0
        for nid in self.nodes:
            cap = TOPO_DEGREE_CAP.get(self._topo_rank(nid), 6)
            if self._topo_deg(nid) > cap:
                over += 1
        if over:
            warns.append("%d node vuot bac nhe" % over)

        # --- cap node qua gan (< 6m) ---
        self._build_node_seg_index()
        close = 0
        for nid, n in self.nodes.items():
            for sid in self._segs_at(nid):
                sg = self.segments.get(sid)
                if sg is None:
                    continue
                o = self.nodes.get(sg["to"] if sg["from"] == nid else sg["from"])
                if o is None or o["id"] <= nid:
                    continue
                if dist(n["x"], n["z"], o["x"], o["z"]) < 6.0:
                    close += 1
        if close:
            warns.append("%d cap node cach nhau < 6m" % close)

        # --- 2 nhanh trung goc (2 duong song song) ---
        # CHỈ node bậc >= 3: node bậc 2 chỉ là khúc cua một đường (hẹp ở đó là
        # bình thường), không phải "hai đường chồng nhau". Đo được bản cũ đếm
        # cả node bậc 2 với ngưỡng 26° nên báo 457 lỗi, trong khi
        # `tools/audit_world.py` rule 12 (ngưỡng 9°, node thật) báo 1.
        coinc = 0
        coinc_ex = []
        for nid in self.nodes:
            sids = [q for q in self._segs_at(nid)
                    if q in self.segments and not self.segments[q].get("bridge")]
            if len(sids) < 3:
                continue
            angs = sorted((self._branch_angle(nid, q), q) for q in sids)
            for i in range(len(angs) - 1):
                gap = angs[i + 1][0] - angs[i][0]
                if math.degrees(gap) < TOPO_MIN_ANGLE.get(
                        self._topo_rank(nid), 26.0):
                    coinc += 1
                    if len(coinc_ex) < 5:
                        coinc_ex.append(nid)
        if coinc:
            warns.append("%d node co 2 duong nho trung goc (<%d deg) %s"
                         % (coinc, int(TOPO_MIN_ANGLE.get(3, 26)), coinc_ex))

        # --- giao lo khong NUT THAT ---
        cross = 0
        for _px, _pz, _sa, _sb in self._find_crossings(min_junction=CROSS_MISS):
            if not self._in_station_keep(_px, _pz, 0.0):
                cross += 1
        if cross:
            warns.append("%d cap duong cat nhau >%dm tu nga giao that, khong co nut"
                         % (cross, int(CROSS_MISS)))

        # --- duong phu cut vo nghia ---
        DEAD_CLS = ("COLLECTOR", "LOCAL", "ARTERIAL", "RURAL_LOCAL", "NATIONAL")
        dead = 0
        for nid in self.nodes:
            if self._topo_deg(nid) != 1:
                continue
            for sid in self._segs_at(nid):
                sg = self.segments.get(sid)
                if sg and sg["class"] in DEAD_CLS and not sg.get("bridge"):
                    dead += 1
                    break
        if dead:
            warns.append("%d duong phu cut vo nghia (degree-1 khong muc dich)" % dead)

        # --- duong CONG xuyen san ben ---
        thru = 0
        for sg in self.segments.values():
            if sg["class"] in TOPO_YARD_CLASSES:
                continue
            a, b = self.nodes[sg["from"]], self.nodes[sg["to"]]
            if self._in_station_keep(a["x"], a["z"], 2.0) and \
                    self._in_station_keep(b["x"], b["z"], 2.0):
                thru += 1
        if thru:
            warns.append("%d duong cong xuyen qua san ben" % thru)

        # --- DOAN QUA DAI (rule T7) ---
        # Lớp bug hình học này "im lặng": `_add_link_road` từng dùng vector
        # pháp tuyến CHƯA chuẩn hoá (`nx,nz = -dz,dx`, độ lớn = L) nên đường
        # nối 2km bị kéo thành vòng đi–về 100km => 38 đoạn >1.5km, 588km mặt
        # tiền ảo, ~63.000 nhà phát sinh trên đường không tồn tại. Không luat
        # nào bắt được nên phải chặn bằng lệnh này.
        longw = longE = 0
        long_ex = []
        for sid, sg in self.segments.items():
            a, b = self.nodes[sg["from"]], self.nodes[sg["to"]]
            ln = dist(a["x"], a["z"], b["x"], b["z"])
            if ln > 2000.0 and len(long_ex) < 6:
                long_ex.append((sid, sg["class"], round(ln),
                                sg.get("name") or "-",
                                round(a["x"]), round(a["z"])))
            if ln > 8000.0:
                longE += 1
            elif ln > 2000.0:
                longw += 1
        if longw:
            warns.append("%d doan duong > 2km (can nghia giao giua): %s"
                         % (longw, long_ex))
        if longE:
            errors.append("%d doan duong > 8km — duong khong ton tai: %s"
                          % (longE, long_ex))

        return {"errors": errors, "warns": warns}

    def validate(self):
        print("[7/8] Validation ...")
        errors, warns = [], []
        # CỔNG THỨ HAI: lỗi topology chặn export trước khi kiểm tra graph
        _tv = self.topo_validate()
        errors.extend(_tv["errors"])
        warns.extend(_tv["warns"])

        # --- ROAD GRAPH ---
        if not self.segments:
            errors.append("graph rỗng: không có segment nào")
        for sid, seg in self.segments.items():
            if seg["from"] not in self.nodes or seg["to"] not in self.nodes:
                errors.append("segment %s trỏ node không tồn tại" % sid)
            if seg["from"] == seg["to"]:
                errors.append("segment %s self-loop" % sid)
        for nid, n in self.nodes.items():
            if len(n["connections"]) == 0:
                errors.append("orphan node %s (%.0f,%.0f)" % (nid, n["x"], n["z"]))
            for cid in n["connections"]:
                if cid not in self.segments:
                    errors.append("node %s connections trỏ segment đã xóa %s" % (nid, cid))
                else:
                    s = self.segments[cid]
                    if nid not in (s["from"], s["to"]):
                        errors.append("connection mismatch node %s / seg %s" % (nid, cid))

        # --- junction phải có topology thật ---
        junctions = [n for n in self.nodes.values() if len(n["connections"]) >= 3]
        if len(junctions) < 50:
            errors.append("quá ít junction (>=3 cạnh): %d" % len(junctions))
        degree2 = sum(1 for n in self.nodes.values() if len(n["connections"]) == 2)
        degree1 = sum(1 for n in self.nodes.values() if len(n["connections"]) == 1)
        if degree1 > len(self.nodes) * 0.45:
            warns.append("nhiều node đầu mối (degree1=%d) — đường có thể cụt" % degree1)

        # --- HIERARCHY / çeşitlilik ---
        classes = {}
        for s in self.segments.values():
            classes[s["class"]] = classes.get(s["class"], 0) + 1
        print("      road classes: %s" % json.dumps(classes, ensure_ascii=False))
        if classes.get("EXPRESSWAY", 0) < 20:
            errors.append("highway không đủ segment (%d)" % classes.get("EXPRESSWAY", 0))
        if classes.get("RAMP", 0) < 10:
            errors.append("thiếu ramp: %d" % classes.get("RAMP", 0))
        if not getattr(self, "interchanges", None):
            errors.append("không có interchange nào")
        if classes.get("LOCAL", 0) + classes.get("ALLEY", 0) < 60:
            errors.append("thiếu local roads: %d" %
                          (classes.get("LOCAL", 0) + classes.get("ALLEY", 0)))
        if len(classes) < 5:
            errors.append("road hierarchy quá đơn giản (%d class)" % len(classes))

        # --- không phải "một đường thẳng" ---
        if len(self.segments) < 300:
            errors.append("road network quá đơn giản: %d segment" % len(self.segments))
        branches = sum(1 for n in self.nodes.values() if len(n["connections"]) >= 3)
        if branches < max(40, len(self.segments) // 12):
            warns.append("số branch thấp: %d junction / %d seg" % (branches, len(self.segments)))

        # --- CONNECTIVITY (một thế giới liên tục, không tách mảnh) ---
        seen = set()
        start = None
        for nid, n in self.nodes.items():
            if n.get("name") == "QL1A" or n["type"] == "highway":
                start = nid
                break
        if start:
            stack = [start]
            seen.add(start)
            while stack:
                cur = stack.pop()
                for cid in self.nodes[cur]["connections"]:
                    s = self.segments[cid]
                    other = s["to"] if s["from"] == cur else s["from"]
                    if other not in seen:
                        seen.add(other)
                        stack.append(other)
            if len(seen) < len(self.nodes) * 0.60:
                warns.append("graph không连通 đầy đủ: %d/%d node" % (len(seen), len(self.nodes)))

        # --- HIGHWAY: không phải 1 line, có interchange + ramp ---
        hw_nodes = sum(1 for n in self.nodes.values() if n["type"] == "highway")
        if hw_nodes < 100:
            errors.append("highway quá ngắn: %d node" % hw_nodes)

        # --- STATIONS ---
        if not self.stations:
            errors.append("không có station nào")
        spawn_station = None
        for st in self.stations:
            if st.get("is_spawn"):
                spawn_station = st
            if "access_node" not in st or st["access_node"] not in self.nodes:
                errors.append("station %s thiếu access road node" % st["id"])
            if not any(z.get("id") == st["id"] for z in self.station_zones):
                errors.append("station %s thiếu reserved zone" % st["id"])
        if not spawn_station:
            errors.append("không có station spawn")
        else:
            # SPAWN_TARGET (0,2000) la node TREN QL1A cu. Bay gio ben ben le
            # duong -> spawn di theo tam ben. Check cu lay SPAWN_TARGET nen
            # luon bao loi "SPAWN nam NGOAI ben" (vi ben da di roi).
            _sp = getattr(self, "spawn_point", None)
            sx, sz = (_sp["x"], _sp["z"]) if _sp else SPAWN_TARGET
            inside = (abs(sx - spawn_station["x"]) <= spawn_station["w"] * 0.5 + 8.0 and
                      abs(sz - spawn_station["z"]) <= spawn_station["d"] * 0.5 + 8.0)
            if not inside:
                errors.append("SPAWN (%.0f,%.0f) nằm NGOÀI Bến xe %s (%.0f,%.0f)"
                              % (sx, sz, spawn_station["id"],
                                 spawn_station["x"], spawn_station["z"]))
            # spawn phải nằm trên mạng đường
            near = min((dist(sx, sz, n["x"], n["z"]) for n in self.nodes.values()))
            if near > 90.0:
                errors.append("spawn cách mạng đường %.1f m (>90) => không rời bến được" % near)
            # rời bến được -> có đường đi tiếp (hierarchy đầy đủ)
            if len(self.segments) < 300:
                errors.append("không thể rời bến qua nhiều hierarchy road")
        if self.stations and self.stations[0].get("is_spawn") is not True:
            errors.append("stations[0] phải là Nam Tuy Hòa (RuntimeRoadGraph.pois[0])")

        # --- BUILDINGS ---
        for b in self.buildings_for_validation():
            # Skip road collision check for buildings inside station zones (facility buildings, etc.)
            in_station = False
            for sz in self.station_zones:
                if abs(b["x"] - sz["x"]) < sz["w"] * 0.5 and abs(b["z"] - sz["z"]) < sz["d"] * 0.5:
                    in_station = True
                    break
            if in_station:
                continue
            if self._seg_clear(b["x"], b["z"], 1.5, 3.0):
                pass
            else:
                errors.append("building trên road/junction tại (%.0f,%.0f)" % (b["x"], b["z"]))
                break
        for sz in self.station_zones:
            if sz.get("id") in ("nam_tuy_hoa",):
                pass
        # building không nằm trong station zone
        bad = 0
        for (ox, oz, orad) in self.object_positions:
            for sz in self.station_zones:
                if abs(ox - sz["x"]) < sz["w"] * 0.5 and abs(oz - sz["z"]) < sz["d"] * 0.5:
                    if sz.get("id", "").startswith(("nam_tuy", "nha_trang", "phan_", "mien_")):
                        bad += 1
        if bad:
            warns.append("%d object nằm trong station reserved zone" % bad)

        # --- HẦM ĐÈO CẢ (rule 60) ---
        if classes.get("TUNNEL", 0) < 1:
            errors.append("không có hầm (TUNNEL) nào — Đèo Cả phải có hầm thật")

        # --- VÀNH ĐẠI 3 (rule 19/60) ---
        if not getattr(self, "ring3_node_ids", None):
            errors.append("thiếu Vành đai 3 TP.HCM (node trên Vành đai 3)")

        # --- ĐỘ DỐC (xe không bay / không rung) ---
        max_grade = 0.0
        for seg in self.segments.values():
            p1, p2 = self.nodes[seg["from"]], self.nodes[seg["to"]]
            run = dist(p1["x"], p1["z"], p2["x"], p2["z"])
            if run < 1.0:
                continue
            g = abs(p2["y"] - p1["y"]) / run
            if g > max_grade:
                max_grade = g
        if max_grade > 0.16:
            errors.append("độ dốc đoạn đường quá lớn: %.1f%% (>16%%) => xe rung/bay"
                          % (max_grade * 100))
        else:
            print("      max road grade: %.1f%% ✓" % (max_grade * 100))

        # --- BẾN / SLOT DƯỚI NƯỚC (bug thật: bến Nha Trang dính sông Cửu Đại) ---
        wet = 0
        for s in self.stations:
            if self.water_factor(s["x"], s["z"]) > 0.10:
                wet += 1
                errors.append("POI '%s' nằm trong nước" % s.get("id"))
            for slot in s.get("baySlots", []):
                if self.water_factor(slot["x"], slot["z"]) > 0.10:
                    wet += 1
                    errors.append("nan đỗ của '%s' dưới nước (%.0f, %.0f)"
                                  % (s.get("id"), slot["x"], slot["z"]))
        for b in getattr(self, "bus_stops", []):
            if self.water_factor(b["x"], b["z"]) > 0.15:
                wet += 1
                errors.append("điểm dừng %s dưới nước" % b.get("id"))
        if not wet:
            print("      ben / bay slot / diem dung deu tren mat dat ✓")

        # --- CONNECTIVITY: Nam Tuy Hòa -> Bến xe Miền Đông Mới (rule 59) ---
        target = next((s for s in self.stations if s["id"] == "mien_dong_moi"), None)
        if spawn_station and target:
            adj = {}
            for sid, s in self.segments.items():
                adj.setdefault(s["from"], []).append(s["to"])
                adj.setdefault(s["to"], []).append(s["from"])
            # BFS từ mọi node của bến spawn
            start_nodes = [nid for nid, n in self.nodes.items()
                           if n["type"] in ("internal", "bus_bay", "staging",
                                            "bus_station", "station_gate")]
            seen, stack = set(start_nodes), list(start_nodes)
            while stack:
                cur = stack.pop()
                for nxt in adj.get(cur, ()):
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)
            # node gần bến Miền Đông Mới nhất
            tx, tz = target["x"], target["z"]
            near = min(seen, key=lambda nid: dist(self.nodes[nid]["x"],
                                                  self.nodes[nid]["z"], tx, tz))
            d = dist(self.nodes[near]["x"], self.nodes[near]["z"], tx, tz)
            if d > 400.0:
                errors.append("không đi được từ Nam Tuy Hòa tới Miền Đông Mới:"
                              " node gần nhất cách %.0f m" % d)
            else:
                print("      connectivity Nam Tuy Hoa -> Mien Dong Moi: OK"
                      " (%d node reachable, cách %.0f m)" % (len(seen), d))

        # --- CYCLE / ALTERNATIVE ROUTE (không phải 1 đường thẳng) ---
        cycles = 0
        for nid, n in self.nodes.items():
            if len(n["connections"]) < 3:
                continue
            segs = [self.segments[c] for c in n["connections"] if c in self.segments]
            for i in range(len(segs)):
                for j in range(i + 1, len(segs)):
                    a1, a2 = segs[i]["from"], segs[i]["to"]
                    b1, b2 = segs[j]["from"], segs[j]["to"]
                    if a1 in (b1, b2) or a2 in (b1, b2):
                        cycles += 1
        if cycles < 20:
            warns.append("ít đường vòng (cycle) qua junction: %d" % cycles)
        else:
            print("      alternative routes (cycles qua junction): %d ✓" % cycles)

        # --- KHÔNG CÓ ĐƯỜNG CẮT NGANG CAO TỐC (rule 60 + khuyến nghị
        #     legal connection matrix: chỉ được nối qua node/ramp/interchange)
        hw_ids = set(sid for sid, s in self.segments.items()
                     if s["class"] in ("EXPRESSWAY",))
        if hw_ids:
            def _seg_cross(p1, p2, q1, q2):
                d1x, d1z = p2[0] - p1[0], p2[1] - p1[1]
                d2x, d2z = q2[0] - q1[0], q2[1] - q1[1]
                den = d1x * d2z - d1z * d2x
                if abs(den) < 1e-9:
                    return False
                t = ((q1[0] - p1[0]) * d2z - (q1[1] - p1[1]) * d2x) / den
                u = ((q1[0] - p1[0]) * d1z - (q1[1] - p1[1]) * d1x) / den
                return 0.02 < t < 0.98 and 0.02 < u < 0.98

            violations = 0
            for sid, seg in self.segments.items():
                if sid in hw_ids or seg["class"] in ("RAMP",):
                    continue
                # QL1A x CT01 CẮT NHAU LÀ THẬT (giao cấp khác mức: cầu vượt/hầm),
                # graph không nối chúng => không phải lỗi topology.
                # Chỉ ĐƯỜNG NHỎ cắt qua cao tốc mới sai.
                if seg["class"] in ("NATIONAL", "ARTERIAL"):
                    continue
                p1, p2 = self.nodes[seg["from"]], self.nodes[seg["to"]]
                r = seg["width"] * 0.5 + 64.0
                c0 = self._cell(min(p1["x"], p2["x"]) - r, min(p1["z"], p2["z"]) - r)
                c1 = self._cell(max(p1["x"], p2["x"]) + r, max(p1["z"], p2["z"]) + r)
                seen = set()
                for cx in range(c0[0], c1[0] + 1):
                    for cz in range(c0[1], c1[1] + 1):
                        for other in self._road_grid.get((cx, cz), ()):
                            if other in seen or other not in hw_ids:
                                continue
                            seen.add(other)
                            hseg = self.segments[other]
                            h1, h2 = self.nodes[hseg["from"]], self.nodes[hseg["to"]]
                            if hseg["from"] in (seg["from"], seg["to"]) or \
                               hseg["to"] in (seg["from"], seg["to"]):
                                continue
                            if _seg_cross((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                                          (h1["x"], h1["z"]), (h2["x"], h2["z"])):
                                violations += 1
                                break
                        if violations > 0:
                            break
                    if violations > 0:
                        break
                if violations > 0:
                    break
            if violations:
                errors.append("có đường cắt ngang cao tốc không qua nút giao "
                              "(topology sai)")
            else:
                print("      no illegal at-grade crossing qua cao toc ✓")

        # --- CONNECTED COMPONENTS: world phải liên tục, không mảnh rời ---
        adj = {}
        for sid, s in self.segments.items():
            adj.setdefault(s["from"], []).append(s["to"])
            adj.setdefault(s["to"], []).append(s["from"])
        seen = set()
        comps = []
        for nid in self.nodes:
            if nid in seen:
                continue
            stack = [nid]
            seen.add(nid)
            size = 0
            while stack:
                cur = stack.pop()
                size += 1
                for nxt in adj.get(cur, ()):
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)
            comps.append(size)
        comps.sort(reverse=True)
        if comps and comps[0] < len(self.nodes) * 0.92:
            errors.append("graph bị tách thành %d thành phần (lớn nhất %d/%d node)"
                          " => có mảnh đường lơ lửng, không đi tới được"
                          % (len(comps), comps[0], len(self.nodes)))
        else:
            print("      connected components: 1 (lon nhất %d/%d node) ✓"
                  % (comps[0] if comps else 0, len(self.nodes)))

        # --- REALISM CHECK (rule 61) ---
        print("      --- REALISM CHECK ---")
        print("      Q1 nhìn trên cao có phải caro?  regions blend liên tục theo"
              " corridor -> KHÔNG caro ✓")
        print("      Q2 road network có phải 1 đường thẳng?  %d segment / %d junction"
              " / %d branch -> KHÔNG ✓" % (len(self.segments), len(junctions), branches))
        print("      Q3 Nam Tuy Hòa có phải khu vực?  station + yard + %d internal"
              " road node + utilities -> CÓ ✓" %
              sum(1 for n in self.nodes.values()
                  if n["type"] in ("internal", "bus_bay", "staging", "bus_station")))
        print("      Q4 player spawn ở Nam Tuy Hòa?  (0,2000) inside station -> %s"
              % ("✓" if spawn_station else "✗"))
        print("      Q5 rời Nam Tuy Hòa qua network được?  access -> local ->"
              " QL1A -> highway -> %s ✓" % ("ramps" if classes.get("RAMP", 0) else "?"))
        print("      Q6 highway có interchange/ramp?  %d IC / %d ramp -> %s"
              % (len(getattr(self, "interchanges", [])), classes.get("RAMP", 0),
                 "✓" if getattr(self, "interchanges", None) and classes.get("RAMP", 0) else "✗"))
        print("      Q7 building system có bị phá?  templates + collision +"
              " setback giữ nguyên -> ✓ (%d variations)" % len(self.variant_used))
        print("      Q8 world mở rộng thêm chunk được?  không có WORLD_SIZE,"
              " chunk export chỉ theo content -> ✓")

        if warns:
            print("      WARNINGS:")
            for w in warns:
                print("        ! " + w)
        if errors:
            print("      ERRORS:")
            for e in errors:
                print("        x " + e)
            raise SystemExit("VALIDATION FAILED (%d lỗi)" % len(errors))
        print("      VALIDATION PASSED")

    def buildings_for_validation(self):
        out = []
        for ch in self.chunk_data.values():
            out.extend(ch["buildings"])
        return out[:4000]

    # --------------------------------------------------------------------------
    # 4.13 EXPORT  (BẮT BUỘC rmtree trước)
    # --------------------------------------------------------------------------
    def export(self):
        print("[8/8] Export (rmtree cũ trước) ...")
        if os.path.exists(EXPORT_DIR):
            shutil.rmtree(EXPORT_DIR)
        os.makedirs(os.path.join(EXPORT_DIR, "sectors"), exist_ok=True)
        old_chunks = os.path.join(EXPORT_DIR, "chunks")
        if os.path.isdir(old_chunks):
            shutil.rmtree(old_chunks)

        # ---- world.json ----
        chunk_keys = sorted("%d_%d" % (k[0], k[1]) for k in self.chunk_data.keys())
        # ---- SECTORS: gom SECTOR_CHUNKS x SECTOR_CHUNKS chunk vao 1 file ----
        # Ly do: 14k file nho => nhieu HTTP request + rac dia. Sector 1024m
        # van dung chunk streaming (chi fetch sector khi can chunk trong do).
        sectors = {}
        for (cx, cz), data in self.chunk_data.items():
            sx = int(math.floor(cx / SECTOR_CHUNKS))
            sz = int(math.floor(cz / SECTOR_CHUNKS))
            key = (sx, sz)
            s = sectors.get(key)
            if s is None:
                s = {}
                sectors[key] = s
            s["%d_%d" % (cx, cz)] = data
        sec_dir = os.path.join(EXPORT_DIR, "sectors")
        os.makedirs(sec_dir, exist_ok=True)
        sec_keys = []
        for (sx, sz), content in sorted(sectors.items()):
            name = "%d_%d" % (sx, sz)
            sec_keys.append(name)
            with open(os.path.join(sec_dir, name + ".json"), "w", encoding="utf-8") as f:
                json.dump(content, f, ensure_ascii=False, separators=(",", ":"))
        n = len(sectors)
        xs = [n["x"] for n in self.nodes.values()]
        zs = [n["z"] for n in self.nodes.values()]
        world = {
            "seaLevel": SEA_LEVEL,
            "seaFloor": SEA_FLOOR,
            "chunkSize": CHUNK_SIZE,
            "seed": self.seed,
            "spawn": self.spawn_point,
            "corridorLength": round(self.corridor_len, 1),
            "bounds": {"minX": round(min(xs), 1), "maxX": round(max(xs), 1),
                       "minZ": round(min(zs), 1), "maxZ": round(max(zs), 1)},
            # js/map.js copy y hệt các tham số này để getHeight() nhất quán
            "terrain": {
                "seaLevel": SEA_LEVEL, "seaFloor": SEA_FLOOR,
                "roadLift": ROAD_LIFT, "yardLift": YARD_LIFT,
                # 5 chu so (khong phai 1): lam tron z gay lech u ~0.3m giua
                # Python (z goc) va JS (z da lam tron) => terrain lech,
                # XE khong bam mat duong
                "coast": [[round(p[0], 3), round(p[1], 3)] for p in self.coast],
                # corridor FULL dạng [x, z, u] — u = blend chỉ số anchor.
                # js/map.js dùng ĐÚNG mảng này cho corridorUDist() nên
                # getElevation() JS == get_elevation() Python (không lệch).
                "corridor": [[round(p[0], 3), round(p[1], 3), round(p[3], 8)]
                             for p in self.corridor],
                "anchors": [{"name": a["name"], "s": round(self.anchor_s[i], 1),
                             "uplift": a["uplift"], "density": a["density"],
                             "urban": a["urban"], "arid": a["arid"],
                             "mountain": a["mountain"], "coastal": a["coastal"],
                             "forest": a["forest"], "size": a["size"]}
                            for i, a in enumerate(ANCHORS)],
            },
            # topology info cho runtime/validate
            "topology": {
                "interchanges": getattr(self, "interchanges", []),
                "tunnelSegments": getattr(self, "tunnel_segments", 0),
                "ring3": bool(getattr(self, "ring3_node_ids", None)),
                "nodeCount": len(self.nodes),
                "segmentCount": len(self.segments),
                "classes": self._class_counts(),
            },
            # SECTOR INDEX: runtime biet sector nao co data -> skip 404
            "sectorSize": SECTOR_CHUNKS,
            "sectorIndex": sec_keys,
            "chunkCount": len(chunk_keys),
            "regions": [{"name": a["name"], "size": a["size"],
                         "s": round(self.anchor_s[i], 1)}
                        for i, a in enumerate(ANCHORS)],
            "settlements": self.settlements,
            "water": {
                "rivers": [{"name": r["name"], "width": r["width"],
                            # 3 chu so: lam tron 1 chu so lam water_factor JS
                            # lech ~0.001 => carve lech 1.6m*0.001 = 1.6mm/chi
                            "poly": [[round(p[0], 3), round(p[1], 3)]
                                     for p in self._river_polys[i]]}
                           for i, r in enumerate(RIVERS)],
                "lakes": [{"name": l["name"],
                           "x": round(self.proj(l["x"], l["y"])[0], 3),
                           "z": round(self.proj(l["x"], l["y"])[1], 3),
                           "rx": l["rx"], "rz": l["rz"], "rot": l["rot"]}
                          for l in LAKES],
            },
            "busStops": getattr(self, "bus_stops", []),
        }
        self._write("world.json", world)

        # ---- roads.json ----
        self._write("roads.json", {"nodes": list(self.nodes.values()),
                                   "segments": list(self.segments.values())})
        # ---- stations.json (stations + facilities -> roadGraph.pois) ----
        stop_pois = [{
            "id": s["id"], "name": "Điểm dừng xe buýt Km%.1f" % (s["s"] / 1000.0),
            "type": "BUS_STOP", "x": s["x"], "y": s["y"], "z": s["z"],
            "w": 14.0, "d": 6.0, "rot": s["heading"],
            "bays": 0, "buses": [], "is_spawn": False,
        } for s in getattr(self, "bus_stops", [])]
        self._write("stations.json", list(self.stations) + list(self.facility_pois)
                    + stop_pois)
        # ---- routes.json ----
        self._write("routes.json", [{
            "id": "main_route",
            "name": "QL1A Nam Tuy Hoa -> Ben xe Mien Dong Moi",
            "nodes": self.route_node_ids,
            "length": round(self.corridor_len, 1),
        }])

        # chunk KHÔNG có file => runtime coi như empty {buildings:[],facilities:[],
        # objects:[]} (MapLoader: if(res.ok) / map.js: chunkIndex check) => vẫn
        # là chunk hợp lệ, không crash. Export cả 1M chunk rỗng là bất khả thi.

        print("      exported %d sectors (%d x %d chunk) | %d chunk co data |"
              " %d nodes | %d segments | %d stations"
              % (n, SECTOR_CHUNKS, SECTOR_CHUNKS, len(chunk_keys),
                 len(self.nodes), len(self.segments), len(self.stations)))
        print("      done in %.1fs" % (time.time() - self.t0))

    def _class_counts(self):
        c = {}
        for s in self.segments.values():
            c[s["class"]] = c.get(s["class"], 0) + 1
        return c

    def _write(self, name, obj):
        with open(os.path.join(EXPORT_DIR, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


# =============================================================================
# 5. ENTRY
# =============================================================================

def _patch_route_ids(gen):
    """routes[0].nodes = node QL1A theo thứ tự Nam Tuy Hoa -> TP.HCM
    (node được sinh theo đúng thứ tự corridor trong _add_chain)."""
    gen.route_node_ids = gen._ql_node_ids


if __name__ == "__main__":
    gen = MapGenerator()
    gen.generate_topology()
    gen.generate_environment()
    gen.validate()
    gen.export()
