#!/bin/bash
# =============================================================================
# PBXScribe API Deployment Script
#
# Usage:
#   ./deploy.sh [environment]
#
# Environment: dev (default) | staging | prod
# Defaults are read from .env (copy .env.example to get started).
# Shell env vars take precedence over .env values.
#
# Optional flags:
#   --infra-only    Update CloudFormation stack only (skip Lambda code upload)
#   --code-only     Upload Lambda code only (skip CloudFormation update)
#   --migrate       Call POST /migrate after deployment to run pending migrations
#   --drop-tables   Drop all tables before migrating (requires --migrate). Use with caution.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Load .env (only sets variables not already present in the shell environment,
# so shell env vars and command-line prefixes always take precedence)
# ---------------------------------------------------------------------------
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip blank lines and comments
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }"            ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key// /}"
    # Skip if already set in the environment
    [ -z "${!key+x}" ] && export "$key=$value"
  done < .env
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# Positional arg overrides ENVIRONMENT from .env
if [[ "${1:-}" =~ ^(dev|staging|prod)$ ]]; then
  ENVIRONMENT="$1"
else
  ENVIRONMENT="${ENVIRONMENT:-dev}"
fi

PROJECT_NAME="pbxscribe-api-backend"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-api"
LAMBDA_FUNCTION="${PROJECT_NAME}-${ENVIRONMENT}-api"
AWS_REGION="${AWS_REGION:-us-east-2}"
AWS_PROFILE="${AWS_PROFILE:-default}"
BUILD_DIR=".build"
ZIP_FILE="function.zip"

# Parse flags (any position after environment arg)
RUN_INFRA=true
RUN_CODE=true
RUN_MIGRATE=false
DROP_TABLES=false

for arg in "$@"; do
  case $arg in
    --infra-only)  RUN_CODE=false ;;
    --code-only)   RUN_INFRA=false ;;
    --migrate)     RUN_MIGRATE=true ;;
    --drop-tables) DROP_TABLES=true ;;
  esac
done

if $DROP_TABLES && ! $RUN_MIGRATE; then
  fail "--drop-tables requires --migrate"
fi

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
# Validate environment
# ---------------------------------------------------------------------------
case "$ENVIRONMENT" in
  dev|staging|prod) ;;
  *) fail "Invalid environment '$ENVIRONMENT'. Use: dev | staging | prod" ;;
esac

log "Deploying to environment: $ENVIRONMENT"
log "Stack: $STACK_NAME"
log "Lambda: $LAMBDA_FUNCTION"
echo

# ---------------------------------------------------------------------------
# Secrets — read from env or prompt (only needed for infra update)
# ---------------------------------------------------------------------------
if $RUN_INFRA; then
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
  echo
fi

# ---------------------------------------------------------------------------
# Step 1: Update CloudFormation stack
# ---------------------------------------------------------------------------
if $RUN_INFRA; then
  log "Updating CloudFormation stack..."

  aws_cmd cloudformation deploy \
    --template-file infra/services/api.yml \
    --stack-name "$STACK_NAME" \
    --parameter-overrides \
      Environment="$ENVIRONMENT" \
      ProjectName="$PROJECT_NAME" \
      JwtSecret="$JWT_SECRET" \
      MigrationSecret="$MIGRATION_SECRET" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

  ok "CloudFormation stack updated"
  echo
fi

# ---------------------------------------------------------------------------
# Step 2: Package and upload Lambda code
# ---------------------------------------------------------------------------
if $RUN_CODE; then
  log "Building Lambda package..."

  # Clean up any previous build
  rm -rf "$BUILD_DIR" "$ZIP_FILE"

  # Copy source into build dir and install production dependencies
  cp -r src/api "$BUILD_DIR"
  (cd "$BUILD_DIR" && npm ci --omit=dev --silent)

  # Remove test files from the package
  rm -rf "${BUILD_DIR}/tests"

  # Zip from inside the build dir so files are at the root of the archive
  (cd "$BUILD_DIR" && zip -r "../$ZIP_FILE" . -x "*.git*" > /dev/null)

  # Clean up build dir
  rm -rf "$BUILD_DIR"

  ZIP_SIZE=$(du -sh "$ZIP_FILE" | cut -f1)
  ok "Package built: $ZIP_FILE ($ZIP_SIZE)"

  log "Uploading Lambda package..."
  aws_cmd lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION" \
    --zip-file "fileb://${ZIP_FILE}" \
    --output text --query 'FunctionArn' > /dev/null

  log "Waiting for Lambda update to complete..."
  aws_cmd lambda wait function-updated \
    --function-name "$LAMBDA_FUNCTION"

  ok "Lambda code uploaded"
  echo
fi

# ---------------------------------------------------------------------------
# Step 3: Run migrations (optional)
# ---------------------------------------------------------------------------
if $RUN_MIGRATE; then
  log "Fetching API URL from stack outputs..."

  API_URL=$(aws_cmd cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='HttpApiStageUrl'].OutputValue" \
    --output text)

  if [ -z "$API_URL" ]; then
    fail "Could not retrieve API URL from stack outputs"
  fi

  log "Running migrations against $API_URL..."

  # Fetch MIGRATION_SECRET from SSM if not already in env
  if [ -z "${MIGRATION_SECRET:-}" ]; then
    MIGRATION_SECRET=$(aws_cmd ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/migration-secret" \
      --query "Parameter.Value" \
      --output text)
  fi

  MIGRATE_BODY='{}'
  if $DROP_TABLES; then
    log "Drop tables flag set — tables will be dropped before migrating"
    MIGRATE_BODY='{"drop_tables":true}'
  fi

  RESPONSE=$(curl -s -o /tmp/migrate_response.json -w "%{http_code}" \
    -X POST "${API_URL}/migrate" \
    -H "x-migration-secret: ${MIGRATION_SECRET}" \
    -H "Content-Type: application/json" \
    -d "$MIGRATE_BODY")

  BODY=$(cat /tmp/migrate_response.json)

  if [ "$RESPONSE" = "200" ]; then
    ok "Migrations complete: $BODY"
  else
    fail "Migration request failed with HTTP $RESPONSE: $BODY"
  fi

  echo
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "Deployment summary"
echo "  Environment : $ENVIRONMENT"
echo "  Stack       : $STACK_NAME"
echo "  Lambda      : $LAMBDA_FUNCTION"

if $RUN_INFRA || $RUN_CODE; then
  API_URL=$(aws_cmd cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='HttpApiStageUrl'].OutputValue" \
    --output text 2>/dev/null || echo "unavailable")
  echo "  API URL     : $API_URL"
fi

echo
ok "Deployment complete"
