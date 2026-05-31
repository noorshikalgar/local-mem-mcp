import type { TaskType, ExtractedEntities } from "../types.js";

const CLASSIFICATION_PATTERNS: Array<{ type: TaskType; patterns: RegExp[] }> = [
  {
    type: "bug_fix",
    patterns: [
      /bug/i, /fix/i, /broken/i, /error/i, /crash/i, /not working/i,
      /incorrect/i, /wrong/i, /failing/i, /exception/i, /issue/i,
    ],
  },
  {
    type: "new_feature",
    patterns: [
      /add/i, /feature/i, /new/i, /create/i, /implement/i, /build/i,
      /support.*for/i, /introduce/i,
    ],
  },
  {
    type: "refactor",
    patterns: [
      /refactor/i, /clean.?up/i, /reorganize/i, /simplify/i, /extract/i,
      /rework/i, /redesign/i, /improve.*code/i,
    ],
  },
  {
    type: "test_generation",
    patterns: [
      /test/i, /spec/i, /coverage/i, /unit.?test/i, /integration.?test/i,
    ],
  },
  {
    type: "explanation",
    patterns: [
      /explain/i, /what does/i, /how does/i, /why is/i, /understand/i,
      /describe/i, /tell me about/i,
    ],
  },
  {
    type: "code_review",
    patterns: [
      /review/i, /check.*code/i, /audit/i, /inspect/i,
    ],
  },
  {
    type: "dependency_update",
    patterns: [
      /update.*dep/i, /upgrade.*package/i, /bump.*version/i,
      /migrate.*library/i, /dependabot/i,
    ],
  },
  {
    type: "ui_change",
    patterns: [
      /ui/i, /style/i, /layout/i, /css/i, /design/i, /visual/i,
      /component.*change/i, /button/i, /form.*change/i,
    ],
  },
  {
    type: "api_integration",
    patterns: [
      /api.*integrat/i, /endpoint/i, /graphql/i, /rest.*call/i,
      /fetch.*data/i, /http.*request/i,
    ],
  },
  {
    type: "performance_issue",
    patterns: [
      /performance/i, /slow/i, /optimize/i, /bottleneck/i, /memory.*leak/i,
      /lazy.*load/i, /cache/i, /render.*optimize/i,
    ],
  },
];

const ENTITY_EXTRACTION_PATTERNS = [
  // Module references like "auth module"
  /(\w+)\s+(?:module|service|component|page|route|guard|hook)/gi,
  // CamelCase symbols (components, classes)
  /[A-Z][a-z]+(?:[A-Z][a-z]+)+/g,
  // File-like references
  /[\w-]+\/[\w\/.-]+\.\w+/g,
];

export function classifyTask(query: string): TaskType {
  let bestType: TaskType = "unknown";
  let bestScore = 0;

  for (const { type, patterns } of CLASSIFICATION_PATTERNS) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

export function extractEntities(query: string): ExtractedEntities {
  const entities: string[] = [];
  const possibleModules: string[] = [];
  const symbols: string[] = [];
  const files: string[] = [];

  for (const pattern of ENTITY_EXTRACTION_PATTERNS) {
    const matches = query.matchAll(pattern);
    for (const match of matches) {
      const value = match[1] || match[0];
      if (match[0].includes("/")) {
        files.push(match[0]);
      } else if (/^[A-Z]/.test(value) && value.length >= 3) {
        symbols.push(value);
      } else if (value.length >= 2) {
        entities.push(value);
      }
    }
  }

  // Module detection
  const moduleKeywords = [
    "auth", "admin", "billing", "api", "ui", "shared", "settings",
    "users", "reports", "dashboard", "routes", "store", "hooks",
  ];
  for (const keyword of moduleKeywords) {
    if (query.toLowerCase().includes(keyword)) {
      possibleModules.push(keyword);
    }
  }

  return {
    entities: [...new Set(entities)],
    possibleModules: [...new Set(possibleModules)],
    symbols: [...new Set(symbols)],
    files: [...new Set(files)],
  };
}
