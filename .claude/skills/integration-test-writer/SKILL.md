---
name: integration-test-writer
description: >-
  Write fast, deterministic API integration tests for the Express + TypeDI
  service — driving real HTTP requests through the whole route → controller →
  service chain with supertest, while faking only the external boundaries (LLM
  SDKs, Google Cloud Storage, ScrapeCreators/axios, MongoDB). Use this whenever
  the user wants to test an endpoint, route, or controller end-to-end, verify
  HTTP status codes / response bodies / request validation, add a
  `*.server.test.ts`, cover an API's error paths (400/500), or "test the API"
  without hitting real third-party services. Trigger this even when the user
  just says "write an integration test for /generateFromInstagram", "test this
  endpoint", "cover the controller", or "make sure the route returns 400 when
  the body is missing". This is for API-level integration tests through the HTTP
  layer — not unit tests of a single service in isolation (use unit-test-writer
  for those) and not tests that call real paid third-party APIs.
---

# Writing good API integration tests

An **API integration test** exercises a real HTTP request against the real
Express app — the actual route, the actual controller, the actual services
wired through the real TypeDI container — and asserts on the HTTP response the
client would see: **status code, response body, headers**. Only the outermost
boundaries (network calls to LLMs, Google Cloud Storage, ScrapeCreators, Mongo)
are faked, because those are slow, non-deterministic, cost money, and need
credentials the test environment doesn't have.

The point of this level is different from a unit test. A unit test proves one
service's logic in isolation. An integration test proves the **wiring**: that
the route is mounted at the right path, the controller reads the right fields
off `req.body`, validation rejects bad input with the right status, the happy
path serializes the right JSON, and an error deep in a service surfaces as the
right HTTP code. Bugs at this level live *between* the units, so faking too much
defeats the purpose — fake only the network edge, let everything inside run for
real.

## Where to draw the fake line

Picture the request flowing inward. Everything from the HTTP socket down to (but
not including) the third-party network call is **under test and runs for real**.
The third-party call itself is **faked**.

```
supertest → express app → route → controller → service(s) → [ SDK / axios ] → network
└─────────────────── real, under test ──────────────────────┘   └──── faked ────┘
```

Concretely, in this codebase the fake line sits at these leaf modules:

- **`axios`** — used by `InstaScrapperService` to call ScrapeCreators.
- **`@google/genai`** (and `@langchain/openai`, `@langchain/google-genai`) — the
  LLM SDKs behind `RecipeInstructionsService` and `RecipeGeneratorService`.
- **`@google-cloud/storage`** — behind `GoogleStorageService` / video staging.
- **`mongodb`** — any persistence.

You fake the module, not the service. `RecipeGeneratorService`,
`InstaScrapperService`, the controller, and the routing all run their real code
against the faked SDK. That is what makes it an *integration* test rather than a
controller unit test.

> If you only care about the controller's contract and the service graph is
> painful to satisfy, you *can* swap a whole service for a fake via
> `Container.set(RealService, fakeInstance)` before building the app. That's a
> lighter, less faithful test — prefer faking at the SDK leaf so the real
> service logic participates. Reach for `Container.set` only when wiring the real
> service is disproportionate to what the test proves.

## Before writing anything

1. **Trace the endpoint end to end.** Open `index.ts` (route registration), the
   controller method, and every service it calls, down to the SDK/axios call.
   You can't fake a boundary you haven't located, and you can't assert the
   response shape without reading what the controller actually returns
   (`res.json(...)`, `res.sendStatus(204)`, `res.status(400).send('...')`).
2. **List the external boundaries on that path** — which of axios / the LLM SDKs
   / GCS / mongodb get hit. Those, and only those, you fake.
3. **Note every response the controller can produce.** Each `res.status(...)` is
   a test case: the happy `200`/`204`, each validation `400`, and the `500`
   catch-all. Integration tests earn their keep on the branches *between* units —
   especially "bad input → 400" and "service throws → 500", which unit tests of a
   single service can't cover.
4. **Match real request/response shapes.** Build request bodies and faked SDK
   responses from the actual models (`src/models/`) and schemas
   (`src/constants/ai-schemas.ts`), not invented shapes — a test built on a
   guessed shape passes against your fake and lies about production.

## Make the app importable (once)

A supertest integration test needs to `import` the Express `app` **without the
process calling `app.listen()`** — you don't want a real port opening during
tests. Today `index.ts` builds the app inline and listens at the bottom, so
there's nothing to import.

Fix it once by extracting a factory. Create `src/app.ts`:

```ts
import { Container } from 'typedi';
import express from 'express';
import cors from 'cors';
import { RecipeGeneratorController } from './controllers/recipe-generator.controller';
import { PinoLoggerAdapter } from './shared/services/pino-logger.adapter';
import { LOGGER_TOKEN } from './shared/services/logger.service';

export function createApp() {
  if (!Container.has(LOGGER_TOKEN)) {
    Container.set(LOGGER_TOKEN, new PinoLoggerAdapter({ level: process.env.LOG_LEVEL || 'info' }));
  }

  const app = express();
  app.use(express.json());
  app.use(cors({ origin: process.env.ORIGIN, methods: ['POST'] }));

  const controller = Container.get(RecipeGeneratorController);
  app.post('/getInstagramPostMetadata', controller.getInstagramPostMetadata.bind(controller));
  app.post('/generateFromInstagram', controller.generateFromInstagram.bind(controller));
  app.post('/deleteRecipeVideo', controller.deleteRecipeVideo.bind(controller));

  return app;
}
```

Then `index.ts` keeps its `import './instrumentation'` and `import
'reflect-metadata'` as the first two lines, registers the logger, and replaces
the inline app construction with `const app = createApp(); app.listen(port, …)`.
Keep route registration in exactly one place — the factory — so tests and
production mount the same paths. The logger is registered inside the factory
(guarded by `Container.has`) so an imported app is self-sufficient in a test.

If the app is already factored this way, just import it.

## Set up supertest

`supertest` drives HTTP against an Express app without binding a port. It isn't
installed yet — add it as a dev dependency:

```bash
npm install --save-dev supertest @types/supertest
```

Pass the app straight to `request(...)` — supertest starts and tears down an
ephemeral server per request, so no `listen`/`close` bookkeeping:

```ts
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
await request(app).post('/deleteRecipeVideo').send({ publicFileId: 'x' }).expect(204);
```

## Fake the boundary, not the app

Fake the leaf SDK modules with `jest.mock(...)` at the top of the file. Because
`jest.mock` is hoisted above the imports, the real services resolve the *mocked*
module when the container builds them — the service code runs for real, its
network call doesn't. The `references/supertest-typedi-patterns.md` file has
copy-paste fakes for every boundary in this codebase (axios/ScrapeCreators, the
Gemini and OpenAI SDKs, GCS, mongodb) plus the TypeDI container recipes — read
it once instead of reconstructing a fake each time. For the plain axios/REST
boundary (ScrapeCreators) it also documents an optional `nock` pattern that
intercepts at the HTTP layer, if you want to test that edge one layer deeper.

Two ordering rules that will bite you if ignored, both driven by how the app
boots:

- **`import 'reflect-metadata'` must be the very first import** of the test file,
  before anything that pulls in a decorated class or the container. TypeDI's
  `@Service()`/`@Inject()` decorators throw at import time without it. This
  mirrors `index.ts`, which imports it before any `@Service`.
- **You do not need to fake OpenTelemetry.** When the OTel SDK isn't started
  (it's only started in `instrumentation.ts`, which tests don't import), the API
  gives a no-op tracer and everything just works. Don't mock `@opentelemetry/*`.

### Boot trap: services that throw in their constructor

The container builds the *whole* controller graph when `createApp()` resolves the
controller — including services on other endpoints. Some throw in their
constructor if their config is missing. The one you'll hit most:
`GoogleStorageService` throws on an empty bucket name, and `.env.test` leaves
`GOOGLE_CLOUD_BUCKET_NAME` empty. So even an endpoint that never touches storage
fails to boot unless you set it. Set the needed env vars at the very top of the
test file, before `createApp()` runs:

```ts
process.env.GOOGLE_CLOUD_BUCKET_NAME = 'test-bucket'; // GoogleStorageService ctor guard
```

The value is never used — the SDK is faked — it just has to be non-empty. When a
new endpoint's boot fails, read the constructor of whatever service the container
is building and give it the minimal env/fake it needs.

### Beware the retry delays — but don't reach for fake timers

External I/O here is wrapped in `retry()` (see `shared/utils/retry.util.ts`) with
real `setTimeout` delays. If your fake *rejects* to exercise an error path, the
real service retries — three attempts with real 1-second waits makes the error
test slow.

The instinct is `jest.useFakeTimers()` — **don't**. Supertest runs a real
ephemeral HTTP server, and faking the clock freezes the very event loop that
server and socket need, so the request hangs until the test times out. Fake
timers and supertest don't mix.

Instead, neutralize the retry *wrapper* itself when the retry count isn't what
you're proving (it's covered by the service's own unit tests). Mock the util so
it calls the function once, no delay:

```ts
jest.mock('../../shared/utils/retry.util', () => ({ retry: (fn: () => unknown) => fn() }));
```

Now a rejecting boundary surfaces the error immediately and the 500-path test is
fast. If you'd rather keep the real retry, just accept the ~1s — it's under the
default timeout — but never fake the clock around a supertest request.

## Writing the test itself

**Assert the HTTP contract, not the internals.** The value the client sees is
the status code and the body — assert those. `supertest`'s `.expect(200)` checks
status; read `res.body` for JSON, `res.text` for a plain-text `send()`. Don't
reach past the response into service internals; that's a unit test's job and it
couples this test to implementation it shouldn't know about.

```ts
const res = await request(app).post('/getInstagramPostMetadata').send({ postUrl });
expect(res.status).toBe(200);
expect(res.body).toEqual({ description: 'Pasta', videoUrl: null, imageUrl: 'https://…' });
```

**Name by behaviour, endpoint-first.** Follow the project convention `<unit>
<scenario> <expected outcome>`, naming the endpoint as the unit:
`it('POST /getInstagramPostMetadata returns 400 when postUrl is missing')`. A
failing suite then reads as a list of broken guarantees.

**One request, one behaviour per test.** Arrange the fakes, fire exactly one
request, assert the response. If you're asserting two unrelated outcomes, that's
two tests.

**Cover the branches that live between the units** — this is where integration
tests pay off:
- **Validation / bad input** → the `400` the controller returns before doing any
  work (`postUrl is required`). No fake even needs to be primed for these.
- **Happy path** → correct status *and* the exact response body the client
  depends on.
- **Downstream failure** → make a faked boundary throw and assert the controller
  maps it to the right status (a generic error → `500 Internal server error`; a
  typed `InvalidRecipeError` → `400` with its message). Pair "the failure
  surfaced as the right code" with "no success body leaked".

**Reset shared state between tests.** `jest.clearAllMocks()` in `beforeEach` so
call counts and canned responses don't leak across tests — leaked mock state is
the top cause of order-dependent, flaky suites. The TypeDI `Container` is a
singleton, but Jest gives each test *file* a fresh module registry, so the
container is clean per file; you rarely need `Container.reset()`, and if you do
call it, re-register `LOGGER_TOKEN` afterwards or the next `createApp()` will
build a controller with no logger.

**Keep types honest where it's cheap.** `jest.mocked(axios)` / `jest.Mocked<T>`
keep faked return values type-checked. For a big SDK object a focused `as any` on
a partial fake is fine — don't burn time satisfying a 40-field GCS type you're
faking three methods of.

## File placement and running

- Name integration specs **`*.server.test.ts`** and co-locate them with the code
  (e.g. `src/controllers/__tests__/recipe-generator.controller.server.test.ts`).
  The suffix is the project's convention (coding-standards §8) and keeps them
  distinct from `*.spec.ts` unit tests.
- Iterate on just your file: `npx jest path/to/file.server.test.ts`.
- Tests load `.env.test` automatically (jest config), and `check-env.js` fails
  the run if it's missing. `.env.test` already sets `SCRAPECREATORS_API_KEY` so
  `InstaScrapperService`'s constructor guard passes and the app can boot — the
  key is never used because axios is faked.
- **Always run the test before calling it done.** Green is the only proof. If it
  hangs or Jest warns about open handles, a real client or an unresolved promise
  leaked past your fakes (or a `retry()` is sleeping on a real timer) — tighten
  the fake or drive the clock. The suite must pass and exit cleanly.

## A complete example

```ts
import 'reflect-metadata'; // first — TypeDI decorators need it at import time

// Non-empty bucket name so GoogleStorageService's constructor doesn't throw when
// the container builds the controller graph. Never used — GCS is faked below.
process.env.GOOGLE_CLOUD_BUCKET_NAME = 'test-bucket';

// Fake the leaf SDKs (hoisted above the imports). axios is the boundary under
// test; the LLM/GCS SDKs are faked only so sibling services' constructors boot.
jest.mock('axios');
const mockValidate = jest.fn();
jest.mock('@langchain/openai', () => ({
  // withStructuredOutput() is piped onto a real prompt, so the fake must be a
  // function (LangChain wraps it in a RunnableLambda) — NOT a { invoke } object.
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue(() => mockValidate()),
  })),
}));
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', INTEGER: 'INTEGER', NUMBER: 'NUMBER' },
}));
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({ bucket: jest.fn() })),
}));

import axios from 'axios';
import request from 'supertest';
import { createApp } from '../../app';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function scrapeCreatorsResponse(media: Record<string, unknown>) {
  return { data: { data: { xdt_shortcode_media: media } } };
}

describe('POST /getInstagramPostMetadata', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /getInstagramPostMetadata returns 400 when postUrl is missing', async () => {
    const res = await request(app).post('/getInstagramPostMetadata').send({});

    expect(res.status).toBe(400);
    expect(res.text).toBe('postUrl is required');
    expect(mockedAxios.get).not.toHaveBeenCalled(); // rejected before any scraping
  });

  it('POST /getInstagramPostMetadata returns 200 with the mapped metadata for a valid postUrl', async () => {
    // No video_url → the endpoint returns preview metadata and never touches GCS.
    mockedAxios.get.mockResolvedValue(
      scrapeCreatorsResponse({
        edge_media_to_caption: { edges: [{ node: { text: 'Pasta' } }] },
        display_url: 'https://cdn.example.com/i.jpg',
      })
    );
    mockValidate.mockResolvedValue({ isRecipe: true, hasInstructions: true, hasIngredients: true });

    const res = await request(app)
      .post('/getInstagramPostMetadata')
      .send({ postUrl: 'https://www.instagram.com/reel/DBHExLYonRH/' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: 'Pasta' });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
```

Notice the first test asserts the *negative* (`axios` was never called) — proving
validation short-circuits before any downstream work, a wiring guarantee no unit
test can give. That boundary-between-units check is what a good API integration
test adds on top of the unit suite. For an endpoint whose error path returns
`500` through a retried boundary, drive it with the retry-util mock from the
"retry delays" section above — never fake timers around a supertest request.
