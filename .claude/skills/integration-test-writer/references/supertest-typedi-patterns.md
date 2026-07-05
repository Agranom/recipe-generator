# supertest + TypeDI integration patterns

Copy-paste fakes for every external boundary in this codebase, plus the TypeDI
container recipes. Pick the boundary your endpoint touches — you only fake the
ones on that request's path.

## Contents

1. [The skeleton](#skeleton)
2. [Boundary: axios / ScrapeCreators](#axios)
2b. [Alternative: nock for a plain HTTP/REST boundary](#nock)
3. [Boundary: Gemini `@google/genai`](#genai)
4. [Boundary: OpenAI / LangChain](#langchain)
5. [Boundary: Google Cloud Storage](#gcs)
6. [Boundary: MongoDB](#mongo)
7. [TypeDI: swap a whole service](#container-set)
8. [TypeDI: reset between files](#container-reset)
9. [Asserting responses](#assertions)
10. [Driving retry backoff](#retry)

---

## Skeleton {#skeleton}

Every integration spec has the same shape. `reflect-metadata` first, then the
`jest.mock(...)` calls for the boundaries on this path (hoisted above imports),
then the app and supertest.

```ts
import 'reflect-metadata';

// jest.mock calls go here — hoisted above the imports below
jest.mock('axios');

import request from 'supertest';
import { createApp } from '../../app';

describe('POST /endpoint', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('<endpoint> <scenario> <expected outcome>', async () => {
    // arrange fakes → one request → assert response
  });
});
```

Build the app once (`const app = createApp()`) at the top of `describe`. It's
cheap and the container is shared for the whole file anyway.

## Boundary: axios / ScrapeCreators {#axios}

`InstaScrapperService` calls ScrapeCreators through `axios.get`. Fake the whole
module; the real service still strips byte-range params, maps fields, etc.

```ts
import axios from 'axios';
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// success — the shape the service actually reads:
mockedAxios.get.mockResolvedValue({
  data: { data: { xdt_shortcode_media: {
    edge_media_to_caption: { edges: [{ node: { text: 'Pasta' } }] },
    video_url: 'https://cdn.example.com/v.mp4',
    display_url: 'https://cdn.example.com/i.jpg',
  } } },
});

// failure (drives the 500 / null-fields path):
mockedAxios.get.mockRejectedValue(new Error('network down'));
```

`.env.test` sets `SCRAPECREATORS_API_KEY=test-key`, so the service's constructor
guard passes and the app boots — the key is never sent because axios is faked.

## Alternative: nock for a plain HTTP/REST boundary {#nock}

`jest.mock('axios')` (above) is the simplest fake and the right default. But for
a **plain REST boundary like ScrapeCreators**, `nock` is a good alternative when
you want to test one layer deeper: it intercepts at the HTTP layer, so the *real*
axios runs — the URL, query string, and headers your `InstaScrapperService`
builds are exercised for real, and you can assert or fail the actual outgoing
request.

Use nock **only for boundaries that speak plain HTTP through axios** (here, that's
just ScrapeCreators). Do **not** use it for the LLM or GCS SDKs — see the caveat
at the end.

Install it (optional dependency; not needed unless you use this pattern):

```bash
npm install --save-dev nock
```

```ts
import 'reflect-metadata';
process.env.GOOGLE_CLOUD_BUCKET_NAME = 'test-bucket';

// LLM/GCS SDKs still faked at the module boundary so the container can boot.
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue((input: unknown) => input),
  })),
}));
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', INTEGER: 'INTEGER', NUMBER: 'NUMBER' },
}));
jest.mock('@google-cloud/storage', () => ({ Storage: jest.fn().mockImplementation(() => ({ bucket: jest.fn() })) }));

import nock from 'nock';
import request from 'supertest';
import { createApp } from '../../app';

const SCRAPECREATORS = 'https://api.scrapecreators.com';
const REEL_URL = 'https://www.instagram.com/reel/DBHExLYonRH/';

describe('POST /getInstagramPostMetadata (nock)', () => {
  const app = createApp();

  beforeAll(() => {
    // Fail loudly if the code tries to reach any host you didn't intercept —
    // turns a stray real request into a clear test error instead of a slow hang.
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll(); // drop interceptors so they don't leak into the next test
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('POST /getInstagramPostMetadata returns 200 with the mapped metadata', async () => {
    // Intercept the exact request; .query(...) also asserts the query string.
    const scope = nock(SCRAPECREATORS)
      .get('/v1/instagram/post')
      .query({ url: REEL_URL })
      .matchHeader('x-api-key', 'test-key')
      .reply(200, {
        data: { xdt_shortcode_media: {
          edge_media_to_caption: { edges: [{ node: { text: 'Pasta' } }] },
          display_url: 'https://cdn.example.com/i.jpg',
        } },
      });

    const res = await request(app).post('/getInstagramPostMetadata').send({ postUrl: REEL_URL });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: 'Pasta' });
    expect(scope.isDone()).toBe(true); // the interceptor was actually hit
  });

  it('POST /getInstagramPostMetadata surfaces a real HTTP 500 from the upstream', async () => {
    nock(SCRAPECREATORS).get('/v1/instagram/post').query(true).reply(500, 'upstream boom');

    const res = await request(app).post('/getInstagramPostMetadata').send({ postUrl: REEL_URL });

    // Assert whatever your controller maps the upstream failure to.
    expect([400, 500]).toContain(res.status);
  });
});
```

What nock buys you over `jest.mock('axios')`: `scope.isDone()` proves the exact
request was made; `.query(...)` / `.matchHeader(...)` assert the request the
service built; and `.reply(500, ...)` / `.replyWithError('ETIMEDOUT')` simulate
*real* HTTP-level failures instead of a synthetic rejected promise. If the
boundary is wrapped in `retry()`, add one interceptor per expected attempt (nock
consumes an interceptor per matched request) or neutralize retry with the util
mock from the [retry section](#retry).

**Caveat — plain HTTP only.** nock intercepts Node's `http`/`https` (which axios
uses by default), so it works here. It does **not** intercept gRPC or SDKs that
route through `fetch`/`undici` without extra setup — so it's the wrong tool for
`@langchain/openai`, `@google/genai`, and `@google-cloud/storage`. Keep faking
those at the SDK method boundary; reach for nock only on the axios/REST edge.

## Boundary: Gemini `@google/genai` {#genai}

`RecipeInstructionsService` calls `new GoogleGenAI().models.generateContent`.
Mock the module and expose the `generateContent` fn (also re-export `Type`,
which `ai-schemas.ts` reads at import time — omit it and the import crashes).

```ts
const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', INTEGER: 'INTEGER', NUMBER: 'NUMBER' },
}));

// success: the SDK returns { text } holding JSON the service parses
mockGenerateContent.mockResolvedValue({
  text: JSON.stringify({
    instructions: '1. Chop.\n2. Sauté.',
    timestamps: [{ step: 1, startTime: '00:05', endTime: '00:15' }],
  }),
});
```

## Boundary: OpenAI / LangChain {#langchain}

`RecipeGeneratorService` builds chains with `ChatOpenAI().withStructuredOutput`,
then **pipes** them onto a real prompt: `prompt.pipe(model.withStructuredOutput(...))`.
That `.pipe(...)` coerces whatever `withStructuredOutput` returns into a LangChain
Runnable — and it coerces a plain **function** into a `RunnableLambda`, but a
plain `{ invoke }` object gets mis-wrapped and the chain breaks. So the fake must
be a **function** (or a real `RunnableLambda`), not an `{ invoke }` object:

```ts
// Simplest: withStructuredOutput returns a function. `.pipe` wraps it in a
// RunnableLambda; calling the chain calls your mock.
const mockValidate = jest.fn();
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue((input: unknown) => mockValidate(input)),
  })),
}));

// Equivalent, explicit form if you prefer to be unambiguous:
jest.mock('@langchain/openai', () => {
  const { RunnableLambda } = require('@langchain/core/runnables');
  return {
    ChatOpenAI: jest.fn().mockImplementation(() => ({
      withStructuredOutput: () => RunnableLambda.from((input: unknown) => mockValidate(input)),
    })),
  };
});

// validation says "not a recipe" → controller surfaces the 400/500 path:
mockValidate.mockResolvedValueOnce({ isRecipe: false });
// or a parsed recipe on the happy path:
mockValidate.mockResolvedValueOnce({ title: 'Pasta', ingredients: [], instructions: [] });
```

If the endpoint chains several calls (validate, then parse), each is a separate
`withStructuredOutput(...)` runnable; queue results with `mockResolvedValueOnce`
in call order, and read the service first to confirm that order. **Do not** use
the `{ invoke: fn }` shape — it looks right but fails the moment the service pipes
it.

## Boundary: Google Cloud Storage {#gcs}

`GoogleStorageService` wraps `@google-cloud/storage`. Fake the `Storage` class
and the `bucket().file()` chain the service uses (move/delete/makePublic).

```ts
const mockFile = { move: jest.fn(), delete: jest.fn(), makePublic: jest.fn(), save: jest.fn() };
const mockBucket = { file: jest.fn().mockReturnValue(mockFile), upload: jest.fn() };
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({ bucket: jest.fn().mockReturnValue(mockBucket) })),
}));
```

Confirm the exact chain against `google-storage.service.ts` — fake only the
methods the code on your endpoint's path calls, not the whole SDK surface.

## Boundary: MongoDB {#mongo}

Fake the driver's `MongoClient` and the collection methods the code calls. Don't
spin a real/in-memory Mongo for an API test — that's a heavier fixture than this
level needs.

```ts
const mockCollection = {
  insertOne: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn(),
};
jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue({ collection: jest.fn().mockReturnValue(mockCollection) }),
  })),
  ObjectId: jest.requireActual('mongodb').ObjectId,
}));
```

## TypeDI: swap a whole service {#container-set}

When wiring the real service graph is disproportionate to what the test proves,
replace a service with a fake **before** `createApp()` resolves the controller.
Less faithful than faking the SDK leaf — the real service logic no longer runs —
so reserve it for when the boundary fake is impractical.

```ts
import 'reflect-metadata';
import { Container } from 'typedi';
import { RecipeGeneratorService } from '../../services/recipe-generator.service';

const fakeGenerator = { getRecipeMetadata: jest.fn(), generateRecipe: jest.fn() };
Container.set(RecipeGeneratorService, fakeGenerator);

import { createApp } from '../../app';
const app = createApp(); // controller now gets the fake service
```

Set the binding before importing/calling `createApp` — once the controller is
resolved, its injected dependency is fixed.

## TypeDI: reset between files {#container-reset}

You usually don't need this: Jest gives each test *file* a fresh module registry,
so the `Container` singleton starts clean per file. If you do call
`Container.reset()` (e.g. to clear a `Container.set` override mid-file),
re-register the logger afterward or the next `createApp()` builds a controller
with no logger:

```ts
import { LOGGER_TOKEN } from '../../shared/services/logger.service';
import { PinoLoggerAdapter } from '../../shared/services/pino-logger.adapter';

Container.reset();
Container.set(LOGGER_TOKEN, new PinoLoggerAdapter({ level: 'silent' }));
```

## Asserting responses {#assertions}

`supertest` gives you the response; assert the contract the client sees.

```ts
const res = await request(app).post('/x').send(body);

expect(res.status).toBe(200);          // status line
expect(res.body).toEqual({ … });       // parsed JSON body (res.json)
expect(res.body).toMatchObject({ … }); // partial JSON match
expect(res.text).toBe('postUrl is required'); // plain-text res.send(...)
// 204 has no body: assert only res.status === 204
```

`.expect(...)` chains work too (`await request(app).post('/x').send(body).expect(204)`),
but capturing `res` and using `expect(res.body)…` reads clearer for body checks.

Assert the *negative* where it proves wiring: `expect(mockedAxios.get).not.toHaveBeenCalled()`
confirms validation rejected the request before any downstream work ran.

## Keeping retried error paths fast {#retry}

Services wrap external I/O in `retry()` (default 3 attempts, real `setTimeout`
delays). A fake that rejects therefore triggers real waits, so a 500-path test
crawls.

**Do not reach for `jest.useFakeTimers()`.** Supertest runs a real ephemeral HTTP
server; faking the clock freezes the event loop that server and its socket need,
and the request hangs until the test times out. Fake timers and supertest are
incompatible.

Instead, neutralize the retry *wrapper* — the retry logic itself is covered by
`retry.util`'s own unit tests, so for an API test you don't need it to loop.
Mock it to call the function once, no delay:

```ts
// path is relative to the test file; point it at shared/utils/retry.util
jest.mock('../../shared/utils/retry.util', () => ({ retry: (fn: () => unknown) => fn() }));

it('returns 500 when the boundary fails', async () => {
  mockedAxios.get.mockRejectedValue(new Error('down')); // one call, no backoff

  const res = await request(app).post('/x').send(body);

  expect(res.status).toBe(500);
});
```

If you'd rather exercise the real `retry()`, just accept the ~1s backoff — it's
well under Jest's default timeout — and `await` the request normally. Either way,
never fake the clock around a supertest request.
