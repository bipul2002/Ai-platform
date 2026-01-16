"""
PostgreSQL specific prompt sections and templates.
"""

# ============================================================================
# SYNTAX RULES
# ============================================================================

POSTGRESQL_DATE_TIME_SYNTAX = """
## Date/Time Functions (PostgreSQL)

- Current date: `CURRENT_DATE`
- Current timestamp: `NOW()`
- Date arithmetic: `NOW() - INTERVAL '7 days'`, `NOW() - INTERVAL '1 month'`
- Date formatting: `TO_CHAR(col, 'YYYY-MM-DD')`
- Extract year: `EXTRACT(YEAR FROM col)`
- Extract month: `EXTRACT(MONTH FROM col)`
- Date difference: `date1 - date2` (returns interval)
- Date truncation: `DATE_TRUNC('month', col)`

**Examples:**
```sql
-- Last 7 days
WHERE created_at >= NOW() - INTERVAL '7 days'

-- This month
WHERE created_at >= DATE_TRUNC('month', NOW())

-- Year extraction
SELECT EXTRACT(YEAR FROM order_date) AS order_year, COUNT(*) FROM orders GROUP BY order_year
```
"""

POSTGRESQL_STRING_FUNCTIONS = """
## String Functions (PostgreSQL)

- Concatenation: `col1 || ' ' || col2` (preferred) or `CONCAT(col1, ' ', col2)`
- Lowercase: `LOWER(col)`
- Uppercase: `UPPER(col)`
- Substring: `SUBSTRING(col FROM start FOR length)`
- String length: `LENGTH(col)`
- Trim: `TRIM(col)`
- Replace: `REPLACE(col, 'old', 'new')`
- Case-sensitive search: `LIKE`
- Case-insensitive search: `ILIKE`

**Examples:**
```sql
-- Concatenate (PostgreSQL style)
SELECT first_name || ' ' || last_name AS full_name FROM users

-- Case-insensitive search
WHERE name ILIKE '%search%'
```
"""

POSTGRESQL_GROUP_BY_RULES = """
## GROUP BY Rules (PostgreSQL - Flexible)

**PostgreSQL supports functional dependency optimization**

- If grouping by Primary Key, other columns from the same table can be omitted from GROUP BY
- However, for cross-database compatibility, it's safer to include all columns
- **CASE expressions**: Columns used inside CASE should still be in GROUP BY for clarity

**Example (PostgreSQL-specific optimization):**
```sql
-- ✅ VALID in PostgreSQL (if s.id is Primary Key):
SELECT s.id, s.name, s.email, COUNT(o.id) 
FROM suppliers s 
GROUP BY s.id  -- Other columns omitted due to functional dependency

-- ✅ ALSO VALID (more explicit, cross-compatible):
SELECT s.id, s.name, s.email, COUNT(o.id) 
FROM suppliers s 
GROUP BY s.id, s.name, s.email
```

**Recommendation**: For consistency with MySQL, include all non-aggregated columns in GROUP BY.
"""

POSTGRESQL_BOOLEAN_SYNTAX = """
## Boolean Values (PostgreSQL)

- Use `TRUE` / `FALSE` (strict)
- **NEVER** use `1` / `0` or `'t'` / `'f'` or `'true'` / `'false'` strings

**Example:**
```sql
WHERE is_active = TRUE
WHERE is_deleted = FALSE
```
"""

# ============================================================================
# QUERY BUILDER PROMPTS
# ============================================================================

POSTGRESQL_QUERY_BUILDER_PROMPT = """You are an expert PostgreSQL engineer. Generate precise, optimized PostgreSQL queries.

## INPUTS
- Schema Context: {schema_context}
- Restricted Entities: {restricted_entities}
- SQL Dialect: PostgreSQL
- Current Date: {current_date}
- Chat History: {chat_history}
- Is Direct SQL: {is_direct_sql}

**From Intent Analysis:**
- Intent Summary: {intent_summary}
- Is Refinement: {is_refinement}
- Base Query to Modify: {base_query_to_modify}
- Changes Requested: {changes}
- Required Tables: {required_tables}
- Extracted Timeframe: {extracted_timeframe}
- Assumptions Made: {assumptions_made}

---

## PRIMARY OBJECTIVE

Generate a complete, executable SQL query in `generated_sql` that exactly matches the user's intent.

**The `generated_sql` field is the MOST IMPORTANT output.**

---

## DIALECT-SPECIFIC SYNTAX (PostgreSQL)

{date_time_syntax}

{string_functions}

{boolean_syntax}

### 4. Aggregation Rules

{group_by_rules}
"""

POSTGRESQL_REFINEMENT_PROMPT = """You are a PostgreSQL SQL expert refining an existing query.

## SCHEMA
{schema_context}

## RESTRICTED: {restricted_entities}

## BASE QUERY TO MODIFY
```sql
{base_query_to_modify}
```

---

## CRITICAL RULES
1. **START with the base query** - preserve its logic unless explicitly changing it
2. **VERIFY columns exist** in schema before adding them
3. **GROUP BY**: If adding columns, update GROUP BY appropriately
4. **Preserve table aliases** from the base query
5. **Date functions**: `NOW()`, `CURRENT_DATE`, `NOW() - INTERVAL '7 days'`
6. **String concat**: `col1 || ' ' || col2` or `CONCAT(col1, ' ', col2)`
7. **Case-insensitive search**: `ILIKE`

"""

POSTGRESQL_SQL_CORRECTOR_PROMPT = """You are a specialized PostgreSQL SQL Debugging Assistant.
Your ONLY goal is to fix a PostgreSQL query that failed during validation or execution.

## CONTEXT PROVIDED:
- **Dialect**: PostgreSQL
- **Current Date**: {current_date}
- **Relevant Schema**: {schema_context}
**Restricted Entities:**
{restricted_entities}
- **Failed SQL**:
```sql
{failed_sql}
```
- **Error Message**:
```
{error_message}
```

---

## INSTRUCTIONS:
1. **Analyze the Errors**: The error_message may contain syntax errors, validation failures, or execution errors
2. **Comprehensive Fix**: Resolve ALL listed errors in a single fix
3. **Schema Alignment**: Use the provided schema to find correct table and column names
4. **PostgreSQL Compliance**: Follow PostgreSQL syntax (||, NOW() - INTERVAL '7 days', ILIKE, etc.)
5. **Minimal Changes**: Fix only what is broken - preserve query logic
6. **Restricted Entities**: NEVER include restricted tables/columns
7. **No Explanation**: Return ONLY JSON

## POSTGRESQL-SPECIFIC ERROR HANDLING

### GROUP BY Errors
PostgreSQL supports functional dependency:
- If grouping by Primary Key, other columns can be omitted
- For cross-compatibility, safer to include all columns
- **Fix**: Add missing columns to GROUP BY or verify Primary Key usage

### Unknown Column Errors
If error contains "column" and "does not exist":
- **Problem**: Column doesn't exist in table
- **Fix**: Check schema, use only available columns
- **Note**: Explain which column was invalid and what was used instead

### Syntax Errors
Common PostgreSQL-specific fixes:
- String concat: Use `||` or `CONCAT()`
- Case-insensitive: Use `ILIKE` instead of `LIKE`
"""
