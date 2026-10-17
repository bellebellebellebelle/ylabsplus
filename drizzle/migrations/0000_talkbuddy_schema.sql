CREATE TABLE public.odoo_connections (
  user_id uuid PRIMARY KEY, url text NOT NULL, db text NOT NULL, username text NOT NULL, api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  uid integer, status text NOT NULL DEFAULT 'unknown', status_message text, modules jsonb NOT NULL DEFAULT '{}'::jsonb, last_tested_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odoo_connections TO authenticated;
GRANT ALL ON public.odoo_connections TO service_role;
ALTER TABLE public.odoo_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own odoo" ON public.odoo_connections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  role text NOT NULL, content text NOT NULL, board jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX messages_user_created ON public.messages(user_id, created_at);

CREATE TABLE public.ideas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), title text NOT NULL, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ideas TO authenticated;
GRANT ALL ON public.ideas TO service_role;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own ideas" ON public.ideas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ideas_owner_idx ON public.ideas(user_id, created_at DESC);

CREATE TABLE public.lab_activity (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), kind text NOT NULL, app_key text, seconds_saved integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.lab_activity TO authenticated;
GRANT ALL ON public.lab_activity TO service_role;
ALTER TABLE public.lab_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own activity" ON public.lab_activity FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Add own activity" ON public.lab_activity FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX activity_owner_idx ON public.lab_activity(user_id, created_at DESC);

CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL DEFAULT 'Réunion', meeting_date timestamptz NOT NULL DEFAULT now(), duration_min integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'Général', transcript text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '',
  participants jsonb NOT NULL DEFAULT '[]'::jsonb, topics jsonb NOT NULL DEFAULT '[]'::jsonb, decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb, risks jsonb NOT NULL DEFAULT '[]'::jsonb, next_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  sentiment text NOT NULL DEFAULT 'neutre', score_efficiency integer NOT NULL DEFAULT 0, score_clarity integer NOT NULL DEFAULT 0,
  score_engagement integer NOT NULL DEFAULT 0, score_decision integer NOT NULL DEFAULT 0, score_global integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.meetings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.meetings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.meetings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.meetings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX meetings_user_date ON public.meetings(user_id, meeting_date DESC);
ALTER TABLE public.meetings REPLICA IDENTITY FULL;

CREATE TABLE public.angelo_settings (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  agent_name text NOT NULL DEFAULT 'ANGELO', tone text NOT NULL DEFAULT 'professionnel', language text NOT NULL DEFAULT 'fr',
  company_name text, signature text NOT NULL DEFAULT 'Le service recouvrement',
  legal_text text NOT NULL DEFAULT 'Conformément aux conditions générales de vente acceptées lors de la commande et aux articles L441-10 et L441-6 du Code de commerce, tout retard de paiement entraîne de plein droit des pénalités de retard ainsi qu''une indemnité forfaitaire pour frais de recouvrement de 40 euros.',
  extra_instructions text NOT NULL DEFAULT '', min_amount numeric NOT NULL DEFAULT 0, attach_pdf boolean NOT NULL DEFAULT true,
  cc_emails text NOT NULL DEFAULT '', excluded_partners text NOT NULL DEFAULT '', min_days_between_reminders integer NOT NULL DEFAULT 7,
  auto_send boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.angelo_settings TO authenticated;
GRANT ALL ON public.angelo_settings TO service_role;
ALTER TABLE public.angelo_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings all" ON public.angelo_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  level integer NOT NULL, days_overdue integer NOT NULL, firmness text NOT NULL DEFAULT 'courtois', instructions text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, level)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_rules TO authenticated;
GRANT ALL ON public.reminder_rules TO service_role;
ALTER TABLE public.reminder_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rules all" ON public.reminder_rules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.invoices_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  odoo_id integer NOT NULL, name text NOT NULL, partner_id integer, partner_name text, partner_email text,
  amount_total numeric NOT NULL DEFAULT 0, amount_residual numeric NOT NULL DEFAULT 0, currency text,
  invoice_date date, due_date date, payment_state text, sale_orders text,
  reminder_count integer NOT NULL DEFAULT 0, last_reminder_at timestamptz, last_reminder_level integer,
  synced_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, odoo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices_cache TO authenticated;
GRANT ALL ON public.invoices_cache TO service_role;
ALTER TABLE public.invoices_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own invoices all" ON public.invoices_cache FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  invoice_odoo_id integer, invoice_name text, partner_name text, partner_email text,
  level integer, subject text, body text, amount_residual numeric, days_overdue integer,
  status text NOT NULL DEFAULT 'sent', error text, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_logs TO authenticated;
GRANT ALL ON public.reminder_logs TO service_role;
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reminder logs all" ON public.reminder_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  trigger text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'running',
  invoices_found integer NOT NULL DEFAULT 0, overdue_found integer NOT NULL DEFAULT 0,
  reminders_sent integer NOT NULL DEFAULT 0, message text,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_logs TO authenticated;
GRANT ALL ON public.run_logs TO service_role;
ALTER TABLE public.run_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own run logs all" ON public.run_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.schedules (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  enabled boolean NOT NULL DEFAULT false, frequency text NOT NULL DEFAULT 'daily',
  hour_utc integer NOT NULL DEFAULT 8, weekday integer NOT NULL DEFAULT 1, day_of_month integer NOT NULL DEFAULT 1,
  interval_minutes integer NOT NULL DEFAULT 60, minute_utc integer NOT NULL DEFAULT 0,
  last_run_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;
GRANT ALL ON public.schedules TO service_role;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own schedule all" ON public.schedules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.cron_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(),
  trigger text NOT NULL DEFAULT 'cron', status text NOT NULL DEFAULT 'skipped', reason text, frequency text,
  invoices_found integer NOT NULL DEFAULT 0, overdue_found integer NOT NULL DEFAULT 0,
  reminders_sent integer NOT NULL DEFAULT 0, duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_logs TO authenticated;
GRANT ALL ON public.cron_logs TO service_role;
ALTER TABLE public.cron_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cron logs all" ON public.cron_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX cron_logs_user_created_idx ON public.cron_logs (user_id, created_at DESC);

CREATE TABLE public.cron_tokens (id integer PRIMARY KEY DEFAULT 1, token text NOT NULL);
GRANT ALL ON public.cron_tokens TO service_role;
ALTER TABLE public.cron_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.angelo_init_user(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.angelo_settings (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;
  INSERT INTO public.schedules (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;
  INSERT INTO public.reminder_rules (user_id, level, days_overdue, firmness, instructions) VALUES
    (_uid, 1, 1, 'courtois', 'Rappel courtois : la facture est arrivée à échéance, inviter au règlement rapide.'),
    (_uid, 2, 15, 'ferme', 'Relance ferme : rappeler les conditions générales de vente et les pénalités de retard.'),
    (_uid, 3, 30, 'mise_en_demeure', 'Dernière relance avant mise en demeure : rappeler la législation applicable et les suites possibles.')
  ON CONFLICT DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.angelo_init_user(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.angelo_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.angelo_init_user(NEW.id); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.angelo_handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created_angelo AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.angelo_handle_new_user();

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages, public.ideas, public.lab_activity, public.meetings, public.run_logs, public.reminder_logs, public.invoices_cache, public.cron_logs;

CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT, display_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.gmail_credentials (
  user_id UUID NOT NULL PRIMARY KEY,
  google_email TEXT, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.gmail_credentials TO service_role;
GRANT SELECT (user_id, google_email, expires_at, updated_at, scopes) ON public.gmail_credentials TO authenticated;
ALTER TABLE public.gmail_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self read status" ON public.gmail_credentials FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE VIEW public.gmail_connection_status WITH (security_invoker = true) AS
  SELECT user_id, google_email, expires_at, updated_at, scopes FROM public.gmail_credentials;
GRANT SELECT ON public.gmail_connection_status TO authenticated;

CREATE TABLE public.google_chat_links (
  space_id TEXT NOT NULL PRIMARY KEY, user_id UUID NOT NULL, display_name TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.google_chat_links TO authenticated;
GRANT ALL ON public.google_chat_links TO service_role;
ALTER TABLE public.google_chat_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self read links" ON public.google_chat_links FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "self delete links" ON public.google_chat_links FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.chat_link_codes (
  code TEXT NOT NULL PRIMARY KEY, user_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.chat_link_codes TO authenticated;
GRANT ALL ON public.chat_link_codes TO service_role;
ALTER TABLE public.chat_link_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self codes" ON public.chat_link_codes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.chat_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_threads TO authenticated;
GRANT ALL ON public.chat_threads TO service_role;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self threads" ON public.chat_threads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, role TEXT NOT NULL, parts JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_thread_idx ON public.chat_messages(thread_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self messages" ON public.chat_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Nouvelle conversation',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_conversations TO authenticated;
GRANT ALL ON public.agent_conversations TO service_role;
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self agent_conversations" ON public.agent_conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, role text NOT NULL, parts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self agent_messages" ON public.agent_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_agent_messages_conv ON public.agent_messages(conversation_id, created_at);

CREATE TABLE public.agent_actions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  tool_name text NOT NULL, args jsonb, result jsonb,
  status text NOT NULL DEFAULT 'success', source text NOT NULL DEFAULT 'web',
  task_id uuid, stage text NOT NULL DEFAULT 'execution', attempt integer NOT NULL DEFAULT 1,
  plan jsonb, verification_url text, error_detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_actions_log TO authenticated;
GRANT ALL ON public.agent_actions_log TO service_role;
ALTER TABLE public.agent_actions_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self agent_actions_log" ON public.agent_actions_log FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX agent_actions_log_user_created_idx ON public.agent_actions_log (user_id, created_at DESC);
CREATE INDEX agent_actions_log_task_idx ON public.agent_actions_log (task_id, created_at ASC) WHERE task_id IS NOT NULL;

CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'Indian/Reunion',
  chat_memory_size INTEGER NOT NULL DEFAULT 20,
  ai_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  email_greeting text NOT NULL DEFAULT 'Bonjour',
  email_signature text NOT NULL DEFAULT '',
  email_tone text NOT NULL DEFAULT 'professionnel',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings own" ON public.user_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.google_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), space_id TEXT NOT NULL, user_id UUID NOT NULL,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gchat_msg_space_idx ON public.google_chat_messages(space_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_chat_messages TO authenticated;
GRANT ALL ON public.google_chat_messages TO service_role;
ALTER TABLE public.google_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gchat msgs own" ON public.google_chat_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_actions_log, public.agent_messages;