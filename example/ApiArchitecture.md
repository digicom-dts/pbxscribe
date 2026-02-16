# API Architecture Overview

## Infrastructure Components

### Lambda Function
- **Runtime**: Node.js 20.x
- **Framework**: Fastify (to be deployed)
- **Memory**: 512 MB (configurable)
- **Timeout**: 30 seconds (configurable)
- **VPC**: Deployed in app subnets for database access
- **Security**: Private access to RDS via RDS Proxy

### API Gateway
- **Type**: HTTP API (cheaper and simpler than REST API)
- **Custom Domain**: api.pbxscribe.com (prod) / api-dev.pbxscribe.com (dev)
- **SSL/TLS**: Via ACM certificate
- **CORS**: Enabled for all origins (configurable)
- **Throttling**: 2000 requests/second, 5000 burst

### Networking
- **Lambda Security Group**: Allows outbound to RDS on port 5432 and HTTPS to AWS services
- **Database Access**: Through RDS Proxy (connection pooling and security)
- **Subnets**: Lambda deployed in all 3 app subnets (multi-AZ)

### Environment Variables (Auto-configured)
```
NODE_ENV=dev
DB_HOST=<rds-proxy-endpoint>
DB_PORT=5432
DB_NAME=pbxscribe
DB_SECRET_ARN=<secrets-manager-arn>
AWS_NODEJS_CONNECTION_REUSE_ENABLED=1
```

### IAM Permissions
- Lambda can access Secrets Manager to retrieve database credentials
- Lambda has VPC execution permissions
- Lambda can write to CloudWatch Logs

### Logging
- Lambda logs: `/aws/lambda/pbxscribe-api-backend-dev-api`
- API Gateway logs: `/aws/apigateway/pbxscribe-api-backend-dev-api`
- Retention: 7 days (dev), 30 days (prod)

---

## Fastify Application Structure

Your Lambda function should use this structure for Fastify:

```javascript
// index.js
const awsLambdaFastify = require('@fastify/aws-lambda');
const init = require('./app');

let proxy;

exports.handler = async (event, context) => {
  if (!proxy) {
    const app = await init();
    proxy = awsLambdaFastify(app);
  }
  return proxy(event, context);
};
```

```javascript
// app.js
const fastify = require('fastify');
const { Client } = require('pg');
const AWS = require('aws-sdk');

async function init() {
  const app = fastify({
    logger: true,
  });

  // Get database credentials from Secrets Manager
  const secretsManager = new AWS.SecretsManager({
    region: process.env.AWS_REGION || 'us-east-2',
  });

  let dbCredentials;
  try {
    const secret = await secretsManager
      .getSecretValue({ SecretId: process.env.DB_SECRET_ARN })
      .promise();
    dbCredentials = JSON.parse(secret.SecretString);
  } catch (error) {
    app.log.error('Failed to retrieve database credentials:', error);
    throw error;
  }

  // PostgreSQL client configuration
  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: dbCredentials.username,
    password: dbCredentials.password,
    ssl: {
      rejectUnauthorized: true,
    },
  };

  // Health check endpoint
  app.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Database health check
  app.get('/health/db', async (request, reply) => {
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const result = await client.query('SELECT version()');
      await client.end();
      return {
        status: 'ok',
        database: 'connected',
        version: result.rows[0].version,
      };
    } catch (error) {
      reply.code(503);
      return {
        status: 'error',
        database: 'disconnected',
        error: error.message,
      };
    }
  });

  // Example API routes
  app.get('/', async (request, reply) => {
    return {
      message: 'Welcome to PBXScribe API',
      version: '1.0.0',
      environment: process.env.NODE_ENV,
    };
  });

  return app;
}

module.exports = init;
```

---

## Package.json Dependencies

```json
{
  "name": "pbxscribe-api",
  "version": "1.0.0",
  "description": "PBXScribe API with Fastify on AWS Lambda",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "@fastify/aws-lambda": "^4.0.0",
    "fastify": "^4.26.0",
    "pg": "^8.11.3",
    "aws-sdk": "^2.1543.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## Deployment Process

### 1. Install Dependencies
```bash
npm install
```

### 2. Package Lambda Function
```bash
# Create deployment package
zip -r function.zip index.js app.js node_modules/ package.json
```

### 3. Deploy to Lambda
```bash
aws lambda update-function-code \
  --function-name pbxscribe-api-backend-dev-api \
  --zip-file fileb://function.zip \
  --region us-east-2 \
  --profile dts
```

### 4. Test the API
```bash
# Test with custom domain
curl https://api.pbxscribe.com/health

# Test database connection
curl https://api.pbxscribe.com/health/db
```

---

## Database Connection Example

The Lambda function automatically has access to:
- **DB_HOST**: RDS Proxy endpoint (for connection pooling)
- **DB_SECRET_ARN**: Secrets Manager ARN for credentials
- **DB_NAME**: Database name (pbxscribe)
- **DB_PORT**: 5432

Retrieve credentials from Secrets Manager in your code:

```javascript
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

const getDbCredentials = async () => {
  const secret = await secretsManager
    .getSecretValue({ SecretId: process.env.DB_SECRET_ARN })
    .promise();
  return JSON.parse(secret.SecretString);
};
```

---

## Security Best Practices

1. **Always use RDS Proxy** (DB_HOST) instead of direct RDS endpoint
2. **Retrieve credentials from Secrets Manager** at runtime
3. **Use SSL/TLS for database connections** (`ssl: { rejectUnauthorized: true }`)
4. **Keep Lambda in VPC** to access private database
5. **Use environment variables** for configuration
6. **Enable CloudWatch Logs** for debugging
7. **Implement proper error handling** for database connections

---

## Monitoring and Debugging

### View Lambda Logs
```bash
aws logs tail /aws/lambda/pbxscribe-api-backend-dev-api --follow --region us-east-2 --profile dts
```

### Check Lambda Metrics
```bash
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
```

### Test Lambda Function Directly
```bash
aws lambda invoke \
  --function-name pbxscribe-api-backend-dev-api \
  --payload '{"rawPath":"/health","requestContext":{"http":{"method":"GET"}}}' \
  --region us-east-2 \
  --profile dts \
  response.json

cat response.json
```

---

## API Endpoints

Once deployed, your API will be available at:

- **Custom Domain**: https://api.pbxscribe.com (prod) / https://api-dev.pbxscribe.com (dev)
- **API Gateway Direct**: https://{api-id}.execute-api.us-east-2.amazonaws.com/dev

All routes defined in your Fastify app will be accessible through these endpoints.

---

## Cold Start Optimization

To minimize cold starts:

1. **Keep dependencies minimal** - Only install required packages
2. **Use connection reuse** - `AWS_NODEJS_CONNECTION_REUSE_ENABLED=1` (already set)
3. **Lazy load heavy dependencies** - Load database clients only when needed
4. **Consider provisioned concurrency** - For production workloads
5. **Optimize package size** - Remove unnecessary files from deployment package

---

## Scaling Configuration

The API Gateway HTTP API automatically scales, with these limits:

- **Throttle Rate**: 2000 requests/second (configurable)
- **Burst Limit**: 5000 requests (configurable)
- **Lambda Concurrent Executions**: Default 1000 per region (can be increased)

For production, consider:
- Increasing throttle limits
- Setting up Lambda reserved concurrency
- Implementing API Gateway usage plans
- Adding WAF for DDoS protection
