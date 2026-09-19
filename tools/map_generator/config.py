# tools/map_generator/config.py
from dataclasses import dataclass, field
from typing import Dict, Any
import random

@dataclass
class GeneratorConfig:
    # World Bounds (100km x 100km)
    WORLD_WIDTH: float = 100000.0
    WORLD_HEIGHT: float = 100000.0
    WORLD_ORIGIN_X: float = 0.0
    WORLD_ORIGIN_Z: float = 0.0
    
    # Chunking
    CHUNK_SIZE: float = 256.0
    
    # Deterministic Seed
    SEED: int = 20260817
    
    # Generator Metadata
    SCHEMA_VERSION: str = "1.0"
    MAP_VERSION: str = "1.0"
    GENERATOR_VERSION: str = "1.0"
    
    # Export Paths
    EXPORT_PATH: str = "generated/maps"
    
    # Sub-system configurations (placeholders for future phases)
    ROAD_DEFAULTS: Dict[str, Any] = field(default_factory=lambda: {
        'default_width': 10.0,
        'default_lanes': 2
    })
    
    LANE_DEFAULTS: Dict[str, Any] = field(default_factory=lambda: {
        'lane_width': 3.5
    })
    
    TERRAIN_DEFAULTS: Dict[str, Any] = field(default_factory=lambda: {
        'sea_level': 10.0,
        'max_mountain_height': 150.0
    })
    
    SETTLEMENT_DEFAULTS: Dict[str, Any] = field(default_factory=lambda: {
        'urban_density': 0.8,
        'rural_density': 0.1
    })
    
    STATION_DEFAULTS: Dict[str, Any] = field(default_factory=lambda: {
        'major_terminal_buses': 50,
        'standard_station_buses': 15
    })
    
    PERFORMANCE_LIMITS: Dict[str, Any] = field(default_factory=lambda: {
        'max_chunks_loaded': 25,
        'traffic_update_interval_near': 1/30.0
    })

    def get_rng(self) -> random.Random:
        """Return a deterministic Random instance."""
        return random.Random(self.SEED)

# Singleton instance
CONFIG = GeneratorConfig()