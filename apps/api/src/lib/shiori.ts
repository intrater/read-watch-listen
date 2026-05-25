// Client for the Shiori SaaS REST API (shiori.sh) — the canonical bookmark
// store. RWL writes only bookmark FACTS here (url, title, saved date); the
// editorial overlay (why-note, R/W/L, consume-time) stays in Postgres.
//
// API verified 2026-05-24: base https://www.shiori.sh, Bearer `shk_…` auth.
//   POST /api/links  { url, title?, read?, created_at? } -> { success, linkId, duplicate? }
// Rate limits: 60 req/min/key, 30/min for link creation; 429 on exceed.

const DEFAULT_BASE_URL = "https://www.shiori.sh";

/** Non-2xx response or transport failure from Shiori. `status` is unset for network errors. */
export class ShioriError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ShioriError";
    this.status = status;
  }
  /** Transient = worth retrying (network error, 429, or 5xx). */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

export interface CreateLinkInput {
  url: string;
  /** Custom title; Shiori auto-extracts one if omitted. */
  title?: string | null;
  /** ISO-8601 override for the saved date (used by the bootstrap import). */
  created_at?: string;
  /** Save as already-read. */
  read?: boolean;
}

export interface CreateLinkResult {
  /** Shiori's link id — stored as captures.shiori_id, the join key. */
  linkId: string;
  /** True when the URL already existed in Shiori (it bumps it to the inbox). */
  duplicate: boolean;
}

/** A bookmark as returned by GET /api/links (the fields the digest pipeline joins on). */
export interface ShioriLink {
  /** Shiori link id — the join key (captures.shiori_id). */
  id: string;
  url: string;
  title: string | null;
  /** ISO-8601 saved date. */
  createdAt: string | null;
}

export interface ListLinksParams {
  /** Only return links created at or after this ISO-8601 instant (the digest poll). */
  since?: string;
  limit?: number;
  offset?: number;
}

export interface ShioriClient {
  createLink(input: CreateLinkInput): Promise<CreateLinkResult>;
  listLinks(params?: ListLinksParams): Promise<ShioriLink[]>;
}

export interface ShioriClientConfig {
  /** Defaults to process.env.SHIORI_TOKEN at call time. */
  token?: string;
  /** Defaults to process.env.SHIORI_API_BASE, then https://www.shiori.sh. */
  baseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function createShioriClient(config: ShioriClientConfig = {}): ShioriClient {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? process.env.SHIORI_API_BASE ?? DEFAULT_BASE_URL;

  return {
    async createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
      const token = config.token ?? process.env.SHIORI_TOKEN;
      if (!token) throw new ShioriError("SHIORI_TOKEN is not set");

      const body: Record<string, unknown> = { url: input.url };
      if (input.title) body.title = input.title;
      if (input.created_at) body.created_at = input.created_at;
      if (input.read != null) body.read = input.read;

      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/api/links`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw new ShioriError(`Shiori request failed: ${(cause as Error).message}`);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ShioriError(
          `Shiori POST /api/links -> ${res.status} ${detail}`.trim(),
          res.status,
        );
      }

      const data = (await res.json()) as {
        linkId?: string;
        duplicate?: boolean;
        success?: boolean;
      };
      if (!data.linkId) {
        throw new ShioriError("Shiori response missing linkId");
      }
      return { linkId: data.linkId, duplicate: Boolean(data.duplicate) };
    },

    async listLinks(params: ListLinksParams = {}): Promise<ShioriLink[]> {
      const token = config.token ?? process.env.SHIORI_TOKEN;
      if (!token) throw new ShioriError("SHIORI_TOKEN is not set");

      const qs = new URLSearchParams();
      if (params.since) qs.set("since", params.since);
      if (params.limit != null) qs.set("limit", String(params.limit));
      if (params.offset != null) qs.set("offset", String(params.offset));
      const suffix = qs.toString() ? `?${qs}` : "";

      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/api/links${suffix}`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
        });
      } catch (cause) {
        throw new ShioriError(`Shiori request failed: ${(cause as Error).message}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ShioriError(`Shiori GET /api/links -> ${res.status} ${detail}`.trim(), res.status);
      }

      // Be defensive about the envelope: array, {links}, or {data}.
      const body = (await res.json()) as unknown;
      const rows: unknown[] = Array.isArray(body)
        ? body
        : Array.isArray((body as { links?: unknown[] }).links)
          ? (body as { links: unknown[] }).links
          : Array.isArray((body as { data?: unknown[] }).data)
            ? (body as { data: unknown[] }).data
            : [];

      const links: ShioriLink[] = [];
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const id = (o.id ?? o.linkId) as string | undefined;
        const url = o.url as string | undefined;
        if (!id || !url) continue; // a link without an id/url can't be joined
        links.push({
          id: String(id),
          url,
          title: typeof o.title === "string" ? o.title : null,
          createdAt: typeof o.created_at === "string" ? o.created_at : null,
        });
      }
      return links;
    },
  };
}
