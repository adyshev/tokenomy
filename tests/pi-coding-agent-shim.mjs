import { join } from "node:path";
import { tmpdir } from "node:os";

export const CONFIG_DIR_NAME = ".pi";

export function getAgentDir() {
  return join(tmpdir(), "tokenomy-test-agent");
}
