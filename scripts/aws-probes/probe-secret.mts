/**
 * Reads the dev3 Aurora master secret. Confirms IAM gives you
 * `secretsmanager:GetSecretValue` on this resource. Prints the
 * non-password fields only.
 *
 * Override the secret id with `--secret <id>`.
 * Run: `node --experimental-strip-types probe-secret.ts`
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const secretId =
  process.argv[process.argv.indexOf('--secret') + 1] ?? 'dev3-huckleberry';

const client = new SecretsManagerClient({ region: 'us-east-1' });
const res = await client.send(
  new GetSecretValueCommand({ SecretId: secretId }),
);
if (!res.SecretString) throw new Error('SecretString empty');

const parsed = JSON.parse(res.SecretString) as Record<string, unknown>;
// Print everything except the password.
const safe: Record<string, unknown> = { ...parsed };
delete safe.password;
console.log(JSON.stringify({ secretId, fields: safe }, null, 2));
