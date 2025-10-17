import { sh } from "./helpers/utils.ts";
import e from "@oridune/validator";

const ACCESS_TOKEN = Deno.env.get("ACCESS_TOKEN") ?? crypto.randomUUID();
const SYSTEM_USER = Deno.env.get("SYSTEM_USER") ?? "ubuntu";
const APPS_ROOT = Deno.env.get("APPS_ROOT") ?? `/home/${SYSTEM_USER}/apps`;

const ensureAppDir = async (app: string) => {
  const dir = `${APPS_ROOT}/${app}`;

  await Deno.mkdir(dir, { recursive: true });

  return dir;
};

const rollback = async (app: string) => {
  const appDir = await ensureAppDir(app);
  const backupComposePath = `${appDir}/docker-compose.backup.yml`;
  const backupEnvPath = `${appDir}/backup.env`;

  await deploy({
    app,
    compose: await Deno.readTextFile(backupComposePath),
    env: await Deno.readTextFile(backupEnvPath).catch(() => undefined),
  });
}

const deploy = async (opts: { app: string; compose: string; env?: string }) => {
  const appDir = await ensureAppDir(opts.app);
  const backupComposePath = `${appDir}/docker-compose.backup.yml`;
  const composePath = `${appDir}/docker-compose.yml`;
  const backupEnvPath = `${appDir}/backup.env`;
  const envPath = `${appDir}/.env`;

  try {
    await Deno.writeTextFile(
      backupComposePath,
      await Deno.readTextFile(composePath),
    );

    await Deno.writeTextFile(
      backupEnvPath,
      await Deno.readTextFile(envPath),
    );
  } catch {
    // Do nothing...
  }

  await Deno.writeTextFile(composePath, opts.compose);

  if (opts.env) await Deno.writeTextFile(envPath, opts.env);

  // Pull and up with minimal downtime
  await sh(["docker", "compose", "pull"], appDir);

  try {
    await sh(["docker", "compose", "up", "-d", "--remove-orphans"], appDir);
  } catch {
    await rollback(opts.app);
  }
};

const jsonResponse = (json: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(json), {
    ...init,
    headers: {
      ...init?.headers,
      "content-type": "application/json",
    },
  });

Deno.serve({ port: 3740 }, async (req) => {
  try {
    const url = new URL(req.url);

    if (url.pathname === "/health") return jsonResponse({ success: true });

    const authToken = (req.headers.get("authorization") || "").split(" ")[1];

    if (authToken !== ACCESS_TOKEN) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    if (req.method === "POST" && url.pathname === "/deploy") {
      const data = await e.object({
        app: e.string().min(2).max(100),
        compose: e.string(),
        env: e.optional(e.string()),
      }).validate(await req.json());

      await deploy(data);

      return jsonResponse({ success: true });
    }

    if (req.method === "POST" && url.pathname === "/rollback") {
      const data = await e.object({
        app: e.string().min(2).max(100),
      }).validate(await req.json());

      await rollback(data.app);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (err) {
    const error = err as Error;

    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
