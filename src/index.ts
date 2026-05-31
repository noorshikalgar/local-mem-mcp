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
  qdrantUrl?: string;
  qdrantApiKey?: string;
  neo4jUrl?: string;
  neo4jPassword?: string;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
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
      case "--qdrant-url":
        opts.qdrantUrl = args[++i];
        break;
      case "--qdrant-api-key":
        opts.qdrantApiKey = args[++i];
        break;
      case "--neo4j-url":
        opts.neo4jUrl = args[++i];
        break;
      case "--neo4j-password":
        opts.neo4jPassword = args[++i];
        break;
      case "--llm-url":
        opts.llmApiUrl = args[++i];
        break;
      case "--llm-key":
        opts.llmApiKey = args[++i];
        break;
      case "--llm-model":
        opts.llmModel = args[++i];
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
  --qdrant-url <url>         Qdrant vector DB URL (default: http://localhost:6333)
  --qdrant-api-key <key>     API key for Qdrant
  --neo4j-url <url>          Neo4j graph DB URL (default: bolt://localhost:7687)
  --neo4j-password <pass>    Neo4j password (default: neo4j)
  --llm-url <url>            LM Studio / OpenAI-compatible LLM API URL (default: http://localhost:1234/v1)
  --llm-key <key>            API key for LLM service
  --llm-model <model>        LLM model name (default: local-model)
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
    qdrantUrl: opts.qdrantUrl,
    qdrantApiKey: opts.qdrantApiKey,
    neo4jUrl: opts.neo4jUrl,
    neo4jPassword: opts.neo4jPassword,
    llmApiUrl: opts.llmApiUrl,
    llmApiKey: opts.llmApiKey,
    llmModel: opts.llmModel,
    useLlmSummaries: !!opts.llmApiUrl,
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
