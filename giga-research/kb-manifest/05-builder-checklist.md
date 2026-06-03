## 5. BUILDER CHECKLIST (every slot, before returning)
1. Each `.md` <=200 lines (count it). If over, split detail into a same-named subdir or tighten tables.
2. Cross-refs use relative paths that resolve. No absolute paths. No provenance-by-internal-file.
3. Owned facts only — do not restate a fact another leaf owns (see §1 OWNS column); reference instead.
4. One-screen summary at top of each leaf + "Load when" / "Do not load when" + dense lookup tables + short chunks.
5. Footer: `Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026` (author metadata, not a git co-author line).
6. Preserve `[SEED]`/`[INFERRED]`/`[ASSUMPTION]` labels where the source carried them.
7. Slot 5: run `validate_kb.py`; it must exit 0 before the slot is "done" (fail loud otherwise).
