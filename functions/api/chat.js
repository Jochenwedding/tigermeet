export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    const message = String(body.message || "").trim();
    let ticket = body.ticket || {};

    if (!message) {
      return Response.json({
        reply: "RAWR Tiger welkom in Araxos. Welke zone zit je: OPS of TECH?",
        ticket,
        showHotline: false
      });
    }

    ticket.name = ticket.name || "onbekende tijger";
    ticket.step = ticket.step || "ask_zone";
    ticket.createdAt = ticket.createdAt || new Date().toISOString();

    const lower = message.toLowerCase();

    if (ticket.name.toLowerCase().includes("simone") || lower.includes("simone")) {
      ticket.step = "done";

      return Response.json({
        reply: "RAWR Simone. Trek uw plan. Maar bon, als het brandt: druk op de Tiger Hotline.",
        ticket,
        showHotline: true
      });
    }

    let reply = "";
    let showHotline = false;
    let ticketReady = false;

    if (ticket.step === "ask_zone") {
      const zone = detectZone(lower);

      if (!zone) {
        reply = random([
          `RAWR ${ticket.name}, eerst discipline. Welke zone zit je: OPS of TECH?`,
          `Rustig tijger. Eerst de zone: OPS of TECH?`,
          `Araxos CIS luistert. Zit je in OPS of TECH?`
        ]);
      } else {
        ticket.zone = zone;
        ticket.step = "ask_problem";

        reply = random([
          `Zone ${zone} genoteerd. Waar zit de miserie: Netwerk, Computer, Telefonie, Printer, Radio, Crypto of Andere?`,
          `Roger, ${zone}. Wat is kapot aan het doen: Netwerk, Computer, Telefonie, Printer, Radio, Crypto of Andere?`,
          `Copy ${zone}, hete tijger. Kies uw drama: Netwerk, Computer, Telefonie, Printer, Radio, Crypto of Andere.`
        ]);
      }
    }

    else if (ticket.step === "ask_problem") {
      const problemType = detectProblemType(lower);

      if (!problemType) {
        reply = random([
          "RAWR, ik heb een categorie nodig: Netwerk, Computer, Telefonie, Printer, Radio, Crypto of Andere.",
          "Tijger, kies uw slagveld: Netwerk, Computer, Telefonie, Printer, Radio, Crypto of Andere."
        ]);
      } else {
        ticket.problemType = problemType;

        if (["computer", "printer", "telefonie"].includes(problemType)) {
          ticket.step = "ask_asset";

          reply = random([
            `RAWR tijger, doe rustig. CIS komt u te hulp. Geef het assetnummer van het toestel.`,
            `Copy. Geef het assetnummer van die ${problemType}, dan maken we een ticketje.`,
            `Geen paniek. CIS komt eraan. Wat is het assetnummer van het toestel?`
          ]);
        }

        else if (problemType === "radio") {
          ticket.step = "ask_location";

          reply = random([
            "Roger wilco. Hulp komt eraan, over. Geef nog snel uw locatie.",
            "Radio issue ontvangen. CIS zet de tijgerklauwen klaar. Waar zit ge exact?",
            "Copy radio probleem. Geef uw locatie, dan sturen we iemand richting uw nest."
          ]);
        }

        else if (problemType === "crypto") {
          ticket.step = "done";
          ticketReady = true;
          showHotline = true;

          reply = random([
            "Shhhht. Crypto niet via chat, tijger. Bel de Tiger Hotline via de knop.",
            "Crypto? Stilte op de lijn. Niet typen, bellen. Druk op de Tiger Hotline.",
            "RAWR classified vibes. Crypto niet in chat. Bel via de hotline-knop."
          ]);
        }

        else if (problemType === "netwerk") {
          ticket.step = "ask_location";

          reply = random([
            "Jochen is druk bezig met werken. Geef uw locatie, dan stuurt hij een technieker zo snel mogelijk langs.",
            "Netwerkdrama genoteerd. Jochen is druk, maar CIS beweegt. Waar zit ge?",
            "Hold on tight. Netwerkprobleem ontvangen. Geef uw locatie voor dispatch."
          ]);
        }

        else {
          ticket.step = "ask_description";

          reply = random([
            "Andere miserie dus. Beschrijf kort wat er scheelt, tijger.",
            "Copy, speciale categorie. Geef kort de symptomen.",
            "RAWR, vertel kort wat er kapot doet."
          ]);
        }
      }
    }

    else if (ticket.step === "ask_asset") {
      ticket.assetNumber = message;
      ticket.step = "ask_location";

      reply = random([
        "Asset genoteerd. Waar staat dat beest ergens?",
        "Copy assetnummer. Geef nu de locatie.",
        "Ontvangen. Waar moeten de CIS-klauwen naartoe?"
      ]);
    }

    else if (ticket.step === "ask_location") {
      ticket.location = message;
      ticket.step = "ask_description";

      reply = random([
        "Locatie genoteerd. Beschrijf nog kort wat er exact gebeurt.",
        "Copy locatie. Wat ziet ge precies? Foutmelding, geen verbinding, dood toestel?",
        "Ontvangen. Geef nog 1 korte omschrijving van het probleem."
      ]);
    }

    else if (ticket.step === "ask_description") {
      ticket.description = message;
      ticket.step = "done";
      ticketReady = true;
      showHotline = true;

      reply = random([
        "Ticket aangemaakt. CIS technieker is onderweg, tijger. Ge kunt altijd bellen via de Tiger Hotline knop.",
        "RAWR, ticket staat erin. Een CIS technieker komt zo snel mogelijk langs. Hotline-knop staat klaar als ge wilt bellen.",
        "Copy that. CIS is verwittigd en een technieker is onderweg. Voor extra drama: druk op de Tiger Hotline."
      ]);
    }

    else {
      showHotline = true;

      reply = random([
        "Uw ticket is al aangemaakt, hete tijger. CIS is onderweg.",
        "Rustig blijven. De CIS technieker is onderweg.",
        "RAWR, hold on tight. CIS komt u redden."
      ]);
    }

    if (ticketReady) {
      await sendTeamsTicket(env, ticket);
    }

    return Response.json({
      reply,
      ticket,
      showHotline
    });

  } catch (err) {
    return Response.json(
      {
        reply: "RAWR Tiger error. Bel de Tiger Hotline als het dringend is.",
        showHotline: true
      },
      { status: 500 }
    );
  }
}

function detectZone(text) {
  if (text.includes("ops")) return "OPS";
  if (text.includes("tech")) return "TECH";
  return "";
}

function detectProblemType(text) {
  if (text.includes("netwerk") || text.includes("network") || text.includes("internet") || text.includes("wifi")) return "netwerk";
  if (text.includes("computer") || text.includes("pc") || text.includes("laptop")) return "computer";
  if (text.includes("telefonie") || text.includes("telefoon") || text.includes("phone") || text.includes("sip")) return "telefonie";
  if (text.includes("printer") || text.includes("print")) return "printer";
  if (text.includes("radio")) return "radio";
  if (text.includes("crypto") || text.includes("crypt")) return "crypto";
  if (text.includes("andere") || text.includes("ander") || text.includes("other")) return "andere";
  return "";
}

function random(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

async function sendTeamsTicket(env, ticket) {
  if (!env.TEAMS_WEBHOOK_URL) {
    return;
  }

  const text =
`🐯 TIGER CIS TICKET

Naam: ${ticket.name || "onbekend"}
Zone: ${ticket.zone || "onbekend"}
Probleemtype: ${ticket.problemType || "onbekend"}
Assetnummer: ${ticket.assetNumber || "n.v.t."}
Locatie: ${ticket.location || "niet opgegeven"}
Omschrijving: ${ticket.description || "geen extra omschrijving"}
Tijd: ${ticket.createdAt || new Date().toISOString()}

RAWR. CIS technieker dispatchen.`;

  await fetch(env.TEAMS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text
    })
  });
}
