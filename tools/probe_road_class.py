# tools/probe_road_class.py
# =====================================================================
# DỰ ĐOÁN SỐ ĐOẢN của 5 road type mới TRƯỚC khi chạy generator 30 phút.
#
# Quét lưới điểm dọc hành lang, gọi đúng `_context_road_class` (không viết
# lại logic), in ra phân bố + tọa độ mẫu. Nếu class nào = 0 thì biết ngay
# điều kiện của nó không bao giờ chạm, thay vì chạy xong mới thấy.
#
# Chạy: python tools/probe_road_class.py
# =====================================================================
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import map_generator as m                      # noqa: E402

gen = m.MapGenerator()
print("=== PROBE ROAD CLASS (dung ham that cua generator) ===")
print("  KCN: %s" % [(t, round(x), round(z)) for t, x, z in gen._kcn_points()])
print("  rural anchors: %d" % len(gen._rural_anchor_points()))

STEP = 300.0
s0, s1 = 0.0, gen.corridor_len
cnt = Counter()
samples = {}
s = s0
while s < s1:
    path = gen._corridor_subpath(s, s + 40.0)
    if len(path) >= 2:
        # _corridor_subpath trả (x, z, u, ...) — chỉ lấy 2 toạ độ đầu
        px, pz = path[0][0], path[0][1]
        qx, qz = path[1][0], path[1][1]
        ux, uz = qx - px, qz - pz
        L = (ux * ux + uz * uz) ** 0.5 or 1.0
        ux, uz = ux / L, uz / L
        nx, nz = -uz, ux
        for off in range(-2000, 2001, 500):
            bx, bz = px + nx * off, pz + nz * off
            if gen.water_factor(bx, bz) > 0.2:
                continue
            for lv in (0, 1, 2):
                cls, note = gen._context_road_class(bx, bz, lv)
                cnt[(lv, cls)] += 1
                samples.setdefault((lv, cls), (round(bx), round(bz), note))
    s += STEP

print("\n  level | class                 | so diem | vi du (x, z) / ly do")
print("  ------+------------------------+---------+------------------------------")
for (lv, cls), n in sorted(cnt.items()):
    if n == 0:
        continue
    x, z, note = samples[(lv, cls)]
    mark = "  <== CLASS MOI" if cls in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS",
                                       "RESIDENTIAL", "COMMERCIAL",
                                       "AGRICULTURAL") else ""
    print("  %-5d| %-22s | %7d | (%d, %d) %s%s"
          % (lv, cls, n, x, z, note or "-", mark))

# ---------------------------------------------------------------------------
# MÔ PHỎNG LUẬT HẠ CẤP khi đi xa. Đây là chỗ class thật sự quyết định: đoạn đầu
# tính ở node QL1 (d_corridor ~= 0) nên luôn là đường xã/địa phương; muốn
# `AGRICULTURAL` (điều kiện cần cách trục > 650m) xuất hiện thì class PHẢI được
# cập nhật lại mỗi bước. Không mô phỏng bước này thì probe báo "đủ class" rồi
# generator ra 0 đoạn — đúng lỗi đã gặp 1 lần rồi.
# ---------------------------------------------------------------------------
print("\n  --- 2 TANG: thang (level 0) di 1400m, moi node moc nhanh phu (level 1) ---")
step_cls = Counter()
sub_cls = Counter()
raw_cls = Counter()       # context THUAN, khong qua luat ha cap
gate_blocked = Counter()  # context noi A nhung luat ha cap giu B
for start_s in range(2000, int(gen.corridor_len) - 2000, 4000):
    path = gen._corridor_subpath(start_s, start_s + 40.0)
    if len(path) < 2:
        continue
    px, pz = path[0][0], path[0][1]
    qx, qz = path[1][0], path[1][1]
    ux, uz = qx - px, qz - pz
    L = (ux * ux + uz * uz) ** 0.5 or 1.0
    ux, uz = ux / L, uz / L
    nx, nz = -uz, ux
    for side in (1.0, -1.0):
        cur_cls, _ = gen._context_road_class(px, pz, 0)
        rank_floor = m.TOPO_RANK.get(cur_cls, 3)
        for k in range(1, 21):
            d = k * 70.0
            bx, bz = px + nx * side * d, pz + nz * side * d
            nc, _nn = gen._context_road_class(bx, bz, 0)
            raw_cls[nc] += 1
            if m.TOPO_RANK.get(nc, 3) >= rank_floor:
                cur_cls = nc
            elif nc != cur_cls:
                gate_blocked["%s -> %s" % (cur_cls, nc)] += 1
            step_cls[cur_cls] += 1
            # nhanh phu moc tu node nay, dai 120-400m, buoc 45m (dung `_grow_road`)
            if k % 4:
                continue
            sub, _ = gen._context_road_class(bx, bz, 1)
            sub_floor = m.TOPO_RANK.get(cur_cls, 3)
            for j in range(1, 8):
                sx, sz = bx + ux * side * 45.0 * j, bz + uz * side * 45.0 * j
                sc, _sn = gen._context_road_class(sx, sz, 1)
                raw_cls[sc] += 1
                if m.TOPO_RANK.get(sc, 3) >= sub_floor:
                    sub = sc
                elif sc != sub:
                    gate_blocked["(nhanh phu) %s -> %s" % (sub, sc)] += 1
                sub_cls[sub] += 1
print("  context THUAN (khong qua luat ha cap):")
for c, n in raw_cls.most_common():
    print("    %-22s %6d" % (c, n))
print("  context BI LUAT HA CAP CHAN doi:")
for c, n in gate_blocked.most_common(8):
    print("    %-22s %6d" % (c, n))
if not gate_blocked:
    print("    (khong co) -> luat ha cap KHONG phai nguyen nhan")
print("  class cuoi THANG (level 0):")
for c, n in step_cls.most_common():
    print("    %-22s %6d bo doan" % (c, n))
print("  class cuoi NHANH PHU (level 1):")
for c, n in sub_cls.most_common():
    mark = "  <== CLASS MOI" if c in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS",
                                     "AGRICULTURAL") else ""
    print("    %-22s %6d bo doan%s" % (c, n, mark))
dead2 = [c for c in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS", "AGRICULTURAL")
         if not (step_cls.get(c) or sub_cls.get(c))]
if dead2:
    print("\n  !! MO PHONG 2 TANG VAN KHONG CO DOAN: %s" % ", ".join(dead2))
    sys.exit(1)

# ---------------------------------------------------------------------------
# CHỨNG MINH LUẬT HẠ CẤP CÓ TÁC DỤNG. Trên 2 tầng ở trên nó chưa chặn gì
# (`gate_blocked` rỗng) — tức là có thể là code chết. Dẫn chứng cụ thể: nhánh
# `level 2` bắt đầu là `ALLEY` (rank 5) đi ngang KCN thì context bảo
# `INDUSTRIAL_ACCESS` (rank 3, ĐÀO HẠNG) — luật phải giữ `ALLEY`, vì ngõ hẻm
# không tự mình thành đường công nghiệp 2 làn.
print("\n  --- chung minh luat ha cap (level 2 di ngan KCN) ---")
blocked_demo = 0
for nm, kx, kz in gen._kcn_points():
    cur, _ = gen._context_road_class(kx, kz, 2)      # level 2 -> ALLEY
    floor = m.TOPO_RANK.get(cur, 3)
    for d in (0, 40, 80, 120):
        want, _w = gen._context_road_class(kx + d, kz, 2)
        got = want if m.TOPO_RANK.get(want, 3) >= floor else cur
        if want != got:
            blocked_demo += 1
            if blocked_demo <= 3:
                print("    %s tai %d m: context='%s' -> giu '%s'"
                      % (nm, d, want, got))
if blocked_demo == 0:
    print("    (khong co) -> luat ha cap van chua duoc chung minh co tac dung")
else:
    print("    -> luat ha cap chan %d lan, dung nhu mong doi" % blocked_demo)

print("\n  --- class moi, tong theo level ---")
tally = Counter()
for (lv, cls), n in cnt.items():
    if cls in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL",
               "COMMERCIAL", "AGRICULTURAL"):
        tally[cls] += n
for cls in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS", "RESIDENTIAL",
            "COMMERCIAL", "AGRICULTURAL"):
    print("  %-20s %7d" % (cls, tally[cls]))
dead = [c for c in ("INTER_VILLAGE", "INDUSTRIAL_ACCESS", "AGRICULTURAL")
        if tally[c] == 0]
if dead:
    print("\n  !! CLASS MOI KHONG BAO GIO CHAY: %s" % ", ".join(dead))
    sys.exit(1)
print("\n  (RESIDENTIAL/COMMERCIAL chi sinh trong LUOI PHO -> kiem o buoc 5)")
