import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { achDefinition, achFuse, achWorkerPrompt } from "../src/ach";
import type { AcceptedClaim } from "../src/engine";

function claim(
  workerId: string,
  fields: Record<string, unknown>,
  stage: AcceptedClaim["stage"] = "generate",
): AcceptedClaim {
  return {
    claim: {
      claim_id: "C1",
      confidence: 0.8,
      falsifier: "f",
      kind: "hypothesis",
      status: "documented",
      ...fields,
    },
    stage,
    workerId,
  };
}

const H1 = {
  claim: "disk is full",
  claim_id: "C1",
  dependencies: ["C3", "C4"],
  kind: "hypothesis",
};
const H2 = {
  claim: "process leaks handles",
  claim_id: "C2",
  dependencies: ["C3", "C4"],
  kind: "hypothesis",
};
const E_BOTH = {
  claim: "error log covers both hypotheses' signatures",
  claim_id: "C3",
  dependencies: ["C1", "C2"],
  kind: "evidence",
  novelty: "confirms",
};
const E_CONTRADICTS_BOTH = {
  claim: "df shows 90% free",
  claim_id: "C4",
  dependencies: ["C1", "C2"],
  kind: "evidence",
  novelty: "contradicts",
};

describe("achWorkerPrompt", () => {
  it("carries the task, the link rules, and the provenance ban", () => {
    const prompt = achWorkerPrompt("why did the deploy fail?");
    expect(prompt).toContain("TASK: why did the deploy fail?");
    expect(prompt).toContain('"confirms" = consistent');
    expect(prompt).toContain("DISCRIMINATES");
    expect(prompt).toContain("Do NOT include a provenance field");
  });
});

describe("achFuse", () => {
  it("builds the matrix from bidirectional links with novelty as consistency", () => {
    const result = achFuse([
      claim("w1", H1),
      claim("w1", H2),
      claim("w1", E_BOTH),
      claim("w2", E_CONTRADICTS_BOTH),
    ]);
    // E_CONTRADICTS_BOTH novelty=contradicts links both hypotheses, but H1/H2 cite C4 back:
    // cell consistency follows novelty for every linked pair.
    const cellFor = (h: string, e: string) =>
      result.decision.matrix.find((c) => c.hypothesisId === h && c.evidenceId === e)?.consistency;
    expect(cellFor("C1", "C3")).toBe("consistent");
    expect(cellFor("C2", "C3")).toBe("consistent");
    expect(cellFor("C1", "C4")).toBe("inconsistent");
    expect(cellFor("C2", "C4")).toBe("inconsistent");
  });

  it("marks subset-bearing evidence diagnostic and full-coverage confirms consistent-with-all", () => {
    const result = achFuse([
      claim("w1", H1),
      claim("w1", H2),
      claim("w1", { ...E_BOTH, novelty: "confirms" }),
      claim("w2", { ...E_CONTRADICTS_BOTH, dependencies: ["C1"], novelty: "contradicts" }),
      claim("w2", {
        claim: "contradicts everything equally",
        claim_id: "C5",
        dependencies: ["C1", "C2"],
        kind: "evidence",
        novelty: "contradicts",
      }),
    ]);
    expect(result.decision.consistentWithAll).toEqual(["C3"]);
    expect(result.decision.diagnosticEvidence).toEqual(["C4"]);
  });

  it("picks the least-disconfirmed hypothesis and carries its falsifier", () => {
    const result = achFuse([
      claim("w1", H1),
      claim("w1", H2),
      claim("w1", { ...E_BOTH, dependencies: ["C1", "C2"], novelty: "confirms" }),
      claim("w2", {
        claim: "df shows 90% free",
        claim_id: "C4",
        dependencies: ["C1"],
        falsifier: "df shows full disk",
        kind: "evidence",
        novelty: "contradicts",
      }),
    ]);
    expect(result.decision.leastDisconfirmed).toBe("C2");
    expect(result.decision.residualRisks).toEqual([{ claimId: "C2", falsifier: "f" }]);
  });

  it("rejects hypotheses without evidence dependencies and unlinked evidence", () => {
    const result = achFuse([
      claim("w1", { claim: "bare hypothesis", claim_id: "C1", dependencies: [] }),
      claim("w1", {
        claim: "floating evidence",
        claim_id: "C2",
        dependencies: [],
        kind: "evidence",
      }),
    ]);
    expect(result.decision.rejectedClaims).toEqual([
      { claimId: "C1", reason: "ach requires hypotheses to cite their evidence dependencies" },
      { claimId: "C2", reason: "ach requires evidence to link at least one hypothesis" },
    ]);
    expect(result.decision.leastDisconfirmed).toBeNull();
  });

  it("returns an empty but well-formed record when nothing survives", () => {
    const result = achFuse([]);
    expect(result.decision.matrix).toEqual([]);
    expect(result.decision.hypotheses).toEqual([]);
    expect(result.decision.leastDisconfirmed).toBeNull();
  });
});

describe("evidence supply", () => {
  it("appends researched sources to the analyst prompt", () => {
    const prompt = achWorkerPrompt(
      "why?",
      "RESEARCHED EVIDENCE\n- [c001] https://a.example/: s (p1)",
    );
    expect(prompt).toContain("TASK: why?");
    expect(prompt).toContain("RESEARCHED EVIDENCE");
    expect(achWorkerPrompt("why?")).not.toContain("RESEARCHED EVIDENCE");
  });

  it("resolves --evidence files at build time and rejects bad ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusion-ev-"));
    const file = join(dir, "citations.json");
    writeFileSync(
      file,
      JSON.stringify({
        documents: [
          {
            citedBy: [
              {
                claimId: "c001",
                claimStatus: "verified",
                locator: "p1",
                statement: "s",
                verdict: "supported",
              },
            ],
            fetch: { finalUrl: "https://a.example/", status: "ok" },
          },
        ],
        unfetched: [],
      }),
    );
    const build = achDefinition.build({ evidence: file, task: "why?", workers: "2" });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers[0]?.prompt).toContain("RESEARCHED EVIDENCE");
    expect(build.workers[0]?.prompt).toContain("https://a.example/");
    expect(achDefinition.build({ evidence: join(dir, "missing.json"), task: "t" })).toEqual({
      error: expect.stringContaining("cannot read"),
    });
  });
});
