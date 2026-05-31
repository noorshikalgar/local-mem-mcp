import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import type { IndexConfig, SupportedLanguage } from "../types.js";

const EXTENSION_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "cpp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".md": "markdown",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "scss",
};

export interface ScannedFile {
  filePath: string;
  relativePath: string;
  language: SupportedLanguage;
  content: string;
  size: number;
}

export class FileScanner {
  private config: IndexConfig;
  private ig: ReturnType<typeof ignore>;
  private includeExts: Set<string>;

  constructor(config: IndexConfig) {
    this.config = config;
    this.ig = ignore().add(config.excludePatterns);
    this.includeExts = new Set(
      config.includePatterns
        .map((p) => p.replace("**/*", ""))
        .filter(Boolean),
    );
  }

  scan(): ScannedFile[] {
    const files: ScannedFile[] = [];
    this.scanDir(this.config.projectRoot, files);
    return files;
  }

  private scanDir(dirPath: string, files: ScannedFile[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(this.config.projectRoot, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        const igResult = this.ig.ignores(relativePath + "/");
        if (igResult) continue;
        this.scanDir(fullPath, files);
      } else if (entry.isFile()) {
        const igResult = this.ig.ignores(relativePath);
        if (igResult) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (this.includeExts.size > 0 && !this.includeExts.has(ext)) continue;
        const language = EXTENSION_LANGUAGE_MAP[ext];
        if (!language) continue;

        let content: string;
        try {
          content = fs.readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }

        if (content.length > this.config.maxFileSize) continue;

        files.push({
          filePath: fullPath,
          relativePath,
          language,
          content,
          size: content.length,
        });
      }
    }
  }

  getFileHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}
