# AGENTS Router

This file is intentionally thin. Use it to route into the part of the repository you are changing.

## First stop

- For Chrome extension work, read [`extension/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/extension/AGENTS.md).
- For automation and packaging scripts, read [`scripts/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/scripts/AGENTS.md).
- For smoke tests, read [`tests-js/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/tests-js/AGENTS.md).
- For static site or privacy-policy changes, read [`site/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/site/AGENTS.md).
- For store listing and publication docs, read [`docs/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/docs/AGENTS.md).

## Global rules

- Keep exports local-first. Do not add remote collection or telemetry.
- Treat exported conversation content as sensitive user data.
- Keep the extension export schema stable unless there is a clear migration path.
- Prefer deterministic file names and deterministic build outputs.
- Update the nearest scoped `AGENTS.md` when you add a new workflow or rule that future edits should follow.
