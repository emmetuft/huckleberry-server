# BFF deployment — AWS production

End-to-end runbook for getting `huckleberry-server` running in AWS, with a CD pipeline triggered by `git push`.

**Prereq:** laptop-side AWS access set up per **[`docs/aws-local-setup.md`](aws-local-setup.md)** (AWS CLI, SSO profile, SSM Session Manager plugin). The Aurora bootstrap step below assumes you can already run `aws sts get-caller-identity` and `aws secretsmanager get-secret-value` against dev3.

**Sibling doc:** `~/dev/huckleberry/docs/deployment-fe.md` — same shape, for the SPA.

## What you're standing up

```
       Route 53                    CloudFront                          ALB
   huckleberry.ai  ────►   distribution (us-east-1 cert)  ──►  (AWS Load Balancer Controller)
                                  │                                   │
                                  │ /* → S3 origin                    │
                                  │ /api/* → ALB origin               ▼
                                  ▼                            EKS cluster (Fargate profile)
                            S3 (SPA bundle)         ┌─────── huckleberry-bff namespace ───────┐
                                                    │  Deployment: pod 1   pod 2   …          │
                                                    │  Service (ClusterIP) → Ingress → ALB    │
                                                    │  ServiceAccount + IRSA → AWS IAM        │
                                                    │  ExternalSecret ← Secrets Manager       │
                                                    │  Job (migrations, one-shot)             │
                                                    └─────────────┬───────────────────────────┘
                                                                  │
                                                                  ▼
                                                       Aurora MySQL 8.4 (IAM-auth)
                                                                  │
                                                                  ▼
                                                       Secrets Mgr · SSM · KMS · SES
```

What each piece is for:

- **ECR** — private Docker image registry. Each commit pushes a tagged image here, and EKS pulls from it.
- **EKS (Fargate profile)** — managed Kubernetes control plane + serverless pod compute. The Fargate profile lets us run pods without managing EC2 nodes — same operational story as ECS Fargate, but with the Kubernetes API on top. Helm chart in this repo (`infra/chart/`) defines the Deployment, Service, Ingress, ServiceAccount, ExternalSecret, and HPA.
- **AWS Load Balancer Controller** — runs in-cluster. Watches `Ingress` resources and provisions / configures an ALB to match. We declare ALB shape in YAML; it manages the underlying AWS resources.
- **External Secrets Operator** — runs in-cluster. Watches `ExternalSecret` resources and syncs values from AWS Secrets Manager into Kubernetes `Secret` objects, which are then mounted into pods. No AWS SDK calls in the BFF for secret reads.
- **IRSA (IAM Roles for Service Accounts)** — modern AWS-auth pattern for k8s. The pod's ServiceAccount is annotated with an IAM role ARN; EKS's OIDC provider federates with IAM so pods get scoped, short-lived AWS credentials at runtime. Replaces ECS's "task role" concept; same semantics.
- **Aurora MySQL 8.4** — your existing cluster. Connect via IAM auth: the pod's IRSA role signs a 15-min RDS auth token instead of holding a password.
- **Secrets Manager + SSM Parameter Store** — secrets vs. non-secret config. ExternalSecret/ExternalParameter resources sync them into k8s; pods mount the resulting `Secret`/`ConfigMap`.
- **CloudFront** — fronts both the SPA (S3 origin) and the API (ALB origin), so the browser stays same-origin. The same `hb_session` cookie covers `huckleberry.ai` and `huckleberry.ai/api/*`.
- **GitHub Actions + OIDC** — the CD pipeline. No long-lived AWS keys stored in GitHub; each workflow run assumes an IAM role via short-lived OIDC tokens, then uses `aws eks update-kubeconfig` + `helm upgrade` to roll the deployment.

Assumptions throughout: region **`us-east-1`**. Domain **`huckleberry.ai`**. EKS cluster name `huckleberry`. Kubernetes namespace `huckleberry-bff`.

### Why EKS over ECS

ECS Fargate would also work — one option per ARN, simpler control plane, $0/mo for the orchestrator. EKS wins when:

- The org has multiple workloads converging on Kubernetes (operators, GitOps, Helm-based catalogs).
- We want to use the broader k8s ecosystem (ExternalSecrets, ALB Controller, Karpenter, Argo, OPA Gatekeeper, Prometheus / Grafana stack out of the box).
- We want a portable deployment artifact (Helm chart) that runs identically on any conformant k8s — useful if we ever offer self-hosted.

Trade-offs: EKS adds a **$73/month** control-plane fee per cluster, and the YAML surface area is bigger than an ECS task definition.

---

## Environments

Each environment has its own AWS resources following the naming pattern `<env>-huckleberry-*`. The doc uses `<env>` as a placeholder so the same instructions cover dev3 / staging / prod.

| Env      | Aurora cluster               | Master-cred secret | SM prefix                       | SSM prefix               |
| -------- | ---------------------------- | ------------------ | ------------------------------- | ------------------------ |
| **dev3** | `dev3-huckleberry-1-cluster` | `dev3-huckleberry` | `dev3-huckleberry/*`            | `/dev3-huckleberry/*`    |
| staging  | _TBD_                        | _TBD_              | `staging-huckleberry/*`         | `/staging-huckleberry/*` |
| prod     | _TBD_                        | _TBD_              | `huckleberry/*` (no env prefix) | `/huckleberry/*`         |

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
  "Statement": [
    {
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
          "token.actions.githubusercontent.com:sub": "repo:domo-development/huckleberry-server:*"
        }
      }
    }
  ]
}
```

Permissions (what it can do): push to ECR, read EKS cluster config so the workflow can build a kubeconfig, and read CloudWatch logs to surface migration / pod failures back to the CI logs.

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
    },
    {
      "Sid": "EksKubeconfig",
      "Effect": "Allow",
      "Action": ["eks:DescribeCluster"],
      "Resource": "arn:aws:eks:us-east-1:<ACCOUNT_ID>:cluster/huckleberry"
    },
    {
      "Sid": "ReadCloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:us-east-1:<ACCOUNT_ID>:log-group:/aws/eks/huckleberry/*"
    }
  ]
}
```

The deploy role doesn't need `iam:PassRole` for the pod role — that association lives on the ServiceAccount inside the cluster, not at AWS-API level. The workflow only needs to push images and run `kubectl`/`helm` against the cluster.

In addition, **map the deploy role to a Kubernetes group** in the cluster's `aws-auth` ConfigMap (or via EKS Access Entries on modern clusters) so it has permission to apply Helm releases:

```bash
# One-time, via the cluster admin
eksctl create iamidentitymapping \
  --cluster huckleberry --region us-east-1 \
  --arn arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-deploy \
  --group system:masters \
  --username github-actions:huckleberry-bff
```

`system:masters` is broad — tighten to a custom Role/RoleBinding scoped to the `huckleberry-bff` namespace once the chart is stable. The over-broad start makes the first deploy easier to debug.

Save the role ARN — the GitHub workflow needs it.

### 4. IAM: Pod role via IRSA (what the running BFF can do)

The **pod role** is what the BFF container's process sees as its AWS identity. In Kubernetes-land this is set up via **IRSA** (IAM Roles for Service Accounts): the pod's ServiceAccount is annotated with an IAM role ARN, and the EKS cluster's OIDC provider federates with IAM to issue short-lived STS credentials to that pod.

Trust policy: only the specific ServiceAccount inside the cluster can assume it.

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
          "<EKS_OIDC_URL>:sub": "system:serviceaccount:huckleberry-bff:huckleberry-bff"
        }
      }
    }
  ]
}
```

`<EKS_OIDC_URL>` looks like `oidc.eks.us-east-1.amazonaws.com/id/ABCD1234...` and comes from `aws eks describe-cluster --name huckleberry --query 'cluster.identity.oidc.issuer'` (drop the `https://` prefix when pasting into the policy). The `sub` condition reads `system:serviceaccount:<namespace>:<serviceaccount-name>` — pinning the role to a specific SA in a specific namespace.

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
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
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

The role gets associated with the cluster ServiceAccount via an annotation in the Helm chart (`infra/chart/templates/serviceaccount.yaml`):

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: huckleberry-bff
  namespace: huckleberry-bff
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::<ACCOUNT_ID>:role/huckleberry-bff-pod
```

No "execution role" needed — that ECS concept doesn't exist in EKS. Pulling images from ECR is handled by the Fargate profile's underlying execution role (created automatically by EKS when the cluster is provisioned). CloudWatch log writes go through Fluent Bit shipped with the Fargate platform.

### 5. EKS cluster + Fargate profile

Cluster (one-time per environment). Recommended: `eksctl` over raw CloudFormation — it'll wire up the OIDC provider, IAM roles, and the default node group / Fargate profile in one shot.

```bash
brew install eksctl

# Saves a cluster config you can re-apply
cat > infra/eksctl/huckleberry-cluster.yaml <<'EOF'
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: huckleberry
  region: us-east-1
  version: "1.30"

iam:
  withOIDC: true   # required for IRSA

fargateProfiles:
  - name: huckleberry-bff
    selectors:
      - namespace: huckleberry-bff
      - namespace: kube-system          # for AWS LB Controller, ExternalSecrets, etc.
EOF

eksctl create cluster -f infra/eksctl/huckleberry-cluster.yaml
```

This takes ~15 minutes the first time. It creates: the EKS control plane, the OIDC provider for IRSA, a Fargate profile that matches the `huckleberry-bff` and `kube-system` namespaces, and a default kubeconfig context. Cost: $0.10/hour (~$73/month) for the control plane, plus per-pod Fargate compute.

After it's up, install the two operators the chart depends on:

```bash
# 1. AWS Load Balancer Controller — watches Ingress resources, provisions ALBs
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=huckleberry \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller

# 2. External Secrets Operator — syncs Secrets Manager → k8s Secrets
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

Each operator needs its own IRSA role with scoped permissions — the AWS LB Controller chart documents what; same for ESO. Both are one-time per cluster.

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
aws ssm put-parameter --name /huckleberry/magic-link/base-url  --value https://huckleberry.ai --type String
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
  --domain-name api.huckleberry.ai \
  --validation-method DNS \
  --region us-east-1
```

Validate by adding the CNAME record ACM provides into Route 53. Standard 5–15 minute wait.

Then create the ALB pointing at port 443 with that cert, a target group for the BFF (port 3000, health check `GET /health`, healthy threshold 2, interval 15s), and a Route 53 alias `api.huckleberry.ai` → ALB.

### 10. Helm chart for the BFF (committed to `infra/chart/`)

The chart packages the BFF's Kubernetes resources into one parameterized unit. Layout:

```
infra/chart/
  Chart.yaml
  values.yaml                          ← defaults (env-agnostic)
  values-dev3.yaml                     ← per-env overrides
  values-staging.yaml
  values-prod.yaml
  templates/
    namespace.yaml                     ← huckleberry-bff namespace
    serviceaccount.yaml                ← IRSA-annotated SA
    deployment.yaml                    ← BFF Deployment (image tag from values)
    service.yaml                       ← ClusterIP Service on :3000
    ingress.yaml                       ← ALB Ingress (Load Balancer Controller picks up)
    hpa.yaml                           ← HorizontalPodAutoscaler
    externalsecret-session.yaml        ← syncs huckleberry/session-signing-key
    externalsecret-admin.yaml          ← syncs huckleberry/admin-api-key
    configmap.yaml                     ← non-secret config (DATABASE_HOST, etc.)
    job-migrate.yaml                   ← run-on-demand migration Job
    secretstore.yaml                   ← ExternalSecrets ↔ AWS Secrets Manager binding
```

Skeletons for the load-bearing files:

**`deployment.yaml`** — the BFF itself:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: huckleberry-bff
  namespace: {{ .Values.namespace }}
spec:
  replicas: {{ .Values.replicas | default 2 }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0           # equivalent of ECS minimumHealthyPercent=100
      maxSurge: 1                 # equivalent of ECS maximumPercent=200 (with 2 replicas)
  selector:
    matchLabels: { app: huckleberry-bff }
  template:
    metadata:
      labels: { app: huckleberry-bff }
    spec:
      serviceAccountName: huckleberry-bff
      containers:
        - name: bff
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports: [{ containerPort: 3000, protocol: TCP }]
          env:
            - { name: NODE_ENV,   value: production }
            - { name: AWS_REGION, value: us-east-1 }
          envFrom:
            - configMapRef: { name: huckleberry-bff-config }
            - secretRef:    { name: huckleberry-bff-secrets }
          resources:
            requests: { cpu: "250m", memory: "512Mi" }
            limits:   { cpu: "1000m", memory: "1Gi" }
          readinessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 30
            periodSeconds: 15
```

**`ingress.yaml`** — declarative ALB:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: huckleberry-bff
  namespace: {{ .Values.namespace }}
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/certificate-arn: {{ .Values.acmCertArn }}
    alb.ingress.kubernetes.io/healthcheck-path: /health
    alb.ingress.kubernetes.io/healthcheck-interval-seconds: "15"
spec:
  rules:
    - host: api.huckleberry.ai
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: huckleberry-bff, port: { number: 3000 } } }
```

The AWS Load Balancer Controller sees this Ingress and provisions the matching ALB + target group automatically — no manual `create-load-balancer` step.

**`externalsecret-session.yaml`** — syncs one Secrets Manager secret to a k8s Secret:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: huckleberry-bff-session
  namespace: {{ .Values.namespace }}
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: huckleberry-bff-secrets    # the Secret pods mount
    creationPolicy: Owner
  data:
    - secretKey: SESSION_SIGNING_KEY
      remoteRef:
        key: {{ .Values.envPrefix }}/session-signing-key
    - secretKey: ADMIN_API_KEY
      remoteRef:
        key: {{ .Values.envPrefix }}/admin-api-key
```

**`job-migrate.yaml`** — one-shot DB migration:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: huckleberry-migrate-{{ .Values.image.tag }}    # tag in name keeps each deploy's Job unique
  namespace: {{ .Values.namespace }}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      serviceAccountName: huckleberry-bff
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: ["node", "dist/scripts/migrate-prod.js"]
          envFrom:
            - configMapRef: { name: huckleberry-bff-config }
            - secretRef:    { name: huckleberry-bff-secrets }
```

The Job's `migrate-prod.ts` script uses the same `GET_LOCK('hb_migrate', 30)` pattern from the code-gaps section — one process wins, others bail, the Deployment never gets the new image until the Job exits 0.

**`values-dev3.yaml`** — what the CD pipeline parameterizes:

```yaml
namespace: huckleberry-bff
envPrefix: dev3-huckleberry
replicas: 2
image:
  repository: <ACCT>.dkr.ecr.us-east-1.amazonaws.com/huckleberry-bff
  tag: <FILLED_IN_BY_CD>           # set to the git SHA at deploy time
acmCertArn: arn:aws:acm:us-east-1:<ACCT>:certificate/<ID>
```

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
  password: async () => signer.getAuthToken(), // 15-min token; mysql2 refreshes per connection
  ssl: { rejectUnauthorized: true }, // Aurora's CA bundle is in the base image
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

const pool = createPool({
  /* IAM-auth, migrate user */
});
const db = drizzle(pool);

const [lockRow] = await pool.execute(
  "SELECT GET_LOCK('hb_migrate', 30) AS got",
);
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

# Update local kubeconfig to point at the EKS cluster
aws eks update-kubeconfig --name huckleberry --region us-east-1

# Deploy the Helm chart (creates namespace, ServiceAccount, Deployment,
# Service, Ingress, ExternalSecret, Job in one shot)
helm upgrade --install huckleberry-bff infra/chart/ \
  --namespace huckleberry-bff --create-namespace \
  --values infra/chart/values-dev3.yaml \
  --set image.tag=$TAG \
  --wait --timeout 5m

# The migration Job runs as part of the chart. Watch it:
kubectl -n huckleberry-bff logs -l job-name=huckleberry-migrate-$TAG -f

# Smoke (after the Ingress finishes provisioning the ALB, ~2 min)
curl https://api.huckleberry.ai/health
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
  id-token: write # required for OIDC
  contents: read

env:
  AWS_REGION: us-east-1
  ECR_REPO: huckleberry-bff
  EKS_CLUSTER: huckleberry
  K8S_NAMESPACE: huckleberry-bff
  HELM_RELEASE: huckleberry-bff
  ENV_VALUES: infra/chart/values-dev3.yaml

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
          echo "tag=${{ github.sha }}" >> $GITHUB_OUTPUT

      - name: Set up kubectl + helm
        uses: azure/setup-helm@v4
        with:
          version: v3.16.0

      - name: Update kubeconfig
        run: |
          aws eks update-kubeconfig \
            --name ${{ env.EKS_CLUSTER }} \
            --region ${{ env.AWS_REGION }}

      - name: Helm upgrade — runs migration Job, then rolls Deployment
        run: |
          helm upgrade --install ${{ env.HELM_RELEASE }} infra/chart/ \
            --namespace ${{ env.K8S_NAMESPACE }} --create-namespace \
            --values ${{ env.ENV_VALUES }} \
            --set image.tag=${{ steps.build.outputs.tag }} \
            --wait --timeout 10m

      - name: Surface migration Job logs (success or failure)
        if: always()
        run: |
          kubectl -n ${{ env.K8S_NAMESPACE }} logs \
            -l job-name=huckleberry-migrate-${{ steps.build.outputs.tag }} \
            --tail=200 || true

      - name: Smoke test
        run: curl --fail https://api.huckleberry.ai/health
```

Pipeline phases:

1. Checkout + assume the deploy role via OIDC.
2. Build the image, tag with the commit SHA, push to ECR.
3. Pull the EKS kubeconfig.
4. `helm upgrade --install --wait` — Helm creates the migration Job first (it's annotated with the `pre-install,pre-upgrade` Helm hook), waits for it to complete, then applies the Deployment update. If the Job fails, Helm aborts the upgrade and the cluster keeps serving the previous version.
5. Smoke `/health` from outside.

The chart's `job-migrate.yaml` is annotated:

```yaml
annotations:
  "helm.sh/hook": pre-upgrade,pre-install
  "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
  "helm.sh/hook-weight": "1"
```

That hook annotation is what gates the Deployment rollout on migration success — same mechanic as the ECS "run migration task first, then update service" pattern but expressed in Kubernetes-native terms.

---

## Observability

CloudWatch picks up pod stdout/stderr via the Fargate platform's built-in Fluent Bit — `pino` or `nestjs/common` `Logger` output lands at `/aws/eks/huckleberry/huckleberry-bff/*` log streams.

Day-1 alarms:

| Alarm                        | Metric                                                        | Threshold |
| ---------------------------- | ------------------------------------------------------------- | --------- |
| Deployment under-scaled      | `kube_deployment_status_replicas_available` < `replicas`      | Page      |
| 5xx surge                    | ALB `HTTPCode_Target_5XX_Count` > 10 in 5 min                 | Page      |
| Aurora connection saturation | RDS `DatabaseConnections` > 80% of max                        | Warn      |
| HPA pinned at max            | `kube_horizontalpodautoscaler_status_current_replicas` == max | Warn      |

To get the k8s metrics into CloudWatch, deploy **CloudWatch Container Insights** (one Helm install) or use the **OpenTelemetry Collector** if you want vendor-neutral metrics. Aurora Performance Insights is on by default — first stop when a query's slow.

For local debugging — `kubectl logs -n huckleberry-bff -l app=huckleberry-bff -f --tail=200` streams from all pods.

---

## Rollback

Two paths, fast to slow:

1. **Bad release, schema's fine** — `helm rollback huckleberry-bff <REVISION> -n huckleberry-bff`. Helm reverts the Deployment to the previous ReplicaSet; pods roll back in 1–2 minutes. `helm history huckleberry-bff -n huckleberry-bff` lists revisions.
2. **Bad migration** — same forward-only story as before. Drizzle migrations don't have a down-migration concept; write a new corrective migration and deploy. If data is corrupted: restore from Aurora point-in-time, which keeps 35 days by default:
   ```bash
   aws rds restore-db-cluster-to-point-in-time \
     --target-db-cluster-identifier huckleberry-rollback \
     --source-db-cluster-identifier dev3-huckleberry-1-cluster \
     --restore-to-time <ISO>
   ```
   Creates a parallel cluster you cut the BFF over to via a Helm value update.

---

## Cost estimate (rough, us-east-1, low traffic)

| Resource                                | Monthly       |
| --------------------------------------- | ------------- |
| Aurora MySQL Serverless v2 (0.5–2 ACU)  | $50–200       |
| EKS control plane                       | $73           |
| EKS Fargate (2 pods × 0.5 vCPU / 1 GB)  | $25–30        |
| ALB                                     | $20           |
| Secrets Manager (4 secrets × $0.40)     | $1.60         |
| SSM Parameter Store (standard)          | free          |
| CloudWatch Logs (~5 GB)                 | $2            |
| SES (10k emails)                        | $1            |
| Data transfer out (1 GB)                | $0.09         |
| **Total**                               | **~$170–325** |

EKS costs $73/mo more than ECS (the control-plane fee), but you reuse the cluster for everything else you bring to k8s — additional services run for $0 extra control-plane cost. If huckleberry-bff is the only k8s workload long-term, ECS Fargate is the cheaper call.
