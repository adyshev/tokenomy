import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspace = mkdtempSync(join(tmpdir(), "tokenomy-package-smoke-"));
const npmEnvironment = {
  ...process.env,
  npm_config_cache: join(workspace, ".npm-cache"),
};
const packed = spawnSync("npm", ["pack", "--pack-destination", workspace], {
  cwd: root,
  encoding: "utf8",
  env: npmEnvironment,
});
if (packed.status !== 0) {
  process.stderr.write(packed.stderr);
  process.exit(packed.status ?? 1);
}

const archive = readdirSync(workspace).find((name) => name.endsWith(".tgz"));
if (!archive) throw new Error("npm pack did not create an archive");
writeFileSync(
  join(workspace, "package.json"),
  '{"name":"tokenomy-package-smoke","private":true}\n',
);
const installed = spawnSync(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(workspace, archive),
  ],
  { cwd: workspace, encoding: "utf8", env: npmEnvironment },
);
if (installed.status !== 0) {
  process.stderr.write(installed.stderr);
  process.exit(installed.status ?? 1);
}

const packageRoot = join(workspace, "node_modules/tokenomy-pi");
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
const required = [
  ".pi/extensions/tokenomy/index.ts",
  ".pi/extensions/tokenomy/lib/storage.ts",
  ".pi/extensions/tokenomy/lib/config.ts",
  ".pi/extensions/tokenomy/lib/models.ts",
  ".pi/tokenomy.json",
  ".pi/tokenomy.schema.json",
  "EVALUATION.md",
  "scripts/live-evaluation.mjs",
  "scripts/economic-evaluation.mjs",
];
for (const path of required) {
  if (!existsSync(join(packageRoot, path))) {
    throw new Error(`packed install is missing ${path}`);
  }
}
if (
  manifest.pi?.extensions?.[0] !== ".pi/extensions/tokenomy/index.ts"
) {
  throw new Error("packed manifest does not expose the Tokenomy Pi extension");
}
console.log(
  `packed install ok: tokenomy-pi@${manifest.version} (${required.length} required files)`,
);
