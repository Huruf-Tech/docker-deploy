export async function sh(cmd: string[], cwd?: string) {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const { code, stdout, stderr } = await p;

  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));

  return new TextDecoder().decode(stdout);
}

export const jsonResponse = (json: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(json), {
    ...init,
    headers: {
      ...init?.headers,
      "content-type": "application/json",
    },
  });
