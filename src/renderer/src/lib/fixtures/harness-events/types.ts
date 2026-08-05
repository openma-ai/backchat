export const HARNESS_COVERAGE_DIMENSIONS = [
  "capability",
  "commands",
  "modeConfig",
  "plan",
  "usage",
  "sessionStatus",
  "terminalBackground",
  "callback",
  "nativeAgent",
] as const;

export type HarnessCoverageDimension =
  (typeof HARNESS_COVERAGE_DIMENSIONS)[number];

export interface HarnessEvidence {
  /** Versioned source file, official documentation URL, or captured fixture. */
  reference: string;
  /** The exact positive or negative claim established by that reference. */
  claim: string;
}

type EvidenceList = readonly [HarnessEvidence, ...HarnessEvidence[]];

export type HarnessCoverageEntry<
  EventKey extends string,
  SetupKey extends string,
> =
  | {
      status: "emitted_event";
      eventKey: EventKey;
      expectedCanonicalTypes: readonly string[];
      guiSlot: string;
      evidence: EvidenceList;
    }
  | {
      status: "setup_response";
      setupKey: SetupKey;
      expectedCanonicalTypes: readonly ["session.started"];
      guiSlot: string;
      evidence: EvidenceList;
    }
  | {
      status: "capability_only";
      guiSlot: string;
      evidence: EvidenceList;
    }
  | {
      status: "not_emitted";
      evidence: EvidenceList;
    }
  | {
      status: "unverified";
      evidence: EvidenceList;
    };

export type HarnessCoverage<
  EventKey extends string,
  SetupKey extends string,
> = Record<
  HarnessCoverageDimension,
  HarnessCoverageEntry<EventKey, SetupKey>
>;

export function defineHarnessFixture<
  const Metadata extends Record<string, unknown>,
  const Events extends Record<string, unknown>,
  const Setup extends Record<string, unknown>,
>(fixture: {
  metadata: Metadata;
  events: Events;
  setup: Setup;
  coverage: HarnessCoverage<keyof Events & string, keyof Setup & string>;
}) {
  return fixture;
}
