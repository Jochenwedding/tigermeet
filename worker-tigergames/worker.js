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

const FLAG_FOOD_TARGET = 125;
const PIC_SNACK_TARGET = 18;
const ARNOLD_TARGET = 4;
const ARNOLD_SPAWN_MS = 60000;

const TICK_MS = 16;
const BROADCAST_MS = 50;
const MAX_FOOD_SEND = 170;

const BOT_TARGET = 5;
const BOT_RESPAWN_MS = 5000;
const BOT_THINK_MS = 260;

const BOOST_ACTIVE_MS = 3000;
const BOOST_TOTAL_COOLDOWN_MS = 18000;

const TOP_KEY = "top10_v2";
const PLAYERS_KEY = "known_players_v1";
const ATTEMPTS_KEY = "login_attempts_v1";
const COUNTRY_KEY = "country_top_v1";

const COLORS = ["#ff8a00", "#ffb000", "#ff6a00", "#d96b00", "#ff3b30", "#ffe14a"];

const FLAGS = [
  "🇧🇪","🇺🇸","🇳🇱","🇹🇷","🇵🇹","🇸🇪","🇳🇴","🇩🇰","🇫🇮","🇷🇴","🇧🇬","🇨🇴",
  "🇨🇿","🇵🇱","🇩🇪","🇭🇺","🇨🇭","🇮🇹","🇬🇧","🇫🇷","🇪🇸","🇬🇷"
];

const NATION_FLAGS = {
  BE:"🇧🇪", US:"🇺🇸", USA:"🇺🇸", NL:"🇳🇱", TR:"🇹🇷", PT:"🇵🇹",
  SE:"🇸🇪", NO:"🇳🇴", DK:"🇩🇰", FI:"🇫🇮", RO:"🇷🇴", BG:"🇧🇬", CO:"🇨🇴",
  CZ:"🇨🇿", PL:"🇵🇱", DE:"🇩🇪", HU:"🇭🇺", CH:"🇨🇭", IT:"🇮🇹",
  GB:"🇬🇧", UK:"🇬🇧", FR:"🇫🇷", ES:"🇪🇸", GR:"🇬🇷", OTHER:"🏳️"
};

const TOPGUN_NAMES = ["Maverick", "Iceman", "Goose", "Viper", "Jester"];
const BOT_NATIONS = ["US", "US", "US", "US", "US"];

const PIC_SNACKS = ["pic2.webp", "pic3.webp", "pic4.webp"];

export class TigerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.players = new Map();
    this.bots = new Map();
    this.inputs = new Map();
    this.food = [];

    this.lastTick = Date.now();
    this.lastBroadcast = 0;
    this.tickHandle = null;

    this.top10 = [];
    this.knownPlayers = [];
    this.loginAttempts = [];
    this.countryScores = [];

    this.lastBotThink = 0;
    this.lastBotRespawn = 0;
    this.lastArnoldSpawn = Date.now() - ARNOLD_SPAWN_MS + 5000;

    this.state.blockConcurrencyWhile(async () => {
      this.top10 = normalizeTop10((await this.state.storage.get(TOP_KEY)) || []);
      this.knownPlayers = (await this.state.storage.get(PLAYERS_KEY)) || [];
      this.loginAttempts = (await this.state.storage.get(ATTEMPTS_KEY)) || [];
      this.countryScores = normalizeCountryScores((await this.state.storage.get(COUNTRY_KEY)) || []);
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

    return new Response(null, { status: 101, webSocket: client });
  }

  adminResponse(request) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";

    if (!this.env.ADMIN_TOKEN || token !== this.env.ADMIN_TOKEN) {
      return json({ ok: false, error: "Unauthorized tiger move" }, 401);
    }

    const online = [...this.players.values()].map(p => ({
      name: p.name,
      nation: p.nation,
      score: Math.round(p.score || 0),
      alive: !!p.alive,
      len: p.body ? p.body.length : 0
    })).sort((a, b) => b.score - a.score);

    return json({
      ok: true,
      game: "Tigergames Online",
      now: Date.now(),
      onlineCount: online.length,
      botCount: this.bots.size,
      arnoldOnMap: this.food.some(f => f.type === "arnold"),
      online,
      top10: this.top10,
      countryTop3: this.countryTop3(),
      countryScores: this.countryScores,
      knownPlayers: this.knownPlayers.slice(0, 200),
      loginAttempts: this.loginAttempts.slice(0, 200)
    });
  }

  async onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      const name = safeName(msg.name || "Tiger");
      const nation = safeNation(msg.nation || "OTHER");

      this.logLoginAttempt(name, nation, ws).catch(() => {});
      this.rememberPlayer(name, nation).catch(() => {});

      const p = this.createPlayer(ws.id, name, false, nation);

      this.players.set(ws, p);
      this.inputs.set(ws.id, {
        angle: Math.random() * Math.PI * 2,
        boost: false
      });

      this.broadcast({ type: "event", text: `${name} joined Tigergames Online 🐯` });

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

      this.players.set(ws, this.createPlayer(old.id, old.name, false, old.nation || "OTHER"));
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
      this.saveTop(p.name, Math.round(p.score)).catch(() => {});
      this.saveCountryScore(p.nation, Math.round(p.score)).catch(() => {});
    }
    this.players.delete(ws);
    this.inputs.delete(ws.id);
  }

  createPlayer(id, name, bot = false, nation = "OTHER") {
    const a = Math.random() * Math.PI * 2;
    const x = rand(300, WORLD - 300);
    const y = rand(300, WORLD - 300);

    const p = {
      id,
      name,
      nation: safeNation(nation),
      bot,
      x,
      y,
      angle: a,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      skin: "tigerDragon",
      score: bot ? rand(5, 24) : 0,
      alive: true,
      body: [],
      radius: 13,
      bornAt: Date.now(),
      nextBoostAt: Date.now() + rand(5000, 12000),
      boosting: false,
      boostActiveUntil: 0,
      boostCooldownUntil: 0
    };

    const startLen = bot ? Math.floor(rand(20, 38)) : 20;

    for (let i = 0; i < startLen; i++) {
      p.body.push({
        x: x - Math.cos(a) * i * 12,
        y: y - Math.sin(a) * i * 12
      });
    }

    return p;
  }

  createBot() {
    const index = this.bots.size % TOPGUN_NAMES.length;
    const name = TOPGUN_NAMES[index];
    const id = "bot-" + crypto.randomUUID();

    const bot = this.createPlayer(id, name, true, BOT_NATIONS[index] || "US");

    this.bots.set(id, bot);
    this.inputs.set(id, {
      angle: bot.angle,
      boost: false
    });
  }

  ensureBots() {
    while (this.bots.size < BOT_TARGET) this.createBot();
  }

  ensureLoop() {
    if (this.tickHandle) return;

    this.seedFood();
    this.ensureBots();

    this.lastTick = Date.now();
    this.lastBroadcast = 0;

    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    if (this.players.size === 0) {
      this.bots.clear();

      for (const id of [...this.inputs.keys()]) {
        if (String(id).startsWith("bot-")) this.inputs.delete(id);
      }

      clearInterval(this.tickHandle);
      this.tickHandle = null;
      return;
    }

    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.04);
    this.lastTick = now;

    this.seedFood();

    if (now - this.lastBotThink >= BOT_THINK_MS) {
      this.lastBotThink = now;
      this.updateBotBrains();
    }

    for (const p of this.allPlayers()) {
      if (p.alive) this.updatePlayer(p, dt, now);
    }

    this.handleEating();
    this.handleCrashes();

    if (now - this.lastBotRespawn >= BOT_RESPAWN_MS) {
      this.lastBotRespawn = now;
      this.cleanupAndRespawnBots();
    }

    if (now - this.lastBroadcast >= BROADCAST_MS) {
      this.lastBroadcast = now;
      this.broadcastState(false);
    }
  }

  allPlayers() {
    return [...this.players.values(), ...this.bots.values()];
  }

  realPlayers() {
    return [...this.players.values()];
  }

  updateBotBrains() {
    const now = Date.now();
    const humans = this.realPlayers().filter(p => p.alive);
    const all = this.allPlayers().filter(p => p.alive);

    for (const bot of this.bots.values()) {
      if (!bot.alive) continue;

      let targetAngle = bot.angle + rand(-1.2, 1.2);
      let boost = false;

      const nearestHuman = nearest(bot, humans, 700);
      const nearestFood = nearest(bot, this.food, 1050);
      const danger = nearestDanger(bot, all);

      if (danger && danger.d < bot.radius + danger.other.radius + 75) {
        targetAngle = Math.atan2(bot.y - danger.y, bot.x - danger.x);

        if (now > bot.nextBoostAt && bot.body.length > 45 && Math.random() < 0.16) {
          boost = true;
          bot.nextBoostAt = now + rand(9000, 18000);
        }
      } else if (nearestHuman && bot.body.length > 34) {
        const h = nearestHuman.item;
        const clearlyBigger = bot.body.length > h.body.length * 1.35;
        const closeEnough = nearestHuman.d < 390;

        if (clearlyBigger && closeEnough && Math.random() < 0.72) {
          const lead = 0.16;
          const hx = h.x + Math.cos(h.angle || 0) * nearestHuman.d * lead;
          const hy = h.y + Math.sin(h.angle || 0) * nearestHuman.d * lead;

          targetAngle = Math.atan2(hy - bot.y, hx - bot.x);

          boost = nearestHuman.d < 320 &&
            Math.random() < 0.25 &&
            bot.body.length > 45 &&
            now > bot.nextBoostAt;

          if (boost) bot.nextBoostAt = now + rand(10000, 20000);
        } else if (nearestFood) {
          targetAngle = Math.atan2(nearestFood.item.y - bot.y, nearestFood.item.x - bot.x);
        }
      } else if (nearestFood) {
        targetAngle = Math.atan2(nearestFood.item.y - bot.y, nearestFood.item.x - bot.x);
      }

      if (bot.x < 260) targetAngle = 0;
      if (bot.x > WORLD - 260) targetAngle = Math.PI;
      if (bot.y < 260) targetAngle = Math.PI / 2;
      if (bot.y > WORLD - 260) targetAngle = -Math.PI / 2;

      this.inputs.set(bot.id, {
        angle: targetAngle,
        boost
      });
    }
  }

  updatePlayer(p, dt, now) {
    const input = this.inputs.get(p.id) || {
      angle: p.angle,
      boost: false
    };

    const turnRate = Math.max(2.2, 6.5 - Math.min(4, p.body.length * 0.018));
    p.angle += angleDiff(p.angle, input.angle) * Math.min(1, dt * turnRate);

    if (input.boost && !p.boosting && p.body.length > 30 && now >= Number(p.boostCooldownUntil || 0)) {
      p.boosting = true;
      p.boostActiveUntil = now + BOOST_ACTIVE_MS;
    }

    if (p.boosting && now >= p.boostActiveUntil) {
      p.boosting = false;
      p.boostCooldownUntil = now + BOOST_TOTAL_COOLDOWN_MS;
    }

    const len = p.body.length;
    const slowdown = Math.min(85, len * 0.085);
    const baseSpeed = 270;
    const minSpeed = 185;
    const normalSpeed = Math.max(minSpeed, baseSpeed - slowdown);

    const canBoost = p.boosting && p.body.length > 30;
    const boostBonus = canBoost ? 115 : 0;
    const speed = normalSpeed + boostBonus;

    if (canBoost && Math.random() < 0.18) {
      const tail = p.body.pop();

      if (tail) {
        this.food.push(makeFood(
          tail.x + rand(-8, 8),
          tail.y + rand(-8, 8),
          rand(5, 8),
          1.1,
          "flag"
        ));
      }

      p.score = Math.max(0, p.score - 0.025);
    }

    p.x = clamp(p.x + Math.cos(p.angle) * speed * dt, 20, WORLD - 20);
    p.y = clamp(p.y + Math.sin(p.angle) * speed * dt, 20, WORLD - 20);

    p.body.unshift({ x: p.x, y: p.y });

    const growthScore = Math.min(p.score, 2600);
    const maxLen = Math.floor(20 + growthScore * 1.2);

    while (p.body.length > maxLen) p.body.pop();

    const radiusGrowthLen = Math.min(p.body.length, 1300);
    p.radius = clamp(11 + Math.sqrt(radiusGrowthLen) * 1.04, 13, 38);
  }

  handleEating() {
    for (const p of this.allPlayers()) {
      if (!p.alive) continue;

      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        const eatRadius = p.radius + f.r + (f.type === "arnold" ? 16 : 8);

        if (dist2(p.x, p.y, f.x, f.y) < eatRadius ** 2) {
          p.score += f.v;

          if (f.type === "arnold") {
            this.broadcast({
              type: "event",
              text: `${p.name} ate Arnold Pikaar Schwarzenegger. Nomnomnom extra protein is on the menu boys.`
            });
          }

          this.food.splice(i, 1);
        }
      }
    }
  }

  handleCrashes() {
    const all = this.allPlayers().filter(p => p.alive);

    for (const p of all) {
      if (!p.alive) continue;

      if (p.x <= 22 || p.x >= WORLD - 22 || p.y <= 22 || p.y >= WORLD - 22) {
        this.kill(p, null, "border");
        continue;
      }

      const selfStart = Math.max(32, Math.floor(p.radius * 1.35));

      for (let i = selfStart; i < p.body.length; i += 7) {
        const seg = p.body[i];
        const selfHitRadius = p.radius * 0.62 + 5;

        if (dist2(p.x, p.y, seg.x, seg.y) < selfHitRadius ** 2) {
          this.kill(p, p, "self");
          break;
        }
      }

      if (!p.alive) continue;

      for (const other of all) {
        if (p === other || !other.alive) continue;

        const headDist = Math.sqrt(dist2(p.x, p.y, other.x, other.y));
        const headHitRadius = (p.radius + other.radius) * 0.70;

        if (headDist < headHitRadius) {
          this.resolveHeadOn(p, other);
          break;
        }

        const startIndex = Math.max(11, Math.floor(other.radius * 0.95));

        for (let i = startIndex; i < other.body.length; i += 6) {
          const seg = other.body[i];

          const visualBodyRadius = other.radius * 0.70;
          const visualHeadRadius = p.radius * 0.58;
          const hitRadius = visualHeadRadius + visualBodyRadius;

          if (dist2(p.x, p.y, seg.x, seg.y) < hitRadius ** 2) {
            this.kill(p, other, "player");
            break;
          }
        }

        if (!p.alive) break;
      }
    }
  }

  resolveHeadOn(a, b) {
    if (!a.alive || !b.alive) return;

    const aPower = a.body.length + a.score * 0.22;
    const bPower = b.body.length + b.score * 0.22;
    const diff = Math.abs(aPower - bPower);
    const tieZone = Math.max(12, Math.min(a.radius, b.radius) * 0.8);

    if (diff < tieZone) {
      this.kill(a, b, "headon");
      this.kill(b, a, "headon");
      return;
    }

    if (aPower > bPower) this.kill(b, a, "headon");
    else this.kill(a, b, "headon");
  }

  kill(dead, killer, reason) {
    if (!dead.alive) return;

    dead.alive = false;
    dead.boosting = false;

    if (killer && killer !== dead && killer.alive) {
      killer.score += dead.bot ? 20 : 50;
    }

    if (!dead.bot) {
      this.saveTop(dead.name, Math.round(dead.score)).catch(() => {});
      this.saveCountryScore(dead.nation, Math.round(dead.score)).catch(() => {});
    }

    for (let i = 0; i < dead.body.length; i += 4) {
      const b = dead.body[i];

      this.food.push(makeFood(
        b.x + rand(-18, 18),
        b.y + rand(-18, 18),
        rand(5, 9),
        rand(1.2, 3.1),
        Math.random() < 0.10 ? "picSnack" : "flag"
      ));
    }

    let text = `${dead.name} died 💀`;

    if (reason === "self") text = `${dead.name} ate his own tiger tail 🐯`;
    else if (reason === "border") text = `${dead.name} left the Tiger zone 💀`;
    else if (reason === "headon" && killer && killer !== dead) text = `${killer.name} won the head-on against ${dead.name} 💥`;
    else if (killer && killer !== dead) text = `${killer.name} destroyed ${dead.name} 🐯`;

    if (!dead.bot || !killer?.bot) {
      this.broadcast({ type: "event", text });
    }

    this.broadcastState(true);
  }

  cleanupAndRespawnBots() {
    for (const [id, bot] of this.bots.entries()) {
      if (!bot.alive) {
        this.bots.delete(id);
        this.inputs.delete(id);
      }
    }

    this.ensureBots();
  }

  seedFood() {
    const now = Date.now();

    const arnoldCount = this.food.filter(f => f.type === "arnold").length;
    const picSnackCount = this.food.filter(f => f.type === "picSnack").length;
    const flagCount = this.food.filter(f => f.type === "flag").length;
if (arnoldCount < ARNOLD_TARGET && now - this.lastArnoldSpawn >= ARNOLD_SPAWN_MS) {
  this.lastArnoldSpawn = now;

  this.food.push(makeFood(
    rand(170, WORLD - 170),
    rand(170, WORLD - 170),
    38,
    100,
    "arnold"
  ));

  this.broadcast({
    type: "event",
    text: "Arnold Pikaar Schwarzenegger has spawned."
  });
}

      this.broadcast({
        type: "event",
        text: "Arnold Pikaar Schwarzenegger has spawned."
      });
    }

    for (let i = picSnackCount; i < PIC_SNACK_TARGET; i++) {
      const pos = this.findFoodSpot(95);
      this.food.push(makeFood(pos.x, pos.y, rand(7, 10), 5, "picSnack"));
    }

    for (let i = flagCount; i < FLAG_FOOD_TARGET; i++) {
      const pos = this.findFoodSpot(75);
      this.food.push(makeFood(pos.x, pos.y, rand(5, 8), rand(0.8, 2.2), "flag"));
    }

    const maxFood = FLAG_FOOD_TARGET + PIC_SNACK_TARGET + ARNOLD_TARGET + 80;

    if (this.food.length > maxFood) {
      this.food.splice(0, this.food.length - maxFood);
    }
  }

  findFoodSpot(minDistance = 70) {
    for (let tries = 0; tries < 18; tries++) {
      const x = rand(50, WORLD - 50);
      const y = rand(50, WORLD - 50);

      let ok = true;
      for (const f of this.food) {
        if (dist2(x, y, f.x, f.y) < minDistance * minDistance) {
          ok = false;
          break;
        }
      }

      if (ok) return { x, y };
    }

    return {
      x: rand(50, WORLD - 50),
      y: rand(50, WORLD - 50)
    };
  }

  broadcastState(force = false) {
    const now = Date.now();
    const all = this.allPlayers();

    const players = all.map(p => {
      const stride = p.body.length > 900 ? 7 : p.body.length > 450 ? 6 : p.body.length > 160 ? 4 : 3;

      const boostActiveMs = p.boosting
        ? Math.max(0, Number(p.boostActiveUntil || 0) - now)
        : 0;

      const boostCooldownMs = !p.boosting
        ? Math.max(0, Number(p.boostCooldownUntil || 0) - now)
        : 0;

      return {
        id: p.id,
        name: p.name,
        nation: p.nation || "OTHER",
        bot: !!p.bot,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        angle: Math.round(p.angle * 1000) / 1000,
        color: p.color,
        skin: p.skin,
        score: Math.round(p.score * 10) / 10,
        alive: p.alive,
        radius: Math.round(p.radius * 10) / 10,
        len: p.body.length,
        boosting: !!p.boosting,
        boostActiveMs,
        boostCooldownMs,
        body: p.body
          .filter((_, i) => i % stride === 0)
          .map(b => ({
            x: Math.round(b.x * 10) / 10,
            y: Math.round(b.y * 10) / 10
          }))
      };
    });

    const food = shuffled(this.food)
      .slice(0, MAX_FOOD_SEND)
      .map(f => ({
        x: Math.round(f.x),
        y: Math.round(f.y),
        r: Math.round(f.r),
        v: Math.round(f.v * 10) / 10,
        flag: f.flag,
        type: f.type || "flag",
        img: f.img || null
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

  countryTop3() {
    const map = new Map();

    for (const c of this.countryScores) {
      const nation = safeNation(c.nation || "OTHER");
      map.set(nation, {
        nation,
        name: nation,
        flag: NATION_FLAGS[nation] || "🏳️",
        score: Number(c.score || 0)
      });
    }

    for (const p of this.realPlayers()) {
      if (!p.alive) continue;

      const nation = safeNation(p.nation || "OTHER");
      const old = map.get(nation) || {
        nation,
        name: nation,
        flag: NATION_FLAGS[nation] || "🏳️",
        score: 0
      };

      old.score = Math.max(old.score, Number(p.score || 0));
      map.set(nation, old);
    }

    return [...map.values()]
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
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
    name = safeName(name);
    score = Math.round(score);

    if (!score || score < 1) return;

    const existing = this.top10.find(
      x => safeName(x.name).toLowerCase() === name.toLowerCase()
    );

    let changed = false;

    if (existing) {
      if (score > existing.score) {
        existing.score = score;
        existing.at = Date.now();
        changed = true;
      }
    } else {
      this.top10.push({ name, score, at: Date.now() });
      changed = true;
    }

    if (!changed) return;

    this.top10 = normalizeTop10(this.top10);
    await this.state.storage.put(TOP_KEY, this.top10);
  }

  async saveCountryScore(nation, score) {
    nation = safeNation(nation);
    score = Math.round(Number(score || 0));

    if (!score || score < 1) return;

    const existing = this.countryScores.find(x => safeNation(x.nation) === nation);

    if (existing) {
      if (score > Number(existing.score || 0)) {
        existing.score = score;
        existing.at = Date.now();
      }
    } else {
      this.countryScores.push({
        nation,
        score,
        at: Date.now()
      });
    }

    this.countryScores = normalizeCountryScores(this.countryScores);
    await this.state.storage.put(COUNTRY_KEY, this.countryScores);
  }

  async rememberPlayer(name, nation = "OTHER") {
    name = safeName(name);
    nation = safeNation(nation);

    const existing = this.knownPlayers.find(
      x => x.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      existing.nation = nation;
      existing.lastSeen = Date.now();
      existing.times = Number(existing.times || 0) + 1;
    } else {
      this.knownPlayers.push({
        name,
        nation,
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
    this.loginAttempts.unshift({
      name: safeName(name),
      nation: safeNation(nation),
      at: Date.now(),
      ip: ws.ip || "unknown",
      ua: String(ws.ua || "unknown").slice(0, 160)
    });

    this.loginAttempts = this.loginAttempts.slice(0, 200);
    await this.state.storage.put(ATTEMPTS_KEY, this.loginAttempts);
  }
}

function makeFood(x, y, r, v, type = "flag") {
  if (type === "arnold") {
    return {
      x,
      y,
      r,
      v: 100,
      type: "arnold",
      img: "pic1.webp",
      flag: null
    };
  }

  if (type === "picSnack") {
    return {
      x,
      y,
      r,
      v: 5,
      type: "picSnack",
      img: PIC_SNACKS[Math.floor(Math.random() * PIC_SNACKS.length)],
      flag: null
    };
  }

  return {
    x,
    y,
    r,
    v,
    type: "flag",
    img: null,
    flag: FLAGS[Math.floor(Math.random() * FLAGS.length)]
  };
}

function nearest(from, items, maxDist) {
  let best = null;
  let bestD2 = maxDist * maxDist;

  for (const item of items) {
    if (!item || item === from || item.alive === false) continue;

    const d2 = dist2(from.x, from.y, item.x, item.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = item;
    }
  }

  return best ? { item: best, d: Math.sqrt(bestD2) } : null;
}

function nearestDanger(bot, all) {
  let best = null;
  let bestD2 = 999999999;

  for (const other of all) {
    if (!other || other === bot || !other.alive) continue;

    const d2 = dist2(bot.x, bot.y, other.x, other.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = other;
    }
  }

  if (!best) return null;

  return {
    other: best,
    x: best.x,
    y: best.y,
    d: Math.sqrt(bestD2)
  };
}

function normalizeTop10(list) {
  const clean = Array.isArray(list) ? list : [];
  const byName = new Map();

  for (const item of clean) {
    const name = safeName(item.name || "Tiger");
    const score = Math.round(Number(item.score || 0));

    if (!score) continue;

    const key = name.toLowerCase();
    const old = byName.get(key);

    if (!old || score > old.score) {
      byName.set(key, {
        name,
        score,
        at: Number(item.at || Date.now())
      });
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function normalizeCountryScores(list) {
  const clean = Array.isArray(list) ? list : [];
  const byNation = new Map();

  for (const item of clean) {
    const nation = safeNation(item.nation || "OTHER");
    const score = Math.round(Number(item.score || 0));

    if (!score) continue;

    const old = byNation.get(nation);

    if (!old || score > old.score) {
      byNation.set(nation, {
        nation,
        score,
        at: Number(item.at || Date.now())
      });
    }
  }

  return [...byNation.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function safeName(v) {
  return String(v).replace(/[<>"&]/g, "").trim().slice(0, 16) || "Tiger";
}

function safeNation(v) {
  const key = String(v || "OTHER").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 5);
  if (key === "GB") return "UK";
  if (key === "USA") return "US";
  return NATION_FLAGS[key] ? key : "OTHER";
}

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i];
    copy[i] = copy[j];
    copy[j] = t;
  }
  return copy;
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
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
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
