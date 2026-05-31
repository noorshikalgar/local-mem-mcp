import { describe, it, expect } from "vitest";
import { parseCode } from "../../src/indexing/parser.js";

describe("parseCode", () => {
  it("should parse TypeScript imports", () => {
    const result = parseCode("test.ts", `
import { AuthService } from "./auth.service";
import { Router } from "@angular/router";
const x = 1;
`, "typescript");
    expect(result.imports).toContain("./auth.service");
    expect(result.imports).toContain("@angular/router");
  });

  it("should parse function declarations", () => {
    const result = parseCode("test.ts", `
export function login(username: string, password: string) {
  return api.post("/auth/login", { username, password });
}
`, "typescript");
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("login");
    expect(result.symbols[0].type).toBe("function");
  });

  it("should parse class declarations", () => {
    const result = parseCode("test.ts", `
export class AuthService {
  private token: string;
  login() { return "ok"; }
}
`, "typescript");
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("AuthService");
    expect(result.symbols[0].type).toBe("class");
  });

  it("should parse interface declarations", () => {
    const result = parseCode("test.ts", `
export interface User {
  id: number;
  name: string;
}
`, "typescript");
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("User");
    expect(result.symbols[0].type).toBe("interface");
  });

  it("should parse type declarations", () => {
    const result = parseCode("test.ts", `
type UserRole = "admin" | "user";
`, "typescript");
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("UserRole");
  });

  it("should parse enum declarations", () => {
    const result = parseCode("test.ts", `
export enum Role {
  Admin,
  User,
}
`, "typescript");
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("Role");
    expect(result.symbols[0].type).toBe("enum");
  });

  it("should detect exports", () => {
    const result = parseCode("test.ts", `
export function hello() {}
export class World {}
export default const x = 1;
`, "typescript");
    expect(result.exports).toContain("hello");
    expect(result.exports).toContain("World");
  });

  it("should handle empty file", () => {
    const result = parseCode("empty.ts", "", "typescript");
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
    expect(result.symbols).toEqual([]);
  });

  it("should build outline sections", () => {
    const result = parseCode("test.ts", `
import { a } from "./a";
import { b } from "./b";

export class Service {}
export function doStuff() {}
`, "typescript");
    expect(result.outline.length).toBeGreaterThanOrEqual(2);
    const importSection = result.outline.find((s) => s.type === "imports");
    expect(importSection).toBeDefined();
  });
});
