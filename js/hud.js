// js/hud.js - HUD SYSTEM v2.0
// Features: Speedometer, gear, fuel, money, passengers, route info, next stop
// Optimized: DOM-based, throttled updates, lazy element creation

// ============================================================
// HUD CONFIGURATION
// ============================================================

export const HUD_CONFIG = {
    // === UPDATE RATE ===
    updateInterval: 0.1,      // Seconds (10Hz đủ cho HUD)
    
    // === SPEEDOMETER ===
    maxSpeedDisplay: 120,      // Max km/h hiển thị
    
    // === FUEL ===
    fuelWarningThreshold: 0.2, // 20% cảnh báo
    fuelCriticalThreshold: 0.1,// 10% nguy hiểm
    
    // === ROUTE ===
    showRouteInfo: true,
    showNextStop: true,
    showDistance: true,
    
    // === TOAST ===
    toastDuration: 3000,       // ms
    toastMaxStack: 5,
    
    // === COLORS ===
    colors: {
        speed: '#00ff88',
        speedWarn: '#ffaa00',
        speedDanger: '#ff4444',
        fuel: '#44aaff',
        fuelWarn: '#ffaa00',
        fuelCritical: '#ff4444',
        money: '#ffd700',
        passengers: '#00ccff',
        route: '#ffffff',
        accent: '#3b82f6'
    }
};

// ============================================================
// HUD SYSTEM CLASS
// ============================================================

export class HUDSystem {
    constructor({ ui = null, passengerSystem = null, map = null } = {}) {
        this.ui = ui;
        this.passengerSystem = passengerSystem;
        this.map = map;
        
        this.config = { ...HUD_CONFIG };
        
        // State
        this.elements = {};
        this.hudData = {};
        this.lastUpdateTime = 0;
        this.toastContainer = null;
        
        // Create HUD DOM
        this._createHUD();
        
        console.log("📊 HUD System initialized");
    }
    
    // ============================================================
    // DOM CREATION
    // ============================================================
    
    _createHUD() {
        // Remove existing HUD if any
        const existingHUD = document.getElementById('hud-container');
        if (existingHUD) {
            existingHUD.remove();
        }
        
        // Main container
        const container = document.createElement('div');
        container.id = 'hud-container';
        container.style.cssText = `
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 500;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        
        // === TOP LEFT: Route Info ===
        container.appendChild(this._createRouteInfoPanel());
        
        // === TOP RIGHT: Minimap area (minimap handles itself) ===
        
        // === BOTTOM LEFT: Status indicators ===
        container.appendChild(this._createStatusPanel());
        
        // === BOTTOM CENTER: Speedometer ===
        container.appendChild(this._createSpeedometer());
        
        // === BOTTOM RIGHT: Money & Passengers ===
        container.appendChild(this._createEconomyPanel());
        
        // === Toast Container ===
        container.appendChild(this._createToastContainer());
        
        document.body.appendChild(container);
        this.container = container;
    }
    
    _createRouteInfoPanel() {
        const panel = document.createElement('div');
        panel.id = 'hud-route-panel';
        panel.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 12px;
            padding: 12px 16px;
            color: #fff;
            min-width: 220px;
        `;
        
        panel.innerHTML = `
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">TUYẾN</div>
            <div id="hud-route-name" style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">
                PHÚ YÊN → SÀI GÒN
            </div>
            <div style="font-size: 11px; color: #94a3b8;">VỊ TRÍ HIỆN TẠI</div>
            <div id="hud-current-location" style="font-size: 13px; margin-bottom: 6px;">
                Bến xe Phú Yên
            </div>
            <div style="font-size: 11px; color: #94a3b8;">ĐIỂM TIẾP THEO</div>
            <div id="hud-next-stop" style="font-size: 13px; color: #3b82f6; font-weight: 500;">
                Trạm Đại Lãnh
                <span id="hud-next-distance" style="color: #94a3b8; font-weight: normal;"> (2.4 km)</span>
            </div>
        `;
        
        // Store references
        this.elements.routeName = panel.querySelector('#hud-route-name');
        this.elements.currentLocation = panel.querySelector('#hud-current-location');
        this.elements.nextStop = panel.querySelector('#hud-next-stop');
        this.elements.nextDistance = panel.querySelector('#hud-next-distance');
        
        return panel;
    }
    
    _createStatusPanel() {
        const panel = document.createElement('div');
        panel.id = 'hud-status-panel';
        panel.style.cssText = `
            position: absolute;
            bottom: 20px;
            left: 20px;
            display: flex;
            gap: 12px;
            align-items: flex-end;
        `;
        
        // === GEAR INDICATOR ===
        const gearBox = document.createElement('div');
        gearBox.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 8px 12px;
            text-align: center;
        `;
        gearBox.innerHTML = `
            <div style="font-size: 10px; color: #94a3b8;">GEAR</div>
            <div id="hud-gear" style="font-size: 20px; font-weight: bold; color: #00ff88;">N</div>
        `;
        
        // === FUEL GAUGE ===
        const fuelBox = document.createElement('div');
        fuelBox.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 8px 12px;
            min-width: 100px;
        `;
        fuelBox.innerHTML = `
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">⛽ NHIÊN LIỆU</div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="flex: 1; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
                    <div id="hud-fuel-bar" style="height: 100%; background: #44aaff; border-radius: 4px; transition: width 0.3s; width: 100%;"></div>
                </div>
                <span id="hud-fuel-text" style="font-size: 11px; color: #94a3b8;">100%</span>
            </div>
        `;
        
        // === DOOR STATUS ===
        const doorBox = document.createElement('div');
        doorBox.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 8px 12px;
            text-align: center;
        `;
        doorBox.innerHTML = `
            <div style="font-size: 10px; color: #94a3b8;">🚪 CỬA</div>
            <div id="hud-door" style="font-size: 14px; font-weight: 500; color: #94a3b8;">ĐÓNG</div>
        `;
        
        panel.appendChild(gearBox);
        panel.appendChild(fuelBox);
        panel.appendChild(doorBox);
        
        // Store references
        this.elements.gear = panel.querySelector('#hud-gear');
        this.elements.fuelBar = panel.querySelector('#hud-fuel-bar');
        this.elements.fuelText = panel.querySelector('#hud-fuel-text');
        this.elements.door = panel.querySelector('#hud-door');
        
        return panel;
    }
    
    _createSpeedometer() {
        const speedo = document.createElement('div');
        speedo.id = 'hud-speedometer';
        speedo.style.cssText = `
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 23, 42, 0.9);
            border: 2px solid rgba(59, 130, 246, 0.3);
            border-radius: 16px;
            padding: 12px 24px;
            text-align: center;
            min-width: 140px;
        `;
        
        speedo.innerHTML = `
            <div style="font-size: 36px; font-weight: bold; color: #00ff88; line-height: 1;" id="hud-speed">
                0
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                KM/H
            </div>
        `;
        
        this.elements.speed = speedo.querySelector('#hud-speed');
        
        return speedo;
    }
    
    _createEconomyPanel() {
        const panel = document.createElement('div');
        panel.id = 'hud-economy-panel';
        panel.style.cssText = `
            position: absolute;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: flex-end;
        `;
        
        // === MONEY ===
        const moneyBox = document.createElement('div');
        moneyBox.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(255, 215, 0, 0.3);
            border-radius: 8px;
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        moneyBox.innerHTML = `
            <span style="font-size: 16px;">💰</span>
            <span id="hud-money" style="font-size: 16px; font-weight: 600; color: #ffd700;">
                500.000 ₫
            </span>
        `;
        
        // === PASSENGERS ===
        const passengerBox = document.createElement('div');
        passengerBox.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(0, 204, 255, 0.3);
            border-radius: 8px;
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        passengerBox.innerHTML = `
            <span style="font-size: 16px;">👥</span>
            <span id="hud-passengers" style="font-size: 14px; color: #00ccff; font-weight: 500;">
                0 / 24
            </span>
        `;
        
        // === TIME ===
        const timeBox = document.createElement('div');
        timeBox.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 6px 12px;
        `;
        timeBox.innerHTML = `
            <span id="hud-time" style="font-size: 12px; color: #94a3b8;">06:00</span>
        `;
        
        panel.appendChild(moneyBox);
        panel.appendChild(passengerBox);
        panel.appendChild(timeBox);
        
        // Store references
        this.elements.money = panel.querySelector('#hud-money');
        this.elements.passengers = panel.querySelector('#hud-passengers');
        this.elements.time = panel.querySelector('#hud-time');
        
        return panel;
    }
    
    _createToastContainer() {
        const container = document.createElement('div');
        container.id = 'hud-toast-container';
        container.style.cssText = `
            position: absolute;
            top: 80px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: flex-end;
            pointer-events: none;
        `;
        
        this.toastContainer = container;
        return container;
    }
    
    // ============================================================
    // UPDATE METHODS
    // ============================================================
    
    /**
     * Main update - gọi từ game loop
     */
    update(deltaTime, hudData) {
        // Throttle
        this.lastUpdateTime += deltaTime;
        if (this.lastUpdateTime < this.config.updateInterval) return;
        this.lastUpdateTime = 0;
        
        // Merge data
        this.hudData = { ...this.hudData, ...hudData };
        
        // Update all panels
        this._updateSpeed();
        this._updateGear();
        this._updateFuel();
        this._updateDoor();
        this._updateMoney();
        this._updatePassengers();
        this._updateTime();
        this._updateRoute();
    }
    
    _updateSpeed() {
        if (!this.elements.speed) return;
        
        const speed = Math.abs(this.hudData.speed || 0);
        this.elements.speed.textContent = Math.round(speed);
        
        // Color based on speed
        let color = this.config.colors.speed;
        if (speed > 100) {
            color = this.config.colors.speedDanger;
        } else if (speed > 80) {
            color = this.config.colors.speedWarn;
        }
        this.elements.speed.style.color = color;
    }
    
    _updateGear() {
        if (!this.elements.gear) return;
        
        const gear = this.hudData.gear || 'N';
        this.elements.gear.textContent = gear;
        
        // Color by gear
        let color = '#94a3b8'; // N - neutral
        if (gear === 'D') color = '#00ff88';
        if (gear === 'R') color = '#ffaa00';
        
        this.elements.gear.style.color = color;
    }
    
    _updateFuel() {
        if (!this.elements.fuelBar || !this.elements.fuelText) return;
        
        const fuel = Math.max(0, Math.min(1, this.hudData.fuel || 1));
        const fuelPercent = Math.round(fuel * 100);
        
        // Update bar width
        this.elements.fuelBar.style.width = `${fuelPercent}%`;
        
        // Update text
        this.elements.fuelText.textContent = `${fuelPercent}%`;
        
        // Color based on fuel level
        let color = this.config.colors.fuel;
        if (fuel < this.config.fuelCriticalThreshold) {
            color = this.config.colors.fuelCritical;
            this.elements.fuelBar.style.animation = 'pulse 1s infinite';
        } else if (fuel < this.config.fuelWarningThreshold) {
            color = this.config.colors.fuelWarn;
            this.elements.fuelBar.style.animation = '';
        } else {
            this.elements.fuelBar.style.animation = '';
        }
        
        this.elements.fuelBar.style.background = color;
    }
    
    _updateDoor() {
        if (!this.elements.door) return;
        
        const isOpen = this.hudData.doorOpen || false;
        this.elements.door.textContent = isOpen ? 'MỞ' : 'ĐÓNG';
        this.elements.door.style.color = isOpen ? '#00ff88' : '#94a3b8';
    }
    
    _updateMoney() {
        if (!this.elements.money) return;
        
        const money = this.hudData.money || 0;
        this.elements.money.textContent = this._formatMoney(money);
    }
    
    _updatePassengers() {
        if (!this.elements.passengers) return;
        
        const onboard = this.hudData.passengers || 0;
        const capacity = this.hudData.passengerCapacity || 24;
        
        this.elements.passengers.textContent = `${onboard} / ${capacity}`;
        
        // Color warning nếu đầy
        if (onboard >= capacity) {
            this.elements.passengers.style.color = '#ffaa00';
        } else {
            this.elements.passengers.style.color = '#00ccff';
        }
    }
    
    _updateTime() {
        if (!this.elements.time) return;
        
        const time = this.hudData.time || '06:00';
        this.elements.time.textContent = time;
    }
    
    _updateRoute() {
        if (!this.elements.currentLocation || !this.elements.nextStop) return;
        
        // Current location
        if (this.hudData.currentLocation) {
            this.elements.currentLocation.textContent = this.hudData.currentLocation;
        }
        
        // Next stop
        if (this.hudData.nextStop) {
            const nextStopText = this.hudData.nextStop;
            const distance = this.hudData.nextStopDistance;
            
            let displayText = nextStopText;
            if (distance !== undefined && this.config.showDistance) {
                displayText += ` (${this._formatDistance(distance)})`;
            }
            
            this.elements.nextStop.textContent = displayText;
        }
    }
    
    // ============================================================
    // TOAST NOTIFICATIONS
    // ============================================================
    
    /**
     * Hiển thị toast notification
     */
    toast(message, type = 'info', duration = null) {
        if (!this.toastContainer) return;
        
        // Limit stack
        while (this.toastContainer.children.length >= this.config.toastMaxStack) {
            this.toastContainer.removeChild(this.toastContainer.firstChild);
        }
        
        // Create toast element
        const toast = document.createElement('div');
        toast.style.cssText = `
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 10px 16px;
            color: #fff;
            font-size: 13px;
            max-width: 300px;
            animation: slideIn 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        
        // Type-based styling
        switch (type) {
            case 'success':
                toast.style.borderColor = 'rgba(0, 255, 136, 0.5)';
                break;
            case 'warning':
                toast.style.borderColor = 'rgba(255, 170, 0, 0.5)';
                break;
            case 'error':
                toast.style.borderColor = 'rgba(255, 68, 68, 0.5)';
                break;
            case 'money':
                toast.style.borderColor = 'rgba(255, 215, 0, 0.5)';
                toast.style.color = '#ffd700';
                break;
        }
        
        toast.textContent = message;
        
        // Add to container
        this.toastContainer.appendChild(toast);
        
        // Auto remove
        const displayDuration = duration || this.config.toastDuration;
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, displayDuration);
    }
    
    // ============================================================
    // HELPERS
    // ============================================================
    
    _formatMoney(amount) {
        if (amount >= 1000000000) {
            return `${(amount / 1000000000).toFixed(1)}B ₫`;
        } else if (amount >= 1000000) {
            return `${(amount / 1000000).toFixed(1)}M ₫`;
        } else if (amount >= 1000) {
            return `${(amount / 1000).toFixed(0)}k ₫`;
        }
        return `${amount} ₫`;
    }
    
    _formatDistance(km) {
        if (km < 1) {
            return `${Math.round(km * 1000)}m`;
        }
        return `${km.toFixed(1)}km`;
    }
    
    // ============================================================
    // VISIBILITY CONTROL
    // ============================================================
    
    show() {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }
    
    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
    
    setVisible(panel, visible) {
        const element = this.elements[panel];
        if (element) {
            element.style.display = visible ? 'block' : 'none';
        }
    }
    
    // ============================================================
    // CLEANUP
    // ============================================================
    
    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.elements = {};
        this.toastContainer = null;
    }
}

// ============================================================
// CSS ANIMATIONS (inject vào document)
// ============================================================

const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }
`;
document.head.appendChild(styleSheet);

// ============================================================
// FACTORY
// ============================================================

export function createHUDSystem(options) {
    return new HUDSystem(options);
}