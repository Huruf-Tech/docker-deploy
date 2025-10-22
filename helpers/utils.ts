type ShOptions = {
  cwd?: string;
  /** How many trailing lines to show live (dim). Default: 4, set 0 to disable. */
  tail?: number;
};

export const sh = async (
  cmd: string[],
  cwdOrOpts: string | ShOptions = {},
) => {
  const opts: ShOptions = typeof cwdOrOpts === "string"
    ? { cwd: cwdOrOpts }
    : cwdOrOpts || {};

  const tail = Math.max(0, opts.tail ?? 4);

  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const decoder = new TextDecoder();

  let stdoutFull = "";
  let stderrFull = "";

  // For assembling lines across chunk boundaries
  let carryOut = "";
  let carryErr = "";

  // Shared rolling buffer of recent lines from both stdout/stderr
  const recent: string[] = [];
  let printedLines = 0;

  const enc = new TextEncoder();

  const ansi = {
    // Move cursor up N lines
    up: (n: number) => (n > 0 ? `\x1b[${n}A` : ""),
    // Move cursor to column 1, clear whole line
    clearLine: `\r\x1b[2K`,
    // Dim on / reset
    dimOn: `\x1b[2m`,
    reset: `\x1b[0m`,
  };

  const canTTY = Deno.stdout.isTerminal();

  const render = (lines: string[]) => {
    if (!canTTY || tail === 0) return;

    // Move cursor to the top of the previously printed block
    if (printedLines > 0) {
      Deno.stdout.writeSync(enc.encode(ansi.up(printedLines)));
    }

    // Clear the previous block (each line), keeping the cursor at the top
    for (let i = 0; i < printedLines; i++) {
      Deno.stdout.writeSync(enc.encode(ansi.clearLine + "\n"));
    }
    if (printedLines > 0) {
      // Move back up after clearing
      Deno.stdout.writeSync(enc.encode(ansi.up(printedLines)));
    }

    // Print the new block (dim)
    for (const line of lines) {
      Deno.stdout.writeSync(
        enc.encode(`${ansi.clearLine}${ansi.dimOn}${line}${ansi.reset}\n`),
      );
    }
    printedLines = lines.length;
  };

  // Push lines to recent buffer and re-render
  const pushLines = (lines: string[]) => {
    if (lines.length === 0) return;
    for (const ln of lines) {
      if (ln === "") continue;
      recent.push(ln);
      if (recent.length > Math.max(1, tail)) {
        recent.splice(0, recent.length - tail);
      }
    }
    render(recent);
  };

  // Stream handlers
  const pumpStdout = (async () => {
    for await (const chunk of proc.stdout) {
      const text = decoder.decode(chunk);
      stdoutFull += text;

      const parts = (carryOut + text).split(/\r?\n/);
      carryOut = parts.pop() ?? "";
      pushLines(parts);
    }
  })();

  const pumpStderr = (async () => {
    for await (const chunk of proc.stderr) {
      const text = decoder.decode(chunk);
      stderrFull += text;

      const parts = (carryErr + text).split(/\r?\n/);
      carryErr = parts.pop() ?? "";
      pushLines(parts);
    }
  })();

  const status = await proc.status;
  await Promise.all([pumpStdout, pumpStderr]);

  // Flush any remaining partial lines
  pushLines([carryOut, carryErr].filter(Boolean));

  // After finishing, drop the dim window by printing a blank line to “commit” it
  if (canTTY && tail > 0 && printedLines > 0) {
    // Move to bottom of block so subsequent logs appear after it
    Deno.stdout.writeSync(enc.encode(ansi.reset));
  }

  if (!status.success) {
    const err = stderrFull.trim() || "Unknown error";
    // Ensure we finish on a fresh line
    if (canTTY && tail > 0) Deno.stdout.writeSync(enc.encode("\n"));
    throw new Error(err);
  }

  // Ensure we finish on a fresh line
  if (canTTY && tail > 0) Deno.stdout.writeSync(enc.encode("\n"));

  return stdoutFull.trim();
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
