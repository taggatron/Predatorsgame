import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Game constants
const WORLD = { width: 2000, height: 1200 };
const BASE_SPEED = 150; // px/sec
const FOX_SPEED_BONUS = 1.2; // after eating a rabbit
const FOX_ENERGY_MAX = 45_000; // ms
const FOX_ENERGY_GAIN_PER_RABBIT = FOX_ENERGY_MAX; // refill to full on eat one rabbit
const COLLIDE_RADIUS = 32; // px approx for hit tests

// Admin settings
const admin = { user: 'dan', pass: 'tagg' };
let settings = {
  maxFoxes: 5,
  maxRabbits: 20
};
let stats = { hearts: 0, rabbitsEaten: 0, foxBirths: 0 };

function ensureDataFiles() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR); } catch {}
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } else {
    try {
      const loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (typeof loaded.maxFoxes === 'number') settings.maxFoxes = loaded.maxFoxes;
      if (typeof loaded.maxRabbits === 'number') settings.maxRabbits = loaded.maxRabbits;
    } catch {}
  }
  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } else {
    try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch {}
  }
}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
}

function updateStats(patch) {
  for (const [k, v] of Object.entries(patch)) {
    stats[k] = (stats[k] || 0) + v;
  }
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); } catch {}
  return stats;
}

ensureDataFiles();

// Lobby and game state
const players = new Map(); // socketId -> player
const lobbyQueue = new Set(); // socketIds waiting to join game due to caps

function spawnPosition(species) {
  // Place on random side of river: y < WORLD.height/2 or y > WORLD.height/2
  const margin = 50;
  const x = Math.random() * (WORLD.width - 2 * margin) + margin;
  const side = Math.random() < 0.5 ? 0.25 : 0.75;
  const y = WORLD.height * side + (Math.random() * 100 - 50);
  return { x: Math.max(margin, Math.min(WORLD.width - margin, x)), y: Math.max(margin, Math.min(WORLD.height - margin, y)) };
}

function countSpecies() {
  let foxes = 0, rabbits = 0;
  for (const p of players.values()) {
    if (p.alive && p.inGame) {
      if (p.species === 'fox') foxes++; else rabbits++;
    }
  }
  return { foxes, rabbits };
}

function canEnterGame(species) {
  const { foxes, rabbits } = countSpecies();
  if (species === 'fox') return foxes < settings.maxFoxes;
  return rabbits < settings.maxRabbits;
}

function addPlayer(socket, name, species) {
  const now = Date.now();
  const pos = spawnPosition(species);
  players.set(socket.id, {
    id: socket.id,
    name,
    species, // 'fox' | 'rabbit'
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    speedMul: 1,
    alive: true,
    inGame: false,
    eatenCount: 0,
    canReproduceAt: 0, // for foxes after 2 rabbits
    lastUpdate: now,
    energyMs: species === 'fox' ? FOX_ENERGY_MAX : 0
  });
}

function removePlayer(socketId) {
  players.delete(socketId);
  lobbyQueue.delete(socketId);
}

function enterGameIfPossible(socketId) {
  const p = players.get(socketId);
  if (!p) return false;
  if (canEnterGame(p.species)) {
    p.inGame = true;
    const pos = spawnPosition(p.species);
    p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0; p.alive = true; p.speedMul = 1;
    if (p.species === 'fox') p.energyMs = FOX_ENERGY_MAX;
    lobbyQueue.delete(socketId);
    io.to(socketId).emit('enteredGame', { ok: true, settings, world: WORLD });
    io.emit('state', snapshot());
    return true;
  } else {
    lobbyQueue.add(socketId);
    io.to(socketId).emit('enteredGame', { ok: false, reason: 'capacity', settings, world: WORLD });
    return false;
  }
}

function tryAdmitFromLobby() {
  // Attempt to admit waiting players when capacity allows (including reproduction grants)
  for (const id of Array.from(lobbyQueue)) {
    if (enterGameIfPossible(id)) break; // admit one per tick to avoid stampede
  }
}

function distanceSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function snapshot() {
  const arr = [];
  for (const p of players.values()) {
    arr.push({ id: p.id, name: p.name, species: p.species, x: p.x, y: p.y, vx: p.vx, vy: p.vy, alive: p.alive, inGame: p.inGame, speedMul: p.speedMul, energyMs: p.species === 'fox' ? p.energyMs : undefined });
  }
  const counts = countSpecies();
  return { players: arr, settings, world: WORLD, counts, queue: lobbyQueue.size, stats };
}

io.on('connection', (socket) => {
  socket.emit('hello', { world: WORLD, settings });

  socket.on('joinLobby', ({ name, species }) => {
    name = String(name || '').slice(0, 16) || 'Player';
    species = species === 'fox' ? 'fox' : 'rabbit';
    addPlayer(socket, name, species);
    enterGameIfPossible(socket.id);
    io.emit('state', snapshot());
  });

  socket.on('adminLogin', ({ user, pass }) => {
    const ok = user === admin.user && pass === admin.pass;
    if (ok) socket.data.isAdmin = true;
    socket.emit('adminLoginResult', { ok });
  });

  socket.on('updateSettings', ({ maxFoxes, maxRabbits }) => {
    // Basic guard: only allow after successful adminLogin in this session
    if (!socket.data.isAdmin) return;
    const mf = Math.max(0, Math.min(100, Number(maxFoxes)));
    const mr = Math.max(0, Math.min(200, Number(maxRabbits)));
    if (Number.isFinite(mf)) settings.maxFoxes = mf;
    if (Number.isFinite(mr)) settings.maxRabbits = mr;
    saveSettings();
    tryAdmitFromLobby();
    io.emit('settings', settings);
  });

  // Deprecated: client no longer needs to set admin flag

  socket.on('move', ({ input, dt }) => {
    // input: { up, down, left, right }
    const p = players.get(socket.id);
    if (!p || !p.alive || !p.inGame) return;
    dt = Math.max(0, Math.min(100, Number(dt))) || 16; // client-reported delta ms, clamped
    const speed = BASE_SPEED * (p.species === 'fox' ? 1.05 : 1.0) * p.speedMul;
    let vx = 0, vy = 0;
    if (input?.up) vy -= 1;
    if (input?.down) vy += 1;
    if (input?.left) vx -= 1;
    if (input?.right) vx += 1;
    const len = Math.hypot(vx, vy) || 1;
    vx = (vx / len) * speed * (dt / 1000);
    vy = (vy / len) * speed * (dt / 1000);
    p.x = Math.max(0, Math.min(WORLD.width, p.x + vx));
    p.y = Math.max(0, Math.min(WORLD.height, p.y + vy));
    p.vx = vx; p.vy = vy;
  });

  socket.on('disconnect', () => {
    removePlayer(socket.id);
    io.emit('state', snapshot());
  });
});

// Game loop: collisions, energy, reproduction
const HEART_EVENTS = []; // { x, y, t }
const HIT_EVENTS = []; // { x, y, t }
const RECENT_RABBIT_PAIRS = new Map(); // key -> timestamp of last heart

setInterval(() => {
  const now = Date.now();
  // Fox energy drain
  for (const p of players.values()) {
    if (!p.inGame || !p.alive) continue;
    if (p.species === 'fox') {
      p.energyMs -= 100;
      if (p.energyMs <= 0) {
        // Fox dies and returns to lobby
        p.alive = false;
        p.inGame = false;
        p.eatenCount = 0;
        p.speedMul = 1;
        lobbyQueue.add(p.id);
        io.to(p.id).emit('outOfEnergy');
      }
    }
  }

  // Collisions
  const ps = Array.from(players.values()).filter(p => p.inGame && p.alive);
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (distanceSq(a, b) <= COLLIDE_RADIUS * COLLIDE_RADIUS) {
        if (a.species === 'rabbit' && b.species === 'rabbit') {
          // Rabbit meet: spawn heart with cooldown for the pair and grant an extra slot (bounded)
          const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          const last = RECENT_RABBIT_PAIRS.get(k) || 0;
          if (now - last > 1500) { // 1.5s cooldown per pair
            RECENT_RABBIT_PAIRS.set(k, now);
            HEART_EVENTS.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: now });
            const curr = Number(settings.maxRabbits) || 0;
            settings.maxRabbits = Math.min(500, curr + 1); // cap to avoid runaway growth
            saveSettings();
            updateStats({ hearts: 1 });
            tryAdmitFromLobby();
          }
        } else if (a.species !== b.species) {
          // Fox eats rabbit
          const fox = a.species === 'fox' ? a : b;
          const rabbit = a.species === 'rabbit' ? a : b;
          // Remove rabbit to lobby
          rabbit.alive = false;
          rabbit.inGame = false;
          lobbyQueue.add(rabbit.id);
          io.to(rabbit.id).emit('eaten');

          // Fox gains energy and speed bonus
          fox.energyMs = Math.min(FOX_ENERGY_MAX, fox.energyMs + FOX_ENERGY_GAIN_PER_RABBIT);
          fox.eatenCount = (fox.eatenCount || 0) + 1;
          fox.speedMul = FOX_SPEED_BONUS;
          setTimeout(() => { const f = players.get(fox.id); if (f) f.speedMul = 1; }, 5000);
          updateStats({ rabbitsEaten: 1 });
          HIT_EVENTS.push({ x: rabbit.x, y: rabbit.y, t: now });

          // Fox reproduction after 2 rabbits: grant new fox slot once
          if (fox.eatenCount >= 2 && !fox.hasReproduced) {
            fox.hasReproduced = true;
            settings.maxFoxes += 1;
            saveSettings();
            updateStats({ foxBirths: 1 });
            tryAdmitFromLobby();
          }
        }
      }
    }
  }

  // Clean up old heart events (>1.5s)
  while (HEART_EVENTS.length && now - HEART_EVENTS[0].t > 1500) HEART_EVENTS.shift();
  // Clean up old hit events (>700ms)
  while (HIT_EVENTS.length && now - HIT_EVENTS[0].t > 700) HIT_EVENTS.shift();

  io.emit('tick', { state: snapshot(), hearts: HEART_EVENTS, hits: HIT_EVENTS });
}, 100);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
