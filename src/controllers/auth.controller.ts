import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { DbService } from '../services/db.service.js';
import crypto from 'crypto';
import { getLoginPageHtml } from '../ui/login-page.js';
import { getSignupPageHtml } from '../ui/signup-page.js';

const authRoutes: FastifyPluginAsync = async (fastify, opts) => {
  console.log('🔌 Registering Auth Routes...');
  const db = DbService.getInstance();

  // Helper to hash keys
  const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

  // 1. Login Page (Hosted UI)
  fastify.get('/auth/login', async (request, reply) => {
    const { redirect_port, reauth } = request.query as { redirect_port?: string, reauth?: string };
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const redirectUrl = redirect_port ? `http://localhost:${redirect_port}/callback` : '/api/v1/billing';
    const shouldReauth = reauth === 'true';

    const html = getLoginPageHtml(supabaseUrl, supabaseKey, redirectUrl, shouldReauth);
    reply.type('text/html').send(html);
  });

  // 1b. Logout Page (Termination)
  fastify.get('/auth/logout', async (request, reply) => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const { getLogoutPageHtml } = await import('../ui/logout-page.js');
    const html = getLogoutPageHtml(supabaseUrl, supabaseKey);
    reply.type('text/html').send(html);
  });

  // 1c. API Logout (Termination)
  fastify.post('/auth/logout', async (request, reply) => {
    // 1. Invalidate API Key if used
    const apiKey = request.headers['x-api-key'] as string;
    
    if (apiKey) {
      const { createHash } = await import('crypto');
      const keyHash = createHash('sha256').update(apiKey).digest('hex');
      
      const { error: updateError } = await db.client
        .from('api_keys')
        .update({ is_active: false })
        .eq('key_hash', keyHash);
        
      if (updateError) {
        request.log.warn({ err: updateError }, 'Failed to invalidate API key during logout');
      } else {
        request.log.info('API Key invalidated successfully.');
      }
    }

    // 2. Global Sign Out (if Service Role Key exists)
    if (request.user && request.user.id) {
       const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
       if (serviceKey && process.env.SUPABASE_URL) {
          try {
             // Dynamic import to avoid top-level dependency if not used
             const { createClient } = await import('@supabase/supabase-js');
             const adminClient = createClient(process.env.SUPABASE_URL, serviceKey, {
               auth: {
                 autoRefreshToken: false,
                 persistSession: false
               }
             });
             
             const { error: signOutError } = await adminClient.auth.admin.signOut(request.user.id);
             if (signOutError) {
                request.log.warn({ err: signOutError }, 'Failed to perform global sign out');
             } else {
                request.log.info(`User ${request.user.id} signed out globally.`);
             }
          } catch (err) {
             request.log.error({ err }, 'Error during global sign out execution');
          }
       } else {
         request.log.warn('Skipping global sign out: Missing SUPABASE_SERVICE_ROLE_KEY');
       }
    }

    return { success: true, message: 'Logged out successfully' };
  });


  // 2. Signup Page (Hosted UI)
  fastify.get('/auth/signup', async (request, reply) => {
    const { redirect_port } = request.query as { redirect_port?: string };
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const redirectUrl = redirect_port ? `http://localhost:${redirect_port}/callback` : '';

    const html = getSignupPageHtml(supabaseUrl, supabaseKey, redirectUrl);
    reply.type('text/html').send(html);
  });

  fastify.post('/keys', async (request, reply) => {
    if (!request.user || !request.user.id) {
       return reply.code(401).send({ error: 'Unauthorized' });
    }

    const key = `n8k_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = hashKey(key);

    // Save to DB using user's token from request to respect RLS
    const authHeader = request.headers['authorization'];
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
        return reply.code(401).send({ error: 'Missing Bearer Token' });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const userClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { error: insertError } = await userClient
      .from('api_keys')
      .insert({
        user_id: request.user.id,
        key_hash: keyHash,
        name: 'CLI Key (Created via Auth Flow)'
      });

    if (insertError) {
      console.error('❌ Failed to save API Key:', insertError);
      return reply.code(500).send({ error: `Could not persist API Key: ${insertError.message}` });
    }

    return { key };
  });
};

export default authRoutes;
