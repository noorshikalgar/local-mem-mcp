import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore, createTestIndexConfig } from "../setup.js";
import { FileSummaryManager } from "../../src/memory/file-summary.js";

let store = createTestStore();
let manager: FileSummaryManager;

beforeEach(() => {
  store.close();
  store = createTestStore();
  manager = new FileSummaryManager(store, createTestIndexConfig());
});

describe("FileSummaryManager", () => {
  it("should generate summary for TypeScript file", async () => {
    const content = `
import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";

export interface User {
  id: number;
  name: string;
}

export class AuthService {
  login() { return "ok"; }
  logout() { return "bye"; }
}
`;

    const summary = await manager.generateSummary(
      "/test/auth.service.ts",
      "src/auth/auth.service.ts",
      "typescript",
      content,
    );

    expect(summary.file).toBe("src/auth/auth.service.ts");
    expect(summary.mainExports).toContain("AuthService");
    expect(summary.mainExports).toContain("User");
    expect(summary.mainImports).toContain("@angular/core");
    expect(summary.symbols).toContain("AuthService");
    expect(summary.symbols).toContain("User");
  });

  it("should detect risk level based on content", async () => {
    const content = `
import { AuthGuard } from "./auth.guard";
export function deleteUser(id: string) { return fetch("/admin/users/" + id, { method: "DELETE" }); }
`;
    const summary = await manager.generateSummary(
      "/test/admin.ts", "src/admin/admin.ts", "typescript", content,
    );
    expect(["medium", "high", "critical"]).toContain(summary.riskLevel);
  });

  it("should detect side effects", async () => {
    const content = `
export function init() {
  localStorage.setItem("token", "abc");
  setInterval(() => {}, 1000);
  fetch("/api/data");
}
`;
    const summary = await manager.generateSummary(
      "/test/init.ts", "src/init.ts", "typescript", content,
    );
    expect(summary.sideEffects.length).toBeGreaterThanOrEqual(2);
  });

  it("should persist to store", async () => {
    const content = "export const x = 1;";
    await manager.generateSummary("/test/x.ts", "x.ts", "typescript", content);
    const retrieved = manager.getFileSummary("x.ts");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.summary).toContain("Exports");
  });
});
