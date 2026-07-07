export function buildPiProcessEnv(apiKeyEnvName: string, apiKey: string): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    [apiKeyEnvName]: apiKey
  };
}
