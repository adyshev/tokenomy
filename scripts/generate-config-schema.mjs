import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOKENOMY_CONFIG_SCHEMA } from "../.pi/extensions/tokenomy/lib/config-schema.ts";

const output = resolve(import.meta.dirname, "../.pi/tokenomy.schema.json");
const generated = `${JSON.stringify(TOKENOMY_CONFIG_SCHEMA, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) {
    console.error(`${output} is stale; run npm run schema:generate`);
    process.exit(1);
  }
  console.log(`schema is current: ${output}`);
} else {
  writeFileSync(output, generated);
  console.log(`generated ${output}`);
}
