-- Check what's causing the email column to be masked

-- 1. Check what disabled_sensitivity_rules are set for this agent
SELECT
    id,
    name,
    disabled_sensitivity_rules
FROM agents
WHERE id = 'YOUR_AGENT_ID_HERE';  -- Replace with your actual agent ID

-- 2. Check all global sensitivity rules (especially for email)
SELECT
    id,
    pattern_type,
    pattern_value,
    pattern_regex,
    sensitivity_level,
    masking_strategy,
    description,
    is_active
FROM sensitive_field_registry_global
WHERE is_active = true
ORDER BY created_at;

-- 3. Check if the EMAIL column is marked as sensitive in the schema
SELECT
    ac.column_name,
    ac.is_sensitive,
    ac.sensitivity_override,
    ac.masking_strategy_override,
    at.table_name,
    a.name as agent_name
FROM agent_columns ac
JOIN agent_tables at ON ac.table_id = at.id
JOIN agents a ON at.agent_id = a.id
WHERE LOWER(ac.column_name) = 'email'
  AND a.id = 'YOUR_AGENT_ID_HERE';  -- Replace with your actual agent ID

-- 4. Check agent-specific sensitivity rules for this agent
SELECT
    id,
    pattern_type,
    pattern_value,
    pattern_regex,
    sensitivity_level,
    masking_strategy,
    description,
    is_active
FROM sensitive_field_registry_agent
WHERE agent_id = 'YOUR_AGENT_ID_HERE'  -- Replace with your actual agent ID
  AND is_active = true;

-- 5. BONUS: Check what rules are NOT disabled (should be applied)
WITH agent_info AS (
    SELECT
        id,
        disabled_sensitivity_rules
    FROM agents
    WHERE id = 'YOUR_AGENT_ID_HERE'  -- Replace with your actual agent ID
)
SELECT
    g.id,
    g.pattern_value,
    g.masking_strategy,
    g.description,
    CASE
        WHEN g.id::text = ANY(a.disabled_sensitivity_rules) THEN 'DISABLED ❌'
        ELSE 'ACTIVE ✅'
    END as status
FROM sensitive_field_registry_global g
CROSS JOIN agent_info a
WHERE g.is_active = true
ORDER BY status, g.pattern_value;
