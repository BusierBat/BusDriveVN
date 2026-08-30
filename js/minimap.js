// js/minimap.js - MINIMAP SYSTEM v2.0
// Features: Route highlight, passenger markers, station markers, zoom control, rotation
// Optimized: Canvas 2D, throttled updates, culling off-screen elements

// ============================================================
// CONFIGURATION
// ============================================================

export const MINIMAP_CONFIG = {
    // === SIZE ===
    size: 200,                    // Canvas size (px)
    padding: 10,                  // Padding từ edge
    
    // === ZOOM ===
    defaultZoom: 0.08,            // Scale factor (meters → pixels)
    minZoom: 0.03,
    maxZoom: 0.3,
    zoomStep: 0.02,
    
    // === COLORS ===
    colors: {
        background: 'rgba(15, 23, 42, 0.9)',
        border: 'rgba(59, 130, 246, 0.5)',
        grid: 'rgba(255, 255, 255, 0.05)',
        
        // Roads
        roadGeneral: 'rgba(100, 100, 100, 0.4)',
        roadQL1A: 'rgba(100, 150, 255, 0.3)',
        roadHighway: 'rgba(255, 200, 50, 0.3)',
        roadRoute: 'rgba(59, 130, 246, 1.0)',      // Route highlight - blue
        roadRouteGlow: 'rgba(59, 110, 246, 0.3)',
        
        // Markers
        player: '#00ff88',
        playerHeading: '#00ff88',
        passenger: '#00ccff',
        station: '#ffaa00',
        gasStation: '#ff4400',
        junction: '#ffffff',
        tollStation: '#ff8800',
        restStop: '#44ff88',
    },
    
    // === MARKER SIZES ===
    markerSizes: {
        player: 6,
        passenger: 4,
        station: 5,
        gasStation: 5,
        junction: 3,
        tollStation: 5,
        restStop: 4,
    },
    
    // === UPDATE RATE ===
    updateInterval: 0.1,          // Seconds between updates
    
    // === BEHAVIOR ===
    rotateWithPlayer: false,      // Minimap rotate theo hướng xe
    showGrid: true,
    showRoute: true,
    showPassengers: true,
    showStations: true,
    showNorth: true,
    
    // === FUEL STATION ROTATION ===
    fuelIconRotation: true,       // Icon cây xăng xoay tròn
    fuelIconRotationSpeed: 2.0,   // Rad/s
};

// ============================================================
// MINIMAP CLASS
// ============================================================

export class MinimapSystem {
    constructor({ map, passengerSystem = null, ui = null }) {
        this.map = map;
        this.passengerSystem = passengerSystem;
        this.ui = ui;
        
        this.config = { ...MINIMAP_CONFIG };
        
        // Canvas setup
        this.canvas = null;
        this.ctx = null;
        this.setupCanvas();
        
        // State
        this.zoom = this.config.defaultZoom;
        this.playerPos = { x: 0, z: 0 };
        this.playerHeading = 0;
        
        // Cached data
        this.minimapData = null;
        this.cachedRoads = null;
        this.cachedPOIs = null;
        this.cachedRoute = null;
        
        // Animation
        this.animationTime = 0;
        this.lastUpdateTime = 0;
        
        // Load map data
        this.loadMapData();
        
        console.log("🗺️ MinimapSystem initialized");
    }
    
    // ============================================================
    // SETUP
    // ============================================================
    
    setupCanvas() {
        this.canvas = document.getElementById('minimap');
        if (!this.canvas) {
            // Tạo canvas nếu chưa có
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'minimap';
            this.canvas.width = this.config.size;
            this.canvas.height = this.config.size;
            this.canvas.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                border-radius: 50%;
                border: 2px solid rgba(59, 130, 246, 0.5);
                background: rgba(15, 23, 42, 0.9);
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            `;
            document.body.appendChild(this.canvas);
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = this.config.size;
        this.canvas.height = this.config.size;
    }
    
    loadMapData() {
        if (!this.map?.getMinimapData) return;
        
        this.minimapData = this.map.getMinimapData();
        this.cachedRoads = this.minimapData.segments;
        this.cachedPOIs = this.minimapData.pois;
        this.cachedRoute = this.minimapData.route;
    }
    
    // ============================================================
    // PUBLIC API
    // ============================================================
    
    /**
     * Update minimap (gọi từ game loop)
     */
    update(deltaTime, playerPos, playerHeading) {
        this.animationTime += deltaTime;
        
        // Throttle updates
        if (this.animationTime - this.lastUpdateTime < this.config.updateInterval) {
            return;
        }
        this.lastUpdateTime = this.animationTime;
        
        // Update state
        this.playerPos = playerPos;
        this.playerHeading = playerHeading;
        
        // Draw
        this.draw();
    }
    
    /**
     * Zoom control
     */
    zoomIn() {
        this.zoom = Math.min(this.config.maxZoom, this.zoom + this.config.zoomStep);
        this.draw();
    }
    
    zoomOut() {
        this.zoom = Math.max(this.config.minZoom, this.zoom - this.config.zoomStep);
        this.draw();
    }
    
    setZoom(zoom) {
        this.zoom = clamp(zoom, this.config.minZoom, this.config.maxZoom);
        this.draw();
    }
    
    // ============================================================
    // DRAWING
    // ============================================================
    
    draw() {
        if (!this.ctx || !this.minimapData) return;
        
        const ctx = this.ctx;
        const size = this.config.size;
        const half = size / 2;
        
        // Clear
        ctx.clearRect(0, 0, size, size);
        
        // Background
        this._drawBackground(ctx, size);
        
        // Save context
        ctx.save();
        
        // Translate to center (player position)
        ctx.translate(half, half);
        
        // Rotate if enabled
        if (this.config.rotateWithPlayer) {
            ctx.rotate(-this.playerHeading);
        }
        
        // Draw roads
        this._drawRoads(ctx);
        
        // Draw route highlight
        if (this.config.showRoute) {
            this._drawRoute(ctx);
        }
        
        // Draw POIs
        this._drawPOIs(ctx);
        
        // Draw passengers
        if (this.config.showPassengers && this.passengerSystem) {
            this._drawPassengers(ctx);
        }
        
        // Restore context
        ctx.restore();
        
        // Draw player (always at center)
        this._drawPlayer(ctx, half, half);
        
        // Draw north indicator
        if (this.config.showNorth) {
            this._drawNorthIndicator(ctx, size);
        }
        
        // Draw zoom controls
        this._drawZoomControls(ctx, size);
    }
    
    // ============================================================
    // PRIVATE DRAW METHODS
    // ============================================================
    
    _drawBackground(ctx, size) {
        ctx.fillStyle = this.config.colors.background;
        ctx.beginPath();
        ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
        ctx.fill();
    }
    
    _drawRoads(ctx) {
        if (!this.cachedRoads) return;
        
        const zoom = this.zoom;
        const playerPos = this.playerPos;
        
        ctx.lineWidth = 1;
        
        for (const road of this.cachedRoads) {
            // Convert to minimap coordinates
            const fromX = (road.from.x - playerPos.x) * zoom;
            const fromZ = (road.from.z - playerPos.z) * zoom;
            const toX = (road.to.x - playerPos.x) * zoom;
            const toZ = (road.to.z - playerPos.z) * zoom;
            
            // Culling: skip if both points are too far
            const half = this.config.size / 2;
            if (Math.abs(fromX) > half + 50 && Math.abs(toX) > half + 50) continue;
            if (Math.abs(fromZ) > half + 50 && Math.abs(toZ) > half + 50) continue;
            
            // Choose color based on road type
            let color = this.config.colors.roadGeneral;
            if (road.roadType === 'QL1A') {
                color = this.config.colors.roadQL1A;
            } else if (road.roadType === 'HIGHWAY') {
                color = this.config.colors.roadHighway;
            }
            
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(fromX, fromZ);
            ctx.lineTo(toX, toZ);
            ctx.stroke();
        }
    }
    
    _drawRoute(ctx) {
        if (!this.cachedRoute) return;
        
        const zoom = this.zoom;
        const playerPos = this.playerPos;
        
        // Draw route with glow
        ctx.lineWidth = 3;
        ctx.strokeStyle = this.config.colors.roadRoute;
        ctx.shadowColor = this.config.colors.roadRouteGlow;
        ctx.shadowBlur = 4;
        
        ctx.beginPath();
        
        for (let i = 0; i < this.cachedRoute.length; i++) {
            const node = this.cachedRoute[i];
            const x = (node.x - playerPos.x) * zoom;
            const z = (node.z - playerPos.z) * zoom;
            
            if (i === 0) {
                ctx.moveTo(x, z);
            } else {
                ctx.lineTo(x, z);
            }
        }
        
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow
    }
    
    _drawPOIs(ctx) {
        if (!this.cachedPOIs) return;
        
        const zoom = this.zoom;
        const playerPos = this.playerPos;
        
        for (const poi of this.cachedPOIs) {
            const x = (poi.x - playerPos.x) * zoom;
            const z = (poi.z - playerPos.z) * zoom;
            
            // Culling
            const half = this.config.size / 2;
            if (Math.abs(x) > half || Math.abs(z) > half) continue;
            
            // Get marker style by type
            let color = this.config.colors.junction;
            let size = this.config.markerSizes.junction;
            let icon = null;
            
            switch (poi.type) {
                case 'bus_station':
                    color = this.config.colors.station;
                    size = this.config.markerSizes.station;
                    icon = '🚌';
                    break;
                case 'gas_station':
                    color = this.config.colors.gasStation;
                    size = this.config.markerSizes.gasStation;
                    icon = '⛽';
                    break;
                case 'toll_station':
                    color = this.config.colors.tollStation;
                    size = this.config.markerSizes.tollStation;
                    icon = '🎫';
                    break;
                case 'rest_stop':
                    color = this.config.colors.restStop;
                    size = this.config.markerSizes.restStop;
                    icon = '🅿️';
                    break;
                case 'junction':
                    color = this.config.colors.junction;
                    size = this.config.markerSizes.junction;
                    break;
            }
            
            // Draw circle marker
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, z, size, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw icon nếu gần zoom
            if (this.zoom > 0.1 && icon) {
                ctx.font = `${size * 2}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(icon, x, z);
            }
        }
    }
    
    _drawPassengers(ctx) {
        if (!this.passengerSystem?.getMinimapData) return;
        
        const passengers = this.passengerSystem.getMinimapData();
        if (!passengers || passengers.length === 0) return;
        
        const zoom = this.zoom;
        const playerPos = this.personaPos || this.playerPos;
        
        ctx.fillStyle = this.config.colors.passenger;
        
        for (const p of passengers) {
            const x = (p.x - playerPos.x) * zoom;
            const z = (p.z - playerPos.z) * zoom;
            
            // Culling
            const half = this.config.size / 2;
            if (Math.abs(x) > half || Math.abs(z) > half) continue;
            
            // Draw passenger marker (dot)
            ctx.beginPath();
            ctx.arc(x, z, this.config.markerSizes.passenger, 0, Math.PI * 2);
            ctx.fill();
            
            // Pulse effect
            const pulse = 1 + Math.sin(this.animationTime * 3) * 0.3;
            ctx.strokeStyle = this.config.colors.passenger;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, z, this.config.markerSizes.passenger * pulse, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    _drawPlayer(ctx, centerX, centerY) {
        const size = this.config.markerSizes.player;
        
        // Player triangle (hướng xe)
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(this.playerHeading);
        
        // Triangle pointing up (forward)
        ctx.fillStyle = this.config.colors.player;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.7, size * 0.7);
        ctx.lineTo(-size * 0.7, size * 0.7);
        ctx.closePath();
        ctx.fill();
        
        // Heading indicator
        ctx.strokeStyle = this.config.colors.playerHeading;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(0, -size * 1.5);
        ctx.stroke();
        
        ctx.restore();
    }
    
    _drawNorthIndicator(ctx, size) {
        const x = size - 15;
        const y = 15;
        
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('N', x, y + 4);
        
        // North arrow
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x - 3, y + 3);
        (this.ctx || ctx).lineTo(x + 3, y + 3);
        ctx.closePath();
        ctx.fill();
    }
    
    _drawZoomControls(ctx, size) {
        // Zoom buttons (simple + / -)
        const btnSize = 20;
        const x = 10;
        const y = size - 10 - btnSize;
        
        // + button
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(x, y, btnSize, btnSize);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', x + btnSize/2, y + btnSize/2);
        
        // - button
        const y2 = y - btnSize - 5;
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(x, y2, btnSize, btnSize);
        ctx.fillStyle = '#fff';
        ctx.fillText('-', x + btnSize/2, y2 + btnSize/2);
    }
    
    // ============================================================
    // INTERACTION
    // ============================================================
    
    /**
     * Handle click on minimap
     */
    handleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Check zoom buttons
        const btnSize = 20;
        const half = this.config.size / 2;
        
        // + button position
        if (x >= 10 && x <= 10 + btnSize && y >= this.config.size - 10 - btnSize && y <= this.config.size - 10) {
            this.zoomIn();
            return;
        }
        
        // - button position  
        if (x >= 10 && x <= 10 + btnSize && y >= this.config.size - 10 - btnSize - 5 - btnSize && y <= this.config.size - 10 - 5) {
            this.zoomOut();
            return;
        }
    }
    
    /**
     * Handle wheel zoom
     */
    handleWheel(event) {
        event.preventDefault();
        if (event.deltaY < 0) {
            this.zoomIn();
        } else {
            this.zoomOut();
        }
    }
    
    // ============================================================
    // SETTINGS
    // ============================================================
    
    toggleRoute() {
        this.config.showRoute = !this.config.showRoute;
        this.draw();
    }
    
    togglePassengers() {
        this.config.showPassengers = !this.config.showPassengers;
        this.draw();
    }
    
    toggleStations() {
        this.config.showStations = !this.config.showStations;
        this.draw();
    }
    
    toggleRotation() {
        this.config.rotateWithPlayer = !this.config.rotateWithPlayer;
        this.draw();
    }
    
    // ============================================================
    // CLEANUP
    // ============================================================
    
    dispose() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
        this.minimapData = null;
        this.cachedRoads = null;
        this.cachedPOIs = null;
        this.cachedRoute = null;
    }
}

// ============================================================
// HELPERS
// ============================================================

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// ============================================================
// FACTORY
// ============================================================

export function createMinimapSystem(options) {
    return new MinimapSystem(options);
}