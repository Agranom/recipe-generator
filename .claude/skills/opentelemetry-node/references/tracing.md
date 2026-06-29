# Tracing: Spans & Traces

Manual tracing with `@opentelemetry/api`. A **trace** is a tree of **spans**; each span is one unit of work with a start/end time, attributes, events, and a status. Auto-instrumentation creates spans for HTTP/DB/etc.; you add manual spans for your own logic.

## Table of contents

- [Get a tracer](#get-a-tracer)
- [startActiveSpan vs startSpan](#startactivespan-vs-startspan)
- [Nested / child spans](#nested--child-spans)
- [Async work](#async-work)
- [Attributes](#attributes)
- [Events](#events)
- [Status & exceptions](#status--exceptions)
- [Span kind](#span-kind)
- [Links](#links)
- [The active span](#the-active-span)
- [Manual context propagation](#manual-context-propagation)
- [Cross-service propagation](#cross-service-propagation)

## Get a tracer

```js
const { trace } = require('@opentelemetry/api');
const tracer = trace.getTracer('my-app', '1.0.0'); // name = instrumentation scope; version optional
```

Name it after the library/module being instrumented. Getting a tracer is cheap; call it at module load or per-call as you like.

## startActiveSpan vs startSpan

- **`startActiveSpan(name, fn)`** — creates a span, makes it the *active* span for the duration of `fn`, and gives it to you as `fn`'s argument. Spans created inside `fn` (yours or auto-instrumented) automatically become children. **This is what you want almost always.** You still must call `span.end()`.
- **`startSpan(name)`** — creates a span but does *not* make it active. Children won't attach automatically. Use only when you deliberately manage context yourself.

```js
tracer.startActiveSpan('checkout', (span) => {
  // ... work; any spans created here are children of 'checkout'
  span.end();
});
```

`end()` is never automatic — forgetting it means the span never exports and the trace looks broken.

## Nested / child spans

Just call `startActiveSpan` again inside the callback. The context manager handles parentage:

```js
tracer.startActiveSpan('handleRequest', (parent) => {
  tracer.startActiveSpan('validate', (child) => {
    // child's parent is 'handleRequest'
    child.end();
  });
  tracer.startActiveSpan('persist', (child) => {
    child.end();
  });
  parent.end();
});
```

## Async work

The callback can be `async`. End the span in a `finally` so it ends on both success and error, and `return` the promise so the caller can await it:

```js
async function fetchUser(id) {
  return tracer.startActiveSpan('fetchUser', async (span) => {
    try {
      span.setAttribute('user.id', id);
      const user = await db.query('SELECT ...', [id]); // auto-instrumented DB span nests here
      return user;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

The active-span context follows `await` automatically (via `AsyncLocalStorage`, set up by the SDK). It does **not** survive being torn off into an unrelated callback or a manually constructed `Promise` that escapes the scope — see [manual context propagation](#manual-context-propagation).

## Attributes

Key/value metadata for filtering and grouping in your backend. Values are string, number, boolean, or arrays of those.

```js
span.setAttribute('http.route', '/users/:id');
span.setAttributes({ 'user.id': id, 'cache.hit': false, 'retry.count': 2 });
```

Prefer the standardized names from `@opentelemetry/semantic-conventions` where one exists (e.g. `ATTR_HTTP_REQUEST_METHOD`) so backends recognize them. Don't put high-cardinality or sensitive data (raw tokens, full payloads, PII) in attributes.

## Events

A timestamped annotation on a span — "this happened at this moment," without creating a child span.

```js
span.addEvent('cache.miss', { key: cacheKey });
span.addEvent('retrying', { attempt: 3 });
```

## Status & exceptions

```js
const { SpanStatusCode } = require('@opentelemetry/api');

span.setStatus({ code: SpanStatusCode.OK });
span.setStatus({ code: SpanStatusCode.ERROR, message: 'payment declined' });

span.recordException(err); // records the error as an event with stack trace
```

`recordException` records the error but does **not** set status — set `ERROR` status separately so the span is marked failed. Default status is `UNSET`.

## Span kind

Describes the span's role in a trace. Defaults to `INTERNAL`. Pass it in the options (second arg) of `startActiveSpan`/`startSpan`:

```js
const { SpanKind } = require('@opentelemetry/api');

tracer.startActiveSpan('GET /users', { kind: SpanKind.SERVER }, (span) => { /* ... */ });
```

- `SERVER` — handling an inbound request
- `CLIENT` — making an outbound request
- `PRODUCER` / `CONSUMER` — async messaging (enqueue / dequeue)
- `INTERNAL` — in-process work (default)

Auto-instrumentation sets these for you; set them manually only on spans you create around network/messaging boundaries.

## Links

Associate a span with other spans that aren't its parent — e.g. a batch job span linked to the many request traces it processes.

```js
tracer.startActiveSpan('processBatch', {
  links: [{ context: someSpan.spanContext() }],
}, (span) => { /* ... */ });
```

## The active span

Add detail to whatever span is currently active (often one created by auto-instrumentation) without creating your own:

```js
const span = trace.getActiveSpan();
span?.setAttribute('feature.flag', 'beta'); // may be undefined if nothing is active
```

## Manual context propagation

When work escapes the active-span scope — a detached callback, an event emitter, a manually built promise, a `setTimeout` — re-attach the context explicitly with `context.with`:

```js
const { context, trace } = require('@opentelemetry/api');

const span = tracer.startSpan('background-job');           // not active
const ctx = trace.setSpan(context.active(), span);          // context with this span set

context.with(ctx, () => {
  // anything here (and spans created here) sees `span` as the active/parent span
  doDeferredWork();
  span.end();
});
```

Use this pattern whenever a child span shows up as its own root trace — it means the work ran outside the active context.

## Cross-service propagation

To continue a trace across a network call, trace context travels in HTTP headers (W3C `traceparent`/`tracestate`). The auto-instrumentation for `http`/`fetch`/`express` injects and extracts these automatically, so distributed traces "just work" between instrumented services.

For a transport that isn't auto-instrumented (a custom protocol, a queue message), inject/extract manually with the global propagator:

```js
const { propagation, context } = require('@opentelemetry/api');

// SENDER: inject current context into an outgoing carrier (e.g. message headers)
const carrier = {};
propagation.inject(context.active(), carrier);
// ...send `carrier` alongside the payload...

// RECEIVER: extract context, then run handling inside it
const ctx = propagation.extract(context.active(), incomingCarrier);
context.with(ctx, () => {
  tracer.startActiveSpan('handleMessage', { kind: SpanKind.CONSUMER }, (span) => {
    // this span continues the upstream trace
    span.end();
  });
});
```
