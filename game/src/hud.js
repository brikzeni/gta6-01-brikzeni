// HUD: money, health, wanted stars, objective, minimap, speedometer, prompts, dialogue,
// toasts and pause stats. The minimap is drawn from the real city data every frame.
import { districtAt } from './world.js';
import { WANTED_LABELS } from './police.js';

export function createHUD(city) {
  const $ = (id) => document.getElementById(id);
  const els = {
    money: $('money'), healthfill: $('healthfill'), healthnum: $('healthnum'), ammoMini: $('ammoMini'),
    stars: $('stars'), wantedlabel: $('wantedlabel'), mname: $('mname'), mtext: $('mtext'),
    minimap: $('minimap'), speedo: $('speedo'), speed: $('speed'), carname: $('carname'),
    ammo: $('ammo'), ammoMag: $('ammoMag'), prompt: $('prompt'), crosshair: $('crosshair'),
    toast: $('toast'), dialogue: $('dialogue'), dlgWho: $('dlgWho'), dlgLine: $('dlgLine'),
    status: $('status'),
  };
  const mm = els.minimap.getContext('2d');
  let toastTimer = null;
  let dlgQueue = [];
  let dlgShowing = false;
  function showToast(text, ms) {
    els.toast.textContent = text;
    els.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.style.display = 'none'; }, ms || 3200);
  }
  function showDialogue(lines, onDone) {
    dlgQueue = lines.slice();
    dlgShowing = true;
    els.dialogue.style.display = 'block';
    nextDialogue(onDone);
    function nextDialogue(cb) {
      const line = dlgQueue.shift();
      if (!line) { els.dialogue.style.display = 'none'; dlgShowing = false; if (cb) cb(); return; }
      els.dlgWho.textContent = line.who;
      els.dlgLine.textContent = line.line;
      els.dialogue._next = () => nextDialogue(cb);
    }
  }
  function advanceDialogue() {
    if (dlgShowing && els.dialogue._next) els.dialogue._next();
  }
  function drawMinimap(px, pz, heading, missionPos, policeCars, trafficCars, peds) {
    const S = 190, half = 190;
    mm.clearRect(0, 0, S, S);
    mm.fillStyle = '#1c1220'; mm.fillRect(0, 0, S, S);
    const toX = (x) => ((x + half) / (half * 2)) * S;
    const toY = (z) => ((z + half) / (half * 2)) * S;
    // Water west.
    mm.fillStyle = '#2a7a9e'; mm.fillRect(0, 0, toX(-180), S);
    // Blocks.
    mm.fillStyle = '#3a2c3a';
    for (const b of city.buildings) mm.fillRect(toX(b.x - b.w / 2), toY(b.z - b.d / 2), (b.w / (half * 2)) * S, (b.d / (half * 2)) * S);
    // Roads.
    mm.strokeStyle = '#6a5a6a'; mm.lineWidth = 4;
    for (const r of [-150, -90, -30, 30, 90, 150]) {
      mm.beginPath(); mm.moveTo(toX(r), 0); mm.lineTo(toX(r), S); mm.stroke();
      mm.beginPath(); mm.moveTo(0, toY(r)); mm.lineTo(S, toY(r)); mm.stroke();
    }
    // Mission marker.
    if (missionPos) {
      mm.fillStyle = '#ffc93c';
      mm.beginPath(); mm.arc(toX(missionPos.x), toY(missionPos.z), 7, 0, Math.PI * 2); mm.fill();
      mm.strokeStyle = '#ffc93c'; mm.lineWidth = 2;
      mm.beginPath(); mm.arc(toX(missionPos.x), toY(missionPos.z), 11 + Math.sin(performance.now() * 0.005) * 2, 0, Math.PI * 2); mm.stroke();
    }
    // Police (blue), traffic (grey), peds (pale dots).
    mm.fillStyle = '#4466ff';
    for (const v of policeCars || []) { mm.beginPath(); mm.arc(toX(v.x), toY(v.z), 3.5, 0, Math.PI * 2); mm.fill(); }
    mm.fillStyle = '#9a8a9a';
    for (const v of trafficCars || []) { mm.beginPath(); mm.arc(toX(v.x), toY(v.z), 2, 0, Math.PI * 2); mm.fill(); }
    // Player arrow: triangle points up (-y); rotate by PI - heading so it points
    // along the player's forward vector on the map (north is up, +z is down).
    const cx = toX(px), cy = toY(pz);
    mm.save(); mm.translate(cx, cy); mm.rotate(Math.PI - heading);
    mm.fillStyle = '#ff9a3c';
    mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(-5, 6); mm.closePath(); mm.fill();
    mm.restore();
  }
  return {
    els, showToast, showDialogue, advanceDialogue,
    get dialogueShowing() { return dlgShowing; },
    setMoney(v) { els.money.textContent = String(Math.floor(v)); },
    setHealth(h, ammo) {
      els.healthfill.style.width = Math.max(0, h) + '%';
      els.healthnum.innerHTML = 'HEALTH ' + Math.max(0, Math.round(h)) + ' &middot; AMMO <span id="ammoMini">' + ammo + '</span>';
    },
    setWanted(level, heat) {
      let s = '';
      for (let i = 0; i < 5; i++) s += '<span class="' + (i < level ? '' : 'off') + '">&#9733;</span>';
      els.stars.innerHTML = s;
      els.wantedlabel.textContent = (WANTED_LABELS[level] || 'Clear') + (level > 0 ? ' — ' + Math.round(heat) + '%' : '');
    },
    setObjective(name, text) { els.mname.textContent = name; els.mtext.textContent = text; },
    setTimer(left) { if (left > 0) els.mtext.textContent = els.mtext.textContent; },
    setDriving(on, speedMph, carName) {
      els.speedo.style.display = on ? 'block' : 'none';
      els.ammo.style.display = on ? 'none' : 'block';
      if (on) { els.speed.textContent = String(Math.round(speedMph)); els.carname.textContent = carName; }
    },
    setCrosshair(on) { els.crosshair.style.display = on ? 'block' : 'none'; },
    setAmmo(mag) { els.ammoMag.textContent = String(mag); },
    setPrompt(text) {
      if (text) { els.prompt.innerHTML = text; els.prompt.style.display = 'block'; }
      else els.prompt.style.display = 'none';
    },
    announce(msg) { els.status.textContent = msg; },
    updateMinimap(px, pz, heading, missionPos, policeCars, trafficCars) {
      drawMinimap(px, pz, heading, missionPos, policeCars, trafficCars, null);
    },
    district(px, pz) { return districtAt(px, pz); },
  };
}
