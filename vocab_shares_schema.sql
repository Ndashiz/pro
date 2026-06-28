-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Vocab Shares : envoi direct de listes de vocabulaire
-- entre membres LazyPO. À exécuter une fois dans Supabase SQL Editor.
-- ───────────────────────────────────────────────────────────────────
-- Flow :
--   1. L'émetteur insert une row (sender_id = lui, recipient_id = cible,
--      payload = { v, words: [...] }) — status par défaut 'pending'.
--   2. Le destinataire voit un popup "A player has shared vocabulary
--      with you" lors de sa prochaine visite sur quiz.html.
--   3. Accepter → ouvre la modal d'import existante. Refuser → status
--      passe à 'declined'. Une fois importé → status 'accepted'.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.vocab_shares (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  sender_name   text not null,
  payload       jsonb not null,
  status        text not null default 'pending'
                  check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint vocab_shares_no_self check (sender_id <> recipient_id)
);

create index if not exists vocab_shares_recipient_status_idx
  on public.vocab_shares(recipient_id, status, created_at desc);

create index if not exists vocab_shares_sender_idx
  on public.vocab_shares(sender_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────
alter table public.vocab_shares enable row level security;

drop policy if exists vocab_shares_sender_insert on public.vocab_shares;
create policy vocab_shares_sender_insert on public.vocab_shares
  for insert with check (auth.uid() = sender_id);

-- Sender can see their own outgoing shares (utile pour l'historique côté UI)
drop policy if exists vocab_shares_sender_select on public.vocab_shares;
create policy vocab_shares_sender_select on public.vocab_shares
  for select using (auth.uid() = sender_id);

-- Recipient peut voir et mettre à jour ses partages entrants (accept/decline)
drop policy if exists vocab_shares_recipient_select on public.vocab_shares;
create policy vocab_shares_recipient_select on public.vocab_shares
  for select using (auth.uid() = recipient_id);

drop policy if exists vocab_shares_recipient_update on public.vocab_shares;
create policy vocab_shares_recipient_update on public.vocab_shares
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- ───────────────────────────────────────────────────────────────────
-- Trigger : auto-set responded_at when status changes from 'pending'
-- ───────────────────────────────────────────────────────────────────
create or replace function public.vocab_shares_before_update()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and old.status = 'pending' then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vocab_shares_before_update on public.vocab_shares;
create trigger trg_vocab_shares_before_update
  before update on public.vocab_shares
  for each row execute function public.vocab_shares_before_update();

comment on table public.vocab_shares is
  'Envois directs de listes de vocabulaire entre membres LazyPO. payload: {v, words:[{s,t,l,e?,p?},...]}.';
