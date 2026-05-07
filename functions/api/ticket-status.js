<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tiger CIS Tickets</title>

  <style>
    body{
      margin:0;
      background:#0f0f0f;
      color:white;
      font-family:Arial, Helvetica, sans-serif;
      padding:20px;
    }

    h1{
      color:orange;
      margin-bottom:20px;
    }

    .stats{
      margin-bottom:20px;
      color:#aaa;
    }

    .tickets{
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(320px,1fr));
      gap:18px;
    }

    .ticket{
      background:#1a1a1a;
      border:2px solid orange;
      border-radius:16px;
      padding:18px;
      box-shadow:0 0 20px rgba(255,140,0,.15);
    }

    .ticket h2{
      margin-top:0;
      color:orange;
    }

    .label{
      color:#999;
      font-size:13px;
      margin-top:12px;
    }

    .value{
      font-size:15px;
      word-break:break-word;
    }

    .status{
      display:inline-block;
      background:orange;
      color:black;
      padding:4px 10px;
      border-radius:999px;
      font-weight:bold;
      margin-bottom:12px;
    }

    .time{
      margin-top:15px;
      color:#777;
      font-size:12px;
    }
  </style>
</head>
<body>

  <h1>🐯 TIGER CIS TICKETS</h1>

  <div class="stats" id="stats">
    Tickets laden...
  </div>

  <div class="tickets" id="tickets"></div>

  <script>

    async function loadTickets() {

      try {

        const res = await fetch("/api/tickets");
        const data = await res.json();

        const ticketsDiv = document.getElementById("tickets");
        const statsDiv = document.getElementById("stats");

        if (!data.ok) {
          statsDiv.innerHTML = "RAWR error loading tickets.";
          return;
        }

        statsDiv.innerHTML = `
          Open tickets: <b>${data.count}</b>
        `;

        if (!data.tickets.length) {
          ticketsDiv.innerHTML = "Geen tickets momenteel, tijger.";
          return;
        }

        ticketsDiv.innerHTML = data.tickets.map(ticket => `
          <div class="ticket">

            <div class="status">
              ${ticket.status || "OPEN"}
            </div>

            <h2>${ticket.problemType || "Onbekend"}</h2>

            <div class="label">Naam</div>
            <div class="value">${ticket.name || "-"}</div>

            <div class="label">Zone</div>
            <div class="value">${ticket.zone || "-"}</div>

            <div class="label">Assetnummer</div>
            <div class="value">${ticket.assetNumber || "-"}</div>

            <div class="label">Locatie</div>
            <div class="value">${ticket.location || "-"}</div>

            <div class="label">Omschrijving</div>
            <div class="value">${ticket.description || "-"}</div>

            <div class="label">POC</div>
            <div class="value">${ticket.poc || "-"}</div>

            <div class="time">
              ${ticket.createdAt || ""}
            </div>

          </div>
        `).join("");

      } catch(err){
        console.error(err);
      }
    }

    loadTickets();

    setInterval(loadTickets, 5000);

  </script>

</body>
</html>