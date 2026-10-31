-- Chit fund member details (NIC, address, photos) and the optional guarantor (NIC + phone).
-- Same as the matching steps in scripts/migrate.js, for running in the Neon SQL Editor
-- of the SABESH CAPITAL project. Safe to run more than once.
-- Adding a chit member fails with "relation ticket_member_details does not exist" until this has been run.

CREATE TABLE IF NOT EXISTS ticket_member_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  member_id uuid NOT NULL UNIQUE REFERENCES ticket_members(id) ON DELETE CASCADE,
  nic_number varchar(20) NOT NULL,
  address text NOT NULL,
  nic_photo_urls jsonb,
  photo_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_member_details_ticket_id_idx ON ticket_member_details (ticket_id);

CREATE TABLE IF NOT EXISTS ticket_member_guarantors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  member_id uuid NOT NULL UNIQUE REFERENCES ticket_members(id) ON DELETE CASCADE,
  nic_number varchar(20) NOT NULL,
  phone varchar(30) NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_member_guarantors_ticket_id_idx ON ticket_member_guarantors (ticket_id);

-- An older version of the guarantor table also asked for a name and address; they are no longer required.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_member_guarantors' AND column_name = 'full_name') THEN
    ALTER TABLE ticket_member_guarantors ALTER COLUMN full_name DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_member_guarantors' AND column_name = 'address') THEN
    ALTER TABLE ticket_member_guarantors ALTER COLUMN address DROP NOT NULL;
  END IF;
END $$;
