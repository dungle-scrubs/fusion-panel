import { describe, expect, it } from "vitest";
import type { AcceptedClaim } from "../src/engine";
import { juryDefinition, juryFuse, juryWorkerPrompt } from "../src/jury";

function answer(
  workerId: string,
  text: string,
  extra: Record<string, unknown> = {},
): AcceptedClaim {
  return {
    claim: {
      claim: text,
      claim_id: `${workerId}:C1`,
      confidence: 0.8,
      falsifier: `falsifier ${workerId}`,
      kind: "answer",
      status: "documented",
      ...extra,
    },
    stage: "generate",
    workerId,
  };
}

describe("juryWorkerPrompt", () => {
  it("carries the task, the claim schema, and the provenance ban", () => {
    const prompt = juryWorkerPrompt("ship or hold?");
    expect(prompt).toContain("TASK: ship or hold?");
    expect(prompt).toContain('kind: "answer"');
    expect(prompt).toContain("Do NOT include a provenance field");
    expect(prompt).toContain("sealed");
  });
});

describe("juryFuse", () => {
  it("flags a tie that definition order broke", () => {
    const tied = juryFuse([answer("w1", "hold"), answer("w2", "ship")]);
    expect(tied.decision.decision).toBe("hold");
    expect(tied.decision.tie).toBe(true);
    expect(tied.fusion["tie"]).toBe(true);
    const clear = juryFuse([answer("w1", "hold"), answer("w2", "ship"), answer("w3", "hold")]);
    expect(clear.decision.tie).toBe(false);
    const lines = juryDefinition.summarize(tied.decision, {
      cause: "clean",
      decision: {},
      runDir: "d",
      runId: "r",
    });
    expect(lines[1]).toBe("decision hold (tie; definition order decided)");
  });

  it("groups equivalent answers and decides by plurality", () => {
    const result = juryFuse([
      answer("w1", "Ship it. The fix is verified."),
      answer("w2", "ship it. the fix is verified."),
      answer("w3", "Hold for a second review."),
    ]);
    expect(result.decision.decision).toBe("ship it. the fix is verified.");
    expect(result.decision.independence).toEqual({
      acceptedAnswers: 3,
      duplicateRate: 1 - 2 / 3,
      groups: 2,
    });
    expect(result.decision.minorityReport).toHaveLength(1);
    expect(result.decision.minorityReport[0]?.votes).toBe(1);
    expect(result.fusion.method).toBe("plurality");
    expect(result.fusion.winner).toBe("ship it. the fix is verified.");
  });

  it("breaks vote ties by first-seen order", () => {
    const result = juryFuse([answer("w1", "Option A"), answer("w2", "Option B")]);
    expect(result.decision.decision).toBe("option a");
  });

  it("rejects non-answer kinds with the pattern reason", () => {
    const result = juryFuse([
      answer("w1", "Fine"),
      {
        claim: {
          claim: "an objection is not a juror answer",
          claim_id: "C2",
          confidence: 0.9,
          falsifier: "x",
          kind: "objection",
          status: "documented",
        },
        stage: "generate",
        workerId: "w2",
      },
    ]);
    expect(result.decision.rejectedOptions).toEqual([
      { claimId: "C2", reason: "jury requires kind=answer, got objection" },
    ]);
    expect(result.decision.decision).toBe("fine");
  });

  it("lists high-confidence minority answers as residual risks", () => {
    const result = juryFuse([
      answer("w1", "Ship"),
      answer("w2", "Ship"),
      answer("w3", "Hold", { confidence: 0.9, requested_action: "escalate" }),
    ]);
    expect(result.decision.residualRisks).toEqual([
      { claimId: "w3:C1", confidence: 0.9, falsifier: "falsifier w3" },
    ]);
  });

  it("omits low-confidence quiet minorities from residual risks", () => {
    const result = juryFuse([
      answer("w1", "Ship"),
      answer("w2", "Ship"),
      answer("w3", "Hold", { confidence: 0.3 }),
    ]);
    expect(result.decision.residualRisks).toEqual([]);
  });

  it("binds residual risks to the minority claim itself when claim_ids collide", () => {
    const both = { claim_id: "C1" };
    const quiet = juryFuse([
      answer("w1", "Ship", { ...both, confidence: 0.9, requested_action: "escalate" }),
      answer("w2", "Hold", { ...both, confidence: 0.3, falsifier: "hold falsifier" }),
    ]);
    expect(quiet.decision.residualRisks).toEqual([]);
    const escalated = juryFuse([
      answer("w1", "Ship", { ...both, confidence: 0.9 }),
      answer("w2", "Hold", {
        ...both,
        confidence: 0.3,
        requested_action: "escalate",
        falsifier: "hold falsifier",
      }),
    ]);
    expect(escalated.decision.residualRisks).toEqual([
      { claimId: "C1", confidence: 0.3, falsifier: "hold falsifier" },
    ]);
  });

  it("returns a null decision when nothing survives", () => {
    const result = juryFuse([]);
    expect(result.decision.decision).toBeNull();
    expect(result.decision.independence.acceptedAnswers).toBe(0);
    expect(result.decision.minorityReport).toEqual([]);
  });
});

describe("jury merge", () => {
  const member = (workerId: string, text: string): AcceptedClaim => ({
    claim: {
      claim: text,
      claim_id: `${workerId}:C1`,
      confidence: 0.8,
      falsifier: `f ${workerId}`,
      kind: "answer",
      status: "documented",
    },
    stage: "generate",
    workerId,
  });
  const mergeClaim = (deps: string[], label: string): AcceptedClaim => ({
    claim: {
      claim: label,
      claim_id: "C1",
      confidence: 0.9,
      dependencies: deps,
      falsifier: "split on scope",
      kind: "answer",
      status: "inferred",
    },
    stage: "verify",
    workerId: "w-merge",
  });

  it("tallies paraphrased answers as separate groups without merge", () => {
    const result = juryFuse(
      [member("w1", "Ship the release"), member("w2", "Release it now"), member("w3", "Hold")],
      undefined,
    );
    expect(result.decision.decision).toBe("ship the release");
    expect(result.fusion.merged).toBe(false);
  });

  it("applies a valid merge mapping mechanically", () => {
    const result = juryFuse(
      [
        member("w1", "Ship the release"),
        member("w2", "Release it now"),
        member("w3", "Hold everything"),
        mergeClaim(["w1:C1", "w2:C1"], "Ship the release"),
      ],
      undefined,
    );
    expect(result.decision.decision).toBe("Ship the release");
    expect(result.fusion.merged).toBe(true);
    expect(result.decision.mergeClusters).toEqual([
      { label: "Ship the release", members: ["ship the release", "release it now"] },
      { label: "hold everything", members: ["hold everything"] },
    ]);
  });

  it("falls back to the unmerged tally when the merge is unusable", () => {
    const result = juryFuse(
      [member("w1", "Ship"), member("w2", "Hold"), mergeClaim(["w9:C1"], "Nonsense")],
      undefined,
    );
    expect(result.fusion.merged).toBe(true);
    expect(result.decision.decision).toBe("ship");
  });

  it("builds a blind merge worker with --merge", () => {
    const build = juryDefinition.build({ merge: true, task: "t", workers: "2" });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.stages?.verify).toBeTypeOf("function");
    const staged = build.stages?.verify?.({ anonymizedClaims: [], byWorker: new Map() });
    expect(staged?.[0]?.workerId).toBe("w-merge");
    expect(staged?.[0]?.prompt).toContain("merge judge");
    expect(staged?.[0]?.prompt).toContain("record id - answer text");
    expect(juryDefinition.build({ "merge-harness": "codex", task: "t" })).toEqual({
      error: "--merge-harness requires --merge",
    });
  });
});
