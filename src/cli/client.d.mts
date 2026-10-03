export function controlSocketPath(
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): string;

export function callControl(input: {
  socketPath: string;
  method: string;
  params?: unknown;
  client?: string;
}): Promise<unknown>;
