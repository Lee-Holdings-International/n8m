import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { DbService } from '../services/db.service.js';

import { getPortalPageHtml } from '../ui/portal-page.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-01-27' as any,
});

const isStripeShim = !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('sk_test_');

const billingRoutes: FastifyPluginAsync = async (fastify, opts) => {
  const db = DbService.getInstance();

  // 0. Serve Portal Page (Unified Dashboard)
  fastify.get('/', async (request, reply) => {
    if (!request.user || !request.user.id) {
       return reply.redirect('/api/v1/auth/login');
    }

    const userId = request.user.id;
    const userEmail = request.user.email || 'user@example.com';

    const [credits, profileResponse, transactions, apiKeys] = await Promise.all([
      db.getCredits(userId),
      !process.env.SUPABASE_URL ? Promise.resolve({ data: { subscription_tier: 'free' } }) : db.client.from('profiles').select('subscription_tier').eq('id', userId).single(),
      db.getTransactionHistory(userId, 10),
      db.getApiKeys(userId)
    ]);

    const config = {
      prices: {
        pro: process.env.STRIPE_PRICE_ID_PRO || 'price_pro_mock',
        topup_50: process.env.STRIPE_PRICE_ID_TOPUP_50 || 'price_topup_mock',
      }
    };

    const html = getPortalPageHtml({
      user: { id: userId, email: userEmail },
      credits,
      tier: (profileResponse as any).data?.subscription_tier || 'free',
      transactions,
      apiKeys,
      config
    });
    
    reply.type('text/html').send(html);
  });

  // 1. Revoke API Key
  fastify.delete('/keys/:id', async (request, reply) => {
    if (!request.user || !request.user.id) {
       return reply.code(401).send({ error: 'Unauthorized' });
    }
    const { id } = request.params as { id: string };
    
    try {
        await db.revokeApiKey(request.user.id, id);
        return { success: true };
    } catch (err: any) {
        return reply.code(500).send({ error: err.message });
    }
  });


  // 1. Get Billing Config
  fastify.get('/config', async (request, reply) => {
    return {
      prices: {
        pro: process.env.STRIPE_PRICE_ID_PRO,
        topup_50: process.env.STRIPE_PRICE_ID_TOPUP_50,
      },
      creditRate: Number(process.env.STRIPE_CREDIT_RATE) || 10,
    };
  });

  // 2. Create Checkout Session
  fastify.post('/checkout', async (request, reply) => {
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { priceId } = request.body as { priceId: string };
    if (!priceId) {
      return reply.code(400).send({ error: 'Missing priceId' });
    }

    try {
      if (isStripeShim || priceId.includes('mock')) {
        request.log.info({ priceId }, 'Stripe in SHIM mode. Returning mock checkout URL.');
        return { 
          sessionId: 'cs_test_mock', 
          url: `/api/v1/billing?success=true&mock=true&priceId=${priceId}` 
        };
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: priceId === process.env.STRIPE_PRICE_ID_PRO ? 'subscription' : 'payment',
        success_url: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/billing/success',
        cancel_url: process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/billing/cancel',
        metadata: {
          userId: request.user.id,
          priceId: priceId,
        },
      });

      return { sessionId: session.id, url: session.url };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to create checkout session' });
    }
  });

  // 3. Stripe Webhook
  fastify.post('/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const sig = request.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;

    try {
      // Fastify needs raw body for Stripe webhook verification
      // We might need a separate plugin for raw body if not already present
      const body = request.body as Buffer;
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret || '');
    } catch (err: any) {
      request.log.error(`Webhook signature verification failed: ${err.message}`);
      return reply.code(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const priceId = session.metadata?.priceId;

      if (userId && priceId) {
        request.log.info(`Payment successful for user ${userId}, price ${priceId}`);
        
        // Add credits based on priceId or environment config
        let creditsToAdd = 0;
        let description = 'Credit Top-up';

        if (priceId === process.env.STRIPE_PRICE_ID_TOPUP_50) {
          creditsToAdd = 50;
        } else if (priceId === process.env.STRIPE_PRICE_ID_PRO) {
          creditsToAdd = 100; // Example: Pro subscription gives 100 credits initially
          description = 'Pro Subscription Credits';
          
          // Also update subscription tier in profile
          await db.client
            .from('profiles')
            .update({ subscription_tier: 'pro', stripe_customer_id: session.customer as string })
            .eq('id', userId);
        }

        if (creditsToAdd > 0) {
          await db.addCredits(userId, creditsToAdd, description);
        }
      }
    }

    return { received: true };
  });
};

export default billingRoutes;
