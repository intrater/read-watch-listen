import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockEnd = vi.fn();

// Mock pg so the unit test never touches a real database.
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: mockQuery, end: mockEnd })),
}));

beforeEach(() => {
  vi.resetModules(); // fresh module each test -> fresh memoized pool
  mockQuery.mockReset();
  mockEnd.mockReset();
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
});

describe("db", () => {
  it("query delegates text and params to the pool", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mockQuery.mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });

    const { query } = await import("../src/lib/db.js");
    const res = await query<{ ok: number }>("SELECT 1 AS ok");

    expect(mockQuery).toHaveBeenCalledWith("SELECT 1 AS ok", undefined);
    expect(res.rows[0]?.ok).toBe(1);
  });

  it("getPool throws a clear error when DATABASE_URL is unset", async () => {
    const { getPool } = await import("../src/lib/db.js");
    expect(() => getPool()).toThrow(/DATABASE_URL/);
  });
});
