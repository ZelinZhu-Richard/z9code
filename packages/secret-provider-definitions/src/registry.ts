import { makeSecretProviderDefinitionRegistry } from "@z9code/secret-provider-core/shared/definition";
import * as OnePassword from "@z9code/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
