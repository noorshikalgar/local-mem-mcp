import type {
  ContextPack, TaskType, ExtractedEntities, SearchParams,
  DecisionRecord, ProjectRule, FileSummary, ModuleSummary,
  IndexConfig, ContextBudget,
} from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";
import type { VectorStore } from "../stores/vector-store.js";
import { SearchEngine } from "./search.js";
import { classifyTask, extractEntities } from "./classify.js";
import { rerankResults } from "./rerank.js";

export class RetrievalPipeline {
  private store: SQLiteStore;
  private vectorStore: VectorStore;
  private searchEngine: SearchEngine;
  private config: IndexConfig;

  constructor(store: SQLiteStore, vectorStore: VectorStore, config: IndexConfig) {
    this.store = store;
    this.vectorStore = vectorStore;
    this.searchEngine = new SearchEngine(store, vectorStore);
    this.config = config;
  }

  async retrieveContext(task: string, opts?: {
    changedFiles?: string[];
    recentFiles?: string[];
    budget?: ContextBudget;
  }): Promise<ContextPack> {
    // Stage 1: Classify
    const taskType = classifyTask(task);

    // Stage 2: Extract entities
    const entities = extractEntities(task);

    // Stage 3: Retrieve summaries first
    const { moduleSummaries, fileSummaries, projectRules, decisions } = await this.retrieveSummaries(
      task, entities, taskType,
    );

    // Stage 4: Determine files to inspect
    const filesToInspect = this.determineFilesToInspect(entities, moduleSummaries, fileSummaries);

    // Stage 5: Fetch exact code snippets
    const codeSnippets = await this.retrieveCodeSnippets(
      task, entities, filesToInspect, opts,
    );

    // Stage 6: Build risk assessment
    const risk = this.assessRisk(fileSummaries, filesToInspect);

    // Stage 7: Build suggested workflow
    const suggestedWorkflow = this.buildWorkflow(taskType, filesToInspect);

    const pack: ContextPack = {
      task,
      taskType,
      projectRules,
      decisions,
      moduleSummaries,
      fileSummaries: fileSummaries.slice(0, 8),
      filesToInspect: filesToInspect.slice(0, 8),
      codeSnippets: codeSnippets.slice(0, 12),
      risk,
      suggestedWorkflow,
      estimatedTokens: this.estimateTokens({
        projectRules, decisions, moduleSummaries, fileSummaries, codeSnippets,
      }),
    };

    return pack;
  }

  private async retrieveSummaries(
    task: string,
    entities: ExtractedEntities,
    taskType: TaskType,
  ): Promise<{
    moduleSummaries: ModuleSummary[];
    fileSummaries: FileSummary[];
    projectRules: ProjectRule[];
    decisions: DecisionRecord[];
  }> {
    // Module summaries
    const moduleSummaries: ModuleSummary[] = [];
    for (const mod of entities.possibleModules) {
      const summary = this.store.getModuleSummary(mod);
      if (summary && summary.status !== "deleted") {
        moduleSummaries.push(summary);
      }
    }
    if (moduleSummaries.length === 0) {
      const allModules = this.store.getAllModuleSummaries();
      moduleSummaries.push(...allModules.filter((m) => m.status !== "deleted").slice(0, 3));
    }

    // File summaries - search by entities and task
    const allFileSummaries = this.store.getAllFileSummaries();
    const matchedFileSummaries: FileSummary[] = [];
    const lowerTask = task.toLowerCase();

    for (const fs of allFileSummaries) {
      if (fs.status === "deleted") continue;
      const matchesTask = fs.summary.toLowerCase().includes(lowerTask) ||
        fs.file.toLowerCase().includes(lowerTask) ||
        entities.possibleModules.some((m) => fs.file.includes(m)) ||
        entities.symbols.some((s) => fs.symbols.includes(s)) ||
        entities.entities.some((e) => fs.file.toLowerCase().includes(e.toLowerCase()));
      if (matchesTask) {
        matchedFileSummaries.push(fs);
      }
    }

    // Project rules
    const projectRules: ProjectRule[] = [];
    const allRules = this.store.getActiveRules(50);
    for (const rule of allRules) {
      const matchesTask = entities.possibleModules.some((m) =>
        rule.modules.includes(m) || rule.category === m,
      ) || entities.entities.some((e) =>
        rule.category.includes(e) || rule.rule.toLowerCase().includes(e.toLowerCase()),
      );
      if (matchesTask || rule.priority >= 4) {
        projectRules.push(rule);
      }
    }
    if (projectRules.length === 0) {
      projectRules.push(...allRules.filter((r) => r.priority >= 3).slice(0, 3));
    }

    // Decisions
    const decisions: DecisionRecord[] = [];
    const allDecisions = this.store.getAllActiveDecisions();
    for (const d of allDecisions) {
      if (entities.possibleModules.some((m) => d.area.includes(m))) {
        decisions.push(d);
      }
    }
    if (decisions.length === 0) {
      decisions.push(...allDecisions.slice(0, 3));
    }

    return { moduleSummaries: moduleSummaries.slice(0, 3), fileSummaries: matchedFileSummaries.slice(0, 8), projectRules: projectRules.slice(0, 5), decisions: decisions.slice(0, 5) };
  }

  private determineFilesToInspect(
    entities: ExtractedEntities,
    moduleSummaries: ModuleSummary[],
    fileSummaries: FileSummary[],
  ): string[] {
    const fileSet = new Set<string>();

    // From entities
    for (const file of entities.files) {
      fileSet.add(file);
    }

    // From module entry points
    for (const mod of moduleSummaries) {
      for (const ep of mod.entryPoints) {
        fileSet.add(ep);
      }
      for (const cf of mod.coreFiles) {
        fileSet.add(cf);
      }
    }

    // From file summaries
    for (const fs of fileSummaries) {
      fileSet.add(fs.file);
    }

    return [...fileSet];
  }

  private async retrieveCodeSnippets(
    task: string,
    entities: ExtractedEntities,
    filesToInspect: string[],
    opts?: { changedFiles?: string[]; recentFiles?: string[] },
  ): Promise<import("../types.js").CodeChunk[]> {
    const seen = new Set<string>();
    const chunks: import("../types.js").CodeChunk[] = [];

    // 1. Search by keyword
    const searchParams: SearchParams = {
      query: task,
      limit: 12,
      includeTests: false,
    };
    const searchResults = await this.searchEngine.search(searchParams);

    // 2. Rerank
    const fileSummaryMap = new Map<string, FileSummary>();
    const allSummaries = this.store.getAllFileSummaries();
    for (const fs of allSummaries) {
      fileSummaryMap.set(fs.file, fs);
    }

    const reranked = rerankResults(searchResults, {
      userQuery: task,
      entities,
      changedFiles: opts?.changedFiles,
      recentFiles: opts?.recentFiles,
      fileSummaries: fileSummaryMap,
    });

    for (const result of reranked) {
      const chunkChunks = this.store.getChunksForFile(result.file);
      for (const c of chunkChunks) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          chunks.push(c);
        }
      }
    }

    // 3. Get chunks for files to inspect
    for (const file of filesToInspect) {
      const fileChunks = this.store.getChunksForFile(file);
      for (const c of fileChunks) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          chunks.push(c);
        }
      }
    }

    return chunks.slice(0, 12);
  }

  private assessRisk(fileSummaries: FileSummary[], filesToInspect: string[]): string {
    const risks: string[] = [];

    for (const file of filesToInspect) {
      const summary = fileSummaries.find((s) => s.file === file);
      if (summary) {
        if (summary.riskLevel === "critical") {
          risks.push(`CRITICAL: ${file} requires careful review`);
        } else if (summary.riskLevel === "high") {
          risks.push(`HIGH: ${file} has significant impact`);
        }
      }
    }

    // Check for affected relationships
    for (const file of filesToInspect) {
      const affected = this.store.findAffectedFiles(file);
      if (affected.files.length > 2 || affected.tests.length > 0) {
        risks.push(`${file} affects ${affected.files.length} other files and ${affected.tests.length} tests`);
      }
    }

    if (risks.length === 0) return "";
    return risks.join("; ");
  }

  private buildWorkflow(taskType: TaskType, filesToInspect: string[]): string[] {
    const workflow: string[] = [];

    switch (taskType) {
      case "bug_fix":
        workflow.push("1. Reproduce the bug");
        workflow.push("2. Inspect the error source files");
        workflow.push("3. Check recent changes to affected files");
        workflow.push("4. Apply fix");
        workflow.push("5. Run related tests");
        break;
      case "new_feature":
        workflow.push("1. Review module summaries for existing patterns");
        workflow.push("2. Inspect similar existing features");
        workflow.push("3. Check project rules for constraints");
        workflow.push("4. Implement feature following existing patterns");
        workflow.push("5. Add tests");
        break;
      case "refactor":
        workflow.push("1. Run impact analysis for shared files");
        workflow.push("2. Inspect all dependent files");
        workflow.push("3. Refactor step by step");
        workflow.push("4. Run full test suite");
        break;
      case "test_generation":
        workflow.push("1. Inspect source files for test patterns");
        workflow.push("2. Check existing test files for style");
        workflow.push("3. Generate tests covering key paths");
        break;
      default:
        workflow.push("1. Search memory for relevant context");
        workflow.push("2. Inspect relevant files");
        workflow.push("3. Make changes following project patterns");
        workflow.push("4. Run tests");
    }

    if (filesToInspect.length > 0) {
      workflow.push("");
      workflow.push("Files to inspect:");
      for (const file of filesToInspect) {
        workflow.push(`- ${file}`);
      }
    }

    return workflow;
  }

  private estimateTokens(data: {
    projectRules: ProjectRule[];
    decisions: DecisionRecord[];
    moduleSummaries: ModuleSummary[];
    fileSummaries: FileSummary[];
    codeSnippets: import("../types.js").CodeChunk[];
  }): number {
    let total = 0;
    for (const r of data.projectRules) total += r.rule.length / 4;
    for (const d of data.decisions) total += (d.decision.length + d.reason.length) / 4;
    for (const m of data.moduleSummaries) total += m.purpose.length / 4;
    for (const f of data.fileSummaries) total += f.summary.length / 4;
    for (const c of data.codeSnippets) total += c.chunk.length / 4;
    return Math.round(total);
  }

  async searchCode(query: string, limit = 10, includeTests = false): Promise<import("../types.js").SearchResult[]> {
    return this.searchEngine.search({
      query,
      limit,
      includeTests,
    });
  }
}
