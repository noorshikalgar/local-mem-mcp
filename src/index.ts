#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMCPServer } from "./server.js";
import * as path from "node:path";
import * as fs from "node:fs";

interface CLIOptions {
  projectRoot: string;
  dbPath?: string;
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  noWatch?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    projectRoot: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--project-root":
      case "-p":
        opts.projectRoot = path.resolve(args[++i]);
        break;
      case "--db-path":
        opts.dbPath = path.resolve(args[++i]);
        break;
      case "--embedding-url":
        opts.embeddingApiUrl = args[++i];
        break;
      case "--embedding-key":
        opts.embeddingApiKey = args[++i];
        break;
      case "--embedding-model":
        opts.embeddingModel = args[++i];
        break;
      case "--no-watch":
        opts.noWatch = true;
        break;
      case "--help":
      case "-h":
        console.log(`
local-mem-mcp - Development memory MCP server for local coding models

Usage:
  local-mem-mcp [options]

Options:
  -p, --project-root <path>  Project root directory (default: cwd)
  --db-path <path>           SQLite database path (default: .memory/memory.db)
  --embedding-url <url>      OpenAI-compatible embedding API URL
  --embedding-key <key>      API key for embedding service
  --embedding-model <model>  Embedding model name (default: bge-small)
  --no-watch                 Disable file watching
  -h, --help                 Show this help
`);
        process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.projectRoot)) {
    console.error(`Project root not found: ${opts.projectRoot}`);
    process.exit(1);
  }

  const server = await createMCPServer({
    projectRoot: opts.projectRoot,
    dbPath: opts.dbPath,
    embeddingApiUrl: opts.embeddingApiUrl,
    embeddingApiKey: opts.embeddingApiKey,
    embeddingModel: opts.embeddingModel,
    useFileWatcher: !opts.noWatch,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`local-mem-mcp running for: ${opts.projectRoot}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
