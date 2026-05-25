// Anthropic (Claude) client for capture enrichment (U4). Two best-effort jobs:
//   - draftWhyNote: a one-line "why" note in the curator's voice
//   - classifyMedium: resolve an ambiguous R/W/L medium
//
// "Assembled by Claude" — the LLM_API_KEY is an Anthropic key (plan, locked
// 2026-05-24). Model is LLM_MODEL or the default below.
//
// Model default — claude-haiku-4-5: this is a high-frequency, latency-sensitive
// background job (fires per capture via waitUntil), and the plan frames both
// calls as "cheap" with a tight LLM cost ceiling (~$5-10/mo). Haiku 4.5 is fast,
// cheap, and supports structured outputs, which is the right fit. Override with
// LLM_MODEL=claude-opus-4-7 (etc.) for higher-quality note voice.
//
// No `thinking`/`effort`: Haiku 4.5 errors on `effort`, and these are simple
// generation/classification tasks that don't benefit from extended thinking.
//
// Injectable for tests: pass `createMessage` to avoid constructing the real SDK
// client or hitting the network. Mirrors lib/shiori.ts's fetchImpl seam.

import Anthropic from "@anthropic-ai/sdk";
import type { RwlMedium } from "../types.js";
import { WHY_ASSIST_SYSTEM, buildWhyAssistUser } from "../prompts/why-assist.js";
import { CLASSIFY_SYSTEM, buildClassifyUser } from "../prompts/classify.js";

const DEFAULT_MODEL = "claude-haiku-4-5";

/** Failure from the LLM. `status` is unset for non-HTTP errors. */
export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
  /** Transient = worth retrying (network error, 429, or 5xx). */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

export interface PageFacts {
  url: string;
  title?: string | null;
  description?: string | null;
}

export interface LlmClient {
  /** One-line "why" note in the curator's voice. Throws LlmError on failure. */
  draftWhyNote(facts: PageFacts): Promise<string>;
  /** Resolve R/W/L medium for an ambiguous URL. Throws LlmError on failure. */
  classifyMedium(facts: PageFacts): Promise<RwlMedium>;
}

/** The exact request shape we send. Kept local so SDK type drift on
 *  `output_config` (structured outputs) doesn't break the build. */
interface LlmMessageRequest {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: string }>;
  output_config?: { format: { type: "json_schema"; schema: Record<string, unknown> } };
}

type MessageCreateFn = (
  body: LlmMessageRequest,
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export interface LlmConfig {
  /** Defaults to process.env.LLM_API_KEY at call time. */
  apiKey?: string;
  /** Defaults to process.env.LLM_MODEL, then claude-haiku-4-5. */
  model?: string;
  /** Injectable for tests — bypasses the real SDK + network. */
  createMessage?: MessageCreateFn;
}

// Structured-output schema constraining the classifier to a single enum value.
const MEDIUM_SCHEMA = {
  type: "object",
  properties: { medium: { type: "string", enum: ["read", "watch", "listen"] } },
  required: ["medium"],
  additionalProperties: false,
} as const;

function firstText(res: { content: Array<{ type: string; text?: string }> }): string {
  const block = res.content.find((b) => b.type === "text" && typeof b.text === "string");
  return block?.text ?? "";
}

/** Default message sender: lazily constructs the SDK client, validates the key,
 *  and normalizes errors to LlmError with a retryable status. */
function defaultCreateMessage(apiKeyArg?: string): MessageCreateFn {
  let client: Anthropic | null = null;
  return async (body) => {
    const apiKey = apiKeyArg ?? process.env.LLM_API_KEY;
    if (!apiKey) throw new LlmError("LLM_API_KEY is not set");
    if (!client) client = new Anthropic({ apiKey });
    try {
      // Cast at the single SDK boundary: our LlmMessageRequest carries
      // `output_config` (structured outputs), which not every SDK version types
      // on the non-beta create params. The field is still sent on the wire.
      const res = await client.messages.create(
        body as unknown as Anthropic.MessageCreateParamsNonStreaming,
      );
      return res as unknown as { content: Array<{ type: string; text?: string }> };
    } catch (e) {
      const status = (e as { status?: number }).status;
      throw new LlmError(`Anthropic request failed: ${(e as Error).message}`, status);
    }
  };
}

export function createLlmClient(config: LlmConfig = {}): LlmClient {
  const model = config.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  const createMessage = config.createMessage ?? defaultCreateMessage(config.apiKey);

  return {
    async draftWhyNote(facts) {
      const res = await createMessage({
        model,
        max_tokens: 256,
        // Stable voice card first (cacheable prefix), volatile metadata in the
        // user turn. cache_control engages once the prefix exceeds the model's
        // minimum cacheable size; harmless below it.
        system: [{ type: "text", text: WHY_ASSIST_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildWhyAssistUser(facts) }],
      });
      // Collapse to a single clean line; strip wrapping quotes the model may add.
      const line = firstText(res).trim().split(/\r?\n/)[0]!.trim().replace(/^["']|["']$/g, "");
      return line.slice(0, 280);
    },

    async classifyMedium(facts) {
      const res = await createMessage({
        model,
        max_tokens: 64,
        system: [{ type: "text", text: CLASSIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildClassifyUser(facts) }],
        output_config: { format: { type: "json_schema", schema: MEDIUM_SCHEMA } },
      });
      const text = firstText(res).trim();
      let parsed: { medium?: unknown };
      try {
        parsed = JSON.parse(text) as { medium?: unknown };
      } catch {
        throw new LlmError(`classify returned non-JSON: ${text.slice(0, 80)}`);
      }
      const m = parsed.medium;
      if (m === "read" || m === "watch" || m === "listen") return m;
      throw new LlmError(`classify returned an unexpected medium: ${String(m)}`);
    },
  };
}
