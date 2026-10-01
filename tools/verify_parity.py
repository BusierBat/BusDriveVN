# -*- coding: utf-8 -*-
"""
PARITY + PROFILE js/map.js vs tools/map_generator.py (CPU thuan, Node).
Dung thu muc tam + stub 'three' (module nho, khong loi data: URL).
Cach chay: python tools/verify_parity.py
"""
import importlib.util
import json
import math
import os
import random
import shutil
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # thu muc goc cua project
NODE = shutil.which("node") or "node"   # tu tim node trong PATH
MAPS = os.path.join(ROOT, "generated", "maps")
CHUNK = 256

THREE_STUB = r'''export const DoubleSide=2;export const BackSide=1;export const FrontSide=0;
export class Vector3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}}
export class Color{constructor(){}setHex(){}copy(){}lerp(){}}
export class Object3D{constructor(){this.children=[];this.position=new Vector3();}}
export class Scene extends Object3D{}
export class Group extends Object3D{}
export class Mesh{constructor(){}}
export class InstancedMesh{constructor(){this.count=0;}}
export class Fog{constructor(){}}
export class Clock{constructor(){}start(){}getDelta(){return 0;}}
export class PerspectiveCamera{constructor(){}}
export class WebGLRenderer{constructor(){}}
export class Raycaster{}
export class PlaneGeometry{constructor(){this.attributes={position:{count:0,getX(){},getY(){},setZ(){}}},index=null;}
  rotateX(){}computeVertexNormals(){}setAttribute(){}dispose(){}}
export class BoxGeometry{constructor(){this.attributes={position:{count:0}};}
  computeVertexNormals(){}setAttribute(){}dispose(){}}
export class ConeGeometry extends BoxGeometry{}
export class CylinderGeometry extends BoxGeometry{}
export class SphereGeometry extends BoxGeometry{}
export class IcosahedronGeometry extends BoxGeometry{}
export class CapsuleGeometry extends BoxGeometry{}
export class MeshStandardMaterial{constructor(){this.color=new Color();}dispose(){}}
export class MeshLambertMaterial extends MeshStandardMaterial{}
export class MeshBasicMaterial extends MeshStandardMaterial{}
export class Matrix4{constructor(){}compose(){}makeTranslation(){}}
export class Quaternion{constructor(){}setFromEuler(){}}
export class Euler{constructor(){}set(){}}
'''

RUN_JS = r'''import fs from "node:fs";
import { World } from "./map.js";
const world = JSON.parse(fs.readFileSync("./world.json", "utf8"));
const pts = JSON.parse(fs.readFileSync("./pts.json", "utf8"));
const w = new World(world);
const out = { elev: [], prof: {} };
for (const [x, z] of pts) out.elev.push(w.getElevationInfo(x, z).h);

// so sanh GIA TRI TRUNG GIAN tai diem lech lon nhat
if (process.argv[2]) {
  const [x, z] = process.argv[2].split(",").map(Number);
  out.mid = {
    x, z,
    u_d: w.corridorUDist(x, z),
    uAtZ: w._uAtZ(z, x),
    dCoast: w.distToCoast(x, z),
    water: w.waterFactor(x, z),
    p: w.regionParamsWithCoast(x, z, w.distToCoast(x, z)),
    h: w.getElevationInfo(x, z).h
  };
  // do lai: segment bien gan nhat (chi so + cross) de doi chieu Python
  {
    let best = Infinity, bi = -1, bt = 0;
    for (let i = 0; i < w.coast.length - 1; i++) {
      const a = w.coast[i], b = w.coast[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz; if (l2 <= 0) continue;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const cx = a[0] + dx * t, cz = a[1] + dz * t;
      const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    const a = w.coast[bi], b = w.coast[bi + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.sqrt(dx * dx + dz * dz) || 1;
    const cx = a[0] + dx * bt, cz = a[1] + dz * bt;
    out.mid.coastIdx = bi;
    out.mid.coastT = bt;
    out.mid.coastCross = (dz * (x - cx) - dx * (z - cz)) / L;
    out.mid.coastPt = [cx, cz];
  }
}

const time = (fn) => {
  for (let k = 0; k < 2; k++) for (const [x, z] of pts) fn(x, z);
  let best = Infinity;
  for (let r = 0; r < 8; r++) {
    const t0 = process.hrtime.bigint();
    for (const [x, z] of pts) fn(x, z);
    const us = Number(process.hrtime.bigint() - t0) / 1000 / pts.length;
    if (us < best) best = us;
  }
  return +best.toFixed(2);
};
out.prof.getElevationInfo = time((x, z) => w.getElevationInfo(x, z));
out.prof.distToCoast      = time((x, z) => w.distToCoast(x, z));
out.prof.corridorUDist    = time((x, z) => w.corridorUDist(x, z));
out.prof.waterFactor      = time((x, z) => w.waterFactor(x, z));
out.prof.regionParams     = time((x, z) => w.regionParams(x, z));
out.prof._uAtZ            = time((x, z) => w._uAtZ(z, x));
out.counts = {
  coastPts: w.coast.length, corridorPts: w.corridor.length,
  riverPts: w.rivers.reduce((a, r) => a + r.poly.length, 0),
  accCoastCells: w._accCoast.size, accCorridorCells: w._accCorridor.size
};
console.log(JSON.stringify(out));
'''


def main():
    world = json.load(open(os.path.join(MAPS, "world.json"), encoding="utf-8"))
    roads = json.load(open(os.path.join(MAPS, "roads.json"), encoding="utf-8"))
    nodes = {n["id"]: n for n in roads["nodes"]}

    pts = []
    b = world["bounds"]
    rnd = random.Random(20260924)
    for _ in range(400):
        pts.append((rnd.uniform(b["minX"], b["maxX"]), rnd.uniform(b["minZ"], b["maxZ"])))
    for s in roads["segments"][::7]:
        a, c = nodes[s["from"]], nodes[s["to"]]
        pts.append(((a["x"] + c["x"]) * 0.5, (a["z"] + c["z"]) * 0.5))
        pts.append((a["x"] + 3.0, a["z"] - 3.0))
    for r in world.get("water", {}).get("rivers", []):
        for i in range(len(r["poly"]) - 1):
            (x1, z1), (x2, z2) = r["poly"][i], r["poly"][i + 1]
            dx, dz = x2 - x1, z2 - z1
            L = math.hypot(dx, dz) or 1.0
            nx, nz = -dz / L, dx / L
            for t in (0.25, 0.5, 0.75):
                x = x1 + (x2 - x1) * t
                z = z1 + (z2 - z1) * t
                pts.append((x, z))
                pts.append((x + nx * r["width"] * 0.5, z + nz * r["width"] * 0.5))
    coast = world["terrain"]["coast"]
    for i in range(0, len(coast) - 1, 2):
        (x1, z1), (x2, z2) = coast[i], coast[i + 1]
        dx, dz = x2 - x1, z2 - z1
        L = math.hypot(dx, dz) or 1.0
        nx, nz = dz / L, -dx / L
        for off in (-120.0, -20.0, 20.0, 120.0):
            pts.append((x1 + nx * off, z1 + nz * off))
    stations = json.load(open(os.path.join(MAPS, "stations.json"), encoding="utf-8"))
    for s in stations:
        pts.append((s["x"], s["z"]))
        for slot in s.get("baySlots", [])[:40]:
            pts.append((slot["x"], slot["z"]))
    pts = [(round(x, 2), round(z, 2)) for x, z in pts]

    # --- Python side ---
    spec = importlib.util.spec_from_file_location("mg", os.path.join(ROOT, "tools", "map_generator.py"))
    mg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mg)
    gen = mg.MapGenerator()
    py = [gen.get_elevation(x, z) for (x, z) in pts]

    # --- JS side (temp dir + stub) ---
    os.makedirs(os.path.join(ROOT, "_tmpbench"), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="verify_", dir=os.path.join(ROOT, "_tmpbench"))
    try:
        open(os.path.join(tmp, "three.js"), "w", encoding="utf-8").write(THREE_STUB)
        shutil.copy(os.path.join(ROOT, "js", "RuntimeRoadGraph.js"),
                    os.path.join(tmp, "RuntimeRoadGraph.js"))
        src = open(os.path.join(ROOT, "js", "map.js"), encoding="utf-8").read()
        src = src.replace('from "three"', 'from "./three.js"')
        open(os.path.join(tmp, "map.js"), "w", encoding="utf-8").write(src)
        json.dump(world, open(os.path.join(tmp, "world.json"), "w"), separators=(",", ":"))
        json.dump(pts, open(os.path.join(tmp, "pts.json"), "w"), separators=(",", ":"))
        open(os.path.join(tmp, "run.mjs"), "w", encoding="utf-8").write(RUN_JS)
        probe = os.environ.get("PROBE_PT")
        cmd = [NODE, "run.mjs"] + ([probe] if probe else [])
        r = subprocess.run(cmd, cwd=tmp, capture_output=True,
                           text=True, timeout=900)
        if r.returncode != 0:
            print("JS LOI:", "\n".join((r.stderr or "").splitlines()[-12:]))
            raise SystemExit(1)
        js_out = json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    js = js_out["elev"]
    diffs = [abs(a - b) for a, b in zip(py, js)]
    worst = max(range(len(diffs)), key=lambda i: diffs[i])
    over = [i for i, d in enumerate(diffs) if d > 0.01]
    print("=== PARITY PYTHON <-> JS ===")
    print("  so diem: %d | max |py-js| = %.6f m tai (%.1f, %.1f)"
          % (len(pts), diffs[worst], pts[worst][0], pts[worst][1]))
    print("  diem lech > 1cm: %d" % len(over))
    for i in sorted(range(len(diffs)), key=lambda i: -diffs[i])[:6]:
        if diffs[i] > 1e-6:
            print("     (%.0f, %.0f) py=%.3f js=%.3f d=%.4f"
                  % (pts[i][0], pts[i][1], py[i], js[i], diffs[i]))
    print("  -> " + ("PARITY OK" if not over else "PARITY FAIL"))

    mid = js_out.get("mid")
    if mid:
        mx, mz = mid["x"], mid["z"]
        pud = gen.corridor_u_dist(mx, mz)
        pp = gen.region_params(mx, mz)
        pd = gen.dist_to_coast(mx, mz)
        print("=== SO GIA TRI TRUNG GIAN tai (%.0f, %.0f) ===" % (mx, mz))
        print("  u,d      py=%s  js=%s" % ([round(v, 4) for v in pud],
                                           [round(v, 4) for v in mid["u_d"]]))
        print("  uAtZ     py=%.4f js=%.4f" % (gen._u_at_z(mz, mx), mid["uAtZ"]))
        print("  dCoast   py=%.2f js=%.2f" % (pd, mid["dCoast"]))
        print("  water    py=%.4f js=%.4f" % (gen.water_factor(mx, mz), mid["water"]))
        for k in sorted(set(list(pp.keys()) + list(mid["p"].keys()))):
            pv = pp.get(k, 0.0)
            jv = mid["p"].get(k, 0.0)
            if isinstance(pv, (int, float)) and isinstance(jv, (int, float)):
                flag = "  <<< LECH" if abs(pv - jv) > 0.001 else ""
                print("  %-10s py=%-12.5f js=%-12.5f%s" % (k, pv, jv, flag))
            else:
                print("  %-10s py=%-12s js=%-12s" % (k, pv, jv))
        print("  h        py=%.3f js=%.3f" % (py[worst], mid["h"]))
        # do lai segment bien gan nhat o Python
        poly = gen.coast
        best, bi, bt = float("inf"), 0, 0.0
        for i in range(len(poly) - 1):
            ax, az = poly[i]
            bx, bz = poly[i + 1]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 <= 0:
                continue
            t = max(0.0, min(1.0, ((mx - ax) * dx + (mz - az) * dz) / l2))
            cx, cz = ax + dx * t, az + dz * t
            d2 = (mx - cx) ** 2 + (mz - cz) ** 2
            if d2 < best:
                best, bi, bt = d2, i, t
        ax, az = poly[bi]
        bx, bz = poly[bi + 1]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1.0
        cx, cz = ax + dx * bt, az + dz * bt
        cross = (dz * (mx - cx) - dx * (mz - cz)) / L
        print("  bien: idx py=%d js=%s | t py=%.9f js=%.9f | cross py=%+.4f js=%+.4f"
              % (bi, mid.get("coastIdx"), bt, mid.get("coastT", 0), cross,
                 mid.get("coastCross", 0)))
        print("  bien diem gan nhat: py=(%.3f,%.3f) js=(%.3f,%.3f)"
              % (cx, cz, mid.get("coastPt", [0, 0])[0], mid.get("coastPt", [0, 0])[1]))

    print("=== PROFILE JS (us/call) ===")
    for k, v in sorted(js_out["prof"].items(), key=lambda kv: -kv[1]):
        print("  %-20s %6.2f" % (k, v))
    print("  so lieu:", js_out["counts"])
    us = js_out["prof"]["getElevationInfo"]
    print("  => terrain 33x33 = %.1f ms | LOD 17x17 = %.1f ms"
          % (us * 1089 / 1000, us * 289 / 1000))


if __name__ == "__main__":
    main()

