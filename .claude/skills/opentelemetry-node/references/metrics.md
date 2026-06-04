# Metrics

Metrics are numeric measurements aggregated over time (request counts, latencies, queue depth). You get a **meter** from the API, create **instruments**, and record values with **attributes** (dimensions). The SDK aggregates and exports them on an interval via the `PeriodicExportingMetricReader` (see `setup.md`).

## Get a meter

```js
const { metrics } = require('@opentelemetry/api');
const meter = metrics.getMeter('my-app', '1.0.0');
```

## Choosing an instrument

Two families: **synchronous** (you call `.add()`/`.record()` at the moment something happens) and **observable/asynchronous** (you register a callback the SDK invokes at collection time to read a current value).

| Instrument | Use for | How |
|---|---|---|
| Counter | monotonically increasing totals (requests, bytes sent) | `createCounter` → `.add(n, attrs)` |
| UpDownCounter | values that go up and down (active connections, queue length) | `createUpDownCounter` → `.add(±n, attrs)` |
| Histogram | distributions you want bucketed (latency, payload size) | `createHistogram` → `.record(value, attrs)` |
| Gauge (sync) | a current value sampled when you record it | `createGauge` → `.record(value, attrs)` |
| ObservableCounter | monotonic total read on demand from a source | `createObservableCounter` → `addCallback` |
| ObservableUpDownCounter | up/down total read on demand | `createObservableUpDownCounter` → `addCallback` |
| ObservableGauge | current value read on demand (memory, temperature) | `createObservableGauge` → `addCallback` |

Rule of thumb: if a number is computed by *your code as events happen*, use a synchronous instrument. If it's read from *somewhere else at collection time* (a system metric, a library's internal counter), use an observable one.

## Synchronous instruments

```js
const requests = meter.createCounter('http.server.requests', {
  description: 'Total HTTP requests',
  unit: '{request}',
});
requests.add(1, { 'http.route': '/users', 'http.response.status_code': 200 });

const active = meter.createUpDownCounter('http.server.active_requests');
active.add(1);   // request started
active.add(-1);  // request finished

const latency = meter.createHistogram('http.server.duration', {
  description: 'Request duration',
  unit: 'ms',
});
latency.record(142, { 'http.route': '/users' });

const queueDepth = meter.createGauge('worker.queue.depth');
queueDepth.record(getQueueLength());
```

The `unit` follows UCUM conventions: `ms`, `s`, `By` (bytes), `1` (dimensionless ratio), or annotations like `{request}`.

## Observable (async) instruments

Register a callback; the SDK calls it each collection interval and you `observe` the current value. Don't keep a stored value and `.add()` to it for these — observe the absolute reading.

```js
const heap = meter.createObservableGauge('process.memory.heap_used', { unit: 'By' });
heap.addCallback((result) => {
  result.observe(process.memoryUsage().heapUsed);
});

// One callback can observe multiple instruments via batched registration:
const rss = meter.createObservableGauge('process.memory.rss', { unit: 'By' });
meter.addBatchObservableCallback(
  (result) => {
    const m = process.memoryUsage();
    result.observe(heap, m.heapUsed);
    result.observe(rss, m.rss);
  },
  [heap, rss]
);
```

## Attributes (dimensions)

Each distinct attribute set produces a separate time series. Keep cardinality bounded — use stable, low-cardinality keys (route template `/users/:id`, not the concrete `/users/12345`; status class or code, not a free-form message). Unbounded attribute values (user IDs, request IDs, timestamps) explode memory and backend cost.

## Views & aggregation

Views customize how an instrument is aggregated or rename/filter it — most commonly to set explicit histogram bucket boundaries. Configure on the `MeterProvider` (or via `NodeSDK`'s `views` option):

```js
const { View, ExplicitBucketHistogramAggregation } = require('@opentelemetry/sdk-metrics');

new View({
  instrumentName: 'http.server.duration',
  aggregation: new ExplicitBucketHistogramAggregation([0, 5, 10, 25, 50, 100, 250, 500, 1000]),
});
```

Other uses: drop an instrument (`aggregation: new DropAggregation()`), or strip high-cardinality attribute keys via `attributeKeys`. Default histogram buckets are fine for most cases — reach for views when the defaults don't fit your latency profile.
