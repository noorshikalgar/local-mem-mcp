import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore, createTestIndexConfig } from "../setup.js";
import { ModuleSummaryManager } from "../../src/memory/module-summary.js";
import type { FileSummary } from "../../src/types.js";

let store = createTestStore();
let manager: ModuleSummaryManager;

beforeEach(() => {
  store.close();
  store = createTestStore();
  manager = new ModuleSummaryManager(store, createTestIndexConfig());
});

describe("ModuleSummaryManager", () => {
  it("should detect module from file path", () => {
    const files: FileSummary[] = [
      {
        file: "src/auth/auth.service.ts", summary: "Auth service",
        mainExports: ["AuthService"], mainImports: [], sideEffects: [],
        riskLevel: "low", symbols: [], totalLines: 10, language: "typescript",
        fileHash: "h1", lastVerifiedHash: "h1", lastIndexedAt: null,
        status: "fresh", confidence: 0.75,
      },
      {
        file: "src/auth/auth.guard.ts", summary: "Auth guard",
        mainExports: ["AuthGuard"], mainImports: [], sideEffects: [],
        riskLevel: "low", symbols: [], totalLines: 10, language: "typescript",
        fileHash: "h2", lastVerifiedHash: "h2", lastIndexedAt: null,
        status: "fresh", confidence: 0.75,
      },
    ];

    const moduleFiles = manager.detectModules(files);
    expect(moduleFiles.has("auth")).toBe(true);
    expect(moduleFiles.get("auth")).toHaveLength(2);
  });

  it("should generate module summary with proper fields", () => {
    const files: FileSummary[] = [
      {
        file: "src/auth/auth.service.ts", summary: "Auth service",
        mainExports: ["AuthService", "login", "logout"],
        mainImports: ["HttpClient"], sideEffects: ["writes auth token"],
        riskLevel: "high", symbols: ["AuthService", "login"],
        totalLines: 200, language: "typescript",
        fileHash: "h1", lastVerifiedHash: "h1", lastIndexedAt: null,
        status: "fresh", confidence: 0.75,
      },
      {
        file: "src/auth/auth.routes.ts", summary: "Auth routes",
        mainExports: ["authRoutes"], mainImports: ["Router"],
        sideEffects: [], riskLevel: "low", symbols: ["authRoutes"],
        totalLines: 30, language: "typescript",
        fileHash: "h2", lastVerifiedHash: "h2", lastIndexedAt: null,
        status: "fresh", confidence: 0.75,
      },
    ];

    const summary = manager.generateModuleSummary("auth", files);
    expect(summary.module).toBe("auth");
    expect(summary.entryPoints).toContain("src/auth/auth.routes.ts");
    expect(summary.coreFiles).toContain("src/auth/auth.service.ts");
    expect(summary.doNotDuplicate).toContain("AuthService");
  });

  it("should detect entry points from route files", () => {
    const files: FileSummary[] = [
      {
        file: "src/admin/admin.routes.ts", summary: "Admin routes",
        mainExports: ["adminRoutes"], mainImports: [],
        sideEffects: [], riskLevel: "low", symbols: [],
        totalLines: 10, language: "typescript",
        fileHash: "h1", lastVerifiedHash: "h1", lastIndexedAt: null,
        status: "fresh", confidence: 0.75,
      },
    ];

    const summary = manager.generateModuleSummary("admin", files);
    expect(summary.entryPoints).toContain("src/admin/admin.routes.ts");
  });

  it("should persist to store", () => {
    const summary = manager.generateModuleSummary("test", []);
    const retrieved = manager.getModuleSummary("test");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.module).toBe("test");
  });
});
