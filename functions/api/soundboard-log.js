export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.json().catch(() => ({}));

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const country = request.headers.get("CF-IPCountry") || "unknown";
  const ua = request.headers.get("User-Agent") || "unknown";

  const log = {
    time: new Date().toISOString(),
    name: body.name || "Unknown",
    page: body.page || "/soundboard",
    ip,
    country,
    device: ua
  };

  const oldLogs = JSON.parse(await env.LOGS.get("soundboard_logs") || "[]");
  oldLogs.unshift(log);

  await env.LOGS.put("soundboard_logs", JSON.stringify(oldLogs.slice(0, 250)));

  return Response.json({ success: true });
}
