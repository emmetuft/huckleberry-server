# AWS smoke probes

One-shot TypeScript scripts for verifying laptop ↔ AWS connectivity. Run any of them with `node --experimental-strip-types <name>.ts` after exporting `AWS_PROFILE`.

Each probe is intentionally small (~30 lines) — they exist to fail loudly when something's misconfigured, not to be production code. Add new ones as you encounter new AWS surface area to verify.

| Probe | What it checks |
|---|---|
| `probe-identity.mts` | STS `GetCallerIdentity` — confirms your AWS_PROFILE resolves to credentials and the role you expect. |
| `probe-secret.mts` | Reads `dev3-huckleberry` from Secrets Manager and prints the non-password fields. |
| `probe-aurora.mts` | Describes the Aurora cluster — writer + reader endpoints, engine version, resource id. |
| `probe-s3.mts` | Lists keys in `huckleberry-fe-dev3`. |
| `probe-iam-token.mts` | Mints an RDS IAM auth token for `huckleberry_app` (proves the runtime BFF auth path works). |

## Running

```bash
export AWS_PROFILE=huckleberry-dev3
aws sso login --profile $AWS_PROFILE   # if expired

# From the repo root
node --experimental-strip-types scripts/aws-probes/probe-identity.mts
```

`--experimental-strip-types` runs `.mts` (Node ESM) and `.ts` files directly on Node 22.6+. No `tsx`/`ts-node` needed. The files use `.mts` because they use top-level `await` and the project's `tsconfig` is `nodenext` CommonJS — `.mts` flips them to ESM cleanly without touching the rest of the repo.

Most probes accept `--<arg> <value>` overrides; `--help` isn't wired (these are 30-liners). Read the script header for the supported flags.

## Adding probes

Match the existing shape — single async script, top-level await, prints to stdout, throws on failure (don't catch and log; let Node's unhandled-rejection give you the stack trace). Imports come from the existing `@aws-sdk/*` packages in the repo's dependencies — no separate `node_modules` here.

Throwaway exploration that shouldn't be committed: write it in `~/dev/huckleberry-aws` instead. See `docs/aws-local-setup.md` § 5.
