export const CHATBOT_AI_OUTPUT_LIMITS = Object.freeze({
  min: 64,
  max: 2048,
  default: 2048,
  connectionTest: 32
});

export const CHATBOT_AI_TEMPERATURES = Object.freeze({
  existing: 0.7,
  grounded: 0.3
});

export function resolveChatTemperature(profile = 'existing') {
  if (!Object.prototype.hasOwnProperty.call(CHATBOT_AI_TEMPERATURES, profile)) {
    throw new TypeError(`Unsupported Chatbot AI temperature profile: ${profile}`);
  }
  return CHATBOT_AI_TEMPERATURES[profile];
}

export function normalizeMaxOutputTokens(value) {
  const candidate = value === undefined || value === ''
    ? CHATBOT_AI_OUTPUT_LIMITS.default
    : Number(value);

  if (
    !Number.isInteger(candidate)
    || candidate < CHATBOT_AI_OUTPUT_LIMITS.min
    || candidate > CHATBOT_AI_OUTPUT_LIMITS.max
  ) {
    const error = new RangeError(
      `max_output_tokens must be an integer between ${CHATBOT_AI_OUTPUT_LIMITS.min} and ${CHATBOT_AI_OUTPUT_LIMITS.max}.`
    );
    error.code = 'INVALID_MAX_OUTPUT_TOKENS';
    throw error;
  }

  return candidate;
}

export function validateMaxOutputTokens(value) {
  try {
    normalizeMaxOutputTokens(value);
    return null;
  } catch {
    return `max_output_tokens harus berupa bilangan bulat ${CHATBOT_AI_OUTPUT_LIMITS.min}–${CHATBOT_AI_OUTPUT_LIMITS.max}.`;
  }
}

export function buildChatCompletionPayload({
  model,
  messages,
  maxOutputTokens,
  temperature = CHATBOT_AI_TEMPERATURES.existing,
  requestKind = 'production'
}) {
  const maxTokens = requestKind === 'test'
    ? CHATBOT_AI_OUTPUT_LIMITS.connectionTest
    : normalizeMaxOutputTokens(maxOutputTokens);

  return {
    model: model || 'gpt-4o-mini',
    messages,
    max_tokens: maxTokens,
    temperature
  };
}
