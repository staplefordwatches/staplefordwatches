import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { DEFAULT_HOMEPAGE, homepageSettings, loadHomepage } from '../functions/api/homepage.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function frontend(name, globals) {
  const match = html.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'));
  assert.ok(match, name);
  const context = vm.createContext(globals);
  vm.runInContext(match[0], context);
  return context[name];
}

test('homepage settings keep safe defaults when an image or crop is missing or invalid', () => {
  assert.deepEqual(homepageSettings(), DEFAULT_HOMEPAGE);
  const settings = homepageSettings({
    'Image URL':'javascript:alert(1)', 'Mobile Image URL':'https://user:pass@example.com/image.jpg',
    'Desktop Focus':'120% 50%', 'Mobile Focus':'top; color:red',
  });
  assert.equal(settings.imageUrl, DEFAULT_HOMEPAGE.imageUrl);
  assert.equal(settings.mobileImageUrl, '');
  assert.equal(settings.desktopFocus, DEFAULT_HOMEPAGE.desktopFocus);
  assert.equal(settings.mobileFocus, DEFAULT_HOMEPAGE.mobileFocus);
});

test('the Homepage Airtable record selects the Cloudinary originals and independent crops', async () => {
  const previous = globalThis.fetch;
  const image = 'https://res.cloudinary.com/demo/image/upload/v123/home.jpg';
  globalThis.fetch = async (url, options) => {
    assert.equal(url.pathname, '/v0/appTest/Homepage');
    assert.equal(url.searchParams.get('filterByFormula'), '{Name}="Homepage"');
    assert.equal(options.headers.Authorization, 'Bearer test');
    return Response.json({records:[{fields:{'Image URL':image,'Desktop Focus':'40% 35%','Mobile Focus':'60% 50%'}}]});
  };
  try {
    const response = await loadHomepage({env:{AIRTABLE_TOKEN:'test',AIRTABLE_BASE_ID:'appTest'}});
    const data = await response.json();
    assert.equal(data.homepage.imageUrl, image);
    assert.equal(data.homepage.desktopFocus, '40% 35%');
    assert.equal(data.homepage.mobileFocus, '60% 50%');
  } finally { globalThis.fetch = previous; }
});

test('an Airtable outage signals failure so the cache retains the last good image', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('', {status:503});
  try {
    const response = await loadHomepage({env:{AIRTABLE_TOKEN:'test',AIRTABLE_BASE_ID:'appTest'}});
    assert.equal(response.status, 503);
  } finally { globalThis.fetch = previous; }
  const fallback = await loadHomepage({env:{}});
  assert.equal((await fallback.json()).homepage.imageUrl, '/assets/homepage-watch.jpg');
});

test('logo navigation opens the distinct homepage', () => {
  const calls = [];
  const goHome = frontend('goHome', {
    closeAllMenus(){}, closeLightbox(){},
    setRoute:key=>calls.push(['url',key]), showRoute:key=>calls.push(['view',key]),
    $:()=>null, scrollToRouteStart(){},
  });
  goHome();
  assert.deepEqual(calls, [['url','home'],['view','home']]);
});

test('homepage search navigates to the catalogue with the entire query', () => {
  const calls = [];
  const goCatalog = frontend('goCatalog', {
    closeAllMenus(){}, closeLightbox(){}, watchesLoaded:true,
    setCatalogSearchUrl:(replace,path)=>calls.push([replace,path]),
    showRoute:key=>calls.push(key), scrollToRouteStart(){},
  });
  goCatalog('  Perpetual Calendar  ');
  assert.deepEqual(calls, [[false,'/buy/'],'buy']);
});

test('search URLs preserve spaces, apostrophes and ampersands for reload and back navigation', () => {
  let url;
  const update = frontend('setCatalogSearchUrl', {
    searchQuery:"Men's & Perpetual Calendar", routeKey:()=> 'home',
    history:{pushState:(_state,_title,next)=>url=next},
  });
  update();
  assert.equal(new URL(url, 'https://example.com').searchParams.get('q'), "Men's & Perpetual Calendar");
  assert.ok(url.startsWith('/buy/?q='));
});

test('the complete production script compiles', () => {
  const source = html.match(/<script id="stapleford-production-js">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(source));
});
