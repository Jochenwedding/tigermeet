export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => ({}));

    const id = body.id || crypto.randomUUID();
    const isVisit = body.visit === true;

    const country = request.cf?.country || "XX";

    // Totaal visits verhogen
    if (isVisit) {
      const totalVisits =
        Number(await env.TIGER_STATS.get("totalVisits") || 0) + 1;

      await env.TIGER_STATS.put(
        "totalVisits",
        String(totalVisits)
      );

      // Country opslaan
      await env.TIGER_STATS.put(
        `country:${country}`,
        "1"
      );
    }

    // Online user heartbeat
    await env.TIGER_STATS.put(
      `online:${id}`,
      Date.now().toString(),
      {
        expirationTtl: 75
      }
    );

    // Online tellen
    const onlineList = await env.TIGER_STATS.list({
      prefix: "online:"
    });

    // Countries tellen
    const countryList = await env.TIGER_STATS.list({
      prefix: "country:"
    });

    // Visits ophalen
    const totalVisits =
      Number(await env.TIGER_STATS.get("totalVisits") || 0);

    return Response.json({
      success: true,
      online: onlineList.keys.length,
      visits: totalVisits,
      countries: countryList.keys.length
    });

  } catch (err) {

    return Response.json({
      success: false,
      error: err.message
    }, {
      status: 500
    });

  }
}
