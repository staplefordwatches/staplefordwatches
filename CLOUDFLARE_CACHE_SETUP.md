# Stapleford catalogue cache setup

Complete this setup before merging the cache change into production. The binding below makes one saved catalogue work across Cloudflare's whole network; that is the important step for keeping Airtable comfortably below the free allowance while updates remain dependable.

## One-time Cloudflare setup

1. In Cloudflare, create a Workers KV namespace named `stapleford-catalog-cache`.
2. Open the Stapleford Watches Pages project, then go to **Settings → Bindings → KV namespace bindings**.
3. Add the namespace to both Production and Preview with the variable name `CATALOG_CACHE`.
4. Add an encrypted secret named `CACHE_REFRESH_TOKEN` to Production and Preview. Use a long, random value and do not put it in GitHub.
5. Redeploy the latest commit so both bindings are available to the Pages Functions.

Without the KV binding, the website still uses Cloudflare's local edge cache, but different locations cannot share it. With KV, visitors in different locations reuse the same catalogue snapshot and do not each cause Airtable traffic.

## Keep catalogue changes instant

The automatic fallback refresh is every six hours. To make an Airtable edit appear immediately, add an Airtable automation that runs after a Watches record changes and calls:

```text
GET https://staplefordwatches.co.uk/api/watches
X-Stapleford-Refresh-Token: the same CACHE_REFRESH_TOKEN value
```

For changes to a Journal record, call:

```text
GET https://staplefordwatches.co.uk/api/journal
X-Stapleford-Refresh-Token: the same CACHE_REFRESH_TOKEN value
```

Stripe payment events already update the shared watch status and remove the old edge copy, so a sold watch is not left behind waiting for the normal refresh.

## Quick verification

After deployment, request `/api/watches` twice and inspect the response header `X-Stapleford-Cache`:

- `MISS` means Airtable was read and a new snapshot was saved.
- `EDGE` means Cloudflare served its nearby copy.
- `SHARED` means this Cloudflare location reused the global KV snapshot.
- `STALE` means Airtable had a problem and the last good catalogue was served so the website stayed online.

With the shared cache running, the normal background budget is roughly 240 Airtable reads per 30 days for Watches and Journal combined, plus genuine actions such as checkout, newsletter sign-up, sell submissions, and intentional refreshes. This leaves a substantial margin below 1,000.
