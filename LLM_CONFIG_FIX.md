# LLM Configuration Fix - Using Agent DB Settings

## Problem

The AI runtime was **NOT using the LLM configuration from the agent's database settings**. Instead, it was using default values from environment variables.

**Evidence from Logs**:
```json
{"provider": "openai", "model": "gpt-4-turbo-preview", "temperature": 0.0, ...}
```

Even though the agent might be configured with a different model (like `gpt-4o`) in the database, it was always using `gpt-4-turbo-preview`.

## Root Cause

**Timing Issue**: The LLM was being initialized in `QueryGraphNodes.__init__()` BEFORE the agent configuration was loaded from the database.

**Code Flow (BEFORE FIX)**:
```python
QueryPipeline._initialize_nodes()
    ↓
QueryGraphNodes.__init__(agent_config=None)  # ← agent_config is None initially
    ↓
self.llm = get_llm()  # ← Uses defaults from settings!
    ↓
Later: load_config() runs and loads DB config  # ← Too late!
```

The `agent_config` parameter passed to `__init__` was from a previous fetch, but it wasn't being used because the LLM was already initialized with defaults.

## Solution

**Delay LLM initialization until AFTER loading agent config from database**.

### Changes Made

**File**: `/ai-runtime/agent/nodes.py`

#### 1. Remove LLM Initialization from `__init__`

**Before**:
```python
class QueryGraphNodes:
    def __init__(self, agent_config: Optional[Dict[str, Any]] = None):
        # ... initialize services ...

        # Initialize LLM with agent-specific configuration
        if agent_config:
            self.llm = get_llm(
                provider=agent_config.get('llmProvider', 'openai'),
                model=agent_config.get('llmModel', 'gpt-4-turbo-preview'),
                temperature=agent_config.get('llmTemperature', 0.0)
            )
        else:
            # Fallback to default
            self.llm = get_llm()
```

**After**:
```python
class QueryGraphNodes:
    def __init__(self, agent_config: Optional[Dict[str, Any]] = None):
        # ... initialize services ...

        # Store agent config but don't initialize LLM yet
        # LLM will be initialized in load_config() with actual DB values
        self.agent_config = agent_config
        self.llm = None  # Will be initialized in load_config()
```

#### 2. Initialize LLM in `load_config()` with DB Values

**Before**:
```python
async def load_config(self, state: QueryState) -> Dict:
    config = await self.system_db.get_agent_config(state["agent_id"])
    # ... but didn't use config to initialize LLM
```

**After**:
```python
async def load_config(self, state: QueryState) -> Dict:
    config = await self.system_db.get_agent_config(state["agent_id"])
    logger.info(
        "Agent config loaded from database",
        llm_provider=config.get("llmProvider"),
        llm_model=config.get("llmModel"),
        llm_temperature=config.get("llmTemperature"),
        db_type=config.get("dbType")
    )

    # Initialize LLM with agent-specific config from database
    self.llm = get_llm(
        provider=config.get('llmProvider', 'openai'),
        model=config.get('llmModel', 'gpt-4-turbo-preview'),
        temperature=config.get('llmTemperature', 0.0)
    )
    logger.info(
        "LLM initialized with agent config",
        provider=config.get('llmProvider'),
        model=config.get('llmModel'),
        temperature=config.get('llmTemperature')
    )
```

## How It Works Now

**Correct Code Flow (AFTER FIX)**:
```python
QueryPipeline._initialize_nodes()
    ↓
QueryGraphNodes.__init__()
    ↓
self.llm = None  # ← Not initialized yet
    ↓
load_config() runs (first node in pipeline)
    ↓
config = get_agent_config(agent_id)  # ← Fetch from DB
    ↓
self.llm = get_llm(provider=config.llmProvider, ...)  # ← Use DB values!
    ↓
NLU, Query Builder, etc. use self.llm  # ← Correct LLM!
```

## Expected Log Output

After the fix, you should see:

```json
{"event": "=== LOADING AGENT CONFIGURATION ===", "agent_id": "778bac5a...", ...}
{"event": "Agent config loaded from database",
 "llm_provider": "openai",
 "llm_model": "gpt-4o",  // ← Your actual model from DB
 "llm_temperature": 0.5, // ← Your actual temperature from DB
 ...}
{"event": "LLM initialized with agent config",
 "provider": "openai",
 "model": "gpt-4o",  // ← Matches DB config!
 "temperature": 0.5, ...}
{"event": "Initializing LLM",
 "provider": "openai",
 "model": "gpt-4o",  // ← agent.llm logs the actual init
 "temperature": 0.5, ...}
```

## Testing

1. **Set agent LLM config** in the database:
   - Go to Edit Agent → Advanced tab
   - Change Model to `gpt-4o`
   - Change Temperature to `0.7`
   - Save

2. **Restart ai-runtime**:
   ```bash
   sudo docker-compose restart ai-runtime
   ```

3. **Send a test query** and check logs:
   ```bash
   sudo docker logs ai-query-ai-runtime --follow | grep "LLM"
   ```

4. **Verify the logs show**:
   - "Agent config loaded from database" with your model/temperature
   - "LLM initialized with agent config" matching your settings
   - "Initializing LLM" from agent.llm matching your settings

## Additional Notes on the Chat Interaction

Looking at the screenshot, the system is working correctly by asking for clarification:

> "I need a bit more information to help you:
> Do you want to fetch all users from a specific table, such as 'admin_users' or 'agents'?"

This is **expected behavior** because:
1. The query "fetch all users" is ambiguous
2. There's no table literally named "users"
3. The LLM correctly identified candidate tables: `admin_users` and `agents`

When you clicked "admin_users", it correctly:
1. Generated SQL: `SELECT * FROM "admin_users" AS "au"`
2. Executed the query
3. Returned 1 row with properly masked email

The clarification is actually a **good feature** - it prevents the system from making assumptions. However, if you want it to auto-match "users" to "admin_users", you need to:

### Option 1: Add Semantic Hints to admin_users Table
In Schema Explorer, edit the `admin_users` table:
- **Semantic Hints**: "users, user accounts, system users, platform users"
- **Custom Prompt**: "This table contains all user accounts in the system"

Then regenerate embeddings.

### Option 2: Increase Embedding Similarity Threshold
The embedding search might be finding `admin_users` but with low confidence. Adding semantic hints will improve the match score.

## Files Modified

1. `/ai-runtime/agent/nodes.py`
   - Lines 62-74: Removed LLM initialization from `__init__`
   - Lines 76-143: Added LLM initialization in `load_config()` with DB values
   - Added detailed logging for LLM config

## Impact

✅ **Now**: Each agent uses its own LLM provider, model, and temperature from database
✅ **Flexibility**: Different agents can use different models (gpt-4o, claude-3-5-sonnet, etc.)
✅ **Temperature Control**: Each agent can have custom creativity levels
✅ **Cost Optimization**: Use cheaper models for simple agents, expensive ones for complex queries
✅ **Visibility**: Logs clearly show which LLM config is being used
