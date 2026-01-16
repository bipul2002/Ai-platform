# Query Pipeline Fixes and Debugging

## Issues Fixed

### 1. ✅ LLM Provider Config Not Being Used

**Status**: Already Working Correctly

**Verification**: The LLM configuration IS being loaded from the agent database configuration and used correctly.

**How it Works**:
1. `QueryPipeline._initialize_nodes()` fetches agent config via `SystemDBService.get_agent_config()` ([query_pipeline.py:25](/home/sumit/projects/ai-platform/ai-runtime/agent/query_pipeline.py#L25))
2. Config includes `llmProvider`, `llmModel`, and `llmTemperature` from database
3. `QueryGraphNodes.__init__()` receives agent_config and initializes LLM with these settings ([nodes.py:73-76](/home/sumit/projects/ai-platform/ai-runtime/agent/nodes.py#L73-L76))

**Database Flow**:
```
agents table (PostgreSQL)
├─ llm_provider (column)
├─ llm_model (column)
└─ llm_temperature (column)
     ↓
SystemDBService.get_agent_config()
     ↓
QueryPipeline._initialize_nodes()
     ↓
QueryGraphNodes.__init__()
     ↓
get_llm(provider, model, temperature)
```

**Added Debug Logging**: Now logs LLM configuration when loading agent config to verify correct provider/model is being used.

### 2. ✅ Stored Procedure Column Naming Error FIXED

**Problem**: Stored procedure `get_agent_enriched_schema()` was using camelCase column names (e.g., `t."tableName"`) but PostgreSQL database uses snake_case (e.g., `t.table_name`).

**Error**:
```
asyncpg.exceptions.UndefinedColumnError: column t.tableName does not exist
HINT: Perhaps you meant to reference the column "t.table_name".
```

**Fix Applied**: Updated `/admin-backend/src/db/migrations/0003_create_enriched_schema_function.sql`

**Changes Made**:
- All column references changed from camelCase to snake_case
- Tables: `tableName` → `table_name`, `schemaName` → `schema_name`, etc.
- Columns: `columnName` → `column_name`, `dataType` → `data_type`, etc.
- Relationships: `sourceTableId` → `source_table_id`, etc.

**Examples**:
```sql
-- Before (WRONG):
'name', t."tableName",
'schema', t."schemaName",
'isVisible', t."isVisible",

-- After (CORRECT):
'name', t.table_name,
'schema', t.schema_name,
'isVisible', t.is_visible,
```

**To Apply the Fix**:
Run the migration to recreate the stored procedure:
```bash
# From admin-backend directory
sudo docker exec -i ai-query-postgres psql -U postgres -d ai_query_platform < src/db/migrations/0003_create_enriched_schema_function.sql
```

### 3. ✅ Comprehensive Debugging Logs Added

**Added Detailed Logging to Query Pipeline**:

#### Load Config Node
```python
logger.info("=== LOADING AGENT CONFIGURATION ===", agent_id=...)
logger.info("Agent config loaded",
    llm_provider=..., llm_model=..., llm_temperature=..., db_type=...)
logger.info("Schema metadata loaded",
    table_count=..., tables=[...])
logger.info("Config loaded with schema-based sensitivity",
    schema_sensitive_count=..., global_rules_count=..., ...)
```

#### Schema Search Node
```python
logger.info("=== SCHEMA SEARCH ===", user_query=...)
logger.info("Query embedding generated", embedding_dimension=...)
logger.info("Vector search completed",
    results_count=..., matched_tables=[...])
```

#### Query Builder Node
```python
logger.info("=== QUERY BUILDER ===", user_message=...)
logger.info("Schema context built", context_length=...)
logger.info("Custom prompts found", prompts_length=...)
logger.info("Calling LLM for canonical query generation", dialect=...)
logger.info("Canonical query built", canonical_query=...)
```

#### SQL Generator Node
```python
logger.info("=== SQL GENERATOR ===", canonical_query=...)
logger.info("SQL generated", sql=..., dialect=...)
```

**How to View Logs**:
```bash
# Real-time logs
sudo docker logs ai-query-ai-runtime --follow

# Filter for specific pipeline step
sudo docker logs ai-query-ai-runtime --follow | grep "SCHEMA SEARCH"
sudo docker logs ai-query-ai-runtime --follow | grep "SQL GENERATOR"

# See full query execution
sudo docker logs ai-query-ai-runtime --follow | grep "==="
```

## Issue to Investigate: "users" Not Matching "admin_users"

### Problem Statement
User asked: **"Can you fetch all users?"**

Expected behavior: Should match `admin_users` table via embeddings
Actual behavior: Error: `relation "users" does not exist`

### Why This Happens

The query pipeline uses **vector embeddings** to match user queries to database tables. The process:

1. **User Query**: "Can you fetch all users?"
2. **Embedding Generation**: Query converted to vector
3. **Vector Search**: Searches `agent_schema_embeddings` table for similar vectors
4. **Table Matching**: Returns top 20 most similar schema elements
5. **Query Building**: LLM uses matched elements to build SQL

### Possible Causes

1. **No Embeddings Generated**:
   - Check if embeddings exist for the agent:
   ```sql
   SELECT COUNT(*), target_type
   FROM agent_schema_embeddings
   WHERE agent_id = '778bac5a-000d-4ad4-a673-c5b94db1ac72'
   GROUP BY target_type;
   ```

2. **Poor Embedding Match**:
   - Embedding for "users" query doesn't match "admin_users" table well enough
   - Check similarity scores in logs (now logged with debug changes)

3. **Table Not Visible/Queryable**:
   ```sql
   SELECT table_name, is_visible, is_queryable
   FROM agent_tables
   WHERE agent_id = '778bac5a-000d-4ad4-a673-c5b94db1ac72'
   AND table_name = 'admin_users';
   ```

4. **Missing Table Description**:
   - `admin_users` table might lack semantic hints or description to help matching
   ```sql
   SELECT table_name, admin_description, semantic_hints, custom_prompt
   FROM agent_tables
   WHERE agent_id = '778bac5a-000d-4ad4-a673-c5b94db1ac72'
   AND table_name = 'admin_users';
   ```

### Debug Steps

With the new logging, you can now see exactly what's happening:

1. **Start a query**: "Can you fetch all users?"

2. **Check logs for schema search**:
```bash
sudo docker logs ai-query-ai-runtime --follow | grep "SCHEMA SEARCH" -A 10
```

Look for:
- `embedding_dimension`: Should be 1536
- `results_count`: How many results were found
- `matched_tables`: Which tables were matched (should include admin_users)

3. **Check canonical query**:
```bash
sudo docker logs ai-query-ai-runtime --follow | grep "Canonical query built"
```

See what the LLM decided to query

4. **Check generated SQL**:
```bash
sudo docker logs ai-query-ai-runtime --follow | grep "SQL generated"
```

See the actual SQL that was generated

### Solutions

#### Option 1: Add Semantic Hints to admin_users Table

Via Schema Explorer, add semantic hints to help matching:
- **Table Description**: "User accounts and authentication data"
- **Semantic Hints**: "users, user accounts, admin users, authentication, login"
- **Custom Prompt**: "This table contains user account information"

#### Option 2: Regenerate Embeddings

Ensure embeddings are up-to-date:
1. Go to agent → Database tab
2. Click "Generate Embeddings"
3. Wait for completion

#### Option 3: Check Embedding Text

See what text was embedded for admin_users:
```sql
SELECT
    target_type,
    embedding_text,
    substring(embedding_vector::text, 1, 50) as vector_preview
FROM agent_schema_embeddings
WHERE agent_id = '778bac5a-000d-4ad4-a673-c5b94db1ac72'
AND embedding_text ILIKE '%admin_users%'
LIMIT 5;
```

### Testing the Fix

After applying fixes:

1. **Regenerate embeddings** (if table descriptions were updated)
2. **Test the query**:
   - "Can you fetch all users?"
   - "Show me all user accounts"
   - "List admin users"

3. **Check logs** to see:
   - Which tables matched in vector search
   - What SQL was generated
   - Verify `admin_users` is being used

## Next Steps

1. **Apply stored procedure fix**:
   ```bash
   sudo docker exec -i ai-query-postgres psql -U postgres -d ai_query_platform < /path/to/0003_create_enriched_schema_function.sql
   ```

2. **Restart ai-runtime** to get debug logs:
   ```bash
   sudo docker-compose restart ai-runtime
   ```

3. **Test a query** and watch the logs:
   ```bash
   sudo docker logs ai-query-ai-runtime --follow
   ```

4. **Add semantic hints** to admin_users table if embeddings aren't matching

5. **Share logs** with detailed pipeline execution for further debugging

## Files Modified

1. `/admin-backend/src/db/migrations/0003_create_enriched_schema_function.sql`
   - Fixed all column names from camelCase to snake_case

2. `/ai-runtime/agent/nodes.py`
   - Added comprehensive debug logging to:
     - `load_config()` - Lines 84-125
     - `schema_search()` - Lines 197-229
     - `query_builder()` - Lines 233-267
     - `sql_generator()` - Lines 273-281

## Log Output Example

When you run a query, you should now see:

```json
{"event": "=== LOADING AGENT CONFIGURATION ===", "agent_id": "778bac5a...", ...}
{"event": "Agent config loaded", "llm_provider": "openai", "llm_model": "gpt-4o", "llm_temperature": 0.0, ...}
{"event": "Schema metadata loaded", "table_count": 15, "tables": ["admin_users", "agents", ...], ...}
{"event": "=== SCHEMA SEARCH ===", "user_query": "Can you fetch all users?", ...}
{"event": "Query embedding generated", "embedding_dimension": 1536, ...}
{"event": "Vector search completed", "results_count": 8, "matched_tables": ["admin_users", ...], ...}
{"event": "=== QUERY BUILDER ===", "user_message": "Can you fetch all users?", ...}
{"event": "Canonical query built", "canonical_query": {...}, ...}
{"event": "=== SQL GENERATOR ===", "canonical_query": {...}, ...}
{"event": "SQL generated", "sql": "SELECT * FROM admin_users LIMIT 1000", ...}
```

This detailed logging will help identify exactly where the "users" → "admin_users" mapping is failing.
