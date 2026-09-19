# tools/map_generator/terrain.py
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import math
from .config import CONFIG
from .roads import RoadNetwork

@dataclass
class Mountain:
    center_x: float
    center_z: float
    radius: float
    height: float

class TerrainManager:
    def __init__(self, network: RoadNetwork):
        self.network = network
        self.base_height = CONFIG.TERRAIN_DEFAULTS['sea_level']
        self.mountains: List[Mountain] = []
        
    def add_mountain(self, center_x: float, center_z: float, radius: float, height: float):
        pass  # Vô hiệu hóa hoàn toàn, terrain phẳng tuyệt đối
        
    def _distance_to_segment_2d(self, px: float, pz: float, p1x: float, p1z: float, p2x: float, p2z: float) -> float:
        dx = p2x - p1x
        dz = p2z - p1z
        l2 = dx*dx + dz*dz
        if l2 == 0: return math.hypot(px - p1x, pz - p1z)
        t = max(0.0, min(1.0, ((px - p1x) * dx + (pz - p1z) * dz) / l2))
        proj_x = p1x + t * dx
        proj_z = p1z + t * dz
        return math.hypot(px - proj_x, pz - proj_z)

    def get_height(self, x: float, z: float) -> float:
        # Địa hình phẳng tuyệt đối, trả về base_height
        return self.base_height

    def to_dict(self) -> Dict:
        return {
            "baseHeight": self.base_height,
            "mountains": [],
            "rivers": []
        }