#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools/traffic_audit.py — kiểm tra offline hệ thống lane/giao thông.

QUY PHẠM (rule: Python = offline, JS = runtime):
  * Đọc generated/maps/roads.json (SOURCE OF TRUTH của đường).
  * Tính lại lane metadata theo ĐÚNG CÔNG THỨC của
    js/RuntimeRoadGraph.js#deriveLaneMeta (validate parity, không có
    nguồn dữ liệu thứ 2).
  * Đối chiếu ĐOẠN MÃ trong JS: nếu ai đổi công thức bên JS mà không
    cập nhật Python (hoặc đảo dấu vector phải -> bug lái tay trái),
    audit FAIL ngay lập tức.
  * Báo cáo topology (dead-end / junction / thành phần liên thông) và
    mật độ giao thông theo loại đường.

Chạy:
    python tools/traffic_audit.py
    python tools/traffic_audit.py --roads generated/maps/roads.json
    python tools/traffic_audit.py --json

Exit code: 0 = PASS, 1 = FAIL (dùng được trong CI/test).
"""
import argparse
import json
import math
import os
import sys
import re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ROADS = os.path.join(ROOT, "generated", "maps", "roads.json")
GRAPH_JS = os.path.join(ROOT, "js", "RuntimeRoadGraph.js")
AI_JS = os.path.join(ROOT, "js", "traffic", "TrafficAI.js")

# --- phải TRÙNG KHỚP với RuntimeRoadGraph.js ---------------------------
DEFAULT_SPEED_KMH = {
    "EXPRESSWAY": 90, "NATIONAL": 70, "TUNNEL": 60, "ARTERIAL": 50,
    "RAMP": 40, "COLLECTOR": 40, "PROVINCIAL_ROAD": 45, "LOCAL": 30,
    "RURAL_LOCAL": 30,
    "ALLEY": 20, "SERVICE": 25, "STATION_ACCESS": 25, "INTERNAL": 15,
    # --- Phase 3: phải khớp DEFAULT_SPEED_KMH trong RuntimeRoadGraph.js ---
    "INTER_VILLAGE": 35, "INDUSTRIAL_ACCESS": 45, "RESIDENTIAL": 25,
    "COMMERCIAL": 35, "AGRICULTURAL": 25,
}
NO_LANE_CHANGE = {"TUNNEL", "INTERNAL", "ALLEY", "SERVICE", "STATION_ACCESS",
                  "AGRICULTURAL"}
NO_SHOULDER = {"ALLEY", "INTERNAL", "STATION_ACCESS", "AGRICULTURAL"}
DENSITY_BY_CLASS = {
    "EXPRESSWAY": 1.0, "NATIONAL": 1.0, "ARTERIAL": 0.9, "COLLECTOR": 0.75,
    "PROVINCIAL_ROAD": 0.7,
    "LOCAL": 0.6, "RURAL_LOCAL": 0.5, "TUNNEL": 0.5, "RAMP": 0.3,
    "SERVICE": 0.15, "ALLEY": 0.1, "STATION_ACCESS": 0.1, "INTERNAL": 0.1,
    # --- Phase 3: phải khớp DENSITY_BY_CLASS trong RuntimeRoadGraph.js ---
    "INTER_VILLAGE": 0.55, "INDUSTRIAL_ACCESS": 0.65, "RESIDENTIAL": 0.45,
    "COMMERCIAL": 0.7, "AGRICULTURAL": 0.2,
}

# Những đoạn CON MÃ JS phải còn giữ (chống hồi quy/lỗi lái tay trái).
JS_FORMULA_MARKERS = [
    ("deriveLaneMeta", "hàm deriveLaneMeta bị xóa"),
    ("half - (i + 0.5) * this.laneW", "công thức tâm làn laneCenter() đổi"),
    ("Math.min(4.5, Math.max(2.6, width / effTotal))", "công thức bề rộng làn đổi"),
    ("const lane0Center = half - laneW * 0.5", "lane0Center đổi"),
    ("shoulderLateral >= lane0Center + 0.5", "điều kiện tấp lề đổi"),
    ("getLaneMeta", "TrafficAI/Manager mất nguồn metadata (getLaneMeta)"),
]
# TrafficAI: vector PHẢI = (-uz, ux) và offset áp theo vector đó.
AI_DIRECTION_MARKERS = [
    ("rx: -uz, rz: ux", "vector PHẢI của đoạn đường không còn (-uz, ux)"),
    ("f.rx * this.laneOffset", "offset làn không còn áp theo vector PHẢI"),
]


def derive_lane_meta(seg):
    """Bản sao 1-1 của deriveLaneMeta() — nếu khác bên JS thì audit FAIL."""
    cls = seg.get("class") or ""
    two_way = seg.get("twoWay", True) is not False
    lanes_total = max(1, int(seg.get("lanes") or 1))
    lanes_per_dir = max(1, lanes_total // 2) if two_way else lanes_total
    eff_total = lanes_per_dir * 2 if two_way else lanes_total
    width = max(4.0, float(seg.get("width") or 12))
    half = width * 0.5
    lane_w = min(4.5, max(2.6, width / eff_total))
    lane0_center = half - lane_w * 0.5
    shoulder_lateral = half - 1.0
    speed = float(seg.get("speed") or DEFAULT_SPEED_KMH.get(cls, 30))
    is_station = seg.get("type") == "bus_station_road"
    lane_change_allowed = lanes_per_dir >= 2 and cls not in NO_LANE_CHANGE and not is_station
    shoulder_allowed = (cls not in NO_SHOULDER and not is_station
                        and shoulder_lateral >= lane0_center + 0.5)
    return {
        "cls": cls,
        "twoWay": two_way,
        "lanesTotal": lanes_total,
        "lanesPerDir": lanes_per_dir,
        "effTotal": eff_total,
        "width": width,
        "half": half,
        "laneW": lane_w,
        "lane0Center": lane0_center,
        "shoulderLateral": shoulder_lateral,
        "speedKmh": speed,
        "speedMs": speed / 3.6,
        "laneChangeAllowed": lane_change_allowed,
        "shoulderAllowed": shoulder_allowed,
        "density": DENSITY_BY_CLASS.get(cls, 0.4),
    }


def lane_center(meta, lane_index):
    i = min(max(int(lane_index), 0), meta["lanesPerDir"] - 1)
    return meta["half"] - (i + 0.5) * meta["laneW"]


def check_parity(errors):
    """Đối chiếu công thức trong file JS — JS đổi mà Python không đổi => FAIL."""
    if not os.path.exists(GRAPH_JS):
        errors.append("thiếu %s" % GRAPH_JS)
        return
    with open(GRAPH_JS, encoding="utf-8") as f:
        src = f.read()
    for marker, why in JS_FORMULA_MARKERS:
        if marker not in src:
            errors.append("PARITY/JS: %s (không thấy \"%s\" trong RuntimeRoadGraph.js)" % (why, marker))

    # Bảng class phải khớp TỪNG KHÓA, không chỉ "có vẻ giống". Phase 3 thêm 5
    # road type mới: nếu thêm bên JS mà quên bên Python (hoặc ngược lại) thì
    # TrafficAI và audit tính tốc độ/mật độ khác nhau → xe chạy lệch làn mà
    # audit vẫn xanh. Đo được lỗi này khi thêm INTER_VILLAGE mà bỏ AGRICULTURAL.
    def _js_set(name):
        m = re.search(re.escape(name) + r"\s*=\s*(?:new Set\()?\{(.*?)\}\)?\s*;",
                      src, re.S)
        if not m:
            return None
        return set(re.findall(r'"([A-Z_]+)"', m.group(1)))

    for name, py_tbl, js_name in (
            ("DEFAULT_SPEED_KMH", DEFAULT_SPEED_KMH, "DEFAULT_SPEED_KMH"),
            ("NO_LANE_CHANGE", NO_LANE_CHANGE, "NO_LANE_CHANGE"),
            ("NO_SHOULDER", NO_SHOULDER, "NO_SHOULDER"),
            ("DENSITY_BY_CLASS", DENSITY_BY_CLASS, "DENSITY_BY_CLASS")):
        js_keys = _js_set(js_name)
        if js_keys is None:
            errors.append("PARITY/JS: không đọc được bảng %s trong RuntimeRoadGraph.js" % js_name)
            continue
        py_keys = set(py_tbl)
        only_js = js_keys - py_keys
        only_py = py_keys - js_keys
        if only_js:
            errors.append("PARITY/JS: %s có key chỉ có bên JS: %s"
                          % (js_name, sorted(only_js)))
        if only_py:
            errors.append("PARITY/PY: %s có key chỉ có bên Python: %s"
                          % (js_name, sorted(only_py)))
        # giá trị số phải bằng nhau cho các key chung
        if js_name in ("DEFAULT_SPEED_KMH", "DENSITY_BY_CLASS"):
            body = re.search(re.escape(js_name) + r"\s*=\s*\{(.*?)\n\};", src, re.S)
            if body:
                for k, v in re.findall(r"([A-Z_]+)\s*:\s*([0-9.]+)", body.group(1)):
                    if k not in py_tbl:
                        continue
                    if abs(float(v) - float(py_tbl[k])) > 1e-9:
                        errors.append("PARITY: %s[%s] JS=%s PY=%s"
                                      % (js_name, k, v, py_tbl[k]))

    if not os.path.exists(AI_JS):
        errors.append("thiếu %s" % AI_JS)
        return
    with open(AI_JS, encoding="utf-8") as f:
        ai_src = f.read()
    for marker, why in AI_DIRECTION_MARKERS:
        if marker not in ai_src:
            errors.append("PARITY/AI: %s (không thấy \"%s\" trong TrafficAI.js)" % (why, marker))


def audit(roads_path):
    errors, warnings, info = [], [], []

    with open(roads_path, encoding="utf-8") as f:
        data = json.load(f)
    nodes = data.get("nodes") or []
    segs = data.get("segments") or []
    if not nodes or not segs:
        return ["roads.json rỗng hoặc sai cấu trúc {nodes, segments}"], [], []

    node_map = {n["id"]: n for n in nodes if "id" in n}
    degree = Counter()
    seg_len = {}
    class_len = defaultdict(float)
    class_count = Counter()
    lane_hist = Counter()
    speed_by_class = defaultdict(list)

    for s in segs:
        sid = s.get("id")
        fid, tid = s.get("from"), s.get("to")
        if fid not in node_map or tid not in node_map:
            errors.append("segment %s trỏ tới node không tồn tại (%s -> %s)" % (sid, fid, tid))
            continue
        a, b = node_map[fid], node_map[tid]
        length = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
        seg_len[sid] = length
        if length <= 0.5:
            errors.append("segment %s có độ dài %.2fm (0)" % (sid, length))
        if length > 4000:
            warnings.append("segment %s dài bất thường: %.0fm" % (sid, length))
        degree[fid] += 1
        degree[tid] += 1

        cls = s.get("class") or "?"
        class_count[cls] += 1
        class_len[cls] += length
        lane_hist[int(s.get("lanes") or 0)] += 1
        if s.get("speed"):
            speed_by_class[cls].append(float(s["speed"]))

        m = derive_lane_meta(s)
        width = float(s.get("width") or 0)
        lanes = int(s.get("lanes") or 0)
        if width <= 0:
            errors.append("segment %s không có width" % sid)
        elif width < 4.0 or width > 40:
            warnings.append("segment %s width %.1f ngoài khoảng 4-40m (class %s)" % (sid, width, cls))
        if lanes < 1 or lanes > 8:
            warnings.append("segment %s lanes=%s ngoài khoảng 1-8" % (sid, lanes))
        if s.get("speed") is not None and not (5 <= float(s["speed"]) <= 130):
            warnings.append("segment %s speed=%s ngoài 5-130 km/h" % (sid, s.get("speed")))
        if s.get("twoWay", True) and lanes % 2 == 1 and lanes > 1:
            warnings.append("segment %s hai chiều nhưng lanes=%d lẻ -> mất 1 làn tính" % (sid, lanes))
        # làn có nằm trọn trong nửa đường không (xe không lòi ra mép/tim)
        if m["laneW"] * m["lanesPerDir"] > m["half"] + 0.01:
            warnings.append(
                "segment %s làn không vừa mặt đường (%.2fm x %d > half %.2fm)"
                % (sid, m["laneW"], m["lanesPerDir"], m["half"]))
        # làn 0 (bên phải) phải nằm trong khoảng (0, half)
        c0 = lane_center(m, 0)
        if not (0.0 < c0 < m["half"]):
            errors.append("segment %s tâm làn 0 = %.2f không trong (0, %.2f) -> sai làn" % (sid, c0, m["half"]))

    # ---------------- topology ----------------
    dead_ends = [nid for nid, d in degree.items() if d == 1]
    junctions = [nid for nid, d in degree.items() if d >= 3]
    info.append("node degree: dead-end=%d, junction(>=3)=%d, total=%d"
                % (len(dead_ends), len(junctions), len(degree)))

    # thành phần liên thông (A* phải đi được giữa các node trong cùng thành phần)
    adj = defaultdict(list)
    for s in segs:
        if s.get("id") in seg_len:
            adj[s.get("from")].append(s.get("to"))
            adj[s.get("to")].append(s.get("from"))
    seen = set()
    components = []
    for start in adj:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nxt in adj[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        components.append(comp)
    components.sort(key=len, reverse=True)
    if components:
        main_n = len(components[0])
        outside = sum(len(c) for c in components[1:])
        info.append("thành phần liên thông: %d (lớn nhất %d node, ngoài %d node)"
                    % (len(components), main_n, outside))
        if outside > 0:
            warnings.append("%d node nằm NGOÀI thành phần lớn nhất -> A* không tới được (NPC phải có fallback)" % outside)

    # ---------------- mật độ theo loại đường ----------------
    total_len = sum(class_len.values()) or 1.0
    lines = []
    for cls, ln in sorted(class_len.items(), key=lambda kv: -kv[1]):
        meta_d = DENSITY_BY_CLASS.get(cls, 0.4)
        lines.append("  %-14s %6.1f km (%4.1f%%)  n=%-5d density=%.2f  speed=%s"
                     % (cls, ln / 1000.0, 100.0 * ln / total_len, class_count[cls], meta_d,
                        _speed_range(speed_by_class.get(cls, []))))
    info.append("phân bố đường (tổng %.1f km):\n%s" % (total_len / 1000.0, "\n".join(lines)))
    info.append("phân bố lanes: %s" % dict(sorted(lane_hist.items())))

    # ---------------- metadata sanity ----------------
    shoulder_ok = sum(1 for s in segs if derive_lane_meta(s)["shoulderAllowed"])
    lanechange_ok = sum(1 for s in segs if derive_lane_meta(s)["laneChangeAllowed"])
    info.append("segment tấp lề được: %d/%d, đổi làn được: %d/%d"
                % (shoulder_ok, len(segs), lanechange_ok, len(segs)))

    return errors, warnings, info


def _speed_range(speeds):
    if not speeds:
        return "-"
    return "%.0f-%.0f km/h" % (min(speeds), max(speeds))


def main():
    ap = argparse.ArgumentParser(description="Audit lane/traffic metadata của BusDriveVN (offline)")
    ap.add_argument("--roads", default=DEFAULT_ROADS)
    ap.add_argument("--json", action="store_true", help="in kết quả dạng JSON")
    args = ap.parse_args()

    if not os.path.exists(args.roads):
        print("FAIL: không tìm thấy %s — chạy tools/map_generator.py trước" % args.roads)
        return 1

    errors, warnings, info = [], [], []
    check_parity(errors)
    e2, w2, i2 = audit(args.roads)
    errors += e2
    warnings += w2
    info += i2

    result = {
        "pass": not errors,
        "errors": errors,
        "warnings": warnings,
        "info": info,
        "roads": os.path.relpath(args.roads, ROOT),
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("=" * 72)
        print("TRAFFIC AUDIT — %s" % result["roads"])
        print("=" * 72)
        for line in info:
            print(line)
        if warnings:
            print("\n[%d CẢNH BÁO]" % len(warnings))
            for w in warnings[:40]:
                print("  ! " + w)
            if len(warnings) > 40:
                print("  ... và %d cảnh báo nữa" % (len(warnings) - 40))
        if errors:
            print("\n[%d LỖI]" % len(errors))
            for e in errors:
                print("  x " + e)
        print("\nKẾT LUẬN: %s (%d lỗi, %d cảnh báo)" % ("PASS" if not errors else "FAIL", len(errors), len(warnings)))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
