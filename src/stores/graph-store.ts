import type { CodeRelation } from "../types.js";
import type { SQLiteStore } from "./sqlite-store.js";

export interface GraphStore {
  upsertRelation(rel: CodeRelation): void | Promise<void>;
  deleteRelationsForFile(file: string): void | Promise<void>;
  findRelatedFiles(file: string, depth?: number): CodeRelation[] | Promise<CodeRelation[]>;
  findAffectedFiles(file: string): { files: string[]; tests: string[] } | Promise<{ files: string[]; tests: string[] }>;
  clear(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export class SqliteGraphStore implements GraphStore {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  upsertRelation(rel: CodeRelation): void {
    this.store.upsertRelation(rel);
  }

  deleteRelationsForFile(file: string): void {
    this.store.deleteRelationsForFile(file);
  }

  findRelatedFiles(file: string, depth = 1): CodeRelation[] {
    return this.store.findRelatedFiles(file, depth);
  }

  findAffectedFiles(file: string): { files: string[]; tests: string[] } {
    return this.store.findAffectedFiles(file);
  }

  clear(): void {
    /* no-op: SQLiteStore handles its own data lifecycle */
  }
}

type Neo4jTransaction = {
  run(query: string, params?: Record<string, unknown>): Promise<{ records: any[] }>;
};

type Neo4jSession = {
  executeWrite<T>(fn: (tx: Neo4jTransaction) => Promise<T>): Promise<T>;
  executeRead<T>(fn: (tx: Neo4jTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

type Neo4jDriver = {
  session(): Neo4jSession;
  close(): Promise<void>;
};

let neo4jModule: any = null;

async function getNeo4j(): Promise<any> {
  if (!neo4jModule) {
    neo4jModule = await import("neo4j-driver");
  }
  return neo4jModule;
}

export class Neo4jGraphStore implements GraphStore {
  private driver: Neo4jDriver | null = null;
  private url: string;
  private username: string;
  private password: string;

  constructor(opts: { url: string; username?: string; password?: string }) {
    this.url = opts.url;
    this.username = opts.username || "neo4j";
    this.password = opts.password || "neo4j";
  }

  private async getDriver(): Promise<Neo4jDriver> {
    if (!this.driver) {
      const neo4jMod = await getNeo4j();
      const n = neo4jMod.default || neo4jMod;
      this.driver = n.driver(this.url, n.auth.basic(this.username, this.password));
    }
    return this.driver!;
  }

  async upsertRelation(rel: CodeRelation): Promise<void> {
    const session = (await this.getDriver()).session();
    try {
      await session.executeWrite(async (tx: Neo4jTransaction) => {
        const sourceFile = rel.sourceFile;
        const targetFile = rel.targetFile || rel.targetName;
        const relType = rel.relationType.toUpperCase().replace(/-/g, "_");

        await tx.run(
          `MERGE (s:File {path: $sourceFile})
           MERGE (t:File {path: $targetFile})
           MERGE (s)-[r:${relType}]->(t)
           SET r.weight = $weight, r.confidence = $confidence, r.status = $status`,
          {
            sourceFile,
            targetFile,
            weight: rel.weight,
            confidence: rel.confidence,
            status: rel.status,
          },
        );
      });
    } finally {
      await session.close();
    }
  }

  async deleteRelationsForFile(file: string): Promise<void> {
    const session = (await this.getDriver()).session();
    try {
      await session.executeWrite(async (tx: Neo4jTransaction) => {
        await tx.run(
          `MATCH (f:File {path: $file})
           OPTIONAL MATCH (f)-[r]-()
           DELETE r`,
          { file },
        );
      });
    } finally {
      await session.close();
    }
  }

  async findRelatedFiles(file: string, depth = 1): Promise<CodeRelation[]> {
    const session = (await this.getDriver()).session();
    try {
      const result = await session.executeRead(async (tx: Neo4jTransaction) => {
        const query = depth > 1
          ? `MATCH (f:File {path: $file})
             OPTIONAL MATCH path = (f)-[*1..${depth}]-(related:File)
             WHERE ALL(rel IN relationships(path) WHERE type(rel) <> 'TESTED_BY')
             RETURN relationships(path)[-1] AS r, related
             LIMIT 50`
          : `MATCH (f:File {path: $file})
             OPTIONAL MATCH (f)-[r]-(related:File)
             WHERE type(r) <> 'TESTED_BY'
             RETURN r, related
             LIMIT 50`;

        return await tx.run(query, { file });
      });

      return result.records
        .filter((record: any) => record.get("r") !== null)
        .map((record: any) => {
          const rel = record.get("r");
          const related = record.get("related");

          return {
            id: rel.elementId || `${file}-${related?.properties?.path || ""}`,
            sourceType: "file" as const,
            sourceName: rel.start?.properties?.name || "",
            sourceFile: rel.start?.properties?.path || file,
            targetType: "file" as const,
            targetName: related?.properties?.name || "",
            targetFile: related?.properties?.path || "",
            relationType: rel.type.toLowerCase() as CodeRelation["relationType"],
            weight: rel.properties?.weight || 1,
            status: rel.properties?.status || "fresh",
            confidence: rel.properties?.confidence || 0.98,
          } as CodeRelation;
        });
    } finally {
      await session.close();
    }
  }

  async findAffectedFiles(file: string): Promise<{ files: string[]; tests: string[] }> {
    const session = (await this.getDriver()).session();
    try {
      const result = await session.executeRead(async (tx: Neo4jTransaction) => {
        return await tx.run(
          `MATCH (f:File {path: $file})
           OPTIONAL MATCH (f)-[r:IMPORTS|RENDERS|CALLS|USES]->(target:File)
           OPTIONAL MATCH (source:File)-[r2:IMPORTS|RENDERS|CALLS|USES]->(f)
           OPTIONAL MATCH (test:File)-[r3:COVERS]->(f)
           RETURN
             COLLECT(DISTINCT target.path) AS forwardFiles,
             COLLECT(DISTINCT source.path) AS backwardFiles,
             COLLECT(DISTINCT test.path) AS testFiles`,
          { file },
        );
      });

      const record = result.records[0];
      const forwardFiles: string[] = record?.get("forwardFiles") || [];
      const backwardFiles: string[] = record?.get("backwardFiles") || [];
      const testFiles: string[] = record?.get("testFiles") || [];

      const files = [...new Set([...forwardFiles, ...backwardFiles])].filter(
        (f: string) => f && f !== file,
      );
      const tests = testFiles.filter(Boolean);

      return { files, tests };
    } finally {
      await session.close();
    }
  }

  async clear(): Promise<void> {
    const session = (await this.getDriver()).session();
    try {
      await session.executeWrite(async (tx: Neo4jTransaction) => {
        await tx.run("MATCH (n) DETACH DELETE n");
      });
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }
}
