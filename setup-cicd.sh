#!/bin/bash
# =============================================================================
# PBXScribe CI/CD Setup Script
#
# Bootstraps GitHub Actions blue-green deployment for a given environment.
# Run this once per environment before pushing to the deploy branch.
#
# Usage:
#   ./setup-cicd.sh [environment]
#
# Environment: dev (default) | staging | prod
# Reads configuration from .env (copy .env.example to get started).
#
# What this script does:
#   1. Deploys infra/github-oidc.yml  — creates the AWS OIDC provider and
#      a GitHub Actions IAM role locked to the named GitHub Environment
#      (e.g. "dev"). The role cannot be assumed from the "prod" environment
#      or any other context.
#   2. Deploys/updates infra/services/api.yml (--infra-only) — adds the
#      CodeDeploy application and deployment group to the API stack.
#   3. Creates the GitHub Environment in your repository.
#   4. Stores AWS_DEPLOY_ROLE_ARN as an environment-level secret so each
#      environment has its own isolated AWS credentials.
#
# Requirements:
#   - aws CLI (configured with a profile that has CloudFormation/IAM rights)
#   - gh CLI (github.com/cli/cli) — authenticated via: gh auth login
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve environment (needed before loading .env so we pick the right file)
# ---------------------------------------------------------------------------
if [[ "${1:-}" =~ ^(dev|staging|prod)$ ]]; then
  ENVIRONMENT="$1"
else
  ENVIRONMENT="${ENVIRONMENT:-dev}"
fi

# ---------------------------------------------------------------------------
# Load .env.<environment>, falling back to .env
# ---------------------------------------------------------------------------
ENV_FILE=".env.${ENVIRONMENT}"
[ -f "$ENV_FILE" ] || ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
  echo "Loading config from $ENV_FILE"
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }"            ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key// /}"
    [ -z "${!key+x}" ] && export "$key=$value"
  done < "$ENV_FILE"
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PROJECT_NAME="pbxscribe-api-backend"
AWS_REGION="${AWS_REGION:-us-east-2}"
AWS_PROFILE="${AWS_PROFILE:-default}"
GITHUB_ORG="${GITHUB_ORG:?GITHUB_ORG is not set. Add it to .env or the environment.}"
GITHUB_REPO="${GITHUB_REPO:?GITHUB_REPO is not set. Add it to .env or the environment.}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:?DEPLOY_BRANCH is not set. Add it to $ENV_FILE.}"

OIDC_STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-github-oidc"
API_STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-api"
GITHUB_SECRET_NAME="AWS_DEPLOY_ROLE_ARN"
DEPLOY_WORKFLOW=".github/workflows/deploy.yml"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "▶ $*"; }
ok()   { echo "✓ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

aws_cmd() {
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

# Updates the BEGIN_BRANCH_MAP…END_BRANCH_MAP block in deploy.yml so that
# DEPLOY_BRANCH → ENVIRONMENT is always in sync with the env file.
patch_deploy_workflow() {
  local env="$1" branch="$2" workflow="$3"

  python3 - "$env" "$branch" "$workflow" <<'PYEOF'
import re, sys

env, branch, workflow = sys.argv[1], sys.argv[2], sys.argv[3]

with open(workflow, 'r') as f:
    content = f.read()

m = re.search(
    r'([ \t]*# BEGIN_BRANCH_MAP[^\n]*\n)(.*?)([ \t]*# END_BRANCH_MAP)',
    content, re.DOTALL
)
if not m:
    print('ERROR: BEGIN_BRANCH_MAP sentinel not found in ' + workflow, file=sys.stderr)
    sys.exit(1)

header, block, footer = m.group(1), m.group(2), m.group(3)

# Detect indentation from existing lines
indent = '            '
for line in block.splitlines():
    stripped = line.lstrip()
    if stripped and not stripped.startswith('#'):
        indent = line[:len(line) - len(stripped)]
        break

# Remove any existing entry for this environment OR this branch (avoid duplicates)
lines = [l for l in block.splitlines()
         if f'ENV="{env}"' not in l and not l.strip().startswith(f'{branch})')]
lines = [l for l in lines if l.strip()]  # drop blank lines
lines.append(f'{indent}{branch}) ENV="{env}" ;;')
lines.sort()  # stable alphabetical order

new_block = '\n'.join(lines) + '\n'
content = content[:m.start(1)] + header + new_block + footer + content[m.end(3):]

with open(workflow, 'w') as f:
    f.write(content)

print(f'  deploy.yml: {branch} → {env}')
PYEOF
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
log "Checking required tools..."

command -v aws > /dev/null || fail "aws CLI is not installed or not in PATH"
command -v gh  > /dev/null || fail "gh CLI is not installed. Install from https://cli.github.com then run: gh auth login"

gh auth status > /dev/null 2>&1 || fail "gh CLI is not authenticated. Run: gh auth login"

ok "aws and gh CLIs are available"
echo

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log "CI/CD setup"
echo "  Environment   : $ENVIRONMENT"
echo "  Deploy branch : $DEPLOY_BRANCH"
echo "  Project       : $PROJECT_NAME"
echo "  AWS Region    : $AWS_REGION"
echo "  AWS Profile   : $AWS_PROFILE"
echo "  GitHub repo   : ${GITHUB_ORG}/${GITHUB_REPO}"
echo "  OIDC stack    : $OIDC_STACK_NAME"
echo "  API stack     : $API_STACK_NAME"
echo "  GitHub secret : ${GITHUB_SECRET_NAME} (stored in '${ENVIRONMENT}' environment)"
echo

# ---------------------------------------------------------------------------
# Step 0: Patch deploy.yml branch → environment mapping
# ---------------------------------------------------------------------------
log "Updating branch mapping in $DEPLOY_WORKFLOW..."

[ -f "$DEPLOY_WORKFLOW" ] || fail "$DEPLOY_WORKFLOW not found. Run from the repo root."

patch_deploy_workflow "$ENVIRONMENT" "$DEPLOY_BRANCH" "$DEPLOY_WORKFLOW"

ok "deploy.yml updated: $DEPLOY_BRANCH → $ENVIRONMENT"
echo "  Commit and push $DEPLOY_WORKFLOW to apply the inline fallback mapping."
echo

# ---------------------------------------------------------------------------
# Step 1: Deploy GitHub OIDC provider + deploy role
# ---------------------------------------------------------------------------
log "Deploying GitHub OIDC stack ($OIDC_STACK_NAME)..."

# Check whether an OIDC provider for GitHub already exists in this account.
# If it does, pass CreateOIDCProvider=false so CloudFormation skips creating
# a duplicate (which would fail with a conflicting resource error).
OIDC_PROVIDER_EXISTS=$(aws_cmd iam list-open-id-connect-providers \
  --query "OIDCProviderList[?ends_with(Arn, 'token.actions.githubusercontent.com')]" \
  --output text 2>/dev/null || echo "")

if [ -n "$OIDC_PROVIDER_EXISTS" ]; then
  log "OIDC provider already exists in this account — skipping provider creation"
  CREATE_OIDC_PROVIDER="false"
else
  CREATE_OIDC_PROVIDER="true"
fi

aws_cmd cloudformation deploy \
  --template-file infra/github-oidc.yml \
  --stack-name "$OIDC_STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    ProjectName="$PROJECT_NAME" \
    Environment="$ENVIRONMENT" \
    GitHubOrg="$GITHUB_ORG" \
    GitHubRepo="$GITHUB_REPO" \
    CreateOIDCProvider="$CREATE_OIDC_PROVIDER"

ok "OIDC stack deployed"
echo

# ---------------------------------------------------------------------------
# Step 2: Retrieve the deploy role ARN
# ---------------------------------------------------------------------------
log "Retrieving deploy role ARN..."

DEPLOY_ROLE_ARN=$(aws_cmd cloudformation describe-stacks \
  --stack-name "$OIDC_STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" \
  --output text)

[ -n "$DEPLOY_ROLE_ARN" ] || fail "Could not retrieve DeployRoleArn from stack outputs"

ok "Deploy role ARN: $DEPLOY_ROLE_ARN"
echo

# ---------------------------------------------------------------------------
# Step 3: Create GitHub Environment and set environment-level secret
#
# Secrets are stored at the GitHub Environment level (not repo level).
# This means each environment has its own isolated AWS_DEPLOY_ROLE_ARN.
# The dev environment can only assume the dev IAM role, and the prod
# environment can only assume the prod IAM role.
# ---------------------------------------------------------------------------
log "Creating GitHub Environment '${ENVIRONMENT}' on ${GITHUB_ORG}/${GITHUB_REPO}..."

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${GITHUB_ORG}/${GITHUB_REPO}/environments/${ENVIRONMENT}" \
  > /dev/null

ok "GitHub Environment '${ENVIRONMENT}' ready"

log "Storing ${GITHUB_SECRET_NAME} in '${ENVIRONMENT}' environment..."

echo "$DEPLOY_ROLE_ARN" | gh secret set "$GITHUB_SECRET_NAME" \
  --env "$ENVIRONMENT" \
  --repo "${GITHUB_ORG}/${GITHUB_REPO}"

ok "Secret set in '${ENVIRONMENT}' environment (not visible at repo level)"

log "Setting DEPLOY_BRANCH variable in '${ENVIRONMENT}' environment..."

gh variable set "DEPLOY_BRANCH" \
  --env "$ENVIRONMENT" \
  --repo "${GITHUB_ORG}/${GITHUB_REPO}" \
  --body "$DEPLOY_BRANCH"

ok "DEPLOY_BRANCH=$DEPLOY_BRANCH (edit at: GitHub → Settings → Environments → ${ENVIRONMENT} → Variables)"
echo

# ---------------------------------------------------------------------------
# Step 4: Update the API stack to add CodeDeploy resources
# ---------------------------------------------------------------------------
log "Updating API stack ($API_STACK_NAME) to add CodeDeploy resources..."

if [ -z "${JWT_SECRET:-}" ]; then
  read -r -s -p "JWT_SECRET (min 32 chars): " JWT_SECRET
  echo
fi

if [ -z "${MIGRATION_SECRET:-}" ]; then
  read -r -s -p "MIGRATION_SECRET (min 16 chars): " MIGRATION_SECRET
  echo
fi

[ ${#JWT_SECRET} -ge 32 ]       || fail "JWT_SECRET must be at least 32 characters"
[ ${#MIGRATION_SECRET} -ge 16 ] || fail "MIGRATION_SECRET must be at least 16 characters"

aws_cmd cloudformation deploy \
  --template-file infra/services/api.yml \
  --stack-name "$API_STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    Environment="$ENVIRONMENT" \
    ProjectName="$PROJECT_NAME" \
    JwtSecret="$JWT_SECRET" \
    MigrationSecret="$MIGRATION_SECRET"

ok "API stack updated with CodeDeploy resources"
echo

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "CI/CD setup complete"
echo
echo "  Environment       : $ENVIRONMENT"
echo "  GitHub repo       : ${GITHUB_ORG}/${GITHUB_REPO}"
echo "  GitHub Environment: ${ENVIRONMENT} (secret stored here)"
echo "  Deploy role ARN   : $DEPLOY_ROLE_ARN"
echo
echo "Branch → environment mapping (edit deploy.yml to change):"
echo "  develop → dev | staging → staging | main → prod"
echo
echo "To add a prod approval gate:"
echo "  GitHub → Settings → Environments → prod → Required reviewers"
echo
