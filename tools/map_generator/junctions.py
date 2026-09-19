# tools/map_generator/junctions.py
from dataclasses import dataclass, field
from typing import List, Dict
from .roads import RoadNetwork

@dataclass
class JunctionConnection:
    from_lane: str
    to_lane: str
    type: str = "straight" # Can be 'left', 'right', 'straight'

@dataclass
class Junction:
    id: str
    node_id: str
    connections: List[JunctionConnection] = field(default_factory=list)
    signal: bool = False

class JunctionManager:
    def __init__(self, network: RoadNetwork, lane_manager):
        self.network = network
        self.lane_manager = lane_manager
        self.junctions: Dict[str, Junction] = {}
    
    def create_junctions(self):
        """Create junction objects for nodes with multiple connections."""
        for node_id, node in self.network.nodes.items():
            connected_segments = self.network.get_segments_at_node(node_id)
            if len(connected_segments) >= 2:
                junction_id = f"jct_{node_id}"
                junction = Junction(id=junction_id, node_id=node_id, signal=True)
                
                # Extract connections from lane manager
                for lane_id, lane in self.lane_manager.lanes.items():
                    # If lane ends at this node and has successors
                    seg = self.network.get_segment(lane.segment_id)
                    if not seg: continue
                    
                    if (lane.direction == 1 and seg.to_node == node_id) or \
                       (lane.direction == -1 and seg.from_node == node_id):
                        for succ_id in lane.successors:
                            junction.connections.append(JunctionConnection(
                                from_lane=lane_id, to_lane=succ_id
                            ))
                
                self.junctions[junction_id] = junction
    
    def to_dict(self) -> List[Dict]:
        return [
            {
                "id": j.id, "node": j.node_id, "signal": j.signal,
                "connections": [{"from": c.from_lane, "to": c.to_lane, "type": c.type} for c in j.connections]
            } for j in self.junctions.values()
        ]