export async function onRequest() {
  return new Response("404 Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}
