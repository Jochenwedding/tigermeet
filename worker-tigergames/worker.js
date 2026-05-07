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
const FOOD_TARGET = 650;

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

export class TigerRoom {

  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.players = new Map();
    this.inputs = new Map();

    this.food = [];

    this.lastTick = Date.now();
    this.tickHandle = null;

    this.top5 = [];

    this.state.blockConcurrencyWhile(async () => {
      this.top5 =
        (await this.state.storage.get("top5")) || [];
    });
  }

  async fetch(request) {

    const pair = new WebSocketPair();

    const [client, server] =
      Object.values(pair);

    server.accept();

    const id = crypto.randomUUID();

    server.id = id;

    server.addEventListener(
      "message",
      evt => this.onMessage(server, evt.data)
    );

    server.addEventListener(
      "close",
      () => this.onClose(server)
    );

    server.addEventListener(
      "error",
      () => this.onClose(server)
    );

    server.send(JSON.stringify({
      type: "welcome",
      id
    }));

    this.ensureLoop();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  onMessage(ws, raw) {

    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {

      const name =
        safeName(msg.name || "Tiger");

      const p =
        this.createPlayer(ws.id, name);

      this.players.set(ws, p);

      this.inputs.set(ws.id, {
        angle: Math.random() * Math.PI * 2,
        boost: false
      });

      this.broadcast({
        type: "event",
        text: `${name} joined TigerGames 🐯`
      });

      return;
    }

    if (msg.type === "input") {

      const p = this.players.get(ws);

      if (!p) return;

      this.inputs.set(p.id, {
        angle: Number(msg.angle) || 0,
        boost: !!msg.boost
      });

      return;
    }

    if (msg.type === "respawn") {

      const old = this.players.get(ws);

      if (!old) return;

      this.players.set(
        ws,
        this.createPlayer(old.id, old.name)
      );
    }
  }

  onClose(ws) {

    const p = this.players.get(ws);

    if (p) {
      this.saveTop(
        p.name,
        Math.round(p.score)
      );
    }

    this.players.delete(ws);

    this.inputs.delete(ws.id);
  }

  createPlayer(id, name) {

    const a =
      Math.random() * Math.PI * 2;

    const x =
      rand(300, WORLD - 300);

    const y =
      rand(300, WORLD - 300);

    const p = {
      id,
      name,
      x,
      y,
      angle: a,
      color:
        COLORS[
          Math.floor(
            Math.random() * COLORS.length
          )
        ],
      score: 0,
      alive: true,
      body: [],
      radius: 13
    };

    for (let i = 0; i < 22; i++) {

      p.body.push({
        x: x - Math.cos(a) * i * 11,
        y: y - Math.sin(a) * i * 11
      });
    }

    return p;
  }

  ensureLoop() {

    if (this.tickHandle) return;

    this.seedFood();

    this.lastTick = Date.now();

    this.tickHandle =
      setInterval(() => this.tick(), 50);
  }

  tick() {

    if (this.players.size === 0) {

      clearInterval(this.tickHandle);

      this.tickHandle = null;

      return;
    }

    const now = Date.now();

    const dt =
      Math.min(
        (now - this.lastTick) / 1000,
        0.06
      );

    this.lastTick = now;

    this.seedFood();

    for (const p of this.players.values()) {

      if (p.alive) {
        this.updatePlayer(p, dt);
      }
    }

    this.handleEating();

    this.handleCrashes();

    this.broadcastState();
  }

  updatePlayer(p, dt) {

    const input =
      this.inputs.get(p.id) || {
        angle: p.angle,
        boost: false
      };

    p.angle +=
      angleDiff(
        p.angle,
        input.angle
      ) *
      Math.min(1, dt * 7.2);

    const canBoost =
      input.boost &&
      p.body.length > 26;

    const speed =
      165 +
      Math.max(
        0,
        70 - p.body.length * 0.25
      ) +
      (canBoost ? 125 : 0);

    if (
      canBoost &&
      Math.random() < 0.52
    ) {

      const tail = p.body.pop();

      if (tail) {

        this.food.push({
          x: tail.x,
          y: tail.y,
          r: 6,
          v: 1.2
        });
      }

      p.score =
        Math.max(
          0,
          p.score - 0.04
        );
    }

    p.x =
      clamp(
        p.x +
        Math.cos(p.angle) *
        speed *
        dt,
        18,
        WORLD - 18
      );

    p.y =
      clamp(
        p.y +
        Math.sin(p.angle) *
        speed *
        dt,
        18,
        WORLD - 18
      );

    p.body.unshift({
      x: p.x,
      y: p.y
    });

    const maxLen =
      Math.floor(
        22 + p.score * 2.2
      );

    while (
      p.body.length > maxLen
    ) {
      p.body.pop();
    }

    p.radius =
      clamp(
        11 +
        Math.sqrt(p.body.length) *
        1.18,
        13,
        36
      );
  }

  handleEating() {

    for (const p of this.players.values()) {

      if (!p.alive) continue;

      for (
        let i = this.food.length - 1;
        i >= 0;
        i--
      ) {

        const f = this.food[i];

        if (
          dist2(
            p.x,
            p.y,
            f.x,
            f.y
          ) <
          (p.radius + f.r + 9) ** 2
        ) {

          p.score += f.v;

          this.food.splice(i, 1);
        }
      }
    }
  }

  handleCrashes() {

    const all =
      [...this.players.values()]
        .filter(p => p.alive);

    for (const p of all) {

      for (const other of all) {

        if (p === other) continue;

        for (
          let i = 9;
          i < other.body.length;
          i += 3
        ) {

          const seg = other.body[i];

          if (
            dist2(
              p.x,
              p.y,
              seg.x,
              seg.y
            ) <
            (p.radius + 9) ** 2
          ) {

            this.kill(p, other);

            break;
          }
        }

        if (!p.alive) break;
      }
    }
  }

  kill(dead, killer) {

    dead.alive = false;

    killer.score += 10;

    this.saveTop(
      dead.name,
      Math.round(dead.score)
    );

    for (
      let i = 0;
      i < dead.body.length;
      i += 2
    ) {

      const b = dead.body[i];

      this.food.push({
        x: b.x + rand(-18, 18),
        y: b.y + rand(-18, 18),
        r: rand(5, 9),
        v: rand(1.4, 3.5)
      });
    }

    this.broadcast({
      type: "event",
      text:
        `${killer.name} ate ${dead.name} 🐯`
    });
  }

  seedFood() {

    while (
      this.food.length < FOOD_TARGET
    ) {

      this.food.push({
        x: rand(40, WORLD - 40),
        y: rand(40, WORLD - 40),
        r: rand(4, 7),
        v: rand(0.7, 2.1)
      });
    }
  }

  broadcastState() {

    const players =
      [...this.players.values()]
        .map(p => ({
          id: p.id,
          name: p.name,
          x: p.x,
          y: p.y,
          color: p.color,
          score: p.score,
          alive: p.alive,
          radius: p.radius,
          len: p.body.length,
          body:
            p.body.filter(
              (_, i) => i % 2 === 0
            )
        }));

    const msg = JSON.stringify({
      type: "state",
      players,
      food: this.food.slice(0, 700),
      top5: this.top5
    });

    this.broadcastRaw(msg);
  }

  broadcast(obj) {
    this.broadcastRaw(
      JSON.stringify(obj)
    );
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

    this.top5.sort(
      (a, b) => b.score - a.score
    );

    this.top5 =
      this.top5.slice(0, 5);

    await this.state.storage.put(
      "top5",
      this.top5
    );
  }
}

function safeName(v) {
  return String(v)
    .replace(/[<>\"&]/g, '')
    .trim()
    .slice(0, 16) || 'Tiger';
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
