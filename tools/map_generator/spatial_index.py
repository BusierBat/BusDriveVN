# tools/map_generator/spatial_index.py
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple
import math
from .config import CONFIG
from .roads import RoadNetwork, Node, Segment

@dataclass
class GridCell:
    segments: List[str] = field(default_factory=list)
    nodes: List[str] = field(default_factory=list)

class SpatialIndexManager:
    def __init__(self, network: RoadNetwork):
        self.network = network
        self.grid: Dict[Tuple[int, int], GridCell] = {}
        self.cell_size = 200.0 # Cell size lớn hơn chunk để bao phủ nhiều đường
        
    def build_index(self):
        """Đánh index các node và segment vào grid."""
        # 1. Index Nodes
        for node_id, node in self.network.nodes.items():
            cx, cz = self._get_cell_coord(node.x, node.z)
            if (cx, cz) not in self.grid:
                self.grid[(cx, cz)] = GridCell()
            self.grid[(cx, cz)].nodes.append(node_id)
            
        # 2. Index Segments (rải điểm dọc theo segment để cell nào chứa segment sẽ biết)
        for seg_id, seg in self.network.segments.items():
            n1 = self.network.get_node(seg.from_node)
            n2 = self.network.get_node(seg.to_node)
            if not n1 or not n2: continue
            
            dx = n2.x - n1.x
            dz = n2.z - n1.z
            length = math.hypot(dx, dz)
            steps = max(1, int(length / (self.cell_size / 2)))
            
            for i in range(steps + 1):
                t = i / steps
                px = n1.x + t * dx
                pz = n1.z + t * dz
                cx, cz = self._get_cell_coord(px, pz)
                if (cx, cz) not in self.grid:
                    self.grid[(cx, cz)] = GridCell()
                if seg_id not in self.grid[(cx, cz)].segments:
                    self.grid[(cx, cz)].segments.append(seg_id)
                    
    def _get_cell_coord(self, x: float, z: float) -> Tuple[int, int]:
        return (int(x // self.cell_size), int(z // self.cell_size))
        
    def to_dict(self) -> Dict[str, Any]:
        """Xuất index ra JSON. Three.js sẽ dùng để query nhanh."""
        grid_dict = {}
        for (cx, cz), cell in self.grid.items():
            key = f"{cx},{cz}"
            grid_dict[key] = {
                "segments": cell.segments,
                "nodes": cell.nodes
            }
        return {
            "cellSize": self.cell_size,
            "grid": grid_dict
        }