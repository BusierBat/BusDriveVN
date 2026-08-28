// js/ui.js - HIỂN THỊ TỌA ĐỘ (X, Z) + FIX LOADING SCREEN
import { clamp as clampUtil, formatMoney, formatTime, formatNumber } from "./utils.js";

let minimapCtx = null, minimapCanvas = null;
let lastPlayerX = Infinity, lastPlayerZ = Infinity;
let minimapData = null;

export function createUI({ map = null, callbacks = {} } = {}) {
    const els = {
        hud: document.getElementById('hud'),
        fps: document.getElementById('hud-fps'),
        speed: document.getElementById('hud-speed'),
        fuel: document.getElementById('hud-fuel'),
        money: document.getElementById('hud-money'),
        passengers: document.getElementById('hud-passengers'),
        time: document.getElementById('hud-time'),
        areaName: document.getElementById('area-name'),
        routeHint: document.getElementById('route-hint'),
        minimap: document.getElementById('minimap'),
        toastRoot: document.getElementById('toast-root'),
        loadingScreen: document.getElementById('loading-screen'),
        loadingMessage: document.getElementById('loading-message'),
        loadingProgress: document.getElementById('loading-progress'),
        settingsPanel: document.getElementById('settings-panel'),
        rayTracingToggle: document.getElementById('ray-tracing-toggle'),
        camSensitivity: document.getElementById('cam-sensitivity'),
        camSensValue: document.getElementById('cam-sens-value'),
        fovSlider: document.getElementById('fov-slider'),
        fovValue: document.getElementById('fov-value'),
        outsideDistance: document.getElementById('outside-distance'),
        outsideDistValue: document.getElementById('outside-dist-value'),
        invertX: document.getElementById('invert-x'),
        invertY: document.getElementById('invert-y'),
        themeToggle: document.getElementById('theme-toggle'),
        btnContinue: document.getElementById('btn-continue'),
        btnNewGame: document.getElementById('btn-new-game'),
        btnLoad: document.getElementById('btn-load'),
        btnSettings: document.getElementById('btn-settings'),
        btnHelp: document.getElementById('btn-help'),
        btnExit: document.getElementById('btn-exit'),
        btnCloseSettings: document.getElementById('btn-close-settings'),
        btnApplySettings: document.getElementById('btn-apply-settings'),
        btnResume: document.getElementById('btn-resume'),
        btnRestart: document.getElementById('btn-restart'),
        btnSave: document.getElementById('btn-save'),
        btnMainMenu: document.getElementById('btn-main-menu'),
        consoleEl: document.getElementById('command-console'),
        consoleInput: document.getElementById('command-input'),
        consoleOutput: document.getElementById('console-output'),
        btnCloseConsole: document.getElementById('btn-close-console'),
        mainMenu: document.getElementById('main-menu'),
        pauseMenu: document.getElementById('pause-menu'),
        continueHint: document.getElementById('continue-hint')
    };

    // Tạo element hiển thị tọa độ nếu chưa có
    let coordsEl = document.getElementById('hud-coords');
    if (!coordsEl) {
        coordsEl = document.createElement('div');
        coordsEl.id = 'hud-coords';
        coordsEl.style.position = 'absolute';
        coordsEl.style.bottom = '60px';
        coordsEl.style.left = '20px';
        coordsEl.style.color = '#aaa';
        coordsEl.style.fontSize = '14px';
        coordsEl.style.fontFamily = 'monospace';
        coordsEl.style.background = 'rgba(0,0,0,0.5)';
        coordsEl.style.padding = '4px 10px';
        coordsEl.style.borderRadius = '4px';
        coordsEl.style.zIndex = '100';
        const hud = document.getElementById('hud');
        if (hud) hud.appendChild(coordsEl);
    }
    els.coords = coordsEl;

    // ===== SETUP MINIMAP =====
    function setupMinimap() {
        minimapCanvas = els.minimap;
        if (!minimapCanvas) return;
        minimapCtx = minimapCanvas.getContext('2d');
        minimapCanvas.width = 200;
        minimapCanvas.height = 200;
        if (map && typeof map.getMinimapData === 'function') {
            minimapData = map.getMinimapData();
        }
    }

    function worldToMinimap(x, z, playerX, playerZ, scale) {
        const dx = x - playerX;
        const dz = z - playerZ;
        return {
            x: minimapCanvas.width / 2 + dx * scale,
            y: minimapCanvas.height / 2 + dz * scale
        };
    }

    function drawMinimap(playerX, playerZ, heading) {
        if (!minimapCtx || !minimapData) return;
        const ctx = minimapCtx;
        const w = minimapCanvas.width, h = minimapCanvas.height;
        ctx.fillStyle = '#1a1a24';
        ctx.fillRect(0, 0, w, h);

        const scale = 0.02;
        ctx.strokeStyle = '#4a4a5a';
        ctx.lineWidth = 2;
        for (const seg of minimapData.segments || []) {
            const from = worldToMinimap(seg.from.x, seg.from.z, playerX, playerZ, scale);
            const to = worldToMinimap(seg.to.x, seg.to.z, playerX, playerZ, scale);
            if (from.x >= -10 && from.x <= w + 10 && from.y >= -10 && from.y <= h + 10) {
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();
            }
        }

        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        for (let i = 0; i < (minimapData.route || []).length - 1; i++) {
            const p1 = minimapData.route[i];
            const p2 = minimapData.route[i + 1];
            if (!p1 || !p2) continue;
            const from = worldToMinimap(p1.x, p1.z, playerX, playerZ, scale);
            const to = worldToMinimap(p2.x, p2.z, playerX, playerZ, scale);
            if (from.x >= -10 && from.x <= w + 10 && from.y >= -10 && from.y <= h + 10) {
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();
            }
        }

        for (const poi of minimapData.pois || []) {
            const pos = worldToMinimap(poi.x, poi.z, playerX, playerZ, scale);
            if (pos.x >= 0 && pos.x <= w && pos.y >= 0 && pos.y <= h) {
                let color = '#ffffff';
                if (poi.type === 'bus_station') color = '#ff6b6b';
                else if (poi.type === 'rest_stop') color = '#51cf66';
                else if (poi.type === 'gas_station') color = '#ffd43b';
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-heading);
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-4, 4);
        ctx.lineTo(4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // ===== UPDATE HUD =====
    function update(state = {}) {
        if (els.fps) els.fps.textContent = formatNumber(state.fps ?? 0, 0);
        if (els.speed) els.speed.textContent = formatNumber(state.speedKmh ?? 0, 0) + ' km/h';
        if (els.fuel) els.fuel.textContent = `${Math.round(clampUtil(state.fuel ?? 0, 0, 1) * 100)}%`;
        if (els.money) els.money.textContent = formatMoney(state.money ?? 0);
        if (els.passengers) els.passengers.textContent = `${state.passengers ?? 0}/${state.passengerCapacity ?? 0}`;
        if (els.time) els.time.textContent = formatTime(state.timeMinutes ?? 0);
        if (els.areaName) els.areaName.textContent = state.areaName ?? '';
        if (els.routeHint) els.routeHint.textContent = state.routeHint ?? '';

        // Hiển thị tọa độ
        if (els.coords) {
            const x = state.x !== undefined ? state.x.toFixed(1) : '?';
            const z = state.z !== undefined ? state.z.toFixed(1) : '?';
            els.coords.textContent = `📍 X: ${x}  Z: ${z}`;
        }

        if (state.x !== undefined && state.z !== undefined) {
            const moved = Math.abs(state.x - lastPlayerX) > 0.5 || Math.abs(state.z - lastPlayerZ) > 0.5;
            if (moved || lastPlayerX === Infinity) {
                lastPlayerX = state.x;
                lastPlayerZ = state.z;
                drawMinimap(state.x, state.z, state.heading || 0);
            }
        }
    }

    // ===== TOAST =====
    function toast(msg) {
        if (!els.toastRoot) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        els.toastRoot.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    // ===== LOADING SCREEN =====
    function setLoading(msg, progress) {
        const screen = els.loadingScreen || document.getElementById('loading-screen');
        if (screen) screen.style.display = 'flex';
        if (els.loadingMessage) els.loadingMessage.textContent = msg;
        if (els.loadingProgress) els.loadingProgress.value = progress * 100;
    }

    function hideLoading() {
        const screen = els.loadingScreen || document.getElementById('loading-screen');
        if (screen) {
            screen.style.display = 'none';
            screen.style.opacity = '0';
            screen.classList.remove('visible');
        }
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) overlay.style.display = 'none';
        console.log('✅ Loading screen hidden');
    }

    // ===== SETTINGS =====
    function loadSettings() {
        try {
            const saved = localStorage.getItem('coachvn_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.cameraSensitivity !== undefined && els.camSensitivity) {
                    els.camSensitivity.value = settings.cameraSensitivity;
                    if (els.camSensValue) els.camSensValue.textContent = settings.cameraSensitivity;
                }
                if (settings.fov !== undefined && els.fovSlider) {
                    els.fovSlider.value = settings.fov;
                    if (els.fovValue) els.fovValue.textContent = settings.fov + '°';
                }
                if (settings.outsideDistance !== undefined && els.outsideDistance) {
                    els.outsideDistance.value = settings.outsideDistance;
                    if (els.outsideDistValue) els.outsideDistValue.textContent = settings.outsideDistance + 'm';
                }
                if (settings.invertX !== undefined && els.invertX) {
                    els.invertX.checked = settings.invertX;
                }
                if (settings.invertY !== undefined && els.invertY) {
                    els.invertY.checked = settings.invertY;
                }
                if (settings.rayTracing !== undefined && els.rayTracingToggle) {
                    els.rayTracingToggle.checked = settings.rayTracing;
                }
                if (settings.theme === 'light') {
                    document.body.classList.add('light-mode');
                    if (els.themeToggle) els.themeToggle.textContent = '☀ Light';
                }
                return settings;
            }
        } catch (_) {}
        return null;
    }

    function saveSettings() {
        try {
            const settings = {
                cameraSensitivity: els.camSensitivity ? parseInt(els.camSensitivity.value) : 30,
                fov: els.fovSlider ? parseInt(els.fovSlider.value) : 70,
                outsideDistance: els.outsideDistance ? parseInt(els.outsideDistance.value) : 12,
                invertX: els.invertX ? els.invertX.checked : false,
                invertY: els.invertY ? els.invertY.checked : false,
                rayTracing: els.rayTracingToggle ? els.rayTracingToggle.checked : false,
                theme: document.body.classList.contains('light-mode') ? 'light' : 'dark'
            };
            localStorage.setItem('coachvn_settings', JSON.stringify(settings));
            return settings;
        } catch (_) { return null; }
    }

    function applySettings() {
        const settings = saveSettings();
        if (settings && callbacks.onSettingsApplied) {
            callbacks.onSettingsApplied(settings);
        }
        if (window.lighting && settings) {
            window.lighting.setRayTracingEnabled(settings.rayTracing || false);
        }
        return settings;
    }

    // ===== MENU HELPERS =====
    function showMainMenu() {
        if (els.mainMenu) {
            els.mainMenu.style.display = 'flex';
            els.mainMenu.classList.add('visible');
        }
        if (els.hud) els.hud.classList.add('hidden');
        if (els.pauseMenu) {
            els.pauseMenu.style.display = 'none';
            els.pauseMenu.classList.remove('visible');
        }
    }

    function hideMainMenu() {
        if (els.mainMenu) {
            els.mainMenu.classList.remove('visible');
            els.mainMenu.style.display = 'none';
        }
        if (els.hud) els.hud.classList.remove('hidden');
    }

    function showPauseMenu() {
        if (els.pauseMenu) {
            els.pauseMenu.style.display = 'flex';
            els.pauseMenu.classList.add('visible');
        }
    }

    function hidePauseMenu() {
        if (els.pauseMenu) {
            els.pauseMenu.classList.remove('visible');
            els.pauseMenu.style.display = 'none';
        }
    }

    // ===== CONSOLE =====
    function showConsole() {
        if (els.consoleEl) {
            els.consoleEl.classList.add('visible');
            setTimeout(() => els.consoleInput?.focus(), 50);
        }
    }

    function hideConsole() {
        if (els.consoleEl) els.consoleEl.classList.remove('visible');
    }

    function appendConsole(text, type = 'msg') {
        if (!els.consoleOutput) return;
        const el = document.createElement('div');
        el.className = type === 'cmd' ? 'console-cmd' : 'console-msg';
        el.textContent = text;
        els.consoleOutput.appendChild(el);
        els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
    }

    function clearConsole() {
        if (els.consoleOutput) els.consoleOutput.innerHTML = '';
    }

    // ===== INIT =====
    setupMinimap();
    window.addEventListener('resize', setupMinimap);

    const savedSettings = loadSettings();
    if (savedSettings && savedSettings.rayTracing && window.lighting) {
        window.lighting.setRayTracingEnabled(true);
    }

    return {
        update,
        toast,
        setLoading,
        hideLoading,
        showMainMenu,
        hideMainMenu,
        showPauseMenu,
        hidePauseMenu,
        showConsole,
        hideConsole,
        appendConsole,
        clearConsole,
        saveSettings,
        loadSettings,
        applySettings,
        getElements: () => els,
        drawMinimap,
        setupMinimap,
        els
    };
}