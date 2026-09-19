# tools/map_generator/settlements.py
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any
from .regions import Region, RegionType
from .roads import RoadNetwork

class SettlementType(Enum):
    CITY = "CITY"
    SUBURBAN = "SUBURBAN"
    TOWN = "TOWN"
    VILLAGE = "VILLAGE"
    INDUSTRIAL_ZONE = "INDUSTRIAL_ZONE"
    COMMERCIAL_ZONE = "COMMERCIAL_ZONE"

@dataclass
class Settlement:
    id: str
    type: SettlementType
    name: str
    center_x: float
    center_z: float
    radius: float
    density: float
    region_id: str

class SettlementManager:
    def __init__(self):
        self.settlements: List[Settlement] = []
        
    def create_settlement(self, id: str, type: SettlementType, name: str, 
                          center_x: float, center_z: float, radius: float, 
                          density: float, region_id: str) -> Settlement:
        s = Settlement(id, type, name, center_x, center_z, radius, density, region_id)
        self.settlements.append(s)
        return s
        
    def get_settlements(self) -> List[Settlement]:
        return self.settlements
        
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": s.id, "type": s.type.value, "name": s.name,
                "cx": s.center_x, "cz": s.center_z, "radius": s.radius,
                "density": s.density, "region": s.region_id
            } for s in self.settlements
        ]