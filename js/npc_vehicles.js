// js/npc_vehicles.js
// =====================================================================
// MODEL NPC GIAO THÔNG THỰC TẾ VIỆT NAM (ngoài xe khách)
//   - CAR    : ô tô con (sedan)         ~ Toyota Vios 4.475 x 1.740 x 1.435 m
//   - VAN16  : xe van 16 chỗ            ~ Ford Transit 5.998 x 2.068 x 2.485 m
//   - TRUCK  : xe tải thùng kín         ~ Isuzu FVR34 12.110 x 2.485 x 2.895 m
//   - SEMI   : đầu kéo + container 40ft ~ 16.5 x 2.50 x 4.00 m (40ft ISO)
// NGUỒN THAM KHẢO (đo từ catalogue / sản phẩm thật):
//   * Ford Transit 16 chỗ (ford.com.vn): 5.998 x 2.068 x 2.485 mm
//   * Isuzu FVR34VE5 thùng kín (xeisuzu-vn.com): 12.110 x 2.485 x 2.895 mm;
//     thùng 4 cửa, kích thước thùng 12.200 x 2.500 x 3.940 mm
//   * Container 40ft ISO: 12.192 x 2.438 x 2.591 m
//   * Toyota Vios sedan: 4.475 x 1.740 x 1.435 m
//
// QUY ƯỚC TRỤC (BẮT BUỘC — đã có 1 lần lật trục, dùng sai là xe nằm ngang):
//   +Z = hướng đi (CHIỀU DÀI), +Y = lên (CAO), X = bề rộng.
//   Helper bx(len, h, wid, x, y, z) -> BoxGeometry(wid, h, len)
//   => luôn truyền (CHIỀU DÀI, CHIỀU CAO, BỀ RỘNG).
//
// HÌNH HỌC: Three.js geometry (Box/Cylinder) gộp theo vật liệu.
// Màu sơn NHÚI VÀO VERTEX COLOR -> mỗi xe = 4 draw call thay vì hàng chục
// mesh rời (quan trọng với iGPU Intel UHD 605 của Pentium N5000).
// TEMPLATE CACHE: geometry + material dùng chung cho mọi xe cùng (loại, màu)
//   -> không cấp phát lại khi NPC spawn/despawn, không rò bộ nhớ.
// Gốc tọa độ: giữa bánh xe trên mặt đường (y = 0), đuôi xe tại z âm.
// =====================================================================
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const NPC_VEHICLE_KIND = {
    CAR: "CAR",
    VAN16: "VAN16",
    TRUCK: "TRUCK",
    SEMI: "SEMI"
};

// Kích thước thật (m) — dùng cho va chạm OBB, khoảng cách giữ xe, bán kính
// collider. Tỉ lệ giữ xe khớp tỉ lệ thật -> người chơi nhận ra loại xe ngay.
export const NPC_VEHICLE_SPECS = {
    [NPC_VEHICLE_KIND.CAR]: {
        length: 4.475, width: 1.740, height: 1.435,
        wheelRadius: 0.305, wheelWidth: 0.200, axleZ: [1.34, -1.34], axleX: 0.76
    },
    [NPC_VEHICLE_KIND.VAN16]: {
        length: 5.998, width: 2.068, height: 2.485,
        wheelRadius: 0.350, wheelWidth: 0.220, axleZ: [1.95, -1.90], axleX: 0.90
    },
    [NPC_VEHICLE_KIND.TRUCK]: {
        length: 12.110, width: 2.485, height: 3.400,
        wheelRadius: 0.525, wheelWidth: 0.300, axleZ: [4.20, -2.60, -3.90], axleX: 0.95
    },
    [NPC_VEHICLE_KIND.SEMI]: {
        length: 16.900, width: 2.500, height: 4.000,
        wheelRadius: 0.525, wheelWidth: 0.300, axleZ: [7.00, 5.00, -4.50, -6.00, -7.20], axleX: 0.95
    }
};

// Bảng màu sơn thực tế giao thông VN
const PAINT_PALETTES = {
    [NPC_VEHICLE_KIND.CAR]: [0xf2f4f7, 0xb8c0c8, 0x1b2733, 0x8c1c22, 0x1d3f7a, 0x2f3b45],
    [NPC_VEHICLE_KIND.VAN16]: [0xf2f4f7, 0xd8dde2, 0xb8c0c8, 0x1d3f7a],
    [NPC_VEHICLE_KIND.TRUCK]: [0x1d5fa8, 0xf2f4f7, 0x8c1c22, 0xd98a1f],
    [NPC_VEHICLE_KIND.SEMI]: [0x8c1c22, 0x1d3f7a, 0x2f6b3a, 0xe0e3e6]
};
// Màu thùng/ container (riêng khỏi màu cabin đầu kéo)
const BOX_PALETTES = {
    [NPC_VEHICLE_KIND.TRUCK]: [0xf2f4f7, 0xd8dde2, 0x2f6b3a, 0x1d5fa8],
    [NPC_VEHICLE_KIND.SEMI]: [0x1d5fa8, 0x8c1c22, 0x2f6b3a, 0xe0e3e6, 0xd98a1f]
};

const C_TIRE = 0x14161a;
const C_RIM = 0x9aa1a8;
const C_TRIM = 0x22262b;      // gầm, lưới tản nhiệt, bật cửa
const C_CHROME = 0xb8bec4;
const C_GLASS = 0x1b2b38;

// ---------------------------------------------------------------- helpers
function paint(geo, hex) {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return geo;
}

/** Hộp: len = chiều dài (Z), h = cao (Y), wid = bề rộng (X). */
function bx(len, h, wid, x, y, z, hex, rotX = 0, rotY = 0, rotZ = 0) {
    const g = new THREE.BoxGeometry(wid, h, len);
    if (rotX) g.rotateX(rotX);
    if (rotY) g.rotateY(rotY);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(x, y, z);
    return paint(g, hex);
}

function cyl(r, h, x, y, z, hex, axis = "x", seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    if (axis === "x") g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    return paint(g, hex);
}

// Bánh xe: lốp + mâm, trục ngang (theo X)
function wheel(r, w, x, y, z) {
    return [
        cyl(r, w, x, y, z, C_TIRE, "x", 12),
        cyl(r * 0.55, w + 0.02, x, y, z, C_RIM, "x", 10)
    ];
}

// Gộp nhiều geometry thành 1 (cùng vật liệu) -> 1 draw call
function merge(list) {
    const clean = list.filter(Boolean);
    if (!clean.length) return null;
    const g = mergeGeometries(clean, false);
    clean.forEach((x) => x.dispose());
    return g;
}

// ------------------------------------------------------------------ CAR
// Sedan 4.475 x 1.740 x 1.435: thân thấp + cabin kính + cản + gương + đèn
function buildCar(colorHex) {
    const body = [], glass = [], head = [], tail = [];
    const W = 1.740;

    body.push(bx(4.195, 0.52, W, 0, 0.62, 0, colorHex));            // thân
    body.push(bx(4.375, 0.16, W - 0.10, 0, 0.36, 0, C_TRIM));        // gầm
    body.push(bx(1.100, 0.20, W - 0.08, 0, 0.90, 1.42, colorHex));   // nắp cáp
    body.push(bx(0.860, 0.20, W - 0.10, 0, 0.93, -1.72, colorHex));  // cốp sau
    body.push(bx(2.000, 0.10, W - 0.22, 0, 1.38, -0.22, colorHex));   // trần cabin
    body.push(bx(0.900, 0.30, 0.10, 0, 1.10, 0.62, colorHex, -0.55));  // A-pillar nghiêng
    body.push(bx(0.600, 0.34, 0.10, 0, 1.10, -1.12, colorHex, 0.50));   // C-pillar nghiêng
    body.push(bx(0.120, 0.40, 0.10, -0.84, 1.16, -0.30, colorHex));    // trụ B
    body.push(bx(0.120, 0.40, 0.10, 0.84, 1.16, -0.30, colorHex));     // trụ A
    // kính
    glass.push(bx(0.850, 0.05, W - 0.26, 0, 1.16, 0.90, C_GLASS, -0.62)); // kính chắn gió
    glass.push(bx(0.820, 0.36, 0.05, -0.87, 1.17, 0.10, C_GLASS));      // kính cửa trước
    glass.push(bx(0.820, 0.36, 0.05, 0.87, 1.17, 0.10, C_GLASS));       // kính cửa trước
    glass.push(bx(0.720, 0.34, 0.05, -0.87, 1.16, -0.72, C_GLASS));     // kính cửa sau
    glass.push(bx(0.720, 0.34, 0.05, 0.87, 1.16, -0.72, C_GLASS));      // kính cửa sau
    glass.push(bx(0.700, 0.05, W - 0.30, 0, 1.18, -1.16, C_GLASS, 0.50)); // kính sau
    // cản + lưới
    body.push(bx(0.200, 0.30, W - 0.06, 0, 0.52, 2.14, colorHex));
    body.push(bx(0.200, 0.28, W - 0.06, 0, 0.54, -2.14, colorHex));
    body.push(bx(0.06, 0.16, 0.70, 0, 0.74, 2.16, C_TRIM));         // lưới tản nhiệt
    // gương chiếu hậu (trong bề rộng thân để OBB va chạm khớp spec)
    body.push(bx(0.120, 0.09, 0.06, -0.84, 1.14, 0.70, C_TRIM));
    body.push(bx(0.120, 0.09, 0.06, 0.84, 1.14, 0.70, C_TRIM));
    // đèn
    head.push(bx(0.260, 0.11, 0.07, -0.56, 0.80, 2.16, 0xfff3cf));
    head.push(bx(0.260, 0.11, 0.07, 0.56, 0.80, 2.16, 0xfff3cf));
    tail.push(bx(0.280, 0.12, 0.06, -0.60, 0.86, -2.16, 0xd01c1c));
    tail.push(bx(0.280, 0.12, 0.06, 0.60, 0.86, -2.16, 0xd01c1c));
    // bánh + vòm bánh
    const r = 0.305, w = 0.200;
    for (const sx of [-1, 1]) for (const sz of [1.34, -1.34]) {
        wheel(r, w, sx * 0.76, r, sz).forEach((g) => body.push(g));
        body.push(bx(0.620, 0.10, 0.06, sx * 0.86, r + 0.16, sz, C_TRIM));
    }
    return { body: merge(body), glass: merge(glass), head: merge(head), tail: merge(tail) };
}

// ---------------------------------------------------------------- VAN16
// Ford Transit: thân vuông cao, kính chắn lớn, cửa trượt, 4 bánh
function buildVan(colorHex) {
    const body = [], glass = [], head = [], tail = [];
    const W = 2.068;

    body.push(bx(5.700, 1.55, W, 0, 1.60, 0, colorHex));            // thân
    body.push(bx(5.900, 0.40, W - 0.06, 0, 0.42, 0, colorHex));     // thấp xe
    body.push(bx(5.800, 0.06, W + 0.02, 0, 2.38, 0, colorHex));      // nóc
    // kính chắn gió nghiêng
    body.push(bx(0.090, 0.98, W - 0.20, 0, 1.86, 2.79, colorHex, -0.20));
    glass.push(bx(0.070, 0.98, W - 0.22, 0, 1.86, 2.82, C_GLASS, -0.20));
    // kính bên: 3 cửa mỗi bên + gương
    for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const z = 1.10 - i * 1.12;
            glass.push(bx(0.860, 0.66, 0.05, sx * (W / 2 - 0.01), 1.80, z, C_GLASS));
        }
        body.push(bx(0.130, 0.26, 0.10, sx * (W / 2 - 0.06), 1.82, 2.42, C_TRIM));
        // đường cửa trượt + tay nắm
        body.push(bx(1.050, 0.04, 0.04, sx * (W / 2 + 0.01), 1.42, -0.05, C_TRIM));
        body.push(bx(0.140, 0.05, 0.05, sx * (W / 2 + 0.02), 1.30, 0.42, C_CHROME));
    }
    // cản
    body.push(bx(0.220, 0.34, W - 0.04, 0, 0.50, 2.86, C_TRIM));
    body.push(bx(0.220, 0.34, W - 0.04, 0, 0.52, -2.86, C_TRIM));
    // đèn
    head.push(bx(0.300, 0.14, 0.07, -0.72, 0.78, 2.85, 0xfff3cf));
    head.push(bx(0.300, 0.14, 0.07, 0.72, 0.78, 2.85, 0xfff3cf));
    tail.push(bx(0.340, 0.16, 0.07, -0.86, 1.20, -2.88, 0xd01c1c));
    tail.push(bx(0.340, 0.16, 0.07, 0.86, 1.20, -2.88, 0xd01c1c));
    tail.push(bx(0.300, 0.10, 0.06, -0.80, 0.62, -2.90, 0xd01c1c));
    tail.push(bx(0.300, 0.10, 0.06, 0.80, 0.62, -2.90, 0xd01c1c));
    // bánh + vòm
    const r = 0.350, w = 0.220;
    for (const sx of [-1, 1]) for (const sz of [1.95, -1.90]) {
        wheel(r, w, sx * 0.90, r, sz).forEach((g) => body.push(g));
        body.push(bx(0.760, 0.34, 0.05, sx * 1.00, r + 0.10, sz, C_TRIM));
    }
    return { body: merge(body), glass: merge(glass), head: merge(head), tail: merge(tail) };
}

// ---------------------------------------------------------------- TRUCK
// Isuzu FVR + thùng kín: cabin, khung chassis, thùng 9.2m, 6 bánh
function buildTruck(cabHex, boxHex) {
    const body = [], glass = [], head = [], tail = [];
    const W = 2.485;

    body.push(bx(11.30, 0.22, 0.86, 0, 1.02, -0.20, C_TRIM));      // khung xe
    // cabin
    body.push(bx(2.30, 1.70, W, 0, 1.95, 4.30, cabHex));
    body.push(bx(2.16, 0.10, W - 0.04, 0, 2.80, 4.30, cabHex));
    // kính chắn gió + kính cửa
    glass.push(bx(0.070, 0.86, W - 0.26, 0, 2.24, 5.42, C_GLASS, -0.12));
    for (const sx of [-1, 1]) {
        glass.push(bx(0.800, 0.62, 0.05, sx * (W / 2 - 0.01), 2.16, 4.30, C_GLASS));
        // gương xe tải (2 bên, treo dọc) — đặt trong bề rộng thân
        body.push(bx(0.160, 0.46, 0.06, sx * (W / 2 - 0.06), 2.20, 5.20, C_TRIM));
        body.push(bx(0.140, 0.06, 0.06, sx * (W / 2 - 0.10), 2.42, 5.20, C_TRIM));
    }
    // lưới tản nhiệt + cản trước
    body.push(bx(0.100, 0.80, 1.30, 0, 1.52, 5.46, C_TRIM));
    body.push(bx(0.180, 0.30, 2.34, 0, 1.05, 5.50, C_TRIM));
    // đèn
    head.push(bx(0.070, 0.16, 0.34, -0.86, 1.66, 5.48, 0xfff3cf));
    head.push(bx(0.070, 0.16, 0.34, 0.86, 1.66, 5.48, 0xfff3cf));
    // THÙNG KÍN: 9.20 (Z) x 2.44 (X) x 2.20 (Y)
    body.push(bx(9.20, 2.20, W - 0.05, 0, 2.25, -1.40, boxHex));
    body.push(bx(9.24, 0.12, W + 0.02, 0, 3.36, -1.40, C_TRIM));   // nóc thùng
    body.push(bx(9.24, 0.12, W + 0.02, 0, 1.16, -1.40, C_TRIM));   // đáy thùng
    for (const sx of [-1, 1]) {
        body.push(bx(9.24, 2.20, 0.08, sx * (W / 2 - 0.02), 2.25, -1.40, C_TRIM));
        // gân sóng DỌC thùng: sọc mỏng (0.05 theo Z) chạy dọc chiều cao,
        // đặt cách đều dọc thùng — KHÔNG vẽ 1 sọc dài 9m (làm xe dài vượt).
        for (let i = 0; i < 6; i++) {
            const z = -5.10 + i * 1.55;
            body.push(bx(0.05, 2.02, 0.04, sx * (W / 2 - 0.01), 2.25, z, C_TRIM));
        }
    }
    // 2 cánh cửa sau + then chống
    body.push(bx(0.100, 2.06, 0.05, 0, 2.25, -5.98, C_TRIM));
    for (const sx of [-1, 1]) {
        body.push(bx(0.100, 0.24, 0.07, sx * 0.12, 2.25, -6.00, C_CHROME));
    }
    // cản sau + đèn hậu
    body.push(bx(0.160, 0.26, 2.40, 0, 1.02, -6.02, C_TRIM));
    tail.push(bx(0.060, 0.14, 0.18, -1.02, 1.30, -6.00, 0xd01c1c));
    tail.push(bx(0.060, 0.14, 0.18, 1.02, 1.30, -6.00, 0xd01c1c));
    // bánh: 1 trước + 2 cụm đôi sau (bánh đôi nằm TRONG bề rộng thân 2.485m)
    const r = 0.525, w = 0.300;
    for (const sx of [-1, 1]) {
        wheel(r, w, sx * 0.95, r, 4.20).forEach((g) => body.push(g));
        for (const sz of [-2.60, -3.90]) {
            wheel(r, w, sx * 0.78, r, sz).forEach((g) => body.push(g));
            wheel(r, w, sx * 1.06, r, sz).forEach((g) => body.push(g));
            body.push(bx(1.30, 0.40, 0.06, sx * 1.06, r + 0.16, sz, C_TRIM));
        }
    }
    return { body: merge(body), glass: merge(glass), head: merge(head), tail: merge(tail) };
}

// ----------------------------------------------------------------- SEMI
// Đầu kéo 6x4 + container 40ft ISO (12.192 x 2.438 x 2.591)
function buildSemi(cabHex, boxHex) {
    const body = [], glass = [], head = [], tail = [];
    const W = 2.500;
    const contLen = 12.192, contH = 2.591, contY = 1.32;
    const contZ = -2.00;                     // tâm container

    // --- container 40ft ---
    body.push(bx(contLen, contH, W - 0.06, 0, contY + contH / 2, contZ, boxHex));
    // gân sóng DỌC container (2 mặt, sọc mỏng 0.05 theo Z, cách đều)
    for (const sx of [-1, 1]) {
        for (let i = 0; i < 8; i++) {
            const z = contZ - 5.4 + i * 1.55;
            body.push(bx(0.05, contH - 0.20, 0.04, sx * (W / 2 - 0.02), contY + contH / 2, z, C_TRIM));
        }
    }
    // khung trên/dưới
    body.push(bx(contLen + 0.04, 0.12, W, 0, contY + contH, contZ, C_TRIM));
    body.push(bx(contLen + 0.04, 0.12, W, 0, contY, contZ, C_TRIM));
    // 2 cánh cửa sau + then chống + 4 góc tắc
    body.push(bx(0.090, contH - 0.16, 0.06, 0, contY + contH / 2, contZ - contLen / 2 - 0.04, C_TRIM));
    for (const sx of [-1, 1]) {
        body.push(bx(0.080, 0.22, 0.16, sx * 0.16, contY + contH / 2, contZ - contLen / 2 - 0.06, C_CHROME));
        for (const sy of [contY + 0.06, contY + contH - 0.06]) {
            body.push(bx(0.160, 0.12, 0.16, sx * (W / 2 - 0.10), sy, contZ - contLen / 2 + 0.08, C_TRIM));
            body.push(bx(0.160, 0.12, 0.16, sx * (W / 2 - 0.10), sy, contZ + contLen / 2 - 0.08, C_TRIM));
        }
    }
    // --- rơ-moóc ---
    body.push(bx(12.20, 0.24, 0.90, 0, 1.12, -2.50, C_TRIM));        // khung rơ
    body.push(bx(1.40, 0.10, 0.50, 0, 1.30, 3.20, C_TRIM));         // bàn tỳ (5th wheel)
    for (const sx of [-1, 1]) for (const sz of [-4.50, -6.00, -7.20]) {
        body.push(bx(0.900, 0.40, 0.06, sx * 0.98, 0.72, sz, C_TRIM));
    }
    // --- đầu kéo ---
    body.push(bx(4.40, 0.28, 0.94, 0, 1.06, 6.00, C_TRIM));          // khung đầu kéo
    body.push(bx(2.45, 1.95, W - 0.06, 0, 2.10, 6.90, cabHex));     // cabin
    body.push(bx(2.30, 0.10, W - 0.02, 0, 3.10, 6.90, cabHex));     // nóc cabin
    glass.push(bx(0.070, 0.92, W - 0.30, 0, 2.52, 8.08, C_GLASS, -0.14));
    for (const sx of [-1, 1]) {
        glass.push(bx(0.860, 0.66, 0.05, sx * (W / 2 - 0.01), 2.46, 6.90, C_GLASS));
        // gương cabin (2 gương mỗi bên như xe tải VN) — trong bề rộng thân
        body.push(bx(0.150, 0.44, 0.06, sx * (W / 2 - 0.06), 2.48, 7.80, C_TRIM));
        body.push(bx(0.130, 0.06, 0.06, sx * (W / 2 - 0.10), 2.68, 7.80, C_TRIM));
    }
    body.push(bx(0.100, 0.80, 1.40, 0, 1.62, 8.12, C_TRIM));          // lưới tản nhiệt
    body.push(bx(0.180, 0.32, 2.40, 0, 1.02, 8.16, C_TRIM));          // cản trước
    head.push(bx(0.070, 0.16, 0.34, -0.88, 1.80, 8.10, 0xfff3cf));
    head.push(bx(0.070, 0.16, 0.34, 0.88, 1.80, 8.10, 0xfff3cf));
    // bánh đầu kéo: 1 trước + 1 cụm đôi sau (trong bề rộng thân 2.5m)
    const r = 0.525, w = 0.300;
    for (const sx of [-1, 1]) {
        wheel(r, w, sx * 0.95, r, 7.00).forEach((g) => body.push(g));
        wheel(r, w, sx * 0.78, r, 5.00).forEach((g) => body.push(g));
        wheel(r, w, sx * 1.06, r, 5.00).forEach((g) => body.push(g));
    }
    // bánh rơ: 3 cụm đôi
    for (const sx of [-1, 1]) for (const sz of [-4.50, -6.00, -7.20]) {
        wheel(r, w, sx * 0.78, r, sz).forEach((g) => body.push(g));
        wheel(r, w, sx * 1.06, r, sz).forEach((g) => body.push(g));
    }
    // đèn hậu rơ + cản
    tail.push(bx(0.060, 0.14, 0.16, -1.02, 1.10, -8.10, 0xd01c1c));
    tail.push(bx(0.060, 0.14, 0.16, 1.02, 1.10, -8.10, 0xd01c1c));
    body.push(bx(0.140, 0.24, 2.30, 0, 1.02, -8.12, C_TRIM));
    return { body: merge(body), glass: merge(glass), head: merge(head), tail: merge(tail) };
}

// ---------------------------------------------------------------- template
const TEMPLATE_CACHE = new Map();

/** Trả về template đã gộp cho (kind, màu). Cache -> không cấp phát lại. */
export function getVehicleTemplate(kind, colorIndex) {
    const key = kind + "#" + colorIndex;
    let tpl = TEMPLATE_CACHE.get(key);
    if (tpl) return tpl;

    const paintPal = PAINT_PALETTES[kind] || [0xf2f4f7];
    const boxPal = BOX_PALETTES[kind] || paintPal;
    const paintHex = paintPal[colorIndex % paintPal.length];
    const boxHex = boxPal[colorIndex % boxPal.length];

    let parts;
    if (kind === NPC_VEHICLE_KIND.CAR) parts = buildCar(paintHex);
    else if (kind === NPC_VEHICLE_KIND.VAN16) parts = buildVan(paintHex);
    else if (kind === NPC_VEHICLE_KIND.TRUCK) parts = buildTruck(paintHex, boxHex);
    else parts = buildSemi(paintHex, boxHex);

    tpl = {
        kind, colorIndex, paintHex, boxHex,
        body: parts.body, glass: parts.glass, head: parts.head, tail: parts.tail
    };
    TEMPLATE_CACHE.set(key, tpl);
    return tpl;
}

export function getColorCount(kind) {
    return (PAINT_PALETTES[kind] || [0xffffff]).length;
}

/** Ngẫu nhiên màu cho 1 loại xe. */
export function pickVehicleColor(kind, random = Math.random) {
    const n = getColorCount(kind);
    return Math.floor(random() * n) % n;
}

// Material dùng CHUNG cho mọi xe (1 shader program -> không recompile)
const MAT_BODY = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0.12
});
const MAT_GLASS = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.42,
    roughness: 0.12, metalness: 0.3, depthWrite: false
});
const MAT_HEAD = new THREE.MeshStandardMaterial({
    color: 0xfff3cf, emissive: 0xfff3cf, emissiveIntensity: 0.9, roughness: 0.3
});
const MAT_TAIL = new THREE.MeshStandardMaterial({
    color: 0x8c1010, emissive: 0xff2020, emissiveIntensity: 0.7, roughness: 0.4
});

/**
 * Tạo 1 xe NPC. Trả về CÙNG interface với createNpcBus() của bus.js
 * (group/dimensions/setSteering/...) để TrafficAI/TrafficManager dùng
 * không cần biết loại xe.
 */
export function createNpcVehicle(kind, colorIndex = 0) {
    const tpl = getVehicleTemplate(kind, colorIndex);
    const spec = NPC_VEHICLE_SPECS[kind];
    const root = new THREE.Group();
    root.name = "npc_" + kind.toLowerCase();

    const mk = (geo, mat, castShadow) => {
        if (!geo) return null;
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = !!castShadow;
        m.receiveShadow = false;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        root.add(m);
        return m;
    };
    const bodyMesh = mk(tpl.body, MAT_BODY, true);
    mk(tpl.glass, MAT_GLASS, false);
    const headMesh = mk(tpl.head, MAT_HEAD, false);
    const tailMesh = mk(tpl.tail, MAT_TAIL, false);

    return {
        group: root,
        kind,
        colorIndex: tpl.colorIndex,
        dimensions: { length: spec.length, width: spec.width, height: spec.height },
        wheelRadius: spec.wheelRadius,
        // API tương thích createNpcBus (traffic chưa dùng tới nhưng giữ cho
        // tương thích nếu sau này bật bánh/vô-lăng cho NPC).
        setSteering: () => { },
        setWheelRotation: () => { },
        setDoor: () => { },
        setHeadlights: (on) => { if (headMesh) headMesh.visible = on !== false; },
        setTaillights: (on) => { if (tailMesh) tailMesh.visible = on !== false; },
        setInteriorLed: () => { },
        setSkin: () => { },
        skinPath: null,
        bodyMesh
    };
}

/** Giải phóng geometry của 1 template (chỉ dùng khi game đóng hẳn). */
export function disposeVehicleTemplates() {
    for (const tpl of TEMPLATE_CACHE.values()) {
        for (const k of ["body", "glass", "head", "tail"]) {
            if (tpl[k]) tpl[k].dispose();
        }
    }
    TEMPLATE_CACHE.clear();
    MAT_BODY.dispose(); MAT_GLASS.dispose(); MAT_HEAD.dispose(); MAT_TAIL.dispose();
}
