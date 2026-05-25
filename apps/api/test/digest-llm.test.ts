import { describe, it, expect, vi } from "vitest";
import { createDigestComposer, SIGNATURE } from "../src/lib/digest-llm.js";
import {
  buildComposeSystem,
  buildComposeUser,
  type DigestComposeItem,
} from "../src/prompts/digest-compose.js";
import type { Voice } from "../src/lib/voice.js";

const voice: Voice = { card: "VOICE_CARD_TEXT", samples: ["SAMPLE_ONE", "SAMPLE_TWO"] };

const item = (over: Partial<DigestComposeItem> = {}): DigestComposeItem => ({
  url: "https://example.com/a",
  title: "A Title",
  note: "why it matters",
  rwlTag: "read",
  consumeMinutes: 8,
  ...over,
});

const textRes = (text: string) => ({ content: [{ type: "text", text }] });

describe("buildComposeSystem / buildComposeUser", () => {
  it("embeds the voice card, the anchor samples, and the exact signature instruction", () => {
    const sys = buildComposeSystem(voice);
    expect(sys).toContain("VOICE_CARD_TEXT");
    expect(sys).toContain("SAMPLE_ONE");
    expect(sys).toContain("SAMPLE_TWO");
    expect(sys).toContain(SIGNATURE);
  });

  it("lists items in a delimited block and threads an optional theme", () => {
    const user = buildComposeUser([item({ title: "First" }), item({ title: "Second" })], "agents week");
    expect(user).toContain("<items>");
    expect(user).toContain("</items>");
    expect(user).toContain("First");
    expect(user).toContain("Second");
    expect(user).toContain("agents week");
  });
});

describe("createDigestComposer.composeDigest", () => {
  it("returns the model's markdown unchanged when it already has the signature", async () => {
    const body = `## Read\n- [A](https://x) — why\n\n${SIGNATURE}`;
    const composer = createDigestComposer({ createMessage: vi.fn(async () => textRes(body)) });
    expect(await composer.composeDigest({ voice, items: [item()] })).toBe(body);
  });

  it("appends the signature when the model omits it", async () => {
    const composer = createDigestComposer({ createMessage: vi.fn(async () => textRes("## Read\n- x")) });
    const out = await composer.composeDigest({ voice, items: [item()] });
    expect(out.endsWith(SIGNATURE)).toBe(true);
  });

  it("throws on an empty body", async () => {
    const composer = createDigestComposer({ createMessage: vi.fn(async () => textRes("   ")) });
    await expect(composer.composeDigest({ voice, items: [item()] })).rejects.toThrow();
  });

  it("primes the call with the voice system prompt and the items", async () => {
    const createMessage = vi.fn(async (_b: unknown) => textRes(`body\n${SIGNATURE}`));
    await createDigestComposer({ createMessage }).composeDigest({ voice, items: [item({ title: "Xyz" })] });
    const body = createMessage.mock.calls[0]![0] as {
      system: Array<{ text: string }>;
      messages: Array<{ content: string }>;
    };
    expect(body.system[0]!.text).toContain("VOICE_CARD_TEXT");
    expect(body.messages[0]!.content).toContain("Xyz");
  });
});

describe("createDigestComposer.clusterItems", () => {
  it("returns the parsed theme", async () => {
    const composer = createDigestComposer({ createMessage: vi.fn(async () => textRes('{"theme":"agents"}')) });
    expect(await composer.clusterItems([item(), item(), item()])).toBe("agents");
  });

  it("maps an empty theme to null", async () => {
    const composer = createDigestComposer({ createMessage: vi.fn(async () => textRes('{"theme":""}')) });
    expect(await composer.clusterItems([item()])).toBeNull();
  });

  it("is best-effort — a thrown call or bad JSON yields null, never throws", async () => {
    const thrower = createDigestComposer({
      createMessage: vi.fn(async () => {
        throw new Error("503");
      }),
    });
    expect(await thrower.clusterItems([item()])).toBeNull();

    const garbled = createDigestComposer({ createMessage: vi.fn(async () => textRes("not json")) });
    expect(await garbled.clusterItems([item()])).toBeNull();
  });
});
