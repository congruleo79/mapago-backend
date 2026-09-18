# MapAgo backend repository instructions

## Commands

- Install dependencies with `npm install`.
- Run the Worker locally with `npm run dev`.
- Type-check Worker code with `npm run typecheck`.
- Apply D1 migrations with `npm run db:migrate:local` for local development or `npm run db:migrate:remote` for the configured remote database.
- Deploy with `npm run deploy`.
- Regenerate `worker-configuration.d.ts` with `npx wrangler types` after changing bindings or relevant Wrangler configuration. This file is generated; do not edit it manually.

Location curation is validated one date at a time:

- Summarize Wikimedia candidates: `npm run ai:events -- --date YYYY-MM-DD`. If the candidate file is missing, this command generates it first.
- Fetch candidates directly, optionally with Wikidata enrichment: `npm run ai:events:fetch -- --date YYYY-MM-DD [--enrich-wikidata]`.
- Inspect selected zero-based candidate indices: `npm run ai:candidates:get -- --date YYYY-MM-DD --indices 1,4,7`.
- Validate one curated file: `npm run ai:validate:locations -- --date YYYY-MM-DD`.
- Seed dated files through the admin API: `npm run seed:locations -- --date YYYY-MM-DD`; it reads `ADMIN_SEED_TOKEN` from the environment or `.env`.

## Architecture

- This is a module-style Cloudflare Worker. `src/index.ts` is intentionally the single HTTP entry point and contains route dispatch, authentication, domain operations, D1 queries, validation, serialization, and HTTP error conversion.
- `wrangler.jsonc` binds the D1 database as `env.DB`; `worker-configuration.d.ts` supplies generated Worker and binding types. The admin seed token is a Wrangler secret named `ADMIN_SEED_TOKEN`, not a value stored in configuration.
- `migrations/` is the source of truth for the SQLite/D1 schema. Core relationships are: users own sessions and plays; each date has one game; each game has exactly five ordered locations; each user has at most one play per game; each play has at most one guess per location.
- Public API identifiers use prefixed random IDs (`usr_`, `ses_`, `gam_`, `loc_`, `ply_`, `gus_`, `fol_`). Database integer IDs are internal join keys and must not be exposed in new response shapes.
- The operational content pipeline is separate from request handling: Wikimedia data is fetched into `locations/candidates/YYYY-MM-DD.json`, curators produce `locations/YYYY-MM-DD.json`, validation enforces the file contract, and `scripts/seed-locations.ts` converts that contract to the admin seed API payload.
- `.github/skills/select-locations/SKILL.md` defines the curation workflow and content policy. Follow it for location-selection tasks, especially its instruction not to inspect previous curated files unless explicitly requested.

## API and domain conventions

- Add routes in the ordered method/path checks inside `fetch`. Normalize paths with `trimTrailingSlash`, authenticate before reading protected data, return JSON through `json`, and wrap every response with `withCors`.
- Expected failures use `throw httpError(status, message)` and are converted centrally by `handleError`; API errors have the shape `{ "error": "..." }`.
- Use prepared D1 statements with positional bindings. Use the local `first<T>` and `all<T>` wrappers, `env.DB.batch(...)` for related multi-statement writes, and explicit row types whose fields match SQL aliases.
- Database rows and columns are snake_case. Serialized API fields are normally camelCase; preserve existing endpoint shapes documented in `README.md`, including the legacy snake_case fields returned by `GET /games/today`.
- Player endpoints use `Authorization: Bearer <token>`. Only SHA-256 token hashes are persisted. Passwords use the existing PBKDF2 format and helpers. Admin endpoints use `x-admin-token` and timing-safe comparison.
- “Today” is calculated in `Europe/Vienna`, not UTC or the caller's timezone. Keep date parsing strict (`YYYY-MM-DD`) and preserve the scoring switch at `NEW_SCORING_START_DATE`.
- A play is created lazily, guesses are immutable, and the fifth guess finalizes the play. Leaderboards include finalized plays only. Preserve social-visibility gates when changing play or social behavior.
- Reseeding a dated game replaces its locations only while no play exists for that game. Seed input must contain exactly five locations, and array order defines ordinals 1 through 5.

## Location data conventions

- Curated `locations/YYYY-MM-DD.json` files are arrays of exactly five objects, ordered easiest to hardest. `scripts/ai/validate-locations.mjs` requires the exact key order: `name`, `region`, `isoCountryCode`, `text`, `source_link`, `wikibase_id`, `coordinates`; `coordinates` must contain `lat` then `lon`.
- Location text must start with `On {Month} {Day}`, remain at most 50 words, and source an English Wikipedia article. Country codes are uppercase two-letter ISO codes, Wikidata IDs match `Q<number>`, and coordinates must be finite geographic values.
- Candidate files and curated files have different schemas. Do not pass candidate objects directly to the seed endpoint; `scripts/seed-locations.ts` performs the curated-to-API field mapping.
- The seed script defaults to files after today's UTC date, processes files in date order, and appends newly seeded `name, region` pairs to `locations/candidates/blacklist.txt`.
