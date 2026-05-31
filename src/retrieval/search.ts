import type { CodeChunk, SearchParams, SearchResult } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";
import type { VectorStore } from "../stores/vector-store.js";

export class SearchEngine {
  private store: SQLiteStore;
  private vectorStore: VectorStore;

  constructor(store: SQLiteStore, vectorStore: VectorStore) {
    this.store = store;
    this.vectorStore = vectorStore;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const { query, limit, includeTests, fileFilter, moduleFilter, symbolFilter } = params;

    const candidates: Map<string, { result: SearchResult; score: number }> = new Map();

    // 1. Keyword search
    const keywordResults = this.store.searchChunksByKeyword(query, limit * 2);
    for (const chunk of keywordResults) {
      const score = this.computeKeywordScore(query, chunk);
      const key = `${chunk.file}:${chunk.startLine}`;
      const existing = candidates.get(key);
      if (!existing || score > existing.score) {
        candidates.set(key, {
          result: this.chunkToSearchResult(chunk, score, `keyword match: ${query}`),
          score,
        });
      }
    }

    // 2. Symbol search
    if (symbolFilter || query) {
      const searchSymbol = symbolFilter || query;
      const symbolResults = this.store.searchChunksBySymbol(searchSymbol, limit);
      for (const chunk of symbolResults) {
        const score = 0.9;
        const key = `${chunk.file}:${chunk.startLine}`;
        const existing = candidates.get(key);
        if (!existing || score > existing.score) {
          candidates.set(key, {
            result: this.chunkToSearchResult(chunk, score, `symbol match: ${searchSymbol}`),
            score,
          });
        }
      }
    }

    // 3. Vector search (if available)
    try {
      const vectorResults = await this.vectorStore.searchChunks(query, limit);
      for (const vr of vectorResults) {
        const key = `${vr.file}:${vr.startLine}`;
        const existing = candidates.get(key);
        if (!existing || vr.score > existing.score) {
          candidates.set(key, { result: vr, score: vr.score });
        }
      }
    } catch {
      // vector search not available, skip
    }

    // 4. File filter
    let results = [...candidates.values()];
    if (fileFilter) {
      results = results.filter((r) => r.result.file.includes(fileFilter));
    }

    // 5. Test filter
    if (!includeTests) {
      results = results.filter((r) => !r.result.file.includes(".spec.") && !r.result.file.includes(".test."));
    }

    // 6. Module filter
    if (moduleFilter) {
      results = results.filter((r) => r.result.file.includes(moduleFilter));
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.result);
  }

  private computeKeywordScore(query: string, chunk: CodeChunk): number {
    const lowerQuery = query.toLowerCase();
    const lowerChunk = chunk.chunk.toLowerCase();
    const lowerFile = chunk.file.toLowerCase();

    let score = 0;

    // Exact file path match
    if (lowerFile === lowerQuery) score += 1.0;
    else if (lowerFile.includes(lowerQuery)) score += 0.5;

    // Symbol match
    if (chunk.symbols.some((s) => s.toLowerCase().includes(lowerQuery))) score += 0.8;

    // Content match frequency
    const matches = lowerChunk.split(lowerQuery).length - 1;
    score += Math.min(matches * 0.1, 0.5);

    // Exact line match
    for (const line of lowerChunk.split("\n")) {
      if (line.includes(lowerQuery) && line.trim().length < 100) {
        score += 0.2;
      }
    }

    return Math.min(score, 1.0);
  }

  private chunkToSearchResult(chunk: CodeChunk, score: number, whyMatched: string): SearchResult {
    return {
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score,
      whyMatched,
      codeSnippet: chunk.chunk,
      language: chunk.language,
      status: chunk.status,
    };
  }
}
