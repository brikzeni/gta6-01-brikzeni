// Vehicles: six original types with distinct geometry and handling, plus the traffic
// system that drives them along the road graph, stops at red lights and keeps spacing.
import * as THREE from 'three';
import { clamp, angleLerp } from './rng.js';
import { moveCircle } from './physics.js';
import { nearestIntersection, ROADS } from './world.js';

export const VEHICLE_TYPES = {
  hatch: { name: 'Pipit Hatch', color: 0xffc93c, accel: 16, maxSpeed: 26, turn: 2.4, len: 3.6, wid: 1.7, h: 1.15 },
  coupe: { name: 'Vela Coupe', color: 0xff4a6a, accel: 22, maxSpeed: 36, turn: 2.1, len: 4.2, wid: 1.8, h: 1.0 },
  sedan: { name: 'Coral Sedan', color: 0x4a7ad9, accel: 18, maxSpeed: 30, turn: 2.2, len: 4.4, wid: 1.85, h: 1.2 },
  van: { name: 'Bay Van', color: 0xe8e2d2, accel: 13, maxSpeed: 24, turn: 1.9, len: 4.8, wid: 2.0, h: 1.9 },
  suv: { name: 'Crown SUV', color: 0x2c2c34, accel: 17, maxSpeed: 29, turn: 2.0, len: 4.6, wid: 2.0, h: 1.6 },
  police: { name: 'CBPD Cruiser', color: 0x1a1a22, accel: 21, maxSpeed: 34, turn: 2.5, len: 4.5, wid: 1.9, h: 1.25 },
};

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.15, metalness: 0.6 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.6 });
const brakeMat = new THREE.MeshStandardMaterial({ color: 0xaa1020, emissive: 0x660000, emissiveIntensity: 0.4 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.8 });

export function createVehicleMesh(typeKey, opts) {
  const t = VEHICLE_TYPES[typeKey];
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.35, metalness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(t.wid, t.h * 0.62, t.len), paint);
  body.position.y = 0.55 + t.h * 0.31; body.castShadow = true; g.add(body);
  const cabinH = t.h * 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.86, cabinH, t.len * (typeKey === 'van' ? 0.9 : 0.52)), glassMat);
  cabin.position.set(0, 0.55 + t.h * 0.62 + cabinH / 2 - 0.08, typeKey === 'van' ? 0 : -t.len * 0.06);
  cabin.castShadow = true; g.add(cabin);
  if (typeKey === 'van') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.94, t.h * 0.9, t.len * 0.55), paint);
    box.position.set(0, 0.55 + t.h * 0.45, -t.len * 0.2); box.castShadow = true; g.add(box);
  }
  // Spoiler on the coupe, roof rack on the SUV, light bar on police.
  if (typeKey === 'coupe') {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.9, 0.08, 0.5), chromeMat);
    sp.position.set(0, 1.28, -t.len / 2 + 0.3); g.add(sp);
  }
  if (typeKey === 'suv') {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.7, 0.08, t.len * 0.5), chromeMat);
    rack.position.set(0, 1.78, 0); g.add(rack);
  }
  if (typeKey === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0x2244aa, emissive: 0x2244ff, emissiveIntensity: 1.2 }));
    bar.position.set(0, 1.62, 0); g.add(bar);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.02, 0.22, t.len * 0.8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    stripe.position.y = 0.95; g.add(stripe);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.7, 0.16, 0.1), lightMat);
  head.position.set(0, 0.85, t.len / 2 + 0.02); g.add(head);
  const brake = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.7, 0.16, 0.1), brakeMat.clone());
  brake.position.set(0, 0.85, -t.len / 2 - 0.02); g.add(brake);
  g.userData.brakeMat = brake.material;
  const wheels = [];
  for (const [wx, wz] of [[-t.wid / 2, t.len * 0.32], [t.wid / 2, t.len * 0.32], [-t.wid / 2, -t.len * 0.32], [t.wid / 2, -t.len * 0.32]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.36, wz); w.castShadow = true;
    g.add(w); wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.type = t;
  if (opts && opts.police) {
    const beacon = new THREE.PointLight(0x4466ff, 0, 30);
    beacon.position.y = 2.2; g.add(beacon);
    g.userData.beacon = beacon;
  }
  return g;
}

export class Vehicle {
  constructor(scene, typeKey, x, z, heading, opts) {
    this.typeKey = typeKey;
    this.type = VEHICLE_TYPES[typeKey];
    this.mesh = createVehicleMesh(typeKey, opts);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.steer = 0; this.health = 100;
    this.occupied = false; this.police = !!(opts && opts.police);
    this.stolen = false;
  }
  // Arcade kinematic drive: throttle, brake/reverse, steering that scales with speed.
  drive(dt, throttle, steerInput, handbrake, colliders) {
    const t = this.type;
    if (throttle > 0) this.speed += t.accel * throttle * dt;
    else if (throttle < 0) this.speed += (this.speed > 0.5 ? -26 : -10) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 8 * dt);
    if (handbrake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 30 * dt);
    this.speed = clamp(this.speed, -9, t.maxSpeed);
    const steerTarget = steerInput * t.turn * clamp(Math.abs(this.speed) / 8, 0, 1);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 6);
    this.heading += this.steer * dt * Math.sign(this.speed || 1) * (this.speed < 0 ? -1 : 1) * 0.9;
    const dx = Math.sin(this.heading) * this.speed * dt;
    const dz = Math.cos(this.heading) * this.speed * dt;
    const before = { x: this.x, z: this.z };
    const r = moveCircle(this.x, this.z, dx, dz, t.len * 0.42, colliders);
    const hit = Math.abs(r.x - (this.x + dx)) > 0.05 || Math.abs(r.z - (this.z + dz)) > 0.05;
    this.x = r.x; this.z = r.z;
    if (hit) { this.speed *= 0.45; this.health -= 2; }
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.z = -this.steer * 0.06 * Math.sign(this.speed || 1);
    for (const w of this.mesh.userData.wheels) w.rotation.x += this.speed * dt * 2.4;
    const braking = throttle < 0 || handbrake;
    this.mesh.userData.brakeMat.emissiveIntensity = braking ? 2.4 : 0.4;
    return { hit, moved: Math.hypot(this.x - before.x, this.z - before.z) };
  }
}

export function createTraffic(scene, city, rng, count) {
  const cars = [];
  const keys = ['hatch', 'sedan', 'van', 'suv', 'coupe'];
  for (let i = 0; i < count; i++) {
    const road = rng.pick(ROADS);
    const along = rng.range(-170, 170);
    const vertical = rng.chance(0.5);
    const x = vertical ? road + (rng.chance(0.5) ? 3.5 : -3.5) : along;
    const z = vertical ? along : road + (rng.chance(0.5) ? 3.5 : -3.5);
    const heading = vertical ? (x > road ? Math.PI : 0) : (z > road ? -Math.PI / 2 : Math.PI / 2);
    const v = new Vehicle(scene, rng.pick(keys), x, z, heading);
    v.traffic = true;
    v.target = nearestIntersection(city, x, z);
    v.cruise = rng.range(9, 15);
    cars.push(v);
  }
  return {
    cars,
    update(dt, city, playerPos, policeActive) {
      for (const v of cars) {
        if (v.occupied) continue;
        // Pick the next intersection along the current road.
        const dx = v.target.x - v.x, dz = v.target.z - v.z;
        const d = Math.hypot(dx, dz);
        if (d < 6) {
          const opts = city.intersections.filter(it => (it.x === v.target.x || it.z === v.target.z) && !(it.x === v.target.x && it.z === v.target.z));
          v.target = opts.length ? opts[Math.floor(Math.random() * opts.length)] : v.target;
          continue;
        }
        const want = Math.atan2(dx, dz);
        v.heading = angleLerp(v.heading, want, Math.min(1, dt * 2.2));
        // Red light: stop before the intersection; keep distance from the car ahead.
        let speedTarget = v.cruise;
        if (d < 18 && city.lightIsRed(v.target.x, v.target.z)) speedTarget = 0;
        for (const o of cars) {
          if (o === v) continue;
          const od = Math.hypot(o.x - v.x, o.z - v.z);
          if (od < 9) {
            const ahead = Math.cos(v.heading) * (o.x - v.x) + Math.sin(v.heading) * (o.z - v.z);
            if (ahead > 0) speedTarget = Math.min(speedTarget, 3);
          }
        }
        if (policeActive && playerPos) {
          const pd = Math.hypot(playerPos.x - v.x, playerPos.z - v.z);
          if (pd < 7) speedTarget = 0;
        }
        v.speed += (speedTarget - v.speed) * Math.min(1, dt * 1.6);
        const mx = Math.sin(v.heading) * v.speed * dt;
        const mz = Math.cos(v.heading) * v.speed * dt;
        const r = moveCircle(v.x, v.z, mx, mz, 1.6, city.colliders);
        v.x = r.x; v.z = r.z;
        v.mesh.position.set(v.x, 0, v.z);
        v.mesh.rotation.y = v.heading;
        for (const w of v.mesh.userData.wheels) w.rotation.x += v.speed * dt * 2.4;
      }
    },
  };
}
