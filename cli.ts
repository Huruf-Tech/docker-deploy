#!/usr/bin/env -S deno run -A

import { parseArgs as parse } from "@std/cli/parse-args";
import { dirname, join } from "@std/path";
import { existsSync } from "@std/fs";
import e, {
  type inferInput,
  type inferOutput,
  ValidationException,
} from "@oridune/validator";

import { Confirm, Input, Select } from "cliffy:prompt";
import { sh } from "./helpers/utils.ts";

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
  dockerCompose: e.optional(e.string()).default("./docker-compose.yml"),
  envPaths: e.optional(e.array(e.string()).min(1)).default(["./.env"]),
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

export const resolveDeployment = async (name: string, logPath: string) => {
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
) => {
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
  deployEnv: e.optional(e.in(Object.values(DeployEnv)))
    .default(DeployEnv.Production),
  deployType: e.optional(e.in(Object.values(DeployType)))
    .default(DeployType.Patch),
  logPath: e.optional(e.string()).default(
    join(Deno.cwd(), "deployment-logs.json"),
  ),

  deployDirty: e.optional(e.boolean()),
  skipBuild: e.optional(e.boolean()),
  skipPublish: e.optional(e.boolean()),
  skipApply: e.optional(e.boolean()),
  skipCommit: e.optional(e.boolean()),
}, { allowUnexpectedProps: true });

// export const build = async (
//   opts: {},
// ) => {
//   // Build docker image
//   const [_, dockerBuildErr] = await spawn(
//     `docker build -t ${DefaultImageTag} .`,
//   );

//   if (/^ERROR/.test(dockerBuildErr[0] ?? "")) {
//     throw new Error(`Docker build has been failed!`);
//   }

//   // Tag default image
//   await spawn(
//     `docker tag ${DefaultImageTag} ${ImageTag}`,
//   );
// };

export const deploy = async (
  opts?: inferInput<typeof optsSchema>,
  init?: Partial<inferInput<typeof deploymentLogEnvSchema>>,
) => {
  if (!opts?.deployDirty) {
    const output = await sh(
      ["git", "status", "--porcelain"],
    );

    console.log(output.trim());

    return;

    // if (stdout.length) {
    //   throw new Error(
    //     `Git staged files detected! Please commit any changes before the deployment!`,
    //   );
    // }
  }

  const options = await optsSchema.validate(opts);

  if (options.prompt) {
    if (
      options.deployEnv === DeployEnv.Production &&
      (await Input.prompt(
          "Are you sure you want to deploy to production? Type (sure)",
        )).toLowerCase() !== "sure"
    ) throw new Error("Deployment has been aborted!");
  }

  const resolvedName = options.name ?? dirname(Deno.cwd());

  const log = await resolveDeployment(resolvedName, options.logPath);

  let deployEnvOpts = log[options.deployEnv];

  if (options.prompt) {
    if (!deployEnvOpts) {
      if (
        !(await Confirm.prompt({
          message: `Do you want to initialize a new deployment?`,
        }))
      ) throw new Error(`No previous deployment logs found!`);

      const org = init?.dockerOrganization ?? await Input.prompt({
        message: "Provide your docker hub organization/id",
      });

      const image = init?.dockerImage ?? await Input.prompt({
        message: "Provide your docker image id",
      });

      const compose = init?.dockerCompose ?? await Input.prompt({
        message: "Provide your docker compose path",
      });

      const envPaths = init?.envPaths ?? (await Input.prompt({
        message: "Provide the env variable paths",
      })).split(/\s*,\s*/);

      const agentUrls = init?.agentUrls ?? (await Input.prompt({
        message: "Provide the agent urls",
      })).split(/\s*,\s*/);

      deployEnvOpts = {
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

  const deployEnv = await deploymentLogEnvSchema.validate(deployEnvOpts);

  if (!options.deployDirty) {
    const output = await sh(
      ["git", "status", "--porcelain"],
    );

    // if (stdout.length) {
    //   throw new Error(
    //     `Git staged files detected! Please commit any changes before the deployment!`,
    //   );
    // }
  }

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
};

if (import.meta.main) {
  await deploy({ ...parse(Deno.args), prompt: true });

  Deno.exit();
}
