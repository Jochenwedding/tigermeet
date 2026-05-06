export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, name } = await request.json();

    if (!message || typeof message !== "string") {
      return Response.json({
        reply: "RAWR Tiger welkom in Araxos! Zit je probleem in OPS of TECH zone? Voor dringend gejank: Tigerhotline 27610005."
      });
    }

    const visitorName = name?.trim() || "hete tijger";
    const isSimone = visitorName.toLowerCase().includes("simone");

    if (isSimone) {
      return Response.json({
        reply: `RAWR Simone. Trek uw plan, hete tijger. Voor echte dringende problemen: Tigerhotline 27610005.`
      });
    }

    const systemPrompt = `
Je bent TIGER IT SUPPORT AI op Araxos Airbase.

ALTIJD starten met:
"RAWR Tiger welkom in Araxos, ${visitorName}! Zit je probleem in OPS of TECH zone?"

Belangrijke vaste regels:
- Vraag in het begin duidelijk of het probleem in OPS of TECH zone zit.
- Voor dringende problemen: verwijs naar de Tigerhotline 27610005.
- Als de gebruiker een medewerker wil spreken, zeg ALTIJD:
"Jochen is druk bezig met belangrijk werk. Bel de Tigerhotline 27610005 en vraag naar Kevin, Tommy, Piccart, Bram of Jorrit."
- Als de gebruiker Simone heet of over Simone gaat: zeg dat hij zijn plan trekt.

Persoonlijkheid:
- Casual Vlaams/Nederlands.
- Kort, direct, grappig, cocky en behulpzaam.
- Tiger squadron spirit.
- Zeg af en toe "RAWR", "hete tijger", "Gunny is de man".
- Geen lange uitleg tenzij gevraagd.
- Maximum 1 gerichte vraag terug.

Gedrag:
- Bij technisch probleem: vraag eerst OPS of TECH zone.
- Daarna vraag je of het gaat over telefonie, internet, printer of persoonlijk toestel.
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
      temperature: 0.65
    });

    return Response.json({
      reply:
        aiResponse.response ||
        `RAWR Tiger welkom in Araxos, ${visitorName}! Zit je probleem in OPS of TECH zone? Voor dringend gedoe: Tigerhotline 27610005. Jochen is natuurlijk druk bezig.`
    });

  } catch (err) {
    return Response.json(
      {
        reply:
          "RAWR Tiger error, hete tijger. Zit je in OPS of TECH zone? Voor dringende problemen: Tigerhotline 27610005. Jochen is druk bezig, uiteraard."
      },
      { status: 500 }
    );
  }
}
