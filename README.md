# Recipe Generator

A Node.js / TypeScript service that turns Instagram posts and reels into structured, normalized recipe JSON. It scrapes the post, uses an LLM to validate that it actually contains a recipe, optionally derives step instructions and video timestamps from the reel, and returns a clean `Recipe` object.

Runs as an Express HTTP service and deploys to Google Cloud Run.

## Features

- **Instagram scraping** via the ScrapeCreators API (single `axios` call).
- **Recipe validation** — rejects posts that aren't recipes (via OpenAI through LangChain).
- **Structured parsing** — extracts title, description, ingredients (with amounts/units), instructions, and portions.
- **Video understanding** — derives step-by-step instructions and aligns them to video timestamps using Gemini (Vertex AI).
- **Localization** — translate output to a target language and convert to the metric system on demand.
- **Video staging/publishing** — stages the reel to Google Cloud Storage during preview, then promotes it to permanent storage on generation.
- **Observability** — OpenTelemetry traces, metrics, and logs (OTLP) with Express/HTTP/Pino auto-instrumentation.

## Tech stack

- **Runtime:** Node.js (Docker image uses `node:18-slim`), TypeScript, Express
- **DI:** TypeDI (`reflect-metadata`)
- **AI:** OpenAI via LangChain (text parsing/validation), Gemini `gemini-2.5-flash` via Vertex AI (video understanding)
- **Storage:** Google Cloud Storage
- **Scraping:** ScrapeCreators API (via axios)
- **Logging:** Pino
- **Observability:** OpenTelemetry
- **Testing:** Jest (`ts-jest`)

## Architecture

```
index.ts → RecipeGeneratorController → RecipeGeneratorService (orchestrator)
                                          ├── InstaScrapperService        (scrape post via ScrapeCreators API)
                                          ├── RecipeInstructionsService   (Gemini/Vertex AI: instructions + timestamps)
                                          ├── VideoProcessingService      (stage/publish video to GCS)
                                          ├── LocalVideoManagerService    (download/cleanup temp video)
                                          └── GoogleStorageService        (GCS upload/move/delete)
```

The flow is intentionally two-call: the client first **previews** post metadata, then **generates** the full recipe. The reel is *staged* during metadata retrieval and only *published* to permanent storage during generation.

Two AI providers are used deliberately — **OpenAI** for text recipe parsing/validation, **Gemini** for video understanding.

## Getting started

### Prerequisites

- Node.js (18+; repo developed on 22.x)
- A Google Cloud service account with access to Vertex AI (project `boykom`, region `us-central1`) and Cloud Storage
- An OpenAI API key

### Install

```bash
npm install
```

### Configure environment

Create a `.env` file in the project root (loaded by both `index.ts` and `instrumentation.ts`):

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | LLM for recipe parsing/validation (`gpt-4o-mini` via LangChain). |
| `SCRAPECREATORS_API_KEY` | ✅ | API key for ScrapeCreators Instagram scraping (constructor throws without it). |
| `GOOGLE_API_KEY` | ✅ | Required by `RecipeInstructionsService` (constructor throws without it). |
| `GOOGLE_CLOUD_BUCKET_NAME` | ✅ | GCS bucket for staged/published videos. |
| `GOOGLE_APPLICATION_CREDENTIALS` | ✅ | Path to the service-account JSON for Vertex AI and GCS. |
| `OTEL_EXPORTER_OTLP_*` | ⚠️ | OpenTelemetry OTLP exporter endpoint/auth. |
| `PORT` | — | HTTP port (default `4000`). |
| `ORIGIN` | — | Allowed CORS origin. |
| `LOG_LEVEL` | — | Pino log level (default `info`). |
| `NODE_ENV` | — | `production` disables pretty logs. |

Tests load from `.env.test` instead of `.env`. `check-env.js` fails the test run if `.env.test` is missing.

### Run locally

```bash
npm run dev
```

The service starts on `http://localhost:4000` (or `PORT`).

## API

All endpoints are `POST` and accept/return JSON.

### `POST /getInstagramPostMetadata`

Scrapes a post, validates it's a recipe, and stages the video. Returns preview metadata.

**Request**

```json
{ "postUrl": "https://www.instagram.com/reel/..." }
```

**Response** — `RecipeMetadata`

```json
{
  "description": "…",
  "hasInstructions": true,
  "imageUrl": "https://…",
  "videoUrl": "https://…",
  "videoFile": { "fileName": "…", "url": "https://…", "publicFileId": "…" }
}
```

Returns `400` if `postUrl` is missing or the post is not a recipe.

### `POST /generateFromInstagram`

Produces the final structured recipe and publishes the video to permanent storage.

**Request**

```json
{
  "metadata": { "...": "RecipeMetadata from the previous call" },
  "targetLanguage": "en",
  "useMetricSystem": true
}
```

**Response** — `Recipe`

```json
{
  "title": "…",
  "description": "…",
  "ingredients": [{ "name": "…", "amount": "…", "measurementUnit": "g" }],
  "instructions": [
    { "step": 1, "text": "…", "videoStartTime": "00:00", "videoEndTime": "00:12" }
  ],
  "portionsCount": 4,
  "videoUrl": "https://…"
}
```

### `POST /deleteRecipeVideo`

Deletes a published video from GCS.

**Request**

```json
{ "publicFileId": "…" }
```

Returns `204 No Content`.

## Scripts

```bash
npm run dev          # Run locally with nodemon (ts-node, watches index.ts)
npm run build        # Compile TypeScript to dist/
npm start            # Run the compiled build from dist/
npm test             # Run Jest tests
npm run test:watch   # Jest in watch mode
npm run lint         # ESLint over .js/.ts
npm run lint:fix     # ESLint with --fix
npm run format       # prettier --write then eslint --fix (run before committing)
npm run deploy       # Deploy to Cloud Run (predeploy: lint + test + build)
```

Run a single test:

```bash
npx jest src/services/__tests__/insta-scrapper.service.spec.ts
# or by name
npx jest -t "<test name>"
```

`husky` + `lint-staged` run `npm run format` on staged `.ts`/`.js` files at pre-commit.

## Observability

`instrumentation.ts` is imported as the very first line of `index.ts` and starts the OpenTelemetry `NodeSDK` (traces, metrics, and logs over OTLP/proto) with auto-instrumentation for Express, HTTP, and Pino, plus host and runtime metrics. The SDK shuts down cleanly on `SIGTERM`/`SIGINT`.

## Deployment

Deploys to Cloud Run service `recipe-generator` (region `us-west1`):

```bash
npm run deploy
```

The `Dockerfile` (`node:18-slim`) installs `ca-certificates`, builds via `npm run build`, and runs the Express service.

**Service URL:** `https://recipe-generator-584335420311.us-west1.run.app`
