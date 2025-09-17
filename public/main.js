const socket = io();

// Canvas setup
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let world = { width: 2000, height: 1200 };
let myId = null;
let players = [];
let hearts = [];
let hits = [];
let settings = {};
let me = null;

// Resize canvas to window, maintain world scaling
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();
// Initial visibility: show user join modal by default, keep admin hidden
try {
  document.getElementById('lobby')?.classList.remove('hidden');
  document.getElementById('adminModal')?.classList.add('hidden');
} catch {}

// Lobby and admin UI
const lobby = document.getElementById('lobby');
const lobbyMsg = document.getElementById('lobbyMsg');
const hud = document.getElementById('hud');
const energy = document.getElementById('energy');
const energyBar = energy.querySelector('.bar');
const statusEl = document.getElementById('status');

// Lobby form submit
const lobbyForm = document.getElementById('lobbyForm');
lobbyForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value || 'Player';
  const species = document.getElementById('species').value;
  socket.emit('joinLobby', { name, species });
});

// Admin modal
const adminModal = document.getElementById('adminModal');
const lobbyModal = document.getElementById('lobby');
const splash = document.getElementById('splash');

// Admin modal open/close
const adminBtn = document.getElementById('adminBtn');
const adminTopBtn = document.getElementById('adminTopBtn');
const openAdmin = () => adminModal.classList.remove('hidden');
adminBtn?.addEventListener('click', openAdmin);
adminTopBtn?.addEventListener('click', openAdmin);
// Splash entry points
document.getElementById('openLobbyBtn')?.addEventListener('click', () => {
  splash?.classList.add('hidden');
  lobbyModal?.classList.remove('hidden');
});
document.getElementById('openAdminBtn')?.addEventListener('click', () => {
  splash?.classList.add('hidden');
  adminModal?.classList.remove('hidden');
});
// Ensure default visibility: lobby shown, admin hidden
if (lobbyModal) lobbyModal.classList.remove('hidden');
if (adminModal) adminModal.classList.add('hidden');
const closeAdminBtn = document.getElementById('closeAdmin');
const closeAdminX = document.getElementById('adminCloseX');
const hideAdmin = () => adminModal.classList.add('hidden');
closeAdminBtn?.addEventListener('click', hideAdmin);
closeAdminX?.addEventListener('click', hideAdmin);
// Click outside to close admin modal
adminModal?.addEventListener('click', (e) => {
  if (e.target === adminModal) hideAdmin();
});

// Lobby close to splash
document.getElementById('lobbyCloseX')?.addEventListener('click', () => {
  lobbyModal?.classList.add('hidden');
  splash?.classList.remove('hidden');
});

// Admin form submit
const adminForm = document.getElementById('adminForm');
adminForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const user = document.getElementById('adminUser').value;
  const pass = document.getElementById('adminPass').value;
  socket.emit('adminLogin', { user, pass });
});

document.getElementById('saveSettings').addEventListener('click', () => {
  if (!socket.dataIsAdmin) return;
  const maxFoxes = Number(document.getElementById('maxFoxes').value);
  const maxRabbits = Number(document.getElementById('maxRabbits').value);
  socket.emit('updateSettings', { maxFoxes, maxRabbits });
});

socket.on('adminLoginResult', ({ ok }) => {
  const adminMsg = document.getElementById('adminMsg');
  const adminSettings = document.getElementById('adminSettings');
  if (ok) {
    adminMsg.textContent = 'Logged in as admin';
    socket.dataIsAdmin = true;
    adminSettings?.classList.remove('hidden');
    // Hide top admin button, show admin badge and analytics
    document.getElementById('adminTopBtn')?.classList.add('hidden');
    document.getElementById('adminBadge')?.classList.remove('hidden');
    document.getElementById('analytics')?.classList.remove('hidden');
    // Make badge reopen admin modal
    document.getElementById('adminBadge')?.addEventListener('click', openAdmin, { once: false });
    // Close admin modal and show the lobby (waiting) panel
    const lobbyEl = document.getElementById('lobby');
    hideAdmin();
    lobbyEl?.classList.remove('hidden');
    socket.emit('setAdminFlag', { ok: true });
  } else {
    adminMsg.textContent = 'Invalid credentials';
    adminSettings?.classList.add('hidden');
  }
});

socket.on('hello', (data) => {
  world = data.world;
  settings = data.settings;
});

socket.on('enteredGame', ({ ok, reason, settings: s, world: w }) => {
  settings = s;
  world = w;
  if (ok) {
    lobby.classList.add('hidden');
    hud.classList.remove('hidden');
    lobbyMsg.textContent = '';
  } else if (reason === 'capacity') {
    lobbyMsg.textContent = 'Lobby full, waiting for a slot…';
  }
});

socket.on('outOfEnergy', () => {
  statusEl.textContent = 'Fox out of energy! Returned to lobby';
  lobby.classList.remove('hidden');
  hud.classList.add('hidden');
});

socket.on('eaten', () => {
  statusEl.textContent = 'You were eaten! Returned to lobby';
  lobby.classList.remove('hidden');
  hud.classList.add('hidden');
});

socket.on('settings', (s) => {
  settings = s;
  const mf = document.getElementById('maxFoxes');
  const mr = document.getElementById('maxRabbits');
  if (mf) mf.value = s.maxFoxes;
  if (mr) mr.value = s.maxRabbits;
});

socket.on('state', (s) => {
  players = s.players;
  settings = s.settings;
  world = s.world;
  // Show stats in admin if available
  const adminStats = document.getElementById('adminStats');
  if (adminStats && s.stats) {
    const st = s.stats;
    adminStats.textContent = `Stats — Hearts: ${st.hearts} | Rabbits eaten: ${st.rabbitsEaten} | Fox births: ${st.foxBirths}`;
  }
});

socket.on('tick', ({ state, hearts: h, hits: hi }) => {
  players = state.players;
  settings = state.settings;
  world = state.world;
  hearts = h || [];
  hits = hi || [];
  // Update counts UI
  if (state.counts) {
    const countsElNow = document.getElementById('counts');
    if (countsElNow) countsElNow.textContent = `Foxes: ${state.counts.foxes}/${state.settings.maxFoxes} | Rabbits: ${state.counts.rabbits}/${state.settings.maxRabbits} | Queue: ${state.queue || 0}`;
    pushPopSample(state.counts.foxes, state.counts.rabbits);
  }
});

// Input handling: keyboard + mobile joystick
const input = { up: false, down: false, left: false, right: false };
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'w') input.up = true;
  if (e.key === 'ArrowDown' || e.key === 's') input.down = true;
  if (e.key === 'ArrowLeft' || e.key === 'a') input.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd') input.right = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'w') input.up = false;
  if (e.key === 'ArrowDown' || e.key === 's') input.down = false;
  if (e.key === 'ArrowLeft' || e.key === 'a') input.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') input.right = false;
});

// Virtual joystick
const joystick = document.getElementById('joystick');
const stick = joystick.querySelector('.stick');
let joyActive = false;
let joyCenter = { x: 0, y: 0 };
let joyVec = { x: 0, y: 0 };

function setInputFromJoy() {
  // Convert joy vector to 4-way inputs
  input.up = joyVec.y < -0.3;
  input.down = joyVec.y > 0.3;
  input.left = joyVec.x < -0.3;
  input.right = joyVec.x > 0.3;
}

function joyStart(x, y) {
  joyActive = true;
  joyCenter = { x, y };
  joystick.style.opacity = '1';
  joystick.style.transform = `translate(${x - 60}px, ${y - 60}px)`;
}
function joyMove(x, y) {
  if (!joyActive) return;
  const dx = x - joyCenter.x;
  const dy = y - joyCenter.y;
  const r = 40;
  const len = Math.hypot(dx, dy);
  const cl = Math.min(len, r);
  const nx = (dx / (len || 1)) * cl;
  const ny = (dy / (len || 1)) * cl;
  stick.style.transform = `translate(${nx}px, ${ny}px)`;
  joyVec = { x: nx / r, y: ny / r };
  setInputFromJoy();
}
function joyEnd() {
  joyActive = false;
  stick.style.transform = 'translate(0px, 0px)';
  joystick.style.opacity = '0.6';
  joyVec = { x: 0, y: 0 };
  setInputFromJoy();
}

window.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  joyStart(t.clientX, t.clientY);
});
window.addEventListener('touchmove', (e) => {
  const t = e.changedTouches[0];
  joyMove(t.clientX, t.clientY);
});
window.addEventListener('touchend', () => joyEnd());
window.addEventListener('touchcancel', () => joyEnd());

// Load SVG assets as images
const imgForest = new Image(); imgForest.src = '/assets/forest.svg';
const imgFox = new Image(); imgFox.src = '/assets/fox.svg';
const imgRabbit = new Image(); imgRabbit.src = '/assets/rabbit.svg';

// Forest background draw using forest.svg aligned to camera
function drawForestImage() {
  const origin = worldToScreen(0, 0);
  const w = world.width * origin.scaleX;
  const h = world.height * origin.scaleY;
  if (imgForest.complete && imgForest.naturalWidth) {
    ctx.drawImage(imgForest, origin.x, origin.y, w, h);
  } else {
    // fallback to simple background
    ctx.fillStyle = '#7bbf6a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// Sprite drawers with simple bobbing animation
function drawRabbitSprite(x, y, walkingPhase = 0) {
  const bob = Math.sin(walkingPhase * 3) * 3;
  const size = 44;
  ctx.save();
  ctx.translate(x, y + bob);
  if (imgRabbit.complete && imgRabbit.naturalWidth) {
    ctx.drawImage(imgRabbit, -size / 2, -size / 2, size, size);
  } else {
    drawRabbit(0, 0, 1, walkingPhase); // fallback
  }
  ctx.restore();
}

function drawFoxSprite(x, y, walkingPhase = 0) {
  const bob = Math.sin(walkingPhase * 3) * 3;
  const size = 48;
  ctx.save();
  ctx.translate(x, y + bob);
  if (imgFox.complete && imgFox.naturalWidth) {
    ctx.drawImage(imgFox, -size / 2, -size / 2, size, size);
  } else {
    drawFox(0, 0, 1, walkingPhase);
  }
  ctx.restore();
}

// Facing direction (flip sprites based on vx)
function drawRabbitSpriteFacing(x, y, vx, phase) {
  ctx.save();
  const flip = vx < -0.01 ? -1 : 1;
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  drawRabbitSprite(0, 0, phase);
  ctx.restore();
}
function drawFoxSpriteFacing(x, y, vx, phase) {
  ctx.save();
  const flip = vx < -0.01 ? -1 : 1;
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  drawFoxSprite(0, 0, phase);
  ctx.restore();
}

// Assets: simple inline SVG draw for fox and rabbit
function drawRabbit(x, y, scale = 1, walkingPhase = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  // body
  ctx.fillStyle = '#f5f5f5';
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.ellipse(12, -4, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears animated slightly
  const eWiggle = Math.sin(walkingPhase) * 1.5;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(16, -14 + eWiggle, 3, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(9, -15 - eWiggle, 3, 8, 0, 0, Math.PI * 2); ctx.fill();
  // eye
  ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(15, -5, 1.5, 0, Math.PI * 2); ctx.fill();
  // legs subtle bounce
  ctx.fillStyle = '#e5e5e5';
  const leg = Math.sin(walkingPhase * 2) * 2;
  ctx.fillRect(-8, 8 + leg, 6, 3);
  ctx.fillRect(4, 8 - leg, 6, 3);
  ctx.restore();
}

function drawFox(x, y, scale = 1, walkingPhase = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  // body
  ctx.fillStyle = '#f06d2f';
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  // head
  ctx.beginPath(); ctx.ellipse(14, -4, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
  // ears
  ctx.beginPath(); ctx.moveTo(16, -12); ctx.lineTo(20, -18); ctx.lineTo(22, -10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(10, -12); ctx.lineTo(6, -18); ctx.lineTo(4, -10); ctx.closePath(); ctx.fill();
  // eye
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(16, -5, 1.8, 0, Math.PI * 2); ctx.fill();
  // tail swish
  ctx.fillStyle = '#ffa66a';
  const tail = Math.sin(walkingPhase * 2) * 4;
  ctx.beginPath(); ctx.ellipse(-18, -4 + tail, 8, 4, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Camera centers on me
function worldToScreen(x, y) {
  const mx = me ? me.x : world.width / 2;
  const my = me ? me.y : world.height / 2;
  const scaleX = canvas.width / world.width;
  const scaleY = canvas.height / world.height;
  const sx = (x - mx) * scaleX + canvas.width / 2;
  const sy = (y - my) * scaleY + canvas.height / 2;
  return { x: sx, y: sy, scaleX, scaleY };
}

// Heart emoji effect
function drawHearts() {
  ctx.font = '24px system-ui, Apple Color Emoji';
  for (const h of hearts) {
    const p = worldToScreen(h.x, h.y);
    ctx.fillText('❤️', p.x - 12, p.y - 12);
  }
}

// Draw hits
function drawHits() {
  for (const h of hits) {
    const p = worldToScreen(h.x, h.y);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(255,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Render loop
let last = performance.now();
let walkPhase = 0;
function loop(now) {
  const dt = Math.min(50, now - last);
  last = now;
  walkPhase += dt / 100;

  me = players.find(p => p.id === myId);

  // Send input to server
  socket.emit('move', { input, dt });

  // Draw
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Prefer SVG forest background if available
  if (imgForest) drawForestImage(); else drawForest();

  // Draw players
  for (const p of players) {
    if (!p.inGame || !p.alive) continue;
    const scr = worldToScreen(p.x, p.y);
    // Prefer image sprites if available
    if (imgFox && imgRabbit) {
      if (p.species === 'rabbit') drawRabbitSpriteFacing(scr.x, scr.y, p.vx || 0, walkPhase);
      else drawFoxSpriteFacing(scr.x, scr.y, p.vx || 0, walkPhase);
    } else {
      const scale = Math.min(scr.scaleX, scr.scaleY) * 2.5; // fallback shape scale
      if (p.species === 'rabbit') drawRabbit(scr.x, scr.y, scale, walkPhase);
      else drawFox(scr.x, scr.y, scale, walkPhase);
    }
    // name label
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, scr.x, scr.y - 24);
  }

  // Hearts
  drawHearts();
  // Hits
  drawHits();

  // Energy HUD
  if (me && me.species === 'fox') {
    energy.classList.remove('hidden');
    const pct = Math.max(0, Math.min(1, (me.energyMs || 0) / 45000));
    energyBar.style.width = `${pct * 100}%`;
  } else {
    energy.classList.add('hidden');
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Track my id via connection id (socket.io doesn't expose directly to client). Infer on first state tick by finding unknown id after join.
// As a fallback, set myId when lobby hides and my name/species matches a player that just appeared.
const nameInput = document.getElementById('name');
const speciesInput = document.getElementById('species');
const joinBtn = document.getElementById('join');
let joinedAt = 0;
joinBtn.addEventListener('click', () => { joinedAt = performance.now(); });

setInterval(() => {
  if (myId) return;
  const cand = players.find(p => p.name === nameInput.value && p.species === speciesInput.value);
  if (cand && cand.inGame) myId = cand.id;
}, 500);

// Client-side state for hit events, sound toggle, and preload simple sounds.
let playSound = true;
const soundToggle = document.getElementById('soundToggle');
soundToggle?.addEventListener('click', () => {
  playSound = !playSound;
  soundToggle.textContent = playSound ? '🔊' : '🔇';
});

// Simple sounds
const sndEat = new Audio('/eat.mp3');
const sndHeart = new Audio('/heart.mp3');

// Play sounds when events change
let lastHeartsLen = 0;
let lastHitsLen = 0;
setInterval(() => {
  if (playSound) {
    if (hearts.length > lastHeartsLen) {
      try { sndHeart.currentTime = 0; } catch {}
      try { sndHeart.play().catch(() => {}); } catch {}
    }
    if (hits.length > lastHitsLen) {
      try { sndEat.currentTime = 0; } catch {}
      try { sndEat.play().catch(() => {}); } catch {}
    }
  }
  lastHeartsLen = hearts.length;
  lastHitsLen = hits.length;
}, 150);

// --- Simple population graph ---
const chartCanvas = document.getElementById('popChart');
const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;
const popHistory = []; // {t, foxes, rabbits}
const MAX_SAMPLES = 300; // ~30s if sampling at 100ms
let lastSampleAt = 0;

function pushPopSample(foxes, rabbits) {
  const now = performance.now();
  // throttle to ~5 fps
  if (now - lastSampleAt < 200) return;
  lastSampleAt = now;
  popHistory.push({ t: now, foxes, rabbits });
  if (popHistory.length > MAX_SAMPLES) popHistory.shift();
  drawChart();
}

function drawChart() {
  if (!chartCtx || !chartCanvas) return;
  const w = chartCanvas.width, h = chartCanvas.height;
  chartCtx.clearRect(0, 0, w, h);
  if (popHistory.length < 2) return;
  const t0 = popHistory[0].t;
  const t1 = popHistory[popHistory.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const maxVal = Math.max(1, ...popHistory.map(p => Math.max(p.foxes, p.rabbits)));

  // axes
  chartCtx.strokeStyle = 'rgba(0,0,0,0.3)';
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(30, 10); chartCtx.lineTo(30, h - 20); chartCtx.lineTo(w - 10, h - 20);
  chartCtx.stroke();

  function plot(color, key) {
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 2;
    chartCtx.beginPath();
    popHistory.forEach((p, i) => {
      const x = 30 + ((p.t - t0) / span) * (w - 40);
      const y = (h - 20) - (p[key] / maxVal) * (h - 40);
      if (i === 0) chartCtx.moveTo(x, y); else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();
  }

  plot('#1976d2', 'foxes'); // blue line
  plot('#43a047', 'rabbits'); // green line

  // legend
  chartCtx.fillStyle = '#222'; chartCtx.font = '12px sans-serif';
  chartCtx.fillText('Foxes', 34, 16);
  chartCtx.fillText('Rabbits', 90, 16);
  chartCtx.fillStyle = '#1976d2'; chartCtx.fillRect(5, 8, 20, 4);
  chartCtx.fillStyle = '#43a047'; chartCtx.fillRect(65, 8, 20, 4);
}
