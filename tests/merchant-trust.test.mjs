import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const robots = await readFile(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");

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
  for (const method of ["American Express", "Apple Pay", "Mastercard", "Visa", "Onelink", "Amazon Pay", "Revolut Pay"]) {
    assert.match(html, new RegExp(`aria-label="${method}"`));
  }
  assert.match(html, /class="sw-payment-marks" role="list"/);
  assert.match(html, /class="sw-footer-legal"[^>]*>[\s\S]*?<\/div><div aria-labelledby="swPaymentMethodsTitle" class="sw-footer-payments"/);
  assert.match(html, /aria-label="American Express"[^>]*>[\s\S]*?class="sw-payment-amex"><span>AM<\/span><span>EX<\/span>/);
  assert.doesNotMatch(html, /aria-label="American Express"[^>]*>[\s\S]*?<svg/);
  assert.match(html, /aria-label="Apple Pay" class="sw-payment-mark sw-payment-mark--apple">[\s\S]*?class="sw-payment-brand sw-payment-brand--apple">[\s\S]*?<span>Pay<\/span>/);
  assert.match(html, /\.sw-payment-mark--apple\{[^}]*border-color:#000/);
  assert.match(html, /aria-label="Revolut Pay" class="sw-payment-mark">[\s\S]*?class="sw-payment-brand sw-payment-brand--revolut">[\s\S]*?<span>Pay<\/span>/);
  assert.doesNotMatch(html, /<span>Revolut<\/span>/);
  assert.match(html, /\.sw-payment-mark\{[^}]*width:48px;height:30px[^}]*border:1px solid #d9dde3/);
  assert.doesNotMatch(html, /\.sw-footer-payments\{[^}]*border-top/);
  assert.match(html, /const copyrightAnchor = footerPayments \|\| footerLegal;/);
});
