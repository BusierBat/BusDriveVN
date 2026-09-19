# tools/map_generator/landmarks.py
from dataclasses import dataclass
from typing import List, Dict, Any
from .terrain import TerrainManager

@dataclass
class Landmark:
    id: str
    name: str
    type: str
    x: float
    y: float
    z: float
    asset_class: str

class LandmarkManager:
    def __init__(self, terrain: TerrainManager):
        self.terrain = terrain
        self.landmarks: List[Landmark] = []
        
    def add_landmark(self, id: str, name: str, type: str, x: float, z: float, asset_class: str):
        y = self.terrain.get_height(x, z)
        self.landmarks.append(Landmark(id, name, type, x, y, z, asset_class))
        
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {"id": l.id, "name": l.name, "type": l.type, "x": l.x, "y": l.y, "z": l.z, "asset": l.asset_class}
            for l in self.landmarks
        ]