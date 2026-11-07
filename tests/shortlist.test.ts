import { describe, expect, it } from "vitest";
import type { AcceptedClaim } from "../src/engine";
import { generatorPrompt, judgePrompt, shortlistDefinition, shortlistFuse } from "../src/shortlist";

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

const optionA = claim("generate", "w-prop-1", { claim: "Option A", claim_id: "w-prop-1:C1" });
const optionB = claim("generate", "w-prop-2", { claim: "Option B", claim_id: "w-prop-2:C1" });
const optionA_dup = claim("generate", "w-prop-3", { claim: "option a", claim_id: "w-prop-3:C1" });

const verdict = (
  workerId: string,
  target: string,
  action: string,
  extra: Record<string, unknown> = {},
) =>
  claim("challenge", workerId, {
    claim: "note",
    claim_id: "C1",
    dependencies: [target],
    requested_action: action,
    ...extra,
  });

describe("shortlist prompts", () => {
  it("generator prompt bans provenance and asks for distinct options", () => {
    const prompt = generatorPrompt("name a launch strategy");
    expect(prompt).toContain("1-3 distinct");
    expect(prompt).toContain("Do NOT include a provenance field");
  });

  it("judge prompt carries rubric, per-option verdict shape, and blindness", () => {
    const prompt = judgePrompt(
      "t",
      "ship cost under 2 weeks",
    )({
      anonymizedClaims: [{ claim_id: "w-prop-1:C1", claim: "Option A" }],
      byWorker: new Map(),
    });
    expect(prompt).toContain("RUBRIC: ship cost under 2 weeks");
    expect(prompt).toContain("hidden from you");
    expect(prompt).toContain("dependencies: [the option's id exactly as listed below]");
    expect(prompt).toContain("w-prop-1:C1");
  });

  it("judge prompt lists an option two proposers filed once, under its first-seen id", () => {
    const prompt = judgePrompt(
      "t",
      "r",
    )({
      anonymizedClaims: [
        { claim_id: "w-prop-1:C1", claim: "Option A" },
        { claim_id: "w-prop-2:C1", claim: "option a" },
        { claim_id: "w-prop-3:C1", claim: "Option B" },
      ],
      byWorker: new Map(),
    });
    expect(prompt).toContain("w-prop-1:C1");
    expect(prompt).not.toContain("w-prop-2:C1");
    expect(prompt).toContain("w-prop-3:C1");
  });
});

describe("shortlistFuse", () => {
  it("advances majority-accept options and ranks them", () => {
    const result = shortlistFuse([
      optionA,
      optionB,
      verdict("w-judge-1", "w-prop-1:C1", "accept", { confidence: 0.9 }),
      verdict("w-judge-2", "w-prop-1:C1", "accept", { confidence: 0.7 }),
      verdict("w-judge-1", "w-prop-2:C1", "abstain"),
      verdict("w-judge-2", "w-prop-2:C1", "accept"),
    ]);
    expect(result.decision["decision"]).toBe("option a");
    const shortlist = result.decision["shortlist"] as { canonical: string }[];
    expect(shortlist).toHaveLength(1);
    const dropped = result.decision["dropped"] as { canonical: string; reason: string }[];
    expect(dropped).toEqual([
      { canonical: "option b", reason: "dropped (abstain majority)", tally: expect.anything() },
    ]);
  });

  it("merges duplicate options across proposers and folds their verdicts", () => {
    const result = shortlistFuse([
      optionA,
      optionA_dup,
      optionB,
      verdict("w-judge-1", "w-prop-1:C1", "accept"),
      verdict("w-judge-2", "w-prop-3:C1", "accept", { confidence: 0.6 }),
    ]);
    const shortlist = result.decision["shortlist"] as {
      canonical: string;
      tally: { accepts: number };
    }[];
    expect(shortlist).toHaveLength(1);
    expect(shortlist[0]?.canonical).toBe("option a");
    expect(shortlist[0]?.tally.accepts).toBe(2);
    expect(result.decision["unscored"]).toEqual(["option b"]);
    expect(result.decision["residualRisks"]).toEqual([
      { canonical: "option b", reason: "unscored by any judge" },
    ]);
  });

  it("a judge counts once per option, whichever copies it cited", () => {
    const result = shortlistFuse([
      optionA,
      optionA_dup,
      optionB,
      verdict("w-judge-1", "w-prop-1:C1", "accept"),
      claim("challenge", "w-judge-1", {
        claim: "note",
        claim_id: "C2",
        dependencies: ["w-prop-3:C1"],
        requested_action: "accept",
      }),
      verdict("w-judge-1", "w-prop-2:C1", "accept", { confidence: 1 }),
      verdict("w-judge-2", "w-prop-2:C1", "accept", { confidence: 1 }),
    ]);
    const shortlist = result.decision["shortlist"] as {
      canonical: string;
      tally: { accepts: number };
    }[];
    expect(shortlist.map((s) => [s.canonical, s.tally.accepts])).toEqual([
      ["option b", 2],
      ["option a", 1],
    ]);
  });

  it("a tie is not a majority: the option drops to needs-revision", () => {
    const result = shortlistFuse([
      optionA,
      verdict("w-judge-1", "w-prop-1:C1", "accept"),
      verdict("w-judge-2", "w-prop-1:C1", "revise"),
    ]);
    expect(result.decision["shortlist"]).toEqual([]);
    expect(result.decision["decision"]).toBeNull();
    expect((result.decision["dropped"] as { reason: string }[])[0]?.reason).toBe("needs revision");
  });
});

describe("shortlist definition", () => {
  it("builds proposers and judges with the rubric frozen in the registration", () => {
    const build = shortlistDefinition.build({
      generators: "3",
      harness: "pi",
      judges: "2",
      rubric: "two-week cost",
      task: "pick a launch strategy",
      timeout: "60",
    });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    expect(build.workers).toHaveLength(3);
    expect(build.workers[0]?.workerId).toBe("w-prop-1");
    expect(build.rubric).toBe("two-week cost");
    const challenge = build.stages?.challenge;
    expect(challenge).toBeDefined();
    if (challenge === undefined) {
      return;
    }
    const wave = challenge({ anonymizedClaims: [], byWorker: new Map() });
    expect(wave).toHaveLength(2);
    expect(wave?.[0]?.workerId).toBe("w-judge-1");
    expect(wave?.[0]?.prompt).toContain("RUBRIC: two-week cost");
  });

  it("judges cover the listed representatives only, not every proposer's copy", () => {
    const build = shortlistDefinition.build({ rubric: "r", task: "t" });
    expect("error" in build).toBe(false);
    if ("error" in build) {
      return;
    }
    const accepted = [optionA, optionA_dup, optionB];
    const job = {
      jobId: "challenge:w-judge-1",
      prompt: "p",
      stage: "challenge",
      timeoutSec: 1,
      workerId: "w-judge-1",
    } as const;
    const covering = [
      verdict("w-judge-1", "w-prop-1:C1", "accept").claim,
      { ...verdict("w-judge-1", "w-prop-2:C1", "accept").claim, claim_id: "C2" },
    ];
    expect(build.validateSubmission(job, covering, accepted)).toEqual([]);
    const citingTheCopy = [
      verdict("w-judge-1", "w-prop-3:C1", "accept").claim,
      { ...verdict("w-judge-1", "w-prop-2:C1", "accept").claim, claim_id: "C2" },
    ];
    const errors = build.validateSubmission(job, citingTheCopy, accepted);
    expect(errors.some((e) => e.includes("w-prop-3:C1 is not a target"))).toBe(true);
    expect(errors.some((e) => e.includes("missing verdict for target w-prop-1:C1"))).toBe(true);
  });

  it("rejects missing rubric and undersized panels", () => {
    expect(
      shortlistDefinition.build({
        generators: "2",
        harness: "pi",
        judges: "2",
        task: "t",
        timeout: "60",
      }),
    ).toEqual({ error: "--task and --rubric must be non-empty" });
    expect(
      shortlistDefinition.build({
        generators: "2",
        harness: "pi",
        judges: "1",
        rubric: "r",
        task: "t",
        timeout: "60",
      }),
    ).toEqual({ error: "--judges must be an integer >= 2" });
  });
});
