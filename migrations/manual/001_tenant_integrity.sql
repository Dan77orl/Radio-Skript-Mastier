-- Tenant integrity hardening — APPLY MANUALLY, NOT VIA drizzle-kit.
--
-- Why this is not a generated migration: it can fail on real data (orphan rows,
-- dangling references). Work through it step by step and inspect the counts in
-- step 1 before running anything below it. Take a backup first.
--
--   psql "$DATABASE_URL" -f migrations/manual/001_tenant_integrity.sql
--
-- Background: every tenant table has a nullable user_id, and programs /
-- host_shifts / news_items / automation_runs reference their parent by a bare
-- varchar with no foreign key. That is what produced the orphan-program repair
-- loop the server used to run on every boot.

-- ---------------------------------------------------------------------------
-- Step 1 — inspect. Run this alone first; it changes nothing.
-- ---------------------------------------------------------------------------

SELECT 'programs.user_id IS NULL'        AS problem, count(*) FROM programs           WHERE user_id IS NULL
UNION ALL SELECT 'dialogs.user_id IS NULL',           count(*) FROM dialogs            WHERE user_id IS NULL
UNION ALL SELECT 'ads.user_id IS NULL',               count(*) FROM ads                WHERE user_id IS NULL
UNION ALL SELECT 'voices.user_id IS NULL',            count(*) FROM voices             WHERE user_id IS NULL
UNION ALL SELECT 'program_types.user_id IS NULL',     count(*) FROM program_types      WHERE user_id IS NULL
UNION ALL SELECT 'settings.user_id IS NULL',          count(*) FROM settings           WHERE user_id IS NULL
UNION ALL SELECT 'programs -> missing program_type',  count(*) FROM programs p
    WHERE p.program_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM program_types t WHERE t.id = p.program_type_id)
UNION ALL SELECT 'host_shifts -> missing template',   count(*) FROM host_shifts h
    WHERE NOT EXISTS (SELECT 1 FROM schedule_templates s WHERE s.id = h.template_id)
UNION ALL SELECT 'news_items -> missing source',      count(*) FROM news_items n
    WHERE NOT EXISTS (SELECT 1 FROM news_sources s WHERE s.id = n.source_id)
UNION ALL SELECT 'automation_runs -> missing automation', count(*) FROM automation_runs r
    WHERE NOT EXISTS (SELECT 1 FROM automations a WHERE a.id = r.automation_id);

-- ---------------------------------------------------------------------------
-- Step 2 — repair what can be repaired: adopt orphan programs from their type.
-- This is the same fix the server used to run on every boot.
-- ---------------------------------------------------------------------------

UPDATE programs p
SET user_id = t.user_id
FROM program_types t
WHERE p.program_type_id = t.id
  AND p.user_id IS NULL
  AND t.user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 3 — DESTRUCTIVE. Only after reviewing step 1 again.
-- Rows still lacking an owner or a parent cannot be attributed to a tenant and
-- are unreachable through the API. Uncomment deliberately.
-- ---------------------------------------------------------------------------

-- DELETE FROM programs        WHERE user_id IS NULL;
-- DELETE FROM dialogs         WHERE user_id IS NULL;
-- DELETE FROM ads             WHERE user_id IS NULL;
-- DELETE FROM voices          WHERE user_id IS NULL;
-- DELETE FROM program_types   WHERE user_id IS NULL;
-- DELETE FROM settings        WHERE user_id IS NULL;
-- DELETE FROM host_shifts h    WHERE NOT EXISTS (SELECT 1 FROM schedule_templates s WHERE s.id = h.template_id);
-- DELETE FROM news_items n     WHERE NOT EXISTS (SELECT 1 FROM news_sources s WHERE s.id = n.source_id);
-- DELETE FROM automation_runs r WHERE NOT EXISTS (SELECT 1 FROM automations a WHERE a.id = r.automation_id);
-- DELETE FROM programs p       WHERE p.program_type_id IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM program_types t WHERE t.id = p.program_type_id);

-- ---------------------------------------------------------------------------
-- Step 4 — referential integrity. Fails if step 3 was skipped and dangling
-- references remain; that failure is the point.
-- ---------------------------------------------------------------------------

ALTER TABLE programs        ADD CONSTRAINT programs_program_type_id_fk
    FOREIGN KEY (program_type_id) REFERENCES program_types(id) ON DELETE CASCADE;
ALTER TABLE host_shifts     ADD CONSTRAINT host_shifts_template_id_fk
    FOREIGN KEY (template_id) REFERENCES schedule_templates(id) ON DELETE CASCADE;
ALTER TABLE news_items      ADD CONSTRAINT news_items_source_id_fk
    FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE CASCADE;
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_automation_id_fk
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Step 5 — make tenant ownership mandatory, so a row can never again exist
-- without an owner.
-- ---------------------------------------------------------------------------

ALTER TABLE settings           ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE dialogs            ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE news_sources       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE prompt_templates   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE ads                ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE ad_presets         ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE voices             ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE program_types      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE programs           ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE automations        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE schedule_templates ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE host_shifts        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE custom_holidays    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE news_items         ALTER COLUMN user_id SET NOT NULL;

-- Deliberately left nullable:
--   usage_logs.user_id, support_messages.user_id — support chat is reachable
--   without an account, so these legitimately carry NULL.
