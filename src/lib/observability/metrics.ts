import { Counter, Gauge, Histogram, Registry } from 'prom-client';

let registry: Registry;
let httpDuration: Histogram<'method' | 'route' | 'status'>;
let httpTotal: Counter<'method' | 'route' | 'status'>;
let dbDuration: Histogram<'operation'>;
let collabConnections: Gauge;
let collabDocUpdates: Counter;
let webhookTotal: Counter<'event' | 'outcome'>;
let webhookDuration: Histogram<'event' | 'outcome'>;
let notificationsSent: Counter<'channel'>;

function build(): void {
  registry = new Registry();
  httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  dbDuration = new Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query latency in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [registry],
  });
  collabConnections = new Gauge({
    name: 'collab_active_connections',
    help: 'Currently open collaboration websocket connections',
    registers: [registry],
  });
  collabDocUpdates = new Counter({
    name: 'collab_doc_updates_total',
    help: 'Total Yjs document updates applied',
    registers: [registry],
  });
  webhookTotal = new Counter({
    name: 'webhook_delivery_total',
    help: 'Total outbound webhook delivery attempts',
    labelNames: ['event', 'outcome'],
    registers: [registry],
  });
  webhookDuration = new Histogram({
    name: 'webhook_delivery_duration_seconds',
    help: 'Outbound webhook delivery latency in seconds',
    labelNames: ['event', 'outcome'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  notificationsSent = new Counter({
    name: 'notifications_sent_total',
    help: 'Total notifications sent',
    labelNames: ['channel'],
    registers: [registry],
  });
}

build();

export function metricsRegistry(): Registry {
  return registry;
}

export function resetMetrics(): void {
  build();
}

export function observeHttp(s: {
  method: string;
  route: string;
  status: number;
  durationSec: number;
}): void {
  const labels = { method: s.method, route: s.route, status: String(s.status) };
  httpTotal.inc(labels);
  httpDuration.observe(labels, s.durationSec);
}

export function observeDb(s: { operation: string; durationSec: number }): void {
  dbDuration.observe({ operation: s.operation }, s.durationSec);
}

export function setCollabConnections(n: number): void {
  collabConnections.set(n);
}

export function incCollabDocUpdate(n = 1): void {
  collabDocUpdates.inc(n);
}

export function incWebhook(s: {
  event: string;
  outcome: 'success' | 'failed';
  durationSec: number;
}): void {
  const labels = { event: s.event, outcome: s.outcome };
  webhookTotal.inc(labels);
  webhookDuration.observe(labels, s.durationSec);
}

export function incNotificationsSent(s: { channel: string }): void {
  notificationsSent.inc({ channel: s.channel });
}
