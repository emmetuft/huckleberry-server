/**
 * Idempotent LocalStack KMS setup for local integration testing.
 *
 * Usage: pnpm infra:kms   (starts LocalStack then runs this script)
 *
 * The script waits for LocalStack to be ready, creates the KMS key the first
 * time, then prints the two lines to add to .env. Subsequent runs print the
 * same ARN (idempotent via the alias `alias/huckleberry-dev`).
 *
 * Teammates who don't need KMS testing can skip this entirely — just use
 * DEV_ENCRYPTION_KEY (the default local-dev path).
 */

import {
  KMSClient,
  CreateKeyCommand,
  CreateAliasCommand,
  ListAliasesCommand,
} from '@aws-sdk/client-kms';

const ENDPOINT = 'http://localhost:4566';
const ALIAS = 'alias/huckleberry-dev';
const ACCOUNT = '000000000000';

const client = new KMSClient({
  endpoint: ENDPOINT,
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

async function waitForLocalStack(maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await client.send(new ListAliasesCommand({ Limit: 1 }));
      return;
    } catch {
      if (i === maxAttempts - 1)
        throw new Error('LocalStack did not become ready after 30 seconds');
      process.stdout.write('.');
      await new Promise<void>((r) => {
        setTimeout(r, 1000);
      });
    }
  }
}

async function getOrCreateKeyArn(): Promise<string> {
  const { Aliases } = await client.send(new ListAliasesCommand({}));
  const existing = Aliases?.find((a) => a.AliasName === ALIAS);
  if (existing?.TargetKeyId) {
    return `arn:aws:kms:us-east-1:${ACCOUNT}:key/${existing.TargetKeyId}`;
  }

  const { KeyMetadata } = await client.send(
    new CreateKeyCommand({
      Description: 'huckleberry-dev',
      KeyUsage: 'ENCRYPT_DECRYPT',
    }),
  );
  const keyId = KeyMetadata?.KeyId;
  const keyArn = KeyMetadata?.Arn;
  if (!keyId || !keyArn)
    throw new Error('KMS CreateKey returned empty metadata');

  await client.send(
    new CreateAliasCommand({
      AliasName: ALIAS,
      TargetKeyId: keyId,
    }),
  );
  return keyArn;
}

async function main() {
  process.stdout.write('Waiting for LocalStack');
  await waitForLocalStack();
  console.log('\nLocalStack ready.');

  const arn = await getOrCreateKeyArn();

  console.log('\nAdd to your .env:\n');
  console.log(`  KMS_ENDPOINT=${ENDPOINT}`);
  console.log(`  KMS_KEY_ARN=${arn}`);
  console.log('\nThen restart the server (pnpm start:dev).');
  console.log(
    '\nNote: no AWS credentials needed — the server uses LocalStack dummy creds automatically.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
