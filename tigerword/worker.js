export default {
  async fetch(request, env) {
    return new Response("TigerWord Worker OK 🐯", {
      headers: { "content-type": "text/plain;charset=UTF-8" }
    });
  }
};

export class TigerWordRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
}
