export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      const id = env.TIGER_ROOM.idFromName("main-arena");
      return env.TIGER_ROOM.get(id).fetch(request);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const id = env.TIGER_ROOM.idFromName("main-arena");
    return env.TIGER_ROOM.get(id).fetch(request);
  }
};

const WORLD = 4200;

const FOOD_TARGET = 140;
const TICK_MS = 33;
const BROADCAST_MS = 50;
const MAX_FOOD_SEND = 150;

const TOP_KEY = "top10_v2";
const BESTS_KEY = "player_bests_v1";
const PLAYERS_KEY = "known_players_v1";
const ATTEMPTS_KEY = "login_attempts_v1";

const COLORS = [
  "#ff8a00",
  "#ffb000",
  "#ff6a00",
  "#d96b00",
  "#ff3b30",
  "#ffe14a"
];

const FLAGS = [
  "🇧🇪", "🇨🇿", "🇵🇱", "🇩🇪", "🇭🇺", "🇨🇭",
  "🇮🇹", "🇬🇧", "🇫🇷", "🇪🇸", "🇬🇷"
];

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
    this.playerBests = [];
    this.knownPlayers = [];
    this.loginAttempts = [];

    this.state.blockConcurrencyWhile(async () => {
      const storedTop = (await this.state.storage.get(TOP_KEY)) || [];
      const storedBests = (await this.state.storage.get(BESTS_KEY)) || [];
      const storedPlayers = (await this.state.storage.get(PLAYERS_KEY)) || [];
      const storedAttempts = (await this.state.storage.get(ATTEMPTS_KEY)) || [];

      this.top10 = normalizeTop10(storedTop);

      this.playerBests = normalizePlayerBests(
        storedBests.length ? storedBests : this.top10
      );

      this.top10 = normalizeTop10(this.playerBests);
      this.knownPlayers = Array.isArray(storedPlayers) ? storedPlayers : [];
      this.loginAttempts = Array.isArray(storedAttempts) ? storedAttempts : [];
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return this.adminResponse(request);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    server.id = crypto.randomUUID();
    server.ip = request.headers.get("CF-Connecting-IP") || "unknown";
    server.ua = request.headers.get("User-Agent") || "unknown";

    server.addEventListener("message", evt => this.onMessage(server, evt.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    server.send(JSON.stringify({
      type: "welcome",
      id: server.id,
      game: "Tigergames Online",
      world: WORLD,
      top10: this.top10,
      countryTop3: this.countryTop3()
    }));

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  adminResponse(request) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";

    if (!this.env.ADMIN_TOKEN || token !== this.env.ADMIN_TOKEN) {
      return json({ ok: false, error: "Unauthorized tiger move" }, 401);
    }

    const online = [...this.players.values()].map(p => ({
      name: p.name,
      nation: p.nation || "OTHER",
      flag: flagOf(p.nation || "OTHER"),
      score: Math.round(p.score || 0),
      alive: !!p.alive,
      len: p.body ? p.body.length : 0
    })).sort((a, b) => b.score - a.score);

    return json({
      ok: true,
      game: "Tigergames Online",
      now: Date.now(),
      onlineCount: online.length,
      online,
      top10: this.top10,
      countryTop3: this.countryTop3(),
      knownPlayers: this.knownPlayers.slice(0, 200),
      loginAttempts: this.loginAttempts.slice(0, 200)
    });
  }

  async onMessage(ws, raw) {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {
      const name = safeName(msg.name || "Tiger");
      const nation = safeNation(msg.nation || "OTHER");

      await this.logLoginAttempt(name, nation, ws);
      await this.rememberPlayer(name, nation);

      const p = this.createPlayer(ws.id, name, nation);

      this.players.set(ws, p);

      this.inputs.set(ws.id, {
        angle: Math.random() * Math.PI * 2,
        boost: false
      });

      this.broadcast({
        type: "event",
        text: `${flagOf(nation)} ${name} joined Tigergames Online 🐯`
      });

      this.ensureLoop();
      this.broadcastState(true);
      return;
    }

    if (msg.type === "input") {
      const p = this.players.get(ws);

      if (!p || !p.alive) return;

      this.inputs.set(p.id, {
        angle: Number(msg.angle) || p.angle,
        boost: !!msg.boost
      });

      return;
    }

    if (msg.type === "respawn") {
      const old = this.players.get(ws);

      if (!old) return;

      this.players.set(
        ws,
        this.createPlayer(old.id, old.name, old.nation)
      );

      this.inputs.set(old.id, {
        angle: Math.random() * Math.PI * 2,
        boost: false
      });

      this.ensureLoop();
      this.broadcastState(true);
    }
  }

  onClose(ws) {
    const p = this.players.get(ws);

    if (p) {
      this.saveTop(p.name, Math.round(p.score), p.nation);
    }

    this.players.delete(ws);
    this.inputs.delete(ws.id);
  }

  async rememberPlayer(name, nation = "OTHER") {
    name = safeName(name);
    nation = safeNation(nation);

    const existing = this.knownPlayers.find(
      x => safeName(x.name).toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      existing.nation = nation;
      existing.flag = flagOf(nation);
      existing.lastSeen = Date.now();
      existing.times = Number(existing.times || 0) + 1;
    } else {
      this.knownPlayers.push({
        name,
        nation,
        flag: flagOf(nation),
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        times: 1
      });
    }

    this.knownPlayers.sort((a, b) => b.lastSeen - a.lastSeen);
    this.knownPlayers = this.knownPlayers.slice(0, 200);

    await this.state.storage.put(PLAYERS_KEY, this.knownPlayers);
  }

  async logLoginAttempt(name, nation, ws) {
    nation = safeNation(nation);

    this.loginAttempts.unshift({
      name: safeName(name),
      nation,
      flag: flagOf(nation),
      at: Date.now(),
      ip: ws.ip || "unknown",
      ua: String(ws.ua || "unknown").slice(0, 160)
    });

    this.loginAttempts = this.loginAttempts.slice(0, 200);
    await this.state.storage.put(ATTEMPTS_KEY, this.loginAttempts);
  }

  createPlayer(id, name, nation = "OTHER") {
    const a = Math.random() * Math.PI * 2;
    const x = rand(300, WORLD - 300);
    const y = rand(300, WORLD - 300);

    const p = {
      id,
      name,
      nation: safeNation(nation),
      x,
      y,
      angle: a,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      skin: "tigerDragon",
      score: 0,
      alive: true,
      body: [],
      radius: 13
    };

    for (let i = 0; i < 20; i++) {
      p.body.push({
        x: x - Math.cos(a) * i * 12,
        y: y - Math.sin(a) * i * 12
      });
    }

    return p;
  }

  ensureLoop() {
    if (this.tickHandle) return;

    this.seedFood();
    this.lastTick = Date.now();
    this.lastBroadcast = 0;

    this.tickHandle = setInterval(() => {
      this.tick();
    }, TICK_MS);
  }

  tick() {
    if (this.players.size === 0) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      return;
    }

    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.06);
    this.lastTick = now;

    this.seedFood();

    for (const p of this.players.values()) {
      if (p.alive) {
        this.updatePlayer(p, dt);
      }
    }

    this.handleEating();
    this.handleCrashes();

    if (now - this.lastBroadcast >= BROADCAST_MS) {
      this.lastBroadcast = now;
      this.broadcastState(false);
    }
  }

  updatePlayer(p, dt) {
    const input = this.inputs.get(p.id) || {
      angle: p.angle,
      boost: false
    };

    p.angle += angleDiff(p.angle, input.angle) * Math.min(1, dt * 9.5);

    const len = p.body.length || 20;

    /*
      Movement balance:
      - Kleine spelers blijven snel en wendbaar.
      - Grote spelers worden trager.
      - Boost blijft nuttig, maar grote spelers worden geen raket meer.
    */
    const sizeSlowdown = Math.min(95, Math.log(len / 20 + 1) * 58);

    const baseSpeed = Math.max(115, 270 - sizeSlowdown);
    const boostBonus = Math.max(65, 145 - sizeSlowdown * 0.45);

    const canBoost = input.boost && len > 28;
    const speed = baseSpeed + (canBoost ? boostBonus : 0);

    if (canBoost && Math.random() < 0.22) {
      const tail = p.body.pop();

      if (tail) {
        this.food.push(makeFood(
          tail.x + rand(-8, 8),
          tail.y + rand(-8, 8),
          rand(5, 8),
          1.1
        ));
      }

      p.score = Math.max(0, p.score - 0.035);
    }

    p.x = clamp(
      p.x + Math.cos(p.angle) * speed * dt,
      20,
      WORLD - 20
    );

    p.y = clamp(
      p.y + Math.sin(p.angle) * speed * dt,
      20,
      WORLD - 20
    );

    p.body.unshift({
      x: p.x,
      y: p.y
    });

    const maxLen = Math.floor(20 + p.score * 1.25);

    while (p.body.length > maxLen) {
      p.body.pop();
    }

    p.radius = clamp(
      11 + Math.sqrt(p.body.length) * 1.04,
      13,
      30
    );
  }

  handleEating() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;

      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];

        if (
          dist2(p.x, p.y, f.x, f.y) <
          (p.radius + f.r + 8) ** 2
        ) {
          p.score += f.v;
          this.food.splice(i, 1);
        }
      }
    }
  }

  handleCrashes() {
    const all = [...this.players.values()].filter(p => p.alive);

    for (const p of all) {
      if (
        p.x <= 22 ||
        p.x >= WORLD - 22 ||
        p.y <= 22 ||
        p.y >= WORLD - 22
      ) {
        this.kill(p, null, "border");
        continue;
      }

      for (let i = 18; i < p.body.length; i += 4) {
        const seg = p.body[i];

        if (
          dist2(p.x, p.y, seg.x, seg.y) <
          (p.radius + 7) ** 2
        ) {
          this.kill(p, p, "self");
          break;
        }
      }

      if (!p.alive) continue;

      for (const other of all) {
        if (p === other || !other.alive) continue;

        for (let i = 8; i < other.body.length; i += 4) {
          const seg = other.body[i];

          if (
            dist2(p.x, p.y, seg.x, seg.y) <
            (p.radius + 9) ** 2
          ) {
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

    if (killer && killer !== dead) {
      killer.score += 10;
    }

    this.saveTop(dead.name, Math.round(dead.score), dead.nation);

    for (let i = 0; i < dead.body.length; i += 5) {
      const b = dead.body[i];

      this.food.push(makeFood(
        b.x + rand(-18, 18),
        b.y + rand(-18, 18),
        rand(5, 9),
        rand(1.2, 3.1)
      ));
    }

    let text = `${flagOf(dead.nation)} ${dead.name} died 💀`;

    if (reason === "self") {
      text = `${flagOf(dead.nation)} ${dead.name} ate his own tiger tail 🐯`;
    } else if (reason === "border") {
      text = `${flagOf(dead.nation)} ${dead.name} left the Tiger zone 💀`;
    } else if (killer) {
      text = `${flagOf(killer.nation)} ${killer.name} destroyed ${flagOf(dead.nation)} ${dead.name} 🐯`;
    }

    this.broadcast({
      type: "event",
      text
    });

    this.broadcastState(true);
  }

  seedFood() {
    while (this.food.length < FOOD_TARGET) {
      this.food.push(makeFood(
        rand(50, WORLD - 50),
        rand(50, WORLD - 50),
        rand(5, 8),
        rand(0.8, 2.2)
      ));
    }

    if (this.food.length > FOOD_TARGET + 130) {
      this.food.splice(0, this.food.length - (FOOD_TARGET + 130));
    }
  }

  broadcastState(force = false) {
    const players = [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      nation: p.nation || "OTHER",
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      angle: Math.round(p.angle * 1000) / 1000,
      color: p.color,
      skin: p.skin,
      score: Math.round(p.score * 10) / 10,
      alive: p.alive,
      radius: Math.round(p.radius * 10) / 10,
      len: p.body.length,
      body: p.body
        .filter((_, i) => i % 3 === 0)
        .map(b => ({
          x: Math.round(b.x * 10) / 10,
          y: Math.round(b.y * 10) / 10
        }))
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
      game: "Tigergames Online",
      world: WORLD,
      players,
      food,
      top10: this.top10,
      countryTop3: this.countryTop3(),
      force
    }));
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

  async saveTop(name, score, nation = "OTHER") {
    name = safeName(name);
    nation = safeNation(nation);
    score = Math.round(score);

    if (!score || score < 1) return;

    const existingBest = this.playerBests.find(
      x => safeName(x.name).toLowerCase() === name.toLowerCase()
    );

    if (existingBest) {
      if (score > Number(existingBest.score || 0)) {
        existingBest.score = score;
        existingBest.nation = nation;
        existingBest.at = Date.now();
      } else if (!existingBest.nation || existingBest.nation === "OTHER") {
        existingBest.nation = nation;
      }
    } else {
      this.playerBests.push({
        name,
        nation,
        score,
        at: Date.now()
      });
    }

    this.playerBests = normalizePlayerBests(this.playerBests);
    this.top10 = normalizeTop10(this.playerBests);

    await this.state.storage.put(BESTS_KEY, this.playerBests);
    await this.state.storage.put(TOP_KEY, this.top10);
  }

  countryTop3() {
    const totals = new Map();

    for (const p of this.playerBests || []) {
      const nation = safeNation(p.nation || "OTHER");
      const score = Math.round(Number(p.score || 0));

      if (!score) continue;

      totals.set(nation, (totals.get(nation) || 0) + score);
    }

    return [...totals.entries()]
      .map(([nation, score]) => ({
        nation,
        flag: flagOf(nation),
        name: countryName(nation),
        score
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }
}

function makeFood(x, y, r, v) {
  return {
    x,
    y,
    r,
    v,
    flag: FLAGS[Math.floor(Math.random() * FLAGS.length)]
  };
}

function normalizeTop10(list) {
  return normalizePlayerBests(list)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function normalizePlayerBests(list) {
  const clean = Array.isArray(list) ? list : [];
  const byName = new Map();

  for (const item of clean) {
    const name = safeName(item.name || "Tiger");
    const nation = safeNation(item.nation || "OTHER");
    const score = Math.round(Number(item.score || 0));

    if (!score) continue;

    const key = name.toLowerCase();
    const old = byName.get(key);

    if (!old || score > old.score) {
      byName.set(key, {
        name,
        nation,
        score,
        at: Number(item.at || Date.now())
      });
    } else if (old.nation === "OTHER" && nation !== "OTHER") {
      old.nation = nation;
      byName.set(key, old);
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 500);
}

function safeName(v) {
  return (
    String(v)
      .replace(/[<>"&]/g, "")
      .trim()
      .slice(0, 16) || "Tiger"
  );
}

function safeNation(v) {
  const n = String(v || "OTHER").toUpperCase();

  const allowed = [
    "BE",
    "CZ",
    "HU",
    "CH",
    "IT",
    "ES",
    "DE",
    "GR",
    "PL",
    "UK",
    "OTHER"
  ];

  return allowed.includes(n) ? n : "OTHER";
}

function flagOf(nation) {
  const flags = {
    BE: "🇧🇪",
    CZ: "🇨🇿",
    HU: "🇭🇺",
    CH: "🇨🇭",
    IT: "🇮🇹",
    ES: "🇪🇸",
    DE: "🇩🇪",
    GR: "🇬🇷",
    PL: "🇵🇱",
    UK: "🇬🇧",
    OTHER: "🏳️"
  };

  return flags[safeNation(nation)] || "🏳️";
}

function countryName(nation) {
  const names = {
    BE: "Belgium",
    CZ: "Czech Republic",
    HU: "Hungary",
    CH: "Switzerland",
    IT: "Italy",
    ES: "Spain",
    DE: "Germany",
    GR: "Greece",
    PL: "Poland",
    UK: "UK",
    OTHER: "Other"
  };

  return names[safeNation(nation)] || "Other";
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

function angleDiff(a, b) {
  return Math.atan2(
    Math.sin(b - a),
    Math.cos(b - a)
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
