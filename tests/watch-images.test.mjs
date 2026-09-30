import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../functions/_utils/watch-images.js', import.meta.url), 'utf8');
const { uniqueWatchImages } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helpers = html.slice(html.indexOf('  function safeUrl('), html.indexOf('  function preloadDetailImage('))
  + html.slice(html.indexOf('  function imageIdentity('), html.indexOf('  function description('));
const frontend = vm.runInNewContext(helpers + ';({images, gridImage, gridSrcset, gridImageSizes, detailImage})', {
  URL, window: { location: { origin: 'https://staplefordwatches.co.uk' } },
});
const original = 'https://res.cloudinary.com/dvm4pgghh/image/upload/v1790708457/watches/SW064/01.jpg';
const duplicate = 'https://res.cloudinary.com/dvm4pgghh/image/upload/f_auto,q_auto/watches/SW064/01';
const second = duplicate.replace('/01', '/02');

test('API and carousel treat transformed, versioned and extensionless URLs as one photo', () => {
  const expected = [original, second];
  assert.deepEqual(uniqueWatchImages([original, duplicate, second, original]), expected);
  assert.deepEqual(Array.from(frontend.images({ image: original, images: [original, duplicate, second] })), expected);
});

test('distinct folders, cloud accounts and external image URLs remain distinct', () => {
  const urls = [original, original.replace('SW064', 'SW065'), original.replace('dvm4pgghh', 'another-cloud'),
    'https://images.example.com/photo.jpg?v=1', 'https://images.example.com/photo.jpg?v=2'];
  assert.equal(uniqueWatchImages(urls).length, urls.length);
  assert.equal(frontend.images({ images: urls }).length, urls.length);
});

test('attachment originals take priority over low-resolution thumbnails', () => {
  const result = frontend.images({ attachments: [{ url: original, thumbnails: { large: { url: duplicate } } }] });
  assert.deepEqual(Array.from(result), [original]);
});

test('gallery requests best quality with sufficient candidates for large and high-density screens', () => {
  assert.match(frontend.gridImage(original), /q_auto:best/);
  assert.match(frontend.detailImage(original), /q_auto:best/);
  assert.match(frontend.gridSrcset(original), /w_2400\/.* 2400w/);
  assert.match(frontend.gridImageSizes(), /max-width: 767px/);
  assert.match(frontend.gridImageSizes(), /100vw - 9px/);
  assert.doesNotMatch(frontend.gridImageSizes(), /234px/);
});
