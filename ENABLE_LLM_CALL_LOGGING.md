# Enable LLM Call Logging

## Current Status

✅ **Query History** - Working and storing records
✅ **Pipeline Execution** - Fixed! Now logs ALL nodes (previously only logged final nodes)
❌ **LLM Calls** - Not logging yet (requires manual update of node code)

## Why LLM Calls Are Not Being Logged

The LLM call logging wrapper `_call_llm_with_logging()` was added to the `QueryGraphNodes` class in [nodes.py:113](ai-runtime/agent/nodes.py#L113), but the existing LLM calls in the nodes are still using the old direct call method:

**Current code (not logging)**:
```python
response = await self.llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_prompt)
])
```

**Updated code (with logging)**:
```python
response = await self._call_llm_with_logging(
    messages=[
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt)
    ],
    node_name="refinement_detector",  # Current node name
    query_history_id=state.get("query_history_id")
)
```

## Nodes That Make LLM Calls

These nodes need to be updated to use the logging wrapper:

### 1. refinement_detector - [nodes.py:307](ai-runtime/agent/nodes.py#L307)
```python
# Current:
response = await self.llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_message)
])

# Update to:
response = await self._call_llm_with_logging(
    messages=[
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message)
    ],
    node_name="refinement_detector",
    query_history_id=state.get("query_history_id")
)
```

### 2. nlu_router - [nodes.py:493](ai-runtime/agent/nodes.py#L493)
```python
# Current:
response = await self.llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_message)
])

# Update to:
response = await self._call_llm_with_logging(
    messages=[
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message)
    ],
    node_name="nlu_router",
    query_history_id=state.get("query_history_id")
)
```

### 3. schema_search - [nodes.py:648](ai-runtime/agent/nodes.py#L648)
```python
# Current:
response = await self.llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_content)
])

# Update to:
response = await self._call_llm_with_logging(
    messages=[
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_content)
    ],
    node_name="schema_search",
    query_history_id=state.get("query_history_id")
)
```

### 4. query_builder - [nodes.py:1013](ai-runtime/agent/nodes.py#L1013)
```python
# Current:
response = await structured_llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_content)
])

# Update to:
# Note: This one uses structured_llm, not self.llm
# For now, keep using direct call or modify wrapper to handle structured_llm
response = await structured_llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_content)
])
# TODO: Add logging support for structured LLM calls
```

## Quick Update Script

You can update all LLM calls at once by searching for these patterns:

```bash
# Find all LLM calls in nodes.py
grep -n "await self.llm.ainvoke" ai-runtime/agent/nodes.py
grep -n "await structured_llm.ainvoke" ai-runtime/agent/nodes.py
```

## What the Wrapper Logs

When you use `_call_llm_with_logging()`, it automatically logs:

✅ **Provider** (openai/anthropic) and **Model** (gpt-4, claude-3.5-sonnet, etc.)
✅ **System prompt** and **User prompt** (full text)
✅ **Response** (full text)
✅ **LLM Configuration** (temperature, max_tokens, etc.) - **SANITIZED** (no API keys!)
✅ **Token Usage** (prompt_tokens, completion_tokens, cached tokens)
✅ **Duration** (milliseconds)
✅ **Errors** (if LLM call fails)

## Example: Update refinement_detector

**File**: `ai-runtime/agent/nodes.py`

**Find** (around line 307):
```python
logger.info("Detecting refinement intent", user_message=state["user_message"])
response = await self.llm.ainvoke([
    SystemMessage(content=system_prompt),
    HumanMessage(content=user_message)
])
```

**Replace with**:
```python
logger.info("Detecting refinement intent", user_message=state["user_message"])
response = await self._call_llm_with_logging(
    messages=[
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message)
    ],
    node_name="refinement_detector",
    query_history_id=state.get("query_history_id")
)
```

## Verification

After updating the nodes and restarting ai-runtime:

```bash
# Restart service
docker-compose restart ai-runtime

# Send a test query

# Check if LLM calls were logged
psql $DATABASE_URL -c "
SELECT
    node_name,
    llm_provider,
    llm_model,
    token_usage->>'total_tokens' as tokens,
    duration_ms
FROM query_llm_calls
WHERE query_history_id = (
    SELECT id FROM query_history ORDER BY created_at DESC LIMIT 1
)
ORDER BY created_at;
"

# Should show LLM calls for each node that uses LLM:
# - refinement_detector (if it's a refinement)
# - nlu_router
# - schema_search (if schema search was performed)
# - query_builder
```

## Benefits of LLM Call Logging

Once enabled, you'll be able to:

📊 **Track LLM costs** - Sum token usage by model
📈 **Analyze performance** - Identify slow LLM calls
🐛 **Debug prompts** - See exact prompts sent and responses received
💰 **Cost optimization** - Find expensive queries and optimize prompts
📉 **Monitor usage** - Track which models are used most

## Summary

**Current State**:
- ✅ Query history: **Working**
- ✅ Pipeline execution: **Fixed** - now logs all nodes
- ⚠️ LLM calls: **Needs manual update** - update 3-4 LLM call sites in nodes.py

**To enable LLM logging**:
1. Find each `await self.llm.ainvoke()` call in nodes.py
2. Replace with `await self._call_llm_with_logging()`
3. Pass `node_name` and `query_history_id` parameters
4. Restart ai-runtime

**Estimated time**: 10-15 minutes to update all nodes
