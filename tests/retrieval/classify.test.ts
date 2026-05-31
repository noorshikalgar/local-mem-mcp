import { describe, it, expect } from "vitest";
import { classifyTask, extractEntities } from "../../src/retrieval/classify.js";

describe("classifyTask", () => {
  it("should classify bug fixes", () => {
    expect(classifyTask("Fix login button not working")).toBe("bug_fix");
    expect(classifyTask("Bug: profile page crashes")).toBe("bug_fix");
    expect(classifyTask("Error when submitting form")).toBe("bug_fix");
  });

  it("should classify new features", () => {
    expect(classifyTask("Add user profile page")).toBe("new_feature");
    expect(classifyTask("Create new billing module")).toBe("new_feature");
    expect(classifyTask("Implement dark mode support")).toBe("new_feature");
  });

  it("should classify refactors", () => {
    expect(classifyTask("Refactor auth service")).toBe("refactor");
    expect(classifyTask("Clean up the store layer")).toBe("refactor");
    expect(classifyTask("Extract shared components")).toBe("refactor");
  });

  it("should classify test generation", () => {
    expect(classifyTask("Write tests for auth service")).toBe("test_generation");
    expect(classifyTask("Add unit tests")).toBe("test_generation");
  });

  it("should classify explanations", () => {
    expect(classifyTask("What does this function do?")).toBe("explanation");
    expect(classifyTask("Explain the auth flow")).toBe("explanation");
  });

  it("should classify code reviews", () => {
    expect(classifyTask("Review the PR code")).toBe("code_review");
  });

  it("should return unknown for ambiguous queries", () => {
    expect(classifyTask("Hello world")).toBe("unknown");
  });
});

describe("extractEntities", () => {
  it("should extract module names", () => {
    const result = extractEntities("Add role-based access to admin dashboard with auth");
    expect(result.possibleModules).toContain("admin");
    expect(result.possibleModules).toContain("auth");
  });

  it("should extract symbols (CamelCase names)", () => {
    const result = extractEntities("Update RoleGuard to support AdminDashboard");
    expect(result.symbols).toContain("RoleGuard");
    expect(result.symbols).toContain("AdminDashboard");
  });

  it("should extract file paths", () => {
    const result = extractEntities("Check src/auth/role.guard.ts");
    expect(result.files.length).toBeGreaterThanOrEqual(1);
  });
});
