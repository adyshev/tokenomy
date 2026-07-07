import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-coding-agent") {
    return {
      url: pathToFileURL(join(process.cwd(), "tests/pi-coding-agent-shim.mjs"))
        .href,
      shortCircuit: true,
    };
  }

  if (specifier === "@earendil-works/pi-ai/compat") {
    return {
      url: pathToFileURL(join(process.cwd(), "tests/pi-ai-compat-shim.mjs"))
        .href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
