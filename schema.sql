-- Create a table for public profiles (extends auth.users)
create table profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique,
  credits int default 10,
  subscription_tier text default 'free',
  stripe_customer_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table profiles enable row level security;

-- Create policies
create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

-- Create a table for API keys
create table api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  key_hash text not null, -- Store the hash, not the key!
  name text,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  is_active boolean default true
);

-- Enable RLS for API keys
alter table api_keys enable row level security;

create policy "Users can view own keys" on api_keys
  for select using (auth.uid() = user_id);

create policy "Users can delete own keys" on api_keys
  for delete using (auth.uid() = user_id);

create policy "Users can create keys" on api_keys
  for insert with check (auth.uid() = user_id);

-- Create a table for credit transactions
create table credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  amount int not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for transactions
alter table credit_transactions enable row level security;

create policy "Users can view own transactions" on credit_transactions
  for select using (auth.uid() = user_id);

-- Atomic credit decrement function
create or replace function decrement_credits_atomic(user_id uuid, amount int, description text default 'Usage')
returns int as $$
declare
  curr_balance int;
  new_balance int;
begin
  -- Get current balance and lock row
  select credits into curr_balance from profiles where id = user_id for update;
  
  if curr_balance < amount then
    raise exception 'Insufficient credits' using errcode = 'P0001';
  end if;
  
  new_balance := curr_balance - amount;
  
  -- Update profile
  update profiles set credits = new_balance where id = user_id;
  
  -- Log transaction
  insert into credit_transactions (user_id, amount, description)
  values (user_id, -amount, description);
  
  return new_balance;
end;
$$ language plpgsql security definer;

-- Atomic credit increment function
create or replace function increment_credits_atomic(user_id uuid, amount int, description text default 'Top-up')
returns int as $$
declare
  curr_balance int;
  new_balance int;
begin
  -- Get current balance and lock row
  select credits into curr_balance from profiles where id = user_id for update;
  
  if curr_balance is null then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;
  
  new_balance := curr_balance + amount;
  
  -- Update profile
  update profiles set credits = new_balance where id = user_id;
  
  -- Log transaction
  insert into credit_transactions (user_id, amount, description)
  values (user_id, amount, description);
  
  return new_balance;
end;
$$ language plpgsql security definer;



-- Function to handle new user creation
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, credits, subscription_tier)
  values (new.id, new.email, 10, 'free'); -- Give 10 free credits
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
