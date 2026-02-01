import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class DbService {
  private static instance: DbService;
  public client: SupabaseClient;
  private isShim: boolean = false;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    // Prioirtize Service Role Key for backend operations to bypass RLS
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('placeholder')) {
      console.warn('⚠️ SUPABASE_URL or keys not set. Database features will use SHIM/MOCK data.');
      this.isShim = true;
    }
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY missing. API key validation may fail due to RLS.');
    }

    this.client = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseKey || 'placeholder'
    );
  }

  public getIsShim(): boolean {
    return this.isShim;
  }

  public static getInstance(): DbService {
    if (!DbService.instance) {
      DbService.instance = new DbService();
    }
    return DbService.instance;
  }

  async getCredits(userId: string): Promise<number> {
    if (this.isShim) return 42;

    const { data, error } = await this.client
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();
    
    if (error || !data) return 0;
    return data.credits;
  }

  async decrementCredits(userId: string, amount: number = 1, description: string = 'Usage'): Promise<number> {
    const { data, error } = await this.client.rpc('decrement_credits_atomic', {
      user_id: userId,
      amount,
      description
    });

    if (error) {
      if (error.code === 'P0001') {
        throw new Error('Insufficient credits');
      }
      console.error('Error decrementing credits:', error);
      throw new Error('Failed to decrement credits');
    }

    return data;
  }

  async addCredits(userId: string, amount: number, description: string = 'Top-up'): Promise<number> {
    const { data, error } = await this.client.rpc('increment_credits_atomic', {
      user_id: userId,
      amount,
      description
    });

    if (error) {
      console.error('Error adding credits:', error);
      throw new Error('Failed to add credits');
    }

    return data;
  }

  async getTransactionHistory(userId: string, limit: number = 50) {
    if (this.isShim) {
      return [
        { id: '1', created_at: new Date().toISOString(), description: 'Mock Top-up', amount: 50 },
        { id: '2', created_at: new Date(Date.now() - 86400000).toISOString(), description: 'AI Workflow Generation', amount: -1 },
        { id: '3', created_at: new Date(Date.now() - 172800000).toISOString(), description: 'Welcome Bonus', amount: 10 },
      ];
    }

    const { data, error } = await this.client
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching transaction history:', error);
      return [];
    }

    return data;
  }

  async getApiKeys(userId: string) {
    if (this.isShim) {
      return [
        { id: 'key-1', name: 'Desktop CLI', key_hash: 'n8m_sk_...1234', created_at: new Date().toISOString() },
        { id: 'key-2', name: 'CI/CD Bot', key_hash: 'n8m_sk_...5678', created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
      ];
    }

    const { data, error } = await this.client
      .from('api_keys')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching API keys:', error);
      return [];
    }
    return data;
  }

  async revokeApiKey(userId: string, keyId: string) {
    if (this.isShim) return true;

    const { error } = await this.client
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', keyId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error revoking API key:', error);
      throw new Error('Failed to revoke API key');
    }
    return true;
  }
}
