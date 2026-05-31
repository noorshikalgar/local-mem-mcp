import * as crypto from "node:crypto";
import type { ProjectRule } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";

export class RulesManager {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  addRule(opts: {
    rule: string;
    category?: string;
    files?: string[];
    modules?: string[];
    priority?: number;
    confidence?: number;
  }): ProjectRule {
    const id = crypto.createHash("sha256").update(opts.rule).digest("hex").slice(0, 16);
    const existing = this.store.getActiveRules();
    const conflict = existing.find((r) => r.rule === opts.rule);
    if (conflict) return conflict;

    const rule: ProjectRule = {
      id,
      rule: opts.rule,
      category: opts.category || "general",
      files: opts.files || [],
      modules: opts.modules || [],
      priority: opts.priority || 3,
      isActive: true,
      confidence: opts.confidence ?? 1.0,
      source: "manual",
    };

    this.store.upsertRule(rule);
    return rule;
  }

  getActiveRules(limit = 50): ProjectRule[] {
    return this.store.getActiveRules(limit);
  }

  getRulesForModule(module: string): ProjectRule[] {
    return this.store.getRulesForModule(module);
  }

  getRulesForFile(file: string): ProjectRule[] {
    return this.store.getRulesForFile(file);
  }

  deleteRule(id: string): void {
    this.store.deleteRule(id);
  }
}
