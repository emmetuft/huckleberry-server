# AWS access request — what to ask DevOps/IT

One-time request per developer per environment. Send this to DevOps/IT when you need access to a new AWS environment (dev3, staging, prod).

---

## What to request

### 1. AWS SSO access

Ask DevOps to add you to the AWS SSO permission set for the target account. You need:

- **Account ID** — the numeric AWS account ID for the environment (e.g. dev3 = `1234567890`).
- **Permission set** — `PowerUserAccess` or a custom huckleberry role. You need at minimum:
  - `secretsmanager:GetSecretValue` on `dev3-huckleberry/*`
  - `rds:DescribeDBClusters` on the Aurora cluster
  - `s3:ListBucket` + `s3:GetObject` + `s3:PutObject` on `huckleberry-fe-dev3`
  - `ssm:StartSession` on the bastion EC2 (for Aurora port-forward)
  - `sts:GetCallerIdentity` (needed to verify creds work)
- **SSO start URL** — the org's AWS access portal URL (e.g. `https://domo.awsapps.com/start`). Ask DevOps for this if you don't have it.

### 2. Bastion EC2 instance ID

The Aurora cluster lives in a private subnet — the only way to connect from a laptop is through a bastion EC2 running the SSM agent. Ask DevOps for:

- The **instance ID** of the bastion (e.g. `i-0abc1234def56789`).
- Confirm the bastion has an **instance profile** with `AmazonSSMManagedInstanceCore` so the SSM Session Manager plugin can reach it.

That instance ID goes into the `aws ssm start-session` command in `docs/local-development.md` and `docs/aws-local-setup.md`.

### 3. Confirm the secret format

Ask DevOps what JSON structure the `dev3-huckleberry` Secrets Manager secret uses. The most common RDS-managed format is:

```json
{ "username": "admin", "password": "...", "host": "...", "engine": "mysql" }
```

But if they created it manually it may be a different shape. The probe script `scripts/aws-probes/probe-secret.mts` will print the non-password fields once you have access.

---

## Template message to send

> Hi,
>
> I'm setting up local AWS access for the Huckleberry project (dev3 environment). Can you help with the following?
>
> 1. **AWS SSO access** — add me to the permission set for the dev3 account. I need to be able to read Secrets Manager secrets under `dev3-huckleberry/*`, describe the Aurora cluster `dev3-huckleberry-1-cluster`, list/read/write the S3 bucket `huckleberry-fe-dev3`, and start SSM sessions on the bastion EC2.
>
> 2. **SSO start URL** — what's the URL for the AWS access portal I should use with `aws configure sso`?
>
> 3. **Bastion EC2 instance ID** — the instance I can port-forward through to reach Aurora (port 3306). I need the instance ID (starts with `i-`).
>
> 4. **Secret format confirmation** — is the `dev3-huckleberry` secret in the standard RDS JSON format (`{ username, password, host, engine }`) or something custom?
>
> I'll handle the rest locally using the runbooks in `docs/aws-local-setup.md`.
>
> Thanks

---

## What you do once DevOps responds

```bash
# 1. Install the AWS CLI and SSM plugin if you haven't yet
brew install awscli
brew install --cask session-manager-plugin
brew install jq

# 2. Configure your SSO profile
aws configure sso
#    → SSO session name: domo
#    → SSO start URL: <from DevOps>
#    → SSO region: us-east-1
#    → account + role: pick the dev3 account + the role DevOps added you to
#    → default region: us-east-1
#    → profile name: huckleberry-dev3

# 3. Log in
aws sso login --profile huckleberry-dev3
export AWS_PROFILE=huckleberry-dev3

# 4. Verify
aws sts get-caller-identity
```

Then run the smoke probes in order to confirm each piece works:

```bash
cd ~/dev/huckleberry-server

node --experimental-strip-types scripts/aws-probes/probe-identity.mts
node --experimental-strip-types scripts/aws-probes/probe-secret.mts
node --experimental-strip-types scripts/aws-probes/probe-aurora.mts
node --experimental-strip-types scripts/aws-probes/probe-s3.mts
node --experimental-strip-types scripts/aws-probes/probe-iam-token.mts
```

If a probe fails with `AccessDeniedException`, that specific permission is missing — reply to DevOps with the exact error.

---

## Per-environment checklist

Copy this for each environment you need access to:

```
[ ] SSO added to account: _____________ (account ID)
[ ] SSO start URL confirmed: ___________
[ ] Bastion instance ID confirmed: i-___________
[ ] probe-identity passes
[ ] probe-secret passes
[ ] probe-aurora passes
[ ] probe-s3 passes
[ ] probe-iam-token passes
```
