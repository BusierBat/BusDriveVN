// js/bus.js
import * as THREE from "three";

export const BUS_TEXTURE_URL = "assets/textures/bus/bus_final.png";
export const NPC_SKIN_DIR = "assets/textures/bus/bus_npc/";

const TW = 2048, TH = 1024, TIRE_M = 1.05;
const PX = {
  sideR: { bodyFront: 72, bodyRear: 1572, roof: 31, bodyBottom: 440, wheelBottom: 476, frontWheel: 394, rearWheel: 1126, wheelD: 123, doorFront: 97, doorRear: 220, doorTop: 154, winFront: 240, winRear: 1450, winLoTop: 190, winLoBot: 251, winHiTop: 77, winHiBot: 143 },
  sideL: { bodyRear: 56, bodyFront: 1490, roof: 543, bodyBottom: 952 },
  front: { bodyLeft: 1690, bodyRight: 1986, roof: 543, bodyBottom: 988, winTop: 599, winBot: 788, winLeft: 1700, winRight: 1930, hlTop: 830, hlBot: 900, hlL0: 1655, hlL1: 1700, hlR0: 1935, hlR1: 1980, indTop: 800, indBot: 825, indL0: 1652, indL1: 1672, indR0: 1976, indR1: 1996 },
  rear: { bodyLeft: 1690, bodyRight: 1986, roof: 31, bodyBottom: 471, winTop: 82, winBot: 154, winLeft: 1705, winRight: 1930, tlTop: 266, tlBot: 358, tlL0: 1660, tlL1: 1685, tlR0: 1950, tlR1: 1975, riTop: 365, riBot: 395 },
  roofBand: { x0: 600, x1: 1000, y0: 300, y1: 340 }
};

const S = TIRE_M / PX.sideR.wheelD;
const L = (PX.sideR.bodyRear - PX.sideR.bodyFront) * S;
const W = (PX.front.bodyRight - PX.front.bodyLeft) * S;
const H = (PX.sideR.wheelBottom - PX.sideR.roof) * S;
const BODY_BOTTOM = (PX.sideR.wheelBottom - PX.sideR.bodyBottom) * S;
const FRONT_AXLE_Z = L / 2 - (PX.sideR.frontWheel - PX.sideR.bodyFront) * S;
const REAR_AXLE_Z = L / 2 - (PX.sideR.rearWheel - PX.sideR.bodyFront) * S;
const WHEEL_RADIUS = (PX.sideR.wheelD / 2) * S;
const WHEEL_WIDTH = 0.3;
const WALL_X = W / 2 - 0.05;

export const BUS_DIMENSIONS = { length: L, width: W, height: H };

const sharedDark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
const sharedMetal = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.8 });
const sharedTire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const sharedPlate = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });

const U = (x) => x / TW, V = (y) => 1 - y / TH;
const UV_REGIONS = {
  right: { u0: U(PX.sideR.bodyFront), u1: U(PX.sideR.bodyRear), v0: V(PX.sideR.bodyBottom), v1: V(PX.sideR.roof) },
  left: { u0: U(PX.sideL.bodyRear), u1: U(PX.sideL.bodyFront), v0: V(PX.sideL.bodyBottom), v1: V(PX.sideL.roof) },
  rear: { u0: U(PX.rear.bodyLeft), u1: U(PX.rear.bodyRight), v0: V(PX.rear.bodyBottom), v1: V(PX.rear.roof) },
  front: { u0: U(PX.front.bodyLeft), u1: U(PX.front.bodyRight), v0: V(PX.front.bodyBottom), v1: V(PX.front.roof) },
  roofBand: { u0: U(PX.roofBand.x0), u1: U(PX.roofBand.x1), v0: V(PX.roofBand.y1), v1: V(PX.roofBand.y0) }
};

function mapRegion(r, t, s) { return [r.u0 + t * (r.u1 - r.u0), r.v0 + s * (r.v1 - r.v0)]; }

function faceUV(x, y, z, nx, ny, nz) {
  const s = (y - BODY_BOTTOM) / (H - BODY_BOTTOM);
  if (nx > 0.5) return mapRegion(UV_REGIONS.right, (L / 2 - z) / L, s);
  if (nx < -0.5) return mapRegion(UV_REGIONS.left, (L / 2 + z) / L, s);
  if (nz > 0.5) return mapRegion(UV_REGIONS.front, (x + W / 2) / W, s);
  if (nz < -0.5) return mapRegion(UV_REGIONS.rear, (W / 2 - x) / W, s);
  return mapRegion(UV_REGIONS.roofBand, (x + W / 2) / W, (L / 2 - z) / L);
}

const sideZr = (px) => L / 2 - (px - PX.sideR.bodyFront) * S;
const sideY = (py) => (PX.sideR.bodyBottom - py) * S + BODY_BOTTOM;
const sideZl = (px) => -L / 2 + (px - PX.sideL.bodyRear) * S;
const sideYl = (py) => (PX.sideL.bodyBottom - py) * S + BODY_BOTTOM;
const frontX = (px) => ((px - PX.front.bodyLeft) / (PX.front.bodyRight - PX.front.bodyLeft) - 0.5) * W;
const frontY = (py) => (PX.front.bodyBottom - py) * S;
const rearX = (px) => -(((px - PX.rear.bodyLeft) / (PX.rear.bodyRight - PX.rear.bodyLeft)) - 0.5) * W;
const rearY = (py) => (PX.rear.bodyBottom - py) * S;

function makeQuad(corners, uvs) {
  const geo = new THREE.BufferGeometry();
  const pos = [], uv = [];
  for (let i = 0; i < 4; i++) { pos.push(corners[i][0], corners[i][1], corners[i][2]); uv.push(uvs[i][0], uvs[i][1]); }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

function pixelQuad(face, px0, px1, py0, py1, offset) {
  const uvs = [[U(px0), V(py1)], [U(px1), V(py1)], [U(px1), V(py0)], [U(px0), V(py0)]];
  let c;
  if (face === "right") { const x = W / 2 + offset; c = [[x, sideY(py1), sideZr(px0)], [x, sideY(py1), sideZr(px1)], [x, sideY(py0), sideZr(px1)], [x, sideY(py0), sideZr(px0)]]; }
  else if (face === "left") { const x = -(W / 2 + offset); c = [[x, sideYl(py1), sideZl(px0)], [x, sideYl(py1), sideZl(px1)], [x, sideYl(py0), sideZl(px1)], [x, sideYl(py0), sideZl(px0)]]; }
  else if (face === "front") { const z = L / 2 + offset; c = [[frontX(px0), frontY(py1), z], [frontX(px1), frontY(py1), z], [frontX(px1), frontY(py0), z], [frontX(px0), frontY(py0), z]]; }
  else { const z = -(L / 2 + offset); c = [[rearX(px0), rearY(py1), z], [rearX(px1), rearY(py1), z], [rearX(px1), rearY(py0), z], [rearX(px0), rearY(py0), z]]; }
  return makeQuad(c, uvs);
}

function mergeGeos(list) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    const ix = g.index;
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function createLedStripTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const c = new THREE.Color(color);
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0)`);
  gradient.addColorStop(0.15, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.5)`);
  gradient.addColorStop(0.3, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 1)`);
  gradient.addColorStop(0.5, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 1)`);
  gradient.addColorStop(0.7, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 1)`);
  gradient.addColorStop(0.85, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.5)`);
  gradient.addColorStop(1, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 256; i += 4) {
    const brightness = Math.sin(i / 3) * 0.4 + 0.6;
    ctx.fillStyle = `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, ${brightness * 0.6})`;
    ctx.fillRect(i, 20, 3, 24);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

let SHARED = null;
function getShared() {
  if (SHARED) return SHARED;
  const g = {};

  const body = new THREE.BoxGeometry(W, H - BODY_BOTTOM, L);
  body.translate(0, BODY_BOTTOM + (H - BODY_BOTTOM) / 2, 0);

  const pos = body.attributes.position;
  const norm = body.attributes.normal;
  const uv = body.attributes.uv;

  if (uv) {
    for (let i = 0; i < pos.count; i++) {
      const [uVal, vVal] = faceUV(pos.getX(i), pos.getY(i), pos.getZ(i), norm.getX(i), norm.getY(i), norm.getZ(i));
      uv.setXY(i, uVal, vVal);
    }
    uv.needsUpdate = true;
  }
  g.body = body;

  const roof = new THREE.BoxGeometry(W - 0.06, 0.12, L - 0.1);
  {
    const p = roof.attributes.position, n = roof.attributes.normal, u = roof.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const [a, b] = mapRegion(UV_REGIONS.roofBand, (p.getX(i) + W / 2) / W, (p.getZ(i) + L / 2) / L);
      u.setXY(i, n.getY(i) > 0.5 ? a : UV_REGIONS.roofBand.u0, n.getY(i) > 0.5 ? b : UV_REGIONS.roofBand.v0);
    }
    u.needsUpdate = true;
  }
  g.roof = roof;

  g.glassSide = mergeGeos([pixelQuad("right", PX.sideR.winFront, PX.sideR.winRear, PX.sideR.winLoTop, PX.sideR.winLoBot, 0.006), pixelQuad("right", PX.sideR.winFront, PX.sideR.winRear, PX.sideR.winHiTop, PX.sideR.winHiBot, 0.006)]);
  g.glassEnds = mergeGeos([pixelQuad("front", PX.front.winLeft, PX.front.winRight, PX.front.winTop, PX.front.winBot, 0.006), pixelQuad("rear", PX.rear.winLeft, PX.rear.winRight, PX.rear.winTop, PX.rear.winBot, -0.006)]);
  g.head = mergeGeos([pixelQuad("front", PX.front.hlL0, PX.front.hlL1, PX.front.hlTop, PX.front.hlBot, 0.02), pixelQuad("front", PX.front.hlR0, PX.front.hlR1, PX.front.hlTop, PX.front.hlBot, 0.02)]);
  g.tail = mergeGeos([pixelQuad("rear", PX.rear.tlL0, PX.rear.tlL1, PX.rear.tlTop, PX.rear.tlBot, -0.02), pixelQuad("rear", PX.rear.tlR0, PX.rear.tlR1, PX.rear.tlTop, PX.rear.tlBot, -0.02)]);
  g.indL = mergeGeos([pixelQuad("front", PX.front.indL0, PX.front.indL1, PX.front.indTop, PX.front.indBot, 0.02), pixelQuad("rear", PX.rear.tlL0, PX.rear.tlL1, PX.rear.riTop, PX.rear.riBot, -0.02)]);
  g.indR = mergeGeos([pixelQuad("front", PX.front.indR0, PX.front.indR1, PX.front.indTop, PX.front.indBot, 0.02), pixelQuad("rear", PX.rear.tlR0, PX.rear.tlR1, PX.rear.riTop, PX.rear.riBot, -0.02)]);

  const doorGeo = pixelQuad("right", PX.sideR.doorFront, PX.sideR.doorRear, PX.sideR.bodyBottom, PX.sideR.doorTop, 0.009);
  const doorPos = doorGeo.attributes.position;
  const doorNorm = doorGeo.attributes.normal;
  for (let i = 0; i < doorPos.count; i++) {
    doorPos.setX(i, -doorPos.getX(i));
    doorNorm.setX(i, -doorNorm.getX(i));
  }
  doorPos.needsUpdate = true;
  doorNorm.needsUpdate = true;
  g.door = doorGeo;

  const mir = [];
  for (const side of [1, -1]) {
    const arm = new THREE.BoxGeometry(0.5, 0.08, 0.08); arm.translate(side * (W / 2 + 0.2), H - 0.55, L / 2 - 0.05);
    const hd = new THREE.BoxGeometry(0.1, 0.55, 0.3); hd.translate(side * (W / 2 + 0.45), H - 0.75, L / 2 + 0.1);
    mir.push(arm, hd);
  }
  g.mirrors = mergeGeos(mir);

  const pf = new THREE.BoxGeometry(0.8, 0.2, 0.03); pf.translate(0, 0.55, L / 2 + 0.02);
  const pr = new THREE.BoxGeometry(0.8, 0.2, 0.03); pr.translate(0, 0.65, -L / 2 - 0.02);
  g.plates = mergeGeos([pf, pr]);

  g.tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 16); g.tire.rotateZ(Math.PI / 2);
  g.rim = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.55, WHEEL_RADIUS * 0.55, WHEEL_WIDTH + 0.02, 12); g.rim.rotateZ(Math.PI / 2);

  const ledIntParts = [];
  const ledLen = L - 1.2;
  const CEILING_Y = 2.6;
  for (const side of [1, -1]) {
    const stripUpper = new THREE.BoxGeometry(0.02, 0.02, ledLen);
    stripUpper.translate(side * (WALL_X - 0.02), CEILING_Y - 0.05, 0);
    ledIntParts.push(stripUpper);
    const stripLower = new THREE.BoxGeometry(0.02, 0.02, ledLen);
    stripLower.translate(side * (WALL_X - 0.02), 0.85, 0);
    ledIntParts.push(stripLower);
  }
  g.ledInt = mergeGeos(ledIntParts);

  const extLen = L - 1.2;
  g.ledExtGeo = new THREE.BoxGeometry(0.06, 0.06, extLen);
  g.emergency = new THREE.BoxGeometry(0.4, 0.15, 0.02);

  SHARED = g;
  return g;
}

const textureCache = new Map();
const materialCache = new Map();
let sharedLoader = null;

function getLoader() { if (!sharedLoader) sharedLoader = new THREE.TextureLoader(); return sharedLoader; }

export function loadTextureCached(path) {
  let t = textureCache.get(path);
  if (!t) {
    t = getLoader().load(path);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textureCache.set(path, t);
  }
  return t;
}

export function getSkinMaterial(path) {
  let m = materialCache.get("b:" + path);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: loadTextureCached(path), roughness: 0.55, metalness: 0.15 });
    materialCache.set("b:" + path, m);
  }
  return m;
}

function assembleBus(mats, withDoorPivot) {
  const G = getShared();
  const root = new THREE.Group();
  root.name = "bus";
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    root.add(m);
    return m;
  };
  add(G.body, mats.body);
  add(G.roof, mats.body);
  const gr = add(G.glassSide, mats.glass);
  gr.renderOrder = 0;
  const gl = add(G.glassSide, mats.glass);
  gl.scale.x = -1;
  gl.renderOrder = 0;
  const ge = add(G.glassEnds, mats.glass);
  ge.renderOrder = 0;

  let doorPivot = null;
  if (withDoorPivot) {
    doorPivot = new THREE.Group();
    doorPivot.name = "doorPivot";
    doorPivot.position.set(0, 0, 0);
    const doorMesh = new THREE.Mesh(G.door, mats.door);
    doorPivot.add(doorMesh);
    root.add(doorPivot);
  } else {
    const doorMesh = new THREE.Mesh(G.door, mats.door);
    root.add(doorMesh);
  }

  const headMesh = add(G.head, mats.head);
  const tailMesh = add(G.tail, mats.tail);
  add(G.indL, mats.indL);
  add(G.indR, mats.indR);
  add(G.mirrors, sharedDark);
  add(G.plates, sharedPlate);

  const steerPivots = [], tireMeshes = [], rimMeshes = [];
  for (const [z, isFront] of [[FRONT_AXLE_Z, true], [REAR_AXLE_Z, false]]) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * (W / 2 - WHEEL_WIDTH / 2 + 0.02), WHEEL_RADIUS, z);
      const tire = new THREE.Mesh(G.tire, sharedTire);
      const rim = new THREE.Mesh(G.rim, sharedMetal);
      pivot.add(tire, rim);
      if (isFront) steerPivots.push(pivot);
      tireMeshes.push(tire);
      rimMeshes.push(rim);
      root.add(pivot);
    }
  }

  let interiorGroup = null;

  const ledInt = new THREE.Mesh(G.ledInt, mats.led);
  ledInt.name = "interiorLed";
  ledInt.renderOrder = 1;
  root.add(ledInt);

  const extMat = new THREE.MeshBasicMaterial({
    map: mats.ledExtTexture,
    // SÁNG HƠN: nhân màu trắng 1.8x (THREE.Color nhận giá trị > 1) —
    // additive blending nhân texture * color, tăng scale màu mà KHÔNG đổi tông
    // xanh 0x2fb6ff gốc. Đặt 1 lần lúc dựng material, không chạy mỗi frame,
    // áp dụng cho cả xe người chơi lẫn xe NPC (dùng chung assembleBus).
    color: new THREE.Color(1.8, 1.8, 1.8),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 1.5,
    side: THREE.DoubleSide
  });
  const extMeshes = [];
  const frontWheelZ = FRONT_AXLE_Z;
  const ledLength = (L / 2) + frontWheelZ + 0.8;
  const ledPosZ = (-L / 2 + frontWheelZ) / 7 - 0.1;
  const ledGeo = new THREE.BoxGeometry(0.06, 0.06, ledLength);

  for (const side of [1, -1]) {
    const upper = new THREE.Mesh(ledGeo, extMat.clone());
    upper.position.set(side * (WALL_X + 0.04), 3.40, ledPosZ);
    upper.renderOrder = 3;
    upper.name = "exteriorLed";
    extMeshes.push(upper);
    root.add(upper);

    const lower = new THREE.Mesh(ledGeo, extMat.clone());
    lower.position.set(side * (WALL_X + 0.04), 2.37, ledPosZ);
    lower.renderOrder = 3;
    lower.name = "exteriorLed";
    extMeshes.push(lower);
    root.add(lower);
  }

  const emergencyY = rearY(PX.rear.tlTop) + 0.25;
  const emergencyZ = -L / 2 - 0.01;
  const emergencyMesh = new THREE.Mesh(G.emergency, mats.emergency);
  emergencyMesh.position.set(0, emergencyY, emergencyZ);
  root.add(emergencyMesh);

  return {
    root, doorPivot, steerPivots, tireMeshes, rimMeshes, mats, headMesh, tailMesh, emergencyMesh, extMeshes, extMat
  };
}

function makeControl(a) {
  return {
    setSteering: (val) => {
      for (const pivot of a.steerPivots || []) {
        pivot.rotation.y = val * 0.3;
      }
    },
    setWheelRotation: (val) => {
      for (const tire of a.tireMeshes || []) {
        tire.rotation.x = val;
      }
    },
    setDoor: (t) => {
      if (a.doorPivot) {
        // Cửa trượt VỀ SAU khi mở (mở = t=1 → dịch −z 1.2m; đóng = t=0 → về 0).
        // doorGeo đã được dựng NGAY tại vị trí đúng trên thân xe theo layout
        // texture (sideZr: z = L/2 − (px − bodyFront)·S — door px 97..220 →
        // z ≈ 5.14..6.19, sát mũi xe như trận hình vẽ). Do đó lực offset pivot
        // khi đóng phải là 0; trước đây là (L/2 − 1.0) = +5.4m trên đỉnh tọa
        // độ local sẵn có → cả MESH CỬA TRÔI RA TRƯỚC ĐẦU XE ~5.4m (bug "cửa
        // lệch về phía trước"). Trượt đi/trượt về không drift: luôn tính từ 0.
        a.doorPivot.position.z = -t * 1.2;
      }
    }
  };
}

export function createBus({ textureUrl = BUS_TEXTURE_URL } = {}) {
  const texture = loadTextureCached(textureUrl);
  const headOff = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 0.5, metalness: 0.1 });
  const headOn = new THREE.MeshStandardMaterial({ color: 0xe8f2fa, emissive: 0xffffff, emissiveIntensity: .2, roughness: 0.5, metalness: 0.1 });
  const emergencyMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0, transparent: true, opacity: 0 });
  const ledExtTexture = createLedStripTexture(0x2fb6ff);

  const mats = {
    body: new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    door: new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide }),
    head: headOff,
    tail: new THREE.MeshStandardMaterial({ color: 0x4a0d0d, emissive: 0xff2020, emissiveIntensity: 0 }),
    indL: new THREE.MeshStandardMaterial({ color: 0x3a2408, emissive: 0xffa020, emissiveIntensity: 0.05 }),
    indR: new THREE.MeshStandardMaterial({ color: 0x3a2408, emissive: 0xffa020, emissiveIntensity: 0.05 }),
    led: new THREE.MeshStandardMaterial({ color: 0x06182b, emissive: 0x2fb6ff, emissiveIntensity: 5.4 }),
    emergency: emergencyMat,
    ledExtTexture: ledExtTexture
  };

  const a = assembleBus(mats, true);
  const c = makeControl(a);
  const tailMaterial = a.tailMesh.material;
  const emergencyMaterial = a.emergencyMesh.material;

  const spotL = new THREE.SpotLight(0xfff3cf, 0, 400, Math.PI / 5, 0.05, 1.0);
  spotL.position.set(-0.78, 1.05, L / 2 + 0.05);
  const spotLT = new THREE.Object3D(); spotLT.position.set(-0.78, 0, L / 2 + 100);
  const spotR = new THREE.SpotLight(0xfff3cf, 0, 400, Math.PI / 5, 0.05, 1.0);
  spotR.position.set(0.78, 1.05, L / 2 + 0.05);
  const spotRT = new THREE.Object3D(); spotRT.position.set(0.78, 0, L / 2 + 100);
  const tailGlow = new THREE.PointLight(0xff2020, 0, 20, 2.5);
  tailGlow.position.set(0, 1.1, -L / 2 - 0.3);
  a.root.add(spotL, spotLT, spotR, spotRT, tailGlow);
  spotL.target = spotLT;
  spotR.target = spotRT;

  let signalLeft = false, signalRight = false, hazard = false;
  let cockpitScreenTimer = 999;   // attach muộn: vẽ luôn frame đầu
  function update(dt) {
    // ĐÃ XÓA `c.updateDoor(dt)` — makeControl không có hàm đó (chỉ
    // setSteering/setWheelRotation/setDoor) => TypeError mỗi frame
    // ("c.updateDoor is not a function"). Cửa animate chính chủ tại
    // main.js: doorProgress -> bus.setDoor(doorProgress).
    const t = performance.now() / 1000;
    const blink = (t % 1) < 0.5;
    mats.indL.emissiveIntensity = ((signalLeft || hazard) && blink) ? 1.8 : 0.05;
    mats.indR.emissiveIntensity = ((signalRight || hazard) && blink) ? 1.8 : 0.05;
    // cockpit tài xế: màn update/BSOD redraw theo CHU KỲ 1s (không mỗi frame)
    if (cockpitTickScreen) {
      cockpitScreenTimer += dt;
      if (cockpitScreenTimer >= 1) {
        cockpitScreenTimer = 0;
        cockpitTickScreen(performance.now());
      }
    }
  }

  function setHeadlights(on) {
    if (on) {
      a.headMesh.material = headOn;
      spotL.intensity = 250;
      spotR.intensity = 150;
    } else {
      a.headMesh.material = headOff;
      spotL.intensity = 0;
      spotR.intensity = 0;
    }
    // BUG 6 FIX (game khuyng khi bam F/L): KHONG doi `.visible` cua SpotLight/PointLight.
    // Trong Three.js r160 `numPointLights`/`numSpotLights` nam TRONG program cache key
    // va `lights.state.version` tang khi length light trong render list doi -> tat 2 den
    // nay lam `needsProgramChange = true` cho TOAN BO MeshStandardMaterial -> gl.linkProgram
    // DONG BO ngay frame do (khong dung KHR_parallel_shader_compile) -> dot 1-3 giay tren
    // Intel UHD. Tat den chi can intensity = 0 (da co o tren) -> light count co dinh.
    spotL.visible = true;
    spotR.visible = true;
  }

  function setTaillights(on) {
    tailMaterial.emissiveIntensity = on ? 0.9 : 0;
    tailGlow.intensity = on ? 6 : 0;
    tailGlow.visible = true;   // BUG 6: giu luon trong render list, chi intensity moi doi
  }
  function setSignalLeft(on) { signalLeft = on; }
  function setSignalRight(on) { signalRight = on; }
  function setHazard(on) { hazard = on; }
  function setIndicators(on) { signalLeft = on; signalRight = on; }

  let interiorRef = null;
  function setInteriorLed(on) {
    if (interiorRef && typeof interiorRef.setInteriorLed === 'function') {
      interiorRef.setInteriorLed(on);
    }
    if (a.extMeshes) {
      a.extMeshes.forEach(mesh => {
        mesh.visible = on;
        mesh.material.opacity = on ? 1 : 0;
      });
    }
  }

  // ===== COCKPIT TAI XE (bus.js — interior.js CAM sua file, chi gan runtime) =====
  // Man hinh / 2 dong ho / nut bam la mesh CO SAN cua interior.js (o khung dash
  // tai (0,1.05,5.6) va x lan can =+/-0.45). Module nay CHI gan material/texture runtime
  // cho dung mesh do (traverse theo geometry + vi tri), khong dung he thong
  // thu hai cung chuc nang, khong sua file interior.js. Screen redraw theo chu
  // ky (1s; speedo chi khi so km/h doi) — nhe cho Pentium N5000/4GB. NPC
  // (createNpcBus) khong goi setInteriorReference nen khong attach.
  let cockpitDrawSpeed = null;
  function setDriverTelemetry(speedKmhSigned) {
    if (cockpitDrawSpeed) cockpitDrawSpeed(speedKmhSigned);
  }
  let cockpitTickScreen = null;
  function createDriverCockpit(interiorRoot) {
    if (cockpitTickScreen || !interiorRoot?.isObject3D) return;
    const findMesh = (pred) => {
      let hit = null;
      interiorRoot.traverse(o => {
        if (hit || !o.isMesh) return;
        const gp = o.geometry?.parameters;
        if (gp && pred(gp, o)) hit = o;
      });
      return hit;
    };
    const findAllMeshes = (pred) => {
      const hits = [];
      interiorRoot.traverse(o => {
        if (!o.isMesh) return;
        const gp = o.geometry?.parameters;
        if (gp && pred(gp, o)) hits.push(o);
      });
      return hits;
    };
    const screenMesh = findMesh((gp, o) =>
      Math.abs(gp.width - 0.5) < 0.03 && Math.abs(gp.height - 0.25) < 0.03 &&
      Math.abs(gp.depth - 0.05) < 0.03 && Math.abs(o.position.x) < 0.12 &&
      o.position.z > 5.3 && o.position.y > 0.9);
    const speedoMesh = findMesh((gp, o) =>
      Math.abs(gp.width - 0.35) < 0.03 && Math.abs(gp.height - 0.2) < 0.03 &&
      o.position.x < -0.25 && o.position.x > -0.6 && o.position.z > 5.3);
    const gaugeMesh = findMesh((gp, o) =>
      Math.abs(gp.width - 0.25) < 0.03 && Math.abs(gp.height - 0.15) < 0.03 &&
      o.position.x > 0.25 && o.position.x < 0.6 && o.position.z > 5.3);
    const btnMeshes = findAllMeshes((gp, o) =>
      Math.abs(gp.width - 0.04) < 0.02 && Math.abs(gp.height - 0.04) < 0.02 &&
      Math.abs(gp.depth - 0.04) < 0.02 && o.position.z > 5.3 &&
      o.position.y > 0.7 && o.position.y < 1.0);
    if (!screenMesh) {
      console.warn("[cockpit] Khong tim thay man hinh dashboard trong interior — khong gan bua");
      return;
    }

    // ---- man hinh trung tam: Windows Update + BSOD (TRUST_ME_BRO) + QR gia ----
    const SW = 320, SH = 192, DOT_N = 5, DOT_R = 13;
    const screenCv = document.createElement('canvas');
    screenCv.width = SW; screenCv.height = SH;
    const sctx = screenCv.getContext('2d');
    // 37% khoi dau; +1% moi 300 giay gio THUC (Date.now, khong theo FPS)
    const UPDATE_STEP_MS = 300000;
    const updateStartMs = Date.now();
    let screenMode = 0, lastScreenDraw = 0, lastBsodStart = 0, bsodEndMs = 0, bsodProgress = 0;

    const drawQRPseudo = (x, y, size) => {
      // QR Chi LA HINH (de bai) — luoi module gia, co 3 finder square cho giong,
      // KHONG ma hoa noi dung gi ca.
      const cells = 21, cell = size / (cells + 4);
      sctx.fillStyle = '#f2f2f2';
      sctx.fillRect(x, y, (cells + 4) * cell, (cells + 4) * cell);
      sctx.fillStyle = '#1a1a1a';
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          const inFinder = (r < 8 && c < 8) || (r < 8 && c >= cells - 8) || (r >= cells - 8 && c < 8);
          if (inFinder) continue;
          if (((r * 31 + c * 17 + (r * c) % 23) % 7) < 3) {
            sctx.fillRect(x + (c + 2) * cell, y + (r + 2) * cell, cell, cell);
          }
        }
      }
      const finder = (fx, fy) => {
        const f = 7 * cell;
        sctx.fillRect(x + (fx + 2) * cell, y + (fy + 2) * cell, f, f);
        sctx.fillStyle = '#f2f2f2';
        sctx.fillRect(x + (fx + 3) * cell, y + (fy + 3) * cell, f - 2 * cell, f - 2 * cell);
        sctx.fillStyle = '#1a1a1a';
        sctx.fillRect(x + (fx + 4) * cell, y + (fy + 4) * cell, f - 4 * cell, f - 4 * cell);
      };
      finder(0, 0); finder(cells - 7, 0); finder(0, cells - 7);
    };
    const drawUpdateScreen = (nowMs) => {
      const pct = 37 + Math.floor((nowMs - updateStartMs) / UPDATE_STEP_MS);
      sctx.fillStyle = '#0468c8';
      sctx.fillRect(0, 0, SW, SH);
      // vong xoay cham: chu ky RIENG 1.6s, doc lap voi percent
      const spin = ((nowMs % 1600) / 1600) * Math.PI * 2;
      sctx.fillStyle = '#ffffff';
      for (let i = 0; i < DOT_N; i++) {
        const ang = spin - i * ((Math.PI * 2) / DOT_N);
        sctx.globalAlpha = 1.0 - i * 0.17;
        sctx.beginPath();
        sctx.arc(38 + Math.cos(ang) * DOT_R, 44 + Math.sin(ang) * DOT_R, 4.2, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.globalAlpha = 1;
      sctx.textAlign = 'left';
      sctx.font = 'bold 23px Arial';
      sctx.fillText(`Working on update ${pct}%`, 24, 110);
      sctx.font = '15px Arial';
      sctx.fillText(`${pct}% complete`, 24, 137);
      sctx.font = '13px Arial';
      sctx.fillText("Don't turn off your computer", 24, 168);
    };
    const drawBsodScreen = () => {
      bsodProgress = Math.min(99, bsodProgress + 17);
      sctx.fillStyle = '#0078d7';
      sctx.fillRect(0, 0, SW, SH);
      sctx.fillStyle = '#ffffff';
      sctx.textAlign = 'left';
      sctx.font = 'bold 42px Arial';
      sctx.fillText(':(', 26, 60);
      sctx.font = '14px Arial';
      sctx.fillText('Your PC ran into a problem and needs to', 26, 88);
      sctx.fillText(`We're just collecting some error info,`, 26, 106);
      sctx.fillText(`and then we'll restart for you. ${bsodProgress}%`, 26, 124);
      sctx.font = '11px Arial';
      sctx.fillText('For more information about this issue and possible', 26, 150);
      sctx.fillText('fixes, visit busdrivevn.local/trustmebro', 26, 164);
      sctx.font = 'bold 12px Arial';
      sctx.fillText('STOP code: TRUST_ME_BRO', 26, 184);
      drawQRPseudo(SW - 66, SH - 78, 46);
    };
    const screenTex = new THREE.CanvasTexture(screenCv);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const refreshScreen = (nowMs) => {
      if (screenMode === 0) {
        drawUpdateScreen(nowMs);
        // xac suat nho + cooldown 90s moi xuat hien BSOD (ngau nhien vua phai)
        if (nowMs - lastBsodStart > 90000 && Math.random() < 0.006) {
          screenMode = 1;
          lastBsodStart = nowMs;
          bsodEndMs = nowMs + 12000 + Math.random() * 12000;
          bsodProgress = 0;
        }
      } else {
        drawBsodScreen();
        if (nowMs > bsodEndMs) screenMode = 0;  // "restart" xong ve lai update
      }
      screenTex.needsUpdate = true;
    };
    refreshScreen(performance.now());
    cockpitTickScreen = refreshScreen;
    screenMesh.material = new THREE.MeshBasicMaterial({ map: screenTex });

    // ---- dong ho toc do (cluster trai): SO KMH LAY TU XE THAT ----
    let spdCtex = null, lastSpdInt = -1, lastSpdRev = null, lastSpdDrawMs = 0;
    if (speedoMesh) {
      const GW2 = 192, GH2 = 96;
      const spdCv = document.createElement('canvas');
      spdCv.width = GW2; spdCv.height = GH2;
      const gctx = spdCv.getContext('2d');
      spdCtex = new THREE.CanvasTexture(spdCv);
      spdCtex.colorSpace = THREE.SRGBColorSpace;
      speedoMesh.material = new THREE.MeshBasicMaterial({ map: spdCtex });
      // ve lai CHI khi so km/h doi (hoac che do lui doi) — khong tung frame
      cockpitDrawSpeed = (kmhSigned) => {
        const rev = kmhSigned < -0.5;
        const aint = Math.round(Math.abs(kmhSigned));
        const nowMs = performance.now();
        if (aint === lastSpdInt && rev === lastSpdRev && (nowMs - lastSpdDrawMs) < 3000) return;
        lastSpdInt = aint; lastSpdRev = rev; lastSpdDrawMs = nowMs;
        gctx.fillStyle = '#020208';
        gctx.fillRect(0, 0, GW2, GH2);
        gctx.strokeStyle = '#35ffd0';
        gctx.lineWidth = 2;
        gctx.strokeRect(3, 3, GW2 - 6, GH2 - 6);
        gctx.fillStyle = '#f2fffb';
        gctx.textAlign = 'center';
        gctx.font = 'bold 40px Consolas, monospace';
        gctx.fillText(String(aint), GW2 / 2, 54);
        gctx.font = '13px Arial';
        gctx.fillStyle = '#8fe8d8';
        gctx.fillText(rev ? 'R' : 'km/h', GW2 / 2, 76);
        spdCtex.needsUpdate = true;
      };
      cockpitDrawSpeed(0);
    } else {
      console.warn("[cockpit] Khong tim thay cluster toc do trong interior");
    }

    // ---- dong ho phu (cluster phai): canvas TINH ve 1 lan ----
    if (gaugeMesh) {
      const aCv = document.createElement('canvas');
      aCv.width = 160; aCv.height = 96;
      const actx = aCv.getContext('2d');
      actx.fillStyle = '#020208';
      actx.fillRect(0, 0, 160, 96);
      actx.textAlign = 'center';
      actx.strokeStyle = '#ffcf3f'; actx.lineWidth = 2;
      actx.strokeRect(10, 14, 60, 40);
      actx.fillStyle = '#ffcf3f'; actx.font = '13px Arial';
      actx.fillText('BATT', 40, 40);
      actx.strokeStyle = '#2fb6ff';
      actx.strokeRect(90, 14, 60, 40);
      actx.fillStyle = '#2fb6ff';
      actx.fillText('TANK', 120, 40);
      actx.fillStyle = '#99a';
      actx.font = '11px Arial';
      actx.fillText('Tieu hao: 8km/l', 80, 78);
      gaugeMesh.material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(aCv) });
    }

    // ---- 4 nut bam: PHAN NHOM mau phat sang (gan 1 LAN luc attach ----
    // nhom: do = dung khan, vang = cua, xanh = LED noi that, trang = den)
    if (btnMeshes.length) {
      const groups = [0xff4040, 0xffd23f, 0x2fb6ff, 0xf2f4f0];
      btnMeshes.forEach((m, i) => {
        m.material = new THREE.MeshStandardMaterial({
          color: 0x111118, emissive: groups[i % 4], emissiveIntensity: 1.4
        });
      });
    } else {
      console.warn("[cockpit] Khong tim thay nut bam tren dashboard interior");
    }

    buildCockpitShell(interiorRoot, findMesh, findAllMeshes);
  }

  // ===== REBUILD TABLO theo anh khoang lai THACO that (anh kem prompt) =====
  // interior.js la FILE CAM — moi mesh duoi day do bus.js dung PHU quanh dash
  // san cua interior (dash goc y0.8-1.0 z5.3-5.6, volang x0.35 z5.1) cung he
  // toa do; khong dong geometry interior. Mesh count nho (~16) — Pentium-safe.
  function buildCockpitShell(interiorRoot, findMesh, findAllMeshes) {
    const dashDark = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.4, metalness: 0.25 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dce6, roughness: 0.3, metalness: 0.85 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.7 });
    // NOTE (táp-lô rebuild): hai mesh dash "phụ" cũ (dashTop/lowerDash) ĐÃ BỊ
    // XÓA — táp-lô thật giờ được dựng TRONG interior.js (mặt trên nghiêng +
    // mặt trước + vách hai bên + kick + knee console, khối kín hết bóng "bàn").
    // Dùng thêm khối dup ở đây chỉ gây z-fighting + tái tạo hình "chân bàn".
    // Các giáo deco giữ lại MẮT LÊN MẶT DASH MỚI:
    //   mặt trước dash z≈5.785±0.025 (bề ngoài 5.81) — mọi mesh mặt ở z>5.81.
    // Nep chrome ngang seam mặt trước/kick panel (y seam 0.736)
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.025, 0.03), chrome);
    trim.position.set(0, 0.736, 5.808);
    interiorRoot.add(trim);
    // Vong chrome quanh cluster (trái) + gauge phu (phai) — tâm trùng mesh
    // cluster/gauge cua interior (o z5.83), vong nhont truoc 1 cho de thay.
    const clusterTrim = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.018, 8, 24), chrome);
    clusterTrim.position.set(-0.45, 0.99, 5.87);
    interiorRoot.add(clusterTrim);
    const gaugeTrim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.014, 8, 20), chrome);
    gaugeTrim.position.set(0.45, 0.98, 5.86);
    interiorRoot.add(gaugeTrim);
    // 2 khe gio turbine chrome (phai dash theo anh): khung + ruot toi mau;
    // dong thoi: DICH cot volang chay runtime (interior dat x=+0.35 trong khi
    // ghe tai xe x=-0.35 theo LHD — volang phai nam truoc nguc tai xe).
    // ===== VÔ LĂNG: ẨN nhóm gốc + DỰNG LẠI bằng mesh bus.js =====
    // Test thực tế: phép dời position trên nhóm interior KHÔNG hiện đúng chỗ
    // (vô lăng vẫn bên phải = phía copilot). Thay vì thử các khác biến transform
    // runtime, qui về đạo hàm chắc chắn: ẨN steerGroup gốc (visible=false —
    // không phụ thuộc matrix đóng băng), dựng lại wheel+nan+column của bus.js
    // NGAY TẠI ghế tài xế LHD (x=-0.35, z=5.1, nghiêng như gốc PI/2-0.2).
    // Tìm nhóm gốc bằng torus vô lăng interior (local (0,0,0)); trims của
    // bus.js (clusterTrim/gaugeTrim) cũng Torus nhưng position != 0 → lọc.
    const steerRing = findMesh((gp, o) =>
      o.geometry?.type === "TorusGeometry" &&
      Math.abs(o.position.x) < 0.001 && Math.abs(o.position.y) < 0.001 &&
      Math.abs(o.position.z) < 0.001);
    if (steerRing?.parent) steerRing.parent.visible = false;
    const wheelGroup = new THREE.Group();
    // HOÁN VỊ theo test thực tế: vô lăng về x=+0.35 (chỗ ghế người chơi coi
    // là "tài xế"); nhóm gốc interior đã ẨN nên chỉ có 1 vô lăng duy nhất.
    wheelGroup.position.set(0.35, 1.1, 5.1);
    const wRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 16), dashDark);
    wRing.rotation.x = Math.PI / 2 - 0.2;
    wheelGroup.add(wRing);
    for (let i = 0; i < 3; i++) {
      const wAngle = (i / 3) * Math.PI * 2;
      const wSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.025), dashDark);
      wSpoke.position.set(Math.sin(wAngle) * 0.12, 0, Math.cos(wAngle) * 0.12);
      wSpoke.rotation.y = -wAngle;
      wheelGroup.add(wSpoke);
    }
    const wColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 8), panelMat);
    wColumn.position.set(0, -0.15, 0);
    wColumn.rotation.x = 0.2;
    wheelGroup.add(wColumn);
    interiorRoot.add(wheelGroup);
    for (const vx of [0.95, 0.62]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.035, 14), chrome);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(vx, 1.0, 5.826);
      interiorRoot.add(ring);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), panelMat);
      core.rotation.x = Math.PI / 2;
      core.position.set(vx, 1.0, 5.831);
      interiorRoot.add(core);
    }
    // Can so: tru + num (giua, thap — theo anh)
    const gearStick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.2, 8), chrome);
    gearStick.position.set(0.5, 0.75, 4.7);
    interiorRoot.add(gearStick);
    const gearKnob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), dashDark);
    gearKnob.position.set(0.5, 0.87, 4.7);
    interiorRoot.add(gearKnob);
    // Panel cong tac ben phai — montag len mat truoc dash moi (z>5.81)
    const switchPanel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.03), panelMat);
    switchPanel.position.set(0.75, 0.80, 5.823);
    interiorRoot.add(switchPanel);
    // ===== GHE TAI XE + PHU XE: boc CAM/DEN khau thoi theo anh THACO =====
    // Mesh ghe co san cua interior (cushion/back/headrest, z4.2-4.6, y<1.15):
    // gán material runtime — khong doi hinh hoc, khong sua file cam.
    // Man trung tam + cluster: scale RUNTIME (man goc 0.5x0.25 & cluster
    // 0.35x0.2 la quá nho tu mat nguoi ngi z4.95 y1.22 nhìn; theo ảnh màn
    // trung tâm = lớn màn dấu giữa dash. Gi nguyên vi tri, không doi file cấm.
    const bigScreen = findMesh((gp, o) =>
      Math.abs(gp.width - 0.5) < 0.03 && Math.abs(gp.height - 0.25) < 0.03 &&
      Math.abs(gp.depth - 0.05) < 0.03 && Math.abs(o.position.x) < 0.12 &&
      o.position.z > 5.3 && o.position.y > 0.9);
    // QUAN TRỌNG: mesh của interior qua helper box() bị đóng băng matrix
    // (matrixAutoUpdate=false + matrix cache sẵn) — scale.set() thật mà KHÔNG
    // gọi updateMatrix() thì matrix không bao giờ được tính lại = scale chết.
    if (bigScreen) { bigScreen.scale.set(1.4, 1.4, 1); bigScreen.updateMatrix(); }
    const bigCluster = findMesh((gp, o) =>
      Math.abs(gp.width - 0.35) < 0.03 && Math.abs(gp.height - 0.2) < 0.03 &&
      o.position.x < -0.25 && o.position.x > -0.6 && o.position.z > 5.3);
    if (bigCluster) { bigCluster.scale.set(1.25, 1.25, 1); bigCluster.updateMatrix(); }
    const seatMeshes = findAllMeshes((gp, o) =>
      (Math.abs(gp.width - 0.5) < 0.03 || Math.abs(gp.width - 0.45) < 0.03 ||
       Math.abs(gp.width - 0.3) < 0.03 || Math.abs(gp.width - 0.25) < 0.03) &&
      o.position.z < 4.65 && o.position.z > 4.15 &&
      o.position.y > 0.2 && o.position.y < 1.15 &&
      (Math.abs(o.position.x + 0.35) < 0.05 || Math.abs(o.position.x - 0.65) < 0.05));
    const seatCam = new THREE.MeshStandardMaterial({ color: 0xd97b1f, roughness: 0.9, metalness: 0.05 });
    const seatBlack = new THREE.MeshStandardMaterial({ color: 0x17171e, roughness: 0.85, metalness: 0.05 });
    seatMeshes.forEach((m) => {
      const headrestLike = m.geometry.parameters.width <= 0.32;
      m.material = headrestLike ? seatBlack : seatCam;
    });
  }

  function setEmergencyBrake(on) { emergencyMaterial.emissiveIntensity = on ? 1.2 : 0; emergencyMaterial.opacity = on ? 1 : 0; }
  function dispose() {}

  const busObj = {
    group: a.root, texture, dimensions: BUS_DIMENSIONS, wheelRadius: WHEEL_RADIUS,
    setSteering: c.setSteering, setWheelRotation: c.setWheelRotation, setDoor: c.setDoor,
    setHeadlights, setTaillights, setIndicators, setSignalLeft, setSignalRight, setHazard,
    setInteriorLed, setEmergencyBrake, update, dispose, setDriverTelemetry,
    areLightsOn: false, doorOpen: false, interiorLedOn: false,
    setInteriorReference: (interior) => {
      interiorRef = interior;
      // cockpit chỉ tồn tại trên xe người chơi (interior của createBusInterior)
      if (interior?.isObject3D) createDriverCockpit(interior);
    }
  };

  return busObj;
}

let npcSkinList = null;
let npcSkinPromise = null;

export function loadNpcSkinList() {
  if (npcSkinPromise) return npcSkinPromise;

  if (location.protocol === "file:") {
    npcSkinList = [BUS_TEXTURE_URL];
    npcSkinPromise = Promise.resolve(npcSkinList);
    return npcSkinPromise;
  }

  // Pre-defined skin list as fallback (since directory listing may not work on all servers)
  const knownSkins = [
    "bus (1).png", "bus (2).png", "bus (3).png", "bus (4).png",
    "bus (5).png", "bus (6).png", "bus (7).png", "bus (8).png",
    "bus (9).png", "bus (10).png", "bus (11).png", "bus (12).png",
    "bus (13).png", "bus (14).png", "bus (15).png", "bus (16).png"
  ];

  npcSkinPromise = fetch(NPC_SKIN_DIR, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error('Cannot fetch skin directory');
      return r.text();
    })
    .then((html) => {
      const names = new Set();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const links = doc.querySelectorAll("a[href]");

      if (links.length) {
        links.forEach((a) => {
          const href = decodeURIComponent(a.getAttribute("href") || "").split("?")[0].split("#")[0];
          const m = href.match(/([^/]+\.png)$/i);
          if (m && m[1].toLowerCase() !== "bus_final.png") {
            names.add(m[1]);
          }
        });
      }

      if (!names.size) {
        for (const line of html.split(/\r?\n/)) {
          const m = line.trim().match(/([^/]+\.png)$/i);
          if (m && m[1].toLowerCase() !== "bus_final.png") {
            names.add(m[1]);
          }
        }
      }

      npcSkinList = [...names].sort().map((n) => NPC_SKIN_DIR + n);

      if (npcSkinList.length === 0) {
        // Fallback to known skins
        npcSkinList = knownSkins.map(n => NPC_SKIN_DIR + n);
      }

      return npcSkinList;
    })
    .catch((err) => {
      console.warn('⚠ Cannot load skin list from server, using built-in list:', err);
      npcSkinList = knownSkins.map(n => NPC_SKIN_DIR + n);
      return npcSkinList;
    });

  return npcSkinPromise;
}

export function pickNpcSkinPath() {
  if (!npcSkinList || npcSkinList.length === 0) {
    return BUS_TEXTURE_URL;
  }
  const randomIndex = Math.floor(Math.random() * npcSkinList.length);
  return npcSkinList[randomIndex];
}

export function pickLedColor() {
  return [0x39ff6e, 0x2fb6ff, 0xffffff, 0xff9a2f, 0xff4fd8, 0xffd23f, 0x9d4fff, 0x35ffd0][(Math.random() * 8) | 0];
}

export function createNpcBus({ skinPath = null, ledColor = 0x2fb6ff } = {}) {
  const finalSkinPath = skinPath || pickNpcSkinPath();

  const texture = loadTextureCached(finalSkinPath);
  const headOff = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 0.5, metalness: 0.1 });
  const emergencyMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0, transparent: true, opacity: 0 });
  const ledExtTexture = createLedStripTexture(ledColor);

  const mats = {
    body: new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    door: new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide }),
    head: headOff,
    tail: new THREE.MeshStandardMaterial({ color: 0x4a0d0d, emissive: 0xff2020, emissiveIntensity: 0.4 }),
    indL: new THREE.MeshStandardMaterial({ color: 0x3a2408, emissive: 0xffa020, emissiveIntensity: 0.05 }),
    indR: new THREE.MeshStandardMaterial({ color: 0x3a2408, emissive: 0xffa020, emissiveIntensity: 0.05 }),
    led: new THREE.MeshStandardMaterial({ color: 0x06182b, emissive: ledColor, emissiveIntensity: 1.4 }),
    emergency: emergencyMat,
    ledExtTexture: ledExtTexture
  };

  const a = assembleBus(mats, false);
  const c = makeControl(a);

  function setSkin(path) {
    const t = loadTextureCached(path);
    mats.body.map = t; mats.body.needsUpdate = true;
    mats.glass.map = t; mats.glass.needsUpdate = true;
    mats.door.map = t; mats.door.needsUpdate = true;
  }

  return {
    group: a.root,
    dimensions: BUS_DIMENSIONS,
    wheelRadius: WHEEL_RADIUS,
    setSteering: c.setSteering,
    setWheelRotation: c.setWheelRotation,
    setDoor: c.setDoor,
    setHeadlights: (on) => { if(a.headMesh) a.headMesh.material.emissiveIntensity = on ? 0.2 : 0; },
    setTaillights: (on) => { if(a.tailMesh) a.tailMesh.material.emissiveIntensity = on ? 0.9 : 0; },
    setInteriorLed: (on) => {
      const led = a.root.getObjectByName("interiorLed");
      if(led) led.visible = on;
    },
    setSkin,
    skinPath: finalSkinPath
  };
}
