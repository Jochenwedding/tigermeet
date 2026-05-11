export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get("key") !== "tiger31") {
    return new Response("Forbidden", { status: 403 });
  }

  const logs = JSON.parse(await env.LOGS.get("soundboard_logs") || "[]");
  const clicks = JSON.parse(await env.LOGS.get("soundboard_clicks") || "[]");

  const buttonCounts = {};
  clicks.forEach(c => {
    buttonCounts[c.sound] = (buttonCounts[c.sound] || 0) + 1;
  });

  const topButtons = Object.entries(buttonCounts)
    .sort((a,b) => b[1] - a[1])
    .map(([sound,count]) => `
      <tr>
        <td>${escapeHtml(sound)}</td>
        <td>${count}</td>
      </tr>
    `).join("");

  const visitRows = logs.map(log => `
    <tr data-name="${escapeHtml(log.name)}" data-country="${escapeHtml(log.country)}">
      <td>${formatLocal(log.time)}</td>
      <td>${escapeHtml(log.name)}</td>
      <td>${escapeHtml(log.ip)}</td>
      <td>${escapeHtml(log.country)}</td>
      <td>${escapeHtml(log.page)}</td>
      <td>${escapeHtml(shortDevice(log.device))}</td>
    </tr>
  `).join("");

  const clickRows = clicks.map(c => `
    <tr data-name="${escapeHtml(c.name)}" data-sound="${escapeHtml(c.sound)}">
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
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px}
.card{background:#111;border:1px solid #333;border-radius:16px;padding:16px}
.big{font-size:30px;font-weight:900;color:#ffd36a}
input{width:100%;padding:12px;border-radius:12px;border:1px solid #444;background:#080808;color:white;margin:8px 0 18px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:30px}
th,td{border:1px solid #333;padding:8px;text-align:left;vertical-align:top}
th{background:#ff8a00;color:#000;position:sticky;top:0}
tr:nth-child(even){background:#111}
.section{margin-top:30px}
</style>
</head>
<body>

<h1>Soundboard Visitor Logs</h1>

<div class="grid">
  <div class="card"><div>Total visits</div><div class="big">${logs.length}</div></div>
  <div class="card"><div>Total button clicks</div><div class="big">${clicks.length}</div></div>
  <div class="card"><div>Unique names</div><div class="big">${new Set(logs.map(l=>l.name)).size}</div></div>
</div>

<input id="filter" placeholder="Filter op naam, land, IP, knop, device..." oninput="filterTables()">

<h2>Most pressed soundboard buttons</h2>
<table>
<tr><th>Button / Sound</th><th>Clicks</th></tr>
${topButtons || `<tr><td colspan="2">Nog geen button clicks.</td></tr>`}
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
${visitRows || `<tr><td colspan="6">Nog geen visits.</td></tr>`}
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
${clickRows || `<tr><td colspan="5">Nog geen clicks.</td></tr>`}
</table>

<script>
function filterTables(){
  const q = document.getElementById("filter").value.toLowerCase();
  document.querySelectorAll("tr").forEach((row,i)=>{
    if(i === 0) return;
    const txt = row.innerText.toLowerCase();
    row.style.display = txt.includes(q) ? "" : "none";
  });
}
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

function shortDevice(ua){
  ua = String(ua || "");
  if(ua.includes("Edg")) return "Edge / Windows";
  if(ua.includes("Chrome")) return "Chrome";
  if(ua.includes("Firefox")) return "Firefox";
  if(ua.includes("Safari")) return "Safari";
  return ua.slice(0,120);
}
