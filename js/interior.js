function wallBoxSide(w, h, d, mat, x, y, zCenter, group, side, doorCut) {
    if (!(side < 0 && doorCut)) return box(w, h, d, mat, x, y, zCenter, group);
    const z0 = zCenter - d / 2, z1 = zCenter + d / 2;
    const y0 = y - h / 2, y1 = y + h / 2;
    const dz0 = doorCut.z0, dz1 = doorCut.z1;
    const dy0 = doorCut.y0 ?? -1e9, dy1 = doorCut.y1 ?? 1e9;
    if (dz1 <= z0 || dz0 >= z1 || dy1 <= y0 || dy0 >= y1) return box(w, h, d, mat, x, y, zCenter, group);
    if (dz0 - z0 > 1e-4) box(w, h, dz0 - z0, mat, x, y, (z0 + dz0) / 2, group);
    if (z1 - dz1 > 1e-4) box(w, h, z1 - dz1, mat, x, y, (dz1 + z1) / 2, group);
    const cz0 = Math.max(z0, dz0), cz1 = Math.min(z1, dz1);
    const above = y1 - Math.max(y0, dy1);
    if (above > 1e-4) box(w, above, cz1 - cz0, mat, x, Math.max(y0, dy1) + above / 2, (cz0 + cz1) / 2, group);
    const below = Math.min(y1, dy0) - y0;
    if (below > 1e-4) box(w, below, cz1 - cz0, mat, x, y0 + below / 2, (cz0 + cz1) / 2, group);
    return null;
}

import * as THREE from "three";

const L = 12, W = 2.4, H = 3.3;
// ===== TÁI CẤU TRÚC CHIỀU CAO HAI TẦNG (Thaco Mobihome — neo theo texture vỏ xe) =====
// Texture vỏ xe (bus.js, PX.sideR) định nghĩa 2 dải kính CỐ ĐỊNH trong texture:
//   Kính dưới : y 1.920 … 2.441
//   Dải đen phân tầng: y 2.441 … 2.843
//   Kính trên : y 2.843 … 3.405
//   Gầm xe    : y 0.307 (BODY_BOTTOM — thân xe bắt đầu)
// Sàn hành khách NÂNG LÊN ~1m → khoảng trống 0.307..0.92 để trống cho khoang
// hành lý tương lai. Nội thất (giường/vách/kính nội thất/đèn) neo theo các dải
// kính của vỏ xe, KHÔNG neo theo số cũ của cấu hình phòng 20/34.
const FLOOR_Y = 1.00, CEILING_Y = 3.6;   // sàn khoang hành khách / trần
const UPPER_FLOOR_Y = 2.49;              // sàn tầng trên (vách phân tầng) — mép y 2.45..2.53
const WALL_X = 1.15;
const CABIN_END_Z = 4.8;
// Texture WELCOME dùng CHUNG cho mọi lần dựng platform bậc lên (không tạo lại
// CanvasTexture khi đổi cấu hình nội thất 20 phòng <-> 34 giường).
let _welcomePlateShared = { tex: null };

const BED_WIDTH = 0.7;
const BED_LENGTH = 1.7;
const BED_Z_POSITIONS = [1.85, 2.05, 0.25, -1.85, -3.5, -5.15];
const LOWER_BED_Y = 1.62;
const UPPER_BED_Y = 2.69;

// Kính nội thất PHẢI trùng dải kính vẽ trong texture vỏ xe (bus.js):
const WIN_LO_BOT = 1.92;
const WIN_LO_TOP = 2.44;
const WIN_HI_BOT = 2.845;
const WIN_HI_TOP = 3.405;

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
const matDashboard = new THREE.MeshStandardMaterial({ color: 0x252540, roughness: 0.55, metalness: 0.2 });
const matDashboardPanel = new THREE.MeshStandardMaterial({ color: 0x2e2e46, roughness: 0.4, metalness: 0.3 });
const matCluster = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x35ffd0, emissiveIntensity: 0.6, roughness: 0.3 });
const matSteeringWheel = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.7 });
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
const matScreen = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, emissive: 0x2f6fbf, emissiveIntensity: 0.5 });

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

    // Kính buồng lái 2 bên + khung viền.
    // LƯU Ý (CHẶN CỬA): bên -x LÀ CỬA LÊN XE — lỗ cửa z 5.14..6.19 cắt
    // y 0.31..2.75 trong vỏ xe (bus.js wallQuad). Kính/khung lẻ bên -x đứng
    // NGUYÊN tại z 5.5 (y 0.8..2.4) sẽ chặn lối đi BẤT KỂ cửa đóng/mở — cửa
    // trượt mở vẫn bị tấm "kính giả" bịt lại. Lối vào CHỈ còn thông thoáng khi
    // bỏ cặp kính-khung BÊN TRÁI (bề mặt cửa đã có kínhhình vẽ trên texture
    // + door mesh bus.js). Bên +x giữ nguyên (cửa sổ ghế lái, RHD).
    for (const side of [1, -1]) {
        if (side < 0) continue;   // cửa bên -x: không dựng kính/khung tĩnh
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

    // Keep the front frame but leave the stair-width entry corridor clear.
    const addFrontCrossbar = (y, h) => {
        const xMin = -1.05, xMax = 1.05;
        const entryMin = -1.12, entryMax = -0.40;
        const segments = [
            [xMin, Math.min(xMax, entryMin)],
            [Math.max(xMin, entryMax), xMax]
        ];
        for (const [x0, x1] of segments) {
            if (x1 > x0) box(x1 - x0, h, 0.06, matShell, (x0 + x1) / 2, y, 6.0, BodyShell);
        }
    };
    addFrontCrossbar(2.5, 0.04);
    addFrontCrossbar(1.1, 0.06);
    // Khung trước: bên -x chừa không gian gần mép cửa (aperture tới z 6.189) — chỉ dựng đoạn an toàn
    box(0.04, 1.5, 0.06, matShell, -1.05, 1.8, 5.00, BodyShell);
    box(0.04, 1.5, 0.06, matShell, 1.05, 1.8, 6.0, BodyShell);
    // Cột tiền buồng lái: CHỈ bên +x. Bên -x (x = -WALL_X) tại z 5.8 nằm GIỮA
    // khoang cửa lên xe (aperture thân xe z 5.139..6.189, bus.js) — giữ cột này
    // sẽ chặn lối đi khi cửa mở. Bề mặt cửa do door mesh + bodyDoorWall quản lý.
    box(0.06, 1.8, 0.06, matShell, WALL_X, 1.8, 5.8, BodyShell);

    // ===== TÁP-LÔ (PHASE 3 REBUILD — THACO Mobihome style) =====
    // Dashboard bao gồm 5 vùng chức năng:
    //   - Vùng trên: mặt nghiêng chắn kính + dải chrome + LED thông báo
    //   - Vùng giữa: cụm đồng hồ + màn thông tin + cửa gió + nút bấm
    //   - Vùng dưới: kick panel + bàn đạp + hộp đựng đồ
    //   - Vách hai bên và cột chuyển đổi mềm
    //   - Ghế lái + ghế phụ phía trước
    //
    // QUAN TRỌNG (bus.js createDriverCockpit findMesh):
    //   màn 0.5×0.25×0.05, cluster 0.35×0.2×0.05, gauge 0.25×0.15×0.05, nút 0.04³
    //   — giữ nguyên kích thước, chỉ cải tiến vị trí và chi tiết thêm.
    {
        // --- Mặt trên (có độ sâu 3D, cong nhẹ) ---
        dashPiece(2.26, 0.055, 1.10, matDashboardPanel, 0, 1.175, 5.42, Dashboard, 0.08); // mặt trên nghiêng
        // Thêm lớp đệm đường cong phía trước mặt trên
        dashPiece(2.26, 0.025, 0.18, matDashboard, 0, 1.148, 5.88, Dashboard, 0.04);

        // --- Cụm giải trí + đồng hồ (giữ kích thước cho bus.js) ---
        dashPiece(2.26, 0.38, 0.05, matDashboard, 0, 0.926, 5.785, Dashboard, 0);           // mặt trước
        dashPiece(2.26, 0.37, 0.05, matDashboard, 0, 0.551, 5.785, Dashboard, 0);           // kick panel
        // KHÔNG dựng vách bên -x (cửa lên xe): tấm vách đứng y 0.51..1.24
        // z 4.84..5.76 sẽ bịt lối vào người đi lên cầu thang (panel che lối
        // vào → loại theo Mission 2). Chỉ giữ vách bên +x (ghế lái).
        dashPiece(0.05, 0.72, 0.92, matDashboard, 1.115, 0.875, 5.30, Dashboard, 0);        // vách phải (ghế lái)
        dashPiece(0.45, 0.25, 0.18, matDashboard, 0.65, 0.68, 5.65, Dashboard, 0);          // knee console ghế lái


        // THACO Mobihome style infotainment (giữ kích thước cho bus.js)
        dashPiece(0.54, 0.29, 0.015, matDashboardPanel, 0, 0.94, 5.818, Dashboard, 0);      // viền màn hình
        dashPiece(0.5, 0.25, 0.05, matScreen, 0, 0.94, 5.83, Dashboard, 0);                 // màn trung tâm

        // Cụm đồng hồ (RHD: trước tài xế bên PHẢI)
        dashPiece(0.35, 0.2, 0.05, matCluster, 0.45, 0.99, 5.83, Dashboard, 0);             // cluster tốc độ
        dashPiece(0.25, 0.15, 0.05, matCluster, -0.45, 0.98, 5.83, Dashboard, 0);           // gauge phụ (copilot)

        // Nút bấm + công tắc (giữ kích thước 0.04 cho bus.js)
        for (let i = 0; i < 4; i++) {
            dashPiece(0.04, 0.04, 0.04, matBtn, 0.3 - i * 0.15, 0.80, 5.82, Dashboard, 0);
        }

        // Cần gạt (gương theo trục)
        dashPiece(0.015, 0.25, 0.015, matDark, -0.25, 0.9, 5.83, Dashboard, 0);
        dashPieceSphere(0.025, matDark, -0.25, 1.055, 5.83, Dashboard);

        // --- Cửa gió điều hòa (THACO Mobihome style: 2 cửa giữa, 2 cửa hai bên) ---
        for (const gx of [-0.2, 0.2]) {
            dashPiece(0.14, 0.05, 0.02, matDark, gx, 1.02, 5.815, Dashboard, 0);
            for (let vi = 0; vi < 3; vi++) {
                dashPiece(0.11, 0.008, 0.01, matDashboardPanel, gx, 1.0 + vi * 0.015, 5.808, Dashboard, 0);
            }
        }

        // Cửa gió bên trái và phải (thêm cho THACO style)
        for (const gx of [-1.0, 1.0]) {
            dashPiece(0.12, 0.06, 0.02, matDark, gx, 1.05, 5.815, Dashboard, 0);
            for (let vi = 0; vi < 2; vi++) {
                dashPiece(0.09, 0.008, 0.01, matDashboardPanel, gx, 1.04 + vi * 0.02, 5.808, Dashboard, 0);
            }
        }

        // Dải chrome ngang + LED trang trí
        dashPiece(2.2, 0.01, 0.01, matDashboardPanel, 0, 1.09, 5.805, Dashboard, 0);
        dashPiece(2.2, 0.006, 0.006, matLEDBlue, 0, 1.072, 5.806, Dashboard, 0);

        // Nút bấm bổ sung (THACO style: công tắc đèn, điều hòa, kèn)
        for (const [gx, gy, gz] of [[-0.8, 0.85, 5.82], [0.8, 0.85, 5.82], [-0.6, 0.78, 5.82], [0.6, 0.78, 5.82]]) {
            dashPiece(0.03, 0.03, 0.03, matBtn, gx, gy, gz, Dashboard, 0);
        }

        // --- Bàn đạp (ga, phanh, côn — phía chân tài xế, RHD bên phải) ---
        // RHD: bàn đạp bên phải (+0.65)
        dashPiece(0.12, 0.08, 0.03, matDark, 0.58, 0.35, 5.70, DriverArea, 0);   // bàn ga
        dashPiece(0.12, 0.06, 0.03, matDark, 0.42, 0.38, 5.72, DriverArea, 0);   // bàn phanh
        dashPiece(0.10, 0.06, 0.03, matDark, 0.28, 0.38, 5.74, DriverArea, 0);   // bàn côn
        dashPiece(0.25, 0.02, 0.15, matDark, 0.65, 0.12, 5.85, DriverArea, 0);   // tấm đệm chân

        // --- Cần số (giữa hai ghế, bên phải tài xế RHD: x=+0.28) ---
        dashPieceSphere(0.032, matDark, 0.28, 0.78, 4.90, DriverArea);            // tay nắm cần số
        dashPiece(0.014, 0.22, 0.014, matDark, 0.28, 0.68, 4.90, DriverArea, 0); // thân cần số
        dashPiece(0.06, 0.04, 0.06, matDashboard, 0.28, 0.60, 4.90, DriverArea, 0); // đế cần số

        // --- Hộp đựng đồ + tủ lạnh nhỏ (THACO style) ---
        dashPiece(0.35, 0.18, 0.18, matDashboard, -0.65, 0.75, 5.70, Dashboard, 0); // ngăn kéo (phía ghế phụ)
        dashPiece(0.30, 0.12, 0.10, matDashboard, 0.85, 0.85, 5.75, Dashboard, 0);  // khoang nhỏ (phía lái)

        // --- Sàn lái (thấp hơn khoang hành khách, có bậc chuyển tiếp) ---
        // KHÔNG thò vào khoang hành lý: chỉ phủ buồng lái z ≥ CABIN_END_Z (4.8).
        dashPiece(1.8, 0.02, 1.05, matDark, 0, 0.06, 5.325, DriverArea, 0);   // sàn vùng lái

        // --- Ghế tài xế (nâng cấp: đệm, tựa lưng, tựa đầu, chân ghế) ---
        // RHD: ghế lái bên PHẢI (+0.65)
        // Đế và chân ghế
        box(0.52, 0.10, 0.52, matDark, 0.65, 0.15, 4.50, DriverArea);            // đế trượt ghế
        box(0.40, 0.06, 0.40, matDark, 0.65, 0.35, 4.50, DriverArea);            // khung ghế

        // Đệm ngồi (dày hơn, có hỗ trợ thắt lưng)
        box(0.50, 0.14, 0.50, matSeatCushion, 0.65, 0.48, 4.50, DriverArea);    // đệm ngồi chính
        box(0.50, 0.06, 0.12, matSeatCushion, 0.65, 0.50, 4.75, DriverArea);     // hỗ trợ thắt lưng

        // Tựa lưng (có độ nghiêng nhẹ)
        box(0.50, 0.55, 0.08, matSeatCushion, 0.65, 0.80, 4.25, DriverArea);    // tựa lưng chính
        box(0.42, 0.20, 0.06, matSeatCushion, 0.65, 0.98, 4.27, DriverArea);     // đệm tựa lưng trên

        // Tựa đầu
        box(0.30, 0.16, 0.06, matSeatCushion, 0.65, 1.14, 4.28, DriverArea);     // tựa đầu

        // Tay vịn + cần điều chỉnh
        box(0.03, 0.08, 0.30, matSeat, 0.92, 0.58, 4.50, DriverArea);            // tay vịn phải
        box(0.03, 0.08, 0.30, matSeat, 0.38, 0.58, 4.50, DriverArea);            // tay vịn trái

        // --- Ghế phụ (copilot, nâng cấp tương tự) — RHD: copilot bên TRÁI (-0.35) ---
        box(0.45, 0.08, 0.45, matDark, -0.35, 0.14, 4.50, DriverArea);           // đế ghế phụ
        box(0.06, 0.18, 0.06, matDark, -0.35, 0.28, 4.50, DriverArea);           // chân ghế phụ
        box(0.45, 0.12, 0.45, matSeatCushion, -0.35, 0.46, 4.50, DriverArea);    // đệm ghế phụ
        box(0.45, 0.45, 0.06, matSeatCushion, -0.35, 0.72, 4.30, DriverArea);    // tựa lưng ghế phụ
        box(0.25, 0.12, 0.04, matSeatCushion, -0.35, 0.95, 4.31, DriverArea);    // tựa đầu ghế phụ

        dashPiece(0.5, 0.2, 0.25, matDashboard, -0.85, 0.7, 5.1, Dashboard, 0);  // tủ đựng đồ phụ
        dashPiece(0.4, 0.05, 0.2, matDashboardPanel, -0.85, 0.85, 5.15, Dashboard, 0); // mặt trên tủ
    }

    const steerGroup = new THREE.Group();
    steerGroup.name = "legacySteeringWheel";
    steerGroup.position.set(-0.35, 1.1, 5.1);   // RHD: vô lăng gốc bên trái (bị ẩn runtime)
    // Vô-lăng xe khách: dày hơn, tỷ lệ thực tế, đúng góc nghiêng
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 12, 24), matSteeringWheel);
    ring.rotation.x = Math.PI / 2 - 0.25;
    ring.rotation.z = 0.05;
    steerGroup.add(ring);
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), matSteeringWheel);
        spoke.position.set(Math.sin(angle) * 0.14, 0, Math.cos(angle) * 0.14);
        spoke.rotation.y = -angle;
        steerGroup.add(spoke);
    }
    // Cột vô-lăng dày, nghiêng đúng
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.45, 12), matDark);
    column.position.set(0, -0.35, 0.05);
    column.rotation.x = 0.35;
    steerGroup.add(column);
    DriverArea.add(steerGroup);

    // RHD: ghế tài xế bên PHẢI (+0.65)
    box(0.5, 0.08, 0.5, matDark, 0.65, 0.14, 4.5, DriverArea);
    box(0.08, 0.2, 0.08, matDark, 0.65, 0.28, 4.5, DriverArea);
    box(0.5, 0.12, 0.5, matSeatCushion, 0.65, 0.44, 4.5, DriverArea);
    box(0.5, 0.55, 0.08, matSeatCushion, 0.65, 0.75, 4.25, DriverArea);
    box(0.3, 0.15, 0.06, matSeatCushion, 0.65, 1.05, 4.25, DriverArea);
    box(0.03, 0.08, 0.3, matSeat, 0.9, 0.5, 4.45, DriverArea);
    box(0.03, 0.08, 0.3, matSeat, 0.4, 0.5, 4.45, DriverArea);

    // RHD: ghế phụ bên TRÁI (-0.35)
    box(0.45, 0.06, 0.45, matDark, -0.35, 0.13, 4.5, DriverArea);
    box(0.06, 0.18, 0.06, matDark, -0.35, 0.25, 4.5, DriverArea);
    box(0.45, 0.1, 0.45, matSeatCushion, -0.35, 0.4, 4.5, DriverArea);
    box(0.45, 0.45, 0.06, matSeatCushion, -0.35, 0.65, 4.3, DriverArea);
    box(0.25, 0.12, 0.04, matSeatCushion, -0.35, 0.9, 4.3, DriverArea);
    box(0.5, 0.2, 0.25, matDashboard, -0.85, 0.7, 5.1, Dashboard);
    box(0.4, 0.05, 0.2, matDashboardPanel, -0.85, 0.85, 5.15, Dashboard);
}

function buildEntryStaircase(Aisle) {
    const PASSENGER_FLOOR_Y = FLOOR_Y;
    if (!_welcomePlateShared.tex) {
        const cv = document.createElement('canvas');
        cv.width = 512; cv.height = 128;
        const cctx = cv.getContext('2d');
        cctx.fillStyle = '#001318';
        cctx.fillRect(0, 0, 512, 128);
        cctx.shadowColor = '#2fb6ff';
        cctx.shadowBlur = 18;
        cctx.fillStyle = '#7fe0ff';
        cctx.font = 'bold 64px sans-serif';
        cctx.textAlign = 'center';
        cctx.textBaseline = 'middle';
        cctx.fillText('WELCOME', 256, 68);
        _welcomePlateShared.tex = new THREE.CanvasTexture(cv);
        _welcomePlateShared.tex.colorSpace = THREE.SRGBColorSpace;
    }
    const welcomeMat = new THREE.MeshBasicMaterial({
        map: _welcomePlateShared.tex, transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, depthWrite: false
    });
    const welcomeGeo = new THREE.PlaneGeometry(0.52, 0.12);
    // Căn sát cửa -x: stairX lệch về -x, z trải từ mép cabin ra giữa khoang cửa
    const stairW = 0.62, stairX = -0.76, treadDepth = 0.19;
    const zBase = CABIN_END_Z; // bậc cao nhất sát mép cabin
    const stepTops = [0.81, 0.625, 0.44, 0.25];   // từ trên xuống dưới
    const riserLow = [0.625, 0.44, 0.25, 0.06];
    for (let i = 0; i < stepTops.length; i++) {
        const yTop = stepTops[i];
        const zNear = zBase + treadDepth * i;
        const zFar  = zNear + treadDepth; // +z ra phía cửa/buồng lái
        box(stairW, yTop, treadDepth, matShell, stairX, yTop / 2, (zNear + zFar) / 2, Aisle);
        const plateY = (riserLow[i] + yTop) / 2;
        const plate = new THREE.Mesh(welcomeGeo, welcomeMat);
        // WELCOME trên mặt đứng riser — hướng +z (về phía người bước lên từ ngoài cửa)
        plate.position.set(stairX, plateY, zFar + 0.002);
        Aisle.add(plate);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(stairW - 0.06, 0.02, 0.02), matLEDBlue);
        lamp.position.set(stairX, yTop - 0.015, zFar - 0.01);
        Aisle.add(lamp);
    }
    // Bậc chuyển tiếp nối mặt trên cầu thang với sàn cabin.
    box(stairW, 0.06, 0.26, matAisle, stairX, PASSENGER_FLOOR_Y - 0.03, CABIN_END_Z - 0.13, Aisle);
    box(stairW, PASSENGER_FLOOR_Y, 0.12, matShell, stairX, PASSENGER_FLOOR_Y / 2, CABIN_END_Z - 0.06, Aisle);
}

function buildPassengerCabin(groups) {
    const { Beds, Floor, Ceiling, Curtains, Windows, Cabins, Aisle, Led, BodyShell, Lights } = groups;

    // ---------- SÀN KHOANG HÀNH KHÁCH (NÂNG LÊN ~1.0m) ----------
    // Sàn cabin cao 1.00m, CHỈ phủ khoang hành khách (z < CABIN_END_Z = 4.8).
    // Buồng lái GIỮ floor thấp (0.06) như cũ — ghế lái/pedals không bị chôn.
    // Khoang hành lý = khoảng trống 0.31 (BODY_BOTTOM) → 0.92 (đáy sàn),
    // giữ trống hoàn toàn, không mesh interior nào nằm trong đó.
    const PASSENGER_FLOOR_Y = FLOOR_Y;
    // zFront = CABIN_END_Z = 4.8, zRear = -L/2 + 0.15 = -5.85
    const zFront = CABIN_END_Z, zRear = -L / 2 + 0.15;
    const floorSpan = zFront - zRear;
    const floorCz = (zFront + zRear) / 2;
    box(W - 0.1, 0.08, floorSpan, matFloorPax, 0, PASSENGER_FLOOR_Y - 0.04, floorCz, Floor);
    // Mặt bịt khoang hành lý phía trước — CHỪA LỐI CẦU THANG căn theo cửa -x.
    // Staircase (buildEntryStaircase): stairX=-0.76, stairW=0.62 => x -1.07..-0.45.
    // Mở lỗ x -1.12..-0.40, y 0.28..FLOOR_Y để bậc thang đi lên không bị bịt.
    const sealH = PASSENGER_FLOOR_Y - 0.28;
    const sealY = (PASSENGER_FLOOR_Y + 0.28) / 2;
    const stOpenL = -1.12, stOpenR = -0.40;
    const bodyHalf = (W - 0.1) / 2; // 1.15
    // đoạn phải: từ stOpenR tới +bodyHalf
    box(bodyHalf - stOpenR, sealH, 0.06, matShell, (stOpenR + bodyHalf) / 2, sealY, CABIN_END_Z - 0.03, Floor);
    // đoạn trái xa: từ -bodyHalf tới stOpenL
    box(stOpenL - (-bodyHalf), sealH, 0.06, matShell, (-bodyHalf + stOpenL) / 2, sealY, CABIN_END_Z - 0.03, Floor);
    // Vách dưới (toàn thân y 0..0.28) — bịt kín đáy, không nhìn xuyên gầm.
    // Vách dưới (y 0..0.28) — bịt kín đáy, CHỪA LỖ CẦU THANG bên -x (stair gap x -1.12..-0.40)
    box(bodyHalf - stOpenR, 0.28, 0.06, matShell, (stOpenR + bodyHalf) / 2, 0.14, CABIN_END_Z - 0.03, Floor);
    box(stOpenL - (-bodyHalf), 0.28, 0.06, matShell, (-bodyHalf + stOpenL) / 2, 0.14, CABIN_END_Z - 0.03, Floor);
    // Vòm bánh xe trong cabin: bánh trước (z 3.65) / bánh sau (z -2.59) có
    // đỉnh y=1.05 > mặt sàn 1.00 — vòm che phần bánh thò (như xe giường nằm thật).
    for (const [wz] of [[3.65], [-2.59]]) {
        for (const side of [1, -1]) {
            box(0.52, 0.18, 1.16, matShell, side * 1.02, 1.01, wz, Floor);
        }
    }

    // ---------- CẦU THANG LÊN CABIN (buồng lái → khoang hành khách) ----------
    // 4 bậc + 1 riser cuối; chữ WELCOME trên từng mặt đứng riser (LED mũi bậc).
    buildEntryStaircase(Aisle);

    // ---------- HÀNH LANG (chỉ trong khoang hành khách, z < CABIN_END_Z) ----------
    const aisleWidth = 0.8;
    const aisleLength = zFront - zRear;                        // khớp sàn cabin
    const aisleCenterZ = (zFront + zRear) / 2;
    box(aisleWidth, 0.06, aisleLength, matAisle, 0, PASSENGER_FLOOR_Y + 0.02, aisleCenterZ, Aisle);
    for (const side of [1, -1]) {
        box(0.035, 0.035, aisleLength, matLEDBlue, side * (aisleWidth / 2 - 0.025), PASSENGER_FLOOR_Y + 0.07, aisleCenterZ, Aisle);
        box(0.045, 0.05, aisleLength, matDivider, side * (aisleWidth / 2), PASSENGER_FLOOR_Y + 0.04, aisleCenterZ, Aisle);
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
    const doorCut = { z0: 5.139, z1: 6.189, y0: 0.307, y1: 2.749 };
    for (const side of [1, -1]) {
        wallBoxSide(0.04, WIN_LO_BOT - PASSENGER_FLOOR_Y, shellLen, matShell, side * WALL_X, (PASSENGER_FLOOR_Y + WIN_LO_BOT) / 2, 0, BodyShell, side, doorCut);
        wallBoxSide(0.04, WIN_HI_BOT - WIN_LO_TOP, shellLen, matShell, side * WALL_X, (WIN_LO_TOP + WIN_HI_BOT) / 2, 0, BodyShell, side, doorCut);
        box(0.04, CEILING_Y - WIN_HI_TOP, shellLen, matShell, side * WALL_X, (WIN_HI_TOP + CEILING_Y) / 2, 0, BodyShell);
    }

    // ---------- SÀN TẦNG TRÊN ----------
    const upperFloorY = UPPER_FLOOR_Y;
    const floorThick = 0.08;
    const xPosAbs = 0.75;
    const deckRearZ = Math.min(...BED_Z_POSITIONS) - BED_LENGTH / 2;
    const deckFrontZ = Math.max(...BED_Z_POSITIONS) + BED_LENGTH / 2;
    const upperDeckGeos = [];
    for (const side of [1, -1]) {
        const deck = new THREE.BoxGeometry(
            BED_WIDTH + 0.06, floorThick, deckFrontZ - deckRearZ
        );
        deck.translate(side * xPosAbs, upperFloorY, (deckFrontZ + deckRearZ) / 2);
        upperDeckGeos.push(deck);
    }
    const upperDeckGeo = mergeBoxes(upperDeckGeos);
    if (upperDeckGeo) {
        const upperDeck = new THREE.Mesh(upperDeckGeo, matUpperFloor);
        upperDeck.name = "upperDeck20";
        upperDeck.updateMatrix();
        upperDeck.matrixAutoUpdate = false;
        Floor.add(upperDeck);
    }

    // ---------- GIƯỜNG 24 CÁI ----------
    const pillowOffset = BED_LENGTH / 2 - 0.25;
    const dividerThick = 0.02;
    const dividerWidth = BED_WIDTH + 0.04;
    const deckBottom = upperFloorY - floorThick / 2;
    const deckTop = upperFloorY + floorThick / 2;
    const partitionGeos = [];
    const addPartition = (x, z) => {
        const lowerHeight = deckBottom - PASSENGER_FLOOR_Y;
        const upperHeight = CEILING_Y - deckTop;
        const lower = new THREE.BoxGeometry(dividerWidth, lowerHeight, dividerThick);
        lower.translate(x, PASSENGER_FLOOR_Y + lowerHeight / 2, z);
        partitionGeos.push(lower);
        const upper = new THREE.BoxGeometry(dividerWidth, upperHeight, dividerThick);
        upper.translate(x, deckTop + upperHeight / 2, z);
        partitionGeos.push(upper);
    };

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

            addPartition(xPos, z + BED_LENGTH / 2);
            addPartition(xPos, z - BED_LENGTH / 2);
        }
    }

    const rearZ = BED_Z_POSITIONS[BED_Z_POSITIONS.length - 1] - BED_LENGTH / 2;
    addPartition(-xPosAbs, rearZ);
    addPartition(xPosAbs, rearZ);
    const partitionGeo = mergeBoxes(partitionGeos);
    if (partitionGeo) {
        const partitions = new THREE.Mesh(partitionGeo, matDivider);
        partitions.name = "cabinPartitions20";
        partitions.updateMatrix();
        partitions.matrixAutoUpdate = false;
        Cabins.add(partitions);
    }

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
            aisleCurtainLow.position.set(xAisle, LOWER_BED_Y + 0.02, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainLow.updateMatrix();
            aisleCurtainLow.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainLow);
            const aisleCurtainUp = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.75, 0.35), matFabricDark);
            aisleCurtainUp.position.set(xAisle, UPPER_BED_Y + 0.02, z + BED_LENGTH / 2 - 0.35);
            aisleCurtainUp.updateMatrix();
            aisleCurtainUp.matrixAutoUpdate = false;
            Curtains.add(aisleCurtainUp);
            // Tay vịn mép giường hướng lối đi (ngang tầm nệm)
            const rod1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, BED_LENGTH - 0.1), matDark);
            rod1.position.set(xAisle, LOWER_BED_Y - 0.09, z);
            rod1.updateMatrix();
            rod1.matrixAutoUpdate = false;
            Curtains.add(rod1);
            const rod2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, BED_LENGTH - 0.1), matDark);
            rod2.position.set(xAisle, UPPER_BED_Y - 0.09, z);
            rod2.updateMatrix();
            rod2.matrixAutoUpdate = false;
            Curtains.add(rod2);
            rod2.updateMatrix();
            rod2.matrixAutoUpdate = false;
            Curtains.add(rod2);
        }
    }

    // ---------- LED DỌC TẦNG (cắt ngắn, không thò qua cửa buồng lái) ----------
    // z từ 4.8 (vách cabin) lùi về -5.0; đoạn 5.0..6.0 = buồng lái/cửa ra vào
    const xLedType = [L - 7.2, -0.1];   // [độ dài, tâm z]
    for (const side of [1, -1]) {
        const xLed = side * (WALL_X - 0.02);
        const ledLow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, xLedType[0]), matLEDBlue);
        ledLow.position.set(xLed, 2.37, xLedType[1]);
        ledLow.updateMatrix();
        ledLow.matrixAutoUpdate = false;
        Led.add(ledLow);
        const ledUp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, xLedType[0]), matLEDBlue);
        ledUp.position.set(xLed, 3.40, xLedType[1]);
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
    mkLight(0, CEILING_Y - 0.15, 2.0, 1.0);
    mkLight(0, CEILING_Y - 0.15, -3.0, 1.0);
    mkLight(0, 2.2, 2.0, 0.8);
    mkLight(0, 2.2, -3.0, 0.8);
    mkLight(0, 3.0, 5.0, 1.8);

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

// =====================================================================
// CẤU HÌNH NỘI THẤT 34 GIƯỜNG VIP (3 DÃY, 2 LỐI ĐI)
// ---------------------------------------------------------------------
// BỔ SUNG MỚI (đặt ở CUỐI file, KHÔNG đụng cấu hình 20 phòng ở trên).
//
// CƠ SỞ THIẾT KẾ (đo từ catalogue THACO + quy định giường VN):
//   * THACO MOBIHOME 120 phiên bản 34 giường: "khoang hành khách thiết kế
//     3 dãy giường tối ưu không gian" + "sàn lót 2 dãy LED nằm trần"
//     (catalogue-busgiuong-2024-1.pdf) -> đúng 3 dãy / 2 lối / 2 dải LED.
//   * Quy định giường VN: rộng >= 48cm, dài >= 165cm.
//   * Khoang trong xe rộng 2.30m (WALL_X = 1.15) -> chia:
//       giường bên 0.52 | lối đi 0.36 | giường giữa 0.54 | lối đi 0.36 | giường bên 0.52
//     (tổng đúng 2.30m — KHÔNG vật thể nào xuyên nhau).
//   * Giường giữa 1.40m với BƯỚC 1.42m -> giữa 2 khoang liền kề có khe
//     0.02m đúng bằng bề dày vách ngăn: vách TRƯỚC/SAU mỗi khoang nằm gọn
//     trong khe nên mặt vách chỉ TIẾP XÚC mép nệm/khung, không lấn 1mm.
//     7 giuong 1.40 + 8 vach 0.02 = 9.96m, vẫn nằm trong khoang
//     [-5.95 .. 4.05] (dư 0.03 trước / 0.01 sau) — KHÔNG kéo dài thân xe.
//     (Trước đây dãy giữa để 1.42m dính liền nhau, không còn khe đặt vách
//     -> 7 giường nối đuôi thành 1 khối, thiếu vách ngăn riêng tư VIP.)
//     Chi tiết: buildCenterRowPartitions34 ở CUỐI file.
//   * Bố cục: bên trái 5 + giữa 7 + bên phải 5 = 17 mỗi tầng, 2 tầng = 34.
//
// AN TOÀN HÌNH HỌC: mọi giường nằm trong khoang z [-5.95 .. 4.05], cao
//   y 0.55..1.75 (dưới trần 3.20), rộng x [-1.15 .. 1.15] — không cắt qua
//   tường sau, trần hay vỏ xe.
//
// HIỆU NĂNG: dải LED dùng 5 PointLight (2 lối + 2 đầu + 1 phụ) thay vì 26
//   như cấu hình 20 phòng — mỗi PointLight thêm vào scene đều làm shader của
//   MỌI vật liệu phải lặp thêm 1 vòng ánh sáng (rất nặng trên iGPU N5000).
// =====================================================================
// Gộp nhiều BoxGeometry thành 1 (tự chứa, KHÔNG thêm import mới — chỉ dùng
// THREE đã có sẵn trong file). Mọi box đều có cùng bộ thuộc tính
// (position/normal/uv) nên nối mảng là an toàn.
function mergeBoxes(geos) {
    if (!geos || !geos.length) return null;
    const parts = [];
    let total = 0;
    for (const g of geos) {
        const n = g.index ? g.toNonIndexed() : g;
        parts.push({ src: g, geo: n });
        total += n.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let off = 0;
    for (const p of parts) {
        const n = p.geo;
        const c = n.attributes.position.count;
        pos.set(n.attributes.position.array, off * 3);
        if (n.attributes.normal) nor.set(n.attributes.normal.array, off * 3);
        if (n.attributes.uv) uv.set(n.attributes.uv.array, off * 2);
        off += c;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    for (const p of parts) {
        if (p.geo !== p.src) p.geo.dispose();
        p.src.dispose();
    }
    return out;
}

const CFG34 = {
    FLOOR_Y: 1.00,          // sàn khoang hành khách (nâng lên — gầm để trống khoang hành lý)
    LOWER_Y: 1.62,          // mặt nệm tầng dưới
    UPPER_Y: 2.69,          // mặt nệm tầng trên
    SIDE_BED_W: 0.52,       // bề rộng giường 2 dãy bên
    CENTER_BED_W: 0.54,     // bề rộng giường dãy giữa
    SIDE_BED_L: 1.70,       // chiều dài giường bên
    CENTER_BED_L: 1.40,     // chiều dài giường giữa (bước 1.42 -> khe 0.02 đặt vách)
    SIDE_X: 0.87,           // |x| tâm giường bên  (khung 0.56 -> 0.59..1.15)
    CENTER_X: 0.00,         // tâm dãy giữa (đối xứng)
    AISLE_X: 0.43,          // |x| tâm lối đi       (0.27 .. 0.59)
    AISLE_W: 0.32,
    Z_FIRST: 3.00,          // tâm giường bên đầu tiên
    Z_STEP: 2.00,          // bước giữa 2 giường bên
    Z_CENTER_FIRST: 3.30,   // tâm giường giữa đầu tiên
    Z_CENTER_STEP: 1.42,
    FRONT_Z: 4.05,          // mép trước khoang hành khách
    REAR_Z: -5.95           // mép sau khoang hành khách
};

function buildPassengerCabin34(groups) {
    const { Beds, Floor, Ceiling, Curtains, Windows, Cabins, Aisle, Led, BodyShell, Lights } = groups;
    const C = CFG34;
    const half = C.AISLE_W * 0.5;
    const aisleZ1Clamp = Math.max(C.REAR_Z, -L / 2 + 0.15);   // kẹp trong mặt sàn
    const aisleZ0Clamp = Math.min(C.FRONT_Z, CABIN_END_Z);
    const aisleZ0 = aisleZ0Clamp, aisleZ1 = aisleZ1Clamp;
    const aisleLen = aisleZ0 - aisleZ1;
    const aisleCz = (aisleZ0 + aisleZ1) * 0.5;

    // ---------- SÀN KHOANG HÀNG KHÁCH (NÂNG LÊN 1.0m) ----------
    // Chỉ phủ khoang hành khách (z ≤ CABIN_END_Z), khớp cấu hình 20 phòng.
    // Buồng lái GIỮ sàn thấp (0.06). Khoang hành lý = khoảng trống gầm xe.
    const zFront = CABIN_END_Z, zRear = -L / 2 + 0.15;
    box(W - 0.1, 0.08, zFront - zRear, matFloorPax, 0, C.FLOOR_Y - 0.04, (zFront + zRear) / 2, Floor);
    // Mặt bịt khoang hành lý phía trước — CHỪA LỐI CẦU THANG căn theo cửa -x.
    const sealH = C.FLOOR_Y - 0.28;
    const sealY = (C.FLOOR_Y + 0.28) / 2;
    const stOpenL = -1.12, stOpenR = -0.40;
    const bodyHalf = (W - 0.1) / 2;
    box(bodyHalf - stOpenR, sealH, 0.06, matShell, (stOpenR + bodyHalf) / 2, sealY, CABIN_END_Z - 0.03, Floor);
    box(stOpenL - (-bodyHalf), sealH, 0.06, matShell, (-bodyHalf + stOpenL) / 2, sealY, CABIN_END_Z - 0.03, Floor);
    // Vách dưới (y 0..0.28) — bịt kín đáy, CHỪA LỖ CẦU THANG bên -x (stair gap x -1.12..-0.40)
    box(bodyHalf - stOpenR, 0.28, 0.06, matShell, (stOpenR + bodyHalf) / 2, 0.14, CABIN_END_Z - 0.03, Floor);
    box(stOpenL - (-bodyHalf), 0.28, 0.06, matShell, (-bodyHalf + stOpenL) / 2, 0.14, CABIN_END_Z - 0.03, Floor);
    // Vòm bánh xe (khớp cấu hình 20 phòng)
    for (const [wz] of [[3.65], [-2.59]]) {
        for (const side of [1, -1]) {
            box(0.52, 0.18, 1.16, matShell, side * 1.02, 1.01, wz, Floor);
        }
    }

    // ---------- 2 LỐI ĐI (2 dãy) ----------
    for (const side of [1, -1]) {
        const ax = side * C.AISLE_X;
        box(C.AISLE_W, 0.06, aisleLen, matAisle, ax, C.FLOOR_Y + 0.02, aisleCz, Aisle);
        // viền LED 2 bên lối đi + vách ngăn
        for (const e of [1, -1]) {
            box(0.035, 0.035, aisleLen, matLEDBlue, ax + e * (half - 0.025), C.FLOOR_Y + 0.07, aisleCz, Aisle);
            box(0.045, 0.05, aisleLen, matDivider, ax + e * half, C.FLOOR_Y + 0.04, aisleCz, Aisle);
        }
    }

    // ---------- CẦU THANG LÊN CABIN (dùng chung với cấu hình 20 phòng) ----------
    buildEntryStaircase(Aisle);

    // ---------- TRẦN + 2 DẢI LED NẰM TRẦN (trên 2 lối đi) ----------
    box(W - 0.06, 0.04, L - 0.5, matCream, 0, CEILING_Y + 0.02, 0, Ceiling);
    for (const side of [1, -1]) {
        const ax = side * C.AISLE_X;
        // dải LED dọc nằm trần TRÊN ĐÚNG LỐI ĐI
        const strip = box(0.05, 0.02, aisleLen, matLEDNude, ax, CEILING_Y - 0.005, aisleCz, Led);
        strip.name = side > 0 ? "rightLed34" : "leftLed34";
        // sọc LED ngang trên mỗi lối đi
        for (let z = C.FRONT_Z - 0.3; z > C.REAR_Z + 0.2; z -= 0.45) {
            box(C.AISLE_W - 0.04, 0.015, 0.06, matLEDRib, ax, CEILING_Y - 0.005, z, Led);
        }
        // dải LED dọc sát vỏ xe — cắt tại vách cabin (z=4.8), không thò qua cửa
        box(0.02, 0.03, 9.9, matLEDBlue, side * (WALL_X - 0.02), CEILING_Y - 0.04, -0.1, Led);
    }

    // ---------- THÂN XE (2 bên) + sàn tầng trên ----------
    const shellLen = L - 0.6;
    const doorCut = { z0: 5.139, z1: 6.189, y0: 0.307, y1: 2.749 };
    const upperDeckGeos = [];
    for (const side of [1, -1]) {
        const deck = new THREE.BoxGeometry(
            C.SIDE_BED_W + 0.04, 0.08, zFront - zRear
        );
        deck.translate(side * C.SIDE_X, UPPER_FLOOR_Y, (zFront + zRear) / 2);
        upperDeckGeos.push(deck);
        wallBoxSide(0.04, WIN_LO_BOT - C.FLOOR_Y, shellLen, matShell, side * WALL_X, (C.FLOOR_Y + WIN_LO_BOT) / 2, 0, BodyShell, side, doorCut);
        wallBoxSide(0.04, WIN_HI_BOT - WIN_LO_TOP, shellLen, matShell, side * WALL_X, (WIN_LO_TOP + WIN_HI_BOT) / 2, 0, BodyShell, side, doorCut);
        box(0.04, CEILING_Y - WIN_HI_TOP, shellLen, matShell, side * WALL_X, (WIN_HI_TOP + CEILING_Y) / 2, 0, BodyShell);
    }

    // ---------- DỰNG GIƯỜNG ----------
    // Một giường = khung + nệm + gối + chăn (cùng vật liệu & tỷ lệ cấu hình
    // 20 phòng). Geometry gộp theo vật liệu: 34 giường x 4 chi tiết = 136
    // mesh rời -> 4 mesh (giảm draw call, quan trọng cho iGPU N5000).
    const bedFrameGeo = [], bedMatGeo = [], bedPillowGeo = [], bedBlanketGeo = [];
    let bedCount = 0;
    const pushBox = (arr, w, h, d, x, y, z) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        arr.push(g);
    };
    // framePadZ: mức nhô thêm của KHUNG so với nệm theo chiều dài (mặc định
    // 0.04 như cấu hình 20 phòng / 2 dãy bên). Dãy giữa dùng 0 để khung
    // không tràn vào khe 0.02m — nơi đặt vách ngăn khoang (nếu khung tràn
    // vào khe thì vách sẽ cắt ngang khung giường).
    const buildBed = (x, z, y, bedLen, bedW, framePadZ = 0.04) => {
        pushBox(bedFrameGeo, bedW + 0.04, 0.08, bedLen + framePadZ, x, y - 0.12, z);
        pushBox(bedMatGeo, bedW, 0.14, bedLen, x, y, z);
        pushBox(bedPillowGeo, bedW * 0.64, 0.10, 0.28, x, y + 0.10, z + bedLen / 2 - 0.22);
        pushBox(bedBlanketGeo, bedW * 0.85, 0.04, bedLen * 0.45, x, y + 0.08, z - bedLen * 0.12);
        bedCount++;
    };

    // 2 dãy bên: 5 giường mỗi bên, mỗi tầng (tổng 10 + 10)
    // Chừa khe đúng bề dày sàn tầng trên để các vách không cắt xuyên mặt sàn.
    const ledgeY0 = UPPER_FLOOR_Y - 0.04;          // mép dưới sàn tầng trên 2.45
    const ledgeY1 = UPPER_FLOOR_Y + 0.04;          // mép trên               2.53
    const wallW = C.SIDE_BED_W - 0.02;            // 0.50
    const wallThick = 0.02;
    const wallZ = C.SIDE_BED_L / 2 + 0.03;        // 0.88 — trong khe 0.30
    const sideWallGeos = [];
    const swPush = (w, h, d, x, y, z) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        sideWallGeos.push(g);
    };
    for (const side of [1, -1]) {
        for (let i = 0; i < 5; i++) {
            const z = C.Z_FIRST - i * C.Z_STEP;
            const x = side * C.SIDE_X;
            for (const y of [C.LOWER_Y, C.UPPER_Y]) {
                buildBed(x, z, y, C.SIDE_BED_L, C.SIDE_BED_W);
            }
            for (const dz of [1, -1]) {
                const wz = z + dz * wallZ;
                // Hai đoạn vách gặp sàn tầng trên ở y=2.45 và y=2.53.
                swPush(wallW, ledgeY0 - C.FLOOR_Y, wallThick, x, (C.FLOOR_Y + ledgeY0) / 2, wz);
                swPush(wallW, CEILING_Y - ledgeY1, wallThick, x, (ledgeY1 + CEILING_Y) / 2, wz);
            }
        }
    }
    if (sideWallGeos.length) {
        const swGeo = mergeBoxes(sideWallGeos);
        if (swGeo) {
            const swMesh = new THREE.Mesh(swGeo, matDivider);
            swMesh.name = "sideWalls34";
            swMesh.updateMatrix();
            swMesh.matrixAutoUpdate = false;
            Cabins.add(swMesh);
        }
    }

    // dãy giữa: 7 giường mỗi tầng (tổng 14) — khung KHÔNG nhô thêm theo z
    // (framePadZ=0) để giữ trống khe 0.02m đặt vách ngăn khoang.
    for (let i = 0; i < 7; i++) {
        const z = C.Z_CENTER_FIRST - i * C.Z_CENTER_STEP;
        for (const y of [C.LOWER_Y, C.UPPER_Y]) {
            if (y === C.UPPER_Y) {
                const deck = new THREE.BoxGeometry(
                    C.CENTER_BED_W + 0.04, 0.08, C.CENTER_BED_L
                );
                deck.translate(C.CENTER_X, UPPER_FLOOR_Y, z);
                upperDeckGeos.push(deck);
            }
            buildBed(C.CENTER_X, z, y, C.CENTER_BED_L, C.CENTER_BED_W, 0);
        }
    }
    // VÁCH NGĂN KHOANG GIƯỜNG DÃY GIỮA — trước đây dãy giữa KHÔNG có vách
    // (7 giường nối đuôi thành 1 khối, mất cảm giác riêng tư VIP) và chỉ có
    // 2 "vách bên" chạy dọc cao 0.55m tại x=±0.28 — tấm vách đó CẮT NGANG
    // nệm/khung giường tầng dưới (nệm mặt trên y=0.74, khung 0.55..0.63).
    // Nay bỏ 2 tấm sai đó, thay bằng vách TRƯỚC/SÁU cho từng khoang, đúng
    // ngôn ngữ thiết kế của 2 dãy bên (xem buildCenterRowPartitions34 ở cuối
    // file — khai báo hàm ở cuối để không đụng code cũ).
    buildCenterRowPartitions34(groups);
    const upperDeckGeo = mergeBoxes(upperDeckGeos);
    if (upperDeckGeo) {
        const upperDeck = new THREE.Mesh(upperDeckGeo, matUpperFloor);
        upperDeck.name = "upperDeck34";
        upperDeck.updateMatrix();
        upperDeck.matrixAutoUpdate = false;
        Floor.add(upperDeck);
    }

    // ---------- CỬA SỔ + RÈM (2 dãy bên, 2 tầng) ----------
    for (const side of [1, -1]) {
        const xGlass = side * (WALL_X + 0.01);
        const xCurtain = side * (WALL_X - 0.02);
        for (let i = 0; i < 5; i++) {
            const z = C.Z_FIRST - i * C.Z_STEP;
            // cửa sổ tầng dưới + tầng trên
            for (const [yBot, yTop] of [[WIN_LO_BOT, WIN_LO_TOP], [WIN_HI_BOT, WIN_HI_TOP]]) {
                const win = new THREE.Mesh(new THREE.PlaneGeometry(C.SIDE_BED_L - 0.20, yTop - yBot), matGlass);
                win.position.set(xGlass, (yBot + yTop) / 2, z);
                win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
                win.updateMatrix(); win.matrixAutoUpdate = false;
                Windows.add(win);
            }
            // rèm (nằm trong khoang, không xuyên ra ngoài vỏ xe)
            for (const [yBot, yTop] of [[WIN_LO_BOT, WIN_LO_TOP], [WIN_HI_BOT, WIN_HI_TOP]]) {
                const curt = new THREE.Mesh(new THREE.BoxGeometry(0.02, yTop - yBot, 0.30), matFabric);
                curt.position.set(xCurtain, (yBot + yTop) / 2, z - C.SIDE_BED_L / 2 + 0.15);
                curt.updateMatrix(); curt.matrixAutoUpdate = false;
                Curtains.add(curt);
            }
        }
    }

    // ---------- ĐÈN (5 PointLight: 2 lối đi + 2 đầu + 1 phụ) ----------
    // Gộp geometry giường vừa dựng thành 4 mesh (1 draw call / vật liệu).
    const addMerged = (arr, mat) => {
        if (!arr.length) return;
        const merged = mergeBoxes(arr);
        if (!merged) return;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        Beds.add(mesh);
    };
    addMerged(bedFrameGeo, matBedFrame);
    addMerged(bedMatGeo, matBrownLeather);
    addMerged(bedPillowGeo, matWhite);
    addMerged(bedBlanketGeo, matBrownLeatherDark);
    Beds.userData.bedCount = bedCount;

    const mkPoint = (x, y, z, intensity, dist, name) => {
        const pl = new THREE.PointLight(0x88ccff, intensity, dist, 1.0);
        pl.position.set(x, y, z);
        pl.name = name;
        pl.userData.base = intensity;
        Lights.add(pl);
        return pl;
    };
    const led34 = [];
    led34.push(mkPoint(C.AISLE_X, CEILING_Y - 0.12, 2.20, 5.0, 14, "aisleLightR"));
    led34.push(mkPoint(-C.AISLE_X, CEILING_Y - 0.12, 2.20, 5.0, 14, "aisleLightL"));
    led34.push(mkPoint(C.AISLE_X, CEILING_Y - 0.12, -2.60, 4.0, 14, "aisleLightR2"));
    led34.push(mkPoint(-C.AISLE_X, CEILING_Y - 0.12, -2.60, 4.0, 14, "aisleLightL2"));
    led34.push(mkPoint(0, CEILING_Y - 0.10, C.FRONT_Z - 0.60, 3.0, 10, "frontLed34"));
    groups.ledStripLights = led34;
}

/**
 * Tạo nội thất xe khách 34 giường VIP (3 dãy, 2 lối đi, 2 dải LED trần).
 * Cấu hình ĐỘC LẬP — không đụng tới cấu hình 20 phòng ở trên file.
 * Driver cabin dùng lại đúng hàm buildCabin() của cấu hình gốc (cùng thân xe).
 */
export function createBusInterior34() {
    const root = new THREE.Group();
    root.name = "busInterior34";

    const groups = {};
    const names = ["Beds", "Floor", "Ceiling", "Curtains", "Windows",
        "DriverArea", "Dashboard", "Lights", "Cabins", "Aisle", "Led", "BodyShell"];
    for (const name of names) {
        groups[name] = new THREE.Group();
        groups[name].name = name;
        root.add(groups[name]);
    }

    buildCabin(groups);              // cabin lái dùng chung (thân xe giống nhau)
    buildPassengerCabin34(groups);    // khoang hành khách 34 giường (MỚI)

    // setInteriorLed riêng cho cấu hình 34: bật/tắt bằng INTENSITY
    // (giữ visible = true -> numPointLights cố định, không recompile shader).
    function setInteriorLed34(on) {
        matLEDBlue.emissiveIntensity = on ? 5.0 : 0;
        matLEDNude.emissiveIntensity = on ? 5.5 : 0;
        matLEDRib.emissiveIntensity = on ? 3.5 : 0;
        matCluster.emissiveIntensity = on ? 1.0 : 0.1;
        if (groups.ledStripLights) {
            for (const pl of groups.ledStripLights) {
                if (pl) pl.intensity = on ? pl.userData.base : 0;
            }
        }
        const ledStrips = groups.Led;
        if (ledStrips) {
            ledStrips.traverse((obj) => {
                if (obj.isMesh && (obj.material === matLEDBlue || obj.material === matLEDNude || obj.material === matLEDRib)) {
                    obj.visible = on;
                }
            });
        }
    }

    root.setInteriorLed = setInteriorLed34;
    setInteriorLed34(true);
    root.configId = "BED34";
    return root;
}

// =====================================================================
// TỐI ƯU: GỘP ĐÈN CABIN (GIẢM numPointLight TRONG SCENE)
// ---------------------------------------------------------------------
// BẰNG CHỨNG (đo được, không phải phỏng đoán):
//   Nội thất 20 phòng tạo **31 PointLight**; cộng đèn đường pool (6) + đèn
//   đuôi (1) = **38 PointLight trong scene**. Trong Three.js, `numPointLights`
//   nằm trong program cache key và MỌI fragment shader của MeshStandardMaterial
//   phải LẶP 38 VÒNG ánh sáng point cho mỗi pixel. Trên iGPU Intel UHD 605
//   (Pentium N5000) đo được frame ~1.1s -> `[PERF] Spikes ... TB 1130.6ms`,
//   chunk dựng không kịp -> "không load vào game".
//
// CÁCH SỬA (không đụng code cũ, không mất nội dung):
//   - GIỮ NGUYÊN 5 đèn chính (center/left/right/front/rear) — chúng quyết định
//     màu và độ sáng cabin, và `setInteriorLed` vẫn điều khiển được.
//   - 26 đèn phụ (21 dải LED strip + 5 đèn mkLight) -> gộp còn **4 đèn đại
//     diện** đặt dọc lối đi, TĂNG `userData.base` để tổng độ sáng tương đương
//     (setInteriorLed vẫn tính intensity = base * 5 * factor -> vẫn bật/tắt
//     được bằng phím F/L).
//   - MESH dải LED (cái dải sáng nhìn thấy) GIỮ NGUYÊN -> hình ảnh không đổi.
//   - 38 -> 16 PointLight trong scene (giảm ~58% chi phí shader).
// LƯU Ý: đổi số PointLight làm đổi program cache key -> Three.js biên dịch lại
// shader 1 lần. Việc này chạy LÚC KHỞI ĐỘNG GAME (trước frame đầu tiên có
// thế giới) nên không gây giật giữa chơi.
// =====================================================================
export function optimizeInteriorLights(root) {
    const out = { before: 0, after: 0, merged: 0 };
    if (!root) return out;
    const lightsGrp = root.getObjectByName('Lights');
    if (!lightsGrp) return out;

    const all = [];
    lightsGrp.traverse((o) => { if (o.isPointLight) all.push(o); });
    out.before = all.length;
    if (all.length <= 8) { out.after = all.length; return out; }   // 34 giường: đã gọn

    // 5 đèn chính (được đặt tên) giữ nguyên; phần còn lại gộp.
    const KEEP = new Set(['centerLedLight', 'leftLedLight', 'rightLedLight', 'frontLedLight', 'rearLedLight']);
    const main = all.filter((l) => KEEP.has(l.name));
    const extra = all.filter((l) => !KEEP.has(l.name));

    // Giữ 4 đèn đại diện, dời dọc lối đi (trục z), tăng công suất + tầm với.
    const kept = extra.slice(0, 4);
    const pos = [[0, 3.45, 3.6], [0, 3.45, 0.9], [0, 3.45, -1.9], [0, 3.45, -4.6]];
    for (let i = 0; i < kept.length; i++) {
        const l = kept[i];
        l.position.set(pos[i][0], pos[i][1], pos[i][2]);
        l.userData.base = 3.0;      // setInteriorLed sẽ tính intensity = base*5*factor
        l.distance = 15;
        l.intensity = 15;           // áp ngay (trước lần setInteriorLed sau đó)
    }
    // Gỡ các đèn dư khỏi SCENE (giữ object trong group để setInteriorLed vẫn
    // chạy được, chỉ là chúng không chiếu sáng nữa).
    for (const l of extra.slice(4)) {
        if (l.parent) l.parent.remove(l);
        out.merged++;
    }
    out.after = main.length + kept.length;
    return out;
}

/**
 * Chuyển COCKPIT (màn hình/đồng hồ/nút/joystick) từ interior cũ sang mới.
 * bus.js gắn cockpit vào GỐC của interior (con trực tiếp, không thuộc nhóm
 * nào) -> đổi cấu hình mà không chuyển thì màn hình tài xế biến mất.
 * Giữ nguyên local transform khi re-parent (cùng gốc toạ độ).
 */
const INTERIOR_STD_GROUPS = new Set([
    "Beds", "Floor", "Ceiling", "Curtains", "Windows", "DriverArea",
    "Dashboard", "Lights", "Cabins", "Aisle", "Led", "BodyShell"
]);
export function migrateInteriorCockpit(oldRoot, newRoot) {
    if (!oldRoot || !newRoot) return 0;
    let n = 0;
    for (const child of [...oldRoot.children]) {
        if (!INTERIOR_STD_GROUPS.has(child.name)) {
            newRoot.add(child);
            n++;
        }
    }
    return n;
}

// =====================================================================
// ===== VÁCH NGĂN KHOANG GIƯỜNG — DÃY GIỮA (CẤU HÌNH 34 GIƯỜNG) =====
// BỔ SUNG Ở CUỐI FILE (yêu cầu nhiệm vụ: chỉ thêm code mới ở cuối
// — KHÔNG sửa/xóa/di chuyển bất kỳ dòng nào của cấu hình
// 20 phòng ở trên; hàm này chỉ được buildPassengerCabin34 gọi tới).
//
// NGUYÊN NHÂN DÃY GIỮA THIẾU VÁCH:
//   Cấu hình 34 giường trước đây dựng vách ngăn cho 2 DÃY BÊN (mỗi khoang
//   2 tấm trước/sau, cao sàn->trần, material matDivider) nhưng DÃY GIỮA để
//   7 giường + 7 giường tầng trên nối đuôi nhau (bước = chiều dài) -> không
//   có ranh giới khoang, cả dãy thành 1 khối dài, mất cảm giác riêng tư VIP.
//   Thêm 2 tấm "vách bên" cao 0.55m chạy dọc dãy giữa tại x=±0.28 còn CẮT
//   NGANG nệm/khung giường tầng dưới (nệm mặt y=0.74, khung y=0.55..0.63)
//   -> 2 tấm sai đó đã bị xoá, thay bằng hệ vách của hàm này.
//
// ĐỐI CHIẾU XE THẬT (nguồn ở mục 5 của yêu cầu):
//   * THACO Mobihome Luxury 34 giường — "34 khoang giường riêng biệt, tạo
//     khoảng không gian riêng tư cho hành khách"; khoang "độc lập, rộng rãi
//     có rèm che ngăn cách"; "vách ngăn bọc da công nghiệp phẳng"
//     (https://thuocongthuong.vn/tin-tuc-thi-truong/2019/07/thaco-mobihome-
//      luxury-2019-dau-moi-trong-segment-xe-giuong-nam-cao-cap-1563216034.html)
//     -> MỖI giường là một khoang có vách trước/sau, vật liệu vách phẳng.
//   * Catalogue THACO MOBIHOME 120SL
//     (https://thacoauto.vn/storage/san-xuat-lap-rap/nha-may-mazda/xk-nc/
//      e-catalogue/xe-giuong-nam-thaco/catalogue-new-mobihome-120sl-02102023-en.pdf)
//     -> "34 BEDS", lề đi 400mm, "Bedside decorative frame" (khung trang
//     trí đầu giường) — vách đầu/cuối khoang là chi tiết chuẩn của xe VIP.
//   -> Dãy giữa PHẢI có vách trước/sau từng khoang như 2 dãy bên.
//
// HÌNH HỌC (có test riêng trong harness):
//   * Bước 1.42 − giường 1.40 = khe 0.02 = ĐÚNG bề dày vách -> vách nằm
//     trọn trong khe, 2 mặt chỉ TIẾP XÚC mép nệm/khung 2 khoang liền kề
//     (không lấn 1mm -> không xuyên nệm/gối/khung).
//   * Cao 0.30..3.20 (sàn->trần, đúng 2.90m như vách 2 dãy bên) -> 1 tấm
//     dùng chung cho tầng dưới lẫn tầng trên, giao nhau tại đúng 1 mặt phẳng.
//   * 7 khoang x 2 vách = 14 vị trí nhưng 6 cặp giữa 2 khoang trùng vị trí
//     (dùng chung 1 tấm) -> Set khử trùng lặp còn 8 tấm, không z-fighting.
//   * Đáy vách thu hẹp (0.495m) qua vùng viền lối đi đang cao tới y=0.365
//     và ăn tới x=0.2475: phần đáy dừng ĐÚNG mép trong viền, phần thân từ
//     đỉnh viền trở lên mở hết 0.54m (= bề rộng nệm). Nhờ vậy vách TIẾP XÚC
//     viền/sàn đúng mặt phẳng, không cắt 1mm nào -> 2 lối đi thông thoáng.
//   * Nằm gọn trong khoang z [-5.95 .. 4.05] (dư 0.03 trước / 0.01 sau):
//     KHÔNG kéo dài thân xe, KHÔNG đổi model xe.
//
// HIỆU NĂNG: 16 box gộp bằng mergeBoxes() -> 1 mesh / 1 draw call, dùng
//   chung material matDivider của 2 dãy bên (không material mới, không mesh
//   trùng, không dựng lại nội thất mỗi frame — chỉ dựng 1 lần khi build
//   passenger cabin, chuyển cấu hình 20<->34 không rò rỉ đối tượng vì nội
//   thất cũ được thay thế hẳn trong applyInteriorConfig).
// =====================================================================
function buildCenterRowPartitions34(groups) {
    const { Cabins } = groups;
    if (!Cabins) return null;
    const C = CFG34;

    // Khe giữa 2 khoang = bước − chiều dài; bề dày vách lấy ĐÚNG khe.
    const gap = +(C.Z_CENTER_STEP - C.CENTER_BED_L).toFixed(6);   // 0.02
    const thick = Math.max(gap, 0.001);
    const wallW = C.CENTER_BED_W;                                 // 0.54 = nệm
    const halfBody = C.CENTER_BED_L / 2 + thick / 2;              // 0.71 (tâm vách)
    const rows = 7;

    // Viền lối đi (nhóm Aisle, code cấu hình 34): box(0.045, 0.05, ...) đặt
    // tại y = FLOOR_Y + 0.04 -> đỉnh 0.365; mép trong mỗi viền tại x=±0.2475.
    const trimW = 0.045, trimH = 0.05, trimY = C.FLOOR_Y + 0.04;
    const trimTop = trimY + trimH / 2;
    const trimInnerX = (C.AISLE_X - C.AISLE_W / 2) - trimW / 2;
    const baseW = trimInnerX * 2;                                 // 0.495

    // Vị trí vách duy nhất: trước khoang 0 ... sau khoang 6 (Set khử trùng
    // lặp — tầng dưới/tầng trên dùng chung 1 tấm full-height nên không x2).
    const zSet = new Set();
    for (let i = 0; i < rows; i++) {
        const z = C.Z_CENTER_FIRST - i * C.Z_CENTER_STEP;
        zSet.add(+(z + halfBody).toFixed(4));    // vách TRƯỚC khoang i
        zSet.add(+(z - halfBody).toFixed(4));    // vách SAU  khoang i
    }

    const geos = [];
    const push = (w, h, d, x, y, z) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        geos.push(g);
    };
    for (const wz of zSet) {
        // Đáy vách (0.30 -> đỉnh viền 0.365): hẹp vừa khít mép trong viền.
        push(baseW, trimTop - C.FLOOR_Y, thick, C.CENTER_X, (C.FLOOR_Y + trimTop) / 2, wz);
        // Thân vách (đỉnh viền -> trần 3.20): hết bề rộng khoang.
        push(wallW, CEILING_Y - trimTop, thick, C.CENTER_X, (trimTop + CEILING_Y) / 2, wz);
    }

    const geo = mergeBoxes(geos);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, matDivider);
    mesh.name = "centerRowWalls34";
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    Cabins.add(mesh);
    return mesh;
}
