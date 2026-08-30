// js/bus.js - RESTORED ORIGINAL PATTERN + NPC SKIN FIX
// Texture Atlas 2048x1024 - UV Mapping như code gốc
import * as THREE from "three";

export const BUS_TEXTURE_URL = "assets/textures/bus/bus_final.png";
export const NPC_SKIN_DIR = "assets/textures/bus/bus_npc/";

// ============================================================
// TEXTURE ATLAS COORDINATES (TỪ CODE GỐC)
// ============================================================

const TW = 2048, TH = 1024, TIRE_M = 1.05;

const PX = {
    sideR: { 
        bodyFront: 72, bodyRear: 1572, roof: 31, bodyBottom: 440, 
        wheelBottom: 476, frontWheel: 394, rearWheel: 1126, 
        wheelD: 123, doorFront: 97, doorRear: 220, doorTop: 154, 
        winFront: 240, winRear: 1450, winLoTop: 190, winLoBot: 251, 
        winHiTop: 77, winHiBot: 143 
    },
    sideL: { bodyRear: 56, bodyFront: 1490, roof: 543, bodyBottom: 952 },
    front: { 
        bodyLeft: 1690, bodyRight: 1986, roof: 543, bodyBottom: 988, 
        winTop: 599, winBot: 788, winLeft: 1700, winRight: 1930, 
        hlTop: 830, hlBot: 900, hlL0: 1655, hlL1: 1700, hlR0: 1935, hlR1: 1980,
        indTop: 800, indBot: 825, indL0: 1652, indL1: 1672, indR0: 1976, indR1: 1996 
    },
    rear: { 
        bodyLeft: 1690, bodyRight: 1986, roof: 31, bodyBottom: 471, 
        winTop: 82, winBot: 154, winLeft: 1705, winRight: 1930,
        tlTop: 266, tlBot: 358, tlL0: 1660, tlL1: 1685, tlR0: 1950, tlR1: 1975,
        riTop: 365, riBot: 395 
    },
    roofBand: { x0: 600, x1: 1000, y0: 300, y1: 340 }
};

// ============================================================
// DIMENSIONS (TÍNH TỪ ATLAS - NHƯ CODE GỐC)
// ============================================================

const S = TIRE_M / PX.sideR.wheelD;
const L = (PX.sideR.bodyRear - PX.sideR.bodyFront) * S;
const W = (PX.front.bodyRight - PX.front.bodyLeft) * S;
const H = (PX.sideR.wheelBottom - PX.sideR.roof) * S;
const BODY_BOTTOM = (PX.sideR.wheelBottom - PX.sideR.bodyBottom) * S;
const FRONT_AXLE_Z = L / 2 - (PX.sideR.frontWheel - PX.sideR.bodyFront) * S;
const REAR_AXLE_Z = L / 2 - (PX.sideR.rearWheel - PX.sideR.bodyFront) * S;
const WHEEL_RADIUS = (PX.sideR.wheelD / 2) * S;
const WHEEL_WIDTH = 0.3;
const WALL_X = W / 2 - 0.05;

export const BUS_DIMENSIONS = { length: L, width: W, height: H };

// ============================================================
// UV MAPPING HELPERS (TỪ CODE GỐC)
// ============================================================

const U = (x) => x / TW, V = (y) => 1 - y / TH;

const UV_REGIONS = {
    right: { u0: U(PX.sideR.bodyFront), u1: U(PX.sideR.bodyRear), v0: V(PX.sideR.bodyBottom), v1: V(PX.sideR.roof) },
    left: { u0: U(PX.sideL.bodyRear), u1: U(PX.sideL.bodyFront), v0: V(PX.sideL.bodyBottom), v1: V(PX.sideL.roof) },
    rear: { u0: U(PX.rear.bodyLeft), u1: U(PX.rear.bodyRight), v0: V(PX.rear.bodyBottom), v1: V(PX.rear.roof) },
    front: { u0: U(PX.front.bodyLeft), u1: U(PX.front.bodyRight), v0: V(PX.front.bodyBottom), v1: V(PX.front.roof) },
    roofBand: { u0: U(PX.roofBand.x0), u1: U(PX.roofBand.x1), v0: V(PX.roofBand.y1), v1: V(PX.roofBand.y0) }
};

function mapRegion(r, t, s) {
    return [r.u0 + t * (r.u1 - r.u0), r.v0 + s * (r.v1 - r.v0)];
}

// ============================================================
// TEXTURE CACHE (TỐI ƯU - LOAD MỘT LẦN)
// ============================================================

const textureCache = new Map();
let npcSkinListLoaded = false;
let npcSkinListPromise = null;
let npcSkinPaths = [];

/**
 * Load texture với cache - tránh load trùng
 */
function loadCachedTexture(url) {
    if (textureCache.has(url)) {
        return textureCache.get(url);
    }
    
    return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(
            url,
            (texture) => {
                texture.flipY = false;
                texture.colorSpace = THREE.SRGBColorSpace;
                textureCache.set(url, texture);
                resolve(texture);
            },
            undefined,
            (error) => {
                console.warn(`⚠️ Texture load failed: ${url}`);
                reject(error);
            }
        );
    });
}

// ============================================================
// CREATE PLAYER BUS (GIỮ NGUYÊN PATTERN GỐC)
// ============================================================

export function createBus({ skinPath = null, ledColor = 0x00aaff } = {}) {
    const group = new THREE.Group();
    group.name = "player_bus";
    
    // === BODY MATERIALS (khởi tạo với màu trắng, sẽ map texture sau) ===
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.1
    });
    
    const glassMat = new THREE.MeshStandardMaterial({
        color: 0x0a1420,
        transparent: true,
        opacity: 0.7,
        roughness: 0.1,
        metalness: 0.4
    });
    
    // === LOAD TEXTURE (ASYNC - KHÔNG BLOCK) ===
    const textureUrl = skinPath || BUS_TEXTURE_URL;
    
    loadCachedTexture(textureUrl).then(texture => {
        bodyMat.map = texture;
        bodyMat.needsUpdate = true;
    }).catch(() => {
        console.warn("⚠️ Using fallback color for player bus");
        bodyMat.color.set(0xe8e8e8);
    });
    
    // ============================================================
    // BUILD BUS BODY - UV MAPPED MESHES (PATTERN GỐC)
    // ============================================================
    
    // === RIGHT SIDE PANEL ===
    const rightGeo = new THREE.PlaneGeometry(L, H - BODY_BOTTOM);
    _setUVs(rightGeo, UV_REGIONS.right);
    const rightSide = new THREE.Mesh(rightGeo, bodyMat);
    rightSide.position.set(WALL_X, BODY_BOTTOM + (H - BODY_BOTTOM) / 2, 0);
    rightSide.rotation.y = Math.PI / 2;
    group.add(rightSide);
    
    // === LEFT SIDE PANEL ===
    const leftGeo = new THREE.PlaneGeometry(L, H - BODY_BOTTOM);
    _setUVs(leftGeo, UV_REGIONS.left);
    const leftSide = new THREE.Mesh(leftGeo, bodyMat);
    leftSide.position.set(-WALL_X, BODY_BOTTOM + (H - BODY_BOTTOM) / 2, 0);
    leftSide.rotation.y = -Math.PI / 2;
    group.add(leftSide);
    
    // === FRONT PANEL ===
    const frontGeo = new THREE.PlaneGeometry(W, H - BODY_BOTTOM);
    _setUVs(frontGeo, UV_REGIONS.front);
    const frontPanel = new THREE.Mesh(frontGeo, bodyMat);
    frontPanel.position.set(0, BODY_BOTTOM + (H - BODY_BOTTOM) / 2, L / 2);
    frontPanel.rotation.y = 0;
    group.add(frontPanel);
    
    // === REAR PANEL ===
    const rearGeo = new THREE.PlaneGeometry(W, H - BODY_BOTTOM);
    _setUVs(rearGeo, UV_REGIONS.rear);
    const rearPanel = new THREE.Mesh(rearGeo, bodyMat);
    rearPanel.position.set(0, BODY_BOTTOM + (H - BODY_BOTTOM) / 2, -L / 2);
    rearPanel.rotation.y = Math.PI;
    group.add(rearPanel);
    
    // === ROOF ===
    const roofGeo = new THREE.PlaneGeometry(W, L);
    _setUVs(roofGeo, UV_REGIONS.roofBand);
    const roof = new THREE.Mesh(roofGeo, bodyMat);
    roof.position.set(0, H, 0);
    roof.rotation.x = -Math.PI / 2;
    group.add(roof);
    
    // === BOTTOM ===
    const bottom = new THREE.Mesh(
        new THREE.PlaneGeometry(W, L),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
    );
    bottom.position.set(0, BODY_BOTTOM, 0);
    bottom.rotation.x = Math.PI / 2;
    group.add(bottom);
    
    // ============================================================
    // WINDOWS (GLASS - KHÔNG MAP TEXTURE)
    // ============================================================
    
    // Windshield
    const windshieldGeo = new THREE.PlaneGeometry(
        (PX.front.winRight - PX.front.winLeft) * S,
        (PX.front.winBot - PX.front.winTop) * S
    );
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, BODY_BOTTOM + (PX.front.winBot - PX.front.roof) * S, L/2 + 0.01);
    group.add(windshield);
    
    // Side windows (Right - lower tier)
    const sideWinRW = (PX.sideR.winRear - PX.sideR.winFront) * S;
    const sideWinRH = (PX.sideR.winLoBot - PX.sideR.winLoTop) * S;
    const sideWinRGeo = new THREE.PlaneGeometry(sideWinRW, sideWinRH);
    const sideWinR = new THREE.Mesh(sideWinRGeo, glassMat);
    sideWinR.position.set(WALL_X + 0.01, BODY_BOTTOM + (PX.sideR.winLoTop - PX.sideR.roof + sideWinRH/2) * S, (PX.sideR.winFront + PX.sideR.winRear) / 2 * S - L/2);
    sideWinR.rotation.y = Math.PI / 2;
    group.add(sideWinR);
    
    // Side windows (Left - mirror)
    const sideWinL = new THREE.Mesh(sideWinRGeo.clone(), glassMat);
    sideWinL.position.set(-WALL_X - 0.01, sideWinR.position.y, sideWinR.position.z);
    sideWinL.rotation.y = -Math.PI / 2;
    group.add(sideWinL);
    
    // ============================================================
    // WHEELS (PATTERN GỐC)
    // ============================================================
    
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 12);
    const wheelMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.9
    });
    const hubMat = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.3,
        metalness: 0.8
    });
    
    const wheels = [];
    const wheelPositions = [
        [WALL_X - 0.05, FRONT_AXLE_Z],
        [-WALL_X + 0.05, FRONT_AXLE_Z],
        [WALL_X - 0.05, REAR_AXLE_Z],
        [-WALL_X + 0.05, REAR_AXLE_Z]
    ];
    
    for (const [x, z] of wheelPositions) {
        const wheel = new THREE.Group();
        
        // Tire
        const tire = new THREE.Mesh(wheelGeo, wheelMat);
        tire.rotation.z = Math.PI / 2;
        wheel.add(tire);
        
        // Hub
        const hub = new THREE.Mesh(
            new THREE.CylinderGeometry(WHEEL_RADIUS * 0.4, WHEEL_RADIUS * 0.4, WHEEL_WIDTH + 0.02, 8),
            hubMat
        );
        hub.rotation.z = Math.PI / 2;
        wheel.add(hub);
        
        wheel.position.set(x, WHEEL_RADIUS, z);
        group.add(wheel);
        wheels.push(wheel);
    }
    
    // ============================================================
    // LIGHTS
    // ============================================================
    
    // Headlights
    const hlMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.0
    });
    
    const hlW = (PX.front.hlR1 - PX.front.hlR0) * S;
    const hlH = (PX.front.hlBot - PX.front.hlTop) * S;
    
    for (const side of [-1, 1]) {
        const hl = new THREE.Mesh(
            new THREE.BoxGeometry(hlW, hlH, 0.1),
            hlMat.clone()
        );
        hl.position.set(
            side * W / 4,
            BODY_BOTTOM + (PX.front.hlBot - PX.front.roof) * S,
            L/2 + 0.05
        );
        hl.userData.isHeadlight = true;
        group.add(hl);
    }
    
    // Taillights
    const tlMat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.0
    });
    
    for (const side of [-1, 1]) {
        const tl = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.2, 0.1),
            tlMat.clone()
        );
        tl.position.set(side * W / 4, 0.8, -L/2 - 0.05);
        tl.userData.isTaillight = true;
        group.add(tl);
    }
    
    // LED strip
    const ledMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: ledColor,
        emissiveIntensity: 0.8
    });
    
    const ledStrip = new THREE.Mesh(
        new THREE.BoxGeometry(W - 0.5, 0.1, 0.05),
        ledMat
    );
    ledStrip.position.set(0, H - 0.15, L/2 - 0.5);
    group.add(ledStrip);
    
    // ============================================================
    // DOOR (Right side)
    // ============================================================
    
    const doorW = (PX.sideR.doorRear - PX.sideR.doorFront) * S;
    const doorH = (PX.sideR.bodyBottom - PX.sideR.doorTop) * S;
    
    const doorMat = bodyMat.clone();
    const doorGeo = new THREE.PlaneGeometry(doorW, doorH);
    _setUVs(doorGeo, UV_REGIONS.right, 
        (PX.sideR.doorFront - PX.sideR.bodyFront) / (PX.sideR.bodyRear - PX.sideR.bodyFront),
        (PX.sideR.doorRear - PX.sideR.bodyFront) / (PX.sideR.bodyRear - PX.sideR.bodyFront)
    );
    
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(
        WALL_X + 0.02,
        BODY_BOTTOM + doorH / 2,
        L/2 - (PX.sideR.doorFront - PX.sideR.bodyFront) * S - doorW / 2
    );
    door.rotation.y = Math.PI / 2;
    door.userData.isDoor = true;
    door.userData.openAmount = 0;
    group.add(door);
    
    // ============================================================
    // RETURN API
    // ============================================================
    
    return {
        group,
        wheels,
        areLightsOn: false,
        doorOpen: false,
        interiorLedOn: false,
        
        setHeadlights(on) {
            group.traverse(child => {
                if (child.userData?.isHeadlight) {
                    child.material.emissiveIntensity = on ? 2.0 : 0.0;
                }
            });
            this.areLightsOn = on;
        },
        
        setTaillights(on) {
            group.traverse(child => {
                if (child.userData?.isTaillight) {
                    child.material.emissiveIntensity = on ? 1.5 : 0.0;
                }
            });
        },
        
        setDoor(open) {
            this.doorOpen = open > 0.5;
            door.userData.targetOpen = open;
            // Door animation sẽ được xử lý trong update
        },
        
        setInteriorLed(on) {
            this.interiorLedOn = on;
            // Interior LED handled by interior system
        },
        
        update(deltaTime) {
            // Door slide animation
            if (door.userData.targetOpen !== undefined) {
                const target = door.userData.targetOpen;
                const current = door.userData.openAmount || 0;
                const speed = 2.0;
                
                if (Math.abs(target - current) > 0.01) {
                    const newAmount = current + Math.sign(target - current) * speed * deltaTime;
                    door.userData.openAmount = Math.max(0, Math.min(1, newAmount));
                    
                    // Slide door along Z axis
                    door.position.z = door.userData.baseZ + door.userData.openAmount * doorW;
                }
            }
        },
        
        dispose() {
            _disposeGroup(group);
        }
    };
    
    // Store base position cho door animation
    door.userData.baseZ = door.position.z;
}

// ============================================================
// CREATE NPC BUS (TÁI SỤ DỤNG CREATEBUS - CHỈ ĐỔI SKIN)
// ============================================================

export function createNpcBus({ skinPath = null, ledColor = 0x00aaff } = {}) {
    // ⚠️ TÁI SỤ DỤNG HOÀN TOÀN createBus - chỉ khác skinPath
    const npcBus = createBus({ 
        skinPath: skinPath, 
        ledColor: ledColor 
    });
    
    // Rename group
    npcBus.group.name = "npc_bus";
    
    // Thêm methods riêng cho NPC
    npcBus.setBrakeLights = function(on) {
        this.group.traverse(child => {
            if (child.userData?.isTaillight) {
                child.material.emissiveIntensity = on ? 2.5 : 0.0;
            }
        });
    };
    
    npcBus.setTurnSignal = function(left, right) {
        // Turn signals nếu cần
    };
    
    return npcBus;
}

// ============================================================
// UV HELPER
// ============================================================

function _setUVs(geometry, region, uStart = 0, uEnd = 1) {
    const uv = geometry.attributes.uv;
    if (!uv) return;
    
    for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        
        // Map to region
        const newU = region.u0 + (uStart + u * (uEnd - uStart)) * (region.u1 - region.u0);
        const newV = region.v0 + v * (region.v1 - region.v0);
        
        uv.setXY(i, newU, newV);
    }
    
    uv.needsUpdate = true;
}

// ============================================================
// NPC SKIN LIST LOADING (ASYNC - KHÔNG BLOCK SPAWN)
// ============================================================

export async function loadNpcSkinList() {
    if (npcSkinListLoaded) return;
    if (npcSkinListPromise) return npcSkinListPromise;
    
    npcSkinListPromise = new Promise((resolve) => {
        // Trong thực tế: fetch directory listing từ server
        // Ở đây: hardcoded paths dựa trên cấu trúc assets
        const skinPaths = [
            "assets/textures/bus/bus_npc/npc_skin_01.png",
            "assets/textures/bus/bus_npc/npc_skin_02.png",
            "assets/textures/bus/bus_npc/npc_skin_03.png",
            "assets/textures/bus/bus_final.png" // Fallback: dùng skin player
        ];
        
        // Preload all textures (cache)
        let loaded = 0;
        const total = skinPaths.length;
        
        if (total === 0) {
            npcSkinListLoaded = true;
            npcSkinPaths = [];
            resolve();
            return;
        }
        
        for (const path of skinPaths) {
            loadCachedTexture(path).then(() => {
                npcSkinPaths.push(path);
                loaded++;
                if (loaded >= total) {
                    npcSkinListLoaded = true;
                    console.log(`✅ NPC skins loaded: ${npcSkinPaths.length}/${total}`);
                    resolve();
                }
            }).catch(() => {
                loaded++;
                if (loaded >= total) {
                    npcSkinListLoaded = true;
                    console.log(`✅ NPC skins loaded: ${npcSkinPaths.length}/${total} (some failed)`);
                    resolve();
                }
            });
        }
    });
    
    return npcSkinListPromise;
}

// ============================================================
// SKIN PICKERS
// ============================================================

export function pickNpcSkinPath() {
    if (!npcSkinListLoaded || npcSkinPaths.length === 0) {
        return BUS_TEXTURE_URL; // Fallback: dùng texture player
    }
    return npcSkinPaths[Math.floor(Math.random() * npcSkinPaths.length)];
}

export function pickLedColor() {
    const colors = [
        0x00aaff, 0x00ff88, 0xff4400, 0xffaa00,
        0x8800ff, 0xff0088, 0x00ffcc, 0x4488ff
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// ============================================================
// DISPOSE HELPER
// ============================================================

function _disposeGroup(group) {
    group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                    // KHÔNG dispose texture vì nó cached/shared
                    m.dispose();
                });
            } else {
                child.material.dispose();
            }
        }
    });
    if (group.parent) {
        group.parent.remove(group);
    }
}

// ============================================================
// CLEANUP (khi unload page)
// ============================================================

export function disposeBusTextures() {
    for (const [url, texture] of textureCache) {
        texture.dispose();
    }
    textureCache.clear();
    npcSkinListLoaded = false;
    npcSkinListPromise = null;
    npcSkinPaths = [];
}