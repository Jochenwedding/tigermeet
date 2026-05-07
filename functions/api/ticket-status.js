export async function onRequestGet() {
  return Response.json({
    ok: true,
    message: "ticket-status API is alive. Gebruik POST om status te wijzigen."
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const id = String(body.id || "");
    const status = String(body.status || "open");

    if (!env.TICKETS) {
      return Response.json({ ok: false, error: "TICKETS KV ontbreekt" }, { status: 500 });
    }

    if (!id) {
      return Response.json({ ok: false, error: "Geen ticket ID" }, { status: 400 });
    }

    const ticket = await env.TICKETS.get(id, "json");

    if (!ticket) {
      return Response.json({ ok: false, error: "Ticket niet gevonden" }, { status: 404 });
    }

    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();

    if (status === "opgelost") {
      ticket.solvedAt = new Date().toISOString();
    } else {
      ticket.solvedAt = "";
    }

    await env.TICKETS.put(id, JSON.stringify(ticket));

    return Response.json({ ok: true, ticket });

  } catch (err) {
    return Response.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
