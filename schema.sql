-- Create a table for public profiles (extends auth.users)
create table profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique,
  credits int default 10,
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

-- Function to handle new user creation
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, credits)
  values (new.id, new.email, 10); -- Give 10 free credits
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
