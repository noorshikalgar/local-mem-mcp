import * as crypto from "node:crypto";
import type { DecisionRecord } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";

export class DecisionManager {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  addDecision(opts: {
    title: string;
    area: string;
    files?: string[];
    decision: string;
    reason: string;
    rule?: string;
    branchName?: string | null;
  }): DecisionRecord {
    const id = crypto.createHash("sha256").update(`${opts.title}:${Date.now()}`).digest("hex").slice(0, 16);

    const record: DecisionRecord = {
      id,
      title: opts.title,
      date: new Date().toISOString(),
      area: opts.area,
      files: opts.files || [],
      decision: opts.decision,
      reason: opts.reason,
      rule: opts.rule,
      status: "fresh",
      confidence: 0.9,
      branchName: opts.branchName || null,
      supersededBy: null,
    };

    this.store.upsertDecision(record);
    return record;
  }

  getDecisionsForArea(area: string): DecisionRecord[] {
    return this.store.getDecisionsForArea(area);
  }

  getDecisionsForFile(file: string): DecisionRecord[] {
    return this.store.getDecisionsForFile(file);
  }

  searchDecisions(query: string, limit = 10): DecisionRecord[] {
    return this.store.searchDecisions(query, limit);
  }

  getAllActiveDecisions(): DecisionRecord[] {
    return this.store.getAllActiveDecisions();
  }

  supersedeDecision(oldId: string, newId: string): void {
    const old = this.store.getDecisionsForArea("");
    const found = this.store.getAllActiveDecisions().find((d) => d.id === oldId);
    if (found) {
      this.store.upsertDecision({ ...found, supersededBy: newId });
    }
  }

  /**
   * Resolve conflicting decisions. Newer, higher-confidence decisions win.
   */
  resolveConflicts(): void {
    const decisions = this.store.getAllActiveDecisions();
    const areaMap = new Map<string, DecisionRecord[]>();

    for (const d of decisions) {
      const existing = areaMap.get(d.area) || [];
      existing.push(d);
      areaMap.set(d.area, existing);
    }

    for (const [, areaDecisions] of areaMap) {
      if (areaDecisions.length <= 1) continue;

      areaDecisions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      for (let i = 1; i < areaDecisions.length; i++) {
        const newer = areaDecisions[i - 1];
        const older = areaDecisions[i];

        if (newer.confidence >= older.confidence) {
          // Check if they conflict (same area, different decisions)
          if (newer.decision !== older.decision) {
            this.store.upsertDecision({ ...older, supersededBy: newer.id });
          }
        }
      }
    }
  }
}
