export function runCli(
  argv: string[],
  env?: NodeJS.ProcessEnv,
  io?: {
    stdout(line: string): void;
    stderr(line: string): void;
  },
): Promise<number>;
