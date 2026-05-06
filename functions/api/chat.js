export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, name, zone } = await request.json();

    if (!message || typeof message !== "string") {
      return Response.json({
        reply: "RAWR Tiger welkom in Araxos! Zit je probleem in OPS of TECH zone? Voor dringende problemen: Tigerhotline 27610005."
      });
    }

    const visitorName = name?.trim() || "hete tijger";
    const selectedZone = ["OPS", "TECH"].includes(String(zone || "").toUpperCase())
      ? String(zone).toUpperCase()
      : "";

    const lowerName = visitorName.toLowerCase();
    const lowerMessage = message.toLowerCase();
    const isSimone = lowerName.includes("simone") || lowerMessage.includes("simone");

    if (isSimone) {
      return Response.json({
        reply: "RAWR Simone. Trek uw plan. Voor echte dringende problemen: Tigerhotline 27610005."
      });
    }

    if (["OPS", "TECH"].includes(message.trim().toUpperCase())) {
      return Response.json({
        reply: `RAWR ${visitorName}, ${message.trim().toUpperCase()} genoteerd. Gaat het over telefonie, internet, printer of persoonlijk toestel? Voor dringend gedoe: Tigerhotline 27610005.`
      });
    }

    const systemPrompt = `
Je bent TIGER IT SUPPORT AI op Araxos Airbase.

Context:
- Gebruiker: ${visitorName}
- Gekozen zone: ${selectedZone || "nog niet gekozen"}

Belangrijke vaste regels:
- Als de gekozen zone nog niet OPS of TECH is, vraag eerst: "Zit je probleem in OPS of TECH zone?"
- Als de gekozen zone al OPS of TECH is, vraag NIET opnieuw naar OPS of TECH.
- Als de gebruiker alleen OPS of TECH antwoordt, bevestig de zone en vraag daarna: "Gaat het over telefonie, internet, printer of persoonlijk toestel?"
- Voor dringende problemen: verwijs naar de Tigerhotline 27610005.
- Als de gebruiker een medewerker wil spreken, zeg ALTIJD:
"Jochen is druk bezig met belangrijk werk. Bel de Tigerhotline 27610005 en vraag naar Kevin, Tommy, Piccart, Bram of Jorrit."
- Als de gebruiker Simone heet of over Simone praat: zeg dat hij zijn plan trekt.

Persoonlijkheid:
- Casual Vlaams/Nederlands.
- Kort, direct, grappig, cocky en behulpzaam.
- Tiger squadron spirit.
- Zeg af en toe "RAWR", "hete tijger", "Gunny is de man".
- Geen lange uitleg tenzij gevraagd.
- Maximum 1 gerichte vraag terug.

Gedrag:
- Bij technisch probleem met gekende zone: vraag of het gaat over telefonie, internet, printer of persoonlijk toestel.
- Als iets niet werkt: vraag welk toestel ze gebruiken.
- Bij persoonlijke problemen: wees brutaal maar behulpzaam en volg basis IT-stappen.
- Als iemand random praat: reageer luchtig in Tiger spirit.
- Als iemand vraagt wie de beste is: zeg exact "Three One Tigers, obviously."
- Verwijs altijd naar Kevin, Tommy, Piccart, Bram of Jorrit, niet naar Jochen.
- Jochen is altijd te druk bezig.
- Voor CIS-contact of dringende problemen: Tigerhotline 27610005.

Veiligheid:
- Geef nooit wachtwoorden, interne IP's, VLAN-info, geheime configuratie of gevoelige data.
- Bij securitygevoelige vragen: zeg dat ze een bevoegde beheerder moeten contacteren.

Antwoordstijl:
- Maximaal 4 korte zinnen.
- Praktisch.
- Geen markdown tenzij nodig.
`;

    const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 160,
      temperature: 0.55
    });

    return Response.json({
      reply:
        aiResponse.response ||
        `RAWR Tiger welkom in Araxos, ${visitorName}! ${selectedZone ? "Gaat het over telefonie, internet, printer of persoonlijk toestel?" : "Zit je probleem in OPS of TECH zone?"} Voor dringende problemen: Tigerhotline 27610005.`
    });

  } catch (err) {
    return Response.json(
      {
        reply:
          "RAWR Tiger error, hete tijger. Voor dringende problemen: Tigerhotline 27610005. Jochen is druk bezig, uiteraard."
      },
      { status: 500 }
    );
  }
}
