// js/hud.js
export class HUDSystem {
    constructor() {
        this.root = document.createElement("div");
        this.root.id = "game-hud";
        this.root.className = "hud-root";
        this.root.style.display = "none";
        document.body.appendChild(this.root);

        this.root.innerHTML = `
            <div class="hud-panel hud-tl">
                <div class="hud-row"><span class="hud-label">Tuyến</span><span id="hud-route" class="hud-val">Phú Yên → Sài Gòn</span></div>
                <div class="hud-row"><span class="hud-label">Trạm tới</span><span id="hud-next" class="hud-val">Đại Lãnh (2.4 km)</span></div>
                <div class="hud-row"><span class="hud-label">Trạng thái</span><span id="hud-status" class="hud-val">Đỗ xe</span></div>
            </div>
            
            <div class="hud-panel hud-bl">
                <div class="speed-gauge">
                    <span id="hud-speed" class="speed-num">0</span>
                    <span class="speed-unit">km/h</span>
                </div>
                <div class="vehicle-stats">
                    <div class="fuel-gauge">
                        <div id="hud-fuel-bar" class="fuel-bar"></div>
                        <span id="hud-fuel-text" class="fuel-text">100%</span>
                    </div>
                    <div id="hud-door" class="door-status">🚪 Đóng</div>
                </div>
            </div>
            
            <div class="hud-panel hud-br">
                <div class="hud-row"><span class="hud-label">💵 Tiền</span><span id="hud-money" class="hud-val">0 ₫</span></div>
                <div class="hud-row"><span class="hud-label">🧍 Khách</span><span id="hud-pax" class="hud-val">0/24</span></div>
                <div class="hud-row"><span class="hud-label">🕒 Giờ</span><span id="hud-time" class="hud-val">06:00</span></div>
                <div class="hud-row"><span class="hud-label">🖥 FPS</span><span id="hud-fps" class="hud-val">60</span></div>
            </div>
        `;
    }

    update(data = {}) {
        const speed = Math.round(data.speedKmh || 0);
        const sp = document.getElementById('hud-speed');
        if (sp) {
            sp.textContent = speed;
            sp.style.color = speed > 90 ? '#f87171' : speed > 70 ? '#fbbf24' : '#4ade80';
        }

        const fuel = Math.max(0, Math.min(1, data.fuel ?? 1));
        const bar = document.getElementById('hud-fuel-bar');
        if (bar) {
            bar.style.width = (fuel * 100) + '%';
            bar.style.background = fuel <= 0.1 ? '#f87171' : fuel <= 0.2 ? '#fbbf24' : '#4ade80';
            document.getElementById('hud-fuel-text').textContent = Math.round(fuel * 100) + '%';
        }

        document.getElementById('hud-door').textContent = data.doorOpen ? '🚪 Mở' : '🚪 Đóng';
        document.getElementById('hud-money').textContent = new Intl.NumberFormat('vi-VN').format(data.money ?? 0) + ' ₫';
        document.getElementById('hud-pax').textContent = `${data.passengers ?? 0}/${data.passengerCapacity ?? 24}`;
        
        const t = data.timeMinutes ?? 0;
        const hh = String(Math.floor(t/60)%24).padStart(2,'0');
        const mm = String(Math.floor(t%60)).padStart(2,'0');
        document.getElementById('hud-time').textContent = `${hh}:${mm}`;
        
        document.getElementById('hud-fps').textContent = data.fps || 60;
        document.getElementById('hud-status').textContent = (data.speedKmh > 1) ? 'Đang chạy' : 'Đỗ xe';
    }

    show() { this.root.style.display = 'block'; }
    hide() { this.root.style.display = 'none'; }
}