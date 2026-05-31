import * as crypto from "node:crypto";
import type { SessionMemory } from "../types.js";
import { SQLiteStore } from "../stores/sqlite-store.js";

export class SessionMemoryManager {
  private store: SQLiteStore;
  private sessionId: string;

  constructor(store: SQLiteStore, sessionId?: string) {
    this.store = store;
    this.sessionId = sessionId || crypto.randomUUID();
  }

  createSession(): SessionMemory {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const session: SessionMemory = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      currentTask: "",
      filesInspected: [],
      currentFindings: "",
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "fresh",
    };

    this.store.upsertSession(session);
    return session;
  }

  getActiveSession(): SessionMemory | null {
    const session = this.store.getSession(this.sessionId);
    if (!session) return null;

    const now = new Date();
    const expires = new Date(session.expiresAt);
    if (now > expires) {
      return null;
    }
    return session;
  }

  updateTask(task: string): SessionMemory | null {
    const session = this.getOrCreateSession();
    const updated: SessionMemory = {
      ...session,
      currentTask: task,
      updatedAt: new Date().toISOString(),
    };
    this.store.upsertSession(updated);
    return updated;
  }

  addInspectedFile(file: string): SessionMemory | null {
    const session = this.getOrCreateSession();
    if (session.filesInspected.includes(file)) return session;

    const updated: SessionMemory = {
      ...session,
      filesInspected: [...session.filesInspected, file],
      updatedAt: new Date().toISOString(),
    };
    this.store.upsertSession(updated);
    return updated;
  }

  updateFindings(findings: string): SessionMemory | null {
    const session = this.getOrCreateSession();
    const updated: SessionMemory = {
      ...session,
      currentFindings: findings,
      updatedAt: new Date().toISOString(),
    };
    this.store.upsertSession(updated);
    return updated;
  }

  private getOrCreateSession(): SessionMemory {
    return this.getActiveSession() || this.createSession();
  }

  cleanupExpired(): void {
    this.store.deleteExpiredSessions();
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
