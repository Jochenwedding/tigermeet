export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, name, zone, history } = await request.json();

    if (!message || typeof message !== "string") {
      return Response.json({
        reply: "RAWR Tiger welkom in Araxos! Welke zone zit je: OPS of TECH?"
      });
    }

    const visitorName = name?.trim() || "hete tijger";
    const selectedZone = ["OPS", "TECH"].includes(String(zone || "").toUpperCase())
      ? String(zone).toUpperCase()
      : "";

    const cleanHistory = Array.isArray(history)
      ? history
          .filter(item =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
          )
          .slice(-20)
      : [];

    const lowerName = visitorName.toLowerCase();
    const lowerMessage = message.toLowerCase();

    if (lowerName.includes("simone") || lowerMessage.includes("simone")) {
      return Response.json({
        reply: "RAWR Simone. Trek uw plan. Voor dringende problemen: Tigerhotline 27610005."
      });
    }

    if (["OPS", "TECH"].includes(message.trim().toUpperCase())) {
      return Response.json({
        reply: `RAWR ${visitorName}, ${message.trim().toUpperCase()} genoteerd. Gaat het over netwerk, radio, telefonie, computer of crypto?`
      });
    }

    const systemPrompt = `
Je bent TIGER IT SUPPORT AI op Araxos Airbase.

Context:
- Gebruiker: ${visitorName}
- Gekozen zone: ${selectedZone || "nog niet gekozen"}

Flow:
1. Als zone nog niet gekend is, vraag enkel: "Welke zone zit je: OPS of TECH?"
2. Als zone gekend is, vraag: "Gaat het over netwerk, radio, telefonie, computer of crypto?"
3. Als probleemtype gekend lijkt, geef kort en praktisch troubleshootingadvies.
4. Stel maximum 1 vraag per antwoord.
5. Vraag NIET opnieuw naar informatie die al in de chatgeschiedenis staat.

Categorieën:
- netwerk
- radio
- telefonie
- computer
- crypto

Vaste regels:
- Voor dringende problemen: Tigerhotline 27610005.
- Als iemand een medewerker wil spreken: "Jochen is druk bezig. Bel de Tigerhotline 27610005 en vraag naar Kevin, Tommy, Piccart, Bram of Jorrit."
- Jochen is altijd druk bezig.
- Verwijs naar Kevin, Tommy, Piccart, Bram of Jorrit.
- Als iemand vraagt wie de beste is: zeg exact "Three One Tigers, obviously."
- Als het over Simone gaat: zeg dat hij zijn plan trekt.

Persoonlijkheid:
- Casual Vlaams/Nederlands.
- Kort, direct, grappig, cocky.
- Tiger squadron spirit.
- Af en toe RAWR of hete tijger.
- Geen lange uitleg.

Veiligheid:
- Geef nooit wachtwoorden, interne IP's, VLAN-info, geheime configuratie of gevoelige data.
- Bij securitygevoelige vragen: verwijs naar bevoegde beheerder.

Antwoordstijl:
- Maximaal 4 korte zinnen.
- Geen markdown.
`;

    const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        ...cleanHistory
      ],
      max_tokens: 140,
      temperature: 0.45
    });

    return Response.json({
      reply:
        aiResponse.response ||
        `RAWR ${visitorName}. ${selectedZone ? "Gaat het over netwerk, radio, telefonie, computer of crypto?" : "Welke zone zit je: OPS of TECH?"}`
    });

  } catch (err) {
    return Response.json(
      {
        reply: "RAWR Tiger error. Voor dringende problemen: Tigerhotline 27610005."
      },
      { status: 500 }
    );
  }
}
