import { defineConfig } from "astro/config";

// Static output (Astro default). The site is rebuilt on publish and reads the
// RWL corpus from Shiori at build time. The @astrojs/vercel adapter is added at
// the deploy step (M1/U-S4) — not needed for local builds.
export default defineConfig({
  site: "https://rwl.johnintrater.com",
});
