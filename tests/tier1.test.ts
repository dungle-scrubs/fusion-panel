import { describe, expect, it } from "vitest";
import {
  aggregate,
  canonicalize,
  evidenceFromCitations,
  normalizeClaims,
  scoreForecasts,
} from "../src/tier1";

describe("canonicalize", () => {
  it("collapses whitespace, trims, and lowercases", () => {
    expect(canonicalize("  Hello   WORLD\n\t")).toBe("hello world");
  });

  it("normalizes Unicode to NFC", () => {
    expect(canonicalize("café")).toBe("café");
    expect(canonicalize("café")).toBe("café");
  });

  it("unifies number formats", () => {
    expect(canonicalize("1,000")).toBe("1000");
    expect(canonicalize("3.0")).toBe("3");
  });

  it("treats non-breaking and wide spaces as spaces", () => {
    expect(canonicalize("a b　c")).toBe("a b c");
  });

  it("is idempotent", () => {
    const samples = ["  MiXeD  Case\n", "café", "1,000 items", "", "   "];
    for (const s of samples) {
      expect(canonicalize(canonicalize(s))).toBe(canonicalize(s));
    }
  });

  it("maps equivalent variants to the same key", () => {
    const variants = ["  SemVer-minor  v2.3\n", "semver-minor v2.3", "SEMVER-MINOR\u00a0V2.3"];
    const keys = new Set(variants.map(canonicalize));
    expect(keys.size).toBe(1);
  });
});

describe("normalizeClaims", () => {
  it("groups exact matches after canonicalization", () => {
    const groups = normalizeClaims([
      { claim: "dep X removes default export", claim_id: "C1" },
      { claim: "  DEP x REMOVES default  export ", claim_id: "C2" },
      { claim: "migration is mechanical", claim_id: "C3" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      canonical: "dep x removes default export",
      members: ["C1", "C2"],
    });
    expect(groups[1]?.members).toEqual(["C3"]);
  });

  it("keeps near-misses separate (no semantic dedup in tier 1)", () => {
    const groups = normalizeClaims([
      { claim: "dep X removes default export", claim_id: "C1" },
      { claim: "dep X removes the default export", claim_id: "C2" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("returns empty groups for empty input", () => {
    expect(normalizeClaims([])).toEqual([]);
  });

  it("is order-deterministic: same multiset, same groups", () => {
    const a = [
      { claim: "x", claim_id: "C1" },
      { claim: "Y", claim_id: "C2" },
      { claim: "x ", claim_id: "C3" },
    ];
    const b = [...a].reverse();
    const norm = (groups: { canonical: string; members: readonly string[] }[]) =>
      [...groups]
        .map((g) => ({ canonical: g.canonical, members: [...g.members].sort() }))
        .sort((p, q) => (p.canonical < q.canonical ? -1 : 1));
    expect(norm(normalizeClaims(a))).toEqual(norm(normalizeClaims(b)));
  });
});

describe("aggregate", () => {
  it("plurality picks the most-voted value", () => {
    const result = aggregate("plurality", [
      { confidence: 0.6, value: "a" },
      { confidence: 0.9, value: "b" },
      { confidence: 0.7, value: "a" },
    ]);
    expect(result).toEqual({
      detail: { votes: 3, winnerVotes: 2 },
      method: "plurality",
      value: "a",
    });
  });

  it("plurality breaks ties by first-seen order", () => {
    const result = aggregate("plurality", [
      { confidence: 0.5, value: "b" },
      { confidence: 0.5, value: "a" },
    ]);
    expect(result.value).toBe("b");
  });

  it("median works on odd and even counts", () => {
    expect(
      aggregate("median", [
        { confidence: 1, value: "3" },
        { confidence: 1, value: "1" },
        { confidence: 1, value: "2" },
      ]).value,
    ).toBe(2);
    expect(
      aggregate("median", [
        { confidence: 1, value: "4" },
        { confidence: 1, value: "1" },
      ]).value,
    ).toBe(2.5);
  });

  it("weighted computes the confidence-weighted mean", () => {
    const result = aggregate("weighted", [
      { confidence: 0.75, value: "0" },
      { confidence: 0.25, value: "1" },
    ]);
    expect(result.value).toBeCloseTo(0.25, 12);
  });

  it("is bit-for-bit reproducible on identical input", () => {
    const votes = [
      { confidence: 0.6, value: "0.1" },
      { confidence: 0.9, value: "0.2" },
      { confidence: 0.7, value: "0.3" },
    ] as const;
    const run = () =>
      JSON.stringify([
        aggregate(
          "plurality",
          votes.map((v) => ({ ...v, value: String(v.value) })),
        ),
        aggregate("median", [...votes]),
        aggregate("weighted", [...votes]),
      ]);
    expect(run()).toBe(run());
  });

  it("rejects empty input, non-numeric median/weighted, and zero total weight", () => {
    expect(() => aggregate("plurality", [])).toThrow("at least one vote");
    expect(() => aggregate("median", [{ confidence: 1, value: "yes" }])).toThrow(
      "requires finite numeric values",
    );
    expect(() => aggregate("median", [{ confidence: 1, value: "Infinity" }])).toThrow(
      "requires finite numeric values",
    );
    expect(() =>
      aggregate("weighted", [
        { confidence: -0.5, value: "1" },
        { confidence: 0.5, value: "2" },
      ]),
    ).toThrow("confidences in [0,1]");
    expect(() =>
      aggregate("weighted", [
        { confidence: 0, value: "1" },
        { confidence: 0, value: "2" },
      ]),
    ).toThrow("non-zero total confidence");
  });
});

describe("scoreForecasts", () => {
  it("scores a perfect forecaster at 0 brier and ~0 log score", () => {
    const result = scoreForecasts([
      { confidence: 1, outcome: true },
      { confidence: 0, outcome: false },
    ]);
    expect(result.brier).toBe(0);
    expect(result.logScore).toBeCloseTo(0, 6);
    expect(result.n).toBe(2);
  });

  it("computes brier as mean squared error", () => {
    const result = scoreForecasts([
      { confidence: 0.75, outcome: true },
      { confidence: 0.25, outcome: false },
    ]);
    expect(result.brier).toBeCloseTo(0.0625, 12);
  });

  it("clamps 0/1 forecasts so log score stays finite", () => {
    const result = scoreForecasts([{ confidence: 1, outcome: false }]);
    expect(Number.isFinite(result.logScore)).toBe(true);
    expect(result.logScore).toBeGreaterThan(10);
  });

  it("rejects empty input and out-of-range confidences", () => {
    expect(() => scoreForecasts([])).toThrow("at least one resolved outcome");
    expect(() => scoreForecasts([{ confidence: 1.5, outcome: true }])).toThrow("in [0,1]");
  });
});

describe("evidenceFromCitations", () => {
  const doc = (claimId: string, status: string, url: string) => ({
    citedBy: [
      {
        claimId,
        claimStatus: status,
        locator: "p1",
        statement: `statement ${claimId}`,
        verdict: "supported",
      },
    ],
    fetch: { finalUrl: url, status: "ok" },
    normalized: url,
    title: `title ${claimId}`,
    url,
  });

  it("maps verified and single-source citations to evidence entries", () => {
    const supplied = evidenceFromCitations({
      documents: [
        doc("c001", "verified", "https://a.example/"),
        doc("c002", "single-source", "https://b.example/"),
      ],
      unfetched: [],
    });
    expect(supplied).toHaveLength(2);
    expect(supplied[0]).toMatchObject({
      claimId: "c001",
      evidence: [{ source_or_test: "https://a.example/", supports: "statement c001 (p1)" }],
      excluded: [],
    });
  });

  it("excludes misrepresented and unreachable sources with reasons", () => {
    const supplied = evidenceFromCitations({
      documents: [doc("c001", "misrepresented", "https://a.example/")],
      unfetched: [{ reason: "fetch failed", url: "https://b.example/" }],
    });
    expect(supplied[0]?.evidence).toEqual([]);
    expect(supplied[0]?.excluded).toEqual([
      { reason: "claim status misrepresented: supported", url: "https://a.example/" },
      { reason: "unfetched: fetch failed", url: "https://b.example/" },
    ]);
  });

  it("rejects exports without a documents array", () => {
    expect(() => evidenceFromCitations({})).toThrow("documents array");
  });
});
