export const sh = async (cmd: string[], cwd?: string) => {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const { code, stdout, stderr } = await p;

  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));

  return new TextDecoder().decode(stdout);
};

export const renderTemplate = (
  template: string,
  data: Record<string, string>,
) => {
  let content = template;

  for (const [key, value] of Object.entries(data)) {
    content = content.replace(`__${key}__`, value);
  }

  return content;
};
