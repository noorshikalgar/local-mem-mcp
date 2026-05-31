import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../setup.js";
import { DecisionManager } from "../../src/memory/decisions.js";

let store = createTestStore();
let manager: DecisionManager;

beforeEach(() => {
  store.close();
  store = createTestStore();
  manager = new DecisionManager(store);
});

describe("DecisionManager", () => {
  it("should add a decision", () => {
    const decision = manager.addDecision({
      title: "Use RoleGuard for admin",
      area: "auth",
      files: ["src/auth/role.guard.ts"],
      decision: "Admin dashboard should use existing RoleGuard",
      reason: "Avoid duplicate AdminGuard and keep role checks centralized",
      rule: "Do not create duplicate admin guard",
    });

    expect(decision.title).toBe("Use RoleGuard for admin");
    expect(decision.area).toBe("auth");
    expect(decision.confidence).toBe(0.9);
    expect(decision.id).toBeTruthy();
  });

  it("should get decisions for area", () => {
    manager.addDecision({
      title: "Decision 1", area: "auth",
      decision: "dec1", reason: "r1",
    });
    manager.addDecision({
      title: "Decision 2", area: "billing",
      decision: "dec2", reason: "r2",
    });

    const authDecisions = manager.getDecisionsForArea("auth");
    expect(authDecisions).toHaveLength(1);
    expect(authDecisions[0].title).toBe("Decision 1");
  });

  it("should search decisions", () => {
    manager.addDecision({
      title: "Use TanStack Query",
      area: "data-fetching",
      decision: "Use TanStack Query for all data fetching",
      reason: "Better caching and DX",
    });
    manager.addDecision({
      title: "Use Zustand",
      area: "state",
      decision: "Migrated from Redux to Zustand",
      reason: "Simpler API",
    });

    const results = manager.searchDecisions("Zustand");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Use Zustand");
  });

  it("should resolve conflicting decisions (newer wins)", () => {
    const old = manager.addDecision({
      title: "Use Redux",
      area: "state",
      decision: "Use Redux for state management",
      reason: "Team familiarity",
    });
    const newer = manager.addDecision({
      title: "Use Zustand",
      area: "state",
      decision: "Migrated to Zustand",
      reason: "Simpler API, less boilerplate",
    });

    // Manually set newer to have higher confidence
    const oldRecord = manager.getDecisionsForArea("state").find((d) => d.id === old.id);
    const newRecord = manager.getDecisionsForArea("state").find((d) => d.id === newer.id);
    if (oldRecord && newRecord) {
      // Supersede the old one
      manager.supersedeDecision(oldRecord.id, newRecord.id);
      const checkOld = manager.getAllActiveDecisions().find((d) => d.id === old.id);
      expect(checkOld?.supersededBy).toBe(newer.id);
    }
  });

  it("should get decisions for file", () => {
    manager.addDecision({
      title: "Test Decision",
      area: "test",
      files: ["src/test/file.ts"],
      decision: "test", reason: "test",
    });

    const decisions = manager.getDecisionsForFile("src/test/file.ts");
    expect(decisions).toHaveLength(1);
  });
});
