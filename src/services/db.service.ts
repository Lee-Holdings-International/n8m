import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class DbService {
  private static instance: DbService;
  public client: SupabaseClient;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    // Prioirtize Service Role Key for backend operations to bypass RLS
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ SUPABASE_URL or keys not set. Database features will fail.');
    }
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY missing. API key validation may fail due to RLS.');
    }

    this.client = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseKey || 'placeholder'
    );
  }

  public static getInstance(): DbService {
    if (!DbService.instance) {
      DbService.instance = new DbService();
    }
    return DbService.instance;
  }

  async getCredits(userId: string): Promise<number> {
    const { data, error } = await this.client
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();
    
    if (error || !data) return 0;
    return data.credits;
  }

  async decrementCredits(userId: string, amount: number = 1): Promise<void> {
    // RPC call is better for atomicity, but for MVP update is fine
    // or: update profiles set credits = credits - 1 where id = ...
    
    // Supabase JS doesn't support 'increment' directly without RPC? 
    // Actually it does not. We need to fetch then update, or use RPC.
    // MVP: Optimistic.
    
    const current = await this.getCredits(userId);
    if (current < amount) throw new Error('Insufficient credits');

    await this.client
      .from('profiles')
      .update({ credits: current - amount })
      .eq('id', userId);
  }
}
