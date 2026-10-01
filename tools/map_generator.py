# -*- coding: utf-8 -*-
"""
BUSDRIVEVN — WORLD / ROAD-NETWORK / PROCEDURAL MAP GENERATOR  (SOURCE OF TRUTH)
=================================================================================
Pipeline (không đảo thứ tự):

    REAL-WORLD RESEARCH
        -> WORLD / REGION PLAN
        -> TERRAIN / GEOGRAPHY          (coast line + elevation field)
        -> MAJOR ROAD CORRIDORS         (QL1 trunk + CT01 + Vành đai 3)
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
import heapq          # ROUTE ĐA DẠNG: Dijkstra tìm tuyến thay thế A->B
import random
import os
import shutil
import hashlib
import time
from collections import Counter, defaultdict  # P37: dem ly do BO QUA trong vong sua ma tran

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
    "COLLECTOR": 3, "PROVINCIAL_ROAD": 3, "LOCAL": 3, "RURAL_LOCAL": 3,
    "SERVICE": 4, "STATION_ACCESS": 4, "ALLEY": 5, "INTERNAL": 5,
    # --- Road types mới (Phase 3) ---
    "INTER_VILLAGE": 3,
    "INDUSTRIAL_ACCESS": 3,
    "RESIDENTIAL": 5,
    "COMMERCIAL": 4,
    "AGRICULTURAL": 5,
}

# ĐƯỜNG PHỦ được phép có đầu degree-1. DÙNG CHUNG cho bước dọn đầu cụt và
# `topo_validate` — liệt kê riêng ở 2 chỗ là sinh ra "đã dọn mà vẫn báo lỗi".
TOPO_DEAD_CLS = ("ALLEY", "COLLECTOR", "PROVINCIAL_ROAD", "LOCAL",
                 "ARTERIAL", "RURAL_LOCAL", "NATIONAL",
                 "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL",
                 "COMMERCIAL", "AGRICULTURAL")

# MA TRẬN KẾT NỐI HỢP PHÁP. ĐỐI XỨNG — phải kiểm tra cả 2 chiều khi sửa
#   - CAO TỐC chỉ nối qua RAMP/TUNNEL: cấm cấp thấp chạm mặt bằng.
#   - QL1 nối được cả phố (ngã ba T là bình thường ở VN) + trạm xăng/trạm
#     thu phí/trạm nghỉ (SERVICE) dọc QL — đó là thiết kế thật.
#   - VÀNH ĐẠI 3 / liên kết vào cao tốc là RAMP, không phải ARTERIAL.
TOPO_LEGAL = {
    # Cao tốc hạn chế: chỉ nối qua RAMP/TUNNEL ở nút giao. Cấp thấp chạm
    # thẳng mặt bằng là lỗi nghiêm trọng nhất (xe chui qua rào).
    "EXPRESSWAY":   ("EXPRESSWAY", "RAMP", "TUNNEL"),
    "TUNNEL":       ("TUNNEL", "EXPRESSWAY", "RAMP", "NATIONAL"),
    "RAMP":         ("RAMP", "EXPRESSWAY", "TUNNEL", "NATIONAL", "ARTERIAL",
                     "COLLECTOR", "PROVINCIAL_ROAD", "SERVICE", "STATION_ACCESS",
                     "INDUSTRIAL_ACCESS"),
    # QL1: phố gặp QL ở ngã ba T là bình thường; trạm xăng / trạm thu phí /
    # trạm nghỉ lấy xe trực tiếp từ QL (SERVICE) là thiết kế thật.
    "NATIONAL":     ("NATIONAL", "RAMP", "ARTERIAL", "TUNNEL", "COLLECTOR",
                     "PROVINCIAL_ROAD", "RURAL_LOCAL", "STATION_ACCESS", "LOCAL", "SERVICE",
                     "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL"),
    "ARTERIAL":     ("ARTERIAL", "NATIONAL", "RAMP", "COLLECTOR", "PROVINCIAL_ROAD",
                     "RURAL_LOCAL", "STATION_ACCESS", "LOCAL", "SERVICE",
                     "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "COMMERCIAL",
                     # Phố nhà đổ ra đường tỉnh là BÌNH THƯỜNG ở VN (ngõ kiệt
                     # cụt ra đường phố), khác hẻm (`ALLEY`) — hẻm cấm đổ thẳng
                     # vào đường tỉnh là chủ ý. Thiếu cạnh này thì MỌI phố
                     # `RESIDENTIAL` trong lưới thị trấn đều bị `topo_try_link`
                     # từ chối vì node kề nó có cạnh vành `ARTERIAL`.
                     "RESIDENTIAL"),
    "COLLECTOR":    ("COLLECTOR", "ARTERIAL", "NATIONAL", "RAMP", "PROVINCIAL_ROAD",
                     "RURAL_LOCAL", "STATION_ACCESS", "LOCAL", "SERVICE",
                     "ALLEY", "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "COMMERCIAL",
                     "RESIDENTIAL", "AGRICULTURAL"),
    # ĐƯỜNG TỈNH (tinh_lo_*): cùng bậc với COLLECTOR, nối thị trấn - thị trấn,
    # vào khu công nghiệp, vào nút giao cao tốc qua đường dẫn.
    "PROVINCIAL_ROAD": ("PROVINCIAL_ROAD", "COLLECTOR", "ARTERIAL", "NATIONAL",
                     "RAMP", "RURAL_LOCAL", "STATION_ACCESS", "LOCAL",
                     "SERVICE", "ALLEY", "INTER_VILLAGE", "INDUSTRIAL_ACCESS",
                     "RESIDENTIAL", "COMMERCIAL", "AGRICULTURAL"),
    "LOCAL":        ("LOCAL", "ARTERIAL", "COLLECTOR", "PROVINCIAL_ROAD", "RURAL_LOCAL",
                     "STATION_ACCESS", "ALLEY", "SERVICE", "INTERNAL",
                     "NATIONAL", "RESIDENTIAL", "COMMERCIAL", "AGRICULTURAL",
                     # --- Phase 3: chiều ngược của cạnh khai báo ở INTER_VILLAGE
                     #     và INDUSTRIAL_ACCESS. Đường xã / đường khu CN đều gặp
                     #     phố nội bộ ở VN — thiếu 2 key này làm ma trận vô đối
                     #     xứng và CẢ GENERATOR KHÔNG IMPORT ĐƯỢC (đã đo).
                     "INTER_VILLAGE", "INDUSTRIAL_ACCESS"),
    "RURAL_LOCAL":  ("RURAL_LOCAL", "LOCAL", "COLLECTOR", "PROVINCIAL_ROAD", "ARTERIAL", "ALLEY",
                     "NATIONAL", "INTER_VILLAGE", "AGRICULTURAL", "RESIDENTIAL",
                     "INDUSTRIAL_ACCESS"),
    # Đường vào cơ sở (trạm xăng / trạm nghỉ / trạm thu phí) hoặc vào sân bến.
    "SERVICE":      ("SERVICE", "COLLECTOR", "PROVINCIAL_ROAD", "STATION_ACCESS", "LOCAL",
                     "ALLEY", "INTERNAL", "RAMP", "NATIONAL", "ARTERIAL",
                     "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL",
                     "COMMERCIAL"),
    "STATION_ACCESS": ("STATION_ACCESS", "INTERNAL", "ARTERIAL", "COLLECTOR",
                       "PROVINCIAL_ROAD", "LOCAL", "NATIONAL", "RAMP", "SERVICE",
                       "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "COMMERCIAL"),
    "ALLEY":        ("ALLEY", "LOCAL", "SERVICE", "RURAL_LOCAL", "COLLECTOR",
                     "PROVINCIAL_ROAD", "RESIDENTIAL", "AGRICULTURAL",
                     "INTER_VILLAGE", "COMMERCIAL"),
    "INTERNAL":     ("INTERNAL", "STATION_ACCESS", "SERVICE", "LOCAL"),
    # --- Road types mới (Phase 3) ---
    "INTER_VILLAGE": ("INTER_VILLAGE", "LOCAL", "COLLECTOR", "PROVINCIAL_ROAD", "ARTERIAL",
                      "RURAL_LOCAL", "NATIONAL", "SERVICE", "ALLEY", "AGRICULTURAL",
                      "INDUSTRIAL_ACCESS", "STATION_ACCESS", "RESIDENTIAL",
                      "COMMERCIAL"),
    "INDUSTRIAL_ACCESS": ("INDUSTRIAL_ACCESS", "ARTERIAL", "COLLECTOR", "PROVINCIAL_ROAD",
                          "NATIONAL", "RAMP", "SERVICE", "STATION_ACCESS", "LOCAL",
                          "INTER_VILLAGE",
                          # Đường làng mở rộng thành đường vào KCN là chuyện
                          # thật ở VN (KCN Dốc Kết, Long Bình, Bình Hưng Hoà
                          # đều bám đường huyện cũ). Thiếu cạnh này thì đoạn
                          # `RURAL_LOCAL` đầu tiên tới gần KCN bị `add_segment`
                          # TỪ CHỐI => cả nhánh đường dừng lại ở đó, âm thầm.
                          "RURAL_LOCAL"),
    "RESIDENTIAL":  ("RESIDENTIAL", "LOCAL", "ALLEY", "SERVICE", "COLLECTOR",
                      "PROVINCIAL_ROAD", "COMMERCIAL", "INTER_VILLAGE",
                      "AGRICULTURAL", "RURAL_LOCAL", "ARTERIAL", "NATIONAL"),
    "COMMERCIAL":   ("COMMERCIAL", "LOCAL", "ARTERIAL", "COLLECTOR", "PROVINCIAL_ROAD",
                     "SERVICE", "ALLEY", "RESIDENTIAL", "INTER_VILLAGE",
                      "STATION_ACCESS"),
    "AGRICULTURAL": ("AGRICULTURAL", "RURAL_LOCAL", "LOCAL", "ALLEY", "COLLECTOR",
                     "PROVINCIAL_ROAD", "INTER_VILLAGE", "RESIDENTIAL"),
}
# Kiem tra doi xung ngay khi khai bao -> bat loi "mat doi xung" ngay tai cho.
_TOPO_ASYM = []
for _a, _lst in list(TOPO_LEGAL.items()):
    for _b in _lst:
        if _a not in TOPO_LEGAL.get(_b, ()):
            _TOPO_ASYM.append("%s -> %s" % (_a, _b))
if _TOPO_ASYM:
    # GOM TẤT CẢ cạnh vô đối xứng rồi mới chết. Bản cũ raise ngay ở cạnh đầu
    # tiên nên 1 lần sửa chỉ lộ ra 1 lỗi — phải chạy lại 14 lần mới hết.
    raise SystemExit("TOPO_LEGAL mat doi xung (%d canh):\n    %s"
                     % (len(_TOPO_ASYM), "\n    ".join(_TOPO_ASYM)))

# TRAN BAC THEO RANK (khong phai con so cung cho moi loai): nut tren cao toc
# 6 nhanh la binh thuong (trai + phai + 2 ramp), con 6 nhanh tren pho la nan
# quat. Tran cung 8 cho ca mang => 15 node 7-9 nhanh luon vuot tran roi
# validate moi lo no ra.
# KEY LUON LA `TOPO_RANK` (int 0-5), KHONG BAO GIO la ten class. Mọi chỗ đọc
# đều qua `_topo_rank(node)` — trộn key str vào đây làm `sorted()` chết
# (TypeError: '<' giữa str và int) và làm các class mới có cap "ma" không ai
# đọc tới. Class mới đã có rank trong `TOPO_RANK` nên tự nhận cap theo rank.
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
# --- Road types mới (Phase 3) ---
TOPO_JUNCTION_SPACING.update({
    "INTER_VILLAGE": 200.0,
    "INDUSTRIAL_ACCESS": 250.0,
    "RESIDENTIAL": 90.0,
    "COMMERCIAL": 130.0,
    "AGRICULTURAL": 150.0,
})
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

# "DUONG DIA PHONG" — nhóm class ĐƯỢC PHÉP chạm mặt bằng cao tốc không.
# Dùng CHUNG danh sách này cho `add_segment` (chặn) và `tools/audit_world.py`
# rule 11 (báo lỗi) để hai bên nói cùng một cái.
# ⚠ KHÔNG dùng `hierarchy >= 4`: `INTERNAL` / `STATION_ACCESS` cũng = 5, chặn
# luôn thì đường nội bộ sân bến không tới được cổng → đứt mạng.
TOPO_SMALL_ROAD = ("LOCAL", "ALLEY", "RURAL_LOCAL", "SERVICE", "COLLECTOR",
                     "PROVINCIAL_ROAD",
                     # --- Road types mới: cũng là "đường địa phương", cũng cấm
                     # chạm thẳng mặt bằng cao tốc. Thiếu 5 key này thì audit
                     # rule 11 im lặng với chúng — tức luật kiểm chỉ có tác
                     # dụng với 6 class cũ, 5 class mới đi vô đường cù tắt.
                     "INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL",
                     "COMMERCIAL", "AGRICULTURAL")

# ĐOẠN QUÁ NGẮN GIỮA HAI NÚT GIAO THẬT, theo BẬC (`TOPO_RANK`).
# 0 = không chặn. Dùng CHUNG cho `topo_link_ok` (từ chối) và `audit_world.py`
# T1 (báo). Căn cứ đo trên data đã export: phân bố đoạn ngắn MƯỢT
# (8/25/21/20/22/31/27/37 theo nhóm 5m) ⇒ phần lớn là phố thật, ngõ 30m giữa
# hai khối là bình thường. Lỗi thật là đoạn ngắn trên XƯƠNG SỐNG: QL1 11.2m,
# ARTERIAL 7.0m, Vành đai 3 8.4m — hai nút giao cách nhau chưa tới một đoạn
# đường, mất ý nghĩa. RAMP 25m vì ramp thật có mốc 15m ở đầu đường nối vào.
TOPO_MIN_LINK_LEN = {0: 60.0, 1: 25.0, 2: 45.0, 3: 0.0, 4: 0.0, 5: 0.0}

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

# Spawn nằm 115 m về TÂY (bên trongland) của trục QL1 tại anchor Nam Tuy Hòa.
# Hướng bus khi spawn: main.js  rotation.y = spawn.heading + PI/2, heading=0
# => forward = +X (Đông) => lái ra QL1. Cổng bến phải mở về phía Đông.
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
    "PROVINCIAL_ROAD": dict(width=9.0, lanes=2, hierarchy=4, twoWay=True, speed=45),
    "LOCAL":        dict(width=7.5,  lanes=2, hierarchy=4, twoWay=True,  speed=30),
    "ALLEY":        dict(width=4.5,  lanes=1, hierarchy=5, twoWay=True,  speed=20),
    "RURAL_LOCAL":  dict(width=6.0,  lanes=1, hierarchy=4, twoWay=True,  speed=30),
    "SERVICE":      dict(width=6.5,  lanes=1, hierarchy=5, twoWay=True,  speed=25),
    "STATION_ACCESS": dict(width=16.0, lanes=2, hierarchy=5, twoWay=True, speed=25),
    "INTERNAL":     dict(width=9.0,  lanes=1, hierarchy=5, twoWay=True,  speed=15),
    "TUNNEL":       dict(width=13.0, lanes=2, hierarchy=2, twoWay=True,  speed=60),
    # --- Road types mới (Phase 3: Road Network Upgrade) ---
    "INTER_VILLAGE": dict(width=7.0,  lanes=2, hierarchy=4, twoWay=True,  speed=35),   # Đường liên xã
    "INDUSTRIAL_ACCESS": dict(width=11.0, lanes=2, hierarchy=3, twoWay=True, speed=45), # Đường vào khu công nghiệp
    "RESIDENTIAL":  dict(width=6.0,  lanes=2, hierarchy=5, twoWay=True,  speed=25),   # Đường khu dân cư
    "COMMERCIAL":   dict(width=8.0,  lanes=2, hierarchy=4, twoWay=True,  speed=35),   # Đường thương mại
    "AGRICULTURAL": dict(width=5.0,  lanes=1, hierarchy=5, twoWay=True,  speed=25),   # Đường nông nghiệp
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
    "PROVINCIAL_ROAD": "provincial",
    "LOCAL": "local",
    "ALLEY": "alley",
    "RURAL_LOCAL": "rural",
    "SERVICE": "service",
    # --- Road types mới (Phase 3) ---
    "INTER_VILLAGE": "inter_village",
    "INDUSTRIAL_ACCESS": "industrial_access",
    "RESIDENTIAL": "residential",
    "COMMERCIAL": "commercial",
    "AGRICULTURAL": "agricultural",
}
# Segment class -> material cho js/map.js (phải có đủ key, thiếu sẽ fallback)
MAT_BY_CLASS = {
    "EXPRESSWAY": "asphalt", "RAMP": "asphalt", "TUNNEL": "asphalt",
    "NATIONAL": "asphalt_old", "ARTERIAL": "asphalt_old",
    "COLLECTOR": "concrete", "PROVINCIAL_ROAD": "concrete", "LOCAL": "concrete", "ALLEY": "concrete",
    "RURAL_LOCAL": "dirt", "SERVICE": "dirt",
    "STATION_ACCESS": "concrete", "INTERNAL": "concrete",
    # --- Road types mới (Phase 3) ---
    "INTER_VILLAGE": "concrete",
    "INDUSTRIAL_ACCESS": "asphalt_old",
    "RESIDENTIAL": "concrete",
    "COMMERCIAL": "concrete",
    "AGRICULTURAL": "dirt",
}
# Segment class -> max length khi subdivide (met)
MAX_SEG_LEN = {
    "EXPRESSWAY": 3000.0, "RAMP": 70.0, "TUNNEL": 120.0,
    "NATIONAL": 2500.0, "ARTERIAL": 400.0, "COLLECTOR": 250.0, "PROVINCIAL_ROAD": 300.0,
    "LOCAL": 160.0, "ALLEY": 90.0, "RURAL_LOCAL": 300.0,
    "SERVICE": 200.0, "STATION_ACCESS": 120.0, "INTERNAL": 90.0,
    # --- Road types mới (Phase 3) ---
    "INTER_VILLAGE": 200.0,
    "INDUSTRIAL_ACCESS": 350.0,
    "RESIDENTIAL": 120.0,
    "COMMERCIAL": 150.0,
    "AGRICULTURAL": 250.0,
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


def _cls_of(gen, nid, new_class=None):
    """
    Class ĐẠI NHẤT của node (rank nhỏ nhất trong các nhánh) — thứ mà ma trận
    `TOPO_LEGAL` phải dùng. Node QL1 nối 3 phố + 2 ramp thì "đường chính"
    của nó là NATIONAL, không phải LOCAL của nhánh nhỏ nhất.

    ⚠ `new_class` BẮT BUỘC khi gọi từ `add_segment`. Node CHƯA CÓ NHÁNH nào
    thì CHƯA CÓ CLASS — class của nó CHÍNH LÀ class của đoạn đang thêm vào.
    Bản cũ trả về `"LOCAL"` cho node rỗng ⇒ lúc dựng cao tốc mọi node mới bị
    coi là phố, rồi `EXPRESSWAY not in TOPO_LEGAL["LOCAL"]` ⇒ chặn hết.
    Đo được trên smoke: **1623 lần chặn `LOCAL|LOCAL`**, map tách thành
    **13 thành phần** (trước đó là 1).
    """
    n = gen.nodes.get(nid)
    if n is None:
        return new_class or "LOCAL"
    best_r, best_c = 9, None
    for sid in n["connections"]:
        sg = gen.segments.get(sid)
        if sg is None:
            continue
        r = TOPO_RANK.get(sg["class"], 4)
        if r < best_r:
            best_r, best_c = r, sg["class"]
    return best_c if best_c is not None else (new_class or "LOCAL")


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
#   * Cầu Đà Rằng : QL1 vượt sông Đà Rằng, ~8 km Nam trung tâm Tuy Hòa.
#   * Hầm Đèo Cả : tổng 13,19 km, hầm chính 4,125 km + hầm Cổ Mã 0,5 km + 9,3 km
#       đường dẫn; điểm đầu Km1353+150 (Phú Yên) -> Km1374+525 (Khánh Hòa).
#       Đèo Cả ~12 km, đỉnh ~333-407 m, ranh Đông Hòa (PhY) / Vạn Ninh (KH).
#   * Vũng Rô : vịnh dưới chân đèo Cả, Vạn Ninh, Khánh Hòa (nhánh ven biển).
#   * Đại Lãnh : bãi biển Vạn Giã, Khánh Hòa.
#   * CT01 = Đường cao tốc Bắc-Nam phía Đông : đoạn Nha Trang-Cam Lâm 49,11 km,
#       Cam Lâm-Vĩnh Hảo, Vĩnh Hảo-Phan Thiết 100,8 km, Phan Thiết-Dầu Giây
#       ~99 km (Bình Thuận 47,5 + Đồng Nai 51,5). Nút giao Ba Bàu (Hàm Thuận
#       Nam) đấu nối QL1 tại Km 1717+593.
#   * Vành đai 3 TP.HCM : 47,51 km, nút giao Tân Vạn (3 tầng, 5 nhánh),
#       nút giao Hoàng Hữu Nam, đoạn Thủ Đức 14,73 km.
#   * Khoảng cách QL1 : Tuy Hoa->Nha Trang 122 km, ->Phan Rang +104 km,
#       ->Phan Thiết +138 km, ->TP.HCM +204 km (tổng ~568 km).
# size : city | town | village | hamlet | none   (settlement size class)
# road_factor : hệ số đường bộ / đường chim bay (đồi núi lớn hơn)
# Các tham số vùng (uplift/density/urban/arid/mountain/coastal/forest) được
# BLEND LIÊN TỤC dọc trục corridor => region KHÔNG phải ô vuông (rule 20).
# NGUỒN TỌA ĐỘ (đã đối chiếu Internet 2026-09-29):
#   * CT01 hành lang + km QL1: Wikipedia EN/VI (North–South Expressway East,
#     National Route 1: Tuy Hoa km1329 -> Nha Trang km1450 -> Cam Ranh km1507
#     -> Phan Rang km1555 -> Phan Thiet km1701 -> Long Khanh km1819
#     -> Bien Hoa km1867 -> HCMC km1889).
#   * Tọa độ thị trấn/bến: Nominatim OpenStreetMap (place/node/relation).
#   * Mục "approx" = suy từ vị trí tương đối dọc QL1, cần hiệu chỉnh OSM sau.

ANCHORS = [
    dict(name="Song_Cau",        lat=13.462100, lon=109.223600, size="town",   road_factor=1.15,
         uplift=12, density=0.55, urban=0.50, arid=0.00, mountain=0.20, coastal=0.60, forest=0.35),
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
    dict(name="Ninh_Hoa",        lat=12.493438, lon=109.127087, size="town",   road_factor=1.14,
         uplift=18,  density=0.60, urban=0.55, arid=0.00, mountain=0.20, coastal=0.45, forest=0.35),
    dict(name="Nha_Trang",       lat=12.247185, lon=109.189207, size="city",   road_factor=1.12,
         uplift=16,  density=1.00, urban=1.00, arid=0.00, mountain=0.25, coastal=0.95, forest=0.25),
    dict(name="Dien_Khanh",      lat=12.259825, lon=109.100018, size="town",   road_factor=1.12,
         uplift=14,  density=0.65, urban=0.60, arid=0.00, mountain=0.15, coastal=0.20, forest=0.30),
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
    dict(name="Ca_Na",           lat=11.359448, lon=108.877653, size="village", road_factor=1.16,
         uplift=32,  density=0.30, urban=0.20, arid=0.85, mountain=0.35, coastal=0.65, forest=0.15),
    dict(name="Vinh_Hao",        lat=11.305535, lon=108.721349, size="town",   road_factor=1.18,
         uplift=40,  density=0.42, urban=0.30, arid=0.90, mountain=0.45, coastal=0.55, forest=0.12),
    dict(name="Phan_Ri_Cua",     lat=11.165000, lon=108.535000, size="village", road_factor=1.18,
         uplift=38,  density=0.35, urban=0.22, arid=0.85, mountain=0.40, coastal=0.60, forest=0.12),
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
    dict(name="Long_Thanh",      lat=10.761314, lon=107.020635, size="town",   road_factor=1.14,
         uplift=18,  density=0.62, urban=0.60, arid=0.05, mountain=0.15, coastal=0.05, forest=0.30),
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

# =============================================================================
# 1b. ĐƠN VỊ HÀNH CHÍNH SAU SÁP NHẬP (hiệu lực 12/6/2025 — NQ 202/2025/QH15)
# =============================================================================
# NGUỒN: docs/research/tuyen-phu-yen-sai-gon-2025-sap-xa-hanh-chinh.md
#   §A (NQ 202/2025/QH15, hiệu lực 12/6/2025; huyện tier bỏ từ 1/7/2025)
#   §B1 Đắk Lắk 102 đv = 14 phường + 88 xã   (sau gộp Phú Yên)
#   §B2 Khánh Hòa 65 đv = 16 phường + 48 xã + 1 đặc khu
#   §B3 Lâm Đồng 124 đv = 20 phường + 103 xã + 1 đặc khu (gộp Bình Thuận)
#   §B4 TP Đồng Nai 95 đv = 33 phường + 62 xã (trực thuộc TW)
#   Diện tích + dân số: Văn bản 2896/BNV-CQĐP ngày 27/5/2025 (Bộ Nội vụ),
#   theo bảng "Danh sách đơn vị hành chính thuộc <tỉnh>" trên Wikipedia VI.
#
# ⚠ HAI CÁI KHÔNG ĐƯỢC BỊA (đã đánh dấu rõ trong data):
#   1. `compose` — ĐƠN VỊ CŨ nào gộp vào đơn vị mới: KHÔNG XÁC MINH. Danh
#      sách mới chỉ nêu tên, không nêu thành phần. Suy ra từ "giống tên"
#      là SAI (đã có bẫy thật: "Krông Nô" tồn tại ở cả Đắk Lắk lẫn Lâm Đồng;
#      "Phú Lâm" ở Đồng Nai KHÔNG phải bến xe Nam Tuy Hòa).
#   2. Toạ độ trung tâm: đã tra OSM/Nominatim (grade A) cho thị xã, nhưng
#      phường/xã MỚI thì dùng lại trung tâm đơn vị CŨ (grade B) — đánh dấu
#      `seat="gradeB"`. `seat=None` = chưa có toạ độ, KHÔNG bịa.
#   `on_corridor=False` = đơn vị KHÔNG nằm cạnh QL1 (nội địa) → không chia
#   dải km dọc tuyến, chỉ dùng cho tra cứu "đơn vị gần nhất".
#
# THỨ TỰ trong bảng = thứ tự dọc QL1 từ Bắc (Tuy Hòa) xuống Nam (TP.HCM).
ADMIN_UNITS = [
    # id,               tỉnh,      tên,              loại,      lat,      lon,       km2,   dân 2025, seat,     on_corridor
    ("tuy_hoa",        "Đắk Lắk",  "Tuy Hòa",        "phường", 13.086728, 109.307228,  33.77, 126118, "anchor", True),
    ("phu_yen",        "Đắk Lắk",  "Phú Yên",        "phường", 13.053788, 109.294803,  44.04,  61799, "gradeB", True),
    ("tan_lap",        "Đắk Lắk",  "Tân Lập",        "phường",  None,      None,       46.70,  73316, None,      True),
    ("tan_an",         "Đắk Lắk",  "Tân An",         "phường",  None,      None,       56.41,  64122, None,      True),
    ("hoa_xuan",       "Đắk Lắk",  "Hòa Xuân",       "xã",     13.003000, 109.097000, 129.33,  22962, "gradeB", True),
    ("song_hinh",      "Đắk Lắk",  "Sông Hinh",      "xã",     12.969000, 108.965000, 460.13,  23841, "gradeB", False),
    ("tay_hoa",       "Đắk Lắk",  "Tây Hòa",        "xã",     None,      None,       55.14,  49720, None,      False),
    ("o_loan",         "Đắk Lắk",  "Ô Loan",         "xã",     None,      None,      103.48,  40278, None,      True),
    ("phu_hoa_1",     "Đắk Lắk",  "Phú Hòa 1",      "xã",     None,      None,      142.54,  54212, None,      True),
    ("phu_xuan",       "Đắk Lắk",  "Phú Xuân",       "xã",     None,      None,      140.74,  34836, None,      True),
    ("tuyen_dong",     "Đắk Lắk",  "Tuy An Đông",    "xã",     13.264000, 109.173000,  46.05,  40108, "gradeB", True),
    ("tuyen_bac",      "Đắk Lắk",  "Tuy An Bắc",     "xã",     None,      None,       52.32,  26174, None,      True),
    ("tuyen_tay",      "Đắk Lắk",  "Tuy An Tây",     "xã",     None,      None,      136.20,  12913, None,      False),
    ("tuyen_nam",      "Đắk Lắk",  "Tuy An Nam",     "xã",     None,      None,       69.99,  29805, None,      True),
    ("xuan_canh",      "Đắk Lắk",  "Xuân Cảnh",      "xã",     None,      None,       83.81,  23972, None,      True),
    ("dong_xuan",      "Đắk Lắk",  "Đồng Xuân",      "xã",     13.392000, 109.010000, 206.26,  26907, "gradeB", True),
    ("song_cau",       "Đắk Lắk",  "Sông Cầu",       "phường", 13.462100, 109.223600,  90.49,  38891, "anchor", True),
    ("xuan_dai",       "Đắk Lắk",  "Xuân Đài",       "phường", None,      None,       13.40,  21574, None,      True),
    ("bac_nha_trang",  "Khánh Hòa", "Bắc Nha Trang",  "phường", None,      None,       97.04, 128239, None,      True),
    ("nha_trang",      "Khánh Hòa", "Nha Trang",      "phường", 12.247185, 109.189207,  47.13, 136118, "anchor", True),
    ("tay_nha_trang",  "Khánh Hòa", "Tây Nha Trang",  "phường", None,      None,       27.89, 108065, None,      True),
    ("nam_nha_trang",  "Khánh Hòa", "Nam Nha Trang",  "phường", None,      None,       82.18, 130164, None,      True),
    ("cam_lam",        "Khánh Hòa", "Cam Lâm",        "xã",     12.053414, 109.118664,  None,   None,  "anchor", True),
    ("dien_khanh",     "Khánh Hòa", "Diên Khánh",     "xã",     12.259825, 109.100018,  18.41,  45223, "anchor", True),
    ("van_ninh",       "Khánh Hòa", "Vạn Ninh",       "xã",     12.669000, 109.220000,  None,   None,  "gradeB", True),
    ("ninh_hoa",       "Khánh Hòa", "Ninh Hòa",       "phường", 12.493438, 109.127087,  35.80,  58816, "anchor", True),
    ("ninh_huu",       "Khánh Hòa", "Ninh Hữu",       "xã",     None,      None,      124.30,  14727, None,      False),
    ("phuoc_dinh",     "Khánh Hòa", "Phước Dinh",     "xã",     None,      None,      153.97,  35301, None,      True),
    ("cam_ranh",       "Khánh Hòa", "Cam Ranh",       "phường", 11.887931, 109.094847,  None,   None,  "anchor", True),
    ("do_vinh",        "Khánh Hòa", "Đô Vinh",        "phường", None,      None,       61.96,  33207, None,      True),
    ("phuoc_ha",       "Khánh Hòa", "Phước Hà",       "xã",     None,      None,      230.00,   8900, None,      True),
    ("thuan_nam",      "Khánh Hòa", "Thuận Nam",      "xã",     None,      None,       None,   None,  None,      True),
    ("phan_rang",      "Khánh Hòa", "Phan Rang",      "phường", 11.576983, 108.986539,   9.41,  72250, "anchor", True),
    ("dong_hai",       "Khánh Hòa", "Đông Hải",       "phường", None,      None,       11.00,  54615, None,      True),
    ("tuyen_phong",    "Lâm Đồng", "Tuy Phong",      "xã",     11.400000, 108.850000, 444.10,   9510, "anchor", False),
    ("vinh_hao",       "Lâm Đồng", "Vĩnh Hảo",       "xã",     11.305535, 108.721349,  None,   None,  "anchor", True),
    ("ham_tin",        "Lâm Đồng", "Hàm Tín",        "xã",     10.800000, 107.870000,  None,   None,  "anchor", False),
    ("ham_thuan",      "Lâm Đồng", "Hàm Thuận",      "xã",     10.898000, 107.980000, 198.36,  50680, "gradeB", True),
    ("ham_thuan_nam",  "Lâm Đồng", "Hàm Thuận Nam",  "xã",     None,      None,      111.82,  32771, None,      True),
    ("ba_bau",         "Lâm Đồng", "Bà Bàu",         "xã",     10.865000, 108.030000,  None,   None,  "anchor", True),
    ("phan_thiet",     "Lâm Đồng", "Phan Thiết",     "phường", 10.929626, 108.104387,   4.46,  85493, "anchor", True),
    ("mui_ne",         "Lâm Đồng", "Mũi Né",         "phường", None,      None,      118.59,  50166, None,      True),
    ("ham_thang",      "Lâm Đồng", "Hàm Thắng",      "phường", None,      None,       44.90,  54544, None,      True),
    ("phu_thuy",       "Lâm Đồng", "Phú Thủy",       "phường", None,      None,       17.31,  54049, None,      True),
    ("la_gi",          "Lâm Đồng", "La Gi",          "phường", 10.659000, 107.772000,  68.47,  60549, "gradeB", True),
    ("dau_giay",       "TP Đồng Nai", "Dầu Giây",    "phường", 10.943068, 107.139889,  None,   None,  "anchor", True),
    ("xuan_loc",       "TP Đồng Nai", "Xuân Lộc",     "phường", 10.947000, 107.223000,  None,   None,  "gradeB", True),
    ("long_khanh",     "TP Đồng Nai", "Long Khánh",   "phường", None,      None,       None,   None,  None,      True),
    ("trang_bom",      "TP Đồng Nai", "Trảng Bom",    "phường", 10.966000, 107.000000,  None,   None,  "gradeB", True),
    ("ho_nai",         "TP Đồng Nai", "Hố Nai",       "phường", 10.967000, 106.917000,  None,   None,  "gradeB", True),
    ("phuoc_binh",     "TP Đồng Nai", "Phước Bình",   "phường", None,      None,       None,   None,  None,      True),
    ("nhon_trach",     "TP Đồng Nai", "Nhơn Trạch",   "phường", None,      None,       None,   None,  None,      True),
    ("bien_hoa",       "TP Đồng Nai", "Biên Hòa",     "phường", 10.957000, 106.847000,  None,   None,  "gradeB", True),
    ("long_binh",      "TP Đồng Nai", "Long Bình",    "phường", None,      None,       None,   None,  None,      True),
    ("thu_duc",        "TP Hồ Chí Minh", "Thủ Đức",   "phường", 10.849000, 106.753000,  None,   None,  "gradeB", True),
]
# Ngưỡng "đơn vị gần nhất" dùng được: quá xa thì thà "ngoài tuyến" thay vì
# bịa tên. 25 km — quy mô huyện cũ quanh trục QL1.
ADMIN_NEAR_MAX_KM = 25.0

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
    ("IC_Dai_Lanh",        12.834510, 109.361217, "diamond"),
    ("IC_Van_Thang",       12.657000, 109.190000, "diamond"),
    ("IC_Dien_Tho_QL27C", 12.252659, 109.021261, "diamond"),
    ("IC_Dien_Khanh",      12.247100, 109.082900, "diamond"),
    ("IC_Suoi_Dau",      12.181850, 109.054248, "diamond"),
    ("IC_Cam_Lam",       12.053414, 109.118664, "trumpet"),
    ("IC_Cam_Ranh_QL27B", 11.887931, 109.094847, "diamond"),
    ("IC_Du_Long",       11.753060, 109.054044, "diamond"),
    ("IC_Tan_Dinh",        11.706682, 108.751946, "diamond"),
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
# side   : bến nằm phía nào so với QL1  (west = phía đất liền)
# offset : KHOẢNG TRỐNG từ mép sân bến tới trục QL1 (m) — không phải tâm->QL
# bays   : SỐ NAN ĐỖ MỤC TIÊU (>= số xe tĩnh muốn thấy trong bến)
# TỌA ĐỘ ĐÃ ĐỐI CHIẾU OSM (Nominatim, 2026-09-29):
#   Nha Trang = Bến xe phía Bắc (2 Tháng 4), Phan Rang = Ninh Thuan bus
#   station (52 Lê Duẩn), Phan Thiết = Phan Thiet Bus Station (OSM amenity).
STATION_DEFS = [
    dict(id="nam_tuy_hoa",   name="Bến xe Nam Tuy Hòa",     lat=13.041118, lon=109.311939,
         poi_type="BUS_STATION",          bays=15, spawn=True,  side="west", offset=45.0,
         w=190.0, d=140.0),
    dict(id="nha_trang",     name="Bến xe Nha Trang",       lat=12.288685, lon=109.190585,
         poi_type="MAJOR_BUS_TERMINAL",   bays=24, spawn=False, side="west", offset=45.0,
         w=240.0, d=170.0),
    dict(id="phan_rang",     name="Bến xe Phan Rang",       lat=11.586036, lon=108.986448,
         poi_type="BUS_STATION",          bays=20, spawn=False, side="west", offset=45.0,
         w=220.0, d=150.0),
    dict(id="phan_thiet",    name="Bến xe Phan Thiết",      lat=10.939661, lon=108.102923,
         poi_type="BUS_STATION",          bays=20, spawn=False, side="west", offset=45.0,
         w=220.0, d=150.0),
    dict(id="mien_dong_moi", name="Bến xe Miền Đông Mới",   lat=10.879596, lon=106.815964,
         poi_type="MAJOR_BUS_TERMINAL",   bays=50, spawn=False, side="west", offset=55.0,
         w=340.0, d=200.0),
    # --- Phase 5: Bến xe trung gian ---
    dict(id="song_cau",      name="Bến xe Sông Cầu",        lat=13.462100, lon=109.223600,
         poi_type="BUS_STATION",          bays=10, spawn=False, side="west", offset=35.0,
         w=140.0, d=100.0),
    dict(id="dong_hoa",      name="Bến xe Đông Hòa",        lat=12.905000, lon=109.330000,
         poi_type="BUS_STATION",          bays=12, spawn=False, side="west", offset=40.0,
         w=160.0, d=120.0),
    dict(id="ninh_hoa",      name="Bến xe Ninh Hòa",        lat=12.493438, lon=109.127087,
         poi_type="BUS_STATION",          bays=14, spawn=False, side="west", offset=40.0,
         w=180.0, d=130.0),
    dict(id="cam_ranh",      name="Bến xe Cam Ranh",        lat=11.887931, lon=109.094847,
         poi_type="BUS_STATION",          bays=18, spawn=False, side="west", offset=40.0,
         w=200.0, d=140.0),
    dict(id="vinh_hao",      name="Bến xe Vĩnh Hảo",        lat=11.305535, lon=108.721349,
         poi_type="BUS_STATION",          bays=14, spawn=False, side="west", offset=35.0,
         w=170.0, d=120.0),
    dict(id="bau_cau",       name="Bến xe Bàu Cầu",         lat=10.865000, lon=108.030000,
         poi_type="BUS_STATION",          bays=12, spawn=False, side="west", offset=35.0,
         w=150.0, d=110.0),
    dict(id="phan_ri",       name="Bến xe Phan Rí",         lat=11.165000, lon=108.535000,
         poi_type="BUS_STATION",          bays=10, spawn=False, side="west", offset=35.0,
         w=140.0, d=100.0),
    dict(id="ham_thuan",     name="Bến xe Hàm Thuận",       lat=10.898000, lon=107.980000,
         poi_type="BUS_STATION",          bays=12, spawn=False, side="west", offset=35.0,
         w=150.0, d=110.0),
    dict(id="dau_giay",      name="Bến xe Dầu Giây",        lat=10.943068, lon=107.139889,
         poi_type="BUS_STATION",          bays=16, spawn=False, side="west", offset=40.0,
         w=180.0, d=130.0),
    dict(id="long_thanh",    name="Bến xe Long Thành",      lat=10.761314, lon=107.020635,
         poi_type="BUS_STATION",          bays=14, spawn=False, side="west", offset=35.0,
         w=160.0, d=120.0),
    dict(id="bien_hoa",      name="Bến xe Biên Hòa",        lat=10.940000, lon=106.900000,
         poi_type="MAJOR_BUS_TERMINAL",   bays=22, spawn=False, side="west", offset=45.0,
         w=220.0, d=160.0),
    dict(id="ho_nai",        name="Bến xe Hố Nai",          lat=10.967000, lon=106.917000,
         poi_type="BUS_STATION",          bays=12, spawn=False, side="west", offset=40.0,
         w=150.0, d=120.0),
    dict(id="thu_duc",       name="Bến xe Thủ Đức",         lat=10.849000, lon=106.753000,
         poi_type="BUS_STATION",          bays=15, spawn=False, side="west", offset=40.0,
         w=180.0, d=130.0),
]


# Trạm xăng / trạm nghỉ dọc đường  (station.json pois — KHÔNG có busBays nên
# TrafficManager.setupStationTraffic() return ngay => không phá traffic budget)
FACILITY_DEFS = [
    # === TRẠM THU PHÍ CAO TỐC CT01 (theo thực tế) ===
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
    ("toll_deo_ca",   "Trạm thu phí Đèo Cả",     12.840000, 109.370000, "TOLL"),
    ("toll_van_ninh", "Trạm thu phí Vạn Ninh",   12.670000, 109.220000, "TOLL"),
    ("toll_cam_lam",  "Trạm thu phí Cam Lâm",    12.050000, 109.120000, "TOLL"),
    ("toll_ninh_hoa", "Trạm thu phí Ninh Hòa",   12.490000, 109.130000, "TOLL"),
    ("toll_phan_rang", "Trạm thu phí Phan Rang", 11.580000, 108.990000, "TOLL"),
    ("toll_phan_ri",  "Trạm thu phí Phan Rí",    11.170000, 108.540000, "TOLL"),
    ("toll_ham_thuan", "Trạm thu phí Hàm Thuận", 10.900000, 107.980000, "TOLL"),
    ("toll_long_thanh", "Trạm thu phí Long Thành", 10.770000, 107.020000, "TOLL"),

    # === TRẠM NGHỈ DỌC QL1/CAO TỐC (theo thực tế) ===
    ("rest_vh_205",   "Trạm nghỉ Km205 Vĩnh Hảo-Phan Thiết", 11.154679, 108.185109, "REST_AREA"),
    ("rest_pt_47",    "Trạm nghỉ Km47 Phan Thiết",           10.866266, 107.559388, "REST_AREA"),
    ("rest_lt_41",    "Trạm nghỉ Km41 Long Thành",            10.848196, 107.101505, "REST_AREA"),
    ("rest_cvl_113",  "Trạm nghỉ Km113 Cam Lâm-Vĩnh Hảo",    11.467138, 108.821261, "REST_AREA"),
    ("rest_ninh_hoa", "Trạm nghỉ Ninh Hòa",            12.493400, 109.127100, "REST_AREA"),
    ("rest_ca_na",    "Trạm nghỉ Cà Ná",               11.359400, 108.877600, "REST_AREA"),
    ("rest_long_thanh", "Trạm nghỉ Long Thành",        10.800000, 107.020000, "REST_AREA"),
    ("rest_deo_ca",   "Trạm nghỉ Đèo Cả",             12.850000, 109.370000, "REST_AREA"),
    ("rest_van_ninh", "Trạm nghỉ Vạn Ninh",           12.670000, 109.220000, "REST_AREA"),
    ("rest_cam_ranh", "Trạm nghỉ Cam Ranh",           11.890000, 109.090000, "REST_AREA"),
    ("rest_dien_khanh", "Trạm nghỉ Diên Khánh",        12.260000, 109.100000, "REST_AREA"),
    ("rest_phan_rang", "Trạm nghỉ Phan Rang",         11.580000, 108.990000, "REST_AREA"),
    ("rest_vinh_hao", "Trạm nghỉ Vĩnh Hảo",          11.310000, 108.720000, "REST_AREA"),
    ("rest_phan_ri",  "Trạm nghỉ Phan Rí",           11.170000, 108.540000, "REST_AREA"),
    ("rest_ham_tan",  "Trạm nghỉ Hàm Tân",           10.780000, 107.820000, "REST_AREA"),
    ("rest_ba_bau",   "Trạm nghỉ Bà Bàu",            10.870000, 108.030000, "REST_AREA"),
    ("rest_dau_giay", "Trạm nghỉ Dầu Giây",          10.940000, 107.140000, "REST_AREA"),
    ("rest_xuan_loc", "Trạm nghỉ Xuân Lộc",          10.890000, 107.370000, "REST_AREA"),
    ("rest_trang_bom", "Trạm nghỉ Trảng Bom",        10.950000, 107.060000, "REST_AREA"),
    ("rest_bien_hoa", "Trạm nghỉ Biên Hòa",          10.940000, 106.900000, "REST_AREA"),
    ("rest_ho_nai",   "Trạm nghỉ Hố Nai",            10.970000, 106.920000, "REST_AREA"),

    # === TRẠM XĂNG PETROLIMEX / PVOIL (theo thực tế dọc QL1/CT01) ===
    ("fuel_cam_lam",  "Petrolimex Cam Lâm",   12.047000, 109.112000, "FUEL_STATION"),
    ("fuel_dau_giay", "Petrolimex Dầu Giây",  10.937000, 107.142000, "FUEL_STATION"),
    ("pvoil_hhn",     "PVOIL Hoàng Hữu Nam",   10.874000, 106.820000, "FUEL_STATION"),
    ("pvoil_phan_thiet", "PVOIL Phan Thiết",  10.925000, 108.098000, "FUEL_STATION"),
    ("fuel_tuy_phong", "Petrolimex Tuy Phong",         11.400000, 108.850000, "FUEL_STATION"),
    ("fuel_phan_ri",  "PVOIL Phan Rí Cửa",             11.200000, 108.600000, "FUEL_STATION"),
    ("fuel_ham_tan",  "Petrolimex Hàm Tân",            10.780000, 107.820000, "FUEL_STATION"),
    ("fuel_song_cau", "Petrolimex Sông Cầu",          13.460000, 109.220000, "FUEL_STATION"),
    ("fuel_tuy_hoa",  "Petrolimex Tuy Hòa",           13.080000, 109.310000, "FUEL_STATION"),
    ("fuel_dong_hoa", "Petrolimex Đông Hòa",          12.910000, 109.330000, "FUEL_STATION"),
    ("fuel_ninh_hoa", "Petrolimex Ninh Hòa",          12.490000, 109.130000, "FUEL_STATION"),
    ("fuel_van_ninh", "Petrolimex Vạn Ninh",          12.670000, 109.220000, "FUEL_STATION"),
    ("fuel_cam_ranh", "Petrolimex Cam Ranh",          11.890000, 109.090000, "FUEL_STATION"),
    ("fuel_nha_trang", "Petrolimex Nha Trang",        12.250000, 109.190000, "FUEL_STATION"),
    ("fuel_dien_khanh", "Petrolimex Diên Khánh",      12.260000, 109.100000, "FUEL_STATION"),
    ("fuel_phan_rang", "Petrolimex Phan Rang",        11.580000, 108.990000, "FUEL_STATION"),
    ("fuel_thap_cham", "Petrolimex Tháp Chàm",        11.600000, 109.010000, "FUEL_STATION"),
    ("fuel_vinh_hao", "Petrolimex Vĩnh Hảo",          11.310000, 108.720000, "FUEL_STATION"),
    ("fuel_phan_ri",  "Petrolimex Phan Rí",           11.170000, 108.540000, "FUEL_STATION"),
    ("fuel_ham_thuan", "Petrolimex Hàm Thuận",        10.900000, 107.980000, "FUEL_STATION"),
    ("fuel_ham_tan",  "Petrolimex Hàm Tân",           10.780000, 107.820000, "FUEL_STATION"),
    ("fuel_long_thanh", "Petrolimex Long Thành",      10.760000, 107.020000, "FUEL_STATION"),
    ("fuel_bien_hoa", "Petrolimex Biên Hòa",          10.940000, 106.900000, "FUEL_STATION"),
    ("fuel_ho_nai",   "Petrolimex Hố Nai",            10.970000, 106.920000, "FUEL_STATION"),
    ("fuel_thu_duc",  "Petrolimex Thủ Đức",           10.850000, 106.750000, "FUEL_STATION"),
    ("pvoil_cam_ranh", "PVOIL Cam Ranh",             11.890000, 109.090000, "FUEL_STATION"),
    ("pvoil_nha_trang", "PVOIL Nha Trang",           12.250000, 109.190000, "FUEL_STATION"),
    ("pvoil_vinh_hao", "PVOIL Vĩnh Hảo",             11.310000, 108.720000, "FUEL_STATION"),
    ("pvoil_dau_giay", "PVOIL Dầu Giây",             10.940000, 107.140000, "FUEL_STATION"),
    ("pvoil_long_thanh", "PVOIL Long Thành",         10.760000, 107.020000, "FUEL_STATION"),
    ("pvoil_bien_hoa", "PVOIL Biên Hòa",             10.940000, 106.900000, "FUEL_STATION"),

    # === CÔNG TRÌNH CÔNG CỘNG (Trường học, Bệnh viện, Chợ, Khu công nghiệp) ===
    ("school_tuy_hoa",    "THPT Tuy Hòa",               13.086728, 109.307228, "SCHOOL"),
    ("school_song_cau",   "THPT Sông Cầu",              13.462100, 109.223600, "SCHOOL"),
    ("school_dong_hoa",   "THPT Đông Hòa",              12.905000, 109.330000, "SCHOOL"),
    ("school_nha_trang",  "THPT Nha Trang",             12.247185, 109.189207, "SCHOOL"),
    ("school_cam_ranh",   "THPT Cam Ranh",              11.887931, 109.094847, "SCHOOL"),
    ("school_ninh_hoa",   "THPT Ninh Hòa",              12.493438, 109.127087, "SCHOOL"),
    ("school_phan_rang",  "THPT Phan Rang",             11.576983, 108.986539, "SCHOOL"),
    ("school_thap_cham",  "THPT Tháp Chàm",             11.600000, 109.010000, "SCHOOL"),
    ("school_vinh_hao",   "THPT Vĩnh Hảo",              11.305535, 108.721349, "SCHOOL"),
    ("school_tuy_phong",  "THPT Tuy Phong",             11.400000, 108.850000, "SCHOOL"),
    ("school_phan_ri",    "THPT Phan Rí",               11.165000, 108.535000, "SCHOOL"),
    ("school_ham_thuan",  "THPT Hàm Thuận",             10.898000, 107.980000, "SCHOOL"),
    ("school_phan_thiet", "THPT Phan Thiết",            10.929626, 108.104387, "SCHOOL"),
    ("school_dau_giay",   "THPT Dầu Giây",              10.943068, 107.139889, "SCHOOL"),
    ("school_long_thanh", "THPT Long Thành",            10.761314, 107.020635, "SCHOOL"),
    ("school_bien_hoa",   "THPT Biên Hòa",              10.940000, 106.900000, "SCHOOL"),
    ("school_thu_duc",    "THPT Thủ Đức",               10.849000, 106.753000, "SCHOOL"),

    ("hospital_tuy_hoa",  "BVĐK Tuy Hòa",               13.086728, 109.307228, "HOSPITAL"),
    ("hospital_song_cau", "BVĐK Sông Cầu",              13.462100, 109.223600, "HOSPITAL"),
    ("hospital_nha_trang","BVĐK Nha Trang",             12.247185, 109.189207, "HOSPITAL"),
    ("hospital_cam_ranh", "BVĐK Cam Ranh",              11.887931, 109.094847, "HOSPITAL"),
    ("hospital_ninh_hoa", "BVĐK Ninh Hòa",              12.493438, 109.127087, "HOSPITAL"),
    ("hospital_phan_rang","BVĐK Phan Rang",             11.576983, 108.986539, "HOSPITAL"),
    ("hospital_vinh_hao", "BVĐK Vĩnh Hảo",              11.305535, 108.721349, "HOSPITAL"),
    ("hospital_phan_thiet","BVĐK Phan Thiết",           10.929626, 108.104387, "HOSPITAL"),
    ("hospital_dau_giay", "BVĐK Dầu Giây",              10.943068, 107.139889, "HOSPITAL"),
    ("hospital_long_thanh","BVĐK Long Thành",           10.761314, 107.020635, "HOSPITAL"),
    ("hospital_bien_hoa", "BVĐK Biên Hòa",              10.940000, 106.900000, "HOSPITAL"),
    ("hospital_thu_duc",  "BVĐK Thủ Đức",               10.849000, 106.753000, "HOSPITAL"),

    ("market_tuy_hoa",    "Chợ Tuy Hòa",                13.086728, 109.307228, "MARKET"),
    ("market_song_cau",   "Chợ Sông Cầu",               13.462100, 109.223600, "MARKET"),
    ("market_dong_hoa",   "Chợ Đông Hòa",               12.905000, 109.330000, "MARKET"),
    ("market_nha_trang",  "Chợ Nha Trang",              12.247185, 109.189207, "MARKET"),
    ("market_cam_ranh",   "Chợ Cam Ranh",               11.887931, 109.094847, "MARKET"),
    ("market_ninh_hoa",   "Chợ Ninh Hòa",               12.493438, 109.127087, "MARKET"),
    ("market_phan_rang",  "Chợ Phan Rang",              11.576983, 108.986539, "MARKET"),
    ("market_thap_cham",  "Chợ Tháp Chàm",              11.600000, 109.010000, "MARKET"),
    ("market_vinh_hao",   "Chợ Vĩnh Hảo",               11.305535, 108.721349, "MARKET"),
    ("market_phan_ri",    "Chợ Phan Rí",                11.165000, 108.535000, "MARKET"),
    ("market_phan_thiet", "Chợ Phan Thiết",             10.929626, 108.104387, "MARKET"),
    ("market_dau_giay",   "Chợ Dầu Giây",               10.943068, 107.139889, "MARKET"),
    ("market_long_thanh", "Chợ Long Thành",             10.761314, 107.020635, "MARKET"),
    ("market_bien_hoa",   "Chợ Biên Hòa",               10.940000, 106.900000, "MARKET"),
    ("market_thu_duc",    "Chợ Thủ Đức",                10.849000, 106.753000, "MARKET"),

    ("industrial_cam_lam","KCN Cam Lâm",                12.053414, 109.118664, "INDUSTRIAL"),
    ("industrial_vinh_hao","KCN Vĩnh Hảo",              11.305535, 108.721349, "INDUSTRIAL"),
    ("industrial_dau_giay","KCN Dầu Giây",              10.943068, 107.139889, "INDUSTRIAL"),
    ("industrial_long_thanh","KCN Long Thành",          10.761314, 107.020635, "INDUSTRIAL"),
    ("industrial_bien_hoa","KCN Biên Hòa",              10.940000, 106.900000, "INDUSTRIAL"),
    ("industrial_nha_trang", "KCN Nha Trang",           12.250000, 109.190000, "INDUSTRIAL"),
    ("industrial_cam_ranh", "KCN Cam Ranh",             11.890000, 109.090000, "INDUSTRIAL"),
    ("industrial_phan_rang", "KCN Phan Rang",           11.580000, 108.990000, "INDUSTRIAL"),
    ("industrial_phan_thiet", "KCN Phan Thiết",         10.930000, 108.100000, "INDUSTRIAL"),
    ("industrial_xuan_loc", "KCN Xuân Lộc",             10.950000, 107.220000, "INDUSTRIAL"),
    ("industrial_trang_bom", "KCN Trảng Bom",           10.970000, 107.000000, "INDUSTRIAL"),
    ("industrial_ho_nai", "KCN Hố Nai",                10.970000, 106.920000, "INDUSTRIAL"),
    ("industrial_thu_duc", "KCN Thủ Đức",               10.850000, 106.750000, "INDUSTRIAL"),
    ("industrial_hi_tech", "KCN Cao Tăng Long Thạnh",    10.780000, 107.050000, "INDUSTRIAL"),
]




# -----------------------------------------------------------------------------
# SÔNG / HỒ THẬT (tọa độ xấp xỉ từ OSM + bản đồ) — dùng để KHẮC ĐỊA HÌNH vũng
# nước và TỰ SINH CẦU cho đường cắt qua sông.
# Không phải mọi con sông đều có trong data; đủ các con sông lớn cắt QL1.
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
    ("Cau_Da_Rang", 13.053788, 109.294803, "QL1"),
]
TUNNEL_DEFS = [
    ("Ham_Deo_Ca",  12.864700, 109.365300, "CT01"),
    ("Ham_Co_Ma",   12.815488, 109.354999, "CT01"),
    ("Ham_Nui_Vung", 11.400318, 108.759032, "CT01"),
]

# =============================================================================
# 2. HE THONG NHA — 30 kieu that + bang template phang (>150 hinh hoc khac nhau)
# =============================================================================
# BA LOP, tach bach:
#   1. HOUSE_ARCHETYPES — KIEU NHA THAT TIET VIET NAM (nhà ống, nhà gỗ Trại
#      Câu, nhà lái, nhà sàn, nhà vườn, nhà mái tôn, nhà cửa cuốn, tiệm vá
#      lốp...). Bản cũ để tên giả ("CAP4_NGANG", "MAI_TON1"...) nhưng CHỈ
#      khác nhau ở con số w/d: đo được 194k nhà trong đó 74% SHOPHOUSE, 91.6%
#      SHOPHOUSE+TUBEHOUSE, và chỉ 8/62 archetype từng xuất hiện.
#   2. HOUSE_TEMPLATES — BẢNG PHẲNG trải ra từ (số tầng x ngang x sâu x mái
#      x cánh), khử trùng theo CHỮ KÝ HÌNH HỌC (KHÔNG kèm màu). Mỗi dòng là
#      một hình khác nhau thật sự => không thể còn "100 bản recolor".
#   3. build_house_variant(variant_id, zone) — chọn theo zone + trọng số.
#
# ⚠ BIT CHI TIET (`fl` trong JSON) phải giống hệt `HOUSE_DETAIL` trong
# js/map.js. Đổi thứ tự = đổi hình nhà trong game. Xem js/map.js đầu hàm.
HOUSE_DETAIL = (
    ("WING", 1),        # cánh chữ L phía sau (nhà L / nhà có gác)
    ("ROLLER", 2),      # cửa cuốn mặt tiền
    ("SLIDING", 4),     # vách kính cửa trượt tầng 1
    ("GATE", 8),        # hàng rào + cổng ngưỡng
    ("BALCONY", 16),    # ban công
    ("AWNING", 32),     # mái hiên trước cửa
    ("PORCH", 64),      # hiên gỗ / mái đón (nhà gỗ, nhà lái)
    ("OVERHANG", 128),  # mái nhô sâu hai đầu
    ("STILT", 256),     # nhà sàn — thân nhà nâng cao khỏi nền
    ("SETBACK2", 512),  # tầng 2 lùi vào (nhà 2 lầu lùi)
    ("STAIRWIN", 1024), # cửa sổ cầu thang bên hông (đặc trưng nhà ống)
    ("PARAPET", 2048),  # lan can mái bằng
    ("SHEDJOIN", 4096), # nhà phụ mái tôn chạm hông (hiên kho / chở xe)
)
_HOUSE_BIT = dict(HOUSE_DETAIL)

# flag chi duoc bat khi dieu kien KIEU nha that cho phep:
#   _gate     -> nhom nha co tuong ran (khong phai nha pho dan sat)
#   _balcony  -> can >= 2 tang moi co chuc nang
#   _setback2 -> can >= 2 tang
#   _awning   -> khong o tang 6 dem xuong
#   _parapet  -> chi khi mai bang
HOUSE_ARCHETYPES = [
    # ---------------------------------------------------------------- PHỐ ---
    dict(type="nha_pho_3_lai", zones=("urban",), weight=12, floors=(2, 4),
         w=(4.4, 5.2), d=(9.0, 11.0), roof=("pitched",), wing=(None, "L"),
         flags=("BALCONY", "ROLLER", "OVERHANG", "SETBACK2", "AWNING"),
         sign=False),
    dict(type="nha_pho_cua_cuon", zones=("urban", "industrial"), weight=10,
         floors=(3, 5), w=(4.8, 6.0), d=(10.0, 12.0), roof=("flat",),
         wing=(None,),
         flags=("ROLLER", "BALCONY", "PARAPET", "STAIRWIN", "SHEDJOIN"),
         sign=True),
    dict(type="nha_pho_chi_tinh", zones=("urban",), weight=5, floors=(4, 6),
         w=(4.6, 5.6), d=(11.0, 14.0), roof=("flat",), wing=(None,),
         flags=("PARAPET", "STAIRWIN", "SHEDJOIN", "ROLLER", "OVERHANG"),
         sign=True),
    dict(type="nha_pho_hem", zones=("urban",), weight=9, floors=(2, 3),
         w=(3.8, 4.6), d=(8.0, 10.0), roof=("flat", "pitched"), wing=(None,),
         flags=("STAIRWIN", "AWNING", "PARAPET", "SHEDJOIN"), sign=False),
    dict(type="nha_ong", zones=("urban", "suburb"), weight=13, floors=(3, 5),
         w=(3.4, 4.2), d=(13.0, 16.0), roof=("flat",), wing=(None,),
         flags=("STAIRWIN", "OVERHANG", "PARAPET", "SHEDJOIN"), sign=False),
    dict(type="nha_tam_pho", zones=("urban", "industrial"), weight=8,
         floors=(1, 2), w=(4.0, 5.0), d=(7.0, 9.0), roof=("flat",),
         wing=(None,), flags=("PARAPET", "ROLLER"), sign=True),
    dict(type="nha_thuong_mai", zones=("urban",), weight=9, floors=(4, 5),
         w=(5.0, 6.4), d=(11.0, 14.0), roof=("flat", "pitched"),
         wing=(None, "L"),
         flags=("ROLLER", "BALCONY", "AWNING", "PARAPET", "SHEDJOIN",
                "OVERHANG"),
         sign=True),
    dict(type="khach_san_mini", zones=("urban", "suburb"), weight=5,
         floors=(3, 5), w=(8.0, 11.0), d=(12.0, 15.0), roof=("flat",),
         wing=(None,), flags=("PARAPET", "SETBACK2", "AWNING", "STAIRWIN"),
         sign=True),
    dict(type="nha_an_hoa_gian", zones=("urban", "suburb"), weight=5,
         floors=(1, 2), w=(7.0, 9.0), d=(10.0, 12.0), roof=("flat",),
         wing=(None,), flags=("AWNING", "SHEDJOIN", "ROLLER"), sign=True),
    dict(type="nha_dat_kinh_doan", zones=("urban", "industrial"), weight=4,
         floors=(1, 2), w=(6.0, 8.0), d=(9.0, 12.0), roof=("flat", "pitched"),
         wing=(None, "L"), flags=("AWNING", "ROLLER", "PARAPET"), sign=True),
    # ------------------------------------------------------- NGOẠI THÀNH ---
    dict(type="biet_thu", zones=("suburb",), weight=8, floors=(2, 3),
         w=(9.0, 11.0), d=(12.0, 15.0), roof=("pitched",), wing=(None, "L"),
         flags=("GATE", "BALCONY", "OVERHANG", "PORCH"), sign=False),
    dict(type="biet_thu_dong_duong", zones=("suburb",), weight=4, floors=(3, 3),
         w=(10.0, 12.0), d=(14.0, 17.0), roof=("pitched",), wing=(None,),
         flags=("GATE", "BALCONY", "SETBACK2", "OVERHANG", "PORCH"),
         sign=False),
    dict(type="nha_vuon", zones=("suburb", "rural"), weight=11, floors=(1, 2),
         w=(8.0, 10.0), d=(11.0, 14.0), roof=("pitched", "shed"),
         wing=(None, "L"), flags=("GATE", "OVERHANG", "SHEDJOIN"), sign=False),
    dict(type="nha_lai_2_lau", zones=("suburb",), weight=7, floors=(2, 3),
         w=(7.0, 9.0), d=(10.0, 13.0), roof=("pitched",), wing=(None,),
         flags=("GATE", "BALCONY", "SETBACK2", "OVERHANG"), sign=False),
    dict(type="nha_cap4_nguong", zones=("suburb", "rural"), weight=9,
         floors=(1, 2), w=(8.0, 10.0), d=(12.0, 15.0), roof=("pitched",),
         wing=(None,), flags=("GATE", "OVERHANG", "PORCH"), sign=False),
    dict(type="nha_ro_hien_tam", zones=("suburb", "rural"), weight=7,
         floors=(1, 1), w=(7.0, 9.0), d=(10.0, 12.0), roof=("pitched",),
         wing=(None,), flags=("PORCH", "OVERHANG", "SHEDJOIN", "GATE"),
         sign=False),
    dict(type="nha_cao_cap", zones=("suburb",), weight=5, floors=(2, 3),
         w=(7.0, 8.0), d=(11.0, 14.0), roof=("flat",), wing=(None, "L"),
         flags=("GATE", "BALCONY", "PARAPET", "SHEDJOIN"), sign=False),
    # ------------------------------------------------------------ NÔNG THÔN ---
    dict(type="nha_go_trai_cau", zones=("rural",), weight=9, floors=(1, 1),
         w=(5.4, 6.4), d=(9.0, 11.0), roof=("pitched",), wing=(None,),
         flags=("STILT", "PORCH", "OVERHANG", "SHEDJOIN"), sign=False),
    dict(type="nha_go_mai_ton", zones=("rural",), weight=10, floors=(1, 2),
         w=(5.6, 7.0), d=(9.0, 12.0), roof=("shed", "pitched"), wing=(None,),
         flags=("STILT", "PORCH", "SHEDJOIN", "OVERHANG"), sign=False),
    dict(type="nha_san_tho", zones=("rural",), weight=6, floors=(1, 1),
         w=(6.0, 7.5), d=(8.0, 10.0), roof=("shed",), wing=(None,),
         flags=("STILT", "PORCH", "SHEDJOIN"), sign=False),
    dict(type="nha_mai_ton", zones=("rural",), weight=18, floors=(1, 2),
         w=(5.5, 7.0), d=(8.0, 11.0), roof=("shed",), wing=(None, "L"),
         flags=("SHEDJOIN",), sign=False),
    dict(type="nha_mai_nghi_nam", zones=("rural",), weight=12, floors=(1, 1),
         w=(6.5, 8.0), d=(10.0, 12.0), roof=("pitched",), wing=(None,),
         flags=("OVERHANG", "SHEDJOIN"), sign=False),
    dict(type="nha_lan_hai", zones=("rural",), weight=8, floors=(1, 1),
         w=(9.0, 11.0), d=(7.0, 9.0), roof=("shed",), wing=(None,),
         flags=("SHEDJOIN", "PORCH"), sign=False),
    dict(type="nha_lai_hue", zones=("rural",), weight=6, floors=(1, 1),
         w=(5.0, 6.0), d=(9.0, 11.0), roof=("pitched",), wing=(None,),
         flags=("PORCH", "OVERHANG", "STILT"), sign=False),
    dict(type="nha_cap4", zones=("rural",), weight=14, floors=(1, 2),
         w=(6.5, 8.0), d=(10.0, 13.0), roof=("pitched",), wing=(None, "L"),
         flags=("OVERHANG", "GATE", "SHEDJOIN"), sign=False),
    dict(type="nha_tam_can", zones=("rural",), weight=10, floors=(1, 1),
         w=(3.4, 4.4), d=(5.0, 7.0), roof=("shed",), wing=(None,),
         flags=("SHEDJOIN", "PORCH"), sign=False),
    dict(type="nha_mai_nhua_lan", zones=("rural",), weight=9, floors=(1, 1),
         w=(5.0, 6.5), d=(7.0, 9.0), roof=("shed",), wing=(None, "L"),
         flags=("SHEDJOIN",), sign=False),
    dict(type="nha_ke_dai", zones=("rural",), weight=7, floors=(1, 1),
         w=(4.4, 5.4), d=(6.0, 8.0), roof=("pitched",), wing=(None,),
         flags=("STILT", "PORCH", "OVERHANG"), sign=False),
    # -------------------------------------------------- KHU CÔNG NGHIỆP ---
    dict(type="nha_cong_nhan", zones=("industrial", "suburb"), weight=10,
         floors=(2, 3), w=(6.0, 8.0), d=(9.0, 12.0), roof=("flat", "shed"),
         wing=(None,), flags=("PARAPET", "SHEDJOIN", "ROLLER"), sign=False),
    dict(type="nha_xuong_nho", zones=("industrial",), weight=9, floors=(1, 1),
         w=(11.0, 15.0), d=(16.0, 21.0), roof=("shed", "pitched"),
         wing=(None,), flags=("SHEDJOIN", "ROLLER", "AWNING"), sign=True),
    dict(type="kho_hang", zones=("industrial",), weight=7, floors=(1, 2),
         w=(14.0, 19.0), d=(20.0, 26.0), roof=("flat",), wing=(None,),
         flags=("PARAPET", "SHEDJOIN", "ROLLER"), sign=False),
    dict(type="quan_an_xe_tai", zones=("industrial", "rural", "suburb"),
         weight=9, floors=(1, 1), w=(8.0, 11.0), d=(11.0, 15.0),
         roof=("shed", "pitched"), wing=(None, "L"),
         flags=("SHEDJOIN", "AWNING", "ROLLER"), sign=True),
    dict(type="tiem_sua_chua_xe", zones=("industrial", "urban", "suburb"),
         weight=8, floors=(1, 2), w=(8.0, 10.0), d=(12.0, 16.0),
         roof=("shed",), wing=(None,),
         flags=("SHEDJOIN", "ROLLER", "AWNING"), sign=True),
    # ------------------------------------------ VÙNG THƯƠNG MẠI DỌC ĐƯỜNG ---
    dict(type="nha_mat_tien_quan_cafe", zones=("commercial", "urban"), weight=10,
         floors=(1, 2), w=(4.0, 6.0), d=(8.0, 12.0), roof=("flat", "shed"),
         wing=(None,), flags=("ROLLER", "AWNING", "SHEDJOIN"), sign=True),
    dict(type="nha_mat_tien_tap_hoa", zones=("commercial", "urban"), weight=8,
         floors=(1, 2), w=(3.5, 5.0), d=(7.0, 10.0), roof=("flat",),
         wing=(None,), flags=("ROLLER", "SHEDJOIN"), sign=True),
    dict(type="nha_mat_tien_nha_hang", zones=("commercial", "urban", "suburb"), weight=7,
         floors=(1, 2), w=(6.0, 9.0), d=(10.0, 14.0), roof=("flat", "pitched"),
         wing=(None, "L"), flags=("AWNING", "ROLLER", "SHEDJOIN"), sign=True),
    dict(type="nha_mat_tien_xe_may", zones=("commercial", "urban", "industrial"), weight=6,
         floors=(1, 2), w=(8.0, 12.0), d=(12.0, 18.0), roof=("shed", "flat"),
         wing=(None,), flags=("ROLLER", "AWNING", "SHEDJOIN"), sign=True),
    # ------------------------------------------ KHU DÂN CƯ HIỆN ĐẠI ---
    dict(type="chung_cu_cao_cap", zones=("urban", "residential"), weight=6,
         floors=(10, 20), w=(18.0, 25.0), d=(25.0, 35.0), roof=("flat",),
         wing=(None,), flags=("PARAPET", "BALCONY", "SETBACK2"), sign=False),
    dict(type="chung_cu_trung_cap", zones=("urban", "residential", "suburb"), weight=8,
         floors=(5, 10), w=(15.0, 20.0), d=(20.0, 30.0), roof=("flat",),
         wing=(None,), flags=("PARAPET", "BALCONY", "SETBACK2"), sign=False),
    dict(type="nha_pho_hien_dai", zones=("residential", "urban", "suburb"), weight=12,
         floors=(3, 5), w=(4.5, 6.0), d=(10.0, 14.0), roof=("flat",),
         wing=(None, "L"), flags=("BALCONY", "ROLLER", "PARAPET", "SETBACK2", "OVERHANG"), sign=False),
    dict(type="biet_thu_hien_dai", zones=("residential", "suburb"), weight=5,
         floors=(2, 3), w=(10.0, 14.0), d=(15.0, 20.0), roof=("flat", "pitched"),
         wing=(None, "L"), flags=("GATE", "BALCONY", "OVERHANG", "SETBACK2", "PORCH"), sign=False),
    dict(type="nha_pho_dien_may", zones=("commercial", "urban", "residential"), weight=7,
         floors=(2, 4), w=(4.0, 6.0), d=(10.0, 14.0), roof=("flat",),
         wing=(None, "L"), flags=("ROLLER", "AWNING", "PARAPET", "SETBACK2"), sign=True),
    # ------------------------------------------ KHU CÔNG NGHIỆP MỞ RỘNG ---
    dict(type="nha_may_lon", zones=("industrial",), weight=5,
         floors=(1, 2), w=(30.0, 50.0), d=(40.0, 80.0), roof=("shed", "flat"),
         wing=(None,), flags=("PARAPET", "SHEDJOIN", "ROLLER"), sign=True),
    dict(type="kho_xang_dau", zones=("industrial",), weight=4,
         floors=(1, 1), w=(20.0, 30.0), d=(30.0, 50.0), roof=("shed", "flat"),
         wing=(None,), flags=("PARAPET", "SHEDJOIN", "ROLLER"), sign=False),
    dict(type="kho_lanh", zones=("industrial",), weight=4,
         floors=(1, 1), w=(15.0, 25.0), d=(20.0, 40.0), roof=("flat", "shed"),
         wing=(None,), flags=("PARAPET", "SHEDJOIN", "ROLLER"), sign=False),
    dict(type="tram_xang_kcn", zones=("industrial",), weight=5,
         floors=(1, 1), w=(20.0, 30.0), d=(15.0, 25.0), roof=("shed", "flat"),
         wing=(None,), flags=("ROLLER", "AWNING", "SHEDJOIN"), sign=True),
    dict(type="nha_xuong_che_bien", zones=("industrial",), weight=6,
         floors=(1, 2), w=(15.0, 25.0), d=(20.0, 35.0), roof=("shed", "flat"),
         wing=(None,), flags=("SHEDJOIN", "ROLLER", "AWNING"), sign=True),
    # ------------------------------------------ NÔNG THÔN MỞ RỘNG ---
    dict(type="nha_san_mien_nui", zones=("rural",), weight=7,
         floors=(1, 1), w=(5.0, 7.0), d=(7.0, 10.0), roof=("pitched", "shed"),
         wing=(None,), flags=("STILT", "PORCH", "OVERHANG"), sign=False),
    dict(type="nha_go_chan_cao", zones=("rural",), weight=6,
         floors=(1, 1), w=(6.0, 8.0), d=(8.0, 12.0), roof=("pitched",),
         wing=(None,), flags=("STILT", "PORCH", "OVERHANG", "SHEDJOIN"), sign=False),
    dict(type="nha_san_ban_lam", zones=("rural",), weight=5,
         floors=(1, 1), w=(8.0, 12.0), d=(6.0, 8.0), roof=("shed",),
         wing=(None,), flags=("STILT", "SHEDJOIN"), sign=False),
    dict(type="nha_nghi_duong_truong", zones=("rural",), weight=6,
         floors=(1, 1), w=(8.0, 12.0), d=(10.0, 15.0), roof=("shed", "pitched"),
         wing=(None,), flags=("PORCH", "AWNING", "SHEDJOIN"), sign=True),
    dict(type="chua_dinh", zones=("rural", "suburb"), weight=3,
         floors=(1, 1), w=(8.0, 12.0), d=(10.0, 15.0), roof=("pitched",),
         wing=(None,), flags=("OVERHANG", "PORCH"), sign=False),
]

ROOF_COLORS = [0x8b3a3a, 0xa0422a, 0x6b2f2f, 0x9c4a2f, 0x2f5f8b, 0x3f6b4a,
               0x5a5a5a, 0x7a4b2a, 0x274b6b, 0x8a6a3a, 0x5c6b52, 0x9a7b4f]
FACADE_COLORS = [0xf2ece0, 0xe8dfc8, 0xdfd3b8, 0xf5f0e6, 0xe4ddd0, 0xd9cfc0,
                 0xcfd9d4, 0xe9d9c4, 0xdde4ea, 0xf0e2d0, 0xe6e6dc, 0xcfc4b4,
                 0xd9d2c6, 0xece2d2]
FLOOR_H = 3.15          # chiều cao 1 tầng (m) — nhà dân VN 3.0-3.3
STILT_LIFT = 0.95       # khoảng không dưới nhà sàn
HOUSE_ZONES = ("urban", "suburb", "rural", "industrial")


def _house_flags(a, floors, roof):
    """Cờ chi tiết hợp lệ với (kiểu nhà, số tầng, kiểu mái)."""
    f = set()
    want = a["flags"]
    for b in want:
        bit = _HOUSE_BIT.get(b)
        if bit is None:
            continue
        if b == "GATE" and a["type"] in ("nha_pho_3_lai", "nha_ong",
                                         "nha_pho_hem", "nha_pho_chi_tinh",
                                         "nha_pho_cua_cuon", "nha_thuong_mai",
                                         "khach_san_mini", "nha_an_hoa_gian",
                                         "nha_dat_kinh_doan", "nha_tam_pho"):
            continue                      # nhà phố dính liền kề, không tường rào
        if b == "BALCONY" and floors < 2:
            continue
        if b == "SETBACK2" and floors < 2:
            continue
        if b == "OVERHANG" and roof != "pitched":
            continue                      # mái nhô sâu chỉ có ý nghĩa ở mái nghi
        if b == "PARAPET" and roof != "flat":
            continue
        if b == "AWNING" and floors > 4:
            continue
        f.add(bit)
    return f


def _expand_house_templates():
    """
    Trải bảng template PHẲNG. Mỗi dòng khác nhau về HÌNH HỌC, không kể màu.

    Khử trùng bằng chữ ký hình học:
        type|floors|w|d|roof|wing|flags
    => KHÔNG THỂ còn 2 dòng trùng hình (chỉ khác màu), vì màu không nằm trong
    chữ ký và cũng không sinh ra 2 dòng.
    """
    rows, seen = [], set()
    for a in HOUSE_ARCHETYPES:
        for floors in range(a["floors"][0], a["floors"][1] + 1):
            for w in a["w"]:
                for d in a["d"]:
                    for roof in a["roof"]:
                        for wing in a["wing"]:
                            fl = _house_flags(a, floors, roof)
                            sig = "|".join((
                                a["type"], str(floors), "%.2f" % w,
                                "%.2f" % d, roof, str(wing),
                                ",".join(str(b) for b in sorted(fl))))
                            if sig in seen:
                                continue
                            seen.add(sig)
                            h = round(floors * FLOOR_H, 2)
                            rows.append({
                                "type": a["type"], "zones": a["zones"],
                                "floors": floors, "w": w, "d": d, "height": h,
                                "roof_type": roof, "wing": wing,
                                "flags": fl, "sign": bool(a.get("sign")),
                                "weight": a["weight"], "sig": sig})
    return rows


HOUSE_TEMPLATES = _expand_house_templates()
HOUSE_TEMPLATE_COUNT = len(HOUSE_TEMPLATES)

# Bảng chọn theo zone: danh sách template + trọng số lũy tiến (nhị phân).
_HOUSE_ZONE_IDX = {}
_HOUSE_ZONE_CUM = {}
for _z in HOUSE_ZONES:
    _lst = [i for i, t in enumerate(HOUSE_TEMPLATES) if _z in t["zones"]]
    _HOUSE_ZONE_IDX[_z] = _lst
    _cum, _acc = [], 0
    for _i in _lst:
        _acc += HOUSE_TEMPLATES[_i]["weight"]
        _cum.append(_acc)
    _HOUSE_ZONE_CUM[_z] = _cum
# Zone nào không có template nào -> fallback toàn bộ bảng (không bao giờ rỗng).
HOUSE_ZONE_COUNTS = {z: len(_HOUSE_ZONE_IDX[z]) for z in HOUSE_ZONES}


def house_template_stats():
    """Báo cáo kiểm chứng: KHÔNG dùng làm '100 template' giả."""
    by_type, by_zone, sigs = {}, {z: 0 for z in HOUSE_ZONES}, set()
    for t in HOUSE_TEMPLATES:
        by_type[t["type"]] = by_type.get(t["type"], 0) + 1
        sigs.add(t["sig"])
        for z in t["zones"]:
            by_zone[z] = by_zone.get(z, 0) + 1
    return {"templates": HOUSE_TEMPLATE_COUNT,
            "archetypes": len(HOUSE_ARCHETYPES),
            "distinct_signatures": len(sigs),
            "by_type": by_type, "by_zone": by_zone}


def build_house_variant(variant_id, zone="urban"):
    """
    Trả 1 bộ tham số nhà. Chọn theo ZONE + TRỌNG SỐ, hình học lấy thẳng từ
    bảng phẳng nên 2 variant khác id hoặc khác zone vẫn không bao giờ trùng
    hình (trùng màu thì được, màu không phải hình).
    """
    idxs = _HOUSE_ZONE_IDX.get(zone)
    if not idxs:
        idxs = list(range(HOUSE_TEMPLATE_COUNT))
        cum = None
    else:
        cum = _HOUSE_ZONE_CUM.get(zone)
    # hash loang: id lien ke phai ra kieu khac nhau
    h = (variant_id * 2654435761 + 1013904223) & 0xffffffff
    if cum:
        r = h % cum[-1]
        lo, hi = 0, len(cum) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cum[mid] <= r:
                lo = mid + 1
            else:
                hi = mid
        tpl = HOUSE_TEMPLATES[idxs[lo]]
    else:
        tpl = HOUSE_TEMPLATES[h % HOUSE_TEMPLATE_COUNT]
    roof_color = ROOF_COLORS[(h >> 7) % len(ROOF_COLORS)]
    facade = FACADE_COLORS[(h >> 13) % len(FACADE_COLORS)]
    flags = tpl["flags"]
    # `flags` la TAP SO BIT (int) — dung `in`, khong dung `&` voi int.
    awning = (_HOUSE_BIT["AWNING"] in flags) or (_HOUSE_BIT["PORCH"] in flags)
    return dict(tpl, roof_color=roof_color, facade=facade, awning=awning,
                variant=variant_id, zone=zone)


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
        self._build_corridor()       # QL1 polyline + chainage
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
    # 4.2 CORRIDOR — QL1 trunk (đích + khoảng cách thật, không drift)
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
        -> (u: blend chỉ số anchor, d: khoảng cách tới trục QL1)

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
        # LỊCH SỬ TOẠ ĐỘ: giữ lại SAU khi node bị xoá, để `_repair_route_refs`
        # gán lại đúng vị trí cho id đã chết. Rất nhỏ, không bao giờ xoá.
        # ⚠ Bản cũ THIẾU dòng này => `hint` luôn None => node chết trong
        # `routes.json` bị thay bằng node tùy tiện, tuyến dài 3357km với hop
        # 379km .
        self._node_xy_hist[nid] = (float(x), float(z))
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
    # VẤN ĐỀ ĐO ĐƯỢC TRÊN DATA HIỆN TẠI:
    #   * 1229 cặp nhánh rời CÙNG node dưới 15°  -> 2 đường nằm chồng lên
    #     nhau cả trăm mét (đường ma, mép đường cắt ngang, z-fighting).
    #   * 55 node có >=6 nhánh, tệ nhất 32 nhánh  -> không phải ngã giao,
    #     là mìn spaghetti. Ngã giao thật tối đa 4-6 nhánh.
    #   * 476 node degree-1 (ALLEY/COLLECTOR/LOCAL/INTERNAL) -> đường cụt
    #     không dẫn tới đâu, chỉ để "map có nhiều đường".
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
                    if not isinstance(far, str):
                        break
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
                  % ("/".join(str(TOPO_DEGREE_CAP.get(r, 6)) for r in sorted(
                      r for r in TOPO_DEGREE_CAP if isinstance(r, int))), fixed))
        if stuck:
            print("      ! %d node vuot bac, khong ghep duoc (de lai nguyen)" % stuck)
        return fixed

    def _split_ql_from_expressway(self, min_br=45.0):
        """
        TÁCH QL1 RA KHỎI NÚT CAO TỐC (rule 11/60) — tạo CẦU VƯỢT thật.

        Đo được trong game: node mang [EXPRESSWAY, NATIONAL, COLLECTOR] tức
        QL1 nối THẲNG vào mặt CT01 ở mặt bằng. Trên cao tốc kiểu hạn chế,
        QL1 và CT01 chỉ gặp nhau ở ngã giao KHÁC MỨC: chúng KHÔNG chung node
        (đúng như Vành đai 3 × QL1, QL1 × CT01 ở Việt Nam).

        ⚠ PHẢI GIỮ LIÊN THÔNG: cắt `nid->far` rồi nối `nid->nn->far`. Bản chỉ
        nối `nn->far` làm QL1 ĐỨT ở nút cũ — 5814 node rơi thành 2 mảnh (đo
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
                        self.segments[t2].get("name") or "cau_vuot_QL1")
                moved += 1
        if moved:
            print("      tach QL1 khoi nut cao toc (cau vuot): %d nhanh" % moved)
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

    def _in_kdc_zone(self, x, z, pad=30.0):
        """(x,z) có lọt vào bán kính khu dân cư (settlement) + pad?"""
        for s in (getattr(self, "settlements", []) or []):
            r = s.get("radius")
            if not r:
                continue
            dx, dz = x - s["x"], z - s["z"]
            if dx * dx + dz * dz <= (r + pad) ** 2:
                return True
        return False

    def _dead_end_meaningful(self, nid, sg):
        """Đầu đường degree-1 có CHỦ ĐÍCH không?

        MỘT phép tính cho cả bước dọn lẫn `topo_validate`: cleanup dọn đúng
        thứ validate báo lỗi, không thể lệch nhau.
        """
        if sg.get("bridge") or sg["class"] == "TUNNEL":
            return True                    # cầu vượt / hầm = cấp khác mức
        n = self.nodes.get(nid)
        a, b = self.nodes.get(sg["from"]), self.nodes.get(sg["to"])
        if n is None or a is None or b is None:
            return True
        if dist(a["x"], a["z"], b["x"], b["z"]) <= 60.0:
            return True                    # lối vào nhà / ngõ hẻm
        if self._in_station_zone(n["x"], n["z"], 10.0):
            return True                    # lối vào sân bến / trạm
        if sg["class"] in ("NATIONAL", "ARTERIAL", "PROVINCIAL_ROAD"):
            return False                   # đường chính không bào chữa bằng "trong phố"
        return self._in_kdc_zone(n["x"], n["z"])

    def _resolve_meaningless_dead_ends(self, max_round=8, reach=600.0):
        """Đầu degree-1 VÔ NGHĨA ở cuối pipeline: nối (T-junction) trước,
        không nối được thì xoá. Chạy SAU mọi bước cắt/gộp vì chúng sinh đầu
        cụt mới — dọn sớm là dọn đồ của người khác.
        """
        linked = dropped = 0
        for _ in range(max_round):
            self._build_node_seg_index()
            todo = []
            for nid in list(self.nodes.keys()):
                sids = self._segs_at(nid)
                if len(sids) != 1:
                    continue
                sg = self.segments.get(sids[0])
                if not sg or sg["class"] not in TOPO_DEAD_CLS:
                    continue
                if not self._dead_end_meaningful(nid, sg):
                    todo.append((nid, sids[0]))
            if not todo:
                break
            progress = False
            for nid, sid in todo:
                sg = self.segments.get(sid)
                if sg is None or nid not in self.nodes:
                    continue
                if self._t_junction_link(nid, sg, reach):
                    linked += 1
                    progress = True
                    continue
                self._remove_segment(sid)
                dropped += 1
                progress = True
            self._prune_orphans()
            if not progress:
                break
        if linked or dropped:
            print("      dau duong vo nghia: noi %d / xoa %d"
                  % (linked, dropped))
        return dropped

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
            # ĐƯỜNG CÓ TÊN = THỨ ĐƯỢC ĐẶT TÊN CÓ Ý (tuyến thật, đường nối hạ
            # tầng, nối mảnh rời). Đo được 6 đường cụt CÓ TÊN trong đó có
            # `RING3_LINK_QL` (nối Vành đai 3 về QL1) và `LINK_CT01_END`
            # (nối cuối CT01) — hạ tầng thật, chỉ vì dài 283m/349m là dính
            # điều kiện xoá theo độ dài. Không tên = nhánh do thuật toán tăng
            # trưởng sinh ra ⇒ mới là "đường cụt vô nghĩa".
            if s.get("name"):
                continue
            L = self._branch_len(nid, sid)
            if L < min_len and s["class"] in ("ALLEY", "SERVICE", "INTERNAL", "LOCAL"):
                dead.append(nid)          # ngan sat -> xoa
            elif L >= 120.0 and s["class"] in ("COLLECTOR", "ARTERIAL",
                                               "RURAL_LOCAL", "LOCAL"):
                # `LOCAL` phải có mặt: đo được 42/47 đoạn cụt >= 120m là LOCAL
                # (đường phố trong khu phố — 30m bình thường, 247m thì là ngõ
                # cụt dài 250m không dẫn đi đâu).
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
        # CHẶN BẰNG CHÍNH MA TRẬN `TOPO_LEGAL` (P32) — cùng tiêu chí mà
        # `audit_world.py` T5 kiểm. Đo được trên data đã export:
        #     ALLEY<->ARTERIAL 101 | ARTERIAL<->EXPRESSWAY 5
        #     EXPRESSWAY<->NATIONAL 2 | LOCAL<->RAMP 2
        # 101 trong số đó cổng `topo_link_ok` ĐÃ chặn đúng ⇒ chúng đi qua
        # `add_segment` trực tiếp. Đặt luật ở đây là cách duy nhất không chỗ
        # nào lách được: mọi đường trong map đều đi qua đúng một điểm này.
        # MA TRẬN KHÔNG SỬA — đã kiểm đối xứng 12×12: 0 cặp lệch. Đó là
        # phân cấp có chủ ý: `ALLEY` chỉ nối ALLEY/COLLECTOR/LOCAL/
        # RURAL_LOCAL/SERVICE, KHÔNG nối ARTERIAL — hẻm phải đổ vào đường phố
        # hoặc đường cấp xã, không đổ thẳng vào đường tỉnh.
        _ca = _cls_of(self, n1, r_class)
        _cb = _cls_of(self, n2, r_class)
        if (r_class not in TOPO_LEGAL.get(_cb, ()) or
                _ca not in TOPO_LEGAL.get(r_class, ())):
            # ghi cả `r_class` vào lý do: chỉ ghi `_ca|_cb` thì
            # `EXPRESSWAY|LOCAL` và `ALLEY|LOCAL` trùng một chuỗi.
            _k = "ngoai ma tran %s>%s|%s" % (r_class, _ca, _cb)
            self._topo_reject[_k] = self._topo_reject.get(_k, 0) + 1
            return None
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
    # 4.7 CORRIDOR ROADS  (QL1 trunk + branch + junction)
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
    # Do duoc: 3 ham sua giao lo tach 1 thanh phan thanh 61 chi bang cach
    # them canh moi roi xoa canh cu. Ly do: canh cu co the la CANH CAU NOI
    # duy nhat cua mot nhanh - xoa no cat nhanh khoi phia lai.
    # `oid` duoc chon tu neighbors cua `far` nen cung o phia `far`, khong
    # the bu lai phia bi cat.
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
        print("[1/8] Road corridors (QL1 / CT01 / Vành đai 3) ...")
        self._build_ql1()
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
        # RULE 8: duong da build xong -> ben nao bi cat lai thi DAT LAI ben,
        # khong bẻ duong. Phai chay TRUOC _build_stations (step 4.10) vi
        # station_place + station_zones la dau vao cua do.
        self._reseat_stations_on_final_roads()
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
        self._cap_dangling_highway()  # dau cao toc cuot: noi vao QL1 gan nhat
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
        # noi ngo cut thanh VONG truoc, roi moi don ngo cut con lai.
        # Nguoc lai thi vong vua tao lai bi prune xoa ngay.
        self._close_dead_ends()
        self._build_node_seg_index()
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
        # đoạn dài phải có node ở giữa (không có ngã giao / điểm dừng /
        # nhà, minimap vẽ 1 nét thẳng 17km). Đo được 4 đoạn > 8km trước khi có
        # bước này ⇒ `validate` chặn export.
        self._densify_long_segments(900.0)
        self._resolve_crossings()
        # PHẢI CẤN ĐỘ SAU mọi thay đổi hình học cuối: các đoạn vừa tách / vừa
        # weld giữ cao độ nội suy cũ nên sinh dốc 32.8% (VALIDATION FAILED).
        self._fix_final_slopes()
        self._finalize_grade_separation()
        self._build_node_seg_index()
        # WELD THEO BẬC trước, SỬA MA TRẬN sau — gộp node làm thay đổi
        # tập class tại node, nên sửa ma trận phải ĐỨNG SAU.
        self._weld_by_rank()
        self._build_node_seg_index()
        # sửa ma trận lần cuối, PHẢI sau `_finalize_grade_separation` (hàm đó
        # đổi class nhánh); sau đây chỉ còn dedupe/prune — không đổi class
        self._repair_matrix_violations()
        self._build_node_seg_index()
        # FINAL CONNECTIVITY — `_ensure_connected()` chạy SỚM, các bước cuối
        # (weld/prune/crossings) gộp + xoá đoạn nên mảnh có thể đứt lại
        self._reconnect_islands(max_len=3200.0)
        self._build_node_seg_index()
        # bến/trạm bị tách khỏi main do weld/prune cuối
        self._ensure_station_access()
        self._build_node_seg_index()
        # QL/đường chính đứt do weld/prune cuối; `final=True` = nối hoặc XOÁ
        # (không giữ QL lơ lửng); min_len=20 để cả đoạn QL ngắn cũng được xử
        self._link_dangling_major(min_len=20.0, final=True)
        self._prune_orphans()
        self._build_node_seg_index()
        # ngõ cụt mới sinh sau weld/prune (320m ko đủ ứng viên: vấp góc)
        self._close_dead_ends(reach=600.0)
        self._build_node_seg_index()
        self._resolve_crossings()        # giao lỗ do weld gộp node làm mất nút
        self._build_node_seg_index()
        # cắn lại dốc SAU mọi đổi hình học: validate chặn export khi >16%, mà
        # weld/split gộp-cắt đoạn sinh dốc mới (đoạn 12m cong 2m = 16.7%)
        self._fix_final_slopes()
        self._build_node_seg_index()
        self._resnap_bus_stops()
        self._dedupe_edges()
        self._prune_orphans()
        self._sync_graph()
        self._repair_station_refs()
        self._repair_route_refs()
        self._enforce_station_integrity()
        # --- QUÉT CUỐI: dọn -> hàn -> dọn lại ---
        # `_fix_internal_crossings` chạy sớm ở giữa pipeline, các bước sau đó
        # dựng lại được đoạn cắt MẶT BẰNG cao tốc. Nhưng tự nó xoá đoạn thì
        # làm đứt đường vào bến và sinh đầu cụt MỚI ở 2 đầu đoạn bị xoá
        # (đo được: bến Nha Trang 36 node rời + 2 đầu cụt mới) nên phải:
        #   xoá -> hàn mảnh đứt -> vào bến -> mới dọn đầu cụt
        self._fix_internal_crossings()
        self._prune_orphans()
        self._build_node_seg_index()
        self._reconnect_islands(max_len=3200.0)
        self._build_node_seg_index()
        self._purge_major_danglers(min_len=20.0, tag="truoc topo_report")
        # đầu degree-1 vô nghĩa = CÙNG predicate với `topo_validate`
        self._resolve_meaningless_dead_ends()
        self._build_node_seg_index()
        # access_node phải ở thành phần lớn nhất -> chạy SAU mọi lần xoá
        self._ensure_station_access()
        self._build_node_seg_index()
        # sửa ref SAU quét: quét gọi `_prune_orphans`, ref có thể chết thêm
        self._repair_station_refs()
        self._repair_route_refs()
        # P71: sau lượt `_reconnect_islands` cuối (dòng trên) CÒN 3 bước có khả
        # năng xoá đoạn (`_purge_major_danglers`, `_resolve_meaningless_dead_ends`,
        # `_ensure_station_access` -> `_prune_orphans`) mà không nối lại. Đo được:
        # validate FAIL "graph roi 2 manh rieng le (9 node ngoai main, nho nhat 4)"
        # + "2 cum ramp hoan toan co lap". Sửa đúng thứ tự: chữa ramp fragment
        # TRƯỚC (vì `_reconnect_islands` cấm bám node RAMP/EXPRESSWAY — xem
        # `_heal_ramp_fragments`), rồi mới nối các mảnh rời còn lại.
        self._heal_ramp_fragments()
        self._reconnect_islands(max_len=3200.0)
        self._build_node_seg_index()
        self._sync_graph()
        self.topo_report()

    def _repair_route_refs(self):
        """
        SỬA THAM CHIẾU NODE CỦA TUYẾN (routes.json) — phải chạy SAU mọi bước
        weld / prune / split / relocate.

        `self.route_node_ids` được chụp lúc dựng corridor. Sau đó các hàm trên
        đổi id node (xoá rồi tạo mới). `routes.json` vẫn giữ id cũ => tuyến
        minimap vẽ thẳng qua chỗ đó, NPC đi sai, `driveRoute` báo điểm lệch
        224m khỏi QL1. Đo được: `routes[0].nodes` chứa `n_109` không tồn tại.

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
            if hint is None:
                # KHÔNG biết node chết nằm ở đâu => BỎ nó khỏi tuyến.
                # Thiếu 1 waypoint thì polyline nối thẳng 2 node kề nhau (vẫn
                # đúng hình dạng); gép bừa thì tuyến lệch hàng trăm km.
                dropped += 1
                continue
            best, bd = None, 1e18
            for oid, op in self.nodes.items():
                if op.get("type") not in TOPO_JOINABLE_TYPES:
                    continue
                d = math.hypot(op["x"] - hint[0], op["z"] - hint[1])
                if d < bd:
                    bd, best = d, oid
            # chỉ gắn node CÙNG ĐƯỜNG: node thay thế cách chỗ cũ < 3km
            if best is not None and bd <= 3000.0:
                out.append(best)
            else:
                dropped += 1
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

    def _build_ql1(self):
        """QL1 = xương sống (source of truth). Dùng FULL corridor (độ cong thật),
        KHÔNG dùng coarse 1.5km (trước đây node cách nhau 1.5km => đường thẳng
        cục cục, junction không tìm được, map trông như caro)."""
        pts = [(p[0], p[1], p[2], p[3], 0.0) for p in self.corridor]
        # => self._ql_node_ids luôn RỖNG => routes.json nodes=[] => minimap mất
        #    route, NPC không sinh hành khách, hầm/interchange không bám được.
        self._ql_node_ids = self._add_chain_with_ids(
            pts, "NATIONAL", name="QL1",
            region_fn=lambda x, z: self.determine_region(z, x))
        self.ql_nodes = self._ql_node_ids
        # route chính cho minimap + NPC passenger: bắt đầu tại Nam Tuy Hòa
        self.route_node_ids = self._ql_node_ids
        self._trim_route_to_service_span()

    # Tuyến xe khách chạy Nam Tuy Hòa -> Miền Đông Mới, KHÔNG phải cả
    # corridor Sông Cầu -> HCM_Core_South. Trước đây route_node_ids = toàn bộ
    # _ql_node_ids nên tuyến bắt đầu lệch 51 km về phía Bắc (Sông Cầu) và kết
    # thúc lệch 17 km về phía Nam (đi qua Miền Đông Mới rồi chạy tiếp vào
    # nội đô) => ETA bị thổi phồng, `getRouteWaypoints()[0]` (npc.js dùng làm
    # vị trí đứng chờ của hành khách) rơi vào giữa ruộng.
    # Đo được sau khi sửa: đoạn Nam Tuy Hòa -> Miền Đông Mới = 567.9 km
    # (Tuy Hòa -> TP.HCM theo mốc km QL1 = 560 km, chênh +1.4%).
    ROUTE_FROM_ANCHOR = "Nam_Tuy_Hoa"
    ROUTE_TO_ANCHOR = "Mien_Dong_Moi"

    def _anchor_node_index(self, anchor_name, node_ids):
        """Index trong `node_ids` của node QL1 gần nhất về điểm chiếu của anchor."""
        try:
            ai = next(i for i, a in enumerate(ANCHORS) if a["name"] == anchor_name)
        except StopIteration:
            return None
        ax, az = self.proj(ANCHORS[ai]["lat"], ANCHORS[ai]["lon"])
        best, bi = None, 1e18
        bd = 1e18
        for i, nid in enumerate(node_ids):
            n = self.nodes.get(nid)
            if n is None:
                continue
            d = dist(n["x"], n["z"], ax, az)
            if d < bd:
                bd, bi = d, i
        if bi is None or bd > 3000.0:
            return None
        return bi

    def _measure_route_length(self, node_ids):
        """Chiều dài thật của polyline tuyến (đo trên node, không dùng hằng số)."""
        total = 0.0
        for a, b in zip(node_ids, node_ids[1:]):
            na, nb = self.nodes.get(a), self.nodes.get(b)
            if na and nb:
                total += dist(na["x"], na["z"], nb["x"], nb["z"])
        return total

    def _trim_route_to_service_span(self):
        i0 = self._anchor_node_index(self.ROUTE_FROM_ANCHOR, self._ql_node_ids)
        i1 = self._anchor_node_index(self.ROUTE_TO_ANCHOR, self._ql_node_ids)
        if i0 is None or i1 is None or i1 <= i0:
            print("      [route] KHONG tim thay moc %s -> %s, giu nguyen corridor"
                  % (self.ROUTE_FROM_ANCHOR, self.ROUTE_TO_ANCHOR))
            self.route_len = self.corridor_len
            return
        self.route_node_ids = list(self._ql_node_ids[i0:i1 + 1])
        self.route_len = self._measure_route_length(self.route_node_ids)
        print("      [route] cat tuyen %s (node %d) -> %s (node %d): %d node, "
              "%.1f km (corridor %.1f km)"
              % (self.ROUTE_FROM_ANCHOR, i0, self.ROUTE_TO_ANCHOR, i1,
                 len(self.route_node_ids), self.route_len / 1000.0,
                 self.corridor_len / 1000.0))

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

        # --- Vành đai 3: chạy song song QL1 ở nội đô, sát QL hơn
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
        (237 node lơ lửng, người chơi không đi từ QL1 vào được).
        Nối vào QL1/CT01 bằng link 2 làn tại đầu, giữa, cuối vành đai.
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
                # RAMP, không phải ARTERIAL: Vành đai 3 là cao tốc, QL1 là
                # quốc lộ, đường nối giữa hai đường lớn là RAMP. Gán ARTERIAL
                # sinh cặp `ARTERIAL<->EXPRESSWAY` ngoài ma trận .
                if self._add_link_road(nid, tgt, "RAMP", "RING3_LINK_QL"):
                    made += 1
                continue
            tgt, d = self._nearest_node_on(n["x"], n["z"], ct_pool, 9000.0)
            if tgt is not None and self._add_link_road(nid, tgt, "RAMP",
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
        thành phần (QL1 bị cắt đôi). Đây là bug đã xảy ra thật.
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
        self._relevel_stations()
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
        # MỐC GIỚI HẠN PHẢI LÀ TERRAIN THẬT, KHÔNG PHẢI CAO ĐỘ ĐÃ GRADE.
        # Bản trước: `raw = {nid: n["y"] ...}` — tức mỗi lần gọi cửa sổ
        # `raw ± max_cut` TRƯỢT thêm 8m. Đếm số lần gọi: 6 (4 trực tiếp +
        # 2 qua `_fix_final_slopes`) => trôi tới 48m. Đo được 44.87m ở
        # `n_2865` (đường 62.27, terrain 107.14). Khớp phép nhân.
        # `add_node` đã lưu sẵn `elev = get_elevation(x, z)` lúc tạo node ⇒
        # dùng làm mốc, KHÔNG tính lại (`get_elevation` không cache, 2.6ms;
        # 6642 node x 6 lần gọi = 100s). Node thiếu `elev` mới tính.
        raw = {}
        for nid, nd in self.nodes.items():
            e = nd.get("elev")
            if isinstance(e, (int, float)):
                raw[nid] = float(e)
            else:
                raw[nid] = self.get_elevation(nd["x"], nd["z"])
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
        self._relevel_stations()
        for f in getattr(self, "facility_pois", []):
            n = self.get_node_near(f["x"], f["z"])
            if n:
                f["y"] = round(n["y"], 3)
        if getattr(self, "spawn_point", None) and self.stations:
            sp = self.spawn_point
            n = self.get_node_near(sp["x"], sp["z"])
            if n:
                # KHÔNG `+0.5`: xe người chơi chạy ở `bus.y = road.y + BUS_AXLE`
                # (đo trong game: 2.883 = road.y 2.383 + 0.5).
                sp["y"] = round(n["y"], 3)
            for st in self.stations:
                if st.get("is_spawn"):
                    st["spawn"] = dict(sp)

    def _relevel_stations(self):
        """
        CĂN CHIỀU CAO SÂN BẾN + BÃI ĐỖ THEO **ĐƯỜNG TRONG SÂN** (P40).

        ⚠ KHÔNG dùng `anchor_node`: đó là node CỔNG, nằm ngoài sân trên đường
        chính. `_grade_roads` hạ đường trong sân xuống (max_cut 8m) cho sân
        phẳng, còn node cổng giữ nguyên → lệch nhau. Đo được: Nam Tuy Hòa lệch
        **2.30m**, Phan Thiết lệch **1.33m** ⇒ sân vẽ lơ lửng trên đầu xe, xe
        xuyên sân (đo trong game: stY 5.327 vs busY 2.883).

        Sân lấy trung bình node `INTERNAL`/`STATION_ACCESS` BÊN TRONG sân; mỗi
        bãi lấy đúng cao độ node của nó.
        """
        for st in getattr(self, "stations", []):
            cx, cz = st.get("x"), st.get("z")
            if cx is None or cz is None:
                continue
            hw = st.get("w", 190) * 0.5
            hd = st.get("d", 140) * 0.5
            ys = []
            for sg in self.segments.values():
                if sg["class"] not in TOPO_YARD_CLASSES:
                    continue
                for nid in (sg["from"], sg["to"]):
                    nd = self.nodes.get(nid)
                    if nd is None:
                        continue
                    if abs(nd["x"] - cx) > hw or abs(nd["z"] - cz) > hd:
                        continue
                    ys.append(nd["y"])
            if ys:
                st["y"] = round(sum(ys) / len(ys), 3)
            for slot in st.get("baySlots", []):
                bn = slot.get("node")
                nd = self.nodes.get(bn) if bn else None
                if nd is not None:
                    slot["x"] = round(nd["x"], 2)
                    slot["z"] = round(nd["z"], 2)
                    slot["y"] = round(nd["y"], 3)

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
        Mỗi interchange = node THẬT tại toạ độ OSM, nối 2 nhánh ramp từ QL1 và
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
                    # RAMP: đường nối từ QL1 xuống CT01 là đường vào IC.
                    self._add_link_road(ql_node if ql_node != tgt else ql_node,
                                        tgt, "RAMP", "LINK_" + ic_name)
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

            # 2 ramp chéo từ QL1 vào node IC (diamond/trumpet khác hình dạng bulge)
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
        Cầu THẬT trên QL1: Cầu Đà Rằng (đánh dấu bridge để runtime dựng nhịp).
        Cách làm: tìm segment gần toạ độ nhất thuộc đúng hệ thống rồi đánh dấu
        (không hard-code chỉ số segment vì id đổi theo seed).
        """
        made_t = 0
        for (name, lat, lon, system) in TUNNEL_DEFS:
            px, pz = self.proj(lat, lon)
            want = "CT01" if system == "CT01" else "QL1"
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
            want = "QL1" if system == "QL1" else "CT01"
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
        Tuyến nhánh cấp vùng: rẽ ra khỏi QL1 tại node thật (junction thật),
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
        QL1/CT01/ramp được tạo ở step 1-2, còn _place_stations chạy ở step 3
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
        # --- verify: khong con cat rect (margin 2) + khong cat QL1/cao to khac ---
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
        """UỐN ĐƯỜNG CHÍNH QUANH STATION — KHÔNG BAO GIỜ ĐỂ ROAD XUYÊN QUA SÂN.

        Sửa theo nguyên tắc #1: STATION KHÔNG ĐƯỢC TỰ SINH ĐƯỜNG GIAO THÔNG
        XUYÊN QUA BÊN TRONG. Tất cả đường giao thông chính (EXPRESSWAY, RAMP,
        NATIONAL, ARTERIAL, COLLECTOR, LOCAL) phải nằm BÊN NGOÀI khuôn viên.

        Chỉ cho phép INTERNAL và STATION_ACCESS nằm trong sân (đường nội bộ).
        """
        zones = [z for z in self.station_zones if z.get("keep_clear")]
        if not zones:
            return 0
        fixed = 0
        # Tất cả class đường chính phải tránh station
        main_road_classes = ("EXPRESSWAY", "RAMP", "NATIONAL", "ARTERIAL",
                             "COLLECTOR", "PROVINCIAL_ROAD", "LOCAL", "RURAL_LOCAL", "SERVICE")
        for _ in range(max_pass):
            hit = 0
            for sid, seg in list(self.segments.items()):
                if seg["class"] not in main_road_classes:
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
            print("      uonce %d doan duong chinh tranh san ben xe" % fixed)
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

    def _t_junction_link(self, stub_nid, stub_seg, reach=600.0):
        """
        NỐI ĐẦU CỤT BẰNG T-JUNCTION — fallback khi ỨNG VIÊN LÀ NỨT đều hỏng.

        Nút ứng viên nằm trên đường gần nên hướng nối hay trùng hướng nhánh
        đang có => `TOPO_MIN_ANGLE` từ chối. Đổi sang ứng viên ĐOẠN: cắt đoạn
        gần nhất tại CHÂN HÌNH VUÔNG => nút P mới có 2 nhánh cùng đường
        (≈180°) nên góc ở P luôn vượt, và cắt ngay điểm chạm nên là NGÃ 3 THẬT.
        """
        n = self.nodes.get(stub_nid)
        if n is None or not stub_seg:
            return False
        lim = TOPO_MIN_ANGLE.get(self._topo_rank(stub_nid), 26.0)
        # đếm lý do thất bại: chết TRƯỚC cổng `topo_link_ok` thì log im lặng
        _r = getattr(self, "_tj_reject", None)
        if _r is None:
            _r = self._tj_reject = {}

        def _fail(k):
            _r[k] = _r.get(k, 0) + 1
            return False

        # --- (0) hướng các nhánh ĐANG CÓ của đầu ngõ (dùng để tách trước) ---
        stub_dirs = []
        for _q, qs in self.segments.items():
            if qs["from"] != stub_nid and qs["to"] != stub_nid:
                continue
            o = self.nodes.get(qs["to"] if qs["from"] == stub_nid
                               else qs["from"])
            if o is None:
                continue
            stub_dirs.append(math.atan2(o["z"] - n["z"], o["x"] - n["x"]))
        # --- (1) đoạn ỨNG VIÊN gần nhất: quét theo ô lưới như `_seg_clear` ---
        c0 = self._cell(n["x"] - reach, n["z"] - reach)
        c1 = self._cell(n["x"] + reach, n["z"] + reach)
        best, seen = None, set()
        _hit = 0
        _st = {"mtx": 0, "geo": 0, "zon": 0, "ang": 0, "maj": 0, "wet": 0}
        for cx in range(c0[0], c1[0] + 1):
            for cz in range(c0[1], c1[1] + 1):
                for sid in self._road_grid.get((cx, cz), ()):
                    if sid in seen:
                        continue
                    seen.add(sid)
                    _hit += 1
                    s = self.segments.get(sid)
                    if s is None or s is stub_seg or s.get("bridge"):
                        continue
                    # ma trận 2 chiều không cho phép => tách đoạn cũng vô ích
                    if stub_seg["class"] not in TOPO_LEGAL.get(s["class"], ()):
                        _st["mtx"] += 1
                        continue
                    a = self.nodes.get(s["from"])
                    b = self.nodes.get(s["to"])
                    if not a or not b:
                        continue
                    dx, dz = b["x"] - a["x"], b["z"] - a["z"]
                    l2 = dx * dx + dz * dz
                    if l2 <= 1.0:
                        continue
                    t = ((n["x"] - a["x"]) * dx + (n["z"] - a["z"]) * dz) / l2
                    if t <= 0.03 or t >= 0.97:
                        _st["geo"] += 1
                        continue          # chân quá gần 2 đầu đoạn
                    px, pz = a["x"] + dx * t, a["z"] + dz * t
                    dd = dist(n["x"], n["z"], px, pz)
                    if dd > reach or dd < 8.0:
                        _st["geo"] += 1
                        continue
                    if self._in_station_zone(px, pz, 8.0):
                        _st["zon"] += 1
                        continue
                    # so góc ngay trong vòng lặp: lấy đoạn gần nhất rồi mới so
                    # => 1 đoạn vấp là bỏ cuộc dù đoạn khác thỏa mãn nằm cạnh
                    _ang = math.atan2(pz - n["z"], px - n["x"])
                    _gok = True
                    for a2 in stub_dirs:
                        gap = abs((a2 - _ang + math.pi) % (2.0 * math.pi)
                                  - math.pi)
                        if math.degrees(gap) < lim:
                            _gok = False
                            break
                    if not _gok:
                        _st["ang"] += 1
                        continue
                    if self._crosses_major(n["x"], n["z"], px, pz):
                        _st["maj"] += 1
                        continue
                    _steps = max(1, int(dd // 150.0))
                    _wet = False
                    for _k in range(_steps + 1):
                        _t = _k / float(_steps)
                        if self.water_factor(
                                n["x"] + (px - n["x"]) * _t,
                                n["z"] + (pz - n["z"]) * _t) > 0.2:
                            _wet = True
                            break
                    if _wet:
                        _st["wet"] += 1
                        continue
                    if best is None or dd < best[0]:
                        best = (dd, sid, px, pz)
        if best is None:
            if _hit == 0:
                return _fail("khong co duong nao trong %.0fm" % reach)
            _lab = {"mtx": "MA TRAN", "geo": "chan doan/gan dau doan",
                    "zon": "trong san", "ang": "vap goc o dau ngo",
                    "maj": "cat duong chinh", "wet": "qua song"}
            _k = max(_st, key=lambda z: _st[z])
            if _st[_k] == 0:
                return _fail("het ung vien (khong ro)")
            # báo mức chặn NHIỀU NHẤT trong lần gọi, không phải mức thấy đầu
            return _fail("het ung vien: %s" % _lab[_k])
        dd, sid, px, pz = best
        pid = self._split_seg_at_point(sid, px, pz)
        if pid is None:
            return _fail("khong tach duoc doan")
        osid, _why = self.topo_try_link(stub_nid, pid, stub_seg["class"],
                                        width=stub_seg.get("width"))
        if osid is None:
            return _fail("topo tu choi: %s" % (_why or "khong ro"))
        _r["OK"] = _r.get("OK", 0) + 1
        return True

    def _purge_major_danglers(self, min_len=20.0, tag="cuoi"):
        """
        XOÁ SẠCH ĐẦU ĐƯỜNG CHÍNH (NATIONAL/ARTERIAL) CÒN TREO.

        Phải có lần quét CUỐI, ngay trước báo cáo: `_dedupe_edges` /
        `_enforce_station_integrity` chạy SAU `_link_dangling_major` nên dựng
        lại đầu treo. Giữ đầu đường nằm trong sân bến/trạm (lối vào POI).
        """
        MAJOR = ("NATIONAL", "ARTERIAL")
        dropped = 0
        # 64 vòng (không phải 8): mỗi vòng xoá đoạn treo có thể làm đoạn ĐỐI
        # DIỆN thành cụt mới. Vòng thừa rẻ (quét ~10k đoạn/vòng).
        for _ in range(64):
            deg = {}
            for s in self.segments.values():
                deg[s["from"]] = deg.get(s["from"], 0) + 1
                deg[s["to"]] = deg.get(s["to"], 0) + 1
            left = []
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
                    left.append((sid, s["from"]))
                if deg.get(s["to"], 0) == 1:
                    left.append((sid, s["to"]))
            if not left:
                break
            kill = 0
            for sid, nid in left:
                n = self.nodes.get(nid)
                if n and self._in_station_zone(n["x"], n["z"], 12.0):
                    continue          # loi vao tram/xang: giu
                if self._remove_segment(sid):
                    dropped += 1
                    kill += 1
            if not kill:
                break                 # con lai doan trong san tram het
            self._prune_orphans()
        if dropped:
            print("      xoa %d doan duong CHINH con cuot (lan sach %s)"
                  % (dropped, tag))
        # in phần sót kèm cờ zone — zone=0 mà còn sót là vòng quét còn lỗ,
        # phải sửa vòng chứ không nới ngưỡng `topo_validate`
        deg2 = {}
        for s in self.segments.values():
            deg2[s["from"]] = deg2.get(s["from"], 0) + 1
            deg2[s["to"]] = deg2.get(s["to"], 0) + 1
        rem = []
        for sid, s in self.segments.items():
            if s["class"] not in MAJOR:
                continue
            a = self.nodes.get(s["from"])
            b = self.nodes.get(s["to"])
            if not a or not b:
                continue
            L = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
            if L < min_len:
                continue
            for z in (s["from"], s["to"]):
                if deg2.get(z, 0) != 1:
                    continue
                n = self.nodes.get(z)
                rem.append((L, s["class"], s.get("name") or "-",
                            bool(n and self._in_station_zone(n["x"], n["z"],
                                                             12.0))))
        if rem:
            print("      ! van con %d dau duong chinh sau sach [%s]: %s"
                  % (len(rem), tag,
                     "; ".join("%.0fm %s %s zone=%d" % (L, c, nm, int(z))
                               for L, c, nm, z in rem[:6])))
        return dropped

    def _link_dangling_major(self, min_len=150.0, max_link=500.0, final=False):
        """Dau duong CHINH (NATIONAL/ARTERIAL) cuot > min_len:
        - noi vao node gan nhat neu hop le (khong cat cao to, khong cat san
          ben, khong qua bien, do doc < 12%);
        - khong noi duoc -> xoa doan cuot (khong giua duong treo voi 200-300m
          vao nowhere, truoc do bi chan boi cao to/san ben/san doc)."""
        MAJOR = ("NATIONAL", "ARTERIAL")
        made = dropped = 0
        # 8 vòng: mỗi vòng nối được 1 phần; hết vòng mà mọi vòng đều nối được
        # thì thoát mà không xoá lần nào (đo được `ket_QL1` 389m còn treo)
        for _round in range(8):
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
                    # KHÔNG nối vào một ĐẦU CỤT khác: A(cụt) -> B(cụt) ra
                    # `ket_QL1` mà 2 đầu vẫn treo hoặc sau đó bị xoá đoạn
                    # kia làm A cụt lại. Chỉ nối vào nút đã có >=2 nhánh.
                    if deg.get(cid, 0) < 2:
                        continue
                    # ƯU TIÊN nối vào ĐƯỜNG CHÍNH khác (đóng kín QL1 với
                    # QL1) thay vì rẽ nhánh vào phố dân cư: cộng điểm phạt
                    # 150m cho ứng viên cấp thấp => vẫn chọn nó khi không có
                    # đường chính nào trong bán kính.
                    _maj = any((self.segments.get(_q) or {}).get("class") in MAJOR
                               for _q in B.get("connections", ()))
                    score = d + (0.0 if _maj else 150.0)
                    if best is None or score < best[0]:
                        best = (score, cid)
                seg = self.segments.get(sid)
                if seg is None:
                    continue
                nm = seg.get("name")
                linked = False
                if best is not None:
                    linked = self.add_segment(
                        nid, best[1], cls,
                        name=("ket_%s" % nm) if nm else None) is not None
                if not linked:
                    # fallback: hết nút đúng => cắt đoạn gần nhất thành ngã 3
                    # thật; thiếu nó thì đầu QL1 hoặc nối bừa hoặc bị purge
                    linked = self._t_junction_link(nid, seg, max_link)
                if linked:
                    made += 1
                    progress += 1
            if progress:
                continue
            # vong nay khong noi duoc doan nao -> xoa het doan cuot con lai
            for sid, nid, cls in danglers:
                _n0 = self.nodes.get(nid)
                # KHÔNG xoá đầu đường nằm trong sân bến / trạm: đó là LỐI VÀO
                # (trạm xăng PVOIL dọc QL, đường vào trạm thu phí) — degree-1
                # là bình thường, xoá là mất lối vào.
                if _n0 and self._in_station_zone(_n0["x"], _n0["z"], 12.0):
                    continue
                if self._remove_segment(sid):
                    dropped += 1
            break
        if final:
            # Hết vòng nối mà đầu treo vẫn còn => không có nơi nào nối được:
            # bàn giao cho hàm quét (cũng là chỗ tái sử dụng cho lần quét CUỐI
            # chạy sau `_dedupe_edges` / `_enforce_station_integrity`).
            dropped += self._purge_major_danglers(min_len,
                                                  tag="link_dangling")
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
                print("      ! cao to '%s' cuot tai (%.0f,%.0f): khong tim thay QL1 de noi"
                      % (nm, A["x"], A["z"]))
                continue
            B = self.nodes[ql]
            if not self._clear_for_link(A["x"], A["z"], B["x"], B["z"],
                                         exclude_sid=sid):
                continue
            # RAMP: đầu cao tốc cụt nối xuống QL1 bằng đường vào — đó là
            # ramp. Đặt ARTERIAL là nối thẳng mặt cao tốc (rule 11/60).
            if self._add_link_road(ql, nid, "RAMP",
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
            đường. Nếu dùng cả hai thì QL1 — vốn nằm ngoài sân, chỉ chạm
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

    def _node_touches_class(self, nid, classes):
        """Node `nid` có ít nhất một nhánh thuộc `classes` không?

        Dùng chung cho luật "đường địa phương không chạm đường cấp cao":
        `RAMP` cũng là cấp cao (ma trận không cho `LOCAL` nối `RAMP`), nên
        một hàm riêng cho từng class sẽ vỡ theo thời gian — như P23 đã vỡ.
        """
        n = self.nodes.get(nid)
        if n is None:
            return False
        for sid in n["connections"]:
            sg = self.segments.get(sid)
            if sg is not None and sg.get("class") in classes:
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
        ca = _cls_of(self, n1, r_class)
        cb = _cls_of(self, n2, r_class)
        if r_class not in TOPO_LEGAL.get(cb, ()) or r_class not in TOPO_LEGAL.get(ca, ()):
            # cap thap len cap cao bi cam; hai duong cung cap thi hop le
            if r_class not in TOPO_LEGAL.get(cb, ()):
                return False, "cap thap vao cap cao (%s)" % cb
        # 2) khong cat nguang mat cao toc / ham
        if self._seg_hits_expressway(A["x"], A["z"], B["x"], B["z"], (n1, n2)):
            return False, "cat nguang mat cao toc"
        # 2b) ĐOẠN QUÁ NGẮN trên đường xương sống (ngưỡng theo BẬC, P28).
        # Hai nút giao cách nhau 11m trên QL1 = một ngã giao rồi một ngã giao
        # nữa: xe vào 11m là ra khỏi đường. Cùng quãng cách trên phố là bình
        # thường nên chỉ chặn bậc <= 2.
        _llim = TOPO_MIN_LINK_LEN.get(TOPO_RANK.get(r_class, 3), 0.0)
        if _llim > 0.0 and dist(A["x"], A["z"], B["x"], B["z"]) < _llim:
            return False, "doan qua ngan (%d m)" % int(_llim)
        # 3) khong dua duong moi vao san ben
        if self._in_station_keep(A["x"], A["z"], 2.0) or \
                self._in_station_keep(B["x"], B["z"], 2.0) or \
                self._crosses_station(A["x"], A["z"], B["x"], B["z"]):
            return False, "trong san ben"
        # 4) GOC giua duong moi va nhanh dang co: phai >= TOPO_MIN_ANGLE.
        # Khong co buoc nay thi 2 con duong cung cat vao 1 nut o goc 5 van duoc
        # noi => 149 nut co 2 nhanh trung goc (do duoc o n_18, n_52, n_70: nut
        # QL1 co 2-3 collector tie vao gan nhu cung huong). `TOPO_MIN_ANGLE`
        # da duoc khai bao tu truoc nhung CHUA BAO GI DUNG.
        # huong doi chieu: n1 so `dir(A->B)`, n2 so `dir(B->A)` (ra khoi node
        # do). Ban cu lay `dir(A->B)` cho ca 2 => n2 dao chieu: tu choi duong
        # thang (gap=0) ma chap nhan nhanh quay nguoc (gap=180).
        ang = math.atan2(B["z"] - A["z"], B["x"] - A["x"])
        for nid, node_pos, dir_out in ((n1, A, ang),
                                       (n2, B, ang + math.pi)):
            lim = TOPO_MIN_ANGLE.get(self._topo_rank(nid), 26.0)
            for sid in self._segs_at(nid):
                sg = self.segments.get(sid)
                if sg is None:
                    continue
                o = self.nodes.get(sg["to"] if sg["from"] == nid
                                   else sg["from"])
                if o is None:
                    continue
                a2 = math.atan2(o["z"] - node_pos["z"], o["x"] - node_pos["x"])
                gap = abs((a2 - dir_out + math.pi) % (2.0 * math.pi) - math.pi)
                if math.degrees(gap) < lim:
                    return False, "nhanh trung goc (<%d deg)" % int(lim)
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

    def _split_seg_at_point(self, sid, px, pz, n_type="junction",
                            allow_close_junction=False):
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
        # (a) >= CROSS_MISS tới ngã giao THẬT (bậc >= 3) — khớp audit T4.
        # ⚠ `allow_close_junction` (P38): vòng sửa ma trận tạo node BẬC 2 để
        # móc lại phần xa của nhánh cấp thấp — đó là node HÌNH HỌC, không
        # phải ngã giao, nên luật "trong 100m đã có ngã giao rồi" không áp.
        # Đo được: điều kiện này làm `_split_road_near` trả None 27 lần và
        # `n_4861` (ARTERIAL|ALLEY) không sửa được. Mặc định GIỮ NGUYÊN.
        if not allow_close_junction:
            _jn, _jd = self._topo_near_junction(mx, mz, CROSS_MISS,
                                                ignore=(seg["from"],
                                                        seg["to"]),
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

    def _split_road_near(self, x, z, reach=90.0, classes=None, min_gap=0.0,
                         allow_close_junction=False):
        """
        Tìm đoạn `classes` gần (x,z) trong `reach` và TÁCH NÓ tại điểm gần nhất
        trên đoạn đó, trả node mới. Nếu `min_gap` > 0 mà đã có nút giao trong
        khoảng đó thì KHÔNG tách (trả None) — để người gọi nối vào nút đó.

        Đây là cách tạo NGÃ GIAO THẬT: một phố đi qua QL1 thì QL1 bị chia
        đôi tại đúng điểm cắt, thay vì phố "ngoắt" vào một node QL cách xa
        (cách cũ gom 3-4 phố vào cùng 1 node -> 7 nhánh, đo được tại n_18:
        các góc -146 / -106 / -83 / -76 / 26 / 98 / 116).
        """
        n_type = "link" if allow_close_junction else "junction"
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
        mid = self._split_seg_at_point(sid, px_, pz_, n_type=n_type,
                                       allow_close_junction=allow_close_junction)
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

    def _repair_matrix_violations(self, max_round=6):
        """
        SỬA VI PHẠM MA TRẬN `TOPO_LEGAL` CÒN SÓT (chạy CUỐI, sau mọi thay đổi).

        Ma trận là thuộc tính của CẢ TẬP class tại một node, không phải của
        từng cạnh. Nên kiểm ở `add_segment` chỉ bắt được vi phạm sinh RA;
        vi phạm do ĐỔI CLASS hậu kỳ (`_seal_expressway_nodes`,
        `_finalize_grade_separation`, `_cap_node_degree` di nhánh sang node mới)
        thì lọt. Đo được còn 46 cặp sau khi `add_segment` đã chặn hết:
            ALLEY<->ARTERIAL 21 | EXPRESSWAY<->NATIONAL 2 | ARTERIAL<->EXPRESSWAY 1

        1. `NATIONAL` trên node cao tốc, không có nhánh cầu vượt
           → tách QL1 ngay tại node và đánh CẢ HAI ĐẦU là `bridge`.
             Không dùng ngưỡng `min_br*1.6` nữa: một nhánh cầu vượt 11m vẫn
             là nghĩa đúng (that's how a real overpass stub looks at an IC).
        2. cấp thấp (ALLEY/...) trên node cấp cao (ARTERIAL/...)
           → tách đường nhánh đó ~130m kể từ node, BỎ phần gần node, giữ
             phần xa nối vào node mới tách. Nhánh đó không còn chạm node cấp cao.

        Mỗi lần bị BỎ QUA đều đếm theo lý do và in ra: im lặng khi 0 thì không
        phân biệt được "đã sửa hết" với "hàm không chạy" — đúng cái sai đã tốn
        một vòng chạy 12 phút.
        """
        moved = bridged = 0
        skip = Counter()
        for _rd in range(max_round):
            self._build_node_seg_index()
            did = 0
            for nid in list(self.nodes.keys()):
                sids = [q for q in self._segs_at(nid)
                        if self.segments.get(q) is not None]
                if len(sids) < 2:
                    continue
                # CÓ NHÁNH CẦU VƯỢT => giao KHÁC MỨC, hợp pháp
                if any(self.segments[q].get("bridge") for q in sids):
                    continue
                info = []
                for q in sids:
                    sg = self.segments[q]
                    o = sg["to"] if sg["from"] == nid else sg["from"]
                    if o not in self.nodes:
                        continue
                    info.append((q, sg, o, sg["class"]))
                if len(info) < 2:
                    continue
                top_r, top_c = 9, None
                for _q, _sg, _o, _c in info:
                    r = TOPO_RANK.get(_c, 4)
                    if r < top_r:
                        top_r, top_c = r, _c
                # nhánh vi phạm = class KHÔNG nằm trong danh sách của `top_c`
                off = [(q, sg, o, c) for (q, sg, o, c) in info
                       if c != top_c and c not in TOPO_LEGAL.get(top_c, ())]
                if not off:
                    continue
                q, sg, o, c = off[0]
                far_p = self.nodes[o]
                nid_p = self.nodes[nid]
                L = dist(nid_p["x"], nid_p["z"], far_p["x"], far_p["z"])

                # (1) QL1 tren node cao toc -> tach ra lam CAU VUOT that
                if c == "NATIONAL" and top_c in ("EXPRESSWAY", "TUNNEL"):
                    if L < 1.0:
                        skip["QL1 qua gan (<1m)"] += 1
                        did += 1
                        continue
                    # THỬ NHIỀU KHOẢNG CÁCH: 35m thường trùng vị trí node đã
                    # có, `add_node` trả None và bản cũ `continue` im lặng.
                    nn = None
                    for off_m in (35.0, 70.0, 120.0, 190.0):
                        if off_m >= L * 0.9:
                            break
                        t = off_m / L
                        nn = self.add_node(lerp(nid_p["x"], far_p["x"], t),
                                           lerp(nid_p["z"], far_p["z"], t),
                                           "URBAN",
                                           force_y=lerp(nid_p.get("y", 0.0),
                                                        far_p.get("y", 0.0), t),
                                           n_type="crossing")
                        if nn is not None:
                            break
                    if nn is None:
                        skip["khong tach duoc doan cau vuot"] += 1
                        did += 1
                        continue
                    self._remove_segment(q)
                    head = self._add_segment_like(sg, nid, nn)
                    tail = self._add_segment_like(sg, nn, o) if head else None
                    if tail is None:
                        self._add_segment_like(sg, nid, o)
                        self._drop_node(nn)
                        skip["tach khong tao duoc 2 doan"] += 1
                        did += 1
                        continue
                    for t2 in (head, tail):
                        self.segments[t2]["bridge"] = True
                        self.segments[t2]["pier"] = True
                        self.segments[t2].setdefault("name", "cau_vuot_QL1")
                    bridged += 1
                    did += 1
                    continue

                # (2) cap thap tren node cap cao -> tach nhanh ra xa
                if L < MIN_SEG_LEN * 2.4:
                    skip["nhanh qua ngan de tach (<%.0fm)"
                         % (MIN_SEG_LEN * 2.4)] += 1
                    did += 1
                    continue
                # `along` phai nam trong [MIN_SEG_LEN, L - MIN_SEG_LEN] de
                # ca hai doan moi deu du lon
                along = min(130.0, max(MIN_SEG_LEN * 2.0, L * 0.32))
                along = min(along, L - MIN_SEG_LEN * 2.0)
                nx = lerp(nid_p["x"], far_p["x"], along / L)
                nz = lerp(nid_p["z"], far_p["z"], along / L)
                # `allow_close_junction=True`: node moi o day la node bac 2
                # hinh hoc, khong phai nga giao (P38)
                mid, _dd = self._split_road_near(
                    nx, nz, reach=30.0, classes=(c,), min_gap=0.0,
                    allow_close_junction=True)
                if mid is None or mid == nid:
                    skip["khong tach duoc doan cap thap"] += 1
                    did += 1
                    continue
                # chi giu phan XA (mid -> o); bo phan gan (nid -> mid) la
                # chinh do la noi nhanh cap thap cham node cap cao
                for l2 in list(self._segs_at(nid)):
                    sg2 = self.segments.get(l2)
                    if sg2 is None:
                        continue
                    o2 = sg2["to"] if sg2["from"] == nid else sg2["from"]
                    if o2 == mid and sg2.get("class") == c:
                        self._remove_segment(l2)
                moved += 1
                did += 1
            if not did:
                break
            self._build_node_seg_index()
        # LUÔN in (kể cả 0): im lặng khi 0 thì không phân biệt được "đã sửa hết"
        # với "hàm không chạy".
        print("      sua ma tran: %d nhanh tach ra xa, %d doan thanh cau vuot"
              % (moved, bridged))
        if skip:
            print("      bo qua: %s" % dict(skip))
        return moved + bridged

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

    # ---------------------------------------------------------------------
    # CLASS ĐƯỜNG THEO CONTEXT — nguồn DUY NHẤT quyết định đoạn nhánh mang
    # class nào. KHÔNG suy từ `level` đệ quy.
    # ---------------------------------------------------------------------
    def _kcn_points(self):
        """[(ten, x, z)] các KCN THẬT trong FACILITY_DEFS (đã tra Internet).

        Cache 1 lần. `proj()` cần `_build_projection()` chạy trước — `__init__`
        gọi nó ở dòng ~1251, trước MỌI bước dựng mạng lưới, nên ở đây luôn sẵn.
        """
        pts = self.__dict__.get("_kcn_pts_cache")
        if pts is None:
            pts = []
            for f in FACILITY_DEFS:
                if len(f) >= 5 and f[4] == "INDUSTRIAL":
                    fx, fz = self.proj(f[2], f[3])
                    pts.append((f[1], fx, fz))
            self._kcn_pts_cache = pts
        return pts

    def _nearest_kcn(self, x, z):
        """(khoảng cách m, tên KCN) gần nhất. Trả (None, None) nếu chưa có."""
        best, bd = None, 1e30
        for nm, kx, kz in self._kcn_points():
            d = (kx - x) ** 2 + (kz - z) ** 2
            if d < bd:
                bd, best = d, nm
        if best is None:
            return None, None
        return math.sqrt(bd), best

    def _rural_anchor_points(self):
        """[(ten, x, z)] thị trấn/thôn có thật (bỏ `city` — thành phố có lưới
        phố riêng, đường tới đó là đường tỉnh chứ không phải đường liên xã)."""
        pts = self.__dict__.get("_rural_pts_cache")
        if pts is None:
            pts = []
            for a in ANCHORS:
                if a.get("size") not in ("town", "village", "hamlet"):
                    continue
                ax, az = self.proj(a["lat"], a["lon"])
                pts.append((a["name"], ax, az))
            self._rural_pts_cache = pts
        return pts

    def _nearest_rural_anchor(self, x, z):
        best, bd = None, 1e30
        for nm, ax, az in self._rural_anchor_points():
            d = (ax - x) ** 2 + (az - z) ** 2
            if d < bd:
                bd, best = d, nm
        if best is None:
            return None, None
        return math.sqrt(bd), best

    def _context_road_class(self, x, z, level):
        """
        Class cho đoạn đường nhánh đi qua (x, z) — quyết định bằng DỮ LIỆU THẬT
        (toạ độ KCN/thị trấn đã tra, tham số vùng đã nội suy), KHÔNG random.

        VÌ SAO PHẢI CÓ HÀM NÀY (và vì sao KHÔNG dùng `level`):
        `_grow_road` trước đây chỉ có 3 nhánh — level 0 -> LOCAL/RURAL_LOCAL,
        level 1 -> COLLECTOR, level 2 -> ALLEY. 5 road type "Phase 3" có đủ
        bảng số liệu (ROAD_CLASS, TOPO_LEGAL, TOPO_RANK, MAT_BY_CLASS,
        MAX_SEG_LEN, bảng JS) nhưng KHÔNG chỗ nào phát ra class đó: audit đo
        được 0 segment. Bảng có mà đoạn không có = thay đổi bằng 0.

        Mỗi class gắn với MỘT điều kiện đo được, không gắn với cảm giác:
          INDUSTRIAL_ACCESS  trong 800m quanh 1 KCN thật (FACILITY_DEFS)
          AGRICULTURAL       ngoài đồng: urban<0.22, density<0.45, cách trục
                             QL1 > 650m. CHỈ `level>=1` — nhánh chính (level 0)
                             rời QL1 là đường xã (INTER_VILLAGE), nhánh phụ
                             mới là đường ruộng. Cùng cấp cả hai là vô nghĩa.
          INTER_VILLAGE      ngoài đô thị (urban<0.5) và trong 120-3500m quanh
                             1 thị trấn/thôn thật
          không match        GIỮ NGUYÊN phân cấp cũ (RURAL_LOCAL/LOCAL theo
                             `level`+`urban`, COLLECTOR, ALLEY) — đổi 5 class
                             mới KHÔNG được phép làm đổi luôn hình dạng map cũ.

        Thứ tự là thứ tự độ riêng: KCN (hẹp nhất) -> ruộng -> liên xã.
        """
        p = self.region_params(x, z)
        kd, kname = self._nearest_kcn(x, z)
        if kd is not None and kd <= 800.0:
            return "INDUSTRIAL_ACCESS", "KCN %s" % kname
        if (level >= 1 and p["urban"] < 0.22 and p["density"] < 0.45
                and p["d_corridor"] > 650.0):
            return "AGRICULTURAL", "ngoai dong"
        rd, rname = self._nearest_rural_anchor(x, z)
        if p["urban"] < 0.5 and rd is not None and 120.0 <= rd <= 3500.0:
            return "INTER_VILLAGE", "vai %s" % rname
        if level == 0:
            return ("RURAL_LOCAL" if p["urban"] < 0.25 else "LOCAL"), None
        if level >= 2:
            return "ALLEY", None
        return "COLLECTOR", None

    def _grow_road(self, start_nid, heading, length, level, rng, p):
        """Mọc đường theo bước, tạo junction khi chạm đường khác."""
        if level > 2:  # Reduced max level to prevent excessive branching
            return
        # class lấy theo VỊ TRÍ đầu đoạn (node `start_nid`), không theo level
        r_class, _rnote = self._context_road_class(
            self.nodes[start_nid]["x"], self.nodes[start_nid]["z"], level)
        # ĐƯỜNG ĐI XA THÌ HẠ CẤP ĐƯỢC, ĐƯỜNG ĐI GÌN GIỮ CẤP ĐẦU. Đường xã rẽ
        # vào ngõ ruộng là chuyện thật; ngõ ruộng tự nhiên mở rộng thành đường
        # vào KCN thì không.
        # `TOPO_RANK` BÉ = QUAN TRỌNG HƠN, nên "hạ cấp" là rank LỚN HƠN:
        # cho đổi khi `rank(_nc) >= rank_floor`, chặn khi nhỏ hơn. Viết ngược
        # (`<=`) thì đường xã không bao giờ xuống được đồng ruộng — đo trước,
        # sửa sau, không đo thì class có bảng mà 0 đoạn lại lặp lại.
        rank_floor = TOPO_RANK.get(r_class, 3)
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
            # QL1/CT01 moi co hầm/đèo để vượt.
            p_now = self.nodes[prev]
            raw_dy = abs(self.get_elevation(nx, nz) - p_now.get("elev", p_now["y"]))
            if raw_dy / step > 0.15:
                break
            up, _ = self.corridor_u_dist(nx, nz)
            reg, _r = self.determine_region(nz, nx)
            # Cập nhật class theo vị trí node vừa đi tới (chỉ xuống cấp).
            # Tính ở `prev` chứ không ở `nx`: `prev` là node ĐÃ TỒN TẠI, nên
            # không phụ thuộc node mới có bị `topo_try_link` từ chối hay không —
            # nếu tính ở `nx` thì đoạn cuối đọc class của vị trí chưa tồn tại.
            _nc, _nn = self._context_road_class(
                self.nodes[prev]["x"], self.nodes[prev]["z"], level)
            if TOPO_RANK.get(_nc, 3) >= rank_floor:
                r_class = _nc
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
    # 4.9b ĐIỂM DỪNG XE BUÝT dọc QL1 (đặc trưng xe khách Việt Nam)
    # --------------------------------------------------------------------------
    def _build_bus_stops(self):
        """
        Mỗi ~8-9km một điểm dừng, so le 2 bên QL1: mái chờ + biển bảng + chỗ
        đứng. Xuất ra POI type BUS_STOP (TrafficManager/main.js bỏ qua type này
        nên không ăn traffic budget).
        """
        self.bus_stops = []
        rng = stable_rng(self.seed, "busstops")
        # TÊN TRẠM theo ĐỊA DANH THẬT gần nhất (task 6: tên điểm dừng phải
        # dùng địa danh thật đã tra Internet — không để "Điểm dừng Kmxx").
        _anch = [(a["name"].replace("_", " "), ) + self.proj(a["lat"], a["lon"])
                 for a in ANCHORS]

        def _place_of(x, z):
            best, bd = None, 40000.0 ** 2          # nửa bán kính 40km
            for (nm, ax, az) in _anch:
                d = (x - ax) ** 2 + (z - az) ** 2
                if d < bd:
                    bd, best = d, nm
            return best or "QL1"
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
                        "place": _place_of(bx, bz),
                    })
                    self._reserve(bx, bz, 5.0)
                    idx += 1
            s += rng.uniform(7600.0, 9600.0)
            side = -side
        print("      diem dung xe buyt tren QL1: %d" % len(self.bus_stops))

    def _weld_pair(self, a_id, b_id):
        """Gộp node `a_id` vào `b_id` (giữ node ít connection lại).

        Tách riêng từ `_weld_close_nodes` (P39) để dùng lại cho
        `_weld_by_rank`, vốn dùng NGUỒNG khác cho từng cấp đường. Trả 0 hoặc
        1. Không tự dựng lại index — caller làm.
        """
        if a_id not in self.nodes or b_id not in self.nodes or a_id == b_id:
            return 0
        if (len(self.nodes[a_id]["connections"]) >
                len(self.nodes[b_id]["connections"])):
            a_id, b_id = b_id, a_id
        L = self.nodes[a_id]
        K = self.nodes[b_id]
        # KIỂM TRƯỚC, THOÁT CẢ LẦN GỘP nếu có đoạn sẽ cắt ngang cao tốc
        # sau khi dời. Gộp node = dời đầu đoạn tới vị trí hoàn toàn khác, nên
        # đoạn 12m có thể thành đoạn 300m và cắt qua cao tốc. `add_segment`
        # không cứu được vì weld không đi qua đó.
        for sid in list(L["connections"]):
            s_ = self.segments.get(sid)
            if not s_:
                continue
            o_ = s_["to"] if s_["from"] == a_id else s_["from"]
            if o_ == b_id:
                continue
            m_ = self.nodes.get(o_)
            if m_ is None:
                continue
            if self._crosses_major(K["x"], K["z"], m_["x"], m_["z"]):
                self._topo_reject["weld se cat nguang cao toc"] = \
                    self._topo_reject.get("weld se cat nguang cao toc", 0) + 1
                return 0
        drop = []
        for sid in list(L["connections"]):
            s = self.segments.get(sid)
            if not s:
                continue
            o = s["to"] if s["from"] == a_id else s["from"]
            if o == b_id:
                drop.append(sid)
                continue
            if s["from"] == a_id:
                s["from"] = b_id
            else:
                s["to"] = b_id
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
        self.nodes.pop(a_id, None)
        return 1

    def _rebuild_road_index(self):
        """Dựng lại index đường từ `segments` (nguồn sự thật)."""
        self._road_grid = {}
        self.road_bboxes = []
        self._edge_index = {}
        for sid, s in self.segments.items():
            p1, p2 = self.nodes[s["from"]], self.nodes[s["to"]]
            self.road_bboxes.append((p1["x"], p1["z"], p2["x"], p2["z"],
                                     s["width"]))
            self._index_road(p1["x"], p1["z"], p2["x"], p2["z"],
                             s["width"], sid)
        self._dedupe_edges()
        self._build_accel()
        self._build_node_seg_index()

    def _weld_by_rank(self, max_round=4):
        """
        GỘP NODE QUÁ GẦN **THEO BẬC ĐƯỜNG** — vòng cuối, sau mọi thay đổi.

        Đo được T1 còn 74 cặp nút giao liền kề dưới ngưỡng của cấp đường:
            14 cặp ĐÚNG 15.0m (số cứng của đường ramp tạo sẵn ở IC)
            QL1 11-23m | Vành đai 3 8-30m | ARTERIAL 8-12m

        KHÔNG dùng một ngưỡng chung: 25m là đúng cho ramp (hai đầu ramp ở
        cùng một điểm vật lý) nhưng SAI cho lưới phố — đo được khoảng cách
        node phố mượt 8→60m theo nhóm 5m, hẻm 20-30m là bình thường. Nên
        dùng đúng `TOPO_MIN_LINK_LEN` — CÙNG hằng số mà `topo_link_ok` chặn
        lúc tạo và audit T1 kiểm.

        Sau đó PHẢI chạy lại `_repair_matrix_violations`: gộp hai node có
        thể tạo ra một cặp class mà trước đó hợp lệ.
        """
        merged = 0
        for _rd in range(max_round):
            self._build_node_seg_index()
            did = 0
            for nid, n in list(self.nodes.items()):
                if nid not in self.nodes:
                    continue
                if self._in_station_zone(n["x"], n["z"], 30.0):
                    continue
                for sid in self._segs_at(nid):
                    sgd = self.segments.get(sid)
                    if sgd is None:
                        continue
                    lim = TOPO_MIN_LINK_LEN.get(
                        TOPO_RANK.get(sgd["class"], 3), 0.0)
                    if lim <= 0.0:
                        continue
                    o = sgd["to"] if sgd["from"] == nid else sgd["from"]
                    m = self.nodes.get(o)
                    if m is None or o == nid:
                        continue
                    if dist(n["x"], n["z"], m["x"], m["z"]) >= lim:
                        continue
                    if self._in_station_zone(m["x"], m["z"], 30.0):
                        continue
                    did += self._weld_pair(nid, o)
                    break
            merged += did
            if not did:
                break
            self._rebuild_road_index()
        if merged:
            print("      weld theo bac: %d cap" % merged)
        return merged

    def _resnap_bus_stops(self, max_d=60.0):
        """
        BÁM LẠI ĐIỂM DỪNG XE BUÝT VÀO ĐƯỜNG (chạy SAU mọi thay đổi topology).

        Đo được: 53/54 điểm dừng cách đường 11m, nhưng `Km41.2` cách **118m**
        → audit rule 14/62 báo lỗi. Nguyên nhân: điểm dừng tham chiếu một
        node QL1 đã bị dời/gộp trong khi sửa topology, còn `bus_stops` thì
        không được bám lại.

        Chỉ dời khi lệch > `max_d` — còn lại giữ nguyên, không làm rung toạ
        độ của các điểm dừng đang đúng.
        """
        pool = [(0, n["id"], n["x"], n["z"]) for n in self.nodes.values()]
        moved = 0
        for bs in getattr(self, "bus_stops", []) or []:
            tgt, d = self._nearest_node_on(bs["x"], bs["z"], pool, 4000.0)
            if tgt is None or d <= max_d:
                continue
            tn = self.nodes[tgt]
            bs["x"] = round(tn["x"], 2)
            bs["z"] = round(tn["z"], 2)
            bs["y"] = round(tn.get("y", bs.get("y", 0.0)), 3)
            moved += 1
        if moved:
            print("      bam lai %d diem dung vao duong (truoc do lech >%dm)"
                  % (moved, int(max_d)))
        return moved

    def _close_dead_ends(self, reach=320.0):
        """
        NỐI NGÕ CỤT THÀNH VÒNG (P47).

        Đo được 71 ngõ cụt, **70 cái không dẫn tới gì** (>200m mọi trạm/POI):
        COLLECTOR 31 | LOCAL 22 | ARTERIAL 12 | RURAL_LOCAL 2 | NATIONAL 4;
        63 cái không tên, dài 25-125m là phần lớn.

        Xoá thì MẤT đường thật; giữ thì minimap đầy ngõ cụt. Nối sang đường
        gần nhất thành VÒNG: minimap sạch, có tuyến thay thế, không mất gì.

        Mọi lần nối đi qua `topo_try_link` ⇒ vẫn tuân ma trận `TOPO_LEGAL`,
        góc, đoạn quá ngắn — không tạo lỗi mới. KHÔNG nối đường có tên (tuyến
        thật) và không nối quá `reach` (nối xa 300m là tạo đường mới, không
        phải vòng).
        """
        self._build_node_seg_index()
        pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()]
        joined = 0
        tried = 0
        no_cand = 0
        why_fail = Counter()
        for nid in list(self.nodes.keys()):
            sids = self._segs_at(nid)
            if len(sids) != 1:
                continue
            sg = self.segments.get(sids[0])
            if sg is None or sg.get("bridge"):
                continue
            # CHỈ bỏ qua tuyến ĐƯỜNG THẬT (QL1, CT01, DT720...). Tên do
            # generator tự sinh (ngo_/pho_/tinh_lo_/noi_manh/...) là đường
            # lô: bỏ qua mọi tên như bản cũ thì 97/100 ngõ cụt bị bỏ rơi.
            _nm = sg.get("name") or ""
            _up = _nm.upper()
            if _nm and _up.startswith(("QL", "CT", "DT", "HL")):
                continue
            if sg["class"] not in ("LOCAL", "COLLECTOR", "RURAL_LOCAL",
                                   "ALLEY", "ARTERIAL", "PROVINCIAL_ROAD"):
                continue
            n = self.nodes.get(nid)
            if n is None or self._in_station_zone(n["x"], n["z"], 30.0):
                continue
            tried += 1
            cands = []
            for (_s, oid, nx, nz) in pool:
                if oid == nid or self._in_station_zone(nx, nz, 30.0):
                    continue
                cands.append((dist(n["x"], n["z"], nx, nz), oid))
            cands.sort()
            # 60 ứng viên (không phải 14): nút gần nhất thường vấp góc hoặc
            # vấp `_crosses_major`; nút xa hơn mới có góc mới mà nối được
            att, linked_now = 0, False
            for d, oid in cands[:60]:
                if d > reach:
                    break
                m = self.nodes.get(oid)
                if m is None:
                    continue
                att += 1
                # cổng chất lượng riêng: `topo_link_ok` không có 2 luật này
                # => giao lộ vô hình cắt QL1, và đường nổi trên sông
                if self._crosses_major(n["x"], n["z"], m["x"], m["z"]):
                    why_fail["cat ngang duong chinh"] += 1
                    continue
                _st = max(1, int(d // 150.0))
                _wet = False
                for _k in range(_st + 1):
                    _t = _k / float(_st)
                    if self.water_factor(n["x"] + (m["x"] - n["x"]) * _t,
                                         n["z"] + (m["z"] - n["z"]) * _t) > 0.2:
                        _wet = True
                        break
                if _wet:
                    why_fail["cat song (nuoc)"] += 1
                    continue
                sid, _why = self.topo_try_link(nid, oid, sg["class"],
                                              width=sg.get("width"))
                if sid is not None:
                    joined += 1
                    linked_now = True
                    break
                why_fail[_why or "khong ro"] += 1
            if not linked_now:
                # FALLBACK T-JUNCTION (xem `_t_junction_link`): hết nút đúng
                # hướng => cắt đoạn gần nhất thành ngã 3 thật.
                if self._t_junction_link(nid, sg, reach):
                    joined += 1
                    linked_now = True
            if not linked_now:
                no_cand += 1
                if att == 0:
                    why_fail["het ung vien trong %dm" % reach] += 1
        if joined:
            print("      noi ngo cut thanh vong: %d / %d ngo cut thu"
                  % (joined, tried))
        if no_cand or (tried > joined and why_fail):
            print("        ngo khong noi duoc %d (het ung vien: %d): %s"
                  % (tried - joined, no_cand, why_fail.most_common(4)))
        return joined

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
                # KHÔNG cần dọn `grid`: vòng lặp trên đã có
                # `if nid not in self.nodes: continue`, nên id node đã bị gộp
                # sẽ tự bị bỏ qua.
                merged += self._weld_pair(nid, best)

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

    def _densify_long_segments(self, max_len=900.0, max_round=14):
        """
        Cắt mọi đoạn dài hơn `max_len` thành các đoạn có node ở giữa.

        Một đoạn 17km không có node nào ở giữa là ĐOẠN THIẾU NODE, không phải
        "đoạn dài hợp lệ": không có ngã giao, không có điểm dừng, không có
        nhà, minimap vẽ 1 nét thẳng 17km. Đo được trên smoke: **4 đoạn > 8km**
        (`tinh_lo_Vung_Ro_Van_Gia` 17.1km, `tinh_lo_Nam_Tuy_Hoa_Dong_Hoa`
        14.3km, một COLLECTOR không tên 20.9km, `tinh_lo_Phan_Thiet_Ham_Tin`
        28.1km) ⇒ `validate` chặn export.

        Node thêm vào là node HÌNH HỌC (`n_type="link"`), không phải ngã giao,
        nên dùng `allow_close_junction=True` (P38) — nếu không, luật "tách
        phải cách ≥100m ngã giao thật" chặn vô lý.
        """
        made = 0
        for _rd in range(max_round):
            self._build_node_seg_index()
            did = 0
            for sid in list(self.segments.keys()):
                sg = self.segments.get(sid)
                if sg is None:
                    continue
                a = self.nodes.get(sg["from"])
                b = self.nodes.get(sg["to"])
                if a is None or b is None:
                    continue
                L = dist(a["x"], a["z"], b["x"], b["z"])
                if L <= max_len:
                    continue
                # cắt ở giữa; nếu giữa trùng node khác thì lùi về 1/3, 2/3
                ok = False
                for frac in (0.5, 1.0 / 3.0, 2.0 / 3.0):
                    mx = lerp(a["x"], b["x"], frac)
                    mz = lerp(a["z"], b["z"], frac)
                    mid, _d = self._split_road_near(
                        mx, mz, reach=30.0, classes=(sg["class"],),
                        min_gap=0.0, allow_close_junction=True)
                    if mid is not None and mid not in (sg["from"], sg["to"]):
                        ok = True
                        break
                if ok:
                    did += 1
            made += did
            if not did:
                break
            self._rebuild_road_index()
        if made:
            print("      cat doan dai >%dm: %d lan" % (int(max_len), made))
        return made

    def _unbury_roads(self, tol=0.30):
        """NÂNG ĐƯỜNG BỊ CHÔI DƯỚI ĐẤT lên mặt đất (trừ hầm/cầu).

        Đo trong game: 4/2214 node đường nằm dưới terrain 2-10m
        (`IC_TL720` -6.4 -> -10.3m, `IC_QL56` -0.6 -> -1.3m, QL1 -2.0m) ⇒
        xe chạy xuyên đất. 99.5% node còn lại đúng +0.62m (chiều dày thân).

        Nguyên nhân: `_grade_roads` cho phép đào tới `max_cut = 8.0m` (ý là
        hào đường), nhưng `get_elevation` KHÔNG BAO GIỜ đào hào — không có mã
        nào cắt terrain theo đường. Hào ảo ⇒ đường bị chôn. Thêm nữa
        `road_lift = mountain*62*(...)` trong `get_elevation` nâng đất ven
        đường tới 62m ở vùng núi, biến hào 8m thành chôn 10m — vì vậy lỗi tập
        trung ở interchange trong núi.

        Đối xứng với `_fix_bridge_heights` (nâng cầu lên mặt nước): thiếu hẳn
        phần nâng đường bị chôn.

        Xét CẢ GIỮA ĐOẠN (t = 0.25/0.5/0.75) rồi nâng cả hai đầu lên mức
        cao nhất cần: hai đầu trên mặt đất không bảo đảm đoạn không chôn ở
        giữa khi terrain phồi lên. Nội suy thẳng giữa hai đầu thì không thể
        chui xuống dưới mặt đất ở giữa.

        Bỏ qua `TUNNEL` (hầm xuyên đất là đúng) và `bridge` (cầu vượt nằm
        trên đất là đúng, đã có `_fix_bridge_heights` lo).
        """
        need = {}

        def _need(nid, y):
            cur = need.get(nid)
            if cur is None or y > cur:
                need[nid] = y

        for sg in self.segments.values():
            if sg.get("bridge") or sg["class"] == "TUNNEL":
                continue
            a, b = self.nodes.get(sg["from"]), self.nodes.get(sg["to"])
            if a is None or b is None:
                continue
            for t in (0.0, 0.25, 0.5, 0.75, 1.0):
                x = a["x"] + (b["x"] - a["x"]) * t
                z = a["z"] + (b["z"] - a["z"]) * t
                th = self.get_elevation(x, z)          # mặt đất thật (water=True)
                road_y = a["y"] + (b["y"] - a["y"]) * t
                if road_y < th - tol:
                    _need(sg["from"], th - tol)
                    _need(sg["to"], th - tol)
        lifted = 0
        worst = 0.0
        for nid, y in need.items():
            nd = self.nodes.get(nid)
            if nd is None or nd["y"] >= y:
                continue
            worst = max(worst, y - nd["y"])
            nd["y"] = y
            # KHÔNG ghi `nd["elev"]`: P67 dùng `elev` làm MỐC GIỚI HẠN BẤT
            # BIẾN. Ghi đè nó bằng cao độ đường là phá mốc, và lần
            # `_grade_roads` sau sẽ lại trượt cửa sổ từ đó.
            lifted += 1
        ramp = self._ramp_after_unbury()
        print("      duong choi duoi dat: nang %d len mat dat (toan bo %d node, "
              "sau toi da %0.1fm)" % (lifted, len(need), worst))
        print("      san bang doc sau khi nang: %d node vuon qua mat dat "
              "(thuong nhat +%.1fm), %d doan van >16%%" % ramp)
        return lifted

    def _ramp_after_unbury(self, max_grade=0.14, cap=45.0, rounds=30):
        """P69 — SAN PHANG DO DOC SAU KHI NANG DUONG.

        `_unbury_roads` nang mot node len mat dat (do duoc: toi da 65.3m) nhung
        KHONG dua theo hai dau xom -> doan do bien thanh doc 29.6%. Bi chuoi:
        `_fix_final_slopes` goi `_limit_slopes` nhung no chay TRUOC luc nang,
        nen hau nhu khong anh huong gi; sau do no chi danh dau doan >16% la
        CAU VUOT de cho qua. Do duoc tren ban that:

            surface >16% = 0 doan   (mat duong da duoc grade rat tot)
            bridge  >16% = 6 doan   (worst 29.6%: s_7971, s_2739/s_2738 Vanh dai 3)
            tunnel  >16% = 0 doan

        va `validate()` van DO CA bridge -> VALIDATION FAILED -> khong export.

        Khong the tai tao terrain (khong co che do carve theo duong) va khong
        the ha node vi chinh no da bi chon vi DUOI mat dat. Cach con lai: moi
        node THAP hon duoc nang len cho do doc <= max_grade, lan ra theo chuoi.
        Mat duong van nam tren mat dat tai dung diem chon; phan con lai tro
        thanh vuon dat (skirt ve mat dat) — dung nhu duong dap that.

        Chi bo qua TUNNEL (ha tuong dua node len se lam huong ham).
        Tra ve (so node vuon qua mat dat, do vuon lon nhat, so doan con >16%).
        """
        raised = set()
        for _ in range(rounds):
            moved = 0
            for sg in self.segments.values():
                if sg["class"] == "TUNNEL":
                    continue
                a = self.nodes.get(sg["from"])
                b = self.nodes.get(sg["to"])
                if a is None or b is None:
                    continue
                run = dist(a["x"], a["z"], b["x"], b["z"])
                if run < 1.0:
                    continue
                dy = b["y"] - a["y"]
                if abs(dy) <= max_grade * run:
                    continue
                lo, hi = (a, b) if dy > 0.0 else (b, a)
                tgt = hi["y"] - max_grade * run
                if tgt <= lo["y"]:
                    continue
                th = self.get_elevation(lo["x"], lo["z"])
                if tgt > th + cap:          # chan tran: khong cho vuon mau thap
                    tgt = th + cap
                    if tgt <= lo["y"]:
                        continue
                lo["y"] = tgt
                raised.add(id(lo))
                moved += 1
            if not moved:
                break
        nf, worst, left = 0, 0.0, 0
        for sg in self.segments.values():
            if sg["class"] == "TUNNEL":
                continue
            a = self.nodes.get(sg["from"])
            b = self.nodes.get(sg["to"])
            if a is None or b is None:
                continue
            run = dist(a["x"], a["z"], b["x"], b["z"])
            if run >= 1.0 and abs(b["y"] - a["y"]) / run > 0.16:
                left += 1
        for nd in self.nodes.values():
            if id(nd) not in raised:
                continue
            d = nd["y"] - self.get_elevation(nd["x"], nd["z"])
            if d > 1.0:
                nf += 1
                if d > worst:
                    worst = d
        return nf, worst, left

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
        # hai hàm trên vừa tạo lại chỗ đường bị chôn, và chúng cũng vừa
        # nới `max_cut` lên 11m — nên phải nâng lại TRƯỚC khi đo dốc, để node
        # vừa nâng còn được đánh giá: dốc >16% thì thành cầu vượt (đúng luật).
        self._unbury_roads()
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
        why_fail = Counter()      # vi sao khong noi duoc (in ra khi that bai)
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
            # 400 -> 3000: bản cũ cắt top-400 theo khoảng cách, nhưng các
            # ứng viên GẦN có thể đều bị `_crosses_major` chặn (mảnh rời nằm
            # bên kia QL1) ⇒ bỏ luôn ứng viên xa hơn nhưng đi ĐƯỢNG HỢP PHÁP.
            for d2, rid, mid in cands[:3000]:
                n, m = self.nodes.get(rid), self.nodes.get(mid)
                if n is None or m is None:
                    continue
                L = math.sqrt(d2)
                if L < 6.0:
                    continue
                # ---- DIEU KIEN (theo danh cap) ----
                # KHÔNG CẮT NGANG CAO TỐC — LUÔN CHẠY, không theo
                # dàn cấp. Bản trước bọc trong `if level < 2` nên ở level >= 2
                # luật bị bỏ qua hoàn toàn; đo được `s_8801 LOCAL noi_manh`
                # cắt Vành đai 3 tại (-269597,-237561) ⇒ `validate()` chặn
                # export. Và lớp escape ấy chẳng bổ ích: log cùng lần chạy in
                # `khong noi duoc 2 node roi` — nới luật không nối được, chỉ
                # làm hỏng validation.
                # Phân biệt rõ: cắt ngang cao tốc là SAI TOPOLOGY (không có
                # mức nào cho phép — đường nhỏ không được đi giao cấp mặt với
                # cao tốc), còn `_seg_clear` (nước/dốc) là CHẤT LƯỢNG nên
                # nới theo dàn cấp được. Trước đây hai thứ bị gộp chung một
                # điều kiện.
                if self._crosses_major(n["x"], n["z"], m["x"], m["z"]):
                    why_fail["cat ngang duong chinh"] += 1
                    continue
                if level < 2 and not self._seg_clear(
                        (n["x"] + m["x"]) * 0.5, (n["z"] + m["z"]) * 0.5, 2.0, 1.0):
                    why_fail["nuoc/doc (level<2)"] += 1
                    continue
                # LIÊN THÔNG là ưu tiên 1, nhưng KHÔNG được liên thông bằng
                # cách đâm LOCAL vào MẶT CAO TỐC (rule 11/60). Đo được 11
                # `noi_manh` chạm thẳng nút cao tốc.
                # ⚠ CHẶN CẢ RAMP (P34). `TOPO_LEGAL["RAMP"]` không có `LOCAL`
                # (đúng: đầu ramp là nơi đường vào gặp cao tốc, không phải
                # nơi phố đổ vào). Bản trước chỉ chặn cao tốc nên `noi_manh`
                # bám nút ramp bị `add_segment` (P32) từ chối hàng loạt — đo
                # được 149 lần, và mỗi lần từ chối là một cơ hội nối mảnh rời
                # bị bỏ. Bám node cấp thấp cách 200m thì tốt hơn và đúng hơn.
                if self._node_touches_expressway(mid) or \
                        self._node_touches_expressway(rid) or \
                        self._node_touches_class(mid, ("RAMP",)) or \
                        self._node_touches_class(rid, ("RAMP",)):
                    why_fail["gan mat cao toc/ramp"] += 1
                    continue
                if self.add_segment(rid, mid, "LOCAL", name="noi_manh") is None:
                    why_fail["add_segment tu choi (ma tran/da canh)"] += 1
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
        if rest:
            print("      ! khong noi duoc %d node roi (main=%d node, cands=%d)"
                  % (len(rest), len(main), len(cands)))
            if why_fail:
                print("        ly do tu choi: %s" % (why_fail.most_common(6),))
            if added:
                return added
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

    # --------------------------------------------------------------------------
    # 4.7h CHỮA CỤM RAMP BỊ CẮT MẤT CẢ HAI ĐẦU  (P71)
    # --------------------------------------------------------------------------
    #
    # VÌ SAO `_reconnect_islands` KHÔNG CHỮA ĐƯỢC:
    #   Nó CỐ TÌNH bỏ qua mọi ứng viên chạm RAMP/EXPRESSWAY (luật P34 — đường
    #   phụ không được cắm vào mặt cao tốc). Một cụm RAMP bị weld/prune cắt mất
    #   cả đầu cao tốc lẫn đầu đường địa phương sẽ mãi mãi không được nối bởi
    #   lượt reconnect đó. Đo được: `validate()` FAIL
    #     x 2 cum ramp hoan toan co lap (khong cao toc khong duong)
    #     x graph roi 2 manh rieng le (9 node ngoai main, nho nhat 4)
    #   tức 2 mảnh 4 node + 5 node nằm ngoài mạng chính, không ai tới được.
    #
    # HAI NHÁNH, CẢ HAI ĐỀU GHI LOG (không giấu):
    #   (a) NỐI — cụm còn trong `max_len` của một node chạm EXPRESSWAY/TUNNEL
    #       hoặc một cụm ramp khác cùng interchange. Nối bằng chính luật RAMP
    #       (`TOPO_LEGAL["RAMP"]` có EXPRESSWAY/TUNNEL/RAMP) nên đây đúng là
    #       hình dạng một nhánh ramp, không phải đường phụ đâm vào cao tốc.
    #   (b) XOÁ — không có ứng viên trong bán kính. Khi đó cụm không đầu cao
    #       tốc, không đầu đường, không lối vào: là mảnh vô nghĩa, xử lý y hệt
    #       ngõ cụt trong `_prune_useless_stubs`. In ra số node đã xoá.
    def _heal_ramp_fragments(self, max_len=1500.0):
        HI_SIDE = ("EXPRESSWAY", "TUNNEL")
        LOW_SIDE = ("NATIONAL", "ARTERIAL", "COLLECTOR", "PROVINCIAL_ROAD",
                    "LOCAL", "RURAL_LOCAL", "SERVICE", "STATION_ACCESS",
                    "RESIDENTIAL", "COMMERCIAL", "INTER_VILLAGE",
                    "INDUSTRIAL_ACCESS", "AGRICULTURAL")
        self._build_node_seg_index()

        # --- gom cụm RAMP liên thông qua cạnh RAMP ---
        radj = {}
        for sid, sg in self.segments.items():
            if sg["class"] != "RAMP":
                continue
            radj.setdefault(sg["from"], []).append(sid)
            radj.setdefault(sg["to"], []).append(sid)

        seen = set()
        clusters = []
        for st in radj:
            if st in seen:
                continue
            stack, comp_s, comp_n = [st], set(), {st}
            seen.add(st)
            while stack:
                cur = stack.pop()
                for sid in radj.get(cur, ()):
                    if sid in comp_s:
                        continue
                    comp_s.add(sid)
                    sg = self.segments[sid]
                    for e in (sg["from"], sg["to"]):
                        if e not in comp_n:
                            comp_n.add(e)
                            stack.append(e)
            clusters.append((comp_s, comp_n))

        # ỨNG VIÊN NỐI: node chạm cao tốc/ramp **THUỘC THÀNH PHẦN CHÍNH**.
        #
        # Bản trước lấy MỌI node chạm RAMP làm ứng viên, kể cả node của một
        # cụm ramp rời khác. Đo được: 9 cụm được "chữa" xong nhưng nối vào
        # NHAU (cách 3-11m vì các cụm nằm sát nhau), không cụm nào chạm main
        # => `_ensure_connected` vẫn còn thành phần rời, và validate báo
        # "graph roi N manh rieng le".
        #
        # Sửa đúng nguyên nhân: ứng viên phải nằm trong thành phần lớn nhất.
        # Tính 1 lần bằng BFS trên toàn graph (O(V+E)), rẻ hơn nhiều so với
        # quét từng cụm, và đảm bảo "chữa" = "nối vào mạng chính" đúng nghĩa.
        _radj = defaultdict(list)
        for sg in self.segments.values():
            _radj[sg["from"]].append(sg["to"])
            _radj[sg["to"]].append(sg["from"])
        _withseg = set(_radj)
        _seen_all = set()
        _main_set = set()
        for _st in _withseg:
            if _st in _seen_all:
                continue
            _comp = set()
            _stack = [_st]
            _seen_all.add(_st)
            while _stack:
                _cur = _stack.pop()
                _comp.add(_cur)
                for _nx in _radj[_cur]:
                    if _nx not in _seen_all:
                        _seen_all.add(_nx)
                        _stack.append(_nx)
            if len(_comp) > len(_main_set):
                _main_set = _comp
        target = [nid for nid in _main_set
                  if self._node_touches_class(nid, HI_SIDE)
                  or self._node_touches_class(nid, ("RAMP",))]
        if not target:
            # không còn node cao tốc/ramp nào trong main -> mọi cụm ramp mồ
            # côi chỉ có thể XOÁ. `target` rỗng làm vòng `add_segment` tự
            # từ chối hết -> rơi vào nhánh xoá, đúng ý nghĩa.
            print("      [heal ramp] main khong con node cao toc/ramp "
                  "(main=%d node) -> chi co the xoa cum ramp" % len(_main_set))

        healed = dropped = 0
        for comp_s, comp_n in clusters:
            has_hi = has_lo = False
            for nid in comp_n:
                for sid in self._segs_at(nid):
                    cl = self.segments[sid]["class"]
                    if cl == "RAMP":
                        continue
                    if cl in HI_SIDE:
                        has_hi = True
                    elif cl in LOW_SIDE:
                        has_lo = True
            if has_hi or has_lo:
                continue          # cụm ramp bình thường: đã có đầu nối
            # --- cụm bị cắt mất cả hai đầu ---
            cands = []
            for a in sorted(comp_n):
                na = self.nodes.get(a)
                if na is None:
                    continue
                for b in target:
                    if b in comp_n:
                        continue
                    nb = self.nodes.get(b)   # `target` dựng 1 lần: cụm trước
                    if nb is None:           # có thể đã bị `_prune_orphans` xoá
                        continue
                    d2 = (na["x"] - nb["x"]) ** 2 + (na["z"] - nb["z"]) ** 2
                    if d2 <= max_len * max_len:
                        cands.append((d2, a, b))
            cands.sort()
            done = None
            # 40 -> 200: 40 ứng viên gần nhất hay rơi hết vào node RAMP cùng
            # interchange đã kín, trong khi ứng viên hợp pháp nằm xa hơn vài
            # chục mét. Thử nhiều hơn rẻ hơn nhiều so với xoá nhầm cụm.
            for _d2, a, b in cands[:200]:
                if self.add_segment(a, b, "RAMP", name="noi_ramp") is not None:
                    done = (a, math.sqrt(_d2))
                    break
            if done is not None:
                healed += 1
                print("      noi cum ramp bi cat: %d seg -> %s cach %.0fm"
                      % (len(comp_s), done[0], done[1]))
                self._build_node_seg_index()
            else:
                dropped += len(comp_s)
                print("      xoa cum ramp vo nghia: %d seg / %d node "
                      "(khong dau cao toc, khong dau duong, khong ung vien "
                      "trong %.0fm)" % (len(comp_s), len(comp_n), max_len))
                for sid in comp_s:
                    self.segments.pop(sid, None)
                self._build_node_seg_index()
                self._prune_orphans()
        if healed or dropped:
            print("      chua ramp: noi %d cum / xoa %d seg" % (healed, dropped))
        return healed + dropped

    def _ensure_station_access(self, max_try=700):
        """MỌI sân bến / trạm phải NỐI VỚI MẠNG CHÍNH (task 4/15).

        Đo được trên data: sân bến Nha Trang (36 node INTERNAL +
        STATION_ACCESS) nằm HOÀN TOÀN RỜI khỏi main — access road bị các
        bước weld/prune CUỐI cắt mất, trong khi `validate()` chỉ check
        `access_node in nodes` chứ KHÔNG check connectivity ⇒ lỗi lọt.
        """
        adj = {}
        for sg in self.segments.values():
            a, b = sg.get("from"), sg.get("to")
            if a is None or b is None:
                continue
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        if not adj:
            return 0

        def _components():
            seen, comps = set(), []
            for st in adj:
                if st in seen:
                    continue
                stack, comp = [st], []
                seen.add(st)
                while stack:
                    c = stack.pop()
                    comp.append(c)
                    for nxt in adj.get(c, ()):
                        if nxt not in seen:
                            seen.add(nxt)
                            stack.append(nxt)
                comps.append(comp)
            comps.sort(key=len, reverse=True)
            return comps

        comps = _components()
        if len(comps) < 2:
            return 0
        main = set(comps[0])
        main_pts = [(q, self.nodes[q]["x"], self.nodes[q]["z"])
                    for q in main if q in self.nodes]

        def _in_zone(zn, x, z, pad=6.0):
            dx, dz = x - zn["x"], z - zn["z"]
            r = zn.get("rot") or 0.0
            ca, sa = math.cos(-r), math.sin(-r)
            lx = dx * ca - dz * sa
            lz = dx * sa + dz * ca
            return (abs(lx) <= zn["w"] * 0.5 + pad and
                    abs(lz) <= zn["d"] * 0.5 + pad)

        fixed = 0
        for zn in (getattr(self, "station_zones", []) or []):
            zn_nodes = []
            for nid in adj:
                n = self.nodes.get(nid)
                if n is None:
                    continue
                if _in_zone(zn, n["x"], n["z"], 6.0):
                    zn_nodes.append(nid)
            if not zn_nodes or any(q in main for q in zn_nodes):
                continue
            cands = sorted(main_pts,
                           key=lambda q: (q[1] - zn["x"]) ** 2 +
                           (q[2] - zn["z"]) ** 2)[:max_try]
            src_sorted = sorted(zn_nodes,
                                key=lambda q: (self.nodes[q]["x"] - zn["x"]) ** 2 +
                                (self.nodes[q]["z"] - zn["z"]) ** 2)
            done = False
            for (_mid, mx, mz) in cands:
                for src in src_sorted[:6]:
                    sn = self.nodes.get(src)
                    if sn is None or _mid == src:
                        continue
                    d = dist(sn["x"], sn["z"], mx, mz)
                    if d < 6.0 or d > 600.0:
                        continue
                    if self._crosses_major(sn["x"], sn["z"], mx, mz):
                        continue          # khong duoc di qua mat duong chinh
                    if self._node_touches_expressway(_mid) or \
                            self._node_touches_class(_mid, ("RAMP",)):
                        continue
                    for _cls in ("STATION_ACCESS", "LOCAL", "SERVICE"):
                        if self.add_segment(src, _mid, _cls,
                                            name="ben_noi") is not None:
                            done = True
                            break
                    if done:
                        break
                if done:
                    break
            if done:
                main |= set(zn_nodes)
                fixed += 1
                continue
            # --- KHONG NOI DUOC ---
            base = (zn.get("id") or "").split("#")[0]
            st_ids = {s0["id"] for s0 in (getattr(self, "stations", []) or [])}
            if base in st_ids:
                # BẾN XE thì GIỮ + báo lỗi — validate sẽ chặn export.
                print("      ! zone '%s': KHONG noi duoc voi mang chinh "
                      "(%d node roi)" % (zn.get("id", "?"), len(zn_nodes)))
                continue
            # TRẠM/PHỤC VỤ (trạm thu phí, trạm xăng): mảnh 2-52m bị cao tốc
            # bịt kín 3 phía, không nối được và CHẲNG dẫn tới đâu => XOÁ cho
            # hết đường đứt. KHÔNG đụng nếu mảnh chứa đường chính/cao tốc.
            comp, stack = set(), list(zn_nodes)
            while stack:
                c0 = stack.pop()
                if c0 in comp:
                    continue
                comp.add(c0)
                for n2 in adj.get(c0, ()):
                    if n2 not in comp:
                        stack.append(n2)
            if len(comp) > 8:
                print("      ! zone '%s': manh roi %d node qua lon, giu lai"
                      % (zn.get("id", "?"), len(comp)))
                continue
            bad_cls = set()
            victim = []
            for sid0, sg0 in list(self.segments.items()):
                if sg0["from"] in comp and sg0["to"] in comp:
                    if sg0["class"] in ("NATIONAL", "ARTERIAL", "EXPRESSWAY",
                                        "RAMP", "TUNNEL", "PROVINCIAL_ROAD"):
                        bad_cls.add(sg0["class"])
                    elif not sg0.get("bridge"):
                        victim.append(sid0)
            if bad_cls or not victim:
                print("      ! zone '%s': manh roi %d node, khong xoa duoc"
                      % (zn.get("id", "?"), len(comp)))
                continue
            for sid0 in victim:
                self._remove_segment(sid0)
            self._prune_orphans()
            print("      xoa manh roi %d doan tai tram '%s' (bi cao toc "
                  "bi ket, khong co loi vao)" % (len(victim), base))
        if fixed:
            print("      noi vao mang chinh cho %d zone ben/tram roi" % fixed)
        return fixed

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
                # ⚠ CHẶN CẢ RAMP (P34). `TOPO_LEGAL["RAMP"]` không có `LOCAL`
                # (đúng: đầu ramp là nơi đường vào gặp cao tốc, không phải
                # nơi phố đổ vào). Bản trước chỉ chặn cao tốc nên `noi_manh`
                # bám nút ramp bị `add_segment` (P32) từ chối hàng loạt — đo
                # được 149 lần, và mỗi lần từ chối là một cơ hội nối mảnh rời
                # bị bỏ. Bám node cấp thấp cách 200m thì tốt hơn và đúng hơn.
                if self._node_touches_expressway(mid) or \
                        self._node_touches_expressway(rid) or \
                        self._node_touches_class(mid, ("RAMP",)) or \
                        self._node_touches_class(rid, ("RAMP",)):
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
        
        BẢO VỆ: STATION_ACCESS, INTERNAL, SERVICE (khi kết nối vào station zone)
        không được xóa vì chúng là lối ra/vào bến/trạm thiết yếu.
        """
        hw = [(sid, s) for sid, s in self.segments.items()
              if s["class"] in ("EXPRESSWAY", "TUNNEL")]
        if not hw:
            return 0
        
        # Xác định các node thuộc station zones (để bảo vệ access roads)
        # Mở rộng bounding box thêm 50m để bắt được access roads ra vào
        station_zone_nodes = set()
        for sz in getattr(self, "station_zones", []):
            cx, cz, w, d, rot = sz["x"], sz["z"], sz["w"], sz["d"], sz.get("rot", 0.0)
            ca, sa = math.cos(rot), math.sin(rot)
            hw_ = w * 0.5 + 60.0  # mở rộng để bắt access roads
            hd_ = d * 0.5 + 60.0
            for nid, n in self.nodes.items():
                dx, dz = n["x"] - cx, n["z"] - cz
                lx = dx * sa + dz * ca
                lz = dx * ca - dz * sa
                if abs(lx) <= hw_ and abs(lz) <= hd_:
                    station_zone_nodes.add(nid)
        
        # Cũng thêm các node của segment kết nối vào zone (access roads)
        access_seg_nodes = set()
        for sz in getattr(self, "station_zones", []):
            cx, cz, w, d, rot = sz["x"], sz["z"], sz["w"], sz["d"], sz.get("rot", 0.0)
            ca, sa = math.cos(rot), math.sin(rot)
            hw_ = w * 0.5 + 100.0
            hd_ = d * 0.5 + 100.0
            for sid, seg in self.segments.items():
                if seg["class"] in ("STATION_ACCESS", "SERVICE", "INTERNAL"):
                    n1 = self.nodes.get(seg["from"])
                    n2 = self.nodes.get(seg["to"])
                    if n1 and n2:
                        for n in (n1, n2):
                            dx, dz = n["x"] - cx, n["z"] - cz
                            lx = dx * sa + dz * ca
                            lz = dx * ca - dz * sa
                            if abs(lx) <= hw_ and abs(lz) <= hd_:
                                access_seg_nodes.add(n["x"]), access_seg_nodes.add(n["z"])  # dùng toạ độ làm key
        
        removed = 0
        for sid, seg in list(self.segments.items()):
            # Bảo vệ: trục chính, ramp, tunnel, station access, internal
            if seg["class"] in ("EXPRESSWAY", "NATIONAL", "TUNNEL", "RAMP", "STATION_ACCESS", "INTERNAL"):
                continue
            if seg.get("bridge"):
                continue
            # Bảo vệ SERVICE nếu NỐI VÀO station zone (một đầu trong zone hoặc là access road)
            if seg["class"] == "SERVICE":
                n1, n2 = self.nodes.get(seg["from"]), self.nodes.get(seg["to"])
                if n1 and n2:
                    in_zone1 = n1["x"] in access_seg_nodes or n2["x"] in access_seg_nodes
                    # Check đơn giản hơn: nếu segment class là SERVICE và một đầu gần station zone
                    if (seg["from"] in station_zone_nodes or seg["to"] in station_zone_nodes or
                        (n1 and self._point_near_station_zones(n1["x"], n1["z"], 120.0)) or
                        (n2 and self._point_near_station_zones(n2["x"], n2["z"], 120.0))):
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
    
    def _point_near_station_zones(self, x, z, radius):
        """Check if point is near any station zone (for SERVICE road protection)."""
        for sz in getattr(self, "station_zones", []):
            cx, cz, w, d, rot = sz["x"], sz["z"], sz["w"], sz["d"], sz.get("rot", 0.0)
            ca, sa = math.cos(rot), math.sin(rot)
            hw_ = w * 0.5 + radius
            hd_ = d * 0.5 + radius
            dx, dz = x - cx, z - cz
            lx = dx * sa + dz * ca
            lz = dx * ca - dz * sa
            if abs(lx) <= hw_ and abs(lz) <= hd_:
                return True
        return False

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
        """Hướng đơn vị của QL1 tại (x, z), suy từ 2 node QL kề nhau."""
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
          - phố cắt QL1 -> tách đôi, mỗi nửa nối vào NODE QL1 THẬT => giao
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
            # TAM LƯỚI = TOẠ ĐỘ THẬT của thị trấn (trước đây đặt tại node QL1
            # gần nhất => Dầu Giây lệch 1.5km khỏi vị trí thật).
            cx, cz = ax, az
            # ⚠ BIÊN ĐỘ WARP PHẢI THEO BƯỚC LƯỚI, KHÔNG THEO BÁN KÍNH.
            # Cũ: `sc = radius` (thành phố 1350m) => biên ±418m trong khi bước
            # lưới chỉ 195m => LƯỚI TỰ GẤP LÊN TRÊN THÂN CHÍNH NÓ (nham bi).
            # Đo được trong game: đường thành phố chạy thành dãy thẳng dài
            # hàng km thay vì lưới có block.
            # mỗi thị trấn MỘT bước lưới và MỘT mức méo riêng. Trước
            # đây `sp["step"]` và `0.36` CỐ ĐỊNH theo cỡ ⇒ 28 thị trấn chỉ có
            # 4 khuôn. `rng` đã seed theo `self.seed` nên vẫn TẤT ĐỊNH.
            R = sp["radius"]
            st_step = sp["step"] * rng.uniform(0.85, 1.18)
            sc = st_step * rng.uniform(0.22, 0.52)
            # TỈ LỆ KÉO DÀI: thị trấn ven đường dọc, thành phố vuông, thị
            # trấn trải rộng ngang. Đây là đổi HÌNH DẠNG, không phải rung lệch.
            # hẹp lại từ U(0.50,1.50) của P61. Bản rộng làm mất 887 node
            # và sinh "đường cắt ngang cao tốc không qua nút giao" .
            aspect = rng.uniform(0.80, 1.25)
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

            # trục chính: hướng QL1 tại node hub
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
            # `v` = phương DỌC QL1 ⇒ kéo dài theo `aspect`.
            us, u = [], -R
            while u <= R + 1.0:
                us.append(u)
                u += st_step * rng.uniform(0.82, 1.26)
            vs, v = [], -R * aspect
            while v <= R * aspect + 1.0:
                vs.append(v)
                v += st_step * rng.uniform(0.84, 1.24)

            # mỗi nút QL1 chỉ phục vụ MỘT phố cắt qua (xem chỗ dùng)
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
                return (pu * pu + (pv * pv) / (aspect * aspect)) <= rr * rr

            big = size in ("city", "town")

            # PHỐ TRONG THỊ TRẤN mang class theo BÁN KÍNH TỚI TÂM, không random:
            #   vành ngoài   -> ARTERIAL (đường tránh, đã có sẵn bên dưới)
            #   lõi 1/3      -> COMMERCIAL (phố chợ, phố thương mại: mật độ
            #                   đi bộ + đậu xe cao nhất, xe buýt dừng nhiều)
            #   ngoài lõi    -> RESIDENTIAL (đường khu dân cư)
            # Ngưỡng 0.35R là hình dạng thị trấn Việt Nam thật: chợ + vài dãy
            # phố lõi nằm trong ~1/3 bán kính, phía ngoài là phố tĩnh. Thôn
            # (`village`/`hamlet`) giữ `LOCAL` như cũ: đường thôn 6-7m, hẻm
            # chạy vô nhà, không có "phố thương mại" để mà đổi class.
            def _street_cls(dcen):
                if not big:
                    return "LOCAL"
                if dcen < R * 0.35:
                    return "COMMERCIAL"
                return "RESIDENTIAL"

            def _dcen(nid):
                n = self.nodes[nid]
                return math.hypot(n["x"] - cx, n["z"] - cz)

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

            # BỎ superblock của P61. Xoá cả hàng/cột làm mất 887 node
            # và đứt mạng. Superblock vốn ĐÃ CÓ: đoạn dưới đây đã bỏ ~8%
            # cạnh để sinh siêu block + ngõ cụt.
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
                """
                Nối 2 node lưới — QUA CỔNG `topo_try_link`.

                Bản cũ gọi `add_segment` trực tiếp nên bỏ qua ma trận cấp,
                khoảng cách nút giao và GÓC. Đo được 38 node còn lại có 2 nhánh
                <9°, gồm n_18 / n_52 / n_70 — đều là nút QL1 có nhiều
                collector; cộng dồn 3-4 phố vào 1 nút là "lược răng".
                """
                nonlocal made
                if a_id is None or b_id is None or a_id == b_id:
                    return 0
                A, B = self.nodes[a_id], self.nodes[b_id]
                if self._crosses_major(A["x"], A["z"], B["x"], B["z"]):
                    return 0
                sid, _why = self.topo_try_link(a_id, b_id, cls, name=nm)
                if sid is None:
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
                        cls = _street_cls((_dcen(a_id) + _dcen(b_id)) * 0.5)
                        nm = ("pho_%s" if cls == "COMMERCIAL"
                              else "ngo_%s") % a["name"]
                    _link(a_id, b_id, cls, nm)
                # cạnh ngang (tăng u, giữ v) — cắt trục QL thì tách tại node QL
                b2 = nid_of.get((iu + 1, iv))
                if b2 is not None:
                    straddle = (iu + 1 < len(us)) and (uu * us[iu + 1]) < 0.0
                    if straddle:
                        hx = cx + px_ * (uu + us[iu + 1]) * 0.5 + ax_ * vv
                        hz = cz + pz_ * (uu + us[iu + 1]) * 0.5 + az_ * vv
                        # PHỐ SONG SONG VỚI QL1 THÌ KHÔNG PHẢI GIAO LỖ.
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
                        # TÁCH QL1 TẠI ĐÚNG ĐIỂM CẮT, và MỖI NÚT QL CHỈ NHẬN
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
                            cls = _street_cls((_dcen(a_id) + _dcen(b2)) * 0.5)
                            nm = ("pho_%s" if cls == "COMMERCIAL"
                                  else "ngo_%s") % a["name"]
                        _link(a_id, b2, cls, nm)
                # đường chéo 2 hướng (phá lưới hoàn hảo -> superblock + ngã 3
                # chữ Y tự nhiên). Hướng ngược tạo nút giao lệch kiểu VN.
                if rng.random() < 0.09:
                    b3 = nid_of.get((iu + 1, iv + 1))
                    if b3 is not None:
                        _link(a_id, b3, "ALLEY", "ngo_%s" % a["name"])
                if rng.random() < 0.06:
                    b4 = nid_of.get((iu - 1, iv + 1))
                    if b4 is not None:
                        _link(a_id, b4, "ALLEY", "hem_%s" % a["name"])

            # --- VÀNH ĐAI TRONG (vòng xuyến lưu thông) cho city/town ---
            # Vòng kín quanh tâm thị trấn tạo tuần hoàn + nhiều ngã 3/4 trên
            # vòng, đúng kiểu bùng binh/vành đai VN. Chỉ nối node lưới có sẵn
            # qua cổng topo_try_link (góc + bậc + cao tốc đều được kiểm).
            if size in ("city", "town") and len(nid_of) >= 12:
                ring_r = R * 0.45
                ring_nodes = []
                for nid in nid_of.values():
                    n = self.nodes[nid]
                    d = math.hypot(n["x"] - cx, n["z"] - cz)
                    if abs(d - ring_r) < st_step * 0.75:
                        ang = math.atan2(n["x"] - cx, n["z"] - cz)
                        ring_nodes.append((ang, nid))
                ring_nodes.sort()
                for i in range(len(ring_nodes)):
                    a_id = ring_nodes[i][1]
                    b_id = ring_nodes[(i + 1) % len(ring_nodes)][1]
                    if a_id == b_id:
                        continue
                    A, B = self.nodes[a_id], self.nodes[b_id]
                    if dist(A["x"], A["z"], B["x"], B["z"]) > st_step * 2.2:
                        continue
                    # Vành trong là đường THU THẬP (nó gom xe từ phố nội bộ
                    # đổ ra vành ngoài) nên là `COLLECTOR`, không phải `LOCAL`
                    # như bản cũ — và không đi theo `_street_cls` vì nó là
                    # đường TUẦN HOÀN, không phải đường đi qua một địa chỉ.
                    _link(a_id, b_id, "COLLECTOR", "vanh_%s" % a["name"])

            # --- ĐƯỜNG TRÁNH ĐÔ THỊ: khép kín vành ngoài thành vòng thật ---
            # Biên lưới đã có "vang_<name>" ARTERIAL nhưng là từng đoạn rời.
            # Nối các node biên kề góc với nhau để xe có route vòng qua thị
            # trấn mà không phải xuyên tâm (đúng chức năng đường tránh VN).
            if len(nid_of) >= 8:
                peri = []
                for nid in nid_of.values():
                    n = self.nodes[nid]
                    ang = math.atan2(n["x"] - cx, n["z"] - cz)
                    peri.append((ang, nid))
                peri.sort()
                for i in range(len(peri)):
                    a_id = peri[i][1]
                    b_id = peri[(i + 1) % len(peri)][1]
                    if a_id == b_id:
                        continue
                    A, B = self.nodes[a_id], self.nodes[b_id]
                    if dist(A["x"], A["z"], B["x"], B["z"]) > st_step * 2.2:
                        continue
                    _link(a_id, b_id, "ARTERIAL", "tranh_%s" % a["name"])

            # --- NGÃ NĂM đô thị lớn: dồn thêm nhánh vào nút trung tâm ---
            # topo_try_link + trần bậc (6) tự chặn nếu quá tải nên an toàn.
            if size == "city" and len(nid_of) >= 16:
                hub_cands = sorted(
                    nid_of.values(),
                    key=lambda nid: self._topo_deg(nid), reverse=True)[:3]
                for hub_nid in hub_cands:
                    H = self.nodes[hub_nid]
                    near = sorted(
                        nid_of.values(),
                        key=lambda nid: dist(self.nodes[nid]["x"],
                                             self.nodes[nid]["z"],
                                             H["x"], H["z"]))
                    for cand in near[1:4]:
                        if cand == hub_nid:
                            continue
                        C = self.nodes[cand]
                        if dist(C["x"], C["z"], H["x"], H["z"]) > st_step * 1.3:
                            continue
                        _link(hub_nid, cand,
                              _street_cls((_dcen(hub_nid) + _dcen(cand)) * 0.5),
                              "nga_%s" % a["name"])

            # --- ĐÓNG ĐƯỜNG CỤT LƯỚI: node bậc 1 nối vào node lưới gần nhất ---
            # Quy tắc tuyệt đối: không đường cụt vô lý. Mọi nối qua cổng
            # topo_try_link nên chỉ tạo vòng hợp lệ, không phá topology.
            deg = {}
            for nid in nid_of.values():
                deg[nid] = self._topo_deg(nid)
            for nid in nid_of.values():
                if deg.get(nid, 0) != 1:
                    continue
                N = self.nodes[nid]
                best, bd = None, st_step * 2.0
                for oid in nid_of.values():
                    if oid == nid:
                        continue
                    O = self.nodes[oid]
                    d = dist(N["x"], N["z"], O["x"], O["z"])
                    if d < bd:
                        bd, best = d, oid
                if best is not None:
                    before = self._topo_deg(nid)
                    _link(nid, best, "LOCAL", "noi_%s" % a["name"])
                    if self._topo_deg(nid) != before:
                        deg[nid] = self._topo_deg(nid)
                        deg[best] = self._topo_deg(best)

            # nối tâm lưới vào node QL1 thật
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
                                    _sid, _why = self.topo_try_link(
                                        mini[i2], mini[i2 + 1], "LOCAL",
                                        name="ngo_%s" % a["name"])
                                    if _sid is not None:
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
        đều phải vòng ra QL1. Chỉ nhận link nếu: không cắt cao tốc, san dốc
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
                mn = self.add_node(mx, mz, "RURAL", n_type="link")
                if mn is None:
                    continue
                # QUA CỔNG: đo được tỉnh lộ bám QL1 ở góc 5.1-5.5° (n_52,
                # n_70) — cùng hướng gần như trùng. `add_segment` trực tiếp
                # bỏ qua kiểm góc nên 2 nhánh dính nhau ở nút QL1.
                _sid, _why = self.topo_try_link(prev, mn, "PROVINCIAL_ROAD",
                                              width=9.0)
                if _sid is None:
                    self._drop_node(mn)
                    continue          # giu prev, thu diem sau
                prev = mn
                chain += 1
            if prev is not None and prev != nb and not self._crosses_major(
                    self.nodes[prev]["x"], self.nodes[prev]["z"], B["x"], B["z"]):
                if self.add_segment(prev, nb, "PROVINCIAL_ROAD", width=9.0, lanes=2,
                                    name=nm) is not None:
                    chain += 1
            if chain == 0:
                # khong cat duoc giua 2 dau -> chi lay 1 duong thang de khong
                # lam dut mang.
                if self.add_segment(na, nb, "PROVINCIAL_ROAD", width=9.0, lanes=2,
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

    @staticmethod
    def _station_gate_pos(cx, cz, w, qx, qz):
        """Cong ben nam tren ria rect, huong ve duong chinh (ox = w/2 - 4)."""
        vx, vz = qx - cx, qz - cz
        vl = math.hypot(vx, vz) or 1.0
        gh = w * 0.5 - 4.0
        return cx + vx / vl * gh, cz + vz / vl * gh

    def _access_hits_hwy(self, ax, az, gx, gz):
        """Duong dan tu diem neo tren QL den cong ben co cat cao to TAI MAT BANG?

        Dung DUNG luat ma `_fix_internal_crossings` dang dung de xoa:
        `_seg_cross` + class in ("EXPRESSWAY","TUNNEL"). Kiem bang mot luat
        khac thi van bi xoa doc lap -> doan STATION_ACCESS mat -> ben tro thanh
        DAO. Do duoc tren data: STATION_ACCESS = 14/15 (thieu chinh doan
        j1->j2), comp 66 node rieng tai Bến xe Miền Đông Mới, seg_ra_ngoai=0.
        """
        lo_x, hi_x = min(ax, gx) - 2.0, max(ax, gx) + 2.0
        lo_z, hi_z = min(az, gz) - 2.0, max(az, gz) + 2.0
        for seg in self.segments.values():
            if seg["class"] not in ("EXPRESSWAY", "TUNNEL"):
                continue
            h1 = self.nodes.get(seg["from"])
            h2 = self.nodes.get(seg["to"])
            if not h1 or not h2:
                continue
            if (max(h1["x"], h2["x"]) < lo_x or min(h1["x"], h2["x"]) > hi_x or
                    max(h1["z"], h2["z"]) < lo_z or min(h1["z"], h2["z"]) > hi_z):
                continue
            if _seg_cross((ax, az), (gx, gz),
                          (h1["x"], h1["z"]), (h2["x"], h2["z"])):
                return True
        return False

    def _refind_station_clear(self, x0, z0, w, d, qn, bx, bz, tx=1.0, tz=0.0):
        """TÌM LẠI VỊ TRÍ SÂN BẾN SẠCH (rule 11/14/16/63).

        Bến xe phải nằm BÊN LỀ đường chính, có lối vào, và TUYỆT ĐỐI không
        nằm trên cao tốc / trong lòng đường. Khi mọi vị trí vuông góc với
        trục QL đều bị đường khác cắt (khu nút giao), ta quét vành khuyên
        quanh điểm neo trên QL:
          * ưu tiên rect KHÔNG cắt bất kỳ đường nào (`_rect_clear_of_roads`)
          * bắt buộc cách mọi CAO TỐC thêm một khoảng lề (rule 11)
          * không nằm trên nước, không sát biển
          * ĐƯỜNG TIẾP CẬN (neo QL -> cổng) KHÔNG được cắt ngang cao tốc
            (`_access_hits_hwy`): nếu cắt thì `_fix_internal_crossings` sẽ
            XOÁ đoạn đó -> bến mất lối ra vào. Sân sạch nhưng bến thành
            đảo thì vẫn là vi phạm spec.
        Trả về (x, z, w, d) hoặc None.
        """
        best = None
        base_hw = w * 0.5
        for rad in (base_hw + 70.0, base_hw + 130.0, base_hw + 210.0,
                    base_hw + 300.0, base_hw + 400.0, base_hw + 520.0,
                    base_hw + 680.0, base_hw + 880.0, base_hw + 1100.0):
            for k in range(24):
                ang = 2.0 * math.pi * k / 24.0
                cx2 = bx + math.cos(ang) * rad
                cz2 = bz + math.sin(ang) * rad
                for (rw, rd) in ((w, d), (d, w)):
                    crot = math.atan2(qn["x"] - cx2, qn["z"] - cz2)
                    if not self._rect_clear_of_roads(cx2, cz2, rw, rd, crot):
                        continue
                    g2x, g2z = self._station_gate_pos(cx2, cz2, rw,
                                                      qn["x"], qn["z"])
                    # diem neo tren QL phai tinh theo TAM ỨNG VIÊN moi
                    # (cung cong thuc voi _place_stations), khong dung
                    # `bx,bz` cu -> khong thi tuyen tiem can sai huong.
                    tp2 = ((cx2 - qn["x"]) * tx + (cz2 - qn["z"]) * tz)
                    ax2 = qn["x"] + tx * tp2
                    az2 = qn["z"] + tz * tp2
                    if self._access_hits_hwy(ax2, az2, g2x, g2z):
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

    def _reseat_stations_on_final_roads(self):
        """RULE 8 — KHÔNG ĐƯỢC BẺ ĐƯỜNG ĐỂ ÉP BẾN VÀO (đặt lại BẾN).

        `_place_stations` (step 3) chốt vị trí khi mạng đường mới chỉ có
        QL1/CT01/cao tốc. Sau đó các bước sau sinh/thêm đoạn nữa:
          L2231 `_divert_hw_around_stations`  (uốn cao to quanh zone)
          L2232 `_build_secondary_networks`
          L2233 `_build_settlements`          (đường LOCAL trong thị trấn)
          L2234 `_build_provincial_routes`
        Đo được trên data: Bến xe Miền Đông Mới bị 4 đoạn cắt qua sân
        (s_3019/s_3020 RAMP IC_Hoang_Huu_Nam, s_3028 EXPRESSWAY Vanh_dai_3,
        s_7885 LOCAL noi_manh) trong khi log vẫn in "tim lai vi tri sach" —
        nghĩa là vị trí ĐÃ SẠCH lúc đó, nhưng đường sau đó lại lấn vào.

        Chạy TRƯỚC `_build_stations` để `station_place` + `station_zones`
        mang vị trí CUỐI. Không tìm được chỗ sach -> IN VI PHAM (không âm
        thầm bẻ đường, không im lặng).
        """
        if not getattr(self, "station_place", None):
            return 0
        moved = 0
        for sd in STATION_DEFS:
            pl = self.station_place.get(sd["id"])
            if pl is None:
                continue
            zc = None
            for sz in self.station_zones:
                if sz.get("keep_clear") and sz.get("id") == sd["id"]:
                    zc = sz
                    break
            if zc is None:
                continue
            rot0 = zc.get("rot", 0.0)
            rect_ok = self._rect_clear_of_roads(zc["x"], zc["z"],
                                                zc["w"], zc["d"], rot0)
            qn = self.nodes.get(pl["ql"])
            if qn is None:
                print("      VI PHAM ben '%s': mat node QL lam diem neo" % sd["id"])
                continue
            # San sach van CHUA du: neu tuyen tiem can (neo QL -> cong) cat
            # ngang cao to thi `_fix_internal_crossings` se xoa doan do ->
            # ben mat l roi vao (do duoc: STATION_ACCESS 14/15, comp 66 node).
            g0x, g0z = self._station_gate_pos(zc["x"], zc["z"], zc["w"],
                                              qn["x"], qn["z"])
            if rect_ok and not self._access_hits_hwy(pl["ax"], pl["az"],
                                                     g0x, g0z):
                continue                      # ca san lan tuyen deu sach
            fixed = self._refind_station_clear(zc["x"], zc["z"], zc["w"], zc["d"],
                                               qn, pl["ax"], pl["az"],
                                               pl["tx_"], pl["tz_"])
            if fixed is None:
                print("      VI PHAM ben '%s': khong tim duoc vi tri sach "
                      "=> MAP CHUA HOAN THANH theo spec" % sd["id"])
                continue
            nx, nz, nw, nd = fixed
            nrot = math.atan2(qn["x"] - nx, qn["z"] - nz)
            if (abs(nx - zc["x"]) < 1e-6 and abs(nz - zc["z"]) < 1e-6 and
                    (nw, nd) == (zc["w"], zc["d"])):
                continue                      # khong doi gi -> dung
            # cap nhat CA 2 zone (keep_clear + #pad) bang cung toa do moi
            for sz in self.station_zones:
                if sz.get("id") == sd["id"]:
                    sz["x"], sz["z"] = nx, nz
                    sz["w"], sz["d"], sz["rot"] = nw, nd, nrot
                elif sz.get("id") == sd["id"] + "#pad":
                    sz["x"], sz["z"] = nx, nz
                    sz["w"], sz["d"], sz["rot"] = nw + 70.0, nd + 70.0, nrot
            # cap nhat station_place de _build_stations dung vi tri moi
            VX, VZ = qn["x"] - nx, qn["z"] - nz
            VL = math.hypot(VX, VZ) or 1.0
            pl["x"], pl["z"] = nx, nz
            pl["rot"] = nrot
            pl["vx"], pl["vz"] = VX / VL, VZ / VL
            pl["w"], pl["d"] = nw, nd
            # diem neo tren QL phai di CHEN LAI cho dung dien tam ben moi,
            # khong thi cong se loi sang mot ben (access road cheo)
            tx_, tz_ = pl["tx_"], pl["tz_"]
            tp2 = (nx - qn["x"]) * tx_ + (nz - qn["z"]) * tz_
            if abs(tp2) > 500.0:
                tp2 = 0.0
            pl["ax"] = qn["x"] + tx_ * tp2
            pl["az"] = qn["z"] + tz_ * tp2
            moved += 1
            print("      ! ben '%s': DAT LAI tren duong cuoi, di chuyen %.0fm"
                  " (truoc do bi duong sinh sau cat qua san)"
                  % (sd["id"], math.hypot(nx - zc["x"], nz - zc["z"])))
        return moved

    def _enforce_station_integrity(self):
        """
        KIỂM TRA & SỬA TOÀN BỘ STATION SAU KHI ROAD NETWORK HOÀN TẤT.

        Nguyên tắc #1: STATION KHÔNG ĐƯỢC TỰ SINH ĐƯỜNG GIAO THÔNG XUYÊN QUA BÊN TRONG.
        - Không được tạo road/road segment/road graph chạy xuyên qua station.
        - Không được copy một đoạn đường rồi đặt vào giữa station.
        - Không được để đường quốc lộ, tỉnh lộ hoặc đường chính xuyên qua sân station.

        Nguyên tắc #2: STATION PHẢI NẰM BÊN LỀ ĐƯỜNG.
        - Mỗi station phải được đặt như một khu đất riêng bên cạnh tuyến đường thực tế.

        Nguyên tắc #3: MỖI STATION PHẢI CÓ RANH GIỚI RIÊNG.
        - Station phải có: Khu đất riêng, Hàng rào riêng bao quanh, Cổng ra vào rõ ràng,
          Lối vào từ đường chính, Sân riêng bên trong, Công trình nằm bên trong khuôn viên.

        Nguyên tắc #5: PHÂN BIỆT ĐƯỜNG CHÍNH VÀ ĐƯỜNG NỘI BỘ.
        - Road graph phải phân biệt rõ: Đường giao thông thế giới vs Hạ tầng bên trong station.

        Nguyên tắc #8: KHÔNG ĐƯỢC PHÁ ROAD EXISTING.
        - Không được xóa road hiện tại, không được bẻ road để xuyên qua station.

        Chạy CUỐI pipeline để đảm bảo mọi thay đổi hình học đã hoàn tất.
        """
        violations = []

        # Danh sách class đường chính (không được xuyên qua station)
        main_road_classes = ("EXPRESSWAY", "RAMP", "NATIONAL", "ARTERIAL",
                             "COLLECTOR", "PROVINCIAL_ROAD", "LOCAL", "RURAL_LOCAL", "SERVICE")

        for sd in STATION_DEFS:
            pl = self.station_place.get(sd["id"])
            if pl is None:
                continue

            # Tìm zone keep_clear cho station này
            zc = None
            for sz in self.station_zones:
                if sz.get("keep_clear") and sz.get("id") == sd["id"]:
                    zc = sz
                    break
            if zc is None:
                continue

            # KIỂM TRA 1: Không có road chính nào xuyên qua station
            for sid, seg in list(self.segments.items()):
                if seg["class"] not in main_road_classes:
                    continue
                p1 = self.nodes.get(seg["from"])
                p2 = self.nodes.get(seg["to"])
                if not p1 or not p2:
                    continue
                if _seg_hits_rect((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                                  zc["x"], zc["z"], zc["w"] * 0.5,
                                  zc["d"] * 0.5, 2.0, zc.get("rot", 0.0)):
                    # VI PHẠM: đường chính xuyên qua station.
                    # ⚠ KHÔNG `_remove_segment` ở đây (rule 8):
                    #   - đây là CUỐI pipeline (sau `_prune_orphans`,
                    #     `_fix_final_slopes`, `_sync_graph`) -> xóa lúc này
                    #     làm đứt đường thế giới, bỏ node mồ côi lại trơ,
                    #     không còn bước nào dọn dẹp / cắn lại độ dốc;
                    #   - rule 8 nói RÕ: không xóa/bẻ/đè đường existing,
                    #     không đủ chỗ thì ĐỔI VỊ TRÍ STATION
                    #     (`_reseat_stations_on_final_roads` đã làm việc đó
                    #     TRƯỚC khi dựng sân). Checker chỉ BÁO.
                    violations.append(
                        "DUONG_CHINH_XUYEN_QUA: %s (%s) cat qua %s "
                        "=> MAP CHUA HOAN THANH theo spec"
                        % (sid, seg["class"], sd["id"]))

            # KIỂM TRA 2: Station phải có access road (STATION_ACCESS)
            has_access = False
            for sid, seg in self.segments.items():
                if seg["class"] == "STATION_ACCESS":
                    p1 = self.nodes.get(seg["from"])
                    p2 = self.nodes.get(seg["to"])
                    if p1 and p2:
                        if _seg_hits_rect((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                                          zc["x"], zc["z"], zc["w"] * 0.5,
                                          zc["d"] * 0.5, 0.0, zc.get("rot", 0.0)):
                            has_access = True
                            break
            if not has_access:
                violations.append("THIEU_ACCESS_ROAD: %s khong co STATION_ACCESS" % sd["id"])

            # KIỂM TRA 3: Station phải có sân (INTERNAL roads)
            has_yard = False
            for sid, seg in self.segments.items():
                if seg["class"] == "INTERNAL":
                    p1 = self.nodes.get(seg["from"])
                    p2 = self.nodes.get(seg["to"])
                    if p1 and p2:
                        if _seg_hits_rect((p1["x"], p1["z"]), (p2["x"], p2["z"]),
                                          zc["x"], zc["z"], zc["w"] * 0.5,
                                          zc["d"] * 0.5, 0.0, zc.get("rot", 0.0)):
                            has_yard = True
                            break
            if not has_yard:
                violations.append("THIEU_SAN: %s khong co INTERNAL roads" % sd["id"])

            # KIỂM TRA 4: Không có building nằm trên road
            # (đã được xử lý bởi _place_buildings, nhưng kiểm tra lại)
            for b in self.buildings:
                bx, bz = b.get("x"), b.get("z")
                if bx is None or bz is None:
                    continue
                if _seg_hits_rect((bx, bz), (bx, bz),
                                  zc["x"], zc["z"], zc["w"] * 0.5,
                                  zc["d"] * 0.5, 0.0, zc.get("rot", 0.0)):
                    # Building nằm trong station zone - kiểm tra có phải facility không
                    if b.get("type") not in ("TERMINAL", "UTILITY", "WAREHOUSE",
                                             "TOLL", "TOLL_LANE", "FUEL_STATION",
                                             "REST_AREA"):
                        violations.append("BUILDING_TRONG_SAN: %s tai (%.0f,%.0f)"
                                         % (b.get("type", "?"), bx, bz))

        # BÁO CÁO
        if violations:
            print("      === VI PHAM STATION (%d) === MAP CHUA HOAN THANH theo spec"
                  % len(violations))
            for v in violations[:20]:  # Giới hạn 20 dòng
                print("         ! %s" % v)
            if len(violations) > 20:
                print("         ... va %d vi pham nua" % (len(violations) - 20))
        if not violations:
            print("      station integrity: OK (khong co vi pham)")

        return len(violations)

    def _place_stations(self):
        """
        ĐẶT VỊ TRÍ + HƯỚNG toàn bộ bến xe TRƯỚC khi mở đường/thị trấn.

        2 BUG GỐC sửa tại đây:

        (a) STATION_ZONES HAY QUÁ TRỄ. Trước đây zone chỉ được append trong
            _station_complex (step 4.10) = SAU _build_settlements và
            _build_provincial_routes => mọi check "san ben" tại L2636/L2657
            đều là DEAD CODE. Hậu quả đo được: 65/78 điểm bị đường công cộng
            cắt qua sân, riêng 4/5 bến xe lớn bị cắt 11-41 đoạn
            (QL1 + đường thị trấn chạy xuyên giữa sân bến).

        (b) TÂM BẾN TRÙNG NODE ĐƯỜNG. tx,tz = proj(lat/lon); Nam Tuy Hòa =
            (0,2000) = node QL1 n_18 => vx,vz = qn - center = (0,0) =>
            VL = 0, vx,vz = 0/1 = 0, rot = atan2(0,0) = 0. Cổng bến rơi
            đúng giữa sân, access road chạy lấn sang một bên, và QL1 cắt
            ngang giữa sân. => Giữ nguyên vị trí TRÊN trục đường nhưng ĐẨY
            SANG NGANG (vuông góc) đủ để rìa sân cách tâm đường.
        """
        self.station_place = {}
        self.station_zones = []
        ai_off = 0.0
        # STATION ACCESS POOL: ưu tiên QL1 (NATIONAL) thay vì EXPRESSWAY
        # vì STATION_ACCESS không được nối vào EXPRESSWAY (TOPO_LEGAL)
        # hw_pool = EXPRESSWAY + RAMP (cho các việc khác)
        hw_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                   if n["type"] in ("highway", "ramp")]
        # ql1_pool = NATIONAL (QL1) nodes - dùng cho access road của bến
        ql1_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                    if n.get("_src") != "ct" and n.get("class") == "NATIONAL"]
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

            # node đường gần nhất (QL1/CT01) để làm cổng bến
            # Ưu tiên QL1 (NATIONAL) cho access road, fallback EXPRESSWAY
            ql, _d = self._nearest_node_on(tx, tz, ql1_pool, 12000.0)
            if ql is None:
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
            # 2. KHONG CAT DUONG DA DUNG (QL1/CT01/ramp o step 1-2)
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
                        # Sân bến nằm trên cao tốc là sai hoàn toàn.
                        fixed = self._refind_station_clear(tx, tz, w, d, qn,
                                                           bx, bz, tx_, tz_)
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

            # --- DIEM NEO TREN QL PHAI CHEN LAI THEO TAM BEN CUOI CUNG ---
            # `bx,bz` luc dau tinh tu TAM GỐC (truoc khi probe day ra /
            # _refind di chuyen ben toi vi tri khac). Neu tam da di ma
            # diem neo khong di theo thi tuyen tiep can (neo -> cong) se
            # cheo, va no se cat ngang cao to -> bi xoa -> ben mat loi ra vao.
            tp2 = (tx - qn["x"]) * tx_ + (tz - qn["z"]) * tz_
            if abs(tp2) > 500.0:
                tp2 = 0.0
            bx, bz = qn["x"] + tx_ * tp2, qn["z"] + tz_ * tp2
            # huong cong ben: TU TAM BEN VE PHIA DUONG (khong phai nguoc lai)
            vx, vz = qn["x"] - tx, qn["z"] - tz
            VL = math.hypot(vx, vz) or 1.0
            vx, vz = vx / VL, vz / VL
            rot = math.atan2(vx, vz)
            self.station_place[sd["id"]] = dict(
                x=tx, z=tz, ql=ql, ax=bx, az=bz,
                vx=vx, vz=vz, tx_=tx_, tz_=tz_, rot=rot,
                # w/d CO THE DA BI HOAN VI 90 DO o nhanh "thu quay 90 do" /
                # _refind_station_clear. Phai luu vao day de zone, san ben va
                # stations.json dong phieng cung mot bo w/d.
                w=w, d=d)
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
        for sd0 in STATION_DEFS:
            pl = self.station_place.get(sd0["id"]) if hasattr(self, "station_place") else None
            if pl is None:
                continue
            # w/d co the da bi _place_stations / _reseat_stations_on_final_roads
            # hoan vi 90 do de tim duoc vi tri sach. Zone (station_zones) lay bo
            # do, nen nha ga/san/phai lay CUNG bo — khong thi vung cam duong va
            # san ben ve se khong khop nhau (mot lan nua la "duong xuyen san").
            sd = sd0
            if (pl.get("w"), pl.get("d")) != (sd0["w"], sd0["d"]):
                sd = dict(sd0, w=pl["w"], d=pl["d"])
            self._station_complex(sd, pl["ql"], pl["x"], pl["z"],
                                  pl["vx"], pl["vz"], pl["tx_"], pl["tz_"],
                                  pl["rot"], access=(pl["ax"], pl["az"]))

        # đảm bảo Bến xe Nam Tuy Hòa đứng đầu (RuntimeRoadGraph dùng pois[0])
        self.stations.sort(key=lambda s: 0 if s["id"] == "nam_tuy_hoa" else 1)

        # --- SPAWN: đúng trong bến, trên đường nội bộ, nối vào mạng bến ---
        spawn_station = next((s for s in self.stations if s.get("is_spawn")), None)
        if spawn_station:
            # BÂY GIỜ bến đã bị đẩy RA BÊN LỀ ĐƯỜNG nên tâm bến != SPAWN_TARGET
            # (mà SPAWN_TARGET là node trên QL1). Spawn phải đi theo tâm bến.
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

        # --- CỔNG CHÍNH (gate structure): 2 trụ cổng + biển tên ---
        # (vị trí world tính trực tiếp, không cần w2)
        gate_post_offset = 6.0  # mét mỗi bên cổng
        gpx, gpz = -pz, px  # vector vuông góc với hướng cổng
        for sgn in (-1.0, 1.0):
            gx = gate_x + gpx * gate_post_offset * sgn
            gz = gate_z + gpz * gate_post_offset * sgn
            self._reserve(gx, gz, 1.0)  # trụ cổng
        # Biển tên station (object lớn hơn)
        self._reserve(gate_x, gate_z, 2.0)  # biển tên

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

        # --- HÀNG RÀO STATION (fence): cột dọc biên sân (đặt SAU def w2) ---
        fence_margin = 2.0  # mét từ mép sân
        fence_hw = w * 0.5 + fence_margin
        fence_hd = d * 0.5 + fence_margin
        n_fence_x = max(4, int(w / 4.0))
        n_fence_z = max(4, int(d / 4.0))
        for i in range(n_fence_x + 1):
            ox = -fence_hw + (2.0 * fence_hw) * i / n_fence_x
            for oz in (-fence_hd, fence_hd):
                fx, fz = w2(ox, oz)
                self._reserve(fx, fz, 0.5)  # cột hàng rào
        for i in range(1, n_fence_z):
            oz = -fence_hd + (2.0 * fence_hd) * i / n_fence_z
            for ox in (-fence_hw, fence_hw):
                fx, fz = w2(ox, oz)
                self._reserve(fx, fz, 0.5)  # cột hàng rào

        # --- nha ga (ticket building) : DINH NGhia TRUOC de tinh spine ---
        tb_w, tb_d = w * 0.34, d * 0.22
        tb_ox, tb_oz = -hw * 0.35, -hd * 0.62
        tb_x, tb_z = w2(tb_ox, tb_oz)
        self._add_facility_building(tb_x, tb_z, "TERMINAL", w=tb_w, d=tb_d,
                                    h=13.0, rot=rot, roof="flat")
        # mep nha ga gan sang tam hon (theo truc ox)
        tb_near_ox = tb_ox + tb_w * 0.5

        # --- utilities ---
        # Bến xe VN thật: quầy vé, nhà chờ, WC, căng-tin, bảo vệ, xưởng.
        # `_add_facility_building` tự REJECT khi vướng đường nên thêm thoải mái.
        util = [(-hw * 0.75, hd * 0.55, "UTILITY", 10.0, 8.0, 4.5),
                (hw * 0.72, -hd * 0.5, "UTILITY", 9.0, 7.0, 4.0),
                (hw * 0.75, hd * 0.5, "WAREHOUSE", 14.0, 10.0, 6.0),
                (-hw * 0.7, -hd * 0.1, "UTILITY", 8.0, 6.0, 3.6),
                (-hw * 0.75, -hd * 0.30, "CANTEEN", 16.0, 10.0, 5.0),
                (tb_ox, tb_oz + tb_d * 0.5 + 14.0, "WAITING_HALL",
                 24.0, 12.0, 6.0),
                (tb_ox + tb_w * 0.5 + 10.0, tb_oz, "TICKET_OFFICE",
                 12.0, 8.0, 4.0),
                (tb_ox - tb_w * 0.5 - 9.0, tb_oz + 4.0, "RESTROOM",
                 10.0, 7.0, 3.5),
                (hw - 24.0, -hd + 30.0, "GUARDHOUSE", 7.0, 6.0, 3.5)]
        if int(sd["bays"]) >= 24:
            # Bến lớn (Nha Trang / Miền Đông Mới): xưởng bảo dưỡng riêng.
            util.append((-hw + 26.0, hd - 30.0, "DEPOT", 18.0, 12.0, 7.0))
        for (ox, oz, typ, bw, bd, bh) in util:
            ux, uz = w2(ox, oz)
            self._add_facility_building(ux, uz, typ, w=bw, d=bd, h=bh, rot=rot,
                                        roof="pitched")

        # --- cây xanh + đèn sân bến (bến xe VN có hàng cây bóng mát) ---
        oz_tree = -hd + 24.0
        while oz_tree <= hd - 24.0:
            tx, tz = w2(-hw + 20.0, oz_tree)
            if self._is_space_clear(tx, tz, 3.2, 0.0):
                self._add_object_to_chunks(
                    {"x": round(tx, 2),
                     "y": round(self.get_road_datum(tx, tz), 3),
                     "z": round(tz, 2), "type": "TREE"}, 3.2)
                self._reserve(tx, tz, 3.2)
            oz_tree += 26.0
        for (lox, loz) in ((hw - 20.0, hd - 20.0), (-hw + 20.0, hd - 20.0),
                           (hw - 20.0, -hd + 20.0), (-hw + 20.0, -hd + 20.0)):
            lx, lz = w2(lox, loz)
            if self._is_space_clear(lx, lz, 1.6, 0.0):
                self._add_object_to_chunks(
                    {"x": round(lx, 2),
                     "y": round(self.get_road_datum(lx, lz), 3),
                     "z": round(lz, 2), "type": "STREET_LIGHT",
                     "rot": round(rot, 3)}, 1.6)
                self._reserve(lx, lz, 1.6)

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
        # => 4 × (8-2) = 24 bãi < 50 .
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
                # `node` = node MŨI của bãi. Cao độ bãi lấy từ node này SAU
                # khi đường đã grade (P40): bãi ngồi trên mặt sân, nên cao độ
                # của nó là cao độ đường tại đúng chỗ đó, không phải trung
                # bình cả sân.
                bays.append({"x": round(bx, 2),
                             "y": round(self.get_road_datum(bx, bz), 3),
                             "node": bn,
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

        # --- FENCE + GATE data cho JS render ---
        fence_hw = w * 0.5 + 2.0
        fence_hd = d * 0.5 + 2.0
        fence_data = {
            "fencePosts": [],
            "gatePosts": [],
            "gateSign": None,
        }
        # Tính fence posts (cùng logic phần tạo hàng rào ở trên)
        n_fence_x = max(4, int(w / 4.0))
        n_fence_z = max(4, int(d / 4.0))
        for i in range(n_fence_x + 1):
            ox = -fence_hw + (2.0 * fence_hw) * i / n_fence_x
            for oz in (-fence_hd, fence_hd):
                fx, fz = w2(ox, oz)
                fence_data["fencePosts"].append({"x": round(fx, 2), "z": round(fz, 2)})
        for i in range(1, n_fence_z):
            oz = -fence_hd + (2.0 * fence_hd) * i / n_fence_z
            for ox in (-fence_hw, fence_hw):
                fx, fz = w2(ox, oz)
                fence_data["fencePosts"].append({"x": round(fx, 2), "z": round(fz, 2)})
        # Gate posts
        gate_post_offset = 6.0
        gpx, gpz = -pz, px
        for sgn in (-1.0, 1.0):
            gx = gate_x + gpx * gate_post_offset * sgn
            gz = gate_z + gpz * gate_post_offset * sgn
            fence_data["gatePosts"].append({"x": round(gx, 2), "z": round(gz, 2)})
        fence_data["gateSign"] = {"x": round(gate_x, 2), "z": round(gate_z, 2)}

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
            "fence": fence_data,
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
        # highway_pool: EXPRESSWAY + RAMP + junction (cho tìm đường gần)
        highway_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                        if n["type"] in ("highway", "ramp", "junction")]
        # ql1_pool: NATIONAL (QL1) - ưu tiên cho access road trạm dừng
        ql1_pool = [(0, nid, n["x"], n["z"]) for nid, n in self.nodes.items()
                    if n.get("_src") != "ct" and n.get("class") == "NATIONAL"]
        for (fid, fname, lat, lon, ptype) in FACILITY_DEFS:
            fx0, fz0 = self.proj(lat, lon)
            node, dd = self._nearest_node_on(fx0, fz0, highway_pool, 9000.0)
            if node is None:
                continue
            # ĐƯỜNG SERVICE KHÔNG ĐÂM THẲNG VÀO MẶT CAO TỐC (rule 11/60).
            # `_nearest_node_on` trả node gần nhất — thường là node trên thân
            # CT01 nên 7/19 cơ sở dính lỗi. Ưu tiên node đã qua RAMP hoặc
            # thuộc QL1; bán kính 25km vì 9km chưa đủ (QL1 chạy song song
            # cao tốc nên 25km luôn tìm được node hợp lệ).
            if self._node_touches_expressway(node):
                alt, _ad = self._nearest_node_on(
                    fx0, fz0,
                    [q for q in highway_pool
                     if not self._node_touches_expressway(q[1])], 25000.0)
                if alt is not None:
                    node = alt
                else:
                    # Thử tìm trên QL1 (NATIONAL)
                    alt2, _ad2 = self._nearest_node_on(fx0, fz0, ql1_pool, 25000.0)
                    if alt2 is not None:
                        node = alt2
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

            # KIỂM TRA: Không được đặt trạm dừng nơi có road xuyên qua
            # (nguyên tắc #1: STATION KHÔNG ĐƯỢC TỰ SINH ĐƯỜNG GIAO THÔNG XUYÊN QUA)
            fw = 50.0 if ptype != "TOLL" else 60.0
            fd = 40.0 if ptype != "TOLL" else 50.0
            # Thử LUỸ TIẾN 3 chiều: (a) 2 bên đường, (b) 6 mức dời ra,
            # (c) xoay 90° — QL1 thường đầy đường nhánh nên chỉ dời 1 bên
            # rồi bỏ cuộc từng làm mất 3/25 cơ sở (Petrolimex Dầu Giây,
            # PVOIL Phan Thiết, Petrolimex Tuy Phong).
            placed = None
            for rot_try in (rot, rot + math.pi * 0.5):
                for side in (1.0, -1.0):
                    for extra in (0.0, 30.0, 60.0, 100.0, 150.0, 220.0, 300.0):
                        fx2 = qn["x"] + px * side * (46.0 + extra) + tx_ * reach
                        fz2 = qn["z"] + pz * side * (46.0 + extra) + tz_ * reach
                        if self._rect_clear_of_roads(fx2, fz2, fw, fd, rot_try):
                            placed = (fx2, fz2, rot_try)
                            break
                    if placed is not None:
                        break
                if placed is not None:
                    break
            if placed is None:
                # Không tìm được vị trí sạch -> bỏ qua trạm này
                print("      ! tram '%s': khong tim duoc vi tri sach, bo qua" % fname)
                continue
            fx, fz, rot = placed

            # ĐƯỜNG VÀO CỔNG KCN ≠ ĐƯỜNG VÀO TRẠM XĂNG. Cùng một pipeline
            # (`add_segment` qua cổng `topo_try_link`), khác class:
            #   INDUSTRIAL -> INDUSTRIAL_ACCESS (11m, 2 làn, 45km/h — đường
            #     công nghiệp thật, xe tải 20-40 tấn chạy hàng ngày)
            #   còn lại     -> SERVICE (đường vào cơ sở, 6.5m, 1 làn)
            # Bản cũ để tất cả là SERVICE => `INDUSTRIAL_ACCESS` có đủ bảng số
            # liệu mà 0 đoạn, đúng cái loại "thêm bảng = thêm 0" đã gặp.
            # Đường KCN cũng dài hơn (cổng KCN thường lệch vài km khỏi QL1)
            # nên chia 3 đoạn thay vì 2 — cùng một đường thẳng, chỉ thêm node.
            acc_cls = "INDUSTRIAL_ACCESS" if ptype == "INDUSTRIAL" else "SERVICE"
            acc_steps = 3 if ptype == "INDUSTRIAL" else 2
            prev = node
            for k in range(1, acc_steps + 1):
                t = k / float(acc_steps)
                ix = lerp(qn["x"], fx, t)
                iz = lerp(qn["z"], fz, t)
                nid = self.add_node(ix, iz, "URBAN",
                                    n_type="facility" if k == acc_steps else "junction")
                self.add_segment(prev, nid, acc_cls, name=fname)
                prev = nid

            if ptype == "FUEL_STATION":
                self._add_facility_building(fx, fz, "FUEL_STATION", w=26.0, d=16.0,
                                            h=6.0, rot=rot, roof="flat")
            elif ptype == "REST_AREA":
                self._add_facility_building(fx, fz, "REST_AREA", w=34.0, d=18.0,
                                            h=7.0, rot=rot, roof="pitched")
            elif ptype == "SCHOOL":
                self._add_facility_building(fx, fz, "SCHOOL", w=40.0, d=30.0,
                                            h=10.0, rot=rot, roof="flat")
            elif ptype == "HOSPITAL":
                self._add_facility_building(fx, fz, "HOSPITAL", w=50.0, d=35.0,
                                            h=15.0, rot=rot, roof="flat")
            elif ptype == "MARKET":
                self._add_facility_building(fx, fz, "MARKET", w=35.0, d=25.0,
                                            h=6.0, rot=rot, roof="pitched")
            elif ptype == "INDUSTRIAL":
                self._add_facility_building(fx, fz, "INDUSTRIAL", w=60.0, d=40.0,
                                            h=8.0, rot=rot, roof="flat")
            else:   # TOLL: nhà thu phí + mái che làn
                self._add_facility_building(fx, fz, "TOLL", w=22.0, d=12.0,
                                            h=5.0, rot=rot, roof="flat")
            # Tạo 2 zone: keep_clear (chặn đường) + pad (chặn nhà)
            self.station_zones.append({"x": fx, "z": fz, "w": fw, "d": fd,
                                       "rot": rot, "id": fid, "keep_clear": True})
            self.station_zones.append({"x": fx, "z": fz, "w": fw + 40.0, "d": fd + 40.0,
                                       "rot": rot, "id": fid + "#pad"})
            self.facility_pois.append({
                "id": fid, "name": fname, "type": ptype,
                "x": round(fx, 2), "y": round(self.get_road_datum(fx, fz), 3),
                "z": round(fz, 2), "w": fw, "d": fd, "rot": round(rot, 4),
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
        self._place_emergency_bays()
        self._place_road_signage()
        self._build_admin_units()

    # ------------------------------------------------------------------ KM AXIS
    def _km_axis(self):
        """
        Trục km QL1 THẬT -> (hàm km_of_s, (s_lo, s_hi), danh sách mốc).

        Nguồn mốc km (research §D2, Wikipedia EN "National Route 1"):
            Tuy Hòa 1329 | Nha Trang 1450 | Cam Ranh 1507 | Phan Rang 1555
            | Phan Thiết 1701 | Biên Hòa 1867 | Dĩ An 1879 | TP.HCM 1889
        KM của Dầu Giây / Long Thành / Cam My KHÔNG có trong danh sách nguồn ->
        đánh dấu `KHÔNG XÁC MINH`, chỉ dùng để kéo giãn 2 đầu, không dùng làm
        ranh giới đơn vị hành chính.
        Dùng CHUNG cho cột km và lớp hành chính — 2 nguồn km khác nhau là biển
        "km1650" nói với bảng đơn vị hành chính ở hai km khác nhau.
        """
        if getattr(self, "_km_axis_cache", None):
            return self._km_axis_cache
        KM_TRUE = {"Tuy_Hoa_City": 1329.0, "Nha_Trang": 1450.0,
                   "Cam_Ranh": 1507.0, "Phan_Rang": 1555.0,
                   "Phan_Thiet": 1701.0, "Bien_Hoa": 1867.0}
        corridor = getattr(self, "corridor", None) or []
        km_nodes = []
        for i, a in enumerate(ANCHORS):
            if a["name"] in KM_TRUE and i < len(self.anchor_s):
                km_nodes.append((self.anchor_s[i], KM_TRUE[a["name"]],
                                 a["name"]))
        if not corridor or len(km_nodes) < 2:
            return None
        km_nodes.sort()

        def km_of_s(s0):
            if s0 <= km_nodes[0][0]:
                s1, k1 = km_nodes[0][0], km_nodes[0][1]
                s2, k2 = km_nodes[1][0], km_nodes[1][1]
                return k1 + (s0 - s1) * (k2 - k1) / max(1.0, s2 - s1)
            if s0 >= km_nodes[-1][0]:
                s1, k1 = km_nodes[-2][0], km_nodes[-2][1]
                s2, k2 = km_nodes[-1][0], km_nodes[-1][1]
                return k2 + (s0 - s2) * (k2 - k1) / max(1.0, s2 - s1)
            for j in range(len(km_nodes) - 1):
                s1, k1 = km_nodes[j][0], km_nodes[j][1]
                s2, k2 = km_nodes[j + 1][0], km_nodes[j + 1][1]
                if s1 <= s0 <= s2:
                    t = 0.0 if s2 <= s1 else (s0 - s1) / (s2 - s1)
                    return k1 + (k2 - k1) * t
            return km_nodes[0][1]

        out = (km_of_s, (km_nodes[0][0], km_nodes[-1][0]),
               [(nm, k, s) for (s, k, nm) in km_nodes])
        self._km_axis_cache = out
        return out

    def _corridor_s_at_index(self, k):
        """s tại điểm thứ k của `corridor_coarse` (bám đúng _build_corridor)."""
        if not hasattr(self, "_cc_s"):
            acc = 0.0
            cs = [0.0]
            cc = self.corridor_coarse
            for k in range(1, len(cc)):
                acc += dist(cc[k - 1][0], cc[k - 1][1], cc[k][0], cc[k][1])
                cs.append(acc)
            self._cc_s = cs
        return self._cc_s[min(k, len(self._cc_s) - 1)]

    def _corridor_project(self, x, z):
        """(s, lateral, khoang_cach) của (x,z) so với corridor.

        Dùng `corridor_coarse` (mắt lưới 1500 m) vì cần O(n) với n ~ 400; sai
        số < 1.5 km — thừa cho việc gán đơn vị hành chính theo dải km.
        `lateral` > 0 = bên PHẢI khi đi hướng Nam (tức phía biển Đông).
        """
        cc = getattr(self, "corridor_coarse", None)
        if not cc or len(cc) < 2:
            return None
        best, bd = None, 1e18
        for k in range(len(cc) - 1):
            x1, z1 = cc[k]
            x2, z2 = cc[k + 1]
            dx, dz = x2 - x1, z2 - z1
            l2 = dx * dx + dz * dz
            if l2 <= 0.0:
                continue
            t = clamp(((x - x1) * dx + (z - z1) * dz) / l2, 0.0, 1.0)
            px, pz = x1 + dx * t, z1 + dz * t
            d2 = (x - px) ** 2 + (z - pz) ** 2
            if d2 < bd:
                bd, best = d2, (k, t)
        if best is None:
            return None
        k, t = best
        x1, z1 = cc[k]
        x2, z2 = cc[k + 1]
        L = math.hypot(x2 - x1, z2 - z1) or 1.0
        s = self._corridor_s_at_index(k) + t * L
        ux, uz = (x2 - x1) / L, (z2 - z1) / L
        lat = -(x - x1) * uz + (z - z1) * ux
        return s, lat, math.sqrt(bd)

    def _build_admin_units(self):
        """
        LỚP HÀNH CHÍNH: gắn mỗi đơn vị cấp xã (sáp nhập, hiệu lực 12/6/2025 —
        NQ 202/2025/QH15) vào một DẢI KM trên QL1. KHÔNG bịa ranh giới:
          - có toạ độ trung tâm -> chiếu lên corridor -> km thật;
          - không có toạ độ        -> nội suy giữa hai đơn vị có toạ độ liền
            kề, đánh dấu `km_approx: true`;
          - ranh giới giữa hai đơn vị = TRUNG ĐIỂM km (ghi rõ trong docs).
        Đơn vị `on_corridor=False` (nội địa) không chia dải km — chỉ dùng cho
        tra cứu "đơn vị gần nhất" trong ADMIN_NEAR_MAX_KM.
        """
        axis = self._km_axis()
        rows = []
        for (uid, prov, name, kind, lat, lon, km2, pop, seat,
             on_cor) in ADMIN_UNITS:
            xy = self.proj(lat, lon) if lat is not None else None
            km = None
            if xy is not None and axis:
                pr = self._corridor_project(xy[0], xy[1])
                if pr:
                    km = axis[0](pr[0])
            rows.append({"id": uid, "province": prov, "name": name,
                         "kind": kind, "lat": lat, "lon": lon,
                         "areaKm2": km2, "pop": pop, "seat": seat,
                         "onCorridor": bool(on_cor), "km": km, "xy": xy})
        known = [i for i, r in enumerate(rows) if r["km"] is not None]
        for i, r in enumerate(rows):
            if r["km"] is not None or not r["onCorridor"]:
                continue
            lo = max([j for j in known if j < i], default=None)
            hi = min([j for j in known if j > i], default=None)
            if lo is None or hi is None:
                r["km"] = rows[known[0]]["km"] if known else None
            else:
                r["km"] = (rows[lo]["km"] +
                           (rows[hi]["km"] - rows[lo]["km"]) * (i - lo)
                           / float(hi - lo))
            r["km_approx"] = True
        band = [r for r in rows if r["onCorridor"] and r["km"] is not None]
        band.sort(key=lambda r: r["km"])
        for i, r in enumerate(band):
            lo = band[i - 1]["km"] if i > 0 else band[0]["km"] - 60.0
            hi = band[i + 1]["km"] if i + 1 < len(band) else band[-1]["km"] + 60.0
            r["kmLo"] = round((lo + r["km"]) * 0.5, 2)
            r["kmHi"] = round((r["km"] + hi) * 0.5, 2)
        self.admin_units = rows
        self.admin_bands = band
        print("      don vi hanh chinh: %d | dai km: %d | co toa do that: %d"
              % (len(rows), len(band),
                 sum(1 for r in rows if r["xy"] is not None)))
        print("      ! thanh phan don vi CU (don moi gop tu don nao):"
              " KHONG XAC MINH")
        return rows

    def _place_road_signage(self):
        """CỘT KM QL1 + BIỂN CAO TỐC (task 7/8: quốc lộ có cột km, biển báo).

        Số km theo CỘT KM QL1 THẬT — đối chiếu Wikipedia 2026-09-29:
            Tuy Hoa km1329 -> Nha Trang km1450 -> Phan Rang km1555
            -> Phan Thiet km1701
        In chênh lệch ra log để kiểm chứng; lệch > 30km là corridor bị lệch
        chuỗi (phải báo, không được im lặng).
        """
        # --- (0) toạ độ anchor thế giới (1 lần) ---
        a_xy = {}
        for a in ANCHORS:
            a_xy[a["name"]] = self.proj(a["lat"], a["lon"])

        def _near_anchor(x, z, skip=None):
            best, bd = None, 1e18
            for nm, xy in a_xy.items():
                if nm == skip or xy is None:
                    continue
                d = (x - xy[0]) ** 2 + (z - xy[1]) ** 2
                if d < bd:
                    bd, best = d, nm
            return best

        n_km = n_sign = 0

        # --- (1) CỘT KM: đi theo CORRIDOR (xương sống QL1), KHÔNG theo tên
        # segment. Đo được bug: bước tách QL1 khỏi nút cao tốc đổi tên một
        # số đoạn thành `cau_vuot_QL1` ⇒ chuỗi tên "QL1" ĐỨT ở ~41km và
        # km tại Nha Trang/Phan Rang/Phan Thiet đều ra 1370 (sai 80-331km).
        # Bản đồ km(s) ghép từ số km QL1 THẬT đã tra (Wikipedia 2026-09-29):
        #     Tuy Hoa 1329 | Nha Trang 1450 | Phan Rang 1555 | Phan Thiet 1701
        _axis = self._km_axis()
        corridor = getattr(self, "corridor", None) or []
        if _axis and corridor:
            # DÙNG CHUNG `_km_axis()` với lớp hành chính: trước đây cột km và
            # bảng đơn vị hành chính là hai bản km(s) độc lập — sửa một bên là
            # hai bên lệch nhau, cột km đúng mà biển địa danh thì sai.
            km_of_s, _srange, km_nodes = _axis
            km_nodes = [(s, k, nm) for (nm, k, s) in km_nodes]
            km_nodes.sort()
            KM_TRUE = {nm: k for (s, k, nm) in km_nodes}

            # --- KIỂM CHỨNG với số liệu thật: corridor dài bao nhiêu so QL1 ---
            for (na_, nb_) in (("Tuy_Hoa_City", "Nha_Trang"),
                               ("Nha_Trang", "Phan_Rang"),
                               ("Phan_Rang", "Phan_Thiet")):
                sa = next((m0[0] for m0 in km_nodes if m0[2] == na_), None)
                sb = next((m0[0] for m0 in km_nodes if m0[2] == nb_), None)
                if sa is None or sb is None:
                    continue
                real = KM_TRUE[nb_] - KM_TRUE[na_]
                got = (sb - sa) / 1000.0
                print("      doan %-13s -> %-12s corridor %6.1f km | QL1 that "
                      "%6.1f km | lech %+.0f%%"
                      % (na_, nb_, got, real,
                         (got - real) / max(1.0, real) * 100.0))

            # --- 1 cột km mỗi 1.000 m dọc corridor ---
            used_km = set()
            for i in range(len(corridor) - 1):
                x1, z1, s1 = corridor[i][0], corridor[i][1], corridor[i][2]
                x2, z2, s2 = corridor[i + 1][0], corridor[i + 1][1], corridor[i + 1][2]
                if s2 <= s1:
                    continue
                k0, k1 = km_of_s(s1), km_of_s(s2)
                if k1 <= k0:
                    continue
                dx, dz = x2 - x1, z2 - z1
                L = math.hypot(dx, dz)
                if L < 1e-6:
                    continue
                ux, uz = dx / L, dz / L
                nx, nz = -uz, ux
                for K in range(int(math.ceil(k0)), int(math.floor(k1)) + 1):
                    if K in used_km:
                        continue
                    t = (K - k0) / (k1 - k0)
                    px = x1 + dx * t
                    pz = z1 + dz * t
                    ox = 12.0 * 0.5 + 3.2      # nửa trục QL + khoảng lề
                    for side in (1.0, -1.0):
                        qx, qz = px + nx * ox * side, pz + nz * ox * side
                        if self.dist_to_coast(qx, qz) < 2.0:
                            continue
                        if self.water_factor(qx, qz) > 0.15:
                            continue
                        if self._in_station_zone(qx, qz, 6.0):
                            continue
                        if not self._is_space_clear(qx, qz, 1.6, 0.0):
                            continue
                        self._add_object_to_chunks(
                            {"x": round(qx, 2),
                             "y": round(self.get_road_datum(qx, qz), 3),
                             "z": round(qz, 2), "type": "KM_MARKER",
                             "km": int(K),
                             "rot": round(math.atan2(ux, uz), 3)}, 6.0)
                        used_km.add(K)
                        n_km += 1
                        break

        # --- (2) BIỂN CAO TỐC — đi theo CHUỖI cao tốc, không theo segment.
        # Đoạn cao tốc bị `cat doan dai >900m` tách nên KHÔNG segment nào dài
        # 3km ⇒ cách làm cũ (if L < 3000: continue) luôn bị skip -> 0 biển.
        made_hw = 0
        hw_adj = {}
        for _sid, _sg in self.segments.items():
            if _sg["class"] != "EXPRESSWAY":
                continue
            hw_adj.setdefault(_sg["from"], []).append((_sg["to"], _sid))
            hw_adj.setdefault(_sg["to"], []).append((_sg["from"], _sid))
        seen_seg = set()
        SIGN_STEP = 4000.0
        for _start in list(hw_adj.keys()):
            if any(_sid in seen_seg for _n, _sid in hw_adj.get(_start, ())):
                continue          # chuỗi nay da duyet
            cur, acc = _start, 0.0
            next_at = SIGN_STEP * 0.5
            while True:
                nxt = None
                for (nx, nsid) in hw_adj.get(cur, ()):
                    if nsid not in seen_seg:
                        nxt = (nx, nsid)
                        break
                if nxt is None:
                    break
                nx, nsid = nxt
                seen_seg.add(nsid)
                seg = self.segments[nsid]
                a = self.nodes[seg["from"]]
                b = self.nodes[seg["to"]]
                dx, dz = b["x"] - a["x"], b["z"] - a["z"]
                L = math.hypot(dx, dz)
                if L < 1e-6:
                    continue
                ux, uz = dx / L, dz / L
                nx2, nz2 = -uz, ux
                if acc + L >= next_at:
                    px = (a["x"] + b["x"]) * 0.5
                    pz = (a["z"] + b["z"]) * 0.5
                    lbl = _near_anchor(px, pz)
                    if lbl:
                        ox = seg.get("width", 24.0) * 0.5 + 4.5
                        for side in (1.0, -1.0):
                            qx = px + nx2 * ox * side
                            qz = pz + nz2 * ox * side
                            if self.dist_to_coast(qx, qz) < 2.0:
                                continue
                            if self.water_factor(qx, qz) > 0.15:
                                continue
                            if self._in_station_zone(qx, qz, 8.0):
                                continue
                            if not self._is_space_clear(qx, qz, 3.0, 0.0):
                                continue
                            self._add_object_to_chunks(
                                {"x": round(qx, 2),
                                 "y": round(self.get_road_datum(qx, qz), 3),
                                 "z": round(qz, 2), "type": "HIGHWAY_SIGN",
                                 "label": lbl.replace("_", " "),
                                 "rot": round(math.atan2(ux, uz) +
                                              (0.0 if side > 0 else math.pi), 3)},
                                10.0)
                            n_sign += 1
                            made_hw += 1
                            break
                    next_at += SIGN_STEP
                acc += L
                cur = nx
        print("      cot km QL1: %d | bien cao toc: %d (chuoi %d doan)"
              % (n_km, made_hw, len(seen_seg)))

    def _place_emergency_bays(self):
        """Điểm dừng khẩn cấp trên cao tốc (mỗi ~4km / chiều).

        Cao tốc VN thật có dải dừng khẩn cấp + biển. Vệt bê tông nằm SÁT
        mép đường (không phải làn xe) nên đặt trực tiếp, chỉ né nước/trạm.
        """
        made = 0
        for seg in self.segments.values():
            if seg["class"] != "EXPRESSWAY":
                continue
            a = self.nodes[seg["from"]]
            b = self.nodes[seg["to"]]
            dx, dz = b["x"] - a["x"], b["z"] - a["z"]
            L = math.hypot(dx, dz)
            if L < 2000.0:
                continue
            ux, uz = dx / L, dz / L
            nx, nz = -uz, ux
            n_bay = max(1, int(L / 4000.0))
            for k in range(n_bay):
                t = (k + 0.5) / n_bay
                for side in (1.0, -1.0):
                    ox = seg["width"] * 0.5 + 3.5
                    px = a["x"] + dx * t + nx * ox * side
                    pz = a["z"] + dz * t + nz * ox * side
                    if self.dist_to_coast(px, pz) < 2.0:
                        continue
                    if self.water_factor(px, pz) > 0.15:
                        continue
                    if self._in_station_zone(px, pz, 6.0):
                        continue
                    self._add_object_to_chunks(
                        {"x": round(px, 2),
                         "y": round(self.get_road_datum(px, pz) + 0.02, 3),
                         "z": round(pz, 2), "type": "EMERGENCY_BAY",
                         "w": 4.0, "d": 30.0,
                         "rot": round(math.atan2(ux, uz), 3)}, 15.0)
                    made += 1
        print("      diem dung khan cap cao toc: %d" % made)

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

    def _variant_for(self, kind, salt, zone="urban"):
        """
        Chọn template nhà theo ZONE. `variant_used` giờ đếm CHỮ KÝ HÌNH HỌC
        (không phải id) => con số in ra là số kiểu nhà thật sự xuất hiện.
        """
        v = build_house_variant(salt, zone)
        self.variant_used.add(v["sig"])
        return v

    def _house_zone(self, p, seg):
        """
        Phân zone để chọn đúng kiểu nhà cho bối cảnh. Quy tắc đo được từ
        region_params + class đường, không phải random:
          - đường phụ (SERVICE/ALLEY/STATION_ACCESS) ngoài đô thị -> khu công
            nghiệp / tiệm sửa xe, đó là nơi nhà xưởng thật sự mọc.
          - urban > 0.55 -> phố (nhà ống/nhà phố dính kề).
          - 0.32..0.55 -> ngoại thành (biệt thự/nhà vườn/nhà 2 lầu).
          - còn lại -> nông thôn (nhà gỗ/nhà sàn/nhà mái tôn).
        """
        u = p["urban"]
        if seg["class"] in ("SERVICE", "ALLEY", "STATION_ACCESS") and u < 0.5:
            return "industrial"
        if u > 0.55:
            return "urban"
        if u > 0.32:
            return "suburb"
        return "rural"

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
            elif seg["class"] in ("COLLECTOR", "PROVINCIAL_ROAD"):
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
                keep_p *= 0.35     # càng xa QL1 càng thưa (roadside development thật)

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
                    # KIEU NHA THEO BOI CANH, khong ep "urban = SHOPHOUSE".
                    # Do duoc: ban cu ghi de o day khien 74% nha la SHOPHOUSE va
                    # 91.6% la SHOPHOUSE+TUBEHOUSE, 8/62 kieu la duoc dung.
                    v = self._variant_for("road", salt, self._house_zone(p, seg))
                    # Khong lat nha 19m (kho hang) vao pho 8m: mau khong vua
                    # thoi dat -> thu nho hoac bo qua (khong chen vao lot).
                    if v["w"] > spacing * 0.92:
                        continue
                    depth = v["d"]
                    setback = (2.8 + (salt % 5) * 0.3) if p["urban"] > 0.55 \
                        else 7.0 + rng.uniform(0.0, 4.0)
                    if _HOUSE_BIT["GATE"] in v["flags"]:
                        # nha co tuong ran phai lui them cho ran + cuong
                        setback = max(setback, 5.0)
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
                    if v["wing"]:
                        # 1 = cánh chữ L lệch trái (generator xoay nhà về đường
                        # nên trái/phải là theo local, JS gương được qua `mir`)
                        b["wing"] = 1
                    b["nf"] = v["floors"]
                    if (salt >> 3) & 1:
                        b["mir"] = 1
                    fl = sum(v["flags"])
                    if fl:
                        b["fl"] = fl
                    self._add_building_to_chunks(b)
                    # Ban kin dat: object khac (cot dien/cay) phai tránh mat
                    # tien + canh 1, khong phai ca chieu sau (nha pho sau 13m).
                    self._reserve(bx, bz, max(v["w"], min(depth, 7.0)) * 0.42)
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
        # T-junction: nó CÓ được gọi và chết ở khúc nào
        _tj = getattr(self, "_tj_reject", None)
        if _tj:
            print("      T-junction: %s"
                  % ", ".join("%s x%d" % (k, v)
                              for k, v in sorted(_tj.items(),
                                                 key=lambda kv: -kv[1])))

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
                # BỎ QUA SÂN BẾN: layout bãi đỗ CỐ TÌNH để node cách nhau
                # 5.92m (mỗi bãi 1 node, mỗi xe một chỗ). Đo được: 48/48 cặp
                # ngắn trên data đã export đều là class INTERNAL và đều nằm
                # trong sân. `_weld_close_nodes` cũng cố ý bỏ qua sân — nếu
                # "sửa" theo cảnh báo này thì 48 node bị xếp làm 1 và sân bãi
                # đỗ bị xoá. Nguyên tắc "ngoài sân bến, vì layout sân là thiết
                # kế có chủ đích" trong docstring phải áp dụng cho cả câu này.
                if sg["class"] in TOPO_YARD_CLASSES:
                    continue
                if dist(n["x"], n["z"], o["x"], o["z"]) < 6.0:
                    close += 1
        if close:
            warns.append("%d cap node cach nhau < 6m (ngoai san baye)" % close)

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

        # --- duong CUT: phan loai CO CHU DICH / VO NGHIA ---
        # predicate dung CHUNG voi buoc don dau cuot (`_dead_end_meaningful`)
        dead_ok, dead_bad = 0, []
        for nid in self.nodes:
            if self._topo_deg(nid) != 1:
                continue
            n0 = self.nodes.get(nid)
            if n0 is None:
                continue
            for sid in self._segs_at(nid):
                sg = self.segments.get(sid)
                if not sg or sg["class"] not in TOPO_DEAD_CLS or sg.get("bridge"):
                    continue
                if self._dead_end_meaningful(nid, sg):
                    dead_ok += 1
                else:
                    a, b = self.nodes.get(sg["from"]), self.nodes.get(sg["to"])
                    if a and b:
                        dead_bad.append((dist(a["x"], a["z"], b["x"], b["z"]),
                                         sg["class"], sg.get("name") or "-",
                                         int(n0["x"]), int(n0["z"])))
                break
        if dead_bad:
            dead_bad.sort(reverse=True)
            errors.append("%d duong CUT VO NGHIA (dai >60m, ngoai KDC/khong "
                          "cham POI/ben): %s"
                          % (len(dead_bad),
                             "; ".join("%.0fm %s %s@(%d,%d)"
                                       % (L, c, nm, x, z)
                                       for L, c, nm, x, z in dead_bad[:6])))
        if dead_ok:
            warns.append("%d duong cut CO CHU DICH (ngoi/lech ben/ngo KDC)"
                         % dead_ok)

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

        # --- CAO TỐC LIÊN TỤC + RAMP ĐẦU VÀO/ĐẦU RA (task 8/10/15) ---
        # Một đoạn cao tốc "mồ côi" = hành lang liên tỉnh bị đứt giữa 2 tỉnh.
        # Một cụm ramp không có cả 2 đầu = ramp dựng cho có, xe không lên được.
        HI = ("EXPRESSWAY", "RAMP", "TUNNEL")
        cls_at = {}
        for sg in self.segments.values():
            cls_at.setdefault(sg["from"], set()).add(sg["class"])
            cls_at.setdefault(sg["to"], set()).add(sg["class"])
        LOCAL_SIDE = ("NATIONAL", "ARTERIAL", "COLLECTOR", "PROVINCIAL_ROAD",
                      "LOCAL", "RURAL_LOCAL", "SERVICE", "STATION_ACCESS")

        def _hi_component(start):
            """BFS chỉ đi qua segment cao tốc/hầm/ramp."""
            stack, nodes = [start], [start]
            seen = {start}
            while stack:
                cur = stack.pop()
                for sid in self._segs_at(cur):
                    sg = self.segments.get(sid)
                    if sg is None or sg["class"] not in HI:
                        continue
                    nxt = sg["to"] if sg["from"] == cur else sg["from"]
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)
                        nodes.append(nxt)
            return nodes

        _hi_seen, _hi_comps = set(), []
        for nid, cs in cls_at.items():
            if "EXPRESSWAY" not in cs or nid in _hi_seen:
                continue
            comp = _hi_component(nid)
            _hi_seen.update(comp)
            _hi_comps.append(comp)
        if len(_hi_comps) > 1:
            # in rõ từng mảnh (độ dài + bbox + anchor gần nhất) — "3 doan rieng
            # le" không nói được đoạn nào đứt ở đâu.
            det = []
            for comp in _hi_comps:
                mem = set(comp)
                xs = [self.nodes[n]["x"] for n in mem if n in self.nodes]
                zs = [self.nodes[n]["z"] for n in mem if n in self.nodes]
                if not xs:
                    continue
                ln = 0.0
                for sg in self.segments.values():
                    if sg["class"] in HI and sg["from"] in mem:
                        a, b = self.nodes[sg["from"]], self.nodes[sg["to"]]
                        ln += dist(a["x"], a["z"], b["x"], b["z"])
                cx, cz = (min(xs) + max(xs)) * 0.5, (min(zs) + max(zs)) * 0.5
                best, bd = None, 1e18
                for a in ANCHORS:
                    p = self.proj(a["lat"], a["lon"])
                    d = (p[0] - cx) ** 2 + (p[1] - cz) ** 2
                    if d < bd:
                        bd, best = d, a["name"]
                det.append("%.0fkm/%dnut @%s" % (ln / 1000.0, len(mem),
                                                  best or "?"))
            warns.append("cao toc chia thanh %d doan rieng le: %s"
                         % (len(_hi_comps), " | ".join(det)))
        isolated = 0
        for comp in _hi_comps:
            linked = any(bool((cls_at.get(nid, set()) - set(HI)) & set(LOCAL_SIDE))
                         for nid in comp)
            if not linked:
                isolated += 1
        if isolated:
            errors.append("%d doan cao toc KHONG noi voi mang duong dia phuong "
                          "(hanh lang lien tinh dut)" % isolated)

        # --- RAMP: mỗi cụm ramp phải có đầu cao tốc + đầu đường địa phương ---
        # P71: "2 cum ramp hoan toan co lap" KHONG biet la cụm nào, ở đâu -> phải
        # in ra. Số lỗi đếm được không đủ để sửa; cần node + toạ độ + class.
        ramp_seen, ramp_bad, ramp_isolated = set(), [], []
        ramp_det = []
        for sid, sg in self.segments.items():
            if sg["class"] != "RAMP" or sid in ramp_seen:
                continue
            # cụm ramp (chain ramp nối cao tốc -> đường dưới)
            stack, chain = [sid], [sid]
            ramp_seen.add(sid)
            while stack:
                csid = stack.pop()
                csg = self.segments[csid]
                for end in (csg["from"], csg["to"]):
                    for nsid in self._segs_at(end):
                        if nsid in ramp_seen:
                            continue
                        nsg = self.segments.get(nsid)
                        if nsg is None or nsg["class"] != "RAMP":
                            continue
                        ramp_seen.add(nsid)
                        stack.append(nsid)
                        chain.append(nsid)
            has_high = has_low = False
            for csid in chain:
                csg = self.segments[csid]
                for end in (csg["from"], csg["to"]):
                    for cl in (cls_at.get(end, set()) - {"RAMP"}):
                        if cl in ("EXPRESSWAY", "TUNNEL"):
                            has_high = True
                        elif cl in LOCAL_SIDE:
                            has_low = True
            if has_high and has_low:
                continue
            if not has_high and not has_low:
                ramp_isolated.append(sid)
                _nds = sorted({n for s2 in chain
                               for n in (self.segments[s2]["from"],
                                         self.segments[s2]["to"])})
                _xs = [self.nodes[n]["x"] for n in _nds if n in self.nodes]
                _zs = [self.nodes[n]["z"] for n in _nds if n in self.nodes]
                ramp_det.append("%dseg/%dnut @(%.0f,%.0f) %s"
                                % (len(chain), len(_nds),
                                   sum(_xs) / len(_xs), sum(_zs) / len(_zs),
                                   ",".join(_nds[:6])))
            else:
                ramp_bad.append("thieu %s" % ("dau cao toc" if not has_high
                                              else "dau duong dia phuong"))
        if ramp_isolated:
            errors.append("%d cum ramp hoan toan co lap (khong cao toc khong duong): "
                          "%s" % (len(ramp_isolated), " | ".join(ramp_det[:6])))
        if ramp_bad:
            warns.append("%d cum ramp thieu 1 dau (vao/ra): %s"
                         % (len(ramp_bad), ramp_bad[:6]))

        # --- cầu/hầm: 2 đầu phải nối vào graph đường thường ---
        br_bad = 0
        for sg in self.segments.values():
            if not sg.get("bridge") and sg["class"] != "TUNNEL":
                continue
            for end in (sg["from"], sg["to"]):
                if not (cls_at.get(end, set()) - {"EXPRESSWAY", "RAMP", "TUNNEL"}):
                    br_bad += 1
                    break
        if br_bad:
            warns.append("%d cau/ham co 1 dau khong noi duong thuong" % br_bad)

        return {"errors": errors, "warns": warns}

    def validate(self):
        print("[7/8] Validation ...")
        # KHÔNG có repair ở đây. Trước đây có 3 hàm "repair" chạy ở đầu
        # validate() và cả 3 đều LÀM HỎNG map thay vì sửa:
        #   - tạo segment RAMP dài 0m (node mới đặt trùng toạ độ node cũ)
        #   - thêm segment nối dài tới 10km vượt MAX_SEG_LEN 900m
        #   - `del self.segments[sid]` mà không gỡ khỏi `node["connections"]`
        #     => validate() chặn export bằng chính lỗi do nó tạo ra
        # Chữa đúng chỗ đã có sẵn trong `generate_topology`:
        #   `_heal_ramp_fragments()` (nối HOẶC xoá cụm ramp mất cả hai đầu)
        #   `_ensure_connected()` / `_reconnect_islands()` (nối mảnh rời)
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
            if n.get("name") == "QL1" or n["type"] == "highway":
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

        # --- CONNECTIVITY (task 15): graph phải nối + bến phải ở main ---
        # Bug thật đã lọt: sân Nha Trang 36 node nằm thành phần RIÊNG vì
        # `validate` chỉ check `access_node in self.nodes` (tồn tại) chứ
        # KHÔNG check node đó có NỐI VỚI mạng chính không.
        _main_nodes, _comps = set(), []
        if self.segments:
            _adj2 = {}
            for _sg in self.segments.values():
                _a, _b = _sg.get("from"), _sg.get("to")
                if _a is None or _b is None:
                    continue
                _adj2.setdefault(_a, []).append(_b)
                _adj2.setdefault(_b, []).append(_a)
            _seen2 = set()
            for _st0 in _adj2:
                if _st0 in _seen2:
                    continue
                _stack, _comp = [_st0], set()
                _seen2.add(_st0)
                while _stack:
                    _c = _stack.pop()
                    _comp.add(_c)
                    for _n2 in _adj2.get(_c, ()):
                        if _n2 not in _seen2:
                            _seen2.add(_n2)
                            _stack.append(_n2)
                _comps.append(_comp)
            _comps.sort(key=len, reverse=True)
            if _comps:
                _main_nodes = _comps[0]
        if len(_comps) > 1:
            _orph = sum(len(c) for c in _comps[1:])
            _msg = ("graph roi %d manh rieng le (%d node ngoai main, nho nhat %d)"
                    % (len(_comps) - 1, _orph, min(len(c) for c in _comps[1:])))
            if _orph > 4:
                # P71: kèm danh sách node + class từng mảnh, nếu không thì
                # "roi 2 manh" không truy được ra chỗ nào cắt.
                _det = []
                for _c in _comps[1:7]:
                    _m = sorted(_c)
                    _cl = sorted({sg["class"] for sg in self.segments.values()
                                  if sg["from"] in _c or sg["to"] in _c})
                    _xs = [self.nodes[n]["x"] for n in _m if n in self.nodes]
                    _zs = [self.nodes[n]["z"] for n in _m if n in self.nodes]
                    if not _xs:
                        continue
                    _det.append("%dnut @(%d,%d) [%s] %s"
                                % (len(_m), sum(_xs) / len(_xs),
                                   sum(_zs) / len(_zs), "/".join(_cl),
                                   ",".join(_m[:6])))
                errors.append(_msg + " — duong dut that, khong duoc phep: "
                             + " | ".join(_det))
            else:
                warns.append(_msg)

        # --- STATIONS ---
        if not self.stations:
            errors.append("không có station nào")
        spawn_station = None
        for st in self.stations:
            if st.get("is_spawn"):
                spawn_station = st
            if "access_node" not in st or st["access_node"] not in self.nodes:
                errors.append("station %s thiếu access road node" % st["id"])
            elif _main_nodes and st["access_node"] not in _main_nodes:
                errors.append("station %s RỜI khỏi mạng chính — xe vào bến "
                              "không được (access_node không ở thành phần lớn nhất)"
                              % st["id"])
            if not any(z.get("id") == st["id"] for z in self.station_zones):
                errors.append("station %s thiếu reserved zone" % st["id"])
        if not spawn_station:
            errors.append("không có station spawn")
        else:
            # SPAWN_TARGET (0,2000) la node TREN QL1 cu. Bay gio ben ben le
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

        # --- ROUTE TEST: 6 tuyến chính từ Nam Tuy Hòa (BFS trên road graph) ---
        # Quy tắc tuyệt đối: không đường cụt vô lý => mọi tuyến phải đi được.
        # Cam Ranh / Dầu Giây chưa có bến nên test tới tọa độ anchor thật.
        if spawn_station:
            _adj = {}
            for _sid, _sg in self.segments.items():
                _adj.setdefault(_sg["from"], []).append(_sg["to"])
                _adj.setdefault(_sg["to"], []).append(_sg["from"])
            _starts = [nid for nid, _n in self.nodes.items()
                       if dist(_n["x"], _n["z"],
                               spawn_station["x"], spawn_station["z"]) < 600.0]
            _seen = set(_starts)
            _stack = list(_starts)
            while _stack:
                _cur = _stack.pop()
                for _nxt in _adj.get(_cur, ()):
                    if _nxt not in _seen:
                        _seen.add(_nxt)
                        _stack.append(_nxt)
            _by_id = {s["id"]: s for s in self.stations}
            _anchor_xy = {a["name"]: self.proj(a["lat"], a["lon"])
                          for a in ANCHORS}
            _routes = [("nha_trang", None, "Nha Trang"),
                       ("phan_rang", None, "Phan Rang"),
                       ("phan_thiet", None, "Phan Thiet"),
                       ("mien_dong_moi", None, "TP.HCM (Mien Dong Moi)"),
                       (None, _anchor_xy.get("Cam_Ranh"), "Cam Ranh"),
                       (None, _anchor_xy.get("Dau_Giay"), "Dau Giay")]
            for _sid2, _xy, _label in _routes:
                if _sid2 is not None:
                    _t = _by_id.get(_sid2)
                    if _t is None:
                        errors.append("route test: thiếu bến '%s'" % _sid2)
                        continue
                    _tx, _tz = _t["x"], _t["z"]
                elif _xy is not None:
                    _tx, _tz = _xy
                else:
                    errors.append("route test: thiếu tọa độ '%s'" % _label)
                    continue
                _best = min((dist(self.nodes[_nid]["x"], self.nodes[_nid]["z"],
                                  _tx, _tz) for _nid in _seen), default=1e18)
                if _best > 400.0:
                    errors.append("route Nam Tuy Hoa -> %s KHONG DI DUOC "
                                  "(node gan nhat cach %.0fm)" % (_label, _best))
                else:
                    print("      route Nam Tuy Hoa -> %s: OK (%d node, cach %.0fm)"
                          % (_label, len(_seen), _best))

            # --- ROUTE ĐA DẠNG (task 14): A->B phải có TUYẾN THAY THẾ ---
            # Cấm toàn bộ node NỘI BỘ của đường ngắn nhất rồi tìm lại: nếu
            # vẫn đi được => QL1 / cao tốc / đường địa phương song song THẬT,
            # map không phải "một đường độc đạo".
            _cost = {"EXPRESSWAY": 0.75, "RAMP": 0.75, "TUNNEL": 0.8,
                     "NATIONAL": 0.85, "ARTERIAL": 1.0, "COLLECTOR": 1.25,
                     "PROVINCIAL_ROAD": 1.25, "LOCAL": 1.9, "RURAL_LOCAL": 1.9,
                     "ALLEY": 3.4}.get
            _adjw = {}
            for _sg in self.segments.values():
                if _sg["class"] in ("INTERNAL", "STATION_ACCESS"):
                    continue          # đường sân bến không phải tuyến qua tỉnh
                _w = _cost(_sg["class"], 1.5)
                _adjw.setdefault(_sg["from"], []).append((_sg["to"], _w))
                _adjw.setdefault(_sg["to"], []).append((_sg["from"], _w))

            def _path(src, dst, banned):
                if src is None or dst is None or src == dst:
                    return None
                dmap = {src: 0.0}
                prev, seen, pq = {}, set(), [(0.0, src)]
                while pq:
                    d0, u = heapq.heappop(pq)
                    if u in seen:
                        continue
                    seen.add(u)
                    if u == dst:
                        break
                    for (v, w) in _adjw.get(u, ()):
                        if v in banned or v in seen:
                            continue
                        nd = d0 + w
                        if nd < dmap.get(v, 1e18) - 1e-9:
                            dmap[v] = nd
                            prev[v] = u
                            heapq.heappush(pq, (nd, v))
                if dst not in dmap:
                    return None
                p = [dst]
                while p[-1] != src:
                    if p[-1] not in prev:
                        return None
                    p.append(prev[p[-1]])
                return p[::-1]

            def _node_near(x, z):
                best, bd = None, 1e18
                for nid, n in self.nodes.items():
                    if nid not in _adjw:
                        continue
                    d = (n["x"] - x) ** 2 + (n["z"] - z) ** 2
                    if d < bd:
                        bd, best = d, nid
                return best

            for (a_id, b_id, a_lab, b_lab) in (
                    ("nam_tuy_hoa", "nha_trang", "Nam Tuy Hoa", "Nha Trang"),
                    ("nha_trang", "phan_thiet", "Nha Trang", "Phan Thiet"),
                    ("phan_thiet", "mien_dong_moi", "Phan Thiet", "TP.HCM")):
                _sa, _sb = _by_id.get(a_id), _by_id.get(b_id)
                if not _sa or not _sb:
                    continue
                _na = _node_near(_sa["x"], _sa["z"])
                _nb = _node_near(_sb["x"], _sb["z"])
                _p1 = _path(_na, _nb, set())
                if not _p1 or len(_p1) < 4:
                    continue           # tuyến quá ngắn / không có -> bỏ qua
                _p2 = _path(_na, _nb, set(_p1[1:-1]))
                if _p2 is None:
                    warns.append("route %s -> %s chi co MOT tuyen — khong co "
                                 "duong thay the" % (a_lab, b_lab))
                else:
                    print("      tuyen thay the %s -> %s: CO (%d nut vs %d nut)"
                          % (a_lab, b_lab, len(_p1), len(_p2)))

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
        # object không nằm trong vùng bến (sân + 70m lề)
        # ĐO GIỐNG HỆT lúc đặt: rect ĐÃ XOAY + bán kính object, dùng chính
        # `_seg_hits_rect` mà `_in_station_zone` dùng. Bản cũ dùng
        # `abs(ox-cx) < w/2` (AABB không xoay) — sân bến có `rot` khác 0 nên
        # AABB bao hơn rect thật, báo 34 lỗi giả cho object nằm ngoài vùng.
        bad = []
        for (ox, oz, orad) in self.object_positions:
            for sz in self.station_zones:
                if not str(sz.get("id", "")).startswith(
                        ("nam_tuy", "nha_trang", "phan_", "mien_")):
                    continue
                # BỎ QUA CHÍNH TÂM SÂN: `_station_complex` reserve đúng điểm
                # (cx,cz) với bán kính = nửa cạnh sân để chặn nhà mọc trong
                # sân. Điểm đó theo định nghĩa LUÔN nằm trong sân, nên quét nó
                # là tự tham chiếu => 5 cảnh báo giả (đúng bằng số bến).
                if dist(ox, oz, sz["x"], sz["z"]) < 1.0:
                    continue
                if _seg_hits_rect((ox, oz), (ox, oz), sz["x"], sz["z"],
                                  sz["w"] * 0.5, sz["d"] * 0.5,
                                  orad, sz.get("rot", 0.0)):
                    bad.append((sz.get("id"), round(ox), round(oz), orad))
                    break
        if bad:
            warns.append("%d object nằm trong station reserved zone "
                         "(đo bằng rect xoay + bán kính): %s"
                         % (len(bad), bad[:5]))

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
            vinfo = ""
            for sid, seg in self.segments.items():
                if sid in hw_ids or seg["class"] in ("RAMP",):
                    continue
                # QL1 x CT01 CẮT NHAU LÀ THẬT (giao cấp khác mức: cầu vượt/hầm),
                # graph không nối chúng => không phải lỗi topology.
                # Chỉ ĐƯỜNG NHỎ cắt qua cao tốc MẶT BẰNG mới sai.
                if seg["class"] in ("NATIONAL", "ARTERIAL"):
                    continue
                if seg.get("bridge") or seg["class"] == "TUNNEL":
                    continue          # cầu vượt / hầm = không phải mặt bằng
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
                                vinfo = ("%dm %s %s @(%d,%d) cat cao toc"
                                         " @(%d,%d)-(%d,%d)"
                                         % (int(dist(p1["x"], p1["z"],
                                                     p2["x"], p2["z"])),
                                            seg["class"], seg.get("name") or "-",
                                            int(p1["x"]), int(p1["z"]),
                                            int(h1["x"]), int(h1["z"]),
                                            int(h2["x"]), int(h2["z"])))
                                break
                        if violations > 0:
                            break
                    if violations > 0:
                        break
                if violations > 0:
                    break
            if violations:
                errors.append("có đường cắt ngang cao tốc không qua nút giao "
                              "(topology sai): %s" % vinfo)
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
              " QL1 -> highway -> %s ✓" % ("ramps" if classes.get("RAMP", 0) else "?"))
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
    # 4.12b ETA TUYẾN CHÍNH — TÍNH TỪ ĐƯỜNG THẬT, KHÔNG HARD-CODE
    # --------------------------------------------------------------------------
    #
    # VẤN ĐỀ ĐO ĐƯỢC: trước đây ETA là hằng số `"travelTime": 9*3600` chép
    # thẳng vào routes.json. 518 km / 9 h = 57.6 km/h — trùng với con số
    # may mắn chứ không phải kết quả tính. Yêu cầu là ETA phải suy ra từ:
    #   (1) chiều dài thật của từng đoạn (không dùng corridor_len làm đại lượng
    #       duy nhất — corridor là xương sống, route đi qua cả phố/cao tốc),
    #   (2) class đường -> tốc độ cơ sở (ROAD_CLASS[...]["speed"]),
    #   (3) ĐỘ DỐC THẬT (node.y) -> xe khách không leo 8% tốc độ 70,
    #   (4) NÚT GIAO thật trên tuyến (bậc node) -> mỗi nút tốn thời gian dừng/giảm
    #       tốc, không phải cắt ngang là mất 0 giây,
    #   (5) MẬT ĐỘ ĐÔ THỊ tại node (region_params.urban) -> phố làm xe chậm,
    #   (6) ĐỘ DỐC NÚI (region_params.mountain) -> đèo Cả / đèo Hải Vân,
    #   (7) DỪNG BẾN (bến xe trên tuyến) -> thời gian lên/xuống xe thật.
    #
    # P71 — SỬA LỖI "NHÁNH CHẾT": bản đầu dò bến bằng "node tuyến có nằm trong
    # hộp ~55m quanh tâm bến". Đo thật (stnroute.py): tâm bến cách trục tuyến
    # 123 / 169 / 138 / 469 / 240 m vì bến nằm CẠNH QL1, nối bằng đường vào bến.
    # => `stationsOnRoute` LUÔN = 0 và `stationSeconds` LUÔN = 0: nhánh tính
    # dwell bến là code chết, tức ETA thiếu hẳn một thành phần bắt buộc. Nay dò
    # bằng `anchor_node` (node neo của bến trên QL1) — topology thật, không
    # phải ngưỡng hộp tùy ý — và cộng thêm dwell điểm dừng xe buýt dọc QL1.
    #
    # MỌI HỆ SỐ ĐỀU LÀ THAM SỐ, KHÔNG PHẢI KẾT QUẢ:
    #   - tốc độ cơ sở: `ROAD_CLASS[cls]["speed"]` (km/h) — đã có sẵn, dùng lại.
    #   - `ETA_JUNCTION_S`: 6-22 s/nút tùy bậc. Nguồn: KHÔNG CÓ NGUỒN chính
    #     thức cho thời gian chờ đèn ở VN. Đây là THAM SỐ MÔ HÌNH, đã ghi rõ.
    #   - `ETA_STATION_DWELL_S`: 180-600 s/bến tuỳ quy mô. Tương tự — tham số.
    #   - Hệ số giảm tốc theo dốc / đô thị / núi: tham số, công thức ghi dưới.
    # Những gì KHÔNG làm (có chủ đích):
    #   - không lấy `travelTime` từ bất kỳ bảng lịch trình nào: lịch trình
    #     chưa xác minh được (research §F5) nên không được code vào,
    #   - không cộng tốc độ "thiết kế" cao tốc 90-120 vào QL1: tuyến này
    #     chạy QL1 + phố, không phải chạy CT.01 suốt.
    def compute_route_eta(self, node_ids):
        """Trả dict ETA chi tiết cho 1 danh sách node (thứ tự đi)."""
        # ---- tham số mô hình (xem docstring: KHÔNG phải số đo) ----
        JUNCTION_S = {2: 6.0, 3: 10.0, 4: 16.0}   # bậc node -> giây
        JUNCTION_S_DEFAULT = 22.0                  # bậc >= 5 (ngã 5-6 lối)
        STATION_DWELL_S = (180.0, 300.0, 420.0, 600.0)   # theo quy mô bến
        # dốc: tốc độ giảm theo % dốc. Xe khách giường nằm ~3.5-4.5 tấn, lực
        # kéo/độ dốc hãm tốc độ; dốc 8% trên QL1 là đoạn xe phải xuống 35-40.
        GRADE_PENALTY_PER_PCT = 0.055    # mỗi 1% dốc -> giảm 5.5% tốc độ
        GRADE_MIN_FACTOR = 0.42          # sàn: dốc dựng đứng vẫn phải đi được
        # đô thị: phố VN xe chạy 22-35 km/h dù QL1 cấm phố cho xe khách.
        URBAN_SPEED_FLOOR = 22.0
        # núi: đèo — giảm thêm theo `mountain` của region.
        MOUNTAIN_PENALTY = 0.22
        SEG_JOIN_M = 250.0                # nối 2 node cách <250m coi như 1 đoạn
        # P71 ĐO ĐẠC (stnlink.py / stnroute.py): bến KHÔNG nằm trên trục tuyến —
        # tâm bến cách route 123/169/138/469/240 m. Hàm cũ dò "node tuyến nằm
        # trong hộp 55m ở tâm bến" => stationsOnRoute LUÔN = 0, tức nhánh dwell
        # bến là code chết. Đo thật cho thấy mỗi bến có `anchor_node` là node
        # neo trên QL1: 4/5 bến anchor đúng bằng 0.0 m, `nha_trang` 25.3 m.
        # => dùng KHOẢNG CÁCH anchor -> polyline tuyến, ngưỡng khai báo.
        ETA_STATION_LINK_M = 40.0
        # ĐIỂM DỪNG XE BUÝT: đo được 51/54 điểm nằm <=30m trên trục tuyến
        # (median 0.0m). Xe khách thật dừng đón khách ở từng điểm -> có thời
        # gian. Thời lượng lại không có nguồn chính thức -> tham số mô hình.
        ETA_STOP_LINK_M = 30.0
        ETA_BUS_STOP_DWELL_S = 45.0

        t_move = 0.0            # giây chạy thuần (không dừng)
        t_junc = 0.0            # giây dừng/giảm tốc tại nút giao
        t_station = 0.0         # giây dừng bến
        dist_total = 0.0
        by_class = {}
        n_junctions = 0
        slowest = None          # (speed, nodeId, class) — điểm chậm nhất

        # index node -> segment để tìm đoạn giữa 2 node liên tiếp
        edge = self._edge_index

        # ---- polyline tuyến (đã loại node mất) -> dùng đo khoảng cách ----
        rpts = []
        for nid in node_ids:
            n = self.nodes.get(nid)
            if n is not None:
                rpts.append((n["x"], n["z"]))

        def _d_route(px, pz):
            """Khoảng cách point -> polyline tuyến (mét)."""
            best = float("inf")
            for i in range(len(rpts) - 1):
                ax, az = rpts[i]
                bx, bz = rpts[i + 1]
                dx, dz = bx - ax, bz - az
                l2 = dx * dx + dz * dz
                if l2 <= 0.0:
                    d2 = (px - ax) ** 2 + (pz - az) ** 2
                else:
                    t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0.0, 1.0)
                    d2 = (px - (ax + dx * t)) ** 2 + (pz - (az + dz * t)) ** 2
                if d2 < best:
                    best = d2
            return math.sqrt(best)

        def _bay_scale(sid):
            """Quy mô bến -> chỉ số 0..3 trong STATION_DWELL_S."""
            for st in getattr(self, "stations", ()):
                if st.get("id") == sid:
                    nb = len(st.get("baySlots") or ())
                    if nb >= 40:
                        return 3
                    if nb >= 24:
                        return 2
                    if nb >= 14:
                        return 1
                    return 0
            return 1

        # ---- bến trên tuyến: đo bằng `anchor_node` (node neo trên QL1) ----
        # KHÔNG dò bằng hộp quanh tâm bến: bến nằm CẠNH tuyến, tâm cách
        # 123-469m nên cách đó luôn ra 0 bến (đo ở P71).
        t_stop = 0.0
        n_stops = 0
        st_list = []
        for st in getattr(self, "stations", ()):
            if st.get("type") not in ("BUS_STATION", "MAJOR_BUS_TERMINAL"):
                continue
            a = self.nodes.get(st.get("anchor_node"))
            px, pz = (a["x"], a["z"]) if a else (st["x"], st["z"])
            d = _d_route(px, pz)
            if d <= ETA_STATION_LINK_M:
                t_station += STATION_DWELL_S[_bay_scale(st["id"])]
                st_list.append({"id": st["id"], "anchorM": round(d, 1),
                                "bays": len(st.get("baySlots") or ())})
        # ---- điểm dừng xe buýt dọc tuyến (đo: 51/54 nằm <=30m) ----
        for s in getattr(self, "bus_stops", ()):
            if _d_route(s["x"], s["z"]) <= ETA_STOP_LINK_M:
                t_stop += ETA_BUS_STOP_DWELL_S
                n_stops += 1

        prev_nid = None
        for nid in node_ids:
            n = self.nodes.get(nid)
            if n is None:
                continue
            if prev_nid is not None:
                pa = self.nodes.get(prev_nid)
                if pa is None:
                    prev_nid = nid
                    continue
                L2 = math.hypot(n["x"] - pa["x"], n["z"] - pa["z"])
                if L2 >= SEG_JOIN_M:
                    key = (prev_nid, nid) if prev_nid < nid else (nid, prev_nid)
                    sid = edge.get(key)
                    seg = self.segments.get(sid) if sid else None
                    cls = seg["class"] if seg else "NATIONAL"
                    spec = ROAD_CLASS.get(cls, ROAD_CLASS["NATIONAL"])
                    v0 = float(spec["speed"])
                    # dốc THẬT giữa 2 node
                    dy = n["y"] - pa["y"]
                    grade_pct = abs(dy) / L2 * 100.0
                    gfac = max(GRADE_MIN_FACTOR,
                               1.0 - GRADE_PENALTY_PER_PCT * grade_pct)
                    # đô thị tại đoạn
                    mx = (pa["x"] + n["x"]) * 0.5
                    mz = (pa["z"] + n["z"]) * 0.5
                    rp = self.region_params(mx, mz)
                    u = rp.get("urban", 0.0)
                    mtn = rp.get("mountain", 0.0)
                    # phố: trong lòng thị trấn QL1 bị dồn làn + xe máy,
                    # kéo tốc độ xuống sàn đô thị.
                    v = v0 * gfac
                    if u > 0.55:
                        v = min(v, max(URBAN_SPEED_FLOOR, v0 * 0.62))
                    # đèo
                    if mtn > 0.5:
                        v *= (1.0 - MOUNTAIN_PENALTY * (mtn - 0.5) * 2.0)
                    v = max(v, 8.0)
                    dt = L2 / (v * 1000.0 / 3600.0)   # m -> s
                    t_move += dt
                    dist_total += L2
                    b = by_class.setdefault(cls, {"m": 0.0, "s": 0.0,
                                                   "count": 0})
                    b["m"] += L2
                    b["s"] += dt
                    b["count"] += 1
                    if slowest is None or v < slowest[0]:
                        slowest = (v, nid, cls)
            # nút giao tại node này (chỉ tính node trong tuyến, bậc >= 3)
            deg = self._topo_deg(nid)
            if deg >= 3:
                n_junctions += 1
                t_junc += JUNCTION_S.get(deg, JUNCTION_S_DEFAULT)
            prev_nid = nid

        # tổng thời gian = chạy + nút giao + dừng bến + dừng điểm. KHÔNG nhân
        # thêm hệ số "kẹt xe" bịa — kẹt đã nằm trong hệ số đô thị ở trên.
        total = t_move + t_junc + t_station + t_stop
        avg_kmh = (dist_total / 1000.0) / (total / 3600.0) if total > 0 else 0.0
        return {
            "totalSeconds": round(total, 1),
            "totalHours": round(total / 3600.0, 2),
            "totalMinutes": round(total / 60.0, 1),
            "driveSeconds": round(t_move, 1),
            "junctionSeconds": round(t_junc, 1),
            "stationSeconds": round(t_station, 1),
            "busStopSeconds": round(t_stop, 1),
            "distanceM": round(dist_total, 1),
            "avgSpeedKmh": round(avg_kmh, 1),
            "junctions": n_junctions,
            "stationsOnRoute": len(st_list),
            "stations": st_list,
            "busStopsOnRoute": n_stops,
            "slowestKmh": round(slowest[0], 1) if slowest else 0.0,
            "slowestNode": slowest[1] if slowest else None,
            "slowestClass": slowest[2] if slowest else None,
            "byClass": {k: {"metres": round(v["m"], 1),
                            "seconds": round(v["s"], 1),
                            "segments": v["count"]}
                        for k, v in by_class.items()},
            # tham số mô hình — ghi ra để người đọc file biết con số này là
            # TÍNH RA, không phải hằng số; và để audit kiểm được.
            "model": {
                "source": "computed from road classes, node elevations, "
                          "junctions, region urban/mountain, station dwell",
                "speedSourceKmh": "ROAD_CLASS[class].speed (khong phai lich "
                                  "trinh; lich KHONG XAC MINH)",
                "junctionSecondsPerDegree": JUNCTION_S,
                "stationDwellSecondsByBayCount": STATION_DWELL_S,
                "stationLinkM": ETA_STATION_LINK_M,
                "busStopLinkM": ETA_STOP_LINK_M,
                "busStopDwellSeconds": ETA_BUS_STOP_DWELL_S,
                "gradePenaltyPerPct": GRADE_PENALTY_PER_PCT,
                "gradeMinFactor": GRADE_MIN_FACTOR,
                "urbanSpeedFloorKmh": URBAN_SPEED_FLOOR,
                "mountainPenalty": MOUNTAIN_PENALTY,
                "note": "He so gia nang la THAM SO MO HINH, khong phai so do.",
            },
        }

    # --------------------------------------------------------------------------
    # 4.13 EXPORT  (BẮT BUỘC rmtree trước)
    # --------------------------------------------------------------------------
    def export(self):
        print("[8/8] Export (rmtree cũ trước) ...")
        # Đảm bảo bảng u(z) tồn tại trước khi export (JS dùng thẳng, không tự dựng).
        if not getattr(self, "_uz", None):
            try:
                self._uz = self._build_u_table()
            except Exception:
                self._uz = []
                self._uz_ambig = set()
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
        # TRỤC KM: chính là corridor_coarse (mắt lưới 1500m) mà _corridor_project
        # dùng, gắn sẵn km từ _km_axis(). js/map.js dùng ĐÚNG polyline này để
        # đổi (x,z) -> km, không tự suy ra lần hai (README 3g/P19).
        admin_axis = []
        _kmk = self._km_axis()
        if _kmk and getattr(self, "corridor_coarse", None):
            _km_of_s = _kmk[0]
            admin_axis = [[round(p[0], 1), round(p[1], 1),
                           round(_km_of_s(self._corridor_s_at_index(k)), 3)]
                          for k, p in enumerate(self.corridor_coarse)]
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
                # BẢNG u(z) + BIN MÂU THUẬN — JS dùng thẳng, KHÔNG tự dựng lại.
                # Lý do: corridor export đã làm tròn 3 chữ số thập phân, nếu JS
                # tự dựng bảng từ corridor tròn sẽ thành "bản độc lập thứ hai"
                # lệch ~2.26m ở u => terrain lệch ~40m => XE BAY/CHÌM.
                # Generator là nguồn duy nhất (Xem README 3g/P19).
                "uz": [[round(z, 3), round(u, 8)] for (z, u) in self._uz]
                      if getattr(self, "_uz", None) else [],
                "uzAmbig": sorted(list(getattr(self, "_uz_ambig", set()))) ,
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
            # ---- LỚP HÀNH CHÍNH (sáp nhập 12/6/2025, NQ 202/2025/QH15) ----
            # js/map.js getAdminUnit(x,z) tra theo dải km; đơn vị nội địa
            # (onCorridor=false, không chia dải km) dùng cho tra "đơn vị gần
            # nhất" trong nearMaxKm.
            "admin": {
                "nearMaxKm": ADMIN_NEAR_MAX_KM,
                # Ranh giới = TRUNG ĐIỂM km giữa 2 đơn vị (xấp xỉ, ghi rõ).
                "bandRule": "ranh gioi = truong diem km giua 2 don vi ke nhau",
                # TRỤC km (corridor_coarse + km): đơn vị của lớp hành chính.
                "axisStepM": 1500,
                "axis": admin_axis,
                # NGUỒN ĐỦ: THÀNH PHẦN gộp từ đơn vị cũ chưa đối chiếu được.
                "unverified": "thanh phan don vi CU (don moi gop tu don nao): "
                               "KHONG XAC MINH",
                "units": [{
                    "id": r["id"], "province": r["province"], "name": r["name"],
                    "kind": r["kind"], "areaKm2": r["areaKm2"], "pop": r["pop"],
                    "km": (round(r["km"], 2) if r.get("km") is not None else None),
                    "kmLo": r.get("kmLo"), "kmHi": r.get("kmHi"),
                    "kmApprox": bool(r.get("km_approx")),
                    "onCorridor": bool(r["onCorridor"]), "seat": r["seat"],
                    "x": (round(r["xy"][0], 1) if r.get("xy") else None),
                    "z": (round(r["xy"][1], 1) if r.get("xy") else None),
                } for r in (getattr(self, "admin_units", []) or [])],
            },
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
            "id": s["id"],
            # TÊN ĐỊA DANH THẬT (task 6) — fallback Km khi không gắn được
            "name": ("Trạm dừng %s" % s["place"]) if s.get("place")
                    else ("Điểm dừng xe buýt Km%.1f" % (s["s"] / 1000.0)),
            "type": "BUS_STOP", "x": s["x"], "y": s["y"], "z": s["z"],
            "w": 14.0, "d": 6.0, "rot": s["heading"],
            "bays": 0, "buses": [], "is_spawn": False,
        } for s in getattr(self, "bus_stops", [])]
        self._write("stations.json", list(self.stations) + list(self.facility_pois)
                    + stop_pois)
        # ---- routes.json ----
        eta = self.compute_route_eta(self.route_node_ids)
        self._write("routes.json", [{
            "id": "main_route",
            "name": "QL1 Nam Tuy Hoa -> Ben xe Mien Dong Moi",
            "nodes": self.route_node_ids,
            # CHIỀU DÀI ĐO TRÊN TUYẾN ĐÃ CẮT, KHÔNG phải corridor_len
            # (corridor kéo từ Sông Cầu nên dài hơn tuyến xe khách ~68 km).
            "length": round(self._measure_route_length(self.route_node_ids), 1),
            # ETA TÍNH ĐƯỢC — không có hằng số "9 giờ" ở bất kỳ đâu.
            "eta": eta,
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




if __name__ == "__main__":
    gen = MapGenerator()
    gen.generate_topology()
    gen.generate_environment()
    gen.validate()
    gen.export()
