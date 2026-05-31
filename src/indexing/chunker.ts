import * as crypto from "node:crypto";
import type { CodeChunk, IndexConfig, SupportedLanguage, ParsedSymbol } from "../types.js";

export interface ParseResult {
  imports: string[];
  exports: string[];
  symbols: ParsedSymbol[];
  chunks: CodeChunk[];
}

export class Chunker {
  private config: IndexConfig;

  constructor(config: IndexConfig) {
    this.config = config;
  }

  chunkFile(
    filePath: string,
    relativePath: string,
    language: SupportedLanguage,
    content: string,
    symbols: ParsedSymbol[],
    imports: string[],
    exports: string[],
  ): CodeChunk[] {
    const lines = content.split("\n");
    const chunkSize = this.config.chunkSize;
    const overlap = this.config.chunkOverlap;
    const chunks: CodeChunk[] = [];

    if (lines.length <= chunkSize) {
      chunks.push(this.makeChunk(
        relativePath, language, 1, lines.length, content, symbols.map(s => s.name), imports, exports,
      ));
    } else {
      let start = 0;
      while (start < lines.length) {
        const end = Math.min(start + chunkSize, lines.length);
        const chunkContent = lines.slice(start, end).join("\n");

        const chunkSymbols = symbols
          .filter((s) => s.startLine >= start + 1 && s.startLine <= end)
          .map((s) => s.name);
        const chunkImports = [...imports];

        chunks.push(this.makeChunk(
          relativePath, language, start + 1, end, chunkContent, chunkSymbols, chunkImports, exports,
        ));

        if (end >= lines.length) break;
        start = end - overlap;
      }
    }

    return chunks;
  }

  private makeChunk(
    file: string,
    language: SupportedLanguage,
    startLine: number,
    endLine: number,
    chunk: string,
    symbols: string[],
    imports: string[],
    exports: string[],
  ): CodeChunk {
    const id = crypto.createHash("sha256").update(`${file}:${startLine}:${endLine}`).digest("hex").slice(0, 16);
    const hash = crypto.createHash("sha256").update(chunk).digest("hex").slice(0, 16);

    return {
      id,
      file,
      language,
      startLine,
      endLine,
      chunk,
      hash,
      symbols,
      imports,
      exports,
      embedding: null,
      lastModified: null,
      gitCommitHash: null,
      status: "fresh",
    };
  }
}
