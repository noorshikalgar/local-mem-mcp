import type { IndexConfig, TaskMemory } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";
import { FileSummaryManager } from "../memory/file-summary.js";
import { ModuleSummaryManager } from "../memory/module-summary.js";
import { DecisionManager } from "../memory/decisions.js";
import { SessionMemoryManager } from "../memory/session-memory.js";

export class Compactor {
  private store: SQLiteStore;
  private config: IndexConfig;
  private fileSummaryManager: FileSummaryManager;
  private moduleSummaryManager: ModuleSummaryManager;
  private decisionManager: DecisionManager;

  constructor(
    store: SQLiteStore,
    config: IndexConfig,
    fileSummaryManager: FileSummaryManager,
    moduleSummaryManager: ModuleSummaryManager,
    decisionManager: DecisionManager,
  ) {
    this.store = store;
    this.config = config;
    this.fileSummaryManager = fileSummaryManager;
    this.moduleSummaryManager = moduleSummaryManager;
    this.decisionManager = decisionManager;
  }

  /**
   * Compact stale/dirty summaries.
   * Should be called periodically (every 5-10 minutes).
   */
  compactFileSummaries(): number {
    const staleFiles = this.store.getFileSummariesByStatus("stale");
    let compacted = 0;

    for (const summary of staleFiles) {
      this.store.upsertFileSummary({ ...summary, status: "fresh" });
      compacted++;
    }

    return compacted;
  }

  /**
   * Compact dirty module summaries.
   * Should be called periodically (every 30-60 minutes).
   */
  compactModuleSummaries(): number {
    const allModules = this.store.getAllModuleSummaries();
    let compacted = 0;

    for (const mod of allModules) {
      if (mod.status === "dirty") {
        this.store.upsertModuleSummary({ ...mod, status: "fresh" });
        compacted++;
      }
    }

    return compacted;
  }

  /**
   * Resolve conflicting decisions.
   */
  compactDecisions(): number {
    const before = this.store.getAllActiveDecisions().length;
    this.decisionManager.resolveConflicts();
    const after = this.store.getAllActiveDecisions().length;
    return before - after;
  }

  /**
   * Compact session memory into task memory.
   * Called on task complete.
   */
  compactSessionToTask(
    sessionManager: SessionMemoryManager,
  ): TaskMemory | null {
    const session = sessionManager.getActiveSession();
    if (!session || !session.currentTask) return null;

    const taskId = this.generateTaskId(session.currentTask);
    const now = new Date().toISOString();

    const task: TaskMemory = {
      id: taskId,
      task: session.currentTask,
      status: "completed",
      filesTouched: session.filesInspected,
      decisions: [],
      openQuestions: [],
      branchName: null,
      createdAt: session.startedAt,
      updatedAt: now,
      confidence: 0.9,
    };

    this.store.upsertTask(task);
    return task;
  }

  /**
   * Run all compaction tasks.
   */
  compactAll(sessionManager?: SessionMemoryManager): {
    fileSummaries: number;
    moduleSummaries: number;
    decisions: number;
  } {
    return {
      fileSummaries: this.compactFileSummaries(),
      moduleSummaries: this.compactModuleSummaries(),
      decisions: this.compactDecisions(),
    };
  }

  private generateTaskId(task: string): string {
    let hash = 0;
    for (let i = 0; i < task.length; i++) {
      const char = task.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `task_${Math.abs(hash).toString(16)}_${Date.now().toString(36)}`;
  }
}
