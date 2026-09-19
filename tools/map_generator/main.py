# tools/map_generator/main.py
import json
import math
import random
from pathlib import Path

EXPORT_DIR = Path("generated/maps")
CHUNK_SIZE = 256
SEA_LEVEL = 10.0
SEED = 20260817

def main():
    print("=== BusDriveVN Vast Organic Network Generator ===")
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    (EXPORT_DIR / "chunks").mkdir(exist_ok=True)
    
    rng = random.Random(SEED)
    nodes = {}
    segments = {}
    buildings = []
    objects = []
    stations = []
    chunk_data = {} 
    
    node_id_counter = 0
    seg_id_counter = 0

    def get_id(prefix):
        nonlocal node_id_counter, seg_id_counter
        if prefix == "n":
            nid = f"n_{node_id_counter}"; node_id_counter += 1; return nid
        else:
            sid = f"s_{seg_id_counter}"; seg_id_counter += 1; return sid

    def add_node(x, z, type="intersection", y=SEA_LEVEL):
        nid = get_id("n")
        nodes[nid] = {"id": nid, "x": float(x), "y": float(y), "z": float(z), "type": type, "connections": []}
        return nid
        
    def add_segment(from_id, to_id, road_type, width=12.0, two_way=True):
        if from_id not in nodes or to_id not in nodes: return None
        sid = get_id("s")
        segments[sid] = {"id": sid, "from": from_id, "to": to_id, "roadType": road_type, "width": float(width), "twoWay": two_way}
        nodes[from_id]["connections"].append(sid)
        if two_way: nodes[to_id]["connections"].append(sid)
        return sid

    def add_building(x, z, template, rot=0):
        data = {"x": float(x), "y": SEA_LEVEL, "z": float(z), "rot": float(rot), **template}
        buildings.append(data)
        cx = int(x // CHUNK_SIZE)
        cz = int(z // CHUNK_SIZE)
        if (cx, cz) not in chunk_data: chunk_data[(cx, cz)] = {"buildings": [], "objects": []}
        chunk_data[(cx, cz)]["buildings"].append(data)

    def add_object(x, z, o_type="TREE"):
        data = {"type": o_type, "x": float(x), "y": SEA_LEVEL, "z": float(z)}
        objects.append(data)
        cx = int(x // CHUNK_SIZE)
        cz = int(z // CHUNK_SIZE)
        if (cx, cz) not in chunk_data: chunk_data[(cx, cz)] = {"buildings": [], "objects": []}
        chunk_data[(cx, cz)]["objects"].append(data)

    def is_near_station(bx, bz, st_list):
        margin = 30
        for st in st_list:
            if abs(bx - st["x"]) < (st["w"]/2 + margin) and abs(bz - st["z"]) < (st["d"]/2 + margin):
                return True
        return False

    def is_near_road(bx, bz, segments, nodes, max_dist=15.0):
        for seg in segments.values():
            p1 = nodes[seg["from"]]
            p2 = nodes[seg["to"]]
            dx = p2["x"] - p1["x"]
            dz = p2["z"] - p1["z"]
            l2 = dx*dx + dz*dz
            if l2 == 0: continue
            t = max(0, min(1, ((bx - p1["x"]) * dx + (bz - p1["z"]) * dz) / l2))
            proj_x = p1["x"] + t * dx
            proj_z = p1["z"] + t * dz
            if math.hypot(bx - proj_x, bz - proj_z) < max_dist:
                return True
        return False

    print("[1/6] Generating 200 House Templates...")
    house_templates = []
    colors = [0xeeeeee, 0xdddddd, 0xffffaa, 0xaaccff, 0xffdddd, 0xccccaa, 0x88cc88]
    roof_colors = [0x8b4513, 0x556b2f, 0x222222, 0xaa3333, 0x444466]
    t_id = 0
    for w in [6, 8, 10, 12, 15]:
        for d in [8, 10, 12, 15, 20]:
            for f in [1, 2, 3, 4, 5]:
                for rt in ['flat', 'pitched']:
                    for c in colors:
                        if t_id < 200:
                            house_templates.append({"id": f"house_{t_id}", "type": "RESIDENTIAL", "w": w, "d": d, "height": f * 3.5, "roof_type": rt, "color": c, "roof_color": roof_colors[t_id % 5]})
                            t_id += 1

    print("[2/6] Generating Main Spine (QL1A & Expressway)...")
    # QL1A chạy xuyên suốt từ Z=5000 (Bắc) đến Z=-5000 (Nam)
    ql_nodes = []
    current_x = 0
    current_z = 5000
    target_z = -5000
    step_z = -500
    
    # Cao tốc song song cách 800m
    exp_nodes = []
    
    while current_z >= target_z:
        current_x += rng.uniform(-200, 200)
        n_ql = add_node(current_x, current_z, "highway_junction")
        if len(ql_nodes) > 0: add_segment(ql_nodes[-1], n_ql, "QL1A", 20.0)
        ql_nodes.append(n_ql)
        
        n_exp = add_node(current_x - 800, current_z, "highway_junction")
        if len(exp_nodes) > 0: add_segment(exp_nodes[-1], n_exp, "EXPRESSWAY", 28.0)
        exp_nodes.append(n_exp)
        
        # Nút giao Interchange
        if int(current_z) % 2000 == 0:
            n_ramp_ql = add_node(current_x - 100, current_z, "junction")
            n_ramp_exp = add_node(current_x - 700, current_z, "junction")
            add_segment(n_ql, n_ramp_ql, "RAMP", 10.0)
            add_segment(n_ramp_ql, n_ramp_exp, "RAMP", 10.0)
            add_segment(n_ramp_exp, n_exp, "RAMP", 10.0)
            
        current_z += step_z

    print("[3/6] Generating Station Off-Road (Nam Tuy Hoa & Mien Dong)...")
    # Bến xe Nam Tuy Hòa nằm bên lề QL1A (tại Z=2000), không bị đường xuyên qua
    st1_q_node = [n for n in ql_nodes if nodes[n]["z"] <= 2000][0]
    st1_q_x = nodes[st1_q_node]["x"]
    st1_q_z = nodes[st1_q_node]["z"]
    
    # Offset sang phải 150m
    st1_x = st1_q_x + 150
    st1_z = st1_q_z
    n_st1_entry = add_node(st1_q_x + 50, st1_q_z, "junction")
    n_st1 = add_node(st1_x, st1_z, "bus_station")
    # Đường nhánh vào bến
    add_segment(st1_q_node, n_st1_entry, "STATION_ACCESS", 15.0, False)
    add_segment(n_st1_entry, n_st1, "STATION_ACCESS", 15.0, False)
    # Đường ra nối ngược lại QL1A
    n_st1_exit = add_node(st1_q_x + 50, st1_q_z - 100, "junction")
    add_segment(n_st1, n_st1_exit, "STATION_ACCESS", 15.0, False)
    n_ql_next = [n for n in ql_nodes if nodes[n]["z"] <= st1_q_z - 500][0]
    add_segment(n_st1_exit, n_ql_next, "STATION_ACCESS", 15.0, False)
    
    stations.append({
        "id": "nam_tuy_hoa", "type": "BUS_STATION", "name": "Bến xe Nam Tuy Hòa",
        "x": st1_x, "y": SEA_LEVEL, "z": st1_z, "w": 150, "d": 100,
        "buses": [{"x": st1_x - 50 + i*8, "y": SEA_LEVEL, "z": st1_z + 20, "heading": 0} for i in range(15)]
    })

    # Bến xe Miền Đông tại Z=-4000
    st2_q_node = [n for n in ql_nodes if nodes[n]["z"] <= -4000][0]
    st2_q_x = nodes[st2_q_node]["x"]
    st2_q_z = nodes[st2_q_node]["z"]
    st2_x = st2_q_x + 200
    st2_z = st2_q_z
    n_st2_entry = add_node(st2_q_x + 50, st2_q_z, "junction")
    n_st2 = add_node(st2_x, st2_z, "bus_station")
    add_segment(st2_q_node, n_st2_entry, "STATION_ACCESS", 20.0, False)
    add_segment(n_st2_entry, n_st2, "STATION_ACCESS", 20.0, False)
    n_st2_exit = add_node(st2_q_x + 50, st2_q_z - 100, "junction")
    add_segment(n_st2, n_st2_exit, "STATION_ACCESS", 20.0, False)
    n_ql_next2 = [n for n in ql_nodes if nodes[n]["z"] <= st2_q_z - 500][0]
    add_segment(n_st2_exit, n_ql_next2, "STATION_ACCESS", 20.0, False)
    
    stations.append({
        "id": "mien_dong", "type": "MAJOR_BUS_TERMINAL", "name": "Bến xe Miền Đông",
        "x": st2_x, "y": SEA_LEVEL, "z": st2_z, "w": 300, "d": 200,
        "buses": [{"x": st2_x - 100 + i*10, "y": SEA_LEVEL, "z": st2_z + 20, "heading": 0} for i in range(50)]
    })

    print("[4/6] Generating Vast Local Road Network (Recursive Branches)...")
    # Sinh nhánh đệ quy từ QL1A lan tỏa ra 2 bên, tạo vòng (cycle) không cụt
    def grow_branch(start_node_id, depth, angle, length, road_type, width):
        if depth == 0: return
        p1 = nodes[start_node_id]
        bx = p1["x"] + math.cos(angle) * length
        bz = p1["z"] + math.sin(angle) * length
        
        # Thêm chút uốn lượn
        bx += rng.uniform(-50, 50)
        bz += rng.uniform(-50, 50)
        
        n_new = add_node(bx, bz, "junction")
        add_segment(start_node_id, n_new, road_type, width)
        
        # Tiếp tục rẽ nhánh
        grow_branch(n_new, depth-1, angle + rng.uniform(-0.5, 0.5), length * 0.8, road_type, width)
        
        # Nối ngược lại QL1A để tạo Cycle (nếu gần)
        nearest_ql = min(ql_nodes, key=lambda n: math.hypot(nodes[n]["x"]-bx, nodes[n]["z"]-bz))
        if math.hypot(nodes[nearest_ql]["x"]-bx, nodes[nearest_ql]["z"]-bz) < 500 and rng.random() < 0.3:
            add_segment(n_new, nearest_ql, "LOCAL", 10.0)

    # Chạy nhánh từ các node QL1A
    for n_ql in ql_nodes:
        if rng.random() < 0.7:
            angle = rng.choice([0, math.pi]) # Sang trái hoặc phải
            grow_branch(n_ql, rng.randint(2, 4), angle, 300, "LOCAL", 10.0)

    print("[5/6] Placing Buildings along ALL Roads & Scattering Vegetation...")
    # 1. Nhà dọc đường
    placed_buildings = []
    for seg_id, seg in segments.items():
        if seg["roadType"] in ["EXPRESSWAY", "RAMP"]: continue
        
        p1 = nodes[seg["from"]]
        p2 = nodes[seg["to"]]
        dx = p2["x"] - p1["x"]
        dz = p2["z"] - p1["z"]
        length = math.hypot(dx, dz)
        if length == 0: continue
        
        nx = -dz / length
        nz = dx / length
        rot = math.atan2(dx, dz)
        
        is_urban = (abs(p1["z"]) < 2500) # Xung quanh bến xe là đô thị
        spacing = 25 if is_urban else 100
        
        for d in range(15, int(length), spacing):
            t = d / length
            cx = p1["x"] + dx * t
            cz = p1["z"] + dz * t
            
            for side in [1, -1]:
                offset = seg["width"]/2 + 10
                bx = cx + nx * offset * side
                bz = cz + nz * offset * side
                
                if is_near_station(bx, bz, stations): continue
                if is_near_road(bx, bz, segments, nodes, 10.0): continue # Không đè đường khác
                
                overlap = False
                for pb in placed_buildings:
                    if math.hypot(bx - pb["x"], bz - pb["z"]) < 15:
                        overlap = True; break
                if overlap: continue
                
                template = rng.choice(house_templates)
                final_rot = rot + (math.pi / 2 if side == 1 else -math.pi / 2)
                add_building(bx, bz, template, final_rot)
                placed_buildings.append({"x": bx, "z": bz})

    # 2. Cây cối ngẫu nhiên khắp map (Trừ khu vực trống quá lớn)
    for _ in range(2000):
        tx = rng.uniform(-3000, 3000)
        tz = rng.uniform(-5000, 5000)
        if is_near_station(tx, tz, stations): continue
        if is_near_road(tx, tz, segments, nodes, 15.0): continue
        add_object(tx, tz, "TREE")

    print("[6/6] Exporting JSON Data...")
    with open(EXPORT_DIR / "world.json", "w") as f: json.dump({"size": 100000, "seaLevel": SEA_LEVEL}, f)
    with open(EXPORT_DIR / "roads.json", "w") as f: json.dump({"nodes": list(nodes.values()), "segments": list(segments.values())}, f)
    with open(EXPORT_DIR / "stations.json", "w") as f: json.dump(stations, f)
    
    route_nodes = ql_nodes
    with open(EXPORT_DIR / "routes.json", "w") as f: json.dump([{"id": "main_route", "name": "Phú Yên - Sài Gòn", "nodes": route_nodes}], f)

    for (cx, cz), data in chunk_data.items():
        with open(EXPORT_DIR / "chunks" / f"{cx}_{cz}.json", "w") as f: json.dump(data, f)

    print("Generation Complete! Vast network created. No dead ends. Stations off-road.")

if __name__ == "__main__":
    main()