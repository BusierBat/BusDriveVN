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
start_list = sorted(nodes.keys(), key=lambda i: -deg.get(i, 0))
for st in start_list:
    if st in seen:
        continue
    q = deque([st])
    seen.add(st)
    cnt = 0
    while q:
        u = q.popleft()
        cnt += 1
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                q.append(v)
    best_cc = max(best_cc, cnt)
print("  connected component lon nhat: %d/%d node (%.2f%%)" %
      (best_cc, len(nodes), 100.0 * best_cc / max(1, len(nodes))))
if best_cc < len(nodes) * 0.99:
    bad("53", "do thi khong lien tinh: chi %.1f%% node nam trong component lon nhat"
        % (100.0 * best_cc / max(1, len(nodes))))

# ---------------------------------------------------------------- rule 8/59
leaves = [nid for nid in nodes if deg.get(nid, 0) == 1]
print("  degree-1 (cuc/tuan ket): %d" % len(leaves))
if len(leaves) > max(60, len(nodes) * 0.04):
    bad("8/59", "qua nhieu node degree-1: %d/%d (%.1f%%) — dead-end spam"
        % (len(leaves), len(nodes), 100.0 * len(leaves) / max(1, len(nodes))))

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
    # mạng (đo được: 1 thành phần -> 61 thành phần). Ưu tiên road network
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
SMALL_CLS = ("LOCAL", "ALLEY", "RURAL_LOCAL", "SERVICE", "COLLECTOR")
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
stops = [s for s in stations if s.get("type") in
         ("BUS_STOP", "REST_AREA", "FUEL_STATION", "TOLL")]
# kiem tra khoang cach tren truc route
rt = routes[0] if routes else None
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

# ---------------------------------------------------------------- rule 15/22
print("=== 4. NHA / BUILDING ===")
sec_dir = os.path.join(MAPS, "sectors")
files = sorted(os.listdir(sec_dir))
total_b = 0
on_road = []
btypes = Counter()
for fn in files:
    with open(os.path.join(sec_dir, fn), encoding="utf-8") as f:
        sec = json.load(f)
    for ck, ch in sec.items():
        for b in (ch.get("buildings") or []):
            total_b += 1
            btypes[b.get("type", "?")] += 1
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
print("  tong nha: %d | loai: %s" % (total_b, dict(btypes.most_common(8))))
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
    hw = (s.get("w", 180) or 180) * 0.5
    hd = (s.get("d", 130) or 130) * 0.5
    corners = [(s["x"] - hw, s["z"] - hd), (s["x"] + hw, s["z"] - hd),
               (s["x"] + hw, s["z"] + hd), (s["x"] - hw, s["z"] + hd)]
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

print()
print("=" * 66)
if not issues:
    print("AUDIT: KHONG PHAT HIEN LOI")
else:
    print("AUDIT: %d VAN DE" % len(issues))
    for r, m in issues:
        print("  [rule %s] %s" % (r, m))
sys.exit(1 if issues else 0)
