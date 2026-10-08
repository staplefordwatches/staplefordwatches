# Google Search and Shopping operating guide

The website changes prepare crawlable product, brand, journal and policy pages plus an inventory feed. Rankings and Shopping visibility still depend on accurate inventory, Merchant Center approval, demand, competition, site reputation, and ongoing content—not a one-time switch.

## 1. Merge and deploy

After the pull request is reviewed, merge it and wait for the production deployment. Confirm these URLs return HTTP 200:

- `https://staplefordwatches.co.uk/sitemap.xml`
- `https://staplefordwatches.co.uk/api/google-merchant-feed`
- An available and a sold `/watches/.../` URL: inspect the HTML before JavaScript runs for the model/reference, description, price/status and matching Product markup.
- A `/brands/.../` page and a journal article.
- `/contact/` and the delivery/returns pages: content must appear in the first response.
- An obsolete product slug: HTTP 301 to the current canonical product URL.
- An unknown product: HTTP 404. An unavailable catalogue: HTTP 503 with Retry-After, rather than a successful empty catalogue.

The sitemap and feed are generated from Airtable, so newly published inventory does not require hand-editing XML.

## 2. Complete every Airtable listing

Required for every available watch:

- SKU / Listing ID: unique and permanent; never reuse it for another watch.
- Brand and model title.
- Exact price and `Available` status.
- Main image and additional images.
- Original description written for that individual watch.
- Manufacturer reference / MPN. Do not invent one.
- GTIN/EAN/UPC when the watch genuinely has one. Leave it blank when it does not.
- Year, condition, contents, movement, case size, and case material where known.
- Product Type, such as `Dive Watch`, `Chronograph`, or `Dress Watch`.

Change the status immediately when a watch is reserved or sold. Sold and reserved watches retain their original product URLs, descriptions, photographs and references, remain in the organic sitemap, and are excluded from the Shopping feed. Sold pages show Sold, label any retained price as the last listed price, disable purchase and offer available alternatives or a sourcing enquiry. Do not turn every sold URL into a redirect to the home page.

Blank or unknown status is not treated as available. Draft and incomplete records are not published. The feed requires a brand, title, unique ID, positive price and HTTPS image; duplicate IDs are withheld until corrected. `Google Shopping Ready` explicitly set to No/false blocks the feed. A blank readiness field is allowed for otherwise complete legacy listings. GTINs must have a valid length and checksum; a missing number does not prove that the manufacturer never assigned one, so the feed does not automatically claim `identifier_exists=no`. Never invent prices, references, GTINs, availability or provenance.

## 3. Configure Merchant Center

In Merchant Center, add a scheduled data source using:

`https://staplefordwatches.co.uk/api/google-merchant-feed`

Identify every existing data source before replacing one. Compare its item IDs, update times, prices and stock statuses with Airtable and the live website. Keep item IDs stable. Disable an obsolete source only after the replacement has fetched successfully and covers the correct stock; do not delete sources based on their age alone.

Set it to fetch at least daily and refresh promptly after stock changes. Keep the website domain verified and claimed and enable Free listings. Enable Shopping ads only as part of an authorised advertising campaign; this change creates no campaign and spends no advertising budget.

The feed defaults to **United Kingdom only**, in GBP with free UK shipping. International checkout remains available according to the delivery policy. Product-level shipping declarations are separate from checkout destinations.

For a deliberate international Merchant rollout, set Cloudflare `MERCHANT_TARGET_COUNTRIES` to comma-separated supported country codes, for example `GB,FR,US`. The existing £50 Europe and £80 international rates are retained for those explicitly selected markets. Adjust Merchant Center data-source countries, additional countries and shipping services as well: a code deployment cannot clear countries already selected in the account. Remove unintended markets only after confirming the intended sales strategy.

Account-level shipping and return settings must match the website and feed. Open **Needs attention**, download the issue report and inspect the exact reasons before requesting review. Connector status totals alone do not diagnose the cause of a rejection.

After the first fetch, work through **Needs attention** until there are no account-level issues and no fixable item disapprovals. Never add guessed GTINs to silence an identifier warning.

## 4. Configure Search Console

Use a Domain property for `staplefordwatches.co.uk`, then submit:

`https://staplefordwatches.co.uk/sitemap.xml`

Check:

- Page indexing: product and journal URLs should be indexed, not treated as duplicates of the home page.
- Shopping / Product snippets: no required-property errors.
- Core Web Vitals: no poor mobile URL group.
- Manual actions and Security issues: both clear.

Inspect and request indexing for the home page, `/buy/`, the strongest available products, and each substantial new journal guide. Do not repeatedly request indexing for unchanged URLs.

## 5. International growth

The current English, GBP, `.co.uk` site is strongest for the UK. It can sell abroad and participate in supported cross-border Shopping programmes, but genuine local organic growth should use dedicated market versions only when the business can maintain them—for example `/en-us/` with USD pricing and US delivery/returns, or `/fr-fr/` with professionally translated French content and EUR pricing.

When those versions exist, each page needs self-referencing canonicals and reciprocal `hreflang` annotations. Do not create thin country copies or automatic translations merely to add country keywords.

## 6. Work that drives rankings

Technical correctness makes pages eligible; it does not create authority. Each month:

1. Publish two genuinely useful guides based on real watch expertise and inventory, then link them to relevant products and brand/category pages.
2. Improve thin product descriptions with provenance, condition specifics, servicing history, measurements, and original photography.
3. Earn editorial links and mentions from relevant watch publications, collectors, events, suppliers, and partners. Do not buy bulk links.
4. Review Search Console queries and improve pages already ranking in positions 4–20 before creating overlapping pages.
5. Review Merchant Center diagnostics, price/availability mismatches, clicks, conversions, and country profitability.

## 7. Measurement

Track organic and Shopping results separately by country. The minimum useful dashboard is:

- Search Console non-brand clicks, impressions, average position, and indexed product count.
- Merchant Center approved/disapproved item count and free-listing clicks.
- Google Ads Shopping spend, conversion value, and return on ad spend when ads are active.
- Revenue, enquiries, and completed purchases by landing page and country.

Expect crawling and Merchant Center processing in days; meaningful competitive ranking movement usually takes weeks or months. No reputable implementation can guarantee position one, but this setup removes the main technical barriers and creates a maintainable workflow.

