export async function onRequestGet(context) {
  const { env } = context;

  if (!env.TICKETS) {
    return Response.json({
      ok: false,
      error: "TICKETS KV binding niet gevonden",
      tickets: []
    });
  }

  const list = await env.TICKETS.list({ prefix: "ticket:" });

  const tickets = [];

  for (const key of list.keys) {
    const ticket = await env.TICKETS.get(key.name, "json");
    if (ticket) tickets.push(ticket);
  }

  tickets.sort((a, b) => {
    return new Date(b.savedAt || b.createdAt) - new Date(a.savedAt || a.createdAt);
  });

  return Response.json({
    ok: true,
    count: tickets.length,
    tickets
  });
}