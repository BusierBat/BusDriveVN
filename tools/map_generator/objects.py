# tools/map_generator/objects.py
from dataclasses import dataclass
from enum import Enum
from typing import List, Dict, Any
import math
import random
from .config import CONFIG
from .roads import RoadNetwork, RoadType
from .terrain import TerrainManager

class ObjectType(Enum):
    TREE = "TREE"
    STREET_LIGHT = "STREET_LIGHT"
    SIGN = "SIGN"
    GUARDRAIL = "GUARDRAIL"
    BUS_STOP = "BUS_STOP"

@dataclass
class WorldObject:
    id: str
    type: ObjectType
    x: float
    y: float
    z: float
    rotation: float
    asset_class: str
    chunk_x: int
    chunk_z: int

class ObjectManager:
    def __init__(self, network: RoadNetwork, terrain: TerrainManager):
        self.network = network
        self.terrain = terrain
        self.objects: List[WorldObject] = []
        self.rng = CONFIG.get_rng()
        self._id_counter = 0
        
    def _add_object(self, type: ObjectType, x: float, z: float, rotation: float, asset_class: str):
        y = self.terrain.get_height(x, z)
        self._id_counter += 1
        self.objects.append(WorldObject(
            id=f"obj_{self._id_counter:05d}", type=type, x=x, y=y, z=z,
            rotation=rotation, asset_class=asset_class,
            chunk_x=int(x // CONFIG.CHUNK_SIZE), chunk_z=int(z // CONFIG.CHUNK_SIZE)
        ))
        
    def generate_objects(self):
        """Sinh vật thể môi trường dọc theo đường."""
        for seg in self.network.segments.values():
            n1 = self.network.get_node(seg.from_node)
            n2 = self.network.get_node(seg.to_node)
            if not n1 or not n2: continue
            
            dx = n2.x - n1.x
            dz = n2.z - n1.z
            length = math.hypot(dx, dz)
            if length == 0: continue
            
            dir_x = dx / length
            dir_z = dz / length
            
            # Right vector (pointing to the right side of the road direction)
            right_x = -dir_z
            right_z = dir_x
            
            profile = seg.road_type
            road_width = 10.0 # Default
            
            # 1. Street Lights (Urban/QL1A)
            if profile in [RoadType.URBAN_ARTERIAL, RoadType.QL1A]:
                spacing = 40.0
                num = int(length / spacing)
                for i in range(num):
                    t = (i + 0.5) / num if num > 0 else 0.5
                    px = n1.x + dir_x * length * t
                    pz = n1.z + dir_z * length * t
                    # Place on right side
                    lx = px + right_x * (road_width / 2 + 2.0)
                    lz = pz + right_z * (road_width / 2 + 2.0)
                    self._add_object(ObjectType.STREET_LIGHT, lx, lz, 0, "street_light_01")
                    
            # 2. Guardrails (Highway/Expressway/Mountain)
            if profile in [RoadType.EXPRESSWAY, RoadType.MOUNTAIN]:
                spacing = 10.0
                num = int(length / spacing)
                for i in range(num + 1):
                    t = i / num if num > 0 else 0
                    px = n1.x + dir_x * length * t
                    pz = n1.z + dir_z * length * t
                    # Both sides
                    self._add_object(ObjectType.GUARDRAIL, px + right_x * (road_width / 2), pz + right_z * (road_width / 2), math.atan2(dir_x, dir_z), "guardrail_01")
                    self._add_object(ObjectType.GUARDRAIL, px - right_x * (road_width / 2), pz - right_z * (road_width / 2), math.atan2(dir_x, dir_z), "guardrail_01")
                    
            # 3. Trees (Rural/Local)
            if profile in [RoadType.LOCAL, RoadType.MOUNTAIN, RoadType.QL1A]:
                num = int(length / 15.0)
                for i in range(num):
                    t = self.rng.random()
                    px = n1.x + dir_x * length * t
                    pz = n1.z + dir_z * length * t
                    offset = self.rng.uniform(15.0, 40.0) * (1 if self.rng.random() > 0.5 else -1)
                    lx = px + right_x * offset
                    lz = pz + right_z * offset
                    self._add_object(ObjectType.TREE, lx, lz, self.rng.uniform(0, math.pi), "tree_01")
                    
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": o.id, "type": o.type.value, "x": o.x, "y": o.y, "z": o.z,
                "rot": o.rotation, "asset": o.asset_class, "chunkX": o.chunk_x, "chunkZ": o.chunk_z
            } for o in self.objects
        ]