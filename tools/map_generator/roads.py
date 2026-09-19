# tools/map_generator/roads.py
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Optional
import math

class RoadType(Enum):
    LOCAL = "LOCAL"
    RESIDENTIAL = "RESIDENTIAL"
    URBAN_ARTERIAL = "URBAN_ARTERIAL"
    NATIONAL = "NATIONAL"
    QL1A = "QL1A"
    BYPASS = "BYPASS"
    MOUNTAIN = "MOUNTAIN"
    HIGHWAY = "HIGHWAY"
    EXPRESSWAY = "EXPRESSWAY"
    RAMP = "RAMP"
    BUS_STATION_ROAD = "BUS_STATION_ROAD"

@dataclass
class RoadProfile:
    lanes_per_dir: int
    lane_width: float = 3.5
    median_width: float = 0.0
    shoulder_width: float = 0.0
    speed_limit: float = 60.0
    access_controlled: bool = False

ROAD_PROFILES = {
    RoadType.LOCAL: RoadProfile(lanes_per_dir=1, lane_width=3.0, speed_limit=40),
    RoadType.URBAN_ARTERIAL: RoadProfile(lanes_per_dir=2, lane_width=3.5, median_width=1.0, speed_limit=60),
    RoadType.QL1A: RoadProfile(lanes_per_dir=2, lane_width=3.5, median_width=2.0, shoulder_width=1.5, speed_limit=80),
    RoadType.EXPRESSWAY: RoadProfile(lanes_per_dir=2, lane_width=3.75, median_width=3.0, shoulder_width=3.0, speed_limit=120, access_controlled=True),
    RoadType.MOUNTAIN: RoadProfile(lanes_per_dir=1, lane_width=3.5, speed_limit=40),
    RoadType.RAMP: RoadProfile(lanes_per_dir=1, lane_width=3.5, speed_limit=40),
    RoadType.BUS_STATION_ROAD: RoadProfile(lanes_per_dir=1, lane_width=3.5, speed_limit=20)
}

@dataclass
class Node:
    id: str
    x: float
    y: float
    z: float
    type: str = "junction"
    region: str = "default"
    connections: List[str] = field(default_factory=list)

@dataclass
class Segment:
    id: str
    from_node: str
    to_node: str
    road_type: RoadType
    two_way: bool = True
    length: float = 0.0
    grade: float = 0.0
    lanes: List[str] = field(default_factory=list)

class RoadNetwork:
    def __init__(self):
        self.nodes: Dict[str, Node] = {}
        self.segments: Dict[str, Segment] = {}
    
    def add_node(self, node_id: str, x: float, y: float, z: float, node_type: str = "junction", region: str = "default"):
        if node_id not in self.nodes:
            self.nodes[node_id] = Node(id=node_id, x=x, y=y, z=z, type=node_type, region=region)
    
    def add_segment(self, seg_id: str, from_id: str, to_id: str, road_type: RoadType, two_way: bool = True):
        if seg_id not in self.segments:
            from_node = self.nodes.get(from_id)
            to_node = self.nodes.get(to_id)
            if not from_node or not to_node:
                raise ValueError(f"Node {from_id} or {to_id} does not exist.")
            
            dx = to_node.x - from_node.x
            dy = to_node.y - from_node.y
            dz = to_node.z - from_node.z
            length = math.sqrt(dx*dx + dy*dy + dz*dz)
            grade = (dy / length) if length > 0 else 0.0
            
            seg = Segment(
                id=seg_id, from_node=from_id, to_node=to_id, 
                road_type=road_type, two_way=two_way, length=length, grade=grade
            )
            self.segments[seg_id] = seg
            
            from_node.connections.append(seg_id)
            if two_way:
                to_node.connections.append(seg_id)
    
    def get_node(self, node_id: str) -> Optional[Node]:
        return self.nodes.get(node_id)
    
    def get_segment(self, seg_id: str) -> Optional[Segment]:
        return self.segments.get(seg_id)
    
    def get_segments_at_node(self, node_id: str) -> List[Segment]:
        node = self.nodes.get(node_id)
        if not node: return []
        return [self.segments[sid] for sid in node.connections if sid in self.segments]
    
    def to_dict(self) -> Dict:
        return {
            "nodes": [
                {"id": n.id, "x": n.x, "y": n.y, "z": n.z, "type": n.type, "region": n.region, "connections": n.connections}
                for n in self.nodes.values()
            ],
            "segments": [
                {"id": s.id, "from": s.from_node, "to": s.to_node, "roadType": s.road_type.value, "twoWay": s.two_way, "length": s.length, "lanes": s.lanes}
                for s in self.segments.values()
            ]
        }