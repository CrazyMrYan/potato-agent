import type { PiAdapterOptions } from "./PiAdapter.js";

export type ModelConfigInput = {
  provider?: string;
  model?: string;
  apiKey?: string;
  workspacePath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

const providerApiKeyEnvNames: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY"
};

export function resolvePiAdapterOptions(input: ModelConfigInput): PiAdapterOptions {
  const workspacePath = input.workspacePath ?? process.cwd();

  if (!input.provider) {
    throw new Error("必须提供 --provider，例如 --provider deepseek。");
  }

  if (!input.model) {
    throw new Error("必须提供 --model，例如 --model deepseek-chat。");
  }

  const apiKeyConfig = resolveApiKeyConfig(input.provider, input.apiKey, input.env ?? process.env);

  return {
    provider: input.provider,
    model: input.model,
    workspacePath,
    apiKeyEnvName: apiKeyConfig.envName,
    apiKey: apiKeyConfig.apiKey,
    timeoutMs: input.timeoutMs
  };
}

function resolveApiKeyConfig(
  provider: string,
  runtimeApiKey: string | undefined,
  env: NodeJS.ProcessEnv
): { envName: string; apiKey: string } {
  const envName = providerApiKeyEnvNames[provider.toLowerCase()];

  if (!envName) {
    throw new Error(`暂不支持 provider：${provider}。当前支持 openai、anthropic、google/gemini、deepseek、mistral。`);
  }

  const apiKey = runtimeApiKey ?? env[envName];
  if (!apiKey) {
    throw new Error(`使用 --provider ${provider} 时必须提供 ${envName}，或通过 --api-key 传入。`);
  }

  return { envName, apiKey };
}
