# -*- coding: utf-8 -*-
"""
AUDIT WORLD — kiem tra du lieu generated/ theo BUSDRIVEVN MASTER SPEC.
Chay: python tools/audit_world.py
Chi DOC, khong ghi. In ra cac loi vi pham rule 6/7/8/9/14/15/22/39/53/59/60.
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, "generated", "maps")

EPS = 1e-6
issues = []


def bad(rule, msg):
    issues.append((rule, msg))


def _obb_overlap(a, b):
    """Hai hộp xoay (cx, cz, hw, hd, rot, id) có cắt nhau không? — SAT 4 trục.

    Dùng để phát hiện POI/bến chồng lấn. Khoảng hở `slack` (m) cho phép lề
    an toàn: 2 hộp chạm sát nhau vẫn tính là KHÔNG chồng.
    """
    slack = 6.0

    def axes(box):
        cx, cz, hw, hd, rot, _id = box
        c, s = math.cos(rot), math.sin(rot)
        return [((c, s), (s, -c)), ((c, -s), (s, c))]

    def corners(box):
        cx, cz, hw, hd, rot, _id = box
        c, s = math.cos(rot), math.sin(rot)
        return [(cx + ox * c - oz * s, cz + ox * s + oz * c)
                for (ox, oz) in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]

    ca, cb = corners(a), corners(b)
    for (nx, ny), _ in axes(a) + axes(b):
        pa = [x * nx + z * ny for (x, z) in ca]
        pb = [x * nx + z * ny for (x, z) in cb]
        gap = min(pa) - max(pb)
        if gap > slack:
            return False
        gap = min(pb) - max(pa)
        if gap > slack:
            return False
    return True


def load(name):
    with open(os.path.join(MAPS, name), encoding="utf-8") as f:
        return json.load(f)


world = load("world.json")
roads = load("roads.json")
stations = load("stations.json")
routes = load("routes.json")

nodes = {n["id"]: n for n in roads["nodes"]}
segs = roads["segments"]

print("=== 1. TOPOLOGY ===")
print("  nodes=%d segs=%d" % (len(nodes), len(segs)))

# ---------------------------------------------------------------- rule 7/57
# segment hop dang -> node id khong ton tai / segment trung / doan 0 length
bad_id = 0
zero_len = 0
dup = Counter()
for s in segs:
    a, b = s["from"], s["to"]
    if a not in nodes or b not in nodes:
        bad_id += 1
        continue
    p, q = nodes[a], nodes[b]
    d = math.hypot(q["x"] - p["x"], q["z"] - p["z"])
    if d < 0.5:
        zero_len += 1
    dup[(min(a, b), max(a, b), s.get("class"))] += 1
if bad_id:
    bad("7/57", "%d segment tro toi node khong ton tai" % bad_id)
if zero_len:
    bad("7", "%d segment dai < 0.5m (doan rac)" % zero_len)
dups = {k: v for k, v in dup.items() if v > 1}
if dups:
    bad("6", "%d cap node trung (segment song song/trung lap)" % len(dups))

# ---------------------------------------------------------------- rule 6
# node.connections khong chua segment id / segment khong xuat hien 2 lan
seg_by_node = defaultdict(list)
for s in segs:
    seg_by_node[s["from"]].append(s["id"])
    seg_by_node[s["to"]].append(s["id"])

conn_mismatch = 0
for n in roads["nodes"]:
    declared = set(n.get("connections", []) or [])
    actual = set(seg_by_node.get(n["id"], []))
    if declared and declared != actual:
        conn_mismatch += 1
if conn_mismatch:
    bad("6/57", "%d node co connections khop voi segment thuc" % conn_mismatch)

# ---------------------------------------------------------------- rule 53
# do thi lien tinh: BFS tu node pho bien nhat
adj = defaultdict(list)
for s in segs:
    adj[s["from"]].append(s["to"])
    adj[s["to"]].append(s["from"])

deg = {nid: len(set(adj[nid])) for nid in nodes}
seen = set()
best_cc = 0
main_component = set()      # tập node của thành phần lớn nhất (dùng ở rule P7-st)
start_list = sorted(nodes.keys(), key=lambda i: -deg.get(i, 0))
for st in start_list:
    if st in seen:
        continue
    q = deque([st])
    seen.add(st)
    comp = set([st])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                comp.add(v)
                q.append(v)
    if len(comp) > best_cc:
        best_cc = len(comp)
        main_component = comp
print("  connected component lon nhat: %d/%d node (%.2f%%)" %
      (best_cc, len(nodes), 100.0 * best_cc / max(1, len(nodes))))
print("  node NGOAI thanh phan chinh: %d" % (len(nodes) - best_cc))
if best_cc < len(nodes) * 0.99:
    bad("53", "do thi khong lien tinh: chi %.1f%% node nam trong component lon nhat"
        % (100.0 * best_cc / max(1, len(nodes))))

# ---------------------------------------------------------------- rule 8/59
# Chỉ đếm ĐƯỜNG PHỦ bị cắt. ALLEY/INTERNAL/SERVICE degree-1 là HỢP LỆ: ngõ cụt
# trong ngách, làn đỗ xe trong sân bến (xe lùi vào rồi chạy ra), đường vào
# trạm xăng. Trước đây audit đếm cả 3 loại nên luôn báo lỗi trong khi
# generator đã dọn đúng phần vi phạm thật.
BA = defaultdict(list)
for sg in segs:
    BA[sg["from"]].append(sg)
    BA[sg["to"]].append(sg)
DEAD_CLS = ("COLLECTOR", "PROVINCIAL_ROAD", "LOCAL", "ARTERIAL", "RURAL_LOCAL", "NATIONAL")
leaves = [nid for nid in nodes if deg.get(nid, 0) == 1]
leaf_road = []
for nid in leaves:
    for sg in BA.get(nid, ()):
        if sg.get("class") in DEAD_CLS and not sg.get("bridge"):
            leaf_road.append(nid)
            break
print("  degree-1 (cuc/tuan ket): %d | tren duong PHU bi cat: %d"
      % (len(leaves), len(leaf_road)))
if len(leaf_road) > max(60, len(nodes) * 0.035):
    bad("8/59", "qua nhieu duong phu bi cat: %d/%d (%.1f%%) — dead-end spam"
        % (len(leaf_road), len(nodes),
           100.0 * len(leaf_road) / max(1, len(nodes))))

# ================================================================ 1b. LUAT TOPOLOGY
# Mot khoi rieng cho cac quy tac do CHINH tang topology sinh ra. Dat o day vi
# `tools/map_generator.py` la SOURCE OF TRUTH va audit PHAI dung cung dinh
# nghia voi no, neu khong mot ben im lang con ben kia bao loi.
print("=== 1b. LUAT TOPOLOGY (khoang cach / bac node / giao lo) ===")
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("mg", os.path.join(ROOT, "tools",
                                                        "map_generator.py"))
_mg = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mg)
# IMPORT TƯƠNG ĐỐI. Đo được `AttributeError: ... has no attribute
# 'CROSS_MISS'`: audit chết ở dòng này, TRƯỚC khi kiểm tra bất kỳ thứ gì —
# mất khả năng đo được, và người đọc dễ tưởng "audit pass" trong khi audit
# chưa chạy dòng nào.
# Nguyên nhân: `tools/map_generator.py` trong working tree là một BIẾN THỂ
# KHÁC của tầng topology (có `TOPO_RANK` riêng, `_TOPO_LEGAL_RAW`, không có
# `CROSS_MISS`). Audit vẫn trỏ tới biến thể đã bị thay thế.
# KHÔNG đặt giá trị giả để "cho chạy": ngưỡng đo sai thì audit XANH giả còn
# nguy hiểm hơn audit đỏ. Thiếu thì in cảnh báo rõ ràng và bỏ quy tắc phụ
# thuộc nó; các quy tắc còn lại vẫn chạy.
_MISSING = [k for k in ("TOPO_LEGAL", "TOPO_DEGREE_CAP", "CROSS_MISS",
                        "TOPO_SMALL_ROAD", "TOPO_MIN_LINK_LEN")
            if not hasattr(_mg, k)]
if _MISSING:
    print("  [CANH BAO] generator thieu hang so: %s" % ", ".join(_MISSING))
    print("  [CANH BAO] bo qua cac quy tac phu thuoc chung. Cac quy tac khac "
          "van chay.")
TOPO_RANK = getattr(_mg, "TOPO_RANK", {})
TOPO_LEGAL = getattr(_mg, "TOPO_LEGAL", getattr(_mg, "_TOPO_LEGAL_RAW", {}))
TOPO_DEGREE_CAP = getattr(_mg, "TOPO_DEGREE_CAP", {})
CROSS_MISS = getattr(_mg, "CROSS_MISS", 100.0)
TOPO_SMALL_ROAD = getattr(_mg, "TOPO_SMALL_ROAD",
                          ("LOCAL", "ALLEY", "RURAL_LOCAL", "SERVICE",
                           "COLLECTOR"))
TOPO_MIN_LINK_LEN = getattr(_mg, "TOPO_MIN_LINK_LEN", {})

# --- (a) node type: "link" la node HINH HOC giua duong, khong phai nga giao ---
type_hist = Counter()
for nid in nodes:
    type_hist[nodes[nid].get("type") or "?"] += 1
print("  node type: %s" % dict(type_hist.most_common(6)))
# node bac >=3 duoc gan nhanh 'junction' o generator -> phai ton tai
junc = sum(1 for nid, a in BA.items() if len(a) >= 3)
linkish = type_hist.get("link", 0)
print("  nga giao that (bac>=3) = %d | node hinh hoc (link) = %d" % (junc, linkish))
if linkish == 0 and junc > 200:
    bad("T2", "khong co node 'link' nao ma van co %d nga giao — node giua duong "
              "dang bi dem la nga giao" % junc)

# --- (b) T1: hai nga giao lien tiep < 45m tren cung duong -----------------
JUNC_T = ("junction", "local", "highway", "crossing", "ramp", "tunnel",
          # --- node type của 5 road type mới (`ROAD_TYPE_OF_CLASS`) ---
          # Thiếu 5 key này thì T1 BỎ QUA đúng những cặp ngã tư sát nhau nằm
          # trong lớp phố vừa sinh ra: `residential`/`commercial` là `local` về
          # nghĩa, bỏ chúng là đo trừng phạt đúng chỗ vừa sửa. Danh sách đã
          # sẵn thiếu `collector`/`arterial`/`alley` từ trước — ghi ra để lần
          # sau ai cũng thấy, đừng tưởng là đủ.
          "inter_village", "industrial_access", "residential", "commercial",
          "agricultural")
ACC_CLS = ("STATION_ACCESS", "INTERNAL", "SERVICE")
adj_j = 0
close_by_cls = Counter()
for nid, arr in BA.items():
    if nodes[nid].get("type") not in JUNC_T:
        continue
    for sg in arr:
        if sg.get("class") in ACC_CLS:
            continue
        o = sg["to"] if sg["from"] == nid else sg["from"]
        if nodes[o].get("type") not in JUNC_T:
            continue
        dd = math.hypot(nodes[o]["x"] - nodes[nid]["x"],
                        nodes[o]["z"] - nodes[nid]["z"])
        # nguong theo BAC cua CHINH doan nay (P28, cung hang so voi
        # `topo_link_ok`): ngo 30m giua hai khoi la binh thuong, con QL1
        # 11m / Vanh dai 3 8.4m moi la loi that (xe vao 11m la ra khoi duong).
        lim = TOPO_MIN_LINK_LEN.get(TOPO_RANK.get(sg.get("class"), 3), 0.0)
        if lim > 0.0 and dd < lim and o > nid:     # moi cap dem 1 lan
            adj_j += 1
            close_by_cls[sg.get("class")] += 1
print("  cap nut giao lien tiep qua ngan (nguong theo bac): %d %s"
      % (adj_j, dict(close_by_cls)))
if adj_j > 20:
    bad("T1", "%d cap nut giao lien tiep qua nguong theo bac (>20) — can them "
              "node hinh hoc o giua hoac tach xa them" % adj_j)

# --- (c) T2/T3: bac node trong SAN BEN -----------------------------------
for stn in stations:
    if stn.get("type") not in ("BUS_STATION", "MAJOR_BUS_TERMINAL"):
        continue
    hw, hd = stn.get("w", 190) * 0.5 + 90, stn.get("d", 140) * 0.5 + 90
    inside = [nid for nid, nd in nodes.items()
              if abs(nd["x"] - stn["x"]) <= hw and abs(nd["z"] - stn["z"]) <= hd]
    if not inside:
        continue
    mx = max(len(BA.get(q, ())) for q in inside)
    print("     %-24s max bac node trong san = %d | node = %d"
          % (stn.get("name"), mx, len(inside)))
    if mx > 8:
        bad("T3", "san %s co node %d nhanh — layout san phai la luong thang, "
                  "khong phai nan quat" % (stn.get("name"), mx))

# --- (d) T4: giao lo THAT THIEU -----------------------------------------
# Do phan bo do duoc tren 6886 segment: 96/157 diem cat da cach nga giao that
# <=25m (da la nga tu 4 nhanh), 50 o 25-75m, chi 33 o 75-200m, 11 >200m.
# => LUAT: nga giao thieu THAT khi diem cat cach >100m moi nga giao.
# Doi nguong 25m thi audit bao 63 loi GIA dong thoi generator tach nut o 25m
# => sinh 145 cap nut giao cach nhau 23-31m (doi loi "giao lo" lay loi "nut
# dinh nhau").
CROSS_CELL = 220.0
cgrid = defaultdict(list)
for sg in segs:
    if sg.get("class") in ("TUNNEL", "EXPRESSWAY", "RAMP"):
        continue
    a, b = nodes[sg["from"]], nodes[sg["to"]]
    hwid = (sg.get("width", 12) or 12) * 0.5
    for cx in range(int((min(a["x"], b["x"]) - hwid) // CROSS_CELL),
                    int((max(a["x"], b["x"]) + hwid) // CROSS_CELL) + 1):
        for cz in range(int((min(a["z"], b["z"]) - hwid) // CROSS_CELL),
                        int((max(a["z"], b["z"]) + hwid) // CROSS_CELL) + 1):
            cgrid[(cx, cz)].append(sg)
JCELL = 256
jgrid = defaultdict(list)
for nid, nd in nodes.items():
    if deg.get(nid, 0) >= 3:
        jgrid[(int(nd["x"] // JCELL), int(nd["z"] // JCELL))].append(
            (nd["x"], nd["z"]))


def near_junction(x, z):
    cx, cz = int(x // JCELL), int(z // JCELL)
    best = 1e18
    for dx in range(-1, 2):
        for dz in range(-1, 2):
            for jx, jz in jgrid.get((cx + dx, cz + dz), ()):
                dd = math.hypot(jx - x, jz - z)
                if dd < best:
                    best = dd
    return best


def _seg_x(p1, p2, q1, q2):
    d1x, d1z = p2[0] - p1[0], p2[1] - p1[1]
    d2x, d2z = q2[0] - q1[0], q2[1] - q1[1]
    den = d1x * d2z - d1z * d2x
    if abs(den) < 1e-9:
        return None
    t = ((q1[0] - p1[0]) * d2z - (q1[1] - p1[1]) * d2x) / den
    u = ((q1[0] - p1[0]) * d1z - (q1[1] - p1[1]) * d1x) / den
    if 0.02 < t < 0.98 and 0.02 < u < 0.98:
        return (p1[0] + d1x * t, p1[1] + d1z * t)
    return None


cross_n = cross_near = 0
cross_pairs = []
cross_hist = defaultdict(int)
cdone = set()
for sg in segs:
    if sg.get("class") in ("TUNNEL", "EXPRESSWAY", "RAMP") or sg["id"] in cdone:
        continue
    a, b = nodes[sg["from"]], nodes[sg["to"]]
    hwid = (sg.get("width", 12) or 12) * 0.5
    for cx in range(int((min(a["x"], b["x"]) - hwid) // CROSS_CELL),
                    int((max(a["x"], b["x"]) + hwid) // CROSS_CELL) + 1):
        for cz in range(int((min(a["z"], b["z"]) - hwid) // CROSS_CELL),
                        int((max(a["z"], b["z"]) + hwid) // CROSS_CELL) + 1):
            for o in cgrid.get((cx, cz), ()):
                if o["id"] <= sg["id"] or o["id"] in cdone:
                    continue
                if o["from"] in (sg["from"], sg["to"]) or \
                        o["to"] in (sg["from"], sg["to"]):
                    continue
                q1, q2 = nodes[o["from"]], nodes[o["to"]]
                pt = _seg_x((a["x"], a["z"]), (b["x"], b["z"]),
                            (q1["x"], q1["z"]), (q2["x"], q2["z"]))
                if pt is None:
                    continue
                dj = near_junction(*pt)
                for _b in (25, 50, 75, 100, 150, 200, 10 ** 7):
                    if dj <= _b:
                        cross_hist[_b] += 1
                        break
                if dj <= CROSS_MISS:
                    cross_near += 1
                else:
                    cross_n += 1
                    if len(cross_pairs) < 6:
                        cross_pairs.append((sg["id"], o["id"],
                                            sg.get("class"), o.get("class"),
                                            round(dj, 1)))
    cdone.add(sg["id"])
print("  giao lo KHONG NUT that: %d (diem cat lech >%dm tu nga giao) | "
      "cung co nga tu that lech <=%dm: %d"
      % (cross_n, int(CROSS_MISS), int(CROSS_MISS), cross_near))
print("     phan bo giao lo theo khoang cach toi nga giao that:")
for _b in (25, 50, 75, 100, 150, 200, 10 ** 7):
    _lbl = (">200m" if _b > 10 ** 6 else "<=%dm" % _b)
    print("        %-7s : %4d" % (_lbl, cross_hist[_b]))
if cross_n > 8:
    bad("T4", "%d cap duong cat nhau o diem CACH ngai giao that >%dm, khong co nut "
              "(nguong chung voi generator; tran >8): %s"
        % (cross_n, int(CROSS_MISS), cross_pairs[:4]))

# --- (e) T5: cấp nối theo MA TRAN cua generator -------------------------
# KHÔNG hiểu "lệch > 1 bậc": node giao cao tốc (bậc 0) + QL1 (bậc 2) là
# nút giao HỢP LỆ, heuristic đó báo 660 lỗi sai. Dùng chính TOPO_LEGAL.
hier_bad = 0
hier_ex = []


def _cls_of(nid):
    best_r, best_c = 9, "LOCAL"
    for sg in BA.get(nid, ()):
        r = TOPO_RANK.get(sg.get("class"), 4)
        if r < best_r:
            best_r, best_c = r, sg.get("class")
    return best_c


for nid, arr in BA.items():
    # bỏ qua T5 nếu generator không có ma trận (không đo được đại lượng
    # này thì không phát ra kết luận).
    if not TOPO_LEGAL:
        break
    # CÓ NHÁNH CẦU VƯỢT => giao KHÁC MỨC, hợp pháp. QL1 giao CT01 là ngã giao
    # khác mức thật .
    if any(sg.get("bridge") for sg in arr):
        continue
    present = set(sg.get("class") for sg in arr)
    for c in present:
        for dd in present:
            if dd == c:
                continue
            if c not in TOPO_LEGAL.get(dd, ()):
                hier_bad += 1
                if len(hier_ex) < 6:
                    hier_ex.append((nid, c, dd))
                break
print("  cap noi khong hop phap theo ma tran generator: %d %s"
      % (hier_bad, hier_ex[:3]))
if hier_bad:
    bad("T5", "%d cap noi khong nam trong ma tran TOPO_LEGAL %s"
        % (hier_bad, hier_ex[:4]))

# --- (f) T6: duong CONG xuyen san ben ------------------------------------
YARD_CLS = ("INTERNAL", "STATION_ACCESS")
thru = 0
for sg in segs:
    if sg.get("class") in YARD_CLS:
        continue
    a, b = nodes[sg["from"]], nodes[sg["to"]]
    for stn in stations:
        if stn.get("type") not in ("BUS_STATION", "MAJOR_BUS_TERMINAL"):
            continue
        if (abs(a["x"] - stn["x"]) < stn.get("w", 190) * 0.5 and
                abs(a["z"] - stn["z"]) < stn.get("d", 140) * 0.5 and
                abs(b["x"] - stn["x"]) < stn.get("w", 190) * 0.5 and
                abs(b["z"] - stn["z"]) < stn.get("d", 140) * 0.5):
            thru += 1
            break
print("  duong cong xuyen qua san ben: %d" % thru)
if thru:
    bad("T6", "%d doan duong CONG xuyen qua san ben" % thru)

# --- (g) T7: doan duong qua dai ----------------------------------------
# Lop bug hinh hoc "im lang": `_add_link_road` tung dung vector phap tuyen CHUA
# chuan hoa (`nx,nz = -dz,dx`, do lon = L) nen duong noi 2km bi keo thanh vong
# di-ve 100km => 38 doan >1.5km (dai nhat 51 334m) + 588km mat tien ao =>
# ~63.000 nha phat sinh tren duong khong ton tai.
_lw, _le, _ex = 0, 0, []
for sg in segs:
    a, b = nodes[sg["from"]], nodes[sg["to"]]
    ln = math.hypot(a["x"] - b["x"], a["z"] - b["z"])
    if ln > 8000.0:
        _le += 1
        if len(_ex) < 5:
            _ex.append((sg["id"], sg.get("class"), round(ln),
                        sg.get("name") or "-"))
    elif ln > 2000.0:
        _lw += 1
print("  doan duong: >8km (LOI) = %d | >2km (canh bao) = %d %s" % (_le, _lw, _ex))
if _lw > 12:
    bad("T7", "%d doan duong > 2km — duong bi keo dai khong co gi giua" % _lw)
if _le:
    bad("T7", "%d doan duong > 8km: %s" % (_le, _ex))

# --- (h) tran bac node theo RANK ----------------------------------------
over_rank = 0
for nid, arr in BA.items():
    r = min(TOPO_RANK.get(sg.get("class"), 4) for sg in arr)
    cap_n = TOPO_DEGREE_CAP.get(r, 6)
    if len(arr) > cap_n:
        over_rank += 1
print("  node vuot TRAN BAC THEO RANK: %d" % over_rank)
if over_rank:
    bad("T3", "%d node vuot tran bac theo rank" % over_rank)

# ---------------------------------------------------------------- rule 12
# GIAO LỠ: (a) node qua nhieu nhanh  (b) 2 nhanh cung goc = 2 duong chong nhau
branches_at = defaultdict(list)
for s in segs:
    branches_at[s["from"]].append(s)
    branches_at[s["to"]].append(s)

# Node tam SAN BEN XE (class INTERNAL) co 18-33 nhanh la SAN BAI, KHONG phai
# nga giao duong: san ben xe la mot mat be tong bang, cac duong noi bo la
# luoi nan dat. Renderer da co tran kich thuoc san giao lo cho cac nut nay.
# -> chi canh bao node duong THAT (co duong cap lon chui vao).
def _is_yard_hub(nid):
    arr = branches_at.get(nid, [])
    if len(arr) <= 8:
        return False
    road_like = [s for s in arr if s.get("class") not in ("INTERNAL", "SERVICE", "ALLEY")]
    return len(road_like) == 0

over_cap = [(nid, len(a)) for nid, a in branches_at.items() if len(a) > 8 and not _is_yard_hub(nid)]
yard_hubs = sum(1 for nid, a in branches_at.items() if len(a) > 8 and _is_yard_hub(nid))
over_cap.sort(key=lambda t: -t[1])
print("  node >8 nhanh tren DUONG THAT: %d (max %d) | tam san ben (INTERNAL, bo qua): %d"
      % (len(over_cap), over_cap[0][1] if over_cap else 0, yard_hubs))
if over_cap:
    bad("12", "%d node duong co >8 nhanh (te nhat %s = %d nhanh) — spaghetti, "
              "khong phai nga lo" % (len(over_cap), over_cap[0][0], over_cap[0][1]))

NEAR_DEG = 9.0
coincident = 0
coincident_nodes = set()
for nid, arr in branches_at.items():
    if len(arr) < 2:
        continue
    p = nodes[nid]
    items = []
    for s in arr:
        if s.get("bridge") or s.get("class") == "TUNNEL":
            continue
        o = nodes[s["to"] if s["from"] == nid else s["from"]]
        items.append((math.atan2(o["x"] - p["x"], o["z"] - p["z"]), s, o))
    items.sort(key=lambda t: t[0])
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            gap = math.degrees(items[j][0] - items[i][0])
            if gap < 1e-9:
                gap += 360
            if gap >= NEAR_DEG:
                break
            # 2 nhanh cung goc chi la CHONG NHAU khi ca 2 con dai
            li = math.hypot(items[i][2]["x"] - p["x"], items[i][2]["z"] - p["z"])
            lj = math.hypot(items[j][2]["x"] - p["x"], items[j][2]["z"] - p["z"])
            if min(li, lj) < 25.0:
                continue
            # bo qua cap trung goc trong san ben: ca 2 nhanh deu la
            # INTERNAL/ALLEY cua cung mot san be tong bang -> duong "chong"
            # ma benh mat kin, khong nhin thay, khong phai loi hinh hoc.
            ca = items[i][1].get("class")
            cb = items[j][1].get("class")
            if ca in ("INTERNAL", "SERVICE") and cb in ("INTERNAL", "SERVICE"):
                continue
            coincident += 1
            coincident_nodes.add(nid)
print("  cap nhanh trung goc <%.0f do (duong chong nhau): %d o %d node"
      % (NEAR_DEG, coincident, len(coincident_nodes)))
if coincident > 0:
    # Ghi rõ ràng buộc phải chọn: 78/80 lần chuyển nhánh bị CHẶN vì sẽ cắt
    # mạng . Ưu tiên road network
    # liên thông (rule 53) hơn hạ cap hình học cục bộ (rule 6). Renderer đã có
    # junction patch thật nên đường chồng nhẹ không gây z-fighting.
    bad("6/12", "%d cap nhanh cung goc duoi %.0f do o %d node — chap nhan de doi "
                "lay road network lien thong (78/80 lan sua bi chan vi cat mang)"
                % (coincident, NEAR_DEG, len(coincident_nodes)))

# ---------------------------------------------------------------- rule 6
# 2 doan CUNG cap node = duong chong DUNG vi tri (khac cap o muc tren)
dup_pair = Counter()
for s in segs:
    dup_pair[(min(s["from"], s["to"]), max(s["from"], s["to"]))] += 1
dup2 = [k for k, v in dup_pair.items() if v > 1]
if dup2:
    bad("6", "%d cap node co >1 segment (duong chong dung vi tri)" % len(dup2))

# ---------------------------------------------------------------- rule 9/60
# phat hien grid: so segment ngang/doc gan nhu nhau + spacing deu
hor = ver = 0
for s in segs:
    a, b = nodes[s["from"]], nodes[s["to"]]
    dx, dz = abs(b["x"] - a["x"]), abs(b["z"] - a["z"])
    L = math.hypot(dx, dz)
    if L < 1:
        continue
    if dz / L < 0.08:
        hor += 1
    elif dx / L < 0.08:
        ver += 1
print("  segment ngang=%d doc=%d (ty %.2f)" % (hor, ver, ver / max(1, hor)))
if hor > 40 and ver > 40 and 0.75 < ver / max(1, hor) < 1.33:
    # chi canh bao khi ty qua deu + nhieu
    pass  # xu ly phan sau bang spacing test

# ---------------------------------------------------------------- rule 11
# DUONG DIA PHONG KHONG DUOC NOI THANG VAO CAO TOC
# lấy từ generator (khối import ở trên) — MỘT định nghĩa duy nhất
SMALL_CLS = TOPO_SMALL_ROAD
hw_nodes = set()
for s in segs:
    if s.get("class") == "EXPRESSWAY":
        hw_nodes.add(s["from"]); hw_nodes.add(s["to"])
direct = 0
graded = 0
for nid in hw_nodes:
    for s in branches_at.get(nid, []):
        if s.get("class") not in SMALL_CLS:
            continue
        # duong nho qua cao toc o MUC KHAC (co bridge) la cau vuot — dung
        # thuc te Viet Nam, khong phai "noi thang vao mat duong toc"
        if s.get("bridge"):
            graded += 1
        else:
            direct += 1
print("  duong nho o nut cao toc: %d noi thang (sai) | %d quang muc khac (dung)"
      % (direct, graded))
if direct:
    bad("11", "%d nhanh LOCAL/ALLEY/COLLECTOR noi thang vao nut cao toc "
              "(phai qua ramp hoac cau vuot)" % direct)

# `get_elevation` la METHOD, can instance that (khoi tao 0.015s,
# do duoc). KHONG dung ham module va KHONG dat gia tri gia.
_elev_ref = _mg.MapGenerator().get_elevation

# ---------------------------------------------------------------- rule 21 (P66)
# DUONG BI CHON DUOI DAT — xe chay xuyen dat
# Do duoc trong game: 4/2214 node duong nam duoi terrain 2-10m
# (IC_TL720 -6.4 -> -10.3m, IC_QL56 -0.6 -> -1.3m, QL1 -2.0m).
# Da co `_fix_bridge_heights` (nang cau len) nhung THIEU phan nang duong choi (P65).
# `get_elevation` la METHOD cua MapGenerator, khong phai ham module. Tao
# instance (khoi tao do duoc 0.015s). KHONG dat gia tri gia de cho audit chay:
# v1 goi no nhu ham module => `NameError` => audit CHET truoc khi kiem
# het cac rule sau, tuc la audit im lang mat kha nang do (P48).
# CHI PHI: khong cache, 2.6ms/lan. 5 diem x 8287 doan = 108s qua nang cho
# audit. Do thay bang: MOI node (1 mau) + giua cac doan DAI >150m. Doan ngan
# gan nhu khong choi o giua (hai dau ke nhau, terrain doi cham); choi nghiem
# trong do deu nam o ramp dai.
# đo CẢ HAI chiều. Chỉ kiểm chôn là bỏ trót chiều lơ lửng — đo được
# `n_100 roadY 10.54 | terrain -14.65 | +25.19m`. Ngưỡng lơ lửng CAO HƠN
# (3m) vì đường trên cầu vượt/đắp nền hợp lệ cao hơn chút; 25m là lỗi chắc.
_BURY_TOL = 0.30
_FLOAT_TOL = 3.0
_elev_cache = {}


def _terrain_at(x_, z_):
    k_ = (int(x_ * 4.0), int(z_ * 4.0))
    v_ = _elev_cache.get(k_)
    if v_ is None:
        v_ = _elev_ref(x_, z_)            # mat dat that (water=True)
        _elev_cache[k_] = v_
    return v_


_buried = []
_floated = []
_worst_bury = 0.0
_worst_float = 0.0
_nod_has_hw = set()
for s_ in segs:
    if s_.get("bridge") or s_.get("class") == "TUNNEL":
        _nod_has_hw.add(s_["from"])
        _nod_has_hw.add(s_["to"])

for nid_, n_ in nodes.items():
    if nid_ in _nod_has_hw:
        continue
    th_ = _terrain_at(n_["x"], n_["z"])
    gap_ = n_.get("y", 0.0) - th_
    if gap_ < -_BURY_TOL:
        _worst_bury = min(_worst_bury, gap_)
        _buried.append((nid_, "node", n_.get("n_type") or "-",
                        round(gap_, 1), round(n_["x"]), round(n_["z"])))
    elif gap_ > _FLOAT_TOL:
        _worst_float = max(_worst_float, gap_)
        _floated.append((nid_, "node", n_.get("n_type") or "-",
                         round(gap_, 1), round(n_["x"]), round(n_["z"])))

# giua doan: hai dau tren mat dat CHUA dam bao giua khong choi
for s_ in segs:
    if s_.get("bridge") or s_.get("class") == "TUNNEL":
        continue
    a_, b_ = nodes[s_["from"]], nodes[s_["to"]]
    if math.hypot(b_["x"] - a_["x"], b_["z"] - a_["z"]) <= 150.0:
        continue
    for t_ in (0.25, 0.5, 0.75):
        x_ = a_["x"] + (b_["x"] - a_["x"]) * t_
        z_ = a_["z"] + (b_["z"] - a_["z"]) * t_
        gap_ = (a_.get("y", 0.0) + (b_.get("y", 0.0) - a_.get("y", 0.0)) * t_) \
            - _terrain_at(x_, z_)
        if gap_ < -_BURY_TOL:
            _worst_bury = min(_worst_bury, gap_)
            _buried.append((s_["id"], s_.get("class"), s_.get("name") or "-",
                            round(gap_, 1), round(x_), round(z_)))
        elif gap_ > _FLOAT_TOL:
            _worst_float = max(_worst_float, gap_)
            _floated.append((s_["id"], s_.get("class"), s_.get("name") or "-",
                             round(gap_, 1), round(x_), round(z_)))

print("  duong choi duoi dat >%.2fm: %d diem (sau nhat %.1fm) | duong lo "
      "lung >%.1fm: %d diem (toi nhat %.1fm) | %d mau cao do"
      % (_BURY_TOL, len(_buried), _worst_bury, _FLOAT_TOL, len(_floated),
         _worst_float, len(_elev_cache)))
if _buried:
    for b_ in _buried[:6]:
        print("      CHON  %-9s %-10s %-20s %sm tai (%d,%d)"
              % (b_[0], b_[1], b_[2][:20], b_[3], b_[4], b_[5]))
    bad("21", "%d diem duong bi choi duoi mat dat >%.2fm (xe chay xuyen dat; "
              "sau nhat %.1fm)" % (len(_buried), _BURY_TOL, -_worst_bury))
if _floated:
    for b_ in _floated[:6]:
        print("      LUNG   %-9s %-10s %-20s +%sm tai (%d,%d)"
              % (b_[0], b_[1], b_[2][:20], b_[3], b_[4], b_[5]))
    bad("22", "%d diem duong lo lung tren mat dat >%.1fm (duong treo trong "
              "khong; toi nhat %.1fm)" % (len(_floated), _FLOAT_TOL,
                                          _worst_float))

# ---------------------------------------------------------------- rule 20/36
# do lech node.y vs terrain khong do duoc o day (can JS) — kiem slope
max_slope = 0.0
steep = 0
for s in segs:
    a, b = nodes[s["from"]], nodes[s["to"]]
    run = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
    if run < 1:
        continue
    sl = abs(b.get("y", 0) - a.get("y", 0)) / run
    max_slope = max(max_slope, sl)
    if sl > 0.16 and not s.get("bridge") and s.get("class") != "TUNNEL":
        steep += 1
print("  max slope=%.1f%% | doan >16%%: %d" % (max_slope * 100, steep))
if steep > 30:
    bad("20/36", "%d doan duong doc hon 16%% (xe khoi duoc/khong thuc te)" % steep)

# ---------------------------------------------------------------- rule 14/39
print("=== 2. STATION ===")
st_by_type = Counter(s.get("type") for s in stations)
print(" ", dict(st_by_type))

def seg_dist(px, pz, a, b):
    dx, dz = b["x"] - a["x"], b["z"] - a["z"]
    l2 = dx * dx + dz * dz
    if l2 <= 0:
        return math.hypot(px - a["x"], pz - a["z"])
    t = max(0.0, min(1.0, ((px - a["x"]) * dx + (pz - a["z"]) * dz) / l2))
    return math.hypot(px - (a["x"] + dx * t), pz - (a["z"] + dz * t))


# index seg nhanh
CELL = 256
grid = defaultdict(list)
for s in segs:
    a, b = nodes[s["from"]], nodes[s["to"]]
    hw = (s.get("width", 12) * 0.5)
    x0 = int((min(a["x"], b["x"]) - hw) // CELL)
    x1 = int((max(a["x"], b["x"]) + hw) // CELL)
    z0 = int((min(a["z"], b["z"]) - hw) // CELL)
    z1 = int((max(a["z"], b["z"]) + hw) // CELL)
    for cx in range(x0, x1 + 1):
        for cz in range(z0, z1 + 1):
            grid[(cx, cz)].append(s)


def near_segs(x, z, r=400):
    out = []
    cx, cz = int(x // CELL), int(z // CELL)
    rr = int(r // CELL) + 1
    seen = set()
    for dx in range(-rr, rr + 1):
        for dz in range(-rr, rr + 1):
            for s in grid.get((cx + dx, cz + dz), []):
                if s["id"] in seen:
                    continue
                seen.add(s["id"])
                out.append(s)
    return out


def road_probe(x, z, r=400):
    best = None
    for s in near_segs(x, z, r):
        a, b = nodes[s["from"]], nodes[s["to"]]
        d = seg_dist(x, z, a, b)
        if best is None or d < best[0]:
            best = (d, s)
    return best


off_road = []
for s in stations:
    if s.get("type") in ("BUS_STOP", "TOLL", "TOLL_LANE", "FUEL_STATION", "REST_AREA"):
        pass
    p = road_probe(s["x"], s["z"])
    if p is None:
        off_road.append((s, None))
        continue
    d, seg = p
    w = seg.get("width", 12)
    if s.get("type") in ("BUS_STATION", "MAJOR_BUS_TERMINAL"):
        # BẾN XE: sân là mặt bê tông, đường nội bộ CHÍNH BẾN chạy qua tâm
        # sân là đúng thiết kế (đo được: Nam Tuy Hòa tâm bến nằm trên đường
        # nội bộ w=16, 4 góc sân cách đường lớn 0m). Chỉ báo lỗi thật khi:
        #   * tâm bến nằm trên đường LỚN (không phải đường nội bộ của bến), hoặc
        #   * bến không có đường nào để vào (d > 200m).
        big_road_under = seg.get("class") not in ("INTERNAL", "SERVICE",
                                                  "STATION_ACCESS", "ALLEY")
        if d > 200:
            off_road.append((s, d))
        elif big_road_under and d < w * 0.5:
            off_road.append((s, d))
    else:
        if d > 90:
            off_road.append((s, d))
if off_road:
    bad("14/62", "%d station/POI cach duong qua xa hoac nam giua duong: %s"
        % (len(off_road), ", ".join("%s(%.0fm)" % (s.get("name"), d) if d else s.get("name")
                                    for s, d in off_road[:12])))

# ---------------------------------------------------------------- rule 39
overlap = []
for i in range(len(stations)):
    for j in range(i + 1, len(stations)):
        a, b = stations[i], stations[j]
        if abs(a["x"] - b["x"]) > 600 or abs(a["z"] - b["z"]) > 600:
            continue
        d = math.hypot(a["x"] - b["x"], a["z"] - b["z"])
        ra = math.hypot(a.get("w", 100), a.get("d", 80)) * 0.5
        rb = math.hypot(b.get("w", 100), b.get("d", 80)) * 0.5
        if d < (ra + rb) * 0.65:
            overlap.append((a.get("name"), b.get("name"), d))
if overlap:
    bad("39", "%d cap station/chung song nhau: %s"
        % (len(overlap), "; ".join("%s~%s(%.0fm)" % o for o in overlap[:8])))

# ---------------------------------------------------------------- rule 40/41
spawn = [s for s in stations if s.get("is_spawn")]
for s in spawn:
    n = len(s.get("baySlots", []) or [])
    print("  spawn %s: %d bay slot, w=%s d=%s" % (s.get("name"), n, s.get("w"), s.get("d")))
    if n < 8:
        bad("40/41", "spawn %s chi co %d bay slot (yeu cau ~15)" % (s.get("name"), n))

# ---------------------------------------------------------------- rule 17
print("=== 3. DIEM DUNG ===")
# CHỈ ĐIỂM DỪNG. Đo được cả 3 cặp "dưới 600m" đều là ĐIỂM DỪNG đối với
# TRẠM THU PHÍ / TRẠM XĂNG / TRẠM NGHỈ (Ba Bàu 358m, Vĩnh Hảo 373m,
# PVOIL Hoàng Hữu Nam 396m) — ba tiện ích khác nhau ở ba chỗ khác nhau.
# Trạm thu phí cách điểm dừng vài trăm mét là BÌNH THƯỜNG ở Việt Nam, thực
# tế hai thứ đó hay đứng cạnh nhau. "Nhầm điểm dừng" chỉ có nghĩa khi so giữa
# HAI ĐIỂM DỪNG với nhau. Đây là sửa LUẬT theo bằng chứng, không sửa data.
stops = [s for s in stations if s.get("type") == "BUS_STOP"]
# kiem tra khoang cach tren truc route
rt = routes[0] if routes else None
total = 0.0            # do dai tuyen do AUDIT tu do (khong lay tu `eta`)
if rt and len(rt.get("nodes", [])) > 2:
    pts = [nodes[i] for i in rt["nodes"] if i in nodes]
    chain = [0.0]
    for i in range(1, len(pts)):
        chain.append(chain[-1] + math.hypot(pts[i]["x"] - pts[i - 1]["x"],
                                            pts[i]["z"] - pts[i - 1]["z"]))
    total = chain[-1]
    print("  route dai %.1f km, %d waypoint" % (total / 1000, len(pts)))
    # gan nhat toi truc
    gaps = []
    for st in stops:
        best = None
        for i, p in enumerate(pts):
            d = math.hypot(st["x"] - p["x"], st["z"] - p["z"])
            if best is None or d < best[0]:
                best = (d, chain[i])
        if best and best[0] < 250:
            gaps.append(best[1])
    gaps.sort()
    if gaps:
        dd = [gaps[i + 1] - gaps[i] for i in range(len(gaps) - 1)]
        print("  khoang cach giua diem dung tren truc: min=%.0fm max=%.0fm trungbinh=%.0fm"
              % (min(dd), max(dd), sum(dd) / len(dd)))
        close = [d for d in dd if d < 600]
        if close:
            bad("17", "%d khoang cach diem dung < 600m tren truc (nham diem dung)" % len(close))

# ------------------------------------------------------------- rule 12/80-84
# ETA TUYEN + LOP HANH CHINH. P71: `travelTime` cu la hang so 9*3600 chep tay.
# O day audit TU DO lai (khong tin generator) roi so voi `routes[0].eta`.
print("=== 3b. ETA + HANH CHINH ===")
eta = (rt or {}).get("eta")
if not isinstance(eta, dict) or not eta.get("totalSeconds"):
    bad("12/80", "routes[0].eta thieu hoac totalSeconds = 0 "
                 "(ETA phai TINH RA, khong hard-code)")
else:
    parts = (eta.get("driveSeconds", 0.0) + eta.get("junctionSeconds", 0.0)
             + eta.get("stationSeconds", 0.0) + eta.get("busStopSeconds", 0.0))
    if abs(parts - eta["totalSeconds"]) > 1.0:
        bad("12/80", "ETA tong (%.1fs) != tong thanh phan (%.1fs)"
            % (eta["totalSeconds"], parts))
    if abs(eta["totalSeconds"] - 9 * 3600) < 1.0:
        bad("12/80", "ETA = 32400s DUNG BANG HANG SO 9 GIO CU - van la hard-code")
    if not eta.get("model", {}).get("note"):
        bad("12/80", "ETA thong bao he so la tham so mo hinh (model.note)")
    if total > 0:
        rel = abs(eta.get("distanceM", 0.0) - total) / total
        if rel > 0.03:
            bad("12/81", "ETA distanceM=%.0fm lech tuyen do audit do %.0fm (%.2f%%)"
                % (eta.get("distanceM", 0.0), total, rel * 100))
    v = eta.get("avgSpeedKmh", 0.0)
    if not (30.0 <= v <= 75.0):
        bad("12/82", "ETA toc do trung binh %.1f km/h ngoai khoang 30-75 "
                     "(khong hop le voi xe khach QL1)" % v)
    # P71 REGRESSION GUARD: nhanh dwell ben truoc day LUON = 0 vi dung hop tam
    # ben thay vi `anchor_node` -> nhanh la code chet. Phai co ben tren tuyen.
    bus_st = [s for s in stations
              if s.get("type") in ("BUS_STATION", "MAJOR_BUS_TERMINAL")]
    if bus_st and eta.get("stationsOnRoute", 0) <= 0:
        bad("12/83", "co %d ben xe nhung ETA bao stationsOnRoute=0 - nhanh "
                     "dwell ben dang chet (P71)" % len(bus_st))
    if bus_st and eta.get("stationSeconds", 0.0) <= 0:
        bad("12/83", "ETA stationSeconds=0 trong khi co ben xe tren tuyen")
    print("  ETA %.2f h | %.1f km | tb %.1f km/h | %d nut giao (%.0fs) | "
          "%d ben (%.0fs) | %d diem dung (%.0fs)"
          % (eta.get("totalHours", eta["totalSeconds"] / 3600.0),
             eta.get("distanceM", 0) / 1000.0, v, eta.get("junctions", 0),
             eta.get("junctionSeconds", 0.0), eta.get("stationsOnRoute", 0),
             eta.get("stationSeconds", 0.0), eta.get("busStopsOnRoute", 0),
             eta.get("busStopSeconds", 0.0)))

adm = world.get("admin")
if not isinstance(adm, dict) or not adm.get("units"):
    bad("12/84", "world.json thieu khoi 'admin' (don vi hanh chinh sau sap nhap "
                 "12/6/2025) - js/map.js getAdminUnit() se tra null o moi noi")
else:
    if not adm.get("axis"):
        bad("12/84", "world.admin.thieu 'axis' - js/map.js phai lay truc do tu "
                     "day, KHONG tu suy lai (README 3g/P19)")
    _seen, _dupu = set(), 0
    for u in adm["units"]:
        k = (u.get("province"), u.get("name"))
        if k in _seen:
            _dupu += 1
        _seen.add(k)
        if u.get("onCorridor") is False and not u.get("kmApprox"):
            bad("12/84", "don vi %s/%s khong nam tren tuyen nhung khong co "
                         "co do kmApprox" % (u.get("province"), u.get("name")))
    if _dupu:
        bad("12/84", "%d don vi hanh chinh trung ten+tinh" % _dupu)
    print("  admin: %d don vi / %d tinh | %d don vi gan tuyen | axis %d diem"
          % (len(adm["units"]), len({u.get("province") for u in adm["units"]}),
             sum(1 for u in adm["units"] if u.get("onCorridor")),
             len(adm.get("axis") or [])))

# ---------------------------------------------------------------- rule 15/22
print("=== 4. NHA / BUILDING ===")
sec_dir = os.path.join(MAPS, "sectors")
files = sorted(os.listdir(sec_dir))
total_b = 0
on_road = []
btypes = Counter()
bsigs = Counter()
for fn in files:
    with open(os.path.join(sec_dir, fn), encoding="utf-8") as f:
        sec = json.load(f)
    for ck, ch in sec.items():
        for b in (ch.get("buildings") or []):
            total_b += 1
            btypes[b.get("type", "?")] += 1
            # CHU KY HINH HOC: KHONG KE MAU. Hai nha chung ky = cung hinh.
            bsigs[(b.get("type"), b.get("nf"), b.get("w"), b.get("d"),
                   b.get("roof_type"), b.get("wing", 0), b.get("fl", 0),
                   b.get("mir", 0))] += 1
            p = road_probe(b["x"], b["z"], 60)
            if p is None:
                continue
            d, seg = p
            w = seg.get("width", 12) * 0.5
            if seg.get("class") in ("EXPRESSWAY", "TUNNEL"):
                if d < w + 8:
                    on_road.append((b, seg.get("class"), d))
            elif d < w * 0.75:
                on_road.append((b, seg.get("class"), d))
print("  tong nha: %d | loai: %d | HINH HOC KHAC NHAU: %d"
      % (total_b, len(btypes), len(bsigs)))
print("  top 8 loai: %s" % dict(btypes.most_common(8)))
_top = btypes.most_common(1)
if _top and total_b:
    share = _top[0][1] * 100.0 / total_b
    print("  loai chiem %d%%: %s (%d)" % (round(share), _top[0][0], _top[0][1]))
    if share > 55.0:
        bad("12/70", "1 kieu nha chiem %.1f%% tong so nha -> la 'recolor', "
                     "khong phai nhieu kieu nha" % share)
if total_b and len(bsigs) < 50:
    bad("12/71", "chi %d hinh hoc khac nhau cho %d nha -> nhiet the khong du"
        % (len(bsigs), total_b))
if on_road:
    bad("15/22", "%d nha nam TREN mat duong/cao toc (vi du: %s)"
        % (len(on_road), "; ".join("%s@%s d=%.1fm" % (b.get("type"), c, d)
                                   for b, c, d in on_road[:6])))

# ---------------------------------------------------------------- rule 16
print("=== 5. BEN XE ===")
for s in stations:
    if s.get("type") not in ("BUS_STATION", "MAJOR_BUS_TERMINAL"):
        continue
    acc = [x for x in stations if x.get("type") == "STATION_ACCESS"
           and math.hypot(x["x"] - s["x"], x["z"] - s["z"]) < 500]
    internal = [g for g in segs if g.get("class") in ("INTERNAL", "STATION_ACCESS")
                and seg_dist(s["x"], s["z"], nodes[g["from"]], nodes[g["to"]]) <
                max(s.get("w", 180), s.get("d", 130)) * 0.75]
    print("  %-28s bay=%d internal_seg=%d w=%s d=%s"
          % (s.get("name"), len(s.get("baySlots", []) or []), len(internal),
             s.get("w"), s.get("d")))
    if not internal:
        bad("16/63", "ben %s khong co duong noi bo trong san" % s.get("name"))
    # rule 11/14: ben xe KHONG duoc nam tren cao toc / trong long duong
    # tinh theo diem xa nhat cua san (khong phai tam san) -> dung hinh hoc that
    #
    # P70 (2026-09-30) — SAI SO DUOC DO: ban nay BO QUA `rot` cua san, lay
    # 4 goc truc tiep theo truc X/Z. Do goc san xoay ~90-180 do (generator
    # xoay san theo huong duong), rect do sai HOAN TOAN — do lai dai sang
    # truc khong, dung vao duong khac. Do duoc tren data THAT:
    #     Bến xe Miền Đông Mới  rot=3.1416  w=200 d=340
    #     goc TINH SAI (bo rot)  -> 11.1 m tu Vanh_dai_3 (EXPRESSWAY)  => LOI
    #     goc DUNG  (co rot)    -> het          (clearance thuc 33 m)   => SACH
    # => goc phai XOAY theo `rot`, dung cung quy tac nhu generator:
    #    X = ox*sin(rot) + oz*cos(rot) ; Z = ox*cos(rot) - oz*sin(rot)
    hw = (s.get("w", 180) or 180) * 0.5
    hd = (s.get("d", 130) or 130) * 0.5
    rot = s.get("rot", 0.0) or 0.0
    cr, sr = math.cos(rot), math.sin(rot)
    corners = []
    for (ox, oz) in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)):
        corners.append((s["x"] + ox * sr + oz * cr, s["z"] + ox * cr - oz * sr))
    hit = []
    for g in segs:
        if g.get("class") not in ("EXPRESSWAY", "NATIONAL", "ARTERIAL", "TUNNEL"):
            continue
        a, b = nodes[g["from"]], nodes[g["to"]]
        gw = (g.get("width", 12) or 12) * 0.5
        for cx, cz in corners:
            if seg_dist(cx, cz, a, b) < gw:
                hit.append((g.get("name") or g.get("class"), g.get("class")))
                break
    if hit:
        bad("11/14", "ben %s bi dat TREN duong lon: %s"
            % (s.get("name"), ", ".join("%s(%s)" % h for h in hit[:3])))
    else:
        # phai co duong ra duong chinh (khong phai be cong dat giua dong)
        maj = min((seg_dist(s["x"], s["z"], nodes[g["from"]], nodes[g["to"]])
                   for g in segs
                   if g.get("class") in ("NATIONAL", "EXPRESSWAY", "ARTERIAL", "COLLECTOR")),
                  default=1e9)
        if maj > 320:
            bad("63", "ben %s cach duong chinh %.0fm — khong co duong vao ben"
                % (s.get("name"), maj))
        else:
            print("       duong chinh gan nhat: %.0fm" % maj)

# ---------------------------------------------------------------- rule 43
print("=== 6. ANCHOR POINTS ===")
required = ["Cầu Đà Rằng", "Đèo Cả", "Vũng Rô", "Đại Lãnh", "Nha Trang",
            "Cam Lâm", "Phan Rang", "Vĩnh Hảo", "Phan Thiết", "Dầu Giây",
            "Tân Vạn", "Hoàng Hữu Nam", "Suối Tiên"]
names = " ".join(str(s.get("name", "")) for s in stations).lower()
missing = [r for r in required if r.lower() not in names]
if missing:
    print("  thieu ten POI (co the la settlement, khong nhat thieu station): %s" % missing)

# ---------------------------------------------------------------- rule 58
print("=== 7. WORLD BOUND / SPAWN-ONLY ===")
xs = [n["x"] for n in roads["nodes"]]
zs = [n["z"] for n in roads["nodes"]]
print("  bbox x [%.0f, %.0f] z [%.0f, %.0f]  (w=%.0fkm h=%.0fm)"
      % (min(xs), max(xs), min(zs), max(zs), (max(xs) - min(xs)) / 1000, max(zs) - min(zs)))
if world.get("size"):
    print("  world.size =", world["size"])

# ---------------------------------------------------------------- rule 34
print("=== 8. DATA CONTRACT ===")
for k in ("sectorSize", "sectorIndex", "spawn", "water", "corridorLength"):
    v = world.get(k)
    print("  world.%s: %s" % (k, ("OK (%s)" % (len(v) if isinstance(v, (list, dict, str)) else v))
                              if v is not None else "THIEU"))
sec_files = set(f[:-5] for f in files)
idx = set(world.get("sectorIndex") or [])
if idx and idx != sec_files:
    bad("31/34", "sectorIndex khop file thuc: thieu=%d thua=%d"
        % (len(sec_files - idx), len(idx - sec_files)))

# ---------------------------------------------------------------- Phase 7: Validation mới
print("=== 9. PHASE 7: ROAD TYPES MOI ===")
new_road_types = ("INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL", "COMMERCIAL", "AGRICULTURAL")
for rt in new_road_types:
    count = sum(1 for s in segs if s.get("class") == rt)
    print("  %s: %d segments" % (rt, count))

# ---- 9a. ROAD TYPE MỚI PHẢI HỢP LỆ VỀ HÌNH HỌC --------------------------
# Nếu chỉ đếm số segment thì 5 loại mới có thể tồn tại trên giấy nhưng sai
# hình học: bề rộng 0.2m, 8 làn trên đường làng, dốc 40%. Mỗi loại được đo
# bằng bảng kỳ vọng đọc thẳng từ generator (SOURCE OF TRUTH), không gõ lại.
ROAD_GEO_SPEC = {
    #           bề rộng tối thiểu / số làn 2 chiều / tốc độ thiết kế
    # SỐ LÀN Ở ĐÂY LÀ KỲ VỌNG ĐỘC LẬP, không đọc từ `ROAD_CLASS` của
    # generator — nếu đọc thì generator hạ làn xuống 1 là cũng "đạt". Số 1 là
    # số ĐÚNG cho đường 1 làm ở Việt Nam (xe máy + ô tô con tranh nhau,
    # bề rộng 4.5-6.5m): hẻm 4.5m, đường làng 6m, đường vào cơ sở 6.5m,
    # đường ruộng 5m, ramp 9m, đường trong sân bến 9m. Bản cũ đòi 2 làn cho
    # cả 6 class đó => SAI LỆCH 100% số đoạn của chúng, tức audit báo động
    # giả rồi mọi người quen mặt bỏ qua, đúng thứ audit sinh ra để tránh.
    "EXPRESSWAY":        (14.0, 4, 80),
    "NATIONAL":          (10.0, 4, 60),
    "TUNNEL":            (10.0, 2, 60),
    "RAMP":              (6.0, 1, 30),
    "ARTERIAL":          (9.0, 4, 50),
    "COLLECTOR":         (7.0, 2, 40),
    "PROVINCIAL_ROAD":   (7.0, 2, 45),
    "INTER_VILLAGE":     (5.5, 2, 35),
    "INDUSTRIAL_ACCESS": (6.5, 2, 45),
    "RESIDENTIAL":       (5.5, 2, 25),
    "COMMERCIAL":        (7.5, 2, 35),
    "AGRICULTURAL":      (4.5, 1, 25),
    "LOCAL":             (5.0, 2, 30),
    "RURAL_LOCAL":       (5.0, 1, 30),
    "SERVICE":           (4.5, 1, 25),
    "ALLEY":             (3.0, 1, 20),
    "STATION_ACCESS":    (5.0, 2, 25),
    "INTERNAL":          (5.0, 1, 15),
}
MAX_SLOPE_PCT = 16.0      # giống hằng validate của generator (xe khách rung)
_geo_bad = defaultdict(list)
for sg in segs:
    spec = ROAD_GEO_SPEC.get(sg.get("class"))
    if not spec:
        continue
    min_w, min_lanes, des_kmh = spec
    w = sg.get("width") or 0.0
    lanes = sg.get("lanes") or 0
    if w and w < min_w:
        _geo_bad["nhe hon %s (%.1f < %.1f)" % (sg["class"], w, min_w)].append(sg["id"])
    if lanes and lanes < min_lanes:
        _geo_bad["it hon %s (%d < %d)" % (sg["class"], lanes, min_lanes)].append(sg["id"])
    sp = sg.get("speed")
    if sp is not None and sp and sp > des_kmh + 5:
        _geo_bad["toc do %s (%s > %d)" % (sg["class"], sp, des_kmh)].append(sg["id"])
for reason, ids in sorted(_geo_bad.items(), key=lambda kv: -len(kv[1])):
    print("  [SAI HINH HOC] %-46s %d (vd %s)" % (reason, len(ids), ids[:3]))
    bad("P7-geo", "%d segment %s" % (len(ids), reason))

# ---------------------------------------------------------------- rule 9a-mat
# MỖI ROAD TYPE TRONG BẢNG PHẢI CÓ ĐOẠN THẬT.
#
# Luật này viết ra sau khi đo được: 5 road type ("INTER_VILLAGE",
# "INDUSTRIAL_ACCESS", "RESIDENTIAL", "COMMERCIAL", "AGRICULTURAL") có ĐỦ bảng
# số liệu ở cả Python lẫn JS — ROAD_CLASS, TOPO_LEGAL, TOPO_RANK, MAT_BY_CLASS,
# MAX_SEG_LEN, DEFAULT_SPEED_KMH, DENSITY_BY_CLASS, audit parity — nhưng KHÔNG
# chỗ nào trong generator phát ra class đó. Đo được 0 segment cho cả 5.
# Nghĩa là chúng không có mặt đường, không có làn, không có tốc độ, không có
# vật liệu: mọi thứ đã làm cho chúng bằng 0. Bảng khớp nhau hoàn toàn — audit
# parity xanh — trong khi sản phẩm là 0.
#
# Số "class trong bảng mà 0 đoạn" là thứ DUY NHẤT bắt được loại lỗi đó, vì mọi
# kiểm tra khác đều hỏi "đoạn này có đúng không", không hỏi "class này có tồn
# tại không".
_cls_count = Counter(sg.get("class") for sg in segs)
_declared = sorted(_mg.ROAD_CLASS.keys())
print("\n  [ROAD TYPE] doan theo class (khai bao %d, co mat %d):"
      % (len(_declared), len([c for c in _declared if _cls_count.get(c)])))
for c in _declared:
    print("    %-20s %6d" % (c, _cls_count.get(c, 0)))
_empty_cls = [c for c in _declared if not _cls_count.get(c)]
if _empty_cls:
    bad("9a-mat", "%d road type co bang so lieu nhung 0 doan: %s"
        % (len(_empty_cls), ", ".join(_empty_cls)))
# ngược lại: đoạn có class KHÔNG khai báo trong ROAD_CLASS -> sẽ rơi về
# `ROAD_CLASS["LOCAL"]` trong add_segment và về `roadMinor` ở js/map.js
_unknown_cls = sorted({c for c in _cls_count if c and c not in _mg.ROAD_CLASS})
if _unknown_cls:
    bad("9a-la", "segment mang class nam ngoai ROAD_CLASS: %s"
        % ", ".join(_unknown_cls))
# mỗi class mới phải đủ số đoạn để thấy trong minimap/traffic, không phải 1-2
# đoạn rác rồi kết luận "đã làm"
for c in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL",
          "COMMERCIAL", "AGRICULTURAL"):
    n = _cls_count.get(c, 0)
    if 0 < n < 20:
        bad("9a-it", "%s chi %d doan — duoi nguoi co y nghia" % (c, n))

# dốc: dùng Y CUỐI trong export (node.y), không dùng terrain
_slope_over = []
for sg in segs:
    p, q = nodes.get(sg["from"]), nodes.get(sg["to"])
    if not p or not q:
        continue
    run = math.hypot(q["x"] - p["x"], q["z"] - p["z"])
    if run < 1.0:
        continue
    if sg.get("bridge") or sg.get("class") == "TUNNEL":
        continue          # cầu/hầm được miễn: cầu vượt dốc cũng hợp lý
    sl = abs(q["y"] - p["y"]) / run * 100.0
    if sl > MAX_SLOPE_PCT:
        _slope_over.append((sg["id"], sl))
print("  doan ngoai cau/ham ma doc > %.0f%%: %d" % (MAX_SLOPE_PCT, len(_slope_over)))
for sid, sl in sorted(_slope_over, key=lambda t: -t[1])[:5]:
    print("    %s: %.1f%%" % (sid, sl))
if _slope_over:
    bad("P7-slope", "%d doan duong doc > %.0f%% (khong phai cau/ham)"
        % (len(_slope_over), MAX_SLOPE_PCT))

print("=== 10. PHASE 5: BEN XE MOI ===")
new_stations = [s for s in stations if s.get("id") in ("dong_hoa", "song_cau", "cam_ranh", "vinh_hao", "bau_cau", "dau_giay", "long_thanh", "bien_hoa")]
for s in new_stations:
    print("  %s: %s, %d bays" % (s.get("name"), s.get("type"), len(s.get("baySlots", []) or [])))

# ---- 10a. BẾN PHẢI ĐỦ ĐIỆN, KHÔNG ĐỨT MẠNG, KHÔNG ĐÈ NHAU -----------
# "Bến xe thật" không phải là 1 hình chữ nhật đặt xuống ruộng. Mỗi bến phải:
#   - có bến đỗ (baySlots) — bến không có chỗ đỗ là sân trống
#   - có access_node thuộc THÀNH PHẦN LỚN NHẤT — bến tách mạng = xe vào
#     bến bằng cách bay, và tuyến xe qua bến đó gãy
#   - có nhà bến (bán kính quanh tâm) — bến trống trơn là sân bãi
_st_types = ("BUS_STATION", "MAJOR_BUS_TERMINAL")
_bus_st = [s for s in stations if s.get("type") in _st_types]
print("  tong so ben xe: %d" % len(_bus_st))
_no_bay = _no_access = _no_house = _off_grid = 0
for s in _bus_st:
    bays = s.get("baySlots") or []
    if len(bays) < 5:
        _no_bay += 1
        bad("P7-st", "ben '%s' chi co %d bay do xe" % (s.get("name"), len(bays)))
    an = s.get("access_node")
    if not an or an not in nodes:
        _no_access += 1
        bad("P7-st", "ben '%s' access_node=%r khong ton tai" % (s.get("name"), an))
    elif an not in main_component:
        _off_grid += 1
        bad("P7-st", "ben '%s' access_node %s nam NGOAI thanh phan chinh"
            % (s.get("name"), an))
print("  ben thieu bay: %d | access_node hong/ngoai mang: %d/%d"
      % (_no_bay, _no_access, _off_grid))

# ---- 10b. POI KHÔNG ĐÈ NHAU / KHÔNG ĐỨNG GIỮA ĐƯỜNG --------------------
# 20 POI công cộng mới (trường / BVĐK / chợ / KCN) sinh từ cùng pipeline với
# bến nên chồng lấn là rủi ro thật. Đo bằng hộp xoay + SAT, không đoán.
_POI_SIZED = ("BUS_STATION", "MAJOR_BUS_TERMINAL", "SCHOOL", "HOSPITAL",
              "MARKET", "INDUSTRIAL", "REST_AREA", "FUEL_STATION", "TOLL")
_sized = [s for s in stations if s.get("type") in _POI_SIZED]
_sized.sort(key=lambda s: s["x"])
_overlap = []
for i in range(len(_sized)):
    s = _sized[i]
    hw = (s.get("w") or 40) * 0.5, (s.get("d") or 40) * 0.5
    box = (s["x"], s["z"], hw[0], hw[1], s.get("rot") or 0.0, s.get("id"))
    for j in range(i + 1, len(_sized)):
        t = _sized[j]
        if t["x"] - s["x"] > 400:
            break        # đã sort theo x
        thw = (t.get("w") or 40) * 0.5, (t.get("d") or 40) * 0.5
        tb = (t["x"], t["z"], thw[0], thw[1], t.get("rot") or 0.0, t.get("id"))
        if _obb_overlap(box, tb):
            _overlap.append((s["id"], t["id"]))
print("  POI co kich thuoc: %d | cap doi chong lan: %d" % (len(_sized), len(_overlap)))
for a, b in _overlap[:8]:
    print("    %s <-> %s" % (a, b))
if _overlap:
    bad("P7-poi", "%d cap POI chong lan nhau (vd %s)"
        % (len(_overlap), _overlap[:6]))

# POI đứng giữa mặt đường = cái biển bị xe đâm
_on_road_poi = []
for s in _sized:
    p = road_probe(s["x"], s["z"], 80)
    if p is None:
        continue
    d, seg = p
    w = (seg.get("width", 12) or 12) * 0.5
    if d < w + (s.get("w") or 40) * 0.25:
        _on_road_poi.append((s.get("id"), s.get("type"), seg.get("class"), d))
print("  POI lech < nua be rong duong: %d" % len(_on_road_poi))
for pid, ty, cl, d in _on_road_poi[:8]:
    print("    %s (%s) dat gan %s %.1fm" % (pid, ty, cl, d))
if _on_road_poi:
    bad("P7-poi", "%d POI lech vao mat duong (%s)"
        % (len(_on_road_poi), ", ".join("%s@%s" % (p[0], p[2]) for p in _on_road_poi[:6])))

# ---- 10c. TUYẾN PHẢI BÁM ROAD GRAPH ------------------------------------
# Route là thứ NPC + HUD dùng. Route đứt gãy = người chơi thấy đường mà
# xe không đi được. Đo bằng chính adjacency của roads.json, không tin tên.
print("=== 10c. TUYEN BAM ROAD GRAPH ===")
_routes = routes if isinstance(routes, list) else routes.get("routes", [])
print("  so tuyen: %d" % len(_routes))
for rt in _routes:
    rn = rt.get("nodes") or []
    _rt_name = rt.get("name") or rt.get("id") or "?"
    if not rn:
        bad("P7-route", "tuyen '%s' khong co node nao" % _rt_name)
        continue
    miss = [n for n in rn if n not in nodes]
    off = [n for n in rn if n in nodes and n not in main_component]
    breaks = 0
    run_len = 0
    for a, b in zip(rn, rn[1:]):
        if a in adj and b in adj[a]:
            run_len += 1
        else:
            breaks += 1
    # chuỗi liên tiếp dài nhất = đoạn đường thực sự liên tục
    best_run = cur = 0
    for a, b in zip(rn, rn[1:]):
        cur = cur + 1 if (a in adj and b in adj[a]) else 0
        best_run = max(best_run, cur)
    total_m = 0.0
    for a, b in zip(rn, rn[1:]):
        p, q = nodes.get(a), nodes.get(b)
        if p and q:
            total_m += math.hypot(q["x"] - p["x"], q["z"] - p["z"])
    print("  %-22s node=%4d lienKe=%4d doanDut=%3d daiNhat=%4d/%4d "
          "(%.1f km theo toa do) %s -> %s"
          % (str(_rt_name)[:22], len(rn), run_len,
             breaks, best_run, max(0, len(rn) - 1), total_m / 1000.0,
             rn[0], rn[-1]))
    if miss:
        bad("P7-route", "tuyen '%s' co %d node khong ton tai" % (_rt_name, len(miss)))
    if off:
        bad("P7-route", "tuyen '%s' co %d node NGOAI thanh phan chinh"
            % (_rt_name, len(off)))
    if breaks:
        bad("P7-route", "tuyen '%s' DUT %d doan (khong lien thong theo roads.json)"
            % (_rt_name, breaks))
    if rn[0] == rn[-1] and len(rn) > 2:
        bad("P7-route", "tuyen '%s' co node dau == node cuoi (%s): duong hinh long"
            % (_rt_name, rn[0]))

print("=== 11. HE THONG NHA: KIỂU / TEMPLATE / HÌNH HỌC ===")
_hs = getattr(_mg, "house_template_stats", None)
if _hs:
    st = _hs()
    print("  kieu nha that: %d | template phang: %d | chu ky hinh hoc: %d"
          % (st["archetypes"], st["templates"], st["distinct_signatures"]))
    print("  theo zone: %s" % st["by_zone"])
    if st["templates"] != st["distinct_signatures"]:
        bad("12/72", "bang template co trung hinh hoc (%d != %d)"
            % (st["templates"], st["distinct_signatures"]))
else:
    print("  (khong tim thay house_template_stats trong map_generator)")
print("  so kieu xuat hien thuc te: %d" % len(btypes))
for ht, cnt in btypes.most_common(12):
    print("  %-22s %d" % (ht, cnt))

print()
print("=" * 66)
if not issues:
    print("AUDIT: KHONG PHAT HIEN LOI")
else:
    print("AUDIT: %d VAN DE" % len(issues))
    for r, m in issues:
        print("  [rule %s] %s" % (r, m))
sys.exit(1 if issues else 0)
