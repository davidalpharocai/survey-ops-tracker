-- Occam onboarding gate. An external client contact must have an Occam account
-- (welcome email sent + able to sign in) before they can view delivered data. We
-- track that per contact so the delivery gate can prompt the internal user to
-- confirm the invite went out the FIRST time we deliver to a given requested-by
-- contact — and never re-nag once confirmed.
alter table public.client_contacts
  add column if not exists occam_invited boolean not null default false,
  add column if not exists occam_invited_at timestamptz,
  add column if not exists occam_invited_by text;

comment on column public.client_contacts.occam_invited is
  'True once the internal team has confirmed the Occam account invite (welcome email) was sent to this contact. Gates first delivery.';
