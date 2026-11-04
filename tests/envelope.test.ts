import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  appendCommandRecord,
  commandRecordPath,
  type EnvelopeError,
  EXIT_INTERNAL,
  EXIT_NOTHING_TAKEABLE,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION,
  endRecord,
  envelopeFail,
  envelopeOk,
  exitCodeForErrors,
  formatError,
  startRecord,
} from "../src/envelope";

const err = (code: string, detail = "x"): EnvelopeError => ({ code, detail });

describe("exitCodeForErrors", () => {
  it("maps the E-code class digit to the exit code", () => {
    expect(exitCodeForErrors([])).toBe(EXIT_OK);
    expect(exitCodeForErrors([err("E106")])).toBe(EXIT_USAGE);
    expect(exitCodeForErrors([err("E201"), err("E104")])).toBe(EXIT_VALIDATION);
    expect(exitCodeForErrors([err("E302")])).toBe(EXIT_NOTHING_TAKEABLE);
    expect(exitCodeForErrors([err("E499")])).toBe(EXIT_INTERNAL);
  });

  it("falls to internal on a malformed code", () => {
    expect(exitCodeForErrors([err("X99")])).toBe(EXIT_INTERNAL);
  });
});

describe("envelope shape", () => {
  it("ok and fail carry run, step, errors", () => {
    expect(envelopeOk("r1")).toEqual({ errors: [], ok: true, run: "r1", step: "done" });
    const fail = envelopeFail("r1", "claims", [err("E201", "claims: C9: bad")]);
    expect(fail.ok).toBe(false);
    expect(formatError(fail.errors[0] as EnvelopeError)).toBe("E201: claims: C9: bad");
  });
});

describe("durable command records", () => {
  it("start and end lines land in the append-only file; failed appends never throw", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-env-"));
    const path = commandRecordPath(root);
    appendCommandRecord(path, startRecord("validate", "run-1"));
    appendCommandRecord(
      path,
      endRecord("validate", "run-1", envelopeFail("run-1", "claims", [err("E201")])),
    );
    const entries = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.["event"]).toBe("start");
    expect(entries[0]?.["pid"]).toBeGreaterThan(0);
    expect(entries[1]?.["event"]).toBe("end");
    expect(entries[1]?.["exit"]).toBe(2);
    expect(() =>
      appendCommandRecord(join(root, "no", "such", "dir"), startRecord("x", "y")),
    ).not.toThrow();
  });
});

describe("crash handlers", () => {
  it("an uncaught exception emits an E499 envelope on stdout and exits 4", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-env-"));
    const script = join(root, "crash.ts");
    writeFileSync(
      script,
      [
        `import { installCrashHandlers } from ${JSON.stringify(join(process.cwd(), "src", "envelope"))};`,
        "installCrashHandlers({",
        '  command: "crash-test",',
        `  recordPath: ${JSON.stringify(commandRecordPath(root))},`,
        '  runResolver: () => ({ run: "run-9", step: "work" }),',
        "});",
        "setTimeout(() => {",
        '  throw new Error("boom during work");',
        "}, 0);",
      ].join("\n"),
    );
    const executable = join(root, "crash.mjs");
    buildSync({
      entryPoints: [script],
      outfile: executable,
      bundle: true,
      platform: "node",
      format: "esm",
    });
    const proc = spawnSync(process.execPath, [executable], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PATH: root },
    });
    expect(proc.status).toBe(4);
    const line = String(proc.stdout).trim().split("\n").pop();
    const envelope = JSON.parse(line as string) as Record<string, unknown>;
    expect(envelope["ok"]).toBe(false);
    expect((envelope["errors"] as { code: string }[])[0]?.code).toBe("E499");
    expect(envelope["crashed"]).toBe(true);
    const entries = readFileSync(commandRecordPath(root), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.some((e) => e["crashed"] === true && e["exit"] === 4)).toBe(true);
  });
});
