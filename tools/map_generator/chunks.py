# tools/map_generator/chunks.py
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple
import math
import json
from pathlib import Path
from .config import CONFIG
from .terrain import TerrainManager
from .buildings import BuildingManager, Building
from .objects import ObjectManager, WorldObject

@dataclass
class ChunkData:
    x: int
    z: int
    terrain: Dict[str, Any] = field(default_factory=dict)
    buildings: List[Dict] = field(default_factory=list)
    objects: List[Dict] = field(default_factory=list)

class ChunkManager:
    def __init__(self, terrain: TerrainManager, buildings: BuildingManager, objects: ObjectManager):
        self.terrain = terrain
        self.buildings = buildings
        self.objects = objects
        self.chunks: Dict[Tuple[int, int], ChunkData] = {}
        
    def _get_chunk_coord(self, x: float, z: float) -> Tuple[int, int]:
        return (int(x // CONFIG.CHUNK_SIZE), int(z // CONFIG.CHUNK_SIZE))
        
    def assign_data_to_chunks(self):
        """Gán buildings và objects vào các chunk tương ứng."""
        # 1. Assign Buildings
        for b in self.buildings.buildings:
            cx, cz = b.chunk_x, b.chunk_z
            if (cx, cz) not in self.chunks:
                self.chunks[(cx, cz)] = ChunkData(x=cx, z=cz)
            self.chunks[(cx, cz)].buildings.append({
                "id": b.id, "type": b.type.value, "x": b.x, "y": b.y, "z": b.z,
                "rot": b.rotation, "w": b.width, "d": b.depth, "h": b.height, "asset": b.asset_class
            })
            
        # 2. Assign Objects
        for o in self.objects.objects:
            cx, cz = o.chunk_x, o.chunk_z
            if (cx, cz) not in self.chunks:
                self.chunks[(cx, cz)] = ChunkData(x=cx, z=cz)
            self.chunks[(cx, cz)].objects.append({
                "id": o.id, "type": o.type.value, "x": o.x, "y": o.y, "z": o.z,
                "rot": o.rotation, "asset": o.asset_class
            })
            
    def generate_terrain_heightmaps(self):
        """Tạo heightmap resolution 32x32 cho mỗi chunk có chứa building/object."""
        res = 32
        for (cx, cz), chunk in self.chunks.items():
            # Chỉ tạo heightmap nếu chunk có content (tối ưu)
            heightmap = []
            start_x = cx * CONFIG.CHUNK_SIZE
            start_z = cz * CONFIG.CHUNK_SIZE
            
            for i in range(res):
                for j in range(res):
                    # Sample điểm giữa của mỗi cell
                    x = start_x + (i + 0.5) * (CONFIG.CHUNK_SIZE / res)
                    z = start_z + (j + 0.5) * (CONFIG.CHUNK_SIZE / res)
                    h = self.terrain.get_height(x, z)
                    heightmap.append(round(h, 2))
                    
            chunk.terrain = {
                "resolution": res,
                "size": CONFIG.CHUNK_SIZE,
                "heightmap": heightmap
            }
            
    def export_chunks(self, output_dir: Path):
        """Xuất từng chunk ra file JSON riêng biệt."""
        chunk_dir = output_dir / "chunks"
        chunk_dir.mkdir(parents=True, exist_ok=True)
        
        for (cx, cz), chunk in self.chunks.items():
            file_path = chunk_dir / f"{cx}_{cz}.json"
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(chunk.__dict__, f, ensure_ascii=False, indent=2)
                
    def get_chunk_list(self) -> List[Dict[str, int]]:
        return [{"x": c.x, "z": c.z} for c in self.chunks.values()]