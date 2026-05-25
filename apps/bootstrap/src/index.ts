// Resumable terminal review loop for the bootstrap importer (U13).
//
// parse → LLM-judge (cached) → review candidates with a raw-mode keypress loop
// (a/s/e/q; no TUI dependency, per the U13 review refinement) → import approved
// items. Scores and decisions are persisted on every step, so quitting (`q`) and
// re-running resumes exactly where you left off and never re-bills the LLM or
// re-imports an already-imported item.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { parseBookmarks, type ParsedItem } from "./parse.js";
import {
  createRelevanceJudge,
  judgeItems,
  passesThreshold,
  type Judgment,
} from "./filter.js";
import { ingestApproved, type ApprovedItem } from "./ingest.js";
import { JsonStore } from "./store.js";

interface Decision {
  decision: "approved" | "skipped";
  note: string;
  ingested?: boolean;
}

const DEFAULT_INPUT = fileURLToPath(new URL("../input/bookmarks.json", import.meta.url));
const SCORES_PATH = fileURLToPath(new URL("../.cache/scores.json", import.meta.url));
const DECISIONS_PATH = fileURLToPath(new URL("../.cache/decisions.json", import.meta.url));

function readKey(): Promise<string> {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const onKey = (strKey: string, key: readline.Key): void => {
      if (key?.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      cleanup();
      resolve((key?.name ?? strKey ?? "").toLowerCase());
    };
    const cleanup = (): void => {
      process.stdin.off("keypress", onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
  });
}

function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

function render(item: ParsedItem, j: Judgment, position: string): void {
  const verdict = j.relevant ? "relevant" : "not relevant";
  process.stdout.write(
    `\n${position}  ${verdict} · ${j.confidence.toFixed(2)} · ${j.primaryTopic}\n` +
      `  ${item.url}\n` +
      `  "${item.tweetText.replace(/\s+/g, " ").slice(0, 140)}"\n` +
      `  why: ${j.whyDraft || "(none drafted)"}\n\n` +
      `  [a] approve   [s] skip   [e] edit note   [q] save & quit\n`,
  );
}

async function main(): Promise<void> {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (e) {
    console.error(`Could not read export at ${inputPath}: ${(e as Error).message}`);
    console.error("Export your X bookmarks to JSON (see README) and drop them there.");
    process.exit(1);
  }

  const items = parseBookmarks(raw);
  console.error(`Parsed ${items.length} bookmark(s) from ${inputPath}`);
  if (items.length === 0) process.exit(0);

  const scores = new JsonStore<Judgment>(SCORES_PATH);
  const decisions = new JsonStore<Decision>(DECISIONS_PATH);

  // 1. Judge everything (reusing cached scores).
  let judged = 0;
  const judgments = await judgeItems(items, createRelevanceJudge(), scores, (_i, _j, fromCache) => {
    judged += 1;
    if (!fromCache) process.stderr.write(`\rjudged ${judged}/${items.length}`);
  });
  process.stderr.write("\n");

  // 2. Candidates: relevant && confidence >= threshold, awaiting a decision.
  const candidates = items.filter((it) => passesThreshold(judgments.get(it.tweetId)!));
  const pending = candidates.filter((it) => !decisions.has(it.tweetId));
  console.error(
    `${candidates.length} candidate(s) above threshold; ${pending.length} awaiting review.`,
  );

  // 3. Review loop.
  let quit = false;
  for (let i = 0; i < pending.length && !quit; i++) {
    const item = pending[i]!;
    const j = judgments.get(item.tweetId)!;
    render(item, j, `[${i + 1}/${pending.length}]`);

    let decided = false;
    while (!decided) {
      const key = await readKey();
      switch (key) {
        case "a":
          decisions.set(item.tweetId, { decision: "approved", note: j.whyDraft });
          decided = true;
          break;
        case "s":
          decisions.set(item.tweetId, { decision: "skipped", note: "" });
          decided = true;
          break;
        case "e": {
          const note = await readLine(`  note [${j.whyDraft}]: `);
          decisions.set(item.tweetId, {
            decision: "approved",
            note: note.trim() || j.whyDraft,
          });
          decided = true;
          break;
        }
        case "q":
          quit = true;
          decided = true;
          break;
        default:
          process.stdout.write("  (a / s / e / q)\n");
      }
    }
  }

  // 4. Import approved-but-not-yet-imported items. Re-runs retry only failures.
  const toIngest: ApprovedItem[] = [];
  for (const item of candidates) {
    const d = decisions.get(item.tweetId);
    if (d?.decision === "approved" && !d.ingested) toIngest.push({ item, note: d.note });
  }

  if (toIngest.length > 0) {
    console.error(`\nImporting ${toIngest.length} approved item(s) to Shiori…`);
    const result = await ingestApproved(toIngest, {
      onSuccess: (tweetId) => {
        const d = decisions.get(tweetId)!;
        decisions.set(tweetId, { ...d, ingested: true });
      },
    });
    console.error(`Imported ${result.succeeded.length}; ${result.failed.length} failed.`);
    for (const f of result.failed) console.error(`  ✗ ${f.tweetId}: ${f.error}`);
    if (result.failed.length > 0) console.error("Re-run to retry the failures.");
  } else {
    console.error("\nNothing new to import.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
