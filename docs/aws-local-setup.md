# Local AWS setup

Prereq for both deployment docs. Gets your laptop ready to talk to the dev3 / staging / prod AWS resources — reading secrets, port-forwarding to Aurora, listing S3 buckets, running ad-hoc SDK probes. Do this once.

Sibling docs:

- `docs/deployment-bff.md` — BFF deploy runbook (uses this for the Aurora bootstrap step).
- `~/dev/huckleberry/docs/deployment-fe.md` — SPA deploy runbook (uses this for the S3 upload step).

## What you're setting up

```
laptop ─┬─ AWS CLI v2  ─┐
        │                ├─ talks to ─► AWS APIs over HTTPS
        └─ AWS SDK (JS)  ┘                (Secrets, S3, RDS, ECS, SSM, ...)
                ▲
                │ uses credentials from
                │
            ~/.aws/credentials  (or SSO cache)
            ~/.aws/config
```

Two clients, one credential store. The CLI is for ops (port-forward, run-task, secret reads). The SDK is for app code (the BFF reading IAM tokens at runtime) and for one-off TypeScript probes when you want richer logic than a shell pipeline.

## 1. Install

```bash
# AWS CLI v2 (not v1 — v2 supports SSO properly)
brew install awscli

# jq — for slicing secret JSON
brew install jq

# AWS Session Manager plugin — required for the SSM port-forward to Aurora
brew install --cask session-manager-plugin

# Verify
aws --version           # aws-cli/2.x.x
session-manager-plugin --version
```

## 2. Authenticate

Most Domo AWS accounts use **SSO** (single sign-on). Configure a per-account profile so you can switch between dev3 / staging / prod without re-logging in each time.

```bash
aws configure sso
```

You'll get walked through:

- **SSO session name** — pick anything, e.g. `domo`.
- **SSO start URL** — the AWS access portal URL (your IT team has it; typically `https://<org>.awsapps.com/start`).
- **SSO region** — `us-east-1`.
- **Account / role picker** — choose the dev3 account + an appropriate role (AdministratorAccess or PowerUserAccess in dev).
- **Default region** — `us-east-1`.
- **Profile name** — name it after the env, e.g. `huckleberry-dev3`.

Then:

```bash
# Log in (once per ~8h, depending on org settings)
aws sso login --profile huckleberry-dev3

# Make it the default for this shell, or pass --profile every command
export AWS_PROFILE=huckleberry-dev3
```

**Sanity check:**

```bash
aws sts get-caller-identity
# {
#   "UserId":  "AROAEXAMPLEABCDEFG:jon.tiritilli@domo.com",
#   "Account": "<ACCOUNT_ID>",
#   "Arn":     "arn:aws:sts::<ACCOUNT_ID>:assumed-role/AWSReservedSSO_..."
# }
```

If `UserId` includes `AROAEXAMPLE...` and the right email, you're in.

## 3. Smoke tests

Each of these confirms one piece of the AWS surface area the deploys depend on.

### 3.1. Read the dev3 master DB secret

```bash
aws secretsmanager get-secret-value \
  --secret-id dev3-huckleberry \
  --query SecretString --output text | jq .
# {
#   "username": "admin",
#   "password": "<long-random-string>",
#   "engine":   "mysql",
#   "host":     "dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com",
#   ...
# }
```

If you see the JSON, your IAM has `secretsmanager:GetSecretValue` on the resource. If you see `AccessDeniedException`, the role you assumed via SSO doesn't have read on that secret — ask the AWS admin.

### 3.2. List S3 buckets (FE deploy prereq)

```bash
aws s3 ls
# 2026-05-15 09:12:33 huckleberry-fe-dev3
# 2026-05-15 09:12:51 huckleberry-fe-staging
# ...

aws s3 ls s3://huckleberry-fe-dev3/
# (empty if you haven't deployed anything yet — that's fine)
```

### 3.3. Describe the Aurora cluster

```bash
aws rds describe-db-clusters \
  --db-cluster-identifier dev3-huckleberry-1-cluster \
  --query 'DBClusters[0].{
    Endpoint: Endpoint,
    Reader:   ReaderEndpoint,
    Engine:   EngineVersion,
    ResourceId: DbClusterResourceId
  }'
# {
#   "Endpoint":   "dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com",
#   "Reader":     "dev3-huckleberry-1-cluster.cluster-ro-cjeyhncfcola.us-east-1.rds.amazonaws.com",
#   "Engine":     "8.4.x",
#   "ResourceId": "cluster-ABCD..."
# }
```

The `ResourceId` is what goes into IAM policies for the `rds-db:connect` action (see `deployment-bff.md` § 4).

## 4. Connecting to Aurora from your laptop

The cluster lives in a private subnet — no direct internet route. Two options:

### Option A: SSM Session Manager port-forward via a bastion EC2

```bash
# Replace <bastion-instance-id> with an EC2 instance tagged for SSM in the same VPC.
aws ssm start-session \
  --target <bastion-instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{
    "host":["dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com"],
    "portNumber":["3306"],
    "localPortNumber":["13306"]
  }'
# Leaves a foreground "Starting session ..." process. Keep it running; open another shell.
```

Then in a second terminal:

```bash
# Read master password
MASTER_PW=$(aws secretsmanager get-secret-value \
  --secret-id dev3-huckleberry --query SecretString --output text | jq -r .password)

# Connect via the local forwarded port
mysql -h 127.0.0.1 -P 13306 -u admin -p"$MASTER_PW" huckleberry

# Or run migrations from huckleberry-server checkout
cd ~/dev/huckleberry-server
DATABASE_URL="mysql://admin:${MASTER_PW}@127.0.0.1:13306/huckleberry" pnpm db:migrate
```

### Option B: AWS VPN

If your AWS account has a Client VPN endpoint, install the AWS VPN Client (`brew install --cask aws-vpn-client`), import the config file, connect. Aurora's writer/reader endpoints are then directly reachable on 3306.

## 5. Ad-hoc SDK probes

For things that don't fit shell pipelines — multi-step flows, parsing complex outputs — write a TypeScript probe. The pattern:

### Where to keep them

- **Keepers** (worth committing): `huckleberry-server/scripts/aws-probes/<name>.ts`. They live alongside the code they support, get type-checked, can import from `src/`.
- **Throwaways** (exploration, secrets in shell history risk): `~/dev/huckleberry-aws/` as a personal scratch dir. Don't commit. Drop the existing `~/nodegetstarted` and use this layout if you want a stable home.

### Minimal smoke script

```ts
// ~/dev/huckleberry-aws/probe-secret.ts
import { SecretsManagerClient, GetSecretValueCommand }
  from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });

const r = await client.send(new GetSecretValueCommand({
  SecretId: 'dev3-huckleberry',
}));

const secret = JSON.parse(r.SecretString!);
console.log('host:', secret.host);
console.log('user:', secret.username);
// (don't print the password)
```

Run with:

```bash
# In ~/dev/huckleberry-aws or wherever the script lives
node --experimental-strip-types probe-secret.ts
```

Node 24's `--experimental-strip-types` runs `.ts` files directly — no `tsx`/`ts-node` needed for one-offs. Pick `tsx` if you want stable module resolution for imports.

### S3 probe

```ts
// ~/dev/huckleberry-aws/probe-s3.ts
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
const s3 = new S3Client({ region: 'us-east-1' });

const r = await s3.send(new ListObjectsV2Command({
  Bucket: 'huckleberry-fe-dev3',
  MaxKeys: 10,
}));
console.log('keys:', r.Contents?.map((o) => o.Key));
```

Same `AWS_PROFILE` env var that drives the CLI also drives the SDK — no separate auth dance.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `Unable to locate credentials` | Run `aws sso login --profile huckleberry-dev3`, then re-export `AWS_PROFILE`. SSO sessions expire (~8h). |
| `ExpiredTokenException` mid-session | Same as above — SSO token's gone, re-login. |
| `AccessDeniedException` reading a specific resource | Your assumed role doesn't have the action+resource combo. Run `aws sts get-caller-identity` to confirm which role you're on, then ask the AWS admin for the policy. |
| SSM port-forward hangs / "Session ended" instantly | The bastion EC2 is stopped, isn't tagged for SSM, or its SG doesn't allow egress to Aurora on 3306. `aws ssm describe-instance-information` lists which instances are reachable. |
| `ECONNREFUSED 127.0.0.1:13306` from `mysql` | The port-forward process died or you're in the wrong shell. The `aws ssm start-session` must stay in the foreground in some terminal. |
| Node `fetch failed` from the AWS SDK on Node 24 | Set `AWS_HTTP_TIMEOUT_MILLIS=10000` to surface the real underlying timeout. Or downgrade to Node 22 LTS if it keeps flaking. |
| `Unable to verify/decode JWT` from SSO | Your `~/.aws/sso/cache/*.json` got stale. Delete the cache file and `aws sso login` again. |

## 7. What's out of scope here

This doc gets your laptop talking to AWS. It deliberately doesn't cover:

- **Provisioning AWS resources** — see `deployment-bff.md` (Aurora, ECS, ALB) and `deployment-fe.md` (S3, CloudFront).
- **Permissions you need to actually deploy** — those live on the roles GitHub Actions assumes via OIDC, not on your laptop's SSO role.
- **Migrations as a CD step** — your laptop runs the first migration once; from then on, GH Actions runs them. See `deployment-bff.md` § "GitHub Actions CD".
