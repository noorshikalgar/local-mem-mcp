import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore, createTestIndexConfig } from "../setup.js";
import { Compactor } from "../../src/compaction/compactor.js";
import { FileSummaryManager } from "../../src/memory/file-summary.js";
import { ModuleSummaryManager } from "../../src/memory/module-summary.js";
import { DecisionManager } from "../../src/memory/decisions.js";
import { SessionMemoryManager } from "../../src/memory/session-memory.js";

let store = createTestStore();
let compactor: Compactor;
let fileSummaryManager: FileSummaryManager;
let moduleSummaryManager: ModuleSummaryManager;
let decisionManager: DecisionManager;
let config = createTestIndexConfig();

beforeEach(() => {
  store.close();
  store = createTestStore();
  config = createTestIndexConfig();
  fileSummaryManager = new FileSummaryManager(store, config);
  moduleSummaryManager = new ModuleSummaryManager(store, config);
  decisionManager = new DecisionManager(store);
  compactor = new Compactor(store, config, fileSummaryManager, moduleSummaryManager, decisionManager);
});

describe("Compactor", () => {
  it("should compact stale file summaries", () => {
    store.upsertFileSummary({
      file: "stale.ts", summary: "old", mainExports: [], mainImports: [],
      sideEffects: [], riskLevel: "low", symbols: [], totalLines: 10,
      language: "typescript", fileHash: "h1", lastVerifiedHash: "h1",
      lastIndexedAt: null, status: "stale", confidence: 0.75,
    });

    const count = compactor.compactFileSummaries();
    expect(count).toBe(1);
    const summary = store.getFileSummary("stale.ts");
    expect(summary!.status).toBe("fresh");
  });

  it("should compact dirty module summaries", () => {
    store.upsertModuleSummary({
      module: "test-mod", path: "src/test", purpose: "test",
      entryPoints: [], coreFiles: [], doNotDuplicate: [],
      riskLevel: "low", relatedModules: [],
      lastIndexedAt: null, status: "dirty", confidence: 0.75,
    });

    const count = compactor.compactModuleSummaries();
    expect(count).toBe(1);
    const summary = store.getModuleSummary("test-mod");
    expect(summary!.status).toBe("fresh");
  });

  it("should compact session to task memory", () => {
    const sessionManager = new SessionMemoryManager(store, "test-session");
    sessionManager.createSession();
    sessionManager.updateTask("Test task");
    sessionManager.addInspectedFile("src/test.ts");

    const task = compactor.compactSessionToTask(sessionManager);
    expect(task).not.toBeNull();
    expect(task!.task).toBe("Test task");
    expect(task!.filesTouched).toContain("src/test.ts");
    expect(task!.status).toBe("completed");
  });

  it("should run all compactions", () => {
    store.upsertFileSummary({
      file: "a.ts", summary: "a", mainExports: [], mainImports: [],
      sideEffects: [], riskLevel: "low", symbols: [], totalLines: 10,
      language: "typescript", fileHash: "h1", lastVerifiedHash: "h1",
      lastIndexedAt: null, status: "stale", confidence: 0.75,
    });
    store.upsertModuleSummary({
      module: "mod", path: "src/mod", purpose: "mod",
      entryPoints: [], coreFiles: [], doNotDuplicate: [],
      riskLevel: "low", relatedModules: [],
      lastIndexedAt: null, status: "dirty", confidence: 0.75,
    });

    const result = compactor.compactAll();
    expect(result.fileSummaries).toBeGreaterThanOrEqual(1);
    expect(result.moduleSummaries).toBeGreaterThanOrEqual(1);
  });
});
