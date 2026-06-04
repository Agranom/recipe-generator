# SDK Setup & Exporters

How to initialize the OpenTelemetry SDK for Node.js, configure resources and exporters, and debug the pipeline.

## Table of contents

- [Two ways to initialize](#two-ways-to-initialize)
- [NodeSDK (recommended)](#nodesdk-recommended)
- [Resources](#resources)
- [Exporters](#exporters)
- [Span & metric processors](#span--metric-processors)
- [Environment-variable configuration](#environment-variable-configuration)
- [ESM vs CommonJS](#esm-vs-commonjs)
- [Sampling](#sampling)
- [Manual providers (without NodeSDK)](#manual-providers-without-nodesdk)
- [Debugging the pipeline](#debugging-the-pipeline)

## Two ways to initialize

1. **`NodeSDK`** from `@opentelemetry/sdk-node` — one object that wires up traces, metrics, logs, context management, and auto-instrumentation. Use this unless you have a reason not to.
2. **Manual providers** — construct `NodeTracerProvider`, `MeterProvider`, `LoggerProvider` yourself. More verbose; use only when you need fine control the `NodeSDK` options don't expose. See the last section.

Both must run before application code (load via `--require`/`--import`).

## NodeSDK (recommended)

Full setup covering all three signals, with OTLP exporters:

```js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');

const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-service',
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment.name': process.env.NODE_ENV ?? 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: 'http://localhost:4318/v1/metrics' }),
    exportIntervalMillis: 15000,
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({ url: 'http://localhost:4318/v1/logs' })
    ),
  ],
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Flush and close cleanly so the batch processors don't drop buffered data.
const shutdown = () => sdk.shutdown().then(
  () => console.log('OTel shut down'),
  (err) => console.error('OTel shutdown error', err),
).finally(() => process.exit(0));

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

Notes:
- In current major versions `sdk.start()` is synchronous and returns `void`. Older versions returned a promise. `sdk.shutdown()` always returns a promise.
- Omit any of `traceExporter`, `metricReader`, or `logRecordProcessors` to disable that signal. Setting `traceExporter` alone gives you traces only.
- `getNodeAutoInstrumentations()` enables a large bundle (HTTP, Express, Fastify, gRPC, pg, mysql, redis, mongodb, and more). Disable individual ones by passing config, e.g. `getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })` — the `fs` instrumentation is noisy and commonly turned off.

## Resources

A *resource* describes the entity producing telemetry (the service). `service.name` is the most important attribute — backends group and name services by it. Without it you'll see `unknown_service`.

```js
const { resourceFromAttributes, defaultResource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

// Merge your attributes onto the auto-detected defaults (host, process, etc.)
const resource = defaultResource().merge(
  resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'my-service' })
);
```

`NodeSDK` merges your `resource` with detected defaults automatically, so passing just `resourceFromAttributes({...})` is fine there.

> Version note: older code used `new Resource({ ... })` and `SemanticResourceAttributes.SERVICE_NAME`. Current versions use the `resourceFromAttributes()` factory and `ATTR_SERVICE_NAME`-style constants. If one form errors, the package version expects the other.

## Exporters

| Goal | Trace package | Port / path |
|------|---------------|-------------|
| OTLP over HTTP (default) | `@opentelemetry/exporter-trace-otlp-http` | `4318`, `/v1/traces` |
| OTLP over gRPC | `@opentelemetry/exporter-trace-otlp-grpc` | `4317` |
| OTLP over HTTP+protobuf | `@opentelemetry/exporter-trace-otlp-proto` | `4318` |
| Console (debug) | `ConsoleSpanExporter` from `@opentelemetry/sdk-trace-base` | n/a |

Metrics and logs mirror this with `exporter-metrics-otlp-*` and `exporter-logs-otlp-*`, and `ConsoleMetricExporter` / `ConsoleLogRecordExporter`.

**Console exporter** — the fastest way to confirm the pipeline works without a backend. With `NodeSDK`:

```js
const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
// ...
const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});
```

Spans print to stdout as JSON. Swap to OTLP once you see them.

**OTLP headers / auth** (e.g. for a hosted backend):

```js
new OTLPTraceExporter({
  url: 'https://otlp.example.com/v1/traces',
  headers: { 'x-api-key': process.env.OTEL_API_KEY },
});
```

## Span & metric processors

- **`BatchSpanProcessor`** (the `NodeSDK` default for `traceExporter`) buffers spans and exports them in batches — use in production. The trade-off: buffered spans are lost if the process exits without `shutdown()`.
- **`SimpleSpanProcessor`** exports each span immediately. Useful for tests/debugging; too chatty for production.
- **`PeriodicExportingMetricReader`** pushes metrics on an interval (`exportIntervalMillis`, default 60s).

To use a non-default processor you generally drop to manual providers (last section), since `NodeSDK`'s `traceExporter` shortcut always wraps it in a `BatchSpanProcessor`.

## Environment-variable configuration

`NodeSDK` reads standard `OTEL_*` env vars, so you can move config out of code. Useful ones:

```bash
OTEL_SERVICE_NAME=my-service
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=prod,service.version=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318      # applies to all signals
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf               # or grpc, http/json
OTEL_TRACES_EXPORTER=otlp                               # or console, none
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1                             # sample 10%
OTEL_LOG_LEVEL=debug                                    # internal diagnostics
```

A clean pattern: set `service.name` and exporter endpoint via env vars, keep only auto-instrumentation config in code.

## ESM vs CommonJS

**CommonJS** (`package.json` has no `"type": "module"`): use a `.js` bootstrap and `node --require ./instrumentation.js app.js`.

**ESM** (`"type": "module"` or `.mjs`): module loading differs and import-time patching needs the loader hook. Use `--import`:

```bash
node --import ./instrumentation.mjs app.js
```

Inside the ESM bootstrap, the SDK setup code is the same (using `import`), and `@opentelemetry/auto-instrumentations-node` registers the necessary module-loader hook automatically when started via `--import`. If auto-instrumentation of ESM-only dependencies still doesn't patch, the official escape hatch is to run with `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`. Prefer `--import` first.

## Sampling

Control how many traces are kept. Set in code via the `sampler` option, or with env vars (above).

```js
const { TraceIdRatioBasedSampler, ParentBasedSampler } = require('@opentelemetry/sdk-trace-base');

const sdk = new NodeSDK({
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) }), // keep 10% of root traces; respect parent decision
  // ...
});
```

`ParentBasedSampler` keeps a trace intact across services: if an upstream service sampled the trace, downstream services honor that decision rather than re-rolling.

## Manual providers (without NodeSDK)

Use when you need control `NodeSDK` doesn't expose (custom processors, multiple exporters per signal, custom context manager). Traces example:

```js
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor, ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'my-service' }),
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' })),
    new BatchSpanProcessor(new ConsoleSpanExporter()), // export to two places at once
  ],
});

provider.register(); // sets the global tracer provider + context propagation

registerInstrumentations({ instrumentations: [getNodeAutoInstrumentations()] });
```

Metrics use `MeterProvider` + `PeriodicExportingMetricReader` from `@opentelemetry/sdk-metrics`; logs use `LoggerProvider` + processors from `@opentelemetry/sdk-logs`, registered globally via `logs.setGlobalLoggerProvider(...)` from `@opentelemetry/api-logs`.

## Debugging the pipeline

Turn on OpenTelemetry's internal diagnostic logging to see what the SDK is doing (exporter connections, dropped spans, config problems):

```js
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

Put this at the very top of the bootstrap file, before creating the SDK. Or set `OTEL_LOG_LEVEL=debug`. Checklist when nothing shows up: (1) is the bootstrap loaded via `--require`/`--import`? (2) is the collector/endpoint reachable from the app? (3) did the process exit before `shutdown()` flushed batched data?
