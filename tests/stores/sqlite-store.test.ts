import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../setup.js";
import type { CodeChunk, FileSummary, ModuleSummary, DecisionRecord, ProjectRule, TaskMemory } from "../../src/types.js";

let store = createTestStore();

beforeEach(() => {
  store.close();
  store = createTestStore();
});

describe("SQLiteStore", () => {
  describe("code chunks", () => {
    it("should store and retrieve chunks", () => {
      const chunk: CodeChunk = {
        id: "chunk-1",
        file: "src/test.ts",
        language: "typescript",
        startLine: 1,
        endLine: 10,
        chunk: "const x = 1;",
        hash: "abc123",
        symbols: ["x"],
        imports: [],
        exports: [],
        embedding: null,
        lastModified: null,
        gitCommitHash: null,
        status: "fresh",
      };

      store.upsertChunk(chunk);
      const chunks = store.getChunksForFile("src/test.ts");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe("chunk-1");
      expect(chunks[0].symbols).toEqual(["x"]);
    });

    it("should update chunk on conflict", () => {
      const chunk: CodeChunk = {
        id: "chunk-1",
        file: "src/test.ts",
        language: "typescript",
        startLine: 1,
        endLine: 10,
        chunk: "const x = 1;",
        hash: "abc123",
        symbols: ["x"],
        imports: [],
        exports: [],
        embedding: null,
        lastModified: null,
        gitCommitHash: null,
        status: "fresh",
      };

      store.upsertChunk(chunk);
      const updated: CodeChunk = { ...chunk, chunk: "const y = 2;", hash: "def456" };
      store.upsertChunk(updated);

      const chunks = store.getChunksForFile("src/test.ts");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].hash).toBe("def456");
    });

    it("should delete chunks for file", () => {
      const chunk: CodeChunk = {
        id: "chunk-1",
        file: "src/test.ts",
        language: "typescript",
        startLine: 1,
        endLine: 10,
        chunk: "test",
        hash: "abc",
        symbols: [],
        imports: [],
        exports: [],
        embedding: null,
        lastModified: null,
        gitCommitHash: null,
        status: "fresh",
      };

      store.upsertChunk(chunk);
      store.deleteChunksForFile("src/test.ts");
      expect(store.getChunksForFile("src/test.ts")).toHaveLength(0);
    });

    it("should search chunks by keyword", () => {
      store.upsertChunk({
        id: "c1", file: "a.ts", language: "typescript",
        startLine: 1, endLine: 2, chunk: "function login() {}", hash: "h1",
        symbols: ["login"], imports: [], exports: [], embedding: null,
        lastModified: null, gitCommitHash: null, status: "fresh",
      });
      store.upsertChunk({
        id: "c2", file: "b.ts", language: "typescript",
        startLine: 1, endLine: 2, chunk: "function logout() {}", hash: "h2",
        symbols: ["logout"], imports: [], exports: [], embedding: null,
        lastModified: null, gitCommitHash: null, status: "fresh",
      });

      const results = store.searchChunksByKeyword("login", 10);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("c1");
    });

    it("should search chunks by symbol", () => {
      store.upsertChunk({
        id: "c1", file: "a.ts", language: "typescript",
        startLine: 1, endLine: 2, chunk: "class AuthService {}", hash: "h1",
        symbols: ["AuthService", "login"], imports: [], exports: [], embedding: null,
        lastModified: null, gitCommitHash: null, status: "fresh",
      });

      const results = store.searchChunksBySymbol("AuthService", 10);
      expect(results).toHaveLength(1);
    });
  });

  describe("file summaries", () => {
    it("should store and retrieve file summaries", () => {
      const summary: FileSummary = {
        file: "src/auth.service.ts",
        summary: "Handles authentication",
        mainExports: ["AuthService"],
        mainImports: ["HttpClient"],
        sideEffects: [],
        riskLevel: "high",
        symbols: ["AuthService", "login"],
        totalLines: 100,
        language: "typescript",
        fileHash: "abc",
        lastVerifiedHash: "abc",
        lastIndexedAt: new Date().toISOString(),
        status: "fresh",
        confidence: 0.75,
      };

      store.upsertFileSummary(summary);
      const retrieved = store.getFileSummary("src/auth.service.ts");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.summary).toBe("Handles authentication");
      expect(retrieved!.mainExports).toEqual(["AuthService"]);
    });

    it("should return null for missing file summary", () => {
      expect(store.getFileSummary("nonexistent.ts")).toBeNull();
    });

    it("should get summaries by status", () => {
      const s1: FileSummary = {
        file: "a.ts", summary: "File A", mainExports: [], mainImports: [],
        sideEffects: [], riskLevel: "low", symbols: [], totalLines: 10,
        language: "typescript", fileHash: "h1", lastVerifiedHash: "h1",
        lastIndexedAt: null, status: "fresh", confidence: 0.75,
      };
      const s2: FileSummary = {
        file: "b.ts", summary: "File B", mainExports: [], mainImports: [],
        sideEffects: [], riskLevel: "low", symbols: [], totalLines: 10,
        language: "typescript", fileHash: "h2", lastVerifiedHash: "h2",
        lastIndexedAt: null, status: "stale", confidence: 0.75,
      };

      store.upsertFileSummary(s1);
      store.upsertFileSummary(s2);

      const fresh = store.getFileSummariesByStatus("fresh");
      expect(fresh).toHaveLength(1);
      expect(fresh[0].file).toBe("a.ts");
    });
  });

  describe("module summaries", () => {
    it("should store and retrieve module summaries", () => {
      const summary: ModuleSummary = {
        module: "auth",
        path: "src/auth",
        purpose: "Authentication module",
        entryPoints: ["src/auth/auth.routes.ts"],
        coreFiles: ["src/auth/auth.service.ts"],
        doNotDuplicate: ["token refresh", "role validation"],
        riskLevel: "high",
        relatedModules: ["admin"],
        lastIndexedAt: new Date().toISOString(),
        status: "fresh",
        confidence: 0.75,
      };

      store.upsertModuleSummary(summary);
      const retrieved = store.getModuleSummary("auth");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.purpose).toBe("Authentication module");
    });
  });

  describe("decisions", () => {
    it("should store and retrieve decisions by area", () => {
      const decision: DecisionRecord = {
        id: "dec-1",
        title: "Use RoleGuard",
        date: new Date().toISOString(),
        area: "auth",
        files: ["src/auth/role.guard.ts"],
        decision: "Centralize role checks",
        reason: "Avoid duplication",
        rule: "Use RoleGuard for all role checks",
        status: "fresh",
        confidence: 0.9,
        branchName: null,
        supersededBy: null,
      };

      store.upsertDecision(decision);
      const decisions = store.getDecisionsForArea("auth");
      expect(decisions).toHaveLength(1);
      expect(decisions[0].title).toBe("Use RoleGuard");
    });

    it("should search decisions by keyword", () => {
      store.upsertDecision({
        id: "dec-1", title: "Use Redux", date: new Date().toISOString(),
        area: "state", files: [], decision: "Use Redux for state",
        reason: "Team familiarity", rule: "", status: "fresh", confidence: 0.9,
        branchName: null, supersededBy: null,
      });
      store.upsertDecision({
        id: "dec-2", title: "Use Zustand", date: new Date().toISOString(),
        area: "state", files: [], decision: "Migrated to Zustand",
        reason: "Simpler API", rule: "", status: "fresh", confidence: 0.9,
        branchName: null, supersededBy: null,
      });

      const results = store.searchDecisions("Zustand", 10);
      expect(results).toHaveLength(1);
    });

    it("should exclude deleted decisions", () => {
      store.upsertDecision({
        id: "dec-1", title: "Old", date: new Date().toISOString(),
        area: "test", files: [], decision: "old", reason: "old",
        status: "deleted", confidence: 0.5, branchName: null, supersededBy: null,
      });

      expect(store.getAllActiveDecisions()).toHaveLength(0);
    });
  });

  describe("project rules", () => {
    it("should store and retrieve active rules", () => {
      const rule: ProjectRule = {
        id: "rule-1",
        rule: "Use existing API client",
        category: "api",
        files: [],
        modules: ["api"],
        priority: 5,
        isActive: true,
        confidence: 1.0,
        source: "manual",
      };

      store.upsertRule(rule);
      const rules = store.getActiveRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].rule).toBe("Use existing API client");
    });

    it("should filter inactive rules", () => {
      store.upsertRule({
        id: "rule-1", rule: "Active rule", category: "general",
        files: [], modules: [], priority: 3, isActive: true,
        confidence: 1.0, source: "manual",
      });
      store.upsertRule({
        id: "rule-2", rule: "Inactive rule", category: "general",
        files: [], modules: [], priority: 3, isActive: false,
        confidence: 0.5, source: "manual",
      });

      expect(store.getActiveRules()).toHaveLength(1);
    });
  });

  describe("task memory", () => {
    it("should store and retrieve active tasks", () => {
      const task: TaskMemory = {
        id: "task-1",
        task: "Add RBAC to admin",
        status: "in_progress",
        filesTouched: ["src/admin/routes.ts"],
        decisions: ["reuse RoleGuard"],
        openQuestions: ["Does super_admin exist?"],
        branchName: "feature/rbac",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: 0.9,
      };

      store.upsertTask(task);
      const tasks = store.getActiveTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].task).toBe("Add RBAC to admin");
    });

    it("should exclude completed tasks from active", () => {
      store.upsertTask({
        id: "task-1", task: "Completed task", status: "completed",
        filesTouched: [], decisions: [], openQuestions: [],
        branchName: null, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), confidence: 0.9,
      });

      expect(store.getActiveTasks()).toHaveLength(0);
    });
  });

  describe("index state", () => {
    it("should track index state", () => {
      store.upsertIndexState("src/test.ts", "abc123", "fresh");
      const state = store.getIndexState("src/test.ts");
      expect(state).not.toBeNull();
      expect(state!.fileHash).toBe("abc123");
      expect(state!.status).toBe("fresh");
    });

    it("should get stale files", () => {
      store.upsertIndexState("fresh.ts", "h1", "fresh");
      store.upsertIndexState("stale.ts", "h2", "stale");
      store.upsertIndexState("dirty.ts", "h3", "dirty");

      const stale = store.getStaleFiles();
      expect(stale).toHaveLength(2);
      expect(stale).toContain("stale.ts");
      expect(stale).toContain("dirty.ts");
    });
  });

  describe("relations", () => {
    it("should find related files", () => {
      const rel = {
        id: "rel-1",
        sourceType: "file" as const,
        sourceName: "AdminDashboard",
        sourceFile: "src/admin/dashboard.tsx",
        targetType: "file" as const,
        targetName: "RoleGuard",
        targetFile: "src/auth/role.guard.ts",
        relationType: "imports" as const,
        weight: 1,
        status: "fresh" as const,
        confidence: 0.98,
      };

      store.upsertRelation(rel);
      const related = store.findRelatedFiles("src/auth/role.guard.ts");
      expect(related).toHaveLength(1);
    });

    it("should find affected files", () => {
      store.upsertRelation({
        id: "r1", sourceType: "file", sourceName: "AdminDashboard",
        sourceFile: "src/admin/dashboard.tsx", targetType: "file",
        targetName: "RoleGuard", targetFile: "src/auth/role.guard.ts",
        relationType: "imports", weight: 1, status: "fresh", confidence: 0.98,
      });
      store.upsertRelation({
        id: "r2", sourceType: "test", sourceName: "RoleGuardTest",
        sourceFile: "src/auth/role.guard.spec.ts", targetType: "function",
        targetName: "RoleGuard", targetFile: "src/auth/role.guard.ts",
        relationType: "tested_by", weight: 1, status: "fresh", confidence: 0.98,
      });

      const affected = store.findAffectedFiles("src/auth/role.guard.ts");
      expect(affected.files).toContain("src/admin/dashboard.tsx");
      expect(affected.tests).toContain("src/auth/role.guard.spec.ts");
    });
  });
});
