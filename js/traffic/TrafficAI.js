// js/traffic/TrafficAI.js - AI lái xe thông minh, có personality, rẽ mượt
import * as THREE from "three";
import { createSeededRandom, lerpAngle, clamp } from "../utils.js";
const TWO_PI = Math.PI * 2;
// Personality types
export const DRIVER_PERSONALITY = {
NORMAL: {
label: 'Bình thường',
speedFactor: 0.8,
followDistance: 8,
acceleration: 4,
deceleration: 8,
overtakeChance: 0.05,
laneChangeChance: 0.02,
aggressiveFactor: 0.0,
},
CAREFUL: {
label: 'Cẩn thận',
speedFactor: 0.65,
followDistance: 12,
acceleration: 2.5,
deceleration: 10,
overtakeChance: 0.0,
laneChangeChance: 0.01,
aggressiveFactor: -0.3,
},
AGGRESSIVE: {
label: 'Ẩu',
speedFactor: 1.1,
followDistance: 4,
acceleration: 8,
deceleration: 12,
overtakeChance: 0.25,
laneChangeChance: 0.08,
aggressiveFactor: 0.6,
},
RANDOM: {
label: 'Ngẫu nhiên',
speedFactor: 0.9,
followDistance: 7,
acceleration: 5,
deceleration: 9,
overtakeChance: 0.1,
laneChangeChance: 0.05,
aggressiveFactor: 0.2,
}
};
// Trạng thái AI
export const AI_STATE = {
DRIVING: 'DRIVING',
FOLLOWING: 'FOLLOWING',
SLOWING: 'SLOWING',
STOPPING: 'STOPPING',
WAITING: 'WAITING',
TURNING: 'TURNING',
OVERTAKING: 'OVERTAKING',
LANE_CHANGING: 'LANE_CHANGING',
YIELDING: 'YIELDING',
PARKED: 'PARKED',
};
export class TrafficAI {
constructor({
vehicle,             // instance từ createNpcBus() hoặc createBus()
roadGraph,           // roadDataSegments
personality = 'NORMAL',
seed = null,
}) {
this.vehicle = vehicle;
this.roadGraph = roadGraph;
this.seed = seed || Math.random() * 999999;
this.random = createSeededRandom(this.seed);
// Personality
const basePersonality = DRIVER_PERSONALITY[personality] || DRIVER_PERSONALITY.NORMAL;
this.personality = {
...basePersonality,
speedFactor: basePersonality.speedFactor * (0.9 + this.random() * 0.2),
followDistance: basePersonality.followDistance * (0.8 + this.random() * 0.4),
};
// State
this.state = AI_STATE.DRIVING;
this.speed = 0;
this.targetSpeed = 0;
this.maxSpeed = 12 + this.random() * 4; // 12-16 m/s
this.heading = 0;
this.targetHeading = 0;
this.turnProgress = 0;
this.oldHeading = 0;
this.laneOffset = 0;
this.targetLaneOffset = 0;
// Waypoint tracking
this.currentSegmentIndex = 0;
this.progress = 0; // 0-1 trên segment
this.turning = false;
this.turnTimer = 0;
// Following
this.followTarget = null;
this.followDistance = this.personality.followDistance;
this.brakeTimer = 0;
// Overtaking
this.overtaking = false;
this.overtakeTimer = 0;
this.overtakeDirection = 1;
// Collider
this.collider = { x: 0, z: 0, r: 1.4 };
// Animation
this.wheelSpin = 0;
this.steerAngle = 0;
// LOD
this.active = true;
this.lastUpdateTime = 0;
this.updateInterval = 1 / 30;

// ===== PATCH: Fields cho stop 20s / lane change / cut-in =====
this.shouldStop = this.random() < 0.15;           // 15% xe có kế hoạch dừng
this.stopTimer = 0;
this.stopDuration = 18 + this.random() * 6;        // ~20s ±3
this.stopCooldown = 40 + this.random() * 80;       // cooldown 40–120s giữa các lần
this.stopCooldownTimer = this.stopCooldown * this.random();
this.stopped = false;
this.laneChangeTimer = 0;
this.laneChangeCooldown = 8 + this.random() * 15;
this.cutInCooldown = 0;
this._segWidth = 10;
// ===== END PATCH =====

// Khởi tạo vị trí
this._initPosition();
}
_initPosition() {
if (!this.roadGraph || this.roadGraph.length === 0) return;
const seg = this.roadGraph[0];
if (!seg) return;
this.currentSegmentIndex = 0;
this.progress = 0.1 + this.random() * 0.3;
this._updatePositionFromSegment();
// Set heading
this.heading = this._getSegmentHeading(0);
this.targetHeading = this.heading;
// Cập nhật vehicle
this.vehicle.group.position.set(this.collider.x, 0.5, this.collider.z);
this.vehicle.group.rotation.y = this.heading;

// ===== PATCH: Lane PHẢI mặc định (âm theo convention npc.js) =====
this.laneOffset = -0.3 * (seg.width || 10);
this.targetLaneOffset = this.laneOffset;
// ===== END PATCH =====
}
_getSegmentHeading(index) {
const seg = this.roadGraph[index];
if (!seg) return 0;
const p0 = seg.points[0];
const p1 = seg.points[1];
return Math.atan2(p1.x - p0.x, p1.z - p0.z);
}
_updatePositionFromSegment() {
const seg = this.roadGraph[this.currentSegmentIndex];
if (!seg) return;
const p0 = seg.points[0];
const p1 = seg.points[1];
const x = p0.x + (p1.x - p0.x) * this.progress;
const z = p0.z + (p1.z - p0.z) * this.progress;
this.collider.x = x;
this.collider.z = z;

// ===== PATCH: Sửa perpendicular vector (trước đây đang là forward) =====
// perpendicular PHẢI: (cos(angle), -sin(angle))  [xoay forward -90°]
const angle = this._getSegmentHeading(this.currentSegmentIndex);
const nx =  Math.cos(angle);
const nz = -Math.sin(angle);
this.collider.x += nx * this.laneOffset;
this.collider.z += nz * this.laneOffset;
// ===== END PATCH =====
}
_getCurrentSegment() {
return this.roadGraph[this.currentSegmentIndex];
}
_getNextSegment() {
const nextIndex = this.currentSegmentIndex + 1;
if (nextIndex < this.roadGraph.length) {
return this.roadGraph[nextIndex];
}
return null;
}
_getSegmentLength(seg) {
if (!seg) return 0;
const p0 = seg.points[0];
const p1 = seg.points[1];
return Math.hypot(p1.x - p0.x, p1.z - p0.z);
}
// ====== MAIN UPDATE ======
update(deltaTime, playerPos, allVehicles) {
if (!this.active) return;
// LOD: giảm update frequency khi xa
if (playerPos) {
const dist = Math.hypot(
this.collider.x - playerPos.x,
this.collider.z - playerPos.z
);
if (dist > 300) {
this.updateInterval = 1 / 10;
} else if (dist > 150) {
this.updateInterval = 1 / 20;
} else {
this.updateInterval = 1 / 30;
}
}
this.lastUpdateTime += deltaTime;
if (this.lastUpdateTime < this.updateInterval) return;
const dt = this.lastUpdateTime;
this.lastUpdateTime = 0;
// 1. Tìm xe phía trước
this._findFollowTarget(allVehicles);
// 2. Cập nhật trạng thái
this._updateState(dt, allVehicles); // PATCH: thêm allVehicles để check gap
// 3. Cập nhật tốc độ
this._updateSpeed(dt);
// 4. Cập nhật vị trí
this._updatePosition(dt);
// 5. Cập nhật hướng (rẽ mượt)
this._updateHeading(dt);
// 6. Cập nhật vehicle
this._updateVehicle();
// 7. Kiểm tra turn
this._checkTurn(dt);
}
// ====== FIND FOLLOW TARGET ======
_findFollowTarget(allVehicles) {
this.followTarget = null;
if (!allVehicles || allVehicles.length === 0) return;
const myAngle = this.heading;
const myX = this.collider.x;
const myZ = this.collider.z;
let closestDist = Infinity;
for (const other of allVehicles) {
if (other === this) continue;
if (!other.collider) continue;
const dx = other.collider.x - myX;
const dz = other.collider.z - myZ;
const dist = Math.hypot(dx, dz);
if (dist > 40) continue;
// Kiểm tra xe ở phía trước (dot product > 0)
const dot = dx * Math.sin(myAngle) + dz * Math.cos(myAngle);
if (dot < 0) continue;
// Kiểm tra cùng lane (khoảng cách bên)
const perp = -dx * Math.cos(myAngle) + dz * Math.sin(myAngle);
const laneWidth = 3;
if (Math.abs(perp) > laneWidth * 1.5) continue;
if (dist < closestDist) {
closestDist = dist;
this.followTarget = other;
}
}
}
// ====== STATE MACHINE ======
_updateState(dt, allVehicles) {
const seg = this._getCurrentSegment();
if (!seg) return;
// Kiểm tra đến cuối segment
const segLen = this._getSegmentLength(seg);
if (this.progress >= 0.95 && !this.turning) {
// Chuẩn bị rẽ sang segment tiếp theo
const nextSeg = this._getNextSegment();
if (nextSeg) {
this.turning = true;
this.turnTimer = 0;
this.oldHeading = this.heading;
this.targetHeading = this._getSegmentHeading(this.currentSegmentIndex + 1);
// Dừng một chút trước khi rẽ
this.state = AI_STATE.TURNING;
this.targetSpeed = this.maxSpeed * 0.3;
} else {
// Đến cuối tuyến - quay lại hoặc dừng
this.targetSpeed = 0;
this.state = AI_STATE.STOPPING;
this.progress = 0.95;
}
}
// Kiểm tra follow target
if (this.followTarget) {
const dx = this.followTarget.collider.x - this.collider.x;
const dz = this.followTarget.collider.z - this.collider.z;
const dist = Math.hypot(dx, dz);
const followDist = this.followDistance + (this.followTarget.speed || 0) * 0.5;
if (dist < followDist * 0.5) {
// Quá gần - phanh gấp
this.state = AI_STATE.STOPPING;
this.targetSpeed = 0;
this.brakeTimer = 0.5;
} else if (dist < followDist * 0.8) {
// Gần - giảm tốc
this.state = AI_STATE.FOLLOWING;
const targetSpd = (this.followTarget.speed || 0) * 0.9;
this.targetSpeed = Math.min(targetSpd, this.maxSpeed * 0.7);
} else if (dist > followDist * 1.5) {
// Xa - có thể tăng tốc
if (this.state !== AI_STATE.TURNING) {
this.state = AI_STATE.DRIVING;
this.targetSpeed = this.maxSpeed * this.personality.speedFactor;
}
} else {
// Bình thường
if (this.state !== AI_STATE.TURNING) {
this.state = AI_STATE.FOLLOWING;
this.targetSpeed = (this.followTarget.speed || 0) * 0.95;
}
}
} else {
// Không có xe phía trước
if (this.state !== AI_STATE.TURNING && this.state !== AI_STATE.STOPPING) {
this.state = AI_STATE.DRIVING;
this.targetSpeed = this.maxSpeed * this.personality.speedFactor;
}
}

// ===== PATCH: STOP 20 GIÂY (shouldStop) =====
this._segWidth = (this._getCurrentSegment()?.width) || 10;
if (this.stopCooldownTimer > 0) this.stopCooldownTimer -= dt;
if (!this.stopped && this.state !== AI_STATE.TURNING &&
    this.state !== AI_STATE.STOPPING && this.state !== AI_STATE.OVERTAKING &&
    this.shouldStop && this.stopCooldownTimer <= 0 && this.speed > 2) {
  // xác suất nhỏ mỗi frame (~mỗi 8–15s sẽ trigger 1 lần khi đủ điều kiện)
  if (this.random() < 0.0015) {
    this.stopped = true;
    this.state = AI_STATE.STOPPING;
    this.stopTimer = this.stopDuration;
    this.targetSpeed = 0;
    // dịch sát lề phải để "đỗ"
    this.targetLaneOffset = -0.42 * this._segWidth;
  }
}
if (this.stopped) {
  this.stopTimer -= dt;
  this.targetSpeed = 0;
  if (this.stopTimer <= 0) {
    this.stopped = false;
    this.state = AI_STATE.DRIVING;
    this.targetSpeed = this.maxSpeed * this.personality.speedFactor * 0.6; // tăng tốc từ từ
    this.targetLaneOffset = -0.3 * this._segWidth; // quay lane phải
    this.stopCooldownTimer = this.stopCooldown;
    this.shouldStop = this.random() < 0.15; // có thể sẽ dừng lại lần nữa
  }
}
// ===== END PATCH =====

// ===== PATCH: LANE CHANGE ngẫu nhiên (chỉ khi đang DRIVING, không overtake, không stop) =====
if (!this.overtaking && !this.stopped &&
    (this.state === AI_STATE.DRIVING || this.state === AI_STATE.FOLLOWING)) {
  this.laneChangeTimer += dt;
  if (this.laneChangeTimer > this.laneChangeCooldown) {
    this.laneChangeTimer = 0;
    this.laneChangeCooldown = 8 + this.random() * 15;
    const lc = this.personality.laneChangeChance;
    if (this.random() < lc) {
      // lấn nhẹ lane trái (rất hiếm) hoặc chỉ xê dịch nhẹ trong lane
      const side = this.random() < 0.3 ? 1 : -1;
      this.targetLaneOffset = side * (0.1 + this.random() * 0.25) * this._segWidth;
    } else {
      this.targetLaneOffset = -0.3 * this._segWidth; // về lane phải
    }
  }
}
// ===== END PATCH =====

// ===== PATCH: OVERTAKE (có kiểm tra lane bên cạnh + cut-in sau khi vượt) =====
if (this.cutInCooldown > 0) this.cutInCooldown -= dt;
if (!this.overtaking && !this.stopped &&
    this.personality.aggressiveFactor > 0.2 &&
    this.state === AI_STATE.FOLLOWING &&
    this.followTarget &&
    (this.followTarget.speed || 0) < this.speed * 0.7 &&
    this.stopCooldownTimer >= 0) {
  if (this.random() < this.personality.overtakeChance * 0.5) {
    // chọn bên vượt: ưu tiên lane trái (perpendicular dương = trái theo convention)
    const side = 1;
    // kiểm tra khoảng trống bên cạnh
    const gapOk = this._checkSideGap(allVehicles, side, 12);
    if (gapOk) {
      this.overtaking = true;
      this.overtakeTimer = 0;
      this.overtakeDirection = side;
      this.state = AI_STATE.OVERTAKING;
      this.targetLaneOffset = side * 0.35 * this._segWidth;
      this.targetSpeed = this.maxSpeed * Math.min(1, this.personality.speedFactor + 0.15);
    }
  }
}
if (this.overtaking) {
  this.overtakeTimer += dt;
  // Đã qua xe phía trước hoặc hết thời gian → cut-in về lane phải
  const passed = !this.followTarget ||
    Math.hypot(this.followTarget.collider.x - this.collider.x,
               this.followTarget.collider.z - this.collider.z) > 8;
  if ((passed && this.overtakeTimer > 1.5) || this.overtakeTimer > 4.0) {
    this.overtaking = false;
    this.state = AI_STATE.DRIVING;
    this.targetLaneOffset = -0.3 * this._segWidth; // cut-in về lane phải
    this.cutInCooldown = 3 + this.random() * 3;
    this.targetSpeed = this.maxSpeed * this.personality.speedFactor;
  }
}
// ===== END PATCH =====

// Cập nhật lane offset về target
this.laneOffset += (this.targetLaneOffset - this.laneOffset) * Math.min(1, dt * 2);
}

// ===== PATCH: Helper kiểm tra khoảng trống bên cạnh để vượt =====
_checkSideGap(allVehicles, side, minGap) {
  if (!allVehicles) return true;
  const angle = this.heading;
  const px = Math.cos(angle) * side;  // perpendicular bên side
  const pz = -Math.sin(angle) * side;
  for (const other of allVehicles) {
    if (other === this || !other.collider) continue;
    const dx = other.collider.x - this.collider.x;
    const dz = other.collider.z - this.collider.z;
    const along = dx * Math.sin(angle) + dz * Math.cos(angle); // dọc
    const across = dx * px + dz * pz;                          // ngang bên side
    if (Math.abs(across) < 1.8 && Math.abs(along) < minGap) return false;
  }
  return true;
}
// ===== END PATCH =====

// ====== SPEED ======
_updateSpeed(dt) {
const accel = this.personality.acceleration;
const decel = this.personality.deceleration;
if (this.speed < this.targetSpeed) {
// Tăng tốc
this.speed += accel * dt;
if (this.speed > this.targetSpeed) this.speed = this.targetSpeed;
} else if (this.speed > this.targetSpeed) {
// Giảm tốc
this.speed -= decel * dt;
if (this.speed < this.targetSpeed) this.speed = this.targetSpeed;
}
// Giới hạn
this.speed = Math.max(0, this.speed);
// Thêm nhiễu nhỏ cho AI ẩu
if (this.personality.aggressiveFactor > 0.3) {
this.speed += (this.random() - 0.5) * 0.5 * dt;
}
}
// ====== POSITION ======
_updatePosition(dt) {
const seg = this._getCurrentSegment();
if (!seg) return;
const segLen = this._getSegmentLength(seg);
const speedFactor = this.speed / segLen;
this.progress += speedFactor * dt;
// Nếu vượt quá segment, chuyển sang segment tiếp theo
if (this.progress >= 1.0 && !this.turning) {
this.progress = 0.0;
this.currentSegmentIndex++;
if (this.currentSegmentIndex >= this.roadGraph.length) {
this.currentSegmentIndex = 0; // Loop (nếu có)
this.progress = 0.1;
}
// Cập nhật heading cho segment mới
this.oldHeading = this.heading;
this.targetHeading = this._getSegmentHeading(this.currentSegmentIndex);
this.turning = true;
this.turnTimer = 0;
}
// Giới hạn progress
this.progress = Math.max(0, Math.min(1, this.progress));
// Cập nhật position
this._updatePositionFromSegment();
}
// ====== HEADING (RẼ MƯỢT) ======
_updateHeading(dt) {
if (this.turning) {
this.turnTimer += dt;
const turnDuration = 1.2 + (1 - this.personality.aggressiveFactor) * 0.8;
const progress = Math.min(1, this.turnTimer / turnDuration);
// Ease in-out
const smooth = progress < 0.5 ?
2 * progress * progress :
1 - Math.pow(-2 * progress + 2, 2) / 2;
// Lerp angle
let diff = this.targetHeading - this.oldHeading;
while (diff > Math.PI) diff -= TWO_PI;
while (diff < -Math.PI) diff += TWO_PI;
this.heading = this.oldHeading + diff * smooth;
if (progress >= 1) {
this.turning = false;
this.heading = this.targetHeading;
// Quay lại trạng thái driving sau khi rẽ
if (this.state === AI_STATE.TURNING) {
this.state = AI_STATE.DRIVING;
this.targetSpeed = this.maxSpeed * this.personality.speedFactor;
}
}
} else {
// Smooth heading khi đang đi thẳng
const targetHeading = this._getSegmentHeading(this.currentSegmentIndex);
this.heading = lerpAngle(this.heading, targetHeading, Math.min(1, dt * 1.5));
}
}
// ====== CHECK TURN ======
_checkTurn(dt) {
// Nếu sắp đến cuối segment và chưa rẽ
if (this.progress > 0.85 && !this.turning) {
const nextSeg = this._getNextSegment();
if (nextSeg) {
const nextAngle = this._getSegmentHeading(this.currentSegmentIndex + 1);
let diff = nextAngle - this.heading;
while (diff > Math.PI) diff -= TWO_PI;
while (diff < -Math.PI) diff += TWO_PI;
// Nếu góc rẽ lớn, chuẩn bị giảm tốc
if (Math.abs(diff) > 0.3) {
this.targetSpeed = this.maxSpeed * 0.4;
}
}
}
}
// ====== UPDATE VEHICLE ======
_updateVehicle() {
if (!this.vehicle) return;
// Position
this.vehicle.group.position.set(
this.collider.x,
0.5,
this.collider.z
);
this.vehicle.group.rotation.y = this.heading;
// Wheel rotation
this.wheelSpin += (this.speed / 0.5) * this.lastUpdateTime;
if (this.vehicle.setWheelRotation) {
this.vehicle.setWheelRotation(this.wheelSpin);
}
// Steering
const steerTarget = this.turning ? Math.sin(this.turnTimer * 2) * 0.3 : 0;
this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, this.lastUpdateTime * 3);
if (this.vehicle.setSteering) {
this.vehicle.setSteering(this.steerAngle);
}
// Door (mặc định đóng)
if (this.vehicle.setDoor) {
this.vehicle.setDoor(0);
}
// Headlights (tắt)
if (this.vehicle.setHeadlights) {
this.vehicle.setHeadlights(false);
}
// Interior LED (tắt khi đang chạy)
if (this.vehicle.setInteriorLed) {
this.vehicle.setInteriorLed(false);
}
}
// ====== HELPER ======
getPosition() {
return { x: this.collider.x, z: this.collider.z };
}
getSpeed() {
return this.speed;
}
getHeading() {
return this.heading;
}
isActive() {
return this.active;
}
setActive(active) {
this.active = active;
if (!active && this.vehicle && this.vehicle.group) {
this.vehicle.group.visible = false;
} else if (active && this.vehicle && this.vehicle.group) {
this.vehicle.group.visible = true;
}
}
dispose() {
if (this.vehicle && this.vehicle.group) {
if (this.vehicle.group.parent) {
this.vehicle.group.parent.remove(this.vehicle.group);
}
}
this.active = false;
}
}