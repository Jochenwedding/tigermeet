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

const SNACK_TARGET = 58;
const ARNOLD_TARGET = 4;

const GAY_TARGET = 2;
const GAY2_TARGET = 2;
const ZEUS_TARGET = 1;

const HAZARD_KILL_SCORE = 25;
const ARNOLD_SPAWN_MS = 60000;

const MORPHEUS_FIRST_SPAWN_MS = 120000;
const MORPHEUS_REPEAT_SPAWN_MS = 180000;
const MORPHEUS_GATE_DELAY_MS = 10000;
const MORPHEUS_PILL_TARGET_EACH = 14;

const OUTSIDE_PILL_LIMIT_EACH = 1;
const OUTSIDE_PILL_CHECK_MS = 45000;

const TICK_MS = 16;
const BROADCAST_MS = 50;
const MAX_FOOD_SEND = 135;

const BOT_TARGET = 5;
const BOT_RESPAWN_MS = 5000;
const BOT_THINK_MS = 260;

const BOOST_ACTIVE_MS = 3000;
const BOOST_TOTAL_COOLDOWN_MS = 18000;

const RED_PILL_MS = 10000;
const BLUE_PILL_MS = 10000;
const BUFF_COOLDOWN_MS = 30000;

const HAZARD_RESPAWN_MS = 60000;
const ZEUS_SHOT_MS = 2000;

const TOP_KEY = "top10_v2";
const PLAYERS_KEY = "known_players_v1";
const ATTEMPTS_KEY = "login_attempts_v1";
const COUNTRY_KEY = "country_top_v1";

const COLORS = ["#ff8a00", "#ffb000", "#ff6a00", "#d96b00", "#ff3b30", "#ffe14a"];

const NATION_FLAGS = {
  BE:"🇧🇪", US:"🇺🇸", USA:"🇺🇸", NL:"🇳🇱", TR:"🇹🇷", PT:"🇵🇹",
  SE:"🇸🇪", NO:"🇳🇴", DK:"🇩🇰", FI:"🇫🇮", RO:"🇷🇴", BG:"🇧🇬", CO:"🇨🇴",
  CZ:"🇨🇿", PL:"🇵🇱", DE:"🇩🇪", HU:"🇭🇺", CH:"🇨🇭", IT:"🇮🇹",
  GB:"🇬🇧", UK:"🇬🇧", FR:"🇫🇷", ES:"🇪🇸", GR:"🇬🇷", OTHER:"🏳️"
};

const TOPGUN_NAMES = ["Maverick", "Iceman", "Goose", "Viper", "Jester"];
const BOT_NATIONS = ["US", "US", "US", "US", "US"];

const SNACK_IMAGES = ["pic2.webp", "pic3.webp", "pic4.webp", "pic5.webp", "pic6.webp", "pic7.webp"];

const MORPHEUS_SPAWNS = [
  { x: 980,  y: 980,  variant: 0 },
  { x: 3220, y: 980,  variant: 1 },
  { x: 980,  y: 3220, variant: 2 },
  { x: 3220, y: 3220, variant: 3 }
];

export class TigerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.players = new Map();
    this.bots = new Map();
    this.inputs = new Map();

    this.food = [];
    this.hazards = [];
    this.projectiles = [];
    this.morpheusEvent = null;

    this.lastTick = Date.now();
    this.lastBroadcast = 0;
    this.tickHandle = null;

    this.top10 = [];
    this.knownPlayers = [];
    this.loginAttempts = [];
    this.countryScores = [];

    this.lastBotThink = 0;
    this.lastBotRespawn = 0;
    this.lastArnoldSpawn = Date.now() - ARNOLD_SPAWN_MS + 3000;
    this.nextMorpheusSpawnAt = Date.now() + MORPHEUS_FIRST_SPAWN_MS;
    this.lastOutsidePillCheck = 0;
    this.morpheusSpawnIndex = 0;

    this.lastEvent = {
      id: "",
      type: "",
      text: "",
      at: 0,
      mazeUnlockAt: 0
    };

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

    const now = Date.now();

    const online = [...this.players.values()].map(p => ({
      name: p.name,
      nation: p.nation,
      score: Math.round(p.score || 0),
      alive: !!p.alive,
      len: p.body ? p.body.length : 0,
      shieldMs: Math.max(0, Number(p.shieldUntil || 0) - now),
      speedMs: Math.max(0, Number(p.speedUntil || 0) - now),
      matrixImmuneMs: Math.max(0, Number(p.matrixImmuneUntil || 0) - now),
      buffCooldownMs: Math.max(0, Number(p.buffCooldownUntil || 0) - now)
    })).sort((a, b) => b.score - a.score);

    return json({
      ok: true,
      game: "Tigergames Online",
      now,
      onlineCount: online.length,
      botCount: this.bots.size,
      morpheusActive: !!this.morpheusEvent,
      arnoldOnMap: this.food.filter(f => f.type === "arnold").length,
      gayOnMap: this.hazards.filter(h => h.alive && h.type === "gay").length,
      gay2OnMap: this.hazards.filter(h => h.alive && h.type === "gay2").length,
      zeusOnMap: this.hazards.filter(h => h.alive && h.type === "zeus").length,
      lightningCount: this.projectiles.length,
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

      this.emitEvent(`${name} joined Tigergames Online 🐯`, "join");
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
      this.saveTop(p.name, Math.round(p.score), p.nation).catch(() => {});
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
      boostCooldownUntil: 0,

      shieldUntil: 0,
      speedUntil: 0,
      matrixImmuneUntil: 0,
      buffCooldownUntil: 0
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
    this.ensureHazards(Date.now());

    this.lastTick = Date.now();
    this.lastBroadcast = 0;

    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    if (this.players.size === 0) {
      this.bots.clear();
      this.hazards = [];
      this.projectiles = [];
      this.morpheusEvent = null;
      this.food = [];

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
    this.ensureHazards(now);
    this.updateMorpheusGate(now);

    if (now - this.lastBotThink >= BOT_THINK_MS) {
      this.lastBotThink = now;
      this.updateBotBrains();
    }

    for (const p of this.allPlayers()) {
      if (p.alive) this.updatePlayer(p, dt, now);
    }

    this.updateHazards(dt, now);
    this.updateProjectiles(dt, now);

    this.handleEating(now);
    this.handleCrashes(now);
    this.handleMazeWallCrashes(now);
    this.handleHazardHits(now);

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

  emitEvent(text = "", eventType = "", extra = {}) {
    this.lastEvent = {
      id: crypto.randomUUID(),
      type: eventType || "",
      text: text || "",
      at: Date.now(),
      mazeUnlockAt: extra.mazeUnlockAt || 0
    };

    this.broadcast({
      type: "event",
      text: text || "",
      eventType: eventType || "",
      eventId: this.lastEvent.id,
      ...extra
    });
  }

  updateBotBrains() {
    const now = Date.now();
    const humans = this.realPlayers().filter(p => p.alive);
    const all = this.allPlayers().filter(p => p.alive);

    for (const bot of this.bots.values()) {
      if (!bot.alive) continue;

      let targetAngle = bot.angle + rand(-1.1, 1.1);
      let boost = false;

      const nearestHuman = nearest(bot, humans, 740);
      const nearestFood = nearest(bot, this.food.filter(f => f.type !== "morpheus"), 1200);
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
      } else if (this.morpheusEvent && this.morpheusEvent.active && Math.random() < 0.24) {
        targetAngle = Math.atan2(this.morpheusEvent.center.y - bot.y, this.morpheusEvent.center.x - bot.x);
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

    const turnRate = Math.max(2.4, 6.9 - Math.min(3.6, Math.sqrt(p.body.length) * 0.17));
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
    const slowdown = Math.min(58, Math.sqrt(len) * 1.7);

    const baseSpeed = 282;
    const minSpeed = 112;
    const normalSpeed = Math.max(minSpeed, baseSpeed - slowdown);

    const canBoost = p.boosting && p.body.length > 30;
    const boostBonus = canBoost ? 108 : 0;
    const redPillMultiplier = now < Number(p.speedUntil || 0) ? 2 : 1;

    const speed = (normalSpeed + boostBonus) * redPillMultiplier;

    if (canBoost && Math.random() < 0.16) {
      const tail = p.body.pop();
      if (tail) {
        this.food.push(makeFood(
          tail.x + rand(-8, 8),
          tail.y + rand(-8, 8),
          rand(7, 9),
          1.1,
          "snack"
        ));
      }
      p.score = Math.max(0, p.score - 0.025);
    }

    p.x = clamp(p.x + Math.cos(p.angle) * speed * dt, 20, WORLD - 20);
    p.y = clamp(p.y + Math.sin(p.angle) * speed * dt, 20, WORLD - 20);

    p.body.unshift({ x: p.x, y: p.y });

    const growthScore = Math.min(p.score, 2800);
    const maxLen = Math.floor(20 + growthScore * 1.15);

    while (p.body.length > maxLen) p.body.pop();

    const radiusGrowthLen = Math.min(p.body.length, 1300);
    p.radius = clamp(11 + Math.sqrt(radiusGrowthLen) * 1.04, 13, 38);
  }

  ensureHazards(now) {
    for (const hz of this.hazards) {
      if (!hz.alive && now >= Number(hz.deadUntil || 0)) {
        this.respawnHazard(hz);
      }
    }

    while (this.countAliveHazards("gay") < GAY_TARGET) {
      this.hazards.push(this.makeHazard("gay"));
    }
    while (this.countAliveHazards("gay2") < GAY2_TARGET) {
      this.hazards.push(this.makeHazard("gay2"));
    }
    while (this.countAliveHazards("zeus") < ZEUS_TARGET) {
      this.hazards.push(this.makeHazard("zeus"));
    }
  }

  countAliveHazards(type) {
    return this.hazards.filter(h => h.alive && h.type === type).length;
  }

  makeHazard(type) {
    if (type === "zeus") {
      return {
        id: "zeus-" + crypto.randomUUID(),
        type: "zeus",
        img: "zeus.webp",
        x: 160,
        y: 160,
        r: 106,
        alive: true,
        deadUntil: 0,
        routeIndex: 0,
        lastShotAt: 0
      };
    }

    return {
      id: type + "-" + crypto.randomUUID(),
      type,
      img: type === "gay2" ? "gay2.webp" : "gay.webp",
      x: rand(250, WORLD - 250),
      y: rand(250, WORLD - 250),
      r: 72,
      vx: rand(-15, 15),
      vy: rand(-15, 15),
      alive: true,
      deadUntil: 0
    };
  }

  respawnHazard(hz) {
    if (hz.type === "zeus") {
      hz.alive = true;
      hz.deadUntil = 0;
      hz.x = 160;
      hz.y = 160;
      hz.routeIndex = 0;
      hz.lastShotAt = 0;
      return;
    }

    hz.alive = true;
    hz.deadUntil = 0;
    hz.x = rand(250, WORLD - 250);
    hz.y = rand(250, WORLD - 250);
    hz.vx = rand(-15, 15);
    hz.vy = rand(-15, 15);
  }

  updateHazards(dt, now) {
    const alivePlayers = this.allPlayers().filter(p => p.alive);

    for (const hz of this.hazards) {
      if (!hz.alive) continue;

      if (hz.type === "gay" || hz.type === "gay2") {
        const near = nearest(hz, alivePlayers, 560);
        let targetVx = 0;
        let targetVy = 0;

        if (near) {
          const dx = near.item.x - hz.x;
          const dy = near.item.y - hz.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const speed = hz.type === "gay2" ? 170 : 160;
          targetVx = (dx / d) * speed;
          targetVy = (dy / d) * speed;
        } else {
          targetVx = (hz.vx || 0) + rand(-10, 10);
          targetVy = (hz.vy || 0) + rand(-10, 10);
        }

        hz.vx = lerpNum(hz.vx || 0, clamp(targetVx, -175, 175), 0.06);
        hz.vy = lerpNum(hz.vy || 0, clamp(targetVy, -175, 175), 0.06);

        hz.x = clamp(hz.x + hz.vx * dt, 45, WORLD - 45);
        hz.y = clamp(hz.y + hz.vy * dt, 45, WORLD - 45);

        if (hz.x <= 46 || hz.x >= WORLD - 46) hz.vx *= -0.6;
        if (hz.y <= 46 || hz.y >= WORLD - 46) hz.vy *= -0.6;
        continue;
      }

      if (hz.type === "zeus") {
        const path = [
          { x: 160, y: 160 },
          { x: WORLD - 160, y: 160 },
          { x: WORLD - 160, y: WORLD - 160 },
          { x: 160, y: WORLD - 160 }
        ];

        const target = path[hz.routeIndex % path.length];
        const dx = target.x - hz.x;
        const dy = target.y - hz.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const speed = 110;

        hz.x += (dx / d) * speed * dt;
        hz.y += (dy / d) * speed * dt;

        if (d < 30) hz.routeIndex = (hz.routeIndex + 1) % path.length;

        const shotTarget = nearest(hz, alivePlayers, 620);
        if (shotTarget && now - Number(hz.lastShotAt || 0) >= ZEUS_SHOT_MS) {
          hz.lastShotAt = now;
          this.spawnLightning(hz, shotTarget.item);
          this.emitEvent("", "zeusShot");
        }
      }
    }
  }

  spawnLightning(zeus, target) {
    const dx = target.x - zeus.x;
    const dy = target.y - zeus.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const speed = 860;
    const ttl = Math.min(2200, Math.max(650, (d / speed) * 1000 + 200));

    this.projectiles.push({
      id: "bolt-" + crypto.randomUUID(),
      type: "zeusBolt",
      x: zeus.x,
      y: zeus.y,
      vx: (dx / d) * speed,
      vy: (dy / d) * speed,
      r: 18,
      spawnedAt: Date.now(),
      expiresAt: Date.now() + ttl
    });
  }

  updateProjectiles(dt, now) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (
        now >= Number(p.expiresAt || 0) ||
        p.x < -50 || p.x > WORLD + 50 ||
        p.y < -50 || p.y > WORLD + 50
      ) {
        this.projectiles.splice(i, 1);
        continue;
      }

      for (const player of this.allPlayers()) {
        if (!player.alive) continue;

        const isImmune = now < Number(player.shieldUntil || 0) || now < Number(player.matrixImmuneUntil || 0);
        if (isImmune) continue;

        const hitRadius = p.r + player.radius * 0.55;
        if (dist2(p.x, p.y, player.x, player.y) < hitRadius ** 2) {
          this.kill(player, null, "zeusLightning");
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  updateMorpheusGate(now) {
    if (!this.morpheusEvent || !this.morpheusEvent.active) return;
    if (!this.morpheusEvent.gateOpen && now >= this.morpheusEvent.unlockAt) {
      this.morpheusEvent.gateOpen = true;
      this.emitEvent("GATES OPEN", "matrixGateOpen");
    }
  }

  handleEating(now) {
    for (const p of this.allPlayers()) {
      if (!p.alive) continue;

      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        const eatRadius = p.radius + f.r + (
          f.type === "morpheus" ? 30 :
          f.type === "arnold" ? 24 :
          f.type === "redPill" || f.type === "bluePill" ? 10 :
          7
        );

        if (dist2(p.x, p.y, f.x, f.y) >= eatRadius ** 2) continue;

        if (f.type === "snack") {
          p.score += f.v;
          this.food.splice(i, 1);
          continue;
        }

        if (f.type === "arnold") {
          p.score += 100;
          this.food.splice(i, 1);
          continue;
        }

        if (f.type === "redPill" || f.type === "bluePill") {
          const hasAnyBuff =
            now < Number(p.speedUntil || 0) ||
            now < Number(p.shieldUntil || 0) ||
            now < Number(p.matrixImmuneUntil || 0);
          const buffLocked = now < Number(p.buffCooldownUntil || 0);

          if (hasAnyBuff || buffLocked) continue;

          if (f.type === "redPill") {
            p.speedUntil = now + RED_PILL_MS;
            p.buffCooldownUntil = now + RED_PILL_MS + BUFF_COOLDOWN_MS;
          } else {
            p.shieldUntil = now + BLUE_PILL_MS;
            p.buffCooldownUntil = now + BLUE_PILL_MS + BUFF_COOLDOWN_MS;
          }

          this.food.splice(i, 1);
          continue;
        }

        if (f.type === "morpheus") {
          p.score += 500;
          this.massGrowPlayer(p, 120);
          p.matrixImmuneUntil = now + 5000;
          this.food.splice(i, 1);
          this.clearMorpheusEvent();
          this.emitEvent(`${p.name} has taken Morpheus.`, "morpheusTaken");
          this.emitEvent("THE MATRIX IS COLLAPSING", "matrixCollapse");
          continue;
        }
      }
    }
  }

  massGrowPlayer(p, amount) {
    const last = p.body[p.body.length - 1] || { x: p.x, y: p.y };
    for (let i = 0; i < amount; i++) {
      p.body.push({ x: last.x, y: last.y });
    }
  }

  handleCrashes(now) {
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

        const eitherShielded =
          now < Number(p.shieldUntil || 0) ||
          now < Number(other.shieldUntil || 0) ||
          now < Number(p.matrixImmuneUntil || 0) ||
          now < Number(other.matrixImmuneUntil || 0);

        const headDist = Math.sqrt(dist2(p.x, p.y, other.x, other.y));
        const headHitRadius = (p.radius + other.radius) * 0.70;

        if (!eitherShielded && headDist < headHitRadius) {
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
            if (!eitherShielded) {
              this.kill(p, other, "player");
            }
            break;
          }
        }

        if (!p.alive) break;
      }
    }
  }

  handleMazeWallCrashes(now) {
    if (!this.morpheusEvent || !this.morpheusEvent.active) return;

    const walls = this.morpheusEvent.walls || [];
    const gate = !this.morpheusEvent.gateOpen ? this.morpheusEvent.gate : null;

    for (const p of this.allPlayers()) {
      if (!p.alive) continue;
      if (now < Number(p.matrixImmuneUntil || 0)) continue;

      for (const w of walls) {
        if (circleRectHit(p.x, p.y, p.radius * 0.75, w)) {
          this.kill(p, null, "matrixwall");
          break;
        }
      }

      if (!p.alive) continue;

      if (gate && circleRectHit(p.x, p.y, p.radius * 0.75, gate)) {
        this.kill(p, null, "matrixwall");
      }
    }
  }

  handleHazardHits(now) {
    for (const hz of this.hazards) {
      if (!hz.alive) continue;

      for (const p of this.allPlayers()) {
        if (!p.alive) continue;

        const hitRadius = p.radius + hz.r * 0.46;
        if (dist2(p.x, p.y, hz.x, hz.y) >= hitRadius ** 2) continue;

        const canKillHazard =
          now < Number(p.speedUntil || 0) ||
          now < Number(p.shieldUntil || 0) ||
          now < Number(p.matrixImmuneUntil || 0);

        if (canKillHazard) {
          hz.alive = false;
          hz.deadUntil = now + HAZARD_RESPAWN_MS;
          p.score += HAZARD_KILL_SCORE;

          if (hz.type === "zeus") {
            this.emitEvent(`${p.name} zapped Zeus out of the sky ⚡`, "zeusDown");
          } else {
            this.emitEvent(`${p.name} deleted ${hz.type === "gay2" ? "3CPBROMO" : "ARUGAY2 - Jorrit"} 💥`, "hazardDown");
          }
          continue;
        }

        if (hz.type === "gay" || hz.type === "gay2") {
          this.kill(p, null, "gay");
        } else if (hz.type === "zeus") {
          this.kill(p, null, "zeusTouch");
        }
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
      this.saveTop(dead.name, Math.round(dead.score), dead.nation).catch(() => {});
      this.saveCountryScore(dead.nation, Math.round(dead.score)).catch(() => {});
    }

    for (let i = 0; i < dead.body.length; i += 4) {
      const b = dead.body[i];
      this.food.push(makeFood(
        b.x + rand(-18, 18),
        b.y + rand(-18, 18),
        rand(7, 10),
        rand(1.2, 3.1),
        "snack"
      ));
    }

    let text = `${dead.name} died 💀`;

    if (reason === "self") text = `${dead.name} ate his own tiger tail 🐯`;
    else if (reason === "border") text = `${dead.name} left the Tiger zone 💀`;
    else if (reason === "matrixwall") text = `${dead.name} got deleted by the Matrix wall 💀`;
    else if (reason === "gay") text = `aah lil gay fella i got u — ${dead.name} 💀`;
    else if (reason === "zeusLightning") text = `${dead.name} got smoked by Zeus lightning ⚡`;
    else if (reason === "zeusTouch") text = `${dead.name} touched Zeus and got fried ⚡`;
    else if (reason === "headon" && killer && killer !== dead) text = `${killer.name} won the head-on against ${dead.name} 💥`;
    else if (killer && killer !== dead) text = `${killer.name} destroyed ${dead.name} 🐯`;

    if (!dead.bot || !killer?.bot) {
      this.emitEvent(text, "death");
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

    const snackCount = this.food.filter(f => f.type === "snack").length;
    const arnoldCount = this.food.filter(f => f.type === "arnold").length;

    if (now - this.lastArnoldSpawn >= ARNOLD_SPAWN_MS) {
      this.lastArnoldSpawn = now;
      while (this.food.filter(f => f.type === "arnold").length < ARNOLD_TARGET) {
        const pos = this.findFoodSpot(440);
        this.food.push(makeFood(pos.x, pos.y, 92, 100, "arnold"));
      }
      this.emitEvent("Arnold has spawned.", "arnoldSpawn");
    }

    if (!this.morpheusEvent && now >= this.nextMorpheusSpawnAt) {
      this.spawnMorpheusEvent(now);
      this.nextMorpheusSpawnAt = now + MORPHEUS_REPEAT_SPAWN_MS;
    }

    if (this.morpheusEvent && this.morpheusEvent.active) {
      this.ensureMorpheusPills();
    } else {
      this.ensureRareOutsidePills(now);
    }

    for (let i = snackCount; i < SNACK_TARGET; i++) {
      const pos = this.findFoodSpot(92);
      this.food.push(makeFood(pos.x, pos.y, rand(12, 15), rand(1.3, 5.4), "snack"));
    }

    while (this.food.filter(f => f.type === "snack").length > SNACK_TARGET + 30) {
      const idx = this.food.findIndex(f => f.type === "snack");
      if (idx === -1) break;
      this.food.splice(idx, 1);
    }

    while (this.food.length > MAX_FOOD_SEND + 55) {
      const idx = this.food.findIndex(f => f.type === "snack");
      if (idx === -1) break;
      this.food.splice(idx, 1);
    }
  }

  ensureMorpheusPills() {
    const redCount = this.food.filter(f => f.type === "redPill").length;
    const blueCount = this.food.filter(f => f.type === "bluePill").length;

    for (let i = redCount; i < MORPHEUS_PILL_TARGET_EACH; i++) {
      const pos = this.findFoodSpot(110);
      this.food.push(makeFood(pos.x, pos.y, 22, 0, "redPill"));
    }
    for (let i = blueCount; i < MORPHEUS_PILL_TARGET_EACH; i++) {
      const pos = this.findFoodSpot(110);
      this.food.push(makeFood(pos.x, pos.y, 22, 0, "bluePill"));
    }
  }

  ensureRareOutsidePills(now) {
    if (now - this.lastOutsidePillCheck < OUTSIDE_PILL_CHECK_MS) return;
    this.lastOutsidePillCheck = now;

    const redCount = this.food.filter(f => f.type === "redPill").length;
    const blueCount = this.food.filter(f => f.type === "bluePill").length;

    if (redCount < OUTSIDE_PILL_LIMIT_EACH && Math.random() < 0.30) {
      const pos = this.findFoodSpot(110);
      this.food.push(makeFood(pos.x, pos.y, 22, 0, "redPill"));
    }
    if (blueCount < OUTSIDE_PILL_LIMIT_EACH && Math.random() < 0.30) {
      const pos = this.findFoodSpot(110);
      this.food.push(makeFood(pos.x, pos.y, 22, 0, "bluePill"));
    }
  }

  spawnMorpheusEvent(now) {
    const spawn = MORPHEUS_SPAWNS[this.morpheusSpawnIndex % MORPHEUS_SPAWNS.length];
    this.morpheusSpawnIndex++;

    const maze = buildMatrixMazeVariant(spawn.x, spawn.y, spawn.variant);

    this.morpheusEvent = {
      active: true,
      spawnedAt: now,
      center: { x: spawn.x, y: spawn.y },
      walls: maze.walls,
      gate: maze.gate,
      gateOpen: false,
      unlockAt: now + MORPHEUS_GATE_DELAY_MS
    };

    this.food = this.food.filter(f => f.type !== "morpheus" && f.type !== "redPill" && f.type !== "bluePill");
    this.food.push(makeFood(spawn.x, spawn.y, 120, 500, "morpheus"));
    this.ensureMorpheusPills();

    this.emitEvent("ENTER THE MATRIX", "morpheusSpawn", {
      mazeUnlockAt: this.morpheusEvent.unlockAt
    });
  }

  clearMorpheusEvent() {
    this.morpheusEvent = null;
    this.food = this.food.filter(f => f.type !== "morpheus" && f.type !== "redPill" && f.type !== "bluePill");
  }

  findFoodSpot(minDistance = 70) {
    for (let tries = 0; tries < 22; tries++) {
      const x = rand(80, WORLD - 80);
      const y = rand(80, WORLD - 80);

      let ok = true;

      for (const f of this.food) {
        if (dist2(x, y, f.x, f.y) < minDistance * minDistance) {
          ok = false;
          break;
        }
      }

      if (ok && (!this.morpheusEvent || !pointInAnyRect(x, y, this.morpheusEvent.walls))) {
        return { x, y };
      }
    }

    return {
      x: rand(80, WORLD - 80),
      y: rand(80, WORLD - 80)
    };
  }

  broadcastState(force = false) {
    const now = Date.now();
    const all = this.allPlayers();

    const players = all.map(p => {
      const stride =
        p.body.length > 900 ? 7 :
        p.body.length > 450 ? 6 :
        p.body.length > 160 ? 4 : 3;

      const boostActiveMs = p.boosting
        ? Math.max(0, Number(p.boostActiveUntil || 0) - now)
        : 0;

      const boostCooldownMs = !p.boosting
        ? Math.max(0, Number(p.boostCooldownUntil || 0) - now)
        : 0;

      const shieldMs = Math.max(0, Number(p.shieldUntil || 0) - now);
      const speedMs = Math.max(0, Number(p.speedUntil || 0) - now);
      const matrixImmuneMs = Math.max(0, Number(p.matrixImmuneUntil || 0) - now);
      const buffCooldownMs = Math.max(0, Number(p.buffCooldownUntil || 0) - now);

      return {
        id: p.id,
        name: p.name,
        nation: p.nation || "OTHER",
        bot: !!p.bot,
        x: round1(p.x),
        y: round1(p.y),
        angle: round3(p.angle),
        color: p.color,
        skin: p.skin,
        score: round1(p.score),
        alive: p.alive,
        radius: round1(p.radius),
        len: p.body.length,
        boosting: !!p.boosting,
        boostActiveMs,
        boostCooldownMs,
        shieldMs,
        speedMs,
        matrixImmuneMs,
        buffCooldownMs,
        body: p.body
          .filter((_, i) => i % stride === 0)
          .map(b => ({
            x: round1(b.x),
            y: round1(b.y)
          }))
      };
    });

    const food = [...this.food]
      .sort((a, b) => foodPriority(a.type) - foodPriority(b.type))
      .slice(0, MAX_FOOD_SEND)
      .map(f => ({
        x: Math.round(f.x),
        y: Math.round(f.y),
        r: Math.round(f.r),
        v: round1(f.v),
        type: f.type || "snack",
        img: f.img || null,
        spin: round3(f.spin || 0)
      }));

    const hazards = this.hazards
      .filter(h => h.alive)
      .map(h => ({
        id: h.id,
        type: h.type,
        img: h.img || null,
        x: Math.round(h.x),
        y: Math.round(h.y),
        r: Math.round(h.r)
      }));

    const projectiles = this.projectiles.map(p => ({
      id: p.id,
      type: p.type,
      x: round1(p.x),
      y: round1(p.y),
      r: Math.round(p.r),
      vx: round1(p.vx),
      vy: round1(p.vy)
    }));

    const mazeWalls = this.morpheusEvent?.active
      ? this.morpheusEvent.walls.map(w => ({
          x: Math.round(w.x),
          y: Math.round(w.y),
          w: Math.round(w.w),
          h: Math.round(w.h)
        }))
      : [];

    const mazeGate = (this.morpheusEvent?.active && !this.morpheusEvent.gateOpen)
      ? {
          x: Math.round(this.morpheusEvent.gate.x),
          y: Math.round(this.morpheusEvent.gate.y),
          w: Math.round(this.morpheusEvent.gate.w),
          h: Math.round(this.morpheusEvent.gate.h)
        }
      : null;

    this.broadcastRaw(JSON.stringify({
      type: "state",
      game: "Tigergames Online",
      world: WORLD,
      players,
      food,
      hazards,
      projectiles,
      mazeWalls,
      mazeGate,
      morpheusActive: !!this.morpheusEvent,
      mazeUnlockAt: this.morpheusEvent?.active && !this.morpheusEvent.gateOpen ? this.morpheusEvent.unlockAt : 0,
      top10: this.top10,
      countryTop3: this.countryTop3(),
      eventId: this.lastEvent.id,
      eventType: this.lastEvent.type,
      eventText: this.lastEvent.text,
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

  async saveTop(name, score, nation = "OTHER") {
    name = safeName(name);
    score = Math.round(score);
    nation = safeNation(nation);

    if (!score || score < 1) return;

    const existing = this.top10.find(
      x => safeName(x.name).toLowerCase() === name.toLowerCase()
    );

    let changed = false;

    if (existing) {
      if (score > existing.score) {
        existing.score = score;
        existing.nation = nation;
        existing.at = Date.now();
        changed = true;
      } else if (!existing.nation || existing.nation === "OTHER") {
        existing.nation = nation;
        changed = true;
      }
    } else {
      this.top10.push({ name, score, nation, at: Date.now() });
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

function makeFood(x, y, r, v, type = "snack") {
  if (type === "arnold") {
    return {
      x, y, r, v: 100,
      type: "arnold",
      img: "pic1.webp"
    };
  }

  if (type === "morpheus") {
    return {
      x, y, r, v: 500,
      type: "morpheus",
      img: "mor1.webp"
    };
  }

  if (type === "redPill") {
    return {
      x, y, r, v: 0,
      type: "redPill",
      img: null,
      spin: rand(0, Math.PI * 2)
    };
  }

  if (type === "bluePill") {
    return {
      x, y, r, v: 0,
      type: "bluePill",
      img: null,
      spin: rand(0, Math.PI * 2)
    };
  }

  return {
    x, y, r, v,
    type: "snack",
    img: SNACK_IMAGES[Math.floor(Math.random() * SNACK_IMAGES.length)]
  };
}

function foodPriority(type) {
  if (type === "morpheus") return 0;
  if (type === "arnold") return 1;
  if (type === "redPill" || type === "bluePill") return 2;
  return 9;
}

function buildMatrixMazeVariant(cx, cy, variant = 0) {
  const walls = [];
  const t = 54;
  const outer = 470;
  const inner = 240;
  const gateW = 210;

  if (variant === 0) {
    walls.push({ x: cx - outer, y: cy - outer, w: outer * 2, h: t });
    walls.push({ x: cx - outer, y: cy - outer, w: t, h: outer * 2 });
    walls.push({ x: cx + outer - t, y: cy - outer, w: t, h: outer * 2 });
    walls.push({ x: cx - outer, y: cy + outer - t, w: outer - gateW / 2, h: t });
    walls.push({ x: cx + gateW / 2, y: cy + outer - t, w: outer - gateW / 2, h: t });

    walls.push({ x: cx - inner, y: cy - inner, w: inner * 2, h: t });
    walls.push({ x: cx - inner, y: cy - inner, w: t, h: inner * 2 - 120 });
    walls.push({ x: cx + inner - t, y: cy - inner + 120, w: t, h: inner * 2 - 120 });
    walls.push({ x: cx - inner, y: cy + inner - t, w: inner - 85, h: t });
    walls.push({ x: cx + 85, y: cy + inner - t, w: inner - 85, h: t });

    walls.push({ x: cx - 60, y: cy - 340, w: t, h: 210 });
    walls.push({ x: cx + 110, y: cy - 40, w: t, h: 220 });
    walls.push({ x: cx - 240, y: cy + 80, w: 180, h: t });

    return {
      walls: clampWalls(walls),
      gate: { x: cx - gateW / 2, y: cy + outer - t, w: gateW, h: t }
    };
  }

  if (variant === 1) {
    walls.push({ x: cx - outer, y: cy + outer - t, w: outer * 2, h: t });
    walls.push({ x: cx - outer, y: cy - outer, w: t, h: outer * 2 });
    walls.push({ x: cx + outer - t, y: cy - outer, w: t, h: outer * 2 });
    walls.push({ x: cx - outer, y: cy - outer, w: outer - gateW / 2, h: t });
    walls.push({ x: cx + gateW / 2, y: cy - outer, w: outer - gateW / 2, h: t });

    walls.push({ x: cx - inner, y: cy + inner - t, w: inner * 2, h: t });
    walls.push({ x: cx - inner, y: cy - inner, w: t, h: inner * 2 - 120 });
    walls.push({ x: cx + inner - t, y: cy - inner + 120, w: t, h: inner * 2 - 120 });
    walls.push({ x: cx - inner, y: cy - inner, w: inner - 85, h: t });
    walls.push({ x: cx + 85, y: cy - inner, w: inner - 85, h: t });

    walls.push({ x: cx - 60, y: cy + 120, w: t, h: 210 });
    walls.push({ x: cx + 110, y: cy - 180, w: t, h: 220 });
    walls.push({ x: cx - 240, y: cy - 120, w: 180, h: t });

    return {
      walls: clampWalls(walls),
      gate: { x: cx - gateW / 2, y: cy - outer, w: gateW, h: t }
    };
  }

  if (variant === 2) {
    walls.push({ x: cx - outer, y: cy - outer, w: outer * 2, h: t });
    walls.push({ x: cx - outer, y: cy + outer - t, w: outer * 2, h: t });
    walls.push({ x: cx + outer - t, y: cy - outer, w: t, h: outer * 2 });
    walls.push({ x: cx - outer, y: cy - outer, w: t, h: outer - gateW / 2 });
    walls.push({ x: cx - outer, y: cy + gateW / 2, w: t, h: outer - gateW / 2 });

    walls.push({ x: cx - inner, y: cy - inner, w: inner * 2, h: t });
    walls.push({ x: cx - inner, y: cy + inner - t, w: inner * 2, h: t });
    walls.push({ x: cx - inner, y: cy - inner, w: t, h: inner - 85 });
    walls.push({ x: cx - inner, y: cy + 85, w: t, h: inner - 85 });
    walls.push({ x: cx + inner - t, y: cy - inner, w: t, h: inner * 2 });

    walls.push({ x: cx - 340, y: cy - 60, w: 210, h: t });
    walls.push({ x: cx - 40, y: cy + 110, w: 220, h: t });
    walls.push({ x: cx + 80, y: cy - 240, w: t, h: 180 });

    return {
      walls: clampWalls(walls),
      gate: { x: cx - outer, y: cy - gateW / 2, w: t, h: gateW }
    };
  }

  walls.push({ x: cx - outer, y: cy - outer, w: outer * 2, h: t });
  walls.push({ x: cx - outer, y: cy + outer - t, w: outer * 2, h: t });
  walls.push({ x: cx - outer, y: cy - outer, w: t, h: outer * 2 });
  walls.push({ x: cx + outer - t, y: cy - outer, w: t, h: outer - gateW / 2 });
  walls.push({ x: cx + outer - t, y: cy + gateW / 2, w: t, h: outer - gateW / 2 });

  walls.push({ x: cx - inner, y: cy - inner, w: inner * 2, h: t });
  walls.push({ x: cx - inner, y: cy + inner - t, w: inner * 2, h: t });
  walls.push({ x: cx - inner, y: cy - inner, w: t, h: inner * 2 });
  walls.push({ x: cx + inner - t, y: cy - inner, w: t, h: inner - 85 });
  walls.push({ x: cx + inner - t, y: cy + 85, w: t, h: inner - 85 });

  walls.push({ x: cx + 120, y: cy - 60, w: 210, h: t });
  walls.push({ x: cx - 180, y: cy + 110, w: 220, h: t });
  walls.push({ x: cx - 120, y: cy - 240, w: t, h: 180 });

  return {
    walls: clampWalls(walls),
    gate: { x: cx + outer - t, y: cy - gateW / 2, w: t, h: gateW }
  };
}

function clampWalls(walls) {
  return walls.map(w => ({
    x: clamp(w.x, 40, WORLD - 40),
    y: clamp(w.y, 40, WORLD - 40),
    w: w.w,
    h: w.h
  }));
}

function pointInAnyRect(x, y, rects) {
  for (const r of rects || []) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

function circleRectHit(cx, cy, cr, rect) {
  const nearestX = clamp(cx, rect.x, rect.x + rect.w);
  const nearestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) < cr * cr;
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
        nation: safeNation(item.nation || "OTHER"),
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

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function lerpNum(a, b, t) { return a + (b - a) * t; }

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
