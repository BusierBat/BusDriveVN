// js/map/laneGenerator.js - GENERATOR ĐƯỜNG VỚI LANE MARKINGS VÀ MEDIAN
// Tối ưu cho máy yếu: Shared materials, InstancedMesh cho elements lặp lại

import * as THREE from "three";
import {
    getRoadTypeConfig,
    calculateRoadWidth,
    getLaneCenterOffset,
    getAllLaneOffsets
} from "./data/roadTypes.js";

// ============================================================
// SHARED MATERIALS (Tối ưu - chỉ tạo 1 lần)
// ============================================================

const _materials = {};

function getMaterials() {
    if (_materials.initialized) return _materials;
    
    // Road surfaces
    _materials.asphaltDark = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.95,
        metalness: 0.0,
    });
    
    _materials.asphaltMedium = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.95,
        metalness: 0.0,
    });
    
    _materials.asphaltLight = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a,
        roughness: 0.95,
        metalness: 0.0,
    });
    
    _materials.concrete = new THREE.MeshStandardMaterial({
        color: 0x555555,
        roughness: 0.9,
        metalness: 0.0,
    });
    
    // Lane markings
    _materials.whiteLine = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3,
        emissive: 0x111111,
        emissiveIntensity: 0.1,
    });
    
    _materials.yellowLine = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        emissive: 0x111100,
        emissiveIntensity: 0.1,
    });
    
    // Median elements
    _materials.grass = new THREE.MeshStandardMaterial({
        color: 0x4a7c3f,
        roughness: 1.0,
    });
    
    _materials.concreteBarrier = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.8,
        metalness: 0.1,
    });
    
    _materials.metalBarrier = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        roughness: 0.4,
        metalness: 0.7,
    });
    
    // Trees
    _materials.treeTrunk = new THREE.MeshStandardMaterial({
        color: 0x5a3a22,
        roughness: 0.9,
    });
    
    _materials.treeFoliage = new THREE.MeshStandardMaterial({
        color: 0x2d5a1e,
        roughness: 1.0,
    });
    
    // Street lights
    _materials.lightPole = new THREE.MeshStandardMaterial({
        color: 0x666666,
        roughness: 0.3,
        metalness: 0.8,
    });
    
    _materials.lightHead = new THREE.MeshStandardMaterial({
        color: 0xfff8dc,
        emissive: 0xfff8dc,
        emissiveIntensity: 0.5,
        roughness: 0.2,
    });
    
    // Shoulder
    _materials.shoulder = new THREE.MeshStandardMaterial({
        color: 0x555555,
        roughness: 0.98,
    });
    
    _materials.initialized = true;
    return _materials;
}

// ============================================================
// SHARED GEOMETRIES (Tối ưu)
// ============================================================

const _geometries = {};

function getGeometries() {
    if (_geometries.initialized) return _geometries;
    
    _geometries.dashMark = new THREE.BoxGeometry(0.15, 0.05, 3.0);
    _geometries.solidLine = new THREE.BoxGeometry(0.12, 0.05, 1.0);
    _geometries.barrier = new THREE.BoxGeometry(0.15, 0.6, 1.0);
    _geometries.treeTrunk = new THREE.CylinderGeometry(0.15, 0.2, 2.0, 6);
    _geometries.treeFoliage = new THREE.SphereGeometry(1.2, 6, 6);
    _geometries.lightPole = new THREE.CylinderGeometry(0.08, 0.1, 8.0, 6);
    _geometries.lightHead = new THREE.BoxGeometry(1.0, 0.15, 0.3);
    
    _geometries.initialized = true;
    return _geometries;
}

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Tạo road mesh với lane markings và median
 * @param {object} options
 * @param {THREE.Group} options.group - Group để add meshes
 * @param {number} options.startX - X start point
 * @param {number} options.startZ - Z start point
 * @param {number} options.endX - X end point
 * @param {number} options.endZ - Z end point
 * @param {string} options.roadType - Road type ('QL1A', 'HIGHWAY', etc.)
 * @param {object} options.segmentData - Dữ liệu segment gốc
 * @returns {THREE.Group} - Group chứa road meshes
 */
export function generateLaneRoad({
    group,
    startX,
    startZ,
    endX,
    endZ,
    roadType = 'NORMAL_ROAD',
    segmentData = {}
}) {
    const mats = getMaterials();
    const geos = getGeometries();
    const config = getRoadTypeConfig(roadType);
    
    // Tính toán cơ bản
    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    const length = Math.hypot(endX - startX, endZ - startZ);
    const angle = Math.atan2(endX - startX, endZ - startZ);
    const totalWidth = calculateRoadWidth(config);
    
    // Vector vuông góc với đường (perpendicular)
    const perpX = Math.cos(angle);
    const perpZ = -Math.sin(angle);
    
    // ===== 1. MẶT ĐƯỜNG CHÍNH =====
    _createRoadSurface(group, midX, midZ, angle, length, totalWidth, config, mats);
    
    // ===== 2. LỀ ĐƯỜNG (SHOULDER) =====
    if (config.hasShoulder && config.shoulderWidth > 0) {
        _createShoulders(group, midX, midZ, angle, length, totalWidth, config, perpX, perpZ, mats);
    }
    
    // ===== 3. DẢI PHÂN CÁCH GIỮA (MEDIAN) =====
    if (config.hasMedian && config.medianWidth > 0) {
        _createMedian(group, midX, midZ, angle, length, config, perpX, perpZ, mats, geos);
    }
    
    // ===== 4. VẠCH LÀN ĐƯỜNG (LANE MARKINGS) =====
    _createLaneMarkings(group, midX, midZ, angle, length, config, perpX, perpZ, mats, geos);
    
    // ===== 5. MEDIAN ELEMENTS (CÂY, ĐÈN) =====
    if (config.hasMedian && config.medianElements) {
        _createMedianElements(group, midX, midZ, angle, length, config, perpX, perpZ, mats, geos, startX, startZ, endX, endZ);
    }
    
    return group;
}

// ============================================================
// PRIVATE FUNCTIONS
// ============================================================

/**
 * Tạo mặt đường chính
 */
function _createRoadSurface(group, midX, midZ, angle, length, width, config, mats) {
    let material;
    switch (config.id) {
        case 'QL1A':
        case 'HIGHWAY':
            material = mats.asphaltDark;
            break;
        case 'MAJOR_ROAD':
            material = mats.asphaltMedium;
            break;
        case 'NORMAL_ROAD':
            material = mats.asphaltLight;
            break;
        case 'STATION_ROAD':
        case 'ACCESS_ROAD':
            material = mats.concrete;
            break;
        default:
            material = mats.asphaltMedium;
    }
    
    const road = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.2, length),
        material
    );
    road.position.set(midX, 0.1, midZ);
    road.rotation.y = angle;
    road.receiveShadow = true;
    road.userData.roadType = config.id;
    group.add(road);
}

/**
 * Tạo lề đường (shoulders) hai bên
 */
function _createShoulders(group, midX, midZ, angle, length, totalWidth, config, perpX, perpZ, mats) {
    const shoulderWidth = config.shoulderWidth;
    
    // Shoulder bên phải (hướng đi)
    const rightOffset = (totalWidth / 2) - (shoulderWidth / 2);
    const shoulderRight = new THREE.Mesh(
        new THREE.BoxGeometry(shoulderWidth, 0.15, length),
        mats.shoulder
    );
    shoulderRight.position.set(
        midX + rightOffset * perpX,
        0.075,
        midZ + rightOffset * perpZ
    );
    shoulderRight.rotation.y = angle;
    group.add(shoulderRight);
    
    // Shoulder bên trái (hướng về)
    const shoulderLeft = new THREE.Mesh(
        new THREE.BoxGeometry(shoulderWidth, 0.15, length),
        mats.shoulder
    );
    shoulderLeft.position.set(
        midX - rightOffset * perpX,
        0.075,
        midZ - rightOffset * perpZ
    );
    shoulderLeft.rotation.y = angle;
    group.add(shoulderLeft);
}

/**
 * Tạo dải phân cách giữa (median)
 */
function _createMedian(group, midX, midZ, angle, length, config, perpX, perpZ, mats, geos) {
    const medianWidth = config.medianWidth;
    
    switch (config.medianType) {
        case 'green':
            // Median cỏ + cây + lan can
            const grassMedian = new THREE.Mesh(
                new THREE.BoxGeometry(medianWidth, 0.3, length),
                mats.grass
            );
            grassMedian.position.set(midX, 0.15, midZ);
            grassMedian.rotation.y = angle;
            group.add(grassMedian);
            
            // Lan can hai bên median
            _createMedianBarriers(group, midX, midZ, angle, length, medianWidth, perpX, perpZ, mats, geos);
            break;
            
        case 'concrete':
            // Rào chắn bê tông liên tục
            const concreteMedian = new THREE.Mesh(
                new THREE.BoxGeometry(medianWidth * 0.6, 0.8, length),
                mats.concreteBarrier
            );
            concreteMedian.position.set(midX, 0.4, midZ);
            concreteMedian.rotation.y = angle;
            group.add(concreteMedian);
            break;
            
        case 'metal':
            // Lan can kim loại
            _createMedianBarriers(group, midX, midZ, angle, length, medianWidth, perpX, perpZ, mats, geos);
            break;
            
        case 'paint':
            // Chỉ vạch sơn (đường lớn)
            _createPaintMedian(group, midX, midZ, angle, length, config, mats, geos);
            break;
    }
}

/**
 * Tạo lan can hai bên median
 */
function _createMedianBarriers(group, midX, midZ, angle, length, medianWidth, perpX, perpZ, mats, geos) {
    const barrierOffset = medianWidth / 2;
    
    // Barrier bên phải median
    const barrierRight = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.6, length),
        mats.metalBarrier
    );
    barrierRight.position.set(
        midX + barrierOffset * perpX,
        0.5,
        midZ + barrierOffset * perpZ
    );
    barrierRight.rotation.y = angle;
    group.add(barrierRight);
    
    // Barrier bên trái median
    const barrierLeft = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.6, length),
        mats.metalBarrier
    );
    barrierLeft.position.set(
        midX - barrierOffset * perpX,
        0.5,
        midZ - barrierOffset * perpZ
    );
    barrierLeft.rotation.y = angle;
    group.add(barrierLeft);
}

/**
 * Tạo vạch sơn median (đường lớn)
 */
function _createPaintMedian(group, midX, midZ, angle, length, config, mats, geos) {
    // Vạch đôi màu vàng
    const yellowLine1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.05, length),
        mats.yellowLine
    );
    yellowLine1.position.set(midX - 0.15, 0.21, midZ);
    yellowLine1.rotation.y = angle;
    group.add(yellowLine1);
    
    const yellowLine2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.05, length),
        mats.yellowLine
    );
    yellowLine2.position.set(midX + 0.15, 0.21, midZ);
    yellowLine2.rotation.y = angle;
    group.add(yellowLine2);
}

/**
 * Tạo vạch làn đường (lane markings)
 */
function _createLaneMarkings(group, midX, midZ, angle, length, config, perpX, perpZ, mats, geos) {
    const laneOffsets = getAllLaneOffsets(config);
    const markings = config.markings;
    
    // ===== EDGE LINES (VẠCH LỀ) =====
    if (markings.edgeLine) {
        const edgeOffset = calculateRoadWidth(config) / 2 - 0.3;
        
        // Edge line phải
        const edgeRight = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.05, length),
            mats.whiteLine
        );
        edgeRight.position.set(
            midX + edgeOffset * perpX,
            0.21,
            midZ + edgeOffset * perpZ
        );
        edgeRight.rotation.y = angle;
        group.add(edgeRight);
        
        // Edge line trái
        const edgeLeft = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.05, length),
            mats.whiteLine
        );
        edgeLeft.position.set(
            midX - edgeOffset * perpX,
            0.21,
            midZ - edgeOffset * perpZ
        );
        edgeLeft.rotation.y = angle;
        group.add(edgeLeft);
    }
    
    // ===== LANE DIVIDERS (VẠCH PHÂN LÀN) =====
    if (markings.laneDivider === 'dashed') {
        // Chỉ vẽ giữa các lane cùng hướng (không vẽ giữa 2 hướng)
        const halfTotal = Math.floor(config.totalLanes / 2);
        
        // Dividers cho hướng đi (forward)
        for (let i = 1; i < halfTotal; i++) {
            const dividerOffset = getLaneCenterOffset(config, halfTotal + i - 1) + 
                                  (config.laneWidth / 2);
            _createDashedLine(group, midX, midZ, angle, length, dividerOffset, perpX, perpZ, mats, geos);
        }
        
        // Dividers cho hướng về (backward)
        for (let i = 1; i < halfTotal; i++) {
            const dividerOffset = getLaneCenterOffset(config, i - 1) + 
                                  (config.laneWidth / 2);
            _createDashedLine(group, midX, midZ, angle, length, dividerOffset, perpX, perpZ, mats, geos);
        }
    }
    
    // ===== CENTER LINE (VẠCH GIỮA) =====
    if (!config.hasMedian && markings.centerLine !== 'none') {
        if (markings.centerLine === 'double-yellow') {
            _createPaintMedian(group, midX, midZ, angle, length, config, mats, geos);
        } else if (markings.centerLine === 'dashed-white') {
            _createDashedLine(group, midX, midZ, angle, length, 0, perpX, perpZ, mats, geos);
        } else if (markings.centerLine === 'dashed-yellow') {
            _createDashedLine(group, midX, midZ, angle, length, 0, perpX, perpZ, mats, geos, mats.yellowLine);
        }
    }
}

/**
 * Tạo vạch đứt nét (dashed line)
 */
function _createDashedLine(group, midX, midZ, angle, length, offset, perpX, perpZ, mats, geos, material = null) {
    const dashMat = material || mats.whiteLine;
    const dashLength = 3.0;
    const gapLength = 6.0;
    const totalDashLength = dashLength + gapLength;
    const dashCount = Math.floor(length / totalDashLength);
    
    // Tạo InstancedMesh để tối ưu
    const dashMesh = new THREE.InstancedMesh(
        geos.dashMark,
        dashMat,
        Math.max(1, dashCount)
    );
    
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    
    for (let i = 0; i < dashCount; i++) {
        const t = (i * totalDashLength + dashLength / 2) / length - 0.5;
        const dashX = midX + t * length * Math.sin(angle) + offset * perpX;
        const dashZ = midZ + t * length * Math.cos(angle) + offset * perpZ;
        
        matrix.compose(
            new THREE.Vector3(dashX, 0.22, dashZ),
            quaternion,
            new THREE.Vector3(1, 1, 1)
        );
        dashMesh.setMatrixAt(i, matrix);
    }
    
    dashMesh.count = dashCount;
    dashMesh.instanceMatrix.needsUpdate = true;
    group.add(dashMesh);
}

/**
 * Tạo các elements trong median (cây, đèn đường)
 */
function _createMedianElements(group, midX, midZ, angle, length, config, perpX, perpZ, mats, geos, startX, startZ, endX, endZ) {
    const elements = config.medianElements;
    
    // ===== CÂY XANH =====
    if (elements.trees && elements.treeSpacing > 0) {
        _createTrees(group, startX, startZ, endX, endZ, angle, length, elements.treeSpacing, mats, geos);
    }
    
    // ===== ĐÈN ĐƯỜNG =====
    if (elements.streetLights && elements.lightSpacing > 0) {
        _createStreetLights(group, startX, startZ, endX, endZ, angle, length, elements.lightSpacing, perpX, perpZ, mats, geos);
    }
}

/**
 * Tạo cây xanh trong median
 */
function _createTrees(group, startX, startZ, endX, endZ, angle, length, spacing, mats, geos) {
    const treeCount = Math.floor(length / spacing);
    if (treeCount <= 0) return;
    
    // InstancedMesh cho trunk và foliage
    const trunkMesh = new THREE.InstancedMesh(geos.treeTrunk, mats.treeTrunk, treeCount);
    const foliageMesh = new THREE.InstancedMesh(geos.treeFoliage, mats.treeFoliage, treeCount);
    
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    
    for (let i = 0; i < treeCount; i++) {
        const t = ((i + 0.5) * spacing) / length - 0.5;
        const x = startX + (endX - startX) * (t + 0.5);
        const z = startZ + (endZ - startZ) * (t + 0.5);
        
        // Trunk
        matrix.compose(
            new THREE.Vector3(x, 1.0, z),
            quaternion,
            scale
        );
        trunkMesh.setMatrixAt(i, matrix);
        
        // Foliage
        matrix.compose(
            new THREE.Vector3(x, 2.8, z),
            quaternion,
            scale
        );
        foliageMesh.setMatrixAt(i, matrix);
    }
    
    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
    
    group.add(trunkMesh);
    group.add(foliageMesh);
}

/**
 * Tạo đèn đường trong median (chiếu sáng 2 hướng)
 */
function _createStreetLights(group, startX, startZ, endX, endZ, angle, length, spacing, perpX, perpZ, mats, geos) {
    const lightCount = Math.floor(length / spacing);
    if (lightCount <= 0) return;
    
    // InstancedMesh cho pole
    const poleMesh = new THREE.InstancedMesh(geos.lightPole, mats.lightPole, lightCount);
    
    // Light heads (không instanced vì cần 2 mỗi cột)
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    
    for (let i = 0; i < lightCount; i++) {
        const t = ((i + 0.5) * spacing) / length - 0.5;
        const x = startX + (endX - startX) * (t + 0.5);
        const z = startZ + (endZ - startZ) * (t + 0.5);
        
        // Pole
        matrix.compose(
            new THREE.Vector3(x, 4.0, z),
            quaternion,
            scale
        );
        poleMesh.setMatrixAt(i, matrix);
        
        // Light head 1 (hướng phải)
        const lightHead1 = new THREE.Mesh(geos.lightHead, mats.lightHead);
        lightHead1.position.set(
            x + 1.5 * perpX,
            7.8,
            z + 1.5 * perpZ
        );
        lightHead1.rotation.y = angle + Math.PI / 2;
        group.add(lightHead1);
        
        // Light head 2 (hướng trái)
        const lightHead2 = new THREE.Mesh(geos.lightHead, mats.lightHead);
        lightHead2.position.set(
            x - 1.5 * perpX,
            7.8,
            z - 1.5 * perpZ
        );
        lightHead2.rotation.y = angle + Math.PI / 2;
        group.add(lightHead2);
    }
    
    poleMesh.instanceMatrix.needsUpdate = true;
    group.add(poleMesh);
}

// ============================================================
// CLEANUP
// ============================================================

export function disposeLaneGenerator() {
    const mats = getMaterials();
    const geos = getGeometries();
    
    for (const key in mats) {
        if (mats[key] && mats[key].dispose) {
            mats[key].dispose();
        }
    }
    
    for (const key in geos) {
        if (geos[key] && geos[key].dispose) {
            geos[key].dispose();
        }
    }
    
    _materials.initialized = false;
    _geometries.initialized = false;
}