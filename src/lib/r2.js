/* Cloudflare R2 over the S3 API, PUT-only, signed with AWS Signature v4 by
   hand (node:crypto) so the site gains no SDK dependency for one verb.

   Env (Railway + local .env when the bucket exists):
     R2_ACCOUNT_ID    : Cloudflare account id (the S3 endpoint host)
     R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY : R2 API token pair
     R2_BUCKET        : bucket name
     R2_JURISDICTION  : bucket jurisdiction when not default (e.g. "eu" —
                        jurisdiction buckets only answer on their own
                        endpoint host, the global one 404s)
     R2_PUBLIC_BASE   : public base URL the bucket serves from
                        (a custom media domain), no trailing slash

   Unset = media uploads are politely disabled; nothing else on the vertical
   depends on this. CSP note: served images are covered by the existing
   img-src https: allowance in csp.js. */
import { createHash, createHmac } from 'node:crypto';

export function r2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_BASE
  );
}

export function r2PublicUrl(key) {
  return `${process.env.R2_PUBLIC_BASE}/${key}`;
}

const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

/* SigV4, region "auto" (R2's convention), service "s3", one signed PUT.
   Keys are generated server-side ([a-z0-9/_.-] only), so the canonical URI
   needs no extra encoding pass. */
export async function r2Put(key, body, contentType) {
  const jur = process.env.R2_JURISDICTION ? `${process.env.R2_JURISDICTION}.` : '';
  const host = `${process.env.R2_ACCOUNT_ID}.${jur}r2.cloudflarestorage.com`;
  const uri = `/${process.env.R2_BUCKET}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  // Keys are unique per upload, so objects are immutable: R2 stores the
  // header at PUT and replays it on public GETs, which is what lets the
  // Cloudflare edge cache them for a year instead of its short default.
  const cacheControl = 'public, max-age=31536000, immutable';

  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = ['PUT', uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${process.env.R2_SECRET_ACCESS_KEY}`, dateStamp);
  for (const part of ['auto', 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${process.env.R2_ACCESS_KEY_ID}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${uri}`, {
    method: 'PUT',
    headers: {
      'cache-control': cacheControl,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'content-type': contentType,
      authorization,
    },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`r2 put ${key} → ${res.status} ${text.slice(0, 200)}`);
  }
}
