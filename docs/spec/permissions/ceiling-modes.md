# Permission Ceiling Modes And Engine

## One-screen summary

`permissionsCeiling` selects a machine-wide posture for launched sub-agents:
`yolo` bypasses gating, `auto` is the default engine-gated mode, and `manual`
parks every non-denied action for approval. The shared `verdict(op, rules)`
function classifies operations as SAFE, DANGER, or NEUTRAL and applies rules
with deny over ask over allow.

## Load when

- Touching `permissionsCeiling`, `applyPermissionCeiling`, or ceiling parsing.
- Touching `verdict()`, `permission-classes.json`, path scoping, irreversible
  detection, or permission-rule matching.

## Do not load when

- Only changing pending-permission lifecycle, config-source precedence, or child
  lockout. Use `config-and-lifecycle.md`.
- Only assessing accepted residual risks. Use `threat-model.md`.

## 1. Ceiling modes

`permissionsCeiling` is a machine-wide posture from
`global-subagent-mcp-config.jsonc` (see `config-and-lifecycle.md` section 6).
Read fresh per `launch_agent` and snapshotted into the agent at launch (before
the first `await`), never re-read.

| Mode | Effect (truthful) |
|---|---|
| `yolo` | No gating. Claude: `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`; Codex: `approvalPolicy: 'never'` + `sandbox: 'danger-full-access'`. Byte-identical to pre-2.12.5. The engine is **not** consulted, including for the config file itself (see `threat-model.md` divergence). |
| `auto` | **Default.** Engine gates: SAFE to allow, DANGER to deny, NEUTRAL residue to ask (parks). `min(ceiling, vote)` with `auto` = `allow` cap, so the vote passes through unchanged. |
| `manual` | Same engine, ceiling caps every vote at `ask`: `min(ask, vote)`. SAFE that would `allow` becomes `ask`; DANGER stays `deny`. Every non-denied action parks for an answer. |

Value resolution (`concurrency.ts:parsePermissionsCeilingConfig`): absent file or
key to `auto`; invalid/corrupt value to fail-closed to `manual`; whole-file parse
failure to `manual`.

## 2. Shared engine

One pure function, `verdict(op, rules)` (`src/permission-engine.ts`), called by
**both** the Claude `canUseTool` callback and the Codex approval handler: one
implementation, no second copy.

- **Verdict** `allow | deny | ask`; **classification** `safe | danger | neutral`
  from `src/permission-classes.json`.
- **Order inside `verdict()`**: DANGER to `deny` immediately (before any rule: no
  `allow[]` from any source downgrades a DANGER match). Else merged ruleset with
  precedence **deny > ask > allow**. Else SAFE to `allow`. Else NEUTRAL residue
  to `ask` (never silently allowed).
- **Ceiling** (`applyPermissionCeiling`): `yolo` to `allow`;
  `manual` to `min(vote,ask)`; `auto` to `min(vote,allow)`. Rank
  `deny(0) < ask(1) < allow(2)`.

**Classes** (`permission-classes.json`):

- **SAFE**: tools `Read/Glob/Grep/LS`; bash prefixes `ls cat pwd echo git status
  git diff git log` (word-boundary: `ls:*` is not `lsof`); WebFetch
  preapproved hosts.
- **DANGER** (auto-denied under `manual`/`auto`): `rm -rf`/`--force`;
  `git push --force*`; `curl|sh`/`wget|sh`; `sudo`; `chmod 777`;
  `npm/pnpm/yarn publish`; disk-format; writes touching
  `.git .ssh .aws .claude .codex .vscode`; writes to
  `global-subagent-mcp-config.jsonc` or legacy `global-concurrency.jsonc`.
- **NEUTRAL**: everything else: rule match, else `ask`.

**Read scoping** (`Read/Glob/Grep/LS`, `isReadPathOutsideAllowedRoots`):
auto-SAFE only for non-protected paths inside `cwd` + approved
`additionalDirectories` (`op.additionalDirectories` feeds containment); a
`dangerousPathSegments`/`protectedFilenames` hit is DANGER (deny), else an
outside-root read is NEUTRAL (`ask`).

**`irreversible` flag**: a DANGER subset (force-push, `git reset --hard`/
`rebase`/`filter-branch`, `DROP`/`TRUNCATE ... TABLE`, publish,
`aws/gcloud/az ... delete`). It does not change the verdict. For NEUTRAL residue
that parks under `auto`, the pending record carries `irreversible` and may set
`escalate_to_human` per the `escalation` config key. DANGER remains denied
before any pending record.

**Rule syntax** (Claude `PermissionRule`, verbatim; `parsePermissionRule` +
`matchesRule`): `Tool` / `Tool()` / `Tool(*)` / `*`-tool match anything of that
tool. Bash: `Bash(prefix:*)` word-boundary; `*` to `[\s\S]*`; compound commands
(`&& ; || |`) excluded from a single-segment allow; `allow` strips only
`SAFE_ENV_VARS` (`NODE_ENV GOOS LANG`), deny/ask strips **all** env prefixes;
over `MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50` to `ask`. Paths matched against
`op.paths` **and** `op.resolvedPaths` (symlink parity; engine does no I/O).
WebFetch `WebFetch(domain:host)` subdomain-suffix match. MCP `server__tool`
split on `__`.
