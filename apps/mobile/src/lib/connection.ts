import { EnvironmentId } from "@z9code/contracts";
import { type EnvironmentConnectionPhase } from "@z9code/client-runtime/connection";

export interface SavedRemoteConnection {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly pairingUrl: string;
  readonly displayUrl: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly bearerToken: string | null;
  readonly authenticationMethod?: "bearer" | "dpop";
  readonly dpopAccessToken?: string;
}

export type RemoteClientConnectionState = EnvironmentConnectionPhase;
