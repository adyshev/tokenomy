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
  };
}
