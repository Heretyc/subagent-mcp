15% LATCH COACHING. Stop before continuing and ask AT LEAST 4 open planning questions using the structured question tool, or natural prose if not available.

Turn the answers into a GOAL CONTEXT for this session before any further work: a concrete goal, a measurable done-condition, and the next concrete action; never a vague "continue working". Keep that goal written down - it is the context a later handoff hands to the next session, and `handoff-write` unlocks from 20% context utilization.

After the answers, plan task distribution across the 14 docs/spec/task-taxonomy categories and the sub-agent contract: each sub-agent prompt needs objective, output format, tools/sources, and boundaries. Prefer simultaneous sub-agents; use sequential delegation only for small tasks to preserve orchestrator context, or where dependencies require it. Serialize writers over shared paths.

The latch is persisted and enforced for this session. It does not re-ask once tripped. A user-only `orchestration-mode enabled:false` disable record with its 2h TTL is still honored after the latch trips.
