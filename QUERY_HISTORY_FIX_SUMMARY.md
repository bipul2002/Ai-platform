# Query History Logging - Fix Summary

## Changes Made

### 1. Added `organizationId` to Query History

**Database Schema (Drizzle)** - [extended.schema.ts:153](admin-backend/src/db/schema/extended.schema.ts#L153)
```typescript
export const queryHistory = pgTable('query_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }), // NEW
  // ... other fields
});
```

**SQLAlchemy Model** - [models.py:259](ai-runtime/db/models.py#L259)
```python
class QueryHistory(Base):
    __tablename__ = "query_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    organizationId: Mapped[Optional[uuid.UUID]] = mapped_column("organization_id", UUID(as_uuid=True))  # NEW
    # ... other fields
```

**Agent Model** - [models.py:16](ai-runtime/db/models.py#L16)
```python
class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizationId: Mapped[Optional[uuid.UUID]] = mapped_column("organization_id", UUID(as_uuid=True))  # NEW
    # ... other fields
```

### 2. Updated System DB Service

**File**: [system_db.py:43](ai-runtime/services/system_db.py#L43)
```python
config = {
    "id": str(agent.id),
    "organizationId": str(agent.organizationId) if agent.organizationId else None,  # NEW
    # ... other fields
}
```

### 3. Updated Audit Service

**File**: [audit_service.py:55](ai-runtime/services/audit_service.py#L55)
```python
async def create_query_log(
    self,
    agent_id: str,
    user_message: str,
    organization_id: Optional[str] = None,  # NEW parameter
    session_id: Optional[str] = None,
    # ... other parameters
):
    query_log = QueryHistory(
        agentId=uuid.UUID(agent_id),
        organizationId=uuid.UUID(organization_id) if organization_id else None,  # NEW
        # ... other fields
    )
```

### 4. Updated Query Pipeline

**File**: [query_pipeline.py:340-344](ai-runtime/agent/query_pipeline.py#L340-L344)
```python
# AUDIT LOGGING: Create query history record
organization_id = self.agent_config.get("organizationId") if self.agent_config else None
query_history_id = await audit_service.create_query_log(
    agent_id=self.agent_id,
    user_message=user_message,
    organization_id=organization_id,  # NEW
    session_id=self.session_id,
    thread_id=thread_id,
    is_refinement=bool(previous_state),
    iteration_count=initial_state.get("iteration_count", 1)
)
```

## Migrations Generated

### Migration 0003 - Audit Tables
**File**: `0003_military_skreet.sql`
- Creates `query_pipeline_execution` table
- Creates `query_llm_calls` table
- Adds `thread_id`, `is_refinement`, `iteration_count` to `query_history`

### Migration 0004 - Audit Logs Organization
**File**: `0004_majestic_ulik.sql`
- Adds `organization_id` to `audit_logs` table

### Migration 0005 - Query History Organization
**File**: `0005_sharp_absorbing_man.sql`
- Adds `organization_id` to `query_history` table
- Creates index on `organization_id`
- Adds foreign key constraint to `organizations` table

## Why Query History Might Not Be Working

### Issue 1: Migrations Not Applied ⚠️

**Problem**: The database tables might not exist yet because migrations haven't been applied.

**Check**:
```bash
# In admin-backend directory
npm run db:migrate:run
```

**Expected Output**:
```
✅ Migration 0003_military_skreet.sql applied
✅ Migration 0004_majestic_ulik.sql applied
✅ Migration 0005_sharp_absorbing_man.sql applied
```

**Error if tables don't exist**:
```
ERROR: relation "query_history" does not exist
```
or
```
ERROR: column "organization_id" does not exist
```

### Issue 2: Database Connection Problem

**Check Python Runtime Logs**:
```bash
# Check ai-runtime logs for errors like:
tail -f ai-runtime/logs/*.log | grep -i "query log\|audit"
```

**Look for**:
- `"Query log created"` - Success ✅
- `"Failed to create query log"` - Error ❌
- Connection refused errors
- Foreign key constraint violations

### Issue 3: Agent Has No Organization

**Problem**: If an agent doesn't have an `organizationId`, the log will still be created but with `NULL` for `organization_id`.

**Check**:
```sql
-- Check if agents have organizationId
SELECT id, name, organization_id
FROM agents
LIMIT 10;

-- Should show organization_id values, not all NULL
```

**Fix**: Update agents to have organizationId:
```sql
-- Example: Assign agents to an organization
UPDATE agents
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;
```

### Issue 4: Audit Service Silently Failing

The audit service catches exceptions and logs them without breaking the query:

```python
except Exception as e:
    logger.error("Failed to create query log", error=str(e), agent_id=agent_id, organization_id=organization_id)
    return None  # Returns None instead of raising
```

**Check logs for**:
```
Failed to create query log
```

**Common errors**:
- Foreign key constraint violation (agent_id doesn't exist)
- Invalid UUID format
- Database connection lost

## How to Verify Query History is Working

### Step 1: Apply Migrations
```bash
cd admin-backend
npm run db:migrate:run
```

### Step 2: Send a Test Query

Via API or frontend, send a query to any agent.

### Step 3: Check Database

```sql
-- Check if query was logged
SELECT
    id,
    agent_id,
    organization_id,
    user_message,
    is_success,
    created_at
FROM query_history
ORDER BY created_at DESC
LIMIT 5;

-- Should show recent queries ✅
```

### Step 4: Check Pipeline Execution

```sql
-- Check if pipeline nodes were logged
SELECT
    qpe.node_name,
    qpe.execution_order,
    qpe.duration_ms,
    qpe.error
FROM query_pipeline_execution qpe
JOIN query_history qh ON qpe.query_history_id = qh.id
WHERE qh.created_at > NOW() - INTERVAL '1 hour'
ORDER BY qpe.execution_order;

-- Should show nodes like: load_config, refinement_detector, nlu_router, etc. ✅
```

### Step 5: Check LLM Calls (if using wrapper)

```sql
-- Check if LLM calls were logged
SELECT
    qlc.node_name,
    qlc.llm_provider,
    qlc.llm_model,
    qlc.token_usage,
    LENGTH(qlc.prompt) as prompt_length,
    LENGTH(qlc.response) as response_length
FROM query_llm_calls qlc
JOIN query_history qh ON qlc.query_history_id = qh.id
WHERE qh.created_at > NOW() - INTERVAL '1 hour';

-- Will be empty unless nodes use _call_llm_with_logging() wrapper
```

## Debugging Steps

### 1. Check if Tables Exist

```sql
\dt query_history
\dt query_pipeline_execution
\dt query_llm_calls

-- All should show "relation found"
```

### 2. Check Table Columns

```sql
\d query_history

-- Should show columns including:
-- - organization_id (uuid)
-- - thread_id (varchar)
-- - is_refinement (boolean)
-- - iteration_count (integer)
```

### 3. Check Python Runtime Logs

```bash
# Look for audit service logs
grep -i "audit\|query log" ai-runtime/logs/*.log

# Should see:
# - "Query log created" with query_history_id
# - "Pipeline execution logged" for each node
```

### 4. Test Direct Database Insert

```python
# In Python shell or script
from ai-runtime.services.audit_service import audit_service
import asyncio

async def test():
    query_id = await audit_service.create_query_log(
        agent_id="your-agent-uuid",
        user_message="Test query",
        organization_id="your-org-uuid",  # or None
        session_id="test-session",
        thread_id="test-thread",
        is_refinement=False,
        iteration_count=1
    )
    print(f"Created query log: {query_id}")

asyncio.run(test())

# Should print: "Created query log: <uuid>"
# If None: Check error logs for the cause
```

### 5. Check for Foreign Key Errors

```sql
-- Verify agent exists
SELECT id, name FROM agents WHERE id = 'your-agent-uuid';

-- Verify organization exists
SELECT id, name FROM organizations WHERE id = 'your-org-uuid';

-- If agent or org doesn't exist, query_log creation will fail
```

## Expected Log Output

When working correctly, you should see logs like:

```
INFO: Query log created query_history_id=<uuid> agent_id=<uuid> organization_id=<uuid> is_refinement=False is_success=True
INFO: Pipeline execution logged query_history_id=<uuid> node_name=load_config execution_order=1
INFO: Pipeline execution logged query_history_id=<uuid> node_name=refinement_detector execution_order=2
INFO: Pipeline execution logged query_history_id=<uuid> node_name=nlu_router execution_order=3
# ... more nodes
INFO: Query log updated query_history_id=<uuid>
```

## Summary of Files Modified

✅ **Database Schema**:
- [extended.schema.ts](admin-backend/src/db/schema/extended.schema.ts) - Added `organizationId` to `queryHistory`
- [models.py](ai-runtime/db/models.py) - Added `organizationId` to `Agent` and `QueryHistory`

✅ **Services**:
- [system_db.py](ai-runtime/services/system_db.py) - Returns `organizationId` in agent config
- [audit_service.py](ai-runtime/services/audit_service.py) - Accepts and stores `organizationId`

✅ **Pipeline**:
- [query_pipeline.py](ai-runtime/agent/query_pipeline.py) - Passes `organizationId` to audit service

✅ **Migrations**:
- `0003_military_skreet.sql` - Audit logging tables
- `0004_majestic_ulik.sql` - Organization in audit_logs
- `0005_sharp_absorbing_man.sql` - Organization in query_history

## Next Steps

1. **Apply migrations** (REQUIRED):
   ```bash
   cd admin-backend
   npm run db:migrate:run
   ```

2. **Restart services**:
   ```bash
   # Restart both admin-backend and ai-runtime
   docker-compose restart admin-backend ai-runtime
   # OR if not using Docker:
   # Restart manually
   ```

3. **Send test query** and verify logs are created

4. **Check database** to confirm records exist

5. **Review Python logs** for any errors

## Quick Test Commands

```bash
# 1. Apply migrations
cd admin-backend && npm run db:migrate:run

# 2. Check if tables exist
psql $DATABASE_URL -c "\dt query_history"

# 3. Send a test query (via your API or frontend)

# 4. Check if records were created
psql $DATABASE_URL -c "SELECT COUNT(*) FROM query_history WHERE created_at > NOW() - INTERVAL '5 minutes';"

# 5. View recent query logs
psql $DATABASE_URL -c "SELECT id, user_message, organization_id, is_success, created_at FROM query_history ORDER BY created_at DESC LIMIT 5;"
```

If query_history still shows 0 rows after sending queries, check:
- ✅ Migrations applied
- ✅ Services restarted
- ✅ No errors in Python logs
- ✅ Agent and organization exist in database
- ✅ Database connection from ai-runtime works
