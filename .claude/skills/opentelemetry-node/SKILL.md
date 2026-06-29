---
name: opentelemetry-node
description: Instrument Node.js and TypeScript applications with OpenTelemetry. Use this skill whenever the user wants to add observability, distributed tracing, spans, metrics, or logs to a JavaScript/TypeScript service — including initializing the OpenTelemetry SDK, bootstrapping NodeSDK, creating or nesting spans, recording attributes/events/exceptions, propagating trace context, defining counters/histograms/gauges, wiring up OTLP or console exporters, or setting up auto-instrumentation for Express/HTTP/databases. Trigger this even when the user just says "add tracing", "instrument this service", "set up otel", "emit metrics", or mentions Jaeger, Tempo, an OTLP collector, or a tracing backend, even if they don't say "OpenTelemetry" explicitly.
---

# OpenTelemetry for Node.js / TypeScript

This skill instruments Node.js and TypeScript apps with OpenTelemetry (OTel): SDK bootstrap, traces/spans, metrics, and logs, exporting over OTLP or to the console.

## The single most important rule

**OpenTelemetry must be initialized before any application code runs.** Auto-instrumentation works by monkey-patching modules (`http`, `express`, `pg`, etc.) at `require`/`import` time. If your app loads those modules before the SDK starts, they won't be patched and you'll see no telemetry.

Always load the init file *first*, via Node's `--require` (CommonJS) or `--import` (ESM) flag — never by importing it from inside `app.js`:

```bash
# CommonJS
node --require ./instrumentation.js app.js
# ESM
node --import ./instrumentation.mjs app.js
```

Ready-to-use bootstrap files are in `assets/instrumentation.js` (CJS) and `assets/instrumentation.mjs` (ESM). Copy one in and adjust the service name and exporter endpoint — that covers most setups.

## Workflow

1. **Determine the goal.** Pick the smallest path that satisfies the request:
   - "Just get traces flowing" → install core packages + auto-instrumentation, drop in a bootstrap file (`assets/`), point it at an exporter. Often no manual span code is needed.
   - "Create custom spans / metrics / logs" → bootstrap as above, then add manual instrumentation using the API (`@opentelemetry/api`).
2. **Confirm CommonJS vs ESM.** Check `"type"` in `package.json` (or whether the codebase uses `import`/`require`). This decides which bootstrap file and load flag to use. When unsure, ask or inspect a source file.
3. **Confirm the destination.** Default to OTLP/HTTP at `http://localhost:4318` (the standard collector port) unless the user names a backend or wants console output for local debugging. The console exporter is the fastest way to verify the pipeline works.
4. **Install, bootstrap, then instrument.** Install packages (below), copy a bootstrap file, then add manual spans/metrics/logs only where the user wants detail beyond what auto-instrumentation gives.
5. **Verify.** Suggest the console exporter first, or `diag` debug logging (see `references/setup.md`), so the user can confirm telemetry is emitted before pointing it at a real backend.

## Installation

Core API + SDK + auto-instrumentation + an OTLP/HTTP exporter set:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http
```

- `@opentelemetry/api` is the only package application code imports for manual instrumentation. Keep it as a normal dependency.
- For gRPC instead of HTTP, swap the exporter packages for `-otlp-grpc` variants and use port `4317`.

## Minimal SDK init (the gist)

```js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-service',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => sdk.shutdown().finally(() => process.exit(0)));
```

The full version (metrics + logs + console fallback + graceful shutdown, both CJS and ESM) lives in `assets/`. Read `references/setup.md` for the manual provider approach, environment-variable config, and ESM caveats.

## Creating a span (the gist)

```js
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const tracer = trace.getTracer('my-app', '1.0.0');

function doWork(input) {
  return tracer.startActiveSpan('doWork', (span) => {
    try {
      span.setAttribute('input.size', input.length);
      const result = heavyComputation(input);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end(); // ALWAYS end the span, even on error
    }
  });
}
```

`startActiveSpan` makes the span the *active* span, so any spans (manual or auto-instrumented) created inside the callback automatically become its children — this is what builds the trace tree. The callback may be `async`; just `return` the promise. See `references/tracing.md` for nesting, span kinds, events, links, and manual context propagation.

## Reference material

Read the file matching the task — don't load all of them up front:

- **`references/setup.md`** — SDK initialization in depth: `NodeSDK` vs manual providers, `Resource` attributes, OTLP (HTTP/gRPC) and console exporters, batch vs simple processors, environment-variable configuration, ESM vs CommonJS, sampling, and `diag` debug logging.
- **`references/tracing.md`** — Spans and traces: tracers, `startActiveSpan` vs `startSpan`, attributes, events, links, status, `recordException`, `SpanKind`, nested/child spans, getting the active span, and propagating context across async boundaries and services.
- **`references/metrics.md`** — Metrics: meters and all instrument types (counter, up-down counter, histogram, gauge, and the observable/async variants), attributes/dimensions, units, and views/aggregation.
- **`references/logs.md`** — Logs: bridging existing loggers (Winston/Pino/Bunyan) to OTel so logs carry trace context, plus the direct logs API.

## Common pitfalls

- **No data at all** → the init file isn't loading first. Confirm `--require`/`--import`, not an in-app import. This is the #1 cause.
- **Spans never appear / hang** → a span was never `.end()`ed, or the process exited before the `BatchSpanProcessor` flushed. End every span and call `sdk.shutdown()` on exit.
- **Child spans show as separate traces** → work ran outside the active-span context (e.g. a detached callback or a `new Promise` that escaped). Use `startActiveSpan`, or wrap the work in `context.with(...)`. See `references/tracing.md`.
- **Import errors after install** → OpenTelemetry JS APIs shift between major versions (e.g. `Resource` construction, semantic-convention constant names, whether `sdk.start()` returns a promise). If an import or call fails, check the installed package's actual exports in `node_modules` rather than assuming; the patterns here target current major versions.
- **TypeScript** → all packages ship their own type declarations; the imports and code above are identical, just written with `import`. No `@types/...` packages are needed.
