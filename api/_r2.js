/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * Shared R2 / storage helper.  The leading underscore prevents Vercel from
 * exposing this as an API route.
 *
 * EXTRACTABLE UNIT — to move this module to a standalone project, copy:
 *   api/_r2.js  api/_auth.js  api/releases.js  api/download/  api/admin/
 *   api/upload/  downloads/  dhadmin/  scripts/downloads*.js
 *   styles/downloads.css  styles/dhadmin.css
 *
 * Required env vars (add to .env.local for local dev):
 *   R2_ACCOUNT_ID         Cloudflare account ID
 *   R2_ACCESS_KEY_ID      R2 API token access key
 *   R2_SECRET_ACCESS_KEY  R2 API token secret
 *   R2_BUCKET_NAME        Bucket name (e.g. dh-releases)
 * ─────────────────────────────────────────────────────────────────────────── */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Key of the releases manifest inside the R2 bucket. */
const RELEASES_KEY = 'releases.json';

/** How long (seconds) a download redirect URL stays valid.
 *  Short on purpose — the real file lives in R2, not at this URL. */
const DOWNLOAD_URL_TTL = 60;

/** Presigned part URL TTL — generous enough for slow connections to finish a
 *  100 MB part.  Part uploads go browser → R2 directly; Vercel isn't involved. */
const UPLOAD_PART_TTL = 3600; // 1 hour

/** Chunk size used by both the admin upload UI and reported to clients.
 *  Must be ≥ 5 MB (R2 minimum part size) and ≤ 5 GB (R2 maximum). */
export const UPLOAD_CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB

// ── Client factory (lazy — env vars read at call time) ────────────────────────

function client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const bucket = () => process.env.R2_BUCKET_NAME ?? 'dh-releases';

// ── Releases manifest ─────────────────────────────────────────────────────────

/**
 * Read releases.json from R2.
 * Returns { releases: [] } if the file does not yet exist — no bootstrap needed.
 */
export async function getReleases() {
  try {
    const res  = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: RELEASES_KEY }));
    const body = await res.Body.transformToString('utf-8');
    return JSON.parse(body);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return { releases: [] };
    }
    throw err;
  }
}

/**
 * Write the full releases manifest back to R2.
 * @param {{ releases: object[] }} data
 */
export async function saveReleases(data) {
  await client().send(new PutObjectCommand({
    Bucket:      bucket(),
    Key:         RELEASES_KEY,
    Body:        JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  }));
}

// ── Signed download URL ───────────────────────────────────────────────────────

/**
 * Generate a short-lived presigned GET URL for a private R2 object.
 * The public-facing /downloads/:fileId URL is permanent; this ephemeral URL
 * is what the browser actually fetches bytes from.
 *
 * @param {string}  r2Key     e.g. "files/aB3xK9mP.exe"
 * @param {string}  [filename]  Original filename for the Content-Disposition header.
 *                              Without this the browser would save the file as the
 *                              raw R2 object key (e.g. "aB3xK9mP.exe").
 * @returns {Promise<string>}
 */
export async function getSignedDownloadUrl(r2Key, filename) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key:    r2Key,
      // Tell the browser the correct filename via the presigned URL itself
      ...(filename && {
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
      }),
    }),
    { expiresIn: DOWNLOAD_URL_TTL },
  );
}

// ── File deletion ─────────────────────────────────────────────────────────────

/**
 * Permanently delete a file from R2.
 * Only called from the admin API when a release is removed.
 *
 * @param {string} r2Key
 */
export async function deleteFile(r2Key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: r2Key }));
}

/**
 * Sum the sizes of every object in the bucket (paginated).
 * Reflects what Cloudflare counts as storage used.
 * @returns {Promise<number>} Total bytes
 */
export async function getBucketStorageBytes() {
  let totalBytes = 0;
  let continuationToken;
  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket:            bucket(),
      ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents ?? []) {
      totalBytes += obj.Size ?? 0;
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return totalBytes;
}

// ── Multipart upload (≥ 2 GB files) ──────────────────────────────────────────
// Browser uploads directly to R2 — Vercel is never in the data path.
// Flow: initiate → get part URLs → browser PUTs each part → complete (or abort).

/**
 * Start a multipart upload and return the R2 UploadId.
 *
 * @param {string} r2Key         Destination key, e.g. "files/nanoid.exe"
 * @param {string} contentType   MIME type of the file
 * @returns {Promise<string>}    UploadId
 */
export async function initiateMultipartUpload(r2Key, contentType) {
  const res = await client().send(new CreateMultipartUploadCommand({
    Bucket:      bucket(),
    Key:         r2Key,
    ContentType: contentType,
  }));
  return res.UploadId;
}

/**
 * Generate presigned PUT URLs for each part.
 * Part numbers are 1-based (R2 requirement).
 *
 * @param {string} r2Key
 * @param {string} uploadId
 * @param {number} partCount   ceil(fileSize / UPLOAD_CHUNK_SIZE)
 * @returns {Promise<string[]>}
 */
export async function getPresignedPartUrls(r2Key, uploadId, partCount) {
  return Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      getSignedUrl(
        client(),
        new UploadPartCommand({
          Bucket:     bucket(),
          Key:        r2Key,
          UploadId:   uploadId,
          PartNumber: i + 1,
        }),
        { expiresIn: UPLOAD_PART_TTL },
      ),
    ),
  );
}

/**
 * Complete a multipart upload once all parts have been PUT.
 *
 * @param {string} r2Key
 * @param {string} uploadId
 * @param {{ PartNumber: number, ETag: string }[]} parts   ETags from each PUT response
 */
export async function completeMultipartUpload(r2Key, uploadId, parts) {
  await client().send(new CompleteMultipartUploadCommand({
    Bucket:           bucket(),
    Key:              r2Key,
    UploadId:         uploadId,
    MultipartUpload:  { Parts: parts },
  }));
}

/**
 * Abort an in-progress multipart upload, freeing R2 storage.
 * Call this from the upload/abort API route on any failure.
 *
 * @param {string} r2Key
 * @param {string} uploadId
 */
export async function abortMultipartUpload(r2Key, uploadId) {
  await client().send(new AbortMultipartUploadCommand({
    Bucket:   bucket(),
    Key:      r2Key,
    UploadId: uploadId,
  }));
}
