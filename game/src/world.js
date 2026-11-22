// Cinder Bay: a procedural coastal city. One seeded layout: 6x6 road grid, four districts,
// harbor water to the west, a distant skyline ring. Buildings are real boxes with authored
// procedural facades (window rhythm, balconies, shop awnings, signs) — never bare cubes.
import * as THREE from 'three';

export const CITY = { half: 180, road: 14, block: 60 };
export const ROADS = [-150, -90, -30, 30, 90, 150];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function facadeTex(base, win, floors, cols, lit) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    const cw = w / cols, ch = h / floors;
    for (let f = 0; f < floors; f++) for (let c2 = 0; c2 < cols; c2++) {
      const x = c2 * cw + cw * 0.22, y = f * ch + ch * 0.24;
      g.fillStyle = Math.random() < lit ? '#ffd98a' : win;
      g.fillRect(x, y, cw * 0.56, ch * 0.52);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(x, y, cw * 0.56, 3);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 10, w, 10);
  });
}
function signTex(text, bg, fg) {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}
function roadTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#453f4a'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 60; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    g.fillStyle = '#e8c33a'; g.fillRect(w / 2 - 2, 0, 4, h);
  });
}

const DISTRICTS = [
  { name: 'Harborfront', x0: -180, z0: -180, x1: -60, z1: 60, hMin: 7, hMax: 15 },
  { name: 'Sunline Blvd', x0: -60, z0: -180, x1: 60, z1: 180, hMin: 22, hMax: 46 },
  { name: 'Old Market', x0: 60, z0: -180, x1: 180, z1: 60, hMin: 11, hMax: 21 },
  { name: 'Crown Heights', x0: -60, z0: 60, x1: 180, z1: 180, hMin: 18, hMax: 34 },
];
const SHOPS = ['TACO SOL', 'BAY MART', 'PALM CAFE', 'NEON NAILS', 'FISH & CO', 'SUNLINE MOTEL', 'CORAL BAR', 'PIER 9', 'LAUNDRY 24', 'SURF SHOP'];

export function districtAt(x, z) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  return 'Cinder Bay';
}

export function createCity(scene, rng) {
  const colliders = [];
  const buildings = [];
  const intersections = [];
  for (const x of ROADS) for (const z of ROADS) intersections.push({ x, z });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  scene.background = new THREE.Color(0xffb36b);
  scene.fog = new THREE.Fog(0xf2a56b, 180, 620);
  const skyGeo = new THREE.SphereGeometry(700, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x7fb4e8) }, mid: { value: new THREE.Color(0xffc07a) }, bot: { value: new THREE.Color(0xff8a5c) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; void main(){ float h=normalize(vP).y; vec3 c=h>0.12?mix(mid,top,smoothstep(0.12,0.65,h)):mix(bot,mid,smoothstep(-0.08,0.12,h)); gl_FragColor=vec4(c,1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  const sun = new THREE.DirectionalLight(0xffd9a0, 3.2);
  sun.position.set(-180, 160, -90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -220; sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220; sun.shadow.camera.bottom = -220;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x4a3a4a, 1.15));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x9a8a7a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true;
  scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 900), new THREE.MeshStandardMaterial({ color: 0x2a7a9e, roughness: 0.25, metalness: 0.35 }));
  water.rotation.x = -Math.PI / 2; water.position.set(-310, 0.1, 0); scene.add(water);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(40, 900), new THREE.MeshStandardMaterial({ color: 0xe8d2a0, roughness: 1 }));
  beach.rotation.x = -Math.PI / 2; beach.position.set(-192, 0.02, 0); beach.receiveShadow = true; scene.add(beach);

  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex(), roughness: 0.95 });
  roadMat.map.wrapS = roadMat.map.wrapT = THREE.RepeatWrapping;
  for (const r of ROADS) {
    for (const vertical of [true, false]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(CITY.half * 2 + 40, CITY.road), roadMat);
      m.rotation.x = -Math.PI / 2;
      if (vertical) { m.rotation.z = Math.PI / 2; m.position.set(r, 0.06, 0); }
      else m.position.set(0, 0.06, r);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  const walkMat = new THREE.MeshStandardMaterial({ color: 0xb8a894, roughness: 1 });
  for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 5; iz++) {
    const cx = ROADS[ix] + 30, cz = ROADS[iz] + 30;
    if (cx < -168) continue;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), walkMat);
    w.rotation.x = -Math.PI / 2; w.position.set(cx, 0.04, cz); w.receiveShadow = true;
    scene.add(w);
  }

  const facades = [];
  const bases = ['#e8dcc8', '#d9c2a3', '#c96f4a', '#8fa3b8', '#a8b8c8', '#9c8a76', '#d9a05b', '#b85c5c', '#6f7d84', '#f0e6d2'];
  for (let i = 0; i < bases.length; i++) facades.push(facadeTex(bases[i], '#2c3a4a', 4 + (i % 5), 4 + (i % 3), 0.28));

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4048, roughness: 1 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x7a6a5a, roughness: 0.9 });
  let shopIdx = 0;
  for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 5; iz++) {
    const cx = ROADS[ix] + 30, cz = ROADS[iz] + 30;
    if (cx < -150) continue;
    const d = DISTRICTS.find(dd => cx >= dd.x0 && cx < dd.x1 && cz >= dd.z0 && cz < dd.z1) || DISTRICTS[1];
    const count = (d.name === 'Sunline Blvd' && rng.chance(0.6)) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const w = count === 2 ? rng.range(16, 20) : rng.range(24, 38);
      const dep = count === 2 ? rng.range(16, 20) : rng.range(24, 38);
      const h = rng.range(d.hMin, d.hMax);
      const bx = count === 2 ? cx + (k === 0 ? -11 : 11) : cx;
      const bz = count === 2 ? cz + (k === 0 ? -11 : 11) : cz;
      const mat = new THREE.MeshStandardMaterial({ map: facades[Math.floor(rng.next() * facades.length)], roughness: 0.85 });
      const b = new THREE.Mesh(boxGeo, mat);
      b.scale.set(w, h, dep);
      b.position.set(bx, h / 2, bz);
      b.castShadow = true; b.receiveShadow = true;
      scene.add(b);
      buildings.push({ x: bx, z: bz, w, d: dep, h, district: d.name });
      colliders.push({ minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - dep / 2, maxZ: bz + dep / 2 });
      const ac = new THREE.Mesh(boxGeo, roofMat);
      ac.scale.set(3, 1.2, 2); ac.position.set(bx + w * 0.2, h + 0.6, bz); scene.add(ac);
      if (rng.chance(0.5)) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3, 10), tankMat);
        tank.position.set(bx - w * 0.25, h + 1.5, bz + dep * 0.2); tank.castShadow = true; scene.add(tank);
      }
      if (h > 20 && rng.chance(0.7)) {
        const balMat = new THREE.MeshStandardMaterial({ color: 0x3a3238, roughness: 1 });
        for (let f = 1; f < 4; f++) {
          const bal = new THREE.Mesh(boxGeo, balMat);
          bal.scale.set(w * 0.7, 0.5, 1.6);
          bal.position.set(bx, h * (f / 4), bz + dep / 2 + 0.8);
          scene.add(bal);
        }
      }
      if (rng.chance(0.55)) {
        const shop = SHOPS[shopIdx++ % SHOPS.length];
        const awnMat = new THREE.MeshStandardMaterial({ color: [0xff5e7a, 0x2fae8a, 0xff9a3c, 0x4a7ad9][shopIdx % 4], roughness: 0.8 });
        const awn = new THREE.Mesh(boxGeo, awnMat);
        awn.scale.set(Math.min(w * 0.6, 14), 0.6, 3.4);
        awn.position.set(bx, 3.4, bz + dep / 2 + 1.4);
        awn.castShadow = true; scene.add(awn);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshStandardMaterial({ map: signTex(shop, '#1c1220', '#ffe9b0'), roughness: 0.7 }));
        sign.position.set(bx, 5.6, bz + dep / 2 + 0.15); scene.add(sign);
      }
    }
  }

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 0.9 });
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.45, 7, 7);
  const frondGeo = new THREE.BoxGeometry(3.4, 0.18, 0.9);
  function palm(x, z) {
    const g = new THREE.Group();
    const t = new THREE.Mesh(trunkGeo, trunkMat); t.position.y = 3.5; t.castShadow = true; g.add(t);
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(frondGeo, frondMat);
      f.position.y = 7; f.rotation.y = (i / 6) * Math.PI * 2; f.rotation.z = 0.5;
      f.translateX(1.4); f.castShadow = true; g.add(f);
    }
    g.position.set(x, 0, z); scene.add(g);
  }
  for (let z = -160; z <= 160; z += 24) { palm(22, z); palm(38, z + 12); }
  for (let z = -140; z <= 40; z += 28) palm(-158, z);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffc860, emissiveIntensity: 1.4 });
  for (const it of intersections) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.5, 6), poleMat);
    pole.position.set(it.x + 8.5, 3.25, it.z + 8.5); pole.castShadow = true; scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lampMat);
    lamp.position.set(it.x + 8.5, 6.6, it.z + 8.5); scene.add(lamp);
  }

  const crateMat = new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 1 });
  const contMat = new THREE.MeshStandardMaterial({ color: 0x3a7a8a, roughness: 0.8 });
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(boxGeo, i % 3 === 0 ? contMat : crateMat);
    const s = i % 3 === 0 ? 6 : 2.4;
    c.scale.set(s, s * 0.7, s);
    c.position.set(-168 + rng.range(-6, 6), s * 0.35, -120 + i * 22);
    c.rotation.y = rng.range(-0.3, 0.3);
    c.castShadow = true; c.receiveShadow = true; scene.add(c);
    colliders.push({ minX: c.position.x - s / 2, maxX: c.position.x + s / 2, minZ: c.position.z - s / 2, maxZ: c.position.z + s / 2 });
  }
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  for (let z = -90; z <= 30; z += 40) {
    const dock = new THREE.Mesh(boxGeo, dockMat);
    dock.scale.set(18, 1, 6); dock.position.set(-196, 0.5, z); dock.receiveShadow = true; scene.add(dock);
  }
  const hull = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.6 }));
  hull.position.set(-214, 0.8, -50); hull.rotation.y = 0.2; scene.add(hull);

  const skyMat2 = new THREE.MeshStandardMaterial({ color: 0x6a4a5a, roughness: 1 });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const r = 330 + rng.range(0, 90);
    const h = rng.range(30, 110);
    const s = new THREE.Mesh(boxGeo, skyMat2);
    s.scale.set(rng.range(18, 34), h, rng.range(18, 34));
    s.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(s);
  }

  const lights = intersections.filter(it => Math.abs(it.x) <= 90 && Math.abs(it.z) <= 90)
    .map(it => ({ x: it.x, z: it.z, phase: rng.range(0, 8) }));

  return {
    colliders, buildings, intersections, lights,
    spawns: {
      player: { x: 30, z: -120 },
      depot: { x: 30, z: -138 },
      hotel: { x: 52, z: -30 },
      warehouse: { x: -140, z: -60 },
      safehouse: { x: 120, z: 120 },
      marina: { x: -185, z: -50 },
      market: { x: 120, z: -30 },
    },
    update(dt, t) {
      water.position.y = 0.1 + Math.sin(t * 0.5) * 0.05;
      for (const l of lights) l.phase = (l.phase + dt) % 16;
    },
    lightIsRed(x, z) {
      const l = lights.find(v => Math.abs(v.x - x) < 1 && Math.abs(v.z - z) < 1);
      if (!l) return false;
      return l.phase < 8;
    },
  };
}
export function nearestIntersection(city, x, z) {
  let best = city.intersections[0], bd = Infinity;
  for (const it of city.intersections) {
    const d = (it.x - x) * (it.x - x) + (it.z - z) * (it.z - z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
