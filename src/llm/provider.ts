import { createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

export const LLM_PROVIDER_ID = "llm";

type LlmApi = "anthropic-messages" | "openai-completions" | "openai-responses";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example`);
  return value;
}

function getLlmApi(): LlmApi {
  const raw = process.env.LLM_API_FORMAT ?? "anthropic";
  if (raw === "anthropic") return "anthropic-messages";
  if (raw === "openai") return "openai-completions";
  if (raw === "openai-responses") return "openai-responses";
  throw new Error(`LLM_API_FORMAT must be "anthropic", "openai", or "openai-responses", got "${raw}"`);
}

function apiImplementation(api: LlmApi) {
  if (api === "anthropic-messages") return anthropicMessagesApi();
  if (api === "openai-completions") return openAICompletionsApi();
  return openAIResponsesApi();
}

export function getLlmModel(): Model<LlmApi> {
  const baseUrl = requireEnv("LLM_BASE_URL");
  const modelId = requireEnv("LLM_MODEL");
  const api = getLlmApi();

  return {
    id: modelId,
    name: modelId,
    api,
    provider: LLM_PROVIDER_ID,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
  };
}

/** For direct pi-ai Models usage (see scripts/check-llm.ts). */
export function setupModels() {
  const model = getLlmModel();

  const provider = createProvider({
    id: LLM_PROVIDER_ID,
    name: "LLM",
    baseUrl: model.baseUrl,
    auth: { apiKey: envApiKeyAuth("LLM API key", ["LLM_API_KEY"]) },
    models: [model],
    api: apiImplementation(model.api),
  });

  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}

/** For pi-agent-core's Agent, whose default streamFn resolves auth via getApiKey. */
export async function getLlmApiKey(): Promise<string> {
  return requireEnv("LLM_API_KEY");
}
