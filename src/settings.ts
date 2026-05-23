export type ProviderId = "gemini" | "groq" | "openrouter" | "cerebras";

export type ModelCapability =
  | "text"
  | "image-input"
  | "image-generation"
  | "tts"
  | "web-search";

export type ModelSource = "curated" | "fetched" | "manual";
export type ModelStatus = "available" | "manual" | "preview" | "deprecated-soon";

export interface ModelDefinition {
  key: string;
  id: string;
  provider: ProviderId;
  label: string;
  capabilities: ModelCapability[];
  source: ModelSource;
  status: ModelStatus;
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  parameters?: Record<string, string | number | boolean>;
}

export interface QuickPromptDefinition {
  id: string;
  label: string;
  prompt: string;
  defaultModelKey?: string;
  useWebSearch?: boolean;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
};

export const DEFAULT_TEXT_MODEL_KEY = "cerebras:zai-glm-4.7";
export const DEFAULT_CRITIQUE_MODEL_KEY = "groq:groq/compound";
export const DEFAULT_FACT_CHECK_MODEL_KEY = "groq:groq/compound";
export const DEFAULT_RESEARCH_MODEL_KEY = "openrouter:x-ai/grok-4.3";
export const DEFAULT_IMAGE_MODEL_KEY = "gemini:gemini-3-pro-image-preview";
export const DEFAULT_TTS_MODEL_KEY = "gemini:gemini-3.1-flash-tts-preview";
export const DEFAULT_MAX_TOKENS = 4000;

export function buildModelKey(provider: ProviderId, id: string): string {
  return `${provider}:${id}`;
}

export function splitModelKey(
  key: string,
): { provider: ProviderId; id: string } | undefined {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex === -1) {
    return undefined;
  }

  const provider = key.slice(0, separatorIndex);
  const id = key.slice(separatorIndex + 1);
  if (
    provider === "gemini" ||
    provider === "groq" ||
    provider === "openrouter" ||
    provider === "cerebras"
  ) {
    return { provider, id };
  }
  return undefined;
}

function model(
  provider: ProviderId,
  id: string,
  label: string,
  capabilities: ModelCapability[],
  status: ModelStatus = "available",
  parameters?: Record<string, string | number | boolean>,
): ModelDefinition {
  return {
    key: buildModelKey(provider, id),
    id,
    provider,
    label,
    capabilities,
    source: status === "manual" ? "manual" : "curated",
    status,
    parameters,
  };
}

export const CURATED_MODELS: ModelDefinition[] = [
  model(
    "gemini",
    "antigravity-preview-05-2026",
    "Antigravity Preview 05-2026",
    ["text", "image-input"],
    "manual",
  ),
  model("gemini", "gemini-flash-latest", "Gemini Flash Latest", [
    "text",
    "image-input",
  ]),
  model("gemini", "gemini-pro-latest", "Gemini Pro Latest", [
    "text",
    "image-input",
  ]),
  model(
    "gemini",
    "gemini-3-pro-image-preview",
    "Gemini 3 Pro Image Preview",
    ["image-generation"],
    "preview",
  ),
  model(
    "gemini",
    "gemini-3.1-flash-tts-preview",
    "Gemini 3.1 Flash TTS Preview",
    ["tts"],
    "preview",
  ),
  model("groq", "groq/compound", "Groq Compound", ["text", "web-search"]),
  model("groq", "qwen/qwen3-32b", "Qwen3 32B", ["text"], "preview"),
  model("groq", "openai/gpt-oss-120b", "GPT-OSS 120B", ["text"]),
  model(
    "cerebras",
    "qwen-3-235b-a22b-instruct-2507",
    "Qwen 3 235B Instruct",
    ["text"],
    "deprecated-soon",
  ),
  model("cerebras", "gpt-oss-120b", "GPT-OSS 120B", ["text"], "available", {
    reasoning_effort: "high",
  }),
  model("cerebras", "zai-glm-4.7", "Z.ai GLM 4.7", ["text"], "preview"),
  model("openrouter", "qwen/qwen3.7-max", "Qwen3.7 Max", [
    "text",
  ]),
  model("openrouter", "x-ai/grok-imagine-image-quality", "Grok Imagine Image Quality", [
    "image-generation",
  ]),
  model("openrouter", "x-ai/grok-voice-tts-1.0", "Grok Voice TTS 1.0", [
    "tts",
  ]),
  model("openrouter", "~anthropic/claude-haiku-latest", "Claude Haiku Latest", [
    "text",
  ]),
  model("openrouter", "~openai/gpt-mini-latest", "GPT Mini Latest", ["text"]),
  model("openrouter", "~moonshotai/kimi-latest", "Kimi Latest", ["text"]),
  model("openrouter", "openai/gpt-5.5", "GPT-5.5", ["text", "image-input"]),
  model("openrouter", "deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", [
    "text",
  ]),
  model("openrouter", "tencent/hy3-preview", "Tencent Hy3 Preview", [
    "text",
  ], "preview"),
  model("openrouter", "~anthropic/claude-opus-latest", "Claude Opus Latest", [
    "text",
    "image-input",
  ]),
  model("openrouter", "z-ai/glm-5.1", "Z.ai GLM 5.1", ["text"]),
  model("openrouter", "x-ai/grok-4.3", "Grok 4.3", [
    "text",
    "image-input",
    "web-search",
  ]),
];

export const QUICK_PROMPTS: QuickPromptDefinition[] = [
  {
    id: "grammar_readability",
    label: "Fix grammar, spelling, and readability",
    prompt:
      "Revise the selected note text for grammar, spelling, readability, and flow. Preserve the original meaning, markdown structure, links, headings, code blocks, and Obsidian syntax. Prefer clear active phrasing, remove awkward repetition, and keep the author's voice. Highlight every changed phrase with ==markdown highlights==. Return only the revised text.",
  },
  {
    id: "markdown_structure",
    label: "Suggest markdown or structure improvements",
    prompt:
      "Review the selected Obsidian note as a markdown editor. Return concise, actionable bullets that improve heading hierarchy, section order, lists, callouts, internal links, paragraph length, duplicated content, and unclear transitions. Include the reason for each suggestion. Do not rewrite the whole note unless a short example is necessary.",
  },
  {
    id: "organize_rough_thoughts",
    label: "Organize rough thoughts into clearer writing",
    prompt:
      "Turn the selected rough, stream-of-consciousness writing into a clearer, better-structured version. Preserve the author's voice, uncertainty, personal phrasing, and specific details. Do not make it sound corporate, generic, over-polished, or AI-written. Use headings, paragraphs, or lists only when they improve readability. Return the improved version first. Then add a short 'Rationale' section with 3-5 bullets explaining the main structural changes.",
  },
  {
    id: "continue_writing_options",
    label: "Suggest ways to continue writing",
    prompt:
      "Read the selected draft and suggest 3 distinct ways to continue it. This may be life writing, career advice, reflective notes, or fiction. For each option, give a short direction label, explain the angle in one sentence, and write a sample continuation in the same natural voice. Keep it human, specific, and non-formulaic. Do not over-polish or make it sound like generic AI prose.",
  },
  {
    id: "find_supporting_research",
    label: "Find studies or research to support my logic",
    defaultModelKey: DEFAULT_RESEARCH_MODEL_KEY,
    useWebSearch: true,
    prompt:
      "Find relevant studies, research papers, reputable reports, or expert sources that could support, challenge, or add nuance to the selected argument. Do not hallucinate sources. If strong research is not available, say so clearly. Prefer primary research, meta-analyses, systematic reviews, official data, or reputable institutions. Return: 1) the core claim or logic you inferred, 2) relevant sources with links and one-line summaries, 3) how each source supports or complicates the argument, 4) limitations or uncertainty, and 5) suggested wording to cite the evidence responsibly.",
  },
  {
    id: "writing_coach_feedback",
    label: "Writing coach: score and teach me to improve",
    prompt:
      "Act as a direct but supportive writing coach. Analyze the selected writing and help me become a better writer. First identify whether it is mainly technical, non-technical, reflective, persuasive, or fictional. Score it from 1-10 on clarity, structure, readability, engagement, voice, and usefulness to the intended reader. For technical writing, also score accuracy framing, explanation flow, precision, examples, and cognitive load. Give specific recommendations with examples from my text. Teach the principle behind each recommendation, drawing on strong writing practices used by successful authors and, for technical writing, technical writing principles. Avoid generic advice. End with a short practice exercise I can apply to this piece.",
  },
  {
    id: "fact_check_web",
    label: "Fact check on web",
    defaultModelKey: DEFAULT_FACT_CHECK_MODEL_KEY,
    useWebSearch: true,
    prompt:
      "Fact-check the selected content using web-capable model tools. Break the content into verifiable claims. For each important claim, classify it as correct, incorrect, needs nuance, or unsupported. Cite sources with links. Mention uncertainty clearly and do not invent citations. End with a short list of corrections the note should make.",
  },
  {
    id: "research_web",
    label: "Research on web",
    defaultModelKey: DEFAULT_RESEARCH_MODEL_KEY,
    useWebSearch: true,
    prompt:
      "Research the selected topic using web-capable model tools. Produce a concise research brief with key findings, cited sources, caveats, disagreements between sources, and recommended next questions. Prefer primary or official sources when available. Include links for all source-backed claims.",
  },
];

export function mergeModelLists(
  curatedModels: ModelDefinition[],
  fetchedModels: ModelDefinition[],
): ModelDefinition[] {
  const merged = new Map<string, ModelDefinition>();
  for (const modelDefinition of curatedModels) {
    merged.set(modelDefinition.key, modelDefinition);
  }
  for (const modelDefinition of fetchedModels) {
    const existing = merged.get(modelDefinition.key);
    merged.set(modelDefinition.key, {
      ...modelDefinition,
      source: existing?.source === "manual" ? "manual" : modelDefinition.source,
      status:
        existing?.status === "manual" || existing?.status === "deprecated-soon"
          ? existing.status
          : modelDefinition.status,
      capabilities:
        existing === undefined
          ? modelDefinition.capabilities
          : Array.from(
              new Set([...existing.capabilities, ...modelDefinition.capabilities]),
            ),
      parameters: existing?.parameters ?? modelDefinition.parameters,
    });
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (a.provider !== b.provider) {
      return PROVIDER_LABELS[a.provider].localeCompare(PROVIDER_LABELS[b.provider]);
    }
    return a.label.localeCompare(b.label);
  });
}

export function modelSupports(
  modelDefinition: ModelDefinition,
  capability: ModelCapability,
): boolean {
  return modelDefinition.capabilities.includes(capability);
}
