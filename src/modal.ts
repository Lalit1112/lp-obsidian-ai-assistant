import {
  App,
  Component,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
} from "obsidian";
import {
  ChatMessage,
  GeneratedImage,
  ImageContentPart,
  MessageContent,
  TextAssistant,
} from "./openai_api";
import { QuickPromptDefinition } from "./settings";

function generateUniqueId(): string {
  return "_" + Math.random().toString(36).slice(2, 11);
}

const COPY_BUTTON = "Copy";
const DELETE_BUTTON = "Delete";

interface ChatEntry extends ChatMessage {
  id: string;
}

export interface ModelOption {
  key: string;
  label: string;
}

export interface PromptModalConfig {
  modelOptions: ModelOption[];
  critiqueModelOptions: ModelOption[];
  quickPrompts: QuickPromptDefinition[];
  customPrompts: string[];
  defaultModelKey: string;
  defaultCritiqueModelKey: string;
}

export interface PromptModalSubmit {
  promptText: string;
  selectedModelKey: string;
  useWebSearch: boolean;
  critiqueEnabled: boolean;
  selectedCritiqueModelKey: string;
  responseLength: "short" | "normal" | "long";
  quickPromptId?: string;
}

export class PromptModal extends Modal {
  private selectedModelKey: string;
  private selectedCritiqueModelKey: string;
  private critiqueEnabled = false;
  private useWebSearch = false;
  private responseLength: "short" | "normal" | "long" = "normal";
  private selectedQuickPromptId: string | undefined;

  constructor(
    app: App,
    private readonly onSubmit: (input: PromptModalSubmit) => void,
    private readonly config: PromptModalConfig,
  ) {
    super(app);
    this.selectedModelKey = config.defaultModelKey;
    this.selectedCritiqueModelKey = config.defaultCritiqueModelKey;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("What can I do for you?");

    const quickPromptSelect = contentEl.createEl("select", {
      cls: "ai-assistant-full-width",
    });
    quickPromptSelect.createEl("option", {
      value: "",
      text: "Choose a quick prompt or type your own...",
    });
    for (const prompt of this.config.quickPrompts) {
      quickPromptSelect.createEl("option", {
        value: prompt.id,
        text: prompt.label,
      });
    }
    if (this.config.customPrompts.length > 0) {
      quickPromptSelect.createEl("option", {
        value: "",
        text: "----------------",
        attr: { disabled: "true" },
      });
      this.config.customPrompts.forEach((prompt, index) => {
        quickPromptSelect.createEl("option", {
          value: `custom:${index}`,
          text: `Custom ${index + 1}: ${prompt.slice(0, 48)}`,
        });
      });
    }

    const optionsContainer = contentEl.createEl("div", {
      cls: "prompt-options-container",
    });

    const modelSelect = this.createModelSelect(
      optionsContainer,
      "Model",
      this.config.modelOptions,
      this.selectedModelKey,
      (value) => {
        this.selectedModelKey = value;
      },
    );

    const webSearchRow = optionsContainer.createEl("label", {
      cls: "ai-assistant-checkbox-row",
    });
    const webSearchCheckbox = webSearchRow.createEl("input", {
      type: "checkbox",
    });
    webSearchRow.createSpan({
      text: "Enable OpenRouter web search for this prompt",
    });
    webSearchCheckbox.addEventListener("change", () => {
      this.useWebSearch = webSearchCheckbox.checked;
    });

    const critiqueRow = optionsContainer.createEl("label", {
      cls: "ai-assistant-checkbox-row",
    });
    const critiqueCheckbox = critiqueRow.createEl("input", { type: "checkbox" });
    critiqueRow.createSpan({ text: "Enable critique mode" });

    const critiqueModelContainer = optionsContainer.createEl("div", {
      cls: "ai-assistant-hidden-option",
    });
    this.createModelSelect(
      critiqueModelContainer,
      "Critique model",
      this.config.critiqueModelOptions,
      this.selectedCritiqueModelKey,
      (value) => {
        this.selectedCritiqueModelKey = value;
      },
    );

    critiqueCheckbox.addEventListener("change", () => {
      this.critiqueEnabled = critiqueCheckbox.checked;
      critiqueModelContainer.toggleClass(
        "ai-assistant-hidden-option",
        !this.critiqueEnabled,
      );
    });

    const lengthContainer = optionsContainer.createEl("div", {
      cls: "ai-assistant-radio-row",
    });
    lengthContainer.createSpan({ text: "Response length" });
    for (const [value, label] of [
      ["short", "Short"],
      ["normal", "Normal"],
      ["long", "Long"],
    ] as const) {
      const optionLabel = lengthContainer.createEl("label");
      const radio = optionLabel.createEl("input", {
        type: "radio",
        attr: { name: "response_length", value },
      });
      radio.checked = value === "normal";
      optionLabel.createSpan({ text: label });
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.responseLength = value;
        }
      });
    }

    const inputContainer = contentEl.createEl("div", {
      cls: "chat-button-container-right",
    });
    const inputField = inputContainer.createEl("input", {
      placeholder: "Your prompt here",
      type: "text",
    });

    quickPromptSelect.addEventListener("change", () => {
      const selectedValue = quickPromptSelect.value;
      this.selectedQuickPromptId = undefined;
      if (!selectedValue) {
        return;
      }

      if (selectedValue.startsWith("custom:")) {
        const index = Number(selectedValue.replace("custom:", ""));
        inputField.value = this.config.customPrompts[index] ?? "";
      } else {
        const quickPrompt = this.config.quickPrompts.find(
          (prompt) => prompt.id === selectedValue,
        );
        if (quickPrompt !== undefined) {
          this.selectedQuickPromptId = quickPrompt.id;
          inputField.value = quickPrompt.prompt;
          if (quickPrompt.defaultModelKey !== undefined) {
            this.selectedModelKey = quickPrompt.defaultModelKey;
            modelSelect.value = quickPrompt.defaultModelKey;
          }
          this.useWebSearch = quickPrompt.useWebSearch === true;
          webSearchCheckbox.checked = this.useWebSearch;
        }
      }
      inputField.focus();
    });

    inputField.addEventListener("keypress", (evt) => {
      if (evt.key === "Enter") {
        this.submit(inputField.value);
      }
    });

    const submitButton = inputContainer.createEl("button", {
      text: "Send",
      cls: "mod-cta",
    });
    submitButton.addEventListener("click", () => this.submit(inputField.value));

    inputField.focus();
    inputField.select();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(promptText: string): void {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt) {
      return;
    }
    this.close();
    this.onSubmit({
      promptText: trimmedPrompt,
      selectedModelKey: this.selectedModelKey,
      useWebSearch: this.useWebSearch,
      critiqueEnabled: this.critiqueEnabled,
      selectedCritiqueModelKey: this.selectedCritiqueModelKey,
      responseLength: this.responseLength,
      quickPromptId: this.selectedQuickPromptId,
    });
  }

  private createModelSelect(
    container: HTMLElement,
    label: string,
    options: ModelOption[],
    selectedKey: string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const row = container.createEl("div", { cls: "ai-assistant-setting-row" });
    row.createEl("label", { text: label });
    const select = row.createEl("select");
    for (const option of options) {
      const optionEl = select.createEl("option", {
        value: option.key,
        text: option.label,
      });
      optionEl.selected = option.key === selectedKey;
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
}

export interface ImagePromptSubmit {
  promptText: string;
  sourceText: string;
  selectedModelKey: string;
}

export class ImagePromptModal extends Modal {
  private selectedModelKey: string;

  constructor(
    app: App,
    private readonly onSubmit: (input: ImagePromptSubmit) => void,
    private readonly modelOptions: ModelOption[],
    defaultModelKey: string,
    private readonly selectedText: string,
  ) {
    super(app);
    this.selectedModelKey = defaultModelKey;
  }

  onOpen(): void {
    this.titleEl.setText("What image should I generate?");
    const select = this.contentEl.createEl("select", {
      cls: "ai-assistant-full-width",
    });
    for (const option of this.modelOptions) {
      const optionEl = select.createEl("option", {
        value: option.key,
        text: option.label,
      });
      optionEl.selected = option.key === this.selectedModelKey;
    }
    select.addEventListener("change", () => {
      this.selectedModelKey = select.value;
    });

    const inputContainer = this.contentEl.createEl("div", {
      cls: "chat-button-container-right",
    });
    const inputField = inputContainer.createEl("input", {
      placeholder: this.selectedText
        ? "Image direction"
        : "Image prompt",
      type: "text",
    });
    let sourceTextArea: HTMLTextAreaElement | undefined;
    if (this.selectedText) {
      sourceTextArea = this.contentEl.createEl("textarea", {
        cls: "ai-assistant-textarea",
        placeholder: "Selected text context",
      });
      sourceTextArea.value = this.selectedText;
    }
    inputField.addEventListener("keypress", (evt) => {
      if (evt.key === "Enter") {
        this.submit(inputField.value, sourceTextArea?.value ?? "");
      }
    });
    inputContainer
      .createEl("button", { text: "Generate", cls: "mod-cta" })
      .addEventListener("click", () =>
        this.submit(inputField.value, sourceTextArea?.value ?? ""),
      );
    inputField.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(promptText: string, sourceText: string): void {
    const trimmedPrompt = promptText.trim();
    const trimmedSource = sourceText.trim();
    if (!trimmedPrompt && !trimmedSource) {
      return;
    }
    this.close();
    this.onSubmit({
      promptText: trimmedPrompt,
      sourceText: trimmedSource,
      selectedModelKey: this.selectedModelKey,
    });
  }
}

export class ChatModal extends Modal {
  private promptText = "";
  private promptTable: ChatEntry[] = [];
  private isGeneratingAnswer = false;

  constructor(app: App, private readonly aiAssistant: TextAssistant) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("What can I do for you?");
    void this.displayModalContent();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private clearModalContent(): void {
    this.contentEl.empty();
    this.promptText = "";
  }

  private sendAction = async (): Promise<void> => {
    if (!this.promptText || this.isGeneratingAnswer) {
      return;
    }

    this.isGeneratingAnswer = true;
    this.promptTable.push({
      role: "user",
      content: this.promptText,
      id: generateUniqueId(),
    });
    mergeConsecutiveMessages(this.promptTable);

    this.promptTable.push({
      role: "assistant",
      content: "Generating answer...",
      id: generateUniqueId(),
    });

    this.clearModalContent();
    await this.displayModalContent();

    this.promptTable.pop();
    const answers = this.modalEl.getElementsByClassName("chat-div assistant");
    const answer = await this.aiAssistant.text_api_call(
      this.promptTable.map(({ role, content }) => ({ role, content })),
      answers[answers.length - 1] as HTMLElement | undefined,
    );

    if (answer) {
      this.promptTable.push({
        role: "assistant",
        content: answer,
        id: generateUniqueId(),
      });
    }
    this.clearModalContent();
    await this.displayModalContent();
    this.isGeneratingAnswer = false;
  };

  private extractText(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    return content
      .map((part) => (part.type === "text" ? part.text : "[image]"))
      .join("\n");
  }

  private displayModalContent = async (): Promise<void> => {
    const container = this.contentEl.createEl("div", {
      cls: "chat-modal-container",
    });
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const renderComponent: Component = activeView ?? new Component();

    for (const [index, entry] of this.promptTable.entries()) {
      const div = container.createEl("div", {
        cls: `chat-div ${entry.role}`,
        attr: { style: "position: relative" },
      });

      const deleteButton = div.createEl("button", {
        cls: "delete-btn",
        text: DELETE_BUTTON,
        attr: {
          "aria-label": "Delete message",
          title: "Delete message",
          contentEditable: "false",
        },
      });
      const copyButton = div.createEl("button", {
        cls: "copy-btn",
        text: COPY_BUTTON,
        attr: {
          "aria-label": "Copy to clipboard",
          title: "Copy to clipboard",
          contentEditable: "false",
        },
      });

      if (entry.role === "assistant" && typeof entry.content === "string") {
        await MarkdownRenderer.renderMarkdown(
          entry.content,
          div,
          "",
          renderComponent,
        );
      } else {
        this.renderUserContent(div, entry.content);
      }

      div.dataset.entryId = entry.id;
      if (entry.role === "user" && typeof entry.content === "string") {
        div.addEventListener("click", () => {
          div.contentEditable = "true";
        });
        div.addEventListener("input", () => {
          this.promptTable[index].content = div.innerText;
        });
      }

      div.addEventListener("mouseover", () => {
        deleteButton.style.display = "block";
        copyButton.style.display = "block";
      });
      div.addEventListener("mouseout", () => {
        if (div.contentEditable !== "true") {
          deleteButton.style.display = "none";
          copyButton.style.display = "none";
        }
      });
      div.addEventListener("blur", () => {
        div.contentEditable = "false";
        deleteButton.style.display = "none";
        copyButton.style.display = "none";
      });

      deleteButton.addEventListener("click", () => {
        const entryId = div.dataset.entryId;
        div.remove();
        this.promptTable = this.promptTable.filter(
          (candidate) => candidate.id !== entryId,
        );
      });
      copyButton.addEventListener("click", async () => {
        await navigator.clipboard.writeText(this.extractText(entry.content).trim());
        new Notice("Message copied to clipboard");
      });
    }

    const buttonContainer = this.contentEl.createEl("div", {
      cls: "chat-button-container",
    });
    buttonContainer.createEl("p", { text: "Type here:" });
    const rightButtonContainer = buttonContainer.createEl("div", {
      cls: "chat-button-container-right",
    });

    const hiddenFileButton = rightButtonContainer.createEl("input", {
      type: "file",
      cls: "hidden-file",
    });
    hiddenFileButton.setAttribute("accept", ".png, .jpg, .jpeg, .webp");
    hiddenFileButton.addEventListener("change", async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files === null || files.length === 0) {
        return;
      }
      if (!this.aiAssistant.supportsImageInput()) {
        new Notice("The selected chat model does not support image input.");
        return;
      }
      const imagePart = await fileToImagePart(files[0]);
      this.promptTable.push({
        role: "user",
        content: [imagePart],
        id: generateUniqueId(),
      });
      this.clearModalContent();
      await this.displayModalContent();
    });

    rightButtonContainer
      .createEl("button", { text: "Image" })
      .addEventListener("click", () => hiddenFileButton.click());

    const inputField = rightButtonContainer.createEl("input", {
      placeholder: "Your prompt here",
      type: "text",
    });
    inputField.addEventListener("keypress", (evt) => {
      if (evt.key === "Enter") {
        this.promptText = inputField.value.trim();
        void this.sendAction();
      }
    });
    rightButtonContainer
      .createEl("button", { text: "Send", cls: "mod-cta" })
      .addEventListener("click", () => {
        this.promptText = inputField.value.trim();
        void this.sendAction();
      });

    inputField.focus();
    inputField.select();

    const footerContainer = this.contentEl.createEl("div", {
      cls: "chat-button-container-right upper-border",
    });
    footerContainer
      .createEl("button", { text: "Clear" })
      .addEventListener("click", () => {
        this.promptTable = [];
        this.clearModalContent();
        void this.displayModalContent();
      });
    footerContainer
      .createEl("button", { text: "Copy conversation" })
      .addEventListener("click", async () => {
        const conversation = this.promptTable
          .map((entry) => this.extractText(entry.content))
          .join("\n\n");
        await navigator.clipboard.writeText(conversation.trim());
        new Notice("Conversation copied to clipboard");
      });
  };

  private renderUserContent(container: HTMLElement, content: MessageContent): void {
    if (typeof content === "string") {
      container.createEl("p", { text: content });
      return;
    }
    for (const part of content) {
      if (part.type === "text") {
        container.createEl("p", { text: part.text });
      } else {
        const image = container.createEl("img", { cls: "image-modal-image" });
        image.setAttribute("src", part.dataUrl);
      }
    }
  }
}

export class ImageModal extends Modal {
  private readonly selectedImageIndexes = new Set<number>();

  constructor(
    app: App,
    private readonly images: GeneratedImage[],
    private readonly promptText: string,
    private readonly assetFolder: string,
  ) {
    super(app);
    this.titleEl.setText(
      this.images.length === 1 ? "Generated image" : "Generated images",
    );
  }

  onOpen(): void {
    this.contentEl.createEl("p", {
      text:
        this.images.length === 1
          ? "Save this image to your vault and copy its markdown link."
          : "Select one or more images, then save them to your vault and copy markdown links.",
    });
    const promptDetails = this.contentEl.createEl("details");
    promptDetails.createEl("summary", { text: "Prompt used" });
    promptDetails.createEl("pre", { text: this.promptText });

    const container = this.contentEl.createEl("div", {
      cls: "image-modal-container",
    });

    this.images.forEach((generatedImage, index) => {
      const wrapper = container.createEl("div", {
        cls: "image-modal-wrapper",
      });
      const img = wrapper.createEl("img", { cls: "image-modal-image" });
      img.src = generatedImage.dataUrl;
      if (this.images.length === 1) {
        this.selectedImageIndexes.add(index);
        img.style.border = "2px solid var(--interactive-accent)";
      }
      img.addEventListener("click", () => {
        if (this.selectedImageIndexes.has(index)) {
          this.selectedImageIndexes.delete(index);
          img.style.border = "none";
        } else {
          this.selectedImageIndexes.add(index);
          img.style.border = "2px solid var(--interactive-accent)";
        }
      });
    });

    const buttonContainer = this.contentEl.createEl("div", {
      cls: "chat-button-container-right upper-border",
    });
    if (this.images.length > 1) {
      buttonContainer
        .createEl("button", { text: "Select all" })
        .addEventListener("click", () => {
          this.images.forEach((_, index) =>
            this.selectedImageIndexes.add(index),
          );
          container
            .querySelectorAll<HTMLImageElement>(".image-modal-image")
            .forEach((image) => {
              image.style.border = "2px solid var(--interactive-accent)";
            });
        });
    }
    buttonContainer
      .createEl("button", {
        text:
          this.images.length === 1
            ? "Save image and copy link"
            : "Save selected and copy links",
        cls: "mod-cta",
      })
      .addEventListener("click", () => {
        void this.saveSelectedImages();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async saveSelectedImages(): Promise<void> {
    if (this.selectedImageIndexes.size === 0) {
      new Notice("Select at least one image to save.");
      return;
    }
    await ensureFolder(this.app, this.assetFolder);
    const markdownLinks: string[] = [];
    for (const index of this.selectedImageIndexes) {
      const image = this.images[index];
      const savePath = `${this.assetFolder}/${image.filename}`;
      await this.app.vault.adapter.writeBinary(savePath, image.arrayBuffer);
      markdownLinks.push(`![](${savePath})`);
    }
    await navigator.clipboard.writeText(markdownLinks.join("\n\n") + "\n");
    new Notice("Saved selected images and copied markdown links.");
  }
}

export interface TextToSpeechSubmit {
  text: string;
  selectedModelKey: string;
}

export class TextToSpeechModal extends Modal {
  private selectedModelKey: string;

  constructor(
    app: App,
    private readonly onSubmit: (input: TextToSpeechSubmit) => Promise<Blob | undefined>,
    private readonly modelOptions: ModelOption[],
    defaultModelKey: string,
    private readonly selectedText: string,
  ) {
    super(app);
    this.selectedModelKey = defaultModelKey;
  }

  onOpen(): void {
    this.titleEl.setText("Text to Speech");
    const select = this.contentEl.createEl("select", {
      cls: "ai-assistant-full-width",
    });
    for (const option of this.modelOptions) {
      const optionEl = select.createEl("option", {
        value: option.key,
        text: option.label,
      });
      optionEl.selected = option.key === this.selectedModelKey;
    }
    select.addEventListener("change", () => {
      this.selectedModelKey = select.value;
    });

    const textArea = this.contentEl.createEl("textarea", {
      cls: "ai-assistant-textarea",
      placeholder: "Text to speak",
    });
    textArea.value = this.selectedText;
    const button = this.contentEl.createEl("button", {
      text: "Generate audio",
      cls: "mod-cta",
    });
    const audioContainer = this.contentEl.createEl("div");
    button.addEventListener("click", async () => {
      const text = textArea.value.trim();
      if (!text) {
        return;
      }
      button.disabled = true;
      let audioBlob: Blob | undefined;
      try {
        audioBlob = await this.onSubmit({
          text,
          selectedModelKey: this.selectedModelKey,
        });
      } catch (error) {
        new Notice(`Text to speech failed: ${errorMessage(error)}`);
      } finally {
        button.disabled = false;
      }
      if (audioBlob === undefined) {
        return;
      }
      audioContainer.empty();
      const audio = audioContainer.createEl("audio", {
        attr: { controls: "true" },
      });
      audio.src = URL.createObjectURL(audioBlob);
      try {
        await audio.play();
      } catch {
        new Notice("Audio generated. Press play to listen.");
      }
    });
    textArea.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function mergeConsecutiveMessages(promptTable: ChatEntry[]): void {
  for (let index = 1; index < promptTable.length; index++) {
    const current = promptTable[index];
    const previous = promptTable[index - 1];
    if (current.role !== previous.role) {
      continue;
    }
    previous.content = mergeContent(previous.content, current.content);
    promptTable.splice(index, 1);
    index--;
  }
}

function mergeContent(left: MessageContent, right: MessageContent): MessageContent {
  const leftParts = contentToParts(left);
  const rightParts = contentToParts(right);
  const merged = [...leftParts, ...rightParts];
  if (merged.every(isTextPart)) {
    return merged.map((part) => part.text).join("\n");
  }
  return merged;
}

type NormalizedContentPart = ImageContentPart | { type: "text"; text: string };

function contentToParts(content: MessageContent): NormalizedContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function isTextPart(
  part: NormalizedContentPart,
): part is { type: "text"; text: string } {
  return part.type === "text";
}

async function fileToImagePart(file: File): Promise<ImageContentPart> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
  const commaIndex = dataUrl.indexOf(",");
  const semicolonIndex = dataUrl.indexOf(";");
  const mimeStartIndex = dataUrl.indexOf(":");
  return {
    type: "image",
    mimeType: dataUrl.slice(mimeStartIndex + 1, semicolonIndex),
    data: dataUrl.slice(commaIndex + 1),
    dataUrl,
  };
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(currentPath)) {
      await app.vault.createFolder(currentPath);
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
