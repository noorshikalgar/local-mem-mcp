import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore, createTestVectorStore } from "../setup.js";
import { SearchEngine } from "../../src/retrieval/search.js";
import type { CodeChunk } from "../../src/types.js";

let store = createTestStore();
let vectorStore = createTestVectorStore();
let engine: SearchEngine;

beforeEach(() => {
  store.close();
  store = createTestStore();
  vectorStore = createTestVectorStore();
  engine = new SearchEngine(store, vectorStore);

  // Seed some chunks
  const chunks: CodeChunk[] = [
    {
      id: "c1", file: "src/auth/auth.service.ts", language: "typescript",
      startLine: 1, endLine: 20,
      chunk: "export class AuthService {\n  async login(username: string, password: string) {\n    return this.http.post('/auth/login', { username, password });\n  }\n}",
      hash: "h1", symbols: ["AuthService", "login"], imports: ["HttpClient"],
      exports: ["AuthService"], embedding: null, lastModified: null,
      gitCommitHash: null, status: "fresh",
    },
    {
      id: "c2", file: "src/auth/role.guard.ts", language: "typescript",
      startLine: 1, endLine: 15,
      chunk: "export class RoleGuard {\n  canActivate(route: ActivatedRouteSnapshot) {\n    const role = route.data['role'];\n    return this.authService.hasRole(role);\n  }\n}",
      hash: "h2", symbols: ["RoleGuard", "canActivate"],
      imports: ["AuthService", "ActivatedRouteSnapshot"],
      exports: ["RoleGuard"], embedding: null, lastModified: null,
      gitCommitHash: null, status: "fresh",
    },
    {
      id: "c3", file: "src/admin/AdminDashboard.tsx", language: "typescript",
      startLine: 1, endLine: 30,
      chunk: "export const AdminDashboard: React.FC = () => {\n  const { user } = useAuth();\n  return <div>Admin Panel</div>;\n};",
      hash: "h3", symbols: ["AdminDashboard", "useAuth"],
      imports: ["react", "useAuth"], exports: ["AdminDashboard"],
      embedding: null, lastModified: null, gitCommitHash: null, status: "fresh",
    },
    {
      id: "c4", file: "src/auth/role.guard.spec.ts", language: "typescript",
      startLine: 1, endLine: 25,
      chunk: "describe('RoleGuard', () => {\n  it('should allow admin', () => {\n    expect(guard.canActivate(adminRoute)).toBe(true);\n  });\n});",
      hash: "h4", symbols: ["RoleGuard"],
      imports: [], exports: [], embedding: null, lastModified: null,
      gitCommitHash: null, status: "fresh",
    },
  ];

  for (const chunk of chunks) {
    store.upsertChunk(chunk);
  }
});

afterEach(() => {
  store.close();
});

describe("SearchEngine", () => {
  it("should find chunks by keyword", async () => {
    const results = await engine.search({ query: "login", limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.file.includes("auth.service"))).toBe(true);
  });

  it("should find chunks by symbol name", async () => {
    const results = await engine.search({ query: "RoleGuard", limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].file).toMatch(/role\.guard/);
  });

  it("should filter out test files when includeTests is false", async () => {
    const results = await engine.search({
      query: "RoleGuard",
      limit: 10,
      includeTests: false,
    });
    expect(results.every((r) => !r.file.includes(".spec."))).toBe(true);
  });

  it("should include test files when includeTests is true", async () => {
    const results = await engine.search({
      query: "RoleGuard",
      limit: 10,
      includeTests: true,
    });
    expect(results.some((r) => r.file.includes(".spec."))).toBe(true);
  });

  it("should filter by file path", async () => {
    const results = await engine.search({
      query: "auth",
      limit: 10,
      fileFilter: "admin",
    });
    expect(results.every((r) => r.file.includes("admin"))).toBe(true);
  });

  it("should limit results", async () => {
    const results = await engine.search({ query: "auth", limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("should return empty for no matches", async () => {
    const results = await engine.search({
      query: "xyznonexistentkeyword",
      limit: 10,
    });
    expect(results).toHaveLength(0);
  });
});
