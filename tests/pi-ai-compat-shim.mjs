export async function complete() {
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
