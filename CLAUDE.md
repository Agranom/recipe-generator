# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A NodeJS/TypeScript service that generates structured recipes from Instagram posts and reels. It scrapes the post, validates that it is a recipe, optionally extracts step instructions and timestamps from the recipe video, and returns a normalized recipe JSON. It runs as an Express HTTP service and deploys to Google Cloud Run.

## Commands

```bash
npm run dev          # Run locally with nodemon (ts-node, watches index.ts)
npm run build        # Compile TypeScript to dist/ (tsc)
npm start            # Run compiled build from dist/
npm test             # Run Jest tests
npm run test:watch   # Jest in watch mode
npm run lint         # ESLint over .js/.ts
npm run format       # prettier --write then eslint --fix (run before committing)
npm run deploy       # gcloud run deploy to Cloud Run (runs predeploy: lint + test + build)
```

Run a single test: `npx jest src/services/__tests__/insta-scrapper.server.test.ts` (or `-t "<test name>"`).

Tests load env from `.env.test` (not `.env`); `check-env.js` fails the run if `.env.test` is missing. `husky` + `lint-staged` run `npm run format` on staged `.ts/.js` at pre-commit.

## Required environment

Create a `.env` file (loaded in both `index.ts` and `instrumentation.ts`). Key variables:

- `OPENAI_API_KEY` — recipe parsing/validation LLM (LangChain `ChatOpenAI`, model `gpt-4o-mini`).
- `GOOGLE_API_KEY` — required by `RecipeInstructionsService` (constructor throws without it).
- `GOOGLE_CLOUD_BUCKET_NAME` — GCS bucket (`GoogleStorageService` constructor throws without it).
- `GOOGLE_APPLICATION_CREDENTIALS` — service account for Vertex AI (project `boykom`, location `us-central1`) and GCS.
- `OTEL_EXPORTER_OTLP_*` — OpenTelemetry exporter endpoint/auth (see Observability).
- `IS_MAC_M1=true` — locally points Puppeteer at the system Chrome instead of the bundled binary.
- `PORT` (default 4000), `ORIGIN` (CORS), `LOG_LEVEL`, `NODE_ENV`.

## Architecture

Dependency injection is via **TypeDI** (`@Service()` / `@Inject()`). `reflect-metadata` is imported first in `index.ts`; services are resolved through `Container.get(...)`. `tsconfig` has `experimentalDecorators` + `emitDecoratorMetadata` enabled for this.

### Request flow

`index.ts` wires three POST routes to `RecipeGeneratorController`, which delegates to `RecipeGeneratorService` (the orchestrator):

- `POST /getInstagramPostMetadata` → `getRecipeMetadata(postUrl)`: scrape post → LLM-validate it is a recipe → if a video exists, stage it to GCS and return preview metadata (including `videoFile`).
- `POST /generateFromInstagram` → `generateRecipe(metadata, { targetLanguage, useMetricSystem })`: produce the final structured `Recipe`, publishing the video to permanent GCS storage.
- `POST /deleteRecipeVideo` → `deleteRecipeVideo({ publicFileId })`: delete a published video from GCS.

The two-call design is intentional: the client first previews metadata, then triggers full generation. A video is **staged** during metadata retrieval and only **published** (promoted to permanent storage) during generation.

### Services (`src/services/`)

- **`recipe-generator.service.ts`** — orchestrator. Holds the LangChain chains (`ChatOpenAI` + `withStructuredOutput`) for recipe validation and recipe parsing. Coordinates scraping, instruction generation, timestamp mapping, and video staging/publishing.
- **`insta-scrapper.service.ts`** — extracts post description, video URL, and image. Tries strategies in order: Instagram GraphQL API → HTML/`axios` → Puppeteer headless browser (network interception + DOM evaluation). Strips `bytestart=`/`byteend=` byte-range params that make video URLs unplayable.
- **`recipe-instructions.service.ts`** — **Vertex AI / Gemini** (`gemini-2.5-flash`). Two modes: `generateInstructionsFromVideo` (when the post has no text instructions — derives steps + timestamps from the video) and `getTimestamps` (when instructions already exist — aligns them to video time ranges). Reads the video from GCS via `gs://` URI.
- **`video-processing.service.ts`** — `preloadVideo` (download → upload to GCS `tmp/` staging prefix) and `publishVideo` (GCS move from staging to published prefix, make public).
- **`local-video-manager.service.ts`** — download a video URL to a local temp file and delete it.

Two AI providers are used deliberately: **OpenAI (via LangChain)** for text recipe parsing/validation, **Gemini (via Vertex AI)** for video understanding.

### Shared (`src/shared/`)

- **`services/google-storage.service.ts`** — GCS wrapper (upload/move/delete, gsutil URLs).
- **`services/logger.service.ts` + `pino-logger.adapter.ts`** — `LOGGER_TOKEN` injection token with a Pino-backed `Logger`. Inject the logger via `@Inject(LOGGER_TOKEN)`; do not use `console` in new code. The adapter is registered manually in `index.ts` before resolving the controller.
- **`utils/retry.util.ts`** — `retry(fn, { maxAttempts, delayMs, useExponentialBackoff })`. Used widely around scraping and LLM calls, which are flaky.
- **`constants/video-directories.ts`** — GCS staging vs published prefixes.

### Models, schemas, constants

- `src/models/` — `Recipe`, `RecipeInstruction`, `RecipeTimestamp`, `RecipeMetadata`, `RecipeVideoMetadata`.
- `src/constants/ai-schemas.ts` — Zod / response schemas passed to `withStructuredOutput` (OpenAI) and Gemini `responseSchema`. Change these when altering the recipe/instruction/timestamp shape.
- `src/helpers/recipe.helper.ts` — `mapInstructions` merges instruction text with timestamps into `RecipeInstruction[]`.

## Observability

`instrumentation.ts` is imported as the very first line of `index.ts` and starts the OpenTelemetry `NodeSDK` (traces, metrics, logs via OTLP/proto) with auto-instrumentation for Express, HTTP, and Pino. The SDK is shut down on `SIGTERM`/`SIGINT`.

## Conventions

Project follows the rules in `.cursorrules`. Notable ones beyond standard style:

- **One export per file.** kebab-case file names; PascalCase classes; camelCase members.
- Always declare parameter and return types; avoid `any` (ESLint `no-explicit-any` is a warning).
- Functions start with a verb; small single-purpose classes; prefer early returns over nesting.
- Pass/return multiple values as objects (RO-RO); prefer `readonly`/`as const`.
- No blank lines inside a function body; add a blank line above `return` statements.

## Deployment

Cloud Run service `recipe-generator` (region `us-west1`). The `Dockerfile` (`node:18-slim`) installs Chromium/Puppeteer system dependencies and builds via `npm run build`. Puppeteer launches headless with `--no-sandbox`; Chrome is installed in the image via the `postinstall` hook.
