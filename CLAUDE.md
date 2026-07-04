# CLAUDE.md

Guidance for Claude Code. For project overview, setup, API reference, scripts, and deployment see **[README.md](README.md)**.

## Dependency Injection

TypeDI (`@Service()` / `@Inject()`). `instrumentation.ts` is imported as the very first line of `index.ts` (OTel must initialize before anything else); `reflect-metadata` is imported immediately after. Services are resolved via `Container.get(...)`. `tsconfig` has `experimentalDecorators` + `emitDecoratorMetadata` enabled. New services must be injected — never instantiated with `new` inside another class.

Logger is registered manually in `index.ts` before the controller is resolved; inject it via `@Inject(LOGGER_TOKEN)`. Do not use `console` in new code.

## Service Internals

- **`recipe-generator.service.ts`** — orchestrator. Holds LangChain chains (`ChatOpenAI` + `withStructuredOutput`) for validation and parsing. Coordinates scraping, instruction generation, timestamp mapping, and video staging/publishing.
- **`insta-scrapper.service.ts`** — fetches post metadata (description, video URL, image URL) via the ScrapeCreators Instagram API (single `axios` call, wrapped in `retry`). Strips `bytestart=`/`byteend=` params that make video URLs unplayable. Requires `SCRAPECREATORS_API_KEY`.
- **`recipe-instructions.service.ts`** — Gemini (`gemini-2.5-flash`) via Vertex AI. Two modes: `generateInstructionsFromVideo` (no existing instructions — derives steps + timestamps from video) and `getTimestamps` (instructions exist — aligns them to time ranges). Reads video via `gs://` URI.
- **`video-processing.service.ts`** — `preloadVideo` stages to GCS `tmp/` prefix; `publishVideo` moves to permanent prefix and makes public.
- **`local-video-manager.service.ts`** — downloads a video URL to a local temp file and deletes it.

Two AI providers are used deliberately: **OpenAI (LangChain)** for text parsing/validation, **Gemini (Vertex AI)** for video understanding.

## Shared Utilities

- **`shared/services/pino-logger.adapter.ts`** — Pino-based `Logger` implementation. Registered manually in `index.ts` as `LOGGER_TOKEN`. Configure log level via `LOG_LEVEL` env var; uses `pino-pretty` in non-production environments.
- **`shared/services/google-storage.service.ts`** — GCS wrapper (upload/move/delete, gsutil URLs).
- **`shared/utils/retry.util.ts`** — `retry(fn, { maxAttempts, delayMs, useExponentialBackoff })`. Wrap all external I/O here — LLM calls, GCS, scraping, Vertex AI.
- **`constants/video-directories.ts`** — GCS staging vs published prefixes (single source of truth).

## Models, Schemas, Constants

- `src/models/` — `Recipe`, `RecipeInstruction`, `RecipeTimestamp`, `RecipeMetadata`, `RecipeVideoMetadata`.
- `src/constants/ai-schemas.ts` — Zod schemas for `withStructuredOutput` (OpenAI) and Gemini `responseSchema`. Update here when the recipe/instruction/timestamp shape changes.
- `src/helpers/recipe.helper.ts` — `mapInstructions` merges instruction text with timestamps into `RecipeInstruction[]`.

## Testing Notes

Tests load from `.env.test` (not `.env`); `check-env.js` fails the run if it is missing.
Run a single test: `npx jest path/to/file.spec.ts` or `npx jest -t "<test name>"`.

## Coding Standards

See **[.claude/coding-standards.md](.claude/coding-standards.md)** — KISS, DRY, YAGNI, SOLID, Clean Code, TypeScript conventions, error handling, testing, and staying current.

## Stay Current

- Prefer the latest stable language and runtime features over legacy patterns or polyfills.
- When using any external library or API, use **Context7** (`mcp__plugin_context7_context7__query-docs`) to fetch up-to-date documentation rather than relying on training-data knowledge — interfaces, patterns, and package structures change regularly.
- Avoid deprecated APIs even when they still work. If you encounter one while editing, flag it.