// Wanted / heat system + police AI. Stars rise only from real player actions (steal, shoot,
// hit a pedestrian, ram a car) and fall only when the player stays unseen. Police cars chase
// on the road graph with a search state; foot cops close in when the player is on foot.
import { clamp, angleLerp } from './rng.js';
import { moveCircle } from './physics.js';
import { Vehicle } from './vehicles.js';
import { createHumanMesh, animateWalk } from './characters.js';
import { nearestIntersection } from './world.js';

export const WANTED_LABELS = ['Clear', 'Reported', 'Pursuit', 'High Alert', 'City Lockdown', 'City Lockdown'];

export class WantedSystem {
  constructor() {
    this.level = 0;
    this.heat = 0;          // 0..100 inside the current level
    this.unseenTimer = 0;   // seconds since a cop last saw the player
    this.lastSeen = null;
  }
  add(amount, reason) {
    this.heat += amount;
    while (this.heat >= 100 && this.level < 5) { this.heat -= 100; this.level += 1; }
    if (this.level >= 5) this.heat = 100;
    return reason;
  }
  update(dt, seen) {
    if (seen) { this.unseenTimer = 0; this.lastSeen = { t: performance.now() }; }
    else {
      this.unseenTimer += dt;
      if (this.level > 0 && this.unseenTimer > 18) {
        this.heat -= dt * 6;
        if (this.heat <= 0) { this.heat = 0; this.level -= 1; if (this.level > 0) this.heat = 60; }
      }
    }
  }
  clear() { this.level = 0; this.heat = 0; this.unseenTimer = 0; }
}

export function createPolice(scene, city, rng) {
  const cars = [];
  const cops = [];
  let spawnTimer = 0;
  function spawnCar(px, pz) {
    // Spawn on a road at the edge of the visible city, heading toward the player.
    const edge = city.intersections[Math.floor(Math.random() * city.intersections.length)];
    const v = new Vehicle(scene, 'police', edge.x + 3.5, edge.z, 0, { police: true });
    v.police = true;
    v.state = 'chase';
    v.searchTarget = { x: px, z: pz };
    v.searchTimer = 0;
    cars.push(v);
    return v;
  }
  function spawnCop(px, pz) {
    const mesh = createHumanMesh({ shirt: 0x1a2a4a, pants: 0x1a1a22, cap: true, hair: 0x111111 });
    const a = Math.random() * Math.PI * 2;
    const x = px + Math.cos(a) * 14, z = pz + Math.sin(a) * 14;
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const cop = { mesh, x, z, heading: 0, phase: 0, health: 60, state: 'chase' };
    cops.push(cop);
    return cop;
  }
  return {
    cars, cops,
    wantedCount() { return cars.length + cops.length; },
    update(dt, wanted, player, playerInCar, onCopShot) {
      const wantCars = wanted.level === 0 ? 0 : Math.min(1 + wanted.level, 4);
      const wantCops = wanted.level >= 2 ? Math.min(wanted.level - 1, 3) : 0;
      spawnTimer -= dt;
      if (cars.length < wantCars && spawnTimer <= 0) { spawnCar(player.x, player.z); spawnTimer = 2.5; }
      if (cops.length < wantCops && spawnTimer <= 0 && !playerInCar) { spawnCop(player.x, player.z); spawnTimer = 3; }
      // Despawn the surplus when the heat falls.
      while (cars.length > wantCars) { const v = cars.pop(); scene.remove(v.mesh); }
      while (cops.length > wantCops) { const c = cops.pop(); scene.remove(c.mesh); }
      let seen = false;
      for (const v of cars) {
        const dx = player.x - v.x, dz = player.z - v.z;
        const d = Math.hypot(dx, dz);
        if (d < 90) seen = true;
        if (v.state === 'chase') {
          if (d > 12) {
            // Chase via the road graph: aim at the player's nearest intersection, then at the player.
            const it = nearestIntersection(city, player.x, player.z);
            const tx = d < 40 ? player.x : it.x, tz = d < 40 ? player.z : it.z;
            const want = Math.atan2(tx - v.x, tz - v.z);
            v.heading = angleLerp(v.heading, want, Math.min(1, dt * 1.8));
            v.speed = clamp(v.speed + v.type.accel * dt * 0.8, 0, v.type.maxSpeed * 0.92);
          } else {
            // Ramming range: slow, try to block.
            v.speed = clamp(v.speed - 10 * dt, 2, 10);
          }
          const r = moveCircle(v.x, v.z, Math.sin(v.heading) * v.speed * dt, Math.cos(v.heading) * v.speed * dt, 1.7, city.colliders);
          v.x = r.x; v.z = r.z;
          v.mesh.position.set(v.x, 0, v.z);
          v.mesh.rotation.y = v.heading;
          for (const w of v.mesh.userData.wheels) w.rotation.x += v.speed * dt * 2.4;
          if (v.mesh.userData.beacon) v.mesh.userData.beacon.intensity = (Math.sin(performance.now() * 0.02) > 0 ? 14 : 2);
        }
        // Touching the player on foot hurts.
        if (!playerInCar && d < 1.6 && onCopShot) onCopShot(6 * dt);
      }
      for (const c of cops) {
        const dx = player.x - c.x, dz = player.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < 70) seen = true;
        const want = Math.atan2(dx, dz);
        c.heading = angleLerp(c.heading, want, Math.min(1, dt * 5));
        const speed = d > 6 ? 4.6 : 2.2;
        const r = moveCircle(c.x, c.z, Math.sin(c.heading) * speed * dt, Math.cos(c.heading) * speed * dt, 0.4, city.colliders);
        c.x = r.x; c.z = r.z;
        c.phase += dt * speed * 2;
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.heading;
        animateWalk(c.mesh, c.phase, clamp(speed / 5, 0, 1), false);
        if (d < 26 && onCopShot && Math.random() < dt * 0.35) onCopShot(4);
      }
      return seen;
    },
    damageNearest(px, pz, amount, range) {
      let best = null, bd = range;
      for (const c of cops) {
        const d = Math.hypot(c.x - px, c.z - pz);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { best.health -= amount; if (best.health <= 0) { scene.remove(best.mesh); cops.splice(cops.indexOf(best), 1); return 'cop'; } }
      let bestCar = null, bcd = range;
      for (const v of cars) {
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d < bcd) { bcd = d; bestCar = v; }
      }
      if (bestCar) { bestCar.health -= amount; if (bestCar.health <= 8) { scene.remove(bestCar.mesh); cars.splice(cars.indexOf(bestCar), 1); return 'car'; } }
      return best ? 'cop' : bestCar ? 'car' : null;
    },
  };
}
