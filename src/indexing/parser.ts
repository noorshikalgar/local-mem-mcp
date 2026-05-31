import type { SupportedLanguage, ParsedSymbol } from "../types.js";

export interface ParserResult {
  imports: string[];
  exports: string[];
  symbols: ParsedSymbol[];
  outline: OutlineSection[];
}

export interface OutlineSection {
  name: string;
  startLine: number;
  endLine: number;
  type: "imports" | "types" | "constants" | "class" | "function" | "component" | "interface" | "enum" | "section";
  children?: OutlineSection[];
}

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  namedChildCount: number;
  children: TSNode[];
  namedChildren: TSNode[];
  parent: TSNode | null;
  childForFieldName(fieldName: string): TSNode | null;
}

let tsParser: any = null;

async function getTSParserAsync(language: SupportedLanguage): Promise<any> {
  if (tsParser) return tsParser;

  const langKey = language === "typescript" || language === "tsx" ? "tsx"
    : language === "javascript" ? "javascript"
    : language === "python" ? "python"
    : null;
  if (!langKey) return null;

  try {
    const Parser = (await import("tree-sitter")).default;
    const parser = new Parser();

    if (language === "typescript" || language === "tsx") {
      const tsModule = await import("tree-sitter-typescript");
      const lang: any = tsModule.default?.tsx || tsModule.tsx || tsModule.default || tsModule;
      parser.setLanguage(lang);
    } else if (language === "javascript") {
      const jsModule = await import("tree-sitter-javascript");
      const lang: any = jsModule.default || jsModule;
      parser.setLanguage(lang);
    } else if (language === "python") {
      const pyModule = await import("tree-sitter-python");
      const lang: any = pyModule.default || pyModule;
      parser.setLanguage(lang);
    }

    tsParser = parser;
    return parser;
  } catch {
    return null;
  }
}

export async function parseCodeAsync(filePath: string, content: string, language: SupportedLanguage): Promise<ParserResult> {
  if (language === "typescript" || language === "javascript" || language === "tsx") {
    try {
      const parser = await getTSParserAsync(language);
      if (parser) {
        return tsParse(parser, content);
      }
    } catch {
      // fall through to fallback
    }
  }
  return fallbackParse(content);
}

export function parseCode(filePath: string, content: string, language: SupportedLanguage): ParserResult {
  // Synchronous fallback - try tree-sitter synchronously if parser already loaded
  if (tsParser && (language === "typescript" || language === "javascript" || language === "tsx")) {
    try {
      return tsParse(tsParser, content);
    } catch {
      return fallbackParse(content);
    }
  }
  return fallbackParse(content);
}

function tsParse(parser: any, content: string): ParserResult {
  const tree = parser.parse(content);
  const root = tree.rootNode as TSNode;

  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: ParsedSymbol[] = [];
  const outline: OutlineSection[] = [];
  let importStart = -1;
  let importEnd = -1;

  walkTree(root, (node) => {
    const type = node.type;
    const sl = node.startPosition.row + 1;
    const el = node.endPosition.row + 1;

    switch (type) {
      case "import_statement":
      case "import_declaration":
      case "require_statement": {
        const source = findImportSource(node);
        if (source) imports.push(source);
        if (importStart === -1) importStart = sl;
        importEnd = el;
        return true; // skip children
      }
      case "export_statement": {
        const name = findExportName(node);
        if (name) exports.push(name);
        return false;
      }
      case "function_declaration": {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name) {
          symbols.push({ name, type: "function", startLine: sl, endLine: el });
          outline.push({ name, startLine: sl, endLine: el, type: "function" });
        }
        return true;
      }
      case "method_definition": {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name) {
          symbols.push({ name, type: "method", startLine: sl, endLine: el });
        }
        return true;
      }
      case "class_declaration": {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name) {
          symbols.push({ name, type: "class", startLine: sl, endLine: el });
          outline.push({ name, startLine: sl, endLine: el, type: "class" });
        }
        return true;
      }
      case "interface_declaration": {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name) {
          symbols.push({ name, type: "interface", startLine: sl, endLine: el });
          outline.push({ name, startLine: sl, endLine: el, type: "interface" });
        }
        return true;
      }
      case "type_alias_declaration": {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name) {
          symbols.push({ name, type: "type", startLine: sl, endLine: el });
          outline.push({ name, startLine: sl, endLine: el, type: "types" });
        }
        return true;
      }
      case "enum_declaration": {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name) {
          symbols.push({ name, type: "enum", startLine: sl, endLine: el });
          outline.push({ name, startLine: sl, endLine: el, type: "enum" });
        }
        return true;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const child of node.namedChildren) {
          if (child.type === "variable_declarator" || child.type === "assignment_expression") {
            const nameNode = child.childForFieldName("name") || child.childForFieldName("left");
            const valueNode = child.childForFieldName("value") || child.childForFieldName("right");
            const name = nameNode?.text;
            if (name && valueNode) {
              const vt = valueNode.type;
              if (vt === "arrow_function" || vt === "function_expression") {
                const component = /<[A-Z]/.test(valueNode.text) || /React\.(FC|FunctionComponent)/.test(valueNode.text);
                symbols.push({ name, type: component ? "component" : "function", startLine: sl, endLine: el });
                outline.push({ name, startLine: sl, endLine: el, type: component ? "component" : "function" });
              }
            }
          }
        }
        return true;
      }
    }
    return false;
  });

  if (importStart !== -1) {
    outline.unshift({ name: "imports", startLine: importStart, endLine: importEnd, type: "imports" });
  }

  return { imports: [...new Set(imports)], exports: [...new Set(exports)], symbols, outline };
}

function findImportSource(node: TSNode): string {
  const sourceNode = node.childForFieldName("source");
  if (!sourceNode) {
    // Try to find string in require() calls
    for (const child of node.namedChildren) {
      if (child.type === "string" || child.type === "string_fragment") {
        return child.text.replace(/['"]/g, "");
      }
    }
    return "";
  }
  return sourceNode.text.replace(/['"]/g, "");
}

function findExportName(node: TSNode): string {
  // Check for `export default` with declaration
  const decl = node.childForFieldName("declaration");
  if (decl) {
    const nameNode = decl.childForFieldName("name");
    if (nameNode) return nameNode.text;
    // For lexical declarations (const/let/var)
    for (const child of decl.namedChildren) {
      if (child.type === "variable_declarator") {
        const n = child.childForFieldName("name");
        if (n) return n.text;
      }
    }
  }
  return "";
}

function walkTree(node: TSNode, fn: (node: TSNode) => boolean): void {
  const skipChildren = fn(node);
  if (!skipChildren) {
    for (const child of node.namedChildren) {
      walkTree(child, fn);
    }
  }
}

function fallbackParse(content: string): ParserResult {
  const lines = content.split("\n");
  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: ParsedSymbol[] = [];
  const outline: OutlineSection[] = [];
  const importLines: number[] = [];

  const IMPORT_RE = /^import\s+.*?(?:from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])/m;
  const EXPORT_RE = /^export\s+(?:default\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/m;
  const EXPORT_DEFAULT_RE = /^export\s+default\s+(?:function|class)\s+(\w+)/m;
  const FUNCTION_RE = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m;
  const ARROW_FN_RE = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|\w+\s*=>)/m;
  const CLASS_RE = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m;
  const INTERFACE_RE = /^(?:export\s+)?interface\s+(\w+)/m;
  const TYPE_RE = /^(?:export\s+)?type\s+(\w+)/m;
  const ENUM_RE = /^(?:export\s+)?enum\s+(\w+)/m;
  const COMPONENT_RE = /^(?:export\s+)?(?:const|function)\s+(\w+)\s*[:=]?\s*(?:React\.)?(?:FC|FunctionComponent|ReactNode)/m;

  let i = 0;
  for (const line of lines) {
    const lineNum = i + 1;

    const importMatch = line.match(IMPORT_RE);
    if (importMatch) {
      const source = importMatch[1] || importMatch[2] || "";
      if (source) imports.push(source);
      importLines.push(lineNum);
    }

    const exportMatch = line.match(EXPORT_DEFAULT_RE) || line.match(EXPORT_RE);
    if (exportMatch) {
      exports.push(exportMatch[1]);
    }

    const fnMatch = line.match(FUNCTION_RE);
    if (fnMatch) {
      symbols.push({ name: fnMatch[1], type: "function", startLine: lineNum, endLine: findBlockEnd(lines, lineNum) });
    }

    const arrowMatch = line.match(ARROW_FN_RE);
    if (arrowMatch) {
      symbols.push({ name: arrowMatch[1], type: "function", startLine: lineNum, endLine: findBlockEnd(lines, lineNum) });
    }

    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      symbols.push({ name: classMatch[1], type: "class", startLine: lineNum, endLine: findBlockEnd(lines, lineNum) });
    }

    const ifaceMatch = line.match(INTERFACE_RE);
    if (ifaceMatch) {
      symbols.push({ name: ifaceMatch[1], type: "interface", startLine: lineNum, endLine: findBlockEnd(lines, lineNum) });
    }

    const typeMatch = line.match(TYPE_RE);
    if (typeMatch) {
      symbols.push({ name: typeMatch[1], type: "type", startLine: lineNum, endLine: lineNum });
    }

    const enumMatch = line.match(ENUM_RE);
    if (enumMatch) {
      symbols.push({ name: enumMatch[1], type: "enum", startLine: lineNum, endLine: findBlockEnd(lines, lineNum) });
    }

    const componentMatch = line.match(COMPONENT_RE);
    if (componentMatch) {
      symbols.push({ name: componentMatch[1], type: "component", startLine: lineNum, endLine: findBlockEnd(lines, lineNum) });
    }

    i++;
  }

  if (importLines.length > 0) {
    outline.push({
      name: "imports",
      startLine: importLines[0],
      endLine: importLines[importLines.length - 1],
      type: "imports",
    });
  }

  for (const sym of symbols) {
    outline.push({
      name: sym.name,
      startLine: sym.startLine,
      endLine: sym.endLine,
      type: sym.type as any,
    });
  }

  return { imports: [...new Set(imports)], exports: [...new Set(exports)], symbols, outline };
}

function findBlockEnd(lines: string[], startIdx: number): number {
  let braceCount = 0;
  let foundOpen = false;
  for (let i = startIdx - 1; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        braceCount++;
        foundOpen = true;
      } else if (ch === "}") {
        braceCount--;
      }
    }
    if (foundOpen && braceCount === 0) {
      return i + 1;
    }
  }
  return lines.length;
}
