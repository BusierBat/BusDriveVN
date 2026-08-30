// js/passenger.js - PASSENGER SYSTEM v2.0
// Features: Beacon effects (không dùng PointLight), spawn tại bến xe + dọc tuyến
// Pickup logic, economy system, minimap integration hooks

import * as THREE from "three";
import { getNode, getRouteNodes } from "./map/data/roadNetworkData.js";

// ============================================================
// CONFIGURATION
// ============================================================

const PASSENGER_CONFIG = {
    // === CAPACITY ===
    MAX_PASSENGERS: 24,           // Xe có 24 giường
    MAX_WAITING_DISPLAY: 50,      // Max waiting passengers hiển thị
    
    // === PICKUP ===
    PICKUP_RANGE: 12,             // Khoảng cách để đón khách (meters)
    PICKUP_DOOR_REQUIRED: true,   // Phải mở cửa để đón
    
    // === ECONOMY ===
    PRICE_PER_PASSENGER: 420000,  // 420,000 VND per passenger
    
    // === SPAWN ===
    STATION_SPAWN_COUNT: [8, 15], // [min, max] khách tại bến
    ROUTE_SPAWN_CHANCE: 0.4,      // 40% chance mỗi điểm dọc tuyến
    ROUTE_SPAWN_COUNT: [1, 3],    // [min, max] khách mỗi điểm dọc tuyến
    
    // === BEACON VISUALS ===
    BEACON_HEIGHT: 3.0,           // Chiều cao cột sáng
    BEACON_RADIUS: 0.12,          // Bán kính cột sáng (mảnh)
    BEACON_OPACITY: 0.35,         // Độ trong suốt
    BEACON_COLOR: 0x00ccff,       // Màu xanh dương
    
    RING_RADIUS_INNER: 0.4,       // Vòng sáng trong
    RING_RADIUS_OUTER: 0.7,       // Vòng sáng ngoài
    RING_OPACITY: 0.5,            // Độ trong suốt vòng
    
    // === ANIMATION ===
    PULSE_SPEED: 2.0,             // Tốc độ nhấp nháy
    PULSE_MIN: 0.2,               // Min opacity
    PULSE_MAX: 0.5,               // Max opacity
    
    // === NPC MODEL ===
    NPC_HEIGHT: 1.65,             // Chiều cao người Việt trung bình
    NPC_HEIGHT_VARIATION: 0.15,   // ±15cm variation
};

// ============================================================
// SHARED RESOURCES (TỐI ƯU - CHỈ TẠO 1 LẦN)
// ============================================================

const _resources = {};

function getResources() {
    if (_resources.initialized) return _resources;
    
    // === BEACON MATERIALS ===
    // Cột sáng - dùng MeshBasicMaterial với AdditiveBlending (nhẹ hơn PointLight)
    _resources.beaconMaterial = new THREE.MeshBasicMaterial({
        color: PASSENGER_CONFIG.BEACON_COLOR,
        transparent: true,
        opacity: PASSENGER_CONFIG.BEACON_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    
    // Vòng sáng dưới chân
    _resources.ringMaterial = new THREE.MeshBasicMaterial({
        color: PASSENGER_CONFIG.BEACON_COLOR,
        transparent: true,
        opacity: PASSENGER_CONFIG.RING_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    
    // === GEOMETRIES ===
    // Cột sáng (CylinderGeometry - open ended để nhẹ)
    _resources.beaconGeometry = new THREE.CylinderGeometry(
        PASSENGER_CONFIG.BEACON_RADIUS,
        PASSENGER_CONFIG.BEACON_RADIUS,
        PASSENGER_CONFIG.BEACON_HEIGHT,
        8,     // radialSegments - thấp để tối ưu
        1,     // heightSegments
        true   // openEnded - không cần cap
    );
    
    // Vòng sáng (RingGeometry)
    _resources.ringGeometry = new THREE.RingGeometry(
        PASSENGER_CONFIG.RING_RADIUS_INNER,
        PASSENGER_CONFIG.RING_RADIUS_OUTER,
        16,    // thetaSegments
        1      // phiSegments
    );
    
    // === NPC BODY GEOMETRIES ===
    _resources.bodyGeometry = new THREE.CapsuleGeometry(0.16, 0.55, 4, 8);
    _resources.headGeometry = new THREE.SphereGeometry(0.11, 8, 8);
    _resources.legGeometry = new THREE.CylinderGeometry(0.05, 0.06, 0.6, 6);
    _resources.luggageGeometry = new THREE.BoxGeometry(0.25, 0.35, 0.15);
    
    // === NPC MATERIALS (cached by color) ===
    _resources.npcMaterialCache = new Map();
    
    _resources.initialized = true;
    return _resources;
}

/**
 * Lấy material cho NPC (cached)
 */
function getNpcMaterial(color, cache) {
    const key = `mat_${color}`;
    if (!cache.has(key)) {
        cache.set(key, new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.8,
            metalness: 0.0
        }));
    }
    return cache.get(key);
}

// ============================================================
// COLORS
// ============================================================

const SKIN_COLORS = [
    0xe8c9a0, 0xd4a574, 0xc4956a, 0xf5d6b8, 0xb8876a
];

const CLOTH_COLORS = [
    0x4a6fa5, 0xd64545, 0x2d7d46, 0x8b6b4a, 
    0x5d7f9c, 0x7c5f8f, 0x9a4444, 0x3a5a3a
];

const LUGGAGE_COLORS = [
    0x8B4513, 0x654321, 0x2F2F2F, 0x4a4a6a
];

function randomColor(colors) {
    return colors[Math.floor(Math.random() * colors.length)];
}

// ============================================================
// CREATE PASSENGER SYSTEM
// ============================================================

export function createPassengerSystem({ scene, map, npc, bus, ui }) {
    if (!scene) {
        console.warn("⚠️ PassengerSystem: scene is undefined");
        return null;
    }
    
    const res = getResources();
    
    // === STATE ===
    const passengerGroup = new THREE.Group();
    passengerGroup.name = "passengers";
    scene.add(passengerGroup);
    
    let waitingPassengers = [];
    let onboardPassengers = [];
    let totalEarned = 0;
    let pickupEffectTimer = 0;
    
    // ============================================================
    // NPC MODEL CREATION (scale đúng 1.65m)
    // ============================================================
    
    function createPassengerModel() {
        const group = new THREE.Group();
        
        // Random height variation
        const heightScale = PASSENGER_CONFIG.NPC_HEIGHT * 
            (1 + (Math.random() - 0.5) * (PASSENGER_CONFIG.NPC_HEIGHT_VARIATION / PASSENGER_CONFIG.NPC_HEIGHT));
        
        // Scale factor từ geometry base (base height = 1.0)
        const scale = heightScale / 1.0;
        
        const skinColor = randomColor(SKIN_COLORS);
        const clothColor = randomColor(CLOTH_COLORS);
        const luggageColor = randomColor(LUGGAGE_COLORS);
        
        // === BODY (thân trên) ===
        const body = new THREE.Mesh(
            res.bodyGeometry,
            getNpcMaterial(clothColor, res.npcMaterialCache)
        );
        body.position.y = 0.85 * scale;
        body.scale.setScalar(scale);
        group.add(body);
        
        // === HEAD ===
        const head = new THREE.Mesh(
            res.headGeometry,
            getNpcMaterial(skinColor, res.npcMaterialCache)
        );
        head.position.y = 1.45 * scale;
        head.scale.setScalar(scale);
        group.add(head);
        
        // === LEGS (chân) ===
        const legMaterial = getNpcMaterial(0x333333, res.npcMaterialCache);
        for (let i = 0; i < 2; i++) {
            const leg = new THREE.Mesh(res.legGeometry, legMaterial);
            leg.position.set(
                i === 0 ? -0.08 * scale : 0.08 * scale,
                0.3 * scale,
                0
            );
            leg.scale.setScalar(scale);
            group.add(leg);
        }
        
        // === LUGGAGE (va li) ===
        const luggage = new THREE.Mesh(
            res.luggageGeometry,
            getNpcMaterial(luggageColor, res.npcMaterialCache)
        );
        luggage.position.set(0.35 * scale, 0.18 * scale, 0);
        luggage.scale.setScalar(scale * 0.9);
        group.add(luggage);
        
        // Random rotation
        group.rotation.y = Math.random() * Math.PI * 2;
        
        return group;
    }
    
    // ============================================================
    // BEACON CREATION (cột sáng + vòng sáng)
    // ============================================================
    
    function createBeacon(x, z) {
        const beaconGroup = new THREE.Group();
        
        // === CỘT SÁNG (Beacon Column) ===
        const beacon = new THREE.Mesh(
            res.beaconGeometry,
            res.beaconMaterial.clone() // Clone để có thể animate opacity riêng
        );
        beacon.position.set(0, PASSENGER_CONFIG.BEACON_HEIGHT / 2, 0);
        beaconGroup.add(beacon);
        
        // === VÒNG SÁNG DƯỚI CHÂN (Ground Ring) ===
        const ring = new THREE.Mesh(
            res.ringGeometry,
            res.ringMaterial.clone()
        );
        ring.rotation.x = -Math.PI / 2; // Nằm phẳng trên đất
        ring.position.set(0, 0.05, 0);
        beaconGroup.add(ring);
        
        // Position beacon group
        beaconGroup.position.set(x, 0, z);
        
        return {
            group: beaconGroup,
            beacon: beacon,
            ring: ring,
            phase: Math.random() * Math.PI * 2 // Random phase để không nhấp nháy đồng bộ
        };
    }
    
    // ============================================================
    // SPAWN LOGIC
    // ============================================================
    
    /**
     * Spawn khách tại bến xe
     */
    function spawnAtStation(stationId, count = null) {
        const stationNode = getNode(stationId);
        if (!stationNode) {
            console.warn(`⚠️ Station not found: ${stationId}`);
            return;
        }
        
        const spawnCount = count || 
            Math.floor(
                PASSENGER_CONFIG.STATION_SPAWN_COUNT[0] + 
                Math.random() * (PASSENGER_CONFIG.STATION_SPAWN_COUNT[1] - PASSENGER_CONFIG.STATION_SPAWN_COUNT[0])
            );
        
        // Khu vực spawn trong bến xe (dựa trên size của station)
        const stationWidth = stationNode.size?.width || 100;
        const stationDepth = stationNode.size?.depth || 60;
        
        for (let i = 0; i < spawnCount; i++) {
            // Vị trí random trong khu vực bến
            const offsetX = (Math.random() - 0.5) * (stationWidth * 0.6);
            const offsetZ = (Math.random() - 0.5) * (stationDepth * 0.5);
            
            const x = stationNode.position.x + offsetX;
            const z = stationNode.position.z + offsetZ;
            
            spawnPassenger(x, z, stationNode.name);
        }
        
        console.log(`👥 Spawned ${spawnCount} passengers at ${stationNode.name}`);
    }
    
    /**
     * Spawn khách dọc tuyến tại các điểm đón
     */
    function spawnAlongRoute() {
        const routeNodes = getRouteNodes();
        if (!routeNodes || routeNodes.length === 0) return;
        
        // Chọn các node phù hợp làm điểm đón (không phải junction/tunnel)
        const pickupPoints = routeNodes.filter(node => 
            node.type === 'highway_node' || 
            node.type === 'rest_stop' ||
            node.type === 'urban_node'
        );
        
        for (const point of pickupPoints) {
            // Random chance để có khách tại điểm này
            if (Math.random() > PASSENGER_CONFIG.ROUTE_SPAWN_CHANCE) continue;
            
            const count = Math.floor(
                PASSENGER_CONFIG.ROUTE_SPAWN_COUNT[0] + 
                Math.random() * (PASSENGER_CONFIG.ROUTE_SPAWN_COUNT[1] - PASSENGER_CONFIG.ROUTE_SPAWN_COUNT[0])
            );
            
            for (let i = 0; i < count; i++) {
                // Spawn gần đường (offset nhỏ)
                const offsetX = (Math.random() - 0.5) * 8;
                const offsetZ = (Math.random() - 0.5) * 8;
                
                const x = point.position.x + offsetX;
                const z = point.position.z + offsetZ;
                
                spawnPassenger(x, z, point.name);
            }
        }
    }
    
    /**
     * Spawn một passenger cụ thể
     */
    function spawnPassenger(x, z, locationName = '') {
        if (waitingPassengers.length >= PASSENGER_CONFIG.MAX_WAITING_DISPLAY) return;
        
        // Tạo NPC model
        const model = createPassengerModel();
        model.position.set(x, 0, z);
        
        // Tạo beacon effects
        const beacon = createBeacon(x, z);
        
        // Add to scene
        passengerGroup.add(model);
        passengerGroup.add(beacon.group);
        
        // Create passenger data
        const passenger = {
            id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            model: model,
            beacon: beacon,
            x: x,
            z: z,
            y: 0,
            picked: false,
            locationName: locationName,
            spawnTime: Date.now(),
            destination: getRandomDestination(),
            // Pickup state
            inRange: false,
            pickupProgress: 0
        };
        
        waitingPassengers.push(passenger);
        
        return passenger;
    }
    
    function getRandomDestination() {
        const destinations = [
            'Sài Gòn', 'Nha Trang', 'Phan Thiết', 'Bình Thuận', 
            'Phan Rang', 'Khánh Hòa', 'Đà Lạt'
        ];
        return destinations[Math.floor(Math.random() * destinations.length)];
    }
    
    // ============================================================
    // UPDATE LOGIC (MỖI FRAME)
    // ============================================================
    
    function updatePassengers(busPos, busHeading = 0) {
        if (!busPos) return;
        
        const now = performance.now() / 1000;
        
        for (let i = waitingPassengers.length - 1; i >= 0; i--) {
            const p = waitingPassengers[i];
            
            if (p.picked) continue;
            
            // === 1. CHECK DISTANCE TO BUS ===
            const dx = p.x - busPos.x;
            const dz = p.z - busPos.z;
            const distSq = dx * dx + dz * dz;
            const rangeSq = PASSENGER_CONFIG.PICKUP_RANGE * PASSENGER_CONFIG.PICKUP_RANGE;
            
            const wasInRange = p.inRange;
            p.inRange = distSq < rangeSq;
            
            // === 2. BEACON ANIMATION ===
            _animateBeacon(p, now, p.inRange);
            
            // === 3. AUTO PICKUP (nếu gần + điều kiện) ===
            if (p.inRange && !wasInRange) {
                // Vừa vào range - show hint
                if (ui?.toast) {
                    ui.toast(`👥 Khách chờ tại ${p.locationName} - Mở cửa [K] để đón`);
                }
            }
            
            // Auto pickup nếu điều kiện đúng
            if (p.inRange && _canPickup()) {
                pickUpPassenger(p);
            }
        }
    }
    
    /**
     * Animate beacon effects (pulse)
     */
    function _animateBeacon(passenger, time, isNear) {
        const beacon = passenger.beacon;
        if (!beacon) return;
        
        // Pulse effect
        const pulseFactor = Math.sin(time * PASSENGER_CONFIG.PULSE_SPEED + beacon.phase);
        const t = (pulseFactor + 1) / 2; // Normalize to 0-1
        
        // Beacon column opacity
        const baseOpacity = PASSENGER_CONFIG.PULSE_MIN + 
            t * (PASSENGER_CONFIG.PULSE_MAX - PASSENGER_CONFIG.PULSE_MIN);
        
        // Nếu gần bus → sáng hơn
        const boostFactor = isNear ? 1.5 : 1.0;
        
        beacon.beacon.material.opacity = Math.min(0.8, baseOpacity * boostFactor);
        beacon.ring.material.opacity = Math.min(0.7, baseOpacity * boostFactor);
        
        // Scale ring nhẹ
        const ringScale = 1 + Math.sin(time * PASSENGER_CONFIG.PULSE_SPEED + beacon.phase) * 0.1;
        beacon.ring.scale.set(ringScale, ringScale, 1);
    }
    
    /**
     * Check có thể pickup không
     */
    function _canPickup() {
        // Check capacity
        if (onboardPassengers.length >= PASSENGER_CONFIG.MAX_PASSENGERS) {
            return false;
        }
        
        // Check door (nếu required)
        if (PASSENGER_CONFIG.PICKUP_DOOR_REQUIRED && bus && !bus.doorOpen) {
            return false;
        }
        
        // Check bus speed (phải chậm/dừng)
        if (Math.abs(vehiclePhysics?.currentSpeedKmh || 0) > 5) {
            return false;
        }
        
        return true;
    }
    
    // ============================================================
    // PICKUP LOGIC
    // ============================================================
    
    function pickUpPassenger(passenger) {
        if (passenger.picked) return;
        if (onboardPassengers.length >= PASSENGER_CONFIG.MAX_PASSENGERS) {
            ui?.toast("⚠️ Xe đã đầy!");
            return;
        }
        
        passenger.picked = true;
        
        // === 1. REMOVE BEACON EFFECTS ===
        if (passenger.beacon) {
            passengerGroup.remove(passenger.beacon.group);
            // Dispose cloned materials
            passenger.beacon.beacon.material.dispose();
            passenger.beacon.ring.material.dispose();
            passenger.beacon = null;
        }
        
        // === 2. REMOVE NPC MODEL (khách lên xe) ===
        passengerGroup.remove(passenger.model);
        
        // === 3. ADD TO ONBOARD ===
        onboardPassengers.push({
            id: passenger.id,
            destination: passenger.destination,
            pickupTime: Date.now(),
            pickupLocation: passenger.locationName
        });
        
        // === 4. ECONOMY (+420,000 VND) ===
        totalEarned += PASSENGER_CONFIG.PRICE_PER_PASSENGER;
        
        // === 5. UI FEEDBACK ===
        if (ui?.toast) {
            ui.toast(`✅ Đón khách! +${(PASSENGER_CONFIG.PRICE_PER_PASSENGER / 1000).toFixed(0)}k VND`);
        }
        
        // === 6. REMOVE FROM WAITING LIST ===
        const idx = waitingPassengers.indexOf(passenger);
        if (idx > -1) {
            waitingPassengers.splice(idx, 1);
        }
        
        console.log(`👥 Passenger picked up. Onboard: ${onboardPassengers.length}/${PASSENGER_CONFIG.MAX_PASSENGERS}`);
    }
    
    // ============================================================
    // DROPOFF LOGIC
    // ============================================================
    
    function dropOffPassengers(locationName) {
        if (onboardPassengers.length === 0) return 0;
        
        // Tìm khách có destination trùng location
        const toDrop = onboardPassengers.filter(p => 
            p.destination === locationName || locationName === 'end'
        );
        
        for (const p of toDrop) {
            const idx = onboardPassengers.indexOf(p);
            if (idx > -1) {
                onboardPassengers.splice(idx, 1);
                
                ui?.toast(`👋 Trả khách tại ${locationName}`);
            }
        }
        
        return toDrop.length;
    }
    
    // ============================================================
    // MINIMAP DATA API
    // ============================================================
    
    /**
     * Lấy data cho minimap render
     * Format: [{x, z, type: 'waiting_passenger'}, ...]
     */
    function getMinimapData() {
        return waitingPassengers
            .filter(p => !p.picked)
            .map(p => ({
                x: p.x,
                z: p.z,
                type: 'waiting_passenger',
                id: p.id
            }));
    }
    
    // ============================================================
    // INITIALIZATION - SPAWN INITIAL PASSENGERS
    // ============================================================
    
    function initialize() {
        // Spawn tại bến xe Phú Yên
        spawnAtStation('phuyen_station');
        
        // Spawn dọc tuyến
        spawnAlongRoute();
        
        console.log(`👥 PassengerSystem initialized with ${waitingPassengers.length} waiting passengers`);
    }
    
    // Run initialization
    initialize();
    
    // ============================================================
    // PUBLIC API
    // ============================================================
    
    return {
        // Update (called mỗi frame)
        updatePassengers: updatePassengers,
        
        // Pickup/Dropoff
        pickUpPassenger: pickUpPassenger,
        dropOffPassengers: dropOffPassengers,
        
        // Getters
        getWaitingCount: () => waitingPassengers.length,
        getOnboardCount: () => onboardPassengers.length,
        getMaxCapacity: () => PASSENGER_CONFIG.MAX_PASSENGERS,
        getTotalEarned: () => totalEarned,
        getWaitingPassengers: () => waitingPassengers.filter(p => !p.picked),
        getOnboardPassengers: () => onboardPassengers,
        
        // Minimap
        getMinimapData: getMinimapData,
        
        // Spawn controls
        spawnAtStation: spawnAtStation,
        spawnAlongRoute: spawnAlongRoute,
        
        // Debug
        getDebugInfo: () => ({
            waiting: waitingPassengers.length,
            onboard: onboardPassengers.length,
            capacity: PASSENGER_CONFIG.MAX_PASSENGERS,
            totalEarned: totalEarned,
            pricePerPassenger: PASSENGER_CONFIG.PRICE_PER_PASSENGER
        }),
        
        // Cleanup
        dispose: () => {
            // Remove all models và beacons
            for (const p of waitingPassengers) {
                if (p.model) passengerGroup.remove(p.model);
                if (p.beacon) passengerGroup.remove(p.beacon.group);
            }
            
            scene.remove(passengerGroup);
            waitingPassengers = [];
            onboardPassengers = [];
            totalEarned = 0;
        }
    };
}

// ============================================================
// DISPOSE SHARED RESOURCES (khi unload module)
// ============================================================

export function disposePassengerResources() {
    if (!_resources.initialized) return;
    
    // Dispose geometries
    _resources.beaconGeometry?.dispose();
    _resources.ringGeometry?.dispose();
    _resources.bodyGeometry?.dispose();
    _resources.headGeometry?.dispose();
    _resources.legGeometry?.dispose();
    _resources.luggageGeometry?.dispose();
    
    // Dispose materials
    _resources.beaconMaterial?.dispose();
    _resources.ringMaterial?.dispose();
    
    // Dispose cached NPC materials
    if (_resources.npcMaterialCache) {
        for (const mat of _resources.npcMaterialCache.values()) {
            mat.dispose();
        }
        _resources.npcMaterialCache.clear();
    }
    
    _resources.initialized = false;
}