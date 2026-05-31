import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../setup.js";
import { TaskMemoryManager } from "../../src/memory/task-memory.js";

let store = createTestStore();
let manager: TaskMemoryManager;

beforeEach(() => {
  store.close();
  store = createTestStore();
  manager = new TaskMemoryManager(store);
});

describe("TaskMemoryManager", () => {
  it("should create a task", () => {
    const task = manager.createTask("Add RBAC to admin", "feature/rbac");
    expect(task.task).toBe("Add RBAC to admin");
    expect(task.branchName).toBe("feature/rbac");
    expect(task.status).toBe("pending");
  });

  it("should update task status", () => {
    const task = manager.createTask("Fix login bug");
    const updated = manager.updateTask(task.id, { status: "in_progress" });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("in_progress");
  });

  it("should add file touch", () => {
    const task = manager.createTask("Refactor auth");
    const updated = manager.addFileTouch(task.id, "src/auth/auth.service.ts");
    expect(updated!.filesTouched).toContain("src/auth/auth.service.ts");
  });

  it("should add decision to task", () => {
    const task = manager.createTask("Implement feature");
    manager.addDecision(task.id, "Reuse existing guard");
    const retrieved = manager.getTask(task.id);
    expect(retrieved!.decisions).toContain("Reuse existing guard");
  });

  it("should add open question", () => {
    const task = manager.createTask("Build API");
    manager.addOpenQuestion(task.id, "Should we use REST or GraphQL?");
    const retrieved = manager.getTask(task.id);
    expect(retrieved!.openQuestions).toContain("Should we use REST or GraphQL?");
  });

  it("should complete a task", () => {
    const task = manager.createTask("Quick fix");
    manager.completeTask(task.id);
    const retrieved = manager.getTask(task.id);
    expect(retrieved!.status).toBe("completed");
  });

  it("should return null for non-existent task", () => {
    expect(manager.getTask("nonexistent")).toBeNull();
  });
});
