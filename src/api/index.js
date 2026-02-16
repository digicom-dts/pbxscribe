// Lambda handler for Fastify application
const awsLambdaFastify = require('@fastify/aws-lambda');
const init = require('./app');

let proxy;

/**
 * Lambda handler function
 * Initializes Fastify app on first invocation and reuses it for subsequent calls
 */
exports.handler = async (event, context) => {
  // Initialize proxy on first invocation (cold start)
  if (!proxy) {
    console.log('Cold start - initializing Fastify app');
    const app = await init();
    proxy = awsLambdaFastify(app);
  }

  // Handle the request
  return proxy(event, context);
};
