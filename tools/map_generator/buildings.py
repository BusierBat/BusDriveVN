# tools/map_generator/buildings.py
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional
import math
import random
from .config import CONFIG
from .roads import RoadNetwork
from .terrain import TerrainManager
from .settlements import SettlementManager, Settlement, SettlementType

class BuildingType(Enum):
    RESIDENTIAL = "RESIDENTIAL"
    COMMERCIAL = "COMMERCIAL"
    INDUSTRIAL = "INDUSTRIAL"
    OFFICE = "OFFICE"
    SERVICE = "SERVICE"

@dataclass
class Building:
    id: str
    type: BuildingType
    x: float
    y: float
    z: float
    rotation: float
    width: float
    depth: float
    height: float
    asset_class: str
    chunk_x: int
    chunk_z: int

class BuildingManager:
    def __init__(self, network: RoadNetwork, terrain: TerrainManager, settlements: SettlementManager):
        self.network = network
        self.terrain = terrain
        self.settlements = settlements
        self.buildings: List[Building] = []
        self.rng = CONFIG.get_rng()
        self._id_counter = 0
        
    def _distance_to_segment_2d(self, px: float, pz: float, p1x: float, p1z: float, p2x: float, p2z: float) -> float:
        dx = p2x - p1x
        dz = p2z - p1z
        l2 = dx*dx + dz*dz
        if l2 == 0: return math.hypot(px - p1x, pz - p1z)
        t = max(0.0, min(1.0, ((px - p1x) * dx + (pz - p1z) * dz) / l2))
        proj_x = p1x + t * dx
        proj_z = p1z + t * dz
        return math.hypot(px - proj_x, pz - proj_z)

    def _is_near_road(self, x: float, z: float, max_dist: float = 30.0) -> bool:
        """Kiểm tra xem tọa độ có nằm gần đường không (để xây nhà mặt tiền)."""
        for seg in self.network.segments.values():
            n1 = self.network.get_node(seg.from_node)
            n2 = self.network.get_node(seg.to_node)
            if not n1 or not n2: continue
            dist = self._distance_to_segment_2d(x, z, n1.x, n1.z, n2.x, n2.z)
            if dist < max_dist:
                return True
        return False

    def generate_buildings(self):
        """Sinh metadata công trình dựa trên khu dân cư."""
        # FIX LỖI: Sử dụng get_settlements() để lấy danh sách thay vì duyệt trực tiếp đối tượng
        for settlement in self.settlements.get_settlements():
            num_buildings = int(settlement.radius * settlement.density * 2.0)
            
            for _ in range(num_buildings):
                # Random position within settlement radius
                angle = self.rng.random() * 2 * math.pi
                r = settlement.radius * math.sqrt(self.rng.random())
                x = settlement.center_x + r * math.cos(angle)
                z = settlement.center_z + r * math.sin(angle)
                
                # Bỏ qua nếu quá gần đường (tránh đè lên lane)
                if self._is_near_road(x, z, 8.0):
                    continue
                
                # Chỉ xây nhà nếu có đường gần đó (trong bán kính 50m)
                if not self._is_near_road(x, z, 50.0):
                    continue
                
                y = self.terrain.get_height(x, z)
                
                # Chọn loại nhà dựa trên khu vực
                b_type = BuildingType.RESIDENTIAL
                asset = "res_01"
                if settlement.type == SettlementType.CITY:
                    b_type = self.rng.choice([BuildingType.OFFICE, BuildingType.COMMERCIAL, BuildingType.RESIDENTIAL])
                    asset = self.rng.choice(["office_01", "shop_01", "apt_01"])
                    height = self.rng.uniform(15.0, 40.0)
                elif settlement.type == SettlementType.INDUSTRIAL_ZONE:
                    b_type = BuildingType.INDUSTRIAL
                    asset = self.rng.choice(["factory_01", "warehouse_01"])
                    height = self.rng.uniform(8.0, 15.0)
                else:
                    height = self.rng.uniform(4.0, 8.0)
                
                self._id_counter += 1
                b_id = f"bld_{self._id_counter:04d}"
                
                # Tính chunk thuộc về
                cx = int(x // CONFIG.CHUNK_SIZE)
                cz = int(z // CONFIG.CHUNK_SIZE)
                
                self.buildings.append(Building(
                    id=b_id, type=b_type, x=x, y=y, z=z,
                    rotation=self.rng.uniform(0, math.pi),
                    width=self.rng.uniform(8.0, 15.0),
                    depth=self.rng.uniform(8.0, 15.0),
                    height=height,
                    asset_class=asset,
                    chunk_x=cx, chunk_z=cz
                ))
                
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": b.id, "type": b.type.value, "x": b.x, "y": b.y, "z": b.z,
                "rot": b.rotation, "w": b.width, "d": b.depth, "h": b.height,
                "asset": b.asset_class, "chunkX": b.chunk_x, "chunkZ": b.chunk_z
            } for b in self.buildings
        ]