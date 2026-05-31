import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Indexer } from "../../src/watcher/indexer.js";
import { SQLiteStore } from "../../src/stores/sqlite-store.js";
import { SqliteGraphStore } from "../../src/stores/graph-store.js";
import { NoOpVectorStore } from "../../src/stores/vector-store.js";
import type { IndexConfig } from "../../src/types.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-mcp-int-"));
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

  logout(): void {
    this.token = "";
  }
}
`);
  fs.writeFileSync(path.join(dir, "utils.ts"), `
export function formatDate(d: Date): string {
  return d.toISOString();
}

export const API_VERSION = "v1";
`);
  fs.writeFileSync(path.join(dir, "index.ts"), `
import { AuthService } from "./auth.service";
import { formatDate } from "./utils";

export function getAppName(): string {
  return "MyApp";
}
`);
  return dir;
}

describe("Indexer integration", () => {
  let projectDir: string;
  let store: SQLiteStore;
  let indexer: Indexer;

  beforeAll(() => {
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
      chunkSize: 20,
      chunkOverlap: 3,
      useGit: false,
      useFileWatcher: false,
      embeddingProvider: "none",
      embeddingModel: "bge-small",
    };
    indexer = new Indexer(store, vectorStore, graphStore, config);
  });

  afterAll(() => {
    store.close();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("should index all files in the project", async () => {
    const result = await indexer.indexProject();
    expect(result.filesIndexed).toBeGreaterThanOrEqual(3);
    expect(result.chunksIndexed).toBeGreaterThanOrEqual(3);
  });

  it("should generate file summaries", () => {
    const summaries = store.getAllFileSummaries();
    expect(summaries.length).toBeGreaterThanOrEqual(3);

    const authSummary = summaries.find(s => s.file === "auth.service.ts");
    expect(authSummary).toBeDefined();
    expect(authSummary!.mainExports).toContain("AuthService");
    expect(authSummary!.symbols).toContain("AuthService");
  });

  it("should generate module summaries", () => {
    const modules = store.getAllModuleSummaries();
    // at least one module detected (e.g. "root" or named)
    expect(modules.length).toBeGreaterThanOrEqual(1);
    const mod = modules[0];
    expect(mod.purpose).toBeTruthy();
  });

  it("should store code chunks with content", () => {
    const allChunks = store.getAllChunks();
    expect(allChunks.length).toBeGreaterThanOrEqual(3);
    const authChunks = allChunks.filter(c => c.file === "auth.service.ts");
    expect(authChunks.length).toBeGreaterThanOrEqual(1);
    expect(authChunks[0].chunk).toContain("AuthService");
  });

  it("should store import relations via graph store", () => {
    // index.ts imports from auth.service and utils
    const related = store.findRelatedFiles("index.ts");
    expect(related.length).toBeGreaterThanOrEqual(2);
    const importRel = related.find(r => r.relationType === "imports");
    expect(importRel).toBeDefined();
  });

  it("should track index state", () => {
    const state = store.getIndexState("auth.service.ts");
    expect(state).toBeDefined();
    expect(state!.fileHash).toBeTruthy();
    expect(state!.status).toBe("fresh");
  });

  it("should handle re-index unchanged file (skip)", async () => {
    const result = await indexer.indexProject();
    // Second pass: files already indexed with same hash, should skip
    expect(result.filesIndexed).toBe(0);
    expect(result.chunksIndexed).toBe(0);
  });

  it("should handle file change", async () => {
    const filePath = path.join(projectDir, "utils.ts");
    const original = fs.readFileSync(filePath, "utf-8");
    // Add a function (which IS detected as a symbol)
    fs.writeFileSync(filePath, original + "\n\nexport function newHelper(): string {\n  return \"helper\";\n}\n");

    await indexer.handleFileChange("utils.ts");

    const summary = store.getFileSummary("utils.ts");
    expect(summary).toBeDefined();
    expect(summary!.symbols).toContain("newHelper");

    // Cleanup
    fs.writeFileSync(filePath, original);
  });

  it("should handle file deletion", async () => {
    const filePath = path.join(projectDir, "temp_delete.ts");
    fs.writeFileSync(filePath, "export const temp = 1;");

    // Index the new file
    await indexer.handleFileChange("temp_delete.ts");
    expect(store.getFileSummary("temp_delete.ts")).toBeDefined();

    // Delete it
    fs.unlinkSync(filePath);
    await indexer.handleFileDelete("temp_delete.ts");

    expect(store.getFileSummary("temp_delete.ts")).toBeNull();
  });
});
