import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

async function loadSettingsModule() {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-assistant-settings-"));
  const outfile = join(tempDir, "settings.mjs");
  await esbuild.build({
    entryPoints: ["src/settings.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  return { mod, tempDir };
}

test("recognizes LM Studio as a provider in model keys and labels", async () => {
  const { mod, tempDir } = await loadSettingsModule();
  try {
    assert.deepEqual(mod.splitModelKey("lmstudio:local-qwen"), {
      provider: "lmstudio",
      id: "local-qwen",
    });
    assert.equal(mod.buildModelKey("lmstudio", "qwen/qwen3"), "lmstudio:qwen/qwen3");
    assert.equal(mod.PROVIDER_LABELS.lmstudio, "LM Studio");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("normalizes LM Studio URLs to the OpenAI-compatible v1 base URL", async () => {
  const { mod, tempDir } = await loadSettingsModule();
  try {
    assert.equal(
      mod.normalizeLmStudioBaseUrl(""),
      mod.DEFAULT_LMSTUDIO_BASE_URL,
    );
    assert.equal(
      mod.normalizeLmStudioBaseUrl("http://localhost:1234"),
      "http://localhost:1234/v1",
    );
    assert.equal(
      mod.normalizeLmStudioBaseUrl("http://localhost:1234/v1/chat/completions"),
      "http://localhost:1234/v1",
    );
    assert.equal(
      mod.normalizeLmStudioBaseUrl("https://lm.example.test/proxy/v1/models"),
      "https://lm.example.test/proxy/v1",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
