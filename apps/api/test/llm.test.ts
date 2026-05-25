import { describe, it, expect, vi, afterEach } from "vitest";
import { createLlmClient, LlmError } from "../src/lib/llm.js";

// Minimal mirror of the request shape llm.ts sends, for assertions.
interface Body {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: string }>;
  output_config?: { format: { type: string; schema: Record<string, unknown> } };
}
type Res = { content: Array<{ type: string; text?: string }> };

const textRes = (text: string): Res => ({ content: [{ type: "text", text }] });

describe("createLlmClient.draftWhyNote", () => {
  it("returns a single clean line, stripping quotes and extra lines", async () => {
    const createMessage = vi.fn(async () => textRes('  "A sharp take on agent evals."\nIgnored second line'));
    const note = await createLlmClient({ createMessage }).draftWhyNote({
      url: "https://x.test/a",
      title: "Agent evals",
      description: "How to measure agents",
    });
    expect(note).toBe("A sharp take on agent evals.");
  });

  it("wraps untrusted metadata in a delimited block (prompt-injection containment)", async () => {
    const createMessage = vi.fn(async (_body: unknown) => textRes("ok"));
    await createLlmClient({ createMessage }).draftWhyNote({ url: "https://x.test/a", title: "TITLE_X" });

    const body = createMessage.mock.calls[0]![0] as Body;
    const userContent = body.messages[0]!.content;
    expect(userContent).toContain("<page_metadata>");
    expect(userContent).toContain("</page_metadata>");
    expect(userContent).toContain("TITLE_X");
    // Stable voice card is the cacheable system prefix.
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("propagates a retryable LlmError on a 5xx", async () => {
    const createMessage = vi.fn(async () => {
      throw new LlmError("upstream down", 503);
    });
    await expect(
      createLlmClient({ createMessage }).draftWhyNote({ url: "https://x.test/a" }),
    ).rejects.toMatchObject({ retryable: true });
  });
});

describe("createLlmClient.classifyMedium", () => {
  it("parses the structured-output enum", async () => {
    const createMessage = vi.fn(async () => textRes('{"medium":"listen"}'));
    const tag = await createLlmClient({ createMessage }).classifyMedium({ url: "https://x.test/pod" });
    expect(tag).toBe("listen");
  });

  it("requests a json_schema structured output", async () => {
    const createMessage = vi.fn(async (_body: unknown) => textRes('{"medium":"read"}'));
    await createLlmClient({ createMessage }).classifyMedium({ url: "https://x.test/a" });
    const body = createMessage.mock.calls[0]![0] as Body;
    expect(body.output_config?.format.type).toBe("json_schema");
  });

  it("throws LlmError on non-JSON output", async () => {
    const createMessage = vi.fn(async () => textRes("definitely not json"));
    await expect(
      createLlmClient({ createMessage }).classifyMedium({ url: "https://x.test/a" }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("throws LlmError on an out-of-enum medium", async () => {
    const createMessage = vi.fn(async () => textRes('{"medium":"smell"}'));
    await expect(
      createLlmClient({ createMessage }).classifyMedium({ url: "https://x.test/a" }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

describe("createLlmClient default transport", () => {
  const saved = process.env.LLM_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = saved;
  });

  it("throws LlmError when LLM_API_KEY is unset (no network call)", async () => {
    delete process.env.LLM_API_KEY;
    await expect(
      createLlmClient().classifyMedium({ url: "https://x.test/a" }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
