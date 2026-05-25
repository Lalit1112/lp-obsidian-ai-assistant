export interface DiagnosticLogEntry {
  timestamp: string;
  event: string;
  requestId?: string;
  provider?: string;
  model?: string;
  mode?: string;
  status?: number;
  elapsedMs?: number;
  webSearch?: boolean;
  usage?: unknown;
  error?: string;
  message?: string;
  imageCount?: number;
  bytes?: number;
  rawContentLength?: number;
  textLength?: number;
  promptLength?: number;
}

export const DIAGNOSTIC_LOG_HEADER =
  "# LP Obsidian AI Assistant Diagnostics\n\n" +
  "Safe metadata only. Prompts, selected note text, API keys, and raw provider responses are not logged.\n\n";

const ALLOWED_DETAIL_KEYS = new Set<keyof DiagnosticLogEntry>([
  "requestId",
  "provider",
  "model",
  "mode",
  "status",
  "elapsedMs",
  "webSearch",
  "usage",
  "error",
  "message",
  "imageCount",
  "bytes",
  "rawContentLength",
  "textLength",
  "promptLength",
]);

export function createDiagnosticLogEntry(
  event: string,
  details: Record<string, unknown>,
  now = new Date(),
): DiagnosticLogEntry {
  const entry: DiagnosticLogEntry = {
    timestamp: now.toISOString(),
    event: sanitizeDiagnosticText(event),
  };

  for (const [key, value] of Object.entries(details)) {
    if (!ALLOWED_DETAIL_KEYS.has(key as keyof DiagnosticLogEntry)) {
      continue;
    }
    const normalizedValue = sanitizeDiagnosticValue(value);
    if (normalizedValue !== undefined) {
      (entry as unknown as Record<string, unknown>)[key] = normalizedValue;
    }
  }

  return entry;
}

export function formatDiagnosticLogLine(entry: DiagnosticLogEntry): string {
  return JSON.stringify(entry);
}

export function appendDiagnosticLogEntry(
  currentLogText: string,
  entry: DiagnosticLogEntry,
  maxEntries: number,
): string {
  const header = currentLogText.startsWith(DIAGNOSTIC_LOG_HEADER)
    ? DIAGNOSTIC_LOG_HEADER
    : DIAGNOSTIC_LOG_HEADER;
  const existingEntries = currentLogText
    .split("\n")
    .filter((line) => line.trim().startsWith("{"));
  const nextEntries = [...existingEntries, formatDiagnosticLogLine(entry)].slice(
    -Math.max(maxEntries, 1),
  );
  return `${header}${nextEntries.join("\n")}\n`;
}

export function sanitizeDiagnosticText(text: string): string {
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

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return sanitizeDiagnosticText(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeDiagnosticValue);
  }
  if (typeof value === "object") {
    const sanitizedObject: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
      sanitizedObject[sanitizeDiagnosticText(key)] =
        sanitizeDiagnosticValue(childValue);
    }
    return sanitizedObject;
  }
  return sanitizeDiagnosticText(String(value));
}
