---
name: Factual accuracy / anti-hallucination guard
description: How generated scripts are kept from inventing geography, landmarks, and other verifiable facts
---

# Factual accuracy guard for script generation

Generated radio scripts must not invent verifiable facts (geography/compass
directions/distances relative to Alanya, landmark/beach/hotel names, dates,
prices, numbers). Such facts may only be asserted if present in the injected
web-research blocks or the station knowledge base; otherwise speak generally or
omit.

**Why:** users reported location programs hallucinating attractions and giving
wrong compass directions (e.g. saying "west" for a place east of Alanya).

**How to apply:**
- The rule lives as `factualAccuracy` in `PromptStrings` (server/prompt-locale.ts),
  RU + EN; TR inherits via the EN spread. Any new field added to `PromptStrings`
  must be implemented in RU + EN (TR/others fall back to EN via spread/default).
- It is injected only on NON-template, non-weather generation. Exact-script
  (`promptIsExactScript`) and weather paths use their own guards instead — keep
  those mutually exclusive to avoid conflicting instructions.
- Three generation paths each need the guard separately: auto-create, single
  `/api/programs/:id/generate`, and the batch endpoint (batch is hardcoded RU and
  uses `getPromptStrings("ru")`). The single generate endpoint also gained its
  own Firecrawl research call — it previously did none.
- Never re-introduce the old "if a fact is missing, tell it from the host's
  personal experience" phrasing in research/narrative prompts — that line was the
  direct license to fabricate.
