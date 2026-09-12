# Stapleford catalogue cache setup

Complete this setup before merging the cache change into production. The binding below makes one saved catalogue work across Cloudflare's whole network; that is the important step for keeping Airtable comfortably below the free allowance while updates remain dependable.

## One-time Cloudflare setup

1. In Cloudflare, create a Workers KV namespace named `stapleford-catalog-cache`.
2. Open the Stapleford Watches Pages project, then go to **Settings → Bindings → KV namespace bindings**.
3. Add the namespace to both Production and Preview with the variable name `CATALOG_CACHE`.
4. Redeploy the latest commit so the binding is available to the Pages Functions.

Without the KV binding, the website still uses Cloudflare's local edge cache, but different locations cannot share it. With KV, visitors in different locations reuse the same catalogue snapshot and do not each cause Airtable traffic.

## Keep catalogue changes instant

The production function creates and renews two authenticated Airtable API webhooks automatically: one for Watches and one for Journal. Airtable signs every notification, and the function rejects notifications whose signature does not match. The receiver retrieves all pending Airtable webhook payload pages, advances the saved cursor, and only acknowledges the notification after the affected catalogue has been rebuilt successfully. Failed rebuilds return a retryable response. No paid Airtable automation is required.

The Airtable personal access token used by Cloudflare must include the `webhook:manage` scope as well as its existing record access. Webhook status is available at `https://staplefordwatches.co.uk/api/airtable-webhook`; this endpoint exposes health only and never returns secrets or webhook IDs.

Watches also use a one-minute blocking freshness limit. This is deliberately independent of webhook delivery: once the shared snapshot is a minute old, the next catalogue request waits for Airtable and returns the new source data in that same response. If Airtable is temporarily unavailable, the last good snapshot remains available. Airtable webhooks expire after seven days unless renewed, so catalogue cache maintenance also checks their expiry and renews them at least two days early.

Stripe payment events already update the shared watch status and remove the old edge copy, so a sold watch is not left behind waiting for the normal refresh.

## Quick verification

After deployment, request `/api/watches` twice and inspect the response header `X-Stapleford-Cache`:

- `MISS` means Airtable was read and a new snapshot was saved.
- `EDGE` means Cloudflare served its nearby copy.
- `SHARED` means this Cloudflare location reused the global KV snapshot.
- `STALE` means Airtable had a problem and the last good catalogue was served so the website stayed online.

The KV snapshot is global, so visitors share the same refresh rather than each causing an Airtable request. The one-minute watches limit allows at most one normal catalogue refresh per minute of active traffic in a single refresh path; webhook deliveries can refresh sooner. Monitor Airtable usage against the workspace plan because a continuously busy site can exceed the allowance of a free Airtable workspace.
