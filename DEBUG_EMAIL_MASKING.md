# Debug: Email Column Still Being Masked

## Issue
Even though the email sensitivity rule has been disabled for an agent, the EMAIL column is still showing as `***REDACTED***`.

## Debug Steps

### Step 1: Check Database Configuration

Run the queries in `CHECK_EMAIL_SENSITIVITY.sql` (replace `YOUR_AGENT_ID_HERE` with your actual agent ID):

```bash
psql $DATABASE_URL -f CHECK_EMAIL_SENSITIVITY.sql
```

### Step 2: Identify the Masking Source

There are **4 possible sources** of masking (in priority order):

#### 1. **Schema-Based Sensitivity** (HIGHEST PRIORITY) ⚠️
- The EMAIL column might be marked as `is_sensitive=true` in the `agent_columns` table
- This is separate from pattern-based rules and **NOT affected** by `disabled_sensitivity_rules`
- Check query #3 in the SQL file

**If this is the issue:**
```sql
-- Disable schema-based sensitivity for the email column
UPDATE agent_columns
SET is_sensitive = false,
    sensitivity_override = NULL,
    masking_strategy_override = NULL
WHERE column_name = 'email'
  AND table_id IN (
      SELECT id FROM agent_tables
      WHERE agent_id = 'YOUR_AGENT_ID_HERE'
  );
```

#### 2. **Pattern-Based Global Rules**
- Global sensitivity rules with pattern matching (e.g., pattern_value="email")
- These **ARE affected** by `disabled_sensitivity_rules`
- Check query #2 and #5 in the SQL file

**If this is the issue and the rule is NOT disabled:**
```sql
-- Add the rule ID to disabled_sensitivity_rules
UPDATE agents
SET disabled_sensitivity_rules = array_append(disabled_sensitivity_rules, 'RULE_UUID_HERE')
WHERE id = 'YOUR_AGENT_ID_HERE';
```

#### 3. **Pattern-Based Agent Rules**
- Agent-specific sensitivity rules
- These are **NOT affected** by `disabled_sensitivity_rules` (only global rules can be disabled)
- Check query #4 in the SQL file

**If this is the issue:**
```sql
-- Deactivate the agent-specific rule
UPDATE sensitive_field_registry_agent
SET is_active = false
WHERE agent_id = 'YOUR_AGENT_ID_HERE'
  AND pattern_value ILIKE '%email%';
```

#### 4. **Keyword-Based Fallback** (LOWEST PRIORITY)
- Hardcoded keywords in code: `["password", "passwd", "pwd", "secret", "token", "key", ...]`
- "email" is **NOT** in this list, so this shouldn't be the issue

### Step 3: Clear Cache and Restart Service

The sensitivity configuration is cached for 5 minutes. You need to:

#### Option A: Wait for cache to expire (5 minutes)

#### Option B: Restart the service to clear cache immediately

```bash
# If using Docker:
docker-compose restart ai-runtime

# Or if running directly:
# Find the process
ps aux | grep "uvicorn main:socket_app"
# Kill and restart (or use systemctl if configured)
```

### Step 4: Test with Debug Logging

After restarting, send a test query via `/query/execute`. The logs will now show:

```log
🔍 [DEBUG] Sensitivity config loaded for /query/execute
  agent_id=...
  global_rules_count=5
  agent_rules_count=2
  forbidden_count=0
  global_rules=[...]

🔍 [DEBUG] Checking masking for column
  column=email
  schema_rules_count=0
  global_rules_count=5
  agent_rules_count=2

🔍 [DEBUG] Column matched SCHEMA-BASED rule
  column=email
  matched_rule={...}
  strategy=full

OR

🔍 [DEBUG] Column matched PATTERN-BASED rule (keyword)
  column=email
  rule_id=...
  pattern_value=email
  strategy=full
```

This will tell you **exactly** which rule is causing the masking.

### Step 5: Check the Logs

```bash
# View ai-runtime logs
docker-compose logs -f ai-runtime

# Or if running directly:
tail -f ai-runtime/logs/*.log | grep "DEBUG"
```

## Common Issues

### Issue 1: Service Not Restarted
**Symptom**: Changes to `disabled_sensitivity_rules` not taking effect
**Fix**: Restart ai-runtime service

### Issue 2: Cache Not Cleared
**Symptom**: Old rules still being applied
**Fix**: Wait 5 minutes or restart service

### Issue 3: Schema-Based Sensitivity
**Symptom**: Email column marked as sensitive in schema metadata
**Fix**: Update `agent_columns` table to set `is_sensitive=false`

### Issue 4: Wrong Rule Disabled
**Symptom**: Disabled the wrong rule ID
**Fix**: Check query #5 to see which rules are active/disabled, update with correct ID

### Issue 5: Agent-Specific Rule
**Symptom**: There's an agent-specific email rule (not affected by disabled global rules)
**Fix**: Deactivate the agent-specific rule directly

## Quick Diagnosis

Run this single query to get all information:

```sql
WITH agent_info AS (
    SELECT
        a.id,
        a.name,
        a.disabled_sensitivity_rules,
        array_length(a.disabled_sensitivity_rules, 1) as disabled_count
    FROM agents a
    WHERE a.id = 'YOUR_AGENT_ID_HERE'
)
SELECT
    'Agent Info' as source,
    ai.name,
    ai.disabled_count,
    ai.disabled_sensitivity_rules::text as data
FROM agent_info ai

UNION ALL

SELECT
    'Global Rules' as source,
    g.pattern_value as name,
    NULL as disabled_count,
    CASE WHEN g.id::text = ANY(ai.disabled_sensitivity_rules) THEN '❌ DISABLED' ELSE '✅ ACTIVE' END as data
FROM sensitive_field_registry_global g
CROSS JOIN agent_info ai
WHERE g.is_active = true
  AND g.pattern_value ILIKE '%email%'

UNION ALL

SELECT
    'Agent Rules' as source,
    ar.pattern_value as name,
    NULL as disabled_count,
    '✅ ACTIVE (agent-specific)' as data
FROM sensitive_field_registry_agent ar
CROSS JOIN agent_info ai
WHERE ar.agent_id = ai.id
  AND ar.is_active = true
  AND ar.pattern_value ILIKE '%email%'

UNION ALL

SELECT
    'Schema Columns' as source,
    ac.column_name as name,
    NULL as disabled_count,
    CASE WHEN ac.is_sensitive THEN '✅ MARKED SENSITIVE' ELSE '❌ NOT SENSITIVE' END as data
FROM agent_columns ac
JOIN agent_tables at ON ac.table_id = at.id
CROSS JOIN agent_info ai
WHERE at.agent_id = ai.id
  AND LOWER(ac.column_name) = 'email';
```

This will show you exactly what's configured and what's causing the masking.
