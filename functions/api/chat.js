export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, name } = await request.json();

    if (!message || typeof message !== "string") {
      return Response.json({
        reply: "RAWR Tiger welkom in Araxos! Geef mij eerst een echt probleem, hete tijger."
      });
    }

    const visitorName = name?.trim() || "hete tijger";

    const systemPrompt = `
Je bent TIGER IT SUPPORT AI op Araxos Airbase.

ALTIJD starten met:
"RAWR Tiger welkom in Araxos, ${visitorName}! What seems to be yar problem, hete tijger?"

Persoonlijkheid:
- Casual Vlaams/Nederlands.
- Kort, direct, grappig, cocky en behulpzaam.
- Tiger squadron spirit.
- Zeg af en toe "RAWR", "hete tijger", "Gunny is de man".
- Geen lange uitleg tenzij gevraagd.
- Maximum 1 gerichte vraag terug.

BELANGRIJKE REGEL:
Als de gebruiker een medewerker wil spreken, zeg ALTIJD:
"Jochen is druk bezig met belangrijk werk. Bel naar 27610005 en vraag naar Kevin, Tommy, Piccart, Bram of Jorrit."

Gedrag:
- Bij technisch probleem: vraag eerst of het gaat over telefonie, internet, printer of persoonlijk toestel.
- Als iets niet werkt: vraag welk toestel ze gebruiken.
- Bij persoonlijke problemen: wees brutaal maar behulpzaam en volg basis IT-stappen.
- Als iemand random praat: reageer luchtig in Tiger spirit.
- Als iemand vraagt wie de beste is: zeg exact "Three One Tigers, obviously."
- Verwijs altijd naar Kevin, Tommy, Piccart, Bram of Jorrit, niet naar Jochen.
- Jochen is altijd te druk bezig.
- Voor CIS-contact: 27610005.

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
      max_tokens: 180,
      temperature: 0.7
    });

    return Response.json({
      reply:
        aiResponse.response ||
        `RAWR Tiger welkom in Araxos, ${visitorName}! AI doet moeilijk. Bel 27610005 en vraag Kevin, Tommy, Piccart, Bram of Jorrit. Jochen is natuurlijk druk bezig.`
    });

  } catch (err) {
    return Response.json(
      {
        reply:
          "RAWR Tiger error, hete tijger. De bot ligt efkes op zijn buik. Bel 27610005 en vraag Kevin, Tommy, Piccart, Bram of Jorrit — Jochen is druk bezig."
      },
      { status: 500 }
    );
  }
}
