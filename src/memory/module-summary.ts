import * as path from "node:path";
import type { ModuleSummary, IndexConfig, FileSummary } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";

const KNOWN_MODULE_KEYWORDS: Record<string, string[]> = {
  auth: ["auth", "login", "logout", "password", "token", "session", "guard", "role", "permission"],
  admin: ["admin", "dashboard", "management"],
  billing: ["billing", "payment", "invoice", "subscription", "pricing"],
  api: ["api", "endpoint", "route", "controller", "middleware"],
  ui: ["ui", "component", "button", "input", "modal", "dropdown", "form"],
  shared: ["shared", "common", "util", "helper", "lib"],
  settings: ["setting", "config", "preference"],
  users: ["user", "profile", "account"],
  reports: ["report", "analytics", "statistics"],
};

export class ModuleSummaryManager {
  private store: SQLiteStore;
  private config: IndexConfig;

  constructor(store: SQLiteStore, config: IndexConfig) {
    this.store = store;
    this.config = config;
  }

  detectModules(fileSummaries: FileSummary[]): Map<string, FileSummary[]> {
    const moduleFiles = new Map<string, FileSummary[]>();

    for (const fs of fileSummaries) {
      const moduleName = this.detectModuleForFile(fs.file);
      if (!moduleFiles.has(moduleName)) {
        moduleFiles.set(moduleName, []);
      }
      moduleFiles.get(moduleName)!.push(fs);
    }

    return moduleFiles;
  }

  private detectModuleForFile(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");

    for (const part of parts) {
      const lower = part.toLowerCase();
      for (const [module, keywords] of Object.entries(KNOWN_MODULE_KEYWORDS)) {
        if (keywords.some((k) => lower.includes(k))) {
          return module;
        }
      }
    }

    if (parts.length >= 2) {
      return parts[0] === "src" ? parts[1] : parts[0];
    }

    return "root";
  }

  generateModuleSummary(moduleName: string, files: FileSummary[]): ModuleSummary {
    const coreFile = files[0];
    const dir = coreFile ? path.dirname(coreFile.file) : moduleName;

    const allExports = files.flatMap((f) => f.mainExports);
    const allSideEffects = files.flatMap((f) => f.sideEffects);
    const allSymbols = files.flatMap((f) => f.symbols);

    const entryPoints = files
      .filter((f) => f.file.includes(".route") || f.file.includes("index.") || f.file.includes("main."))
      .map((f) => f.file);

    const coreFiles = files
      .sort((a, b) => b.totalLines - a.totalLines)
      .slice(0, 5)
      .map((f) => f.file);

    const risks = files.filter((f) => f.riskLevel === "high" || f.riskLevel === "critical");
    const riskLevel = risks.length > 0 ? "high" : files.some((f) => f.riskLevel === "medium") ? "medium" : "low";

    const purpose = this.buildModulePurpose(moduleName, files, allExports, allSymbols);

    const doNotDuplicate = this.buildDoNotDuplicate(allExports, files);

    const relatedModules = this.detectRelatedModules(moduleName, files);

    const summary: ModuleSummary = {
      module: moduleName,
      path: dir,
      purpose,
      entryPoints,
      coreFiles,
      doNotDuplicate,
      riskLevel,
      relatedModules,
      lastIndexedAt: new Date().toISOString(),
      status: "fresh",
      confidence: 0.75,
    };

    this.store.upsertModuleSummary(summary);
    return summary;
  }

  private buildModulePurpose(moduleName: string, files: FileSummary[], allExports: string[], allSymbols: string[]): string {
    const parts: string[] = [];

    if (allExports.length > 0) {
      parts.push(`Provides ${allExports.slice(0, 5).join(", ")}${allExports.length > 5 ? " and more" : ""}.`);
    }

    const fileCount = files.length;
    parts.push(`${fileCount} file(s).`);

    return parts.join(" ");
  }

  private buildDoNotDuplicate(exports: string[], files: FileSummary[]): string[] {
    const items: string[] = [];
    for (const file of files) {
      for (const exp of file.mainExports) {
        items.push(exp);
      }
    }
    for (const sideEffect of files.flatMap((f) => f.sideEffects)) {
      items.push(sideEffect);
    }
    return [...new Set(items)];
  }

  private detectRelatedModules(moduleName: string, files: FileSummary[]): string[] {
    const related = new Set<string>();
    for (const file of files) {
      for (const imp of file.mainImports) {
        for (const [mod] of Object.entries(KNOWN_MODULE_KEYWORDS)) {
          if (imp.includes(mod) && mod !== moduleName) {
            related.add(mod);
          }
        }
      }
    }
    return [...related];
  }

  getModuleSummary(module: string): ModuleSummary | null {
    return this.store.getModuleSummary(module);
  }

  getAllModuleSummaries(): ModuleSummary[] {
    return this.store.getAllModuleSummaries();
  }

  markDirty(moduleName: string): void {
    const existing = this.store.getModuleSummary(moduleName);
    if (existing) {
      this.store.upsertModuleSummary({ ...existing, status: "dirty" });
    }
  }
}
