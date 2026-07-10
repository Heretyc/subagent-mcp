import {
  renameSync,
  unlinkSync,
  writeFileSync,
  type WriteFileOptions,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export function atomicWriteFile(path: string, data: string, options: WriteFileOptions): void {
  const dir = dirname(path);
  const tmp = join(
    dir,
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    writeFileSync(tmp, data, options);
    try {
      renameSync(tmp, path);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST" && code !== "EPERM") throw e;
      unlinkSync(path);
      renameSync(tmp, path);
    }
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup only; preserve the original write/rename error.
    }
    throw e;
  }
}

export function atomicWriteJson(path: string, value: unknown, options: WriteFileOptions): void {
  atomicWriteFile(path, JSON.stringify(value), options);
}
