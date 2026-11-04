import { describe, expect, it } from "vitest";
import type { AcceptedClaim } from "../src/engine";
import { claimantPrompt, judgePrompt, redblueFuse } from "../src/redblue";

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

describe("prompts", () => {
  it("claimant prompt bans provenance and allows multiple claims", () => {
    const prompt = claimantPrompt("is the build green?");
    expect(prompt).toContain("is the build green?");
    expect(prompt).toContain("1-4 atomic claims");
    expect(prompt).toContain("Do NOT include a provenance field");
  });

  it("judge prompt carries the burden and the blindness rule", () => {
    const prompt = judgePrompt("two independent sources", {
      anonymizedClaims: [],
      byWorker: new Map(),
    });
    expect(prompt).toContain("BURDEN: two independent sources");
    expect(prompt).toContain("hidden from you");
  });

  it("judge prompt receives claims without provenance", () => {
    const prompt = judgePrompt("b", {
      anonymizedClaims: [{ claim: "x", claim_id: "C1", provenance: undefined }],
      byWorker: new Map(),
    });
    expect(prompt).toContain('"claim":"x"');
  });
});

describe("redblueFuse", () => {
  const base = [
    claim("generate", "w-red", { claim: "claim one", claim_id: "C1" }),
    claim("generate", "w-red", { claim: "claim two", claim_id: "C2" }),
  ];

  it("sustained objection removes its target", () => {
    const result = redblueFuse([
      ...base,
      claim("challenge", "w-blue", {
        claim: "C1 rests on a stale source",
        claim_id: "C1",
        dependencies: ["C1"],
        kind: "objection",
      }),
      claim("verify", "w-umpire", {
        claim: "the source is stale",
        claim_id: "C1",
        dependencies: ["C1"],
        kind: "evidence",
        requested_action: "accept",
        status: "observed",
      }),
      claim("verify", "w-judge", {
        claim: "C2 alone meets the burden",
        claim_id: "C1",
        kind: "answer",
        requested_action: "accept",
      }),
    ]);
    expect(result.decision["survivingClaims"]).toEqual(["C2"]);
    expect(result.decision["decision"]).toBe("C2 alone meets the burden");
    expect(result.decision["judgeVerdict"]).toBe("accept");
    expect(result.decision["rejectedOptions"]).toEqual([
      { claimId: "C1", reason: "objection C1 sustained" },
    ]);
  });

  it("overruled objection leaves the target standing", () => {
    const result = redblueFuse([
      ...base,
      claim("challenge", "w-blue", {
        claim: "C1 is irrelevant",
        claim_id: "C1",
        dependencies: ["C1"],
        kind: "objection",
      }),
      claim("verify", "w-umpire", {
        claim: "C1 is relevant",
        claim_id: "C1",
        dependencies: ["C1"],
        kind: "evidence",
        requested_action: "revise",
        status: "observed",
      }),
      claim("verify", "w-judge", {
        claim: "record stands",
        claim_id: "C1",
        kind: "answer",
        requested_action: "accept",
      }),
    ]);
    expect(result.decision["survivingClaims"]).toEqual(["C1", "C2"]);
    expect(result.decision["residualRisks"]).toEqual([]);
  });

  it("unresolved objections become residual risks", () => {
    const result = redblueFuse([
      ...base,
      claim("challenge", "w-blue", {
        claim: "C2 is unverifiable",
        claim_id: "C1",
        dependencies: ["C2"],
        kind: "objection",
      }),
      claim("verify", "w-judge", {
        claim: "cannot rule",
        claim_id: "C1",
        kind: "answer",
        requested_action: "escalate",
      }),
    ]);
    expect(result.decision["residualRisks"]).toEqual([{ objectionId: "C1", targetId: "C2" }]);
    expect(result.decision["judgeVerdict"]).toBe("escalate");
  });

  it("no objections: everything survives", () => {
    const result = redblueFuse([
      ...base,
      claim("verify", "w-judge", {
        claim: "unopposed record meets burden",
        claim_id: "C1",
        kind: "answer",
        requested_action: "accept",
      }),
    ]);
    expect(result.decision["survivingClaims"]).toEqual(["C1", "C2"]);
  });

  it("no judge: decision null, mechanics still reported", () => {
    const result = redblueFuse(base);
    expect(result.decision["decision"]).toBeNull();
    expect(result.decision["survivingClaims"]).toEqual(["C1", "C2"]);
  });
});
