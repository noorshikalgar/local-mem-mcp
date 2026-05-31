import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Indexer } from "../../src/watcher/indexer.js";
import { SQLiteStore } from "../../src/stores/sqlite-store.js";
import { SqliteGraphStore } from "../../src/stores/graph-store.js";
import { NoOpVectorStore } from "../../src/stores/vector-store.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { SearchEngine } from "../../src/retrieval/search.js";
import type { IndexConfig } from "../../src/types.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-mcp-e2e-"));
  fs.writeFileSync(path.join(dir, "auth.service.ts"), `
import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";

export interface User {
  id: number;
  name: string;
}

export class AuthService {
  private token: string = "";
  login(username: string, password: string): Promise<string> {
    return fetch("/api/auth/login", { method: "POST" }).then(r => r.text());
  }
  logout(): void { this.token = ""; }
}
`);
  fs.writeFileSync(path.join(dir, "user.model.ts"), `
export interface User {
  id: number;
  email: string;
  role: "admin" | "user";
}

export function createUser(data: Partial<User>): User {
  return { id: Date.now(), email: "", role: "user", ...data };
}
`);
  fs.writeFileSync(path.join(dir, "admin.guard.ts"), `
import { AuthService } from "./auth.service";

export function canAccessAdmin(user: { role: string }): boolean {
  return user.role === "admin";
}
`);
  return dir;
}

describe("Pipeline end-to-end", () => {
  let projectDir: string;
  let store: SQLiteStore;
  let pipeline: RetrievalPipeline;
  let searchEngine: SearchEngine;

  beforeAll(async () => {
    projectDir = createTempProject();
    const dbPath = path.join(projectDir, "test.db");
    store = new SQLiteStore({ dbPath });
    const vectorStore = new NoOpVectorStore();
    const graphStore = new SqliteGraphStore(store);
    const config: IndexConfig = {
      projectRoot: projectDir,
      includePatterns: ["**/*.ts"],
      excludePatterns: ["node_modules/**", "dist/**"],
      maxFileSize: 1024 * 100,
      chunkSize: 50,
      chunkOverlap: 5,
      useGit: false,
      useFileWatcher: false,
      embeddingProvider: "none",
      embeddingModel: "bge-small",
    };

    // Index the project first
    const indexer = new Indexer(store, vectorStore, graphStore, config);
    await indexer.indexProject();

    pipeline = new RetrievalPipeline(store, vectorStore, graphStore, config);
    searchEngine = new SearchEngine(store, vectorStore);
  });

  afterAll(() => {
    store.close();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("should retrieve context for authentication task", async () => {
    const pack = await pipeline.retrieveContext("auth service login");

    expect(pack.task).toBe("auth service login");
    expect(pack.fileSummaries.length).toBeGreaterThanOrEqual(1);
    expect(pack.filesToInspect.length).toBeGreaterThanOrEqual(1);
    expect(pack.suggestedWorkflow.length).toBeGreaterThanOrEqual(1);
    expect(pack.warnings).toBeDefined();
  });

  it("should include file summaries relevant to the query", async () => {
    const pack = await pipeline.retrieveContext("auth service login");
    const authFiles = pack.fileSummaries.filter(f => f.file.includes("auth"));
    expect(authFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("should include code snippets in context pack", async () => {
    const pack = await pipeline.retrieveContext("user model and roles");
    expect(pack.codeSnippets.length).toBeGreaterThanOrEqual(1);

    const userSnippet = pack.codeSnippets.find(c => c.file.includes("user.model"));
    expect(userSnippet).toBeDefined();
    expect(userSnippet!.chunk).toContain("User");
  });

  it("should provide risk assessment", async () => {
    const pack = await pipeline.retrieveContext("admin guard authentication");
    // At minimum risk should be an empty string if no risks found
    expect(typeof pack.risk).toBe("string");
  });

  it("should search code via search engine", async () => {
    const results = await searchEngine.search({
      query: "login",
      limit: 5,
      includeTests: false,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const loginResult = results.find(r => r.file.includes("auth.service"));
    expect(loginResult).toBeDefined();
    expect(loginResult!.whyMatched).toBeTruthy();
  });

  it("should return relevant module summaries", async () => {
    const pack = await pipeline.retrieveContext("user data and authentication");
    expect(pack.moduleSummaries.length).toBeGreaterThanOrEqual(1);
  });

  it("should not exceed token budget by default", async () => {
    const pack = await pipeline.retrieveContext("full system review");
    expect(pack.estimatedTokens).toBeLessThanOrEqual(12000);
  });
});
