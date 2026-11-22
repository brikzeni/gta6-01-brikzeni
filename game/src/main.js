// Sundown District — boot, loop, camera, combat, driving, save and screenshot staging.
// Fixed-step simulation (1/60 s) separate from rendering; every system is wired here.
import * as THREE from 'three';
import { createRandom, clamp } from './rng.js';
import { createCity, districtAt } from './world.js';
import { createSoundManager } from './audio.js';
import { createVehicleMesh, createTraffic, Vehicle, VEHICLE_TYPES } from './vehicles.js';
import { PlayerController, createPedestrians } from './characters.js';
import { WantedSystem, createPolice } from './police.js';
import { createMissionManager, MISSIONS } from './missions.js';
import { createHUD } from './hud.js';
import { moveCircle, rayVsBoxes } from './physics.js';

const SAVE_KEY = 'sundown-district-save-v1';
const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;
window.__gameError = null;
window.addEventListener('error', (e) => { window.__gameError = String(e.message || e.error); });

const rng = createRandom(seed);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
const city = createCity(scene, rng);
const sound = createSoundManager();
const hud = createHUD(city);
const wanted = new WantedSystem();

// --- Actors ---------------------------------------------------------------
const player = new PlayerController(scene, city.spawns.player);
const traffic = createTraffic(scene, city, rng, 10);
const peds = createPedestrians(scene, city, rng, 16);
const police = createPolice(scene, city, rng);
const parked = [];
{
  const spots = [
    ['sedan', 22, -100, 0], ['hatch', 38, -60, Math.PI], ['coupe', 22, 10, 0], ['suv', 38, 60, Math.PI],
    ['van', -82, 30, Math.PI / 2], ['sedan', 98, -82, -Math.PI / 2], ['hatch', -22, 98, 0], ['coupe', 158, 38, Math.PI],
  ];
  for (const [type, x, z, h] of spots) parked.push(new Vehicle(scene, type, x, z, h));
}
const allCars = [...parked, ...traffic.cars];

// --- State ----------------------------------------------------------------
const state = {
  screen: 'title', money: 120, ammo: 12, reserve: Infinity, reloading: 0,
  vehicle: null, camYaw: Math.PI, camPitch: 0.32, camDist: 8,
  elapsed: 0, fps: 0, fpsCount: 0, fpsTime: 0, dead: false,
  missionFailed: false, interactCount: 0, firePressed: false,
};
window.__gameState = state;
window.__sundown = {
  playerObj: player,
  get player() { return { x: player.x, z: player.z, health: player.health }; },
  get vehicle() { return state.vehicle ? { type: state.vehicle.typeKey, speed: state.vehicle.speed } : null; },
  get wanted() { return { level: wanted.level, heat: wanted.heat }; },
  get counts() { return { traffic: traffic.cars.length, peds: peds.peds.filter(p => !p.dead).length, policeCars: police.cars.length, cops: police.cops.length, parked: parked.length }; },
  get mission() { return { index: missions.index, active: missions.active, step: missions.step, done: missions.done }; },
  state, wanted,
  get missions() { return missions; },
};

function saveGame() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money, health: player.health, ammo: state.ammo,
      missionsDone: missions.done, missionIndex: missions.index,
      x: player.x, z: player.z,
    }));
    return true;
  } catch { return false; }
}
function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// --- Missions -------------------------------------------------------------
let missions;
missions = createMissionManager(scene, city.spawns, {
  onDialogue: (lines) => hud.showDialogue(lines),
  onObjective: (name, text) => hud.setObjective(name, text),
  onToast: (t) => hud.showToast(t),
  onPrompt: () => {},
  onPickup: () => sound.pickup(),
  onTimer: (left) => { hud.setObjective(MISSIONS[missions.index].name, MISSIONS[missions.index].steps[missions.step].text + ' — ' + left + 's left'); },
  onFail: (msg) => { hud.showToast(msg, 5000); sound.fail(); state.missionFailed = true; },
  onComplete: (m, reward, line) => {
    state.money += reward;
    hud.setMoney(state.money);
    hud.showToast(m.name + ' complete — +$' + reward, 4500);
    hud.showDialogue([line]);
    sound.mission();
    saveGame();
    if (missions.index < MISSIONS.length - 1) {
      setTimeout(() => { if (state.screen === 'play') missions.startNext(); }, 4000);
    } else {
      hud.setObjective('Chapter complete', 'All three missions done. Free roam — Cinder Bay is yours.');
    }
  },
});

// --- Input ----------------------------------------------------------------
const input = { keys: {}, mouseDown: false, jumpPressed: false, dragging: false, lastX: 0, lastY: 0 };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { input.jumpPressed = true; e.preventDefault(); }
  input.keys[e.code] = true;
  if (e.code === 'KeyE') state.interactCount += 1; // a count, not a flag: rapid presses are queued, never lost
  if (e.code === 'KeyF') tryEnterExitCar();
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyM') retryMission();
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'Enter' && state.screen === 'title') startGame(false);
  sound.unlock();
});
window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
renderer.domElement.addEventListener('mousedown', (e) => {
  input.mouseDown = true; state.firePressed = true;
  input.dragging = true; input.lastX = e.clientX; input.lastY = e.clientY;
  sound.unlock();
  if (state.screen === 'play' && document.pointerLockElement !== renderer.domElement) {
    try { renderer.domElement.requestPointerLock(); } catch { /* drag fallback */ }
  }
});
window.addEventListener('mouseup', () => { input.mouseDown = false; input.dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    state.camYaw -= (e.movementX || 0) * 0.0028;
    state.camPitch = clamp(state.camPitch + (e.movementY || 0) * 0.0022, -0.15, 0.9);
  } else if (input.dragging && state.screen === 'play') {
    state.camYaw -= (e.clientX - input.lastX) * 0.005;
    state.camPitch = clamp(state.camPitch + (e.clientY - input.lastY) * 0.004, -0.15, 0.9);
    input.lastX = e.clientX; input.lastY = e.clientY;
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.getElementById('play').addEventListener('click', () => startGame(false));
document.getElementById('freeroam').addEventListener('click', () => startGame(true));
document.getElementById('continueBtn').addEventListener('click', () => startGame(false, true));
document.getElementById('resume').addEventListener('click', togglePause);
document.getElementById('saveBtn').addEventListener('click', () => { saveGame(); hud.showToast('Game saved.'); });
document.getElementById('quitBtn').addEventListener('click', () => {
  saveGame();
  document.getElementById('pause').hidden = true;
  state.screen = 'title';
  document.getElementById('overlay').hidden = false;
});
const saved = loadSave();
if (saved) document.getElementById('continueBtn').hidden = false;

function startGame(freeRoam, useSave) {
  document.getElementById('overlay').hidden = true;
  document.getElementById('pause').hidden = true;
  state.screen = 'play';
  sound.unlock();
  if (useSave && saved) {
    state.money = saved.money || 120;
    player.health = saved.health || 100;
    state.ammo = saved.ammo ?? 12;
    missions.loadState(saved.missionsDone || [false, false, false], saved.missionIndex || 0);
    player.x = saved.x ?? city.spawns.player.x;
    player.z = saved.z ?? city.spawns.player.z;
    player.mesh.position.set(player.x, 0, player.z);
    hud.setMoney(state.money);
    hud.setObjective('Sundown District', 'Save loaded — ' + districtAt(player.x, player.z) + '. Press M for missions.');
  } else if (freeRoam) {
    hud.setObjective('Free roam', 'Explore Cinder Bay. Steal a car with F, press M to start the story.');
    hud.showToast('Free roam — the city is yours. Press M to start Mission 1.');
  } else {
    missions.start(0);
  }
  hud.announce('Playing Sundown District.');
}
function togglePause() {
  if (state.screen === 'play') {
    state.screen = 'paused';
    document.getElementById('pauseStats').textContent =
      'Money $' + Math.floor(state.money) + ' · Health ' + Math.round(player.health) +
      ' · Missions done ' + missions.done.filter(Boolean).length + ' / 3 · ' + districtAt(player.x, player.z);
    document.getElementById('pause').hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (state.screen === 'paused') {
    state.screen = 'play';
    document.getElementById('pause').hidden = true;
  }
}
function retryMission() {
  if (state.screen !== 'play') return;
  const next = missions.done.findIndex(d => !d);
  if (next === -1) { hud.showToast('All missions complete. Free roam!'); return; }
  missions.start(next);
  hud.showToast(MISSIONS[next].name + ' restarted.');
}
function startReload() {
  if (state.screen !== 'play' || state.vehicle || state.reloading > 0 || state.ammo >= 12) return;
  state.reloading = 0.8;
  sound.reload();
}
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const v of allCars) {
    if (v.occupied) continue;
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}
function tryEnterExitCar() {
  if (state.screen !== 'play') return;
  if (state.vehicle) {
    const v = state.vehicle;
    v.occupied = false;
    state.vehicle = null;
    player.x = v.x + Math.sin(v.heading + Math.PI / 2) * 2.4;
    player.z = v.z + Math.cos(v.heading + Math.PI / 2) * 2.4;
    player.mesh.visible = true;
    player.mesh.position.set(player.x, 0, player.z);
    sound.step();
    return;
  }
  const v = nearestCar(4.2);
  if (!v) return;
  state.vehicle = v;
  v.occupied = true;
  player.mesh.visible = false;
  if (!v.stolen) {
    v.stolen = true;
    wanted.add(35, 'stolen car');
    hud.showToast('Car stolen — the heat is on. Lose the cops or lay low.', 3800);
    sound.siren(true);
  }
  state.camYaw = v.heading;
  state.camPitch = 0.28;
}

// --- Combat ---------------------------------------------------------------
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
let tracer = null, tracerTimer = 0;
function fireWeapon() {
  if (state.reloading > 0) return;
  if (state.ammo <= 0) { startReload(); return; }
  state.ammo -= 1;
  sound.gunshot();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  const wallD = rayVsBoxes(ox, oz, dir.x, dir.z, 60, city.colliders);
  let hitD = wallD > 0 ? wallD : 60;
  let hitWhat = null;
  const aimX = dir.x, aimZ = dir.z;
  const targets = [];
  for (const p of peds.peds) if (!p.dead) targets.push({ x: p.x, z: p.z, kind: 'ped', ref: p, y: 1.2 });
  for (const c of police.cops) targets.push({ x: c.x, z: c.z, kind: 'cop', ref: c, y: 1.2 });
  for (const v of police.cars) targets.push({ x: v.x, z: v.z, kind: 'policecar', ref: v, y: 1.0 });
  for (const t of targets) {
    const dx = t.x - player.x, dz = t.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > 55 || d < 0.5) continue;
    const dot = (dx * aimX + dz * aimZ) / d;
    if (dot < 0.985) continue;
    const perp = Math.abs(-dz * aimX + dx * aimZ) / d;
    if (perp > 0.09) continue;
    if (d < hitD) { hitD = d; hitWhat = t; }
  }
  const end = new THREE.Vector3(ox + dir.x * hitD, oy + dir.y * hitD, oz + dir.z * hitD);
  if (tracer) scene.remove(tracer);
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(player.x, 1.35, player.z), end]);
  tracer = new THREE.Line(geo, tracerMat);
  scene.add(tracer);
  tracerTimer = 0.09;
  if (hitWhat) {
    sound.hit();
    if (hitWhat.kind === 'ped') {
      hitWhat.ref.health -= 34;
      hitWhat.ref.panic = 5;
      wanted.add(40, 'attacked a civilian');
      if (hitWhat.ref.health <= 0) {
        hitWhat.ref.dead = true;
        hitWhat.ref.mesh.visible = false;
        wanted.add(30, 'civilian down');
      }
    } else if (hitWhat.kind === 'cop') {
      hitWhat.ref.health -= 34;
      wanted.add(45, 'attacked police');
      if (hitWhat.ref.health <= 0) {
        scene.remove(hitWhat.ref.mesh);
        police.cops.splice(police.cops.indexOf(hitWhat.ref), 1);
      }
    } else if (hitWhat.kind === 'policecar') {
      hitWhat.ref.health -= 20;
      wanted.add(30, 'shot at police');
      if (hitWhat.ref.health <= 0) {
        scene.remove(hitWhat.ref.mesh);
        police.cars.splice(police.cars.indexOf(hitWhat.ref), 1);
      }
    }
  }
}

// --- Camera ---------------------------------------------------------------
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  let tx, tz, ty, dist;
  if (state.vehicle) {
    const v = state.vehicle;
    tx = v.x; tz = v.z; ty = 1.4;
    dist = state.camDistOverride || 10.5;
  } else {
    tx = player.x; tz = player.z; ty = 1.6;
    dist = state.camDistOverride || 7.5;
  }
  const px = tx - Math.sin(state.camYaw) * Math.cos(state.camPitch) * dist;
  const pz = tz - Math.cos(state.camYaw) * Math.cos(state.camPitch) * dist;
  const py = ty + Math.sin(state.camPitch) * dist + 1.2;
  // Keep the camera out of buildings: shorten the boom on a wall hit.
  const d = rayVsBoxes(tx, tz, px - tx, pz - tz, 1, city.colliders);
  let fx = px, fz = pz, fy = py;
  if (d >= 0 && d < 1) {
    fx = tx + (px - tx) * d * 0.9;
    fz = tz + (pz - tz) * d * 0.9;
    fy = Math.max(ty + 1.0, py * 0.7);
  }
  camera.position.lerp(new THREE.Vector3(fx, fy, fz), Math.min(1, dt * 10));
  camTarget.set(tx, ty, tz);
  camera.lookAt(camTarget);
}

// --- Simulation step ------------------------------------------------------
let stepCount = 0;
function step(dt) {
  state.elapsed += dt;
  stepCount += 1;
  city.update(dt, state.elapsed);
  const inCar = !!state.vehicle;
  if (state.screen === 'play') {
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) { state.ammo = 12; hud.setAmmo(12); }
    }
    if (inCar) {
      const v = state.vehicle;
      player.x = v.x; player.z = v.z;
      const throttle = state.shotDrive ? 1 : (input.keys['KeyW'] ? 1 : 0) + (input.keys['KeyS'] ? -1 : 0);
      const steer = state.shotDrive ? 0 : (input.keys['KeyA'] ? 1 : 0) + (input.keys['KeyD'] ? -1 : 0);
      const hb = !!(input.keys['Space']);
      const res = v.drive(dt, throttle, steer, hb, city.colliders);
      if (res.hit && Math.abs(v.speed) > 8) { sound.crash(Math.abs(v.speed) / 30); wanted.add(6, 'crashed'); }
      // Bumping a pedestrian while driving.
      for (const p of peds.peds) {
        if (p.dead) continue;
        if (Math.hypot(p.x - v.x, p.z - v.z) < 1.6) {
          p.dead = true; p.mesh.visible = false;
          wanted.add(40, 'hit a pedestrian');
        }
      }
    } else {
      player.aiming = input.mouseDown;
      player.update(dt, input, state.camYaw, city.colliders, () => sound.step());
      if (state.firePressed) { fireWeapon(); state.firePressed = false; }
    }
    input.jumpPressed = false;
    // Traffic, pedestrians, police.
    traffic.update(dt, city, { x: player.x, z: player.z }, wanted.level > 0);
    peds.update(dt, city, state.ammo < 12 || input.mouseDown ? { x: player.x, z: player.z } : null);
    const seen = police.update(dt, wanted, player, inCar, (dmg) => {
      player.health -= dmg;
      if (player.health <= 0) die();
    });
    wanted.update(dt, seen);
    sound.siren(wanted.level >= 2);
    sound.update(dt, inCar ? Math.abs(state.vehicle.speed) / 36 : 0, inCar);
    // Mission logic + prompts.
    const interact = state.interactCount > 0;
    if (interact) state.interactCount -= 1;
    if (hud.dialogueShowing) {
      if (interact) hud.advanceDialogue();
    } else {
      const mres = missions.update(dt, player.x, player.z, interact);
      if (mres === 'fail') { /* mission manager already toasted */ }
    }
    // Car prompt.
    if (!inCar) {
      const near = nearestCar(4.2);
      if (near && !hud.dialogueShowing) hud.setPrompt('Press <b>F</b> — steal the ' + near.type.name);
      else if (!missions.active) hud.setPrompt('');
      else hud.setPrompt('');
    } else {
      hud.setPrompt('Press <b>F</b> to exit &middot; <b>Space</b> handbrake');
    }
    // Health regen when clear.
    if (wanted.level === 0 && player.health < 100) player.health = Math.min(100, player.health + dt * 3);
    // HUD.
    hud.setMoney(state.money);
    hud.setHealth(player.health, state.ammo);
    hud.setWanted(wanted.level, wanted.heat);
    hud.setDriving(inCar, inCar ? Math.abs(state.vehicle.speed) * 2.237 : 0, inCar ? state.vehicle.type.name : '');
    hud.setCrosshair(!inCar && (player.aiming || input.mouseDown));
    hud.setAmmo(state.ammo);
    const mp = missions.active ? missions.stepPos() : null;
    hud.updateMinimap(player.x, player.z, state.vehicle ? state.vehicle.heading : player.heading, mp, police.cars, traffic.cars);
    if (tracerTimer > 0) { tracerTimer -= dt; if (tracerTimer <= 0 && tracer) { scene.remove(tracer); tracer = null; } }
  } else {
    // Title / pause attract mode: the city still lives.
    traffic.update(dt, city, null, false);
    peds.update(dt, city, null);
    city.update(dt, state.elapsed);
  }
  if (state.screen !== 'title') updateCamera(dt);
}
function die() {
  player.health = 100;
  state.money = Math.max(0, state.money - 50);
  wanted.clear();
  if (state.vehicle) { state.vehicle.occupied = false; state.vehicle = null; player.mesh.visible = true; }
  player.x = city.spawns.player.x; player.z = city.spawns.player.z; player.y = 0;
  player.mesh.position.set(player.x, 0, player.z);
  hud.showToast('You were taken down — woke up at the depot clinic, -$50. The story continues.', 5000);
  sound.fail();
  if (missions.active) missions.fail();
}

// --- Shot staging ---------------------------------------------------------
function stageShot(name) {
  state.screen = 'play';
  document.getElementById('overlay').hidden = true;
  const S = city.spawns;
  if (name === 'chase') {
    // Eastbound on the z=30 avenue, sun behind the camera: lit facades, police behind.
    const v = new Vehicle(scene, 'coupe', -40, 30, Math.PI / 2);
    v.occupied = true; v.stolen = true; state.vehicle = v;
    player.mesh.visible = false;
    player.x = -40; player.z = 30;
    v.speed = 20;
    state.shotDrive = true;
    state.camDistOverride = 9;
    wanted.level = 3; wanted.heat = 40;
    missions.start(2);
    police.update(0.1, wanted, player, true, null);
    for (const c of police.cars) { c.x = -58 - Math.random() * 10; c.z = 30; c.heading = Math.PI / 2; c.speed = 20; c.mesh.position.set(c.x, 0, c.z); }
    state.camYaw = Math.PI / 2; state.camPitch = 0.22;
    hud.setObjective('Mission 3 — Sundown Escape', 'Reach the marina extraction point — 150s left');
  } else if (name === 'foot') {
    player.x = 120; player.z = -30; player.heading = Math.PI / 2;
    player.mesh.position.set(player.x, 0, player.z);
    missions.start(0);
    state.camYaw = Math.PI / 2; state.camPitch = 0.3;
    state.camDistOverride = 7.5;
  } else if (name === 'mission') {
    // On the harbor road facing the warehouse, beacon ring in frame.
    player.x = -152; player.z = -60; player.heading = Math.PI / 2;
    player.mesh.position.set(player.x, 0, player.z);
    missions.start(1);
    missions.update(0, player.x, player.z, false);
    wanted.level = 2; wanted.heat = 55;
    for (let i = 0; i < 2; i++) police.update(0.1, wanted, player, false, null);
    state.camYaw = Math.PI / 2; state.camPitch = 0.3;
    state.camDistOverride = 6.5;
    hud.setObjective('Mission 2 — Evidence Run', 'Grab the ledger from the crate');
  } else { // harbor
    // On the dock road facing west: water, docks and the moored boat ahead.
    const v = new Vehicle(scene, 'van', -168, -40, -Math.PI / 2);
    v.occupied = true; v.stolen = true; state.vehicle = v;
    player.mesh.visible = false;
    player.x = -168; player.z = -40;
    state.camYaw = -Math.PI / 2; state.camPitch = 0.3;
    state.camDistOverride = 11;
    missions.loadState([true, true, true], 2);
    state.money = 1150;
    hud.setObjective('Chapter complete', 'All three missions done — $1,150 banked. Free roam.');
    hud.showToast('Mission 3 complete — +$500', 5000);
  }
  hud.setMoney(state.money);
  hud.setHealth(player.health, state.ammo);
  hud.setWanted(wanted.level, wanted.heat);
  // Close any opening dialogue so the frame shows the world, not a text box.
  while (hud.dialogueShowing) hud.advanceDialogue();
  hud.els.toast.style.display = 'none';
  // Run the living city forward so traffic, peds and police are mid-scene, then settle.
  for (let i = 0; i < 150; i++) step(STEP);
  if (name === 'chase') state.camDistOverride = 13;
  updateCamera(1);
  renderer.render(scene, camera);
  setTimeout(() => {
    for (let i = 0; i < 30; i++) step(STEP);
    if (name === 'chase' && state.vehicle) {
      // Frame the pursuit AFTER the last step: cruisers close behind the coupe,
      // ahead of the camera, so the settle steps cannot drop them out of frame.
      const v = state.vehicle;
      police.cars.forEach((c, i) => {
        c.x = v.x - 6 - i * 3; c.z = 30 + (i === 0 ? -3.5 : 3.5);
        c.heading = Math.PI / 2; c.speed = v.speed;
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.heading;
      });
    }
    updateCamera(1);
    renderer.render(scene, camera);
    window.__shotReady = true;
  }, 700);
}

// --- Main loop ------------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  state.fpsCount += 1; state.fpsTime += dt;
  if (state.fpsTime >= 1) { state.fps = state.fpsCount; state.fpsCount = 0; state.fpsTime = 0; }
  if (!shot) {
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
    renderer.render(scene, camera);
  }
}
if (shot) {
  // Title orbit behind the overlay is skipped in shot mode; stage directly.
  stageShot(shot);
} else {
  // Attract camera: slow orbit over Sunline Blvd behind the title screen.
  const orbit = () => {
    if (state.screen === 'title') {
      const t = performance.now() * 0.00006;
      camera.position.set(Math.sin(t) * 120, 55, Math.cos(t) * 120);
      camera.lookAt(30, 8, 0);
      requestAnimationFrame(orbit);
    }
  };
  orbit();
  requestAnimationFrame(frame);
}
