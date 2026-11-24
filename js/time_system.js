// js/time_system.js
// Hệ thống thời gian trong ngày liên tục - tính toán vị trí mặt trời/mặt trăng thực tế cho Việt Nam
import * as THREE from "three";
import { clamp, lerp, smoothstep } from "./utils.js";

export const VIETNAM_LAT = 14.0;     // vĩ độ trung bình tuyến Phú Yên → TP.HCM
export const VIETNAM_LON = 108.0;    // kinh độ trung bình
export const TIMEZONE_OFFSET = 7;    // UTC+7

// Các mốc thời gian trong ngày (phút từ 00:00)
export const TIME_MARKERS = {
    MIDNIGHT: 0,
    PRE_DAWN: 4 * 60 + 30,      // 04:30
    DAWN: 5 * 60,                // 05:00
    SUNRISE_START: 5 * 60 + 30,  // 05:30
    SUNRISE_END: 6 * 60 + 30,    // 06:30
    MORNING: 7 * 60,             // 07:00
    NOON: 12 * 60,               // 12:00
    AFTERNOON: 15 * 60,          // 15:00
    GOLDEN_HOUR_START: 16 * 60 + 30, // 16:30
    SUNSET_START: 17 * 60,       // 17:00
    SUNSET_END: 18 * 60 + 30,    // 18:30
    TWILIGHT: 19 * 60,           // 19:00
    NIGHT: 20 * 60,              // 20:00
};

export const SUN_PARAMS = {
    distance: 15000,        // khoảng cách mặt trời (đơn vị world)
    angularRadius: 0.00465, // góc nhìn mặt trời ~0.53 độ
};

export const MOON_PARAMS = {
    distance: 12000,
    angularRadius: 0.00465,
    phaseCycleDays: 29.53,
};

// Do sang cua anh sang trang ban dem (chi dung cho khung gio 18h-5h).
// YÊU CẦU (22/11): "lúc tối là tối thui, chỉ có đèn đường và đèn xe là nguồn sáng;
// vẫn thấy ÍT ÍT màu, không phải mesh nào cũng đen đặc".
// Trang chi la dia sang tren troi + anh mong du nhan silhouette — KHONG con la
// nguon sang chinh nhu ban cu 1.6..2.6 (dem sang nhu co den pha san).
// Gia tri cu 1.6..2.6 + ambient .27 + exposure .44 cho dem = 0.70 cua ngay
// (do thuc te luc 00:36: datR 66 so voi 94 luc trua) -> THAT LA BAN NGAY MAC AO DEM.
// Gio amb 0.035 + moon 0.12..0.22 + exp 0.30 -> dat ~0.2 cua ngay, van co mau.
// Endpoint nay dung cho ca transition 17-18h va 5-6h (lerp 0<->MOON_NIGHT_MAX)
// nen hoang hon/binh minh lienvong, khong nhay luc 18:00.
export const MOON_NIGHT_MIN = 0.12;
export const MOON_NIGHT_MAX = 0.22;

export class TimeSystem {
    constructor(options = {}) {
        this.gameTimeMinutes = options.initialMinutes ?? 360; // 06:00 mặc định
        this.timeScale = options.timeScale ?? 1.0;
        this.dayOfYear = options.dayOfYear ?? 172; // 21/6 (mùa hè Việt Nam)
        this.latitude = options.latitude ?? VIETNAM_LAT;
        this.longitude = options.longitude ?? VIETNAM_LON;
        this.timezoneOffset = options.timezoneOffset ?? TIMEZONE_OFFSET;

        // Cache tính toán
        this._sunDirection = new THREE.Vector3();
        this._moonDirection = new THREE.Vector3();
        this._sunPosition = new THREE.Vector3();
        this._moonPosition = new THREE.Vector3();
        this._sunIntensity = 0;
        this._moonIntensity = 0;
        this._ambientIntensity = 0.2;
        this._skyColor = new THREE.Color(0x87CEEB);
        this._fogColor = new THREE.Color(0x87CEEB);
        this._sunColor = new THREE.Color(0xFFFFFF);
        this._moonColor = new THREE.Color(0xAAAAFF);
        this._fogNear = 260;
        this._fogFar = 1450;
        this._hazeDensity = 0;
        this._exposure = 1.0;

        // Phase mặt trăng
        this._moonPhase = 0; // 0 = new, 0.5 = full
        this._moonPhaseAngle = 0;

        this.updateTimeOfDay();
    }

    // Cập nhật thời gian game (được gọi mỗi frame từ main.js)
    update(deltaTime) {
        if (!deltaTime) return;
        this.gameTimeMinutes += deltaTime * this.timeScale;
        if (this.gameTimeMinutes >= 1440) {
            this.gameTimeMinutes -= 1440;
            this.dayOfYear = (this.dayOfYear % 365) + 1;
        }
        this.updateTimeOfDay();
    }

    // Set thời gian tuyệt đối (phút từ 00:00)
    setGameTime(minutes) {
        this.gameTimeMinutes = ((minutes % 1440) + 1440) % 1440;
        this.updateTimeOfDay();
    }

    // Cộng thêm phút (dùng cho dừng bến, giao lộ...)
    addGameMinutes(minutes) {
        if (!minutes || !isFinite(minutes)) return;
        this.gameTimeMinutes = (this.gameTimeMinutes + minutes) % 1440;
        if (this.gameTimeMinutes < 0) this.gameTimeMinutes += 1440;
        this.updateTimeOfDay();
    }

    // Lấy giờ game format HH:MM
    getTimeString() {
        const h = Math.floor(this.gameTimeMinutes / 60);
        const m = Math.floor(this.gameTimeMinutes % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    // Tính declination (độ chệch) của mặt trời theo ngày trong năm
    // Công thức Spencer 1971 - đủ chính xác cho game
    _solarDeclination() {
        const dayAngle = (2 * Math.PI * (this.dayOfYear - 1)) / 365;
        return (
            0.006918 -
            0.399912 * Math.cos(dayAngle) +
            0.070257 * Math.sin(dayAngle) -
            0.006758 * Math.cos(2 * dayAngle) +
            0.000907 * Math.sin(2 * dayAngle) -
            0.002697 * Math.cos(3 * dayAngle) +
            0.00148 * Math.sin(3 * dayAngle)
        );
    }

    // Equation of time (phút) - chênh lệch giữa mean solar time và apparent solar time
    _equationOfTime() {
        const dayAngle = (2 * Math.PI * (this.dayOfYear - 1)) / 365;
        return (
            229.18 *
            (0.000075 +
                0.001868 * Math.cos(dayAngle) -
                0.032077 * Math.sin(dayAngle) -
                0.014615 * Math.cos(2 * dayAngle) -
                0.040849 * Math.sin(2 * dayAngle))
        );
    }

    // Tính hour angle (góc giờ) từ thời gian local
    _hourAngle() {
        // Solar time = local time + equation of time + 4*(longitude - timezone*15)
        const solarTimeMinutes =
            this.gameTimeMinutes +
            this._equationOfTime() +
            4 * (this.longitude - this.timezoneOffset * 15);
        const solarHour = solarTimeMinutes / 60;
        return (solarHour - 12) * (Math.PI / 12); // radian
    }

    // Cập nhật toàn bộ thông số thời tiết/ánh sáng
    updateTimeOfDay() {
        const dec = this._solarDeclination();
        const ha = this._hourAngle();
        const latRad = (this.latitude * Math.PI) / 180;

        // Vị trí mặt trời (altitude, azimuth) - dùng cho shadow direction
        const sinAlt = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(ha);
        const altitude = Math.asin(clamp(sinAlt, -1, 1));
        const cosAz = (Math.sin(dec) - Math.sin(latRad) * sinAlt) / (Math.cos(latRad) * Math.cos(altitude));
        const azimuth = Math.acos(clamp(cosAz, -1, 1));
        const azSign = ha < 0 ? -1 : 1;
        const sunAz = azSign * azimuth;

        this._sunDirection.set(
            Math.sin(sunAz) * Math.cos(altitude),
            Math.sin(altitude),
            Math.cos(sunAz) * Math.cos(altitude)
        ).normalize();

        this._sunPosition.copy(this._sunDirection).multiplyScalar(SUN_PARAMS.distance);

        // Mặt trăng
        this._updateMoon(sunAz);

        // Lighting, sky, exposure theo giờ game (không dùng altitude)
        this._computeLighting();
        this._computeSkyAndFog();
        this._exposure = this._computeExposure();
    }

    _updateMoon(sunAzimuth) {
        // Moon phase dựa trên dayOfYear (đơn giản)
        const phaseCycle = MOON_PARAMS.phaseCycleDays;
        this._moonPhase = ((this.dayOfYear % phaseCycle) / phaseCycle) * Math.PI * 2;
        this._moonPhaseAngle = this._moonPhase;

        // Mặt trăng mọc/lặn theo giờ game: mọc ~18h, lặn ~6h
        const hours = this.gameTimeMinutes / 60;
        let moonAlt;
        if (hours >= 18 || hours < 6) {
            // Đêm: trăng lên cao
            const nightHours = hours >= 18 ? hours - 18 : hours + 6; // 0-12
            moonAlt = Math.sin((nightHours / 12) * Math.PI) * 0.8; // 0->0.8->0
        } else {
            // Ban ngày: trăng dưới horizon
            moonAlt = -0.5;
        }
        const moonAz = sunAzimuth + Math.PI;

        this._moonDirection.set(
            Math.sin(moonAz) * Math.cos(moonAlt),
            Math.sin(moonAlt),
            Math.cos(moonAz) * Math.cos(moonAlt)
        ).normalize();

        this._moonPosition.copy(this._moonDirection).multiplyScalar(MOON_PARAMS.distance);
    }

    _computeLighting() {
        const hours = this.gameTimeMinutes / 60;
        
        // Sáng sớm: 5-6h
        if (hours >= 5 && hours < 6) {
            const t = (hours - 5) / 1; // 0->1
            // Endpoint KHỚP đêm (0 sun / 0.035 amb) và ngày (1 / 0.7) —
            // trước đây 0.1/0.18/0.6 làm giờ 05:00 và 06:00 nhảy ánh sáng.
            this._sunIntensity = lerp(0, 1, t);
            this._ambientIntensity = lerp(0.035, 0.7, t);
            this._moonIntensity = lerp(MOON_NIGHT_MAX, 0, t);
            this._sunColor.setHSL(lerp(0.02, 0.08, t), lerp(0.7, 0.15, t), lerp(0.5, 0.9, t));
        }
        // Sáng: 6-17h
        else if (hours >= 6 && hours < 17) {
            this._sunIntensity = 1.0;
            this._ambientIntensity = 0.7;  // tăng từ 0.5 -> 0.7
            this._moonIntensity = 0;
            this._sunColor.setHSL(0.08, 0.1, 0.98); // vàng nhẹ trắng
        }
        // Hoàng hôn: 17-18h
        else if (hours >= 17 && hours < 18) {
            const t = (hours - 17) / 1; // 0->1
            // Liền mạch với ngày (17:00: sun 1 / amb 0.7) và đêm
            // (18:00: sun 0 / amb 0.035 / moon ~0.2). Hoàng hôn vẫn có nắng
            // xiên dần nhưng KHÔNG giữ ambient sáng đến 18:00.
            this._sunIntensity = lerp(1, 0, t);
            this._ambientIntensity = lerp(0.7, 0.035, t);
            this._moonIntensity = lerp(0, MOON_NIGHT_MAX, t);
            this._sunColor.setHSL(lerp(0.08, 0.02, t), lerp(0.1, 0.7, t), lerp(0.98, 0.5, t));
        }
        // Tối đen: 18-5h
        else {
            this._sunIntensity = 0;
            // YÊU CẦU 22/11: "tối thui, chỉ có đèn đường và đèn xe là nguồn sáng;
            // vẫn thấy ít ít màu". Ambient chỉ là ánh xén để material giữ chút màu —
            // 0.035 đủ thấy livery mờ, không biến cabin thành hố đen (0 -> đen đặc).
            // Đèn đường/đèn xe mới là nguồn sáng thật (moon 0.12..0.22 chỉ nhận silhouette).
            // Các bản cũ .27/4-6/.44 cho đêm = 0.70 ngày -> "bán ngày mặc áo đêm".
            this._ambientIntensity = 0.035;
            // Trăng 18h-6h: cường độ 0.12..0.22, chỉ đủ nhận silhouette.
            this._moonIntensity = MOON_NIGHT_MIN + (MOON_NIGHT_MAX - MOON_NIGHT_MIN) * Math.max(0, Math.sin(this._moonPhaseAngle));
            this._sunColor.setHex(0xFF3300);
            this._moonColor.setHSL(0.58, 0.15, 0.85);
        }
    }

    _computeSkyAndFog() {
        const hours = this.gameTimeMinutes / 60;
        const moonFactor = Math.max(0, Math.sin(this._moonPhaseAngle)) * 0.5 + 0.1;
        
        // Gradient params for each phase's own colour ramp (0 -> 1 inside its window)
        const dawnT = smoothstep(5, 6, hours);
        const duskT = smoothstep(17, 18, hours);

        // Phase weights MUST be a partition of unity (sum === 1).
        // Timeline: night [0,5) | night->dawn [5,6) | day [6,17)
        //           | day->dusk [17,18) | dusk->night [18,19) | night [19,24)
        let wNight, wDawn, wDay, wDusk;
        if (hours < 5) {
            wNight = 1; wDawn = 0; wDay = 0; wDusk = 0;
        } else if (hours < 6) {
            wNight = 1 - dawnT; wDawn = dawnT; wDay = 0; wDusk = 0;
        } else if (hours < 17) {
            wNight = 0; wDawn = 0; wDay = 1; wDusk = 0;
        } else if (hours < 18) {
            wNight = 0; wDawn = 0; wDay = 1 - duskT; wDusk = duskT;
        } else if (hours < 19) {
            const t = smoothstep(18, 19, hours);
            wNight = t; wDawn = 0; wDay = 0; wDusk = 1 - t;
        } else {
            wNight = 1; wDawn = 0; wDay = 0; wDusk = 0;
        }

        // Smooth transitions between all periods
        // Dawn (5-6h): gradient cam/vàng → xanh
        const dawnSkyH = lerp(0.04, 0.55, dawnT);
        const dawnSkyS = lerp(0.6, 0.6, dawnT);
        const dawnSkyL = lerp(0.006, 0.65, dawnT);  // đầu dải = đêm đen, không nhảy lúc 05:00
        const dawnFogH = lerp(0.05, 0.55, dawnT);
        const dawnFogS = lerp(0.5, 0.4, dawnT);
        const dawnFogL = lerp(0.01, 0.75, dawnT);
        const dawnFogNear = lerp(60, 300, dawnT);
        const dawnFogFar = lerp(500, 2000, dawnT);
        const dawnHaze = lerp(0.0004, 0.00015, dawnT);
        
        // Day (6-17h): xanh dương rõ - REDUCED LIGHTNESS
        const daySkyH = 0.55, daySkyS = 0.6, daySkyL = 0.65;  // Reduced from 0.75 to 0.65
        const dayFogH = 0.55, dayFogS = 0.4, dayFogL = 0.8;
        const dayFogNear = 300, dayFogFar = 2000, dayHaze = 0.00015;
        
        // Dusk (17-18h): gradient cam/đỏ → xanh đen
        const duskSkyH = lerp(0.04, 0.62, duskT);
        const duskSkyS = lerp(0.6, 0.35, duskT);
        const duskSkyL = lerp(0.65, 0.006, duskT);  // đầu = trời ngày, cuối = trời đêm đen
        const duskFogH = lerp(0.05, 0.62, duskT);
        const duskFogS = lerp(0.5, 0.3, duskT);
        const duskFogL = lerp(0.8, 0.01, duskT);
        const duskFogNear = lerp(300, 60, duskT);
        const duskFogFar = lerp(2000, 500, duskT);
        const duskHaze = lerp(0.00015, 0.0008, duskT);
        
        // Night (18-5h): navy đen, sao, trăng
        // Trời đêm đen thui như ngoài đời: lightness ~0.005 (gần #010104).
        // Sắc xanh tím chỉ còn ở mức rất nhạt để không thành khối đen tuyền.
        const nightSkyH = 0.72, nightSkyS = 0.45, nightSkyL = 0.003 + moonFactor * 0.004;
        const nightFogH = 0.72, nightFogS = 0.35, nightFogL = 0.004 + moonFactor * 0.005;
        const nightFogNear = 60, nightFogFar = 500, nightHaze = 0.0008;  // closer fog for night

        // Blend all periods smoothly
        this._skyColor.setHSL(
            dawnSkyH * wDawn + daySkyH * wDay + duskSkyH * wDusk + nightSkyH * wNight,
            dawnSkyS * wDawn + daySkyS * wDay + duskSkyS * wDusk + nightSkyS * wNight,
            dawnSkyL * wDawn + daySkyL * wDay + duskSkyL * wDusk + nightSkyL * wNight
        );
        
        this._fogColor.setHSL(
            dawnFogH * wDawn + dayFogH * wDay + duskFogH * wDusk + nightFogH * wNight,
            dawnFogS * wDawn + dayFogS * wDay + duskFogS * wDusk + nightFogS * wNight,
            dawnFogL * wDawn + dayFogL * wDay + duskFogL * wDusk + nightFogL * wNight
        );
        
        this._fogNear = dawnFogNear * wDawn + dayFogNear * wDay + duskFogNear * wDusk + nightFogNear * wNight;
        this._fogFar = dawnFogFar * wDawn + dayFogFar * wDay + duskFogFar * wDusk + nightFogFar * wNight;
        this._hazeDensity = dawnHaze * wDawn + dayHaze * wDay + duskHaze * wDusk + nightHaze * wNight;
    }

    _computeExposure() {
        const hours = this.gameTimeMinutes / 60;
        const moonFactor = Math.max(0, Math.sin(this._moonPhaseAngle));
        
        if (hours >= 5 && hours < 6) {
            const t = (hours - 5) / 1;
            return lerp(0.30, 1.0, t);  // endpoint = DEM (0.30), khong nhay luc 06:00
        }
        else if (hours >= 6 && hours < 17) {
            return 1.0;
        }
        else if (hours >= 17 && hours < 18) {
            const t = (hours - 17) / 1;
            // endpoint = DEM (0.30): cả hai bên 18:00 đều = 0.30 nên liền mạch.
            return lerp(1.0, 0.30, t);
        }
        else {
            // Đêm: exposure 0.30 (+ tối đa 0.02 theo pha trăng) — thấp hơn hẳn
            // bản cũ 0.44 từng cho đêm = 0.70 ngày. Đèn đường/đèn xe tự lo phần sáng;
            // trời thì đã bị sky shader ép gần đen bởi uNightFactor.
            // Đầu 5-6h và 17-18h cũng lerp về 0.30 nên không nhảy ở 18:00.
            return 0.30 + moonFactor * 0.02;
        }
    }

    // Getters
    getGameTime() { return this.gameTimeMinutes; }
    getSunDirection() { return this._sunDirection.clone(); }
    getMoonDirection() { return this._moonDirection.clone(); }
    getSunPosition() { return this._sunPosition.clone(); }
    getMoonPosition() { return this._moonPosition.clone(); }
    getSunIntensity() { return this._sunIntensity; }
    getMoonIntensity() { return this._moonIntensity; }
    getAmbientIntensity() { return this._ambientIntensity; }
    getSkyColor() { return this._skyColor.clone(); }
    getFogColor() { return this._fogColor.clone(); }
    getSunColor() { return this._sunColor.clone(); }
    getMoonColor() { return this._moonColor.clone(); }
    getFogNear() { return this._fogNear; }
    getFogFar() { return this._fogFar; }
    getHazeDensity() { return this._hazeDensity; }
    getExposure() { return this._exposure; }
    getSunAltitude() { return Math.asin(clamp(this._sunDirection.y, -1, 1)); }
    getMoonPhase() { return this._moonPhase; }
    isDay() { const h = this.gameTimeMinutes / 60; return h >= 6 && h < 18; }
    isNight() { const h = this.gameTimeMinutes / 60; return h >= 18 || h < 5; }
    isTwilight() { const h = this.gameTimeMinutes / 60; return (h >= 5 && h < 6) || (h >= 17 && h < 18); }
    isGoldenHour() { const h = this.gameTimeMinutes / 60; return h >= 17 && h < 18; }
}

// Debug helper
export function getTimeOfDayLabel(timeSystem) {
    const hours = timeSystem.getGameTime() / 60;
    if (hours >= 6 && hours < 17) return "SÁNG";
    if (hours >= 5 && hours < 6) return "SÁNG SỚM";
    if (hours >= 17 && hours < 18) return "HOÀNG HÔN";
    return "TỐI";
}