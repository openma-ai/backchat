import type { Locator, Page } from "@playwright/test";

import type { TestBridge } from "./test-bridge";

export type MatrixHarness = {
  id: string;
  label: string;
  version: string;
};

export type MatrixCellStatus =
  | "pass-live"
  | "pass-replay"
  | "fail"
  | "blocked"
  | "upstream-gap"
  | "n-a";

export type MatrixDriverContext = {
  page: Page;
  bridge: TestBridge;
  harness: MatrixHarness;
  sessionId: string;
  turnId: string;
  cwd: string;
  injectEvent: (event: Record<string, unknown>) => Promise<void>;
  injectSession: (input?: {
    supportsSessionFork?: boolean;
    supportsSessionResume?: boolean;
    supportsSessionClose?: boolean;
    configOptions?: unknown[];
  }) => Promise<void>;
};

export type MatrixDriverResult = {
  target: Locator;
  selector: string;
  expected: string;
  observed: string;
  trigger: string;
  status?: MatrixCellStatus;
  verificationMode?: "live" | "replay";
  evidence?: string[];
};

export type MatrixFeatureDriver = {
  id: string;
  run: (context: MatrixDriverContext) => Promise<MatrixDriverResult>;
};
