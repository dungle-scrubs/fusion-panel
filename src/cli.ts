#!/usr/bin/env node
/**
 * fusion CLI entrypoint (RFC-01; envelope and exit contract per ADR-0002;
 * caller-managed delegation per ADR-0003). Pattern commands start runs and
 * hand worker jobs to the calling harness, which executes them with its own
 * delegation tools and submits structured results. Every command emits an
 * {ok, run, step, errors[]} envelope - machine shaped with --json, human
 * text plus error lines without - and exits by class: 0 ok, 1 usage,
 * 2 validation/gate, 3 nothing takeable, 4 internal. Each invocation
 * appends start/end lines to .fusion/commands.jsonl; a start with no end
 * is a hung-or-killed trace.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { Command, CommanderError } from "commander";
import { achDefinition } from "./ach";
import { type ClaimVerdict, validateClaim } from "./claim";
import { delphiDefinition } from "./delphi";
import {
  abortRun,
  type Job,
  type PatternRebuild,
  type RunView,
  startRun,
  statusOfRun,
  submitToRun,
} from "./engine";
import {
  appendCommandRecord,
  commandRecordPath,
  type Envelope,
  type EnvelopeError,
  EXIT_HELP_TEXT,
  EXIT_OK,
  endRecord,
  envelopeFail,
  envelopeOk,
  exitCodeForErrors,
  installCrashHandlers,
  newRunId,
  printEnvelope,
  reportCrash,
  startRecord,
} from "./envelope";
import { gonogoDefinition } from "./gonogo";
import { juryDefinition } from "./jury";
import {
  type PatternDefinition,
  type PatternIo,
  type PatternOptions,
  toRegistration,
} from "./pattern";
import { redblueDefinition } from "./redblue";
import { PROVENANCE_LIMITS, type RunRegistration } from "./run";
import { shortlistDefinition } from "./shortlist";
import { SKILL_TEXT } from "./skill";
import {
  type AggregateMethod,
  aggregate,
  type DrCitations,
  evidenceFromCitations,
  normalizeClaims,
  scoreForecasts,
} from "./tier1";

const VERSION = "0.2.2"; // x-release-please-version

interface ResolvedRun {
  run: string;
  step: string;
}

let resolved: ResolvedRun | null = null;
const COMMAND_RECORD = commandRecordPath(process.cwd());
const CRASH_OPTIONS = {
  command: process.argv[2] ?? "fusion",
  recordPath: COMMAND_RECORD,
  runResolver: () => resolved,
};
installCrashHandlers(CRASH_OPTIONS);

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    stdin.on("end", () => resolve(data));
    stdin.on("error", (error: Error) => reject(error));
  });
}

async function readInput(file: string | undefined): Promise<string> {
  if (file !== undefined) {
    return readFileSync(file, "utf8");
  }
  return readStdin();
}

/**
 * One command's lifecycle: durable start line, work, envelope, durable
 * end line, exit code by error class. Never process.exit - the runtime
 * flushes stdout.
 */
async function runCommand(
  command: string,
  json: boolean,
  work: (run: string) => Promise<{ envelope: Envelope; payload?: Record<string, unknown> }>,
): Promise<void> {
  const run = newRunId();
  resolved = { run, step: command };
  appendCommandRecord(COMMAND_RECORD, startRecord(command, run));
  let envelope: Envelope;
  let payload: Record<string, unknown> | undefined;
  try {
    const outcome = await work(run);
    envelope = outcome.envelope;
    payload = outcome.payload;
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    envelope = envelopeFail(run, command, [{ code: "E499", detail }]);
  }
  if (envelope.ok && payload !== undefined) {
    if (json) {
      stdout.write(`${JSON.stringify({ ...envelope, ...payload })}\n`);
    } else {
      const lines = payload["lines"] as readonly string[] | undefined;
      if (lines !== undefined) {
        for (const line of lines) {
          stdout.write(`${line}\n`);
        }
      }
    }
  } else {
    printEnvelope(envelope, json);
  }
  appendCommandRecord(COMMAND_RECORD, endRecord(command, run, envelope));
  process.exitCode = envelope.ok ? EXIT_OK : exitCodeForErrors(envelope.errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaimArray(text: string): { claim: string; claim_id: string }[] {
  const parsed: unknown = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("normalize expects a JSON array of {claim_id, claim} objects");
  }
  return parsed.map((entry: unknown, index: number) => {
    if (
      !isRecord(entry) ||
      typeof entry["claim_id"] !== "string" ||
      typeof entry["claim"] !== "string"
    ) {
      throw new Error(`normalize entry ${index} must have string claim_id and claim`);
    }
    return { claim: entry["claim"], claim_id: entry["claim_id"] };
  });
}

const AGGREGATE_METHODS: readonly AggregateMethod[] = ["median", "plurality", "weighted"];

function parseAggregateInput(text: string): {
  method: AggregateMethod;
  votes: { confidence: number; value: string }[];
} {
  const parsed: unknown = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("aggregate expects a JSON object {method, votes}");
  }
  const method: unknown = parsed["method"];
  if (typeof method !== "string" || !AGGREGATE_METHODS.includes(method as AggregateMethod)) {
    throw new Error("aggregate method must be one of median|plurality|weighted");
  }
  const votes: unknown = parsed["votes"];
  if (!Array.isArray(votes)) {
    throw new Error("aggregate expects votes to be an array of {value, confidence}");
  }
  const typed = votes.map((entry: unknown, index: number) => {
    if (
      !isRecord(entry) ||
      typeof entry["value"] !== "string" ||
      typeof entry["confidence"] !== "number"
    ) {
      throw new Error(`aggregate vote ${index} must have string value and numeric confidence`);
    }
    return { confidence: entry["confidence"], value: entry["value"] };
  });
  return { method: method as AggregateMethod, votes: typed };
}

function parseOutcomeArray(text: string): { confidence: number; outcome: boolean }[] {
  const parsed: unknown = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("score expects a JSON array of {confidence, outcome} objects");
  }
  return parsed.map((entry: unknown, index: number) => {
    if (
      !isRecord(entry) ||
      typeof entry["confidence"] !== "number" ||
      typeof entry["outcome"] !== "boolean"
    ) {
      throw new Error(`score outcome ${index} must have numeric confidence and boolean outcome`);
    }
    return { confidence: entry["confidence"], outcome: entry["outcome"] };
  });
}

function emitParserError(error: unknown): void {
  const raw = process.argv[2];
  const command = raw === undefined || raw.startsWith("-") ? "fusion" : raw;
  const detail =
    error instanceof CommanderError && error.code === "commander.help"
      ? "a fusion command is required; run fusion --help"
      : error instanceof Error
        ? error.message
        : String(error);
  const run = newRunId();
  resolved = { run, step: "argv" };
  appendCommandRecord(COMMAND_RECORD, startRecord(command, run));
  const envelope = envelopeFail(run, "argv", [{ code: "E106", detail }]);
  printEnvelope(envelope, process.argv.includes("--json"));
  appendCommandRecord(COMMAND_RECORD, endRecord(command, run, envelope));
  process.exitCode = exitCodeForErrors(envelope.errors);
}

/**
 * One parser-error surface for every command (ADR-0002): commander's
 * usage errors - unknown command, unknown option, missing required
 * flags, a bare invocation - route through the standard E106 envelope,
 * machine-shaped with --json. Explicit help and version keep
 * commander's own exit 0 (the override returns and commander exits
 * after its synchronous help/version output).
 */
function ownParserErrors(program: Command): void {
  const override = (error: CommanderError): void => {
    if (
      error.code === "commander.version" ||
      error.code === "commander.helpDisplayed" ||
      (error.code === "commander.help" && error.exitCode === 0)
    ) {
      return;
    }
    emitParserError(error);
  };
  const output = { writeErr: () => {}, writeOut: (str: string) => stdout.write(str) };
  program.exitOverride(override).configureOutput(output);
  for (const command of program.commands) {
    command.exitOverride(override).configureOutput(output);
  }
}

const program = new Command();
program
  .name("fusion")
  .description("A composable fusion layer over agent harnesses.")
  .version(VERSION);

program
  .command("validate")
  .description("Validate a JSONL stream of claims against the claim schema. " + EXIT_HELP_TEXT)
  .argument("[file]", "JSONL file of claims; reads stdin when omitted")
  .option("--json", "emit the machine-shaped envelope with per-claim verdicts")
  .action(async (file: string | undefined, options: { json: boolean }) => {
    await runCommand("validate", options.json, async (run) => {
      let text: string;
      try {
        text = await readInput(file);
      } catch (error) {
        return {
          envelope: envelopeFail(run, "input", [
            {
              code: "E103",
              detail: `cannot read input: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]),
        };
      }
      const lines = text.split("\n").filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        return {
          envelope: envelopeFail(run, "input", [{ code: "E302", detail: "no claims on input" }]),
        };
      }
      const errors: EnvelopeError[] = [];
      const verdicts: Record<string, unknown>[] = [];
      lines.forEach((line, index) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch {
          errors.push({ code: "E104", detail: `line ${index + 1}: not valid JSON` });
          return;
        }
        const verdict: ClaimVerdict = validateClaim(parsed);
        if (!verdict.valid) {
          errors.push({
            code: "E201",
            detail: `claims: ${verdict.claim_id}: ${verdict.errors.join("; ")}`,
          });
        }
        verdicts.push({ claim_id: verdict.claim_id, errors: verdict.errors, valid: verdict.valid });
      });
      return {
        envelope: errors.length === 0 ? envelopeOk(run) : envelopeFail(run, "claims", errors),
        payload: { verdicts },
      };
    });
  });

async function runJsonTier1<TInput>(
  command: string,
  json: boolean,
  file: string | undefined,
  parse: (text: string) => TInput,
  execute: (input: TInput) => { result: Record<string, unknown>; lines: readonly string[] },
): Promise<void> {
  await runCommand(command, json, async (run) => {
    let text: string;
    try {
      text = await readInput(file);
    } catch (error) {
      return {
        envelope: envelopeFail(run, "input", [
          {
            code: "E103",
            detail: `cannot read input: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]),
      };
    }
    let input: TInput;
    try {
      input = parse(text);
    } catch (error) {
      return {
        envelope: envelopeFail(run, "input", [
          {
            code: "E104",
            detail: error instanceof Error ? error.message : String(error),
          },
        ]),
      };
    }
    try {
      const { result, lines } = execute(input);
      return { envelope: envelopeOk(run), payload: { lines, result } };
    } catch (error) {
      return {
        envelope: envelopeFail(run, command, [
          {
            code: command === "aggregate" ? "E202" : "E203",
            detail: error instanceof Error ? error.message : String(error),
          },
        ]),
      };
    }
  });
}

program
  .command("normalize")
  .description(
    "Group claims by exact match on canonicalized text (NFC, whitespace, casing, number formats). " +
      EXIT_HELP_TEXT,
  )
  .argument("[file]", "JSON file of claims; reads stdin when omitted")
  .option("--json", "emit the machine-shaped envelope")
  .action(async (file: string | undefined, options: { json: boolean }) => {
    await runJsonTier1("normalize", options.json, file, parseClaimArray, (claims) => {
      const groups = normalizeClaims(claims);
      return {
        lines: groups.map((g) => `${g.members.join(", ")} -> ${g.canonical}`),
        result: { groups },
      };
    });
  });

program
  .command("aggregate")
  .description(
    "Fuse sealed votes mechanically: plurality, median, or confidence-weighted mean. " +
      EXIT_HELP_TEXT,
  )
  .argument("[file]", "JSON file with method and votes; reads stdin when omitted")
  .option("--json", "emit the machine-shaped envelope")
  .action(async (file: string | undefined, options: { json: boolean }) => {
    await runJsonTier1("aggregate", options.json, file, parseAggregateInput, (input) => {
      const result = aggregate(input.method, input.votes) as unknown as Record<string, unknown>;
      return { lines: [JSON.stringify(result)], result };
    });
  });

function parseCitationsExport(text: string): DrCitations {
  const parsed: unknown = JSON.parse(text) as unknown;
  const root =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const data =
    typeof root["data"] === "object" && root["data"] !== null
      ? (root["data"] as Record<string, unknown>)
      : {};
  const citations =
    typeof data["citations"] === "object" && data["citations"] !== null
      ? (data["citations"] as Record<string, unknown>)
      : root;
  return {
    ...(Array.isArray(citations["documents"]) ? { documents: citations["documents"] } : {}),
    ...(Array.isArray(citations["unfetched"]) ? { unfetched: citations["unfetched"] } : {}),
  };
}

program
  .command("score")
  .description("Proper scoring rules (Brier, log) over resolved outcomes. " + EXIT_HELP_TEXT)
  .argument("[file]", "JSON file of resolved outcomes; reads stdin when omitted")
  .option("--json", "emit the machine-shaped envelope")
  .action(async (file: string | undefined, options: { json: boolean }) => {
    await runJsonTier1("score", options.json, file, parseOutcomeArray, (outcomes) => {
      const result = scoreForecasts(outcomes) as unknown as Record<string, unknown>;
      return { lines: [JSON.stringify(result)], result };
    });
  });

program
  .command("evidence")
  .description(
    "Convert a dr citations export into per-claim evidence blocks for claim evidence[] fields. " +
      EXIT_HELP_TEXT,
  )
  .argument("[file]", "dr citations JSON (dr citations --json); reads stdin when omitted")
  .option("--json", "emit the machine-shaped envelope")
  .action(async (file: string | undefined, options: { json: boolean }) => {
    await runJsonTier1("evidence", options.json, file, parseCitationsExport, (input) => {
      const supplied = evidenceFromCitations(input) as unknown as Record<string, unknown>[];
      const lines = supplied.map((s) => {
        const record = s as {
          claimId: string;
          evidence: { source_or_test: string }[];
          excluded: { reason: string }[];
        };
        return `${record.claimId}: ${record.evidence.length} sources, ${record.excluded.length} excluded`;
      });
      return { lines, result: { supplied } };
    });
  });

const PATTERNS: readonly PatternDefinition[] = [
  juryDefinition,
  redblueDefinition,
  achDefinition,
  delphiDefinition,
  shortlistDefinition,
  gonogoDefinition,
];

/**
 * Read the evidence file once so the run freezes exactly the content the
 * build consumed (ADR-0003: later stages never depend on a mutable
 * external file).
 */
function snapshotEvidence(
  options: PatternOptions,
): { error: string } | { snapshot?: { path: string; content: string } } {
  const raw = options["evidence"];
  if (raw === undefined) {
    return {};
  }
  const path = String(raw);
  if (path.trim().length === 0) {
    return { error: "--evidence requires a file path" };
  }
  try {
    return { snapshot: { content: readFileSync(path, "utf8"), path } };
  } catch (error) {
    return {
      error: `--evidence cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function ioOfSnapshot(
  snapshot: { path: string; content: string } | undefined,
): PatternIo | undefined {
  if (snapshot === undefined) {
    return undefined;
  }
  return { readEvidence: () => snapshot.content };
}

/** Rebuild a run's pattern stages from the frozen registration. */
function rebuildFromRegistration(reg: RunRegistration): ReturnType<PatternRebuild> {
  const definition = PATTERNS.find((d) => d.command === reg.pattern);
  if (definition === undefined) {
    return { error: `unknown pattern "${reg.pattern}" in run record` };
  }
  const built = definition.build(reg.patternOptions ?? {}, ioOfSnapshot(reg.evidenceSnapshot));
  if ("error" in built) {
    return { error: built.error };
  }
  return {
    ...(built.stages !== undefined ? { stages: built.stages } : {}),
    validateSubmission: built.validateSubmission,
    fuse: built.fuse,
  };
}

function jobBriefLine(job: Job): string {
  return `job      ${JSON.stringify(job)}`;
}

function pendingLines(view: RunView): readonly string[] {
  const jobs = view.jobs ?? [];
  const lines = [
    `run      ${view.runId} (${view.runDir})`,
    "status   pending",
    `isolation ${PROVENANCE_LIMITS.isolation}`,
    `identity  ${PROVENANCE_LIMITS.identity}`,
    `submit    fusion submit --run ${view.runId} --job <jobId> <submission.json> (or stdin)`,
    `jobs      ${jobs.length} pending`,
  ];
  for (const job of jobs) {
    lines.push(jobBriefLine(job));
  }
  return lines;
}

function terminalLines(view: RunView): readonly string[] {
  const decision = view.decision ?? {};
  const lines = [
    `run      ${view.runId} (${view.runDir})`,
    `status   ${view.status}`,
    `cause    ${String(decision["cause"] ?? "(none)")}`,
  ];
  if (typeof decision["reason"] === "string") {
    lines.push(`reason   ${decision["reason"]}`);
  }
  const patternName = decision["pattern"];
  const definition =
    typeof patternName === "string" ? PATTERNS.find((d) => d.command === patternName) : undefined;
  if (definition !== undefined && decision["cause"] === "clean") {
    lines.push(
      ...definition.summarize(decision, {
        cause: "clean",
        decision,
        runDir: view.runDir,
        runId: view.runId,
      }),
    );
  } else {
    const failures = decision["failures"] as { class: string; workerId: string }[] | undefined;
    if ((failures?.length ?? 0) > 0) {
      lines.push(`failures ${JSON.stringify(failures)}`);
    }
    if (typeof decision["note"] === "string") {
      lines.push(`note     ${decision["note"]}`);
    }
  }
  lines.push(`isolation ${PROVENANCE_LIMITS.isolation}`, `identity  ${PROVENANCE_LIMITS.identity}`);
  return lines;
}

function viewPayload(view: RunView): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    limitations: PROVENANCE_LIMITS,
    lines: view.status === "pending" ? pendingLines(view) : terminalLines(view),
    runDir: view.runDir,
    runId: view.runId,
    status: view.status,
  };
  if (view.status === "pending") {
    payload.jobs = view.jobs ?? [];
  } else {
    payload.decision = view.decision ?? {};
  }
  return payload;
}

function viewOfErrors(
  run: string,
  step: string,
  errors: readonly { code: string; detail: string }[],
): {
  envelope: Envelope;
} {
  return { envelope: envelopeFail(run, step, errors) };
}

for (const definition of PATTERNS) {
  const command = program
    .command(definition.command)
    .description(`${definition.description} ${EXIT_HELP_TEXT}`)
    .option("--json", "emit the machine-shaped envelope with the run handoff");
  for (const spec of definition.options) {
    if (spec.flag === "boolean") {
      command.option(`--${spec.name}`, spec.description);
      continue;
    }
    const flag = `--${spec.name} <${spec.name}>`;
    if (spec.name === "roster") {
      command.option(flag, spec.description, (value: string, previous: string | undefined) =>
        previous === undefined ? value : `${previous},${value}`,
      );
    } else if (spec.required === true) {
      command.requiredOption(flag, spec.description);
    } else if (spec.default !== undefined) {
      command.option(flag, spec.description, spec.default);
    } else {
      command.option(flag, spec.description);
    }
  }
  command.action(async (options: PatternOptions) => {
    await runCommand(definition.command, options["json"] === true, async (run) => {
      const evidenced = snapshotEvidence(options);
      if ("error" in evidenced) {
        return viewOfErrors(run, "build", [{ code: "E102", detail: evidenced.error }]);
      }
      const snapshot = evidenced.snapshot;
      const build = definition.build(options, ioOfSnapshot(snapshot));
      if ("error" in build) {
        return viewOfErrors(run, "build", [{ code: "E102", detail: build.error }]);
      }
      resolved = { run, step: "startRun" };
      const patternRunId = `r${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const registration = toRegistration(build, definition.command, {
        ...(snapshot !== undefined ? { evidenceSnapshot: snapshot } : {}),
        now: () => new Date().toISOString(),
        patternOptions: { ...options },
        runId: patternRunId,
      });
      const started = startRun(registration, { repoRoot: process.cwd() });
      if ("error" in started) {
        return viewOfErrors(run, "startRun", [started.error]);
      }
      return { envelope: envelopeOk(run), payload: viewPayload(started.view) };
    });
  });
}

program
  .command("submit")
  .description(
    "Submit one worker job result: a success {claims, identity} or a failure {failure}. " +
      "Returns the run's remaining jobs or its decision. " +
      EXIT_HELP_TEXT,
  )
  .requiredOption("--run <runId>", "panel run id (r........)")
  .requiredOption("--job <jobId>", "job id from the run handoff (e.g. generate:w1)")
  .argument("[file]", "submission JSON file; reads stdin when omitted")
  .option("--json", "emit the machine-shaped envelope with the run handoff")
  .action(
    async (file: string | undefined, options: { run: string; job: string; json?: boolean }) => {
      await runCommand("submit", options.json === true, async (run) => {
        let text: string;
        try {
          text = await readInput(file);
        } catch (error) {
          return viewOfErrors(run, "input", [
            {
              code: "E103",
              detail: `cannot read input: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        }
        resolved = { run, step: "submit" };
        const outcome = submitToRun(process.cwd(), options.run, options.job, text, {
          rebuild: rebuildFromRegistration,
          repoRoot: process.cwd(),
        });
        if (outcome.errors !== undefined) {
          return viewOfErrors(run, "submit", outcome.errors);
        }
        if (outcome.view === undefined) {
          return viewOfErrors(run, "submit", [
            { code: "E499", detail: "no result from submission" },
          ]);
        }
        return { envelope: envelopeOk(run), payload: viewPayload(outcome.view) };
      });
    },
  );

program
  .command("status")
  .description(
    "Show a run's pending jobs or its terminal decision, across invocations. " + EXIT_HELP_TEXT,
  )
  .requiredOption("--run <runId>", "panel run id (r........)")
  .option("--json", "emit the machine-shaped envelope with the run handoff")
  .action(async (options: { run: string; json?: boolean }) => {
    await runCommand("status", options.json === true, async (run) => {
      const outcome = statusOfRun(process.cwd(), options.run);
      if (outcome.errors !== undefined) {
        return viewOfErrors(run, "status", outcome.errors);
      }
      if (outcome.view === undefined) {
        return viewOfErrors(run, "status", [{ code: "E499", detail: "no result from status" }]);
      }
      return { envelope: envelopeOk(run), payload: viewPayload(outcome.view) };
    });
  });

program
  .command("abort")
  .description(
    "Abort a pending run, recording a failed terminal decision with your reason. " + EXIT_HELP_TEXT,
  )
  .requiredOption("--run <runId>", "panel run id (r........)")
  .requiredOption("--reason <text>", "why the run is aborted; kept in the decision record")
  .option("--json", "emit the machine-shaped envelope with the run handoff")
  .action(async (options: { run: string; reason: string; json?: boolean }) => {
    await runCommand("abort", options.json === true, async (run) => {
      resolved = { run, step: "abort" };
      const outcome = abortRun(process.cwd(), options.run, options.reason, {
        repoRoot: process.cwd(),
      });
      if (outcome.errors !== undefined) {
        return viewOfErrors(run, "abort", outcome.errors);
      }
      if (outcome.view === undefined) {
        return viewOfErrors(run, "abort", [{ code: "E499", detail: "no result from abort" }]);
      }
      return { envelope: envelopeOk(run), payload: viewPayload(outcome.view) };
    });
  });

program
  .command("skill")
  .description("Print the complete caller-agent instructions to stdout.")
  .action(() => {
    stdout.write(SKILL_TEXT);
  });

ownParserErrors(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  reportCrash("parseAsync", error, CRASH_OPTIONS);
});
