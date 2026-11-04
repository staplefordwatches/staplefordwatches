import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/create-checkout-session.js';
import { loadWatches } from '../functions/api/watches.js';
import { buildMerchantFeed } from '../functions/api/google-merchant-feed.js';
import { buildSitemap } from '../functions/sitemap.xml.js';

const watch = {
  listingId: 'SW999', brand: 'Rolex', title: 'Submariner', price: 10000,
  status: 'Coming soon', image: 'https://images.example.com/watch.jpg',
};

test('coming soon watches stay in the catalogue but have no shopping or sitemap links', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ records: [{
    id: 'recTest', fields: { SKU: watch.listingId, Brand: watch.brand, Title: watch.title, Price: watch.price, Status: watch.status },
  }] });
  try {
    const response = await loadWatches({ env: { AIRTABLE_TOKEN: 'test', AIRTABLE_BASE_ID: 'appTest' } });
    const data = await response.json();
    assert.equal(data.watches.length, 1);
    assert.equal(data.watches[0].status, 'Coming soon');
  } finally {
    globalThis.fetch = originalFetch;
  }
  for (const status of ['Coming soon', ' COMING SOON ']) {
    assert.doesNotMatch(buildMerchantFeed([{ ...watch, status }]), /<g:id>SW999<\/g:id>/);
    assert.doesNotMatch(buildSitemap({ watches: [{ ...watch, status }] }), /sw999/);
  }
  assert.match(buildMerchantFeed([{ ...watch, status: 'Available' }]), /<g:id>SW999<\/g:id>/);
  assert.match(buildSitemap({ watches: [{ ...watch, status: 'Available' }] }), /sw999/);
});

test('checkout checks the current Airtable status before contacting Stripe', async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    AIRTABLE_TOKEN: 'test', AIRTABLE_BASE_ID: 'appTest', STRIPE_SECRET_KEY: 'test',
    STRIPE_SHIPPING_RATE_UK: 'uk', STRIPE_SHIPPING_RATE_EUROPE: 'eu', STRIPE_SHIPPING_RATE_INTERNATIONAL: 'world',
  };
  let stripeCalls = 0;
  let currentStatus;
  globalThis.fetch = async (input) => {
    if (new URL(input).hostname === 'api.airtable.com') {
      return Response.json({ records: [{ id: 'recTest', fields: { SKU: watch.listingId, Price: watch.price, Status: currentStatus } }] });
    }
    stripeCalls += 1;
    return Response.json({ client_secret: 'test-client-secret' });
  };
  try {
    for (currentStatus of ['Coming soon', ' COMING SOON ', 'Sold', 'Reserved', 'Available']) {
      const response = await onRequestPost({ env, request: new Request('https://example.com/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watch: watch.listingId }),
      }) });
      assert.equal(response.status, currentStatus === 'Available' ? 200 : 409);
      if (currentStatus.trim().toLowerCase() === 'coming soon') assert.equal((await response.json()).error, 'This watch is coming soon.');
    }
    assert.equal(stripeCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const { readFile } = await import('node:fs/promises');
const { default: vm } = await import('node:vm');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function sourceFunction(name) {
  const start = html.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = html.slice(start);
  const next = rest.slice(1).search(/\n  (?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function frontend(names, globals = {}) {
  return vm.runInNewContext(
    ['status', 'isComingSoon', ...names].map(sourceFunction).join('\n') + `\n;({${names.join(',')}})`, globals,
  );
}

test('coming soon cards have a badge, no price, no link and no keyboard controls', () => {
  const { cardHtml } = frontend(['cardHtml'], {
    safeUrl: value => value || '', gridImage: value => value, gridSrcset: () => '',
    gridImageSizes: () => '100vw', displayName: item => `${item.brand} ${item.title}`,
    money: value => value ? String(value) : '', listingCardTitle: item => item.title,
    getReference: () => '', formatYear: value => value, listingColumns: () => 3,
    escapeHtml: value => String(value ?? ''), formatSpecValue: (_label, value) => value,
    getMovement: () => '',
  });
  for (const status of ['Coming soon', ' COMING SOON ']) {
    for (const price of [10000, '']) {
      const card = cardHtml({ ...watch, status, price, productLink: '/watches/test-sw999/' }, 0);
      assert.match(card, /class="coming-soon-badge catalog-search-pill">Coming soon<\/div>/);
      assert.doesNotMatch(card, /<a\b|<button\b|tabindex=|role="button"|data-product-link=|is-clickable/);
      assert.doesNotMatch(card, /£|PRICE ON REQUEST|POR/);
    }
  }
  const available = cardHtml({ ...watch, status: 'Available', productLink: '/watches/test-sw999/' }, 0);
  assert.match(available, /role="button" tabindex="0"/);
  assert.match(available, /href="\/watches\/test-sw999\/"/);
  assert.match(available, /£10000/);
  assert.doesNotMatch(available, /Coming soon/);
  assert.match(cardHtml({ ...watch, status: 'Sold' }, 0), />SOLD</);
  assert.match(cardHtml({ ...watch, status: 'Reserved' }, 0), />RESERVED</);
});

test('all attempts to open a coming soon product stop before opening the detail view', () => {
  const { openLightbox } = frontend(['openLightbox']);
  // No DOM is supplied: a bypass would attempt to use it and fail this check.
  for (const status of ['Coming soon', ' COMING SOON ']) {
    assert.doesNotThrow(() => openLightbox({ ...watch, status }));
  }
});

test('direct product links return to the catalogue for coming soon watches', () => {
  const calls = [];
  const { openProductFromUrl } = frontend(['openProductFromUrl'], {
    watchesLoaded: true, watches: [watch], requestedProductToken: () => 'rolex-submariner-sw999',
    slug: () => 'rolex-submariner-sw999', closeLightbox: value => calls.push(['close', value]),
    setRoute: (...args) => calls.push(['route', ...args]), showRoute: key => calls.push(['show', key]),
    openLightbox: () => assert.fail('Coming soon details must not open'),
  });
  assert.equal(openProductFromUrl(true), false);
  assert.deepEqual(calls, [['close', false], ['route', 'buy', true], ['show', 'buy']]);
});

test('a status refresh closes a product that has changed to coming soon', () => {
  let closed = false;
  const { renderLoaded } = frontend(['renderLoaded'], {
    prepare() {}, render() {}, catalogControlsApi: null, activeWatch: { listingId: watch.listingId },
    watchesById: new Map([[watch.listingId, watch]]), closeLightbox() { closed = true; },
    updateStructuredDataSoon() {}, saveCache() {},
  });
  assert.equal(renderLoaded([watch]), true);
  assert.equal(closed, true);
});
