// OpenTelemetry bootstrap (ESM).
//
// Load this BEFORE your application code:
//   node --import ./instrumentation.mjs app.js
//
// Use this version when your package.json has "type": "module" (or you use .mjs).
// Configure via env vars or edit the values below:
//   OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_LOG_LEVEL=debug
//   OTEL_CONSOLE_DEBUG=true  -> print telemetry to stdout instead of shipping it.

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const CONSOLE_DEBUG = process.env.OTEL_CONSOLE_DEBUG === 'true';
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'my-service';

if (process.env.OTEL_LOG_LEVEL === 'debug') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

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
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();
diag.info(`OpenTelemetry started for "${SERVICE_NAME}" (${CONSOLE_DEBUG ? 'console debug' : OTLP_ENDPOINT})`);

function shutdown() {
  sdk
    .shutdown()
    .then(() => diag.info('OpenTelemetry shut down cleanly'))
    .catch((err) => diag.error('OpenTelemetry shutdown error', err))
    .finally(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
