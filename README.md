# LP Obsidian AI Assistant

LP Obsidian AI Assistant is an Obsidian plugin for working with Gemini, Groq,
OpenRouter, Cerebras, and LM Studio-hosted models directly from your notes.

## Features

- Text chat and selected-text prompt workflows.
- Explicit provider/model routing for Gemini, Groq, OpenRouter, Cerebras, and
  LM Studio.
- Curated model catalog with optional provider model refresh from settings.
- Quick prompts for grammar/readability, markdown structure, web fact checking,
  web research, research-backed logic, and writing coaching.
- Image generation with Gemini and OpenRouter image-capable models.
- Text-to-speech with Gemini and OpenRouter TTS-capable models.
- Optional critique mode with a separate critique model.
- Safe diagnostics log and request status notices for troubleshooting.

## Quick Start

1. Install and enable the plugin.
2. Open plugin settings and add API keys for the providers you want to use.
3. Expand Model Manager, enable the models you want in dropdowns, and set
   defaults for chat, critique, fact check, research, image, and TTS.
4. Set hotkeys in Obsidian Settings -> Hotkeys. Search for:
   - `Open Assistant Chat`
   - `Open Assistant Prompt`
   - `Open Image Generator`
   - `Open Text to Speech`

## How To Use

### Open Assistant Chat

Use this for a normal AI conversation. It uses the default chat model. Image
upload is available only when the selected chat model supports image input.

### Open Assistant Prompt

Select text in a note, then run this command. Choose a model, optional web
search, optional critique, response length, and a quick prompt.

Built-in quick prompts:

- Fix grammar, spelling, and readability.
- Suggest markdown or structure improvements.
- Organize rough thoughts into clearer writing.
- Suggest ways to continue writing.
- Find studies or research to support my logic.
- Writing coach: score and teach me to improve.
- Fact check on web.
- Research on web.

Useful options:

- Model: choose which enabled text model handles this prompt.
- OpenRouter web search: adds OpenRouter native web search for this one request.
- Critique mode: after the first answer, runs a second model to critique it.
- Response length: controls the max output size for that request.

Fact-check defaults to Groq Compound. Research defaults to OpenRouter Grok 4.3.

### Open Image Generator

Select text in a note, then run this command. The selected text is used as source
context. Add an optional image direction, choose an image model, and generate.

After generation:

- Click an image to select or unselect it.
- Use `Save image and copy link` for one image.
- If a provider returns multiple images, use `Select all` or select specific
  images, then `Save selected and copy links`.
- Images are saved to the configured vault folder and markdown embeds are copied
  to the clipboard.

### Open Text to Speech

Select text in a note, then run this command. The text area is prefilled with
your selection. Edit it if needed, choose a TTS model, and generate playable
audio in the modal.

Current audio playback is in the modal only; generated audio is not saved to the
vault yet.

## Settings

### Providers

Configure API keys for:

- Gemini
- Groq
- OpenRouter
- Cerebras

LM Studio does not require an API key. Start the LM Studio server, confirm its
OpenAI-compatible base URL, then set `LM Studio base URL` if it differs from
`http://localhost:1234/v1`.

Direct OpenAI and Anthropic API keys are not used. OpenAI- or Anthropic-family
models can still be used when routed through OpenRouter model IDs.

### Defaults

The plugin supports separate defaults for:

- Chat
- Critique
- Fact check
- Research
- Image generation
- Text to speech

Current built-in defaults:

- Chat: Cerebras `zai-glm-4.7`
- Critique: Groq `groq/compound`
- Fact check: Groq `groq/compound`
- Research: OpenRouter `x-ai/grok-4.3`
- Image: Gemini `gemini-3-pro-image-preview`
- Text to speech: Gemini `gemini-3.1-flash-tts-preview`

### Model Manager

The model manager groups curated and fetched models by provider. Expand a
provider section to manage its models. You can:

- Fetch current models per provider.
- Include or exclude models from dropdowns.
- Set task-specific defaults.
- See warning labels for manual/unverified and deprecated-soon models.

Fetched models are excluded by default so large provider catalogs do not crowd
the dropdowns unless you opt in.

OpenRouter-routed OpenAI, Anthropic, xAI, and other model IDs are supported
through OpenRouter. Direct OpenAI and Anthropic API keys are not used.

For LM Studio, start the server first, then use `Fetch LM Studio models` so the
plugin can add the currently available local or network-hosted models.

### Debug Logging

The plugin writes a safe diagnostic log to
`AiAssistant/Logs/diagnostics.md` by default. It records provider, model,
request mode, response status, timing, token usage where available, and
sanitized errors. It does not log API keys, full prompts, selected note text, or
raw response bodies.

Settings also include:

- Request status notices: shows when a request is sent and when the response is
  OK. Provider errors still show as normal Obsidian notices.
- Debug logging: mirrors the same safe metadata to the Obsidian developer
  console.
- Diagnostic log file: change, open, or clear the log file.

## Installation

1. `cd path/to/vault/.obsidian/plugins`
2. `git clone https://github.com/Lalit1112/lp-obsidian-ai-assistant.git`
3. `cd lp-obsidian-ai-assistant`
4. `npm install`
5. `npm run build`
6. Enable the plugin from Obsidian Preferences -> Community plugins.

## Requirements

- Gemini API key: <https://ai.google.dev/gemini-api/docs/api-key>
- Groq API key: <https://console.groq.com/keys>
- OpenRouter API key: <https://openrouter.ai/settings/keys>
- Cerebras API key: <https://cloud.cerebras.ai/>
- LM Studio server: <https://lmstudio.ai/docs/developer/core/server>

## Notes

- The image modal can display multiple images because some providers may return
  multiple image outputs. The plugin currently sends one image request to one
  selected model at a time.
- Generating variants from the same model or comparing two image models in one
  run is possible as a future workflow, but it is not implemented yet.
