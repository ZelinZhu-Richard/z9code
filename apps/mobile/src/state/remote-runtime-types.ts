import { type EnvironmentConnectionPhase } from "@z9code/client-runtime/connection";
import type { MarkedText } from "@z9code/client-runtime/errors";
import { EnvironmentId, ThreadId, type ServerConfig } from "@z9code/contracts";

export interface EnvironmentRuntimeState {
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly i18nConnectionError?: MarkedText;
  readonly connectionErrorTraceId: string | null;
  readonly serverConfig: ServerConfig | null;
}

export interface ConnectedEnvironmentSummary {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly displayUrl: string;
  readonly isEnabled: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly i18nConnectionError?: MarkedText;
  readonly connectionErrorTraceId: string | null;
}

export interface SelectedThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}
