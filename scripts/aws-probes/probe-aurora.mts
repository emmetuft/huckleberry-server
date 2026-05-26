/**
 * Describes the dev3 Aurora cluster. Useful to grab the writer + reader
 * endpoints and the DbClusterResourceId (the latter goes into IAM
 * policies for the `rds-db:connect` action).
 *
 * Override with `--cluster <id>`.
 * Run: `node --experimental-strip-types probe-aurora.mts`
 */
import { RDSClient, DescribeDBClustersCommand } from '@aws-sdk/client-rds';

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const cluster = arg('--cluster', 'dev3-huckleberry-1-cluster');

const rds: RDSClient = new RDSClient({ region: 'us-east-1' });

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
