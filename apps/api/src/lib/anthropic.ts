// Shared Anthropic (Claude) transport seam. Centralizes the request/response
// shape, the LLM_API_KEY lookup + lazy client construction, error normalization,
// and the structured-output cast, so the capture enricher (llm.ts) and the
// digest composer (digest-llm.ts) don't each re-roll it. Inject `createMessage`
// in tests to bypass the SDK + network.

import Anthropic from "@anthropic-ai/sdk";

/** Default model for RWL's LLM calls. Override per-call via LLM_MODEL. */
export const DEFAULT_MODEL = "claude-haiku-4-5";

/** The exact request shape we send. Local (not the SDK's) so `output_config`
 *  (structured outputs) is expressible regardless of SDK type drift. */
export interface LlmRequest {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: string }>;
  output_config?: { format: { type: "json_schema"; schema: Record<string, unknown> } };
}

export interface LlmResponse {
  content: Array<{ type: string; text?: string }>;
}

export type MessageCreateFn = (body: LlmRequest) => Promise<LlmResponse>;

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

/** First text block's text, or "". */
export function firstText(res: LlmResponse): string {
  return res.content.find((b) => b.type === "text" && typeof b.text === "string")?.text ?? "";
}

/** Real transport: lazily constructs the SDK client, validates the key, and
 *  normalizes errors to LlmError with a retryable status. */
export function defaultCreateMessage(apiKeyArg?: string): MessageCreateFn {
  let client: Anthropic | null = null;
  return async (body) => {
    const apiKey = apiKeyArg ?? process.env.LLM_API_KEY;
    if (!apiKey) throw new LlmError("LLM_API_KEY is not set");
    if (!client) client = new Anthropic({ apiKey });
    try {
      // Cast at the single SDK boundary — our LlmRequest carries `output_config`,
      // which not every SDK version types on the non-beta create params; it's
      // still sent on the wire.
      const res = await client.messages.create(
        body as unknown as Anthropic.MessageCreateParamsNonStreaming,
      );
      return res as unknown as LlmResponse;
    } catch (e) {
      throw new LlmError(`Anthropic request failed: ${(e as Error).message}`, (e as { status?: number }).status);
    }
  };
}
