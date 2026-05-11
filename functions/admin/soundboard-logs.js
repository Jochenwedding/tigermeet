export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get("key") !== "tiger31") {
    return new Response("Forbidden", { status: 403 });
  }

  const logs = JSON.parse(await env.LOGS.get("soundboard_logs") || "[]");

  const rows = logs.map(log => `
    <tr>
      <td>${log.time}</td>
      <td>${log.name}</td>
      <td>${log.ip}</td>
      <td>${log.country}</td>
      <td>${log.page}</td>
      <td>${log.device}</td>
    </tr>
  `).join("");

  return new Response(`
<!DOCTYPE html>
<html>
<head>
<title>Soundboard Logs</title>
<style>
body{background:#050505;color:white;font-family:Arial;padding:20px}
h1{color:#ff8a00}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #333;padding:8px;text-align:left;vertical-align:top}
th{background:#ff8a00;color:#000}
tr:nth-child(even){background:#111}
</style>
</head>
<body>
<h1>🐯 Soundboard Visitor Logs</h1>
<p>Total logs: ${logs.length}</p>
<table>
<tr>
  <th>Time</th>
  <th>Name</th>
  <th>IP</th>
  <th>Country</th>
  <th>Page</th>
  <th>Device</th>
</tr>
${rows}
</table>
</body>
</html>
`, {
    headers: { "Content-Type": "text/html" }
  });
}
