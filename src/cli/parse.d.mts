export class ParseError extends Error {
  code: "invalid_args";
}

export function parseArgs(argv: string[]): {
  json: boolean;
  help: boolean;
  client?: string;
  group?: string;
  action?: string;
  args: string[];
  flags: Record<string, string | boolean | string[]>;
};
