import { describe, it, expect } from "vitest";
import { Chunker } from "../../src/indexing/chunker.js";
import type { IndexConfig } from "../../src/types.js";

const testConfig: IndexConfig = {
  projectRoot: "/test",
  includePatterns: ["**/*.ts"],
  excludePatterns: ["node_modules/**"],
  maxFileSize: 10000,
  chunkSize: 10,
  chunkOverlap: 2,
  useGit: false,
  useFileWatcher: false,
  embeddingProvider: "none",
  embeddingModel: "bge-small",
};

describe("Chunker", () => {
  const chunker = new Chunker(testConfig);

  it("should create single chunk for small file", () => {
    const content = "line1\nline2\nline3";
    const chunks = chunker.chunkFile(
      "/test/file.ts", "file.ts", "typescript", content,
      [], [], [],
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(3);
    expect(chunks[0].file).toBe("file.ts");
  });

  it("should create multiple chunks for large file", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    const chunks = chunker.chunkFile(
      "/test/file.ts", "file.ts", "typescript", content,
      [], [], [],
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[chunks.length - 1].endLine).toBe(25);
  });

  it("should include symbols in chunks", () => {
    const content = "function foo() {}\nfunction bar() {}";
    const symbols = [
      { name: "foo", type: "function" as const, startLine: 1, endLine: 1 },
      { name: "bar", type: "function" as const, startLine: 2, endLine: 2 },
    ];
    const chunks = chunker.chunkFile(
      "/test/file.ts", "file.ts", "typescript", content,
      symbols, [], [],
    );
    expect(chunks[0].symbols).toContain("foo");
  });

  it("should generate consistent hashes", () => {
    const content = "const x = 1;";
    const chunks1 = chunker.chunkFile(
      "/test/a.ts", "a.ts", "typescript", content, [], [], [],
    );
    const chunks2 = chunker.chunkFile(
      "/test/a.ts", "a.ts", "typescript", content, [], [], [],
    );
    expect(chunks1[0].hash).toBe(chunks2[0].hash);
    expect(chunks1[0].id).toBe(chunks2[0].id);
  });
});
