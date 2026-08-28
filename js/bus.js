// js/bus.js - FULL VERSION (FIXED NPC TEXTURE AUTO-DISCOVERY + setInteriorLed)
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
  g.door = pixelQuad("right", PX.sideR.doorFront, PX.sideR.doorRear, PX.sideR.doorTop, PX.sideR.bodyBottom, 0.008);
  
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

const sharedDark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
const sharedMetal = new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.35, metalness: 0.8 });
const sharedTire = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.95 });
const sharedPlate = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6 });

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
    doorPivot.position.set(W / 2 + 0.008, 0, sideZr(PX.sideR.doorFront));
    doorPivot.add(new THREE.Mesh(G.door, mats.door));
    root.add(doorPivot);
  } else {
    add(G.door, mats.door);
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
  
  // Lưu tham chiếu đến interior để dùng trong setInteriorLed
  let interiorGroup = null;
  
  const ledInt = new THREE.Mesh(G.ledInt, mats.led);
  ledInt.name = "interiorLed";
  ledInt.renderOrder = 1;
  root.add(ledInt);
  
  const extMat = new THREE.MeshBasicMaterial({
    map: mats.ledExtTexture,
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
    setSteering: (v) => { if(a.steerPivots) a.steerPivots.forEach(p => p.rotation.y = v); },
    setWheelRotation: (r) => {
      if(a.tireMeshes) {
        for (let i = 0; i < a.tireMeshes.length; i++) {
          a.tireMeshes[i].rotation.x = r;
          a.rimMeshes[i].rotation.x = r;
        }
      }
    },
    setDoor: (t) => { if(a.doorPivot) a.doorPivot.rotation.y = -t * 1.1; }
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
  
  const spotL = new THREE.SpotLight(0xfff3cf, 0, 45, Math.PI / 4.6, 0.45, 1.1);
  spotL.position.set(-0.78, 1.05, L / 2 + 0.05);
  const spotLT = new THREE.Object3D(); spotLT.position.set(-0.78, 0, L / 2 + 25);
  const spotR = new THREE.SpotLight(0xfff3cf, 0, 45, Math.PI / 4.6, 0.45, 1.1);
  spotR.position.set(0.78, 1.05, L / 2 + 0.05);
  const spotRT = new THREE.Object3D(); spotRT.position.set(0.78, 0, L / 2 + 25);
  const tailGlow = new THREE.PointLight(0xff2020, 0, 7, 1.8);
  tailGlow.position.set(0, 1.1, -L / 2 - 0.3);
  a.root.add(spotL, spotLT, spotR, spotRT, tailGlow);
  spotL.target = spotLT;
  spotR.target = spotRT;
  
  let signalLeft = false, signalRight = false, hazard = false;
  function update(t) {
    const blink = (t % 1) < 0.5;
    mats.indL.emissiveIntensity = ((signalLeft || hazard) && blink) ? 1.8 : 0.05;
    mats.indR.emissiveIntensity = ((signalRight || hazard) && blink) ? 1.8 : 0.05;
  }
  function setHeadlights(on) {
    if (on) { a.headMesh.material = headOn; spotL.intensity = 100; spotR.intensity = 60; } 
    else { a.headMesh.material = headOff; spotL.intensity = 0; spotR.intensity = 0; }
  }
  function setTaillights(on) { tailMaterial.emissiveIntensity = on ? 0.9 : 0; tailGlow.intensity = on ? 6 : 0; }
  function setSignalLeft(on) { signalLeft = on; }
  function setSignalRight(on) { signalRight = on; }
  function setHazard(on) { hazard = on; }
  function setIndicators(on) { signalLeft = on; signalRight = on; }
  
  // ===== SỬA LỖI: setInteriorLed gọi được interior =====
  let interiorRef = null; // sẽ được gán từ bên ngoài
  function setInteriorLed(on) {
    // Gọi interior.setInteriorLed nếu có
    if (interiorRef && typeof interiorRef.setInteriorLed === 'function') {
      interiorRef.setInteriorLed(on);
    }
    // Bật/tắt LED ngoài
    if (a.extMeshes) {
      a.extMeshes.forEach(mesh => { 
        mesh.visible = on; 
        mesh.material.opacity = on ? 1.5 : 0; 
      });
    }
    // Có thể còn LED khác (nếu có) nhưng không ẩn toàn bộ interior
    // Không set interior.visible = on (vì sẽ ẩn cả nội thất)
  }
  
  function setEmergencyBrake(on) { emergencyMaterial.emissiveIntensity = on ? 1.2 : 0; emergencyMaterial.opacity = on ? 1 : 0; }
  function dispose() {}
  
  // Expose để gán interior từ bên ngoài
  const busObj = {
    group: a.root, texture, dimensions: BUS_DIMENSIONS, wheelRadius: WHEEL_RADIUS,
    setSteering: c.setSteering, setWheelRotation: c.setWheelRotation, setDoor: c.setDoor,
    setHeadlights, setTaillights, setIndicators, setSignalLeft, setSignalRight, setHazard,
    setInteriorLed, setEmergencyBrake, update, dispose,
    areLightsOn: false, doorOpen: false, interiorLedOn: false,
    // Thêm phương thức để gán interior
    setInteriorReference: (interior) => { interiorRef = interior; }
  };
  
  return busObj;
}

// =========================================================================
// PHẦN QUẢN LÝ SKIN XE NPC - AUTO-DISCOVERY TỪ THƯ MỤC
// =========================================================================

let npcSkinList = null;
let npcSkinPromise = null;

export function loadNpcSkinList() {
  if (npcSkinPromise) return npcSkinPromise;
  
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
        npcSkinList = [NPC_SKIN_DIR + "bus_final.png"];
      }
      
      console.log(`🚌 Loaded ${npcSkinList.length} NPC skins:`, npcSkinList);
      return npcSkinList;
    })
    .catch((err) => {
      console.warn('️ Cannot load skin list, using default:', err);
      npcSkinList = [NPC_SKIN_DIR + "bus_final.png"];
      return npcSkinList;
    });
    
  return npcSkinPromise;
}

export function pickNpcSkinPath() {
  if (!npcSkinList || npcSkinList.length === 0) {
    return NPC_SKIN_DIR + "bus_final.png";
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
      // Cho NPC bus, chỉ bật/tắt led của chính nó (nếu có)
      const led = a.root.getObjectByName("interiorLed"); 
      if(led) led.visible = on; 
    },
    setSkin,
    skinPath: finalSkinPath
  };
}