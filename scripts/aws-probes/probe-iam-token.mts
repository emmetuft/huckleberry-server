/**
 * Mints an Aurora IAM auth token for `huckleberry_app` against the dev3
 * writer endpoint. Proves the runtime BFF auth path works end-to-end:
 * STS issues a token, RDS accepts it. The token itself is short-lived
 * (15 min) and can be used as the MySQL password in a port-forwarded
 * connection.
 *
 * Override with `--host <hostname>` and/or `--user <db user>`.
 * Run: `node --experimental-strip-types probe-iam-token.ts`
 */
import { Signer } from '@aws-sdk/rds-signer';

const host =
  process.argv[process.argv.indexOf('--host') + 1] ??
  'dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com';
const username =
  process.argv[process.argv.indexOf('--user') + 1] ?? 'huckleberry_app';

const signer = new Signer({
  region: 'us-east-1',
  hostname: host,
  port: 3306,
  username,
});
const token = await signer.getAuthToken();

console.log(
  JSON.stringify(
    {
      host,
      username,
      tokenLength: token.length,
      // The token is a long signed URL — print just the prefix so a
      // shoulder-surfer can't replay it from a screenshot.
      tokenPrefix: token.slice(0, 64) + '…',
    },
    null,
    2,
  ),
);
console.error(
  '\n  To use this token interactively (port-forward must already be running):',
);
console.error(
  `    mysql -h 127.0.0.1 -P 13306 -u ${username} --ssl-mode=REQUIRED -p"<paste-token-here>"\n`,
);
