// js/audio.js
// =====================================================================
// HỆ THỐNG ÂM THANH TỐI GIẢN CHO BUSDRIVEVN
// Dự án TRƯỚC đâY KHÔNG có âm thanh nào (không AudioContext, không .play()).
// Module này thêm âm thanh THẬT để setting "Âm lượng" có tác dụng thật:
//   - Tiếng máy xe: 2 oscillator sawtooth lệch tần số + lowpass, tần số và
//     âm lượng bám theo TỐC ĐỘ thực của xe (rpm giả lập).
//   - Còi xe (phím H): xung ngắn dạng còi xe khách.
// Dùng WebAudio thuần (không thêm thư viện). AudioContext chỉ được tạo/khởi
// động sau USER GESTURE (chính sách autoplay của trình duyệt) -> game khởi
// động từ nút "LÁI XE" nên an toàn.
// =====================================================================

export function createAudioSystem() {
    let ctx = null;
    let master = null;          // GainNode tổng (âm lượng người chơi đặt)
    let engineGain = null;       // GainNode tiếng máy
    let engineFilter = null;     // LowpassFilter (mở/đóng theo tốc độ)
    let oscA = null, oscB = null;// 2 oscillator lệch nhau -> tiếng "rất-rất-rồm"
    let started = false;
    let muted = false;
    let volume = 0.6;
    let lastSpeed = 0;

    function ensureContext() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            ctx = new AC();
        } catch (e) {
            console.warn("[audio] Khong tao duoc AudioContext:", e?.message || e);
            return null;
        }
        master = ctx.createGain();
        master.gain.value = muted ? 0 : volume;
        master.connect(ctx.destination);
        return ctx;
    }

    /** Bắt đầu tiếng máy (gọi sau user gesture). Trả về true nếu chạy. */
    function startEngine() {
        const c = ensureContext();
        if (!c) return false;
        if (c.state === 'suspended') c.resume().catch(() => { });
        if (started) return true;
        try {
            engineFilter = c.createBiquadFilter();
            engineFilter.type = 'lowpass';
            engineFilter.frequency.value = 320;
            engineFilter.Q.value = 3;

            engineGain = c.createGain();
            engineGain.gain.value = 0;

            oscA = c.createOscillator();
            oscA.type = 'sawtooth';
            oscA.frequency.value = 42;
            oscB = c.createOscillator();
            oscB.type = 'square';
            oscB.frequency.value = 43.5;      // lệch nhẹ -> tiếng động cơ

            const subGain = c.createGain();
            subGain.gain.value = 0.35;         // oscillator phụ nhỏ hơn
            oscA.connect(engineFilter);
            oscB.connect(subGain);
            subGain.connect(engineFilter);
            engineFilter.connect(engineGain);
            engineGain.connect(master);

            oscA.start();
            oscB.start();
            started = true;
            return true;
        } catch (e) {
            console.warn("[audio] Khong khoi dong duoc tieng may:", e?.message || e);
            return false;
        }
    }

    /** Bám tốc độ xe (km/h) -> tần số + âm lượng tiếng máy. */
    function setSpeed(kmh) {
        if (!started || !ctx) return;
        const s = Math.max(0, Math.min(160, kmh || 0));
        lastSpeed = s;
        const t = s / 160;
        const base = 38 + t * 92;              // 38..130 Hz
        const now = ctx.currentTime;
        if (oscA) oscA.frequency.setTargetAtTime(base, now, 0.12);
        if (oscB) oscB.frequency.setTargetAtTime(base * 1.04, now, 0.12);
        if (engineFilter) engineFilter.frequency.setTargetAtTime(260 + t * 1500, now, 0.15);
        // Đứng yên -> gần như im; chạy -> to dần (không chói tai).
        if (engineGain) engineGain.gain.setTargetAtTime(0.035 + t * 0.11, now, 0.15);
    }

    /** Còi xe (phím H). */
    function horn(duration = 0.45) {
        const c = ensureContext();
        if (!c || muted) return false;
        if (c.state === 'suspended') c.resume().catch(() => { });
        try {
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, c.currentTime);
            g.gain.exponentialRampToValueAtTime(0.28, c.currentTime + 0.02);
            g.gain.setValueAtTime(0.28, c.currentTime + duration - 0.05);
            g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
            // 2 tần số -> tiếng còi 2 nốt như còi xe khách
            const o1 = c.createOscillator();
            o1.type = 'square';
            o1.frequency.value = 420;
            const o2 = c.createOscillator();
            o2.type = 'square';
            o2.frequency.value = 315;
            const f = c.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = 1800;
            o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
            o1.start(); o2.start();
            o1.stop(c.currentTime + duration + 0.02);
            o2.stop(c.currentTime + duration + 0.02);
            return true;
        } catch (e) {
            return false;
        }
    }

    function setVolume(v) {
        volume = Math.max(0, Math.min(1, Number(v) || 0));
        if (master && ctx) {
            master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
        }
    }

    function setMuted(m) {
        muted = !!m;
        if (master && ctx) {
            master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
        }
    }

    function stopEngine() {
        if (!started) return;
        try { oscA && oscA.stop(); } catch (e) { }
        try { oscB && oscB.stop(); } catch (e) { }
        started = false;
    }

    return {
        startEngine, setSpeed, horn, setVolume, setMuted, stopEngine,
        isStarted: () => started,
        getVolume: () => volume,
        isMuted: () => muted
    };
}
