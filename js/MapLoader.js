// js/MapLoader.js
import * as THREE from "three";
import { RuntimeRoadGraph } from "./RuntimeRoadGraph.js";

const DATA_PATH = "generated/maps/";

export class MapLoader {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = "map";
        this.scene.add(this.group);
        
        this.roadGraph = null;
        this.stationsData = [];
        this.loadedChunks = new Map();
        this._chunkUpdateTimer = 0;
        this.chunkSize = 256;
        this.renderDistance = 3; 
        
        this._mats = {
            asphalt: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 }),
            line: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
            grass: new THREE.MeshStandardMaterial({ color: 0x3b8e3b, roughness: 1 }),
            glass: new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6, metalness: 0.5, roughness: 0.2 }),
            roof: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 }),
            pillar: new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 }),
            stationWall: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 }),
            door: new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 0.5 }),
            trunk: new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 1 }),
            leaves: new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 1 })
        };
        this._geos = {
            trunk: new THREE.CylinderGeometry(0.5, 0.5, 4, 6),
            leaves: new THREE.SphereGeometry(2.5, 8, 8)
        };
    }
    
    async loadInitialData() {
        try {
            const [worldRes, roadsRes, stationsRes, routesRes] = await Promise.all([
                fetch(`${DATA_PATH}world.json`).then(r => r.json()),
                fetch(`${DATA_PATH}roads.json`).then(r => r.json()),
                fetch(`${DATA_PATH}stations.json`).then(r => r.json()),
                fetch(`${DATA_PATH}routes.json`).then(r => r.json())
            ]);
            
            this.roadGraph = new RuntimeRoadGraph({ roads: roadsRes, routes: routesRes, stations: stationsRes });
            this.stationsData = stationsRes;
            this.terrainBaseHeight = worldRes.seaLevel || 10.0;
            
            this._buildAllRoads();
            this._buildStations();
            
            return true;
        } catch (error) {
            console.error("Map Load Error:", error);
            return false;
        }
    }
    
    _buildAllRoads() {
        if (!this.roadGraph || !this.roadGraph.segments) return;
        
        for (const seg of this.roadGraph.segments) {
            const p1 = this.roadGraph.getNode(seg.from);
            const p2 = this.roadGraph.getNode(seg.to);
            if (!p1 || !p2) continue;
            
            const width = seg.width || 12.0;
            const dir = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
            const length = dir.length();
            if (length < 0.1) continue;
            dir.normalize();
            
            const yAvg = (p1.y + p2.y) / 2;
            const roadGeo = new THREE.BoxGeometry(width, 0.2, length);
            const roadMesh = new THREE.Mesh(roadGeo, this._mats.asphalt);
            roadMesh.position.set(p1.x + dir.x * length / 2, yAvg + 0.1, p1.z + dir.z * length / 2);
            roadMesh.lookAt(new THREE.Vector3(p2.x, yAvg + 0.1, p2.z));
            this.group.add(roadMesh);
            
            if (width >= 15.0) {
                const lineGeo = new THREE.BoxGeometry(0.5, 0.21, length);
                const lineMesh = new THREE.Mesh(lineGeo, this._mats.line);
                lineMesh.position.copy(roadMesh.position);
                lineMesh.lookAt(new THREE.Vector3(p2.x, yAvg + 0.1, p2.z));
                this.group.add(lineMesh);
            }
        }
    }
    
    _buildStations() {
        for (const s of this.stationsData) {
            const stGroup = new THREE.Group();
            stGroup.name = s.name;
            
            const yard = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), this._mats.asphalt);
            yard.rotation.x = -Math.PI / 2;
            yard.position.set(s.x, s.y + 0.05, s.z);
            stGroup.add(yard);
            
            const bldW = s.w * 0.4;
            const bldH = 10;
            const bldD = 20;
            const bldX = s.x - s.w / 2 + bldW / 2 + 10;
            const bldZ = s.z - s.d / 2 + bldD / 2 + 10;
            
            const building = new THREE.Mesh(new THREE.BoxGeometry(bldW, bldH, bldD), this._mats.stationWall);
            building.position.set(bldX, s.y + bldH / 2, bldZ);
            stGroup.add(building);
            
            const glassW = bldW * 0.8;
            const glassH = bldH * 0.7;
            const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(glassW, glassH), this._mats.glass);
            glassMesh.position.set(bldX, s.y + glassH / 2 + 1, bldZ + bldD / 2 + 0.1);
            stGroup.add(glassMesh);
            
            const doorGeo = new THREE.PlaneGeometry(4, 5);
            const doorMesh = new THREE.Mesh(doorGeo, this._mats.door);
            doorMesh.position.set(bldX, s.y + 2.5, bldZ + bldD / 2 + 0.2);
            stGroup.add(doorMesh);
            
            const roofGeo = new THREE.BoxGeometry(bldW * 1.1, 0.5, bldD * 1.1);
            const roofMesh = new THREE.Mesh(roofGeo, this._mats.roof);
            roofMesh.position.set(bldX, s.y + bldH, bldZ);
            stGroup.add(roofMesh);
            
            const canopyW = s.w * 0.5;
            const canopyD = 15;
            const canopy = new THREE.Mesh(new THREE.BoxGeometry(canopyW, 1, canopyD), this._mats.roof);
            canopy.position.set(s.x, s.y + 6, s.z);
            stGroup.add(canopy);
            
            for(let i = -2; i <= 2; i++) {
                if (i === 0) continue;
                const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6), this._mats.pillar);
                pillar.position.set(s.x + i * (canopyW/5), s.y + 3, s.z);
                stGroup.add(pillar);
            }
            
            this.group.add(stGroup);
        }
    }
    
    getTerrainHeight(x, z) {
        return this.terrainBaseHeight || 10.0;
    }
    
    async updateChunks(playerX, playerZ) {
        this._chunkUpdateTimer += 1/30;
        if (this._chunkUpdateTimer < 0.2) return;
        this._chunkUpdateTimer = 0;
        
        const cx = Math.floor(playerX / this.chunkSize);
        const cz = Math.floor(playerZ / this.chunkSize);
        
        const needed = new Set();
        for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
            for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++) {
                needed.add(`${cx + dx},${cz + dz}`);
            }
        }
        
        for (const [key, chunk] of this.loadedChunks) {
            if (!needed.has(key)) {
                this.group.remove(chunk.group);
                chunk.group.traverse(c => { if (c.geometry) c.geometry.dispose(); });
                this.loadedChunks.delete(key);
            }
        }
        
        let count = 0;
        for (const key of needed) {
            if (!this.loadedChunks.has(key) && count < 2) {
                const [x, z] = key.split(',').map(Number);
                this.loadChunk(x, z);
                count++;
            }
        }
    }
    
    async loadChunk(cx, cz) {
        const key = `${cx},${cz}`;
        const chunkGroup = new THREE.Group();
        const centerX = cx * this.chunkSize + this.chunkSize / 2;
        const centerZ = cz * this.chunkSize + this.chunkSize / 2;
        
        const groundGeo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 1, 1);
        const groundMesh = new THREE.Mesh(groundGeo, this._mats.grass);
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.position.set(centerX, 0, centerZ);
        chunkGroup.add(groundMesh);
        
        try {
            const res = await fetch(`${DATA_PATH}chunks/${cx}_${cz}.json`);
            if (res.ok) {
                const data = await res.json();
                
                if (data.buildings) {
                    for (const b of data.buildings) {
                        const mat = new THREE.MeshStandardMaterial({ color: b.color || 0xffffff, roughness: 0.8 });
                        const geo = new THREE.BoxGeometry(b.w, b.height, b.d);
                        const mesh = new THREE.Mesh(geo, mat);
                        mesh.position.set(b.x, b.y + b.height/2, b.z);
                        mesh.rotation.y = b.rot || 0;
                        chunkGroup.add(mesh);
                        
                        if (b.roof_type === 'pitched') {
                            const roofGeo = new THREE.ConeGeometry(b.w * 0.8, 3, 4);
                            const roofMat = new THREE.MeshStandardMaterial({ color: b.roof_color || 0x8b4513, roughness: 0.9 });
                            const roofMesh = new THREE.Mesh(roofGeo, roofMat);
                            roofMesh.position.set(b.x, b.y + b.height + 1.5, b.z);
                            roofMesh.rotation.y = (b.rot || 0) + Math.PI / 4;
                            chunkGroup.add(roofMesh);
                        } else {
                            const roofGeo = new THREE.BoxGeometry(b.w * 1.1, 0.5, b.d * 1.1);
                            const roofMat = new THREE.MeshStandardMaterial({ color: b.roof_color || 0x333333, roughness: 0.9 });
                            const roofMesh = new THREE.Mesh(roofGeo, roofMat);
                            roofMesh.position.set(b.x, b.y + b.height, b.z);
                            roofMesh.rotation.y = b.rot || 0;
                            chunkGroup.add(roofMesh);
                        }
                    }
                }
                
                // Render Objects (Trees)
                if (data.objects) {
                    for (const o of data.objects) {
                        if (o.type === 'TREE') {
                            const trunk = new THREE.Mesh(this._geos.trunk, this._mats.trunk);
                            trunk.position.set(o.x, o.y + 2, o.z);
                            const leaves = new THREE.Mesh(this._geos.leaves, this._mats.leaves);
                            leaves.position.set(o.x, o.y + 5, o.z);
                            chunkGroup.add(trunk, leaves);
                        }
                    }
                }
            }
        } catch (e) { /* Ignore 404 */ }
        
        this.group.add(chunkGroup);
        this.loadedChunks.set(key, { group: chunkGroup, x: cx, z: cz });
    }
    
    getSpawnPoint() {
        // Spawn trên QL1A gần Bến xe Nam Tuy Hòa (Z=2000)
        return { x: 0, y: 10.5, z: 2000, heading: 0 };
    }
    getRoadGraph() { return this.roadGraph; }
    getMinimapData() { return this.roadGraph ? this.roadGraph.getMinimapData() : { segments: [], route: [], pois: [] }; }
    getParkingSlots() { return []; }
}