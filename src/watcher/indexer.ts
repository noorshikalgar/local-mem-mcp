import * as fs from "node:fs";
import * as path from "node:path";
import type { IndexConfig, FileDiff } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";
import type { VectorStore } from "../stores/vector-store.js";
import { FileScanner } from "../indexing/file-scanner.js";
import { Chunker } from "../indexing/chunker.js";
import { parseCode } from "../indexing/parser.js";
import { FileSummaryManager } from "../memory/file-summary.js";
import { ModuleSummaryManager } from "../memory/module-summary.js";
import { GitService } from "../indexing/git.js";
import * as crypto from "node:crypto";

export class Indexer {
  private store: SQLiteStore;
  private vectorStore: VectorStore;
  private config: IndexConfig;
  private chunker: Chunker;
  private fileScanner: FileScanner;
  private fileSummaryManager: FileSummaryManager;
  private moduleSummaryManager: ModuleSummaryManager;
  private gitService: GitService;

  constructor(
    store: SQLiteStore,
    vectorStore: VectorStore,
    config: IndexConfig,
  ) {
    this.store = store;
    this.vectorStore = vectorStore;
    this.config = config;
    this.chunker = new Chunker(config);
    this.fileScanner = new FileScanner(config);
    this.fileSummaryManager = new FileSummaryManager(store, config);
    this.moduleSummaryManager = new ModuleSummaryManager(store, config);
    this.gitService = new GitService(config.projectRoot);
  }

  async indexProject(): Promise<{ filesIndexed: number; chunksIndexed: number }> {
    const scannedFiles = this.fileScanner.scan();
    let filesIndexed = 0;
    let chunksIndexed = 0;

    const allFileSummaries: import("../types.js").FileSummary[] = [];

    for (const scanned of scannedFiles) {
      const result = await this.indexFile(scanned.relativePath, scanned.content, scanned.language);
      filesIndexed += result.filesIndexed;
      chunksIndexed += result.chunksIndexed;
      if (result.fileSummary) {
        allFileSummaries.push(result.fileSummary);
      }
    }

    // Generate module summaries
    const modManager = new ModuleSummaryManager(this.store, this.config);
    const moduleFiles = modManager.detectModules(allFileSummaries);
    for (const [moduleName, files] of moduleFiles) {
      modManager.generateModuleSummary(moduleName, files);
    }

    return { filesIndexed, chunksIndexed };
  }

  private async indexFile(
    relativePath: string,
    content: string,
    language: import("../types.js").SupportedLanguage,
  ): Promise<{
    filesIndexed: number;
    chunksIndexed: number;
    fileSummary: import("../types.js").FileSummary | null;
  }> {
    const fileHash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);

    // Check if file has changed
    const existingState = this.store.getIndexState(relativePath);
    if (existingState && existingState.fileHash === fileHash && existingState.status === "fresh") {
      return { filesIndexed: 0, chunksIndexed: 0, fileSummary: null };
    }

    // Generate file summary
    const fileSummary = this.fileSummaryManager.generateSummary(
      relativePath,
      relativePath,
      language,
      content,
    );

    // Parse code
    const parsed = parseCode(relativePath, content, language);

    // Chunk the file
    const chunks = this.chunker.chunkFile(
      relativePath,
      relativePath,
      language,
      content,
      parsed.symbols,
      parsed.imports,
      parsed.exports,
    );

    // Delete old chunks and relations
    this.store.deleteChunksForFile(relativePath);
    this.store.deleteRelationsForFile(relativePath);

    // Store new chunks
    for (const chunk of chunks) {
      this.store.upsertChunk(chunk);
    }

    // Store relations (imports)
    for (const imp of parsed.imports) {
      const relId = crypto.createHash("sha256")
        .update(`import:${relativePath}:${imp}`).digest("hex").slice(0, 16);
      this.store.upsertRelation({
        id: relId,
        sourceType: "file",
        sourceName: path.basename(relativePath, path.extname(relativePath)),
        sourceFile: relativePath,
        targetType: "file",
        targetName: imp,
        targetFile: imp,
        relationType: "imports",
        weight: 1,
        status: "fresh",
        confidence: 0.98,
      });
    }

    // Vector index
    try {
      await this.vectorStore.deleteVectorsForFile(relativePath);
      await this.vectorStore.indexChunks(chunks);
    } catch {
      // vector store not available
    }

    // Update index state
    this.store.upsertIndexState(relativePath, fileHash, "fresh");

    return { filesIndexed: 1, chunksIndexed: chunks.length, fileSummary };
  }

  async handleFileChange(relativePath: string): Promise<void> {
    const fullPath = path.join(this.config.projectRoot, relativePath);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      return;
    }

    const ext = path.extname(relativePath).toLowerCase();
    const languageMap: Record<string, import("../types.js").SupportedLanguage> = {
      ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
      ".jsx": "javascript", ".py": "python", ".rs": "rust", ".go": "go",
    };
    const language = languageMap[ext];
    if (!language) return;

    await this.indexFile(relativePath, content, language);
  }

  handleFileDelete(relativePath: string): void {
    this.store.deleteChunksForFile(relativePath);
    this.store.deleteRelationsForFile(relativePath);
    this.store.deleteFileSummary(relativePath);
    this.store.deleteIndexState(relativePath);
    this.vectorStore.deleteVectorsForFile(relativePath).catch(() => {});
  }

  async refreshChangedFiles(): Promise<{ updated: number; deleted: number }> {
    let updated = 0;
    let deleted = 0;

    if (this.gitService.isRepo()) {
      const diffs = this.gitService.getDiffSummary();
      for (const diff of diffs) {
        if (diff.status === "deleted") {
          this.handleFileDelete(diff.file);
          deleted++;
        } else {
          await this.handleFileChange(diff.file);
          updated++;
        }
      }
    } else {
      const staleFiles = this.store.getStaleFiles();
      for (const file of staleFiles) {
        await this.handleFileChange(file);
        updated++;
      }
    }

    return { updated, deleted };
  }
}
