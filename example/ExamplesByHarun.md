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

To delete the stacks (in reverse order):

### Step 1: Disable RDS Deletion Protection

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

### Step 3: Delete Network Stack

```bash
# Then delete network stack
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
aws cloudformation validate-template \
  --template-body file://infra/foundation/network.yml \
  --region us-east-2 \
  --profile dts
```
