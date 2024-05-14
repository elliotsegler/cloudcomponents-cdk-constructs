import { EventBridgeClient, PutEventsCommand, PutEventsCommandInput } from '@aws-sdk/client-eventbridge';
import { SecretKey } from '@cloudcomponents/lambda-utils';
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getEnv } from 'get-env-or-die';
import Stripe from 'stripe';

const eventBridge = new EventBridgeClient();
const endpointSecretKey = new SecretKey(getEnv('ENDPOINT_SECRET_STRING'), {
  configuration: { maxAttempts: 5 },
});
const apiSecretKey = new SecretKey(getEnv('SECRET_KEY_STRING'), {
  configuration: { maxAttempts: 5 },
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const apiKey = await apiSecretKey.getValue();

    const stripe = new Stripe(apiKey, {
      apiVersion: '2020-08-27',
      telemetry: false,
      typescript: true,
    });

    const signature = event.headers['Stripe-Signature'];
    if (!signature) {
      throw new Error('Stripe signature is missing');
    }

    const endpointSecret = await endpointSecretKey.getValue();
    if (!event.body) {
      throw new Error('event body undefined or null');
    }
    const eventReceived = stripe.webhooks.constructEvent(event.body, signature, endpointSecret);

    const { type, ...details } = eventReceived;

    const params: PutEventsCommandInput = {
      Entries: [
        {
          Detail: JSON.stringify(details),
          DetailType: type,
          EventBusName: getEnv('EVENT_BUS_NAME', 'default'),
          Resources: [],
          Source: process.env.SOURCE,
        },
      ],
    };

    await eventBridge.send(new PutEventsCommand(params));

    return {
      statusCode: 200,
      body: 'Success',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(error);

    if (error.type === 'StripeSignatureVerificationError') {
      return {
        statusCode: 400,
        body: `Webhook Error: ${error.message}`,
      };
    }

    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
