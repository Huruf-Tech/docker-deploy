import { jsonResponse, sh } from "./helpers/utils.ts";

const ACCESS_TOKEN = Deno.env.get("ACCESS_TOKEN") ?? crypto.randomUUID();
const SYSTEM_USER = Deno.env.get("SYSTEM_USER") ?? "ubuntu";
const APPS_ROOT = Deno.env.get("APPS_ROOT") ?? `/home/${SYSTEM_USER}/apps`;

async function ensureAppDir(app: string) {
  const dir = `${APPS_ROOT}/${app}`;

  await Deno.mkdir(dir, { recursive: true });

  return dir;
}

Deno.serve({ port: 3740 }, async (req) => {
  try {
    const url = new URL(req.url);

    if (url.pathname === "/health") return jsonResponse({ success: true });

    const authToken = (req.headers.get("authorization") || "").split(" ")[1];

    if (authToken !== ACCESS_TOKEN) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    if (req.method === "POST" && url.pathname === "/deploy") {
      const { app, compose, env } = await req.json();

      const appDir = await ensureAppDir(app);

      if (compose) {
        await Deno.writeTextFile(`${appDir}/docker-compose.yml`, compose);
      }

      if (env) {
        await Deno.writeTextFile(`${appDir}/.env`, env);
      }

      // Pull and up with minimal downtime
      await sh(["docker", "compose", "pull"], appDir);
      await sh(["docker", "compose", "up", "-d", "--remove-orphans"], appDir);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (err) {
    const error = err as Error;

    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
