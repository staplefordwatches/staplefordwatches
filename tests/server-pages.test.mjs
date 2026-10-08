import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, runInNewContext } from "node:vm";
import { pageModel, renderPageDocument, productGraph } from "../functions/_utils/page-rendering.js";
import { watchUrl, validGtin, numericPrice } from "../functions/_utils/catalog-seo.js";
import { buildMerchantFeed, merchantCountries } from "../functions/api/google-merchant-feed.js";
import { buildSitemap } from "../functions/sitemap.xml.js";
import { loadWatches, getCatalog } from "../functions/api/watches.js";
import { onRequest } from "../functions/_middleware.js";
import { onRequestPost } from "../functions/api/create-checkout-session.js";
import { INFO_CONTENT } from "../functions/_utils/site-pages.js";

const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bond = { id:"recBond", listingId:"SW024", brand:"Omega", title:"Seamaster 300M James Bond 007", status:"Available", price:3250,
  image:"https://images.example.com/bond.jpg", description:"Individual watch: light marks, original box and papers.",
  specs:{reference:"2226.80.00", year:"2006", caseSize:"41 mm", movement:"Automatic", conditionNotes:"Light marks on the clasp."} };
const alternative = {...bond, id:"recOther", listingId:"SW025", title:"Seamaster Professional"};
const slot = (html, id) => html.match(new RegExp('<([a-z0-9]+)\\b[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)<\\/\\1>', 'i'))?.[2];
const jsonSlot = (html, id) => JSON.parse(slot(html, id));
class MemoryCache {
  values = new Map();
  async match(request){ return this.values.get(request.url)?.clone(); }
  async put(request,response){ this.values.set(request.url,response.clone()); }
}
function context(path="/", env={}) {
  return { request:new Request("https://staplefordwatches.co.uk"+path), env:{AIRTABLE_TOKEN:"test",AIRTABLE_BASE_ID:"appTest",CF_PAGES_BRANCH:"test",...env},
    waitUntil(){}, next:async()=>new Response(shell,{headers:{"Content-Type":"text/html; charset=utf-8","ETag":"old"}}) };
}
function record(watch=bond){ return {id:watch.id,fields:{SKU:watch.listingId,Brand:watch.brand,Title:watch.title,Price:watch.price,Status:watch.status,Reference:watch.specs.reference,"Main Image URL":watch.image,"Watch Description":watch.description}}; }
async function withFetch(fn, body){
  const original=globalThis.fetch; globalThis.fetch=fn; globalThis.caches={default:new MemoryCache()};
  try{await body();}finally{globalThis.fetch=original;}
}

test("James Bond product is readable without JavaScript and agrees with its offer",()=>{
  const model=pageModel(new URL(watchUrl(bond)).pathname,{watches:[bond,alternative]});
  const html=renderPageDocument(shell,model,{watches:[bond,alternative]});
  assert.match(html,/<h1[^>]*id="lightboxDetailTitle"[^>]*>Omega Seamaster 300M James Bond 007 2226\.80\.00<\/h1>/);
  assert.equal(slot(html,"lightboxDetailPrice"),"£3,250");
  assert.equal(slot(html,"lightboxDetailBuy"),"BUY NOW");
  assert.match(slot(html,"lightboxDetailDescription"),/original box and papers/);
  assert.match(slot(html,"lightboxDetailSpecs"),/41 mm/);
  assert.match(html,/<img[^>]*id="lightboxImage"[^>]*src="https:\/\/images\.example\.com\/bond\.jpg"/);
  const product=jsonSlot(html,"stapleford-server-jsonld")["@graph"][0];
  assert.equal(product.offers.price,3250);
  assert.equal(product.offers.availability,"https://schema.org/InStock");
  assert.equal(product.url,watchUrl(bond));
  assert.doesNotMatch(html.slice(0,html.indexOf('<script id="stapleford-production-js">')),/class="sw-booting"/);
});

test("sold watch remains indexable, cannot be bought and links available alternatives",()=>{
  const sold={...bond,status:"Sold"};
  const html=renderPageDocument(shell,pageModel(new URL(watchUrl(sold)).pathname,{watches:[sold,alternative]}),{watches:[sold,alternative]});
  assert.equal(slot(html,"lightboxDetailBuy"),"SOLD");
  assert.match(html,/<button[^>]*id="lightboxDetailBuy"[^>]* disabled/);
  assert.equal(slot(html,"lightboxDetailPrice"),"Last listed at £3,250");
  assert.equal(jsonSlot(html,"stapleford-server-jsonld")["@graph"][0].offers.availability,"https://schema.org/SoldOut");
  assert.doesNotMatch(html,/<meta name="robots" content="noindex/);
  assert.match(slot(html,"lightboxRelatedGrid"),/sw025/);
  assert.doesNotMatch(buildMerchantFeed([sold]),/<item>/);
  assert.ok(buildSitemap({watches:[sold]}).includes(watchUrl(sold)));
});

test("catalogue, brand and policy pages have initial content and canonical links",()=>{
  const inventory=[bond,alternative,{...bond,id:"recDraft",listingId:"SW999",status:"Draft"}];
  const home=renderPageDocument(shell,pageModel("/",{watches:inventory}),{watches:inventory});
  assert.match(slot(home,"gallery"),/href="https:\/\/staplefordwatches\.co\.uk\/watches\/omega-seamaster/);
  assert.ok(home.includes('/brands/omega/'));
  assert.equal(jsonSlot(home,"stapleford-bootstrap").watches.length,2);
  assert.ok(!slot(home,"gallery").includes("sw999"));
  const brand=renderPageDocument(shell,pageModel("/brands/omega/",{watches:inventory}),{watches:inventory});
  assert.match(brand,/<h1[^>]*id="catalogIntroTitle"[^>]*>Pre-owned and vintage Omega watches\./);
  assert.match(buildSitemap({watches:inventory}),/<loc>https:\/\/staplefordwatches\.co\.uk\/brands\/omega\/<\/loc>/);
  const contact=renderPageDocument(shell,pageModel("/contact/"));
  assert.match(slot(contact,"infoBody"),/124 City Road/);
  const returns=renderPageDocument(shell,pageModel("/returns/"));
  assert.match(slot(returns,"infoBody"),/14/);
});

test("journal article body and Article markup appear in the first response",()=>{
  const posts=[{slug:"bond-seamaster-guide",title:"Collecting Bond Seamasters",author:"Stapleford Watches",excerpt:"Reference guide",bodyHtml:"<p>Compare the actual reference and condition.</p>"}];
  const html=renderPageDocument(shell,pageModel("/journal/bond-seamaster-guide/",{posts}),{posts});
  assert.match(slot(html,"journalEntry"),/Collecting Bond Seamasters/);
  assert.match(slot(html,"journalEntry"),/Compare the actual reference/);
  assert.equal(jsonSlot(html,"stapleford-server-jsonld")["@graph"][0]["@type"],"Article");
});

test("untrusted watch text cannot close bootstrap or structured-data scripts",()=>{
  const malicious={...bond,description:'</script><img src=x onerror="alert(1)">',title:"Bond <script>evil</script>"};
  const html=renderPageDocument(shell,pageModel(new URL(watchUrl(malicious)).pathname,{watches:[malicious]}),{watches:[malicious]});
  assert.equal(jsonSlot(html,"stapleford-bootstrap").watches[0].description,malicious.description);
  assert.doesNotMatch(html,/<img src=x onerror=/);
  assert.doesNotMatch(html,/<script>evil/);
});

test("feed excludes ambiguous or incomplete stock and validates real identifiers",()=>{
  for(const changes of [{status:""},{status:"Reserved"},{price:0},{price:-1},{price:"ask 3250"},{brand:""},{title:""},{image:"http://example.com/x"},{shoppingReady:"No"},{shoppingReady:false}]){
    assert.doesNotMatch(buildMerchantFeed([{...bond,...changes}]),/<item>/,JSON.stringify(changes));
  }
  assert.doesNotMatch(buildMerchantFeed([bond,{...bond,listingId:"sw024",price:4000}]),/<item>/);
  assert.equal(validGtin("4006381333931"),"4006381333931");
  assert.equal(validGtin("4006381333932"),"");
  assert.equal(validGtin("EAN 4006381333931"),"");
  assert.equal(numericPrice(-125),0);
  assert.equal(numericPrice("£3,250.00 GBP"),3250);
  assert.equal(productGraph({...bond,price:0})[0].offers,undefined);
  assert.deepEqual(merchantCountries(),["GB"]);
  assert.deepEqual(merchantCountries("gb,fr,gb"),["GB","FR"]);
  assert.throws(()=>merchantCountries("KR"));
  const international=buildMerchantFeed([bond],{countries:["GB","FR","US"]});
  assert.match(international,/<g:country>FR<\/g:country>[\s\S]*?<g:price>50\.00 GBP/);
  assert.match(international,/<g:country>US<\/g:country>[\s\S]*?<g:price>80\.00 GBP/);
});

test("catalogue reads every Airtable page and rejects drafts",async()=>{
  const offsets=[];
  await withFetch(async request=>{
    const url=new URL(request);offsets.push(url.searchParams.get("offset"));
    if(offsets.length===1)return Response.json({records:Array.from({length:100},(_,i)=>record({...bond,id:"rec"+i,listingId:"SW"+i})),offset:"next-page"});
    return Response.json({records:[record(alternative),record({...bond,status:""})]});
  },async()=>{
    const data=await (await loadWatches(context())).json();
    assert.equal(data.count,101);assert.equal(data.watches.at(-1).listingId,"SW025");assert.deepEqual(offsets,[null,"next-page"]);
  });
  await withFetch(async request=>new URL(request).searchParams.has("offset")?new Response("failed",{status:503}):Response.json({records:[record()],offset:"next-page"}),async()=>{
    const response=await loadWatches(context());assert.equal(response.status,503);assert.equal((await response.json()).watches,undefined);
  });
});

test("edge routes redirect obsolete names, give real 404s and serve real product HTML",async()=>{
  await withFetch(async()=>Response.json({records:[record()]}),async()=>{
    const redirect=await onRequest(context("/watches/old-bond-name-sw-0024/?source=test"));
    assert.equal(redirect.status,301);assert.equal(redirect.headers.get("Location"),watchUrl(bond)+"?source=test");
    assert.equal((await onRequest(context("/watches/nonexistent-sw099/"))).status,404);
    assert.equal((await onRequest(context("/not-a-page/"))).status,404);
    const alias=await onRequest(context("/returns-policy/"));assert.equal(alias.status,301);assert.ok(alias.headers.get("Location").endsWith("/returns/"));
    const response=await onRequest(context(new URL(watchUrl(bond)).pathname));assert.equal(response.status,200);assert.equal(response.headers.get("ETag"),null);assert.match(await response.text(),/Omega Seamaster 300M James Bond 007 2226\.80\.00<\/h1>/);
  });
  await withFetch(async()=>new Response("down",{status:503}),async()=>{
    const response=await onRequest(context(new URL(watchUrl(bond)).pathname));assert.equal(response.status,503);assert.equal(response.headers.get("Retry-After"),"60");
  });
});

test("a failed refresh cannot republish stale stock to server pages or Shopping",async()=>{
  const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
  let failing=false;
  try { await withFetch(async()=>failing?new Response("down",{status:503}):Response.json({records:[record()]}),async()=>{
    assert.equal((await getCatalog(context(),{requireFresh:true})).status,200);
    now+=301000;failing=true;
    const result=await getCatalog(context(),{requireFresh:true});assert.equal(result.status,503);assert.equal(result.headers.get("Cache-Control"),"no-store");
  }); } finally { Date.now=originalNow; }
});

test("checkout rejects sold, reserved and blank statuses before contacting Stripe",async()=>{
  for(const status of ["Sold","Reserved","","Draft"]){
    await withFetch(async request=>{ assert.equal(new URL(request).hostname,"api.airtable.com");return Response.json({records:[record({...bond,status})]}); },async()=>{
      const result=await onRequestPost({env:{...context().env,STRIPE_SECRET_KEY:"test",STRIPE_SHIPPING_RATE_UK:"uk",STRIPE_SHIPPING_RATE_EUROPE:"eu",STRIPE_SHIPPING_RATE_INTERNATIONAL:"global"},request:new Request("https://staplefordwatches.co.uk/api/create-checkout-session",{method:"POST",body:JSON.stringify({watch:"SW024"})})});
      assert.equal(result.status,409);
    });
  }
});

test("rendered documents preserve valid application JavaScript",()=>{
  const html=renderPageDocument(shell,pageModel(new URL(watchUrl(bond)).pathname,{watches:[bond]}),{watches:[bond]});
  const original=slot(shell,"stapleford-production-js"),rendered=slot(html,"stapleford-production-js");
  assert.equal(rendered,original);new Script(rendered);
});

test("server policy content and client policy content stay identical",()=>{
  const start=shell.indexOf("  const INFO_CONTENT = {"),end=shell.indexOf("  const infoHero =",start);
  assert.ok(start>0&&end>start);
  const client=runInNewContext(shell.slice(start,end)+"; JSON.stringify(INFO_CONTENT)");
  assert.equal(client,JSON.stringify(INFO_CONTENT));
});

test("Cloudinary product images load the same responsive variants before hydration",()=>{
  const watch={...bond,image:"https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v123/watches/SW024/01.jpg"};
  const html=renderPageDocument(shell,pageModel(new URL(watchUrl(watch)).pathname,{watches:[watch]}),{watches:[watch]});
  const img=html.match(/<img[^>]*id="lightboxImage"[^>]*>/)[0];
  assert.match(img,/f_auto,q_auto:best,fl_progressive,c_limit,w_1600\/v123\/watches/);
  assert.match(img,/srcset="[^" ]+ 900w/);
  assert.equal((img.match(/\bsizes=/g)||[]).length,1);
});
