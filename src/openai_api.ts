import { App, Notice, requestUrl } from "obsidian";
import { GoogleGenAI } from "@google/genai";
import type { Content, ContentListUnion, Part } from "@google/genai";
import {
  buildModelKey,
  ModelDefinition,
  ModelStatus,
  ProviderId,
} from "./settings";

export interface ProviderKeys {
  gemini: string;
  groq: string;
  openrouter: string;
  cerebras: string;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image";
  mimeType: string;
  data: string;
  dataUrl: string;
}

export type MessageContent = string | Array<TextContentPart | ImageContentPart>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

export interface GeneratedImage {
  filename: string;
  mimeType: string;
  dataUrl: string;
  arrayBuffer: ArrayBuffer;
}

interface OpenAICompatibleMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail: "auto" } }
      >;
}

interface ProviderResponseChoice {
  message?: {
    content?: string | null;
    reasoning?: string | null;
    images?: OpenRouterImage[];
  };
}

interface ProviderResponse {
  choices?: ProviderResponseChoice[];
  usage?: unknown;
  error?: { message?: string };
}

interface OpenRouterImage {
  image_url?: { url?: string };
  imageUrl?: { url?: string };
}

interface FetchModelResponse {
  data?: Array<{
    id?: string;
    name?: string;
    owned_by?: string;
    context_length?: number;
    top_provider?: { max_completion_tokens?: number | null };
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
    description?: string;
    expiration_date?: string | null;
  }>;
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

export class TextAssistant {
  constructor(
    private readonly client: ProviderClient,
    readonly model: ModelDefinition,
    private readonly maxTokens: number,
    private readonly useWebSearch: boolean,
  ) {}

  supportsImageInput(): boolean {
    return this.model.capabilities.includes("image-input");
  }

  text_api_call = async (
    promptList: ChatMessage[],
    htmlEl?: HTMLElement,
  ): Promise<string | undefined> => {
    return this.client.textApiCall(
      this.model,
      promptList,
      this.maxTokens,
      htmlEl,
      this.useWebSearch,
    );
  };
}

export class ProviderClient {
  private readonly geminiClient?: GoogleGenAI;

  constructor(
    private readonly app: App,
    private readonly keys: ProviderKeys,
    private readonly debugLogging: boolean,
  ) {
    if (keys.gemini.trim()) {
      this.geminiClient = new GoogleGenAI({ apiKey: keys.gemini.trim() });
    }
  }

  createTextAssistant(
    model: ModelDefinition,
    maxTokens: number,
    useWebSearch = false,
  ): TextAssistant {
    return new TextAssistant(this, model, maxTokens, useWebSearch);
  }

  async textApiCall(
    model: ModelDefinition,
    promptList: ChatMessage[],
    maxTokens: number,
    htmlEl?: HTMLElement,
    useWebSearch = false,
  ): Promise<string | undefined> {
    const startedAt = Date.now();
    this.log("request:start", {
      provider: model.provider,
      model: model.id,
      mode: htmlEl === undefined ? "blocking" : "chat",
      webSearch: useWebSearch,
    });

    try {
      const answer =
        model.provider === "gemini"
          ? await this.callGeminiText(model, promptList, maxTokens)
          : await this.callOpenAICompatibleText(
              model,
              promptList,
              maxTokens,
              useWebSearch,
            );

      if (htmlEl !== undefined && answer !== undefined) {
        htmlEl.textContent = answer;
      }

      this.log("request:success", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
      });

      return answer;
    } catch (error) {
      this.handleError(`${model.provider} API error`, error);
      this.log("request:error", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        error: this.errorMessage(error),
      });
      return undefined;
    }
  }

  async generateImage(
    model: ModelDefinition,
    prompt: string,
  ): Promise<GeneratedImage[] | undefined> {
    switch (model.provider) {
      case "gemini":
        return this.generateGeminiImage(model, prompt);
      case "openrouter":
        return this.generateOpenRouterImage(model, prompt);
      case "groq":
      case "cerebras":
        new Notice(
          `${model.provider} image generation is not implemented for this model.`,
        );
        return undefined;
    }
  }

  private async generateGeminiImage(
    model: ModelDefinition,
    prompt: string,
  ): Promise<GeneratedImage[] | undefined> {
    const client = this.requireGeminiClient();
    const response = await client.models.generateContent({
      model: model.id,
      contents: prompt,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const generatedImages: GeneratedImage[] = [];
    for (const [index, part] of parts.entries()) {
      const inlineData = part.inlineData;
      if (inlineData?.data === undefined) {
        continue;
      }
      const mimeType = inlineData.mimeType ?? "image/png";
      const extension = mimeType.includes("jpeg") ? "jpg" : "png";
      generatedImages.push({
        filename: `gemini-generated-${Date.now()}-${index + 1}.${extension}`,
        mimeType,
        dataUrl: `data:${mimeType};base64,${inlineData.data}`,
        arrayBuffer: base64ToArrayBuffer(inlineData.data),
      });
    }

    if (generatedImages.length === 0) {
      new Notice(response.text ?? "Gemini did not return image data.");
      return undefined;
    }
    return generatedImages;
  }

  private async generateOpenRouterImage(
    model: ModelDefinition,
    prompt: string,
  ): Promise<GeneratedImage[] | undefined> {
    const startedAt = Date.now();
    const apiKey = this.apiKeyFor("openrouter");
    if (!apiKey) {
      new Notice("OpenRouter API key is not configured.");
      return undefined;
    }
    this.log("image:start", {
      provider: model.provider,
      model: model.id,
      promptLength: prompt.length,
    });

    try {
      const response = await requestUrl({
        url: providerEndpoint("openrouter", "chat"),
        method: "POST",
        contentType: "application/json",
        headers: this.authHeaders("openrouter", apiKey),
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: prompt }],
          modalities: model.capabilities.includes("text")
            ? ["image", "text"]
            : ["image"],
          stream: false,
          ...model.parameters,
        }),
        throw: false,
      });
      if (response.status >= 400) {
        throw new Error(this.providerErrorMessage(response.status, response.text));
      }

      const json = response.json as ProviderResponse;
      const images = json.choices?.[0]?.message?.images ?? [];
      const generatedImages = images.flatMap((image, index) => {
        const dataUrl = image.image_url?.url ?? image.imageUrl?.url;
        return dataUrl === undefined
          ? []
          : [generatedImageFromDataUrl(dataUrl, "openrouter-generated", index)];
      });
      if (generatedImages.length === 0) {
        new Notice("OpenRouter did not return image data.");
        this.log("image:error", {
          provider: model.provider,
          model: model.id,
          elapsedMs: Date.now() - startedAt,
          error: "OpenRouter did not return image data.",
        });
        return undefined;
      }

      this.log("image:success", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        imageCount: generatedImages.length,
      });
      return generatedImages;
    } catch (error) {
      this.handleError("OpenRouter image error", error);
      this.log("image:error", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        error: this.errorMessage(error),
      });
      return undefined;
    }
  }

  async generateSpeech(
    model: ModelDefinition,
    text: string,
  ): Promise<Blob | undefined> {
    const startedAt = Date.now();
    this.log("tts:start", {
      provider: model.provider,
      model: model.id,
      textLength: text.length,
    });

    switch (model.provider) {
      case "gemini":
        return this.generateGeminiSpeech(model, text, startedAt);
      case "openrouter":
        return this.generateOpenRouterSpeech(model, text, startedAt);
      case "groq":
      case "cerebras":
        new Notice(`${model.provider} text to speech is not implemented.`);
        return undefined;
    }
  }

  private async generateGeminiSpeech(
    model: ModelDefinition,
    text: string,
    startedAt: number,
  ): Promise<Blob | undefined> {
    try {
      const client = this.requireGeminiClient();
      const response = await client.models.generateContent({
        model: model.id,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.find(
        (candidatePart) => candidatePart.inlineData?.data !== undefined,
      );
      const data = part?.inlineData?.data ?? response.data;
      if (data === undefined) {
        new Notice(response.text ?? "Gemini did not return audio data.");
        this.log("tts:error", {
          provider: model.provider,
          model: model.id,
          elapsedMs: Date.now() - startedAt,
          error: "Gemini did not return audio data.",
        });
        return undefined;
      }
      const pcmBuffer = base64ToArrayBuffer(data);
      this.log("tts:success", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        bytes: pcmBuffer.byteLength,
      });
      return pcmToWavBlob(pcmBuffer);
    } catch (error) {
      this.handleError(`${model.provider} TTS error`, error);
      this.log("tts:error", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        error: this.errorMessage(error),
      });
      return undefined;
    }
  }

  private async generateOpenRouterSpeech(
    model: ModelDefinition,
    text: string,
    startedAt: number,
  ): Promise<Blob | undefined> {
    const apiKey = this.apiKeyFor("openrouter");
    if (!apiKey) {
      new Notice("OpenRouter API key is not configured.");
      return undefined;
    }

    try {
      const response = await requestUrl({
        url: providerEndpoint("openrouter", "speech"),
        method: "POST",
        contentType: "application/json",
        headers: this.authHeaders("openrouter", apiKey),
        body: JSON.stringify({
          model: model.id,
          input: text,
          voice: openRouterTtsVoice(model),
          response_format: "mp3",
        }),
        throw: false,
      });
      if (response.status >= 400) {
        throw new Error(this.providerErrorMessage(response.status, response.text));
      }

      this.log("tts:success", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        bytes: response.arrayBuffer.byteLength,
      });
      return new Blob([response.arrayBuffer], {
        type: response.headers["content-type"] ?? "audio/mpeg",
      });
    } catch (error) {
      this.handleError("OpenRouter TTS error", error);
      this.log("tts:error", {
        provider: model.provider,
        model: model.id,
        elapsedMs: Date.now() - startedAt,
        error: this.errorMessage(error),
      });
      return undefined;
    }
  }

  async fetchModels(provider: ProviderId): Promise<ModelDefinition[]> {
    switch (provider) {
      case "gemini":
        return this.fetchGeminiModels();
      case "groq":
        return this.fetchOpenAICompatibleModels(
          "groq",
          "https://api.groq.com/openai/v1/models",
        );
      case "openrouter":
        return this.fetchOpenRouterModels();
      case "cerebras":
        return this.fetchOpenAICompatibleModels(
          "cerebras",
          "https://api.cerebras.ai/v1/models",
        );
    }
  }

  private async callGeminiText(
    model: ModelDefinition,
    promptList: ChatMessage[],
    maxTokens: number,
  ): Promise<string | undefined> {
    const client = this.requireGeminiClient();
    const response = await client.models.generateContent({
      model: model.id,
      contents: toGeminiContents(promptList),
      config: {
        maxOutputTokens: maxTokens,
      },
    });
    return response.text;
  }

  private async callOpenAICompatibleText(
    model: ModelDefinition,
    promptList: ChatMessage[],
    maxTokens: number,
    useWebSearch: boolean,
  ): Promise<string | undefined> {
    const endpoint = providerEndpoint(model.provider, "chat");
    const apiKey = this.apiKeyFor(model.provider);
    const body: Record<string, unknown> = {
      model: model.id,
      messages: promptList.map(toOpenAICompatibleMessage),
      ...model.parameters,
    };

    if (model.provider === "cerebras") {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    if (model.provider === "openrouter" && useWebSearch) {
      body.tools = [
        {
          type: "openrouter:web_search",
          parameters: {
            engine: "auto",
            max_results: 5,
            max_total_results: 12,
            search_context_size: "medium",
          },
        },
      ];
    }

    const response = await requestUrl({
      url: endpoint,
      method: "POST",
      contentType: "application/json",
      headers: this.authHeaders(model.provider, apiKey),
      body: JSON.stringify(body),
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(this.providerErrorMessage(response.status, response.text));
    }

    const json = response.json as ProviderResponse;
    const content = json.choices?.[0]?.message?.content ?? undefined;
    this.log("request:usage", {
      provider: model.provider,
      model: model.id,
      status: response.status,
      usage: json.usage,
    });
    return stripReasoningTags(content);
  }

  private async fetchGeminiModels(): Promise<ModelDefinition[]> {
    const apiKey = this.keys.gemini.trim();
    if (!apiKey) {
      new Notice("Gemini API key is not configured.");
      return [];
    }

    const response = await requestUrl({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      method: "GET",
      throw: false,
    });
    if (response.status >= 400) {
      throw new Error(this.providerErrorMessage(response.status, response.text));
    }

    const json = response.json as FetchModelResponse;
    return (json.models ?? [])
      .filter((entry) =>
        entry.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((entry) => {
        const id = (entry.name ?? "").replace(/^models\//, "");
        return {
          key: buildModelKey("gemini", id),
          id,
          provider: "gemini",
          label: entry.displayName ?? id,
          capabilities: inferCapabilities("gemini", id, {
            outputModalities: [],
            inputModalities: [],
          }),
          source: "fetched",
          status: inferStatus(id),
          description: entry.description,
          contextLength: entry.inputTokenLimit,
          maxOutputTokens: entry.outputTokenLimit,
        };
      });
  }

  private async fetchOpenRouterModels(): Promise<ModelDefinition[]> {
    const apiKey = this.keys.openrouter.trim();
    const response = await requestUrl({
      url: "https://openrouter.ai/api/v1/models",
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      throw: false,
    });
    if (response.status >= 400) {
      throw new Error(this.providerErrorMessage(response.status, response.text));
    }
    const json = response.json as FetchModelResponse;
    return (json.data ?? []).flatMap((entry) =>
      entry.id === undefined
        ? []
        : [
            {
              key: buildModelKey("openrouter", entry.id),
              id: entry.id,
              provider: "openrouter",
              label: entry.name ?? entry.id,
              capabilities: inferCapabilities("openrouter", entry.id, {
                inputModalities: entry.architecture?.input_modalities ?? [],
                outputModalities: entry.architecture?.output_modalities ?? [],
              }),
              source: "fetched",
              status: entry.expiration_date ? "deprecated-soon" : inferStatus(entry.id),
              description: entry.description,
              contextLength: entry.context_length,
              maxOutputTokens:
                entry.top_provider?.max_completion_tokens ?? undefined,
            },
          ],
    );
  }

  private async fetchOpenAICompatibleModels(
    provider: Exclude<ProviderId, "gemini" | "openrouter">,
    url: string,
  ): Promise<ModelDefinition[]> {
    const apiKey = this.apiKeyFor(provider);
    if (!apiKey) {
      new Notice(`${provider} API key is not configured.`);
      return [];
    }

    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.authHeaders(provider, apiKey),
      throw: false,
    });
    if (response.status >= 400) {
      throw new Error(this.providerErrorMessage(response.status, response.text));
    }

    const json = response.json as FetchModelResponse;
    return (json.data ?? []).flatMap((entry) =>
      entry.id === undefined
        ? []
        : [
            {
              key: buildModelKey(provider, entry.id),
              id: entry.id,
              provider,
              label: entry.id,
              capabilities: inferCapabilities(provider, entry.id, {
                inputModalities: [],
                outputModalities: ["text"],
              }),
              source: "fetched",
              status: inferStatus(entry.id),
            },
          ],
    );
  }

  private requireGeminiClient(): GoogleGenAI {
    if (this.geminiClient === undefined) {
      throw new Error("Gemini API key is not configured.");
    }
    return this.geminiClient;
  }

  private apiKeyFor(provider: ProviderId): string {
    return this.keys[provider].trim();
  }

  private authHeaders(provider: ProviderId, apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] =
        "https://github.com/Lalit1112/lp-obsidian-ai-assistant";
      headers["X-Title"] = "LP Obsidian AI Assistant";
    }
    return headers;
  }

  private providerErrorMessage(status: number, text: string): string {
    const fallback = `HTTP ${status}: Provider request failed.`;
    try {
      const parsed = JSON.parse(text) as ProviderResponse;
      const message = parsed.error?.message;
      return message === undefined
        ? fallback
        : `HTTP ${status}: ${sanitizeDiagnosticText(message)}`;
    } catch {
      return fallback;
    }
  }

  private handleError(prefix: string, error: unknown): void {
    new Notice(`${prefix}: ${this.errorMessage(error)}`);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return sanitizeDiagnosticText(error.message);
    }
    return sanitizeDiagnosticText(String(error));
  }

  private log(event: string, details: Record<string, unknown>): void {
    if (this.debugLogging || event === "request:error") {
      console.log(`[AI Assistant] ${event}`, details);
    }
  }
}

function providerEndpoint(provider: ProviderId, route: "chat" | "speech"): string {
  if (route === "speech") {
    if (provider === "openrouter") {
      return "https://openrouter.ai/api/v1/audio/speech";
    }
    throw new Error("Unsupported provider speech route.");
  }
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "cerebras":
      return "https://api.cerebras.ai/v1/chat/completions";
    case "gemini":
      throw new Error("Gemini does not use an OpenAI-compatible endpoint.");
  }
}

function toOpenAICompatibleMessage(
  message: ChatMessage,
): OpenAICompatibleMessage {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : {
            type: "image_url",
            image_url: { url: part.dataUrl, detail: "auto" },
          },
    ),
  };
}

function toGeminiContents(promptList: ChatMessage[]): ContentListUnion {
  const hasImage = promptList.some((message) => Array.isArray(message.content));
  if (!hasImage) {
    return [
      {
        role: "user",
        parts: [
          {
            text: promptList
              .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
              .join("\n\n"),
          },
        ],
      },
    ];
  }

  return promptList.map<Content>((message) => {
    const parts: Part[] =
      typeof message.content === "string"
        ? [{ text: message.content }]
        : message.content.map<Part>((part) =>
            part.type === "text"
              ? { text: part.text }
              : {
                  inlineData: {
                    mimeType: part.mimeType,
                    data: part.data,
                  },
                },
          );
    return {
      role: message.role === "assistant" ? "model" : "user",
      parts,
    };
  });
}

function inferCapabilities(
  provider: ProviderId,
  id: string,
  metadata: { inputModalities: string[]; outputModalities: string[] },
): ModelDefinition["capabilities"] {
  const capabilities = new Set<ModelDefinition["capabilities"][number]>();
  const normalizedId = id.toLowerCase();

  if (
    metadata.outputModalities.length === 0 ||
    metadata.outputModalities.includes("text") ||
    provider === "groq" ||
    provider === "cerebras"
  ) {
    capabilities.add("text");
  }
  if (
    metadata.inputModalities.includes("image") ||
    normalizedId.includes("vision") ||
    normalizedId.includes("grok-4") ||
    normalizedId.includes("gemini")
  ) {
    capabilities.add("image-input");
  }
  if (
    metadata.outputModalities.includes("image") ||
    normalizedId.includes("image") ||
    normalizedId.includes("imagine")
  ) {
    capabilities.add("image-generation");
    capabilities.delete("text");
  }
  if (
    metadata.outputModalities.includes("audio") ||
    metadata.outputModalities.includes("speech") ||
    normalizedId.includes("tts") ||
    normalizedId.includes("voice")
  ) {
    capabilities.add("tts");
    capabilities.delete("text");
  }
  if (normalizedId.includes("compound") || provider === "openrouter") {
    capabilities.add("web-search");
  }

  return Array.from(capabilities);
}

function inferStatus(id: string): ModelStatus {
  const normalizedId = id.toLowerCase();
  if (
    normalizedId.includes("preview") ||
    normalizedId.includes("latest") ||
    normalizedId.includes("antigravity")
  ) {
    return "preview";
  }
  if (normalizedId.includes("qwen-3-235b-a22b-instruct-2507")) {
    return "deprecated-soon";
  }
  return "available";
}

function stripReasoningTags(response: string | undefined): string | undefined {
  if (response === undefined) {
    return undefined;
  }
  return response
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, "")
    .replace(/^\s*[\r\n]/gm, "")
    .trim();
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function generatedImageFromDataUrl(
  dataUrl: string,
  filenamePrefix: string,
  index: number,
): GeneratedImage {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (match === null) {
    throw new Error("OpenRouter returned an unsupported image URL format.");
  }
  const mimeType = match[1];
  const base64 = match[2];
  const extension = mimeType.includes("jpeg")
    ? "jpg"
    : mimeType.includes("webp")
      ? "webp"
      : "png";
  return {
    filename: `${filenamePrefix}-${Date.now()}-${index + 1}.${extension}`,
    mimeType,
    dataUrl,
    arrayBuffer: base64ToArrayBuffer(base64),
  };
}

function openRouterTtsVoice(model: ModelDefinition): string {
  return model.id.includes("grok-voice") ? "Eve" : "alloy";
}

function pcmToWavBlob(
  pcmBuffer: ArrayBuffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Blob {
  const headerSize = 44;
  const wavBuffer = new ArrayBuffer(headerSize + pcmBuffer.byteLength);
  const view = new DataView(wavBuffer);
  const pcmBytes = new Uint8Array(pcmBuffer);
  const wavBytes = new Uint8Array(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBuffer.byteLength, true);
  wavBytes.set(pcmBytes, headerSize);

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(/(key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^"'\s`]+/gi, "Bearer [redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/sk-or-v1-[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/csk-[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .slice(0, 300);
}
