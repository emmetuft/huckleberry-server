# BFF deployment — AWS production

End-to-end runbook for getting `huckleberry-server` running in AWS, with a CD pipeline triggered by `git push`. Sibling doc for the SPA: `~/dev/huckleberry/docs/deployment-fe.md`.

## What you're standing up

```
       Route 53                    CloudFront                       ALB
   huckleberry.com  ────►   distribution (us-east-1 cert)  ──►  api target group
                                  │                              │
                                  │ /* → S3 origin               │
                                  │ /api/* → ALB origin          ▼
                                  ▼                          ECS Fargate
                            S3 (SPA bundle)            ┌──── huckleberry-bff ────┐
                                                       │  task 1   task 2  …    │
                                                       └──┬──────────┬──────────┘
                                                          │          │
                                                          ▼          ▼
                                                   Aurora MySQL 8.4 (IAM-auth)
                                                          │
                                                          ▼
                                                  Secrets Mgr · SSM · KMS · SES
```

What each piece is for:

- **ECR** — private Docker image registry. Each commit pushes a tagged image here, and ECS pulls from it.
- **ECS Fargate** — runs the containerized BFF without managing EC2 hosts. 2+ tasks behind an ALB for HA.
- **ALB** — terminates TLS, health-checks `/health`, distributes to ECS tasks. Lives in a public subnet.
- **Aurora MySQL 8.4** — your existing cluster. Connect via IAM auth: the ECS task role signs a 15-min token instead of holding a password.
- **Secrets Manager + SSM Parameter Store** — secrets vs. non-secret config; the task reads both at boot. SM costs $0.40/secret/month, SSM is free for standard parameters.
- **CloudFront** — fronts both the SPA (S3 origin) and the API (ALB origin), so the browser stays same-origin. The same `hb_session` cookie covers `huckleberry.com` and `huckleberry.com/api/*`.
- **GitHub Actions + OIDC** — the CD pipeline. No long-lived AWS keys stored in GitHub; each workflow run assumes an IAM role via short-lived OIDC tokens.

Assumptions throughout: region **`us-east-1`**. Domain **`huckleberry.com`**.

---

## Environments

Each environment has its own AWS resources following the naming pattern `<env>-huckleberry-*`. The doc uses `<env>` as a placeholder so the same instructions cover dev3 / staging / prod.

| Env | Aurora cluster | Master-cred secret | SM prefix | SSM prefix |
|---|---|---|---|---|
| **dev3** | `dev3-huckleberry-1-cluster` | `dev3-huckleberry` | `dev3-huckleberry/*` | `/dev3-huckleberry/*` |
| staging | _TBD_ | _TBD_ | `staging-huckleberry/*` | `/staging-huckleberry/*` |
| prod | _TBD_ | _TBD_ | `huckleberry/*` (no env prefix) | `/huckleberry/*` |

**dev3 endpoints** (current):

```
Writer:  dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com
Reader:  dev3-huckleberry-1-cluster.cluster-ro-cjeyhncfcola.us-east-1.rds.amazonaws.com
```

When the doc says `huckleberry/*` (e.g. `huckleberry/session-signing-key`), substitute the env's actual prefix: `dev3-huckleberry/session-signing-key` for dev3.

---

## One-time AWS setup

Done once per environment (dev/staging/prod). The rest of the doc assumes prod is the target.

### 1. ECR repository for the BFF image

```bash
aws ecr create-repository \
  --repository-name huckleberry-bff \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE \
  --region us-east-1
```

Immutable tags prevent us from re-tagging an older image as `latest` — every deploy gets a unique tag (the git SHA).

### 2. OIDC identity provider for GitHub Actions

GitHub Actions can request short-lived AWS credentials by presenting a JWT signed by GitHub's OIDC issuer. AWS verifies the JWT, then issues STS tokens scoped to the role you assign. No `AWS_ACCESS_KEY_ID` lives in GitHub.

```bash
# Once per AWS account
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

The thumbprint is GitHub's; AWS verifies signatures against it.

### 3. IAM: deployment role assumed by the BFF workflow

Trust policy (who can assume it): GitHub Actions OIDC, scoped to your repo:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub":
          "repo:domo-development/huckleberry-server:*"
      }
    }
  }]
}
```

Permissions (what it can do): push to ECR, register task defs, update the ECS service, run one-off tasks (for migrations), and read deployment status.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition",
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:RunTask",
        "ecs:DescribeTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-task",
        "arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-exec"
      ]
    }
  ]
}
```

Save the role ARN — the GitHub workflow needs it.

### 4. IAM: ECS task role (what the running BFF can do)

The **task role** is what the container's process sees as its AWS identity. Distinct from the **execution role** (next step) which is what ECS itself uses to pull the image and write logs.

Trust policy: only ECS tasks can assume it.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Permissions: connect to Aurora via IAM, read its secrets + parameters, send mail via SES.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AuroraIamAuth",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:us-east-1:<ACCOUNT_ID>:dbuser:<DB_CLUSTER_RESOURCE_ID>/huckleberry_app"
    },
    {
      "Sid": "ReadSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:<ACCOUNT_ID>:secret:huckleberry/*"
    },
    {
      "Sid": "ReadParams",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/huckleberry/*"
    },
    {
      "Sid": "SesSend",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
```

`<DB_CLUSTER_RESOURCE_ID>` is the Aurora cluster's resource ID (looks like `cluster-ABCD1234...`), not its arn. `aws rds describe-db-clusters --query 'DBClusters[0].DbClusterResourceId'` gets it.

### 5. IAM: ECS execution role

What ECS uses to do bookkeeping — pull the image, write logs. Standard AWS-managed policy works:

```bash
aws iam create-role --role-name huckleberry-bff-exec ...
aws iam attach-role-policy --role-name huckleberry-bff-exec \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### 6. Secrets Manager + SSM Parameter Store

Secrets:

```bash
aws secretsmanager create-secret \
  --name huckleberry/session-signing-key \
  --secret-string "$(openssl rand -hex 32)"

aws secretsmanager create-secret \
  --name huckleberry/admin-api-key \
  --secret-string "$(openssl rand -hex 32)"
```

Non-secret config (one SSM parameter per logical setting):

```bash
aws ssm put-parameter --name /huckleberry/database/host       --value <writer-endpoint> --type String
aws ssm put-parameter --name /huckleberry/database/name       --value huckleberry --type String
aws ssm put-parameter --name /huckleberry/database/user       --value huckleberry_app --type String
aws ssm put-parameter --name /huckleberry/domo-oauth/client-id --value <DCR client_id> --type String
aws ssm put-parameter --name /huckleberry/gatekeeper/issuers   --value <comma-list> --type StringList
aws ssm put-parameter --name /huckleberry/magic-link/base-url  --value https://huckleberry.com --type String
```

The BFF reads both at boot and assembles `process.env` equivalents — keeps `.env`-style code without `.env` files in the container.

### 7. Aurora — bootstrap migrations + IAM-auth users

One-time per environment. Walk-through with the dev3 cluster:

```bash
# 1. Read the master password from Secrets Manager.
MASTER_PW=$(aws secretsmanager get-secret-value \
  --secret-id dev3-huckleberry \
  --query SecretString --output text | jq -r .password)

# 2. Port-forward via SSM Session Manager to the bastion (or VPN in).
#    The Aurora cluster lives in a private subnet — no direct internet route.
aws ssm start-session --target i-<bastion> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{
    "host":["dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com"],
    "portNumber":["3306"],
    "localPortNumber":["13306"]
  }'

# 3. Apply Drizzle migrations against the writer endpoint.
DATABASE_URL="mysql://admin:${MASTER_PW}@localhost:13306/huckleberry" \
  pnpm db:migrate
```

> Format of the master secret: AWS RDS sets up `dev3-huckleberry` as a JSON secret with `{ "username": "admin", "password": "..." }` if it was created through the RDS-managed flow. If yours is plain text, drop the `| jq -r .password` from step 1.

Then create the IAM-authenticated app + migration users. Connect with `mysql -h 127.0.0.1 -P 13306 -u admin -p"$MASTER_PW"` and run:

```sql
CREATE USER 'huckleberry_app'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
GRANT SELECT, INSERT, UPDATE, DELETE ON huckleberry.* TO 'huckleberry_app'@'%';

CREATE USER 'huckleberry_migrate'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
GRANT ALL ON huckleberry.* TO 'huckleberry_migrate'@'%';
```

The `AWSAuthenticationPlugin` plugin trades the connection-time password for an IAM-signed token. The app token role gets `SELECT/INSERT/UPDATE/DELETE` only — no DDL, so a runaway query can't `DROP TABLE`. The migration role gets everything but is only used by the one-shot migration task.

### 8. VPC + security groups

Aurora and the ECS service must be in the same VPC. ECS tasks talk to Aurora on 3306 over a private subnet — never over the public internet.

Security groups (assuming you have the VPC):

- **`sg-bff`** — attached to ECS tasks. Outbound 443 to anywhere (Domo, SES, ECR), outbound 3306 to `sg-aurora` only.
- **`sg-aurora`** — attached to the Aurora cluster. Inbound 3306 from `sg-bff` only.
- **`sg-alb`** — attached to the ALB. Inbound 443 from `0.0.0.0/0`, outbound to `sg-bff:3000`.
- **`sg-bff`** also gets inbound 3000 from `sg-alb`.

### 9. ALB + ACM + Route 53

ACM cert in `us-east-1` (where the ALB lives — separate cert in us-east-1 will follow for CloudFront):

```bash
aws acm request-certificate \
  --domain-name api.huckleberry.com \
  --validation-method DNS \
  --region us-east-1
```

Validate by adding the CNAME record ACM provides into Route 53. Standard 5–15 minute wait.

Then create the ALB pointing at port 443 with that cert, a target group for the BFF (port 3000, health check `GET /health`, healthy threshold 2, interval 15s), and a Route 53 alias `api.huckleberry.com` → ALB.

### 10. ECS cluster + task definition + service

Cluster:

```bash
aws ecs create-cluster --cluster-name huckleberry --region us-east-1
```

Task definition (committed in the repo at `infra/ecs/bff-task-def.json` — generate-and-commit pattern):

```json
{
  "family": "huckleberry-bff",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-exec",
  "taskRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-task",
  "containerDefinitions": [{
    "name": "bff",
    "image": "<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/huckleberry-bff:<TAG_REPLACED_AT_DEPLOY>",
    "essential": true,
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "AWS_REGION", "value": "us-east-1" }
    ],
    "secrets": [
      {
        "name": "SESSION_SIGNING_KEY",
        "valueFrom": "arn:aws:secretsmanager:us-east-1:<ACCT>:secret:huckleberry/session-signing-key"
      },
      {
        "name": "ADMIN_API_KEY",
        "valueFrom": "arn:aws:secretsmanager:us-east-1:<ACCT>:secret:huckleberry/admin-api-key"
      }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/huckleberry-bff",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "bff"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
      "interval": 15, "timeout": 5, "retries": 3, "startPeriod": 30
    }
  }]
}
```

ECS service:

```bash
aws ecs create-service \
  --cluster huckleberry \
  --service-name bff \
  --task-definition huckleberry-bff \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-priv-a,subnet-priv-b],securityGroups=[sg-bff],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<TG_ARN>,containerName=bff,containerPort=3000" \
  --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200"
```

`min=100/max=200` is the rolling-deploy default — at least all old tasks stay healthy while new ones come up, then old drain. Zero-downtime updates.

---

## Code we need to add to the repo

Three small additions before we can deploy.

### 1. `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Why multi-stage: the `deps` and `build` stages have dev deps + sources; the final `runtime` image strips them, so the deployed image is ~120MB instead of ~600MB.

### 2. IAM-auth wiring in `src/common/db/db.module.ts`

mysql2's `password` accepts a callback that's invoked per-connection. Use it to mint a fresh RDS IAM token each time:

```ts
import { Signer } from '@aws-sdk/rds-signer';
// …
const signer = new Signer({
  region: process.env.AWS_REGION,
  hostname: app.databaseHost,
  port: 3306,
  username: app.databaseUser,
});
const pool = createPool({
  host: app.databaseHost,
  port: 3306,
  user: app.databaseUser,
  database: app.databaseName,
  password: async () => signer.getAuthToken(),  // 15-min token; mysql2 refreshes per connection
  ssl: { rejectUnauthorized: true },             // Aurora's CA bundle is in the base image
  // …
});
```

`@aws-sdk/rds-signer` is one extra runtime dep. The token comes from STS, signed by the ECS task role.

### 3. `scripts/migrate-prod.ts` — locked migration runner

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool, sql } from 'mysql2/promise';
import { Signer } from '@aws-sdk/rds-signer';
// …config load…

const pool = createPool({ /* IAM-auth, migrate user */ });
const db = drizzle(pool);

const [lockRow] = await pool.execute("SELECT GET_LOCK('hb_migrate', 30) AS got");
if ((lockRow as any)[0].got !== 1) {
  throw new Error('Another deploy is migrating; aborting');
}
try {
  await migrate(db, { migrationsFolder: './drizzle' });
} finally {
  await pool.execute("SELECT RELEASE_LOCK('hb_migrate')");
}
await pool.end();
```

Why the lock: multiple ECS tasks may start concurrently on a rolling deploy. Without coordination, two could race on `CREATE TABLE`. `GET_LOCK('hb_migrate', 30)` is MySQL's named advisory lock — one process wins, the others block up to 30s then bail. The winner runs Drizzle's idempotent migrator; later winners see no pending migrations and no-op.

The CD pipeline runs this as a separate ECS **task** (not service) before swapping the service to the new image — so if migrations fail, the deploy aborts before any traffic hits the new code.

---

## First manual deploy (smoke test before CD)

```bash
# Auth to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <ACCT>.dkr.ecr.us-east-1.amazonaws.com

# Build + push (use commit SHA for the tag)
TAG=$(git rev-parse --short HEAD)
docker build -t huckleberry-bff:$TAG .
docker tag huckleberry-bff:$TAG <ACCT>.dkr.ecr.us-east-1.amazonaws.com/huckleberry-bff:$TAG
docker push <ACCT>.dkr.ecr.us-east-1.amazonaws.com/huckleberry-bff:$TAG

# Run migrations once
aws ecs run-task --cluster huckleberry \
  --task-definition huckleberry-bff-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-priv-a],securityGroups=[sg-bff]}"

# Update service to the new image
aws ecs update-service --cluster huckleberry --service bff \
  --task-definition $(aws ecs register-task-definition --cli-input-json file://task-def-rendered.json --query 'taskDefinition.taskDefinitionArn' --output text)

# Smoke
curl https://api.huckleberry.com/health
```

---

## GitHub Actions CD — `.github/workflows/deploy-bff.yml`

```yaml
name: Deploy BFF

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write   # required for OIDC
  contents: read

env:
  AWS_REGION: us-east-1
  ECR_REPO: huckleberry-bff
  ECS_CLUSTER: huckleberry
  ECS_SERVICE: bff
  TASK_FAMILY: huckleberry-bff

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<ACCT>:role/huckleberry-bff-deploy
          aws-region: ${{ env.AWS_REGION }}

      - name: Log in to ECR
        id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build + push image
        id: build
        run: |
          IMAGE_URI=${{ steps.ecr.outputs.registry }}/${{ env.ECR_REPO }}:${{ github.sha }}
          docker build -t $IMAGE_URI .
          docker push $IMAGE_URI
          echo "image=$IMAGE_URI" >> $GITHUB_OUTPUT

      - name: Render migrate task definition
        run: |
          jq --arg img "${{ steps.build.outputs.image }}" \
             '.containerDefinitions[0].image = $img' \
             infra/ecs/bff-migrate-task-def.json > migrate.rendered.json

      - name: Register migrate task def
        id: migrate-td
        run: |
          ARN=$(aws ecs register-task-definition \
                  --cli-input-json file://migrate.rendered.json \
                  --query 'taskDefinition.taskDefinitionArn' --output text)
          echo "arn=$ARN" >> $GITHUB_OUTPUT

      - name: Run migrations
        run: |
          TASK_ARN=$(aws ecs run-task --cluster ${{ env.ECS_CLUSTER }} \
            --task-definition ${{ steps.migrate-td.outputs.arn }} \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=DISABLED}" \
            --query 'tasks[0].taskArn' --output text)
          aws ecs wait tasks-stopped --cluster ${{ env.ECS_CLUSTER }} --tasks $TASK_ARN
          EXIT=$(aws ecs describe-tasks --cluster ${{ env.ECS_CLUSTER }} --tasks $TASK_ARN \
                 --query 'tasks[0].containers[0].exitCode' --output text)
          [ "$EXIT" = "0" ] || { echo "Migration failed"; exit 1; }
        env:
          SUBNET: ${{ vars.PRIVATE_SUBNET_A }}
          SG: ${{ vars.SG_BFF }}

      - name: Render service task definition
        run: |
          jq --arg img "${{ steps.build.outputs.image }}" \
             '.containerDefinitions[0].image = $img' \
             infra/ecs/bff-task-def.json > service.rendered.json

      - name: Register service task def
        id: service-td
        run: |
          ARN=$(aws ecs register-task-definition \
                  --cli-input-json file://service.rendered.json \
                  --query 'taskDefinition.taskDefinitionArn' --output text)
          echo "arn=$ARN" >> $GITHUB_OUTPUT

      - name: Deploy
        run: |
          aws ecs update-service \
            --cluster ${{ env.ECS_CLUSTER }} \
            --service ${{ env.ECS_SERVICE }} \
            --task-definition ${{ steps.service-td.outputs.arn }} \
            --force-new-deployment

      - name: Wait for stable
        run: |
          aws ecs wait services-stable \
            --cluster ${{ env.ECS_CLUSTER }} \
            --services ${{ env.ECS_SERVICE }}

      - name: Smoke test
        run: curl --fail https://api.huckleberry.com/health
```

Pipeline phases:
1. Checkout + assume the deploy role via OIDC.
2. Build the image, tag with the commit SHA, push to ECR.
3. Run the migration ECS task as a one-shot; wait for exit code 0.
4. Register a new service task definition pointing at the new image.
5. `update-service --force-new-deployment` triggers rolling replacement (min healthy 100% / max 200%).
6. Wait for the service to reach steady state; smoke `/health` from outside.

If migrations fail, the service never gets the new image — the cluster keeps serving the previous version, no traffic impact.

---

## Observability

CloudWatch picks up the BFF's stdout/stderr via the `awslogs` log driver — `pino` or `nestjs/common` `Logger` output lands at `/ecs/huckleberry-bff`.

Three alarms worth setting up on day 1:

| Alarm | Metric | Threshold |
|---|---|---|
| Service unhealthy | `ECS / RunningTaskCount` < desired for 2 min | Page |
| 5xx surge | ALB `HTTPCode_Target_5XX_Count` > 10 in 5 min | Page |
| Aurora connection saturation | RDS `DatabaseConnections` > 80% of max | Warn |

Aurora Performance Insights is on by default and is the first thing you'll want when a query is slow. RDS Slow Query Logs to CloudWatch for queries over 1s.

---

## Rollback

Two paths, fast to slow:

1. **Bad service, schema's fine** — `aws ecs update-service --task-definition huckleberry-bff:<PREVIOUS_REVISION>`. ECS rolls back in 1–2 minutes.
2. **Bad migration** — the migration ran and broke something. Drizzle migrations are forward-only by design; you write a new corrective migration and deploy again. If the issue is data corruption: restore from a point-in-time snapshot, which Aurora keeps for 35 days by default. Plan: write down `aws rds restore-db-cluster-to-point-in-time --target-db-cluster-identifier huckleberry-rollback --source-db-cluster-identifier huckleberry-prod --restore-to-time <ISO>` somewhere accessible. It creates a parallel cluster you cut over to.

---

## Cost estimate (rough, us-east-1, low traffic)

| Resource | Monthly |
|---|---|
| Aurora MySQL Serverless v2 (0.5–2 ACU) | $50–200 |
| ECS Fargate (2 × 0.5 vCPU / 1 GB) | $20–25 |
| ALB | $20 |
| Secrets Manager (4 secrets × $0.40) | $1.60 |
| SSM Parameter Store (standard) | free |
| CloudWatch Logs (~5 GB) | $2 |
| SES (10k emails) | $1 |
| Data transfer out (1 GB) | $0.09 |
| **Total** | **~$95–250** |

Aurora dominates. Use Serverless v2 with min capacity 0.5 ACU until traffic justifies more.
