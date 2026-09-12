// js/map/data/roadTypes.js

import { quadSwapDiagonal } from "three/src/nodes/gpgpu/SubgroupFunctionNode.js";
import { QuadraticBezierCurve } from "three/src/Three.Core.js";

export const ROAD_TYPES = {
    QL1A: {
        id: 'QL1A',
        name: 'Quốc Lộ 1A',
        lanesPerDirection: 2,
        totalLanes: 4,
        laneWidth: 3.5,
        hasMedian: true,
        medianWidth: 2.0,
        medianType: 'green',
        hasShoulder: true,
        shoulderWidth: 1.5,
        shoulderColor: 0x555555,
        roadColor: 0x2a2a2a,
        laneMarkingColor: 0xffffff,
        medianColor: 0x4a7c3f,
        speedLimit: 80,
        aiMinSpeed: 40,
        aiMaxSpeed: 80,
        allowOvertaking: true,
        allowStopping: false,
        markings: {
            edgeLine: true,
            laneDivider: 'dashed',
            centerLine: 'double-yellow',
        },
        medianElements: {
            trees: true,
            treeSpacing: 30,
            streetLights: true,
            lightSpacing: 40,
            barrier: true,
        },
    },
    HIGHWAY: {
        id: 'HIGHWAY',
        name: 'Cao Tốc',
        lanesPerDirection: 2,
        totalLanes: 4,
        laneWidth: 3.75,
        hasMedian: true,
        medianWidth: 3.0,
        medianType: 'concrete',
        hasShoulder: true,
        shoulderWidth: 3.0,
        shoulderColor: 0x444444,
        hasEmergencyLane: true,
        roadColor: 0x222222,
        laneMarkingColor: 0xffffff,
        medianColor: 0x888888,
        speedLimit: 120,
        aiMinSpeed: 60,
        aiMaxSpeed: 120,
        allowOvertaking: true,
        allowStopping: false,
        restrictedAccess: true,
        markings: {
            edgeLine: 'solid-white',
            laneDivider: 'dashed',
            centerLine: 'none',
        },
        medianElements: {
            concreteBarrier: true,
            streetLights: true,
            lightSpacing: 50,
            trees: false,
            barrier: true,
        },
    },
    MAJOR_ROAD: {
        id: 'MAJOR_ROAD',
        name: 'Đường Lớn',
        lanesPerDirection: 2,
        totalLanes: 4,
        laneWidth: 3.25,
        hasMedian: false,
        medianWidth: 0.5,
        medianType: 'paint',
        hasShoulder: true,
        shoulderWidth: 1.0,
        shoulderColor: 0x666666,
        roadColor: 0x3a3a3a,
        laneMarkingColor: 0xffffff,
        medianColor: 0xffd700,
        speedLimit: 60,
        aiMinSpeed: 30,
        aiMaxSpeed: 60,
        allowOvertaking: true,
        allowStopping: true,
        markings: {
            edgeLine: true,
            laneDivider: 'dashed',
            centerLine: 'double-yellow',
        },
        medianElements: {
            trees: false,
            streetLights: true,
            lightSpacing: 25,
            barrier: false,
        },
    },
    NORMAL_ROAD: {
        id: 'NORMAL_ROAD',
        name: 'Đường Thường',
        lanesPerDirection: 1,
        totalLanes: 2,
        laneWidth: 3.25,
        hasMedian: false,
        medianWidth: 0.3,
        medianType: 'paint',
        hasShoulder: true,
        shoulderWidth: 1.0,
        shoulderColor: 0x666666,
        roadColor: 0x444444,
        laneMarkingColor: 0xffffff,
        medianColor: 0xffffff,
        speedLimit: 50,
        aiMinSpeed: 20,
        aiMaxSpeed: 50,
        allowOvertaking: false,
        allowStopping: true,
        markings: {
            edgeLine: true,
            laneDivider: 'none',
            centerLine: 'dashed-white',
        },
        medianElements: {
            trees: false,
            streetLights: true,
            lightSpacing: 30,
            barrier: false,
        },
    },
    STATION_ROAD: {
        id: 'STATION_ROAD',
        name: 'Đường Nội Bộ Bến',
        lanesPerDirection: 1,
        totalLanes: 2,
        laneWidth: 3.5,
        hasMedian: false,
        medianWidth: 0,
        medianType: 'none',
        hasShoulder: false,
        shoulderWidth: 0,
        roadColor: 0x555555,
        laneMarkingColor: 0xffff00,
        medianColor: null,
        speedLimit: 20,
        aiMinSpeed: 5,
        aiMaxSpeed: 20,
        allowOvertaking: false,
        allowStopping: true,
        markings: {
            edgeLine: false,
            laneDivider: 'none',
            centerLine: 'dashed-yellow',
        },
        medianElements: {
            trees: false,
            streetLights: false,
            barrier: false,
        },
    },
    ACCESS_ROAD: {
        id: 'ACCESS_ROAD',
        name: 'Đường Vào/Ra Trạm',
        lanesPerDirection: 1,
        totalLanes: 2,
        laneWidth: 3.0,
        hasMedian: false,
        medianWidth: 0,
        medianType: 'none',
        hasShoulder: false,
        shoulderWidth: 0.5,
        roadColor: 0x4a4a4a,
        laneMarkingColor: 0xffffff,
        medianColor: null,
        speedLimit: 30,
        aiMinSpeed: 10,
        aiMaxSpeed: 30,
        allowOvertaking: false,
        allowStopping: false,
        markings: {
            edgeLine: false,
            laneDivider: 'none',
            centerLine: 'solid-white',
        },
        medianElements: {
            trees: false,
            streetLights: false,
            barrier: false,
        },
    },
};


export function getRoadTypeConfig(type) {
    if (!type) return ROAD_TYPES.NORMAL_ROAD;
    return ROAD_TYPES[type] || ROAD_TYPES.NORMAL_ROAD;
}

export function calculateRoadWidth(config) {
    const laneWidthTotal = config.totalLanes * config.laneWidth;
    const medianWidth = config.hasMedian ? config.medianWidth : 0;
    const shoulderWidthTotal = config.hasShoulder ? config.shoulderWidth * 2 : 0;
    return laneWidthTotal + medianWidth + shoulderWidthTotal;
}

export function getLaneCenterOffset(config, laneIndex) {
    if (laneIndex < 0 || laneIndex >= config.totalLanes) {
        console.warn(`Invalid laneIndex: ${laneIndex} for road type ${config.id}`);
        return 0;
    }
    const halfTotalLanes = config.totalLanes / 2;
    const lanePosition = laneIndex - halfTotalLanes + 0.5;
    const medianOffset = config.hasMedian ?
        (lanePosition > 0 ? config.medianWidth / 2 : -config.medianWidth / 2) : 0;
    return (lanePosition * config.laneWidth) + medianOffset;
}

export function getAllLaneOffsets(config) {
    const offsets = [];
    for (let i = 0; i < config.totalLanes; i++) {
        offsets.push(getLaneCenterOffset(config, i));
    }
    return offsets;
}

export function isForwardLane(config, laneIndex) {
    const halfTotalLanes = config.totalLanes / 2;
    return laneIndex >= halfTotalLanes;
}

const LEGACY_TYPE_MAPPING = {
    'highway': 'HIGHWAY',
    'highway_entrance': 'ACCESS_ROAD',
    'highway_exit': 'ACCESS_ROAD',
    'urban': 'MAJOR_ROAD',
    'mountain': 'NORMAL_ROAD',
    'tunnel': 'NORMAL_ROAD',
    'bus_station_road': 'STATION_ROAD',
    'rest_stop_road': 'STATION_ROAD',
    'gas_station_road': 'STATION_ROAD',
    'rest_stop_entrance': 'ACCESS_ROAD',
    'rest_stop_exit': 'ACCESS_ROAD',
    'gas_station_entrance': 'ACCESS_ROAD',
    'gas_station_exit': 'ACCESS_ROAD',
    'road': 'NORMAL_ROAD',
};

export function mapLegacyType(legacyType, width = 0) {
    if (legacyType === 'highway' && width >= 15) {
        return 'QL1A';
    }
    return LEGACY_TYPE_MAPPING[legacyType] || 'NORMAL_ROAD';
}

export function getForwardLaneIndices(config) {
    const indices = [];
    const halfTotal = config.totalLanes / 2;
    for (let i = halfTotal; i < config.totalLanes; i++) {
        indices.push(i);
    }
    return indices;
}

export function getBackwardLaneIndices(config) {
    const indices = [];
    const halfTotal = config.totalLanes / 2;
    for (let i = 0; i < halfTotal; i++) {
        indices.push(i);
    }
    return indices;
}

export function getLaneSpeedLimit(config, laneIndex) {
    const baseLimit = config.speedLimit;
    if (laneIndex === config.totalLanes - 1) {
        return baseLimit * 0.8;
    }
    if (config.lanesPerDirection >= 2 &&
        laneIndex === config.totalLanes / 2) {
        return baseLimit;
    }
    return baseLimit;
}
