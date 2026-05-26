/**
 * Verifies AWS credentials resolve and the role is what you expect.
 * Run: `node --experimental-strip-types probe-identity.ts`
 */
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const sts = new STSClient({ region: 'us-east-1' });
const { Account, Arn, UserId } = await sts.send(
  new GetCallerIdentityCommand({}),
);

console.log(JSON.stringify({ Account, Arn, UserId }, null, 2));
