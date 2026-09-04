// js/ui.js
import { clamp as clampUtil, formatTime } from "./utils.js";

let minimapCtx = null, minimapCanvas = null;
let speedoCtx = null, speedoCanvas = null;
let minimapData = null;

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
    minimapCanvas = els.minimap; if (minimapCanvas) minimapCtx = minimapCanvas.getContext('2d');
    speedoCanvas = els.speedometer; if (speedoCanvas) speedoCtx = speedoCanvas.getContext('2d');
  }
  
  function setupMinimap(mapInstance) {
    if (mapInstance && typeof mapInstance.getMinimapData === 'function') {
      minimapData = mapInstance.getMinimapData();
    }
  }

  els.rngRenderDist?.addEventListener('input', () => els.valRenderDist.textContent = els.rngRenderDist.value);
  els.rngSimDist?.addEventListener('input', () => els.valSimDist.textContent = els.rngSimDist.value);
  els.rngNpcDensity?.addEventListener('input', () => els.valNpcDensity.textContent = els.rngNpcDensity.value);
  els.rngCamSens?.addEventListener('input', () => els.valCamSens.textContent = els.rngCamSens.value);
  els.rngFov?.addEventListener('input', () => els.valFov.textContent = els.rngFov.value);

  function worldToMinimap(x, z, playerX, playerZ, scale) {
    return { x: 110 + (x - playerX) * scale, y: 110 + (z - playerZ) * scale };
  }

  function drawMinimap(playerX, playerZ, heading, npcZones = [], passengerZones = []) {
    if (!minimapCtx || !minimapData) return;
    const ctx = minimapCtx;
    ctx.clearRect(0, 0, 220, 220);
    ctx.save();
    ctx.beginPath(); ctx.arc(110, 110, 110, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1a1a24'; ctx.fillRect(0, 0, 220, 220);
    const scale = 0.05;
    
    ctx.strokeStyle = '#4a4a5a'; ctx.lineWidth = 3;
    for (const seg of minimapData.segments || []) {
      const from = worldToMinimap(seg.from.x, seg.from.z, playerX, playerZ, scale);
      const to = worldToMinimap(seg.to.x, seg.to.z, playerX, playerZ, scale);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
    
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 4;
    for (let i = 0; i < (minimapData.route || []).length - 1; i++) {
      const p1 = minimapData.route[i], p2 = minimapData.route[i + 1];
      const from = worldToMinimap(p1.x, p1.z, playerX, playerZ, scale);
      const to = worldToMinimap(p2.x, p2.z, playerX, playerZ, scale);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
    
    ctx.fillStyle = '#ff6b6b';
    for (const poi of minimapData.pois || []) {
      const pos = worldToMinimap(poi.x, poi.z, playerX, playerZ, scale);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    
    ctx.fillStyle = 'rgba(255, 200, 0, 0.8)';
    for (const zone of passengerZones) {
      if (zone.picked) continue;
      const pos = worldToMinimap(zone.x, zone.z, playerX, playerZ, scale);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    
    ctx.fillStyle = '#ff4d4d';
    for (const npc of npcZones) {
      const pos = worldToMinimap(npc.x, npc.z, playerX, playerZ, scale);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    
    ctx.save(); ctx.translate(110, 110); ctx.rotate(-heading);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5, 5); ctx.lineTo(5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawSpeedometer(speedKmh) {
    if (!speedoCtx) return;
    const ctx = speedoCtx, cx = 120, cy = 120, r = 110;
    ctx.clearRect(0, 0, 240, 240);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.stroke();
    
    ctx.save(); ctx.translate(cx, cy);
    for (let i = 0; i <= 160; i += 20) {
      ctx.rotate((Math.PI * 1.2) / 12);
      ctx.beginPath(); ctx.moveTo(0, -r + 10); ctx.lineTo(0, -r); ctx.lineWidth = 3;
      ctx.strokeStyle = i % 40 === 0 ? '#fff' : 'rgba(255,255,255,0.3)'; ctx.stroke();
    }
    ctx.restore();
    
    const angle = Math.PI * 0.8 + (Math.min(speedKmh, 160) / 160) * Math.PI * 1.4;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(0, -r + 20); ctx.lineTo(12, 0); ctx.closePath();
    ctx.fillStyle = '#ff4d4d'; ctx.fill(); ctx.restore();
    
    ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(speedKmh), cx, cy + 50);
    ctx.font = '16px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('km/h', cx, cy + 75);
  }

  function update(state = {}) {
    if (els.fps) els.fps.textContent = `FPS: ${Math.round(state.fps || 0)}`;
    if (els.passengers) els.passengers.textContent = state.passengers ?? 0;
    if (els.time) els.time.textContent = formatTime(state.timeMinutes || 0);
    if (els.x) els.x.textContent = state.x !== undefined ? state.x.toFixed(1) : '0';
    if (els.z) els.z.textContent = state.z !== undefined ? state.z.toFixed(1) : '0';
    
    drawMinimap(state.x, state.z, state.heading || 0, state.npcZones || [], state.passengerZones || []);
    drawSpeedometer(state.speedKmh || 0);
    if (els.warning) { els.warning.style.display = state.warning ? 'block' : 'none'; if (state.warning) els.warning.innerText = state.warning; }
  }

  function toast(msg) {
    if (!els.toastRoot) return;
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    els.toastRoot.appendChild(el); setTimeout(() => el.remove(), 3000);
  }

  function setLoading(msg, progress) {
    if (!els.loadingScreen) return;
    els.loadingScreen.classList.remove("hidden"); els.loadingScreen.style.display = "flex";
    if (els.loadingTip) els.loadingTip.textContent = msg || "HÃY LÁI XE AN TOÀN";
    if (els.loadingBar) els.loadingBar.style.width = `${Math.max(0, Math.min(100, (progress || 0) * 100))}%`;
  }
  function hideLoading() { if (!els.loadingScreen) return; els.loadingScreen.classList.add("hidden"); els.loadingScreen.style.display = "none"; }

  function showMainMenu() { if (!els.mainMenu) return; els.mainMenu.classList.add("visible"); els.mainMenu.style.display = "flex"; }
  function hideMainMenu() { if (!els.mainMenu) return; els.mainMenu.classList.remove("visible"); els.mainMenu.style.display = "none"; }
  function showPauseMenu() { if (!els.pauseMenu) return; els.pauseMenu.classList.add("visible"); els.pauseMenu.style.display = "flex"; }
  function hidePauseMenu() { if (!els.pauseMenu) return; els.pauseMenu.classList.remove("visible"); els.pauseMenu.style.display = "none"; }
  function showSettings() { if (els.settingsPanel) els.settingsPanel.style.display = "block"; }
  function hideSettings() { if (els.settingsPanel) els.settingsPanel.style.display = "none"; }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('coachvn_settings') || '{}');
      if (s.graphics && els.selGraphics) els.selGraphics.value = s.graphics;
      if (s.renderDist && els.rngRenderDist) { els.rngRenderDist.value = s.renderDist; els.valRenderDist.textContent = s.renderDist; }
      if (s.simDist && els.rngSimDist) { els.rngSimDist.value = s.simDist; els.valSimDist.textContent = s.simDist; }
      if (s.npcDensity !== undefined && els.rngNpcDensity) { els.rngNpcDensity.value = s.npcDensity; els.valNpcDensity.textContent = s.npcDensity; }
      if (s.camSens && els.rngCamSens) { els.rngCamSens.value = s.camSens; els.valCamSens.textContent = s.camSens; }
      if (s.fov && els.rngFov) { els.rngFov.value = s.fov; els.valFov.textContent = s.fov; }
      return s;
    } catch(e) { return {}; }
  }

  function saveSettings() {
    const s = {
      graphics: els.selGraphics?.value || 'medium',
      renderDist: parseInt(els.rngRenderDist?.value || 8),
      simDist: parseInt(els.rngSimDist?.value || 300),
      npcDensity: parseInt(els.rngNpcDensity?.value || 15),
      camSens: parseInt(els.rngCamSens?.value || 30),
      fov: parseInt(els.rngFov?.value || 70)
    };
    localStorage.setItem('coachvn_settings', JSON.stringify(s));
    return s;
  }

  setupCanvases();
  loadSettings();
  window.addEventListener('resize', setupCanvases);

  return {
    update, toast, setLoading, hideLoading, setupMinimap,
    showMainMenu, hideMainMenu, showPauseMenu, hidePauseMenu,
    showSettings, hideSettings, loadSettings, saveSettings, els
  };
}
