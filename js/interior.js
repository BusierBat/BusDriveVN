// js/interior.js - VIP 24 BED SLEEPER BUS (RESTORED SIDE WALLS + GLASS + CEILING)
import * as THREE from "three";

const L = 12, W = 2.4, H = 3.3;
const FLOOR_Y = 0.0, CEILING_Y = 3.2;
const WALL_X = 1.15;
const CABIN_END_Z = 4.8;

const BED_WIDTH = 0.7;
const BED_LENGTH = 1.7;
const BED_Z_POSITIONS = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
const LOWER_BED_Y = 0.67;
const UPPER_BED_Y = 1.67;

const WIN_LO_BOT = 0.8;
const WIN_LO_TOP = 1.4;
const WIN_HI_BOT = 1.8;
const WIN_HI_TOP = 2.4;

const matBrownLeather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 });
const matBrownLeatherDark = new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.8 });

// FIX 3: Khung giường TRẮNG
const matBedFrame = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 });

const matMattress = new THREE.MeshStandardMaterial({ color: 0x607d8b, roughness: 0.9 });
const matPillow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
const matCream = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.85 });
const matWhite = new THREE.MeshStandardMaterial({ color: 0xf2f4f0, roughness: 0.8 });
const matFabric = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1.0 });
const matFabricDark = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1.0 });

// FIX 6: Kính trong suốt
const matGlass = new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    transparent: true,
    opacity: 0.15,
    roughness: 0.05,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide
});
const matGlassClear = new THREE.MeshStandardMaterial({
    color: 0xb8d8e8,
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide
});

// FIX 5: Sàn nâu gỗ
const matWoodFloor = new THREE.MeshStandardMaterial({ color: 0x6b4528, roughness: 0.75, metalness: 0.0 });
const matUpperFloor = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.8 });

// FIX 4: Khung xe màu Trắng (thay vì nâu/xám)
const matShell = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
const matBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
const matDashboard = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.6, metalness: 0.2 });
const matDashboardPanel = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.3 });
const matCluster = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x35ffd0, emissiveIntensity: 0.6, roughness: 0.3 });
const matSteeringWheel = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
const matSeat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
const matSeatCushion = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
const matDivider = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }); // Khung vách trắng

// LED
const matLEDNude = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, emissive: 0xe8c9a0, emissiveIntensity: 4.2 });
const matLEDBlue = new THREE.MeshStandardMaterial({ color: 0x001118, emissive: 0x2fb6ff, emissiveIntensity: 3.75 });
const matLEDWhite = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1.65 });

function box(w, h, d, mat, x, y, z, group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
}

function buildCabin(groups) {
    const { DriverArea, Dashboard, Windows, BodyShell } = groups;
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), matGlassClear);
    windshield.position.set(0, 1.8, 6.0 + 0.01);
    windshield.updateMatrix();
    windshield.matrixAutoUpdate = false;
    Windows.add(windshield);

    for (const side of [1, -1]) {
        const xGlass = side * (WALL_X + 0.01);
        const cabinWin = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.6), matGlassClear);
        cabinWin.position.set(xGlass, 1.6, 5.5);
        cabinWin.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        cabinWin.updateMatrix();
        cabinWin.matrixAutoUpdate = false;
        Windows.add(cabinWin);
        box(0.04, 1.6, 0.04, matShell, side * WALL_X, 1.6, 5.5, BodyShell);
        box(0.6, 0.04, 0.04, matShell, side * WALL_X, 0.8, 5.5, BodyShell);
        box(0.6, 0.04, 0.04, matShell, side * WALL_X, 2.4, 5.5, BodyShell);
    }

    box(2.1, 0.04, 0.06, matShell, 0, 2.5, 6.0, BodyShell);
    box(2.1, 0.06, 0.06, matShell, 0, 1.1, 6.0, BodyShell);
    box(0.04, 1.5, 0.06, matShell, -1.05, 1.8, 6.0, BodyShell);
    box(0.04, 1.5, 0.06, matShell, 1.05, 1.8, 6.0, BodyShell);
    box(0.06, 1.8, 0.06, matShell, -WALL_X, 1.8, 5.8, BodyShell);
    box(0.06, 1.8, 0.06, matShell, WALL_X, 1.8, 5.8, BodyShell);

    box(1.6, 0.3, 0.6, matDashboard, 0, 0.8, 5.3, Dashboard);
    box(1.6, 0.08, 0.5, matDashboardPanel, 0, 1.0, 5.35, Dashboard);
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, emissive: 0x224488, emissiveIntensity: 0.3 });
    box(0.5, 0.25, 0.05, screenMat, 0, 1.05, 5.6, Dashboard);
    const clusterMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x35ffd0, emissiveIntensity: 0.5 });
    box(0.35, 0.2, 0.05, clusterMat, -0.45, 1.05, 5.6, Dashboard);
    box(0.25, 0.15, 0.05, clusterMat, 0.45, 1.05, 5.6, Dashboard);

    for (let i = 0; i < 4; i++) {
        const btnMat = new THREE.MeshStandardMaterial({ color: 0x333344 });
        box(0.04, 0.04, 0.04, btnMat, -0.3 + i * 0.15, 0.85, 5.6, Dashboard);
    }

    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6), matDark);
    lever.position.set(0.25, 0.9, 5.6);
    lever.updateMatrix();
    lever.matrixAutoUpdate = false;
    Dashboard.add(lever);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), matDark);
    knob.position.set(0.25, 1.03, 5.6);
    knob.updateMatrix();
    knob.matrixAutoUpdate = false;
    Dashboard.add(knob);

    const steerGroup = new THREE.Group();
    steerGroup.position.set(0.35, 1.1, 5.1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 16), matSteeringWheel);
    ring.rotation.x = Math.PI / 2 - 0.2;
    steerGroup.add(ring);
    for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.025), matSteeringWheel);
        spoke.position.set(Math.sin(angle) * 0.12, 0, Math.cos(angle) * 0.12);
        spoke.rotation.y = -angle;
        steerGroup.add(spoke);
    }
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 8), matDark);
    column.position.set(0, -0.15, 0);
    column.rotation.x = 0.2;
    steerGroup.add(column);
    DriverArea.add(steerGroup);

    box(0.5, 0.08, 0.5, matDark, -0.35, 0.14, 4.5, DriverArea);
    box(0.08, 0.2, 0.08, matDark, -0.35, 0.28, 4.5, DriverArea);
    box(0.5, 0.12, 0.5, matSeatCushion, -0.35, 0.44, 4.5, DriverArea);
    box(0.5, 0.55, 0.08, matSeatCushion, -0.35, 0.75, 4.25, DriverArea);
    box(0.3, 0.15, 0.06, matSeatCushion, -0.35, 1.05, 4.25, DriverArea);
    box(0.03, 0.08, 0.3, matSeat, -0.6, 0.5, 4.45, DriverArea);
    box(0.03, 0.08, 0.3, matSeat, -0.1, 0.5, 4.45, DriverArea);

    box(0.45, 0.06, 0.45, matDark, 0.65, 0.13, 4.5, DriverArea);
    box(0.06, 0.18, 0.06, matDark, 0.65, 0.25, 4.5, DriverArea);
    box(0.45, 0.1, 0.45, matSeatCushion, 0.65, 0.4, 4.5, DriverArea);
    box(0.45, 0.45, 0.06, matSeatCushion, 0.65, 0.65, 4.3, DriverArea);
    box(0.25, 0.12, 0.04, matSeatCushion, 0.65, 0.9, 4.3, DriverArea);
}

function buildPassengerCabin(groups) {
    const { Beds, Floor, Ceiling, Curtains, Windows, Cabins, Aisle, Led, BodyShell } = groups;
    
    // Sàn
    const mainFloor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, L), matWoodFloor);
    mainFloor.position.set(0, -0.05, 0);
    mainFloor.updateMatrix();
    mainFloor.matrixAutoUpdate = false;
    Floor.add(mainFloor);
    
    const passFloorLen = Math.abs(BED_Z_POSITIONS[0] - BED_Z_POSITIONS[BED_Z_POSITIONS.length-1]) + BED_LENGTH + 1;
    const midZ = (BED_Z_POSITIONS[0] + BED_Z_POSITIONS[BED_Z_POSITIONS.length-1])/2;
    const passFloor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, passFloorLen), matUpperFloor);
    passFloor.position.set(0, 0.7, midZ);
    passFloor.updateMatrix();
    passFloor.matrixAutoUpdate = false;
    Floor.add(passFloor);
    
    // Trần
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, L), matShell);
    ceiling.position.set(0, CEILING_Y, 0);
    ceiling.updateMatrix();
    ceiling.matrixAutoUpdate = false;
    Ceiling.add(ceiling);

    // FIX 7: Cấu trúc hông Tầng 1 và Tầng 2 (Khung trắng + Kính)
    for (const side of [1, -1]) {
        const xWall = side * (WALL_X - 0.01);
        
        // 1. Vách dưới cửa sổ tầng 1 (từ sàn lên)
        const lowerWallHeight = WIN_LO_BOT - 0.1;
        const lowerWall = new THREE.Mesh(new THREE.PlaneGeometry(passFloorLen, lowerWallHeight), matShell);
        lowerWall.position.set(xWall, 0.1 + lowerWallHeight / 2, midZ);
        lowerWall.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        lowerWall.updateMatrix();
        lowerWall.matrixAutoUpdate = false;
        BodyShell.add(lowerWall);
        
        // 2. Vách giữa 2 dãy cửa sổ (tầng 1 và tầng 2)
        const midWallHeight = WIN_HI_BOT - WIN_LO_TOP;
        const midWall = new THREE.Mesh(new THREE.PlaneGeometry(passFloorLen, midWallHeight), matShell);
        midWall.position.set(xWall, (WIN_LO_TOP + WIN_HI_BOT) / 2, midZ);
        midWall.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        midWall.updateMatrix();
        midWall.matrixAutoUpdate = false;
        BodyShell.add(midWall);
        
        // 3. Vách trên cửa sổ tầng 2 lên tới trần
        const upperWallHeight = CEILING_Y - WIN_HI_TOP;
        const upperWall = new THREE.Mesh(new THREE.PlaneGeometry(passFloorLen, upperWallHeight), matShell);
        upperWall.position.set(xWall, (WIN_HI_TOP + CEILING_Y) / 2, midZ);
        upperWall.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        upperWall.updateMatrix();
        upperWall.matrixAutoUpdate = false;
        BodyShell.add(upperWall);
        
        // Khung cột dọc giữa các giường
        for (const z of BED_Z_POSITIONS) {
            const zPos = z + BED_LENGTH/2;
            box(0.05, CEILING_Y, 0.05, matShell, side * (WALL_X - 0.02), CEILING_Y/2, zPos, BodyShell);
        }
    }

    const dividerWidth = BED_WIDTH + 0.04;
    const dividerHeight = 0.6; 
    const dividerThick = 0.04;
    const dividerY = 0.8 + dividerHeight / 2;
    const xPosAbs = WALL_X - BED_WIDTH / 2 - 0.02;

    for (const side of [1, -1]) {
        const xPos = side * xPosAbs;
        for (const z of BED_Z_POSITIONS) {
            const frameLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, 0.04, BED_LENGTH), matBedFrame);
            frameLow.position.set(xPos, LOWER_BED_Y, z);
            frameLow.updateMatrix();
            frameLow.matrixAutoUpdate = false;
            Beds.add(frameLow);
            
            const mattressLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.92, 0.08, BED_LENGTH * 0.95), matMattress);
            mattressLow.position.set(xPos, LOWER_BED_Y + 0.06, z);
            mattressLow.updateMatrix();
            mattressLow.matrixAutoUpdate = false;
            Beds.add(mattressLow);
            
            const pillowLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.6, 0.05, 0.25), matPillow);
            pillowLow.position.set(xPos, LOWER_BED_Y + 0.12, z - BED_LENGTH / 2 + 0.2);
            pillowLow.updateMatrix();
            pillowLow.matrixAutoUpdate = false;
            Beds.add(pillowLow);
            
            const blanketLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.85, 0.04, BED_LENGTH * 0.45), matBrownLeatherDark);
            blanketLow.position.set(xPos, LOWER_BED_Y + 0.08, z + BED_LENGTH * 0.12);
            blanketLow.updateMatrix();
            blanketLow.matrixAutoUpdate = false;
            Beds.add(blanketLow);

            const frameUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, 0.04, BED_LENGTH), matBedFrame);
            frameUp.position.set(xPos, UPPER_BED_Y, z);
            frameUp.updateMatrix();
            frameUp.matrixAutoUpdate = false;
            Beds.add(frameUp);
            
            const mattressUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.92, 0.08, BED_LENGTH * 0.95), matMattress);
            mattressUp.position.set(xPos, UPPER_BED_Y + 0.06, z);
            mattressUp.updateMatrix();
            mattressUp.matrixAutoUpdate = false;
            Beds.add(mattressUp);
            
            const pillowUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.6, 0.05, 0.25), matPillow);
            pillowUp.position.set(xPos, UPPER_BED_Y + 0.12, z - BED_LENGTH / 2 + 0.2);
            pillowUp.updateMatrix();
            pillowUp.matrixAutoUpdate = false;
            Beds.add(pillowUp);
            
            const blanketUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.85, 0.04, BED_LENGTH * 0.45), matBrownLeatherDark);
            blanketUp.position.set(xPos, UPPER_BED_Y + 0.08, z + BED_LENGTH * 0.12);
            blanketUp.updateMatrix();
            blanketUp.matrixAutoUpdate = false;
            Beds.add(blanketUp);

            const wallFront = new THREE.Mesh(new THREE.BoxGeometry(dividerWidth, dividerHeight, dividerThick), matDivider);
            wallFront.position.set(xPos, dividerY, z + BED_LENGTH / 2);
            wallFront.updateMatrix();
            wallFront.matrixAutoUpdate = false;
            Cabins.add(wallFront);
            
            const wallBack = new THREE.Mesh(new THREE.BoxGeometry(dividerWidth, dividerHeight, dividerThick), matDivider);
            wallBack.position.set(xPos, dividerY, z - BED_LENGTH / 2);
            wallBack.updateMatrix();
            wallBack.matrixAutoUpdate = false;
            Cabins.add(wallBack);
        }
    }

    const glassLen = Math.abs(BED_Z_POSITIONS[0] + BED_LENGTH/2 - (BED_Z_POSITIONS[BED_Z_POSITIONS.length-1] - BED_LENGTH/2));
    for (const side of [1, -1]) {
        const xGlass = side * (WALL_X + 0.01);
        const winLow = new THREE.Mesh(new THREE.PlaneGeometry(glassLen, WIN_LO_TOP - WIN_LO_BOT), matGlass);
        winLow.position.set(xGlass, (WIN_LO_BOT + WIN_LO_TOP) / 2, midZ);
        winLow.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        winLow.updateMatrix();
        winLow.matrixAutoUpdate = false;
        Windows.add(winLow);
        
        const winHi = new THREE.Mesh(new THREE.PlaneGeometry(glassLen, WIN_HI_TOP - WIN_HI_BOT), matGlass);
        winHi.position.set(xGlass, (WIN_HI_BOT + WIN_HI_TOP) / 2, midZ);
        winHi.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        winHi.updateMatrix();
        winHi.matrixAutoUpdate = false;
        Windows.add(winHi);
    }

    const curtainMat1 = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1.0 });
    const curtainMat2 = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1.0 });
    for (const side of [1, -1]) {
        const xCurtain = side * (WALL_X - 0.02);
        const xAisle = side * 0.32;
        for (const z of BED_Z_POSITIONS) {
            const curtainLow = new THREE.Mesh(new THREE.BoxGeometry(0.02, WIN_LO_TOP - WIN_LO_BOT, 0.35), curtainMat1);
            curtainLow.position.set(xCurtain, (WIN_LO_BOT + WIN_LO_TOP) / 2, z - 0.50);
            curtainLow.updateMatrix();
            curtainLow.matrixAutoUpdate = false;
            Curtains.add(curtainLow);
            const curtainUp = new THREE.Mesh(new THREE.BoxGeometry(0.02, WIN_HI_TOP - WIN_HI_BOT, 0.35), curtainMat2);
            curtainUp.position.set(xCurtain, (WIN_HI_BOT + WIN_HI_TOP) / 2, z - 0.50);
            curtainUp.updateMatrix();
            curtainUp.matrixAutoUpdate = false;
            Curtains.add(curtainUp);
            const aisleCurtainLow = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.85, 0.35), curtainMat1);
            aisleCurtainLow.position.set(xAisle, 1.30, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainLow.updateMatrix();
            aisleCurtainLow.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainLow);
            const aisleCurtainUp = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.1, 0.35), curtainMat2);
            aisleCurtainUp.position.set(xAisle, 2.00, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainUp.updateMatrix();
            aisleCurtainUp.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainUp);
        }
    }

    // Hệ thống Dải LED Dài
    const ledNude = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, glassLen), matLEDNude);
    ledNude.position.set(0, CEILING_Y - 0.1, midZ);
    ledNude.updateMatrix();
    ledNude.matrixAutoUpdate = false;
    Led.add(ledNude);

    const ledBlueL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, glassLen), matLEDBlue);
    ledBlueL.position.set(-0.4, CEILING_Y - 0.1, midZ);
    ledBlueL.updateMatrix();
    ledBlueL.matrixAutoUpdate = false;
    Led.add(ledBlueL);

    const ledBlueR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, glassLen), matLEDBlue);
    ledBlueR.position.set(0.4, CEILING_Y - 0.1, midZ);
    ledBlueR.updateMatrix();
    ledBlueR.matrixAutoUpdate = false;
    Led.add(ledBlueR);
}

export function createBusInterior() {
    const root = new THREE.Group();
    root.name = "busInterior";
    const groups = {};
    const names = ["Beds", "Floor", "Ceiling", "Curtains", "Windows",
        "DriverArea", "Dashboard", "Lights", "Cabins", "Aisle", "Led", "BodyShell"];
    for (const name of names) {
        groups[name] = new THREE.Group();
        groups[name].name = name;
        root.add(groups[name]);
    }
    buildCabin(groups);
    buildPassengerCabin(groups);

    const lights = [];
    const mkLight = (x, y, z, intensity, color = 0xffe5cc, distance = 8) => {
        const pl = new THREE.PointLight(color, intensity, distance, 1.5);
        pl.position.set(x, y, z);
        pl.userData.base = intensity;
        groups.Lights.add(pl);
        lights.push(pl);
    };
    mkLight(0, CEILING_Y - 0.2, 5.0, 0.9, 0xfff5e6, 6);
    mkLight(0, 2.0, 4.5, 0.6, 0xfff5e6, 4);
    mkLight(0, CEILING_Y - 0.2, 2.5, 0.75, 0xcce5ff, 10);
    mkLight(0, CEILING_Y - 0.2, -1.0, 0.75, 0xcce5ff, 10);
    mkLight(0, CEILING_Y - 0.2, -4.0, 0.75, 0xcce5ff, 10);

    function setInteriorLed(on) {
        matLEDNude.emissiveIntensity = on ? 4.2 : 0;
        matLEDBlue.emissiveIntensity = on ? 3.75 : 0;
        matLEDWhite.emissiveIntensity = on ? 1.65 : 0;
        matCluster.emissiveIntensity = on ? 0.6 : 0.1;
        for (const pl of lights) {
            pl.intensity = on ? pl.userData.base : 0;
        }
    }
    root.setInteriorLed = setInteriorLed;
    setInteriorLed(true);
    return root;
}