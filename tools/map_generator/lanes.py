# tools/map_generator/lanes.py
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from .roads import RoadNetwork, Segment, RoadType, ROAD_PROFILES

@dataclass
class Lane:
    id: str
    segment_id: str
    direction: int  # 1 for from->to, -1 for to->from
    index: int      # 0 is rightmost lane
    width: float
    successors: List[str] = field(default_factory=list)
    predecessors: List[str] = field(default_factory=list)

class LaneManager:
    def __init__(self, network: RoadNetwork):
        self.network = network
        self.lanes: Dict[str, Lane] = {}
        self._lane_counter = 0
    
    def _generate_lane_id(self) -> str:
        self._lane_counter += 1
        return f"lane_{self._lane_counter:04d}"
    
    def generate_lanes(self):
        """Generate lanes for all segments based on road profiles."""
        for seg_id, seg in self.network.segments.items():
            profile = ROAD_PROFILES.get(seg.road_type, ROAD_PROFILES[RoadType.LOCAL])
            
            # Direction 1 (from -> to)
            for i in range(profile.lanes_per_dir):
                lane_id = self._generate_lane_id()
                self.lanes[lane_id] = Lane(
                    id=lane_id, segment_id=seg_id, direction=1, 
                    index=i, width=profile.lane_width
                )
                seg.lanes.append(lane_id)
                
            # Direction -1 (to -> from) if two_way
            if seg.two_way:
                for i in range(profile.lanes_per_dir):
                    lane_id = self._generate_lane_id()
                    self.lanes[lane_id] = Lane(
                        id=lane_id, segment_id=seg_id, direction=-1, 
                        index=i, width=profile.lane_width
                    )
                    seg.lanes.append(lane_id)
    
    def connect_lanes_at_junctions(self):
        """Connect incoming lanes to outgoing lanes at junction nodes."""
        for node_id, node in self.network.nodes.items():
            # Find all segments connected to this node
            connected_segments = self.network.get_segments_at_node(node_id)
            if len(connected_segments) < 2:
                continue
            
            # Separate into incoming and outgoing lanes
            incoming = []  # Lanes that END at this node
            outgoing = []  # Lanes that START at this node
            
            for seg in connected_segments:
                if seg.from_node == node_id:
                    # This segment starts here, so direction -1 is incoming, 1 is outgoing
                    for lane_id in seg.lanes:
                        lane = self.lanes[lane_id]
                        if lane.direction == -1: incoming.append(lane)
                        else: outgoing.append(lane)
                elif seg.to_node == node_id:
                    # This segment ends here, so direction 1 is incoming, -1 is outgoing
                    for lane_id in seg.lanes:
                        lane = self.lanes[lane_id]
                        if lane.direction == 1: incoming.append(lane)
                        else: outgoing.append(lane)
            
            # Simple connection logic: connect each incoming lane to all valid outgoing lanes
            # (Advanced logic can use angles to find the 'straight' lane)
            for in_lane in incoming:
                for out_lane in outgoing:
                    # Prevent U-turns on the same segment unless it's a dead-end
                    if in_lane.segment_id == out_lane.segment_id and len(connected_segments) > 1:
                        continue
                    in_lane.successors.append(out_lane.id)
                    out_lane.predecessors.append(in_lane.id)
    
    def to_dict(self) -> List[Dict]:
        return [
            {
                "id": l.id, "segment": l.segment_id, "direction": l.direction, 
                "index": l.index, "width": l.width,
                "successors": l.successors, "predecessors": l.predecessors
            } for l in self.lanes.values()
        ]