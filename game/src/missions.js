// Story: three real missions with waypoints, triggers, dialogue, failure and restart.
// Each mission only completes when the player actually reaches the place and does the thing.
import * as THREE from 'three';

export const MISSIONS = [
  {
    id: 'm1', name: 'Mission 1 — The Wrong Delivery', reward: 250,
    brief: 'Pick up the parcel at the courier depot, then deliver it to the Sunline Hotel contact.',
    steps: [
      { id: 'pickup', text: 'Pick up the parcel at the depot', pos: 'depot', radius: 4, action: 'pickup' },
      { id: 'deliver', text: 'Deliver the parcel to the hotel contact', pos: 'hotel', radius: 4, action: 'deliver' },
    ],
    dialogue: [
      { who: 'Rae', line: 'One last delivery shift, then I am done with this city. Or so I thought.' },
      { who: 'Dispatch (radio)', line: 'Rae, parcel 417. Sunline Hotel, ask for Maren. Do not open it. Seriously.' },
    ],
    completeLine: { who: 'Maren Voss', line: 'You should not have brought this here. The developers own the docks, the police, half this street. Take this — and run.' },
  },
  {
    id: 'm2', name: 'Mission 2 — Evidence Run', reward: 400,
    brief: 'Break into the Harborfront warehouse, grab the ledger, and get it to the safehouse.',
    steps: [
      { id: 'infiltrate', text: 'Reach the Harborfront warehouse', pos: 'warehouse', radius: 5, action: 'reach' },
      { id: 'grab', text: 'Grab the ledger from the crate', pos: 'warehouse', radius: 4, action: 'pickup' },
      { id: 'escape', text: 'Escape to the Crown Heights safehouse — security is coming', pos: 'safehouse', radius: 5, action: 'deliver' },
    ],
    dialogue: [
      { who: 'Maren Voss', line: 'The ledger is in the warehouse by Pier 9. It names every bribe. Get it, and the whole network burns.' },
      { who: 'Rae', line: 'And if their security finds me first?' },
      { who: 'Maren Voss', line: 'Then drive faster than them.' },
    ],
    completeLine: { who: 'Maren Voss', line: 'You did it. The ledger is real. Tomorrow, Cinder Bay wakes up to the truth.' },
  },
  {
    id: 'm3', name: 'Mission 3 — Sundown Escape', reward: 500,
    brief: 'They know you have the ledger. Reach the marina extraction before the lockdown closes in.',
    steps: [
      { id: 'flee', text: 'Reach the marina extraction point', pos: 'marina', radius: 6, action: 'deliver', timed: 150 },
    ],
    dialogue: [
      { who: 'CBPD (radio)', line: 'All units: suspect vehicle, Sunline corridor. Lockdown protocol. Do not let them reach the water.' },
      { who: 'Rae', line: 'One road left. Sundown, full throttle, no looking back.' },
    ],
    completeLine: { who: 'Rae', line: 'We made it. The story gets out tonight — and Cinder Bay will never be the same.' },
  },
];

export function createMissionManager(scene, spawns, callbacks) {
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  beacon.visible = false; scene.add(beacon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 8, 24), beaconMat);
  ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring);
  let index = 0;          // current mission
  let step = 0;           // current step inside it
  let active = false;
  let timer = 0;
  let done = [false, false, false];
  function current() { return MISSIONS[index]; }
  function stepDef() { const m = current(); return m ? m.steps[step] : null; }
  function stepPos() { const s = stepDef(); return s ? spawns[s.pos] : null; }
  function start(i) {
    index = i; step = 0; active = true; timer = 0;
    const m = current();
    callbacks.onDialogue(m.dialogue);
    callbacks.onObjective(m.name, m.steps[0].text);
    callbacks.onToast(m.name + ' — ' + m.brief);
  }
  return {
    get index() { return index; },
    get active() { return active; },
    get done() { return done; },
    get step() { return step; },
    current, stepDef, stepPos,
    start,
    startNext() {
      if (index < MISSIONS.length - 1) start(index + 1);
      else { active = false; callbacks.onObjective('Chapter complete', 'All three missions done. Free roam — Cinder Bay is yours.'); }
    },
    // Called every frame with the player position and an interact flag.
    update(dt, px, pz, interact) {
      if (!active) { beacon.visible = false; ring.visible = false; return null; }
      const s = stepDef(); const pos = stepPos();
      if (!s || !pos) return null;
      beacon.visible = true; ring.visible = true;
      beacon.position.set(pos.x, 15, pos.z);
      ring.position.set(pos.x, 0.3, pos.z);
      ring.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.15);
      const d = Math.hypot(px - pos.x, pz - pos.z);
      if (s.timed) {
        timer += dt;
        const left = Math.max(0, Math.ceil(s.timed - timer));
        callbacks.onTimer(left);
        if (timer > s.timed) {
          active = false; beacon.visible = false; ring.visible = false;
          callbacks.onFail('Out of time — the lockdown closed in. Press M to retry the mission.');
          return 'fail';
        }
      }
      const inRange = d < s.radius;
      if (inRange && s.action !== 'reach') callbacks.onPrompt('Press E — ' + s.text);
      if (inRange && (s.action === 'reach' || (s.action !== 'reach' && interact))) {
        step += 1;
        callbacks.onPickup(s.action);
        if (step >= current().steps.length) {
          done[index] = true;
          const reward = current().reward;
          const line = current().completeLine;
          active = false; beacon.visible = false; ring.visible = false;
          callbacks.onComplete(current(), reward, line);
          return 'complete';
        }
        callbacks.onObjective(current().name, current().steps[step].text);
        callbacks.onToast('Objective updated — ' + current().steps[step].text);
        return 'step';
      }
      return inRange ? 'near' : null;
    },
    fail() {
      active = false; beacon.visible = false; ring.visible = false;
      callbacks.onFail('Mission failed. Press M to retry.');
    },
    loadState(doneArr, idx) { done = doneArr.slice(); index = Math.min(idx, MISSIONS.length - 1); },
  };
}
