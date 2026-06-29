// OpenTelemetry bootstrap (CommonJS).
//
// Load this BEFORE your application code:
//   node --require ./instrumentation.js app.js
//
// Configure via env vars or edit the values below:
//   OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_LOG_LEVEL=debug
//
// Toggle CONSOLE_DEBUG to print telemetry to stdout instead of shipping it,
// which is the quickest way to confirm the pipeline works with no backend.

'use strict';

const CONSOLE_DEBUG = process.env.OTEL_CONSOLE_DEBUG === 'true';
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'my-service';

const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
if (process.env.OTEL_LOG_LEVEL === 'debug') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');

const { PeriodicExportingMetricReader, ConsoleMetricExporter } = require('@opentelemetry/sdk-metrics');
const { BatchLogRecordProcessor, SimpleLogRecordProcessor, ConsoleLogRecordExporter } = require('@opentelemetry/sdk-logs');
const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');

const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');

const traceExporter = CONSOLE_DEBUG
  ? new ConsoleSpanExporter()
  : new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` });

const metricExporter = CONSOLE_DEBUG
  ? new ConsoleMetricExporter()
  : new OTLPMetricExporter({ url: `${OTLP_ENDPOINT}/v1/metrics` });

const logExporter = CONSOLE_DEBUG
  ? new ConsoleLogRecordExporter()
  : new OTLPLogExporter({ url: `${OTLP_ENDPOINT}/v1/logs` });

const logProcessor = CONSOLE_DEBUG
  ? new SimpleLogRecordProcessor(logExporter)
  : new BatchLogRecordProcessor(logExporter);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.0',
    'deployment.environment.name': process.env.NODE_ENV || 'development',
  }),
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15000,
  }),
  logRecordProcessors: [logProcessor],
  instrumentations: [
    getNodeAutoInstrumentations({
      // The fs instrumentation is very noisy; disable unless you need it.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();
diag.info(`OpenTelemetry started for "${SERVICE_NAME}" (${CONSOLE_DEBUG ? 'console debug' : OTLP_ENDPOINT})`);

// Flush buffered telemetry on shutdown so batched data isn't dropped.
function shutdown() {
  sdk
    .shutdown()
    .then(() => diag.info('OpenTelemetry shut down cleanly'))
    .catch((err) => diag.error('OpenTelemetry shutdown error', err))
    .finally(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
