import { execSync } from "node:child_process";
import * as path from "node:path";

export interface GitInfo {
  currentBranch: string;
  changedFiles: string[];
  uncommittedDiff: string;
  recentCommits: GitCommit[];
  isRepo: boolean;
  rootDir: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
  files: string[];
}

export interface FileDiff {
  file: string;
  oldHash?: string;
  newHash?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
}

export class GitService {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private exec(args: string): string {
    try {
      return execSync(`git ${args}`, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      }).trim();
    } catch {
      return "";
    }
  }

  isRepo(): boolean {
    try {
      const result = this.exec("rev-parse --is-inside-work-tree");
      return result === "true";
    } catch {
      return false;
    }
  }

  getRootDir(): string {
    return this.exec("rev-parse --show-toplevel") || this.projectRoot;
  }

  getCurrentBranch(): string {
    return this.exec("rev-parse --abbrev-ref HEAD") || "unknown";
  }

  getChangedFiles(): string[] {
    const tracked = this.exec("diff --name-only").split("\n").filter(Boolean);
    const staged = this.exec("diff --cached --name-only").split("\n").filter(Boolean);
    const untracked = this.exec("ls-files --others --exclude-standard").split("\n").filter(Boolean);
    return [...new Set([...tracked, ...staged, ...untracked])];
  }

  getUncommittedDiff(): string {
    const tracked = this.exec("diff");
    const staged = this.exec("diff --cached");
    return [tracked, staged].filter(Boolean).join("\n");
  }

  getRecentCommits(count = 10): GitCommit[] {
    const log = this.exec(
      `log --oneline --max-count=${count} --format="%H||%s||%aI"`,
    );
    if (!log) return [];

    return log.split("\n").map((line) => {
      const [hash, ...rest] = line.split("||");
      const message = rest.slice(0, -1).join("||");
      const date = rest[rest.length - 1] || "";

      let files: string[] = [];
      try {
        const fileList = this.exec(`diff-tree --no-commit-id --name-only -r ${hash}`);
        files = fileList.split("\n").filter(Boolean);
      } catch {
        // ignore
      }

      return { hash, message, date, files };
    });
  }

  getDiffSummary(): FileDiff[] {
    const diffs: FileDiff[] = [];

    const statusLines = this.exec(
      'status --porcelain',
    ).split("\n").filter(Boolean);

    for (const line of statusLines) {
      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3).trim();

      if (status === "??") {
        diffs.push({ file: filePath, status: "added" });
      } else if (line[0] === "R") {
        const [_, oldPath, newPath] = filePath.match(/^(.*?) -> (.*)$/) || [];
        diffs.push({ file: newPath || filePath, status: "renamed", oldPath });
      } else if (status === "D") {
        diffs.push({ file: filePath, status: "deleted" });
      } else if (status === "M" || status.includes("M")) {
        diffs.push({ file: filePath, status: "modified" });
      } else if (status === "A") {
        diffs.push({ file: filePath, status: "added" });
      }
    }

    return diffs;
  }

  getCommitDiff(hash: string): FileDiff[] {
    const output = this.exec(`diff-tree --no-commit-id --name-status -r ${hash}`);
    if (!output) return [];

    return output.split("\n").filter(Boolean).map((line) => {
      const [status, ...fileParts] = line.split(/\s+/);
      const file = fileParts.join(" ");
      if (status === "R100" || status.startsWith("R")) {
        const [oldPath, newPath] = file.split("\t");
        return { file: newPath || file, status: "renamed" as const, oldPath };
      }
      if (status === "D") return { file, status: "deleted" as const };
      if (status === "A") return { file, status: "added" as const };
      return { file, status: "modified" as const };
    });
  }

  getFileHash(file: string): string {
    return this.exec(`hash-object "${file}"`);
  }

  getFileLastCommitHash(file: string): string {
    return this.exec(`log -1 --format="%H" -- "${file}"`);
  }

  getAllInfo(): GitInfo {
    const isRepo = this.isRepo();
    if (!isRepo) {
      return {
        isRepo: false,
        currentBranch: "",
        changedFiles: [],
        uncommittedDiff: "",
        recentCommits: [],
        rootDir: this.projectRoot,
      };
    }

    return {
      isRepo: true,
      currentBranch: this.getCurrentBranch(),
      changedFiles: this.getChangedFiles(),
      uncommittedDiff: this.getUncommittedDiff(),
      recentCommits: this.getRecentCommits(),
      rootDir: this.getRootDir(),
    };
  }
}
