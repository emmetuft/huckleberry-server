/**
 * Describes the dev3 Aurora cluster. Useful to grab the writer + reader
 * endpoints and the DbClusterResourceId (the latter goes into IAM
 * policies for the `rds-db:connect` action).
 *
 * Override with `--cluster <id>`.
 * Run: `node --experimental-strip-types probe-aurora.ts`
 */
import { RDSClient, DescribeDBClustersCommand } from '@aws-sdk/client-rds';

const cluster =
  process.argv[process.argv.indexOf('--cluster') + 1] ??
  'dev3-huckleberry-1-cluster';

const rds = new RDSClient({ region: 'us-east-1' });
const { DBClusters } = await rds.send(
  new DescribeDBClustersCommand({ DBClusterIdentifier: cluster }),
);
const c = DBClusters?.[0];
if (!c) throw new Error(`cluster not found: ${cluster}`);

console.log(
  JSON.stringify(
    {
      cluster,
      writer: c.Endpoint,
      reader: c.ReaderEndpoint,
      engine: `${c.Engine} ${c.EngineVersion ?? ''}`.trim(),
      resourceId: c.DbClusterResourceId,
      status: c.Status,
    },
    null,
    2,
  ),
);
