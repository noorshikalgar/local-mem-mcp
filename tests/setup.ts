import { SQLiteStore } from "../src/stores/sqlite-store.js";
import { NoOpVectorStore } from "../src/stores/vector-store.js";
import type { IndexConfig } from "../src/types.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

const TEST_BASE_DIR = path.join(process.cwd(), ".test-tmp");

function getTestDir(): string {
  const testId = crypto.randomUUID().slice(0, 8);
  return path.join(TEST_BASE_DIR, testId);
}

export function createTestStore(): SQLiteStore {
  const dir = getTestDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbPath = path.join(dir, "test-memory.db");
  return new SQLiteStore({ dbPath });
}

export function createTestIndexConfig(projectRoot?: string): IndexConfig {
  return {
    projectRoot: projectRoot || TEST_BASE_DIR,
    includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js"],
    excludePatterns: ["node_modules/**", "dist/**"],
    maxFileSize: 1024 * 100,
    chunkSize: 10,
    chunkOverlap: 2,
    useGit: false,
    useFileWatcher: false,
    embeddingProvider: "none",
    embeddingModel: "bge-small",
  };
}

export function createTestVectorStore(): NoOpVectorStore {
  return new NoOpVectorStore();
}

export function cleanupTestDirs(): void {
  try {
    if (fs.existsSync(TEST_BASE_DIR)) {
      const entries = fs.readdirSync(TEST_BASE_DIR);
      for (const entry of entries) {
        const fullPath = path.join(TEST_BASE_DIR, entry);
        try {
          const files = fs.readdirSync(fullPath);
          for (const file of files) {
            fs.unlinkSync(path.join(fullPath, file));
          }
          fs.rmdirSync(fullPath);
        } catch {
          // ignore individual cleanup errors
        }
      }
    }
  } catch {
    // ignore
  }
}
