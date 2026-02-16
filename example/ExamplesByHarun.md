# Examples By Harun

## Deploying the Infrastructure Stacks

This guide covers deploying the network and database infrastructure for the pbxscribe-api-backend project.

### Prerequisites
- AWS CLI installed and configured
- AWS credentials with appropriate permissions (using dts profile)
- Correct region configured (us-east-2)

### Verify AWS Configuration
```bash
# Check your AWS configuration
aws configure list --profile dts

# Verify you're in the correct region (us-east-2)
aws configure get region --profile dts
# Should output: us-east-2
```

---

## Stack 1: Network Infrastructure (Deploy First)

The network stack creates the VPC, subnets, route tables, NAT gateway, and internet gateway.

### Deploy Network Stack
```bash
aws cloudformation create-stack \
  --stack-name pbxscribe-api-backend-dev-network \
  --template-body file://infra/foundation/network.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=VpcCIDR,ParameterValue=10.42.0.0/16 \
  --region us-east-2 \
  --tags \
    Key=Environment,Value=dev \
    Key=Project,Value=pbxscribe-api-backend \
  --profile dts
```

### Monitor Network Stack Deployment
```bash
# Watch the stack creation progress
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --query 'Stacks[0].StackStatus' \
  --profile dts

# Or watch events in real-time
aws cloudformation describe-stack-events \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --max-items 10 \
  --profile dts
```

### Verify Network Stack Outputs
```bash
# View all stack outputs
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --query 'Stacks[0].Outputs' \
  --profile dts
```

---

## Stack 2: Database Infrastructure (Deploy Second)

The database stack creates the RDS PostgreSQL instance, RDS Proxy, security groups, and secrets.

**IMPORTANT**: The network stack must be deployed and complete before deploying this stack.

### Deploy Database Stack
```bash
aws cloudformation create-stack \
  --stack-name pbxscribe-api-backend-dev-database \
  --template-body file://infra/foundation/database.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=DBMasterUsername,ParameterValue=postgres \
    ParameterKey=PostgreSQLVersion,ParameterValue=18 \
    ParameterKey=DBInstanceClass,ParameterValue=db.t3.micro \
    ParameterKey=DBAllocatedStorage,ParameterValue=100 \
    ParameterKey=DBName,ParameterValue=pbxscribe \
    ParameterKey=MultiAZ,ParameterValue=false \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 \
  --tags \
    Key=Environment,Value=dev \
    Key=Project,Value=pbxscribe-api-backend \
  --profile dts
```

### Monitor Database Stack Deployment
```bash
# Watch the stack creation progress
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --query 'Stacks[0].StackStatus' \
  --profile dts

# Or watch events in real-time
aws cloudformation describe-stack-events \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --max-items 10 \
  --profile dts
```

### Verify Database Stack Outputs
```bash
# View all stack outputs
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --query 'Stacks[0].Outputs' \
  --profile dts
```

---

## Retrieve Database Credentials

After deployment, retrieve the database credentials from AWS Secrets Manager:

```bash
# Get the secret ARN from stack outputs
SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`DBSecretArn`].OutputValue' \
  --output text \
  --profile dts)

# Retrieve the credentials
aws secretsmanager get-secret-value \
  --secret-id $SECRET_ARN \
  --region us-east-2 \
  --query 'SecretString' \
  --output text \
  --profile dts | jq '.'
```

---

## Stack 3: API Services Infrastructure (Deploy Third)

The API stack creates Lambda functions, API Gateway, and custom domain configuration.

**IMPORTANT**: Both network and database stacks must be deployed and complete before deploying this stack.

**Domain Names by Environment:**
- **dev**: api-dev.pbxscribe.com
- **staging**: api-staging.pbxscribe.com
- **prod**: api.pbxscribe.com

---

## Pre-Deployment Verification

Before deploying the API stack, verify that everything is ready.

### 1. Validate CloudFormation Template

```bash
# Validate the API template syntax
aws cloudformation validate-template \
  --template-body file://infra/services/api.yml \
  --region us-east-2 \
  --profile dts

# Check if validation succeeds (should return template description and parameters)
```

**Expected Output**: Template description, parameters list, and capabilities required (CAPABILITY_NAMED_IAM).

### 2. Verify Foundation Stacks are Deployed

```bash
# Check network stack status
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].StackStatus' \
  --output text

# Check database stack status
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].StackStatus' \
  --output text
```

**Expected Output**: Both should return `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

### 3. Verify Stack Exports are Available

The API stack depends on exports from the foundation stacks. Verify they exist:

```bash
# List all exports from network and database stacks
aws cloudformation list-exports \
  --region us-east-2 \
  --profile dts \
  --query 'Exports[?starts_with(Name, `pbxscribe-api-backend-dev`)].{Name:Name,Value:Value}' \
  --output table
```

**Expected Exports** (minimum required):
- `pbxscribe-api-backend-dev-vpc-id`
- `pbxscribe-api-backend-dev-app-subnet-1`
- `pbxscribe-api-backend-dev-app-subnet-2`
- `pbxscribe-api-backend-dev-app-subnet-3`
- `pbxscribe-api-backend-dev-db-sg-id`
- `pbxscribe-api-backend-dev-db-proxy-endpoint`
- `pbxscribe-api-backend-dev-db-port`
- `pbxscribe-api-backend-dev-db-name`
- `pbxscribe-api-backend-dev-db-secret-arn`

### 4. Test Lambda Function Locally

Before deploying, test your Lambda function code locally:

```bash
# Navigate to API directory
cd src/api

# Install dependencies (if not already installed)
npm install

# Run local tests
npm test
```

**Expected Output**: All tests should pass with 200 OK responses for health endpoints.

### 5. Package Lambda Function

```bash
# From the src/api directory, create a deployment package
cd src/api

# Create function.zip with all code and dependencies
zip -r ../../function.zip . -x "*.git*" -x "tests/*" -x "node_modules/aws-sdk/*"

# Verify the zip file was created
ls -lh ../../function.zip

# Optional: View contents of the zip
unzip -l ../../function.zip | head -20
```

**Expected Output**: function.zip file created (typically 2-5 MB with dependencies).

---

### Prerequisites for API Stack

#### 1. Create ACM Certificate for Environment Domain

For dev environment, request certificate for api-dev.pbxscribe.com:

```bash
# Request ACM certificate for the custom domain (dev example)
aws acm request-certificate \
  --domain-name api-dev.pbxscribe.com \
  --validation-method DNS \
  --region us-east-2 \
  --profile dts \
  --tags Key=Name,Value=api-dev.pbxscribe.com Key=Environment,Value=dev

# Get the certificate ARN (save this for deployment)
aws acm list-certificates \
  --region us-east-2 \
  --profile dts \
  --query 'CertificateSummaryList[?DomainName==`api-dev.pbxscribe.com`]'
```

For prod environment, use `api.pbxscribe.com` instead.

**IMPORTANT**: You must validate the certificate by adding the DNS records to Route53. Get validation records:

```bash
# Get certificate validation records
CERT_ARN=<your-certificate-arn>

aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --region us-east-2 \
  --profile dts \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

Add the CNAME record to your Route53 hosted zone for pbxscribe.com to validate the certificate.

#### 2. Verify Route53 Hosted Zone

```bash
# Check if hosted zone exists for pbxscribe.com
aws route53 list-hosted-zones \
  --profile dts \
  --query 'HostedZones[?Name==`pbxscribe.com.`]'
```

If no hosted zone exists, create one:

```bash
aws route53 create-hosted-zone \
  --name pbxscribe.com \
  --caller-reference $(date +%s) \
  --profile dts
```

### Deploy API Stack

Once the ACM certificate is validated and you have the Route53 hosted zone:

```bash
# Set your ACM certificate ARN (for dev environment, use api-dev.pbxscribe.com certificate)
CERT_ARN="arn:aws:acm:us-east-2:YOUR-ACCOUNT-ID:certificate/YOUR-CERT-ID"

aws cloudformation create-stack \
  --stack-name pbxscribe-api-backend-dev-api \
  --template-body file://infra/services/api.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=HostedZoneName,ParameterValue=pbxscribe.com \
    ParameterKey=LambdaRuntime,ParameterValue=nodejs20.x \
    ParameterKey=LambdaMemorySize,ParameterValue=512 \
    ParameterKey=LambdaTimeout,ParameterValue=30 \
    ParameterKey=ACMCertificateArn,ParameterValue=$CERT_ARN \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 \
  --tags \
    Key=Environment,Value=dev \
    Key=Project,Value=pbxscribe-api-backend \
  --profile dts
```

**Note**: The domain name is automatically constructed based on the environment:
- dev → api-dev.pbxscribe.com
- staging → api-staging.pbxscribe.com
- prod → api.pbxscribe.com

### Monitor API Stack Deployment

```bash
# Watch the stack creation progress
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --query 'Stacks[0].StackStatus' \
  --profile dts

# Or watch events in real-time
aws cloudformation describe-stack-events \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --max-items 10 \
  --profile dts
```

### Verify API Stack Outputs

```bash
# View all stack outputs
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --query 'Stacks[0].Outputs' \
  --profile dts
```

### Test API Endpoints

After deploying the Lambda code, test all API endpoints to ensure everything works.

#### Get API Endpoint URL

```bash
# Get the API Gateway endpoint URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiStageUrl`].OutputValue' \
  --output text)

echo "API URL: $API_URL"
```

#### Test Health Endpoints

```bash
# Test root endpoint
echo "Testing GET /"
curl -i $API_URL/

# Test basic health check
echo -e "\nTesting GET /health"
curl -i $API_URL/health

# Test readiness probe
echo -e "\nTesting GET /ready"
curl -i $API_URL/ready

# Test liveness probe
echo -e "\nTesting GET /live"
curl -i $API_URL/live

# Test database health check (Note: May fail if DB credentials are not properly configured)
echo -e "\nTesting GET /health/db"
curl -i $API_URL/health/db
```

**Expected Output**:
- **GET /**: `200 OK` with JSON response showing API information
- **GET /health**: `200 OK` with `{"status":"ok"}`
- **GET /ready**: `200 OK` with `{"status":"ready"}`
- **GET /live**: `200 OK` with `{"status":"alive"}`
- **GET /health/db**: `200 OK` with database status (or `503` if database connection fails)

#### Test with JSON Output

```bash
# Pretty print JSON responses
echo "Testing all endpoints..."

echo -e "\n=== GET / ==="
curl -s $API_URL/ | jq '.'

echo -e "\n=== GET /health ==="
curl -s $API_URL/health | jq '.'

echo -e "\n=== GET /ready ==="
curl -s $API_URL/ready | jq '.'

echo -e "\n=== GET /live ==="
curl -s $API_URL/live | jq '.'

echo -e "\n=== GET /health/db ==="
curl -s $API_URL/health/db | jq '.'
```

#### Test Lambda Function Directly (Bypass API Gateway)

```bash
# Create a test event payload
cat > /tmp/test-event.json << 'EOF'
{
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/health",
  "rawQueryString": "",
  "headers": {
    "accept": "application/json"
  },
  "requestContext": {
    "http": {
      "method": "GET",
      "path": "/health"
    }
  }
}
EOF

# Invoke Lambda function directly
aws lambda invoke \
  --function-name pbxscribe-api-backend-dev-api \
  --payload file:///tmp/test-event.json \
  --region us-east-2 \
  --profile dts \
  /tmp/response.json

# View the response
cat /tmp/response.json | jq '.'
```

### Deploy Lambda Function Code

The template deploys a placeholder Lambda function. To deploy your actual Fastify application from `src/api`:

```bash
# Navigate to the project root directory
cd /Users/rayhan/Code/dts-pbxscribe

# Package the Lambda function (if not already done in pre-deployment)
cd src/api
zip -r ../../function.zip . -x "*.git*" -x "tests/*" -x "node_modules/aws-sdk/*"
cd ../..

# Update Lambda function code
aws lambda update-function-code \
  --function-name pbxscribe-api-backend-dev-api \
  --zip-file fileb://function.zip \
  --region us-east-2 \
  --profile dts

# Wait for update to complete
aws lambda wait function-updated \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts

# Verify the update
aws lambda get-function \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query '{Runtime:Configuration.Runtime,Handler:Configuration.Handler,CodeSize:Configuration.CodeSize,LastModified:Configuration.LastModified,State:Configuration.State}'
```

**Expected Output**:
- State: `Active`
- Runtime: `nodejs20.x`
- Handler: `index.handler`
- CodeSize: ~2-5 MB

### Update Lambda Environment Variables (if needed)

```bash
# Update environment variables
aws lambda update-function-configuration \
  --function-name pbxscribe-api-backend-dev-api \
  --environment Variables="{NODE_ENV=dev,CUSTOM_VAR=value}" \
  --region us-east-2 \
  --profile dts
```

### View Lambda Logs

Monitor Lambda execution logs to troubleshoot issues and verify correct operation:

```bash
# Tail Lambda logs in real-time (watch live requests)
aws logs tail /aws/lambda/pbxscribe-api-backend-dev-api \
  --follow \
  --region us-east-2 \
  --profile dts

# View recent logs (last 1 hour)
aws logs tail /aws/lambda/pbxscribe-api-backend-dev-api \
  --since 1h \
  --region us-east-2 \
  --profile dts

# View recent logs with filter pattern (errors only)
aws logs tail /aws/lambda/pbxscribe-api-backend-dev-api \
  --since 1h \
  --filter-pattern "ERROR" \
  --region us-east-2 \
  --profile dts

# View specific time range
aws logs tail /aws/lambda/pbxscribe-api-backend-dev-api \
  --since 2024-01-01T10:00:00 \
  --until 2024-01-01T11:00:00 \
  --region us-east-2 \
  --profile dts
```

### View API Gateway Logs

```bash
# View API Gateway access logs
aws logs tail /aws/apigateway/pbxscribe-api-backend-dev-api \
  --follow \
  --region us-east-2 \
  --profile dts

# View recent API Gateway logs
aws logs tail /aws/apigateway/pbxscribe-api-backend-dev-api \
  --since 1h \
  --region us-east-2 \
  --profile dts
```

### Monitor Lambda Metrics

```bash
# Get Lambda invocation count (last 1 hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=pbxscribe-api-backend-dev-api \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region us-east-2 \
  --profile dts

# Get Lambda error count
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=pbxscribe-api-backend-dev-api \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region us-east-2 \
  --profile dts

# Get Lambda duration (average execution time)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=pbxscribe-api-backend-dev-api \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum \
  --region us-east-2 \
  --profile dts

# Get Lambda concurrent executions
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name ConcurrentExecutions \
  --dimensions Name=FunctionName,Value=pbxscribe-api-backend-dev-api \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Maximum \
  --region us-east-2 \
  --profile dts
```

### API Stack Verification Checklist

After deployment and testing, verify:

- [ ] CloudFormation stack status is `CREATE_COMPLETE`
- [ ] Lambda function is in `Active` state
- [ ] Lambda function code is deployed (not placeholder)
- [ ] Lambda function has correct runtime (nodejs20.x)
- [ ] Lambda is in VPC with correct subnets
- [ ] Lambda security group allows outbound to RDS and HTTPS
- [ ] Lambda execution role has required permissions
- [ ] API Gateway HTTP API is created
- [ ] API Gateway stage is deployed with correct name
- [ ] API Gateway has correct CORS configuration
- [ ] GET / returns 200 OK with API information
- [ ] GET /health returns 200 OK
- [ ] GET /ready returns 200 OK
- [ ] GET /live returns 200 OK
- [ ] GET /health/db connects to database successfully (or fails gracefully)
- [ ] Lambda logs show requests being processed
- [ ] No errors in CloudWatch logs
- [ ] Lambda cold start completes successfully
- [ ] API Gateway logs show incoming requests
- [ ] Database credentials are retrieved from Secrets Manager
- [ ] Lambda can connect to RDS via RDS Proxy

### Troubleshooting API Stack

#### Lambda Function Issues

```bash
# Check Lambda function configuration
aws lambda get-function-configuration \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts

# Check Lambda function status and state reason
aws lambda get-function \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Configuration.{State:State,StateReason:StateReason,StateReasonCode:StateReasonCode,LastUpdateStatus:LastUpdateStatus}'

# Test Lambda function with a simple event
aws lambda invoke \
  --function-name pbxscribe-api-backend-dev-api \
  --payload '{"rawPath":"/health","requestContext":{"http":{"method":"GET"}}}' \
  --region us-east-2 \
  --profile dts \
  /tmp/test-response.json && cat /tmp/test-response.json | jq '.'
```

#### VPC and Network Issues

```bash
# Check Lambda VPC configuration
aws lambda get-function-configuration \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'VpcConfig'

# Verify Lambda security group rules
LAMBDA_SG=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaSecurityGroupId`].OutputValue' \
  --output text)

aws ec2 describe-security-groups \
  --group-ids $LAMBDA_SG \
  --region us-east-2 \
  --profile dts \
  --query 'SecurityGroups[0].{GroupName:GroupName,Egress:IpPermissionsEgress}'

# Check if Lambda can reach RDS
# (This requires running from within VPC or using VPC endpoints)
```

#### Database Connection Issues

```bash
# Verify RDS Proxy endpoint is correct
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`DBProxyEndpoint`].OutputValue' \
  --output text

# Check if Lambda has access to Secrets Manager
aws lambda get-function-configuration \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Environment.Variables'

# Verify the secret exists and is accessible
SECRET_ARN=$(aws lambda get-function-configuration \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Environment.Variables.DB_SECRET_ARN' \
  --output text)

aws secretsmanager get-secret-value \
  --secret-id $SECRET_ARN \
  --region us-east-2 \
  --profile dts \
  --query 'SecretString' \
  --output text | jq '.'
```

#### API Gateway Issues

```bash
# Check API Gateway configuration
API_ID=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiId`].OutputValue' \
  --output text)

aws apigatewayv2 get-api \
  --api-id $API_ID \
  --region us-east-2 \
  --profile dts

# Check API Gateway routes
aws apigatewayv2 get-routes \
  --api-id $API_ID \
  --region us-east-2 \
  --profile dts

# Check API Gateway integrations
aws apigatewayv2 get-integrations \
  --api-id $API_ID \
  --region us-east-2 \
  --profile dts
```

#### Permission Issues

```bash
# Check if API Gateway has permission to invoke Lambda
aws lambda get-policy \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Policy' \
  --output text | jq '.'

# Check Lambda execution role permissions
ROLE_NAME=$(aws lambda get-function-configuration \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Role' \
  --output text | awk -F'/' '{print $NF}')

aws iam list-attached-role-policies \
  --role-name $ROLE_NAME \
  --profile dts

aws iam list-role-policies \
  --role-name $ROLE_NAME \
  --profile dts
```

#### Common Issues and Solutions

**Issue**: Lambda returns "Task timed out after 30.00 seconds"
- **Solution**: Increase Lambda timeout or check if Lambda is waiting on external service (database, etc.)
- Check database connection and network connectivity

**Issue**: "Cannot connect to database"
- **Solution**: Verify Lambda is in correct VPC subnets
- Check security group rules allow Lambda → RDS connection
- Verify RDS Proxy is available and healthy
- Check database credentials in Secrets Manager

**Issue**: "Internal Server Error" from API Gateway
- **Solution**: Check Lambda logs for actual error
- Verify Lambda function is active and not in failed state
- Check Lambda permissions

**Issue**: Cold start is slow
- **Solution**: Increase Lambda memory (more memory = more CPU)
- Consider using provisioned concurrency for production
- Optimize application initialization code

---

## Verify Database Infrastructure

After deployment, verify that the database is working properly and properly secured.

### Check Database Stack Status
```bash
# View database stack status and outputs
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].{StackStatus:StackStatus,Outputs:Outputs}'
```

### Verify RDS Instance Status
```bash
# Check RDS instance health and configuration
aws rds describe-db-instances \
  --db-instance-identifier pbxscribe-api-backend-dev-db \
  --region us-east-2 \
  --profile dts \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Engine:Engine,EngineVersion:EngineVersion,Class:DBInstanceClass,MultiAZ:MultiAZ,StorageEncrypted:StorageEncrypted,PubliclyAccessible:PubliclyAccessible,Endpoint:Endpoint}'
```

**Expected Output**:
- Status: `available`
- Engine: `postgres`
- EngineVersion: `18.x`
- StorageEncrypted: `true`
- PubliclyAccessible: `false` ✅ (Database is private)

### Verify RDS Proxy Status
```bash
# Check RDS Proxy health
aws rds describe-db-proxies \
  --db-proxy-name pbxscribe-api-backend-dev-db-proxy \
  --region us-east-2 \
  --profile dts \
  --query 'DBProxies[0].{Status:Status,Endpoint:Endpoint,RequireTLS:RequireTLS}'

# Check RDS Proxy target health
aws rds describe-db-proxy-targets \
  --db-proxy-name pbxscribe-api-backend-dev-db-proxy \
  --region us-east-2 \
  --profile dts \
  --query 'Targets[*].{Type:Type,State:TargetHealth.State,Endpoint:Endpoint}'
```

**Expected Output**:
- Proxy Status: `available`
- Target State: `AVAILABLE`
- RequireTLS: `true` ✅

### Verify Security Configuration (Database is Private)
```bash
# Confirm database is NOT publicly accessible
aws rds describe-db-instances \
  --db-instance-identifier pbxscribe-api-backend-dev-db \
  --region us-east-2 \
  --profile dts \
  --query 'DBInstances[0].PubliclyAccessible'

# Check security group rules (should only allow access from app subnets)
aws ec2 describe-security-groups \
  --group-ids $(aws cloudformation describe-stacks \
    --stack-name pbxscribe-api-backend-dev-database \
    --region us-east-2 \
    --profile dts \
    --query 'Stacks[0].Outputs[?OutputKey==`DBSecurityGroupId`].OutputValue' \
    --output text) \
  --region us-east-2 \
  --profile dts \
  --query 'SecurityGroups[0].{GroupName:GroupName,IngressRules:IpPermissions[*].{Port:FromPort,Protocol:IpProtocol,Source:IpRanges[*].CidrIp}}'
```

**Expected Security Configuration**:
- PubliclyAccessible: `false` ✅
- Security Group: Only allows PostgreSQL (port 5432) from app subnets within VPC
- No public IP address assigned
- Database subnets have no internet gateway route

### View Database Credentials
```bash
# Retrieve credentials from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id $(aws cloudformation describe-stacks \
    --stack-name pbxscribe-api-backend-dev-database \
    --region us-east-2 \
    --profile dts \
    --query 'Stacks[0].Outputs[?OutputKey==`DBSecretArn`].OutputValue' \
    --output text) \
  --region us-east-2 \
  --profile dts \
  --query 'SecretString' \
  --output text
```

### Monitor Database Performance
```bash
# View CloudWatch logs
aws logs tail /aws/rds/instance/pbxscribe-api-backend-dev-db/postgresql \
  --follow \
  --region us-east-2 \
  --profile dts

# Check CPU utilization (last 1 hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=pbxscribe-api-backend-dev-db \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average \
  --region us-east-2 \
  --profile dts

# Check database connections
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=pbxscribe-api-backend-dev-db \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average \
  --region us-east-2 \
  --profile dts
```

### Test Database Connection

**IMPORTANT**: Since the database is in a private subnet, you MUST connect from within the VPC.

#### Option 1: From EC2 Instance in App Subnet
```bash
# Launch an EC2 instance in one of the app subnets, then:

# Install PostgreSQL client
sudo yum install postgresql15 -y

# Get the RDS Proxy endpoint
PROXY_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`DBProxyEndpoint`].OutputValue' \
  --output text)

# Connect via RDS Proxy (RECOMMENDED)
psql -h $PROXY_ENDPOINT -p 5432 -U postgres -d pbxscribe

# Once connected, test with basic SQL commands:
# SELECT version();
# SELECT current_database();
# \l  (list databases)
# \q  (quit)
```

#### Option 2: Python Test Script
```python
import psycopg2

# Get connection details from stack outputs
endpoint = "pbxscribe-api-backend-dev-db-proxy.proxy-XXXXXX.us-east-2.rds.amazonaws.com"
database = "pbxscribe"
username = "postgres"
password = "YOUR_PASSWORD_FROM_SECRETS_MANAGER"

try:
    conn = psycopg2.connect(
        host=endpoint,
        port=5432,
        database=database,
        user=username,
        password=password,
        sslmode='require'
    )

    cur = conn.cursor()
    cur.execute("SELECT version();")
    version = cur.fetchone()
    print(f"✅ Connected! PostgreSQL version: {version[0]}")

    cur.close()
    conn.close()
except Exception as e:
    print(f"❌ Connection failed: {str(e)}")
```

### Connection Information for Applications

**Use RDS Proxy Endpoint (Recommended)**:
```bash
# Get connection details
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`DBProxyEndpoint` || OutputKey==`DBName` || OutputKey==`DBEndpointPort`]'
```

**Environment Variables for Your Application**:
```bash
export DB_HOST=<DBProxyEndpoint from outputs>
export DB_PORT=5432
export DB_NAME=pbxscribe
export DB_USER=postgres
export DB_PASSWORD=<retrieve from Secrets Manager>
export DB_SSL_MODE=require
```

**Connection String Format**:
```
postgresql://postgres:<password>@<proxy-endpoint>:5432/pbxscribe?sslmode=require
```

### Verification Checklist

After deployment, verify:
- [x] CloudFormation stack status is `CREATE_COMPLETE`
- [x] RDS instance status is `available`
- [x] RDS Proxy status is `available` and targets are healthy
- [x] Database is **NOT** publicly accessible (`PubliclyAccessible: false`)
- [x] Storage encryption is enabled
- [x] TLS/SSL is required for connections
- [x] Security groups only allow access from app subnets
- [x] Credentials stored in Secrets Manager
- [ ] Test connection from EC2 instance in app subnet
- [ ] Verify application can connect through RDS Proxy

---

## Update Existing Stacks

If you need to update a stack with changes:

### Update Network Stack
```bash
aws cloudformation update-stack \
  --stack-name pbxscribe-api-backend-dev-network \
  --template-body file://infra/foundation/network.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=VpcCIDR,ParameterValue=10.42.0.0/16 \
  --region us-east-2 \
  --profile dts
```

### Update Database Stack
```bash
aws cloudformation update-stack \
  --stack-name pbxscribe-api-backend-dev-database \
  --template-body file://infra/foundation/database.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=DBMasterUsername,ParameterValue=postgres \
    ParameterKey=PostgreSQLVersion,ParameterValue=18 \
    ParameterKey=DBInstanceClass,ParameterValue=db.t3.micro \
    ParameterKey=DBAllocatedStorage,ParameterValue=100 \
    ParameterKey=DBName,ParameterValue=pbxscribe \
    ParameterKey=MultiAZ,ParameterValue=false \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 \
  --profile dts
```

---

## Delete Stacks (Cleanup)

To delete the stacks (in reverse order - API, then Database, then Network):

### Step 1: Delete API Stack

```bash
# Delete API stack first
aws cloudformation delete-stack \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts

# Wait for API stack to be deleted
aws cloudformation wait stack-delete-complete \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts
```

### Step 2: Disable RDS Deletion Protection

The database has deletion protection enabled for safety. You must disable it first:

```bash
# Disable deletion protection on RDS instance
aws rds modify-db-instance \
  --db-instance-identifier pbxscribe-api-backend-dev-db \
  --no-deletion-protection \
  --apply-immediately \
  --region us-east-2 \
  --profile dts

# Verify deletion protection is disabled
aws rds describe-db-instances \
  --db-instance-identifier pbxscribe-api-backend-dev-db \
  --region us-east-2 \
  --profile dts \
  --query 'DBInstances[0].DeletionProtection'
```

### Step 2: Delete Database Stack

```bash
# Delete database stack
aws cloudformation delete-stack \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts

# Monitor deletion progress
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].StackStatus'

# Wait for database stack to be deleted (this may take 5-10 minutes)
aws cloudformation wait stack-delete-complete \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts
```

### Step 4: Delete Network Stack

```bash
# Finally, delete network stack
aws cloudformation delete-stack \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --profile dts

# Wait for network stack to be deleted
aws cloudformation wait stack-delete-complete \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --profile dts
```

**Note**: RDS will create a final snapshot before deletion. This is configured in the CloudFormation template with `DeletionPolicy: Snapshot`.

---

## Troubleshooting

### View Stack Events
```bash
aws cloudformation describe-stack-events \
  --stack-name <stack-name> \
  --region us-east-2 \
  --profile dts
```

### View Stack Resources
```bash
aws cloudformation describe-stack-resources \
  --stack-name <stack-name> \
  --region us-east-2 \
  --profile dts
```

### Validate Template Before Deployment
```bash
# Validate any CloudFormation template
aws cloudformation validate-template \
  --template-body file://infra/foundation/network.yml \
  --region us-east-2 \
  --profile dts

# Validate all templates
aws cloudformation validate-template \
  --template-body file://infra/foundation/network.yml \
  --region us-east-2 \
  --profile dts

aws cloudformation validate-template \
  --template-body file://infra/foundation/database.yml \
  --region us-east-2 \
  --profile dts

aws cloudformation validate-template \
  --template-body file://infra/services/api.yml \
  --region us-east-2 \
  --profile dts
```

---

## Complete Deployment Workflow

Here's the complete workflow from scratch to a working API:

### Step 1: Validate All Templates

```bash
cd /Users/rayhan/Code/dts-pbxscribe

# Validate network template
echo "Validating network template..."
aws cloudformation validate-template \
  --template-body file://infra/foundation/network.yml \
  --region us-east-2 \
  --profile dts

# Validate database template
echo "Validating database template..."
aws cloudformation validate-template \
  --template-body file://infra/foundation/database.yml \
  --region us-east-2 \
  --profile dts

# Validate API template
echo "Validating API template..."
aws cloudformation validate-template \
  --template-body file://infra/services/api.yml \
  --region us-east-2 \
  --profile dts

echo "✅ All templates validated successfully"
```

### Step 2: Deploy Foundation Stacks

```bash
# Deploy network stack
echo "Deploying network stack..."
aws cloudformation create-stack \
  --stack-name pbxscribe-api-backend-dev-network \
  --template-body file://infra/foundation/network.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=VpcCIDR,ParameterValue=10.42.0.0/16 \
  --region us-east-2 \
  --tags Key=Environment,Value=dev Key=Project,Value=pbxscribe-api-backend \
  --profile dts

# Wait for network stack
echo "Waiting for network stack to complete..."
aws cloudformation wait stack-create-complete \
  --stack-name pbxscribe-api-backend-dev-network \
  --region us-east-2 \
  --profile dts

echo "✅ Network stack deployed"

# Deploy database stack
echo "Deploying database stack..."
aws cloudformation create-stack \
  --stack-name pbxscribe-api-backend-dev-database \
  --template-body file://infra/foundation/database.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=DBMasterUsername,ParameterValue=postgres \
    ParameterKey=PostgreSQLVersion,ParameterValue=18 \
    ParameterKey=DBInstanceClass,ParameterValue=db.t3.micro \
    ParameterKey=DBAllocatedStorage,ParameterValue=100 \
    ParameterKey=DBName,ParameterValue=pbxscribe \
    ParameterKey=MultiAZ,ParameterValue=false \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 \
  --tags Key=Environment,Value=dev Key=Project,Value=pbxscribe-api-backend \
  --profile dts

# Wait for database stack (this takes longer, ~10-15 minutes)
echo "Waiting for database stack to complete (this may take 10-15 minutes)..."
aws cloudformation wait stack-create-complete \
  --stack-name pbxscribe-api-backend-dev-database \
  --region us-east-2 \
  --profile dts

echo "✅ Database stack deployed"
```

### Step 3: Test Lambda Code Locally

```bash
# Test Lambda function locally before deploying
cd src/api
npm install
npm test
cd ../..

echo "✅ Lambda function tested locally"
```

### Step 4: Deploy API Stack

```bash
# Deploy API stack
echo "Deploying API stack..."
aws cloudformation create-stack \
  --stack-name pbxscribe-api-backend-dev-api \
  --template-body file://infra/services/api.yml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=pbxscribe-api-backend \
    ParameterKey=LambdaRuntime,ParameterValue=nodejs20.x \
    ParameterKey=LambdaMemorySize,ParameterValue=512 \
    ParameterKey=LambdaTimeout,ParameterValue=30 \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 \
  --tags Key=Environment,Value=dev Key=Project,Value=pbxscribe-api-backend \
  --profile dts

# Wait for API stack
echo "Waiting for API stack to complete..."
aws cloudformation wait stack-create-complete \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts

echo "✅ API stack deployed"
```

### Step 5: Deploy Lambda Code

```bash
# Package Lambda function
echo "Packaging Lambda function..."
cd src/api
zip -r ../../function.zip . -x "*.git*" -x "tests/*" -x "node_modules/aws-sdk/*"
cd ../..

# Update Lambda function code
echo "Deploying Lambda code..."
aws lambda update-function-code \
  --function-name pbxscribe-api-backend-dev-api \
  --zip-file fileb://function.zip \
  --region us-east-2 \
  --profile dts

# Wait for update to complete
aws lambda wait function-updated \
  --function-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts

echo "✅ Lambda code deployed"
```

### Step 6: Test API

```bash
# Get API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiStageUrl`].OutputValue' \
  --output text)

echo "API URL: $API_URL"

# Test endpoints
echo -e "\n✅ Testing API endpoints..."
curl -s $API_URL/health | jq '.'
curl -s $API_URL/ready | jq '.'
curl -s $API_URL/live | jq '.'

echo -e "\n✅ Deployment complete! API is accessible at: $API_URL"
```

---

## Quick Reference

### Check All Stack Statuses

```bash
# Check all stacks at once
aws cloudformation describe-stacks \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[?starts_with(StackName, `pbxscribe-api-backend-dev`)].{Name:StackName,Status:StackStatus}' \
  --output table
```

### Get All API Information

```bash
# Get all important URLs and endpoints
aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `Url`) || contains(OutputKey, `Endpoint`)].{Key:OutputKey,Value:OutputValue}' \
  --output table
```

### Quick Health Check

```bash
# Quick health check of all components
API_URL=$(aws cloudformation describe-stacks \
  --stack-name pbxscribe-api-backend-dev-api \
  --region us-east-2 \
  --profile dts \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiStageUrl`].OutputValue' \
  --output text)

echo "API Health: $(curl -s $API_URL/health)"
echo "Database Health: $(curl -s $API_URL/health/db)"
```

### View All Logs

```bash
# View Lambda logs (last 30 minutes)
aws logs tail /aws/lambda/pbxscribe-api-backend-dev-api \
  --since 30m \
  --region us-east-2 \
  --profile dts

# View API Gateway logs (last 30 minutes)
aws logs tail /aws/apigateway/pbxscribe-api-backend-dev-api \
  --since 30m \
  --region us-east-2 \
  --profile dts
```
