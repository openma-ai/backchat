export const ExitCode: {
  ok: 0;
  error: 1;
  appNotRunning: 2;
  notFound: 3;
  timeout: 4;
  invalidArgs: 5;
};

export function exitCodeFor(code: string): number;
