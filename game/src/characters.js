// People: the player (Rae) and pedestrians. Characters are articulated low-poly figures
// built from boxes/capsules with a procedural walk cycle — limbs swing, torso bobs, no T-pose.
import * as THREE from 'three';
import { clamp, angleLerp } from './rng.js';
import { moveCircle } from './physics.js';
import { nearestIntersection, ROADS } from './world.js';

const SKINS = [0xc98a6a, 0x8a5a3a, 0xe8b88a, 0x6a4a3a];
const SHIRTS = [0xff5e7a, 0x2fae8a, 0xff9a3c, 0x4a7ad9, 0xe8e2d2, 0x9a5ad9];
const PANTS = [0x2c3a4a, 0x3a2c2c, 0x4a4a4a, 0x2a4a3a];

export function createHumanMesh(opts) {
  const o = opts || {};
  const skin = o.skin ?? SKINS[Math.floor(Math.random() * SKINS.length)];
  const shirt = o.shirt ?? SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
  const pants = o.pants ?? PANTS[Math.floor(Math.random() * PANTS.length)];
  const g = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: o.hair ?? 0x1c1218, roughness: 1 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirtMat);
  torso.position.y = 1.12; torso.castShadow = true; g.add(torso);
  if (o.jacket) {
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.5, 0.38), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }));
    jacket.position.y = 1.2; g.add(jacket);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skinMat);
  head.position.y = 1.66; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, 1.4), hairMat);
  hair.position.y = 1.7; g.add(hair);
  if (o.cap) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.8 }));
    cap.position.y = 1.84; g.add(cap);
  }
  const armL = new THREE.Group(); armL.position.set(-0.38, 1.42, 0);
  const armR = new THREE.Group(); armR.position.set(0.38, 1.42, 0);
  for (const arm of [armL, armR]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.16), shirtMat);
    m.position.y = -0.31; m.castShadow = true; arm.add(m);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), skinMat);
    hand.position.y = -0.66; arm.add(hand);
    g.add(arm);
  }
  const legL = new THREE.Group(); legL.position.set(-0.16, 0.76, 0);
  const legR = new THREE.Group(); legR.position.set(0.16, 0.76, 0);
  for (const leg of [legL, legR]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.2), pantsMat);
    m.position.y = -0.36; m.castShadow = true; leg.add(m);
    g.add(leg);
  }
  g.userData.limbs = { armL, armR, legL, legR, torso, head };
  // A small pistol in the right hand when armed.
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.34), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 }));
  barrel.position.z = 0.2; gun.add(barrel);
  gun.position.set(0, -0.66, 0.08);
  gun.visible = false;
  armR.add(gun);
  g.userData.gun = gun;
  return g;
}

export function animateWalk(mesh, phase, speedNorm, aiming) {
  const L = mesh.userData.limbs;
  const swing = Math.sin(phase) * 0.75 * speedNorm;
  L.legL.rotation.x = swing;
  L.legR.rotation.x = -swing;
  L.armL.rotation.x = aiming ? -1.2 : -swing * 0.8;
  L.armR.rotation.x = aiming ? -1.2 : swing * 0.8;
  L.torso.position.y = 1.12 + Math.abs(Math.sin(phase)) * 0.05 * speedNorm;
  L.torso.rotation.x = aiming ? 0.08 : speedNorm * 0.12;
}

export class PlayerController {
  constructor(scene, spawn) {
    this.mesh = createHumanMesh({ shirt: 0xff9a3c, jacket: true, cap: true, hair: 0x2a1a12 });
    this.mesh.position.set(spawn.x, 0, spawn.z);
    scene.add(this.mesh);
    this.x = spawn.x; this.z = spawn.z; this.y = 0;
    this.vy = 0; this.heading = Math.PI; this.walkPhase = 0;
    this.health = 100; this.speed = 0; this.grounded = true;
    this.aiming = false;
  }
  update(dt, input, camYaw, colliders, onStep) {
    const sprint = input.keys['ShiftLeft'] || input.keys['ShiftRight'];
    const maxSpeed = sprint ? 8.5 : 4.6;
    let fx = 0, fz = 0;
    if (input.keys['KeyW']) fz -= 1;
    if (input.keys['KeyS']) fz += 1;
    if (input.keys['KeyA']) fx -= 1;
    if (input.keys['KeyD']) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    // Movement is camera-relative.
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = (fx * cos - fz * sin) * maxSpeed;
    const wz = (fx * sin + fz * cos) * maxSpeed;
    const targetSpeed = (fx || fz) ? maxSpeed : 0;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 10);
    const r = moveCircle(this.x, this.z, wx * dt * (this.speed / maxSpeed || 0) + (wx * 0 + 0), wz * dt * (this.speed / maxSpeed || 0), 0.45, colliders);
    // Note: moveCircle above uses the speed-scaled step; recompute cleanly when idle.
    this.x = r.x; this.z = r.z;
    if (this.speed > 0.4) {
      const want = Math.atan2(wx, wz);
      this.heading = angleLerp(this.heading, want, Math.min(1, dt * 10));
      this.walkPhase += dt * this.speed * 1.9;
      if (onStep && Math.sin(this.walkPhase) > 0.96) onStep();
    }
    if (input.jumpPressed && this.grounded) {
      this.vy = 7.2; this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.grounded = true; }
    }
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
    animateWalk(this.mesh, this.walkPhase, clamp(this.speed / 8.5, 0, 1), this.aiming);
    this.mesh.userData.gun.visible = this.aiming || input.mouseDown;
  }
}

export function createPedestrians(scene, city, rng, count) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const mesh = createHumanMesh({});
    const it = city.intersections[Math.floor(rng.next() * city.intersections.length)];
    const x = it.x + rng.range(-8, 8), z = it.z + rng.range(-8, 8);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    peds.push({
      mesh, x, z, heading: rng.range(0, Math.PI * 2), speed: rng.range(1.0, 1.8),
      target: nearestIntersection(city, x, z), phase: rng.range(0, 6), panic: 0, health: 100, dead: false,
    });
  }
  return {
    peds,
    update(dt, city, danger) {
      for (const p of peds) {
        if (p.dead) continue;
        if (danger) {
          const d2 = (danger.x - p.x) * (danger.x - p.x) + (danger.z - p.z) * (danger.z - p.z);
          if (d2 < 900) p.panic = 4;
        }
        let speed = p.speed;
        if (p.panic > 0) { p.panic -= dt; speed = 5.2; }
        const dx = p.target.x - p.x, dz = p.target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 3) {
          const opts = city.intersections.filter(it => it.x === p.target.x || it.z === p.target.z);
          p.target = opts[Math.floor(Math.random() * opts.length)];
          continue;
        }
        let tx = dx / d, tz = dz / d;
        if (p.panic > 0 && danger) {
          // Flee directly away from the danger, along the street grid.
          tx = (p.x - danger.x) / (Math.hypot(p.x - danger.x, p.z - danger.z) || 1);
          tz = (p.z - danger.z) / (Math.hypot(p.x - danger.x, p.z - danger.z) || 1);
        }
        const want = Math.atan2(tx, tz);
        p.heading = angleLerp(p.heading, want, Math.min(1, dt * 4));
        const r = moveCircle(p.x, p.z, Math.sin(p.heading) * speed * dt, Math.cos(p.heading) * speed * dt, 0.4, city.colliders);
        p.x = r.x; p.z = r.z;
        p.phase += dt * speed * 2.2;
        p.mesh.position.set(p.x, 0, p.z);
        p.mesh.rotation.y = p.heading;
        animateWalk(p.mesh, p.phase, clamp(speed / 5.2, 0.2, 1), false);
      }
    },
  };
}
