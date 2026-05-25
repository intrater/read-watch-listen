// Crash-safe JSON-file store backing the resumable score + decision caches.
// Every set() flushes to disk so a mid-run quit (or crash) loses nothing — the
// whole point of U13's "quit anytime, re-run, picks up where it left off".

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export class JsonStore<T> {
  private data: Record<string, T>;

  constructor(private readonly path: string) {
    this.data = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, T>)
      : {};
  }

  get(key: string): T | undefined {
    return this.data[key];
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  set(key: string, value: T): void {
    this.data[key] = value;
    this.flush();
  }

  entries(): Array<[string, T]> {
    return Object.entries(this.data);
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
