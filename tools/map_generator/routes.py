# tools/map_generator/routes.py
from dataclasses import dataclass, field
from typing import List, Dict, Any

@dataclass
class Route:
    id: str
    name: str
    start_node: str
    end_node: str
    node_path: List[str] = field(default_factory=list)
    segment_path: List[str] = field(default_factory=list)

class RouteManager:
    def __init__(self):
        self.routes: List[Route] = []
        
    def create_route(self, id: str, name: str, start_node: str, end_node: str, 
                     node_path: List[str], segment_path: List[str]) -> Route:
        r = Route(id, name, start_node, end_node, node_path, segment_path)
        self.routes.append(r)
        return r
        
    def to_dict(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": r.id, "name": r.name, "start": r.start_node, "end": r.end_node,
                "nodes": r.node_path, "segments": r.segment_path
            } for r in self.routes
        ]