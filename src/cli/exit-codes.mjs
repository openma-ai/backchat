/** Keep these numbers aligned with src/shared/control-protocol.ts ExitCode. */
export const ExitCode = {
  ok: 0,
  error: 1,
  appNotRunning: 2,
  notFound: 3,
  timeout: 4,
  invalidArgs: 5,
};

export function exitCodeFor(code) {
  switch (code) {
    case "app_not_running":
      return ExitCode.appNotRunning;
    case "not_found":
      return ExitCode.notFound;
    case "timeout":
      return ExitCode.timeout;
    case "invalid_args":
      return ExitCode.invalidArgs;
    default:
      return ExitCode.error;
  }
}
