# tools/map_generator/export.py
import json
from pathlib import Path
from typing import Any
from .config import CONFIG
from .world import World
from .roads import RoadNetwork
from .lanes import LaneManager
from .junctions import JunctionManager
from .terrain import TerrainManager
from .settlements import SettlementManager
from .buildings import BuildingManager
from .stations import StationManager
from .routes import RouteManager
from .landmarks import LandmarkManager
from .objects import ObjectManager
from .chunks import ChunkManager
from .spatial_index import SpatialIndexManager

class WorldExporter:
    def __init__(self, output_path: str):
        self.output_dir = Path(output_path)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        (self.output_dir / "chunks").mkdir(exist_ok=True)
        
    def _write_json(self, filename: str, data: Any):
        file_path = self.output_dir / filename
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  [+] Exported: {filename}")
        
    def export_all(self, world: World, road_network: RoadNetwork, lane_mgr: LaneManager, 
                   jct_mgr: JunctionManager, terrain_mgr: TerrainManager, 
                   settlement_mgr: SettlementManager, building_mgr: BuildingManager, 
                   station_mgr: StationManager, route_mgr: RouteManager, 
                   landmark_mgr: LandmarkManager, object_mgr: ObjectManager,
                   chunk_mgr: ChunkManager, spatial_mgr: SpatialIndexManager):
                   
        print("=== Exporting World Dataset ===")
        
        self._write_json("world.json", world.to_dict())
        self._write_json("roads.json", road_network.to_dict())
        self._write_json("lanes.json", lane_mgr.to_dict())
        self._write_json("junctions.json", jct_mgr.to_dict())
        self._write_json("terrain.json", terrain_mgr.to_dict())
        self._write_json("settlements.json", settlement_mgr.to_dict())
        self._write_json("buildings.json", building_mgr.to_dict())
        self._write_json("stations.json", station_mgr.to_dict())
        self._write_json("routes.json", route_mgr.to_dict())
        self._write_json("landmarks.json", landmark_mgr.to_dict())
        self._write_json("objects.json", object_mgr.to_dict())
        self._write_json("spatial_index.json", spatial_mgr.to_dict())
        
        # Export Chunks individually
        print("  [+] Exporting chunks...")
        for (cx, cz), chunk in chunk_mgr.chunks.items():
            self._write_json(f"chunks/{cx}_{cz}.json", chunk.__dict__)
            
        print("=== Export Complete ===")