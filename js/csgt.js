// js/csgt.js

const DEFAULTS = {
    hudValueId: "hud-speed-limit-value",
    warningId: "hud-csgt-warning",
    sampleRadius: 120,       // m: bán kính tìm đoạn đường gần xe
    csgtDetectRadius: 140,   // m: tầm phát hiện của chốt CSGT
    csgtStopSignalRadius: 90,// m: tầm CSGT ra hiệu dừng xe
    updateInterval: 0.25,    // s: tần số quét (4 Hz)
    toleranceKmh: 5,         // vượt quá limit + tolerance mới tính vi phạm
    violationHoldSec: 1.5,   // phải vượt liên tục chừng này giây mới phạt
    warningSec: 4,           // thời gian hiện bảng cảnh báo
    resetAfterSec: 10,       // thời gian hết vi phạm để hạ nhiệt
};

/** Khoảng cách từ điểm tới đoạn thẳng (m) + tham số chiếu t (0..1). */
function pointSegDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - (ax + dx * t), ez =         pz - (az + dz * t);
    return Math.sqrt(ex * ex + ez * ez);
}

/** Giới hạn tốc độ của 1 segment, đọc từ dữ liệu đường. */
export function getSegmentSpeedLimit(roadGraph, seg) {
    if (!seg) return null;
    const raw = Number(seg.speed);
    if (Number.isFinite(raw) && raw > 0) return raw;
    if (roadGraph && typeof roadGraph.getLaneMeta === "function") {
        try {
            const meta = roadGra
            ph.getLaneMeta(seg);
            const m = meta ? Number(meta.speedKmh) : NaN;
            if (Number.isFinite(m) && m > 0) return m;
        } catch (e) { /* bỏ qua nếu thiếu dữ liệu */ }
    }
    return null;
}

export function createCSGTManager({ roadGraph, stationsData = [], options = {} } = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const hudEl = document.getElementById(cfg.hudValueId);
    const warnEl = document.getElementById(cfg.warningId);

    let limitKmh = null;
    let limitText = "";
    let clock = 0;
    let overSec = 0;
    let warnLeft = 0;
    let calmSec = 0;
    let violations = 0;
    let currentSegId = null;
    let lastRenderState = ""; // Dùng dirty-check chống nhấp nháy

    // Chỉ dùng điểm được dữ liệu đánh dấu rõ là CSGT; trạm thu phí không đồng nghĩa với CSGT.
    const csgtCheckpoints = [];
    if (Array.isArray(stationsData)) {
        for (const st of stationsData) {
            if (!st || !["CSGT", "POLICE_CHECKPOINT"].includes(st.type)
                || !Number.isFinite(st.x) || !Number.isFinite(st.z)) continue;
            csgtCheckpoints.push({
                id: st.id || st.name,
                name: st.name || "Chốt CSGT",
                x: st.x,
                y: Number.isFinite(st.y) ? st.y : 0,
                z: st.z,
                radius: Number.isFinite(st.radius) && st.radius > 0 ? st.radius : cfg.csgtDetectRadius,
                stopSignal: st.stopSignal === true
            });
        }
    }

    function findNearestSegment(x, z) {
        if (!roadGraph || typeof roadGraph.segmentsNear !== "function") return null;
        const list = roadGraph.segmentsNear(x, z, cfg.sampleRadius) || [];
        let best = null, bestD = Infinity;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            const a = roadGraph.getNode ? roadGraph.getNode(s.from) : null;
            const b = roadGraph.getNode ? roadGraph.getNode(s.to) : null;
            if (!a || !b) continue;
            const d = pointSegDist(x, z, a.x, a.z, b.x, b.z);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    function findNearbyCSGT(x, z) {
        for (const cp of csgtCheckpoints) {
            const dx = x - cp.x, dz = z - cp.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= cp.radius) {
                return { checkpoint: cp, distance: dist };
            }
        }
        return null;
    }

    function applyLimit(seg) {
        const lim = getSegmentSpeedLimit(roadGraph, seg);
        if (lim === null) {
            limitKmh = null;
            limitText = "";
            if (hudEl) hudEl.textContent = "-- km/h";
            return false;
        }
        limitKmh = lim;
        const text = `${Math.round(lim)} km/h`;
        if (text !== limitText) {
            limitText = text;
            if (hudEl) hudEl.textContent = text;
        }
        return true;
    }

    function showWarning(speedKmh, csgtInfo, isStopSignal = false) {
        if (!warnEl) return;
        const limitTxt = limitKmh ? `${Math.round(limitKmh)} km/h` : "--";
        const speedTxt = `${Math.round(speedKmh)} km/h`;
        const csgtName = csgtInfo ? csgtInfo.checkpoint.name : "Tổ tuần tra kiểm soát";

        const stateKey = `${speedTxt}_${violations}_${isStopSignal ? 'STOP' : 'SPEED'}_${csgtName}`;
        if (stateKey === lastRenderState && warnEl.style.display === "block") {
            return; // Đã render đúng trạng thái này, không chớp nháy
        }
        lastRenderState = stateKey;

        const headerTitle = isStopSignal
            ? "🚨 HIỆU LỆNH CSGT — YÊU CẦU DỪNG PHƯƠNG TIỆN"
            : "🚨 CSGT GHI NHẬN — VƯỢT QUÁ TỐC ĐỘ";

        const borderCol = isStopSignal ? "#ef4444" : "#f59e0b";
        const gradCol = isStopSignal ? "linear-gradient(135deg, #7f1d1d, #991b1b)" : "linear-gradient(135deg, #78350f, #92400e)";

        warnEl.innerHTML =
            `<div style="background:${gradCol}; border:2px solid ${borderCol}; border-radius:14px; padding:16px 24px; color:#fff; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.6); font-family:system-ui,sans-serif; transition:all 0.3s ease;">` +
            `<div style="font-size:1.15rem; font-weight:800; letter-spacing:0.5px; margin-bottom:8px;">${headerTitle}</div>` +
            `<div style="font-size:0.9rem; color:#fde68a; margin-bottom:6px;">👮 ${csgtName}</div>` +
            `<div style="display:flex; justify-content:center; gap:20px; font-size:0.95rem; margin:8px 0;">` +
            `  <div>Giới hạn: <b>${limitTxt}</b></div>` +
            `  <div>Tốc độ xe: <b style="color:#fca5a5;">${speedTxt}</b></div>` +
            `</div>` +
            `<div style="margin-top:8px; font-size:0.85rem; opacity:0.9; color:#fecaca;">` +
            `Vi phạm lần ${violations} ${isStopSignal ? '— Tấp xe vào lề đường để chấp hành hiệu lệnh!' : '— Giảm tốc độ ngay lập tức!'}` +
            `</div>` +
            `</div>`;
        warnEl.style.display = "block";
    }

    function hideWarning() {
        if (warnEl) {
            warnEl.style.display = "none";
            lastRenderState = "";
        }
    }

    /**
     * Cập nhật trạng thái CSGT.
     * @param {number} dt Giây trôi qua
     * @param {{x:number, z:number, speedKmh:number, isPlayer?:boolean}} s State của xe
     */
    function update(dt, s) {
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.5) : 0.1;

        if (warnLeft > 0) {
            warnLeft -= step;
            if (warnLeft <= 0) hideWarning();
        }

        if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return;

        // Chỉ theo dõi vi phạm của xe người chơi
        if (s.isPlayer === false) return;

        clock += step;
        if (clock < cfg.updateInterval) return;
        const scan = clock;
        clock = 0;

        // 1. Quét giới hạn tốc độ của đoạn đường hiện tại
        const seg = findNearestSegment(s.x, s.z);
        if (seg) {
            const segId = seg.id ?? `${seg.from}:${seg.to}`;
            if (segId !== currentSegId) {
                currentSegId = segId;
                overSec = 0;
            }
            if (!applyLimit(seg)) overSec = 0;
        } else {
            currentSegId = null;
            overSec = 0;
            applyLimit(null);
        }

        const speed = Number(s.speedKmh);
        if (!Number.isFinite(speed) || limitKmh === null) {
            overSec = 0;
            return;
        }

        // 2. Kiểm tra xe có quá tốc độ không
        const isSpeeding = speed > limitKmh + cfg.toleranceKmh;

        // 3. Truy vết thực thể CSGT thực tế tại vị trí xe
        const nearbyCSGT = findNearbyCSGT(s.x, s.z);
        if (isSpeeding && nearbyCSGT) {
            overSec += scan;
            calmSec = 0;

            if (overSec >= cfg.violationHoldSec) {
                overSec = 0;
                violations++;

                const isStopSignal = nearbyCSGT.checkpoint.stopSignal
                    && nearbyCSGT.distance <= cfg.csgtStopSignalRadius;
                warnLeft = cfg.warningSec;
                showWarning(speed, nearbyCSGT, isStopSignal);
            }
        } else {
            overSec = 0;
            if (!isSpeeding) {
                calmSec += scan;
                if (calmSec >= cfg.resetAfterSec) violations = 0;
            }
        }
    }

    function reset() {
        limitKmh = null; limitText = ""; overSec = 0; warnLeft = 0;
        calmSec = 0; violations = 0; currentSegId = null; clock = 0;
        lastRenderState = "";
        hideWarning();
        if (hudEl) hudEl.textContent = "-- km/h";
    }

    function dispose() { reset(); }

    if (hudEl) hudEl.textContent = "-- km/h";
    hideWarning();

    return {
        update, reset, dispose,
        getLimitKmh: () => limitKmh,
        getViolations: () => violations,
    };
}
