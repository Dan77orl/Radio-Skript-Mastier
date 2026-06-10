---
name: Exact-script vs style-example prompts
description: Why program "template mode" must be an explicit per-program-type flag, not structural auto-detection of [Name]: lines.
---

A program-type prompt can contain `[Name]:` speaker lines for two OPPOSITE intents
that are indistinguishable by structure:
- **Exact script** (e.g. weather): reproduce the lines verbatim, only swap live data.
- **Style example** (e.g. "Психофф"): the lines are a sample of tone/format; AI must
  generate NEW content each run.

**Rule:** "reproduce verbatim" template mode is gated ONLY on the explicit
`programTypes.promptIsExactScript` boolean flag (user toggle in show settings),
never on auto-detecting `[Name]:` lines.

**Why:** an earlier heuristic (2+ `[Name]:` lines ⇒ template mode) silently froze
"Психофф" — its defaultPrompt embeds a full sample dialog, so it cloned the same
script every generation and lost all variety mechanisms.

**How to apply:** when `promptIsExactScript` is true, the generate + auto-create paths
skip durationStrict, Firecrawl research, reference-format/title-dedup/narrative/topic
injection, and enforceMaxWords, and append scriptTemplateGuard. Default is false so
shows stay varied unless the user opts in. Do NOT reintroduce structural detection.
