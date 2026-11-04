import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { achDefinition } from "../src/ach";
import type { AcceptedClaim, RunReport } from "../src/engine";
import { gonogoDefinition } from "../src/gonogo";
import { juryDefinition, juryFuse } from "../src/jury";
import { diversityCounts, resolveRoster } from "../src/pattern";
import { redblueDefinition } from "../src/redblue";
import { shortlistDefinition } from "../src/shortlist";

function reportOf(overrides: Partial<RunReport> = {}): RunReport {
  return {
    cause: "clean",
    decision: {},
    runDir: "/tmp/x",
    runId: "r0a1b2c3",
    ...overrides,
  };
}

describe("resolveRoster", () => {
  it("fans the fallback pair out to every worker without --roster", () => {
    const resolved = resolveRoster({ harness: "muse", model: "m1", task: "t" }, 2);
    expect(resolved).toEqual({
      roster: [
        { harness: "muse", model: "m1" },
        { harness: "muse", model: "m1" },
      ],
    });
  });

  it("parses harness and harness:model entries positionally", () => {
    const resolved = resolveRoster({ roster: "pi,codex:gpt" }, 2);
    expect(resolved).toEqual({ roster: [{ harness: "pi" }, { harness: "codex", model: "gpt" }] });
  });

  it("rejects a roster whose length misses the worker count", () => {
    expect(resolveRoster({ roster: "pi" }, 2)).toEqual({
      error: "--roster expects 2 entries (one per worker), got 1",
    });
  });
});

describe("diversityCounts", () => {
  it("counts distinct harnesses and models from stamped provenance", () => {
    expect(
      diversityCounts([
        { provenance: { harness: "pi", model: "m1" } },
        { provenance: { harness: "codex", model: "m1" } },
        {},
      ]),
    ).toEqual({ harnesses: 2, models: 1 });
  });
});

describe("roster wiring", () => {
  it("jury maps roster slots to workers and reports diversity", () => {
    const build = juryDefinition.build({ roster: "pi,codex:m1", task: "t", workers: "2" });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers.map((w) => w.harness)).toEqual(["pi", "codex"]);
    expect(build.workers[1]?.model).toBe("m1");
    const fused = juryFuse(
      [
        {
          claim: {
            claim: "ship",
            claim_id: "C1",
            confidence: 0.8,
            falsifier: "f",
            kind: "answer",
            provenance: { harness: "pi", model: "m1" },
            status: "documented",
          },
          stage: "generate",
          workerId: "w1",
        } as AcceptedClaim,
      ],
      undefined,
    );
    expect(fused.decision.diversity).toEqual({ harnesses: 1, models: 1 });
  });

  it("shortlist maps the first G slots to proposers and the rest to judges", () => {
    const build = shortlistDefinition.build({
      generators: "2",
      judges: "2",
      roster: "pi,pi,codex,codex",
      rubric: "r",
      task: "t",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers.map((w) => w.harness)).toEqual(["pi", "pi"]);
    const staged = build.stages?.challenge?.({ anonymizedClaims: [], byWorker: new Map() });
    expect(staged?.map((w) => w.harness)).toEqual(["codex", "codex"]);
  });

  it("gonogo rejects a short roster before any spawn", () => {
    expect(gonogoDefinition.build({ reviewers: "3", roster: "pi,pi", task: "t" })).toEqual({
      error: "--roster expects 3 entries (one per worker), got 2",
    });
  });

  it("red-blue omits the umpire when there are no objections", () => {
    const build = redblueDefinition.build({ task: "review", burden: "evidence" });
    expect("error" in build).toBe(false);
    if ("error" in build) return;
    expect(
      build.stages
        ?.verify?.({ anonymizedClaims: [], byWorker: new Map() })
        .map((worker) => worker.workerId),
    ).toEqual(["w-judge"]);
  });

  it("red-blue expects four role slots in red,blue,umpire,judge order", () => {
    const build = redblueDefinition.build({
      burden: "b",
      roster: "pi,pi,codex,codex",
      task: "t",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers[0]?.harness).toBe("pi");
    const staged = build.stages?.verify?.({
      anonymizedClaims: [{ claim_id: "w-blue:C1", kind: "objection", claim: "challenge" }],
      byWorker: new Map(),
    });
    expect(staged?.map((w) => w.harness)).toEqual(["codex", "codex"]);
    expect(redblueDefinition.build({ burden: "b", roster: "pi", task: "t" })).toEqual({
      error: "--roster expects 4 entries (one per worker), got 1",
    });
  });
});

describe("jury definition", () => {
  it("builds N sealed workers with the juror prompt", () => {
    const build = juryDefinition.build({
      harness: "pi",
      task: "ship or hold?",
      timeout: "60",
      workers: "2",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers).toHaveLength(2);
    expect(build.workers[0]?.prompt).toContain("TASK: ship or hold?");
    expect(build.workers[1]?.workerId).toBe("w2");
    expect(build.fuse).toBeTypeOf("function");
  });

  it("rejects empty task, too few workers, and bad timeout", () => {
    expect(
      juryDefinition.build({ harness: "pi", task: "  ", timeout: "60", workers: "3" }),
    ).toEqual({
      error: "--task must be non-empty",
    });
    expect(juryDefinition.build({ harness: "pi", task: "t", timeout: "60", workers: "1" })).toEqual(
      {
        error: "--workers must be an integer >= 2",
      },
    );
    expect(juryDefinition.build({ harness: "pi", task: "t", timeout: "0", workers: "2" })).toEqual({
      error: "--timeout must be positive seconds",
    });
  });

  it("summarizes with run, decision, and votes lines", () => {
    const lines = juryDefinition.summarize(
      {
        decision: "ship it",
        independence: { acceptedAnswers: 2, duplicateRate: 0.5, groups: 1 },
      },
      reportOf(),
    );
    expect(lines[0]).toContain("r0a1b2c3");
    expect(lines[1]).toContain("ship it");
    expect(lines[2]).toContain("2 answers, 1 groups");
  });
});

describe("red-blue definition", () => {
  it("builds claimant plus challenge and verify stages with symmetric budgets", () => {
    const build = redblueDefinition.build({
      burden: "two sources",
      harness: "pi",
      task: "is it safe?",
      timeout: "120",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers).toEqual([
      {
        harness: "pi",
        prompt: expect.stringContaining("claimant"),
        timeoutSec: 120,
        workerId: "w-red",
      },
    ]);
    expect(build.rubric).toBe("two sources");
    expect(build.stages?.challenge).toBeTypeOf("function");
    expect(build.stages?.verify).toBeTypeOf("function");
  });

  it("rejects missing burden or task and bad timeout", () => {
    expect(redblueDefinition.build({ harness: "pi", task: "t", timeout: "10" })).toEqual({
      error: "--task and --burden must be non-empty",
    });
    expect(
      redblueDefinition.build({ burden: "b", harness: "pi", task: "t", timeout: "0" }),
    ).toEqual({ error: "--timeout must be positive seconds" });
  });

  it("summarizes ruling, verdict, and surviving claims", () => {
    const lines = redblueDefinition.summarize(
      { decision: "record stands", judgeVerdict: "accept", survivingClaims: ["w-red:C1"] },
      reportOf(),
    );
    expect(lines.join("\n")).toContain("ruling   record stands");
    expect(lines.join("\n")).toContain("verdict  accept");
    expect(lines.join("\n")).toContain('["w-red:C1"]');
  });
});

describe("ach definition", () => {
  it("builds N analysts with the ACH prompt", () => {
    const build = achDefinition.build({
      harness: "muse",
      task: "why did it fail?",
      timeout: "60",
      workers: "2",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers).toHaveLength(2);
    expect(build.workers[0]?.prompt).toContain("TASK: why did it fail?");
    expect(build.workers[0]?.harness).toBe("muse");
  });

  it("rejects single-analyst runs", () => {
    expect(achDefinition.build({ harness: "pi", task: "t", timeout: "60", workers: "1" })).toEqual({
      error: "--workers must be an integer >= 2",
    });
  });
});

describe("skill text covers every pattern command", () => {
  it("mentions all three pattern commands", () => {
    const text = readFileSync(new URL("../src/skill.ts", import.meta.url), "utf8");
    expect(text).toContain("fusion jury");
    expect(text).toContain("fusion red-blue");
    expect(text).toContain("fusion ach");
  });

  it("carries a selection rule and a counter-rule per pattern", () => {
    const text = readFileSync(new URL("../src/skill.ts", import.meta.url), "utf8");
    expect(text).toContain("-> jury");
    expect(text).toContain("Do NOT use jury");
    expect(text).toContain("-> red-blue");
    expect(text).toContain("Do NOT use it when nobody");
    expect(text).toContain("-> ach");
    expect(text).toContain("Do NOT use it to choose between proposals");
    expect(text).toContain(
      "tier 1 directly. A pattern run adds a delegation loop you do not need.",
    );
    expect(text).toContain("do not call fusion at all");
  });
});
