# Debug Logging Implementation

## Summary

Added comprehensive debug logging for all LangGraph nodes and LLM calls in the query pipeline to enable detailed debugging and performance monitoring.

## Changes Made

### File: `ai-runtime/agent/nodes.py`

#### 1. Added Imports
```python
import functools  # For decorator support
```

#### 2. Created `log_node_execution` Decorator

A decorator that wraps every LangGraph node method to log:

**🔵 NODE INPUT** - Logs when a node starts execution:
- Node name
- User message
- Current step
- Thread ID
- Is refinement flag
- Agent ID
- All state keys
- Error status

**🟢 NODE OUTPUT** - Logs when a node completes successfully:
- Node name
- Returned keys
- New current step
- Error status
- Error message (if any)

**🔴 NODE ERROR** - Logs when a node encounters an exception:
- Node name
- Error message
- Error type
- Full traceback

#### 3. Created `log_llm_call` Async Function

A wrapper function for all LLM calls that logs:

**🤖 LLM INPUT** - Before calling the LLM:
- Context (e.g., "refinement_detection", "nlu_intent_classification")
- System prompt preview (first 500 chars)
- System prompt length
- User message preview (first 500 chars)
- User message length

**✅ LLM OUTPUT** - After successful LLM response:
- Context
- Response preview (first 500 chars)
- Response length
- Latency in milliseconds
- Token usage metadata (if available)

**❌ LLM ERROR** - If LLM call fails:
- Context
- Error message
- Error type
- Latency in milliseconds

#### 4. Applied Decorator to All Node Methods

Applied `@log_node_execution("node_name")` to all 16 node methods:

1. ✅ `load_config` - Loads agent configuration and initializes LLM
2. ✅ `refinement_detector` - Detects if query is refinement or new
3. ✅ `query_modifier` - Modifies previous query based on refinement
4. ✅ `nlu_router` - Classifies user intent
5. ✅ `guardrail_responder` - Handles off-topic messages
6. ✅ `no_match_responder` - Handles no schema matches
7. ✅ `clarification_responder` - Requests clarification
8. ✅ `schema_search` - Searches for relevant schema using hybrid search
9. ✅ `query_builder` - Builds canonical query representation
10. ✅ `schema_validator` - Validates and corrects canonical query
11. ✅ `sql_generator` - Generates SQL from canonical query
12. ✅ `sql_validator_node` - Validates generated SQL
13. ✅ `sql_executor` - Executes SQL (validation only mode)
14. ✅ `sanitizer` - Sanitizes results for sensitive data
15. ✅ `response_composer` - Composes final response
16. ✅ `error_handler` - Handles errors

#### 5. Wrapped LLM Calls with Logging

Replaced direct `llm.ainvoke()` calls with `log_llm_call()` wrapper in:

1. **`refinement_detector`** (line 364):
   - Context: "refinement_detection"
   - Logs refinement intent classification

2. **`nlu_router`** (line 495):
   - Context: "nlu_intent_classification"
   - Logs NLU intent analysis

3. **`query_builder`** (lines 779-796):
   - Context: "query_builder_structured"
   - Custom logging for structured output (Pydantic model)
   - Logs canonical query generation

## Log Levels

All debug logs use `logger.debug()` to avoid cluttering info-level logs in production. To enable debug logging, set the log level to DEBUG in the runtime configuration.

## Example Log Output

### Node Execution
```
🔵 NODE INPUT: nlu_router
  node=nlu_router
  user_message="Fetch all organisations and count of users"
  current_step="config_loaded"
  thread_id=None
  is_refinement=False
  agent_id="agent-123"
  state_keys=['agent_id', 'user_message', 'context', 'agent_config', 'schema_metadata']
  has_error=False

🟢 NODE OUTPUT: nlu_router
  node=nlu_router
  returned_keys=['intent', 'is_off_topic', 'is_ambiguous', 'clarifying_questions', 'current_step']
  new_current_step="intent_analyzed"
  has_error=False
  error_message=None
```

### LLM Call
```
🤖 LLM INPUT (nlu_intent_classification)
  context="nlu_intent_classification"
  system_prompt_preview="You are an intelligent SQL agent. Your job is to analyze..."
  system_prompt_length=2456
  user_message="Fetch all organisations and count of users"
  user_message_length=42

✅ LLM OUTPUT (nlu_intent_classification)
  context="nlu_intent_classification"
  response_preview='{"is_database_query": true, "intent": "Fetch organizations with user counts"...'
  response_length=185
  latency_ms=1247
  usage={'input_tokens': 534, 'output_tokens': 45}
```

## Benefits

1. **Full Pipeline Visibility**: Track execution flow through all 16 nodes
2. **LLM Call Monitoring**: See every prompt sent and response received
3. **Performance Profiling**: Measure latency for each LLM call
4. **Error Debugging**: Full tracebacks with context for all errors
5. **State Tracking**: Monitor state changes between nodes
6. **Token Usage**: Track token consumption per LLM call

## Usage

### Enable Debug Logging

Set the environment variable or modify the logging configuration:
```python
import structlog
structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG)
)
```

Or via environment:
```bash
export LOG_LEVEL=DEBUG
```

### Viewing Logs

Debug logs will appear in the AI runtime container logs:
```bash
docker-compose logs -f ai-runtime | grep "🔵\|🟢\|🔴\|🤖\|✅\|❌"
```

Filter by specific nodes:
```bash
docker-compose logs -f ai-runtime | grep "NODE INPUT: query_builder"
```

Filter by LLM calls only:
```bash
docker-compose logs -f ai-runtime | grep "🤖\|✅"
```

## Testing

Syntax validation passed:
```bash
python3 -m py_compile ai-runtime/agent/nodes.py
# ✅ No errors
```

## Next Steps

1. Restart the ai-runtime service to apply changes:
   ```bash
   sudo docker-compose restart ai-runtime
   ```

2. Test with a query and observe debug logs:
   ```bash
   docker-compose logs -f ai-runtime
   ```

3. Monitor for any issues in production

4. Consider adding log filtering/sampling for high-volume production environments

## Notes

- Emoji icons (🔵🟢🔴🤖✅❌) make logs easily scannable
- All debug logs are structured (JSON format) for easy parsing
- Preview lengths (500 chars) prevent log flooding while providing context
- Latency tracking helps identify performance bottlenecks
- State keys logging helps understand what data is available at each step
