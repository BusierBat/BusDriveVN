# tools/map_generator/validation.py
from typing import List, Dict, Any
from .roads import RoadNetwork
from .lanes import LaneManager
from .junctions import JunctionManager
from .stations import StationManager
from .routes import RouteManager

class ValidationResult:
    def __init__(self):
        self.errors: List[Dict] = []
        self.warnings: List[Dict] = []
        
    def add_error(self, code: str, msg: str, obj_id: str = None):
        self.errors.append({"code": code, "msg": msg, "obj": obj_id})
        
    def add_warning(self, code: str, msg: str, obj_id: str = None):
        self.warnings.append({"code": code, "msg": msg, "obj": obj_id})
        
    def is_valid(self) -> bool:
        return len(self.errors) == 0

class WorldValidator:
    def __init__(self, network: RoadNetwork, lane_mgr: LaneManager, jct_mgr: JunctionManager, 
                 station_mgr: StationManager, route_mgr: RouteManager):
        self.network = network
        self.lane_mgr = lane_mgr
        self.jct_mgr = jct_mgr
        self.station_mgr = station_mgr
        self.route_mgr = route_mgr
        self.result = ValidationResult()
        
    def validate_all(self) -> ValidationResult:
        self.validate_roads()
        self.validate_lanes()
        self.validate_stations()
        self.validate_routes()
        return self.result
        
    def validate_roads(self):
        # Check for orphan nodes (no connections)
        for node_id, node in self.network.nodes.items():
            if len(node.connections) == 0:
                self.result.add_warning("ORPHAN_NODE", f"Node {node_id} has no connections.", node_id)
                
        # Check for broken segment references
        for seg_id, seg in self.network.segments.items():
            if seg.from_node not in self.network.nodes:
                self.result.add_error("BROKEN_SEGMENT_REF", f"Segment {seg_id} references missing from_node {seg.from_node}.", seg_id)
            if seg.to_node not in self.network.nodes:
                self.result.add_error("BROKEN_SEGMENT_REF", f"Segment {seg_id} references missing to_node {seg.to_node}.", seg_id)
                
    def validate_lanes(self):
        for lane_id, lane in self.lane_mgr.lanes.items():
            if lane.segment_id not in self.network.segments:
                self.result.add_error("BROKEN_LANE_REF", f"Lane {lane_id} references missing segment {lane.segment_id}.", lane_id)
                
            # Check successors
            for succ_id in lane.successors:
                if succ_id not in self.lane_mgr.lanes:
                    self.result.add_error("BROKEN_LANE_CONN", f"Lane {lane_id} successor {succ_id} does not exist.", lane_id)
                    
    def validate_stations(self):
        for station in self.station_mgr.stations:
            if station.entrance_node and station.entrance_node not in self.network.nodes:
                self.result.add_error("BROKEN_STATION_ACCESS", f"Station {station.id} entrance node {station.entrance_node} missing.", station.id)
            if station.exit_node and station.exit_node not in self.network.nodes:
                self.result.add_error("BROKEN_STATION_ACCESS", f"Station {station.id} exit node {station.exit_node} missing.", station.id)
                
    def validate_routes(self):
        for route in self.route_mgr.routes:
            if not route.node_path:
                self.result.add_warning("EMPTY_ROUTE", f"Route {route.id} has no node path.", route.id)
                continue
                
            # Check path continuity
            for i in range(len(route.node_path) - 1):
                n1 = route.node_path[i]
                n2 = route.node_path[i+1]
                
                # Check if nodes exist
                if n1 not in self.network.nodes:
                    self.result.add_error("BROKEN_ROUTE", f"Route {route.id} references missing node {n1}.", route.id)
                    break
                if n2 not in self.network.nodes:
                    self.result.add_error("BROKEN_ROUTE", f"Route {route.id} references missing node {n2}.", route.id)
                    break
                    
                # Check if there's a segment connecting them
                connected = False
                for seg_id in self.network.nodes[n1].connections:
                    seg = self.network.segments.get(seg_id)
                    if seg and (seg.from_node == n2 or seg.to_node == n2):
                        connected = True
                        break
                        
                if not connected:
                    self.result.add_error("DISCONNECTED_ROUTE", f"Route {route.id} has no segment between {n1} and {n2}.", route.id)