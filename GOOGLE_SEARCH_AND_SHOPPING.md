# Google Search and Shopping operating guide

This repository now produces the technical inputs Google needs. Rankings and Shopping visibility still depend on accurate inventory, Merchant Center approval, demand, competition, site reputation, and ongoing content—not a one-time switch.

## 1. Merge and deploy

After the pull request is reviewed, merge it and wait for the production deployment. Confirm these URLs return HTTP 200:

- `https://staplefordwatches.co.uk/sitemap.xml`
- `https://staplefordwatches.co.uk/api/google-merchant-feed`
- At least one live `/watches/.../` URL

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

Change the status immediately when a watch is reserved or sold. Sold and reserved watches remain useful organic pages but are excluded from the Shopping feed.

## 3. Configure Merchant Center

In Merchant Center, add a scheduled data source using:

`https://staplefordwatches.co.uk/api/google-merchant-feed`

This direct XML source replaces the old Make.com → Google Sheets catalogue bridge. Keep that Make scenario paused until Merchant Center has completed a successful fetch and the item totals match; it can then be deleted along with its Airtable and Google connections.

Set it to fetch daily. Keep the website domain verified and claimed, and enable both Free listings and Shopping ads.

The feed currently declares:

- United Kingdom: free shipping.
- Europe: £50 shipping.
- United States, Canada, Australia, New Zealand, Japan, Singapore, Hong Kong, and UAE: £80 shipping.

Only select target countries in Merchant Center where the business is ready to honour the published delivery, customs, returns, tax, and customer-service terms. Merchant Center account-level shipping and return settings must exactly match the website and feed; contradictory settings are a common reason for disapproval.

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
