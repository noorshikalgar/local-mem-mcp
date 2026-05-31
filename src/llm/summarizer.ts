import type { ParserResult } from "../indexing/parser.js";
import type { FileSummary } from "../types.js";

export interface LLMConfig {
  apiUrl: string;
  apiKey?: string;
  model: string;
}

export class LLMSummarizer {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = {
      apiUrl: config.apiUrl.replace(/\/+$/, ""),
      apiKey: config.apiKey || "",
      model: config.model || "local-model",
    };
  }

  async summarizeFile(filePath: string, content: string, parsed: ParserResult): Promise<string | null> {
    try {
      const prompt = `Summarize the purpose of this code file in 1-3 sentences. Be concise and specific about what the file does.

File: ${filePath}
Exports: ${parsed.exports.join(", ") || "none"}
Symbols: ${parsed.symbols.map(s => s.name).join(", ") || "none"}

\`\`\`
${content.slice(0, 3000)}
\`\`\``;

      const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: "You are a code analysis assistant. Summarize code files concisely." },
            { role: "user", content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        console.error(`LLM API error: ${response.status} ${await response.text()}`);
        return null;
      }

      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (err) {
      console.error("LLM summarization failed:", err);
      return null;
    }
  }

  async summarizeModule(moduleName: string, files: FileSummary[]): Promise<string | null> {
    try {
      const fileList = files.map(f =>
        `- ${f.file}: exports [${f.mainExports.join(", ")}], risk ${f.riskLevel}`
      ).join("\n");

      const prompt = `Summarize the purpose of the "${moduleName}" module based on its files. 1-3 sentences.

Module: ${moduleName}
Files (${files.length}):
${fileList}`;

      const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: "You are a code architecture analyst. Summarize module purposes concisely." },
            { role: "user", content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        console.error(`LLM API error: ${response.status} ${await response.text()}`);
        return null;
      }

      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (err) {
      console.error("LLM module summarization failed:", err);
      return null;
    }
  }
}
