// js/interior.js
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

const matLEDBlue = new THREE.MeshStandardMaterial({
    color: 0x001118,
    emissive: 0x2fb6ff,
    emissiveIntensity: 2.5
});
// Ban dau la 0xe8c9a0 (kem/kho mo) - tach lam 2 ton: giua kem, hai ben xanh.
// That te thi matLEDNude chi chiem 1 day (centerLed) nhung chinh no la day to nhat
// va nam ngay tren aisle, trong khi cac diem chieu cung mau kem la nhung diem manh nhat
// (centerLedLight int 6 / dist 18). Ket qua: day LED nhin xanh ma anh sang len ghe,
// tran, aisle lai mau TRANG. Dong bo het ve xanh 0x2fb6ff - mau da dung cho matLEDBlue.
const matLEDNude = new THREE.MeshStandardMaterial({
    color: 0x001118,
    emissive: 0x2fb6ff,
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

const matAisle = new THREE.MeshStandardMaterial({ color: 0xcc6a6a, roughness: 0.6, metalness: 0.1 });
const matDivider = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.9 });
const matUpperFloor = new THREE.MeshStandardMaterial({ color: 0xd0c8b8, roughness: 0.8 });
const matBtn = new THREE.MeshStandardMaterial({ color: 0x333344 });
const matFloorPax = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
const matScreen = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, emissive: 0x224488, emissiveIntensity: 0.3 });

function box(w, h, d, mat, x, y, z, group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
}

// Dùng cho táp-lô rebuild: như box() nhưng hỗ trợ nghiêng quanh trục X
// (mặt trên táp-lô nghiêng nhẹ về kính trước) — rotate TRƯỚC updateMatrix
// vì mesh bị freeze matrix (matrixAutoUpdate=false).
function dashPiece(w, h, d, mat, x, y, z, group, rotX) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rotX || 0;
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
}

function dashPieceSphere(r, mat, x, y, z, group) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6), mat);
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

    // ===== TÁP-LÔ (REBUILD — hết dạng "bàn": không còn slab nổi + phần thả lơ lửng) =====
    // Cấu trúc khối kín: mặt trên nghiêng nhẹ (đá cản gió vùng kính) + mặt trước
    // đứng + vách hai bên xuống gần sàn + kick chỗ chân + knee console ghế lái.
    // Toàn bộ nằm y 0.36..1.25, x ±1.13 (chạm cột cạnh), z 4.87..5.97 — sát kính
    // (kính trước y1.1..2.5 @z6.0). Mắt tài xế (camera.js: x-0.35, y1.28, z4.75)
    // vẫn nhìn xuyên qua trên mép dash về kính/đường.
    // NEU COCKPIT RUNTIME (bus.js createDriverCockpit findMesh bám theo KÍCH
    // THƯỚC mesh): màn 0.5×0.25×0.05, cluster 0.35×0.2×0.05, gauge 0.25×0.15×0.05
    // và 4 nút 0.04³ — giữ nguyên kích thước, chỉ dời vị trí lên mặt dash mới.
    {
        dashPiece(2.26, 0.055, 1.10, matDashboardPanel, 0, 1.175, 5.42, Dashboard, 0.08); // mặt trên nghiêng
        dashPiece(2.26, 0.38, 0.05, matDashboard, 0, 0.926, 5.785, Dashboard, 0);         // mặt trước (gắn đồng hồ/màn)
        dashPiece(2.26, 0.37, 0.05, matDashboard, 0, 0.551, 5.785, Dashboard, 0);         // kick panel chỗ chân
        dashPiece(0.05, 0.72, 0.92, matDashboard, -1.115, 0.875, 5.30, Dashboard, 0);     // vách trái (dừng trước cột kính z5.77)
        dashPiece(0.05, 0.72, 0.92, matDashboard, 1.115, 0.875, 5.30, Dashboard, 0);      // vách phải (dừng trước cột kính z5.77)
        // Knee console: gọn nhẹ, lùi sát kick panel (z5.65) để không nhô ra trước volang.
        // Kích thước nhỏ: rộng 0.45, cao 0.25, sâu 0.18 — chỉ đỡ gối, không thành "bàn".
        dashPiece(0.45, 0.25, 0.18, matDashboard, -0.35, 0.68, 5.65, Dashboard, 0);        // knee console ghế lái (gọn, sát dash)

        dashPiece(0.5, 0.25, 0.05, matScreen, 0, 0.94, 5.83, Dashboard, 0);               // màn trung tâm
        dashPiece(0.35, 0.2, 0.05, matCluster, -0.45, 0.99, 5.83, Dashboard, 0);          // cluster tốc độ (trước T/L)
        dashPiece(0.25, 0.15, 0.05, matCluster, 0.45, 0.98, 5.83, Dashboard, 0);          // gauge phụ (copilot)
        for (let i = 0; i < 4; i++) {
            dashPiece(0.04, 0.04, 0.04, matBtn, -0.3 + i * 0.15, 0.80, 5.82, Dashboard, 0);
        }

        dashPiece(0.015, 0.25, 0.015, matDark, 0.25, 0.9, 5.83, Dashboard, 0);            // cần gạt (montag lên mặt dash)
        dashPieceSphere(0.025, matDark, 0.25, 1.055, 5.83, Dashboard);
    }

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
    box(0.5, 0.2, 0.25, matDashboard, 0.85, 0.7, 5.1, Dashboard);
    box(0.4, 0.05, 0.2, matDashboardPanel, 0.85, 0.85, 5.15, Dashboard);
}

function buildPassengerCabin(groups) {
    const { Beds, Floor, Ceiling, Curtains, Windows, Cabins, Aisle, Led, BodyShell, Lights } = groups;

    // ---------- BẬC LÊN CABIN ----------
    const PASSENGER_FLOOR_OFFSET = 0.3;
    const PASSENGER_FLOOR_Y = FLOOR_Y + PASSENGER_FLOOR_OFFSET;
    const stepWidth = 1.2;
    const stepDepth = 0.4;
    const stepHeight = PASSENGER_FLOOR_OFFSET;
    box(stepWidth, stepHeight, stepDepth, matShell, -0.7, stepHeight/2, CABIN_END_Z + 0.2, Aisle);
    box(stepWidth, stepHeight, stepDepth, matShell, 0.7, stepHeight/2, CABIN_END_Z + 0.2, Aisle);
    box(0.8, stepHeight, stepDepth, matShell, 0, stepHeight/2, CABIN_END_Z + 0.2, Aisle);

    // ---------- SÀN KHOANG HÀNH KHÁCH ----------
    box(W - 0.1, 0.08, L - 0.5, matFloorPax, 0, PASSENGER_FLOOR_Y - 0.04, 0, Floor);

    // ---------- HÀNH LANG ----------
    const aisleWidth = 0.8;
    const aisleLength = L - 0.5;
    const aisleCenterZ = 0.25;
    box(aisleWidth, 0.06, aisleLength, matAisle, 0, PASSENGER_FLOOR_Y + 0.02, aisleCenterZ, Aisle);
    for (const side of [1, -1]) {
        box(0.035, 0.035, aisleLength, matLEDBlue, side * (aisleWidth / 2 - 0.025), PASSENGER_FLOOR_Y + 0.07, aisleCenterZ, Aisle);
        box(0.045, 0.05, aisleLength, matDivider, side * (aisleWidth / 2), PASSENGER_FLOOR_Y + 0.04, aisleCenterZ, Aisle);
    }
    const cabinAisleLength = 1.2;
    box(aisleWidth, 0.06, cabinAisleLength, matAisle, 0, PASSENGER_FLOOR_Y + 0.02, CABIN_END_Z + cabinAisleLength / 2, Aisle);
    for (const side of [1, -1]) {
        box(0.035, 0.035, cabinAisleLength, matLEDBlue, side * (aisleWidth / 2 - 0.025), PASSENGER_FLOOR_Y + 0.07, CABIN_END_Z + cabinAisleLength / 2, Aisle);
    }

    // ---------- TRẦN & 3 DẢI LED ----------
    box(W - 0.06, 0.04, L - 0.5, matCream, 0, CEILING_Y + 0.02, 0, Ceiling);

    const centerLed = box(0.06, 0.02, L - 0.8, matLEDNude, 0, CEILING_Y - 0.005, 0.5, Led);
    centerLed.name = "centerLed";

    for (const side of [1, -1]) {
        const sideLed = box(0.04, 0.02, L - 0.8, matLEDBlue, side * 0.22, CEILING_Y - 0.005, 0.5, Led);
        sideLed.name = side > 0 ? "rightLed" : "leftLed";
    }

    for (let z = 3.5; z >= -5.0; z -= 0.45) {
        box(0.45, 0.015, 0.06, matLEDRib, 0, CEILING_Y - 0.005, z, Led);
    }
    for (const side of [1, -1]) {
        box(0.02, 0.03, L - 0.8, matLEDBlue, side * 1.05, CEILING_Y - 0.04, 0.5, Led);
    }

    // ---------- ĐÈN POINT LIGHT ----------
    // Hệ thống đèn cabin thực tế: đèn chính giữa + đèn hai bên + đèn dải LED dọc cabin
    // Tất cả đèn có distance đủ lớn để chiếu toàn bộ cabin 12m, decay = 1.0 (giảm dần tự nhiên)
    
    // Đèn chính giữa - chiếu toàn bộ cabin giữa.
    // Gu luc 0xffeeb8 (trang am), nhung chinh no la diem manh nhat (int 6, dist 18, ngay giua tran)
    // nen no quyet dinh mau anh sang tren ghe/aisle -> lam LED xanh phat ra anh TRANG.
    // Doi sang mau xanh 0x88ccff da dung cua leftLedLight/rightLedLight de dong bo.
    const centerLight = new THREE.PointLight(0x88ccff, 0, 18, 1.0);
    centerLight.position.set(0, CEILING_Y - 0.15, 0);
    centerLight.name = "centerLedLight";
    Lights.add(centerLight);

    // Đèn hai bên (xanh dương nhẹ) - chiếu bên hông ghế ngồi
    const leftLight = new THREE.PointLight(0x88ccff, 0, 16, 1.0);
    leftLight.position.set(-0.8, CEILING_Y - 0.15, 0);
    leftLight.name = "leftLedLight";
    Lights.add(leftLight);

    const rightLight = new THREE.PointLight(0x88ccff, 0, 16, 1.0);
    rightLight.position.set(0.8, CEILING_Y - 0.15, 0);
    rightLight.name = "rightLedLight";
    Lights.add(rightLight);

    // Đèn dải LED dọc cabin - phân bố đều mỗi 2m (7 đèn dọc cabin 12m)
    const ledStripPositions = [5.0, 3.3, 1.6, 0, -1.6, -3.3, -5.0];
    const ledStripLights = [];
    
    for (let i = 0; i < ledStripPositions.length; i++) {
        const z = ledStripPositions[i];
        
        // Đèn dải giữa - dong bo mau xanh voi day LED (matLEDNude da doi sang 0x2fb6ff)
        const centerStrip = new THREE.PointLight(0x88ccff, 0, 10, 1.0);
        centerStrip.position.set(0, CEILING_Y - 0.08, z);
        centerStrip.name = `centerLedStrip_${i}`;
        centerStrip.userData.base = 1.0;
        Lights.add(centerStrip);
        ledStripLights.push(centerStrip);
        
        // Đèn dải hai bên (xanh dương nhẹ)
        for (const side of [1, -1]) {
            const sideStrip = new THREE.PointLight(0x88ccff, 0, 8, 1.0);
            sideStrip.position.set(side * 0.7, CEILING_Y - 0.08, z);
            sideStrip.name = `sideLedStrip_${side}_${i}`;
            sideStrip.userData.base = 0.7;
            Lights.add(sideStrip);
            ledStripLights.push(sideStrip);
        }
    }

    // Đèn đầu/đuôi cabin (gần cửa) - cường độ cao hơn
    const frontLight = new THREE.PointLight(0x88ccff, 0, 12, 1.0);
    frontLight.position.set(0, CEILING_Y - 0.1, L * 0.45);
    frontLight.name = "frontLedLight";
    Lights.add(frontLight);

    const rearLight = new THREE.PointLight(0x88ccff, 0, 12, 1.0);
    rearLight.position.set(0, CEILING_Y - 0.1, -L * 0.45);
    rearLight.name = "rearLedLight";
    Lights.add(rearLight);

    // Lưu tham chiếu cho setInteriorLed
    groups.ledStripLights = ledStripLights;

    // ---------- THÂN XE ----------
    const shellLen = L - 0.6;
    for (const side of [1, -1]) {
        box(0.04, WIN_LO_BOT - PASSENGER_FLOOR_Y, shellLen, matShell, side * WALL_X, (PASSENGER_FLOOR_Y + WIN_LO_BOT) / 2, 0, BodyShell);
        box(0.04, WIN_HI_BOT - WIN_LO_TOP, shellLen, matShell, side * WALL_X, (WIN_LO_TOP + WIN_HI_BOT) / 2, 0, BodyShell);
        box(0.04, CEILING_Y - WIN_HI_TOP, shellLen, matShell, side * WALL_X, (WIN_HI_TOP + CEILING_Y) / 2, 0, BodyShell);
    }

    // ---------- SÀN TẦNG TRÊN ----------
    const upperFloorY = UPPER_BED_Y - 0.05;
    const floorThick = 0.08;
    for (const side of [1, -1]) {
        const xFloor = side * (WALL_X - 0.1);
        box(0.02, floorThick, shellLen, matUpperFloor, xFloor, upperFloorY, 0, BodyShell);
    }

    // ---------- GIƯỜNG 24 CÁI ----------
    const xPosAbs = 0.75;
    const pillowOffset = BED_LENGTH / 2 - 0.25;
    const dividerHeight = CEILING_Y - PASSENGER_FLOOR_Y;
    const dividerY = (PASSENGER_FLOOR_Y + CEILING_Y) / 2;
    const dividerThick = 0.02;
    const dividerWidth = BED_WIDTH + 0.04;

    for (const side of [1, -1]) {
        const xPos = side * xPosAbs;
        for (const z of BED_Z_POSITIONS) {
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

    // ---------- CỬA SỔ 2 TẦNG ----------
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

    // ---------- RÈM CỬA ----------
    // REM CUA dung vat lieu module chung (matFabric/matFabricDark/matDark).
    for (const side of [1, -1]) {
        const xCurtain = side * (WALL_X - 0.02);
        const xAisle = side * 0.32;
        for (const z of BED_Z_POSITIONS) {
            const curtainLow = new THREE.Mesh(new THREE.BoxGeometry(0.02, WIN_LO_TOP - WIN_LO_BOT, 0.35), matFabric);
            curtainLow.position.set(xCurtain, (WIN_LO_BOT + WIN_LO_TOP) / 2, z - 0.50);
            curtainLow.updateMatrix();
            curtainLow.matrixAutoUpdate = false;
            Curtains.add(curtainLow);
            const curtainUp = new THREE.Mesh(new THREE.BoxGeometry(0.02, WIN_HI_TOP - WIN_HI_BOT, 0.35), matFabricDark);
            curtainUp.position.set(xCurtain, (WIN_HI_BOT + WIN_HI_TOP) / 2, z - 0.50);
            curtainUp.updateMatrix();
            curtainUp.matrixAutoUpdate = false;
            Curtains.add(curtainUp);
            const aisleCurtainLow = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.85, 0.35), matFabric);
            aisleCurtainLow.position.set(xAisle, 1.90, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainLow.updateMatrix();
            aisleCurtainLow.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainLow);
            const aisleCurtainUp = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.75, 0.35), matFabricDark);
            aisleCurtainUp.position.set(xAisle, 3.00, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainUp.updateMatrix();
            aisleCurtainUp.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainUp);
            const rod1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, BED_LENGTH - 0.1), matDark);
            rod1.position.set(xAisle, 0.58, z);
            rod1.updateMatrix();
            rod1.matrixAutoUpdate = false;
            Curtains.add(rod1);
            const rod2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, BED_LENGTH - 0.1), matDark);
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
    const mkLight = (x, y, z, intensity) => {
        const pl = new THREE.PointLight(0x9fd8ff, intensity, 8, 2);
        pl.position.set(x, y, z);
        pl.userData.base = intensity;
        groups.Lights.add(pl);
        lights.push(pl);
    };
    mkLight(0, 3.25, 2.0, 1.0);
    mkLight(0, 3.25, -3.0, 1.0);
    mkLight(0, 2.0, 2.0, 0.8);
    mkLight(0, 2.0, -3.0, 0.8);
    mkLight(0, 2.6, 5.0, 0.6);

    function setInteriorLed(on) {
        // Emissive materials cho dải LED mesh
        matLEDBlue.emissiveIntensity = on ? 5.0 : 0;
        matLEDNude.emissiveIntensity = on ? 5.5 : 0;
        matLEDRib.emissiveIntensity = on ? 3.5 : 0;
        matCluster.emissiveIntensity = on ? 1.0 : 0.1;

        // --- PointLights chính ---
        const centerLight = groups.Lights.getObjectByName('centerLedLight');
        const leftLight = groups.Lights.getObjectByName('leftLedLight');
        const rightLight = groups.Lights.getObjectByName('rightLedLight');
        const frontLight = groups.Lights.getObjectByName('frontLedLight');
        const rearLight = groups.Lights.getObjectByName('rearLedLight');

        const baseIntensity = on ? 1.0 : 0;

        // BUG 6 FIX (game khuyng vai giay khi bam F/L):
        // Truoc do moi lan `setInteriorLed()` de `light.visible = on` cho ~15 PointLight
        // (center/left/right/front/rear + 7 ledStrip + mkLight). Trong Three.js r160
        // (vendor/three), `numPointLights` + `numSpotLights` nam TRONG program cache key
        // (three.module.js:20870, 21000) va `lights.state.version` tang khi length doi
        // (:21927) -> `needsProgramChange = true` cho TOAN BO MeshStandardMaterial
        // (:30188) -> `gl.linkProgram()` DONG BO ngay frame do (:20269, khong dung
        // KHR_parallel_shader_compile). Tren Intel UHD N5000 = dot 1-3 giay.
        // Giai thich "khong phai lan nao cung xay": chi tinh config nao chua co trong
        // program cache -> lan dau xay dung dot, lan sau da cache thi menh.
        // CACH SUA: GIU `visible = true` moi luc, chi tat bang `intensity = 0`.
        //   - Den van duoc hien thi/bat tat binh thuong (khong loai bo hieu ung den)
        //   - Light count CO DINH -> khong recompile -> khong dot
        //   - Per-frame khong te hon baseline vi luc load toan bo den da visible = true
        //   - Mesh LED (`obj.visible = on` o duoi) van GIU NGUYEN: mesh visibility
        //     khong nam trong program key nen khong gay recompile.
        const vis = true;   // giu den luon co trong render list (chi intensity moi doi)

        // Đèn chính giữa (trắng ấm) - mạnh nhất
        if (centerLight) { centerLight.intensity = baseIntensity * 6.0; centerLight.visible = vis; }
        // Đèn hai bên (xanh dương nhẹ)
        if (leftLight) { leftLight.intensity = baseIntensity * 5.0; leftLight.visible = vis; }
        if (rightLight) { rightLight.intensity = baseIntensity * 5.0; rightLight.visible = vis; }
        // Đèn đầu/đuôi cabin
        if (frontLight) { frontLight.intensity = baseIntensity * 4.5; frontLight.visible = vis; }
        if (rearLight) { rearLight.intensity = baseIntensity * 4.5; rearLight.visible = vis; }

        // --- LED Strip Lights dọc cabin ---
        if (groups.ledStripLights) {
            groups.ledStripLights.forEach((pl, i) => {
                if (!pl) return;
                const factor = [0.7, 0.9, 1.0, 1.0, 1.0, 0.9, 0.7][i] || 0.8;
                pl.intensity = baseIntensity * 5.0 * factor;
                pl.visible = vis;
            });
        }

        // --- Đèn đầu/đuôi cabin ---
        if (frontLight) { frontLight.intensity = baseIntensity * 4.5; frontLight.visible = vis; }
        if (rearLight) { rearLight.intensity = baseIntensity * 4.5; rearLight.visible = vis; }

        // --- Emissive materials cho dải LED mesh ---
        matLEDBlue.emissiveIntensity = on ? 5.0 : 0;
        matLEDNude.emissiveIntensity = on ? 5.5 : 0;
        matLEDRib.emissiveIntensity = on ? 3.5 : 0;
        matCluster.emissiveIntensity = on ? 1.0 : 0.1;

        // --- Các đèn phụ (mkLight) ---
        for (const pl of lights) {
            pl.intensity = on ? pl.userData.base * 1.5 : 0;
            pl.visible = vis;
        }

        // --- LED strip meshes (dải LED nhìn thấy được) ---
        const ledStrips = groups.Led;
        if (ledStrips) {
            ledStrips.traverse((obj) => {
                if (obj.isMesh && (obj.material === matLEDBlue || obj.material === matLEDNude || obj.material === matLEDRib)) {
                    obj.visible = on;
                }
            });
        }
    }

    root.setInteriorLed = setInteriorLed;
    setInteriorLed(true);

    return root;
}
