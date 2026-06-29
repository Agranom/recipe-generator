# Logs

OpenTelemetry logs are designed primarily as a **bridge**: you keep your existing logger (Winston, Pino, Bunyan) and OTel captures its output as log records, automatically stamping them with the active `trace_id` and `span_id`. That correlation — jumping from a log line to the trace it belongs to — is the main reason to wire logs through OTel. Direct use of the logs API exists but is mainly for bridge authors.

## Recommended: bridge an existing logger

The auto-instrumentation bundle (`getNodeAutoInstrumentations()`) includes log appenders for the common loggers. As long as the SDK is configured with a `LoggerProvider` / `logRecordProcessors` (see `setup.md`), your normal log calls are emitted as OTel log records and correlated with the current span — no code change at call sites:

```js
const logger = require('pino')();
// inside an active span:
logger.info({ orderId }, 'order placed'); // emitted as an OTel log record carrying trace_id + span_id
```

If you're configuring instrumentations manually rather than via the full bundle, add the specific appender:

```bash
npm install @opentelemetry/instrumentation-pino
# or -winston, -bunyan
```

```js
const { PinoInstrumentation } = require('@opentelemetry/instrumentation-pino');
registerInstrumentations({ instrumentations: [new PinoInstrumentation()] });
```

Make sure logs are actually exported: the SDK needs a log exporter/processor (`OTLPLogExporter` + `BatchLogRecordProcessor`, or `ConsoleLogRecordExporter` for local debugging). See the full `NodeSDK` setup in `setup.md`.

## Direct logs API

For emitting log records directly (e.g. you have no logger, or you're building your own bridge), use `@opentelemetry/api-logs`:

```js
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const otelLogger = logs.getLogger('my-app', '1.0.0');

otelLogger.emit({
  severityNumber: SeverityNumber.INFO,
  severityText: 'INFO',
  body: 'order placed',
  attributes: { 'order.id': orderId },
});
```

`emit` automatically associates the record with the active span's context, so the log carries `trace_id`/`span_id` when called inside a span. Severity follows the OTel scale (`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL` via `SeverityNumber`).

## Guidance

- Prefer the bridge approach. Most teams already have a logger; bridging gives trace correlation with essentially zero call-site changes.
- Keep `body` for the human-readable message and put structured fields in `attributes` so they're queryable.
- Don't log secrets or PII into attributes/body — log records flow to your backend like any other telemetry.
- During development, point logs at `ConsoleLogRecordExporter` to confirm records (with their trace IDs) are being produced before switching to OTLP.
