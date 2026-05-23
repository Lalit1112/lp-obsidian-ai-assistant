import {
  App,
  Editor,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import {
  ChatModal,
  ImageModal,
  ImagePromptModal,
  ModelOption,
  PromptModal,
  PromptModalSubmit,
  TextToSpeechModal,
} from "./modal";
import { ProviderClient, ProviderKeys } from "./openai_api";
import {
  CURATED_MODELS,
  DEFAULT_CRITIQUE_MODEL_KEY,
  DEFAULT_FACT_CHECK_MODEL_KEY,
  DEFAULT_IMAGE_MODEL_KEY,
  DEFAULT_MAX_TOKENS,
  DEFAULT_RESEARCH_MODEL_KEY,
  DEFAULT_TEXT_MODEL_KEY,
  DEFAULT_TTS_MODEL_KEY,
  mergeModelLists,
  ModelCapability,
  ModelDefinition,
  modelSupports,
  ProviderId,
  PROVIDER_LABELS,
  QUICK_PROMPTS,
} from "./settings";

interface AiAssistantSettings {
  geminiApiKey: string;
  groqApiKey: string;
  openRouterApiKey: string;
  cerebrasApiKey: string;
  defaultTextModelKey: string;
  defaultCritiqueModelKey: string;
  defaultFactCheckModelKey: string;
  defaultResearchModelKey: string;
  defaultImageModelKey: string;
  defaultTtsModelKey: string;
  maxTokens: number;
  replaceSelection: boolean;
  imgFolder: string;
  customPrompt1: string;
  customPrompt2: string;
  customPrompt3: string;
  debugLogging: boolean;
  enabledModelKeys: Record<string, boolean>;
  fetchedModels: ModelDefinition[];
}

type ModelDefaultSettingKey =
  | "defaultTextModelKey"
  | "defaultCritiqueModelKey"
  | "defaultFactCheckModelKey"
  | "defaultResearchModelKey"
  | "defaultImageModelKey"
  | "defaultTtsModelKey";

const DEFAULT_SETTINGS: AiAssistantSettings = {
  geminiApiKey: "",
  groqApiKey: "",
  openRouterApiKey: "",
  cerebrasApiKey: "",
  defaultTextModelKey: DEFAULT_TEXT_MODEL_KEY,
  defaultCritiqueModelKey: DEFAULT_CRITIQUE_MODEL_KEY,
  defaultFactCheckModelKey: DEFAULT_FACT_CHECK_MODEL_KEY,
  defaultResearchModelKey: DEFAULT_RESEARCH_MODEL_KEY,
  defaultImageModelKey: DEFAULT_IMAGE_MODEL_KEY,
  defaultTtsModelKey: DEFAULT_TTS_MODEL_KEY,
  maxTokens: DEFAULT_MAX_TOKENS,
  replaceSelection: true,
  imgFolder: "AiAssistant/Assets",
  customPrompt1: "",
  customPrompt2: "",
  customPrompt3: "",
  debugLogging: false,
  enabledModelKeys: CURATED_MODELS.reduce<Record<string, boolean>>(
    (enabledModelKeys, model) => {
      enabledModelKeys[model.key] = true;
      return enabledModelKeys;
    },
    {},
  ),
  fetchedModels: [],
};

export default class AiAssistantPlugin extends Plugin {
  settings: AiAssistantSettings;
  providerClient: ProviderClient;
  private readonly critiqueTimerIds = new Set<ReturnType<typeof setTimeout>>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.buildClient();

    this.addCommand({
      id: "chat-mode",
      name: "Open Assistant Chat",
      callback: () => {
        const model = this.getModelOrDefault(
          this.settings.defaultTextModelKey,
          DEFAULT_TEXT_MODEL_KEY,
          "text",
        );
        new ChatModal(
          this.app,
          this.providerClient.createTextAssistant(
            model,
            this.settings.maxTokens,
            false,
          ),
        ).open();
      },
    });

    this.addCommand({
      id: "prompt-mode",
      name: "Open Assistant Prompt",
      editorCallback: async (editor: Editor) => {
        const selectedText = editor.getSelection().trim();
        new PromptModal(
          this.app,
          (input) => {
            void this.handlePromptSubmit(editor, selectedText, input);
          },
          {
            modelOptions: this.modelOptions("text"),
            critiqueModelOptions: this.modelOptions("text"),
            quickPrompts: this.quickPromptsWithDefaults(),
            customPrompts: this.customPrompts(),
            defaultModelKey: this.settings.defaultTextModelKey,
            defaultCritiqueModelKey: this.settings.defaultCritiqueModelKey,
          },
        ).open();
      },
    });

    this.addCommand({
      id: "img-generator",
      name: "Open Image Generator",
      editorCallback: async (editor: Editor) => {
        const selectedText = editor.getSelection().trim();
        new ImagePromptModal(
          this.app,
          (input) => {
            void this.handleImageSubmit(
              input.promptText,
              input.sourceText,
              input.selectedModelKey,
            );
          },
          this.modelOptions("image-generation"),
          this.settings.defaultImageModelKey,
          selectedText,
        ).open();
      },
    });

    this.addCommand({
      id: "text-to-speech",
      name: "Open Text to Speech",
      editorCallback: async (editor: Editor) => {
        const selectedText = editor.getSelection().trim();
        new TextToSpeechModal(
          this.app,
          async (input) => {
            const model = this.getModelOrDefault(
              input.selectedModelKey,
              DEFAULT_TTS_MODEL_KEY,
              "tts",
            );
            return this.providerClient.generateSpeech(model, input.text);
          },
          this.modelOptions("tts"),
          this.settings.defaultTtsModelKey,
          selectedText,
        ).open();
      },
    });

    this.addSettingTab(new AiAssistantSettingTab(this.app, this));
  }

  onunload(): void {
    for (const timerId of this.critiqueTimerIds) {
      clearTimeout(timerId);
    }
    this.critiqueTimerIds.clear();
  }

  buildClient(): void {
    this.providerClient = new ProviderClient(
      this.app,
      this.providerKeys(),
      this.settings.debugLogging,
    );
  }

  allModels(): ModelDefinition[] {
    return mergeModelLists(CURATED_MODELS, this.settings.fetchedModels);
  }

  enabledModels(
    capability: ModelCapability,
    provider?: ProviderId,
  ): ModelDefinition[] {
    return this.allModels().filter(
      (model) =>
        modelSupports(model, capability) &&
        (provider === undefined || model.provider === provider) &&
        this.settings.enabledModelKeys[model.key] !== false,
    );
  }

  modelOptions(capability: ModelCapability, provider?: ProviderId): ModelOption[] {
    return this.enabledModels(capability, provider).map((model) => ({
      key: model.key,
      label: this.modelLabel(model),
    }));
  }

  getModelOrDefault(
    requestedKey: string,
    fallbackKey: string,
    capability: ModelCapability,
  ): ModelDefinition {
    const models = this.allModels();
    const requested = models.find(
      (model) => model.key === requestedKey && modelSupports(model, capability),
    );
    if (requested !== undefined) {
      return requested;
    }
    const fallback = models.find(
      (model) => model.key === fallbackKey && modelSupports(model, capability),
    );
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`No model configured for capability: ${capability}`);
  }

  modelLabel(model: ModelDefinition): string {
    const status =
      model.status === "available" ? "" : ` (${model.status.replace("-", " ")})`;
    return `${model.label} - ${PROVIDER_LABELS[model.provider]}${status}`;
  }

  customPrompts(): string[] {
    return [
      this.settings.customPrompt1,
      this.settings.customPrompt2,
      this.settings.customPrompt3,
    ].filter((prompt) => prompt.trim().length > 0);
  }

  quickPromptsWithDefaults(): typeof QUICK_PROMPTS {
    return QUICK_PROMPTS.map((prompt) => {
      if (prompt.id === "fact_check_web") {
        return {
          ...prompt,
          defaultModelKey: this.settings.defaultFactCheckModelKey,
        };
      }
      if (prompt.id === "research_web") {
        return {
          ...prompt,
          defaultModelKey: this.settings.defaultResearchModelKey,
        };
      }
      return prompt;
    });
  }

  async fetchModels(provider: ProviderId): Promise<void> {
    try {
      const fetchedModels = await this.providerClient.fetchModels(provider);
      const otherFetchedModels = this.settings.fetchedModels.filter(
        (model) => model.provider !== provider,
      );
      this.settings.fetchedModels = [...otherFetchedModels, ...fetchedModels];
      for (const model of fetchedModels) {
        if (this.settings.enabledModelKeys[model.key] === undefined) {
          this.settings.enabledModelKeys[model.key] = false;
        }
      }
      await this.saveSettings();
      new Notice(
        `Fetched ${fetchedModels.length} ${PROVIDER_LABELS[provider]} models.`,
      );
    } catch (error) {
      new Notice(
        `Error fetching ${PROVIDER_LABELS[provider]} models: ${errorMessage(error)}`,
      );
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = ((await this.loadData()) ?? {}) as Partial<
      AiAssistantSettings
    > &
      Record<string, unknown>;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      enabledModelKeys: {
        ...DEFAULT_SETTINGS.enabledModelKeys,
        ...(loaded.enabledModelKeys ?? {}),
      },
      fetchedModels: loaded.fetchedModels ?? [],
    };

    if (loaded.defaultTextModelKey === undefined) {
      this.settings.defaultTextModelKey = migrateLegacyModelKey(
        loaded.modelName,
        DEFAULT_TEXT_MODEL_KEY,
      );
    }
    if (loaded.defaultCritiqueModelKey === undefined) {
      this.settings.defaultCritiqueModelKey = migrateLegacyModelKey(
        loaded.critiqueModelName,
        DEFAULT_CRITIQUE_MODEL_KEY,
      );
    }
    if (loaded.defaultImageModelKey === undefined) {
      this.settings.defaultImageModelKey = DEFAULT_IMAGE_MODEL_KEY;
    }
    this.settings.defaultFactCheckModelKey =
      loaded.defaultFactCheckModelKey ?? DEFAULT_FACT_CHECK_MODEL_KEY;
    this.settings.defaultResearchModelKey =
      loaded.defaultResearchModelKey ?? DEFAULT_RESEARCH_MODEL_KEY;
    this.settings.defaultTtsModelKey =
      loaded.defaultTtsModelKey ?? DEFAULT_TTS_MODEL_KEY;

    this.removeObsoleteSettings();
  }

  async saveSettings(): Promise<void> {
    this.removeObsoleteSettings();
    await this.saveData(this.settings);
  }

  private async handlePromptSubmit(
    editor: Editor,
    selectedText: string,
    input: PromptModalSubmit,
  ): Promise<void> {
    let answer: string | undefined;
    try {
      const primaryModel = this.getModelOrDefault(
        input.selectedModelKey,
        DEFAULT_TEXT_MODEL_KEY,
        "text",
      );
      const primaryAssistant = this.providerClient.createTextAssistant(
        primaryModel,
        maxTokensForResponseLength(input.responseLength),
        input.useWebSearch,
      );
      answer = await primaryAssistant.text_api_call([
        {
          role: "user",
          content: buildPromptContent(input.promptText, selectedText),
        },
      ]);
    } catch (error) {
      new Notice(`Error generating response: ${errorMessage(error)}`);
      return;
    }

    if (!answer) {
      new Notice("Model returned an empty response.");
      return;
    }

    this.insertResponse(editor, answer);
    if (!input.critiqueEnabled) {
      return;
    }

    const critiqueInsertPos = editor.getCursor("to");
    new Notice("Preparing critique...");
    const timerId = setTimeout(() => {
      this.critiqueTimerIds.delete(timerId);
      void this.insertCritique(editor, selectedText, input, answer!, critiqueInsertPos);
    }, 7000);
    this.critiqueTimerIds.add(timerId);
  }

  private async insertCritique(
    editor: Editor,
    selectedText: string,
    input: PromptModalSubmit,
    answer: string,
    insertPos: { line: number; ch: number },
  ): Promise<void> {
    try {
      const critiqueModel = this.getModelOrDefault(
        input.selectedCritiqueModelKey,
        DEFAULT_CRITIQUE_MODEL_KEY,
        "text",
      );
      const critiqueAssistant = this.providerClient.createTextAssistant(
        critiqueModel,
        maxTokensForResponseLength(input.responseLength),
      );
      const critique = await critiqueAssistant.text_api_call([
        {
          role: "system",
          content: "You are a rigorous critique assistant. Evaluate AI-generated responses for accuracy, completeness, clarity, and usefulness. Be precise, direct, and constructive. Format your critique as bullet points.",
        },
        {
          role: "user",
          content: `Critique this response. Be precise and direct. Use bullets.

Request:
${input.promptText}

Original text:
${selectedText}

Response:
${answer}

Cover accuracy issues, missing elements, clarity problems, and specific improvements.`,
        },
      ]);
      if (critique) {
        editor.replaceRange(`\n\n---\n**Critique:**\n${critique.trim()}`, insertPos);
        new Notice("Critique completed.");
      } else {
        new Notice("Critique model returned an empty response.");
      }
    } catch (error) {
      new Notice(`Error generating critique: ${errorMessage(error)}`);
    }
  }

  private async handleImageSubmit(
    promptText: string,
    sourceText: string,
    selectedModelKey: string,
  ): Promise<void> {
    const model = this.getModelOrDefault(
      selectedModelKey,
      DEFAULT_IMAGE_MODEL_KEY,
      "image-generation",
    );
    const imagePrompt = buildImagePrompt(promptText, sourceText);
    const images = await this.providerClient.generateImage(model, imagePrompt);
    if (images !== undefined) {
      new ImageModal(this.app, images, imagePrompt, this.settings.imgFolder).open();
    }
  }

  private insertResponse(editor: Editor, response: string): void {
    if (this.settings.replaceSelection) {
      editor.replaceSelection(response.trim());
      return;
    }
    const cursor = editor.getCursor("to");
    editor.replaceRange(`\n${response.trim()}`, cursor);
  }

  private providerKeys(): ProviderKeys {
    return {
      gemini: this.settings.geminiApiKey,
      groq: this.settings.groqApiKey,
      openrouter: this.settings.openRouterApiKey,
      cerebras: this.settings.cerebrasApiKey,
    };
  }

  private removeObsoleteSettings(): void {
    const record = this.settings as unknown as Record<string, unknown>;
    delete record.mySetting;
    delete record.openAIapiKey;
    delete record.anthropicApiKey;
    delete record.modelName;
    delete record.critiqueModelName;
    delete record.imageModelName;
    delete record.language;
  }
}

class AiAssistantSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: AiAssistantPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Assistant Settings" });

    containerEl.createEl("h3", { text: "Providers" });
    this.addApiKeySetting("Gemini API Key", "geminiApiKey");
    this.addApiKeySetting("Groq API Key", "groqApiKey");
    this.addApiKeySetting("OpenRouter API Key", "openRouterApiKey");
    this.addApiKeySetting("Cerebras API Key", "cerebrasApiKey");

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Log provider, model, status, timing, and token usage metadata.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (value) => {
            this.plugin.settings.debugLogging = value;
            await this.plugin.saveSettings();
            this.plugin.buildClient();
          }),
      );

    containerEl.createEl("h3", { text: "Defaults" });
    this.addDefaultModelSetting(
      "Default chat model",
      "defaultTextModelKey",
      "text",
    );
    this.addDefaultModelSetting(
      "Default critique model",
      "defaultCritiqueModelKey",
      "text",
    );
    this.addDefaultModelSetting(
      "Default fact-check model",
      "defaultFactCheckModelKey",
      "text",
    );
    this.addDefaultModelSetting(
      "Default research model",
      "defaultResearchModelKey",
      "text",
    );
    this.addDefaultModelSetting(
      "Default image model",
      "defaultImageModelKey",
      "image-generation",
    );
    this.addDefaultModelSetting(
      "Default text-to-speech model",
      "defaultTtsModelKey",
      "tts",
    );

    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Default maximum generated tokens for normal text responses.")
      .addText((text) =>
        text
          .setPlaceholder("Max tokens")
          .setValue(this.plugin.settings.maxTokens.toString())
          .onChange(async (value) => {
            const intValue = parseInt(value, 10);
            if (!intValue || intValue <= 0) {
              new Notice("Error while parsing max tokens.");
              return;
            }
            this.plugin.settings.maxTokens = intValue;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Prompt behavior")
      .setDesc(
        "When on, replace selected text. When off, keep selected text and add the response below it.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.replaceSelection)
          .onChange(async (value) => {
            this.plugin.settings.replaceSelection = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Image Generation" });
    new Setting(containerEl)
      .setName("Default location for generated images")
      .setDesc("Where generated images are stored.")
      .addText((text) =>
        text
          .setPlaceholder("AiAssistant/Assets")
          .setValue(this.plugin.settings.imgFolder)
          .onChange(async (value) => {
            const path = value.replace(/\/+$/, "");
            if (!path) {
              new Notice("Image folder cannot be empty.");
              return;
            }
            this.plugin.settings.imgFolder = path;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Custom Prompts" });
    this.addCustomPromptSetting("Custom Prompt 1", "customPrompt1");
    this.addCustomPromptSetting("Custom Prompt 2", "customPrompt2");
    this.addCustomPromptSetting("Custom Prompt 3", "customPrompt3");

    containerEl.createEl("h3", { text: "Model Manager" });
    this.addModelRows();
  }

  private addApiKeySetting(
    name: string,
    key: "geminiApiKey" | "groqApiKey" | "openRouterApiKey" | "cerebrasApiKey",
  ): void {
    new Setting(this.containerEl).setName(name).addText((text) => {
      text.inputEl.type = "password";
      text
        .setPlaceholder(`Enter ${name}`)
        .setValue(this.plugin.settings[key])
        .onChange(async (value) => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
          this.plugin.buildClient();
        });
    });
  }

  private addDefaultModelSetting(
    name: string,
    key: ModelDefaultSettingKey,
    capability: ModelCapability,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .addDropdown((dropdown) => {
        const options = this.plugin.modelOptions(capability);
        for (const option of options) {
          dropdown.addOption(option.key, option.label);
        }
        if (!options.some((option) => option.key === this.plugin.settings[key])) {
          const model = this.plugin.getModelOrDefault(
            this.plugin.settings[key],
            defaultKeyForSetting(key),
            capability,
          );
          dropdown.addOption(model.key, this.plugin.modelLabel(model));
        }
        dropdown
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private addCustomPromptSetting(
    name: string,
    key: "customPrompt1" | "customPrompt2" | "customPrompt3",
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc("Appears in prompt mode below the built-in quick prompts.")
      .addText((text) =>
        text
          .setPlaceholder("e.g., Translate to Spanish")
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          }),
      );
  }

  private addModelRows(): void {
    const models = this.plugin.allModels();
    for (const provider of Object.keys(PROVIDER_LABELS) as ProviderId[]) {
      const providerModels = models.filter((model) => model.provider === provider);
      const enabledCount = providerModels.filter(
        (model) => this.plugin.settings.enabledModelKeys[model.key] !== false,
      ).length;
      const details = this.containerEl.createEl("details", {
        cls: "ai-assistant-provider-group",
      }) as HTMLDetailsElement;
      const summary = details.createEl("summary", {
        cls: "ai-assistant-provider-summary",
      });
      summary.createSpan({
        text: `${PROVIDER_LABELS[provider]} (${enabledCount}/${providerModels.length} enabled)`,
      });

      new Setting(details)
        .setName(`Fetch ${PROVIDER_LABELS[provider]} models`)
        .setDesc("Fetched models are added as excluded by default.")
        .addButton((button) =>
          button.setButtonText("Fetch").onClick(async () => {
            await this.plugin.fetchModels(provider);
            this.display();
          }),
        );

      for (const model of providerModels) {
        this.addModelSetting(details, model);
      }
    }
  }

  private addModelSetting(container: HTMLElement, model: ModelDefinition): void {
    const setting = new Setting(container)
        .setName(this.plugin.modelLabel(model))
        .setDesc(modelDescription(model))
        .addToggle((toggle) =>
          toggle
            .setTooltip("Include in model dropdowns")
            .setValue(this.plugin.settings.enabledModelKeys[model.key] !== false)
            .onChange(async (value) => {
              this.plugin.settings.enabledModelKeys[model.key] = value;
              await this.plugin.saveSettings();
            }),
        );

    if (modelSupports(model, "text")) {
      this.addDefaultButton(setting, model, "Chat", "defaultTextModelKey");
      this.addDefaultButton(
        setting,
        model,
        "Critique",
        "defaultCritiqueModelKey",
      );
      this.addDefaultButton(
        setting,
        model,
        "Fact",
        "defaultFactCheckModelKey",
      );
      this.addDefaultButton(
        setting,
        model,
        "Research",
        "defaultResearchModelKey",
      );
    }
    if (modelSupports(model, "image-generation")) {
      this.addDefaultButton(setting, model, "Image", "defaultImageModelKey");
    }
    if (modelSupports(model, "tts")) {
      this.addDefaultButton(setting, model, "TTS", "defaultTtsModelKey");
    }
  }

  private addDefaultButton(
    setting: Setting,
    model: ModelDefinition,
    label: string,
    key: ModelDefaultSettingKey,
  ): void {
    setting.addButton((button) =>
      button.setButtonText(label).onClick(async () => {
        this.plugin.settings[key] = model.key;
        this.plugin.settings.enabledModelKeys[model.key] = true;
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }
}

function maxTokensForResponseLength(
  responseLength: "short" | "normal" | "long",
): number {
  switch (responseLength) {
    case "short":
      return 500;
    case "long":
      return 5000;
    case "normal":
      return 3000;
  }
}

function buildPromptContent(promptText: string, selectedText: string): string {
  if (promptText.includes("{text}")) {
    return promptText.split("{text}").join(selectedText);
  }
  return `${promptText}\n\n${selectedText}`;
}

function buildImagePrompt(promptText: string, sourceText: string): string {
  if (!sourceText) {
    return promptText;
  }
  if (!promptText) {
    return `Create an image inspired by this selected note text:\n\n${sourceText}`;
  }
  return `Use this selected note text as source context:\n\n${sourceText}\n\nImage direction:\n${promptText}`;
}

function defaultKeyForSetting(key: ModelDefaultSettingKey): string {
  switch (key) {
    case "defaultTextModelKey":
      return DEFAULT_TEXT_MODEL_KEY;
    case "defaultCritiqueModelKey":
      return DEFAULT_CRITIQUE_MODEL_KEY;
    case "defaultFactCheckModelKey":
      return DEFAULT_FACT_CHECK_MODEL_KEY;
    case "defaultResearchModelKey":
      return DEFAULT_RESEARCH_MODEL_KEY;
    case "defaultImageModelKey":
      return DEFAULT_IMAGE_MODEL_KEY;
    case "defaultTtsModelKey":
      return DEFAULT_TTS_MODEL_KEY;
  }
}

function migrateLegacyModelKey(
  legacyValue: unknown,
  fallbackKey: string,
): string {
  if (typeof legacyValue !== "string") {
    return fallbackKey;
  }
  if (legacyValue.startsWith("gemini")) {
    return `gemini:${legacyValue}`;
  }
  if (
    legacyValue.includes("llama") ||
    legacyValue.includes("qwen") ||
    legacyValue.includes("deepseek") ||
    legacyValue.includes("gpt-oss") ||
    legacyValue.includes("kimi") ||
    legacyValue.includes("groq")
  ) {
    return `groq:${legacyValue}`;
  }
  return fallbackKey;
}

function modelDescription(model: ModelDefinition): string {
  const warning =
    model.status === "manual"
      ? "Manual/unverified model ID. "
      : model.status === "deprecated-soon"
        ? "Deprecated soon. "
        : "";
  const parameters = model.parameters
    ? ` | parameters: ${JSON.stringify(model.parameters)}`
    : "";
  return `${warning}${model.id} | ${model.source} | ${model.capabilities.join(", ")}${parameters}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeDiagnosticText(error.message);
  }
  return sanitizeDiagnosticText(String(error));
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
