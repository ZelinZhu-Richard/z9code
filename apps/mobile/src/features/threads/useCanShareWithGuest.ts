import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@z9code/contracts";

import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { canShareWithGuest } from "./guestShareAvailability";

/**
 * Whether this environment offers "Share with guest": the user may create links there, and its
 * Guest links beta is on (Settings > Labs). The server refuses links while the beta is off.
 * Guests are remote clients, so a policy that turns those off hides sharing too.
 */
export function useCanShareWithGuest(environmentId: EnvironmentId | null): boolean {
  const permitted = useAtomValue(serverEnvironment.createGuestShare.permissionAtom(environmentId));
  return useAtomValue(environmentServerConfigsAtom, (configs) =>
    canShareWithGuest(permitted, environmentId === null ? undefined : configs.get(environmentId)),
  );
}
