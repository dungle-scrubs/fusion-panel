import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abortRun,
  acceptedInDefinitionOrder,
  type EngineError,
  type Job,
  type PatternRebuild,
  parseSubmission,
  type StageBuilders,
  startRun,
  statusOfRun,
  submitToRun,
} from "../src/engine";
import {
  isLegalTransition,
  type RunRegistration,
  type RunStage,
  stampProvenance,
} from "../src/run";

function registration(overrides: Partial<RunRegistration> = {}): RunRegistration {
  return {
    pattern: "echo",
    registeredAt: "2026-09-23T00:00:00.000Z",
    runId: "ra1b2c3d4",
    stoppingRule: "all workers submit or the caller reports failure",
    task: "reply with one answer claim",
    workers: [
      { prompt: "answer w1", timeoutSec: 60, workerId: "w1" },
      { prompt: "answer w2", timeoutSec: 60, workerId: "w2" },
    ],
    ...overrides,
  };
}

function validClaim(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim: `claim ${id}`,
    claim_id: id,
    confidence: 0.8,
    falsifier: `falsifier ${id}`,
    kind: "answer",
    status: "documented",
    ...extra,
  };
}

function success(claims: readonly unknown[], harness = "codex", model = "gpt-x"): string {
  return JSON.stringify({
    claims,
    identity: { harness, model, sessionId: "sess-1" },
  });
}

function failure(failureClass: string, detail?: string): string {
  return JSON.stringify({
    failure: detail === undefined ? { class: failureClass } : { class: failureClass, detail },
  });
}

/** Definition that records the order stage inputs arrived in and fuses in order. */
function echoRebuild(seen?: { challengeInputs: string[][]; fuseOrder: string[] }): PatternRebuild {
  const stages: StageBuilders = {
    challenge: (input) => {
      seen?.challengeInputs.push(input.anonymizedClaims.map((c) => String(c["claim_id"] ?? "")));
      return [
        { prompt: "revise w1", timeoutSec: 30, workerId: "w1-r2" },
        { prompt: "revise w2", timeoutSec: 30, workerId: "w2-r2" },
      ];
    },
  };
  return () => ({
    stages,
    validateSubmission: () => [],
    fuse: (accepted) => {
      seen?.fuseOrder.push(...accepted.map((a) => a.workerId));
      return {
        decision: { decision: "echo-done", pattern: "echo" },
        fusion: {},
      };
    },
  });
}

function errorsOf(outcome: unknown): readonly EngineError[] {
  if (typeof outcome === "object" && outcome !== null) {
    const record = outcome as Record<string, unknown>;
    if (Array.isArray(record["errors"])) {
      return record["errors"] as EngineError[];
    }
    if (typeof record["error"] === "object" && record["error"] !== null) {
      return [record["error"] as EngineError];
    }
  }
  return [];
}

function codeOf(outcome: unknown): string {
  return errorsOf(outcome)[0]?.code ?? "none";
}

describe("state machine", () => {
  const legal: [RunStage, RunStage][] = [
    ["REGISTERED", "GENERATING"],
    ["GENERATING", "NORMALIZING"],
    ["NORMALIZING", "CHALLENGING"],
    ["NORMALIZING", "VERIFYING"],
    ["NORMALIZING", "DECIDING"],
    ["CHALLENGING", "VERIFYING"],
    ["CHALLENGING", "DECIDING"],
    ["VERIFYING", "DECIDING"],
    ["DECIDING", "DONE"],
    ["GENERATING", "FAILED"],
    ["DECIDING", "FAILED"],
    ["REGISTERED", "FAILED"],
  ];
  for (const [from, to] of legal) {
    it(`allows ${from} -> ${to}`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }

  const illegal: [RunStage, RunStage][] = [
    ["REGISTERED", "CHALLENGING"],
    ["GENERATING", "CHALLENGING"],
    ["GENERATING", "DECIDING"],
    ["NORMALIZING", "GENERATING"],
    ["DECIDING", "NORMALIZING"],
    ["DONE", "FAILED"],
    ["FAILED", "GENERATING"],
    ["GENERATING", "GENERATING"],
    ["VERIFYING", "CHALLENGING"],
  ];
  for (const [from, to] of illegal) {
    it(`rejects ${from} -> ${to}`, () => {
      expect(isLegalTransition(from, to)).toBe(false);
    });
  }
});

describe("stampProvenance", () => {
  it("marks identity as caller-reported and carries the run/worker stamp", () => {
    const stamped = stampProvenance({
      harness: "pi",
      model: "m",
      runId: "ra1b2c3d4",
      sessionId: "s1",
      stampedAt: "2026-09-23T00:00:01.000Z",
      workerId: "w1",
    });
    expect(stamped).toEqual({
      harness: "pi",
      model: "m",
      runId: "ra1b2c3d4",
      sessionId: "s1",
      source: "caller-reported",
      stampedAt: "2026-09-23T00:00:01.000Z",
      workerId: "w1",
    });
  });
});

describe("parseSubmission", () => {
  it("parses a success with claims and identity", () => {
    const parsed = parseSubmission(success([validClaim("C1")]));
    expect("errors" in parsed).toBe(false);
    if (!("errors" in parsed)) {
      expect(parsed.submission).toEqual({
        claims: [validClaim("C1")],
        identity: { harness: "codex", model: "gpt-x", sessionId: "sess-1" },
      });
    }
  });

  it("parses an empty success for the method's cardinality policy to check", () => {
    const parsed = parseSubmission(success([]));
    expect("errors" in parsed).toBe(false);
    if (!("errors" in parsed)) expect(parsed.submission).toMatchObject({ claims: [] });
  });

  it("parses a failure with class and detail", () => {
    const parsed = parseSubmission(failure("timeout", "worker exceeded 60s"));
    expect("errors" in parsed).toBe(false);
    if (!("errors" in parsed)) {
      expect(parsed.submission).toEqual({
        failure: { class: "timeout", detail: "worker exceeded 60s" },
      });
    }
  });

  const bad: [string, string, string][] = [
    ["not json", "{oops", "E104"],
    ["not an object", "[1,2]", "E104"],
    ["both branches", '{"claims":[],"identity":{},"failure":{}}', "E104"],
    ["neither branch", '{"note":"hi"}', "E104"],
    ["unknown top field", `${success([validClaim("C1")]).slice(0, -1)},"extra":1}`, "E104"],

    [
      "claims not array",
      '{"claims":{},"identity":{"harness":"a","model":"b","sessionId":"c"}}',
      "E104",
    ],
    ["identity missing", '{"claims":[{"claim_id":"C1"}]}', "E104"],
    [
      "identity empty field",
      '{"claims":[{"claim_id":"C1"}],"identity":{"harness":"a","model":"","sessionId":"c"}}',
      "E104",
    ],
    [
      "identity unknown field",
      '{"claims":[{"claim_id":"C1"}],"identity":{"harness":"a","model":"b","sessionId":"c","extra":1}}',
      "E104",
    ],
    ["failure empty class", '{"failure":{"class":""}}', "E104"],
    ["failure unknown field", '{"failure":{"class":"timeout","why":"x"}}', "E104"],
    ["failure detail not string", '{"failure":{"class":"timeout","detail":5}}', "E104"],
    ["failure not object", '{"failure":"timeout"}', "E104"],
    ["failure with identity", '{"failure":{"class":"timeout"},"identity":null}', "E104"],
    [
      "failure with identity object",
      '{"failure":{"class":"timeout"},"identity":{"harness":"a","model":"b","sessionId":"c"}}',
      "E104",
    ],
  ];
  for (const [name, text, code] of bad) {
    it(`rejects ${name} with ${code}`, () => {
      const parsed = parseSubmission(text);
      expect("errors" in parsed).toBe(true);
      expect(codeOf(parsed)).toBe(code);
    });
  }
});

describe("startRun", () => {
  it("freezes run.json with the format marker and returns the first wave pending", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-start-"));
    const started = startRun(registration(), {
      now: () => "2026-09-23T00:00:00.000Z",
      repoRoot: root,
    });
    expect("error" in started).toBe(false);
    if ("error" in started) {
      return;
    }
    const view = started.view;
    expect(view.status).toBe("pending");
    expect(view.jobs?.map((job: Job) => job.jobId)).toEqual(["generate:w1", "generate:w2"]);
    expect(view.jobs?.[0]?.prompt).toBe("answer w1");
    expect(view.jobs?.[0]?.timeoutSec).toBe(60);
    expect(view.runDir).toBe(join(root, ".fusion", "runs", "ra1b2c3d4"));

    const frozen = JSON.parse(readFileSync(join(view.runDir, "run.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(frozen["runFormat"]).toBe("caller-managed/v1");
    expect(frozen["pattern"]).toBe("echo");
    const state = JSON.parse(readFileSync(join(view.runDir, "state.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(state["pending"]).toEqual(["generate:w1", "generate:w2"]);
    expect(state["terminal"]).toBe(false);
    const events = readFileSync(join(view.runDir, "events.ndjson"), "utf8").trim().split("\n");
    expect(events.length).toBe(3);
    expect(readdirSync(view.runDir).sort()).toEqual(["events.ndjson", "run.json", "state.json"]);
  });

  it("rejects an invalid registration without creating a run directory", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-start-err-"));
    const bad = startRun(registration({ runId: "nope" }), { repoRoot: root });
    expect(codeOf(bad)).toBe("E499");
    expect(existsSync(join(root, ".fusion", "runs", "nope"))).toBe(false);
  });

  it("refuses to overwrite an existing run (E102) and leaves it byte-identical", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-collision-"));
    const started = startRun(registration(), {
      now: () => "2026-09-23T00:00:00.000Z",
      repoRoot: root,
    });
    expect("error" in started).toBe(false);
    const runDir = join(root, ".fusion", "runs", "ra1b2c3d4");
    // mutate the run so a blind re-init would change bytes on disk
    submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    const before = new Map(
      readdirSync(runDir).map((name) => [name, readFileSync(join(runDir, name), "utf8")]),
    );
    expect([...before.keys()].sort()).toEqual(["events.ndjson", "run.json", "state.json"]);
    const collision = startRun(registration(), { repoRoot: root });
    expect(codeOf(collision)).toBe("E102");
    expect(errorsOf(collision)[0]?.detail).toContain("already exists");
    for (const [name, bytes] of before) {
      expect(readFileSync(join(runDir, name), "utf8")).toBe(bytes);
    }
    expect(readdirSync(runDir).sort()).toEqual([...before.keys()].sort());
    // the existing run still works: its pending job is untouched
    const status = statusOfRun(root, "ra1b2c3d4");
    expect(status.view?.jobs?.map((job) => job.jobId)).toEqual(["generate:w2"]);
  });
});

describe("submitToRun", () => {
  it("accepts a success, stamps caller-reported provenance, keeps the wave open", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-"));
    startRun(registration(), { repoRoot: root });
    const out = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(out.errors).toBeUndefined();
    expect(out.view?.status).toBe("pending");
    expect(out.view?.jobs?.map((job) => job.jobId)).toEqual(["generate:w2"]);

    const state = JSON.parse(
      readFileSync(join(root, ".fusion", "runs", "ra1b2c3d4", "state.json"), "utf8"),
    ) as { accepted: { claim: Record<string, unknown> }[] };
    const claim = state.accepted[0]?.claim;
    expect(claim?.["claim_id"]).toBe("w1:C1");
    expect(claim?.["provenance"]).toMatchObject({
      harness: "codex",
      model: "gpt-x",
      runId: "ra1b2c3d4",
      sessionId: "sess-1",
      source: "caller-reported",
      workerId: "w1",
    });
  });

  it("remaps same-submission dependency refs into run scope", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-deps-"));
    startRun(registration(), { repoRoot: root });
    const out = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w1",
      success([validClaim("C1"), validClaim("C2", { dependencies: ["C1"] })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(out.errors).toBeUndefined();
    const state = JSON.parse(
      readFileSync(join(root, ".fusion", "runs", "ra1b2c3d4", "state.json"), "utf8"),
    ) as { accepted: { claim: Record<string, unknown> }[] };
    expect(state.accepted[1]?.claim["dependencies"]).toEqual(["w1:C1"]);
  });

  it("preserves legal run-scoped refs and rejects unknown ones", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-refs-"));
    startRun(registration(), { repoRoot: root });
    const ok = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(ok.errors).toBeUndefined();
    submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    // w2 completed the wave and the echo pattern issued a challenge wave.
    const scoped = submitToRun(
      root,
      "ra1b2c3d4",
      "challenge:w1-r2",
      success([
        validClaim("C1", {
          claim: "targets the record",
          dependencies: ["w1:C1", "w2:C1"],
        }),
      ]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(scoped.errors).toBeUndefined();
    const state = JSON.parse(
      readFileSync(join(root, ".fusion", "runs", "ra1b2c3d4", "state.json"), "utf8"),
    ) as { accepted: { claim: Record<string, unknown>; workerId: string }[] };
    const revised = state.accepted.find((entry) => entry.workerId === "w1-r2");
    expect(revised?.claim["dependencies"]).toEqual(["w1:C1", "w2:C1"]);

    const unknownScoped = submitToRun(
      root,
      "ra1b2c3d4",
      "challenge:w2-r2",
      success([validClaim("C1", { dependencies: ["w9:C1"] })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(unknownScoped)).toBe("E201");
  });

  it("rejects same-wave peer references even after the peer submitted first", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-samewave-"));
    startRun(registration(), { repoRoot: root });
    const first = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(first.errors).toBeUndefined();
    const peer = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w2",
      success([validClaim("C1", { dependencies: ["w1:C1"] })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(peer)).toBe("E201");
    expect(errorsOf(peer)[0]?.detail).toContain("same-wave peer");
    // state unchanged: w1 accepted, w2 still pending
    const state = JSON.parse(
      readFileSync(join(root, ".fusion", "runs", "ra1b2c3d4", "state.json"), "utf8"),
    ) as { accepted: unknown[]; pending: string[] };
    expect(state.accepted).toHaveLength(1);
    expect(state.pending).toEqual(["generate:w2"]);
    // a corrected independent submission is accepted and advances the wave
    const fixed = submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(fixed.errors).toBeUndefined();
    expect(fixed.view?.jobs?.map((job) => job.jobId)).toEqual([
      "challenge:w1-r2",
      "challenge:w2-r2",
    ]);
  });

  it("rejects bare refs that resolve nowhere and malformed dep forms", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-badref-"));
    startRun(registration(), { repoRoot: root });
    const bare = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w1",
      success([validClaim("C1", { dependencies: ["C7"] })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(bare)).toBe("E201");
    expect(errorsOf(bare)[0]?.detail).toContain("C7");
    const malformed = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w1",
      success([validClaim("C1", { dependencies: ["w-red:X1"] })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(malformed)).toBe("E201");
  });

  it("rejects duplicate claim ids within one submission without committing", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-dup-"));
    startRun(registration(), { repoRoot: root });
    const out = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w1",
      success([validClaim("C1"), validClaim("C1", { claim: "again" })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(out)).toBe("E201");
    expect(errorsOf(out)[0]?.detail).toContain("duplicate");
    const status = statusOfRun(root, "ra1b2c3d4");
    expect(status.view?.jobs?.map((job) => job.jobId)).toEqual(["generate:w1", "generate:w2"]);
  });

  it("rejects schema-invalid claims with E201 and accepts a corrected resubmission", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-e201-"));
    startRun(registration(), { repoRoot: root });
    const bad = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w1",
      success([{ claim_id: "C1", kind: "answer" }]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(bad)).toBe("E201");
    expect(errorsOf(bad)[0]?.detail).toContain("C1");
    const good = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(good.errors).toBeUndefined();
    expect(good.view?.jobs?.map((job) => job.jobId)).toEqual(["generate:w2"]);
  });

  it("rejects worker-authored provenance", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-prov-"));
    startRun(registration(), { repoRoot: root });
    const out = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w1",
      success([
        validClaim("C1", {
          provenance: { harness: "liar", runId: "r00000000", workerId: "w1" },
        }),
      ]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(codeOf(out)).toBe("E201");
    expect(errorsOf(out)[0]?.detail).toContain("provenance");
  });

  it("rejects unknown runs, unknown jobs, replays, and terminal submissions", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-addr-"));
    startRun(registration(), { repoRoot: root });
    expect(
      codeOf(
        submitToRun(root, "r00000000", "generate:w1", success([validClaim("C1")]), {
          rebuild: echoRebuild(),
          repoRoot: root,
        }),
      ),
    ).toBe("E102");
    expect(
      codeOf(
        submitToRun(root, "ra1b2c3d4", "generate:w9", success([validClaim("C1")]), {
          rebuild: echoRebuild(),
          repoRoot: root,
        }),
      ),
    ).toBe("E102");
    expect(
      codeOf(
        submitToRun(root, "ra1b2c3d4", "challenge:w1", success([validClaim("C1")]), {
          rebuild: echoRebuild(),
          repoRoot: root,
        }),
      ),
    ).toBe("E102");
    const accepted = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(accepted.errors).toBeUndefined();
    const replay = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(codeOf(replay)).toBe("E204");
    expect(errorsOf(replay)[0]?.detail).toContain("replay");
    // finish the run, then try submitting to the terminal run
    submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    submitToRun(root, "ra1b2c3d4", "challenge:w1-r2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    submitToRun(root, "ra1b2c3d4", "challenge:w2-r2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    const terminal = submitToRun(root, "ra1b2c3d4", "challenge:w2-r2", failure("other"), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(codeOf(terminal)).toBe("E204");
  });

  it("records a caller-reported failure and continues while survivors remain", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-fail-"));
    startRun(registration(), { repoRoot: root });
    const failed = submitToRun(root, "ra1b2c3d4", "generate:w1", failure("timeout", "60s wall"), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(failed.errors).toBeUndefined();
    expect(failed.view?.jobs?.map((job) => job.jobId)).toEqual(["generate:w2"]);
    const done = submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(done.errors).toBeUndefined();
    expect(done.view?.jobs?.map((job) => job.jobId)).toEqual([
      "challenge:w1-r2",
      "challenge:w2-r2",
    ]);
    const events = readFileSync(join(root, ".fusion", "runs", "ra1b2c3d4", "events.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const failureEvent = events.find((event) => event["kind"] === "failure");
    expect(failureEvent?.["payload"]).toMatchObject({
      class: "timeout",
      detail: "60s wall",
      jobId: "generate:w1",
      workerId: "w1",
    });
  });

  it("fails the run when every generation job fails", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-sub-allfail-"));
    startRun(registration(), { repoRoot: root });
    submitToRun(root, "ra1b2c3d4", "generate:w1", failure("provider-unavailable"), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    const last = submitToRun(root, "ra1b2c3d4", "generate:w2", failure("timeout"), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(last.errors).toBeUndefined();
    expect(last.view?.status).toBe("failed");
    expect(last.view?.decision).toMatchObject({
      cause: "failed",
      survivors: 0,
      note: expect.stringContaining("no surviving workers"),
    });
    const state = JSON.parse(
      readFileSync(join(root, ".fusion", "runs", "ra1b2c3d4", "state.json"), "utf8"),
    ) as { stage: string; terminal: boolean };
    expect(state.stage).toBe("FAILED");
    expect(state.terminal).toBe(true);
  });
});

describe("wave barriers and definition order", () => {
  it("issues later-wave jobs only after every current job is terminal", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-wave-"));
    startRun(registration(), { repoRoot: root });
    submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    const midStatus = statusOfRun(root, "ra1b2c3d4");
    expect(midStatus.view?.jobs?.map((job) => job.jobId)).toEqual(["generate:w1"]);
    const advanced = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(advanced.view?.jobs?.map((job) => job.jobId)).toEqual([
      "challenge:w1-r2",
      "challenge:w2-r2",
    ]);
  });

  it("uses definition order for stage inputs and fusion regardless of submission order", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-order-"));
    const seen: { challengeInputs: string[][]; fuseOrder: string[] } = {
      challengeInputs: [],
      fuseOrder: [],
    };
    const rebuild = echoRebuild(seen);
    startRun(registration(), { repoRoot: root });
    submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild,
      repoRoot: root,
    });
    submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild,
      repoRoot: root,
    });
    expect(seen.challengeInputs[0]).toEqual(["w1:C1", "w2:C1"]);
    submitToRun(root, "ra1b2c3d4", "challenge:w2-r2", success([validClaim("C1")]), {
      rebuild,
      repoRoot: root,
    });
    const done = submitToRun(root, "ra1b2c3d4", "challenge:w1-r2", success([validClaim("C1")]), {
      rebuild,
      repoRoot: root,
    });
    expect(done.view?.status).toBe("done");
    expect(done.view?.decision).toMatchObject({ decision: "echo-done", cause: "clean" });
    expect(seen.fuseOrder).toEqual(["w1", "w2", "w1-r2", "w2-r2"]);
  });

  it("anonymizes stage inputs: no provenance reaches later prompts", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-anon-"));
    let seenClaims: Record<string, unknown>[] = [];
    const rebuild: PatternRebuild = () => ({
      validateSubmission: () => [],
      stages: {
        challenge: (input) => {
          seenClaims = [...input.anonymizedClaims];
          return [{ prompt: "revise", timeoutSec: 30, workerId: "w1-r2" }];
        },
      },
      fuse: () => ({ decision: {}, fusion: {} }),
    });
    startRun(
      {
        ...registration(),
        workers: [
          registration().workers[0] as { prompt: string; timeoutSec: number; workerId: string },
        ],
      },
      { repoRoot: root },
    );
    submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild,
      repoRoot: root,
    });
    expect(seenClaims.length).toBe(1);
    expect(JSON.stringify(seenClaims)).not.toContain("provenance");
    expect(JSON.stringify(seenClaims)).not.toContain("codex");
  });

  it("acceptedInDefinitionOrder sorts by wave, job position, then claim position", () => {
    const ordered = acceptedInDefinitionOrder({
      accepted: [
        { claim: {}, claimIndex: 0, jobIndex: 1, stage: "generate", wave: 0, workerId: "w2" },
        { claim: {}, claimIndex: 1, jobIndex: 0, stage: "generate", wave: 0, workerId: "w1" },
        { claim: {}, claimIndex: 0, jobIndex: 0, stage: "generate", wave: 0, workerId: "w1" },
        { claim: {}, claimIndex: 0, jobIndex: 0, stage: "challenge", wave: 1, workerId: "w1-r2" },
      ],
    });
    expect(ordered.map((entry) => `${entry.workerId}:${entry.stage}`)).toEqual([
      "w1:generate",
      "w1:generate",
      "w2:generate",
      "w1-r2:challenge",
    ]);
  });
});

describe("statusOfRun", () => {
  it("returns pending jobs without writing anything", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-status-"));
    startRun(registration(), { repoRoot: root });
    const statePath = join(root, ".fusion", "runs", "ra1b2c3d4", "state.json");
    const before = readFileSync(statePath, "utf8");
    const view = statusOfRun(root, "ra1b2c3d4");
    expect(view.errors).toBeUndefined();
    expect(view.view?.status).toBe("pending");
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("rejects unknown and malformed run ids without touching the filesystem", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-status-err-"));
    expect(codeOf(statusOfRun(root, "../escape"))).toBe("E102");
    expect(codeOf(statusOfRun(root, "rZZZZZZZ"))).toBe("E102");
    expect(existsSync(join(root, ".fusion", "runs", ".."))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("rejects pre-caller run formats with a usage error", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-status-old-"));
    const runDir = join(root, ".fusion", "runs", "r0a1b2c3d");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({ pattern: "jury", runId: "r0a1b2c3d" }),
    );
    for (const outcome of [
      statusOfRun(root, "r0a1b2c3d"),
      submitToRun(root, "r0a1b2c3d", "generate:w1", success([validClaim("C1")]), {
        rebuild: echoRebuild(),
        repoRoot: root,
      }),
      abortRun(root, "r0a1b2c3d", "moot", { repoRoot: root }),
    ]) {
      expect(codeOf(outcome)).toBe("E102");
      expect(errorsOf(outcome)[0]?.detail).toContain("incompatible");
    }
  });
});

describe("abortRun", () => {
  it("records a failed terminal decision with the reason and retains events", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-abort-"));
    startRun(registration(), { repoRoot: root });
    submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    const aborted = abortRun(root, "ra1b2c3d4", "worker w2 lost its session", { repoRoot: root });
    expect(aborted.errors).toBeUndefined();
    expect(aborted.view?.status).toBe("failed");
    expect(aborted.view?.decision).toMatchObject({
      cause: "aborted",
      reason: "worker w2 lost its session",
      survivors: 1,
    });
    const events = readFileSync(
      join(root, ".fusion", "runs", "ra1b2c3d4", "events.ndjson"),
      "utf8",
    );
    expect(events).toContain('"kind":"claim"');
    expect(events).toContain('"stage":"FAILED"');
    expect(codeOf(abortRun(root, "ra1b2c3d4", "again", { repoRoot: root }))).toBe("E204");
    expect(
      codeOf(
        submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
          rebuild: echoRebuild(),
          repoRoot: root,
        }),
      ),
    ).toBe("E204");
    expect(codeOf(abortRun(root, "r00000000", "x", { repoRoot: root }))).toBe("E102");
    expect(codeOf(abortRun(root, "ra1b2c3d4", "   ", { repoRoot: root }))).toBe("E102");
  });
});

describe("locking", () => {
  it("treats any existing lock as busy - live, dead, or malformed - never removes it, and preserves state", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-lock-"));
    startRun(registration(), { repoRoot: root });
    const runDir = join(root, ".fusion", "runs", "ra1b2c3d4");
    const cases: [string, string][] = [
      ["live holder", JSON.stringify({ at: "2026-09-23T00:00:00.000Z", pid: process.pid })],
      // 999999 exceeds macOS pid limits: definitely not a live process
      ["dead holder", JSON.stringify({ at: "2026-09-23T00:00:00.000Z", pid: 999999 })],
      ["malformed holder", "not json at all"],
    ];
    for (const [, content] of cases) {
      writeFileSync(join(runDir, "lock"), `${content}\n`);
      const busy = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
        rebuild: echoRebuild(),
        repoRoot: root,
      });
      expect(codeOf(busy)).toBe("E304");
      // the lock is untouched: no stealing, no rewriting, regardless of pid
      expect(readFileSync(join(runDir, "lock"), "utf8")).toBe(`${content}\n`);
    }
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8")) as {
      accepted: unknown[];
      pending: string[];
    };
    expect(state.accepted).toEqual([]);
    expect(state.pending).toEqual(["generate:w1", "generate:w2"]);
    // the caller removes the stale lock outside the protocol, then proceeds
    rmSync(join(runDir, "lock"));
    const ok = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(ok.errors).toBeUndefined();
    expect(existsSync(join(runDir, "lock"))).toBe(false);
  });
});

describe("authoritative state and projections", () => {
  const runDirOf = (root: string): string => join(root, ".fusion", "runs", "ra1b2c3d4");

  function readState(root: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(runDirOf(root), "state.json"), "utf8")) as Record<
      string,
      unknown
    >;
  }

  function eventLines(root: string): Record<string, unknown>[] {
    return readFileSync(join(runDirOf(root), "events.ndjson"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** Drive the echo run to completion; obstruction is installed before the final submit. */
  function completeEchoRun(root: string, obstruct: () => void): void {
    startRun(registration(), { repoRoot: root });
    for (const [job, claimText] of [
      ["generate:w1", "one"],
      ["generate:w2", "two"],
      ["challenge:w1-r2", "revised one"],
    ] as const) {
      const out = submitToRun(
        root,
        "ra1b2c3d4",
        job,
        success([validClaim("C1", { claim: claimText })]),
        {
          rebuild: echoRebuild(),
          repoRoot: root,
        },
      );
      expect(out.errors).toBeUndefined();
    }
    obstruct();
    const last = submitToRun(
      root,
      "ra1b2c3d4",
      "challenge:w2-r2",
      success([validClaim("C1", { claim: "revised two" })]),
      { rebuild: echoRebuild(), repoRoot: root },
    );
    expect(last.errors).toBeUndefined();
    expect(last.view?.status).toBe("done");
  }

  it("a failed decision projection cannot produce a false done or empty decision", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-proj-decision-"));
    // the atomic decision write fails: its temp path is a directory
    completeEchoRun(root, () => {
      mkdirSync(join(runDirOf(root), "decision.json.tmp"));
    });
    const runDir = runDirOf(root);
    expect(existsSync(join(runDir, "decision.json"))).toBe(false); // projection genuinely failed
    // the submit result already carried the committed decision, not a projection
    // restart: status reads committed state only, no writes
    const status = statusOfRun(root, "ra1b2c3d4");
    expect(status.view?.status).toBe("done");
    expect(status.view?.decision).toMatchObject({ cause: "clean", decision: "echo-done" });
    expect(readFileSync(join(runDir, "state.json"), "utf8")).toContain("echo-done");
    // caller clears the obstruction; the next mutation attempt (a rejected
    // replay) replays the projections exactly once
    rmSync(join(runDir, "decision.json.tmp"), { recursive: true });
    const replay = submitToRun(root, "ra1b2c3d4", "challenge:w2-r2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(codeOf(replay)).toBe("E204");
    const projected = JSON.parse(readFileSync(join(runDir, "decision.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(projected).toMatchObject({ cause: "clean", decision: "echo-done" });
    const state = readState(root);
    expect(eventLines(root)).toHaveLength((state["journal"] as unknown[]).length);
  });

  it("repairs an interrupted event append without corrupting or duplicating the journal", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-proj-tail-"));
    startRun(registration(), { repoRoot: root });
    const path = join(runDirOf(root), "events.ndjson");
    const committedPrefix = readFileSync(path, "utf8");
    writeFileSync(path, `${committedPrefix}{"kind":"submi`);

    const submitted = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(submitted.errors).toBeUndefined();
    expect(readFileSync(path, "utf8").startsWith(committedPrefix)).toBe(true);
    const state = readState(root);
    expect(eventLines(root)).toEqual(state["journal"]);

    writeFileSync(path, `${readFileSync(path, "utf8")}{"partial":`);
    submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(eventLines(root)).toEqual(state["journal"]);
  });

  it("a failed events projection loses no accepted job and never double-counts after repair", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-proj-events-"));
    startRun(registration(), { repoRoot: root });
    const runDir = runDirOf(root);
    submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    // the append target is a directory: every projection now silently fails
    rmSync(join(runDir, "events.ndjson"));
    mkdirSync(join(runDir, "events.ndjson"));
    const second = submitToRun(root, "ra1b2c3d4", "generate:w2", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(second.errors).toBeUndefined(); // the commit itself succeeded
    const committed = readState(root) as { accepted: { workerId: string }[]; journal: unknown[] };
    expect(committed.accepted.map((entry) => entry.workerId)).toEqual(["w1", "w2"]);
    // caller clears the obstruction; the next mutation replays the missing
    // suffix exactly once, then appends its own events
    rmSync(join(runDir, "events.ndjson"), { recursive: true });
    for (const job of ["challenge:w1-r2", "challenge:w2-r2"]) {
      const out = submitToRun(root, "ra1b2c3d4", job, success([validClaim("C1")]), {
        rebuild: echoRebuild(),
        repoRoot: root,
      });
      expect(out.errors).toBeUndefined();
    }
    const state = readState(root) as {
      accepted: { claim: Record<string, unknown> }[];
      journal: unknown[];
    };
    const lines = eventLines(root);
    expect(lines).toHaveLength(state.journal.length); // complete, no duplicates
    const claimIds = lines
      .filter((event) => event["kind"] === "claim")
      .map(
        (event) =>
          ((event["payload"] as Record<string, unknown>)["claim"] as Record<string, unknown>)[
            "claim_id"
          ],
      );
    expect(claimIds).toEqual(["w1:C1", "w2:C1", "w1-r2:C1", "w2-r2:C1"]); // each accepted job exactly once
    expect(statusOfRun(root, "ra1b2c3d4").view?.decision).toMatchObject({ decision: "echo-done" });
  });

  it("a failed authoritative save commits nothing and the job resubmits cleanly", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-proj-save-"));
    startRun(registration(), { repoRoot: root });
    const runDir = runDirOf(root);
    const before = readFileSync(join(runDir, "state.json"), "utf8");
    mkdirSync(join(runDir, "state.json.tmp")); // the atomic save fails
    expect(() =>
      submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
        rebuild: echoRebuild(),
        repoRoot: root,
      }),
    ).toThrow();
    expect(readFileSync(join(runDir, "state.json"), "utf8")).toBe(before); // nothing committed
    rmSync(join(runDir, "state.json.tmp"), { recursive: true });
    const retry = submitToRun(root, "ra1b2c3d4", "generate:w1", success([validClaim("C1")]), {
      rebuild: echoRebuild(),
      repoRoot: root,
    });
    expect(retry.errors).toBeUndefined();
    const state = readState(root) as { accepted: { workerId: string }[]; pending: string[] };
    expect(state.accepted).toHaveLength(1); // counted once, not twice
    expect(state.pending).toEqual(["generate:w2"]);
    expect(statusOfRun(root, "ra1b2c3d4").view?.jobs?.map((job) => job.jobId)).toEqual([
      "generate:w2",
    ]);
  });
});

describe("evidence snapshot", () => {
  it("rebuilds later waves from the frozen snapshot after the file disappears", async () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-evidence-"));
    const evidencePath = join(root, "citations.json");
    const export_ = {
      data: {
        citations: {
          documents: [
            {
              citedBy: [
                {
                  claimId: "c1",
                  claimStatus: "verified",
                  locator: "p1",
                  statement: "the build is green",
                  verdict: "supported",
                },
              ],
              url: "https://example.com/build",
            },
          ],
          unfetched: [],
        },
      },
    };
    writeFileSync(evidencePath, JSON.stringify(export_));
    const { redblueDefinition } = await import("../src/redblue");
    const options = {
      burden: "two sources",
      evidence: evidencePath,
      task: "is the build green?",
    };
    const build = redblueDefinition.build(options, { readEvidence: () => JSON.stringify(export_) });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    const reg: RunRegistration = {
      evidenceSnapshot: { content: JSON.stringify(export_), path: evidencePath },
      pattern: "red-blue",
      patternOptions: options,
      registeredAt: "2026-09-23T00:00:00.000Z",
      runId: "ra1b2c3d4",
      stoppingRule: build.stoppingRule,
      task: "is the build green?",
      workers: build.workers,
    };
    startRun(reg, { repoRoot: root });
    rmSync(evidencePath);
    const rebuild: PatternRebuild = (stored) => {
      const rebuilt = redblueDefinition.build(stored.patternOptions ?? {}, {
        readEvidence: () => stored.evidenceSnapshot?.content ?? "",
      });
      if ("error" in rebuilt) {
        return { error: rebuilt.error };
      }
      return {
        stages: rebuilt.stages,
        fuse: rebuilt.fuse,
        validateSubmission: rebuilt.validateSubmission,
      };
    };
    const claimant = submitToRun(
      root,
      "ra1b2c3d4",
      "generate:w-red",
      success([validClaim("C1", { claim: "the build is green", kind: "answer" })]),
      { rebuild, repoRoot: root },
    );
    expect(claimant.errors).toBeUndefined();
    expect(claimant.view?.jobs?.map((job) => job.jobId)).toEqual(["challenge:w-blue"]);
    const opponent = submitToRun(
      root,
      "ra1b2c3d4",
      "challenge:w-blue",
      success([
        validClaim("C1", {
          claim: "one source is not two",
          dependencies: ["w-red:C1"],
          kind: "objection",
        }),
      ]),
      { rebuild, repoRoot: root },
    );
    expect(opponent.errors).toBeUndefined();
    expect(opponent.view?.jobs?.map((job) => job.jobId)).toEqual([
      "verify:w-umpire",
      "verify:w-judge",
    ]);
  });
});
