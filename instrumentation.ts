import dotenv from 'dotenv';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { AggregationTemporality, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT_NAME, ATTR_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { HostMetrics } from '@opentelemetry/host-metrics';

dotenv.config({ path: '.env' });

const token = process.env.OTEL_EXPORTER_OTLP_AUTH_TOKEN;
const commonHeaders = {
  'Authorization': `Basic ${token}`,
};

const otelSDK = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'recipe-generator',
    [ATTR_SERVICE_VERSION]: process.env.K_REVISION,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV,
    [ATTR_SERVICE_INSTANCE_ID]: process.env.HOSTNAME ?? 'local',
  }),
  traceExporter: new OTLPTraceExporter({
    headers: commonHeaders,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      headers: commonHeaders,
      temporalityPreference: AggregationTemporality.CUMULATIVE,
    }),
    exportIntervalMillis: 5000,
  }),
  logRecordProcessor: new SimpleLogRecordProcessor(
    new OTLPLogExporter({
      headers: commonHeaders,
    })),
  instrumentations: [
    new ExpressInstrumentation(),
    new HttpInstrumentation(),
    new PinoInstrumentation(),
    new RuntimeNodeInstrumentation(),
  ],
});

otelSDK.start();

const hostMetrics = new HostMetrics({ name: 'recipe-generator' });

hostMetrics.start();

export { otelSDK };
