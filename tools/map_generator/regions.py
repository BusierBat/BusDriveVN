# tools/map_generator/regions.py
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional
from .config import CONFIG

class RegionType(Enum):
    CITY = "CITY"
    SUBURBAN = "SUBURBAN"
    TOWN = "TOWN"
    VILLAGE = "VILLAGE"
    HAMLET = "HAMLET"
    RURAL = "RURAL"
    AGRICULTURAL = "AGRICULTURAL"
    INDUSTRIAL = "INDUSTRIAL"
    COMMERCIAL = "COMMERCIAL"
    RESIDENTIAL = "RESIDENTIAL"
    MOUNTAIN = "MOUNTAIN"
    COASTAL = "COASTAL"
    FOREST = "FOREST"
    HIGHWAY_CORRIDOR = "HIGHWAY_CORRIDOR"

@dataclass
class Region:
    id: str
    type: RegionType
    name: str
    bounds: Dict[str, float] # minX, maxX, minZ, maxZ
    metadata: Dict[str, Any] = field(default_factory=dict)

class RegionManager:
    def __init__(self):
        self.regions: List[Region] = []
        
    def create_region(self, id: str, type: RegionType, name: str, 
                      minX: float, maxX: float, minZ: float, maxZ: float, **kwargs) -> Region:
        region = Region(
            id=id,
            type=type,
            name=name,
            bounds={"minX": minX, "maxX": maxX, "minZ": minZ, "maxZ": maxZ},
            metadata=kwargs
        )
        self.regions.append(region)
        return region
        
    def get_regions(self) -> List[Region]:
        return self.regions
        
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": r.id,
                "type": r.type.value,
                "name": r.name,
                "bounds": r.bounds,
                "metadata": r.metadata
            } for r in self.regions
        ]