// js/ui.js - OPTIMIZED & ENHANCED LOADING SCREEN
import { clamp as clampUtil, formatTime } from "./utils.js";

let minimapCtx = null, minimapCanvas = null;
let speedoCtx = null, speedoCanvas = null;
let minimapData = null;

// Cache cho Dirty Flag
let _lastMinimapX = Infinity, _lastMinimapZ = Infinity, _lastHeading = Infinity;
let _lastSpeed = Infinity;
let _lastWarning = null;
const _minimapPos = { x: 0, y: 0 };

// MẢNG CÂU NÓI RANDOM Ý NGHĨA
const LOADING_TIPS = [
    "HÃY NHỚ LÁI XE AN TOÀN CẢ TRONG GAME VÀ NGOÀI ĐỜI",
    "Đừng quên thắt dây an toàn trước khi khởi hành!",
    "Tuân thủ tốc độ quy định, an toàn cho chính bạn và gia đình.",
    "Hãy nhường đường tại ngã tư, tránh điên xe nhé!",
    "Mệt thì nghỉ, không cố lái xe khi buồn ngủ.",
    "Đèn pha rất quan trọng, hãy kiểm tra trước khi trời tối.",
    "Khách lên xe xong, nhớ đóng cửa (K) cẩn thận!",
    "Chúc bạn có một chuyến đi vui vẻ và bình an!",
    "Đã có giấy phép lái xe B2 chưa mà dám đạp ga thế?",
    "Phanh tay (Space) rất hữu ích khi đỗ xe trên dốc!",
    "Hãy giữ tâm lý bình tĩnh khi tham gia giao thông.",
    "Kiểm tra gương chiếu hậu thường xuyên để tránh điểm mù."
];
let _lastTipIndex = -1;

export function createUI({ map = null, callbacks = {} } = {}) {
    const els = {
        hud: document.getElementById('hud'),
        fps: document.getElementById('hud-fps'),
        passengers: document.getElementById('hud-passengers'),
        time: document.getElementById('hud-time'),
        x: document.getElementById('hud-x'),
        z: document.getElementById('hud-z'),
        nextDest: document.getElementById('hud-next-dest'),
        dist: document.getElementById('hud-dist'),
        minimap: document.getElementById('minimap'),
        speedometer: document.getElementById('speedometer'),
        warning: document.getElementById('hud-warning'),
        context: document.getElementById('hud-context'),
        toastRoot: document.getElementById('toast-root'),
        loadingScreen: document.getElementById('loading-screen'),
        loadingBar: document.getElementById('loading-progress-bar'),
        loadingTip: document.getElementById('loading-tip'),
        settingsPanel: document.getElementById('settings-panel'),
        mainMenu: document.getElementById('main-menu'),
        pauseMenu: document.getElementById('pause-menu'),
        selGraphics: document.getElementById('setting-graphics'),
        rngRenderDist: document.getElementById('setting-render-dist'),
        valRenderDist: document.getElementById('val-render-dist'),
        rngSimDist: document.getElementById('setting-sim-dist'),
        valSimDist: document.getElementById('val-sim-dist'),
        rngNpcDensity: document.getElementById('setting-npc-density'),
        valNpcDensity: document.getElementById('val-npc-density'),
        rngCamSens: document.getElementById('setting-cam-sens'),
        valCamSens: document.getElementById('val-cam-sens'),
        rngFov: document.getElementById('setting-fov'),
        valFov: document.getElementById('val-fov')
    };

    function setupCanvases() {
        minimapCanvas = els.minimap;
        if (minimapCanvas) {
            minimapCtx = minimapCanvas.getContext('2d');
            // TỐI ƯU: Tắt smoothing để vẽ minimap cực nhanh, giảm tải Canvas 2D
            if (minimapCtx) minimapCtx.imageSmoothingEnabled = false;
        }
        speedoCanvas = els.speedometer;
        if (speedoCanvas) {
            speedoCtx = speedoCanvas.getContext('2d');
            if (speedoCtx) speedoCtx.imageSmoothingEnabled = false;
        }
    }

    function setupMinimap(mapInstance) {
        if (mapInstance && typeof mapInstance.getMinimapData === 'function') {
            minimapData = mapInstance.getMinimapData();
        }
    }

    // Bind settings sliders
    els.rngRenderDist?.addEventListener('input', () => els.valRenderDist.textContent = els.rngRenderDist.value);
    els.rngSimDist?.addEventListener('input', () => els.valSimDist.textContent = els.rngSimDist.value);
    els.rngNpcDensity?.addEventListener('input', () => els.valNpcDensity.textContent = els.rngNpcDensity.value);
    els.rngCamSens?.addEventListener('input', () => els.valCamSens.textContent = els.rngCamSens.value);
    els.rngFov?.addEventListener('input', () => els.valFov.textContent = els.rngFov.value);

    function drawMinimap(playerX, playerZ, heading, npcZones = [], passengerZones = []) {
        if (!minimapCtx || !minimapData) return;
        const ctx = minimapCtx;
        const scale = 0.05;
        
        ctx.clearRect(0, 0, 220, 220);
        ctx.save();
        ctx.beginPath(); 
        ctx.arc(110, 110, 110, 0, Math.PI * 2); 
        ctx.clip();
        ctx.fillStyle = '#1a1a24'; 
        ctx.fillRect(0, 0, 220, 220);
        
        // Vẽ roads
        ctx.strokeStyle = '#4a4a5a'; 
        ctx.lineWidth = 3;
        ctx.beginPath(); // Batch tất cả road thành 1 path để giảm draw call
        for (const seg of minimapData.segments || []) {
            ctx.moveTo(110 + (seg.from.x - playerX) * scale, 110 + (seg.from.z - playerZ) * scale); 
            ctx.lineTo(110 + (seg.to.x - playerX) * scale, 110 + (seg.to.z - playerZ) * scale); 
        }
        ctx.stroke();
        
        // Vẽ route
        ctx.strokeStyle = '#3b82f6'; 
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = 0; i < (minimapData.route || []).length - 1; i++) {
            const p1 = minimapData.route[i], p2 = minimapData.route[i + 1];
            ctx.moveTo(110 + (p1.x - playerX) * scale, 110 + (p1.z - playerZ) * scale); 
            ctx.lineTo(110 + (p2.x - playerX) * scale, 110 + (p2.z - playerZ) * scale); 
        }
        ctx.stroke();
        
        // Vẽ POIs
        ctx.fillStyle = '#ff6b6b';
        for (const poi of minimapData.pois || []) {
            ctx.beginPath(); 
            ctx.arc(110 + (poi.x - playerX) * scale, 110 + (poi.z - playerZ) * scale, 4, 0, Math.PI * 2); 
            ctx.fill();
        }
        
        // Vẽ passengers
        ctx.fillStyle = 'rgba(255, 200, 0, 0.8)';
        for (const zone of passengerZones) {
            if (zone.picked) continue;
            ctx.beginPath(); 
            ctx.arc(110 + (zone.x - playerX) * scale, 110 + (zone.z - playerZ) * scale, 3, 0, Math.PI * 2); 
            ctx.fill();
        }
        
        // Vẽ NPCs
        ctx.fillStyle = '#ff4d4d';
        for (const npc of npcZones) {
            ctx.beginPath(); 
            ctx.arc(110 + (npc.x - playerX) * scale, 110 + (npc.z - playerZ) * scale, 2, 0, Math.PI * 2); 
            ctx.fill();
        }
        
        ctx.restore();
        
        // Vẽ mũi tên player
        ctx.save(); 
        ctx.translate(110, 110); 
        ctx.rotate(-heading);
        ctx.fillStyle = '#fff'; 
        ctx.beginPath(); 
        ctx.moveTo(0, -8); 
        ctx.lineTo(-5, 5); 
        ctx.lineTo(5, 5); 
        ctx.closePath(); 
        ctx.fill();
        ctx.restore();
    }

    function drawSpeedometer(speedKmh) {
        if (!speedoCtx) return;
        const ctx = speedoCtx, cx = 120, cy = 120, r = 110;
        ctx.clearRect(0, 0, 240, 240);
        ctx.beginPath(); 
        ctx.arc(cx, cy, r, 0, Math.PI * 2); 
        ctx.lineWidth = 10; 
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; 
        ctx.stroke();
        
        ctx.save(); 
        ctx.translate(cx, cy);
        for (let i = 0; i <= 160; i += 20) {
            ctx.rotate((Math.PI * 1.2) / 12);
            ctx.beginPath(); 
            ctx.moveTo(0, -r + 10); 
            ctx.lineTo(0, -r); 
            ctx.lineWidth = 3;
            ctx.strokeStyle = i % 40 === 0 ? '#fff' : 'rgba(255,255,255,0.3)'; 
            ctx.stroke();
        }
        ctx.restore();
        
        const angle = Math.PI * 0.8 + (Math.min(speedKmh, 160) / 160) * Math.PI * 1.4;
        ctx.save(); 
        ctx.translate(cx, cy); 
        ctx.rotate(angle);
        ctx.beginPath(); 
        ctx.moveTo(-12, 0); 
        ctx.lineTo(0, -r + 20); 
        ctx.lineTo(12, 0); 
        ctx.closePath();
        ctx.fillStyle = '#ff4d4d'; 
        ctx.fill(); 
        ctx.restore();
        
        ctx.fillStyle = '#fff'; 
        ctx.font = 'bold 32px sans-serif'; 
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(speedKmh), cx, cy + 50);
        ctx.font = '16px sans-serif'; 
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; 
        ctx.fillText('km/h', cx, cy + 75);
    }

    function update(state = {}) {
        // TỐI ƯU: Ẩn FPS khỏi HUD để giảm tính toán DOM
        if (els.fps) els.fps.style.display = 'none';
        if (els.passengers) els.passengers.textContent = state.passengers ?? 0;
        if (els.time) els.time.textContent = formatTime(state.timeMinutes || 0);
        if (els.x) els.x.textContent = state.x !== undefined ? state.x.toFixed(1) : '0';
        if (els.z) els.z.textContent = state.z !== undefined ? state.z.toFixed(1) : '0';
        
        // TỐI ƯU: DIRTY FLAG - Chỉ vẽ minimap khi xe di chuyển >5 units hoặc đổi hướng >5 độ
        const dx = Math.abs((state.x || 0) - _lastMinimapX);
        const dz = Math.abs((state.z || 0) - _lastMinimapZ);
        const dh = Math.abs((state.heading || 0) - _lastHeading);
        if (dx > 5 || dz > 5 || dh > 0.087) {
            drawMinimap(state.x, state.z, state.heading || 0, state.npcZones || [], state.passengerZones || []);
            _lastMinimapX = state.x || 0;
            _lastMinimapZ = state.z || 0;
            _lastHeading = state.heading || 0;
        }
        
        // TỐI ƯU: Chỉ vẽ speedometer khi speed thay đổi >1 km/h
        const ds = Math.abs((state.speedKmh || 0) - _lastSpeed);
        if (ds > 1) {
            drawSpeedometer(state.speedKmh || 0);
            _lastSpeed = state.speedKmh || 0;
        }
        
        // TỐI ƯU: Chỉ update DOM warning khi có sự thay đổi trạng thái
        const currentWarning = state.warning || null;
        if (currentWarning !== _lastWarning) {
            if (els.warning) { 
                els.warning.style.display = currentWarning ? 'block' : 'none'; 
                if (currentWarning) els.warning.innerText = currentWarning; 
            }
            _lastWarning = currentWarning;
        }
    }

    function toast(msg) {
        if (!els.toastRoot) return;
        const el = document.createElement('div'); 
        el.className = 'toast'; 
        el.textContent = msg;
        els.toastRoot.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 2500);
    }

    function setLoading(text, progress) {
        if (els.loadingScreen) {
            els.loadingScreen.style.display = 'flex';
            
            if (els.loadingBar) els.loadingBar.style.width = `${progress * 100}%`;
            
            if (els.loadingTip) {
                let idx;
                do { 
                    idx = Math.floor(Math.random() * LOADING_TIPS.length); 
                } while (idx === _lastTipIndex && LOADING_TIPS.length > 1);
                _lastTipIndex = idx;
                
                els.loadingTip.style.opacity = 0;
                setTimeout(() => {
                    els.loadingTip.textContent = LOADING_TIPS[idx];
                    els.loadingTip.style.opacity = 1;
                }, 300);
            }
            
            const statusEl = document.getElementById('loading-status');
            if (statusEl) statusEl.textContent = text || "";
        }
    }

    return { 
        els, 
        setupCanvases, 
        setupMinimap, 
        update, 
        toast,
        showMainMenu() { if (els.mainMenu) els.mainMenu.style.display = 'flex'; },
        hideMainMenu() { if (els.mainMenu) els.mainMenu.style.display = 'none'; },
        showPauseMenu() { if (els.pauseMenu) els.pauseMenu.style.display = 'flex'; },
        hidePauseMenu() { if (els.pauseMenu) els.pauseMenu.style.display = 'none'; },
        showSettings() { if (els.settingsPanel) els.settingsPanel.style.display = 'flex'; },
        hideSettings() { if (els.settingsPanel) els.settingsPanel.style.display = 'none'; },
        setLoading,
        hideLoading() { if (els.loadingScreen) els.loadingScreen.style.display = 'none'; },
        saveSettings() { 
            return { graphics: 'low', renderDist: 4, npcDensity: 10, camSens: 30, fov: 70 }; 
        },
        loadSettings() { 
            return { graphics: 'low', renderDist: 4, npcDensity: 10, camSens: 30, fov: 70 }; 
        }
    };
}