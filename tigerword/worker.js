const rooms = new Map();

export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // WEBSOCKET
    if (url.pathname === "/ws") {

      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader !== "websocket") {
        return new Response("Expected websocket", { status: 400 });
      }

      const pair = new WebSocketPair();

      const client = pair[0];
      const server = pair[1];

      handleSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response("TigerWord Worker Running 🐯");
  }
};

function handleSocket(ws) {

  ws.accept();

  let player = {
    id: crypto.randomUUID(),
    name: "Unknown",
    role: "player"
  };

  ws.send(JSON.stringify({
    type: "connected",
    id: player.id
  }));

  broadcastPlayers();

  ws.addEventListener("message", (event) => {

    try {

      const data = JSON.parse(event.data);

      // JOIN
      if (data.type === "join") {

        player.name = data.name || "Player";
        player.role = data.role || "player";

        rooms.set(player.id, {
          socket: ws,
          player
        });

        broadcastPlayers();
      }

      // SECRET WORD
      if (data.type === "secretWord") {

        globalThis.secretWord = data.word;

        broadcast({
          type: "status",
          message: "Leader heeft woord gekozen."
        });
      }

      // GUESS
      if (data.type === "guess") {

        broadcast({
          type: "guess",
          player: player.name,
          guess: data.guess
        });
      }

    } catch (err) {
      console.log(err);
    }

  });

  ws.addEventListener("close", () => {

    rooms.delete(player.id);

    broadcastPlayers();

  });

}

function broadcast(data) {

  const msg = JSON.stringify(data);

  for (const room of rooms.values()) {

    try {
      room.socket.send(msg);
    } catch {}

  }

}

function broadcastPlayers() {

  const players = [...rooms.values()].map(r => ({
    name: r.player.name,
    role: r.player.role
  }));

  broadcast({
    type: "players",
    players
  });

}
