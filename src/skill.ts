/**
 * Caller instructions for the fusion CLI. The binary is the single source
 * of truth (RFC-01: `fusion skill`): the enum vocabulary below is derived
 * from the validator's own exports, so the text and the behavior cannot
 * disagree about the schema.
 */
import { CLAIM_KINDS, CLAIM_STATUSES, NOVELTIES, REQUESTED_ACTIONS } from "./claim";

const join = (values: readonly string[]): string => [...values].sort().join("|");

export const SKILL_TEXT = `fusion - a composable fusion layer over agent harnesses.

fusion is NOT a harness. A harness owns an agent's loop (context, tools,
permissions). fusion composes runs of harnesses. You - the calling
harness - execute the worker jobs with your own delegation tools;
fusion never launches a process (ADR-0003).

Choosing a method - match the problem shape, not the habit:
  - One bounded question, and one model's answer is not trusted on its
    own (anchoring, herding, prior bias) -> jury. Sealed workers answer
    independently; mechanical plurality fuses. Do NOT use jury for open
    generation (there is no comparable answer to vote on) or when you
    already hold sealed judgments - pipe normalize | aggregate instead.
  - A ship/block decision on one artifact, where one dissenter with
    evidence must be able to stop it -> gonogo. Independent reviewers
    return GO, GO WITH CONSTRAINT, or NO-GO; the veto rule is mechanical:
    any NO-GO blocks, no outvoting. Do NOT use it when you want the
    majority view on an open question -> jury; or when claims must
    survive adversarial attack -> red-blue.
  - An open-ended problem with many possible answers, and you need a
    ranked few -> shortlist. Sealed proposers generate options; blind
    judges score every option against a rubric you state; the tool
    tallies mechanically. Do NOT use it when the answer space is bounded
    enough to vote on -> jury; or when one option must survive adversarial
    attack -> red-blue.
  - A bounded question where independent answers help AND one round of
    peer exposure should improve them (estimation, forecast-style panels)
    -> delphi. Sealed round 1, anonymized revision round 2, mechanical
    convergence vs stability signals. Do NOT use it when anchoring is the
    main risk and any exposure would herd the panel -> jury instead; and
    not with more than one revision round in mind.
  - A claim set whose failure costs more than challenging it, and you
    can state the standard up front -> red-blue. It buys objection-only
    challenge and fact resolution with executable checks. A judge assesses
    claims and objections against your burden without harness, model or session
    metadata; role IDs remain visible. Do NOT use it when nobody
    can state the burden - the judge cannot score an unstated standard.
  - An observed outcome with several plausible causes -> ach. It forces
    every hypothesis against every evidence item and shows which
    evidence discriminates. Do NOT use it to choose between proposals -
    ach explains, it does not rank options.
  - You already hold claims or sealed votes and only want mechanical
    work (schema checks, dedup, vote/median, calibration scoring) ->
    tier 1 directly. A pattern run adds a delegation loop you do not need.
  - One deep pass by one model is enough -> do not call fusion at all;
    run that harness. fusion spends N workers to buy independence - pay
    it only when independence is the missing ingredient.
  - Secret material in the task or claims -> route every worker job to
    a local model (see the privacy rule below); never route it to a
    hosted model through fusion.

Tier 1 (model-free, deterministic, pipe freely - JSON in, JSON out):
  fusion validate [--json] <claims.jsonl>  Validate a JSONL stream of claims
    against the claim schema. Per-claim accept/reject verdicts; rejected
    claims are E201 lines. Exit 0 all valid, 2 any rejected.
  fusion normalize [file]  Group claims by exact match on canonicalized
    text (Unicode NFC, whitespace, casing, number formats). Reads a JSON
    array of {claim_id, claim} from FILE or stdin; prints groups with
    member claim_ids. Near-misses stay separate: no semantic dedup here.
  fusion aggregate [file]  Fuse sealed votes mechanically - plurality,
    median, or confidence-weighted mean. Reads {method, votes:
    [{value, confidence}]} from FILE or stdin. Bit-for-bit reproducible.
  fusion score [file]  Proper scoring rules (Brier, log) over resolved
    outcomes. Reads [{confidence, outcome}] from FILE or stdin. Lower
    is better for both. Score seed questions with known answers to
    calibrate before trusting confidences.
  fusion evidence [file]  Convert a dr citations export (dr citations
    --json) into per-claim evidence blocks for claim evidence[] fields.
    Verified and single-source citations become entries; excluded
    sources carry reasons, never silent drops.

Composition recipes:
  Validate claims, then map accepted claims into normalize's JSON array.
  Map normalized group membership into aggregate's {method, votes}
    schema to compute a vote or median without a model. Each command
    has its own envelope and input schema; direct shell pipes need an
    explicit transformation between them.

Tier 2 (pattern runs - fusion owns the method, you own the delegation):
  fusion jury --task <t> [--workers N] [--vocabulary a,b] [--roster h[:m]] [--merge] [--json]
  fusion red-blue --task <t> --burden <b> [--evidence f] [--json]
  fusion gonogo --task <t> [--reviewers N] [--json]
  fusion shortlist --task <t> --rubric <r> [--generators N] [--judges M] [--json]
  fusion delphi --task <t> [--workers N] [--vocabulary a,b] [--json]
  fusion ach --task <t> [--workers N] [--evidence f] [--json]
    All methods accept --harness, --model, --roster and --timeout as
    advisory hints. Repeat --roster once per worker when using it.
    Jury uses one answer per juror and plurality. Delphi uses one answer
    per worker in each of two rounds, with the same vocabulary in both.
    Go/no-go positions use requested_action: accept=GO, test=GO WITH
    CONSTRAINT, escalate=NO-GO, abstain=NO-GO unverifiable; any NO-GO
    blocks. Missing action is abstain, never GO.
    Red-blue roles submit claims, objections, evidence rulings, then
    an answer assessment. Umpire accept sustains an objection; revise
    overrules it; test is inconclusive. Umpire and judge share a wave,
    so the judge sees claims and objections, not umpire rulings.
    Shortlist judges each option against the stated rubric; an option
    advances only on a strict majority of accept verdicts. ACH builds
    the hypotheses/evidence matrix from dependencies and novelty:
    confirms means consistent, contradicts means inconsistent.
    A pattern command STARTS a run: it freezes the registration
    (.fusion/runs/<runId>/run.json, evidence content snapshotted) and
    exits 0 with status "pending" and the first wave of jobs. Each job
    carries jobId (stage:worker, e.g. generate:w1), workerId, stage,
    the FULL worker prompt, an advisory timeoutSec, and optional
    harness/model hints you may honor or override - you choose how to
    delegate each job with your own tools.
    Give each worker ONLY its job prompt. Jobs of a later wave are
    issued only after every job of the current wave has a terminal
    submission; stage prompts omit harness/model/session provenance.
    Worker slots and role names remain visible in claim reference IDs.
    Definition order, not submission order, drives all tie-breaking.
  fusion submit --run <id> --job <jobId> [file] [--json]
    Submit one job's result (file or stdin), one JSON object, strict:
    - success: {"claims":[<claim objects>],"identity":{"harness":
      "<actual harness>","model":"<actual model or unknown>","sessionId":
      "<opaque invocation/session id>"}} - identity is YOUR report of
      what ran; fusion stamps it into provenance marked caller-reported.
      At least one claim; submit a failure instead of an empty success.
    - failure: {"failure":{"class":"<non-empty failure label>",
      "detail":"optional"}} - the worker did not produce usable claims;
      the run continues while survivors remain.
    Role-specific actions and target references are required where the
    worker brief specifies them. Shortlist judges score every listed option
    exactly once. Umpire rulings cover every objection exactly once; merge
    clusters partition the listed answer IDs. Malformed or incomplete role
    outputs remain pending with E201 so you can correct and resubmit.
    Failure labels include timeout and provider-unavailable; other
    non-empty labels are accepted as caller-reported failure classes.
    On success fusion validates every claim and its method role at the boundary (E201 lines
    name the field; correct and resubmit the SAME job - nothing was
    committed), remaps claim ids to run scope (<worker>:Cn), stamps
    provenance, and returns the run's remaining jobs or, when the last
    wave completes, the decision. Replays of an already-submitted job
    and submissions to a terminal run are rejected (E204). A run locked
    by another fusion command returns E304 - retry. Fusion never steals
    a lock: if the holder is gone (killed mid-command), inspect
    .fusion/runs/<runId>/lock yourself and remove it explicitly.
  fusion status --run <id> [--json]
    Reload the run across invocations: pending jobs (full briefs) or the
    terminal decision. Never advances the run.
  fusion abort --run <id> --reason <text> [--json]
    Record a failed terminal decision with your reason; partial events
    are retained. Use it when a worker is lost or the task is moot.
  Run artifacts: .fusion/runs/<runId>/ - run.json (frozen registration
    with format marker; runs from the hcn-executed era are rejected with
    a usage error), state.json (mutable progress, replaced atomically),
    events.ndjson (append-only audit), decision.json (terminal record).
    Mutations serialize behind an exclusive per-run lock.

What a pattern run guarantees - and what it does not:
  - Guaranteed: the registration is frozen before any job is issued;
    every submission is schema-validated at the boundary; stage barriers
    and anonymized stage inputs are enforced by fusion; fusion is the
    only stamper of provenance; the decision is mechanical - no model in
    the fusion loop; records are durable and replayable.
  - NOT guaranteed: fusion launches nothing and watches nothing, so
    worker isolation is caller-enforced and harness/model/session
    identity is caller-reported - fusion cannot verify either. Decision
    and status records say so (provenanceLimits); do not describe a
    fusion decision as independently verified. A failed worker is a
    typed failure in the record, never a crash; if every generation job
    fails, the run records a failed decision.

Claim schema (one flat schema for all patterns):
  Required: claim_id (C-number, e.g. C1), kind
    (${join(CLAIM_KINDS)}), claim (non-empty),
    status (${join(CLAIM_STATUSES)}), confidence (number
    in [0,1]), falsifier (non-empty - what result would change this claim).
  Optional: evidence[] (source_or_test + supports), assumptions[],
    dependencies[] (C-number refs to the worker's own claims, or
    worker-scoped refs like w-red:C1 to record claims you were shown),
    novelty (${join(NOVELTIES)}), requested_action
    (${join(REQUESTED_ACTIONS)}).
  Unknown fields are rejected, not ignored. \`provenance\` is the ONLY
  tool-stamped block (runId, workerId, harness, model, sessionId,
  stampedAt, source: caller-reported): the validator rejects any claim
  where the worker set it.

Error handling and exit contract (ADR-0002):
  Every command emits {ok, run, step, errors[]} (machine-shaped with
  --json; without, human output plus E-code error lines) and exits by
  class: 0 ok, 1 usage, 2 validation/gate, 3 nothing takeable,
  4 internal. E-codes name class and field, e.g.
  E201: claims: C3.confidence: Invalid input. Crashes surface as E499
  envelopes (exit 4), never as usage errors. Every invocation
  appends start/end lines to .fusion/commands.jsonl; a start with no end
  is a hung or killed invocation.

What counts as a bug - file only these, nothing else:
  - E4xx or E499, a stack trace, or an exit code contradicting the
    envelope: capture the command line, the envelope, the last 20 lines
    of .fusion/commands.jsonl, and matching run artifacts; search the
    repo's open issues for the E-code plus the first error line first -
    a hit means add your evidence as a comment, not a new issue; then
    file with gh issue create --label auto.
  - E1xx (your invocation), E2xx (a gate doing its job), E3xx (nothing
    takeable) are NOT bugs: fix the invocation or the input. Fix
    guidance: E101/E106 argument errors - re-read the command help;
    E103/E104 unreadable or malformed input - fix the input; E201 claim
    schema rejections - the error line names the field, correct and
    resubmit the same job; E204 a gate rejected the submission
    (already-submitted job, terminal run); a run whose every generation
    job failed reports status "failed" with its decision payload -
    check the failure classes in the run's events.ndjson and rerun;
    E302 nothing on input; E304 run busy - another fusion command
    holds the lock, retry; if the holder is truly gone you may remove
    the stale lock file (.fusion/runs/<runId>/lock) yourself - fusion
    never steals it. Repeat --roster per worker for mixed hints;
    secret material routes to local-only models in every delegation.

Rules that bind every caller:
  - Never call the tool a harness. That word means loop-owners
    (claude, codex, pi, muse, cursor, antigravity).
  - Justfiles parameterize pattern invocations; they never define patterns.
  - Privacy: work that puts secret material into model context runs on
    local models only. You choose the routing, so routing secret
    material to a hosted model through a fusion run is a caller error.
`;
