// js/interior.js - VIP 24 BED SLEEPER BUS (FULL VERSION)
import * as THREE from "three";

// ============================================================
// KÍCH THƯỚC XE
// ============================================================
const L = 12, W = 2.4, H = 3.3;
const FLOOR_Y = 0.0, CEILING_Y = 3.2;
const WALL_X = 1.15;
const CABIN_END_Z = 4.8;

// ============================================================
// GIƯỜNG – 24 GIƯỜNG (2 DÃY × 2 TẦNG × 6 HÀNG)
// ============================================================
const BED_WIDTH = 0.7;
const BED_LENGTH = 1.7;
const BED_Z_POSITIONS = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
const LOWER_BED_Y = 0.67;
const UPPER_BED_Y = 1.67;

// ============================================================
// CỬA SỔ
// ============================================================
const WIN_LO_BOT = 0.8;
const WIN_LO_TOP = 1.4;
const WIN_HI_BOT = 1.8;
const WIN_HI_TOP = 2.4;

// ============================================================
// MATERIALS
// ============================================================
const matBrownLeather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 });
const matBrownLeatherDark = new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.8 });
const matBedFrame = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.8 });
const matCream = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.85 });
const matWhite = new THREE.MeshStandardMaterial({ color: 0xf2f4f0, roughness: 0.8 });
const matFabric = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1.0 });
const matFabricDark = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1.0 });
const matGlass = new THREE.MeshStandardMaterial({ color: 0x0a1420, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.4, depthWrite: false });
const matGlassClear = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide });
const matShell = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.9 });
const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
const matBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
const matDashboard = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.6, metalness: 0.2 });
const matDashboardPanel = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.3 });
const matCluster = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x35ffd0, emissiveIntensity: 0.6, roughness: 0.3 });
const matSteeringWheel = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
const matSeat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
const matSeatCushion = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });

// ===== LED MATERIALS =====
const matLEDBlue = new THREE.MeshStandardMaterial({
    color: 0x001118,
    emissive: 0x2fb6ff,
    emissiveIntensity: 2.5
});
const matLEDNude = new THREE.MeshStandardMaterial({
    color: 0x3a2a1a,
    emissive: 0xe8c9a0, // màu da nude
    emissiveIntensity: 2.8
});
const matLEDRib = new THREE.MeshStandardMaterial({
    color: 0x001118,
    emissive: 0x2fb6ff,
    emissiveIntensity: 1.6
});
const matLEDWhite = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0xffffff,
    emissiveIntensity: 1.1
});
const matLED = new THREE.MeshStandardMaterial({
    color: 0x001118,
    emissive: 0x00aaff,
    emissiveIntensity: 2.2
});

const matAisle = new THREE.MeshStandardMaterial({ color: 0xcc6a6a, roughness: 0.6, metalness: 0.1 });
const matDivider = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.9 });
const matUpperFloor = new THREE.MeshStandardMaterial({ color: 0xd0c8b8, roughness: 0.8 });

// ============================================================
// HÀM DỰNG CƠ BẢN
// ============================================================
function box(w, h, d, mat, x, y, z, group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
}

// ============================================================
// CABIN LÁI
// ============================================================
function buildCabin(groups) {
    const { DriverArea, Dashboard, Windows, BodyShell } = groups;

    // Kính chắn gió
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), matGlassClear);
    windshield.position.set(0, 1.8, 6.0 + 0.01);
    windshield.updateMatrix();
    windshield.matrixAutoUpdate = false;
    Windows.add(windshield);

    // Kính bên cabin (không chia tầng)
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

    // Khung kính chắn gió
    box(2.1, 0.04, 0.06, matShell, 0, 2.5, 6.0, BodyShell);
    box(2.1, 0.06, 0.06, matShell, 0, 1.1, 6.0, BodyShell);
    box(0.04, 1.5, 0.06, matShell, -1.05, 1.8, 6.0, BodyShell);
    box(0.04, 1.5, 0.06, matShell, 1.05, 1.8, 6.0, BodyShell);
    box(0.06, 1.8, 0.06, matShell, -WALL_X, 1.8, 5.8, BodyShell);
    box(0.06, 1.8, 0.06, matShell, WALL_X, 1.8, 5.8, BodyShell);

    // Dashboard
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

    // Cần số
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

    // Vô-lăng
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

    // Ghế tài xế
    box(0.5, 0.08, 0.5, matDark, -0.35, 0.14, 4.5, DriverArea);
    box(0.08, 0.2, 0.08, matDark, -0.35, 0.28, 4.5, DriverArea);
    box(0.5, 0.12, 0.5, matSeatCushion, -0.35, 0.44, 4.5, DriverArea);
    box(0.5, 0.55, 0.08, matSeatCushion, -0.35, 0.75, 4.25, DriverArea);
    box(0.3, 0.15, 0.06, matSeatCushion, -0.35, 1.05, 4.25, DriverArea);
    box(0.03, 0.08, 0.3, matSeat, -0.6, 0.5, 4.45, DriverArea);
    box(0.03, 0.08, 0.3, matSeat, -0.1, 0.5, 4.45, DriverArea);

    // Ghế phụ
    box(0.45, 0.06, 0.45, matDark, 0.65, 0.13, 4.5, DriverArea);
    box(0.06, 0.18, 0.06, matDark, 0.65, 0.25, 4.5, DriverArea);
    box(0.45, 0.1, 0.45, matSeatCushion, 0.65, 0.4, 4.5, DriverArea);
    box(0.45, 0.45, 0.06, matSeatCushion, 0.65, 0.65, 4.3, DriverArea);
    box(0.25, 0.12, 0.04, matSeatCushion, 0.65, 0.9, 4.3, DriverArea);
    box(0.5, 0.2, 0.25, matDashboard, 0.85, 0.7, 5.1, Dashboard);
    box(0.4, 0.05, 0.2, matDashboardPanel, 0.85, 0.85, 5.15, Dashboard);
}

// ============================================================
// KHOANG HÀNH KHÁCH
// ============================================================
function buildPassengerCabin(groups) {
    const { Beds, Floor, Ceiling, Curtains, Windows, Cabins, Aisle, Led, BodyShell, Lights } = groups;

    // ---------- BẬC LÊN (CABIN THẤP → KHOANG KHÁCH CAO) ----------
    const PASSENGER_FLOOR_OFFSET = 0.3;
    const PASSENGER_FLOOR_Y = FLOOR_Y + PASSENGER_FLOOR_OFFSET;
    const stepWidth = 1.2;
    const stepDepth = 0.4;
    const stepHeight = PASSENGER_FLOOR_OFFSET;
    // Bậc trái, phải, giữa
    box(stepWidth, stepHeight, stepDepth, matShell, -0.7, stepHeight/2, CABIN_END_Z + 0.2, Aisle);
    box(stepWidth, stepHeight, stepDepth, matShell, 0.7, stepHeight/2, CABIN_END_Z + 0.2, Aisle);
    box(0.8, stepHeight, stepDepth, matShell, 0, stepHeight/2, CABIN_END_Z + 0.2, Aisle);

    // ---------- SÀN KHOANG HÀNH KHÁCH ----------
    box(W - 0.1, 0.08, L - 0.5, new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }), 0, PASSENGER_FLOOR_Y - 0.04, 0, Floor);

    // ---------- HÀNH LANG ----------
    const aisleWidth = 0.8;
    const aisleLength = L - 0.5;
    const aisleCenterZ = 0.25;
    box(aisleWidth, 0.06, aisleLength, matAisle, 0, PASSENGER_FLOOR_Y + 0.02, aisleCenterZ, Aisle);
    for (const side of [1, -1]) {
        box(0.035, 0.035, aisleLength, matLEDBlue, side * (aisleWidth / 2 - 0.025), PASSENGER_FLOOR_Y + 0.07, aisleCenterZ, Aisle);
        box(0.045, 0.05, aisleLength, matDivider, side * (aisleWidth / 2), PASSENGER_FLOOR_Y + 0.04, aisleCenterZ, Aisle);
    }
    // Nối hành lang vào cabin
    const cabinAisleLength = 1.2;
    box(aisleWidth, 0.06, cabinAisleLength, matAisle, 0, PASSENGER_FLOOR_Y + 0.02, CABIN_END_Z + cabinAisleLength / 2, Aisle);
    for (const side of [1, -1]) {
        box(0.035, 0.035, cabinAisleLength, matLEDBlue, side * (aisleWidth / 2 - 0.025), PASSENGER_FLOOR_Y + 0.07, CABIN_END_Z + cabinAisleLength / 2, Aisle);
    }

    // ---------- TRẦN & 3 DẢI LED ----------
    // Trần nền
    box(W - 0.06, 0.04, L - 0.5, matCream, 0, CEILING_Y + 0.02, 0, Ceiling);

    // 1. DẢI LED GIỮA (màu da nude)
    const centerLed = box(0.06, 0.02, L - 0.8, matLEDNude, 0, CEILING_Y - 0.005, 0.5, Led);
    centerLed.name = "centerLed";

    // 2. HAI DẢI LED HAI BÊN (xanh nước biển)
    for (const side of [1, -1]) {
        const sideLed = box(0.04, 0.02, L - 0.8, matLEDBlue, side * 0.22, CEILING_Y - 0.005, 0.5, Led);
        sideLed.name = side > 0 ? "rightLed" : "leftLed";
    }

    // Gân trần
    for (let z = 3.5; z >= -5.0; z -= 0.45) {
        box(0.45, 0.015, 0.06, matLEDRib, 0, CEILING_Y - 0.005, z, Led);
    }
    // Dải LED dọc hai bên (trang trí)
    for (const side of [1, -1]) {
        box(0.02, 0.03, L - 0.8, matLEDBlue, side * 1.05, CEILING_Y - 0.04, 0.5, Led);
    }

    // ---------- ĐÈN POINT LIGHT CHO 3 DẢI LED ----------
    const centerLight = new THREE.PointLight(0xe8c9a0, 0, 8, 1.5);
    centerLight.position.set(0, CEILING_Y - 0.1, 0);
    centerLight.name = "centerLedLight";
    const leftLight = new THREE.PointLight(0x2fb6ff, 0, 6, 1.5);
    leftLight.position.set(-0.22, CEILING_Y - 0.1, 0);
    leftLight.name = "leftLedLight";
    const rightLight = new THREE.PointLight(0x2fb6ff, 0, 6, 1.5);
    rightLight.position.set(0.22, CEILING_Y - 0.1, 0);
    rightLight.name = "rightLedLight";
    Lights.add(centerLight);
    Lights.add(leftLight);
    Lights.add(rightLight);

    // ---------- THÂN XE ----------
    const shellLen = L - 0.6;
    for (const side of [1, -1]) {
        box(0.04, WIN_LO_BOT - PASSENGER_FLOOR_Y, shellLen, matShell, side * WALL_X, (PASSENGER_FLOOR_Y + WIN_LO_BOT) / 2, 0, BodyShell);
        box(0.04, WIN_HI_BOT - WIN_LO_TOP, shellLen, matShell, side * WALL_X, (WIN_LO_TOP + WIN_HI_BOT) / 2, 0, BodyShell);
        box(0.04, CEILING_Y - WIN_HI_TOP, shellLen, matShell, side * WALL_X, (WIN_HI_TOP + CEILING_Y) / 2, 0, BodyShell);
    }

    // ---------- SÀN TẦNG TRÊN (kết cấu đỡ) ----------
    const upperFloorY = UPPER_BED_Y - 0.05;
    const floorThick = 0.08;
    for (const side of [1, -1]) {
        const xFloor = side * (WALL_X - 0.1);
        box(0.02, floorThick, shellLen, matUpperFloor, xFloor, upperFloorY, 0, BodyShell);
    }

    // ---------- GIƯỜNG (24) ----------
    const xPosAbs = 0.75;
    const pillowOffset = BED_LENGTH / 2 - 0.25;
    const dividerHeight = CEILING_Y - PASSENGER_FLOOR_Y;
    const dividerY = (PASSENGER_FLOOR_Y + CEILING_Y) / 2;
    const dividerThick = 0.02;
    const dividerWidth = BED_WIDTH + 0.04;

    for (const side of [1, -1]) {
        const xPos = side * xPosAbs;
        for (const z of BED_Z_POSITIONS) {
            // Tầng dưới
            const yLow = LOWER_BED_Y;
            const frameLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH + 0.06, 0.08, BED_LENGTH + 0.06), matBedFrame);
            frameLow.position.set(xPos, yLow - 0.12, z);
            frameLow.updateMatrix();
            frameLow.matrixAutoUpdate = false;
            Beds.add(frameLow);
            const mattressLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, 0.14, BED_LENGTH), matBrownLeather);
            mattressLow.position.set(xPos, yLow, z);
            mattressLow.updateMatrix();
            mattressLow.matrixAutoUpdate = false;
            Beds.add(mattressLow);
            const pillowLow = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.10, 0.30), matWhite);
            pillowLow.position.set(xPos, yLow + 0.10, z + pillowOffset);
            pillowLow.updateMatrix();
            pillowLow.matrixAutoUpdate = false;
            Beds.add(pillowLow);
            const blanketLow = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.85, 0.04, BED_LENGTH * 0.45), matBrownLeatherDark);
            blanketLow.position.set(xPos, yLow + 0.08, z - BED_LENGTH * 0.12);
            blanketLow.updateMatrix();
            blanketLow.matrixAutoUpdate = false;
            Beds.add(blanketLow);

            // Tầng trên
            const yUp = UPPER_BED_Y;
            const frameUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH + 0.06, 0.08, BED_LENGTH + 0.06), matBedFrame);
            frameUp.position.set(xPos, yUp - 0.12, z);
            frameUp.updateMatrix();
            frameUp.matrixAutoUpdate = false;
            Beds.add(frameUp);
            const mattressUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, 0.14, BED_LENGTH), matBrownLeather);
            mattressUp.position.set(xPos, yUp, z);
            mattressUp.updateMatrix();
            mattressUp.matrixAutoUpdate = false;
            Beds.add(mattressUp);
            const pillowUp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.10, 0.30), matWhite);
            pillowUp.position.set(xPos, yUp + 0.10, z + pillowOffset);
            pillowUp.updateMatrix();
            pillowUp.matrixAutoUpdate = false;
            Beds.add(pillowUp);
            const blanketUp = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH * 0.85, 0.04, BED_LENGTH * 0.45), matBrownLeatherDark);
            blanketUp.position.set(xPos, yUp + 0.08, z - BED_LENGTH * 0.12);
            blanketUp.updateMatrix();
            blanketUp.matrixAutoUpdate = false;
            Beds.add(blanketUp);

            // Vách ngăn giữa các giường
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

    // Vách cuối xe
    const rearZ = BED_Z_POSITIONS[BED_Z_POSITIONS.length - 1] - BED_LENGTH / 2;
    const wallRearLeft = new THREE.Mesh(new THREE.BoxGeometry(dividerWidth, dividerHeight, dividerThick), matDivider);
    wallRearLeft.position.set(-xPosAbs, dividerY, rearZ);
    wallRearLeft.updateMatrix();
    wallRearLeft.matrixAutoUpdate = false;
    Cabins.add(wallRearLeft);
    const wallRearRight = new THREE.Mesh(new THREE.BoxGeometry(dividerWidth, dividerHeight, dividerThick), matDivider);
    wallRearRight.position.set(xPosAbs, dividerY, rearZ);
    wallRearRight.updateMatrix();
    wallRearRight.matrixAutoUpdate = false;
    Cabins.add(wallRearRight);

    // ---------- CỬA SỔ 2 TẦNG (KHÔNG CỘT XÁM) ----------
    for (const side of [1, -1]) {
        const xGlass = side * (WALL_X + 0.01);
        for (const z of BED_Z_POSITIONS) {
            const winLow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, WIN_LO_TOP - WIN_LO_BOT), matGlass);
            winLow.position.set(xGlass, (WIN_LO_BOT + WIN_LO_TOP) / 2, z - 0.50);
            winLow.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            winLow.updateMatrix();
            winLow.matrixAutoUpdate = false;
            Windows.add(winLow);
            const winHi = new THREE.Mesh(new THREE.PlaneGeometry(1.5, WIN_HI_TOP - WIN_HI_BOT), matGlass);
            winHi.position.set(xGlass, (WIN_HI_BOT + WIN_HI_TOP) / 2, z - 0.50);
            winHi.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            winHi.updateMatrix();
            winHi.matrixAutoUpdate = false;
            Windows.add(winHi);
        }
    }

    // ---------- RÈM ----------
    const curtainMat1 = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1.0 });
    const curtainMat2 = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1.0 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
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
            aisleCurtainLow.position.set(xAisle, 1.90, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainLow.updateMatrix();
            aisleCurtainLow.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainLow);
            const aisleCurtainUp = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.75, 0.35), curtainMat2);
            aisleCurtainUp.position.set(xAisle, 3.00, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainUp.updateMatrix();
            aisleCurtainUp.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainUp);
            const rod1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, BED_LENGTH - 0.1), rodMat);
            rod1.position.set(xAisle, 0.58, z);
            rod1.updateMatrix();
            rod1.matrixAutoUpdate = false;
            Curtains.add(rod1);
            const rod2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, BED_LENGTH - 0.1), rodMat);
            rod2.position.set(xAisle, 1.58, z);
            rod2.updateMatrix();
            rod2.matrixAutoUpdate = false;
            Curtains.add(rod2);
        }
    }

    // ---------- LED DỌC TẦNG ----------
    for (const side of [1, -1]) {
        const xLed = side * (WALL_X - 0.02);
        const ledLow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, L - 1.0), matLEDBlue);
        ledLow.position.set(xLed, 2.37, 0.5);
        ledLow.updateMatrix();
        ledLow.matrixAutoUpdate = false;
        Led.add(ledLow);
        const ledUp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, L - 1.0), matLEDBlue);
        ledUp.position.set(xLed, 3.40, 0.5);
        ledUp.updateMatrix();
        ledUp.matrixAutoUpdate = false;
        Led.add(ledUp);
    }
}

// ============================================================
// EXPORT
// ============================================================
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

    // Đèn nội thất (thêm các đèn điểm)
    const lights = [];
    const mkLight = (x, y, z, intensity) => {
        const pl = new THREE.PointLight(0x9fd8ff, intensity, 5, 2);
        pl.position.set(x, y, z);
        pl.userData.base = intensity;
        groups.Lights.add(pl);
        lights.push(pl);
    };
    mkLight(0, 3.25, 2.0, 0.6);
    mkLight(0, 3.25, -3.0, 0.6);
    mkLight(0, 2.0, 2.0, 0.5);
    mkLight(0, 2.0, -3.0, 0.5);
    mkLight(0, 2.6, 5.0, 0.4);

    function setInteriorLed(on) {
        // LED materials
        matLEDBlue.emissiveIntensity = on ? 2.8 : 0;
        matLEDNude.emissiveIntensity = on ? 3.0 : 0;
        matLEDRib.emissiveIntensity = on ? 1.6 : 0;
        matLEDWhite.emissiveIntensity = on ? 1.1 : 0;
        matLED.emissiveIntensity = on ? 2.2 : 0;
        matCluster.emissiveIntensity = on ? 0.6 : 0.1;

        // Point lights cho 3 dải LED
        const centerLight = groups.Lights.getObjectByName('centerLedLight');
        const leftLight = groups.Lights.getObjectByName('leftLedLight');
        const rightLight = groups.Lights.getObjectByName('rightLedLight');
        const intensity = on ? 0.8 : 0;
        if (centerLight) centerLight.intensity = intensity;
        if (leftLight) leftLight.intensity = intensity * 0.7;
        if (rightLight) rightLight.intensity = intensity * 0.7;

        // Các đèn nội thất khác
        for (const pl of lights) {
            pl.intensity = on ? pl.userData.base : 0;
        }
    }

    root.setInteriorLed = setInteriorLed;
    // Mặc định LED bật
    setInteriorLed(true);

    return root;
}