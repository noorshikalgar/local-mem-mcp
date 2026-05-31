import { z } from "zod";

// ─── Memory Status ──────────────────────────────────────────────────────────

export const MemoryStatus = z.enum(["fresh", "stale", "dirty", "unverified", "deleted"]);
export type MemoryStatus = z.infer<typeof MemoryStatus>;

// ─── Confidence ─────────────────────────────────────────────────────────────

export const ConfidenceScore = z.number().min(0).max(1).default(1);
export type ConfidenceScore = z.input<typeof ConfidenceScore>;

// ─── Language ───────────────────────────────────────────────────────────────

export const SupportedLanguage = z.enum([
  "typescript", "javascript", "tsx", "python", "rust", "go", "java",
  "csharp", "cpp", "c", "ruby", "php", "swift", "kotlin",
  "yaml", "json", "markdown", "html", "css", "scss",
]);
export type SupportedLanguage = z.infer<typeof SupportedLanguage>;

// ─── Code Chunk (Layer 1) ───────────────────────────────────────────────────

export const CodeChunk = z.object({
  id: z.string(),
  file: z.string(),
  language: SupportedLanguage,
  startLine: z.number(),
  endLine: z.number(),
  chunk: z.string(),
  hash: z.string(),
  symbols: z.array(z.string()),
  imports: z.array(z.string()).default([]),
  exports: z.array(z.string()).default([]),
  embedding: z.array(z.number()).nullable().default(null),
  lastModified: z.string().nullable().default(null),
  gitCommitHash: z.string().nullable().default(null),
  status: MemoryStatus.default("fresh"),
});
export type CodeChunk = z.infer<typeof CodeChunk>;

// ─── File Summary (Layer 2) ─────────────────────────────────────────────────

export const FileSummary = z.object({
  file: z.string(),
  summary: z.string(),
  mainExports: z.array(z.string()).default([]),
  mainImports: z.array(z.string()).default([]),
  sideEffects: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  symbols: z.array(z.string()).default([]),
  totalLines: z.number().default(0),
  language: SupportedLanguage,
  fileHash: z.string(),
  lastVerifiedHash: z.string(),
  lastIndexedAt: z.string().nullable().default(null),
  status: MemoryStatus.default("fresh"),
  confidence: ConfidenceScore.default(0.75),
});
export type FileSummary = z.infer<typeof FileSummary>;

// ─── Module Summary (Layer 3) ───────────────────────────────────────────────

export const ModuleSummary = z.object({
  module: z.string(),
  path: z.string(),
  purpose: z.string(),
  entryPoints: z.array(z.string()).default([]),
  coreFiles: z.array(z.string()).default([]),
  doNotDuplicate: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  relatedModules: z.array(z.string()).default([]),
  lastIndexedAt: z.string().nullable().default(null),
  status: MemoryStatus.default("fresh"),
  confidence: ConfidenceScore.default(0.75),
});
export type ModuleSummary = z.infer<typeof ModuleSummary>;

// ─── Code Relation (Layer 4) ────────────────────────────────────────────────

export const RelationType = z.enum([
  "imports", "renders", "calls", "uses", "protected_by",
  "depends_on", "checks", "calls_endpoint", "covers",
  "affects", "changed_by", "implements", "extends",
  "composes", "references", "tested_by",
]);
export type RelationType = z.infer<typeof RelationType>;

export const CodeRelation = z.object({
  id: z.string(),
  sourceType: z.enum(["file", "class", "function", "component", "service", "route", "test"]),
  sourceName: z.string(),
  sourceFile: z.string(),
  targetType: z.enum(["file", "class", "function", "component", "service", "route", "test", "endpoint", "module"]),
  targetName: z.string(),
  targetFile: z.string().optional(),
  relationType: RelationType,
  weight: z.number().min(0).max(1).default(1),
  status: MemoryStatus.default("fresh"),
  confidence: ConfidenceScore.default(0.98),
});
export type CodeRelation = z.infer<typeof CodeRelation>;

// ─── Decision Memory (Layer 5) ──────────────────────────────────────────────

export const DecisionRecord = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  area: z.string(),
  files: z.array(z.string()).default([]),
  decision: z.string(),
  reason: z.string(),
  rule: z.string().optional(),
  status: MemoryStatus.default("fresh"),
  confidence: ConfidenceScore.default(0.9),
  branchName: z.string().nullable().default(null),
  supersededBy: z.string().nullable().default(null),
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

// ─── Project Rule (Layer 6) ─────────────────────────────────────────────────

export const ProjectRule = z.object({
  id: z.string(),
  rule: z.string(),
  category: z.string().default("general"),
  files: z.array(z.string()).default([]),
  modules: z.array(z.string()).default([]),
  priority: z.number().min(1).max(5).default(3),
  isActive: z.boolean().default(true),
  confidence: ConfidenceScore.default(1.0),
  source: z.enum(["manual", "inferred", "imported"]).default("manual"),
});
export type ProjectRule = z.infer<typeof ProjectRule>;

// ─── Session Working Memory (Layer 7) ───────────────────────────────────────

export const SessionMemory = z.object({
  id: z.string(),
  sessionId: z.string(),
  currentTask: z.string().default(""),
  filesInspected: z.array(z.string()).default([]),
  currentFindings: z.string().default(""),
  startedAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  status: MemoryStatus.default("fresh"),
});
export type SessionMemory = z.infer<typeof SessionMemory>;

// ─── Task Memory (Layer 8) ──────────────────────────────────────────────────

export const TaskMemory = z.object({
  id: z.string(),
  task: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
  filesTouched: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  branchName: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  confidence: ConfidenceScore.default(0.9),
});
export type TaskMemory = z.infer<typeof TaskMemory>;

// ─── Task Classification ────────────────────────────────────────────────────

export const TaskType = z.enum([
  "bug_fix", "new_feature", "refactor", "test_generation",
  "explanation", "code_review", "dependency_update",
  "ui_change", "api_integration", "performance_issue",
  "unknown",
]);
export type TaskType = z.infer<typeof TaskType>;

// ─── Search ─────────────────────────────────────────────────────────────────

export const SearchParams = z.object({
  query: z.string(),
  limit: z.number().min(1).max(50).default(10),
  includeTests: z.boolean().default(false),
  fileFilter: z.string().optional(),
  moduleFilter: z.string().optional(),
  symbolFilter: z.string().optional(),
});
export type SearchParams = z.infer<typeof SearchParams>;

export const SearchResult = z.object({
  file: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  score: z.number(),
  whyMatched: z.string(),
  codeSnippet: z.string(),
  language: SupportedLanguage.optional(),
  status: MemoryStatus.default("fresh"),
});
export type SearchResult = z.infer<typeof SearchResult>;

// ─── Context Pack ───────────────────────────────────────────────────────────

export const ContextPack = z.object({
  task: z.string(),
  taskType: TaskType.default("unknown"),
  projectRules: z.array(ProjectRule).default([]),
  decisions: z.array(DecisionRecord).default([]),
  moduleSummaries: z.array(ModuleSummary).default([]),
  fileSummaries: z.array(FileSummary).default([]),
  filesToInspect: z.array(z.string()).default([]),
  codeSnippets: z.array(CodeChunk).default([]),
  risk: z.string().optional(),
  suggestedWorkflow: z.array(z.string()).default([]),
  estimatedTokens: z.number().default(0),
  warnings: z.array(z.string()).default([]),
});
export type ContextPack = z.infer<typeof ContextPack>;

// ─── File Outline ───────────────────────────────────────────────────────────

export interface FileOutlineSection {
  name: string;
  startLine: number;
  endLine: number;
  type: "imports" | "types" | "constants" | "class" | "function" | "component" | "interface" | "enum" | "section";
  children: FileOutlineSection[];
}

export interface FileOutline {
  file: string;
  totalLines: number;
  language: SupportedLanguage;
  imports: string[];
  exports: string[];
  sections: FileOutlineSection[];
  riskNotes: string[];
}

// ─── Impact Analysis ────────────────────────────────────────────────────────

export const ImpactAnalysis = z.object({
  target: z.string(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  affectedRoutes: z.array(z.string()).default([]),
  affectedFiles: z.array(z.string()).default([]),
  affectedTests: z.array(z.string()).default([]),
  relevantDecisions: z.array(DecisionRecord).default([]),
  description: z.string(),
});
export type ImpactAnalysis = z.infer<typeof ImpactAnalysis>;

// ─── Diff Summary ───────────────────────────────────────────────────────────

export const DiffSummary = z.object({
  description: z.string(),
  filesChanged: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  isArchitectural: z.boolean().default(false),
});
export type DiffSummary = z.infer<typeof DiffSummary>;

// ─── Index Config ───────────────────────────────────────────────────────────

export const IndexConfig = z.object({
  projectRoot: z.string(),
  includePatterns: z.array(z.string()).default(["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go"]),
  excludePatterns: z.array(z.string()).default(["node_modules", "dist", "build", ".git", "coverage", ".next", "target", "vendor", ".test-tmp", "__pycache__", ".cache"]),
  maxFileSize: z.number().default(1024 * 100),
  chunkSize: z.number().default(50),
  chunkOverlap: z.number().default(10),
  useGit: z.boolean().default(true),
  useFileWatcher: z.boolean().default(true),
  embeddingProvider: z.enum(["none", "local", "openai", "qdrant"]).default("none"),
  embeddingApiUrl: z.string().optional(),
  embeddingApiKey: z.string().optional(),
  embeddingModel: z.string().default("bge-small"),
  qdrantUrl: z.string().optional(),
  qdrantApiKey: z.string().optional(),
  neo4jUrl: z.string().optional(),
  neo4jPassword: z.string().optional(),
  vectorSize: z.number().default(384),
  llmApiUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmModel: z.string().default("local-model"),
  useLlmSummaries: z.boolean().default(false),
});
export type IndexConfig = z.infer<typeof IndexConfig>;

// ─── Context Budget ─────────────────────────────────────────────────────────

export const ContextBudget = z.object({
  totalTokens: z.number().default(12000),
  systemRules: z.number().default(800),
  taskMemory: z.number().default(500),
  moduleSummaries: z.number().default(1200),
  decisionMemory: z.number().default(800),
  codeSnippets: z.number().default(5000),
  currentFileContent: z.number().default(2500),
  responseBudget: z.number().default(1200),
  reserve: z.number().default(1000),
});
export type ContextBudget = z.infer<typeof ContextBudget>;

// ─── Diff ───────────────────────────────────────────────────────────────────

export const FileDiff = z.object({
  file: z.string(),
  oldHash: z.string().optional(),
  newHash: z.string().optional(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  oldPath: z.string().optional(),
});
export type FileDiff = z.infer<typeof FileDiff>;

// ─── Parsed Symbol ───────────────────────────────────────────────────────────

export interface ParsedSymbol {
  name: string;
  type: "function" | "class" | "interface" | "type" | "enum" | "component" | "variable" | "method";
  startLine: number;
  endLine: number;
}

// ─── Module Entities ────────────────────────────────────────────────────────

export const ExtractedEntities = z.object({
  entities: z.array(z.string()).default([]),
  possibleModules: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
});
export type ExtractedEntities = z.infer<typeof ExtractedEntities>;
