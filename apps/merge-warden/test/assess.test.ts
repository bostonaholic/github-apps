import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, assess, modelFromEnv, renderDiff } from "../src/assess.js";
import type { Assessment } from "../src/grade.js";
import type { ChangedFile } from "../src/signals.js";

const FILES: ChangedFile[] = [
  { filename: "src/app.ts", status: "modified", changes: 2, patch: "@@ -1 +1 @@\n-a\n+b" },
];

const VALID: Assessment = {
  customer: "low",
  data_security: "low",
  recovery: "low",
  door: "two-way",
  door_reason: "a revert restores prior behavior",
  confidence: 95,
  summary: "Renames a local variable.",
  findings: [],
};

function fakeClient(respond: () => unknown) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        requests.push(params);
        return respond();
      },
    },
  };
  return { client, requests };
}

function recordingLog() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      info: (msg: string) => lines.push(`info ${msg}`),
      warn: (msg: string) => lines.push(`warn ${msg}`),
      error: (msg: string) => lines.push(`error ${msg}`),
    },
  };
}

async function run(respond: () => unknown) {
  const { client, requests } = fakeClient(respond);
  const { log, lines } = recordingLog();
  // The fake is structurally compatible with the one method assess uses.
  const result = await assess(client as never, FILES, log);
  return { result, requests, lines };
}

describe("renderDiff", () => {
  it("wraps each file's patch with its path and status", () => {
    expect(renderDiff(FILES)).toBe(
      '<file path="src/app.ts" status="modified">\n@@ -1 +1 @@\n-a\n+b\n</file>',
    );
  });

  it("names the previous path of a rename and marks a patchless file", () => {
    const text = renderDiff([
      { filename: "b.ts", previous_filename: "a.ts", status: "renamed", changes: 0 },
    ]);
    expect(text).toBe(
      '<file path="b.ts" status="renamed" previous_path="a.ts">\n(no content change)\n</file>',
    );
  });

  it("separates files with a blank line", () => {
    expect(renderDiff([...FILES, ...FILES]).split("\n\n")).toHaveLength(2);
  });
});

describe("modelFromEnv", () => {
  it("defaults to Haiku", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(modelFromEnv({})).toBe(DEFAULT_MODEL);
  });

  it("falls back to the default when ANTHROPIC_MODEL is blank", () => {
    expect(modelFromEnv({ ANTHROPIC_MODEL: "  " })).toBe(DEFAULT_MODEL);
  });

  it("uses ANTHROPIC_MODEL when set", () => {
    expect(modelFromEnv({ ANTHROPIC_MODEL: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
  });
});

describe("assess", () => {
  it("returns the parsed assessment", async () => {
    const { result } = await run(() => ({ stop_reason: "end_turn", parsed_output: VALID }));
    expect(result).toEqual(VALID);
  });

  it("asks the configured model for structured output over the rendered diff", async () => {
    const { requests } = await run(() => ({ stop_reason: "end_turn", parsed_output: VALID }));
    expect(requests).toHaveLength(1);
    const request = requests[0] as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
      output_config: { format: { type: string } };
    };
    expect(request.model).toBe(modelFromEnv());
    expect(request.messages).toEqual([{ role: "user", content: renderDiff(FILES) }]);
    expect(request.system).toContain("one-way");
    expect(request.output_config.format.type).toBe("json_schema");
  });

  it("sends neither tool_choice nor a thinking field, which this model rejects", async () => {
    const { requests } = await run(() => ({ stop_reason: "end_turn", parsed_output: VALID }));
    expect(requests[0]).not.toHaveProperty("tool_choice");
    expect(requests[0]).not.toHaveProperty("thinking");
  });

  it.each(["refusal", "max_tokens"])(
    "returns null when the model stops with %s, even with parsed output",
    async (stop_reason) => {
      const { result, lines } = await run(() => ({ stop_reason, parsed_output: VALID }));
      expect(result).toBeNull();
      expect(lines).toEqual([`warn assessment stopped early: ${stop_reason}`]);
    },
  );

  it("returns null when the output did not match the schema", async () => {
    const { result, lines } = await run(() => ({ stop_reason: "end_turn", parsed_output: null }));
    expect(result).toBeNull();
    expect(lines).toEqual(["warn assessment did not match the schema"]);
  });

  it.each([
    ["an API status error", new Anthropic.APIError(529, undefined, "overloaded", new Headers())],
    ["a connection error", new Anthropic.APIConnectionError({ message: "socket hang up" })],
    ["any other SDK error", new Anthropic.AnthropicError("could not parse response")],
  ])("returns null and logs on %s", async (_name, error) => {
    const { result, lines } = await run(() => {
      throw error;
    });
    expect(result).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^error assessment failed: /);
  });

  it("rethrows an error that did not come from the SDK", async () => {
    const bug = new TypeError("undefined is not a function");
    await expect(
      run(() => {
        throw bug;
      }),
    ).rejects.toBe(bug);
  });
});
