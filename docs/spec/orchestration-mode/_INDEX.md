# Orchestration-Mode Spec Index

DELETED — do not reintroduce.

Superseded: this file described a marker-presence ON/OFF model
("presence = enabled", "default OFF = no marker") that
`src/orchestration/marker.ts` no longer implements. Orchestration is default
ON; OFF is a time-bounded, session-keyed disable-record only (see the
`marker.ts` module doc comment + `isActive()`). Cwd-keyed disables are deleted;
anonymous/keyless owners can use only a one-time conversational opt-out. Absence
of a marker is NOT OFF.

Live spec:
`docs/spec/dev-loop/orchestration-directive-architecture/sections-10-13.md` §10.
