import {
  AcpSessionImpl as SharedAcpSessionImpl,
  type AcpSessionConstructOptions as SharedConstructOptions,
} from "@openma/common/acp-runtime";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ChildHandle, SessionOptions } from "./types.js";

export interface AcpSessionConstructOptions
  extends Omit<SharedConstructOptions, "options"> {
  options: SessionOptions;
}

type ChildExit = Awaited<ChildHandle["exited"]>;

export class AcpSessionImpl extends SharedAcpSessionImpl {
  declare readonly options: SessionOptions;
  readonly #child: ChildHandle;
  #childExit: ChildExit | null = null;

  constructor(deps: AcpSessionConstructOptions) {
    super(deps);
    this.#child = deps.child;
    void deps.child.exited.then((result) => {
      this.#childExit = result;
    });
  }

  override prompt(
    input: string | readonly ContentBlock[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    return this.#guardPrompt(super.prompt(input, options));
  }

  async *#guardPrompt(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
    try {
      yield* stream;
    } catch (error) {
      const exit = this.#childExit ?? await settledChildExit(this.#child.exited);
      if (exit || isBrokenPipe(error)) {
        throw agentProcessExitError(this.options.agent.command, exit, error);
      }
      throw error;
    }
  }

  override isAlive(): boolean {
    return super.isAlive() && this.#childExit === null;
  }
}

async function settledChildExit(
  exited: ChildHandle["exited"],
): Promise<ChildExit | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 25);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isBrokenPipe(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "EPIPE"
    || code === "ERR_STREAM_DESTROYED"
    || /\bEPIPE\b|broken pipe|stream (?:is )?(?:closed|destroyed)/i.test(message)
  );
}

function agentProcessExitError(
  command: string,
  exit: ChildExit | null,
  cause: unknown,
): Error {
  const status = exit?.signal
    ? `signal ${exit.signal}`
    : exit?.code != null
      ? `exit code ${exit.code}`
      : "no exit status";
  return new Error(
    `The agent process exited before it could accept the prompt (${command}, ${status}). `
      + "Reopen the task to restart it, or check this agent's setup and sign-in.",
    { cause },
  );
}
