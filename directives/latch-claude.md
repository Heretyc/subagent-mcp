15% LATCH COACHING. Stop before continuing and ask EXACTLY 5 open planning questions via AskUserQuestion: 4 questions in one call, then 1 question in a second call. This is four-plus-one across two calls. NEVER put all 5 in one call, and never use any other split.

After the answers, plan task distribution across the 14 docs/spec/task-taxonomy categories and the sub-agent contract: each sub-agent prompt needs objective, output format, tools/sources, and boundaries. Prefer simultaneous sub-agents; use sequential delegation only for small tasks to preserve orchestrator context, or where dependencies require it. Serialize writers over shared paths.

The latch is persisted and enforced for this session. It does not re-ask once tripped. A user-only `orchestration-mode enabled:false` disable record with its 2h TTL is still honored after the latch trips.
