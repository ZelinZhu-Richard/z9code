import { managedCapabilityDenial, type ServerConfig } from "@z9code/contracts";

export function canShareWithGuest(
  permitted: boolean,
  config:
    | {
        readonly settings: Pick<ServerConfig["settings"], "guestSharingEnabled">;
        readonly managedPolicy?: ServerConfig["managedPolicy"];
      }
    | undefined,
) {
  return (
    permitted &&
    config?.settings.guestSharingEnabled === true &&
    managedCapabilityDenial(config.managedPolicy, "remoteClients") === undefined
  );
}
