# CI/CD and AWS access

How code reaches production without anyone holding long-lived AWS keys or the EC2 SSH key.

```
PR ──► CI (ci.yml: typecheck, frontend build, image builds, shellcheck)      no AWS access
       Terraform plan (terraform.yml, if infra/ changed)                     role: devlabs-gha-terraform-plan (read-only)

merge to main ──► Deploy (deploy.yml)
                  ├─ checks: same jobs as CI
                  ├─ build:  images → ECR, release bundle → S3               role: devlabs-gha-build
                  └─ deploy: [approval: environment "production"]            role: devlabs-gha-deploy
                             SSM document devlabs-deploy on the app EC2
                             → scripts/deploy-release.sh (health check, auto-rollback)
              ──► Terraform apply (if infra/ changed)
                  [approval: environment "infra"]                            role: devlabs-gha-terraform-apply
```

| Role | Who can assume it (OIDC `sub`) | What it can do |
|------|-------------------------------|----------------|
| `devlabs-gha-build` | push / dispatch on `main` | push to ECR `devlabs/*`, upload `releases/*` to the release bucket |
| `devlabs-gha-deploy` | jobs in environment `production` | run **only** `devlabs-deploy` on **only** the app instance; read command status |
| `devlabs-gha-terraform-plan` | pull requests from this repo (not forks) | read-only; denied S3 object reads (except state), secrets, parameters, logs, image pulls |
| `devlabs-gha-terraform-apply` | jobs in environment `infra` | manage the resources in `infra/terraform/prod` (`devlabs-*` names) |
| `devlabs-app-instance` | the app EC2 (instance profile) | SSM agent, pull from ECR, read release bundles, write deploy logs |

Everything above is defined in `infra/terraform/prod/`. Account / region / instance IDs live in
`terraform.tfvars` and in the `env:` block of the workflows.

---

## One-time setup

Do these in order. Steps 1–4 need admin credentials on your laptop; after that, day-to-day work
needs none.

### 0. Stop using the root user

Your AWS CLI currently authenticates as the account **root user** with root access keys.

1. Console → **AWS Organizations** → *Create organization* (this account becomes the management account).
2. Console → **IAM Identity Center** → *Enable*. Create a user for yourself, a permission set
   `AdministratorAccess`, and assign it to this account. Turn on MFA.
3. On the laptop: `aws configure sso` → profile name `devlabs-admin`, then `export AWS_PROFILE=devlabs-admin`
   and check `aws sts get-caller-identity` shows an `AWSReservedSSO_AdministratorAccess_…` role.
4. Console (signed in as root) → *Security credentials* → **delete the root access key**. Keep root
   for break-glass only (MFA on, password in a password manager).

### 1. Terraform state bucket

Needs Terraform ≥ 1.10.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply          # creates s3://devlabs-tfstate-204098850303
```

This stack keeps a local `terraform.tfstate` (gitignored). It's one bucket with
`prevent_destroy`; losing that file only means re-importing the bucket.

### 2. GitHub settings (repo → Settings)

- **Environments**
  - `production`: required reviewers = you (and later the on-call people); *Deployment branches* = `main` only.
  - `infra`: required reviewers = you; *Deployment branches* = `main` only.
- **Branches → protect `main`**: require a pull request, require status checks
  `backend`, `frontend`, `scripts` (Terraform's `validate` only runs when `infra/` changes, so it
  can't be required), block force pushes and deletion. Currently 0 approvals and admins may bypass,
  since there is one maintainer; once teammates join, require 1 approval and Code Owner review.
- **Actions → General → Fork pull request workflows**: require approval for all external contributors.
- **Actions → General**: workflow permissions *Read repository contents*.
- Delete the old secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `EC2_*` if present.

The IAM trust policies depend on these environments: no environment, no deploy or apply.

### 3. First apply of the prod stack (from the laptop)

The CI roles don't exist yet, so the first apply runs locally:

```bash
cd infra/terraform/prod
terraform init
terraform plan
terraform apply
```

Creates the GitHub OIDC provider, the five roles, ECR repos `devlabs/backend` and `devlabs/lab-shell`,
`s3://devlabs-releases-204098850303`, the `devlabs-deploy` SSM document and the `/devlabs/deploy`
log group. Later changes go through PRs (`terraform.yml`).

### 4. Give the app instance its role

```bash
aws ec2 associate-iam-instance-profile --region ap-south-2 \
  --instance-id i-0bb3a844fac9d0563 \
  --iam-instance-profile Name=devlabs-app-instance

# Containers on the host must not reach the instance credentials.
aws ec2 modify-instance-metadata-options --region ap-south-2 \
  --instance-id i-0bb3a844fac9d0563 \
  --http-tokens required --http-put-response-hop-limit 1

# Should list the instance within a few minutes (else: sudo systemctl restart amazon-ssm-agent on the host).
aws ssm describe-instance-information --region ap-south-2 \
  --filters Key=InstanceIds,Values=i-0bb3a844fac9d0563
```

The hop limit change doesn't affect the backend: it still authenticates to S3/EKS with the keys in
`/opt/devlabs/.env`, not the instance role.

### 5. First deploy

Merge this change to `main`. **Deploy** runs checks, builds, then waits for approval on `production`.
Approve it and watch the job log (full output also in CloudWatch `/devlabs/deploy`).

The first deploy switches the backend from the host-built / Docker Hub image to the ECR image and
writes `/opt/devlabs/release.env`. `.env`, `kube/` and the Postgres/Redis volumes are untouched.

### 6. Retire the old path

After a successful deploy and a successful `aws ssm start-session --target i-0bb3a844fac9d0563`
(needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)):

- Remove inbound **22** from security group `devlabs-app-sg`.
- Stop using `scripts/sync-to-ec2.sh`; delete the EC2 key pair and `.devlabs-beta.pem`.
- Make the Docker Hub repo `rithvikreddyalkanti/devlabs-backend` private or delete it: it's a public
  copy of the backend.
- `scripts/refresh-ec2-kubeconfig.sh` still uses SSH; run it through a Session Manager session until it's ported.

---

## Day to day

| Task | How |
|------|-----|
| Ship a change | PR → green CI → merge → approve `production` |
| Roll back | Actions → **Deploy** → *Run workflow* on `main`, `sha` = an earlier full commit SHA (last 30 builds / 90 days) |
| Change infra / IAM | PR under `infra/terraform/prod` → read the plan in the job summary → merge → approve `infra` |
| Shell on the app host | `aws ssm start-session --region ap-south-2 --target i-0bb3a844fac9d0563` |
| Restart without a deploy | on the host: `cd /opt/devlabs && sudo ./scripts/prod-restart.sh` (uses `release.env`) |
| Deploy logs | CloudWatch Logs `/devlabs/deploy`, or the Deploy job log |

If the health check fails after a deploy, `deploy-release.sh` puts the previous images back and the
job fails. It restores images only: the compose file, nginx config and frontend from the failed release
stay, so fix forward or roll back with the workflow.

## Guardrails worth knowing

- Approvals on `production` / `infra` and code-owner review on `.github/` and `infra/` are what stop a
  bad change, because whatever merges to `main` runs with these roles. In particular the apply role can
  edit `devlabs-*` IAM roles, including its own.
- The repo is public, so Actions logs (including plan output) are public. No secrets are printed, but
  resource IDs are.
- Actions are pinned to commit SHAs; Dependabot (`.github/dependabot.yml`) proposes updates weekly.

## Not done yet

- The backend still uses the static keys of IAM user `devlabs-app-s3`, which has **EKS cluster-admin**
  (see `docs/security/security-audit-2026-10-05.md`). Next step: a scoped role for the backend, then
  delete the user.
- Team access (Identity Center groups / permission sets in Terraform) for more engineers.
- EKS scripts in `deploy/eks/` still run from a laptop with admin rights; the EKS IAM roles aren't in Terraform.
