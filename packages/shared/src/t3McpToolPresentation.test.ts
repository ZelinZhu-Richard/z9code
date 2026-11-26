import { describe, expect, it } from "vite-plus/test";

import {
  Z9_MCP_TOOL_NAMES,
  resolveT3McpSummaryAction,
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
} from "./t3McpToolPresentation.ts";

describe("resolveT3McpToolPresentation", () => {
  it("recognizes every z9code tool across provider prefixes and completion suffixes", () => {
    for (const tool of Z9_MCP_TOOL_NAMES) {
      const presentation = resolveT3McpToolPresentation(tool);
      for (const prefix of [
        "mcp__z9code__",
        "mcp__z9_code__",
        "mcp__z9code__",
        "z9code-code.",
        "z9code.",
        "z9code-direct.",
        "mcp__z9_code_direct__",
        "z9_code/",
        "z9code:",
        "mcp_z9code_",
        "z9code ",
        "z9code · ",
      ]) {
        expect(resolveT3McpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveT3McpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveT3McpToolPresentation("z9code-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolveT3McpToolPresentation("z9code-thread_opencode2-adapter_not_a_tool")).toBeNull();
  });
});

describe("resolveT3McpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveT3McpToolDefinition("mcp__z9code__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveT3McpToolDefinition("preview_type")?.labels);
    expect(resolveT3McpToolDefinition("z9_thread_transfer", { action: "fork" })?.displayName).toBe(
      resolveT3McpToolDefinition("z9_thread_fork")?.displayName,
    );
    expect(resolveT3McpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveT3McpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveT3McpSummaryAction("mcp__z9code__t3_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolveT3McpSummaryAction("z9_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveT3McpSummaryAction("z9_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveT3McpSummaryAction("z9_thread_configure", {})).toBe("thread-configuration");
    expect(resolveT3McpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveT3McpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
