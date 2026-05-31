import { describe, it, expect } from "vitest";
import { FileScanner } from "../../src/indexing/file-scanner.js";
import type { IndexConfig } from "../../src/types.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-mcp-test-"));
  fs.writeFileSync(path.join(dir, "index.ts"), "export function hello() { return 1; }");
  fs.writeFileSync(path.join(dir, "utils.ts"), "export const x = 1;");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "dep.ts"), "should be ignored");
  fs.mkdirSync(path.join(dir, "dist"));
  fs.writeFileSync(path.join(dir, "dist", "bundle.js"), "should be ignored");
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ key: "value" }));
  return dir;
}

describe("FileScanner", () => {
  it("should scan project files and skip ignored patterns", () => {
    const dir = createTempProject();
    const config: IndexConfig = {
      projectRoot: dir,
      includePatterns: ["**/*.ts", "**/*.json"],
      excludePatterns: ["node_modules/**", "dist/**"],
      maxFileSize: 10000,
      chunkSize: 50,
      chunkOverlap: 10,
      useGit: false,
      useFileWatcher: false,
      embeddingProvider: "none",
      embeddingModel: "bge-small",
    };

    const scanner = new FileScanner(config);
    const files = scanner.scan();

    expect(files.length).toBeGreaterThanOrEqual(2);
    const filenames = files.map((f) => f.relativePath);
    expect(filenames).toContain("index.ts");
    expect(filenames).toContain("utils.ts");
    // Should NOT contain node_modules or dist files
    expect(filenames).not.toContain("node_modules/dep.ts");
    expect(filenames).not.toContain("dist/bundle.js");

    // Cleanup
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("should compute file hash", () => {
    const config: IndexConfig = {
      projectRoot: "/test",
      includePatterns: ["**/*.ts"],
      excludePatterns: ["node_modules/**"],
      maxFileSize: 10000,
      chunkSize: 50,
      chunkOverlap: 10,
      useGit: false,
      useFileWatcher: false,
      embeddingProvider: "none",
      embeddingModel: "bge-small",
    };
    const scanner = new FileScanner(config);
    const hash1 = scanner.getFileHash("hello world");
    const hash2 = scanner.getFileHash("hello world");
    const hash3 = scanner.getFileHash("different content");
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});
