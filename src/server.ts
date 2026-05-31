import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IndexConfig } from "./types.js";
import { SQLiteStore } from "./stores/sqlite-store.js";
import { NoOpVectorStore, OpenAICompatibleVectorStore } from "./stores/vector-store.js";
import { Indexer } from "./watcher/indexer.js";
import { FileSummaryManager } from "./memory/file-summary.js";
import { ModuleSummaryManager } from "./memory/module-summary.js";
import { DecisionManager } from "./memory/decisions.js";
import { RulesManager } from "./memory/rules.js";
import { TaskMemoryManager } from "./memory/task-memory.js";
import { SessionMemoryManager } from "./memory/session-memory.js";
import { RetrievalPipeline } from "./retrieval/pipeline.js";
import { Compactor } from "./compaction/compactor.js";
import { GitService } from "./indexing/git.js";
import { FileScanner } from "./indexing/file-scanner.js";
import { SearchEngine } from "./retrieval/search.js";
import { classifyTask, extractEntities } from "./retrieval/classify.js";
import { rerankResults } from "./retrieval/rerank.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MCPServerOptions {
  projectRoot: string;
  dbPath?: string;
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  useFileWatcher?: boolean;
}

export async function createMCPServer(opts: MCPServerOptions): Promise<Server> {
  const projectRoot = path.resolve(opts.projectRoot);
  const dbPath = opts.dbPath || path.join(projectRoot, ".memory", "memory.db");

  const indexConfig: IndexConfig = {
    projectRoot,
    includePatterns: [
      "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
      "**/*.py", "**/*.rs", "**/*.go", "**/*.java",
      "**/*.cs", "**/*.css", "**/*.scss", "**/*.json",
      "**/*.yaml", "**/*.yml", "**/*.md",
    ],
    excludePatterns: [
      "node_modules/**", "dist/**", "build/**", ".git/**",
      "coverage/**", ".next/**", "target/**", "vendor/**",
      "*.min.*",
    ],
    maxFileSize: 1024 * 100,
    chunkSize: 50,
    chunkOverlap: 10,
    useGit: true,
    useFileWatcher: opts.useFileWatcher ?? true,
    embeddingProvider: opts.embeddingApiUrl ? "openai" : "none",
    embeddingApiUrl: opts.embeddingApiUrl,
    embeddingApiKey: opts.embeddingApiKey,
    embeddingModel: opts.embeddingModel || "bge-small",
  };

  const store = new SQLiteStore({ dbPath });
  const vectorStore = indexConfig.embeddingProvider === "openai" && indexConfig.embeddingApiUrl
    ? new OpenAICompatibleVectorStore({
        apiUrl: indexConfig.embeddingApiUrl,
        apiKey: indexConfig.embeddingApiKey || "",
        model: indexConfig.embeddingModel,
      })
    : new NoOpVectorStore();

  // Initialize managers
  const indexer = new Indexer(store, vectorStore, indexConfig);
  const fileSummaryManager = new FileSummaryManager(store, indexConfig);
  const moduleSummaryManager = new ModuleSummaryManager(store, indexConfig);
  const decisionManager = new DecisionManager(store);
  const rulesManager = new RulesManager(store);
  const taskMemoryManager = new TaskMemoryManager(store);
  const sessionMemoryManager = new SessionMemoryManager(store);
  const retrievalPipeline = new RetrievalPipeline(store, vectorStore, indexConfig);
  const compactor = new Compactor(store, indexConfig, fileSummaryManager, moduleSummaryManager, decisionManager);
  const gitService = new GitService(projectRoot);
  const searchEngine = new SearchEngine(store, vectorStore);
  const fileScanner = new FileScanner(indexConfig);

  const server = new Server(
    {
      name: "local-mem-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ─── Tool List ──────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "index_project",
          description: "Full index of the project: scan files, parse code, generate summaries, build relations",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "refresh_changed_files",
          description: "Re-index only changed files since last index (uses git diff or stale markers)",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "search_code",
          description: "Semantic + keyword + symbol search over indexed code chunks",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: { type: "number", default: 10, description: "Max results" },
              include_tests: { type: "boolean", default: false, description: "Include test files" },
              file_filter: { type: "string", description: "Filter by file path pattern" },
              module_filter: { type: "string", description: "Filter by module name" },
              symbol_filter: { type: "string", description: "Filter by symbol name" },
            },
            required: ["query"],
          },
        },
        {
          name: "search_project_memory",
          description: "Search across all memory layers: summaries, decisions, rules, tasks",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: { type: "number", default: 10 },
            },
            required: ["query"],
          },
        },
        {
          name: "get_file_summary",
          description: "Get compact summary of a file",
          inputSchema: {
            type: "object",
            properties: {
              file: { type: "string", description: "File path relative to project root" },
            },
            required: ["file"],
          },
        },
        {
          name: "get_file_outline",
          description: "Get outline of a file: imports, exports, sections, symbols with line numbers",
          inputSchema: {
            type: "object",
            properties: {
              file: { type: "string", description: "File path relative to project root" },
            },
            required: ["file"],
          },
        },
        {
          name: "get_symbol",
          description: "Get exact code for a symbol (function, class, component, etc.)",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Symbol name" },
              file: { type: "string", description: "Optional file filter" },
            },
            required: ["symbol"],
          },
        },
        {
          name: "find_related_files",
          description: "Find files related via imports, usage, tests, or decisions",
          inputSchema: {
            type: "object",
            properties: {
              file: { type: "string", description: "File path relative to project root" },
              depth: { type: "number", default: 1, description: "Relationship depth" },
            },
            required: ["file"],
          },
        },
        {
          name: "impact_analysis",
          description: "Analyze blast radius before changing a file",
          inputSchema: {
            type: "object",
            properties: {
              target: { type: "string", description: "File path to analyze" },
            },
            required: ["target"],
          },
        },
        {
          name: "get_project_rules",
          description: "Get active project rules and conventions",
          inputSchema: {
            type: "object",
            properties: {
              module: { type: "string", description: "Optional module filter" },
              file: { type: "string", description: "Optional file filter" },
            },
          },
        },
        {
          name: "get_decisions",
          description: "Get architectural decisions relevant to a context",
          inputSchema: {
            type: "object",
            properties: {
              area: { type: "string", description: "Module or area name" },
              query: { type: "string", description: "Search query" },
              file: { type: "string", description: "Related file path" },
            },
          },
        },
        {
          name: "remember_decision",
          description: "Store an architectural or design decision",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Decision title" },
              area: { type: "string", description: "Module/area" },
              files: {
                type: "array",
                items: { type: "string" },
                description: "Affected files",
              },
              decision: { type: "string", description: "What was decided" },
              reason: { type: "string", description: "Why it was decided" },
              rule: { type: "string", description: "Optional actionable rule" },
            },
            required: ["title", "area", "decision", "reason"],
          },
        },
        {
          name: "add_project_rule",
          description: "Add a project rule or convention",
          inputSchema: {
            type: "object",
            properties: {
              rule: { type: "string", description: "The rule text" },
              category: { type: "string", default: "general" },
              modules: {
                type: "array",
                items: { type: "string" },
                description: "Affected modules",
              },
              priority: {
                type: "number",
                default: 3,
                description: "Priority 1-5 (5 = highest)",
              },
            },
            required: ["rule"],
          },
        },
        {
          name: "update_task_memory",
          description: "Create or update current task memory",
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string", description: "Task description" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              files_touched: {
                type: "array",
                items: { type: "string" },
              },
              decisions: {
                type: "array",
                items: { type: "string" },
              },
              open_questions: {
                type: "array",
                items: { type: "string" },
              },
              task_id: { type: "string", description: "Existing task ID to update" },
            },
          },
        },
        {
          name: "get_current_task_context",
          description: "Get a compact context pack for the current task (staged retrieval)",
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string", description: "Task description" },
              include_tests: { type: "boolean", default: false },
            },
            required: ["task"],
          },
        },
        {
          name: "summarize_diff",
          description: "Summarize a git diff and optionally save to memory",
          inputSchema: {
            type: "object",
            properties: {
              diff: { type: "string", description: "Git diff text" },
              save: { type: "boolean", default: false, description: "Save as task memory" },
            },
            required: ["diff"],
          },
        },
        {
          name: "compact_memory",
          description: "Run memory compaction: fix stale summaries, resolve decision conflicts",
          inputSchema: {
            type: "object",
            properties: {
              all: { type: "boolean", default: true },
            },
          },
        },
        {
          name: "classify_task",
          description: "Classify a task to determine what memory layers to prioritize",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Task description" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_module_summary",
          description: "Get summary for a module/feature area",
          inputSchema: {
            type: "object",
            properties: {
              module: { type: "string", description: "Module name" },
            },
            required: ["module"],
          },
        },
      ],
    };
  });

  // ─── Tool Handlers ──────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      // ── Indexing ──────────────────────────────────────────────────────

      case "index_project": {
        const result = await indexer.indexProject();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Project indexed successfully",
              filesIndexed: result.filesIndexed,
              chunksIndexed: result.chunksIndexed,
            }, null, 2),
          }],
        };
      }

      case "refresh_changed_files": {
        const result = await indexer.refreshChangedFiles();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Changed files refreshed",
              updated: result.updated,
              deleted: result.deleted,
            }, null, 2),
          }],
        };
      }

      // ── Search ────────────────────────────────────────────────────────

      case "search_code": {
        const query = args?.query as string;
        const limit = (args?.limit as number) || 10;
        const includeTests = (args?.include_tests as boolean) || false;
        const fileFilter = args?.file_filter as string | undefined;
        const moduleFilter = args?.module_filter as string | undefined;
        const symbolFilter = args?.symbol_filter as string | undefined;

        const results = await searchEngine.search({
          query,
          limit,
          includeTests,
          fileFilter,
          moduleFilter,
          symbolFilter,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              count: results.length,
              results: results.map((r) => ({
                file: r.file,
                lines: `${r.startLine}-${r.endLine}`,
                score: r.score,
                why: r.whyMatched,
                snippet: r.codeSnippet.split("\n").slice(0, 15).join("\n"),
              })),
            }, null, 2),
          }],
        };
      }

      case "search_project_memory": {
        const memQuery = args?.query as string;
        const memLimit = (args?.limit as number) || 10;

        const decisions = decisionManager.searchDecisions(memQuery, memLimit);
        const tasks = taskMemoryManager.searchTasks(memQuery);
        const modules = moduleSummaryManager.getAllModuleSummaries()
          .filter((m) => m.module.includes(memQuery) || m.purpose.includes(memQuery));
        const summaries = fileSummaryManager.getAllSummaries()
          .filter((s) => s.summary.includes(memQuery) || s.file.includes(memQuery));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: memQuery,
              decisions: decisions.map((d) => ({
                title: d.title, area: d.area, decision: d.decision,
              })),
              tasks: tasks.map((t) => ({
                task: t.task, status: t.status, files: t.filesTouched,
              })),
              modules: modules.map((m) => ({
                module: m.module, purpose: m.purpose,
              })),
              files: summaries.slice(0, memLimit).map((s) => ({
                file: s.file, summary: s.summary, risk: s.riskLevel,
              })),
            }, null, 2),
          }],
        };
      }

      // ── File Operations ───────────────────────────────────────────────

      case "get_file_summary": {
        const file = args?.file as string;
        const summary = fileSummaryManager.getFileSummary(file);
        if (!summary) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "File not indexed" }) }],
            isError: true,
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(summary, null, 2),
          }],
        };
      }

      case "get_file_outline": {
        const outlineFile = args?.file as string;
        const summary = fileSummaryManager.getFileSummary(outlineFile);
        if (!summary) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "File not indexed" }) }],
            isError: true,
          };
        }

        const chunks = store.getChunksForFile(outlineFile);
        const outline = {
          file: outlineFile,
          totalLines: summary.totalLines,
          language: summary.language,
          imports: summary.mainImports,
          exports: summary.mainExports,
          symbols: summary.symbols,
          sections: chunks.map((c) => ({
            startLine: c.startLine,
            endLine: c.endLine,
            symbols: c.symbols,
          })),
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(outline, null, 2),
          }],
        };
      }

      case "get_symbol": {
        const symbol = args?.symbol as string;
        const fileFilter2 = args?.file as string | undefined;

        let chunks = store.searchChunksBySymbol(symbol, 10);
        if (fileFilter2) {
          chunks = chunks.filter((c) => c.file.includes(fileFilter2));
        }

        if (chunks.length === 0) {
          // Try keyword search as fallback
          chunks = store.searchChunksByKeyword(symbol, 5);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              count: chunks.length,
              results: chunks.map((c) => ({
                file: c.file,
                lines: `${c.startLine}-${c.endLine}`,
                code: c.chunk,
              })),
            }, null, 2),
          }],
        };
      }

      // ── Relations ─────────────────────────────────────────────────────

      case "find_related_files": {
        const relFile = args?.file as string;
        const depth = (args?.depth as number) || 1;

        const relations = store.findRelatedFiles(relFile, depth);
        const affected = store.findAffectedFiles(relFile);
        const decisions4File = decisionManager.getDecisionsForFile(relFile);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              target: relFile,
              directRelations: relations.map((r) => ({
                source: r.sourceFile,
                target: r.targetFile || r.targetName,
                type: r.relationType,
              })),
              affectedFiles: affected.files,
              affectedTests: affected.tests,
              relevantDecisions: decisions4File.map((d) => ({
                title: d.title,
                decision: d.decision,
              })),
            }, null, 2),
          }],
        };
      }

      case "impact_analysis": {
        const impactTarget = args?.target as string;
        const affected = store.findAffectedFiles(impactTarget);
        const summary = fileSummaryManager.getFileSummary(impactTarget);
        const decisions4Impact = decisionManager.getDecisionsForFile(impactTarget);

        let riskLevel = "low";
        if (affected.files.length > 5) riskLevel = "critical";
        else if (affected.files.length > 2) riskLevel = "high";
        else if (affected.files.length > 0) riskLevel = "medium";

        // Get routes
        const routeRelations = store.findRelatedFiles(impactTarget)
          .filter((r) => r.relationType === "imports" && r.targetFile?.includes("route"));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              target: impactTarget,
              riskLevel,
              affectedRoutes: routeRelations.map((r) => r.sourceFile),
              affectedFiles: affected.files,
              affectedTests: affected.tests,
              relevantDecisions: decisions4Impact.map((d) => ({
                title: d.title,
                decision: d.decision,
              })),
              fileRisk: summary?.riskLevel || "unknown",
            }, null, 2),
          }],
        };
      }

      // ── Rules & Decisions ─────────────────────────────────────────────

      case "get_project_rules": {
        const ruleModule = args?.module as string | undefined;
        const ruleFile = args?.file as string | undefined;

        let rules;
        if (ruleFile) {
          rules = rulesManager.getRulesForFile(ruleFile);
        } else if (ruleModule) {
          rules = rulesManager.getRulesForModule(ruleModule);
        } else {
          rules = rulesManager.getActiveRules();
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: rules.length,
              rules: rules.map((r) => ({
                rule: r.rule,
                category: r.category,
                priority: r.priority,
                source: r.source,
              })),
            }, null, 2),
          }],
        };
      }

      case "get_decisions": {
        const decArea = args?.area as string | undefined;
        const decQuery = args?.query as string | undefined;
        const decFile = args?.file as string | undefined;

        let decisions;
        if (decFile) {
          decisions = decisionManager.getDecisionsForFile(decFile);
        } else if (decArea) {
          decisions = decisionManager.getDecisionsForArea(decArea);
        } else if (decQuery) {
          decisions = decisionManager.searchDecisions(decQuery);
        } else {
          decisions = decisionManager.getAllActiveDecisions();
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: decisions.length,
              decisions: decisions.map((d) => ({
                id: d.id,
                title: d.title,
                area: d.area,
                date: d.date,
                decision: d.decision,
                reason: d.reason,
                rule: d.rule,
                files: d.files,
                supersededBy: d.supersededBy,
              })),
            }, null, 2),
          }],
        };
      }

      case "remember_decision": {
        const newDec = decisionManager.addDecision({
          title: args?.title as string,
          area: args?.area as string,
          files: args?.files as string[] | undefined,
          decision: args?.decision as string,
          reason: args?.reason as string,
          rule: args?.rule as string | undefined,
          branchName: gitService.isRepo() ? gitService.getCurrentBranch() : null,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Decision saved",
              id: newDec.id,
              decision: newDec.decision,
            }, null, 2),
          }],
        };
      }

      case "add_project_rule": {
        const newRule = rulesManager.addRule({
          rule: args?.rule as string,
          category: (args?.category as string) || "general",
          modules: args?.modules as string[] | undefined,
          priority: (args?.priority as number) || 3,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Rule added",
              id: newRule.id,
              rule: newRule.rule,
            }, null, 2),
          }],
        };
      }

      // ── Task Memory ───────────────────────────────────────────────────

      case "update_task_memory": {
        const taskId = args?.task_id as string | undefined;
        const taskDesc = args?.task as string;
        const status = args?.status as string | undefined;
        const filesTouched = args?.files_touched as string[] | undefined;
        const decisions2 = args?.decisions as string[] | undefined;
        const openQuestions = args?.open_questions as string[] | undefined;

        let task;
        if (taskId) {
          task = taskMemoryManager.updateTask(taskId, {
            status: status as any,
            filesTouched,
            decisions: decisions2,
            openQuestions,
          });
        } else if (taskDesc) {
          task = taskMemoryManager.createTask(
            taskDesc,
            gitService.isRepo() ? gitService.getCurrentBranch() : null,
          );
          if (status || filesTouched || decisions2 || openQuestions) {
            task = taskMemoryManager.updateTask(task!.id, {
              status: status as any,
              filesTouched,
              decisions: decisions2,
              openQuestions,
            });
          }
        }

        if (!task) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Task not found or not created" }) }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Task updated",
              task: {
                id: task.id,
                task: task.task,
                status: task.status,
                filesTouched: task.filesTouched,
                decisions: task.decisions,
                openQuestions: task.openQuestions,
              },
            }, null, 2),
          }],
        };
      }

      // ── Retrieval Pipeline ────────────────────────────────────────────

      case "get_current_task_context": {
        const ctxTask = args?.task as string;
        const includeTests = (args?.include_tests as boolean) || false;

        const gitInfo = gitService.isRepo()
          ? { changedFiles: gitService.getChangedFiles() }
          : { changedFiles: [] as string[] };

        const contextPack = await retrievalPipeline.retrieveContext(ctxTask, {
          changedFiles: gitInfo.changedFiles,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              task: contextPack.task,
              taskType: contextPack.taskType,
              projectRules: contextPack.projectRules.map((r) => r.rule),
              decisions: contextPack.decisions.map((d) => ({
                title: d.title,
                decision: d.decision,
                reason: d.reason,
              })),
              moduleSummaries: contextPack.moduleSummaries.map((m) => ({
                module: m.module,
                purpose: m.purpose,
                coreFiles: m.coreFiles,
              })),
              filesToInspect: contextPack.filesToInspect,
              codeSnippets: contextPack.codeSnippets.map((c) => ({
                file: c.file,
                lines: `${c.startLine}-${c.endLine}`,
                symbols: c.symbols,
                snippet: c.chunk.split("\n").slice(0, 20).join("\n"),
              })),
              risk: contextPack.risk,
              suggestedWorkflow: contextPack.suggestedWorkflow,
              estimatedTokens: contextPack.estimatedTokens,
            }, null, 2),
          }],
        };
      }

      case "summarize_diff": {
        const diff = args?.diff as string;
        const saveToMemory = (args?.save as boolean) || false;

        const lines = diff.split("\n");
        const changedFiles: string[] = [];
        let description = "";

        for (const line of lines) {
          const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
          if (match) {
            changedFiles.push(match[2]);
          }
        }

        const addedLines = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
        const removedLines = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

        description = `Changed ${changedFiles.length} file(s): ${changedFiles.join(", ")}. `;
        description += `+${addedLines} / -${removedLines} lines.`;

        const isArchitectural = changedFiles.some(
          (f) => f.includes("route") || f.includes("guard") || f.includes("service") || f.includes("store"),
        );

        const summary = {
          description,
          filesChanged: changedFiles,
          decisions: isArchitectural ? ["Architectural change detected - consider saving as decision"] : [],
          isArchitectural,
        };

        if (saveToMemory) {
          const task = taskMemoryManager.createTask(
            `Diff: ${description.slice(0, 100)}`,
            gitService.isRepo() ? gitService.getCurrentBranch() : null,
          );
          taskMemoryManager.updateTask(task.id, {
            filesTouched: changedFiles,
          });
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(summary, null, 2),
          }],
        };
      }

      case "compact_memory": {
        const compactAll = (args?.all as boolean) ?? true;
        const result = compactor.compactAll(sessionMemoryManager);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Compaction complete",
              fileSummariesCompacted: result.fileSummaries,
              moduleSummariesCompacted: result.moduleSummaries,
              decisionsResolved: result.decisions,
            }, null, 2),
          }],
        };
      }

      case "classify_task": {
        const classifyQuery = args?.query as string;
        const taskType = classifyTask(classifyQuery);
        const entities = extractEntities(classifyQuery);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: classifyQuery,
              classification: taskType,
              extractedEntities: entities,
            }, null, 2),
          }],
        };
      }

      case "get_module_summary": {
        const modName = args?.module as string;
        const modSummary = moduleSummaryManager.getModuleSummary(modName);
        if (!modSummary) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Module "${modName}" not found` }) }],
            isError: true,
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(modSummary, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  });

  return server;
}
