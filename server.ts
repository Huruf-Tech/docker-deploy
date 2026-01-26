import { sh } from "./helpers/utils.ts";
import e from "@oridune/validator";

const ACCESS_TOKEN = Deno.env.get("ACCESS_TOKEN") ?? crypto.randomUUID();
const SYSTEM_USER = Deno.env.get("SYSTEM_USER") ?? "ubuntu";
const APPS_ROOT = Deno.env.get("APPS_ROOT") ?? `/home/${SYSTEM_USER}/apps`;

const ensureAppDir = async (app: string, tag: string) => {
  const dir = `${APPS_ROOT}/${app}/${tag}`;

  await Deno.mkdir(dir, { recursive: true });

  return dir;
};

const rollback = async (
  details: {
    app: string;
    tag: string;
    preCommand?: string;
    postCommand?: string;
  },
) => {
  const appDir = await ensureAppDir(details.app, details.tag);

  const backupComposePath = `${appDir}/docker-compose.backup.yml`;
  const backupEnvPath = `${appDir}/backup.env`;
  const preBackupCommandPath = `${appDir}/.pre_deploy.backup.sh`;
  const postBackupCommandPath = `${appDir}/.post_deploy.backup.sh`;

  if (details.preCommand) {
    await sh(
      details.preCommand.split(" "),
      appDir,
    );
  }

  const [compose, env, preCommand, postCommand] = await Promise.all([
    Deno.readTextFile(backupComposePath),
    Deno.readTextFile(backupEnvPath).catch(() => undefined),
    Deno.readTextFile(preBackupCommandPath).catch(() => undefined),
    Deno.readTextFile(postBackupCommandPath).catch(() => undefined),
  ]);

  await deploy({
    app: details.app,
    tag: details.tag,
    compose,
    env,
    preCommand,
    postCommand,
  }, {
    noBackup: true,
  });

  if (details.postCommand) {
    await sh(
      details.postCommand.split(" "),
      appDir,
    );
  }
};

const deploy = async (
  details: {
    app: string;
    tag: string;
    compose: string;
    env?: string;
    preCommand?: string;
    postCommand?: string;
  },
  opts?: {
    noBackup: boolean;
  },
) => {
  const appDir = await ensureAppDir(details.app, details.tag);

  const composePath = `${appDir}/docker-compose.yml`;
  const envPath = `${appDir}/.env`;
  const preCommandPath = `${appDir}/.pre_deploy.sh`;
  const postCommandPath = `${appDir}/.post_deploy.sh`;

  if (!opts?.noBackup) {
    const backupComposePath = `${appDir}/docker-compose.backup.yml`;
    const backupEnvPath = `${appDir}/backup.env`;
    const preBackupCommandPath = `${appDir}/.pre_deploy.backup.sh`;
    const postBackupCommandPath = `${appDir}/.post_deploy.backup.sh`;

    const backupFiles = await Promise.allSettled([
      Deno.readTextFile(composePath),
      Deno.readTextFile(envPath),
      Deno.readTextFile(preCommandPath),
      Deno.readTextFile(postCommandPath),
    ]);

    await Promise.allSettled([
      backupFiles[0].status === "fulfilled" && Deno.writeTextFile(
        backupComposePath,
        backupFiles[0].value,
      ),
      backupFiles[1].status === "fulfilled" && Deno.writeTextFile(
        backupEnvPath,
        backupFiles[1].value,
      ),
      backupFiles[2].status === "fulfilled" && Deno.writeTextFile(
        preBackupCommandPath,
        backupFiles[2].value,
      ),
      backupFiles[3].status === "fulfilled" && Deno.writeTextFile(
        postBackupCommandPath,
        backupFiles[3].value,
      ),
    ]).catch(() => {
      // Do nothing...
    });
  }

  await Deno.writeTextFile(composePath, details.compose);

  if (details.env) await Deno.writeTextFile(envPath, details.env);

  if (details.preCommand) {
    await sh(
      details.preCommand.split(" "),
      appDir,
    );

    await Deno.writeTextFile(preCommandPath, details.preCommand);
  }

  // Space cleanup
  await sh(["docker", "system", "prune", "-a", "-f"], appDir);

  // Pull and up with minimal downtime
  await sh(["docker", "compose", "pull"], appDir);

  await sh([
    "docker",
    "compose",
    "up",
    "-d",
    "--remove-orphans",
    "--force-recreate",
  ], appDir);

  if (details.postCommand) {
    await sh(
      details.postCommand.split(" "),
      appDir,
    );

    await Deno.writeTextFile(postCommandPath, details.postCommand);
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
        tag: e.string().min(2).max(100),
        compose: e.string(),
        env: e.optional(e.string()),
        preCommand: e.optional(e.string()),
        postCommand: e.optional(e.string()),
      }, { allowUnexpectedProps: true }).validate(await req.json());

      await deploy(data);

      return jsonResponse({ success: true });
    }

    if (req.method === "POST" && url.pathname === "/rollback") {
      const data = await e.object({
        app: e.string().min(2).max(100),
        tag: e.string().min(2).max(100),
        preCommand: e.optional(e.string()),
        postCommand: e.optional(e.string()),
      }, { allowUnexpectedProps: true }).validate(await req.json());

      await rollback(data);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (err) {
    const error = err as Error;

    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
