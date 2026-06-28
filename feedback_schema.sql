-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Feedback / Improvement Request system
-- À exécuter une fois dans Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

-- Helper : is_admin(uid) — bypasses profiles RLS proprement
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

-- ───────────────────────────────────────────────────────────────────
-- 1. feedback
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references auth.users(id) on delete cascade,
  author_nickname     text not null,
  title               text not null check (char_length(title) <= 80),
  component           text not null,
  type                text not null check (type in ('new_feature', 'bug', 'other')),
  description         text not null check (char_length(description) <= 1500),
  status              text not null default 'submitted'
                        check (status in ('submitted','accepted','ongoing','postponed','blocked','done','refused')),
  refusal_reason      text,
  screenshots         jsonb not null default '[]'::jsonb,
  status_history      jsonb not null default '[]'::jsonb,
  upvote_count        int not null default 0,
  comment_count       int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  status_changed_at   timestamptz not null default now(),
  status_changed_by   uuid references auth.users(id) on delete set null,
  constraint refusal_requires_reason
    check (status <> 'refused' or (refusal_reason is not null and char_length(refusal_reason) > 0))
);

create index if not exists feedback_status_idx        on public.feedback(status);
create index if not exists feedback_author_idx        on public.feedback(author_id);
create index if not exists feedback_created_at_idx    on public.feedback(created_at desc);
create index if not exists feedback_upvote_count_idx  on public.feedback(upvote_count desc);

alter table public.feedback enable row level security;

drop policy if exists feedback_select_all on public.feedback;
create policy feedback_select_all on public.feedback
  for select using (auth.role() = 'authenticated');

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert with check (auth.uid() = author_id);

drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback
  for update using (
    public.is_admin(auth.uid())
    or (auth.uid() = author_id and created_at > now() - interval '1 hour')
  );

drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- updated_at trigger + status_history append
create or replace function public.feedback_before_update()
returns trigger language plpgsql as $$
declare
  by_nick text;
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    select coalesce(p.username, '') into by_nick from public.profiles p where p.id = auth.uid();
    new.status_history := coalesce(old.status_history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'status',       new.status,
        'at',           to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'by',           auth.uid(),
        'by_nickname',  by_nick
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_before_update_trg on public.feedback;
create trigger feedback_before_update_trg
  before update on public.feedback
  for each row execute function public.feedback_before_update();

-- ───────────────────────────────────────────────────────────────────
-- 2. feedback_upvote
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.feedback_upvote (
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

create index if not exists feedback_upvote_user_idx on public.feedback_upvote(user_id);

alter table public.feedback_upvote enable row level security;

drop policy if exists feedback_upvote_select on public.feedback_upvote;
create policy feedback_upvote_select on public.feedback_upvote
  for select using (auth.role() = 'authenticated');

drop policy if exists feedback_upvote_insert on public.feedback_upvote;
create policy feedback_upvote_insert on public.feedback_upvote
  for insert with check (auth.uid() = user_id);

drop policy if exists feedback_upvote_delete on public.feedback_upvote;
create policy feedback_upvote_delete on public.feedback_upvote
  for delete using (auth.uid() = user_id);

create or replace function public.feedback_upvote_count_sync()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback set upvote_count = upvote_count + 1 where id = new.feedback_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.feedback set upvote_count = greatest(upvote_count - 1, 0) where id = old.feedback_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists feedback_upvote_count_trg on public.feedback_upvote;
create trigger feedback_upvote_count_trg
  after insert or delete on public.feedback_upvote
  for each row execute function public.feedback_upvote_count_sync();

-- ───────────────────────────────────────────────────────────────────
-- 3. feedback_comment
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.feedback_comment (
  id                uuid primary key default gen_random_uuid(),
  feedback_id       uuid not null references public.feedback(id) on delete cascade,
  author_id         uuid not null references auth.users(id) on delete cascade,
  author_nickname   text not null,
  is_admin_comment  boolean not null default false,
  body              text not null check (char_length(body) <= 500 and char_length(body) > 0),
  like_count        int not null default 0,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz
);

create index if not exists feedback_comment_feedback_idx on public.feedback_comment(feedback_id, created_at);

alter table public.feedback_comment enable row level security;

drop policy if exists feedback_comment_select on public.feedback_comment;
create policy feedback_comment_select on public.feedback_comment
  for select using (auth.role() = 'authenticated');

drop policy if exists feedback_comment_insert on public.feedback_comment;
create policy feedback_comment_insert on public.feedback_comment
  for insert with check (auth.uid() = author_id);

drop policy if exists feedback_comment_update on public.feedback_comment;
create policy feedback_comment_update on public.feedback_comment
  for update using (auth.uid() = author_id or public.is_admin(auth.uid()));

drop policy if exists feedback_comment_delete on public.feedback_comment;
create policy feedback_comment_delete on public.feedback_comment
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

create or replace function public.feedback_comment_count_sync()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback set comment_count = comment_count + 1 where id = new.feedback_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.feedback set comment_count = greatest(comment_count - 1, 0) where id = old.feedback_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists feedback_comment_count_trg on public.feedback_comment;
create trigger feedback_comment_count_trg
  after insert or delete on public.feedback_comment
  for each row execute function public.feedback_comment_count_sync();

create or replace function public.feedback_comment_before_update()
returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_comment_before_update_trg on public.feedback_comment;
create trigger feedback_comment_before_update_trg
  before update on public.feedback_comment
  for each row execute function public.feedback_comment_before_update();

-- ───────────────────────────────────────────────────────────────────
-- 4. feedback_comment_like
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.feedback_comment_like (
  comment_id  uuid not null references public.feedback_comment(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.feedback_comment_like enable row level security;

drop policy if exists feedback_comment_like_select on public.feedback_comment_like;
create policy feedback_comment_like_select on public.feedback_comment_like
  for select using (auth.role() = 'authenticated');

drop policy if exists feedback_comment_like_insert on public.feedback_comment_like;
create policy feedback_comment_like_insert on public.feedback_comment_like
  for insert with check (auth.uid() = user_id);

drop policy if exists feedback_comment_like_delete on public.feedback_comment_like;
create policy feedback_comment_like_delete on public.feedback_comment_like
  for delete using (auth.uid() = user_id);

create or replace function public.feedback_comment_like_count_sync()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback_comment set like_count = like_count + 1 where id = new.comment_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.feedback_comment set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists feedback_comment_like_count_trg on public.feedback_comment_like;
create trigger feedback_comment_like_count_trg
  after insert or delete on public.feedback_comment_like
  for each row execute function public.feedback_comment_like_count_sync();

-- ───────────────────────────────────────────────────────────────────
-- 5. Storage bucket  feedback-screenshots
-- ───────────────────────────────────────────────────────────────────
-- À créer manuellement dans Supabase → Storage → New bucket
--    Name: feedback-screenshots   |   Public: ON
-- Puis exécuter ces policies :

drop policy if exists feedback_screenshots_public_read on storage.objects;
create policy feedback_screenshots_public_read on storage.objects
  for select using (bucket_id = 'feedback-screenshots');

drop policy if exists feedback_screenshots_upload on storage.objects;
create policy feedback_screenshots_upload on storage.objects
  for insert with check (
    bucket_id = 'feedback-screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists feedback_screenshots_update on storage.objects;
create policy feedback_screenshots_update on storage.objects
  for update using (
    bucket_id = 'feedback-screenshots'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin(auth.uid()))
  );

drop policy if exists feedback_screenshots_delete on storage.objects;
create policy feedback_screenshots_delete on storage.objects
  for delete using (
    bucket_id = 'feedback-screenshots'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin(auth.uid()))
  );
