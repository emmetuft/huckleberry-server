# BFF deployment — AWS production

End-to-end runbook for getting `huckleberry-server` running in AWS, with a CD pipeline triggered by `git push`.

**Prereq:** laptop-side AWS access set up per **[`docs/aws-local-setup.md`](aws-local-setup.md)** (AWS CLI, SSO profile, SSM Session Manager plugin). The Aurora bootstrap step below assumes you can already run `aws sts get-caller-identity` and `aws secretsmanager get-secret-value` against dev3.

**Sibling doc:** `~/dev/huckleberry/docs/deployment-fe.md` — same shape, for the SPA.

**Related repos:**
- `~/dev/domo-helm` — Helm chart monorepo; `charts/huckleberry/` is the BFF chart
- `~/dev/huckleberry-gitops` — Argo CD GitOps repo; `instances/dev-ai/<env>/` holds per-environment Helm values

## What you're standing up

```
      Route 53               CloudFront                       ALB
  huckleberry.ai  ──►  distribution (us-east-1 cert)  ──►  (AWS Load Balancer Controller)
                                │                                   │
                                │ /* → S3 origin                    │
                                │ /api/* → ALB origin               ▼
                                ▼                        EKS cluster (us-east-1)
                          S3 (SPA bundle)      ┌─────── namespace: <env> ───────────┐
                                               │  Deployment: pod 1   pod 2   …     │
                                               │  Service (ClusterIP) → Ingress     │
                                               │  ServiceAccount + IRSA → AWS IAM   │
                                               │  ExternalSecret ← Secrets Manager  │
                                               │  Job (migrations, pre-upgrade hook) │
                                               └──────────────┬─────────────────────┘
                                                              │
                                                              ▼
                                                   Aurora MySQL 8.4 (IAM-auth)
                                                              │
                                                              ▼
                                                   Secrets Mgr · KMS · SES
```

What each piece is for:

- **ECR** — private Docker image registry. Each Jenkins build pushes a date-tagged image here; EKS pulls from it.
- **EKS** — managed Kubernetes cluster. Already running in us-east-1 (account `972900829293`). Namespace per environment (e.g. `dev3`).
- **domo-helm** — chart monorepo (`~/dev/domo-helm`). `charts/huckleberry/` packages the BFF's k8s resources. Published to ECR OCI on every Jenkins build.
- **huckleberry-gitops** — Argo CD GitOps repo (`~/dev/huckleberry-gitops`). Each environment has `instances/dev-ai/<env>/values.yaml` (Helm values) and `config.yaml` (chart version). Argo CD auto-syncs when these files change.
- **Argo CD ApplicationSet** — watches `huckleberry-gitops` and creates one Argo CD Application per environment directory automatically.
- **AWS Load Balancer Controller** — in-cluster; watches `Ingress` resources and provisions ALBs.
- **External Secrets Operator** — in-cluster; syncs AWS Secrets Manager values into k8s `Secret` objects.
- **IRSA** — IAM Roles for Service Accounts. The pod's ServiceAccount is annotated with an IAM role ARN; EKS OIDC federates with IAM for scoped, short-lived credentials.
- **Aurora MySQL 8.4** — connect via IAM auth (RDS auth token from the IRSA role, not a stored password).
- **CloudFront** — fronts both origins (S3 for SPA, ALB for API), keeping `hb_session` cookies same-origin.

Assumptions throughout: region **`us-east-1`**, account **`972900829293`**. Production domain **`huckleberry.ai`**. Dev3 host **`huckleberry-dev.domotech.io`**.

---

## Environments

| Env      | Namespace | Host                          | Aurora cluster               | Gitops path                        |
| -------- | --------- | ----------------------------- | ---------------------------- | ---------------------------------- |
| **dev3** | `dev3`    | `huckleberry-dev.domotech.io` | `dev3-huckleberry-1-cluster` | `instances/dev-ai/dev3/`           |
| staging  | TBD       | TBD                           | TBD                          | `instances/dev-ai/staging/`        |
| prod     | TBD       | `huckleberry.ai`              | TBD                          | `instances/dev-ai/prod/`           |

**dev3 Aurora endpoints:**
```
Writer:  dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com
Reader:  dev3-huckleberry-1-cluster.cluster-ro-cjeyhncfcola.us-east-1.rds.amazonaws.com
```

---

## How deployments work (GitOps flow)

```
  huckleberry-server  ──push──►  Jenkins  ──build+push──►  ECR
                                     │
                                     └──update image.tag──►  huckleberry-gitops
                                                                     │
                                                              Argo CD watches
                                                                     │
                                                                     ▼
                                                            EKS cluster (auto-sync)
```

1. Push to `main` in `huckleberry-server` triggers Jenkins via GitHub Actions webhook.
2. Jenkins builds the Docker image, tags it `YYYY-MM-DD-b<N>`, pushes to:
   `972900829293.dkr.ecr.us-east-1.amazonaws.com/huckleberry/huckleberry-bff:<tag>`
3. Jenkins updates `image.tag` in `huckleberry-gitops/instances/dev-ai/<env>/values.yaml` and commits.
4. Argo CD detects the change (auto-sync, self-heal enabled) and runs `helm upgrade`.
5. The migration Job (`job-migrate.yaml`) runs as a Helm pre-upgrade hook before the Deployment rolls.

To change which chart version an environment uses, update `chartVersion` in `instances/dev-ai/<env>/config.yaml`.

---

## One-time AWS setup

Done once per environment. The rest of the doc assumes prod is the target.

### 1. ECR repository for the BFF image

```bash
aws ecr create-repository \
  --repository-name huckleberry/huckleberry-bff \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE \
  --region us-east-1
```

Immutable tags prevent re-tagging an older image — every deploy gets a unique tag.

### 2. IAM: deployment role assumed by Jenkins

Jenkins needs to push to ECR. Use an IAM user or role depending on how Jenkins is configured in your org. Minimum permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PushToEcr",
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
    }
  ]
}
```

### 3. IAM: Pod role via IRSA (what the running BFF can do)

The **pod role** is what the BFF container sees as its AWS identity. Set up via IRSA: the pod's ServiceAccount is annotated with an IAM role ARN, and the EKS OIDC provider federates with IAM to issue short-lived STS credentials.

Trust policy — only the specific ServiceAccount in the specific namespace can assume it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/<EKS_OIDC_URL>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "<EKS_OIDC_URL>:aud": "sts.amazonaws.com",
          "<EKS_OIDC_URL>:sub": "system:serviceaccount:<ENV>:huckleberry"
        }
      }
    }
  ]
}
```

`<EKS_OIDC_URL>` comes from:
```bash
aws eks describe-cluster --name <CLUSTER_NAME> \
  --query 'cluster.identity.oidc.issuer' --output text | sed 's|https://||'
```

Permissions — Aurora IAM auth, Secrets Manager, SES:

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
      "Sid": "SesSend",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
```

Wire the role ARN into the Helm values:

```yaml
# huckleberry-gitops/instances/dev-ai/<env>/values.yaml
serviceAccount:
  iamRoleArn: arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-pod-<env>
```

> **Note:** `serviceAccount.iamRoleArn` is currently commented out in dev3 values — this needs to be filled in before Aurora IAM auth or SES will work from the pod.

### 4. Secrets Manager

```bash
ENV=dev3   # or prod / staging

aws secretsmanager create-secret \
  --name ${ENV}-huckleberry/session-signing-key \
  --secret-string "$(openssl rand -hex 32)"

aws secretsmanager create-secret \
  --name ${ENV}-huckleberry/admin-api-key \
  --secret-string "$(openssl rand -hex 32)"
```

The ExternalSecret in the Helm chart pulls from the key named in `externalSecret.remoteRef.key`. For dev3 that's `dev-huckleberry-1-admin` (see current values.yaml); for prod use `huckleberry/...`.

### 5. Aurora — bootstrap migrations + IAM-auth users

One-time per environment. Walk-through with the dev3 cluster:

```bash
# 1. Read the master password from Secrets Manager.
MASTER_PW=$(aws secretsmanager get-secret-value \
  --secret-id dev3-huckleberry \
  --query SecretString --output text | jq -r .password)

# 2. Port-forward via SSM Session Manager to the bastion (or VPN in).
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

Then create the IAM-authenticated app + migration users:

```sql
CREATE USER 'huckleberry_app'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
GRANT SELECT, INSERT, UPDATE, DELETE ON huckleberry.* TO 'huckleberry_app'@'%';

CREATE USER 'huckleberry_migrate'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
GRANT ALL ON huckleberry.* TO 'huckleberry_migrate'@'%';
```

### 6. VPC + security groups

Aurora and the EKS nodes must be in the same VPC.

- **`sg-bff`** — attached to BFF pods. Outbound 443 anywhere, outbound 3306 to `sg-aurora` only.
- **`sg-aurora`** — attached to Aurora. Inbound 3306 from `sg-bff` only.
- **`sg-alb`** — attached to ALB. Inbound 443 from `0.0.0.0/0`, outbound to `sg-bff:3000`.
- **`sg-bff`** also gets inbound 3000 from `sg-alb`.

### 7. ACM cert + ALB + Route 53

ACM cert for the API hostname:

```bash
aws acm request-certificate \
  --domain-name api.huckleberry.ai \
  --validation-method DNS \
  --region us-east-1
```

Validate via Route 53 CNAME. Once issued, the cert ARN goes into the environment's `values.yaml`:

```yaml
ingress:
  certificateArn: arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<ID>
```

The ALB is provisioned automatically by the AWS Load Balancer Controller when Argo CD syncs the Ingress resource — no manual `create-load-balancer` step. After the first sync, note the ALB DNS name and create the Route 53 alias.

---

## Helm chart (domo-helm)

The chart lives at `~/dev/domo-helm/charts/huckleberry/`. It is not inside `huckleberry-server`.

Chart layout:
```
charts/huckleberry/
  Chart.yaml
  values.yaml                  ← defaults (environment-agnostic)
  templates/
    _helpers.tpl
    deployment.yaml
    service.yaml
    ingress.yaml
    hpa.yaml
    serviceaccount.yaml
    externalsecret.yaml
    job-migrate.yaml           ← pre-upgrade Helm hook
```

**To make chart changes:**

1. Edit templates in `~/dev/domo-helm/charts/huckleberry/templates/`.
2. **Bump `version` in `Chart.yaml`** (required — Jenkins checks this before publishing).
3. Lint and validate locally:
   ```bash
   helm lint charts/huckleberry/
   helm template huckleberry charts/huckleberry/ -f <path-to-env-values.yaml>
   ```
4. Open a PR; merge triggers Jenkins → packages and pushes the chart to ECR OCI.
5. To roll a new chart version to an environment, update `chartVersion` in `huckleberry-gitops/instances/dev-ai/<env>/config.yaml`.

---

## GitOps config (huckleberry-gitops)

Each environment has two files under `instances/dev-ai/<env>/`:

| File          | Purpose                                      |
| ------------- | -------------------------------------------- |
| `config.yaml` | `chartVersion` — which chart version to run  |
| `values.yaml` | Helm values (image tag, host, secrets, etc.) |

The Argo CD ApplicationSet (`applicationsets/dev-ai.yaml`) auto-discovers every `config.yaml` under `instances/dev-ai/` and creates an Application named `huckleberry-<env>`.

**To add a new environment** (e.g. staging):

```bash
mkdir -p instances/dev-ai/staging

cat > instances/dev-ai/staging/config.yaml <<'EOF'
chartVersion: "0.4.2"
EOF

# Copy dev3 values and adjust host, certs, secrets, etc.
cp instances/dev-ai/dev3/values.yaml instances/dev-ai/staging/values.yaml
```

Commit and push — Argo CD creates the Application automatically.

---

## Code we need to add to huckleberry-server

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

### 2. IAM-auth wiring in `src/common/db/db.module.ts`

```ts
import { Signer } from '@aws-sdk/rds-signer';

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
  password: async () => signer.getAuthToken(), // 15-min token, refreshed per connection
  ssl: { rejectUnauthorized: true },
});
```

### 3. `scripts/migrate-prod.ts` — locked migration runner

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool } from 'mysql2/promise';
import { Signer } from '@aws-sdk/rds-signer';

const pool = createPool({ /* IAM-auth, huckleberry_migrate user */ });
const db = drizzle(pool);

const [lockRow] = await pool.execute("SELECT GET_LOCK('hb_migrate', 30) AS got");
if ((lockRow as any)[0].got !== 1) throw new Error('Another deploy is migrating; aborting');
try {
  await migrate(db, { migrationsFolder: './drizzle' });
} finally {
  await pool.execute("SELECT RELEASE_LOCK('hb_migrate')");
}
await pool.end();
```

`GET_LOCK` prevents concurrent migrations on a rolling deploy — one pod wins, others bail, the Deployment only gets the new image after the Job exits 0.

---

## First manual deploy (smoke test)

```bash
# 1. Auth to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 972900829293.dkr.ecr.us-east-1.amazonaws.com

# 2. Build + push
TAG=$(date +%Y-%m-%d)-b1
docker build -t huckleberry-bff:$TAG .
docker tag huckleberry-bff:$TAG \
  972900829293.dkr.ecr.us-east-1.amazonaws.com/huckleberry/huckleberry-bff:$TAG
docker push 972900829293.dkr.ecr.us-east-1.amazonaws.com/huckleberry/huckleberry-bff:$TAG

# 3. Update gitops (triggers Argo CD sync)
cd ~/dev/huckleberry-gitops
# Edit instances/dev-ai/dev3/values.yaml — set image.tag to $TAG
git add instances/dev-ai/dev3/values.yaml
git commit -m "deploy huckleberry-bff $TAG to dev3"
git push

# 4. Watch Argo CD sync
kubectl -n dev3 rollout status deployment/huckleberry

# 5. Smoke test
curl https://huckleberry-dev.domotech.io/health
```

---

## Jenkins CD pipeline

The Jenkinsfile in `huckleberry-server` should:

1. Build the Docker image, tag it `$(date +%Y-%m-%d)-b${BUILD_NUMBER}`.
2. Push to `972900829293.dkr.ecr.us-east-1.amazonaws.com/huckleberry/huckleberry-bff:<tag>`.
3. Clone `huckleberry-gitops`, update `image.tag` in the target environment's `values.yaml`, commit and push.
4. Argo CD picks up the commit automatically (auto-sync, self-heal).
5. Surface the Argo CD sync status back to Jenkins (via Argo CD API or wait step) and fail the build if the sync fails.

The migration Job runs as a Helm `pre-upgrade` hook — Argo CD won't mark the sync successful until the Job completes. If migrations fail, Argo CD marks the sync degraded and the Deployment is not updated.

---

## Observability

CloudWatch picks up pod stdout/stderr via Fluent Bit (Fargate built-in). Structured JSON logs land at `/aws/eks/huckleberry/<namespace>/*`.

Day-1 alarms:

| Alarm                        | Metric                                              | Threshold |
| ---------------------------- | --------------------------------------------------- | --------- |
| Deployment under-scaled      | `replicas_available` < desired                      | Page      |
| 5xx surge                    | ALB `HTTPCode_Target_5XX_Count` > 10 / 5 min        | Page      |
| Aurora connection saturation | RDS `DatabaseConnections` > 80% max                 | Warn      |
| HPA pinned at max            | HPA `current_replicas` == `max_replicas`            | Warn      |

---

## Rollback

Two paths:

1. **Bad release, schema fine** — update `image.tag` in `huckleberry-gitops` to the previous tag and push. Argo CD rolls the Deployment back within minutes.
2. **Bad migration** — Drizzle has no down-migrations; write a corrective migration and deploy forward. For data corruption, restore from Aurora point-in-time (35-day retention):
   ```bash
   aws rds restore-db-cluster-to-point-in-time \
     --target-db-cluster-identifier huckleberry-rollback \
     --source-db-cluster-identifier dev3-huckleberry-1-cluster \
     --restore-to-time <ISO>
   ```

---

## Cost estimate (rough, us-east-1, low traffic)

| Resource                               | Monthly       |
| -------------------------------------- | ------------- |
| Aurora MySQL Serverless v2 (0.5–2 ACU) | $50–200       |
| EKS Fargate (2 pods × 0.5 vCPU / 1 GB) | $25–30        |
| ALB                                    | $20           |
| Secrets Manager (2 secrets × $0.40)    | $0.80         |
| CloudWatch Logs (~5 GB)                | $2            |
| SES (10k emails)                       | $1            |
| **Total (BFF share only)**             | **~$100–255** |

EKS control-plane cost ($73/mo) is shared with other workloads in the cluster — not attributed here.
