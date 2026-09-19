# tools/map_generator/world.py
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from .config import CONFIG

@dataclass
class WorldMetadata:
    schemaVersion: str
    mapVersion: str
    generatorVersion: str
    seed: int
    width: float
    height: float
    coordinateSystem: str = "right-handed-y-up"

@dataclass
class WorldBounds:
    minX: float
    maxX: float
    minZ: float
    maxZ: float

class World:
    def __init__(self):
        self.metadata = WorldMetadata(
            schemaVersion=CONFIG.SCHEMA_VERSION,
            mapVersion=CONFIG.MAP_VERSION,
            generatorVersion=CONFIG.GENERATOR_VERSION,
            seed=CONFIG.SEED,
            width=CONFIG.WORLD_WIDTH,
            height=CONFIG.WORLD_HEIGHT
        )
        self.bounds = WorldBounds(
            minX=CONFIG.WORLD_ORIGIN_X,
            maxX=CONFIG.WORLD_ORIGIN_X + CONFIG.WORLD_WIDTH,
            minZ=CONFIG.WORLD_ORIGIN_Z,
            maxZ=CONFIG.WORLD_ORIGIN_Z + CONFIG.WORLD_HEIGHT
        )
        self.regions = []
        
    def add_region(self, region: Any):
        self.regions.append(region)
        
    def to_dict(self) -> Dict[str, Any]:
        return {
            "metadata": self.metadata.__dict__,
            "bounds": self.bounds.__dict__
        }