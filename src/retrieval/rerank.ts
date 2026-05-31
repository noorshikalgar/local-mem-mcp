import type { SearchResult, FileSummary, ExtractedEntities } from "../types.js";

export interface RerankOptions {
  userQuery: string;
  entities: ExtractedEntities;
  changedFiles?: string[];
  recentFiles?: string[];
  fileSummaries?: Map<string, FileSummary>;
}

export function rerankResults(results: SearchResult[], options: RerankOptions): SearchResult[] {
  const { entities, changedFiles = [], recentFiles = [], fileSummaries = new Map() } = options;
  const lowerQuery = options.userQuery.toLowerCase();

  const scored = results.map((result) => {
    let boost = result.score;

    // Exact filename match
    const fileName = result.file.split("/").pop()?.toLowerCase() || "";
    if (lowerQuery.includes(fileName.replace(/\.[^.]+$/, ""))) {
      boost += 0.3;
    }

    // Symbol match from entities
    for (const symbol of entities.symbols) {
      if (result.codeSnippet.includes(symbol) || result.file.includes(symbol)) {
        boost += 0.2;
      }
    }

    // Entity match
    for (const entity of entities.entities) {
      if (result.file.toLowerCase().includes(entity.toLowerCase())) {
        boost += 0.15;
      }
    }

    // Recently changed files boost
    if (changedFiles.some((cf) => result.file.includes(cf))) {
      boost += 0.25;
    }

    // Recently inspected files boost
    if (recentFiles.some((rf) => result.file.includes(rf))) {
      boost += 0.15;
    }

    // Module match
    for (const mod of entities.possibleModules) {
      if (result.file.includes(mod) || result.file.includes(`/${mod}/`)) {
        boost += 0.2;
      }
    }

    // File summary risk level boost
    const summary = fileSummaries.get(result.file);
    if (summary && (summary.riskLevel === "high" || summary.riskLevel === "critical")) {
      boost += 0.1;
    }

    return { result, score: Math.min(boost, 1.0) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => ({ ...s.result, score: s.score }));
}
