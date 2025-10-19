#!/usr/bin/env -S deno run -A

import { parseArgs as parse } from "@std/cli/parse-args";
import { basename, join } from "@std/path";
import e, { type inferInput, type inferOutput } from "@oridune/validator";

import { Input, Secret, Select } from "@cliffy/prompt";
import { renderTemplate, sh } from "./helpers/utils.ts";

export enum DeployEnv {
  Staging = "staging",
  Development = "development",
  Production = "production",
}

export enum DeployType {
  Patch = "patch",
  Minor = "minor",
  Major = "major",
}

export const deploymentVersionSchema = e.object({
  [DeployType.Major]: e.optional(e.number()),
  [DeployType.Minor]: e.optional(e.number()),
  [DeployType.Patch]: e.optional(e.number()),
});

export const deploymentLogEnvSchema = e.object({
  dockerOrganization: e.string().max(50),
  dockerImage: e.string().max(100),
  dockerCompose: e.string(),
  envPaths: e.array(e.string()).min(1),
  version: deploymentVersionSchema,
  versionTag: e.optional(e.string()),
  agentUrls: e.array(e.string()).min(1),
});

export const deploymentLogSchema = e.object({
  name: e.string().max(50),
  [DeployEnv.Staging]: e.optional(deploymentLogEnvSchema),
  [DeployEnv.Development]: e.optional(deploymentLogEnvSchema),
  [DeployEnv.Production]: e.optional(deploymentLogEnvSchema),
});

type TDeploymentLogOutput = inferOutput<
  typeof deploymentLogSchema
>;

export const resolveDeployment = async (
  name: string,
  logPath: string,
): Promise<TDeploymentLogOutput> => {
  try {
    return JSON.parse(await Deno.readTextFile(logPath)) as TDeploymentLogOutput;
  } catch {
    const newDeployment = {
      name,
    } as TDeploymentLogOutput;

    await saveDeployment(logPath, newDeployment);

    return newDeployment;
  }
};

export const saveDeployment = async (
  logPath: string,
  log: TDeploymentLogOutput,
): Promise<void> => {
  await Deno.writeTextFile(
    logPath,
    JSON.stringify(
      log,
      null,
      2,
    ),
  );
};

export const optsSchema = e.object({
  prompt: e.optional(e.boolean()).default(false),
  name: e.optional(e.string().max(50)),
  deployEnv: e.optional(e.in(Object.values(DeployEnv))),
  deployType: e.optional(e.in(Object.values(DeployType))),
  logPath: e.optional(e.string()).default(
    join(Deno.cwd(), "deployment-logs.json"),
  ),

  deployDirty: e.optional(e.boolean()),
  skipBuild: e.optional(e.boolean()),
  skipPublish: e.optional(e.boolean()),
  skipApply: e.optional(e.boolean()),
  skipCommit: e.optional(e.boolean()),

  secretKey: e.optional(e.string()),
}, { allowUnexpectedProps: true });

export const deploy = async (
  opts?: inferInput<typeof optsSchema>,
  init?: Partial<inferInput<typeof deploymentLogEnvSchema>>,
) => {
  const options = await optsSchema.validate(opts);

  if (!options.deployDirty) {
    const output = await sh(
      ["git", "status", "--porcelain"],
    );

    if (output.length) {
      throw new Error(
        `Git staged files detected! Please commit any changes before the deployment!`,
      );
    }
  }

  if (options.prompt) {
    options.deployEnv = await Select.prompt({
      message: "Select deployment type",
      options: Object.values(DeployEnv),
    }) as DeployEnv;

    options.deployType = await Select.prompt({
      message: "Select deployment type",
      options: Object.values(DeployType),
    }) as DeployType;

    if (
      options.deployEnv === DeployEnv.Production &&
      (await Input.prompt(
          "Are you sure you want to deploy to production? Type (sure)",
        )).toLowerCase() !== "sure"
    ) throw new Error("Deployment has been aborted!");
  }

  const resolvedName = options.name ?? basename(Deno.cwd());

  const log = await resolveDeployment(resolvedName, options.logPath);

  if (!options.deployEnv) {
    throw new Error("A deployment environment is required!");
  }

  if (options.prompt) {
    if (!log[options.deployEnv]) {
      const org = init?.dockerOrganization ?? await Input.prompt({
        message: "Provide your docker hub organization/id",
        validate: (value) => value.length > 2 || "Invalid organization",
      });

      const image = init?.dockerImage ?? await Input.prompt({
        message: "Provide your docker image id",
        validate: (value) => value.length > 2 || "Invalid image name",
      });

      const compose = init?.dockerCompose ?? await Input.prompt({
        message: "Provide your docker compose path",
        default: "./docker-compose.yml",
      });

      const envPaths = init?.envPaths ?? (await Input.prompt({
        message: "Provide the env variable paths",
        default: "./.env",
      })).split(/\s*,\s*/);

      const agentUrls = init?.agentUrls ?? (await Input.prompt({
        message: "Provide the agent urls",
        validate: (value) => value.length > 2 || "Invalid agent url",
      })).split(/\s*,\s*/);

      log[options.deployEnv] = {
        version: {
          major: 0,
          minor: 0,
          patch: 0,
        },
        versionTag: undefined,
        dockerOrganization: org,
        dockerImage: image,
        dockerCompose: compose,
        envPaths,
        agentUrls,
      };
    }
  }

  const deployEnv = await deploymentLogEnvSchema.validate(
    log[options.deployEnv],
  );

  const ImageName = `${deployEnv.dockerImage}-${options.deployEnv}`;
  const ImageVersion = [
    [
      deployEnv.version.major,
      deployEnv.version.minor,
      deployEnv.version.patch,
    ].join("."),
    deployEnv.versionTag,
  ].filter(Boolean).join("-");
  const ImageTag =
    `${deployEnv.dockerOrganization}/${ImageName}:v${ImageVersion}`;

  if (!options.skipBuild) {
    console.info("Building docker image...");

    await sh(
      ["docker", "build", "-t", ImageTag, "."],
    );
  }

  if (!options.skipPublish) {
    console.info("Pushing docker image...");

    // Push docker image to docker hub
    await sh(
      ["docker", "push", ImageTag],
    );
  }

  if (!options.skipApply) {
    console.info("Starting deployment...");

    if (options.prompt && typeof options.secretKey !== "string") {
      options.secretKey = await Secret.prompt({
        message: "Enter agent secret",
      });
    }

    const deployEnv = log[options.deployEnv]!;

    const templateData = {
      name: resolvedName,
      environment: options.deployEnv,
      image: ImageTag,
      imageName: ImageName,
      ImageVersion: ImageVersion,
    };

    const compose = renderTemplate(
      await Deno.readTextFile(
        renderTemplate(deployEnv.dockerCompose, templateData),
      ),
      templateData,
    );

    const env = (await Promise.all(
      deployEnv.envPaths.map((path) =>
        Deno.readTextFile(renderTemplate(path, templateData))
      ),
    )).join("\n");

    const deployedUrls: string[] = [];

    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Content": "application/json",
        "Authorization": "Bearer " + options.secretKey,
      },
      body: JSON.stringify({
        app: resolvedName,
        compose,
        env,
      }),
    };

    try {
      for (const url of deployEnv.agentUrls) {
        console.info("Deploying:", url);

        const res = await fetch(new URL("/deploy", url), init);

        const data = await res.json();

        if (!data.success) {
          throw new Error("Deployment to one of the nodes failed!", {
            cause: data,
          });
        }

        deployedUrls.push(url);
      }
    } catch (error) {
      // Rollback previous deployments
      for (const url of deployedUrls) {
        await fetch(new URL("/rollback", url), init);
      }

      throw error;
    }
  }

  await saveDeployment(options.logPath, log);

  // git commit
  if (!options.skipCommit) {
    await sh(["git", "add", "."]);
    await sh(["git", "commit", "-m", `"Automated deployment: ${ImageTag}"`]);
  }

  console.info("Process completed");
};

if (import.meta.main) {
  const { default: denoConfig } = await import("./deno.json", {
    with: { type: "json" },
  });

  console.info("Docker Deploy Version:", denoConfig.version);

  await deploy({ ...parse(Deno.args), prompt: true });

  Deno.exit();
}
