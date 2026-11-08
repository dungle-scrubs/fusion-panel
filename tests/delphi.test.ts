import { describe, expect, it } from "vitest";
import {
  delphiDefinition,
  delphiFuse,
  delphiRound1Prompt,
  delphiRound2Prompt,
} from "../src/delphi";
import type { AcceptedClaim, RunReport } from "../src/engine";
import { juryFuse, parseVocabulary } from "../src/jury";

function claim(
  stage: AcceptedClaim["stage"],
  workerId: string,
  fields: Record<string, unknown>,
): AcceptedClaim {
  return {
    claim: {
      claim_id: "C1",
      confidence: 0.8,
      falsifier: "f",
      kind: "answer",
      status: "documented",
      ...fields,
    },
    stage,
    workerId,
  };
}

describe("delphi prompts", () => {
  it("round 1 carries the task, schema, and provenance ban", () => {
    const prompt = delphiRound1Prompt("ship or hold?");
    expect(prompt).toContain("TASK: ship or hold?");
    expect(prompt).toContain('kind: "answer"');
    expect(prompt).toContain("Do NOT include a provenance field");
  });

  it("round 2 shows the worker its own answer AND the panel record claims", () => {
    const prompt = delphiRound2Prompt(
      "ship or hold?",
      [{ claim: "hold", claim_id: "C1" }],
      [
        { claim: "ship now", claim_id: "w1:C1" },
        { claim: "hold for tests", claim_id: "w2:C1" },
      ],
    );
    expect(prompt).toContain("YOUR ROUND-1 ANSWER:");
    expect(prompt).toContain('"claim":"hold"');
    expect(prompt).toContain("PANEL RECORD (anonymized");
    expect(prompt).toContain('"claim":"ship now"');
    expect(prompt).toContain('"claim":"hold for tests"');
    expect(prompt).toContain("novelty:");
  });
});

describe("parseVocabulary", () => {
  it("parses members and dedups by canonical form", () => {
    expect(parseVocabulary("ship,hold")).toEqual({ members: ["ship", "hold"] });
    expect(parseVocabulary(" Ship , SHIP, hold ")).toEqual({ members: ["Ship", "hold"] });
  });

  it("rejects fewer than two distinct members", () => {
    expect(parseVocabulary("ship")).toEqual({
      error: "--vocabulary must name at least two distinct answers",
    });
    expect(parseVocabulary("ship, ship")).toEqual({
      error: "--vocabulary must name at least two distinct answers",
    });
    expect(parseVocabulary(", , ")).toEqual({
      error: "--vocabulary must name at least two distinct answers",
    });
  });
});

describe("jury vocabulary", () => {
  const member = (workerId: string, text: string): AcceptedClaim => ({
    claim: {
      claim: text,
      claim_id: `C${workerId.slice(1)}`,
      confidence: 0.8,
      falsifier: `f ${workerId}`,
      kind: "answer",
      status: "documented",
    },
    stage: "generate",
    workerId,
  });

  it("accepts in-vocabulary answers verbatim and reports the vocabulary", () => {
    const result = juryFuse([member("w1", "ship"), member("w2", "HOLD")], ["ship", "hold"]);
    expect(result.decision.decision).toBe("ship");
    expect((result.decision as { vocabulary?: string[] }).vocabulary).toEqual(["ship", "hold"]);
    expect(result.decision.rejectedOptions).toEqual([]);
  });

  it("rejects off-vocabulary answers with a named reason", () => {
    const result = juryFuse([member("w1", "ship"), member("w2", "maybe later")], ["ship", "hold"]);
    expect(result.decision.decision).toBe("ship");
    expect(result.decision.rejectedOptions).toEqual([
      {
        claimId: "C2",
        reason: "jury vocabulary violation: answer must be one of ship, hold",
      },
    ]);
  });

  it("rejects bad vocabularies at build time", () => {
    const build = delphiDefinition.build({ task: "t", vocabulary: "ship" });
    expect(build).toEqual({ error: "--vocabulary must name at least two distinct answers" });
  });
});

describe("delphi vocabulary", () => {
  it("constrains both rounds and reports the vocabulary", () => {
    const result = delphiFuse(
      [
        claim("generate", "w1", { claim: "ship" }),
        claim("generate", "w2", { claim: "hold" }),
        claim("challenge", "w1-r2", { claim: "ship" }),
        claim("challenge", "w2-r2", { claim: "off script" }),
      ],
      ["ship", "hold"],
    );
    expect(result.decision["decision"]).toBe("ship");
    expect(result.decision["vocabulary"]).toEqual(["ship", "hold"]);
    expect(result.decision["rejectedOptions"]).toEqual([
      {
        claimId: "C1",
        reason: "delphi vocabulary violation: answer must be one of ship, hold",
      },
    ]);
  });

  it("carries the vocabulary in both round prompts", () => {
    expect(delphiRound1Prompt("t", ["ship", "hold"])).toContain("VOCABULARY");
    expect(delphiRound2Prompt("t", [], [], ["ship", "hold"])).toContain(
      "MUST stay inside this set",
    );
  });
});

describe("delphiFuse", () => {
  it("computes convergence, stability, and the round-2 winner mechanically", () => {
    const result = delphiFuse([
      claim("generate", "w1", { claim: "Ship Friday" }),
      claim("generate", "w2", { claim: "Hold for tests" }),
      claim("generate", "w3", { claim: "Ship Friday" }),
      claim("challenge", "w1-r2", { claim: "ship friday" }),
      claim("challenge", "w2-r2", { claim: "Ship Friday after tests pass" }),
      claim("challenge", "w3-r2", { claim: "ship friday" }),
    ]);
    const stats = result.decision["delphi"] as Record<string, unknown>;
    expect(result.decision["decision"]).toBe("ship friday");
    expect(stats["round1"]).toEqual({ answers: 3, groups: 2 });
    expect(stats["round2"]).toEqual({ answers: 3, groups: 2 });
    expect(stats["stabilityRate"]).toBeCloseTo(2 / 3, 12);
    expect(stats["convergenceRate"]).toBeCloseTo(1 / 3, 12);
    expect(result.decision["minorityReport"]).toHaveLength(1);
  });

  it("flags a revised high-confidence minority as a residual risk", () => {
    const result = delphiFuse([
      claim("generate", "w1", { claim: "A" }),
      claim("generate", "w2", { claim: "A" }),
      claim("challenge", "w1-r2", { claim: "a" }),
      claim("challenge", "w2-r2", {
        claim: "B instead, panel ignored the load test",
        confidence: 0.9,
        novelty: "new",
      }),
    ]);
    expect(result.decision["residualRisks"]).toEqual([
      { claimId: "C1", confidence: 0.9, falsifier: "f" },
    ]);
  });

  it("empty rounds yield a null decision with well-formed stats", () => {
    const result = delphiFuse([]);
    expect(result.decision["decision"]).toBeNull();
  });
});

describe("delphi definition", () => {
  it("builds the panel and the revision wave from the same worker count", () => {
    const build = delphiDefinition.build({
      harness: "pi",
      task: "t",
      timeout: "60",
      workers: "3",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers).toHaveLength(3);
    expect(build.workers[0]?.workerId).toBe("w1");
    expect(build.stages?.challenge).toBeTypeOf("function");
    if (build.stages?.challenge === undefined) {
      return;
    }
    const own = (id: string) => [{ claim: `answer ${id}`, claim_id: `${id}:C1` }];
    const wave = build.stages.challenge({
      anonymizedClaims: [],
      byWorker: new Map([
        ["w1", own("w1")],
        ["w2", own("w2")],
        ["w3", own("w3")],
      ]),
    });
    expect(wave).toHaveLength(3);
    expect(wave[0]?.workerId).toBe("w1-r2");
    expect(wave[0]?.prompt).toContain("YOUR ROUND-1 ANSWER:");
    expect(wave[0]?.prompt).toContain("answer w1");
    expect(wave[1]?.prompt).toContain("PANEL RECORD");
    // a worker that failed round 1 has nothing to revise and gets no round-2 job
    const partial = build.stages.challenge({
      anonymizedClaims: [],
      byWorker: new Map([
        ["w1", own("w1")],
        ["w3", own("w3")],
      ]),
    });
    expect(partial.map((job) => job.workerId)).toEqual(["w1-r2", "w3-r2"]);
  });

  it("flags a round-2 tie that definition order broke", () => {
    const tied = delphiFuse([
      claim("generate", "w1", { claim: "ship" }),
      claim("generate", "w2", { claim: "hold" }),
      claim("challenge", "w1-r2", { claim: "ship" }),
      claim("challenge", "w2-r2", { claim: "hold" }),
    ]);
    expect(tied.decision["decision"]).toBe("ship");
    expect(tied.decision["tie"]).toBe(true);
    expect(tied.fusion["tie"]).toBe(true);
  });

  it("rejects bad args", () => {
    expect(
      delphiDefinition.build({ harness: "pi", task: "", timeout: "60", workers: "3" }),
    ).toEqual({
      error: "--task must be non-empty",
    });
    expect(
      delphiDefinition.build({ harness: "pi", task: "t", timeout: "60", workers: "1" }),
    ).toEqual({
      error: "--workers must be an integer >= 2",
    });
  });

  it("summarizes rounds and signals", () => {
    const report: RunReport = {
      cause: "clean",
      decision: {},
      runDir: "/tmp/x",
      runId: "r0a1b2c3",
    };
    const lines = delphiDefinition.summarize(
      {
        decision: "ship",
        delphi: {
          convergenceRate: 0.33,
          round1: { answers: 3, groups: 2 },
          round2: { answers: 3, groups: 2 },
          stabilityRate: 0.67,
        },
      },
      report,
    );
    expect(lines.join("\n")).toContain("r1 3 answers / 2 groups -> r2 3 / 2");
    expect(lines.join("\n")).toContain("convergence 0.33, stability 0.67");
  });
});
