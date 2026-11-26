import { AcpRegistryDriver, type AcpRegistryDriverEnv } from "@z9code/provider-acp-registry/server";
import { ClaudeDriver, type ClaudeDriverEnv } from "./Drivers/ClaudeDriver.ts";
import { CodexDriver, type CodexDriverEnv } from "./Drivers/CodexDriver.ts";
import { CursorDriver, type CursorDriverEnv } from "@z9code/provider-cursor/server";
import { FxDriver, type FxDriverEnv } from "@z9code/provider-fx/server";
import { GrokDriver, type GrokDriverEnv } from "@z9code/provider-grok/server";
import { OpenCodeDriver, type OpenCodeDriverEnv } from "@z9code/provider-opencode/server";
import { MuseDriver, type MuseDriverEnv } from "@z9code/provider-muse/server";
import { PiDriver, type PiDriverEnv } from "@z9code/provider-pi/server";
import type {
  AnyProviderDriver,
  ProviderUsageReaderEnv,
} from "@z9code/provider-core/server/driver";
import { KiroDriver, type KiroDriverEnv } from "@z9code/provider-kiro/server";

export type BuiltInDriversEnv =
  | AcpRegistryDriverEnv
  | ClaudeDriverEnv
  | CodexDriverEnv
  | CursorDriverEnv
  | FxDriverEnv
  | GrokDriverEnv
  | KiroDriverEnv
  | OpenCodeDriverEnv
  | PiDriverEnv
  | MuseDriverEnv;

export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  CodexDriver,
  ClaudeDriver,
  CursorDriver,
  GrokDriver,
  FxDriver,
  OpenCodeDriver,
  KiroDriver,
  PiDriver,
  MuseDriver,
  AcpRegistryDriver,
];

export type BuiltInUsageReadersEnv =
  | ProviderUsageReaderEnv<typeof ClaudeDriver>
  | ProviderUsageReaderEnv<typeof CodexDriver>
  | ProviderUsageReaderEnv<typeof GrokDriver>
  | ProviderUsageReaderEnv<typeof OpenCodeDriver>
  | ProviderUsageReaderEnv<typeof CursorDriver>
  | ProviderUsageReaderEnv<typeof PiDriver>
  | ProviderUsageReaderEnv<typeof MuseDriver>;

/** Order matters: aggregation keeps the first duplicate record. */
export const BUILT_IN_USAGE_DRIVERS: ReadonlyArray<
  AnyProviderDriver<BuiltInDriversEnv, BuiltInUsageReadersEnv>
> = [ClaudeDriver, CodexDriver, GrokDriver, PiDriver, OpenCodeDriver, MuseDriver, CursorDriver];
