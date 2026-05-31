# local-mem-mcp

**Development memory layer MCP server for local coding models.**

A production-grade MCP (Model Context Protocol) server that provides an external memory layer for local LLMs (like 9B models running on LM Studio). Instead of forcing small models to handle large context windows, this server acts as a **senior repo navigator + compression engine + evidence retriever + change tracker**.

## Architecture

```
Zed/IDE → MCP memory server → LM Studio (9B coding model)
              │
              ├── SQLite (metadata, summaries, decisions)
              ├── Vector DB (semantic code search) [optional]
              └── Git integration
```

The memory server sits **near the codebase**, not inside LM Studio. It indexes your project, generates layered summaries, tracks decisions and rules, and injects only the relevant context into each task.

## Features

### 8 Memory Layers
| Layer | Purpose |
|-------|---------|
| 1. Raw Code Index | Semantic + keyword code search, symbol lookup |
| 2. File Summaries | Compact summaries, risk levels, side effects |
| 3. Module Summaries | Feature-level overviews, entry points, core files |
| 4. Relationship Graph | Import dependencies, usage, test coverage |
| 5. Decision Memory | Architectural decisions with reasoning |
| 6. Project Rules | Enforceable conventions and constraints |
| 7. Session Memory | Temporary working memory per coding session |
| 8. Task Memory | Persistent task tracking and state |

### Staged Retrieval Pipeline
1. **Classify** the task (bug fix, new feature, refactor, etc.)
2. **Extract entities** (modules, symbols, files)
3. **Retrieve summaries first** (map before code)
4. **Fetch exact snippets** (code chunks with line numbers)
5. **Rerank** results (filename, symbol, graph distance, recency)
6. **Build context pack** (compact, budget-controlled)

### 18 MCP Tools
- `index_project`, `refresh_changed_files` — repo indexing
- `search_code`, `search_project_memory` — search across all layers
- `get_file_summary`, `get_file_outline`, `get_symbol` — file introspection
- `find_related_files`, `impact_analysis` — dependency analysis
- `get_project_rules`, `get_decisions`, `remember_decision`, `add_project_rule` — rule/decision management
- `update_task_memory`, `get_current_task_context` — task tracking
- `summarize_diff`, `compact_memory`, `classify_task` — utility

## Quick Start

```bash
# Install
npm install -g local-mem-mcp

# Run in your project
cd my-project
local-mem-mcp

# With custom embedding service (e.g., LM Studio embeddings)
local-mem-mcp --embedding-url http://localhost:1234/v1 --embedding-key not-needed
```

### MCP Client Configuration (Zed)

In your Zed `settings.json`:

```json
{
  "mcp": {
    "local-mem-mcp": {
      "command": "node",
      "args": ["path/to/local-mem-mcp/dist/index.js", "--project-root", "/path/to/your/project"]
    }
  }
}
```

For **Claude Desktop**:

```json
{
  "mcpServers": {
    "local-mem-mcp": {
      "command": "node",
      "args": ["path/to/local-mem-mcp/dist/index.js"]
    }
  }
}
```

## CLI Options

```
  -p, --project-root <path>  Project root directory (default: cwd)
  --db-path <path>           SQLite database path (default: .memory/memory.db)
  --embedding-url <url>      OpenAI-compatible embedding API URL
  --embedding-key <key>      API key for embedding service
  --embedding-model <model>  Embedding model name (default: bge-small)
  --no-watch                 Disable file watching
  -h, --help                 Show this help
```

## Development

```bash
# Clone and install
git clone https://github.com/your-org/local-mem-mcp.git
cd local-mem-mcp
npm install

# Build
npm run build

# Test
npm test
npm run test:coverage

# Type check
npm run typecheck
```

## Project Structure

```
src/
├── index.ts              # Entry point / CLI
├── server.ts             # MCP server + all tool handlers
├── types.ts              # Zod-validated types
├── stores/
│   ├── sqlite-store.ts   # SQLite persistence
│   └── vector-store.ts   # Vector DB interface (OpenAI-compatible)
├── indexing/
│   ├── file-scanner.ts   # Recursive file scan with gitignore
│   ├── parser.ts         # Code parser (functions, classes, types)
│   ├── chunker.ts        # Code chunk extraction
│   └── git.ts            # Git integration
├── memory/
│   ├── file-summary.ts   # Layer 2: File summaries
│   ├── module-summary.ts # Layer 3: Module summaries
│   ├── decisions.ts      # Layer 5: Decision memory
│   ├── rules.ts          # Layer 6: Project rules
│   ├── task-memory.ts    # Layer 8: Task memory
│   └── session-memory.ts # Layer 7: Session memory
├── retrieval/
│   ├── search.ts         # Multi-strategy search engine
│   ├── classify.ts       # Task classification + entity extraction
│   ├── pipeline.ts       # Staged retrieval pipeline
│   └── rerank.ts         # Result reranking
├── watcher/
│   ├── file-watcher.ts   # File system watcher
│   └── indexer.ts        # Incremental indexer
└── compaction/
    └── compactor.ts      # Memory compaction
tests/
├── stores/
├── indexing/
├── memory/
├── retrieval/
└── compaction/
```

## License

MIT
