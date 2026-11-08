import { describe, expect, it } from "vitest";
import { validateSuccessClaims } from "../src/submission";

function claim(claimId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim: "text",
    claim_id: claimId,
    confidence: 0.5,
    falsifier: "f",
    kind: "answer",
    status: "inferred",
    ...extra,
  };
}

describe("validateSuccessClaims claim-id scopes", () => {
  const state = { accepted: [{ claim: claim("w-red:C1"), wave: 0 }], wave: 1 };

  it("accepts a bare id and the worker's own scoped id, remapped to run scope", () => {
    const verdict = validateSuccessClaims([claim("C1"), claim("w-blue:C2")], "w-blue", state);
    expect("stamped" in verdict).toBe(true);
    if (!("stamped" in verdict)) {
      return;
    }
    expect(verdict.stamped.map((c) => c["claim_id"])).toEqual(["w-blue:C1", "w-blue:C2"]);
  });

  it("rejects a claim_id carrying another worker's scope instead of adopting it", () => {
    const verdict = validateSuccessClaims([claim("w-red:C1")], "w-blue", state);
    expect("errors" in verdict).toBe(true);
    if (!("errors" in verdict)) {
      return;
    }
    expect(verdict.errors).toEqual([
      {
        code: "E201",
        detail:
          'claims: C1: claim_id "w-red:C1" belongs to worker w-red; your own claim ids are bare C-numbers',
      },
    ]);
  });
});
