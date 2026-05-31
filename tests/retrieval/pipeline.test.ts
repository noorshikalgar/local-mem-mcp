import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore, createTestIndexConfig, createTestVectorStore } from "../setup.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { SqliteGraphStore } from "../../src/stores/graph-store.js";
import { FileSummaryManager } from "../../src/memory/file-summary.js";
import { ModuleSummaryManager } from "../../src/memory/module-summary.js";
import { DecisionManager } from "../../src/memory/decisions.js";
import { RulesManager } from "../../src/memory/rules.js";
import type { FileSummary } from "../../src/types.js";

let store = createTestStore();
let pipeline: RetrievalPipeline;

beforeEach(async () => {
  store.close();
  store = createTestStore();
  const config = createTestIndexConfig();
  const vectorStore = createTestVectorStore();
  const graphStore = new SqliteGraphStore(store);
  pipeline = new RetrievalPipeline(store, vectorStore, graphStore, config);

  // Seed file summaries
  const fsManager = new FileSummaryManager(store, config);
  const modManager = new ModuleSummaryManager(store, config);
  const decManager = new DecisionManager(store);
  const ruleManager = new RulesManager(store);

  // Create some test data
  const authServiceSummary: FileSummary = {
    file: "src/auth/auth.service.ts", summary: "Auth service - login, logout, token refresh",
    mainExports: ["AuthService"], mainImports: ["HttpClient"], sideEffects: ["writes token"],
    riskLevel: "high", symbols: ["AuthService", "login"], totalLines: 200,
    language: "typescript", fileHash: "h1", lastVerifiedHash: "h1",
    lastIndexedAt: new Date().toISOString(), status: "fresh", confidence: 0.75,
  };
  const roleGuardSummary: FileSummary = {
    file: "src/auth/role.guard.ts", summary: "Role guard for route protection",
    mainExports: ["RoleGuard"], mainImports: ["AuthService"], sideEffects: [],
    riskLevel: "medium", symbols: ["RoleGuard", "canActivate"], totalLines: 80,
    language: "typescript", fileHash: "h2", lastVerifiedHash: "h2",
    lastIndexedAt: new Date().toISOString(), status: "fresh", confidence: 0.75,
  };
  const adminDashboardSummary: FileSummary = {
    file: "src/admin/AdminDashboard.tsx", summary: "Admin dashboard component",
    mainExports: ["AdminDashboard"], mainImports: ["AuthService", "RoleGuard"], sideEffects: [],
    riskLevel: "medium", symbols: ["AdminDashboard"], totalLines: 150,
    language: "typescript", fileHash: "h3", lastVerifiedHash: "h3",
    lastIndexedAt: new Date().toISOString(), status: "fresh", confidence: 0.75,
  };
  const adminRoutesSummary: FileSummary = {
    file: "src/routes/admin.routes.ts", summary: "Admin route definitions",
    mainExports: ["adminRoutes"], mainImports: ["AuthService", "RoleGuard", "AdminDashboard"],
    sideEffects: [], riskLevel: "medium", symbols: ["adminRoutes"], totalLines: 40,
    language: "typescript", fileHash: "h4", lastVerifiedHash: "h4",
    lastIndexedAt: new Date().toISOString(), status: "fresh", confidence: 0.75,
  };

  store.upsertFileSummary(authServiceSummary);
  store.upsertFileSummary(roleGuardSummary);
  store.upsertFileSummary(adminDashboardSummary);
  store.upsertFileSummary(adminRoutesSummary);

  await modManager.generateModuleSummary("auth", [authServiceSummary, roleGuardSummary]);
  await modManager.generateModuleSummary("admin", [adminDashboardSummary, adminRoutesSummary]);

  decManager.addDecision({
    title: "Use RoleGuard for all role checks",
    area: "auth",
    files: ["src/auth/role.guard.ts", "src/routes/admin.routes.ts"],
    decision: "All role-based access uses centralized RoleGuard",
    reason: "Avoid duplicate guards and keep role checks consistent",
    rule: "Do not create duplicate guards",
  });

  ruleManager.addRule({
    rule: "Use existing RoleGuard, do not create duplicate guards",
    category: "auth",
    modules: ["auth", "admin"],
    priority: 5,
  });
  ruleManager.addRule({
    rule: "Admin routes live in src/routes/admin.routes.ts",
    category: "routing",
    modules: ["admin"],
    priority: 4,
  });
});

afterEach(() => {
  store.close();
});

describe("RetrievalPipeline", () => {
  it("should retrieve context pack for a task", async () => {
    const pack = await pipeline.retrieveContext("Add role-based access to admin dashboard");

    expect(pack.task).toBe("Add role-based access to admin dashboard");
    expect(pack.taskType).toBe("new_feature");
    expect(pack.projectRules.length).toBeGreaterThanOrEqual(1);
    expect(pack.decisions.length).toBeGreaterThanOrEqual(1);
    expect(pack.filesToInspect.length).toBeGreaterThanOrEqual(1);
    expect(pack.estimatedTokens).toBeGreaterThan(0);
  });

  it("should classify task type correctly", async () => {
    const pack = await pipeline.retrieveContext("Fix login bug in auth service");
    expect(pack.taskType).toBe("bug_fix");
  });

  it("should include relevant project rules", async () => {
    const pack = await pipeline.retrieveContext("Add role-based access to admin dashboard");
    const hasRoleGuardRule = pack.projectRules.some(
      (r) => r.rule.toLowerCase().includes("roleguard"),
    );
    expect(hasRoleGuardRule).toBe(true);
  });

  it("should include relevant decisions", async () => {
    const pack = await pipeline.retrieveContext("Add role-based access to admin dashboard");
    expect(pack.decisions.length).toBeGreaterThanOrEqual(1);
  });

  it("should suggest workflow", async () => {
    const pack = await pipeline.retrieveContext("Add role-based access to admin dashboard");
    expect(pack.suggestedWorkflow.length).toBeGreaterThanOrEqual(1);
  });

  it("should include warnings when stale file summaries exist", async () => {
    // Mark a file summary as stale
    const summaries = store.getAllFileSummaries();
    if (summaries.length > 0) {
      store.upsertFileSummary({ ...summaries[0], status: "stale" });
    }

    const pack = await pipeline.retrieveContext("auth");
    expect(pack.warnings.length).toBeGreaterThanOrEqual(1);
    expect(pack.warnings[0]).toContain("stale");
  });

  it("should trim code snippets when budget is tight", async () => {
    const tightBudget = {
      totalTokens: 500, systemRules: 800, taskMemory: 500,
      moduleSummaries: 200, decisionMemory: 200, codeSnippets: 100,
      currentFileContent: 500, responseBudget: 200, reserve: 50,
    };

    const pack = await pipeline.retrieveContext("auth", { budget: tightBudget });
    expect(pack.estimatedTokens).toBeLessThanOrEqual(450);
  });
});
