import { describe, it, expect } from "vitest";
import { rerankResults } from "../../src/retrieval/rerank.js";
import type { SearchResult, ExtractedEntities } from "../../src/types.js";

const baseResults: SearchResult[] = [
  {
    file: "src/auth/auth.service.ts", startLine: 1, endLine: 20,
    score: 0.5, whyMatched: "keyword", codeSnippet: "export class AuthService {}",
    status: "fresh",
  },
  {
    file: "src/admin/AdminDashboard.tsx", startLine: 1, endLine: 30,
    score: 0.4, whyMatched: "keyword", codeSnippet: "export const AdminDashboard = () => {}",
    status: "fresh",
  },
  {
    file: "src/routes/admin.routes.ts", startLine: 1, endLine: 10,
    score: 0.3, whyMatched: "keyword", codeSnippet: "export const adminRoutes = []",
    status: "fresh",
  },
];

describe("rerankResults", () => {
  it("should boost exact filename match", () => {
    const entities: ExtractedEntities = {
      entities: [], possibleModules: [], symbols: ["AdminDashboard"], files: [],
    };
    const results = rerankResults(baseResults, {
      userQuery: "AdminDashboard",
      entities,
    });
    expect(results[0].file).toBe("src/admin/AdminDashboard.tsx");
  });

  it("should boost recently changed files", () => {
    const entities: ExtractedEntities = {
      entities: [], possibleModules: [], symbols: [], files: [],
    };
    const results = rerankResults(baseResults, {
      userQuery: "auth",
      entities,
      changedFiles: ["src/auth/auth.service.ts"],
    });
    expect(results[0].file).toBe("src/auth/auth.service.ts");
  });

  it("should boost module matches", () => {
    const entities: ExtractedEntities = {
      entities: [], possibleModules: ["admin"], symbols: [], files: [],
    };
    const results = rerankResults(baseResults, {
      userQuery: "admin dashboard",
      entities,
    });
    expect(results[0].file).toMatch(/admin/);
  });

  it("should not change order if no boosting factors present", () => {
    const entities: ExtractedEntities = {
      entities: [], possibleModules: [], symbols: [], files: [],
    };
    const results = rerankResults(baseResults, {
      userQuery: "something completely different",
      entities,
    });
    expect(results[0].score).toBe(baseResults[0].score);
  });
});
