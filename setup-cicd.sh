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
#      a GitHub Actions IAM role scoped to your repo + deploy branch.
#   2. Deploys/updates infra/services/api.yml (--infra-only)  — adds the
#      CodeDeploy application and deployment group to the API stack.
#   3. Sets the AWS_DEPLOY_ROLE_ARN secret in your GitHub repository so the
#      workflow can authenticate to AWS without stored access keys.
#
# Requirements:
#   - aws CLI (configured with a profile that has CloudFormation/IAM rights)
#   - gh CLI (github.com/cli/cli) — authenticated via: gh auth login
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }"            ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key// /}"
    [ -z "${!key+x}" ] && export "$key=$value"
  done < .env
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
if [[ "${1:-}" =~ ^(dev|staging|prod)$ ]]; then
  ENVIRONMENT="$1"
else
  ENVIRONMENT="${ENVIRONMENT:-dev}"
fi

PROJECT_NAME="pbxscribe-api-backend"
AWS_REGION="${AWS_REGION:-us-east-2}"
AWS_PROFILE="${AWS_PROFILE:-default}"
GITHUB_ORG="${GITHUB_ORG:?GITHUB_ORG is not set. Add it to .env or the environment.}"
GITHUB_REPO="${GITHUB_REPO:?GITHUB_REPO is not set. Add it to .env or the environment.}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

OIDC_STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-github-oidc"
API_STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-api"
GITHUB_SECRET_NAME="AWS_DEPLOY_ROLE_ARN"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "▶ $*"; }
ok()   { echo "✓ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

aws_cmd() {
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
log "Checking required tools..."

command -v aws > /dev/null || fail "aws CLI is not installed or not in PATH"
command -v gh  > /dev/null || fail "gh CLI is not installed. Install from https://cli.github.com then run: gh auth login"

# Verify gh is authenticated
gh auth status > /dev/null 2>&1 || fail "gh CLI is not authenticated. Run: gh auth login"

ok "aws and gh CLIs are available"
echo

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log "CI/CD setup"
echo "  Environment   : $ENVIRONMENT"
echo "  Project       : $PROJECT_NAME"
echo "  AWS Region    : $AWS_REGION"
echo "  AWS Profile   : $AWS_PROFILE"
echo "  GitHub repo   : ${GITHUB_ORG}/${GITHUB_REPO}"
echo "  Deploy branch : $DEPLOY_BRANCH"
echo "  OIDC stack    : $OIDC_STACK_NAME"
echo "  API stack     : $API_STACK_NAME"
echo "  GitHub secret : $GITHUB_SECRET_NAME"
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
    DeployBranch="$DEPLOY_BRANCH" \
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
# Step 3: Set GitHub secret
# ---------------------------------------------------------------------------
log "Setting GitHub secret '${GITHUB_SECRET_NAME}' on ${GITHUB_ORG}/${GITHUB_REPO}..."

echo "$DEPLOY_ROLE_ARN" | gh secret set "$GITHUB_SECRET_NAME" \
  --repo "${GITHUB_ORG}/${GITHUB_REPO}"

ok "GitHub secret set"
echo

# ---------------------------------------------------------------------------
# Step 4: Update the API stack to add CodeDeploy resources
# ---------------------------------------------------------------------------
log "Updating API stack ($API_STACK_NAME) to add CodeDeploy resources..."

# Read secrets (needed by the infra stack even for --infra-only)
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
echo "  Deploy branch     : $DEPLOY_BRANCH"
echo "  Deploy role ARN   : $DEPLOY_ROLE_ARN"
echo "  GitHub secret     : $GITHUB_SECRET_NAME"
echo
echo "Push or merge a commit to '$DEPLOY_BRANCH' to trigger the first deployment."
echo
