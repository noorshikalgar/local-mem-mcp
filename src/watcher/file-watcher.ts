import * as chokidar from "chokidar";
import * as path from "node:path";
import type { IndexConfig } from "../types.js";
import { FileScanner } from "../indexing/file-scanner.js";
import { Indexer } from "./indexer.js";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink";
  filePath: string;
  relativePath: string;
}

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private config: IndexConfig;
  private indexer: Indexer;
  private onFileChange: ((event: FileChangeEvent) => void) | null = null;

  constructor(config: IndexConfig, indexer: Indexer) {
    this.config = config;
    this.indexer = indexer;
  }

  start(onFileChange: (event: FileChangeEvent) => void): void {
    this.onFileChange = onFileChange;

    const includePatterns = this.config.includePatterns.map((p) =>
      path.posix.join(this.config.projectRoot.replace(/\\/g, "/"), p),
    );
    const excludePatterns = this.config.excludePatterns.map((p) =>
      /^\*\*/.test(p) ? p : `**/${p}`,
    );

    this.watcher = chokidar.watch(includePatterns, {
      ignored: [
        ...excludePatterns,
        /(^|[/\\])\./, // dotfiles
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher
      .on("add", (filePath) => this.handleEvent("add", filePath))
      .on("change", (filePath) => this.handleEvent("change", filePath))
      .on("unlink", (filePath) => this.handleEvent("unlink", filePath));
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async handleEvent(type: "add" | "change" | "unlink", filePath: string): Promise<void> {
    const relativePath = path.relative(this.config.projectRoot, filePath).replace(/\\/g, "/");

    if (this.onFileChange) {
      this.onFileChange({ type, filePath, relativePath });
    }

    if (type === "unlink") {
      this.indexer.handleFileDelete(relativePath);
    } else if (type === "add" || type === "change") {
      await this.indexer.handleFileChange(relativePath);
    }
  }
}
