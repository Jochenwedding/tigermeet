export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const country = request.headers.get("CF-IPCountry") || "unknown";

  const click = {
    time: new Date().toISOString(),
    visitorId: body.visitorId || "unknown",
    name: body.name || "Unknown",
    sound: body.sound || "Unknown sound",
    ip,
    country
  };

  const clicks = JSON.parse(await env.LOGS.get("soundboard_clicks") || "[]");
  clicks.unshift(click);

  await env.LOGS.put("soundboard_clicks", JSON.stringify(clicks.slice(0, 1500)));

  return Response.json({ success:true });
}
