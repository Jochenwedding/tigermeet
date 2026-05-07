export async function onRequestPost(context) {
  const { request, env } = context;

  try {

    const body = await request.json();
    const id = String(body.id || "");

    if (!env.TICKETS) {
      return Response.json({
        ok:false,
        error:"TICKETS binding ontbreekt"
      }, { status:500 });
    }

    if (!id) {
      return Response.json({
        ok:false,
        error:"Geen ID"
      }, { status:400 });
    }

    await env.TICKETS.delete(id);

    return Response.json({
      ok:true
    });

  } catch(err){

    return Response.json({
      ok:false,
      error:"Server error"
    }, { status:500 });

  }
}