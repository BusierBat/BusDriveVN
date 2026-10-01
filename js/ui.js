// js/ui.js - SMART HUD, CONSOLE & RESTORED MENUS
import { formatTime } from "./utils.js";

let minimapCtx = null, speedoCtx = null;
let minimapData = null;
let minimapMap = null;
let _lastMinimapX = Infinity, _lastMinimapZ = Infinity, _lastHeading = Infinity;

export function createUI({ map = null, callbacks = {} } = {}) {
    const els = {
        hud: document.getElementById('hud'),
        fps: document.getElementById('hud-fps'),
        passengers: document.getElementById('hud-passengers'),
        time: document.getElementById('hud-time'),
        trip: document.getElementById('hud-trip'),
        x: document.getElementById('hud-x'),
        z: document.getElementById('hud-z'),
        nextDest: document.getElementById('hud-next-dest'),
        minimap: document.getElementById('hud-minimap'),
        speedometer: document.getElementById('hud-speedometer'),
        warning: document.getElementById('hud-warning'),
        notification: document.getElementById('hud-notification'),
        loadingScreen: document.getElementById('loading-screen'),
        mainMenu: document.getElementById('main-menu'),
        console: document.getElementById('command-console'),
        consoleInput: document.getElementById('console-input'),
        consoleOutput: document.getElementById('console-output'),
        // Khôi phục các phần tử cũ
        settingsPanel: document.getElementById('settings-panel'),
        selGraphics: document.getElementById('setting-graphics'),
        rngNpcDensity: document.getElementById('setting-npc-density'),
        valNpcDensity: document.getElementById('val-npc-density'),
        rngCamSens: document.getElementById('setting-cam-sens'),
        valCamSens: document.getElementById('val-cam-sens'),
        uvPanel: document.getElementById('uv-skin-panel'),
        uvInput: document.getElementById('btn-choose-skin'),
        uvStatus: document.getElementById('uv-skin-status'),
        uvDownload: document.getElementById('uv-skin-download')
    };

    if (els.minimap) {
        minimapCtx = els.minimap.getContext('2d');
        minimapCtx.imageSmoothingEnabled = false;
    }
    if (els.speedometer) {
        speedoCtx = els.speedometer.getContext('2d');
        speedoCtx.imageSmoothingEnabled = false;
    }

    // Khôi phục slider settings
    els.rngNpcDensity?.addEventListener('input', () => els.valNpcDensity.textContent = els.rngNpcDensity.value);
    els.rngCamSens?.addEventListener('input', () => els.valCamSens.textContent = els.rngCamSens.value);

    function setupMinimap(mapInstance) {
        if (mapInstance && typeof mapInstance.getMinimapData === 'function') {
            minimapData = mapInstance.getMinimapData();
        }
        minimapMap = mapInstance || null;
    }

    // rule 34: minimap dùng CÙNG source of truth với world, và CHỈ vẽ
    // phần đang nhìn thấy .
    function drawMinimap(playerX, playerZ, heading, npcZones = [], passengerZones = []) {
        if (!minimapCtx || !minimapData) return;
        const ctx = minimapCtx;
        const scale = 0.05;
        const radius = 115 / scale;   // bán kính vẽ được trong canvas 200px
        const view = (minimapMap && typeof minimapMap.getMinimapNear === 'function')
            ? minimapMap.getMinimapNear(playerX, playerZ, radius)
            : minimapData;
        ctx.clearRect(0, 0, 200, 200);
        ctx.save();
        ctx.beginPath(); ctx.arc(100, 100, 100, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#1a1a24'; ctx.fillRect(0, 0, 200, 200);
        
        ctx.strokeStyle = '#4a4a5a'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (const seg of view.segments || []) {
            ctx.moveTo(100 + (seg.from.x - playerX) * scale, 100 + (seg.from.z - playerZ) * scale);
            ctx.lineTo(100 + (seg.to.x - playerX) * scale, 100 + (seg.to.z - playerZ) * scale);
        }
        ctx.stroke();
        
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3;
        ctx.beginPath();
        const rt = view.route || [];
        for (let i = 0; i < rt.length - 1; i++) {
            const p1 = rt[i], p2 = rt[i + 1];
            ctx.moveTo(100 + (p1.x - playerX) * scale, 100 + (p1.z - playerZ) * scale);
            ctx.lineTo(100 + (p2.x - playerX) * scale, 100 + (p2.z - playerZ) * scale);
        }
        ctx.stroke();

        // POI: bến xe / trạm nghỉ / cây xăng / điểm dừng (rule 34)
        ctx.fillStyle = '#fbbf24';
        for (const p of view.pois || []) {
            ctx.beginPath();
            ctx.arc(100 + (p.x - playerX) * scale, 100 + (p.z - playerZ) * scale, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = '#ff4d4d';
        for (const npc of npcZones) {
            ctx.beginPath(); ctx.arc(100 + (npc.x - playerX) * scale, 100 + (npc.z - playerZ) * scale, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        
        ctx.save();
        ctx.translate(100, 100); ctx.rotate(-heading);
        ctx.fillStyle = '#fff'; ctx.beginPath();
        ctx.moveTo(0, -6); ctx.lineTo(-4, 4); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    function drawSpeedometer(speedKmh) {
        if (!speedoCtx) return;
        const ctx = speedoCtx, cx = 90, cy = 90, r = 70;
        ctx.clearRect(0, 0, 180, 180);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.stroke();
        ctx.save(); ctx.translate(cx, cy);
        for (let i = 0; i <= 12; i++) {
            ctx.rotate((1.5 * Math.PI) / 12);
            ctx.beginPath(); ctx.moveTo(0, -r + 5); ctx.lineTo(0, -r);
            ctx.lineWidth = 2; ctx.strokeStyle = i % 4 === 0 ? '#fff' : 'rgba(255,255,255,0.3)'; ctx.stroke();
        }
        ctx.restore();
        const speed = Math.min(Math.abs(speedKmh), 120);
        const angle = 0.75 * Math.PI + (speed / 120) * 1.5 * Math.PI;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(0, -r + 15); ctx.lineTo(10, 0);
        ctx.fillStyle = '#ff4d4d'; ctx.fill(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(Math.round(speedKmh), cx, cy + 40);
        ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText('km/h', cx, cy + 55);
    }

    let toastTimer = null;
    function toast(msg, isError = false) {
        if (!els.notification) return;
        els.notification.innerText = msg;
        els.notification.style.color = isError ? '#ff4d4d' : '#00ff99';
        els.notification.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { els.notification.style.display = 'none'; }, 3000);
    }

    function update(state = {}) {
        if (els.fps) els.fps.textContent = Math.round(state.fps || 0);
        if (els.passengers) els.passengers.textContent = `${state.passengers ?? 0}/24`;
        if (els.time) els.time.textContent = formatTime(state.timeMinutes || 0);
        if (els.trip && state.trip) {
            const t = state.trip;
            // độ dốc có dấu: lên (↑) / xuống (↓), làm tròn 0.1%
            const g = Math.round(t.gradePct * 10) / 10;
            const grade = Math.abs(g) < 0.1 ? '' : ` · dốc ${g > 0 ? '↑' : '↓'}${Math.abs(g)}%`;
            // `avgKmh` là km/h THỰC; `gameAvgKmh` là km trên giờ game (nhỏ hơn
            // nhiều vì đồng hồ game chạy nhanh thực). Ghi nhầm hai cái này ra
            // "1.1 km/h" khi xe đang chạy 70 km/h.
            els.trip.textContent =
                `${t.distanceKm.toFixed(1)} km · TB ${t.avgKmh.toFixed(0)} km/h` +
                ` · ${t.roadClass.toLowerCase()}${grade}`;
            els.trip.title =
                `Đồng hồ game chạy ${t.timeScale.toFixed(2)}x thực\n` +
                `Quãng đường / giờ game: ${t.gameAvgKmh.toFixed(1)} km\n` +
                `Thời gian thực đã chạy: ${Math.round(t.elapsedRealS)}s | ` +
                `giờ game đã trôi: ${t.gameMinutes.toFixed(1)} phút\n` +
                `Giao lộ đã qua: ${t.junctionsPassed}\n` +
                `Bến đã ghé: ${t.stationsServed}` +
                (t.dwellReason ? `\nĐang dừng: ${t.dwellReason}` : '');
        }
        if (els.x) els.x.textContent = state.x !== undefined ? state.x.toFixed(0) : '0';
        if (els.z) els.z.textContent = state.z !== undefined ? state.z.toFixed(0) : '0';
        if (els.warning) { els.warning.style.display = state.warning ? 'block' : 'none'; if (state.warning) els.warning.innerText = state.warning; }
        
        const dx = Math.abs((state.x || 0) - _lastMinimapX);
        const dz = Math.abs((state.z || 0) - _lastMinimapZ);
        const dh = Math.abs((state.heading || 0) - _lastHeading);
        if (dx > 5 || dz > 5 || dh > 0.087) {
            drawMinimap(state.x, state.z, state.heading || 0, state.npcZones || [], state.passengerZones || []);
            _lastMinimapX = state.x || 0; _lastMinimapZ = state.z || 0; _lastHeading = state.heading || 0;
        }
        drawSpeedometer(state.speedKmh || 0);
    }

    return { 
        els, setupMinimap, update, toast,
        showMainMenu() { if (els.mainMenu) els.mainMenu.style.display = 'flex'; },
        hideMainMenu() { if (els.mainMenu) els.mainMenu.style.display = 'none'; },
        showConsole() { if (els.console) { els.console.style.display = 'flex'; els.consoleInput.focus(); } },
        hideConsole() { if (els.console) els.console.style.display = 'none'; els.consoleInput.value = ''; els.consoleInput.blur?.(); },
        showSettings() { if (els.settingsPanel) els.settingsPanel.style.display = 'block'; },
        hideSettings() { if (els.settingsPanel) els.settingsPanel.style.display = 'none'; },
        setLoading(t, p) { if(els.loadingScreen) { els.loadingScreen.style.display = p < 1 ? 'flex' : 'none'; const bar = document.getElementById('loading-progress-bar'); if(bar) bar.style.width = `${p*100}%`; const tip = document.getElementById('loading-tip'); if(tip) tip.textContent = t; } },
        hideLoading() { if(els.loadingScreen) els.loadingScreen.style.display = 'none'; },
        saveSettings() { 
            return { 
                graphics: els.selGraphics?.value || 'low', 
                renderDist: 1, 
                npcDensity: parseInt(els.rngNpcDensity?.value || 5), 
                camSens: parseInt(els.rngCamSens?.value || 30), 
                fov: 70 
            }; 
        },
        loadSettings() { return { graphics: 'low', renderDist: 1, npcDensity: 5, camSens: 30, fov: 70 }; }
    };
}
