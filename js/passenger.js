// js/passenger.js - FULL 20 PASSENGER SYSTEM & UNIFORM HEIGHT
import * as THREE from "three";
import { getNode, getRouteNodes } from "./map/data/roadNetworkData.js";

export function createPassengerSystem({ scene, map, npc, bus, ui }) {
    const passengerGroup = new THREE.Group();
    passengerGroup.name = "passengers";
    scene.add(passengerGroup);

    const MAX_PASSENGERS = 20;
    const UNIFORM_HEIGHT = 1.65; // Chuẩn chiều cao (m)
    const PICKUP_ZONE_SIZE = 4;
    
    let allPassengers = [];
    let routePassengers = [];
    let nextRouteIndex = 0;

    // Materials (Reuse để tối ưu)
    const matBody = new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.8 });
    const matHead = new THREE.MeshStandardMaterial({ color: 0xe8c9a0, roughness: 0.7 });
    const matZone = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide });

    function createPassengerModel() {
        const group = new THREE.Group();
        // Scale y để khớp với UNIFORM_HEIGHT bất kể geometry gốc
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.8, 4, 8), matBody);
        body.scale.y = UNIFORM_HEIGHT / 1.1; 
        group.add(body);
        
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), matHead);
        head.position.y = UNIFORM_HEIGHT;
        group.add(head);
        
        return group;
    }

    function createPickupZone() {
        const zone = new THREE.Mesh(new THREE.PlaneGeometry(PICKUP_ZONE_SIZE, PICKUP_ZONE_SIZE), matZone.clone());
        zone.rotation.x = -Math.PI / 2;
        zone.position.y = 0.05;
        return zone;
    }

    // 1. SPAWN 10 KHÁCH TẠI BẾN XE
    function spawnStationPassengers() {
        const stationNode = getNode('phuyen_station');
        if (!stationNode) return;
        
        for (let i = 0; i < 10; i++) {
            const model = createPassengerModel();
            const angle = (i / 10) * Math.PI * 2;
            const radius = 5 + Math.random() * 5;
            model.position.set(
                stationNode.position.x + Math.cos(angle) * radius,
                0,
                stationNode.position.z + Math.sin(angle) * radius
            );
            model.lookAt(stationNode.position.x, 0, stationNode.position.z);
            
            const zone = createPickupZone();
            zone.position.copy(model.position);
            
            passengerGroup.add(model);
            passengerGroup.add(zone);
            
            allPassengers.push({
                id: `station_${i}`,
                model: model,
                zone: zone,
                state: 'WAITING',
                type: 'station',
                x: model.position.x,
                z: model.position.z
            });
        }
    }

    // 2. SETUP 10 KHÁCH DỌC ĐƯỜNG
    function setupRoutePassengers() {
        const routeNodes = getRouteNodes().filter(n => 
            n.type === 'rest_stop' || n.type === 'highway_node'
        );
        
        let step = Math.max(1, Math.floor(routeNodes.length / 12));
        for (let i = 0; i < 10; i++) {
            const node = routeNodes[i * step + step];
            if (!node) continue;
            
            routePassengers.push({
                id: `route_${i}`,
                state: 'NOT_SPAWNED',
                type: 'route',
                spawnNode: node,
                x: node.position.x + (Math.random() - 0.5) * 10,
                z: node.position.z + (Math.random() - 0.5) * 10
            });
        }
    }

    // 3. KÍCH HOẠT KHÁCH DỌC ĐƯỜNG KHI XE ĐẾN GẦN
    function checkRouteSpawn() {
        if (nextRouteIndex >= routePassengers.length) return;
        const nextP = routePassengers[nextRouteIndex];
        if (nextP.state === 'NOT_SPAWNED') {
            const dx = nextP.x - bus.group.position.x;
            const dz = nextP.z - bus.group.position.z;
            if (Math.sqrt(dx*dx + dz*dz) < 100) { // Spawn khi xe trong bán kính 100m
                const model = createPassengerModel();
                model.position.set(nextP.x, 0, nextP.z);
                
                const zone = createPickupZone();
                zone.position.copy(model.position);
                
                passengerGroup.add(model);
                passengerGroup.add(zone);
                
                nextP.model = model;
                nextP.zone = zone;
                nextP.state = 'WAITING';
                nextRouteIndex++;
            }
        }
    }

    function update(busPos, busHeading) {
        checkRouteSpawn();
        
        for (const p of allPassengers) {
            if (p.state === 'COMPLETED' || p.state === 'ON_BUS' || p.state === 'NOT_SPAWNED') continue;
            
            const dx = p.x - busPos.x;
            const dz = p.z - busPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist < PICKUP_ZONE_SIZE / 2) {
                p.state = 'IN_PICKUP_ZONE';
                p.zone.material.opacity = 0.6; // Highlight zone
            } else {
                if (p.state === 'IN_PICKUP_ZONE') p.state = 'WAITING';
                p.zone.material.opacity = 0.3;
            }
        }
    }

    function pickUpPassengers() {
        let picked = 0;
        for (const p of allPassengers) {
            if (p.state === 'IN_PICKUP_ZONE') {
                p.state = 'ON_BUS';
                p.zone.visible = false;
                p.model.visible = false;
                picked++;
            }
        }
        if (picked > 0) {
            ui?.toast(`✅ Đã đón ${picked} khách!`);
        } else {
            ui?.toast("❌ Không có khách trong vùng đón!");
        }
        return picked;
    }

    spawnStationPassengers();
    setupRoutePassengers();

    return {
        update,
        pickUpPassengers,
        get onboardPassengers() { return allPassengers.filter(p => p.state === 'ON_BUS'); }
    };
}