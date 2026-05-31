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

const FUNCTION_RE = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m;
const ARROW_FN_RE = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|\w+\s*=>)/m;
const CLASS_RE = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m;
const INTERFACE_RE = /^(?:export\s+)?interface\s+(\w+)/m;
const TYPE_RE = /^(?:export\s+)?type\s+(\w+)/m;
const ENUM_RE = /^(?:export\s+)?enum\s+(\w+)/m;
const IMPORT_RE = /^import\s+.*?(?:from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])/m;
const EXPORT_RE = /^export\s+(?:default\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/m;
const EXPORT_DEFAULT_RE = /^export\s+default\s+(?:function|class)\s+(\w+)/m;
const COMPONENT_RE = /^(?:export\s+)?(?:const|function)\s+(\w+)\s*[:=]?\s*(?:React\.)?(?:FC|FunctionComponent|ReactNode)/m;

export function parseCode(filePath: string, content: string, language: SupportedLanguage): ParserResult {
  if (language !== "typescript" && language !== "javascript") {
    return simpleParse(content);
  }
  return simpleParse(content);
}

function simpleParse(content: string): ParserResult {
  const lines = content.split("\n");
  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: ParsedSymbol[] = [];
  const outline: OutlineSection[] = [];
  const importLines: number[] = [];

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
      symbols.push({ name: arrowMatch[1], type: "function", startLine: lineNum, endLine: lineNum });
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
