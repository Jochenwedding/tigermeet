export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message } = await request.json();

    const systemPrompt = `
Je bent een CIS supportbot.
Antwoord kort en praktisch.
Geen gevoelige info geven.
`;

    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ]
    });

    return Response.json({
      reply: response.response
    });

  } catch (err) {
    return Response.json({
      reply: "Error."
    }, { status: 500 });
  }
}