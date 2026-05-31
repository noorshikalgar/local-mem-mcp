import type { FileSummary, SupportedLanguage, IndexConfig } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";
import { FileScanner } from "../indexing/file-scanner.js";
import { parseCode } from "../indexing/parser.js";
import * as crypto from "node:crypto";

export class FileSummaryManager {
  private store: SQLiteStore;
  private config: IndexConfig;

  constructor(store: SQLiteStore, config: IndexConfig) {
    this.store = store;
    this.config = config;
  }

  generateSummary(
    filePath: string,
    relativePath: string,
    language: SupportedLanguage,
    content: string,
  ): FileSummary {
    const lines = content.split("\n");
    const parsed = parseCode(relativePath, content, language);
    const fileHash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);

    const summary = this.buildSummary(content, parsed);

    const riskLevel = this.inferRiskLevel(parsed, content);

    const result: FileSummary = {
      file: relativePath,
      summary,
      mainExports: parsed.exports,
      mainImports: [...new Set(parsed.imports)],
      sideEffects: this.detectSideEffects(parsed, content),
      riskLevel,
      symbols: parsed.symbols.map((s) => s.name),
      totalLines: lines.length,
      language,
      fileHash,
      lastVerifiedHash: fileHash,
      lastIndexedAt: new Date().toISOString(),
      status: "fresh",
      confidence: 0.75,
    };

    this.store.upsertFileSummary(result);
    return result;
  }

  private buildSummary(content: string, parsed: ReturnType<typeof parseCode>): string {
    const parts: string[] = [];

    if (parsed.exports.length > 0) {
      parts.push(`Exports: ${parsed.exports.join(", ")}.`);
    }

    const symbols = parsed.symbols;
    if (symbols.length > 0) {
      const funcs = symbols.filter(s => s.type === "function" || s.type === "method").map(s => s.name);
      const classes = symbols.filter(s => s.type === "class").map(s => s.name);
      const components = symbols.filter(s => s.type === "component").map(s => s.name);
      const types = symbols.filter(s => s.type === "interface" || s.type === "type").map(s => s.name);
      const enums = symbols.filter(s => s.type === "enum").map(s => s.name);

      if (components.length > 0) parts.push(`Components: ${components.join(", ")}.`);
      if (classes.length > 0) parts.push(`Classes: ${classes.join(", ")}.`);
      if (funcs.length > 0) parts.push(`Functions: ${funcs.join(", ")}.`);
      if (types.length > 0) parts.push(`Types: ${types.join(", ")}.`);
      if (enums.length > 0) parts.push(`Enums: ${enums.join(", ")}.`);
    }

    if (parsed.imports.length > 0) {
      parts.push(`Imports from: ${parsed.imports.slice(0, 5).join(", ")}${parsed.imports.length > 5 ? "..." : ""}.`);
    }

    if (parts.length === 0) {
      parts.push("Utility/configuration file.");
    }

    return parts.join(" ");
  }

  private detectSideEffects(parsed: ReturnType<typeof parseCode>, content: string): string[] {
    const effects: string[] = [];
    if (content.includes("addEventListener") || content.includes("addListener")) {
      effects.push("registers event listeners");
    }
    if (content.includes("localStorage") || content.includes("sessionStorage")) {
      effects.push("reads/writes browser storage");
    }
    if (content.includes("setInterval") || content.includes("setTimeout")) {
      effects.push("schedules timers");
    }
    if (content.includes("fetch(") || content.includes("axios.") || content.includes("http.")) {
      effects.push("makes HTTP requests");
    }
    if (content.includes("new WebSocket")) {
      effects.push("opens WebSocket connections");
    }
    if (content.includes("export default") && parsed.exports.length > 0) {
      // Not really a side effect but indicates main export
    }
    return effects;
  }

  private inferRiskLevel(parsed: ReturnType<typeof parseCode>, content: string): FileSummary["riskLevel"] {
    let score = 0;
    if (content.length > 500) score += 1;
    if (content.length > 2000) score += 1;
    if (parsed.exports.length > 5) score += 1;
    if (parsed.symbols.length > 10) score += 1;
    if (content.includes("delete") || content.includes("remove")) score += 1;
    if (content.includes("admin") || content.includes("sudo") || content.includes("root")) score += 1;
    if (parsed.imports.some(i => i.includes("auth") || i.includes("security"))) score += 1;

    if (score >= 4) return "critical";
    if (score >= 3) return "high";
    if (score >= 2) return "medium";
    return "low";
  }

  getFileSummary(file: string): FileSummary | null {
    return this.store.getFileSummary(file);
  }

  getAllSummaries(): FileSummary[] {
    return this.store.getAllFileSummaries();
  }

  markStale(hash: string): void {
    const summaries = this.store.getFileSummariesByStatus("fresh");
    for (const s of summaries) {
      if (s.fileHash !== hash) {
        this.store.upsertFileSummary({ ...s, status: "stale" });
      }
    }
  }
}
