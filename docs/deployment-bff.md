# BFF deployment — AWS production

Runbook for deploying `huckleberry-server` to EKS via Argo CD GitOps.

**Related repos:**
- `~/dev/domo-helm` — Helm chart monorepo; `charts/huckleberry/` is the BFF chart
- `~/dev/huckleberry-gitops` — Argo CD GitOps repo; `instances/dev-ai/<env>/` holds per-environment Helm values

## Infrastructure overview

Region **`us-east-1`**, account **`972900829293`**. Production domain **`huckleberry.ai`**. Dev3 host **`huckleberry-dev.domotech.io`**.

Key pieces: ECR (image registry), EKS (Kubernetes), Aurora MySQL 8.4 (IAM-auth), Secrets Manager, SES, ALB via AWS Load Balancer Controller, External Secrets Operator, IRSA for pod IAM, Argo CD for GitOps.

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
                                                         (manual step)
                                                              │
                                             update image.tag in huckleberry-gitops
                                                              │
                                                       Argo CD watches
                                                              │
                                                              ▼
                                                    EKS cluster (auto-sync)
```

1. Push to `main` in `huckleberry-server` triggers Jenkins via GitHub Actions webhook.
2. Jenkins builds the Docker image, tags it `YYYY-MM-DD-b<N>`, pushes to:
   `972900829293.dkr.ecr.us-east-1.amazonaws.com/huckleberry/huckleberry-bff:<tag>`
3. **Manual step — update gitops with the new image tag:**
   ```bash
   cd ~/dev/huckleberry-gitops
   # Edit instances/dev-ai/<env>/values.yaml — set image.tag to the new tag from step 2
   git add instances/dev-ai/<env>/values.yaml
   git commit -m "deploy huckleberry-bff <tag> to <env>"
   git push
   ```
   > Jenkins automation for this step is planned but not yet wired. Until then, every deploy requires this manual commit to huckleberry-gitops.
4. Argo CD detects the change (auto-sync, self-heal enabled) and runs `helm upgrade`.
5. The migration Job (`job-migrate.yaml`) runs as a Helm pre-upgrade hook before the Deployment rolls.

To change which chart version an environment uses, update `chartVersion` in `instances/dev-ai/<env>/config.yaml`.

---

## One-time AWS setup

> **Owner: Adam.** The infrastructure (ECR repo, IAM roles, IRSA trust policies, VPC/security groups, ACM certs, ALB, Aurora cluster bootstrap, Secrets Manager layout) was set up by Adam and is running in dev3. This section documents what we know exists — ask Adam for reproduction steps or modification details.

What's in place:
- ECR repo: `972900829293.dkr.ecr.us-east-1.amazonaws.com/huckleberry/huckleberry-bff`
- Aurora dev3 writer: `dev3-huckleberry-1-cluster.cluster-cjeyhncfcola.us-east-1.rds.amazonaws.com`
- Aurora dev3 reader: `dev3-huckleberry-1-cluster.cluster-ro-cjeyhncfcola.us-east-1.rds.amazonaws.com`
- Secrets Manager keys follow the pattern `<env>-huckleberry/<secret-name>`
- Pod authenticates to Aurora via IRSA (IAM-auth, no stored password)
- SES sender identity: verified in SES, configured via `SES_FROM` env var
- VPC, security groups, ALB, ACM cert — all provisioned and working

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

## BFF application code (deployment-relevant)

### Dockerfile

See `Dockerfile` in repo root.

### IAM-auth wiring — `src/common/db/db.module.ts`

The `DbModule` supports two connection modes:
- **`DATABASE_URL` set** — direct connection string (local dev, CI).
- **`DATABASE_HOST` set (no URL)** — IAM-auth via `@aws-sdk/rds-signer`. The Signer generates a 15-minute auth token per connection using the pod's IRSA credentials. TLS required.

Boot-time migrations are gated by `DATABASE_RUN_MIGRATIONS=true`. Production runs migrations out-of-band via the Helm pre-upgrade Job (uses `GET_LOCK('hb_migrate', 30)` to prevent concurrent runs).

### Migration runner — `src/common/db/migrate.ts`

Called either at boot (when `DATABASE_RUN_MIGRATIONS=true`) or by the Helm Job. Uses Drizzle's `migrate()` against the `drizzle/` folder. The Job uses `GET_LOCK` to ensure only one pod runs migrations on a rolling deploy.
