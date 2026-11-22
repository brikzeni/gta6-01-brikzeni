// Axis-aligned collision: buildings and props are AABBs; actors are circles on the XZ plane.
// Move X then Z so actors slide along walls instead of sticking.
export function circleVsAABBs(x, z, r, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 0.000001) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = x - b.minX, pr = b.maxX - x, pt = z - b.minZ, pb = b.maxZ - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = b.minX - r; else if (m === pr) x = b.maxX + r;
        else if (m === pt) z = b.minZ - r; else z = b.maxZ + r;
      }
    }
  }
  return { x, z };
}
// Move with per-axis resolution; returns the resolved position and whether each axis was blocked.
export function moveCircle(x, z, dx, dz, r, boxes) {
  let nx = x + dx, nz = z;
  const rx = circleVsAABBs(nx, nz, r, boxes);
  const blockedX = Math.abs(rx.x - nx) > 0.001 || Math.abs(rx.z - nz) > 0.001;
  nx = rx.x; nz = rx.z;
  nz = z + dz;
  const rz = circleVsAABBs(nx, nz, r, boxes);
  const blockedZ = Math.abs(rz.x - nx) > 0.001 || Math.abs(rz.z - nz) > 0.001;
  return { x: rz.x, z: rz.z, blockedX, blockedZ };
}
// Ray vs AABB (slab method) on XZ, ignoring Y: returns distance or -1.
export function rayVsBoxes(ox, oz, dx, dz, maxDist, boxes) {
  let best = -1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let tmin = 0, tmax = maxDist;
    if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) continue; }
    else {
      let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) continue; }
    else {
      let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (best < 0 || tmin < best) best = tmin;
  }
  return best;
}
