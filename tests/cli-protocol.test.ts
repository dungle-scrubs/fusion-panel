/**
 * Acceptance: the bundled CLI, driven as real subprocesses with no hcn
 * anywhere, runs every method through the caller-managed lifecycle
 * (start -> submit per job -> status across invocations -> decision) and
 * rejects the protocol's negative cases (ADR-0003).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const CLI = join(REPO, "dist", "cli.js");

let root = "";

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: REPO, stdio: "pipe" });
}, 60000);

beforeEach(() => {
  // realpath so the test's path matches process.cwd() inside the CLI
  // (macOS resolves /var/folders to /private/var/folders).
  root = realpathSync(mkdtempSync(join(tmpdir(), "fusion-cli-")));
});

interface JsonBody {
  ok: boolean;
  run: string;
  status?: string;
  runId?: string;
  runDir?: string;
  jobs?: { jobId: string; workerId: string; stage: string; prompt: string }[];
  decision?: Record<string, unknown>;
  limitations?: Record<string, string>;
  errors?: { code: string; detail: string }[];
}

function fusionJson(args: string[], input?: string): { code: number | null; body: JsonBody } {
  const proc = spawnSync(process.execPath, [CLI, ...args, "--json"], {
    cwd: root,
    encoding: "utf8",
    input,
  });
  const lines = proc.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return { body: JSON.parse(lines[0] as string) as JsonBody, code: proc.status };
}

function fusionText(args: string[], input?: string): { code: number | null; out: string } {
  const proc = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8", input });
  return { code: proc.status, out: proc.stdout };
}

const identity = { harness: "codex", model: "gpt-test", sessionId: "sess-42" };

function ok(claims: readonly unknown[], who = identity): string {
  return JSON.stringify({ claims, identity: who });
}

function fail(class_: string, detail?: string): string {
  return JSON.stringify({
    failure: detail === undefined ? { class: class_ } : { class: class_, detail },
  });
}

function submit(
  runId: string,
  jobId: string,
  payload: string,
  useFile = false,
): { code: number | null; body: JsonBody } {
  if (!useFile) {
    return fusionJson(["submit", "--run", runId, "--job", jobId], payload);
  }
  const file = join(root, `${jobId.replace(/:/g, "-")}.json`);
  writeFileSync(file, payload);
  return fusionJson(["submit", "--run", runId, "--job", jobId, file]);
}

function answerClaim(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim: text,
    claim_id: "C1",
    confidence: 0.8,
    falsifier: "a falsifiable check",
    kind: "answer",
    status: "documented",
    ...extra,
  };
}

function startRun(command: string, args: string[]): JsonBody {
  const { body, code } = fusionJson([command, ...args]);
  expect(code).toBe(0);
  expect(body.ok).toBe(true);
  expect(body.status).toBe("pending");
  expect(body.runId).toMatch(/^r[0-9a-f]{8}$/);
  expect(body.runDir).toBe(join(root, ".fusion", "runs", body.runId as string));
  expect(body.limitations).toMatchObject({
    isolation: expect.stringContaining("caller-enforced"),
    identity: expect.stringContaining("caller-reported"),
  });
  return body;
}

function jobIds(body: JsonBody): string[] {
  return (body.jobs ?? []).map((job) => job.jobId);
}

// ---------------------------------------------------------------------------
// Happy-path lifecycles, one per method
// ---------------------------------------------------------------------------

describe("jury lifecycle", () => {
  it("starts pending, accepts submissions across invocations, decides by plurality", () => {
    const start = startRun("jury", [
      "--task",
      "ship or hold?",
      "--workers",
      "2",
      "--timeout",
      "45",
    ]);
    expect(jobIds(start)).toEqual(["generate:w1", "generate:w2"]);
    const w1 = start.jobs?.[0];
    expect(w1?.prompt).toContain("ship or hold?");
    expect(w1?.prompt).toContain("sealed juror");
    expect(w1?.stage).toBe("generate");
    expect(w1?.workerId).toBe("w1");
    expect(JSON.stringify(start.jobs?.[0])).toContain("timeoutSec");

    const runId = start.runId as string;
    const first = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(first.code).toBe(0);
    expect(first.body.status).toBe("pending");
    expect(jobIds(first.body)).toEqual(["generate:w2"]);

    const mid = fusionJson(["status", "--run", runId]);
    expect(mid.body.status).toBe("pending");
    expect(jobIds(mid.body)).toEqual(["generate:w2"]);

    const last = submit(runId, "generate:w2", ok([answerClaim("Ship It")]));
    expect(last.body.status).toBe("done");
    expect(last.body.decision).toMatchObject({
      cause: "clean",
      decision: "ship it",
      independence: { acceptedAnswers: 2, groups: 1 },
      pattern: "jury",
    });
    expect(last.body.decision?.["provenanceLimits"]).toMatchObject({
      isolation: expect.stringContaining("caller-enforced"),
    });

    const final = fusionJson(["status", "--run", runId]);
    expect(final.body.status).toBe("done");
    expect(final.body.decision).toMatchObject({ decision: "ship it" });

    const events = readFileSync(join(root, ".fusion", "runs", runId, "events.ndjson"), "utf8");
    expect(events).toContain('"source":"caller-reported"');
    expect(events).toContain('"harness":"codex"');
  });

  it("breaks ties by definition order regardless of submission order", () => {
    const start = startRun("jury", ["--task", "pick one", "--workers", "2"]);
    const runId = start.runId as string;
    submit(runId, "generate:w2", ok([answerClaim("hold it")]));
    const last = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(last.body.decision).toMatchObject({ decision: "ship it" });
    expect(last.body.decision?.["independence"]).toMatchObject({ groups: 2 });
  });

  it("runs the blind merge wave when --merge is set, with record-id dependencies", () => {
    const start = startRun("jury", ["--task", "ship wording", "--workers", "2", "--merge"]);
    const runId = start.runId as string;
    submit(runId, "generate:w1", ok([answerClaim("ship the release")]));
    const mergeHandoff = submit(runId, "generate:w2", ok([answerClaim("Release it now")]));
    expect(jobIds(mergeHandoff.body)).toEqual(["verify:w-merge"]);

    const mergePrompt = mergeHandoff.body.jobs?.[0]?.prompt ?? "";
    expect(mergePrompt).toContain("merge judge");
    expect(mergePrompt).not.toContain("codex");
    const listed = [...mergePrompt.matchAll(/^(w[a-z0-9-]+:C[0-9]+) - (.+)$/gm)].map(
      (match) => match[1],
    );
    expect(listed).toEqual(["w1:C1", "w2:C1"]);

    const done = submit(
      runId,
      "verify:w-merge",
      ok([
        {
          claim: "Ship the release",
          claim_id: "C1",
          confidence: 0.9,
          dependencies: listed,
          falsifier: "scope differs",
          kind: "answer",
          status: "inferred",
        },
      ]),
    );
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({
      decision: "Ship the release",
      mergeClusters: [
        { label: "Ship the release", members: ["ship the release", "release it now"] },
      ],
    });
  });
});

describe("red-blue lifecycle", () => {
  it("runs claimant, opponent, umpire, judge waves with anonymized prompts", () => {
    const start = startRun("red-blue", ["--task", "is the tree clean?", "--burden", "two sources"]);
    expect(jobIds(start)).toEqual(["generate:w-red"]);
    const runId = start.runId as string;

    const opponentWave = submit(
      runId,
      "generate:w-red",
      ok([
        {
          claim: "the working tree is clean",
          claim_id: "C1",
          confidence: 0.9,
          falsifier: "git status shows changes",
          kind: "finding",
          status: "observed",
        },
      ]),
    );
    expect(jobIds(opponentWave.body)).toEqual(["challenge:w-blue"]);
    const opponentPrompt = opponentWave.body.jobs?.[0]?.prompt ?? "";
    expect(opponentPrompt).toContain('"claim_id":"w-red:C1"');
    expect(opponentPrompt).not.toContain('"provenance"');
    expect(opponentPrompt).not.toContain("codex");

    const verifyWave = submit(
      runId,
      "challenge:w-blue",
      ok([
        {
          claim: "the claim assumes a clean checkout",
          claim_id: "C1",
          confidence: 0.7,
          dependencies: ["w-red:C1"],
          falsifier: "the repo is a scratch clone",
          kind: "objection",
          status: "documented",
        },
      ]),
    );
    expect(jobIds(verifyWave.body)).toEqual(["verify:w-umpire", "verify:w-judge"]);

    submit(
      runId,
      "verify:w-umpire",
      ok([
        {
          claim: "git status is empty in this clone",
          claim_id: "C1",
          confidence: 0.9,
          dependencies: ["w-blue:C1"],
          falsifier: "dirty files appear",
          kind: "evidence",
          requested_action: "revise",
          status: "observed",
        },
      ]),
    );
    const done = submit(
      runId,
      "verify:w-judge",
      ok([answerClaim("the record meets the burden", { requested_action: "accept" })]),
    );
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({
      decision: "the record meets the burden",
      judgeVerdict: "accept",
      pattern: "red-blue",
      survivingClaims: ["w-red:C1"],
    });
  });
});

describe("ach lifecycle", () => {
  it("fuses a hypotheses-x-evidence matrix from a single wave", () => {
    const start = startRun("ach", ["--task", "why did latency spike?", "--workers", "2"]);
    const runId = start.runId as string;
    const analyst = (hyp: string, ev: string): string =>
      ok([
        {
          claim: hyp,
          claim_id: "C1",
          confidence: 0.6,
          dependencies: ["C2"],
          falsifier: "the cache metric disagrees",
          kind: "hypothesis",
          status: "inferred",
        },
        {
          claim: ev,
          claim_id: "C2",
          confidence: 0.7,
          dependencies: ["C1"],
          falsifier: "the log line is absent",
          kind: "evidence",
          novelty: "confirms",
          status: "observed",
        },
      ]);
    submit(runId, "generate:w1", analyst("cache cold start", "cache miss ratio jumped"));
    const done = submit(
      runId,
      "generate:w2",
      analyst("deploy regression", "deploy landed at spike time"),
    );
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({
      leastDisconfirmed: "w1:C1",
      pattern: "ach",
    });
    expect(done.body.decision?.["hypotheses"]).toEqual(["w1:C1", "w2:C1"]);
  });
});

describe("delphi lifecycle", () => {
  it("runs round 2 per worker and reports convergence vs stability", () => {
    const start = startRun("delphi", ["--task", "estimate the risk", "--workers", "2"]);
    const runId = start.runId as string;
    const round1 = submit(runId, "generate:w1", ok([answerClaim("high")]));
    expect(jobIds(round1.body)).toEqual(["generate:w2"]);
    submit(runId, "generate:w2", ok([answerClaim("high")]));

    const round2Wave = fusionJson(["status", "--run", runId]);
    expect(jobIds(round2Wave.body)).toEqual(["challenge:w1-r2", "challenge:w2-r2"]);
    const revise = (novelty: string): string =>
      ok([
        {
          claim: "high",
          claim_id: "C1",
          confidence: 0.85,
          falsifier: "the risk register disagrees",
          kind: "answer",
          novelty,
          status: "documented",
        },
      ]);
    submit(runId, "challenge:w2-r2", revise("new"));
    const done = submit(runId, "challenge:w1-r2", revise("confirms"));
    expect(done.body.status).toBe("done");
    const delphi = done.body.decision?.["delphi"] as Record<string, unknown>;
    expect(delphi).toMatchObject({
      round1: { answers: 2, groups: 1 },
      round2: { answers: 2, groups: 1 },
      stabilityRate: 1,
    });
    expect(done.body.decision).toMatchObject({ decision: "high", pattern: "delphi" });
  });
});

describe("shortlist lifecycle", () => {
  it("proposers generate, blind judges score, majority accepts advance", () => {
    const start = startRun("shortlist", [
      "--task",
      "how to name the cli",
      "--rubric",
      "short and pronounceable",
      "--generators",
      "2",
      "--judges",
      "2",
    ]);
    const runId = start.runId as string;
    submit(runId, "generate:w-prop-1", ok([answerClaim("option A")]));
    const judgeWave = submit(runId, "generate:w-prop-2", ok([answerClaim("option B")]));
    expect(jobIds(judgeWave.body)).toEqual(["challenge:w-judge-1", "challenge:w-judge-2"]);
    const judgePrompt = judgeWave.body.jobs?.[0]?.prompt ?? "";
    expect(judgePrompt).toContain('"claim_id":"w-prop-1:C1"');
    expect(judgePrompt).toContain("blind judge");

    const verdicts = (option: string): string =>
      ok([
        {
          claim: "meets the rubric",
          claim_id: "C1",
          confidence: 0.8,
          dependencies: [`w-prop-1:C${option}`],
          falsifier: "a shorter name exists",
          kind: "answer",
          requested_action: "accept",
          status: "documented",
        },
        {
          claim: "meets the rubric",
          claim_id: "C2",
          confidence: 0.8,
          dependencies: [`w-prop-2:C${option}`],
          falsifier: "a shorter name exists",
          kind: "answer",
          requested_action: "accept",
          status: "documented",
        },
      ]);
    submit(runId, "challenge:w-judge-1", verdicts("1"));
    const done = submit(runId, "challenge:w-judge-2", verdicts("1"));
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({ decision: "option a", pattern: "shortlist" });
    const shortlist = done.body.decision?.["shortlist"] as { canonical: string }[];
    expect(shortlist.map((entry) => entry.canonical)).toEqual(["option a", "option b"]);
  });
});

describe("gonogo lifecycle", () => {
  it("applies the mechanical veto: one NO-GO blocks", () => {
    const start = startRun("gonogo", ["--task", "release 1.2.3", "--reviewers", "3"]);
    const runId = start.runId as string;
    const position = (action: string, claim: string): string =>
      ok([
        {
          claim,
          claim_id: "C1",
          confidence: 0.8,
          falsifier: "the flaky test is fixed",
          kind: "answer",
          requested_action: action,
          status: "observed",
        },
      ]);
    submit(runId, "generate:w-gate-1", position("accept", "green build"));
    submit(runId, "generate:w-gate-2", position("test", "rerun the flaky suite"));
    const done = submit(
      runId,
      "generate:w-gate-3",
      position("escalate", "auth regression unfixed"),
    );
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({
      decision: "NO-GO",
      pattern: "gonogo",
      reviewers: 3,
    });
    expect(done.body.decision?.["blockingConcerns"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Protocol surface details
// ---------------------------------------------------------------------------

describe("handoff surface", () => {
  it("human output exposes full job briefs, hints default to caller", () => {
    const { code, out } = fusionText(["jury", "--task", "human readable?", "--workers", "2"]);
    expect(code).toBe(0);
    expect(out).toContain("status   pending");
    expect(out).toContain("generate:w1");
    expect(out).toContain("TASK: human readable?");
    expect(out).toContain("caller-enforced");
    expect(out).toContain('"harness":"caller"');
  });

  it("roster hints ride along as caller-overridable hints", () => {
    const start = startRun("jury", [
      "--task",
      "hints",
      "--workers",
      "2",
      "--roster",
      "pi,codex:m1",
    ]);
    const jobs = start.jobs ?? [];
    expect(jobs[0]).toMatchObject({ harness: "pi" });
    expect(jobs[1]).toMatchObject({ harness: "codex", model: "m1" });
  });

  it("submit accepts a file argument and stdin identically", () => {
    const start = startRun("gonogo", ["--task", "gate", "--reviewers", "2"]);
    const runId = start.runId as string;
    const viaFile = submit(
      runId,
      "generate:w-gate-1",
      ok([answerClaim("fine", { requested_action: "accept" })]),
      true,
    );
    expect(viaFile.body.ok).toBe(true);
    const viaStdin = submit(
      runId,
      "generate:w-gate-2",
      ok([answerClaim("fine", { requested_action: "accept" })]),
    );
    expect(viaStdin.body.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

describe("negative cases", () => {
  function freshJury(): string {
    return startRun("jury", ["--task", "negativity", "--workers", "2"]).runId as string;
  }

  it("malformed JSON is E104 and leaves the job pending", () => {
    const runId = freshJury();
    const bad = fusionJson(["submit", "--run", runId, "--job", "generate:w1"], "{oops");
    expect(bad.code).toBe(1);
    expect(bad.body.errors?.[0]).toMatchObject({ code: "E104" });
    const status = fusionJson(["status", "--run", runId]);
    expect(jobIds(status.body)).toEqual(["generate:w1", "generate:w2"]);
  });

  it("a failure submission carrying identity is E104 and the job stays pending", () => {
    const runId = freshJury();
    const out = fusionJson(
      ["submit", "--run", runId, "--job", "generate:w1"],
      JSON.stringify({ failure: { class: "timeout" }, identity }),
    );
    expect(out.code).toBe(1);
    expect(out.body.errors?.[0]).toMatchObject({ code: "E104" });
    expect(out.body.errors?.[0]?.detail).toContain("identity");
    const status = fusionJson(["status", "--run", runId]);
    expect(jobIds(status.body)).toEqual(["generate:w1", "generate:w2"]);
  });

  it("same-wave peer references are rejected even after the peer submitted first", () => {
    const runId = freshJury();
    const first = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(first.body.ok).toBe(true);
    const peer = submit(
      runId,
      "generate:w2",
      ok([answerClaim("hold it", { dependencies: ["w1:C1"] })]),
    );
    expect(peer.code).toBe(2);
    expect(peer.body.errors?.[0]).toMatchObject({ code: "E201" });
    expect(peer.body.errors?.[0]?.detail).toContain("same-wave peer");
    // state unchanged: w2 is still pending
    expect(jobIds(fusionJson(["status", "--run", runId]).body)).toEqual(["generate:w2"]);
    const corrected = submit(runId, "generate:w2", ok([answerClaim("hold it")]));
    expect(corrected.body.ok).toBe(true);
    expect(corrected.body.status).toBe("done");
  });

  it("unknown submission fields and empty success are E104", () => {
    const runId = freshJury();
    const extra = fusionJson(
      ["submit", "--run", runId, "--job", "generate:w1"],
      `${ok([answerClaim("x")]).slice(0, -1)},"retry":true}`,
    );
    expect(extra.body.errors?.[0]?.code).toBe("E104");
    const empty = fusionJson(["submit", "--run", runId, "--job", "generate:w1"], ok([]));
    expect(empty.body.errors?.[0]?.code).toBe("E104");
  });

  it("schema-invalid claims are E201; a corrected resubmission of the same job lands", () => {
    const runId = freshJury();
    const bad = submit(runId, "generate:w1", ok([{ claim_id: "C1", kind: "answer" }]));
    expect(bad.code).toBe(2);
    expect(bad.body.errors?.[0]).toMatchObject({ code: "E201" });
    expect(bad.body.errors?.[0]?.detail).toContain("C1");
    const good = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(good.body.ok).toBe(true);
    expect(jobIds(good.body)).toEqual(["generate:w2"]);
  });

  it("worker-authored provenance is rejected", () => {
    const runId = freshJury();
    const forged = submit(
      runId,
      "generate:w1",
      ok([
        answerClaim("ship it", {
          provenance: { harness: "fake", runId, workerId: "w1" },
        }),
      ]),
    );
    expect(forged.body.errors?.[0]).toMatchObject({ code: "E201" });
    expect(forged.body.errors?.[0]?.detail).toContain("provenance");
  });

  it("unknown run, unknown job, malformed run ids, and path traversal are E102", () => {
    const runId = freshJury();
    expect(
      fusionJson(["submit", "--run", "r00000000", "--job", "generate:w1"], ok([answerClaim("x")]))
        .body.errors?.[0]?.code,
    ).toBe("E102");
    expect(
      fusionJson(["submit", "--run", runId, "--job", "generate:w9"], ok([answerClaim("x")])).body
        .errors?.[0]?.code,
    ).toBe("E102");
    expect(
      fusionJson(["submit", "--run", runId, "--job", "verify:w1"], ok([answerClaim("x")])).body
        .errors?.[0]?.code,
    ).toBe("E102");
    for (const evil of ["../escape", "r/../../etc", "r1234567z", ".."]) {
      const out = fusionJson(["status", "--run", evil]);
      expect(out.body.errors?.[0]?.code).toBe("E102");
    }
    expect(readdirSync(root)).toEqual([".fusion"]);
  });

  it("replaying a submitted job is E204 and counts once", () => {
    const runId = freshJury();
    submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    const replay = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(replay.code).toBe(2);
    expect(replay.body.errors?.[0]).toMatchObject({ code: "E204" });
    submit(runId, "generate:w2", ok([answerClaim("ship it")]));
    const done = fusionJson(["status", "--run", runId]);
    expect(done.body.decision).toMatchObject({
      decision: "ship it",
      independence: { acceptedAnswers: 2 },
    });
  });

  it("submissions to a terminal run are E204", () => {
    const runId = freshJury();
    submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    submit(runId, "generate:w2", fail("timeout"));
    const terminal = submit(runId, "generate:w2", fail("other"));
    expect(terminal.body.errors?.[0]?.code).toBe("E204");
  });

  it("every generation job failing records a failed decision (exit 0, status failed)", () => {
    const runId = freshJury();
    submit(runId, "generate:w1", fail("provider-unavailable", "no route"));
    const last = submit(runId, "generate:w2", fail("timeout"));
    expect(last.code).toBe(0);
    expect(last.body.ok).toBe(true);
    expect(last.body.status).toBe("failed");
    expect(last.body.decision).toMatchObject({ cause: "failed", survivors: 0 });
    const after = fusionJson(["status", "--run", runId]);
    expect(after.body.status).toBe("failed");
  });

  it("a failed worker survives in the record while the run decides", () => {
    const runId = freshJury();
    submit(runId, "generate:w1", fail("provider-unavailable"));
    const done = submit(runId, "generate:w2", ok([answerClaim("ship it")]));
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({
      decision: "ship it",
      failures: [{ class: "provider-unavailable", workerId: "w1" }],
      survivors: 1,
    });
  });

  it("abort records a failed terminal decision with the reason and keeps events", () => {
    const runId = freshJury();
    submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    const aborted = fusionJson(["abort", "--run", runId, "--reason", "session lost"]);
    expect(aborted.code).toBe(0);
    expect(aborted.body.status).toBe("failed");
    expect(aborted.body.decision).toMatchObject({ cause: "aborted", reason: "session lost" });
    const events = readFileSync(join(root, ".fusion", "runs", runId, "events.ndjson"), "utf8");
    expect(events).toContain('"kind":"claim"');
    expect(fusionJson(["abort", "--run", runId, "--reason", "again"]).body.errors?.[0]?.code).toBe(
      "E204",
    );
    expect(
      fusionJson(["submit", "--run", runId, "--job", "generate:w2"], ok([answerClaim("x")])).body
        .errors?.[0]?.code,
    ).toBe("E204");
  });

  it("rejects pre-caller run formats with a usage error", () => {
    const runDir = join(root, ".fusion", "runs", "r0a1b2c3d");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({ pattern: "jury", runId: "r0a1b2c3d" }),
    );
    for (const args of [
      ["status", "--run", "r0a1b2c3d"],
      ["abort", "--run", "r0a1b2c3d", "--reason", "x"],
    ]) {
      const out = fusionJson(args);
      expect(out.body.errors?.[0]?.code).toBe("E102");
      expect(out.body.errors?.[0]?.detail).toContain("incompatible");
    }
    const submitOut = fusionJson(
      ["submit", "--run", "r0a1b2c3d", "--job", "generate:w1"],
      ok([answerClaim("x")]),
    );
    expect(submitOut.body.errors?.[0]?.detail).toContain("incompatible");
  });

  it("a live lock holder yields E304 without disturbing state", () => {
    const runId = freshJury();
    const runDir = join(root, ".fusion", "runs", runId);
    writeFileSync(
      join(runDir, "lock"),
      `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid })}\n`,
    );
    const busy = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(busy.code).toBe(3);
    expect(busy.body.errors?.[0]).toMatchObject({ code: "E304" });
    rmSync(join(runDir, "lock"));
    const okNow = submit(runId, "generate:w1", ok([answerClaim("ship it")]));
    expect(okNow.body.ok).toBe(true);
  });

  it("concurrent submissions of different jobs never lose an accepted result", () => {
    const start = startRun("gonogo", ["--task", "contention", "--reviewers", "2"]);
    const runId = start.runId as string;
    const payload = (worker: string): string =>
      ok([answerClaim("fine", { requested_action: "accept" })], {
        ...identity,
        sessionId: `sess-${worker}`,
      });
    const first = spawnSync(
      process.execPath,
      [CLI, "submit", "--run", runId, "--job", "generate:w-gate-1", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        input: payload("one"),
      },
    );
    const second = spawnSync(
      process.execPath,
      [CLI, "submit", "--run", runId, "--job", "generate:w-gate-2", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        input: payload("two"),
      },
    );
    expect(first.status).not.toBeNull();
    expect(second.status).not.toBeNull();
    // A busy rejection is legal; retry it explicitly. Accepted results survive.
    for (const [proc, jobId, who] of [
      [first, "generate:w-gate-1", "one"],
      [second, "generate:w-gate-2", "two"],
    ] as const) {
      const body = JSON.parse(String(proc.stdout)) as JsonBody;
      if (body.ok !== true) {
        expect(body.errors?.[0]?.code).toBe("E304");
        const retry = submit(runId, jobId, payload(who));
        expect(retry.body.ok).toBe(true);
      }
    }
    const done = fusionJson(["status", "--run", runId]);
    expect(done.body.status).toBe("done");
    expect(done.body.decision).toMatchObject({ decision: "GO", reviewers: 2 });
    const events = readFileSync(join(root, ".fusion", "runs", runId, "events.ndjson"), "utf8");
    expect(events).toContain("sess-one");
    expect(events).toContain("sess-two");
  });
});

// ---------------------------------------------------------------------------
// Parser errors: one standard envelope (ADR-0002, E106)
// ---------------------------------------------------------------------------

describe("parser errors use the standard envelope", () => {
  it("missing required flags on submit/status/abort are E106, exit 1, one JSON object", () => {
    for (const args of [["submit"], ["status"], ["abort"], ["submit", "--run", "r12345678"]]) {
      const out = fusionJson(args);
      expect(out.code).toBe(1);
      expect(out.body.ok).toBe(false);
      expect(out.body.errors?.[0]).toMatchObject({ code: "E106" });
      expect(out.body.errors?.[0]?.detail).toContain("required option");
    }
  });

  it("unknown options and unknown commands are E106 with --json", () => {
    const unknownOption = fusionJson(["status", "--run", "r12345678", "--wat"]);
    expect(unknownOption.code).toBe(1);
    expect(unknownOption.body.errors?.[0]).toMatchObject({ code: "E106" });
    expect(unknownOption.body.errors?.[0]?.detail).toContain("--wat");
    const unknownCommand = fusionJson(["frobnicate"]);
    expect(unknownCommand.code).toBe(1);
    expect(unknownCommand.body.errors?.[0]).toMatchObject({ code: "E106" });
    expect(unknownCommand.body.errors?.[0]?.detail).toContain("frobnicate");
  });

  it("without --json parser errors are human E-code lines", () => {
    const out = fusionText(["submit"]);
    expect(out.code).toBe(1);
    expect(out.out).toContain("E106:");
  });

  it("a bare invocation asks for a command via E106 instead of exiting silently", () => {
    const out = fusionJson([]);
    expect(out.code).toBe(1);
    expect(out.body.errors?.[0]).toMatchObject({ code: "E106" });
  });

  it("help and version still exit 0", () => {
    const root = fusionText(["--help"]);
    expect(root.code).toBe(0);
    expect(root.out).toContain("Usage: fusion");
    for (const args of [["submit", "--help"], ["jury", "--help"], ["help"]]) {
      const out = fusionText(args);
      expect(out.code).toBe(0);
      expect(out.out).toContain("Usage: fusion");
    }
    const version = fusionText(["--version"]);
    expect(version.code).toBe(0);
    expect(version.out).toMatch(/^0\.\d+\.\d+\n$/);
  });
});

// ---------------------------------------------------------------------------
// Frozen evidence
// ---------------------------------------------------------------------------

describe("evidence freeze", () => {
  it("survives the evidence file disappearing between start and submit", () => {
    const evidencePath = join(root, "citations.json");
    writeFileSync(
      evidencePath,
      JSON.stringify({
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
      }),
    );
    const start = startRun("red-blue", [
      "--task",
      "is the build green?",
      "--burden",
      "two sources",
      "--evidence",
      evidencePath,
    ]);
    const runId = start.runId as string;
    expect(start.jobs?.[0]?.prompt).toContain("RESEARCHED EVIDENCE");
    const frozen = JSON.parse(
      readFileSync(join(root, ".fusion", "runs", runId, "run.json"), "utf8"),
    ) as { evidenceSnapshot?: { content: string; path: string } };
    expect(frozen.evidenceSnapshot?.content).toContain("the build is green");
    rmSync(evidencePath);
    const next = submit(
      runId,
      "generate:w-red",
      ok([
        {
          claim: "the build is green",
          claim_id: "C1",
          confidence: 0.9,
          falsifier: "the build log disagrees",
          kind: "answer",
          status: "documented",
        },
      ]),
    );
    expect(next.body.ok).toBe(true);
    expect(jobIds(next.body)).toEqual(["challenge:w-blue"]);
  });
});
