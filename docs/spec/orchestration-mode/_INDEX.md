# Orchestration-Mode Spec Index

DELETED : do not reintroduce.

Superseded: this file described a marker-presence ON/OFF model
("presence = enabled", "default OFF = no marker") that
`src/orchestration/marker.ts` and `hook-core.ts::computeEffectiveActive()` no
longer implement. Keyed hook sessions are default OFF; ON requires a
time-bounded session enable-record, an active 15% latch, or (after the turn-1
grace window) a metering-undetectable/null usage lift. An explicit session
disable-record wins over all three. Anonymous/keyless owners remain fail-safe
ON. Marker presence/absence does not determine ON/OFF.

Live spec:
`docs/spec/dev-loop/orchestration-directive-architecture/sections-10-13.md` section 10.
