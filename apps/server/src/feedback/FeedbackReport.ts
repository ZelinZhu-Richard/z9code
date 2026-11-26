import { AgentFeedbackKind, AgentFeedbackTrace } from "@z9code/contracts";
import { resolveT3McpToolId } from "@z9code/shared/t3McpToolPresentation";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

// Code points, as the scrubber caps them, so a valid input stays a valid report after redaction.
const FeedbackText = Schema.String.check(Schema.isMaxCodePoints(300));

/** Turns the outline of a requested report covers at least. */
export const FEEDBACK_TRACE_TURNS = 5;

const reportFields = {
  kind: AgentFeedbackKind,
  subject: Schema.String.annotate({ description: "z9code tool name, `z9` command, or `general`." }),
  expected: FeedbackText,
  actual: FeedbackText,
  workaround: FeedbackText.annotate({ description: "What you did instead, or empty." }),
  // Annotate before the default: an annotation after it never reaches the JSON schema.
  userRequested: Schema.Boolean.annotate({ description: "The user asked for this report." }).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
};

export const FeedbackInput = Schema.Struct({
  ...reportFields,
  turns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
    .annotate({
      description: "How many recent turns, counting this one, the problem spans.",
    })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(1))),
});

export const FeedbackTrace = AgentFeedbackTrace;
export type FeedbackTrace = AgentFeedbackTrace;

const storedFields = {
  id: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  source: Schema.Literals(["mcp", "cli"]),
  sent: Schema.Boolean,
};

export const FeedbackReport = Schema.Struct({
  ...reportFields,
  ...storedFields,
  trace: Schema.NullOr(FeedbackTrace),
});

/** What `z9_feedback` answers: the report, with only the size of what its trace attached. */
export const FeedbackSubmitResult = Schema.Struct({
  ...reportFields,
  ...storedFields,
  trace: Schema.NullOr(FeedbackTrace.mapFields(Struct.omit(["entries"]))),
});

export const FEEDBACK_AWAITING_APPROVAL_NOTE =
  "The user sees this report in a card and chooses there whether to send it and whether to include the conversation. Nothing is sent until they do, and you will not learn their choice. Do not wait for it or send it another way. Call again only if the user asks to change it; that shows a new card.";

/** What `z9_feedback` answers for a requested report: shown to the user, not yet sent. */
export const FeedbackAwaitingApproval = Schema.Struct({
  status: Schema.Literal("awaiting_approval"),
  note: Schema.String,
});
export type FeedbackAwaitingApproval = typeof FeedbackAwaitingApproval.Type;

export const FEEDBACK_OFF_MESSAGE =
  "Agent feedback is off. Turn it on in z9code under Settings > Labs, then try again.";

export class FeedbackOffError extends Schema.TaggedError<FeedbackOffError>()(
  "FeedbackOffError",
  {},
) {
  override get message() {
    return FEEDBACK_OFF_MESSAGE;
  }
}

export type FeedbackSource = "mcp" | "cli";

// Requested reports count when their card is shown, unprompted ones when stored.
export const MAX_REPORTS_PER_TURN = 3;
// Reports from no turn, such as `z9 feedback`, have no turn to count in.
export const MAX_REPORTS_OUTSIDE_TURNS_PER_HOUR = 10;

export class FeedbackLimitError extends Schema.TaggedError<FeedbackLimitError>()(
  "FeedbackLimitError",
  { scope: Schema.Literals(["turn", "hour", "cards"]) },
) {
  override get message() {
    switch (this.scope) {
      case "turn":
        return `This turn already sent ${MAX_REPORTS_PER_TURN} agent feedback reports; nothing was sent.`;
      case "cards":
        return `This turn already showed the user ${MAX_REPORTS_PER_TURN} agent feedback reports to approve; nothing was shown.`;
      case "hour":
        return `This machine already sent ${MAX_REPORTS_OUTSIDE_TURNS_PER_HOUR} agent feedback reports outside a turn in the last hour; nothing was sent.`;
    }
  }
}

export class FeedbackNotRequestedError extends Schema.TaggedError<FeedbackNotRequestedError>()(
  "FeedbackNotRequestedError",
  { source: Schema.Literals(["mcp", "cli"]) },
) {
  override get message() {
    return this.source === "cli"
      ? "Agent feedback is set to When I ask: ask your agent in a thread to send it, so you can approve what is sent."
      : "Agent feedback is set to When I ask: send a report only when the user asks for one.";
  }
}

export class FeedbackStorageError extends Schema.TaggedError<FeedbackStorageError>()(
  "FeedbackStorageError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Could not save agent feedback.";
  }
}

/** The MCP client label `z9 feedback` signs in with, so its reports count as `cli`. */
export const FEEDBACK_CLI_CLIENT_LABEL = "z9 feedback cli";

/** Listed `z9` command paths a report may name. A CLI test keeps this in step with binCli. */
export const Z9_CLI_COMMANDS: ReadonlyArray<string> = [
  "z9",
  "z9 help",
  "z9 serve",
  "z9 app",
  "z9 pair",
  "z9 auth",
  "z9 auth pairing",
  "z9 auth pairing create",
  "z9 auth pairing list",
  "z9 auth pairing revoke",
  "z9 auth session",
  "z9 auth session issue",
  "z9 auth session list",
  "z9 auth session revoke",
  "z9 environment",
  "z9 environment link",
  "z9 environment list",
  "z9 environment unlink",
  "z9 browser",
  "z9 browser setup",
  "z9 project",
  "z9 project add",
  "z9 project remove",
  "z9 project rename",
  "z9 thread",
  "z9 thread list",
  "z9 thread start",
  "z9 thread send",
  "z9 thread show",
  "z9 feedback",
  "z9 feedback list",
  "z9 workflow",
  "z9 workflow start",
  "z9 workflow list",
  "z9 workflow show",
  "z9 workflow resume",
  "z9 workflow cancel",
  "z9 workflow signal",
  "z9 workflow questions",
  "z9 workflow hooks",
  "z9 workflow store",
  "z9 workflow store list",
  "z9 workflow store set",
  "z9 workflow store delete",
  "z9 up",
  "z9 status",
  "z9 service",
  "z9 service install",
  "z9 service restart",
  "z9 service uninstall",
  "z9 service status",
  "z9 service protect",
  "z9 update",
  "z9 install",
  "z9 uninstall",
  "z9 theme",
  "z9 theme set",
  "z9 theme clear",
  "z9 theme show",
  "z9 trace",
  "z9 trace summary",
  "z9 doctor",
  "z9 policy",
  "z9 policy show",
  "z9 policy check",
  "z9 policy templates",
  "z9 policy settings",
  "z9 triage",
];

export type FeedbackInput = typeof FeedbackInput.Type;
export type FeedbackReport = typeof FeedbackReport.Type;

export const FEEDBACK_SUBJECT_MESSAGE =
  "Set subject to the exact z9code tool name, the z9 command, or `general`.";

// The shared resolver knows the presented tools; the prefix covers the rest, such as these.
// Codex also registers `z9code-direct` for z9code tools it keeps out of Code Mode.
const Z9_PREFIX = /^(?:mcp__z9[-_]?code(?:[-_]direct)?__|z9[-_]?code(?:[-_]direct)?[.:/])/iu;

/** The bare name of a registered z9code tool however a provider prefixed it, else undefined. */
export const resolveT3ToolName = (name: string, toolNames: ReadonlyArray<string>) => {
  const tool = resolveT3McpToolId(name) ?? name.replace(Z9_PREFIX, "");
  if (toolNames.includes(tool)) return tool;
  // OpenCode 2 prefixes tools with `z9code-<thread>_`, underscores and all: the longest name wins.
  if (!/^z9code-/iu.test(name)) return undefined;
  return toolNames
    .filter((candidate) => name.endsWith(`_${candidate}`))
    .toSorted((a, b) => b.length - a.length)[0];
};

/** The stored subject, or undefined when the value names no z9code tool, `z9` command, or `general`. */
export const resolveFeedbackSubject = (value: string, toolNames: ReadonlyArray<string>) => {
  const subject = value.trim();
  if (subject === "general" || Z9_CLI_COMMANDS.includes(subject)) return subject;
  return resolveT3ToolName(subject, toolNames);
};
