// Daily digest composer LLM (U5). Two calls, kept separate per research: a cheap
// "cluster" pass (suggests a connective theme, best-effort) and the voice-primed
// composer (voice card + anchor samples + items → markdown). Built on the shared
// Anthropic seam (lib/anthropic.ts); injectable for tests.

import type { Voice } from "./voice.js";
import {
  DEFAULT_MODEL,
  LlmError,
  defaultCreateMessage,
  firstText,
  type MessageCreateFn,
} from "./anthropic.js";
import {
  SIGNATURE,
  buildComposeSystem,
  buildComposeUser,
  type DigestComposeItem,
} from "../prompts/digest-compose.js";
import { CLUSTER_SYSTEM, CLUSTER_SCHEMA, buildClusterUser } from "../prompts/cluster.js";

export type { DigestComposeItem };
export { SIGNATURE };

export interface DigestComposer {
  /** Suggest a one-line connective theme, or null. Best-effort — never throws. */
  clusterItems(items: DigestComposeItem[]): Promise<string | null>;
  /** Compose the digest markdown. Throws LlmError on failure. */
  composeDigest(input: {
    voice: Voice;
    items: DigestComposeItem[];
    theme?: string | null;
  }): Promise<string>;
}

export interface DigestComposerConfig {
  apiKey?: string;
  model?: string;
  createMessage?: MessageCreateFn;
}

export function createDigestComposer(config: DigestComposerConfig = {}): DigestComposer {
  const model = config.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  const createMessage = config.createMessage ?? defaultCreateMessage(config.apiKey);

  return {
    async clusterItems(items) {
      try {
        const res = await createMessage({
          model,
          max_tokens: 64,
          system: [{ type: "text", text: CLUSTER_SYSTEM }],
          messages: [{ role: "user", content: buildClusterUser(items) }],
          output_config: { format: { type: "json_schema", schema: CLUSTER_SCHEMA } },
        });
        const parsed = JSON.parse(firstText(res).trim()) as { theme?: unknown };
        const theme = typeof parsed.theme === "string" ? parsed.theme.trim() : "";
        return theme || null;
      } catch {
        return null; // best-effort: a failed/garbled cluster pass just means "no theme"
      }
    },

    async composeDigest({ voice, items, theme }) {
      const res = await createMessage({
        model,
        max_tokens: 2048,
        system: [
          { type: "text", text: buildComposeSystem(voice), cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: buildComposeUser(items, theme) }],
      });
      const body = firstText(res).trim();
      if (!body) throw new LlmError("digest composer returned an empty body");
      // Guarantee the attribution line even if the model omits it.
      return body.includes(SIGNATURE) ? body : `${body}\n\n${SIGNATURE}`;
    },
  };
}
