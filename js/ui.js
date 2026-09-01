// js/ui.js
export function createUI({ map = null, callbacks = {} } = {}) {
    // Inject HTML Structure
    document.body.insertAdjacentHTML('beforeend', `
        <div id="loading-screen" class="sys-overlay visible">
            <div class="sys-panel">
                <div class="sys-title">COACHVN</div>
                <div id="loading-message">Đang khởi tạo...</div>
                <div class="loading-prog"><div id="loading-bar" class="loading-prog-bar"></div></div>
            </div>
        </div>
        
        <div id="main-menu" class="sys-overlay">
            <div class="sys-panel">
                <div class="sys-title">COACHVN</div>
                <div class="sys-subtitle">Mô Phỏng Xe Khách Việt Nam</div>
                <button id="btn-new-game" class="sys-btn">▶ Bắt đầu game mới</button>
                <button id="btn-continue" class="sys-btn" disabled>↻ Tiếp tục</button>
                <button id="btn-settings" class="sys-btn">⚙ Cài đặt</button>
                <button id="btn-exit" class="sys-btn">🚪 Thoát game</button>
            </div>
        </div>
        
        <div id="pause-menu" class="sys-overlay">
            <div class="sys-panel">
                <div class="sys-title" style="font-size:32px;">Tạm Dừng</div>
                <button id="btn-resume" class="sys-btn">▶ Tiếp tục</button>
                <button id="btn-save" class="sys-btn">💾 Lưu game</button>
                <button id="btn-main-menu" class="sys-btn">🏠 Về Menu Chính</button>
            </div>
        </div>
        
        <div id="command-console">
            <div class="console-panel">
                <div class="console-header">
                    <span>📟 Command Console</span>
                    <button id="btn-close-console" class="btn-close">✕</button>
                </div>
                <div class="console-body">
                    <div id="console-output" class="console-output"></div>
                    <input id="command-input" type="text" class="console-input" placeholder="Gõ lệnh và nhấn Enter (VD: help)" />
                </div>
            </div>
        </div>
    `);

    const els = {
        loadingScreen: document.getElementById('loading-screen'),
        loadingMessage: document.getElementById('loading-message'),
        loadingBar: document.getElementById('loading-bar'),
        mainMenu: document.getElementById('main-menu'),
        pauseMenu: document.getElementById('pause-menu'),
        btnNewGame: document.getElementById('btn-new-game'),
        btnContinue: document.getElementById('btn-continue'),
        btnExit: document.getElementById('btn-exit'),
        btnResume: document.getElementById('btn-resume'),
        btnSave: document.getElementById('btn-save'),
        btnMainMenu: document.getElementById('btn-main-menu'),
        consoleEl: document.getElementById('command-console'),
        consoleInput: document.getElementById('command-input'),
        consoleOutput: document.getElementById('console-output'),
        btnCloseConsole: document.getElementById('btn-close-console')
    };

    function setLoading(msg, prog) {
        if (els.loadingMessage) els.loadingMessage.textContent = msg;
        if (els.loadingBar) els.loadingBar.style.width = `${prog * 100}%`;
    }
    function hideLoading() { els.loadingScreen?.classList.remove('visible'); }
    function showMainMenu() { els.mainMenu?.classList.add('visible'); els.pauseMenu?.classList.remove('visible'); }
    function hideMainMenu() { els.mainMenu?.classList.remove('visible'); }
    function showPauseMenu() { els.pauseMenu?.classList.add('visible'); }
    function hidePauseMenu() { els.pauseMenu?.classList.remove('visible'); }
    function showConsole() { els.consoleEl?.classList.add('visible'); setTimeout(() => els.consoleInput?.focus(), 50); }
    function hideConsole() { els.consoleEl?.classList.remove('visible'); }
    function appendConsole(text, type = "msg") {
        const div = document.createElement('div');
        div.className = type === 'cmd' ? 'console-cmd' : '';
        div.textContent = text;
        els.consoleOutput?.appendChild(div);
        els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
    }

    function toast(msg) {
        let root = document.getElementById('hud-toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'hud-toast-root';
            root.className = 'hud-toast-root';
            document.body.appendChild(root);
        }
        const el = document.createElement('div');
        el.className = 'hud-toast';
        el.textContent = msg;
        root.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    // Console Event Listeners
    els.consoleInput?.addEventListener('keydown', (e) => {
        if (e.key === "Enter") {
            const cmd = els.consoleInput.value;
            appendConsole(`> ${cmd}`, "cmd");
            if (window.executeConsoleCommand) window.executeConsoleCommand(cmd);
            els.consoleInput.value = "";
        }
    });
    els.btnCloseConsole?.addEventListener('click', () => { if (window.toggleConsole) window.toggleConsole(); });

    return { els, setLoading, hideLoading, showMainMenu, hideMainMenu, showPauseMenu, hidePauseMenu, showConsole, hideConsole, appendConsole, toast };
}