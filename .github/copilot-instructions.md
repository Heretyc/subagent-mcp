# Copilot Repository Instructions

Read `AGENTS.md` first. It contains the root operating invariants for this
repository.

For Git/GitHub work, follow:

- `docs/spec/dev-loop/git-collaboration.md`
- `docs/spec/dev-loop/claude-routines-cicd.md`
- `docs/spec/safety-scope.md`
- `agents/GIT_COLLABORATION.md`

Claude Code Routines are the canonical CI/CD path. GitHub Actions in this repo
only bridge to Claude routine CI/CD.

Before proposing a PR, run local checks that mirror the Claude routine contract:

```bash
python - <<'PY'
import json
from pathlib import Path
for p in Path('.').rglob('*'):
    if p.is_file() and (p.suffix in {'.md', '.rag'} or p.name in {'AGENTS.md','CLAUDE.md','GEMINI.md'}):
        assert len(p.read_text(encoding='utf-8', errors='replace').splitlines()) <= 200, p
for p in Path('.').rglob('*.json'):
    json.loads(p.read_text(encoding='utf-8'))
PY
git diff --check
git status --short --branch
```

Keep changes scoped, preserve user work, and do not add AI attribution or
co-author lines.
