
-- PROFILES: Basic user profile mapped by auth.uid() (no FK to auth.users)
create table if not exists public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Select own profile'
  ) then
    create policy "Select own profile"
      on public.profiles
      for select
      using (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Insert own profile'
  ) then
    create policy "Insert own profile"
      on public.profiles
      for insert
      with check (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Update own profile'
  ) then
    create policy "Update own profile"
      on public.profiles
      for update
      using (id = auth.uid());
  end if;
end$$;

-- Shared trigger for updated_at
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- LISTS: Parent entity for grocery lists
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null default 'Untitled list',
  archived boolean not null default false,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lists_user_id on public.lists(user_id);
alter table public.lists enable row level security;

-- RLS for lists
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'lists' and policyname = 'Lists select own'
  ) then
    create policy "Lists select own"
      on public.lists
      for select
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'lists' and policyname = 'Lists insert own'
  ) then
    create policy "Lists insert own"
      on public.lists
      for insert
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'lists' and policyname = 'Lists update own'
  ) then
    create policy "Lists update own"
      on public.lists
      for update
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'lists' and policyname = 'Lists delete own'
  ) then
    create policy "Lists delete own"
      on public.lists
      for delete
      using (user_id = auth.uid());
  end if;
end$$;

-- Trigger: updated_at
drop trigger if exists trg_lists_updated_at on public.lists;
create trigger trg_lists_updated_at
before update on public.lists
for each row execute function public.handle_updated_at();

-- LIST_ITEMS: Items within a list
create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  user_id uuid not null,   -- denormalized for easier RLS and indexing
  name text not null,
  aisle text,
  quantity text,
  checked boolean not null default false,
  position integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_list_items_list_id on public.list_items(list_id);
create index if not exists idx_list_items_user_id on public.list_items(user_id);
create index if not exists idx_list_items_list_position on public.list_items(list_id, position);

alter table public.list_items enable row level security;

-- Validation/Defaults via triggers (preferred over CHECK constraints)
-- 1) Ensure list_items.user_id always matches parent list.user_id
-- 2) Assign position if null: max(position)+1 within the same list
create or replace function public.list_items_defaults()
returns trigger
language plpgsql
as $$
declare
  parent_user uuid;
  next_pos integer;
begin
  select user_id into parent_user from public.lists where id = new.list_id;
  if parent_user is null then
    raise exception 'Invalid list_id %: parent list not found', new.list_id;
  end if;

  new.user_id := parent_user;

  if new.position is null then
    select coalesce(max(position), 0) + 1 into next_pos
    from public.list_items
    where list_id = new.list_id;
    new.position := next_pos;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_list_items_defaults on public.list_items;
create trigger trg_list_items_defaults
before insert or update of list_id on public.list_items
for each row execute function public.list_items_defaults();

-- Trigger: updated_at
drop trigger if exists trg_list_items_updated_at on public.list_items;
create trigger trg_list_items_updated_at
before update on public.list_items
for each row execute function public.handle_updated_at();

-- RLS for list_items: only through parent ownership
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'list_items' and policyname = 'List items select via parent'
  ) then
    create policy "List items select via parent"
      on public.list_items
      for select
      using (exists (
        select 1 from public.lists l
        where l.id = list_id and l.user_id = auth.uid()
      ));
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'list_items' and policyname = 'List items insert via parent'
  ) then
    create policy "List items insert via parent"
      on public.list_items
      for insert
      with check (exists (
        select 1 from public.lists l
        where l.id = list_id and l.user_id = auth.uid()
      ));
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'list_items' and policyname = 'List items update via parent'
  ) then
    create policy "List items update via parent"
      on public.list_items
      for update
      using (exists (
        select 1 from public.lists l
        where l.id = list_id and l.user_id = auth.uid()
      ));
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'list_items' and policyname = 'List items delete via parent'
  ) then
    create policy "List items delete via parent"
      on public.list_items
      for delete
      using (exists (
        select 1 from public.lists l
        where l.id = list_id and l.user_id = auth.uid()
      ));
  end if;
end$$;

-- REALTIME: ensure full row payloads and publication membership
alter table public.lists replica identity full;
alter table public.list_items replica identity full;

-- Might fail if already present; OK to ignore duplicate additions
do $$
begin
  begin
    alter publication supabase_realtime add table public.lists;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.list_items;
  exception when duplicate_object then
    null;
  end;
end$$;

-- STORAGE: create uploads bucket (public read by default)
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

-- RLS for storage.objects
-- Public read for uploads bucket
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read for uploads'
  ) then
    create policy "Public read for uploads"
      on storage.objects
      for select
      using (bucket_id = 'uploads');
  end if;

  -- Authenticated users can insert/update/delete only within prefix {user_id}/...
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users insert own uploads'
  ) then
    create policy "Users insert own uploads"
      on storage.objects
      for insert
      with check (
        bucket_id = 'uploads'
        and auth.role() = 'authenticated'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users update own uploads'
  ) then
    create policy "Users update own uploads"
      on storage.objects
      for update
      using (
        bucket_id = 'uploads'
        and auth.role() = 'authenticated'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users delete own uploads'
  ) then
    create policy "Users delete own uploads"
      on storage.objects
      for delete
      using (
        bucket_id = 'uploads'
        and auth.role() = 'authenticated'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  end if;
end$$;
