import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import type {
  CodeChunk, FileSummary, ModuleSummary, CodeRelation, DecisionRecord,
  ProjectRule, SessionMemory, TaskMemory, MemoryStatus,
} from "../types.js";

export interface StoreOptions {
  dbPath: string;
}

export class SQLiteStore {
  private db: Database.Database;

  constructor(opts: StoreOptions) {
    const dir = path.dirname(opts.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS code_chunks (
        id TEXT PRIMARY KEY,
        file TEXT NOT NULL,
        language TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        hash TEXT NOT NULL,
        symbols TEXT DEFAULT '[]',
        imports TEXT DEFAULT '[]',
        exports TEXT DEFAULT '[]',
        embedding BLOB,
        last_modified TEXT,
        git_commit_hash TEXT,
        status TEXT DEFAULT 'fresh'
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON code_chunks(file);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON code_chunks(hash);
      CREATE INDEX IF NOT EXISTS idx_chunks_symbols ON code_chunks(symbols);
      CREATE INDEX IF NOT EXISTS idx_chunks_status ON code_chunks(status);

      CREATE TABLE IF NOT EXISTS file_summaries (
        file TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        main_exports TEXT DEFAULT '[]',
        main_imports TEXT DEFAULT '[]',
        side_effects TEXT DEFAULT '[]',
        risk_level TEXT DEFAULT 'low',
        symbols TEXT DEFAULT '[]',
        total_lines INTEGER DEFAULT 0,
        language TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        last_verified_hash TEXT NOT NULL,
        last_indexed_at TEXT,
        status TEXT DEFAULT 'fresh',
        confidence REAL DEFAULT 0.75
      );

      CREATE INDEX IF NOT EXISTS idx_file_summaries_status ON file_summaries(status);

      CREATE TABLE IF NOT EXISTS module_summaries (
        module TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        purpose TEXT NOT NULL,
        entry_points TEXT DEFAULT '[]',
        core_files TEXT DEFAULT '[]',
        do_not_duplicate TEXT DEFAULT '[]',
        risk_level TEXT DEFAULT 'low',
        related_modules TEXT DEFAULT '[]',
        last_indexed_at TEXT,
        status TEXT DEFAULT 'fresh',
        confidence REAL DEFAULT 0.75
      );

      CREATE INDEX IF NOT EXISTS idx_module_status ON module_summaries(status);

      CREATE TABLE IF NOT EXISTS code_relations (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_file TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_name TEXT NOT NULL,
        target_file TEXT,
        relation_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        status TEXT DEFAULT 'fresh',
        confidence REAL DEFAULT 0.98
      );

      CREATE INDEX IF NOT EXISTS idx_relations_source ON code_relations(source_name, source_file);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON code_relations(target_name, target_file);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON code_relations(relation_type);

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        area TEXT NOT NULL,
        files TEXT DEFAULT '[]',
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        rule TEXT,
        status TEXT DEFAULT 'fresh',
        confidence REAL DEFAULT 0.9,
        branch_name TEXT,
        superseded_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_area ON decisions(area);
      CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);

      CREATE TABLE IF NOT EXISTS project_rules (
        id TEXT PRIMARY KEY,
        rule TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        files TEXT DEFAULT '[]',
        modules TEXT DEFAULT '[]',
        priority INTEGER DEFAULT 3,
        is_active INTEGER DEFAULT 1,
        confidence REAL DEFAULT 1.0,
        source TEXT DEFAULT 'manual'
      );

      CREATE INDEX IF NOT EXISTS idx_rules_category ON project_rules(category);

      CREATE TABLE IF NOT EXISTS session_memory (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        current_task TEXT DEFAULT '',
        files_inspected TEXT DEFAULT '[]',
        current_findings TEXT DEFAULT '',
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT DEFAULT 'fresh'
      );

      CREATE INDEX IF NOT EXISTS idx_session_id ON session_memory(session_id);

      CREATE TABLE IF NOT EXISTS task_memory (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        files_touched TEXT DEFAULT '[]',
        decisions TEXT DEFAULT '[]',
        open_questions TEXT DEFAULT '[]',
        branch_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confidence REAL DEFAULT 0.9
      );

      CREATE INDEX IF NOT EXISTS idx_task_status ON task_memory(status);

      CREATE TABLE IF NOT EXISTS index_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS index_state (
        file TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL,
        status TEXT DEFAULT 'fresh'
      );

      CREATE INDEX IF NOT EXISTS idx_index_state_status ON index_state(status);
    `);
  }

  close(): void {
    this.db.close();
  }

  // ─── Code Chunks ────────────────────────────────────────────────────────

  upsertChunk(chunk: CodeChunk): void {
    const stmt = this.db.prepare(`
      INSERT INTO code_chunks (id, file, language, start_line, end_line, chunk, hash, symbols, imports, exports, embedding, last_modified, git_commit_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chunk = excluded.chunk,
        hash = excluded.hash,
        symbols = excluded.symbols,
        imports = excluded.imports,
        exports = excluded.exports,
        embedding = excluded.embedding,
        last_modified = excluded.last_modified,
        git_commit_hash = excluded.git_commit_hash,
        status = excluded.status
    `);
    stmt.run(
      chunk.id,
      chunk.file,
      chunk.language,
      chunk.startLine,
      chunk.endLine,
      chunk.chunk,
      chunk.hash,
      JSON.stringify(chunk.symbols),
      JSON.stringify(chunk.imports),
      JSON.stringify(chunk.exports),
      chunk.embedding ? Buffer.from(new Float32Array(chunk.embedding).buffer) : null,
      chunk.lastModified,
      chunk.gitCommitHash,
      chunk.status,
    );
  }

  deleteChunksForFile(file: string): void {
    this.db.prepare("DELETE FROM code_chunks WHERE file = ?").run(file);
  }

  getChunksForFile(file: string): CodeChunk[] {
    const rows = this.db.prepare("SELECT * FROM code_chunks WHERE file = ?").all(file) as any[];
    return rows.map(this.rowToChunk);
  }

  searchChunksBySymbol(symbol: string, limit = 20): CodeChunk[] {
    const rows = this.db.prepare(
      "SELECT * FROM code_chunks WHERE symbols LIKE ? LIMIT ?",
    ).all(`%${symbol}%`, limit) as any[];
    return rows.map(this.rowToChunk);
  }

  searchChunksByKeyword(query: string, limit = 20): CodeChunk[] {
    const like = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT * FROM code_chunks WHERE chunk LIKE ? OR file LIKE ? OR symbols LIKE ?
      LIMIT ?
    `).all(like, like, like, limit) as any[];
    return rows.map(this.rowToChunk);
  }

  getAllChunks(limit = 10000): CodeChunk[] {
    const rows = this.db.prepare("SELECT * FROM code_chunks LIMIT ?").all(limit) as any[];
    return rows.map(this.rowToChunk);
  }

  private rowToChunk(row: any): CodeChunk {
    return {
      id: row.id,
      file: row.file,
      language: row.language,
      startLine: row.start_line,
      endLine: row.end_line,
      chunk: row.chunk,
      hash: row.hash,
      symbols: JSON.parse(row.symbols || "[]"),
      imports: JSON.parse(row.imports || "[]"),
      exports: JSON.parse(row.exports || "[]"),
      embedding: row.embedding ? Array.from(new Float32Array(row.embedding)) : null,
      lastModified: row.last_modified,
      gitCommitHash: row.git_commit_hash,
      status: row.status,
    };
  }

  // ─── File Summaries ─────────────────────────────────────────────────────

  upsertFileSummary(summary: FileSummary): void {
    this.db.prepare(`
      INSERT INTO file_summaries (file, summary, main_exports, main_imports, side_effects, risk_level, symbols, total_lines, language, file_hash, last_verified_hash, last_indexed_at, status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET
        summary = excluded.summary,
        main_exports = excluded.main_exports,
        main_imports = excluded.main_imports,
        side_effects = excluded.side_effects,
        risk_level = excluded.risk_level,
        symbols = excluded.symbols,
        total_lines = excluded.total_lines,
        language = excluded.language,
        file_hash = excluded.file_hash,
        last_verified_hash = excluded.last_verified_hash,
        last_indexed_at = excluded.last_indexed_at,
        status = excluded.status,
        confidence = excluded.confidence
    `).run(
      summary.file,
      summary.summary,
      JSON.stringify(summary.mainExports),
      JSON.stringify(summary.mainImports),
      JSON.stringify(summary.sideEffects),
      summary.riskLevel,
      JSON.stringify(summary.symbols),
      summary.totalLines,
      summary.language,
      summary.fileHash,
      summary.lastVerifiedHash,
      summary.lastIndexedAt,
      summary.status,
      summary.confidence,
    );
  }

  getFileSummary(file: string): FileSummary | null {
    const row = this.db.prepare("SELECT * FROM file_summaries WHERE file = ?").get(file) as any;
    if (!row) return null;
    return this.rowToFileSummary(row);
  }

  getFileSummariesByStatus(status: MemoryStatus): FileSummary[] {
    const rows = this.db.prepare("SELECT * FROM file_summaries WHERE status = ?").all(status) as any[];
    return rows.map(this.rowToFileSummary);
  }

  getAllFileSummaries(): FileSummary[] {
    const rows = this.db.prepare("SELECT * FROM file_summaries").all() as any[];
    return rows.map(this.rowToFileSummary);
  }

  deleteFileSummary(file: string): void {
    this.db.prepare("DELETE FROM file_summaries WHERE file = ?").run(file);
  }

  private rowToFileSummary(row: any): FileSummary {
    return {
      file: row.file,
      summary: row.summary,
      mainExports: JSON.parse(row.main_exports || "[]"),
      mainImports: JSON.parse(row.main_imports || "[]"),
      sideEffects: JSON.parse(row.side_effects || "[]"),
      riskLevel: row.risk_level,
      symbols: JSON.parse(row.symbols || "[]"),
      totalLines: row.total_lines,
      language: row.language,
      fileHash: row.file_hash,
      lastVerifiedHash: row.last_verified_hash,
      lastIndexedAt: row.last_indexed_at,
      status: row.status,
      confidence: row.confidence,
    };
  }

  // ─── Module Summaries ───────────────────────────────────────────────────

  upsertModuleSummary(summary: ModuleSummary): void {
    this.db.prepare(`
      INSERT INTO module_summaries (module, path, purpose, entry_points, core_files, do_not_duplicate, risk_level, related_modules, last_indexed_at, status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module) DO UPDATE SET
        path = excluded.path,
        purpose = excluded.purpose,
        entry_points = excluded.entry_points,
        core_files = excluded.core_files,
        do_not_duplicate = excluded.do_not_duplicate,
        risk_level = excluded.risk_level,
        related_modules = excluded.related_modules,
        last_indexed_at = excluded.last_indexed_at,
        status = excluded.status,
        confidence = excluded.confidence
    `).run(
      summary.module,
      summary.path,
      summary.purpose,
      JSON.stringify(summary.entryPoints),
      JSON.stringify(summary.coreFiles),
      JSON.stringify(summary.doNotDuplicate),
      summary.riskLevel,
      JSON.stringify(summary.relatedModules),
      summary.lastIndexedAt,
      summary.status,
      summary.confidence,
    );
  }

  getModuleSummary(module: string): ModuleSummary | null {
    const row = this.db.prepare("SELECT * FROM module_summaries WHERE module = ?").get(module) as any;
    if (!row) return null;
    return this.rowToModuleSummary(row);
  }

  searchModuleSummaries(query: string): ModuleSummary[] {
    const like = `%${query}%`;
    const rows = this.db.prepare(
      "SELECT * FROM module_summaries WHERE module LIKE ? OR purpose LIKE ?",
    ).all(like, like) as any[];
    return rows.map(this.rowToModuleSummary);
  }

  getAllModuleSummaries(): ModuleSummary[] {
    const rows = this.db.prepare("SELECT * FROM module_summaries").all() as any[];
    return rows.map(this.rowToModuleSummary);
  }

  deleteModuleSummary(module: string): void {
    this.db.prepare("DELETE FROM module_summaries WHERE module = ?").run(module);
  }

  private rowToModuleSummary(row: any): ModuleSummary {
    return {
      module: row.module,
      path: row.path,
      purpose: row.purpose,
      entryPoints: JSON.parse(row.entry_points || "[]"),
      coreFiles: JSON.parse(row.core_files || "[]"),
      doNotDuplicate: JSON.parse(row.do_not_duplicate || "[]"),
      riskLevel: row.risk_level,
      relatedModules: JSON.parse(row.related_modules || "[]"),
      lastIndexedAt: row.last_indexed_at,
      status: row.status,
      confidence: row.confidence,
    };
  }

  // ─── Code Relations ─────────────────────────────────────────────────────

  upsertRelation(rel: CodeRelation): void {
    this.db.prepare(`
      INSERT INTO code_relations (id, source_type, source_name, source_file, target_type, target_name, target_file, relation_type, weight, status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        weight = excluded.weight,
        status = excluded.status,
        confidence = excluded.confidence
    `).run(
      rel.id,
      rel.sourceType,
      rel.sourceName,
      rel.sourceFile,
      rel.targetType,
      rel.targetName,
      rel.targetFile || null,
      rel.relationType,
      rel.weight,
      rel.status,
      rel.confidence,
    );
  }

  deleteRelationsForFile(file: string): void {
    this.db.prepare(
      "DELETE FROM code_relations WHERE source_file = ? OR target_file = ?",
    ).run(file, file);
  }

  findRelations(name: string, file?: string, limit = 30): CodeRelation[] {
    if (file) {
      const rows = this.db.prepare(`
        SELECT * FROM code_relations WHERE (source_name = ? AND source_file = ?) OR (target_name = ? AND target_file = ?) LIMIT ?
      `).all(name, file, name, file, limit) as any[];
      return rows.map(this.rowToRelation);
    }
    const rows = this.db.prepare(`
      SELECT * FROM code_relations WHERE source_name = ? OR target_name = ? LIMIT ?
    `).all(name, name, limit) as any[];
    return rows.map(this.rowToRelation);
  }

  findRelatedFiles(file: string, depth = 1): CodeRelation[] {
    const rows = this.db.prepare(`
      SELECT * FROM code_relations WHERE (source_file = ? OR target_file = ?) AND relation_type != 'tested_by' LIMIT 50
    `).all(file, file) as any[];
    return rows.map(this.rowToRelation);
  }

  findAffectedFiles(file: string): { files: string[]; tests: string[] } {
    const directRows = this.db.prepare(`
      SELECT * FROM code_relations WHERE source_file = ? AND relation_type IN ('imports', 'renders', 'calls', 'uses')
    `).all(file) as any[];
    const testRows = this.db.prepare(`
      SELECT * FROM code_relations WHERE target_file = ? AND relation_type = 'tested_by'
    `).all(file) as any[];

    const backwards = this.db.prepare(`
      SELECT * FROM code_relations WHERE target_file = ? AND relation_type IN ('imports', 'renders', 'calls', 'uses')
    `).all(file) as any[];

    const files = new Set<string>();
    const tests = new Set<string>();

    for (const r of [...directRows, ...backwards]) {
      const rel = this.rowToRelation(r);
      if (rel.relationType === "tested_by") {
        tests.add(rel.sourceFile);
      } else {
        const f = rel.sourceFile === file ? rel.targetFile : rel.sourceFile;
        if (f && f !== file) files.add(f);
      }
    }
    for (const r of testRows) {
      const rel = this.rowToRelation(r);
      tests.add(rel.sourceFile);
    }

    return { files: [...files], tests: [...tests] };
  }

  private rowToRelation(row: any): CodeRelation {
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceName: row.source_name,
      sourceFile: row.source_file,
      targetType: row.target_type,
      targetName: row.target_name,
      targetFile: row.target_file || undefined,
      relationType: row.relation_type,
      weight: row.weight,
      status: row.status,
      confidence: row.confidence,
    };
  }

  // ─── Decisions ──────────────────────────────────────────────────────────

  upsertDecision(d: DecisionRecord): void {
    this.db.prepare(`
      INSERT INTO decisions (id, title, date, area, files, decision, reason, rule, status, confidence, branch_name, superseded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        area = excluded.area,
        files = excluded.files,
        decision = excluded.decision,
        reason = excluded.reason,
        rule = excluded.rule,
        status = excluded.status,
        confidence = excluded.confidence,
        branch_name = excluded.branch_name,
        superseded_by = excluded.superseded_by
    `).run(
      d.id,
      d.title,
      d.date,
      d.area,
      JSON.stringify(d.files),
      d.decision,
      d.reason,
      d.rule || null,
      d.status,
      d.confidence,
      d.branchName || null,
      d.supersededBy || null,
    );
  }

  getDecisionsForArea(area: string): DecisionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM decisions WHERE area = ? AND status != 'deleted' ORDER BY date DESC",
    ).all(area) as any[];
    return rows.map(this.rowToDecision);
  }

  getDecisionsForFile(file: string): DecisionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM decisions WHERE files LIKE ? AND status != 'deleted' ORDER BY date DESC",
    ).all(`%${file}%`) as any[];
    return rows.map(this.rowToDecision);
  }

  searchDecisions(query: string, limit = 10): DecisionRecord[] {
    const like = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT * FROM decisions WHERE (decision LIKE ? OR reason LIKE ? OR title LIKE ? OR area LIKE ?) AND status != 'deleted' LIMIT ?
    `).all(like, like, like, like, limit) as any[];
    return rows.map(this.rowToDecision);
  }

  getAllActiveDecisions(): DecisionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM decisions WHERE status != 'deleted' ORDER BY date DESC LIMIT 100",
    ).all() as any[];
    return rows.map(this.rowToDecision);
  }

  private rowToDecision(row: any): DecisionRecord {
    return {
      id: row.id,
      title: row.title,
      date: row.date,
      area: row.area,
      files: JSON.parse(row.files || "[]"),
      decision: row.decision,
      reason: row.reason,
      rule: row.rule || undefined,
      status: row.status,
      confidence: row.confidence,
      branchName: row.branch_name || null,
      supersededBy: row.superseded_by || null,
    };
  }

  // ─── Project Rules ──────────────────────────────────────────────────────

  upsertRule(rule: ProjectRule): void {
    this.db.prepare(`
      INSERT INTO project_rules (id, rule, category, files, modules, priority, is_active, confidence, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rule = excluded.rule,
        category = excluded.category,
        files = excluded.files,
        modules = excluded.modules,
        priority = excluded.priority,
        is_active = excluded.is_active,
        confidence = excluded.confidence,
        source = excluded.source
    `).run(
      rule.id,
      rule.rule,
      rule.category,
      JSON.stringify(rule.files),
      JSON.stringify(rule.modules),
      rule.priority,
      rule.isActive ? 1 : 0,
      rule.confidence,
      rule.source,
    );
  }

  getActiveRules(limit = 50): ProjectRule[] {
    const rows = this.db.prepare(
      "SELECT * FROM project_rules WHERE is_active = 1 ORDER BY priority DESC LIMIT ?",
    ).all(limit) as any[];
    return rows.map(this.rowToRule);
  }

  getRulesForModule(module: string): ProjectRule[] {
    const rows = this.db.prepare(
      "SELECT * FROM project_rules WHERE (modules LIKE ? OR category = 'general') AND is_active = 1 ORDER BY priority DESC",
    ).all(`%${module}%`) as any[];
    return rows.map(this.rowToRule);
  }

  getRulesForFile(file: string): ProjectRule[] {
    const rows = this.db.prepare(
      "SELECT * FROM project_rules WHERE (files LIKE ? OR modules LIKE ? OR category = 'general') AND is_active = 1 ORDER BY priority DESC",
    ).all(`%${file}%`, `%${file}%`) as any[];
    return rows.map(this.rowToRule);
  }

  deleteRule(id: string): void {
    this.db.prepare("DELETE FROM project_rules WHERE id = ?").run(id);
  }

  private rowToRule(row: any): ProjectRule {
    return {
      id: row.id,
      rule: row.rule,
      category: row.category,
      files: JSON.parse(row.files || "[]"),
      modules: JSON.parse(row.modules || "[]"),
      priority: row.priority,
      isActive: row.is_active === 1,
      confidence: row.confidence,
      source: row.source,
    };
  }

  // ─── Session Memory ─────────────────────────────────────────────────────

  upsertSession(session: SessionMemory): void {
    this.db.prepare(`
      INSERT INTO session_memory (id, session_id, current_task, files_inspected, current_findings, started_at, updated_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_task = excluded.current_task,
        files_inspected = excluded.files_inspected,
        current_findings = excluded.current_findings,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        status = excluded.status
    `).run(
      session.id,
      session.sessionId,
      session.currentTask,
      JSON.stringify(session.filesInspected),
      session.currentFindings,
      session.startedAt,
      session.updatedAt,
      session.expiresAt,
      session.status,
    );
  }

  getSession(sessionId: string): SessionMemory | null {
    const row = this.db.prepare(
      "SELECT * FROM session_memory WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(sessionId) as any;
    if (!row) return null;
    return this.rowToSession(row);
  }

  deleteExpiredSessions(): void {
    const now = new Date().toISOString();
    this.db.prepare("DELETE FROM session_memory WHERE expires_at < ?").run(now);
  }

  private rowToSession(row: any): SessionMemory {
    return {
      id: row.id,
      sessionId: row.session_id,
      currentTask: row.current_task,
      filesInspected: JSON.parse(row.files_inspected || "[]"),
      currentFindings: row.current_findings,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      status: row.status,
    };
  }

  // ─── Task Memory ────────────────────────────────────────────────────────

  upsertTask(task: TaskMemory): void {
    this.db.prepare(`
      INSERT INTO task_memory (id, task, status, files_touched, decisions, open_questions, branch_name, created_at, updated_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task = excluded.task,
        status = excluded.status,
        files_touched = excluded.files_touched,
        decisions = excluded.decisions,
        open_questions = excluded.open_questions,
        branch_name = excluded.branch_name,
        updated_at = excluded.updated_at,
        confidence = excluded.confidence
    `).run(
      task.id,
      task.task,
      task.status,
      JSON.stringify(task.filesTouched),
      JSON.stringify(task.decisions),
      JSON.stringify(task.openQuestions),
      task.branchName || null,
      task.createdAt,
      task.updatedAt,
      task.confidence,
    );
  }

  getActiveTasks(): TaskMemory[] {
    const rows = this.db.prepare(
      "SELECT * FROM task_memory WHERE status IN ('pending', 'in_progress') ORDER BY updated_at DESC LIMIT 20",
    ).all() as any[];
    return rows.map(this.rowToTask);
  }

  getTask(id: string): TaskMemory | null {
    const row = this.db.prepare("SELECT * FROM task_memory WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.rowToTask(row);
  }

  searchTasks(query: string): TaskMemory[] {
    const like = `%${query}%`;
    const rows = this.db.prepare(
      "SELECT * FROM task_memory WHERE task LIKE ? OR files_touched LIKE ? ORDER BY updated_at DESC LIMIT 10",
    ).all(like, like) as any[];
    return rows.map(this.rowToTask);
  }

  private rowToTask(row: any): TaskMemory {
    return {
      id: row.id,
      task: row.task,
      status: row.status,
      filesTouched: JSON.parse(row.files_touched || "[]"),
      decisions: JSON.parse(row.decisions || "[]"),
      openQuestions: JSON.parse(row.open_questions || "[]"),
      branchName: row.branch_name || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confidence: row.confidence,
    };
  }

  // ─── Index State ────────────────────────────────────────────────────────

  getIndexState(file: string): { file: string; fileHash: string; lastIndexedAt: string; status: string } | null {
    const row = this.db.prepare("SELECT * FROM index_state WHERE file = ?").get(file) as any;
    if (!row) return null;
    return {
      file: row.file,
      fileHash: row.file_hash,
      lastIndexedAt: row.last_indexed_at,
      status: row.status,
    };
  }

  upsertIndexState(file: string, fileHash: string, status = "fresh"): void {
    this.db.prepare(`
      INSERT INTO index_state (file, file_hash, last_indexed_at, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET
        file_hash = excluded.file_hash,
        last_indexed_at = excluded.last_indexed_at,
        status = excluded.status
    `).run(file, fileHash, new Date().toISOString(), status);
  }

  getStaleFiles(): string[] {
    const rows = this.db.prepare(
      "SELECT file FROM index_state WHERE status IN ('stale', 'dirty')",
    ).all() as any[];
    return rows.map((r: any) => r.file);
  }

  markFileStale(file: string): void {
    this.db.prepare("UPDATE index_state SET status = 'stale' WHERE file = ?").run(file);
  }

  getIndexedFiles(): string[] {
    const rows = this.db.prepare("SELECT file FROM index_state WHERE status = 'fresh'").all() as any[];
    return rows.map((r: any) => r.file);
  }

  deleteIndexState(file: string): void {
    this.db.prepare("DELETE FROM index_state WHERE file = ?").run(file);
  }
}
