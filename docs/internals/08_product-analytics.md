# Product analytics

This fork sends no product analytics. Upstream's PostHog delivery, install identity, and relay
tracing are removed, and `scripts/check-egress.ts` keeps their hosts out of shipped source.

What remains is local:

- **Agent feedback** ([`FeedbackService`](../../apps/server/src/feedback/FeedbackService.ts)) scrubs
  paths, private values, and secret-shaped strings, then saves reports in the environment's own
  database. Keep its payload rules even though nothing delivers reports: a user can still share
  them by hand, and the scrubbing is what makes that safe.
- **User-configured OpenTelemetry export** goes only to the endpoints the user sets
  ([observability runbook](../operations/04_observability.md)).

Telemetry must never derive identity from a provider's sign-in files or account, even hashed.
