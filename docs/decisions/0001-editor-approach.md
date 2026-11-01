# 0001 Lyric editor approach (PROVISIONAL)

**Recommendation:** a structured line-based editor (one input per lyric line, stable line IDs), not a rich-text document (TipTap/Lexical).

**Why:** locking, per-line comments, per-line audio timing, and reliable phone typing all key off stable line identity. Rich-text editors make those harder.

**Not yet verified:** the plan asks for a prototype test on a real phone. That could not be done in the Phase 0 build environment (a Linux container with no phone). **Owner/Phase 1 action:** test line-based input on your Android phone at the start of Phase 1 and revisit if typing, selection or the keyboard misbehave.
