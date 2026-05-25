import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

async function loadDiagnosticsModule() {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-assistant-diagnostics-"));
  const outfile = join(tempDir, "diagnostics.mjs");
  await esbuild.build({
    entryPoints: ["src/diagnostics.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  return { mod, tempDir };
}

test("sanitizes secrets and caps diagnostic error text", async () => {
  const { mod, tempDir } = await loadDiagnosticsModule();
  try {
    const sanitized = mod.sanitizeDiagnosticText(
      `Authorization Bearer sk-or-v1-${"a".repeat(40)} key=AIza${"b".repeat(40)} ${"x".repeat(400)}`,
    );

    assert.equal(sanitized.includes("sk-or-v1-"), false);
    assert.equal(sanitized.includes("AIza"), false);
    assert.equal(sanitized.includes("Bearer [redacted]"), true);
    assert.equal(sanitized.length <= 300, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("formats diagnostic entries without prompt content", async () => {
  const { mod, tempDir } = await loadDiagnosticsModule();
  try {
    const entry = mod.createDiagnosticLogEntry(
      "request:error",
      {
        provider: "openrouter",
        model: "openai/gpt-5.5",
        mode: "blocking",
        prompt: "this prompt must not be logged",
        selectedText: "this note text must not be logged",
        error: `upstream failed with sk-${"c".repeat(40)}`,
        elapsedMs: 1234,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      new Date("2026-05-25T06:30:00.000Z"),
    );
    const line = mod.formatDiagnosticLogLine(entry);

    assert.equal(entry.timestamp, "2026-05-25T06:30:00.000Z");
    assert.equal(entry.event, "request:error");
    assert.equal(entry.provider, "openrouter");
    assert.equal(entry.model, "openai/gpt-5.5");
    assert.equal(entry.prompt, undefined);
    assert.equal(entry.selectedText, undefined);
    assert.equal(line.includes("this prompt must not be logged"), false);
    assert.equal(line.includes("this note text must not be logged"), false);
    assert.equal(line.includes("sk-"), false);
    assert.equal(line.includes("prompt_tokens"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("appends diagnostic logs while keeping only the newest entries", async () => {
  const { mod, tempDir } = await loadDiagnosticsModule();
  try {
    let log = mod.DIAGNOSTIC_LOG_HEADER;
    for (let index = 0; index < 5; index++) {
      log = mod.appendDiagnosticLogEntry(
        log,
        mod.createDiagnosticLogEntry(
          "request:success",
          { requestId: `req-${index}`, provider: "groq", model: "groq/compound" },
          new Date(`2026-05-25T06:3${index}:00.000Z`),
        ),
        3,
      );
    }

    assert.equal(log.includes("req-0"), false);
    assert.equal(log.includes("req-1"), false);
    assert.equal(log.includes("req-2"), true);
    assert.equal(log.includes("req-4"), true);
    assert.equal(log.split("\n").filter((line) => line.startsWith("{")).length, 3);
    assert.equal(log.startsWith(mod.DIAGNOSTIC_LOG_HEADER), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
