import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const robots = await readFile(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");
const [
  americanExpressLogo,
  applePayLogo,
  caslonRoman,
  caslonItalic,
  sweetSansLight,
  sweetSansRegular,
  sweetSansBold,
] = await Promise.all([
  readFile(new URL("../assets/payment/american-express.svg", import.meta.url), "utf8"),
  readFile(new URL("../assets/payment/apple-pay.svg", import.meta.url), "utf8"),
  readFile(new URL("../fonts/caslon-540-lt-std-roman-v1.ttf", import.meta.url)),
  readFile(new URL("../fonts/caslon-540-lt-std-italic-v1.ttf", import.meta.url)),
  readFile(new URL("../fonts/sweet-sans-pro-light-v1.otf", import.meta.url)),
  readFile(new URL("../fonts/sweet-sans-pro-regular-v1.otf", import.meta.url)),
  readFile(new URL("../fonts/sweet-sans-pro-bold-v1.otf", import.meta.url)),
]);

test("business identity and customer-service details remain on the contact and legal pages", () => {
  assert.match(html, /124 City Road/);
  assert.match(html, /EC1V 2NX/);
  assert.match(html, /VAT registration number: GB 520 4679 02/);
  assert.match(html, /ben@staplefordwatches\.co\.uk/);
  assert.match(html, /\+44 7438 196047/);
});

test("customers and crawlers can reach dedicated trust pages", () => {
  for (const path of ["/contact/", "/delivery/", "/returns/", "/terms-and-conditions/", "/privacy-policy/"]) {
    assert.match(html, new RegExp(`href=["']${path.replaceAll("/", "\\/")}["']`));
    assert.match(sitemap, new RegExp(`<loc>https:\\/\\/staplefordwatches\\.co\\.uk${path.replaceAll("/", "\\/")}<\\/loc>`));
  }
  assert.match(robots, /Sitemap: https:\/\/staplefordwatches\.co\.uk\/sitemap\.xml/);
});

test("merchant structured data publishes real contact and policy details", () => {
  assert.match(html, /"vatID":"GB520467902"/);
  assert.match(html, /"telephone":"\+447438196047"/);
  assert.match(html, /"merchantReturnLink":"https:\/\/staplefordwatches\.co\.uk\/returns\/"/);
});

test("product pages link directly to full delivery and returns policies", () => {
  assert.match(html, /Read our full delivery policy/);
  assert.match(html, /Read our full returns policy/);
});

test("the simplified contact experience keeps only the requested actions", () => {
  assert.doesNotMatch(html, /href=["']\/about\/["']/);
  assert.doesNotMatch(html, />Call<\/a>/);
  assert.doesNotMatch(html, /class="sw-footer-business"/);
  assert.match(html, /actions:\[\{ label:'Email us'.*\{ label:'Chat to us'/);
});

test("the footer identifies and positions every accepted payment method accessibly", () => {
  assert.match(html, /id="swPaymentMethodsTitle">Accepted payment methods<\/p>/);
  for (const method of ["American Express", "Apple Pay", "Mastercard", "Visa", "Onelink", "Amazon Pay"]) {
    assert.match(html, new RegExp(`aria-label="${method}"`));
  }
  assert.match(html, /class="sw-payment-marks" role="list"/);
  assert.match(html, /class="sw-payment-marks" role="list">[\s\S]*?aria-label="Visa"[\s\S]*?aria-label="Mastercard"[\s\S]*?aria-label="Apple Pay"[\s\S]*?aria-label="American Express"[\s\S]*?aria-label="Amazon Pay"[\s\S]*?aria-label="Onelink"[\s\S]*?<\/ul>/);
  assert.match(html, /class="sw-footer-legal"[^>]*>[\s\S]*?<\/div><div aria-labelledby="swPaymentMethodsTitle" class="sw-footer-payments"/);
  assert.match(html, /aria-label="American Express" class="sw-payment-mark sw-payment-mark--amex"><img[^>]*height="24"[^>]*src="\/assets\/payment\/american-express\.svg"[^>]*width="24"/);
  assert.match(html, /aria-label="Apple Pay" class="sw-payment-mark sw-payment-mark--official sw-payment-mark--apple"><img[^>]*src="\/assets\/payment\/apple-pay\.svg"/);
  assert.doesNotMatch(html, /sw-payment-amex|sw-payment-brand--apple|sw-payment-brand--revolut/);
  assert.match(html, /\.sw-payment-mark--official\{[^}]*padding:0;[^}]*border:0;[^}]*background:transparent/);
  assert.match(html, /\.sw-payment-mark\{[^}]*width:48px;height:30px[^}]*border:1px solid #d9dde3/);
  assert.match(html, /\.sw-payment-mark--amex\{width:48px;height:30px\}/);
  assert.match(html, /\.sw-payment-mark--amex img\{width:24px;height:24px\}/);
  assert.doesNotMatch(html, /\.sw-footer-payments\{[^}]*border-top/);
  assert.doesNotMatch(html, /aria-label="Revolut Pay"|\/assets\/payment\/revolut-pay\.svg/);
  assert.match(html, /const copyrightAnchor = footerPayments \|\| footerLegal;/);
});


test("payment marks use the supplied production artwork", () => {
  assert.match(americanExpressLogo, /viewBox="0 0 80 80"/);
  assert.match(americanExpressLogo, /#006FCF/i);
  assert.match(applePayLogo, /viewBox="0 0 165\.52107 105\.9651"/);
  assert.match(applePayLogo, /id="Artwork"/);
});

test("site typography restores Sweet Sans while reserving Caslon for the catalogue introduction", () => {
  assert.match(html, /href="\/fonts\/sweet-sans-pro-regular-v1\.otf" rel="preload" type="font\/otf"/);
  for (const [weight, file] of [
    ["300", "light"],
    ["400", "regular"],
    ["500", "regular"],
    ["600 700", "bold"],
  ]) {
    assert.match(
      html,
      new RegExp(`@font-face\\{font-family:"Sweet Sans Pro";src:url\\("\\/fonts\\/sweet-sans-pro-${file}-v1\\.otf"\\) format\\("opentype"\\);font-weight:${weight};font-style:normal;font-display:optional\\}`)
    );
  }
  assert.match(html, /--font-body:"Sweet Sans Pro",Arial,sans-serif/);
  assert.match(html, /--font-editorial:"Caslon 540 LT Std","Times New Roman",serif/);
  assert.match(html, /\.catalog-intro-title,\.catalog-intro-copy\{font-family:var\(--font-editorial\)\}/);
  assert.match(html, /\.catalog-intro-title\{font-style:italic\}/);
  assert.match(html, /class="curated-hero-title catalog-intro-title" id="catalogIntroTitle">Curator of modern and vintage timepieces\.<\/h1>/);
  assert.match(html, /class="curated-hero-copy catalog-intro-copy">Whether you’re an avid collector/);
  assert.doesNotMatch(html, /\.(?:curated|journal)-hero-title\{[^}]*font-style:italic/);
  assert.deepEqual([...caslonRoman.subarray(0, 4)], [0, 1, 0, 0]);
  assert.deepEqual([...caslonItalic.subarray(0, 4)], [0, 1, 0, 0]);
  for (const sweetSansFont of [sweetSansLight, sweetSansRegular, sweetSansBold]) {
    assert.equal(sweetSansFont.subarray(0, 4).toString("ascii"), "OTTO");
  }
  assert.doesNotMatch(html, /IBM Plex Mono|ibm-plex-mono/i);
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
});
