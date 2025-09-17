const socket = io();

// Canvas setup
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let world = { width: 2000, height: 1200 };
let myId = null;
let players = [];
let hearts = [];
let settings = {};
let me = null;

// Resize canvas to window, maintain world scaling
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Lobby and admin UI
const lobby = document.getElementById('lobby');
const lobbyMsg = document.getElementById('lobbyMsg');
const hud = document.getElementById('hud');
const energy = document.getElementById('energy');
const energyBar = energy.querySelector('.bar');
const statusEl = document.getElementById('status');

document.getElementById('join').addEventListener('click', () => {
  const name = document.getElementById('name').value || 'Player';
  const species = document.getElementById('species').value;
  socket.emit('joinLobby', { name, species });
});

// Admin modal
const adminModal = document.getElementById('adminModal');
document.getElementById('adminBtn').addEventListener('click', () => {
  adminModal.classList.remove('hidden');
});
document.getElementById('closeAdmin').addEventListener('click', () => {
  adminModal.classList.add('hidden');
});

document.getElementById('adminLogin').addEventListener('click', () => {
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
  if (ok) {
    adminMsg.textContent = 'Logged in as admin';
    socket.dataIsAdmin = true;
    socket.emit('setAdminFlag', { ok: true });
  } else {
    adminMsg.textContent = 'Invalid credentials';
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
  document.getElementById('maxFoxes').value = s.maxFoxes;
  document.getElementById('maxRabbits').value = s.maxRabbits;
});

socket.on('state', (s) => {
  players = s.players;
  settings = s.settings;
  world = s.world;
});

socket.on('tick', ({ state, hearts: h }) => {
  players = state.players;
  settings = state.settings;
  world = state.world;
  hearts = h || [];
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
      if (p.species === 'rabbit') drawRabbitSprite(scr.x, scr.y, walkPhase);
      else drawFoxSprite(scr.x, scr.y, walkPhase);
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
