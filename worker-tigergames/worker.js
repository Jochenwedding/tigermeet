export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const id = env.TIGER_ROOM.idFromName("main-arena");
    return env.TIGER_ROOM.get(id).fetch(request);
  }
};

const WORLD = 4200;
const FOOD_TARGET = 180;
const TICK_MS = 45;
const BROADCAST_MS = 140;
const MAX_FOOD_SEND = 190;
const TOP_KEY = "top10_v2";

const COLORS = ["#ff8a00", "#ffb000", "#ff6a00", "#d96b00", "#ff3b30", "#ffe14a"];

const FLAGS = ["🇨🇿","🇵🇱","🇩🇪","🇭🇺","🇨🇭","🇮🇹","🇬🇧","🇫🇷","🇪🇸","🇬🇷"];

export class TigerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map();
    this.inputs = new Map();
    this.food = [];
    this.lastTick = Date.now();
    this.lastBroadcast = 0;
    this.tickHandle = null;
    this.top10 = [];

    this.state.blockConcurrencyWhile(async () => {
      this.top10 = normalizeTop10((await this.state.storage.get(TOP_KEY)) || []);
    });
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    server.id = crypto.randomUUID();

    server.addEventListener("message", evt => this.onMessage(server, evt.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    server.send(JSON.stringify({
      type: "welcome",
      id: server.id,
      game: "Tiger.io",
      world: WORLD,
      top10: this.top10
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      const name = safeName(msg.name || "Tiger");
      const p = this.createPlayer(ws.id, name);

      this.players.set(ws, p);
      this.inputs.set(ws.id, { angle: Math.random() * Math.PI * 2, boost: false });

      this.broadcast({ type: "event", text: `${name} joined Tiger.io 🐯` });
      this.ensureLoop();
      this.broadcastState(true);
      return;
    }

    if (msg.type === "input") {
      const p = this.players.get(ws);
      if (!p || !p.alive) return;
      this.inputs.set(p.id, { angle: Number(msg.angle) || p.angle, boost: !!msg.boost });
      return;
    }

    if (msg.type === "respawn") {
      const old = this.players.get(ws);
      if (!old) return;

      this.players.set(ws, this.createPlayer(old.id, old.name));
      this.inputs.set(old.id, { angle: Math.random() * Math.PI * 2, boost: false });

      this.ensureLoop();
      this.broadcastState(true);
    }
  }

  onClose(ws) {
    const p = this.players.get(ws);
    if (p) this.saveTop(p.name, Math.round(p.score));
    this.players.delete(ws);
    this.inputs.delete(ws.id);
  }

  createPlayer(id, name) {
    const a = Math.random() * Math.PI * 2;
    const x = rand(300, WORLD - 300);
    const y = rand(300, WORLD - 300);

    const p = {
      id, name, x, y, angle: a,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      skin: "tigerDragon",
      score: 0,
      alive: true,
      body: [],
      radius: 13
    };

    for (let i = 0; i < 20; i++) {
      p.body.push({ x: x - Math.cos(a) * i * 12, y: y - Math.sin(a) * i * 12 });
    }

    return p;
  }

  ensureLoop() {
    if (this.tickHandle) return;

    this.seedFood();
    this.lastTick = Date.now();
    this.lastBroadcast = 0;

    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    if (this.players.size === 0) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      return;
    }

    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.075);
    this.lastTick = now;

    this.seedFood();

    for (const p of this.players.values()) {
      if (p.alive) this.updatePlayer(p, dt);
    }

    this.handleEating();
    this.handleCrashes();

    if (now - this.lastBroadcast >= BROADCAST_MS) {
      this.lastBroadcast = now;
      this.broadcastState(false);
    }
  }

  updatePlayer(p, dt) {
    const input = this.inputs.get(p.id) || { angle: p.angle, boost: false };

    p.angle += angleDiff(p.angle, input.angle) * Math.min(1, dt * 8.5);

    const canBoost = input.boost && p.body.length > 28;
    const speed = 195 + Math.max(0, 60 - p.body.length * 0.16) + (canBoost ? 140 : 0);

    if (canBoost && Math.random() < 0.30) {
      const tail = p.body.pop();
      if (tail) this.food.push(makeFood(tail.x + rand(-8, 8), tail.y + rand(-8, 8), rand(5, 8), 1.1));
      p.score = Math.max(0, p.score - 0.035);
    }

    p.x = clamp(p.x + Math.cos(p.angle) * speed * dt, 20, WORLD - 20);
    p.y = clamp(p.y + Math.sin(p.angle) * speed * dt, 20, WORLD - 20);

    p.body.unshift({ x: Math.round(p.x), y: Math.round(p.y) });

    const maxLen = Math.floor(20 + p.score * 1.35);
    while (p.body.length > maxLen) p.body.pop();

    p.radius = clamp(11 + Math.sqrt(p.body.length) * 1.08, 13, 32);
  }

  handleEating() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;

      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        if (dist2(p.x, p.y, f.x, f.y) < (p.radius + f.r + 8) ** 2) {
          p.score += f.v;
          this.food.splice(i, 1);
        }
      }
    }
  }

  handleCrashes() {
    const all = [...this.players.values()].filter(p => p.alive);

    for (const p of all) {
      if (p.x <= 22 || p.x >= WORLD - 22 || p.y <= 22 || p.y >= WORLD - 22) {
        this.kill(p, null, "border");
        continue;
      }

      for (let i = 16; i < p.body.length; i += 4) {
        const seg = p.body[i];
        if (dist2(p.x, p.y, seg.x, seg.y) < (p.radius + 7) ** 2) {
          this.kill(p, p, "self");
          break;
        }
      }

      if (!p.alive) continue;

      for (const other of all) {
        if (p === other || !other.alive) continue;

        for (let i = 8; i < other.body.length; i += 4) {
          const seg = other.body[i];
          if (dist2(p.x, p.y, seg.x, seg.y) < (p.radius + 9) ** 2) {
            this.kill(p, other, "player");
            break;
          }
        }

        if (!p.alive) break;
      }
    }
  }

  kill(dead, killer, reason) {
    if (!dead.alive) return;

    dead.alive = false;

    if (killer && killer !== dead) killer.score += 10;

    this.saveTop(dead.name, Math.round(dead.score));

    for (let i = 0; i < dead.body.length; i += 4) {
      const b = dead.body[i];
      this.food.push(makeFood(b.x + rand(-18, 18), b.y + rand(-18, 18), rand(5, 9), rand(1.2, 3.1)));
    }

    let text = `${dead.name} died 💀`;
    if (reason === "self") text = `${dead.name} ate his own tiger tail 🐯`;
    else if (reason === "border") text = `${dead.name} left the Tiger zone 💀`;
    else if (killer) text = `${killer.name} destroyed ${dead.name} 🐯`;

    this.broadcast({ type: "event", text });
    this.broadcastState(true);
  }

  seedFood() {
    while (this.food.length < FOOD_TARGET) {
      this.food.push(makeFood(rand(50, WORLD - 50), rand(50, WORLD - 50), rand(5, 8), rand(0.8, 2.2)));
    }

    if (this.food.length > FOOD_TARGET + 160) {
      this.food.splice(0, this.food.length - (FOOD_TARGET + 160));
    }
  }

  broadcastState(force = false) {
    const players = [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      angle: Number(p.angle.toFixed(3)),
      color: p.color,
      skin: p.skin,
      score: Math.round(p.score * 10) / 10,
      alive: p.alive,
      radius: Math.round(p.radius),
      len: p.body.length,
      body: p.body.filter((_, i) => i % 4 === 0).map(b => ({ x: b.x, y: b.y }))
    }));

    const food = this.food.slice(0, MAX_FOOD_SEND).map(f => ({
      x: Math.round(f.x),
      y: Math.round(f.y),
      r: Math.round(f.r),
      v: Math.round(f.v * 10) / 10,
      flag: f.flag
    }));

    this.broadcastRaw(JSON.stringify({
      type: "state",
      game: "Tiger.io",
      world: WORLD,
      players,
      food,
      top10: this.top10,
      force
    }));
  }

  broadcast(obj) {
    this.broadcastRaw(JSON.stringify(obj));
  }

  broadcastRaw(msg) {
    for (const ws of this.players.keys()) {
      try { ws.send(msg); } catch { this.onClose(ws); }
    }
  }

  async saveTop(name, score) {
    if (!score || score < 1) return;

    this.top10.push({ name: safeName(name), score: Math.round(score), at: Date.now() });
    this.top10 = normalizeTop10(this.top10);

    await this.state.storage.put(TOP_KEY, this.top10);
  }
}

function makeFood(x, y, r, v) {
  return { x, y, r, v, flag: FLAGS[Math.floor(Math.random() * FLAGS.length)] };
}

function normalizeTop10(list) {
  const clean = Array.isArray(list) ? list : [];
  clean.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return clean.slice(0, 10).map(x => ({
    name: safeName(x.name || "Tiger"),
    score: Math.round(Number(x.score || 0)),
    at: Number(x.at || Date.now())
  }));
}

function safeName(v) {
  return String(v).replace(/[<>"&]/g, "").trim().slice(0, 16) || "Tiger";
}

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist2(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy;
}
function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
