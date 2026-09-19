import os
from pathlib import Path

def cleanup():
    root = Path(__file__).parent.resolve()
    print("=== Cleaning up old map system ===")
    
    files_to_delete = [
        "js/map/map.js",
        "js/map/chunkGenerator.js",
        "js/map/roadGenerator.js",
        "js/map/stationGenerator.js",
        "js/map/buildingGenerator.js",
        "js/map/landmarkGenerator.js",
        "js/map/laneGenerator.js",
        "js/map/terrainGenerator.js",
        "js/map/vegetationGenerator.js",
        "js/map/data/roadNetworkData.js",
        "js/map/data/routeData.js",
        "js/map/data/roadData.js",
        "js/map/data/roadTypes.js",
        "js/map/data/landmarkData.js"
    ]
    
    for f in files_to_delete:
        p = root / f
        if p.exists():
            p.unlink()
            print(f"  [+] Deleted: {f}")
        else:
            print(f"  [i] Not found: {f}")
            
    # Xóa thư mục nếu rỗng
    data_dir = root / "js/map/data"
    if data_dir.exists() and not any(data_dir.iterdir()):
        data_dir.rmdir()
        print("  [+] Deleted empty directory: js/map/data/")
        
    map_dir = root / "js/map"
    if map_dir.exists() and not any(map_dir.iterdir()):
        map_dir.rmdir()
        print("  [+] Deleted empty directory: js/map/")
        
    print("Cleanup complete. Old procedural map system removed.")

if __name__ == "__main__":
    cleanup()