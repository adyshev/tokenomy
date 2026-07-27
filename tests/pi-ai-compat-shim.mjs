export const completeCalls = [];

export async function complete(...args) {
  completeCalls.push(args);
  const response =
    process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE ??
    '{"tier":"simple","confidence":0.5,"reason":"default test"}';

  return {
    content: [
      {
        type: "text",
        text: response,
      },
    ],
    model: "gpt-5.4-mini",
    usage: {
      input: 320,
      output: 24,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 344,
      cost: {
        input: 0.001,
        output: 0.001,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.002,
      },
    },
  };
}
