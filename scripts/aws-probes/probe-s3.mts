/**
 * Lists the first N keys in a bucket. Confirms IAM gives you
 * `s3:ListBucket` — what the FE deploy needs at minimum to verify
 * the upload target is reachable.
 *
 * Override with `--bucket <name>` and/or `--max <N>`.
 * Run: `node --experimental-strip-types probe-s3.ts`
 */
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const bucket =
  process.argv[process.argv.indexOf('--bucket') + 1] ?? 'huckleberry-fe-dev3';
const maxKeys = parseInt(
  process.argv[process.argv.indexOf('--max') + 1] ?? '10',
  10,
);

const s3 = new S3Client({ region: 'us-east-1' });
const res = await s3.send(
  new ListObjectsV2Command({ Bucket: bucket, MaxKeys: maxKeys }),
);

console.log(
  JSON.stringify(
    {
      bucket,
      keyCount: res.KeyCount ?? 0,
      isTruncated: res.IsTruncated ?? false,
      keys: (res.Contents ?? []).map((o) => ({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified,
      })),
    },
    null,
    2,
  ),
);
