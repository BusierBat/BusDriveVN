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
// Truoc do chi la 0.05 + 0.25*sin(moonPhase) = 0.05..0.30, nhung luc do vi tri trang bi dat
// DUOI DAT (xem shadows.js updateMoonDirection) nen tri gia nay khong he co tac dung gi.
// Sau khi sua vi tri, do thuc te tren than xe (RGB/255, khong co ambient):
//   moon 0.3 -> [11,13,14] | moon 1 -> [13,15,17] | moon 3 -> [20,23,25] |
//   moon 5 -> [28,32,34]  | moon 8 -> [41,47,49]
// Can >=3 moi thay ro duoc livery. Sky dem la #2e2f3c ~ [46,47,60], nen gioi han tren 7.0
// (~[37,42,44]) van giu duoc than xe toi hon troi -> van giu cam giac ban dem.
// Hien tai 3.0..7.0 (do tren ban do trang luc outputColorSpace con SAI la LinearSRGB,
// moi tone bi lam toi nen can tang man). Sau khi sua outputColorSpace thanh SRGB
// (xem main.js), sweep luc 02:30 cho thay:
//   amb .30 + moon 3.0 -> ground [52,53,54]  (sang hon sky [46,47,60] -> sai)
//   amb .25 + moon 2.0 -> ground [38,39,40]  (duoi sky -> dung)
//   amb .25 + moon 4.0 -> ~[46] (trang day van nhan, du sang hon trang moi)
// Anh trang dem. Truoc do la 2.0/4.0 -> o luc 22:30 (moon 2) ben xe do duoc
// [47,59,68], khong doc duoc livery (yeu cau goc BUG 1: "dem toi khong thay skin xe").
// Sweep tren bbox xe (xem comment _ambientIntensity): moon 4 -> bus [76,88,96].
// 4.0/6.0 = bus ~[76..89], ground ~[78..94] van duoi ref ngay [103,118,119].
// Day cung la gia tri dung cho transition 17-18h va 5-6h (lerp 0<->MOON_NIGHT_MAX),
// nen tang no cung lam hoang hon/dawn lienvong voi dem (truoc do 17:59 moon=4 ->
// 18:00 moon=2..4 co nhay xuong).
// SWEEP THUC TE 00:36 (canh 3 nguon: dat ben hong khong bi den pha / vung den
// pha tren duong / be mat xe), do trung binh RGB/255, doi chieu ngay 12:30:
//   amb .27 / moon 4-6 / exp .44 -> datR 66  pool 133 bus 59  (dem = 0.70 ngay -> "sang nhu ngay")
//   amb .18 / moon 1.6-2.6/.34   -> datR 40  pool 104 bus 25  (dem = 0.43 ngay)  <- CHON
//   amb .14 / moon 1.2-2.0/.30   -> datR 33  pool  95 bus 18  (dem = 0.35 ngay -> qua toi, xe bien mat)
//   NGAY 12:30 (tham chieu):     -> datR  94 pool 168 bus 89
// 4.0/6.0 truoc do cho dem = 0.70 cua ngay — that ra la BAN NGAY dang mac ao dem.
// 1.6/2.6 van du de: pool den pha 104 GAP 2.6 LAN datR 40 nen duong van ro rang
// de lai, bus 25/255 van co silhouette + emissive den sau/den cabin.
// Cung la endpoint cua transition 17-18h va 5-6h (lerp 0<->MOON_NIGHT_MAX) nen
// hoang hon/binh minh van lienvong (17:59 moon -> 2.6 = 18:00 moon).
export const MOON_NIGHT_MIN = 1.6;
export const MOON_NIGHT_MAX = 2.6;

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
        this._updateMoon(altitude, sunAz);

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
            this._sunIntensity = lerp(0.1, 0.8, t);
            this._ambientIntensity = lerp(0.18, 0.6, t);  // endpoint = DEM (0.18), khong nhay luc 06:00
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
            this._sunIntensity = lerp(0.8, 0.05, t);
            this._ambientIntensity = lerp(0.5, 0.18, t);  // endpoint = DEM (0.18), khong nhay luc 18:00
            // LIEN MAO 18:00: dusk ket thuc tai 0.18 = ambient cua dem (0.18). Cung luc
            // 17:59 moon = MOON_NIGHT_MAX = 2.6 va 18:00 dem la 1.6..2.6 -> khong nhay.
            this._moonIntensity = lerp(0, MOON_NIGHT_MAX, t);
            this._sunColor.setHSL(lerp(0.08, 0.02, t), lerp(0.1, 0.7, t), lerp(0.98, 0.5, t));
        }
        // Tối đen: 18-5h
        else {
            this._sunIntensity = 0;
            // SWEEP LAI (yeu cau: "dem van toi nhu chi co trang" -> khong thay duoc skin xe).
            // Lan truoc chon 0.30 roi ha 0.25 chi de EP ground < sky. Do la sai ly thuyet:
            // sky o day la `scene.background` (#2e2f3c, khong qua tonemap -> do duoc byte-exact)
            // va anh sang trang/sang ambient KHONG anh hue den no -> hai thu DOC LAP.
            // Tang anh trang thi xe/toi sang, sky van [46,47,60] (da do xac nhan).
            // Do lai luc 22:30 tren BUNG XE (bbox projected), khong phai ground nua:
            //   amb .25/moon 2.0/exp .38 -> bus [47,59,68]   ground [41,42,43]   QUA TOI
            //   amb .27/moon 4.0/exp .44 -> bus [76,88,96]   ground [78,80,80]   CHON
            //   amb .28/moon 5.0/exp .46 -> bus [89,100,108] ground [94,96,95]
            //   amb .30/moon 6.0/exp .48 -> bus [100,112,119] ground [109,110,110] QUA SANG
            //   ref NGAY (12:30):         ground [103,118,119] building [125,149,151]
            // SWEEP MOI (BUG 4: "dem van sang nhu ngay", do luc 00:36, xem MOON_NIGHT_MIN):
            // truoc do amb .27/4-6/.44 cho dat ben hong = 66/255 = 0.70 cua ngay (94)
            // -> dem khac ngay qua it. Chon .18 + moon 1.6-2.6 + exp .34 cho 40/255 = 0.43.
            // Dat 0.16/.32 -> 33 (0.35) va 0.11/.27 -> 28: qua toi, mat chi tiet quanh xe.
            // Xe bus do duoc 25/255 (silhouette ro + den sau/den cabin emissive van thay),
            // vung den pha tren duong 104/255 GAP 2.6 lan dat xung quanh -> van LAI DUOC.
            this._ambientIntensity = 0.15;  // Reduced from 0.18 for darker night
            // BUG FIX: truoc do chi la `0.05 + 0.25 * sin(moonPhase)` -> 0.05..0.30. Vi tri
            // trang truoc do bi dat DUOI DAT (xem shadows.js updateMoonDirection) nen tri gia
            // nay khong he co tac dung. Sau khi sua vi tri, do sang thuc te tren xe bus do duoc:
            //   moon 0.3 -> [11,13,14] | moon 3 -> [20,23,25] | moon 8 -> [41,47,49] (RGB/255)
            // Can 2..5 moi thay ro duoc livery xe; 0.30 thi van la mot chiec xe den thui.
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
        // BUG FIX: the old `nightT = 1 - max(dawnT, dayT, duskT)` was broken because
        // smoothstep saturates at 1 for every hour past its edge — so after 18h all three
        // of dawnT/dayT/duskT were 1, nightT was 0, the weights summed to 3, and the blended
        // HSL lightness overflowed past 1.0 -> clamp -> WHITE sky + WHITE fog.
        // (Live proof before the fix: fogColor #ffffff, fogNear 680, fogFar 4400.)
        //
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
        const dawnSkyL = lerp(0.5, 0.65, dawnT);  // Reduced lightness from 0.7 to 0.65
        const dawnFogH = lerp(0.05, 0.55, dawnT);
        const dawnFogS = lerp(0.5, 0.4, dawnT);
        const dawnFogL = lerp(0.5, 0.75, dawnT);
        const dawnFogNear = lerp(150, 300, dawnT);
        const dawnFogFar = lerp(800, 2000, dawnT);
        const dawnHaze = lerp(0.0004, 0.00015, dawnT);
        
        // Day (6-17h): xanh dương rõ - REDUCED LIGHTNESS
        const daySkyH = 0.55, daySkyS = 0.6, daySkyL = 0.65;  // Reduced from 0.75 to 0.65
        const dayFogH = 0.55, dayFogS = 0.4, dayFogL = 0.8;
        const dayFogNear = 300, dayFogFar = 2000, dayHaze = 0.00015;
        
        // Dusk (17-18h): gradient cam/đỏ → xanh đen
        const duskSkyH = lerp(0.04, 0.62, duskT);
        const duskSkyS = lerp(0.6, 0.35, duskT);
        const duskSkyL = lerp(0.5, 0.2, duskT);
        const duskFogH = lerp(0.05, 0.62, duskT);
        const duskFogS = lerp(0.5, 0.3, duskT);
        const duskFogL = lerp(0.5, 0.2, duskT);
        const duskFogNear = lerp(300, 80, duskT);
        const duskFogFar = lerp(2000, 400, duskT);
        const duskHaze = lerp(0.00015, 0.0008, duskT);
        
        // Night (18-5h): navy đen, sao, trăng
        const nightSkyH = 0.65, nightSkyS = 0.25, nightSkyL = 0.02 + moonFactor * 0.04;  // Reduced lightness for darker night
        const nightFogH = 0.65, nightFogS = 0.2, nightFogL = 0.04 + moonFactor * 0.04;  // darker fog
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
            return lerp(0.34, 1.0, t);  // endpoint = DEM (0.34), khong nhay luc 06:00
        }
        else if (hours >= 6 && hours < 17) {
            return 1.0;
        }
        else if (hours >= 17 && hours < 18) {
            const t = (hours - 17) / 1;
            // endpoint = DEM (0.34): ca hai ben 18:00 deu = 0.34 nen lienvong.
            return lerp(1.0, 0.34, t);
        }
        else {
            // Dem: SWEEP 00:36 (xem MOON_NIGHT_MIN). Truoc do 0.44 + moon*0.05 cho
            // dem = 0.70 cua ngay -> "sang nhu ban ngay". Ha xuong 0.34 + moon*0.03:
            //   exp .44 -> datR 66 | exp .34 -> datR 40 | exp .30 -> 33 | exp .27 -> 28
            // 0.34 giu vung den pha 104/255 (duong truoc mat van ro) va khong day
            // geometry vuot ref ngay. moonFactor*0.03 (truoc 0.05) de trang tron
            // van nhe hon ngay nhu truoc.
            return 0.30 + moonFactor * 0.02;  // Reduced from 0.34 for darker night
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