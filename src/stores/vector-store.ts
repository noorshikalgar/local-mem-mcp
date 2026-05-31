import type { CodeChunk, DecisionRecord, SearchResult } from "../types.js";

export interface VectorStore {
  indexChunks(chunks: CodeChunk[]): Promise<void>;
  searchChunks(query: string, limit?: number): Promise<SearchResult[]>;
  indexDecisions(decisions: DecisionRecord[]): Promise<void>;
  searchDecisions(query: string, limit?: number): Promise<SearchResult[]>;
  deleteVectorsForFile(file: string): Promise<void>;
  clear(): Promise<void>;
}

export class NoOpVectorStore implements VectorStore {
  async indexChunks(_chunks: CodeChunk[]): Promise<void> {}
  async searchChunks(_query: string, _limit?: number): Promise<SearchResult[]> { return []; }
  async indexDecisions(_decisions: DecisionRecord[]): Promise<void> {}
  async searchDecisions(_query: string, _limit?: number): Promise<SearchResult[]> { return []; }
  async deleteVectorsForFile(_file: string): Promise<void> {}
  async clear(): Promise<void> {}
}

export class OpenAICompatibleVectorStore implements VectorStore {
  private apiUrl: string;
  private apiKey: string;
  private model: string;
  private chunks: Map<string, { chunk: CodeChunk; embedding: number[] }> = new Map();
  private decisions: Map<string, { decision: DecisionRecord; embedding: number[] }> = new Map();

  constructor(opts: { apiUrl: string; apiKey: string; model?: string }) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model || "text-embedding-ada-002";
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.apiUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as any;
    return data.data[0].embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async indexChunks(chunks: CodeChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const text = `${chunk.file}\n${chunk.chunk}`;
      try {
        const embedding = await this.getEmbedding(text);
        this.chunks.set(chunk.id, { chunk, embedding });
      } catch (err) {
        console.error(`Failed to embed chunk ${chunk.id}:`, err);
      }
    }
  }

  async searchChunks(query: string, limit = 10): Promise<SearchResult[]> {
    if (this.chunks.size === 0) return [];
    const queryEmbedding = await this.getEmbedding(query);

    const results: Array<{ result: SearchResult; score: number }> = [];
    for (const { chunk, embedding } of this.chunks.values()) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      results.push({
        result: {
          file: chunk.file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
          whyMatched: `semantic similarity: ${(score * 100).toFixed(1)}%`,
          codeSnippet: chunk.chunk,
          language: chunk.language,
          status: chunk.status,
        },
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.result);
  }

  async indexDecisions(decisions: DecisionRecord[]): Promise<void> {
    for (const d of decisions) {
      const text = `${d.title}\n${d.decision}\n${d.reason}`;
      try {
        const embedding = await this.getEmbedding(text);
        this.decisions.set(d.id, { decision: d, embedding });
      } catch (err) {
        console.error(`Failed to embed decision ${d.id}:`, err);
      }
    }
  }

  async searchDecisions(query: string, limit = 10): Promise<SearchResult[]> {
    if (this.decisions.size === 0) return [];
    const queryEmbedding = await this.getEmbedding(query);

    const results: Array<{ result: SearchResult; score: number }> = [];
    for (const { decision, embedding } of this.decisions.values()) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      results.push({
        result: {
          file: decision.files.join(", "),
          startLine: 0,
          endLine: 0,
          score,
          whyMatched: `semantic similarity: ${(score * 100).toFixed(1)}%`,
          codeSnippet: decision.decision,
          status: decision.status,
        },
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.result);
  }

  async deleteVectorsForFile(file: string): Promise<void> {
    for (const [id, { chunk }] of this.chunks) {
      if (chunk.file === file) this.chunks.delete(id);
    }
  }

  async clear(): Promise<void> {
    this.chunks.clear();
    this.decisions.clear();
  }
}
