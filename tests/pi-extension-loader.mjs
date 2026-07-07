import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let piPackageDir;

function findPiPackageDir() {
  if (piPackageDir) return piPackageDir;

  const candidates = [];
  if (process.env.PI_CODING_AGENT_PACKAGE_DIR) {
    candidates.push(process.env.PI_CODING_AGENT_PACKAGE_DIR);
  }
  candidates.push(
    join(homedir(), ".local/lib/node_modules/@earendil-works/pi-coding-agent"),
  );

  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (npmRoot) {
      candidates.push(join(npmRoot, "@earendil-works/pi-coding-agent"));
    }
  } catch {
    // npm is optional for these tests; the local Pi install path is checked first.
  }

  piPackageDir = candidates.find((candidate) =>
    existsSync(join(candidate, "package.json")),
  );
  if (!piPackageDir) {
    throw new Error(
      "Cannot find @earendil-works/pi-coding-agent. Set PI_CODING_AGENT_PACKAGE_DIR to the installed package path.",
    );
  }
  return piPackageDir;
}

export async function resolve(specifier, context, nextResolve) {
  const packageDir = findPiPackageDir();

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
