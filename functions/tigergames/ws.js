const WORLD = 4200;
const FOOD_TARGET = 450;

const BOT_TARGET = 7;
const BOT_THINK_MS = 350;
const BOT_CHASE_DISTANCE = 1250;
const BOT_FOOD_DISTANCE = 900;

const SPAWN_PROTECTION_MS = 2500;
const HEAD_HITBOX_FACTOR = 0.55;
const BODY_HITBOX = 7;
const BODY_SKIP_START = 14;
const BODY_CHECK_STEP = 4;

const COLORS = [
  '#ff8a00',
  '#2f80ff',
  '#27d17f',
  '#b45cff',
  '#ff3b30',
  '#00d5ff',
  '#ffe14a',
  '#ff62c8',
  '#9cff57',
  '#ff6a3d'
];

const BOT_NAMES = [
  'TigerBot',
  'AraxosBot',
  'CISBot',
  'BeerBot',
  'RadarBot',
  'F16Bot',
  'SlapBot',
  'WowieBot',
  'SprinklerBot'
];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }

  const id = env.TIGER_ROOM.idFromName('main-arena');
  return env.TIGER_ROOM.get(id).fetch(request);
}

export class TigerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.players = new Map();
    this.bots = new Map();
    this.inputs = new Map();

    this.food = [];
    this.lastTick = Date.now();
    this.tickHandle = null;
    this.top5 = [];

    this.state.blockConcurrencyWhile(async () => {
      this.top5 = (await this.state.storage.get('top5')) || [];
    });
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    const id = crypto.randomUUID();
    server.id = id;

    server.addEventListener('message', evt => this.onMessage(server, evt.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));

    server.send(JSON.stringify({ type: 'welcome', id }));

    this.ensureLoop();

    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(ws, raw) {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const name = safeName(msg.name || 'Tiger');
      const p = this.createPlayer(ws.id, name, false);

      this.players.set(ws, p);

      this.inputs.set(ws.id, {
        angle: Math.random() * Math.PI * 2,
        boost: false
      });

      this.broadcast({
        type: 'event',
        text: `${name} joined TigerGames 🐯`
      });

      return;
    }

    if (msg.type === 'input') {
      const p = this.players.get(ws);
      if (!p) return;

      this.inputs.set(p.id, {
        angle: Number(msg.angle) || 0,
        boost: !!msg.boost
      });

      return;
    }

    if (msg.type === 'respawn') {
      const old = this.players.get(ws);
      if (!old) return;

      this.players.set(ws, this.createPlayer(old.id, old.name, false));

      this.inputs.set(old.id, {
        angle: Math.random() * Math.PI * 2,
        boost: false
      });
    }
  }

  onClose(ws) {
    const p = this.players.get(ws);

    if (p && !p.bot) {
      this.saveTop(p.name, Math.round(p.score));
    }

    this.players.delete(ws);
    this.inputs.delete(ws.id);
  }

  createPlayer(id, name, bot = false) {
    const a = Math.random() * Math.PI * 2;
    const x = rand(300, WORLD - 300);
    const y = rand(300, WORLD - 300);

    const p = {
      id,
      name,
      bot,
      x,
      y,
      angle: a,
      color: bot ? '#777777' : COLORS[Math.floor(Math.random() * COLORS.length)],
      score: 0,
      alive: true,
      body: [],
      radius: 13,
      spawnedAt: Date.now(),
      lastKillerId: null,
      nextThinkAt: 0,
      targetAngle: a
    };

    for (let i = 0; i < 22; i++) {
      p.body.push({
        x: x - Math.cos(a) * i * 11,
        y: y - Math.sin(a) * i * 11
      });
    }

    return p;
  }

  createBot() {
    const id = 'bot-' + crypto.randomUUID();
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const bot = this.createPlayer(id, name, true);

    this.bots.set(id, bot);

    this.inputs.set(id, {
      angle: bot.angle,
      boost: false
    });
  }

  ensureBots() {
    while (this.bots.size < BOT_TARGET) {
      this.createBot();
    }
  }

  getAllPlayers() {
    return [
      ...this.players.values(),
      ...this.bots.values()
    ];
  }

  ensureLoop() {
    if (this.tickHandle) return;

    this.seedFood();
    this.ensureBots();
    this.lastTick = Date.now();

    this.tickHandle = setInterval(() => this.tick(), 50);
  }

  tick() {
    if (this.players.size === 0) {
      this.bots.clear();
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      return;
    }

    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.06);
    this.lastTick = now;

    this.seedFood();
    this.ensureBots();
    this.updateBots(now);

    for (const p of this.getAllPlayers()) {
      if (p.alive) this.updatePlayer(p, dt);
    }

    this.handleEating();
    this.handleCrashes();
    this.cleanupBots();
    this.broadcastState();
  }

  updateBots(now) {
    const humans = [...this.players.values()].filter(p => p.alive);
    const bots = [...this.bots.values()].filter(p => p.alive);

    for (const bot of bots) {
      if (now < bot.nextThinkAt) continue;

      bot.nextThinkAt = now + BOT_THINK_MS + rand(-80, 120);

      let target = null;
      let bestDist = Infinity;

      for (const h of humans) {
        const d = dist2(bot.x, bot.y, h.x, h.y);

        if (d < bestDist && d < BOT_CHASE_DISTANCE * BOT_CHASE_DISTANCE) {
          bestDist = d;
          target = h;
        }
      }

      if (target) {
        const predictedX = target.x + Math.cos(target.angle) * 180;
        const predictedY = target.y + Math.sin(target.angle) * 180;

        bot.targetAngle = Math.atan2(predictedY - bot.y, predictedX - bot.x);

        this.inputs.set(bot.id, {
          angle: bot.targetAngle,
          boost: bot.body.length > 30 && bestDist > 160 * 160 && bestDist < 850 * 850
        });

        continue;
      }

      let foodTarget = null;
      let foodDist = Infinity;

      for (const f of this.food) {
        const d = dist2(bot.x, bot.y, f.x, f.y);

        if (d < foodDist && d < BOT_FOOD_DISTANCE * BOT_FOOD_DISTANCE) {
          foodDist = d;
          foodTarget = f;
        }
      }

      if (foodTarget) {
        bot.targetAngle = Math.atan2(foodTarget.y - bot.y, foodTarget.x - bot.x);
      } else {
        bot.targetAngle += rand(-0.8, 0.8);
      }

      if (bot.x < 250) bot.targetAngle = 0;
      if (bot.x > WORLD - 250) bot.targetAngle = Math.PI;
      if (bot.y < 250) bot.targetAngle = Math.PI / 2;
      if (bot.y > WORLD - 250) bot.targetAngle = -Math.PI / 2;

      this.inputs.set(bot.id, {
        angle: bot.targetAngle,
        boost: false
      });
    }
  }

  cleanupBots() {
    for (const [id, bot] of this.bots.entries()) {
      if (!bot.alive) {
        this.bots.delete(id);
        this.inputs.delete(id);
      }
    }
  }

  updatePlayer(p, dt) {
    const input = this.inputs.get(p.id) || {
      angle: p.angle,
      boost: false
    };

    p.angle += angleDiff(p.angle, input.angle) * Math.min(1, dt * 7.2);

    const canBoost = input.boost && p.body.length > 26;
    const speed = 165 + Math.max(0, 70 - p.body.length * 0.25) + (canBoost ? 125 : 0);

    if (canBoost && Math.random() < 0.52) {
      const tail = p.body.pop();

      if (tail) {
        this.food.push({
          x: tail.x,
          y: tail.y,
          r: 6,
          v: 1.2
        });
      }

      p.score = Math.max(0, p.score - 0.04);
    }

    p.x = clamp(p.x + Math.cos(p.angle) * speed * dt, 18, WORLD - 18);
    p.y = clamp(p.y + Math.sin(p.angle) * speed * dt, 18, WORLD - 18);

    p.body.unshift({
      x: p.x,
      y: p.y
    });

    const maxLen = Math.floor(22 + p.score * 2.2);

    while (p.body.length > maxLen) {
      p.body.pop();
    }

    p.radius = clamp(11 + Math.sqrt(p.body.length) * 1.18, 13, 36);
  }

  handleEating() {
    for (const p of this.getAllPlayers()) {
      if (!p.alive) continue;

      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];

        if (dist2(p.x, p.y, f.x, f.y) < (p.radius + f.r + 9) ** 2) {
          p.score += f.v;
          this.food.splice(i, 1);
        }
      }
    }
  }

  handleCrashes() {
    const all = this.getAllPlayers().filter(p => p.alive);
    const now = Date.now();

    for (const p of all) {
      if (now - p.spawnedAt < SPAWN_PROTECTION_MS) continue;

      const headHitbox = Math.max(8, p.radius * HEAD_HITBOX_FACTOR);

      for (const other of all) {
        if (p === other) continue;
        if (now - other.spawnedAt < 600) continue;

        for (let i = BODY_SKIP_START; i < other.body.length - BODY_CHECK_STEP; i += BODY_CHECK_STEP) {
          const a = other.body[i];
          const b = other.body[i + BODY_CHECK_STEP];

          if (!a || !b) continue;

          const d = pointToSegmentDist2(p.x, p.y, a.x, a.y, b.x, b.y);
          const hit = headHitbox + BODY_HITBOX;

          if (d < hit * hit) {
            this.kill(p, other);
            break;
          }
        }

        if (!p.alive) break;
      }
    }
  }

  kill(dead, killer) {
    if (!dead.alive) return;

    dead.alive = false;
    dead.lastKillerId = killer.id;

    killer.score += dead.bot ? 2 : 10;

    if (!dead.bot) {
      this.saveTop(dead.name, Math.round(dead.score));
    }

    for (let i = 0; i < dead.body.length; i += 2) {
      const b = dead.body[i];

      this.food.push({
        x: b.x + rand(-18, 18),
        y: b.y + rand(-18, 18),
        r: rand(5, 9),
        v: rand(1.4, 3.5)
      });
    }

    const killerName = killer.bot ? 'A bot' : killer.name;
    const deadName = dead.bot ? 'a bot' : dead.name;

    this.broadcast({
      type: 'event',
      text: `${killerName} at ${deadName} op 🐯`
    });
  }

  seedFood() {
    while (this.food.length < FOOD_TARGET) {
      this.food.push({
        x: rand(40, WORLD - 40),
        y: rand(40, WORLD - 40),
        r: rand(4, 7),
        v: rand(0.7, 2.1)
      });
    }
  }

  broadcastState() {
    const players = this.getAllPlayers().map(p => ({
      id: p.id,
      name: p.bot ? '' : p.name,
      x: p.x,
      y: p.y,
      color: p.color,
      score: p.bot ? 0 : p.score,
      alive: p.alive,
      radius: p.radius,
      len: p.body.length,
      bot: !!p.bot,
      body: p.body.filter((_, i) => i % 2 === 0)
    }));

    const msg = JSON.stringify({
      type: 'state',
      players,
      food: this.food.slice(0, 450),
      top5: this.top5
    });

    this.broadcastRaw(msg);
  }

  broadcast(obj) {
    this.broadcastRaw(JSON.stringify(obj));
  }

  broadcastRaw(msg) {
    for (const ws of this.players.keys()) {
      try {
        ws.send(msg);
      } catch {
        this.onClose(ws);
      }
    }
  }

  async saveTop(name, score) {
    if (!score || score < 1) return;

    this.top5.push({
      name,
      score,
      at: Date.now()
    });

    this.top5.sort((a, b) => b.score - a.score);
    this.top5 = this.top5.slice(0, 5);

    await this.state.storage.put('top5', this.top5);
  }
}

function safeName(v) {
  return String(v).replace(/[<>"&]/g, '').trim().slice(0, 16) || 'Tiger';
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dist2(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;

  return dx * dx + dy * dy;
}

function pointToSegmentDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;

  const wx = px - ax;
  const wy = py - ay;

  const len2 = vx * vx + vy * vy;

  if (len2 === 0) {
    return dist2(px, py, ax, ay);
  }

  let t = (wx * vx + wy * vy) / len2;
  t = clamp(t, 0, 1);

  const cx = ax + t * vx;
  const cy = ay + t * vy;

  return dist2(px, py, cx, cy);
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
