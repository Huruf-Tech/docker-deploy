import { jsonResponse, sh } from "./helpers/utils.ts";

const ACCESS_TOKEN = Deno.env.get("ACCESS_TOKEN") ?? crypto.randomUUID();
const APPS_ROOT = Deno.env.get("APPS_ROOT") ?? "/opt/apps";

Deno.serve({ port: 3740 }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/health") return jsonResponse({ healthy: true, ACCESS_TOKEN });

  const authToken = (req.headers.get("authorization") || "").split(" ")[1];

  if (authToken !== ACCESS_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method === "POST" && url.pathname === "/deploy") {
    const { app, image, env = {}, compose } = await req.json();
  }

  return jsonResponse({});
});
