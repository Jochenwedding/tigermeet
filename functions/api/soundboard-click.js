export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.json().catch(() => ({}));

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const country = request.headers.get("CF-IPCountry") || "unknown";

  const click = {
    time: new Date().toISOString(),
    name: body.name || "Unknown",
    sound: body.sound || "Unknown sound",
    ip,
    country
  };

  const oldClicks = JSON.parse(await env.LOGS.get("soundboard_clicks") || "[]");
  oldClicks.unshift(click);

  await env.LOGS.put("soundboard_clicks", JSON.stringify(oldClicks.slice(0, 500)));

  return Response.json({ success: true });
}
