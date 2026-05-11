export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const country = request.headers.get("CF-IPCountry") || "unknown";
  const ua = request.headers.get("User-Agent") || "unknown";

  const visitorId = body.visitorId || crypto.randomUUID();
  const now = new Date().toISOString();

  const session = {
    visitorId,
    name: body.name || "Unknown",
    page: body.page || "/soundboard",
    ip,
    country,
    device: ua,
    openedAt: now,
    lastSeen: now,
    active: true
  };

  const visits = JSON.parse(await env.LOGS.get("soundboard_visits") || "[]");
  visits.unshift(session);

  await env.LOGS.put("soundboard_visits", JSON.stringify(visits.slice(0, 500)));
  await env.LOGS.put("session_" + visitorId, JSON.stringify(session), { expirationTtl: 3600 });

  return Response.json({ success: true, visitorId });
}
