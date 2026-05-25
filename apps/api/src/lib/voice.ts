// Loads the committed voice library (docs/voice/) for the digest composer.
//
// docs/voice/ is the canonical, PR-reviewed source of John's voice (plan:
// "versioned, treated as source code"). The composer takes the loaded strings as
// parameters, so it stays pure/testable; only this loader touches the filesystem.
//
// NOTE (Vercel bundling): docs/voice/ lives outside apps/api, so when the
// daily-digest cron is actually deployed (U6/U12), the voice files must be bundled
// into the function — via `includeFiles` in vercel.json, or by relocating/copying
// the voice library under apps/api at build. Local runs and tests read it directly.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Voice {
  card: string;
  samples: string[];
}

// apps/api/src/lib/voice.ts → repo root is four levels up.
const VOICE_DIR = fileURLToPath(new URL("../../../../docs/voice/", import.meta.url));

export function loadVoice(dir: string = VOICE_DIR): Voice {
  const card = readFileSync(`${dir}/voice-card.md`, "utf8");
  const samplesDir = `${dir}/samples`;
  const samples = readdirSync(samplesDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => readFileSync(`${samplesDir}/${f}`, "utf8"));
  return { card, samples };
}
