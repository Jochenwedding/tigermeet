async function smartAfterTicketReply(env, message, ticket) {
  const lower = message.toLowerCase();

  if (
    lower.includes("beschikbaar") ||
    lower.includes("wie") ||
    lower.includes("cis") ||
    lower.includes("medewerker") ||
    lower.includes("technieker")
  ) {
    return "CIS heeft Kevin, Tommy, Piccart, Bram en Jorrit in de arena. Jochen is uiteraard druk bezig, tijger. Voor spoed: druk op de Tiger Hotline.";
  }

  if (
    lower.includes("crypto") ||
    lower.includes("classified") ||
    lower.includes("secret") ||
    lower.includes("geheim") ||
    lower.includes("wachtwoord") ||
    lower.includes("password")
  ) {
    return "Shhhht, dat niet via chat. Geen classified info delen, tijger. Bel CIS via de hotline.";
  }

  if (
    lower.includes("nieuw ticket") ||
    lower.includes("nieuw probleem") ||
    lower.includes("opnieuw")
  ) {
    return "Typ exact 'nieuw ticket', dan start ik een nieuwe flow, hete tijger.";
  }

  if (!env.AI) {
    return "Ticket staat erin, tijger. Ik geef geen wilde fixes via chat. Voor extra hulp: Tiger Hotline.";
  }

  const systemPrompt = `
Je bent TIGER IT SUPPORT AI op Araxos Airbase.

Er is al een ticket aangemaakt.
Je mag nu enkel korte algemene antwoorden geven.

Regels:
- Antwoord in Vlaams/Nederlands.
- Maximaal 3 korte zinnen.
- Geen technische instructies zoals router resetten, kabels patchen, VLAN, IP, crypto, config, firewall, server, radio settings.
- Niet hallucineren.
- Geen stappenplannen.
- Geen gevoelige info vragen.
- Geen classified info.
- Bij echte problemen: zeg dat CIS het ticket heeft en dat ze kunnen bellen via de hotline.
- Als ze vragen wie beschikbaar is: noem Kevin, Tommy, Piccart, Bram en Jorrit. Jochen is altijd druk bezig.
- Blijf licht grappig met tiger vibe, maar niet te veel.
- Zeg niet telkens letterlijk hetzelfde.

Ticketcontext:
Naam: ${ticket.name}
Zone: ${ticket.zone}
Probleem: ${ticket.problemType}
Asset: ${ticket.assetNumber || "n.v.t."}
Locatie: ${ticket.location || "onbekend"}
Omschrijving: ${ticket.description || "geen"}
`;

  const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ],
    max_tokens: 80,
    temperature: 0.25
  });

  return aiResponse.response ||
    "Ticket staat erin, tijger. CIS pakt het op. Voor spoed: Tiger Hotline.";
}
