export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get("key") !== "tiger31") {
    return new Response("Forbidden", { status: 403 });
  }

  const visits = JSON.parse(await env.LOGS.get("soundboard_visits") || "[]");
  const clicks = JSON.parse(await env.LOGS.get("soundboard_clicks") || "[]");

  const now = Date.now();

  const activeSessions = [];
  const uniqueVisitorIds = [...new Set(visits.map(v => v.visitorId).filter(Boolean))];

  for (const id of uniqueVisitorIds.slice(0, 80)) {
    const session = JSON.parse(await env.LOGS.get("session_" + id) || "null");
    if (!session) continue;

    const lastSeenMs = new Date(session.lastSeen).getTime();
    if (now - lastSeenMs <= 45000) activeSessions.push(session);
  }

  const buttonCounts = {};
  clicks.forEach(c => {
    buttonCounts[c.sound] = (buttonCounts[c.sound] || 0) + 1;
  });

  const topButtons = Object.entries(buttonCounts)
    .sort((a,b) => b[1] - a[1])
    .map(([sound,count]) => `
      <tr class="dataRow" data-time="">
        <td>${escapeHtml(sound)}</td>
        <td>${count}</td>
      </tr>
    `).join("");

  const activeRows = activeSessions.map(s => `
    <tr class="dataRow">
      <td>${formatLocal(s.openedAt)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${sessionDuration(s.openedAt, s.lastSeen)}</td>
      <td>${escapeHtml(s.ip)}</td>
      <td>${escapeHtml(s.country)}</td>
      <td>${escapeHtml(shortDevice(s.device))}</td>
      <td>${formatLocal(s.lastSeen)}</td>
    </tr>
  `).join("");

  const visitRows = visits.map(v => `
    <tr class="dataRow" data-time="${escapeHtml(v.openedAt)}">
      <td>${formatLocal(v.openedAt)}</td>
      <td>${escapeHtml(v.name)}</td>
      <td>${escapeHtml(v.ip)}</td>
      <td>${escapeHtml(v.country)}</td>
      <td>${escapeHtml(v.page)}</td>
      <td>${escapeHtml(shortDevice(v.device))}</td>
    </tr>
  `).join("");

  const clickRows = clicks.map(c => `
    <tr class="dataRow" data-time="${escapeHtml(c.time)}">
      <td>${formatLocal(c.time)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.sound)}</td>
      <td>${escapeHtml(c.ip)}</td>
      <td>${escapeHtml(c.country)}</td>
    </tr>
  `).join("");

  return new Response(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Soundboard Logs</title>
<style>
body{background:#050505;color:white;font-family:Arial;padding:22px}
h1,h2{color:#ff8a00}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:20px}
.card{background:#111;border:1px solid #333;border-radius:16px;padding:16px}
.big{font-size:30px;font-weight:900;color:#ffd36a}
.controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}
input,select{width:100%;padding:12px;border-radius:12px;border:1px solid #444;background:#080808;color:white}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:32px}
th,td{border:1px solid #333;padding:8px;text-align:left;vertical-align:top}
th{background:#ff8a00;color:#000;position:sticky;top:0}
tr:nth-child(even){background:#111}
.activeDot{display:inline-block;width:10px;height:10px;background:#00ff9d;border-radius:50%;box-shadow:0 0 12px #00ff9d;margin-right:6px}
.note{color:#aaa;font-size:12px;margin-bottom:15px}
</style>
</head>
<body>

<h1>Soundboard Visitor Logs</h1>
<div class="note">Auto refresh elke 5 seconden. Filter en tijdspanne blijven onthouden.</div>

<div class="grid">
  <div class="card"><div>Total visits</div><div class="big">${visits.length}</div></div>
  <div class="card"><div>Total clicks</div><div class="big">${clicks.length}</div></div>
  <div class="card"><div>Active users</div><div class="big">${activeSessions.length}</div></div>
  <div class="card"><div>Unique names</div><div class="big">${new Set(visits.map(v=>v.name)).size}</div></div>
</div>

<div class="controls">
  <input id="filter" placeholder="Filter naam, IP, land, knop, device..." oninput="applyFilters()">
  <select id="range" onchange="applyFilters()">
    <option value="all">All time</option>
    <option value="5m">Last 5 minutes</option>
    <option value="15m">Last 15 minutes</option>
    <option value="1h">Last 1 hour</option>
    <option value="6h">Last 6 hours</option>
    <option value="24h">Last 24 hours</option>
  </select>
</div>

<h2><span class="activeDot"></span>Active users</h2>
<table>
<tr>
  <th>Opened</th>
  <th>Name</th>
  <th>Session open</th>
  <th>IP</th>
  <th>Country</th>
  <th>Device</th>
  <th>Last seen</th>
</tr>
${activeRows || `<tr><td colspan="7">No active users.</td></tr>`}
</table>

<h2>Most pressed buttons</h2>
<table>
<tr><th>Button / Sound</th><th>Total clicks</th></tr>
${topButtons || `<tr><td colspan="2">No button clicks yet.</td></tr>`}
</table>

<h2>Button clicks</h2>
<table id="clicksTable">
<tr>
  <th>Local time</th>
  <th>Name</th>
  <th>Sound</th>
  <th>IP</th>
  <th>Country</th>
</tr>
${clickRows || `<tr><td colspan="5">No clicks yet.</td></tr>`}
</table>

<h2>Visits</h2>
<table id="visitsTable">
<tr>
  <th>Local time</th>
  <th>Name</th>
  <th>IP</th>
  <th>Country</th>
  <th>Page</th>
  <th>Device</th>
</tr>
${visitRows || `<tr><td colspan="6">No visits yet.</td></tr>`}
</table>

<script>
const filterInput = document.getElementById("filter");
const rangeInput = document.getElementById("range");

filterInput.value = localStorage.getItem("soundboardLogFilter") || "";
rangeInput.value = localStorage.getItem("soundboardLogRange") || "all";

function rangeMs(value){
  if(value === "5m") return 5 * 60 * 1000;
  if(value === "15m") return 15 * 60 * 1000;
  if(value === "1h") return 60 * 60 * 1000;
  if(value === "6h") return 6 * 60 * 60 * 1000;
  if(value === "24h") return 24 * 60 * 60 * 1000;
  return null;
}

function applyFilters(){
  const q = filterInput.value.toLowerCase();
  const range = rangeInput.value;
  const ms = rangeMs(range);
  const now = Date.now();

  localStorage.setItem("soundboardLogFilter", q);
  localStorage.setItem("soundboardLogRange", range);

  document.querySelectorAll("tr.dataRow").forEach(row => {
    const txt = row.innerText.toLowerCase();
    const time = row.dataset.time;
    let timeOk = true;

    if(ms && time){
      const rowTime = new Date(time).getTime();
      timeOk = now - rowTime <= ms;
    }

    row.style.display = txt.includes(q) && timeOk ? "" : "none";
  });
}

applyFilters();

setInterval(() => {
  location.reload();
}, 5000);
</script>

</body>
</html>
`, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(str){
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function formatLocal(iso){
  if(!iso) return "";
  return new Date(iso).toLocaleString("nl-BE", {
    timeZone:"Europe/Brussels",
    day:"2-digit",
    month:"2-digit",
    year:"numeric",
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit"
  });
}

function sessionDuration(startIso, endIso){
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2,"0")}s`;
}

function shortDevice(ua){
  ua = String(ua || "");
  if(ua.includes("Edg")) return "Edge / Windows";
  if(ua.includes("Chrome") && ua.includes("Android")) return "Chrome / Android";
  if(ua.includes("Chrome")) return "Chrome";
  if(ua.includes("Firefox")) return "Firefox";
  if(ua.includes("Safari") && ua.includes("iPhone")) return "Safari / iPhone";
  if(ua.includes("Safari")) return "Safari";
  return ua.slice(0,120);
}
