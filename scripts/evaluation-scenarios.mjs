const simpleQuestions = [
  ["6 multiplied by 7", "42"],
  ["9 plus 14", "23"],
  ["81 divided by 9", "9"],
  ["the square of 12", "144"],
  ["100 minus 37", "63"],
  ["11 multiplied by 8", "88"],
  ["the next integer after 199", "200"],
  ["half of 84", "42"],
  ["7 squared", "49"],
  ["15 plus 16", "31"],
];

const focusedPrompts = [
  "Fix sum.js so the existing test passes. Run the test and report the result concisely.",
  "Repair only the arithmetic bug in sum.js and verify it with the existing test.",
  "Find why npm test fails, make the smallest correct change, and rerun it.",
  "Correct the sum implementation without changing the public API; run tests.",
  "Resolve the failing assertion by fixing production code, then verify.",
  "Make sum.js add its two inputs and confirm the current test succeeds.",
  "Debug this tiny package, patch the implementation, and run npm test.",
  "Apply a focused fix for the broken sum function and report test status.",
  "Fix the implementation defect in sum.js; do not weaken the test.",
  "Restore correct addition behavior and verify using the repository test.",
];

const multiStepPrompts = [
  "Audit this tiny project, fix the sum implementation, add a negative-number assertion, run all tests, and summarize exactly what changed.",
  "Fix sum.js, extend coverage with negative inputs, execute tests, and give a precise summary.",
  "Review the package, repair addition, add a negative-number test case, and verify everything.",
  "Diagnose the failure, implement the fix, strengthen tests for negatives, then run the suite.",
  "Correct the arithmetic bug and add regression coverage for adding negative values; test and summarize.",
  "Improve this project by fixing sum, testing a negative operand, and running all checks.",
  "Patch the faulty function, add meaningful negative-number coverage, verify, and report changes.",
  "Perform a small quality pass: fix addition, cover negatives, run tests, and summarize.",
  "Repair behavior and add a regression assertion involving a negative integer before testing.",
  "Make the implementation correct, extend the test for negative numbers, run it, and explain the result.",
];

export const BUILTIN_SCENARIOS = [
  ...simpleQuestions.map(([question, answer], index) => ({
    id: `simple-${index + 1}`,
    profile: index < 3 ? "smoke" : "full",
    prompt: `Answer with only the number: what is ${question}?`,
    verify: { stdoutRegex: `\\b${answer}\\b` },
  })),
  ...focusedPrompts.map((prompt, index) => ({
    id: `focused-fix-${index + 1}`,
    profile: index === 0 ? "smoke" : "full",
    fixture: "sum",
    prompt,
    verify: { command: [process.execPath, "sum.test.js"] },
  })),
  ...multiStepPrompts.map((prompt, index) => ({
    id: `multi-step-${index + 1}`,
    profile: index === 0 ? "smoke" : "full",
    fixture: "sum",
    prompt,
    verify: {
      command: [process.execPath, "sum.test.js"],
      fileRegex: { path: "sum.test.js", pattern: "-\\d" },
    },
  })),
];

export function scenariosForProfile(profile) {
  return profile === "full"
    ? BUILTIN_SCENARIOS
    : BUILTIN_SCENARIOS.filter((scenario) => scenario.profile === "smoke");
}
