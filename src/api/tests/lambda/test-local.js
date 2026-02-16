// Local test script for Lambda function
// This simulates invoking the Lambda function locally

// Set up mock environment variables
process.env.NODE_ENV = 'development';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'pbxscribe';
process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-2:123456789012:secret:mock-secret';
process.env.AWS_REGION = 'us-east-2';
process.env.LOG_LEVEL = 'debug';

// Import the Lambda handler
const { handler } = require('../../index');

// Mock API Gateway HTTP API event for root path
const mockEventRoot = {
  version: '2.0',
  routeKey: '$default',
  rawPath: '/',
  rawQueryString: '',
  headers: {
    'accept': 'application/json',
    'content-type': 'application/json',
    'user-agent': 'test-client/1.0',
    'x-forwarded-for': '127.0.0.1',
  },
  requestContext: {
    accountId: '123456789012',
    apiId: 'test-api-id',
    domainName: 'test-api.execute-api.us-east-2.amazonaws.com',
    domainPrefix: 'test-api',
    http: {
      method: 'GET',
      path: '/',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'test-client/1.0',
    },
    requestId: 'test-request-id',
    routeKey: '$default',
    stage: '$default',
    time: new Date().toISOString(),
    timeEpoch: Date.now(),
  },
  isBase64Encoded: false,
};

// Mock API Gateway HTTP API event for /health
const mockEventHealth = {
  ...mockEventRoot,
  rawPath: '/health',
  requestContext: {
    ...mockEventRoot.requestContext,
    http: {
      ...mockEventRoot.requestContext.http,
      path: '/health',
    },
  },
};

// Mock Lambda context
const mockContext = {
  functionName: 'pbxscribe-api-backend-dev-api',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:pbxscribe-api-backend-dev-api',
  memoryLimitInMB: '512',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/pbxscribe-api-backend-dev-api',
  logStreamName: '2024/01/01/[$LATEST]test-stream',
  getRemainingTimeInMillis: () => 30000,
};

// Test function
async function runTests() {
  console.log('='.repeat(80));
  console.log('Testing Lambda Function Locally');
  console.log('='.repeat(80));
  console.log();

  try {
    // Test 1: Root endpoint
    console.log('Test 1: GET /');
    console.log('-'.repeat(80));
    const response1 = await handler(mockEventRoot, mockContext);
    console.log('Status Code:', response1.statusCode);
    console.log('Headers:', JSON.stringify(response1.headers, null, 2));
    console.log('Body:', JSON.stringify(JSON.parse(response1.body), null, 2));
    console.log();

    // Test 2: Health endpoint
    console.log('Test 2: GET /health');
    console.log('-'.repeat(80));
    const response2 = await handler(mockEventHealth, mockContext);
    console.log('Status Code:', response2.statusCode);
    console.log('Headers:', JSON.stringify(response2.headers, null, 2));
    console.log('Body:', JSON.stringify(JSON.parse(response2.body), null, 2));
    console.log();

    // Test 3: Database health endpoint (will fail without real database)
    console.log('Test 3: GET /health/db');
    console.log('-'.repeat(80));
    console.log('Note: This will fail without a real database connection');
    const mockEventDb = {
      ...mockEventRoot,
      rawPath: '/health/db',
      requestContext: {
        ...mockEventRoot.requestContext,
        http: {
          ...mockEventRoot.requestContext.http,
          path: '/health/db',
        },
      },
    };
    const response3 = await handler(mockEventDb, mockContext);
    console.log('Status Code:', response3.statusCode);
    console.log('Headers:', JSON.stringify(response3.headers, null, 2));
    console.log('Body:', JSON.stringify(JSON.parse(response3.body), null, 2));
    console.log();

    console.log('='.repeat(80));
    console.log('Tests completed!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('Test failed with error:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
