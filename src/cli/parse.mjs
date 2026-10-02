const BOOLEAN_FLAGS = new Set(["json", "help", "wait", "stream", "force", "clear"]);
const REPEATABLE_FLAGS = new Set(["source", "dir"]);

export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParseError";
    this.code = "invalid_args";
  }
}

/**
 * `backchat <group> <action> [positionals] [--flags]`.
 * `--client` and `--json` are global and may appear anywhere.
 */
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let client;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!key) throw new ParseError("Missing flag name");
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    let value;
    if (inline !== undefined) value = inline;
    else if (BOOLEAN_FLAGS.has(key)) value = true;
    else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new ParseError(`Missing value for --${key}`);
      }
      value = next;
      index += 1;
    }
    if (key === "client") {
      client = String(value);
      continue;
    }
    if (REPEATABLE_FLAGS.has(key)) {
      const current = Array.isArray(flags[key]) ? flags[key] : [];
      flags[key] = [...current, String(value)];
      continue;
    }
    flags[key] = BOOLEAN_FLAGS.has(key) ? true : value;
  }
  return {
    json: flags.json === true,
    help: flags.help === true,
    client,
    group: positionals[0],
    action: positionals[1],
    args: positionals.slice(2),
    flags,
  };
}
