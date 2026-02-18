# CI/CD Resume Context

Branch: `features/cicd`

## Blocker
GitHub admin approval needed before `setup-cicd.sh` can create GitHub Environments
and set environment-level secrets via `gh` CLI.

## What's done

| File | Status | Purpose |
|---|---|---|
| `.github/workflows/deploy.yml` | ✅ Done | Blue-green deploy workflow |
| `infra/github-oidc.yml` | ✅ Done | OIDC provider + IAM deploy role per env |
| `infra/services/api.yml` | ✅ Done | Added CodeDeploy app/group + CloudWatch alarm |
| `setup-cicd.sh` | ✅ Done | One-shot bootstrap script |
| `src/api/app.js` | ✅ Done | Temp `/deploy-check` route for verifying CI/CD |
| `.env.example` | ✅ Done | Added `GITHUB_ORG`, `GITHUB_REPO` fields |

## How it works (summary)

**Branch → environment mapping** (in `deploy.yml`):
- `develop` → `dev`
- `staging` → `staging`
- `main` → `prod`

**Isolation mechanism**: Each environment has its own IAM deploy role. The OIDC
trust policy is scoped to the GitHub Environment name (`environment:dev` /
`environment:prod`), not the branch. A dev role physically cannot be assumed
from a prod GitHub Environment job.

**Blue-green**: Lambda versions + aliases (`live`). CodeDeploy shifts 10% traffic
to new version for 5 min (`LambdaCanary10Percent5Minutes`), then 100% if the
`LambdaErrorAlarm` (≥3 errors/60s) stays clear. Auto-rolls back on alarm or failure.

## What's left to do

### 1. Run `setup-cicd.sh` (needs GitHub admin)
```bash
./setup-cicd.sh dev
```
This will:
- Deploy `infra/github-oidc.yml` → creates OIDC provider + `pbxscribe-api-backend-dev-github-deploy` IAM role
- Deploy/update `infra/services/api.yml` → adds CodeDeploy resources to the dev stack
- Create the `dev` GitHub Environment in the repo
- Set `AWS_DEPLOY_ROLE_ARN` as a secret inside that environment

### 2. Merge this branch (`features/cicd`) to `develop`
First deployment will:
- Upload code, publish Lambda version
- Create `live` alias
- Update API Gateway integration to invoke the alias
- All future deploys use CodeDeploy canary shifting

### 3. Verify with `/deploy-check`
```
GET https://<api-id>.execute-api.us-east-2.amazonaws.com/dev/deploy-check
```
Confirms `lambdaVersion` increments on each deploy.

### 4. Remove the temp route
Delete the `/deploy-check` block from `src/api/app.js` once CI/CD is confirmed.

### 5. Set up prod (later)
```bash
./setup-cicd.sh prod
```
Then optionally add a required reviewer gate in:
GitHub → Settings → Environments → prod → Required reviewers

## Key decisions made
- **OIDC over stored keys**: No AWS credentials stored in GitHub; uses short-lived tokens
- **Environment-level secrets**: `AWS_DEPLOY_ROLE_ARN` lives in the GitHub Environment, not repo secrets
- **CodeDeploy canary**: 10% for 5 min then 100% — balance of safety and speed
- **CloudFormation for infra, CI/CD for code**: `deploy.sh` handles infrastructure changes; GitHub Actions handles code-only deployments

## `.env` fields needed
```
GITHUB_ORG=digicom-dts
GITHUB_REPO=pbxscribe
```
