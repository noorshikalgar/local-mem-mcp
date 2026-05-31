import * as crypto from "node:crypto";
import type { TaskMemory } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";

export class TaskMemoryManager {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  createTask(task: string, branchName?: string | null): TaskMemory {
    const id = crypto.createHash("sha256").update(`${task}:${Date.now()}`).digest("hex").slice(0, 16);
    const now = new Date().toISOString();

    const record: TaskMemory = {
      id,
      task,
      status: "pending",
      filesTouched: [],
      decisions: [],
      openQuestions: [],
      branchName: branchName || null,
      createdAt: now,
      updatedAt: now,
      confidence: 0.9,
    };

    this.store.upsertTask(record);
    return record;
  }

  updateTask(id: string, updates: Partial<Pick<TaskMemory, "status" | "filesTouched" | "decisions" | "openQuestions">>): TaskMemory | null {
    const existing = this.store.getTask(id);
    if (!existing) return null;

    const updated: TaskMemory = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.store.upsertTask(updated);
    return updated;
  }

  addFileTouch(id: string, file: string): TaskMemory | null {
    const existing = this.store.getTask(id);
    if (!existing) return null;
    if (existing.filesTouched.includes(file)) return existing;

    return this.updateTask(id, {
      filesTouched: [...existing.filesTouched, file],
    });
  }

  addDecision(id: string, decision: string): TaskMemory | null {
    const existing = this.store.getTask(id);
    if (!existing) return null;

    return this.updateTask(id, {
      decisions: [...existing.decisions, decision],
    });
  }

  addOpenQuestion(id: string, question: string): TaskMemory | null {
    const existing = this.store.getTask(id);
    if (!existing) return null;

    return this.updateTask(id, {
      openQuestions: [...existing.openQuestions, question],
    });
  }

  getActiveTasks(): TaskMemory[] {
    return this.store.getActiveTasks();
  }

  getTask(id: string): TaskMemory | null {
    return this.store.getTask(id);
  }

  searchTasks(query: string): TaskMemory[] {
    return this.store.searchTasks(query);
  }

  completeTask(id: string): TaskMemory | null {
    return this.updateTask(id, { status: "completed" });
  }
}
