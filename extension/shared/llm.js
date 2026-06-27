/**
 * LLM providers for prjcap AI assistant.
 * Supports OpenRouter and Z-AI via OpenAI-compatible chat completions API.
 */

const LLM_PROVIDERS = {
  'openrouter': {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.0-flash-001',
    models: [
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
      { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
      { id: 'google/gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite' },
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash (free)' },
      { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B IT' },
      { id: 'microsoft/phi-4', name: 'Phi-4' },
      { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 405B (free)' },
    ],
  },
  'z-ai': {
    name: 'Z-AI',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'GLM-4.7-Flash',
    models: [
      { id: 'GLM-4.7-Flash', name: 'GLM-4.7-Flash' },
      { id: 'GLM-4.7', name: 'GLM-4.7' },
      { id: 'GLM-5.1-Turbo', name: 'GLM-5.1-Turbo' },
    ],
  },
};

/** @typedef {{ provider: string, providers: { [key: string]: { apiKey: string, model: string, customModel: string } } }} LlmSettings */

const DEFAULT_LLM_SETTINGS = {
  provider: 'z-ai',
  providers: {
    'z-ai': { apiKey: '', model: 'GLM-4.7-Flash', customModel: '' },
    'openrouter': { apiKey: '', model: 'google/gemini-2.0-flash-001', customModel: '' },
  },
};

/**
 * Send a chat completion request to the configured LLM provider.
 * @param {LlmSettings} settings
 * @param {{ systemPrompt: string, userMessage: string }} payload
 * @returns {Promise<string>} Assistant response text
 */
export async function chatCompletion(settings, { systemPrompt, userMessage }) {
  const providerKey = settings.provider || 'z-ai';
  const provider = LLM_PROVIDERS[providerKey];
  if (!provider) throw new Error(`Неизвестный провайдер: ${providerKey}`);

  const providerSettings = settings.providers?.[providerKey] || {};
  const apiKey = providerSettings.apiKey || providerSettings.customModel && '' || '';
  if (!apiKey) throw new Error(`API ключ для ${provider.name} не указан. Настройте в popup расширения.`);

  const model = providerSettings.customModel
    || providerSettings.model
    || provider.defaultModel;

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userMessage });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  // OpenRouter requires HTTP-Referer and X-Title
  if (providerKey === 'openrouter') {
    headers['HTTP-Referer'] = 'chrome-extension://prjcap';
    headers['X-Title'] = 'prjcap Extension';
  }

  const url = `${provider.baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 10000,
    }),
    signal: AbortSignal.timeout(300000), // 5 min
  });

  if (response.aborted) {
    throw new Error(`Превышен таймаут ожидания ответа от ${provider.name} (5 мин).`);
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Не удалось прочитать ответ');
    throw new Error(`${provider.name} API ошибка (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
}

/** Get the active model ID from settings */
export function getActiveModelId(settings) {
  const providerKey = settings.provider || 'z-ai';
  const ps = settings.providers?.[providerKey] || {};
  return ps.customModel || ps.model || LLM_PROVIDERS[providerKey]?.defaultModel || '';
}

export { LLM_PROVIDERS, DEFAULT_LLM_SETTINGS };
