import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../setup.js";
import { RulesManager } from "../../src/memory/rules.js";

let store = createTestStore();
let manager: RulesManager;

beforeEach(() => {
  store.close();
  store = createTestStore();
  manager = new RulesManager(store);
});

describe("RulesManager", () => {
  it("should add a rule", () => {
    const rule = manager.addRule({
      rule: "Use existing API client",
      category: "api",
      priority: 5,
    });
    expect(rule.rule).toBe("Use existing API client");
    expect(rule.priority).toBe(5);
    expect(rule.isActive).toBe(true);
  });

  it("should not add duplicate rules", () => {
    manager.addRule({ rule: "Unique rule" });
    manager.addRule({ rule: "Unique rule" });
    const rules = manager.getActiveRules();
    const matching = rules.filter((r) => r.rule === "Unique rule");
    expect(matching).toHaveLength(1);
  });

  it("should get rules for file", () => {
    manager.addRule({
      rule: "Admin routes in admin.routes.ts",
      files: ["src/routes/admin.routes.ts"],
      modules: ["admin"],
    });

    const rules = manager.getRulesForFile("src/routes/admin.routes.ts");
    expect(rules).toHaveLength(1);
  });

  it("should get rules for module", () => {
    manager.addRule({
      rule: "Auth uses RoleGuard",
      modules: ["auth"],
      category: "security",
    });

    const rules = manager.getRulesForModule("auth");
    expect(rules).toHaveLength(1);
    expect(rules[0].rule).toBe("Auth uses RoleGuard");
  });
});
