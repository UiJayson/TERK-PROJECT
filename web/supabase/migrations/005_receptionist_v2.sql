-- Milestone 5: Receptionist v2 — calendar, notifications, conversation escalation

CREATE TABLE IF NOT EXISTS availability_slots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT false,
  customer_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_slots_workspace_date
  ON availability_slots(workspace_id, slot_date, start_time);

CREATE INDEX IF NOT EXISTS idx_availability_slots_reminder
  ON availability_slots(workspace_id, is_booked, reminder_sent, slot_date, start_time)
  WHERE is_booked = true AND reminder_sent = false;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'logged',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_workspace
  ON admin_notifications(workspace_id, created_at DESC);

ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_slots_isolation ON availability_slots
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY admin_notifications_isolation ON admin_notifications
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
