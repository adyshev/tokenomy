import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 200;

function pause(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    chmodSync(path, PRIVATE_DIR_MODE);
  } catch {
    // chmod is best-effort on platforms without POSIX permission bits.
  }
}

function withFileLock<T>(path: string, operation: () => T): T {
  const lockPath = `${path}.lock`;
  ensurePrivateDir(dirname(path));
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: PRIVATE_DIR_MODE });
      try {
        return operation();
      } finally {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      pause(Math.min(5 + attempt, 50));
    }
  }
  throw new Error(`timed out waiting for storage lock: ${basename(path)}`);
}

function writeJsonUnlocked(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
    });
    renameSync(temporaryPath, path);
    try {
      chmodSync(path, PRIVATE_FILE_MODE);
    } catch {
      // Best-effort on Windows and non-POSIX filesystems.
    }
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function loadJsonFile(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function atomicWriteJsonFile(path: string, value: unknown): void {
  withFileLock(path, () => writeJsonUnlocked(path, value));
}

export function updateJsonFile<T>(
  path: string,
  fallback: T,
  update: (current: unknown) => T,
): T {
  return withFileLock(path, () => {
    let current: unknown = fallback;
    if (existsSync(path)) {
      try {
        current = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        current = fallback;
      }
    }
    const next = update(current);
    writeJsonUnlocked(path, next);
    return next;
  });
}

export function appendPrivateTextFile(path: string, text: string): void {
  withFileLock(path, () => {
    appendFileSync(path, text, {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
    });
    try {
      chmodSync(path, PRIVATE_FILE_MODE);
    } catch {
      // Best-effort on Windows and non-POSIX filesystems.
    }
  });
}

export function purgeFiles(
  directory: string,
  predicate: (name: string) => boolean = () => true,
): number {
  if (!existsSync(directory)) return 0;
  let removed = 0;
  for (const name of readdirSync(directory)) {
    if (!predicate(name)) continue;
    const path = join(directory, name);
    try {
      if (!statSync(path).isFile()) continue;
      unlinkSync(path);
      removed += 1;
    } catch {
      // A concurrently removed or inaccessible trace is safe to skip.
    }
  }
  return removed;
}

export function purgeExpiredFiles(
  directory: string,
  maxAgeMs: number,
  predicate: (name: string) => boolean = () => true,
): number {
  if (!existsSync(directory) || maxAgeMs <= 0) return 0;
  const cutoff = Date.now() - maxAgeMs;
  return purgeFiles(directory, (name) => {
    if (!predicate(name)) return false;
    try {
      return statSync(join(directory, name)).mtimeMs < cutoff;
    } catch {
      return false;
    }
  });
}

export function storageHealth(directory: string): {
  ok: boolean;
  detail: string;
} {
  try {
    ensurePrivateDir(directory);
    const probe = join(directory, `.tokenomy-write-probe-${process.pid}`);
    writeFileSync(probe, "", { mode: PRIVATE_FILE_MODE });
    unlinkSync(probe);
    return { ok: true, detail: `writable: ${directory}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function removePrivatePath(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function privatePathInfo(path: string): {
  path: string;
  exists: boolean;
  bytes: number;
  updatedAt?: string;
} {
  try {
    const stat = statSync(path);
    const bytes = stat.isDirectory()
      ? readdirSync(path).reduce(
          (total, name) => total + privatePathInfo(join(path, name)).bytes,
          0,
        )
      : stat.size;
    return {
      path,
      exists: true,
      bytes,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { path, exists: false, bytes: 0 };
  }
}
