/* Sponsor icon validator + renderer. Fixtures are built in-process (sharp
   for the real rasters, hand-assembled bytes for the hostile ones) so the
   repo carries no binary blobs. Run: npm test */
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  ICON_ERRORS,
  ICON_MAX_BYTES,
  ICON_SIZE,
  hostIcon,
  inspectIcon,
  renderIcon,
  svgProblem,
} from '../src/lib/sponsor-icon.js';

const square = (w, h, fmt) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 200, b: 90, alpha: 1 } } })
    [fmt]()
    .toBuffer();

/* A PNG whose IHDR claims the given size, followed by a truncated IDAT.
   Every chunk carries a correct CRC so the header is trusted by any reader;
   the body is nowhere near real, which is the point: the size must be
   refused from the header alone, before any row is inflated. */
function bombPng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG_OK = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#1ec85a"/><stop offset="1" stop-color="#0a7"/></linearGradient></defs>
  <rect width="64" height="64" rx="12" fill="url(#g)"/>
  <use href="#dot"/><circle id="dot" cx="32" cy="32" r="10" fill="#fff"/>
</svg>`;

test('valid png, jpeg and webp are accepted and typed by signature', async () => {
  for (const [fmt, kind] of [['png', 'png'], ['jpeg', 'jpeg'], ['webp', 'webp']]) {
    const buf = await square(200, 120, fmt);
    const r = await inspectIcon(buf);
    assert.equal(r.ok, true, fmt);
    assert.equal(r.kind, kind);
    assert.equal(r.width, 200);
  }
});

test('a png named .jpg is still a png: the extension and declared type are never consulted', async () => {
  const buf = await square(128, 128, 'png');
  const fileNamedJpg = { name: 'logo.jpg', type: 'image/jpeg', bytes: buf };
  const r = await inspectIcon(fileNamedJpg.bytes);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'png');
});

test('svg with <script> is rejected', async () => {
  const r = await inspectIcon(Buffer.from(SVG_OK.replace('</svg>', '<script>alert(1)</script></svg>')));
  assert.deepEqual(r, { ok: false, error: ICON_ERRORS.svgScript });
});

test('svg: namespace-prefixed and self-closing script tags are rejected too', async () => {
  for (const tag of ['<svg:script>alert(1)</svg:script>', '<x:script/>', '<script/>', '<script src="https://evil.example/x.js"/>', '<SVG:SCRIPT />']) {
    const r = await inspectIcon(Buffer.from(SVG_OK.replace('</svg>', `${tag}</svg>`)));
    assert.deepEqual(r, { ok: false, error: ICON_ERRORS.svgScript }, tag);
  }
  // an element that merely starts with the word is not a script
  assert.equal(svgProblem(SVG_OK.replace('</svg>', '<scripted-thing/></svg>')), null);
});

test('svg with an onload= handler is rejected', async () => {
  const r = await inspectIcon(Buffer.from(SVG_OK.replace('<svg ', '<svg onload="alert(1)" ')));
  assert.deepEqual(r, { ok: false, error: ICON_ERRORS.svgHandler });
});

test('svg with an external <image href> is rejected', async () => {
  const r = await inspectIcon(
    Buffer.from(SVG_OK.replace('</svg>', '<image href="https://evil.example/x.png" width="64" height="64"/></svg>'))
  );
  assert.deepEqual(r, { ok: false, error: ICON_ERRORS.svgExternal });
});

test('svg: foreignObject, doctype, xlink:href, external url() and a non-svg root are rejected', () => {
  assert.equal(svgProblem(SVG_OK), null);
  assert.equal(svgProblem(SVG_OK.replace('</svg>', '<foreignObject><div/></foreignObject></svg>')), ICON_ERRORS.svgForeign);
  assert.equal(svgProblem(`<!DOCTYPE svg [<!ENTITY x "y">]>${SVG_OK}`), ICON_ERRORS.svgDoctype);
  assert.equal(svgProblem(SVG_OK.replace('href="#dot"', 'xlink:href="https://evil.example/a.svg#dot"')), ICON_ERRORS.svgExternal);
  assert.equal(svgProblem(SVG_OK.replace('url(#g)', 'url(https://evil.example/g.png)')), ICON_ERRORS.svgExternal);
  assert.equal(svgProblem('<html><svg></svg></html>'), ICON_ERRORS.svgRoot);
  // a comment cannot smuggle a tag past the screen
  assert.equal(svgProblem(SVG_OK.replace('</svg>', '<!-- x --><scr<!-- -->ipt>1</script></svg>')), ICON_ERRORS.svgScript);
});

test('a 3MB file is rejected as over 2MB before anything else', async () => {
  const r = await inspectIcon(Buffer.alloc(3 * 1024 * 1024, 0x89));
  assert.deepEqual(r, { ok: false, error: ICON_ERRORS.size });
  assert.equal(ICON_MAX_BYTES, 2 * 1024 * 1024);
});

test('a 20000x20000 png (decompression bomb) is refused from its header', async () => {
  const r = await inspectIcon(bombPng(20000, 20000));
  assert.deepEqual(r, { ok: false, error: ICON_ERRORS.pixels });
});

test('a gif-header + html polyglot is rejected as not an accepted format', async () => {
  const r = await inspectIcon(Buffer.from('GIF89a<html><script>alert(1)</script></html>', 'latin1'));
  assert.deepEqual(r, { ok: false, error: ICON_ERRORS.format });
});

test('empty and truncated inputs are rejected with clear messages', async () => {
  assert.deepEqual(await inspectIcon(Buffer.alloc(0)), { ok: false, error: ICON_ERRORS.empty });
  const png = await square(64, 64, 'png');
  assert.deepEqual(await inspectIcon(png.subarray(0, 12)), { ok: false, error: ICON_ERRORS.decode });
  assert.deepEqual(await inspectIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect')), {
    ok: false,
    error: ICON_ERRORS.svgParse,
  });
});

test('render: centre-cropped 256x256 webp, metadata stripped, from raster and svg', async () => {
  const wide = await sharp(await square(400, 100, 'png'))
    .withMetadata({ exif: { IFD0: { Copyright: 'strip me' } } })
    .png()
    .toBuffer();
  for (const src of [wide, Buffer.from(SVG_OK)]) {
    const info = await inspectIcon(src);
    assert.equal(info.ok, true);
    const out = await renderIcon(src, info);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, ICON_SIZE);
    assert.equal(meta.height, ICON_SIZE);
    assert.equal(meta.exif, undefined);
  }
});

test('hostIcon: bad bytes never reach storage; without R2 a good icon gets a clear 503', async () => {
  const bad = await hostIcon(Buffer.from('GIF89a<html>'), 'sponsor-icons/test');
  assert.deepEqual(bad, { ok: false, error: ICON_ERRORS.format, status: 400 });
  delete process.env.R2_ACCOUNT_ID;
  const good = await hostIcon(await square(128, 128, 'png'), 'sponsor-icons/test');
  assert.equal(good.ok, false);
  assert.equal(good.status, 503);
  await assert.rejects(() => hostIcon(Buffer.from(SVG_OK), '../etc/passwd'), /bad key stem/);
});
