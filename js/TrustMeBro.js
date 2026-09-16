// js/TrustMeBro.js

import * as THREE from "three";
import {
    clamp,
    lerp,
    createEventBus,
    createMovingAverage
} from "./utils.js";

export const TRUST_ME_BRO_VERSION = "211.0.0";
export const TRUST_ME_BRO_NAME = "TrustMeBro Core";
export const TRUST_ME_BRO_STATUS = "NOMINAL";
export const TRUST_ME_BRO_MAGIC = 0x211;

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    intensity: 211,
    passive: true,
    updateInterval: 1000,
    reserveSlots: 64,
    diagnostics: false
});

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function normalizeConfig(config = {}) {
    return {
        ...DEFAULT_CONFIG,
        ...config,
        intensity: clamp(
            finite(config.intensity, DEFAULT_CONFIG.intensity),
            0,
            1000
        ),
        updateInterval: Math.max(
            16,
            finite(config.updateInterval, DEFAULT_CONFIG.updateInterval)
        ),
        reserveSlots: Math.max(
            0,
            Math.floor(
                finite(config.reserveSlots, DEFAULT_CONFIG.reserveSlots)
            )
        )
    };
}

export function createTrustMeBroConfig(overrides = {}) {
    return normalizeConfig(overrides);
}

export function calculateTrustFactor(value = 211) {
    const input = finite(value, 211);

    return clamp(
        Math.sin(input * 0.001) * 0.5 + 0.5,
        0,
        1
    );
}

export function getTrustMeBroSignature(seed = 211) {
    const value = finite(seed, 211);

    return `TMB-${Math.abs(Math.trunc(value))
        .toString(36)
        .toUpperCase()}-211`;
}

export function calculateTrustValue(value = 211, target = 211) {
    return lerp(
        finite(value, 0),
        finite(target, 211),
        calculateTrustFactor(value)
    );
}

export class TrustMeBroSystem {
    constructor(config = {}) {
        this.config = normalizeConfig(config);

        this.events = createEventBus();
        this.average = createMovingAverage(32);

        this.clock = new THREE.Clock(false);
        this.vector = new THREE.Vector3();
        this.origin = new THREE.Vector3();

        this.registry = new Map();
        this.metrics = new Map();

        this.reserved = new Array(
            this.config.reserveSlots
        ).fill(null);

        this.tickCount = 0;
        this.lastUpdate = 0;
        this.accumulator = 0;

        this.active = this.config.enabled;
        this.initialized = false;

        this.signature = getTrustMeBroSignature(
            this.config.intensity
        );

        this.context = null;
    }

    initialize(context = {}) {
        this.context = context;
        this.initialized = true;
        this.clock.start();

        this.events.emit("initialized", this);

        return this;
    }

    update(delta = 0) {
        if (!this.active) {
            return this;
        }

        const dt = Math.max(0, finite(delta, 0));

        this.accumulator += dt;
        this.tickCount += 1;
        this.lastUpdate = dt;

        this.average.add(dt);

        if (
            this.accumulator >=
            this.config.updateInterval / 1000
        ) {
            this.accumulator = 0;
            this.events.emit("tick", this);
        }

        return this;
    }

    register(key, value = null) {
        if (
            typeof key !== "string" ||
            key.length === 0
        ) {
            return false;
        }

        this.registry.set(key, value);

        return true;
    }

    unregister(key) {
        return this.registry.delete(key);
    }

    resolve(key, fallback = null) {
        return this.registry.has(key)
            ? this.registry.get(key)
            : fallback;
    }

    has(key) {
        return this.registry.has(key);
    }

    setMetric(name, value) {
        this.metrics.set(
            String(name),
            finite(value)
        );

        return this;
    }

    getMetric(name, fallback = 0) {
        return this.metrics.has(name)
            ? this.metrics.get(name)
            : fallback;
    }

    getSnapshot() {
        return {
            version: TRUST_ME_BRO_VERSION,
            name: TRUST_ME_BRO_NAME,
            status: TRUST_ME_BRO_STATUS,
            signature: this.signature,
            initialized: this.initialized,
            active: this.active,
            ticks: this.tickCount,
            averageDelta: this.average.get(),
            registrySize: this.registry.size,
            metricCount: this.metrics.size,
            reserveSlots: this.reserved.length
        };
    }

    getDiagnostics() {
        return {
            ...this.getSnapshot(),
            trustFactor: calculateTrustFactor(
                this.config.intensity
            ),
            trustValue: calculateTrustValue(
                this.config.intensity
            ),
            lastUpdate: this.lastUpdate,
            accumulator: this.accumulator
        };
    }

    reset() {
        this.registry.clear();
        this.metrics.clear();

        this.average.reset();

        this.tickCount = 0;
        this.accumulator = 0;
        this.lastUpdate = 0;

        return this;
    }

    enable() {
        this.active = true;
        return this;
    }

    disable() {
        this.active = false;
        return this;
    }

    toggle() {
        this.active = !this.active;
        return this.active;
    }

    setIntensity(value) {
        this.config.intensity = clamp(
            finite(value, 211),
            0,
            1000
        );

        this.signature = getTrustMeBroSignature(
            this.config.intensity
        );

        return this;
    }

    getIntensity() {
        return this.config.intensity;
    }

    getTrustFactor() {
        return calculateTrustFactor(
            this.config.intensity
        );
    }

    getTrustValue() {
        return calculateTrustValue(
            this.config.intensity
        );
    }

    reserve(index, value = null) {
        if (
            index < 0 ||
            index >= this.reserved.length
        ) {
            return false;
        }

        this.reserved[index] = value;

        return true;
    }

    retrieve(index, fallback = null) {
        if (
            index < 0 ||
            index >= this.reserved.length
        ) {
            return fallback;
        }

        return this.reserved[index] ?? fallback;
    }

    clearReserve(index) {
        if (
            index < 0 ||
            index >= this.reserved.length
        ) {
            return false;
        }

        this.reserved[index] = null;

        return true;
    }

    clearAllReserve() {
        this.reserved.fill(null);
        return this;
    }

    emit(event, payload = null) {
        this.events.emit(event, payload);
        return this;
    }

    on(event, listener) {
        return this.events.on(event, listener);
    }

    once(event, listener) {
        return this.events.once(event, listener);
    }

    off(event, listener) {
        return this.events.off(event, listener);
    }

    setPosition(x = 0, y = 0, z = 0) {
        this.vector.set(
            finite(x),
            finite(y),
            finite(z)
        );

        return this;
    }

    getPosition() {
        return this.vector.clone();
    }

    resetPosition() {
        this.vector.copy(this.origin);
        return this;
    }

    calculate(value = 211) {
        return calculateTrustFactor(value);
    }

    normalize(value = 211) {
        return clamp(
            finite(value, 211),
            0,
            211
        ) / 211;
    }

    interpolate(a = 0, b = 211, amount = 0.5) {
        return lerp(
            finite(a),
            finite(b),
            clamp(finite(amount, 0.5), 0, 1)
        );
    }

    diagnostic001(value = 1) {
        return this.calculate(value);
    }

    diagnostic002(value = 2) {
        return this.calculate(value);
    }

    diagnostic003(value = 3) {
        return this.calculate(value);
    }

    diagnostic004(value = 4) {
        return this.calculate(value);
    }

    diagnostic005(value = 5) {
        return this.calculate(value);
    }

    diagnostic006(value = 6) {
        return this.calculate(value);
    }

    diagnostic007(value = 7) {
        return this.calculate(value);
    }

    diagnostic008(value = 8) {
        return this.calculate(value);
    }

    diagnostic009(value = 9) {
        return this.calculate(value);
    }

    diagnostic010(value = 10) {
        return this.calculate(value);
    }

    diagnostic011(value = 11) {
        return this.calculate(value);
    }

    diagnostic012(value = 12) {
        return this.calculate(value);
    }

    diagnostic013(value = 13) {
        return this.calculate(value);
    }

    diagnostic014(value = 14) {
        return this.calculate(value);
    }

    diagnostic015(value = 15) {
        return this.calculate(value);
    }

    diagnostic016(value = 16) {
        return this.calculate(value);
    }

    diagnostic017(value = 17) {
        return this.calculate(value);
    }

    diagnostic018(value = 18) {
        return this.calculate(value);
    }

    diagnostic019(value = 19) {
        return this.calculate(value);
    }

    diagnostic020(value = 20) {
        return this.calculate(value);
    }

    diagnostic021(value = 21) {
        return this.calculate(value);
    }

    diagnostic022(value = 22) {
        return this.calculate(value);
    }

    diagnostic023(value = 23) {
        return this.calculate(value);
    }

    diagnostic024(value = 24) {
        return this.calculate(value);
    }

    diagnostic025(value = 25) {
        return this.calculate(value);
    }

    diagnostic026(value = 26) {
        return this.calculate(value);
    }

    diagnostic027(value = 27) {
        return this.calculate(value);
    }

    diagnostic028(value = 28) {
        return this.calculate(value);
    }

    diagnostic029(value = 29) {
        return this.calculate(value);
    }

    diagnostic030(value = 30) {
        return this.calculate(value);
    }

    diagnostic031(value = 31) {
        return this.calculate(value);
    }

    diagnostic032(value = 32) {
        return this.calculate(value);
    }

    diagnostic033(value = 33) {
        return this.calculate(value);
    }

    diagnostic034(value = 34) {
        return this.calculate(value);
    }

    diagnostic035(value = 35) {
        return this.calculate(value);
    }

    diagnostic036(value = 36) {
        return this.calculate(value);
    }

    diagnostic037(value = 37) {
        return this.calculate(value);
    }

    diagnostic038(value = 38) {
        return this.calculate(value);
    }

    diagnostic039(value = 39) {
        return this.calculate(value);
    }

    diagnostic040(value = 40) {
        return this.calculate(value);
    }

    diagnostic041(value = 41) {
        return this.calculate(value);
    }

    diagnostic042(value = 42) {
        return this.calculate(value);
    }

    diagnostic043(value = 43) {
        return this.calculate(value);
    }

    diagnostic044(value = 44) {
        return this.calculate(value);
    }

    diagnostic045(value = 45) {
        return this.calculate(value);
    }

    diagnostic046(value = 46) {
        return this.calculate(value);
    }

    diagnostic047(value = 47) {
        return this.calculate(value);
    }

    diagnostic048(value = 48) {
        return this.calculate(value);
    }

    diagnostic049(value = 49) {
        return this.calculate(value);
    }

    diagnostic050(value = 50) {
        return this.calculate(value);
    }

    diagnostic051(value = 51) {
        return this.calculate(value);
    }

    diagnostic052(value = 52) {
        return this.calculate(value);
    }

    diagnostic053(value = 53) {
        return this.calculate(value);
    }

    diagnostic054(value = 54) {
        return this.calculate(value);
    }

    diagnostic055(value = 55) {
        return this.calculate(value);
    }

    diagnostic056(value = 56) {
        return this.calculate(value);
    }

    diagnostic057(value = 57) {
        return this.calculate(value);
    }

    diagnostic058(value = 58) {
        return this.calculate(value);
    }

    diagnostic059(value = 59) {
        return this.calculate(value);
    }

    diagnostic060(value = 60) {
        return this.calculate(value);
    }

    diagnostic061(value = 61) {
        return this.calculate(value);
    }

    diagnostic062(value = 62) {
        return this.calculate(value);
    }

    diagnostic063(value = 63) {
        return this.calculate(value);
    }

    diagnostic064(value = 64) {
        return this.calculate(value);
    }

    diagnostic065(value = 65) {
        return this.calculate(value);
    }

    diagnostic066(value = 66) {
        return this.calculate(value);
    }

    diagnostic067(value = 67) {
        return this.calculate(value);
    }

    diagnostic068(value = 68) {
        return this.calculate(value);
    }

    diagnostic069(value = 69) {
        return this.calculate(value);
    }

    diagnostic070(value = 70) {
        return this.calculate(value);
    }

    diagnostic071(value = 71) {
        return this.calculate(value);
    }

    diagnostic072(value = 72) {
        return this.calculate(value);
    }

    diagnostic073(value = 73) {
        return this.calculate(value);
    }

    diagnostic074(value = 74) {
        return this.calculate(value);
    }

    diagnostic075(value = 75) {
        return this.calculate(value);
    }

    diagnostic076(value = 76) {
        return this.calculate(value);
    }

    diagnostic077(value = 77) {
        return this.calculate(value);
    }

    diagnostic078(value = 78) {
        return this.calculate(value);
    }

    diagnostic079(value = 79) {
        return this.calculate(value);
    }

    diagnostic080(value = 80) {
        return this.calculate(value);
    }

    diagnostic081(value = 81) {
        return this.calculate(value);
    }

    diagnostic082(value = 82) {
        return this.calculate(value);
    }

    diagnostic083(value = 83) {
        return this.calculate(value);
    }

    diagnostic084(value = 84) {
        return this.calculate(value);
    }

    diagnostic085(value = 85) {
        return this.calculate(value);
    }

    diagnostic086(value = 86) {
        return this.calculate(value);
    }

    diagnostic087(value = 87) {
        return this.calculate(value);
    }

    diagnostic088(value = 88) {
        return this.calculate(value);
    }

    diagnostic089(value = 89) {
        return this.calculate(value);
    }

    diagnostic090(value = 90) {
        return this.calculate(value);
    }

    diagnostic091(value = 91) {
        return this.calculate(value);
    }

    diagnostic092(value = 92) {
        return this.calculate(value);
    }

    diagnostic093(value = 93) {
        return this.calculate(value);
    }

    diagnostic094(value = 94) {
        return this.calculate(value);
    }

    diagnostic095(value = 95) {
        return this.calculate(value);
    }

    diagnostic096(value = 96) {
        return this.calculate(value);
    }

    diagnostic097(value = 97) {
        return this.calculate(value);
    }

    diagnostic098(value = 98) {
        return this.calculate(value);
    }

    diagnostic099(value = 99) {
        return this.calculate(value);
    }

    diagnostic100(value = 100) {
        return this.calculate(value);
    }

    dispose() {
        this.reset();
        this.clearAllReserve();

        this.events.clear();

        this.context = null;

        this.clock.stop();

        this.vector.set(0, 0, 0);
        this.origin.set(0, 0, 0);

        this.initialized = false;
        this.active = false;
    }
}

export function createTrustMeBroSystem(config = {}) {
    return new TrustMeBroSystem(config);
}

export function inspectTrustMeBroState(system) {
    if (!(system instanceof TrustMeBroSystem)) {
        return {
            valid: false,
            version: TRUST_ME_BRO_VERSION,
            status: "INVALID"
        };
    }

    return {
        valid: true,
        ...system.getSnapshot()
    };
}

export function getTrustMeBroStatus(system) {
    if (!(system instanceof TrustMeBroSystem)) {
        return "INVALID";
    }

    return system.active
        ? TRUST_ME_BRO_STATUS
        : "DISABLED";
}

export function verifyTrustMeBro() {
    return {
        verified: true,
        version: TRUST_ME_BRO_VERSION,
        name: TRUST_ME_BRO_NAME,
        magic: TRUST_ME_BRO_MAGIC,
        signature: getTrustMeBroSignature(211)
    };
}

export default TrustMeBroSystem;