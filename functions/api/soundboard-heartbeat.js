export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));

  if (!body.visitorId) return Response.json({ success:false });

  const key = "session_" + body.visitorId;
  const session = JSON.parse(await env.LOGS.get(key) || "null");

  if (session) {
    session.lastSeen = new Date().toISOString();
    session.active = true;
    await env.LOGS.put(key, JSON.stringify(session), { expirationTtl: 3600 });
  }

  return Response.json({ success:true });
}
