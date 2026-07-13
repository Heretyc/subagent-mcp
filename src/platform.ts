import { join, posix } from "path";

export type SupportedProvider = "claude" | "codex";

export interface ResolveDeps {
  existsSync(p: string): boolean;
  npmPrefix(): string;
  arch?(): NodeJS.Architecture;
}

/**
 * Pure, dependency-injected exe resolver — enables unit testing with mocked
 * platform and filesystem without spawning real processes.
 *
 * win32:   Resolves the real .exe under the npm global prefix (PowerShell/.cmd
 *          shims cannot be spawned directly). Falls back to bare name if the
 *          expected path does not exist.
 *
 * darwin / linux:  The npm global bin directory contains a real symlink that
 *          re-execs the correct vendor binary, so the bare name works fine when
 *          the shell's PATH is set up normally. For minimal-PATH environments
 *          (non-login shells, some MCP host launchers) we probe candidate
 *          absolute paths in order and return the first that exists. If none
 *          exist we return the bare name so PATH is the final arbiter.
 */
export function resolveExeFor(
  provider: SupportedProvider,
  platform: NodeJS.Platform,
  deps: ResolveDeps
): string {
  if (platform === "win32") {
    const prefix = deps.npmPrefix();
    if (provider === "claude") {
      const exe = join(
        prefix,
        "node_modules",
        "@anthropic-ai",
        "claude-code",
        "bin",
        "claude.exe"
      );
      if (deps.existsSync(exe)) return exe;
    } else {
      const arch = deps.arch?.() ?? process.arch;
      const codexWin32 =
        arch === "arm64"
          ? { packageName: "codex-win32-arm64", vendorTriple: "aarch64-pc-windows-msvc" }
          : { packageName: "codex-win32-x64", vendorTriple: "x86_64-pc-windows-msvc" };
      const exe = join(
        prefix,
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        codexWin32.packageName,
        "vendor",
        codexWin32.vendorTriple,
        "bin",
        "codex.exe"
      );
      if (deps.existsSync(exe)) return exe;
    }
    // Fall back to bare name — PATH resolver
    return provider;
  }

  // darwin / linux: prefer bare name on PATH, but check known absolute
  // candidate locations for non-login shell environments.
  // Use posix.join for path construction so that unix-style prefixes produce
  // forward-slash paths even when this module is built on Windows.
  const prefix = deps.npmPrefix();

  let candidates: string[];
  if (provider === "claude") {
    candidates = [
      posix.join(prefix, "bin", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ];
  } else {
    candidates = [
      posix.join(prefix, "bin", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ];
  }

  for (const candidate of candidates) {
    if (deps.existsSync(candidate)) return candidate;
  }

  return provider; // bare name — last resort, relies on PATH
}
