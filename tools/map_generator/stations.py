# tools/map_generator/stations.py
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional
import math
from .config import CONFIG
from .terrain import TerrainManager

class StationType(Enum):
    BUS_STATION = "BUS_STATION"
    MAJOR_BUS_TERMINAL = "MAJOR_BUS_TERMINAL"
    REST_AREA = "REST_AREA"
    FUEL_STATION = "FUEL_STATION"
    TOLL_STATION = "TOLL_STATION"
    SERVICE_AREA = "SERVICE_AREA"

@dataclass
class BusBay:
    id: str
    x: float
    y: float
    z: float
    heading: float # Radians

@dataclass
class Station:
    id: str
    type: StationType
    name: str
    x: float
    y: float
    z: float
    width: float
    depth: float
    entrance_node: str
    exit_node: str
    bus_bays: List[BusBay] = field(default_factory=list)

class StationManager:
    def __init__(self, terrain: TerrainManager):
        self.terrain = terrain
        self.stations: List[Station] = []
        self.rng = CONFIG.get_rng()
        
    def create_station(self, id: str, type: StationType, name: str, 
                      x: float, z: float, width: float, depth: float, 
                      entrance_node: str, exit_node: str, num_buses: int = 0) -> Station:
        
        y = self.terrain.get_height(x, z)
        
        station = Station(
            id=id, type=type, name=name,
            x=x, y=y, z=z, width=width, depth=depth,
            entrance_node=entrance_node, exit_node=exit_node
        )
        
        if num_buses > 0:
            self._generate_bus_bays(station, num_buses)
            
        self.stations.append(station)
        return station
        
    def _generate_bus_bays(self, station: Station, count: int):
        """Sinh các ô đỗ xe nội bộ (bus bays) với tọa độ hợp lệ."""
        # Chiến lược xếp xe: Xếp thành hàng dọc song song với trục Z của bến
        # Giả sử bến có tâm ở (station.x, station.z)
        # Xe đỗ cách nhau 8 units, bắt đầu từ lề trái của bến
        
        start_x = station.x - (count * 4) + 4
        bay_z = station.z + (station.depth / 2) - 10.0 # Đỗ gần mép sau của bến
        
        for i in range(count):
            bay_x = start_x + i * 8.0
            bay_y = self.terrain.get_height(bay_x, bay_z)
            
            bay = BusBay(
                id=f"{station.id}_bay_{i+1}",
                x=bay_x,
                y=bay_y,
                z=bay_z,
                heading=0.0 # Hướng thẳng về phía Bắc (trục +Z)
            )
            station.bus_bays.append(bay)
            
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": s.id, "type": s.type.value, "name": s.name,
                "x": s.x, "y": s.y, "z": s.z,
                "w": s.width, "d": s.depth,
                "entrance": s.entrance_node, "exit": s.exit_node,
                "busBays": [
                    {"id": b.id, "x": b.x, "y": b.y, "z": b.z, "heading": b.heading}
                    for b in s.bus_bays
                ]
            } for s in self.stations
        ]