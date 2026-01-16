import json
import re
import time
import copy
import difflib
from datetime import datetime
from typing import Dict, Any, List, Tuple, TypedDict, Optional, Annotated, Set
import operator
import structlog
import sqlparse
from sqlparse.sql import Token, Identifier, IdentifierList
from sqlparse.tokens import Keyword, DML

from langchain_core.messages import HumanMessage, SystemMessage

from services.system_db import SystemDBService
from services.embedding_service import EmbeddingService
from mcp_tools.sql_validator import SQLValidator
from mcp_tools.sql_executor import SQLExecutor
from mcp_tools.sensitivity_registry import SensitivityRegistry
from mcp_tools.dialect_translator import DialectTranslator
from mcp_tools.audit_logger import AuditLogger

from agent.llm import get_llm
from agent.prompts import (
    UNIFIED_INTENT_SYSTEM_PROMPT,
    RESPONSE_COMPOSER_SYSTEM_PROMPT,
    GUARDRAIL_RESPONSE,
    build_query_builder_prompt,
    build_sql_corrector_prompt
)
from agent.text_utils import find_relevant_items, is_keyword_match, extract_keywords
from agent.schema_validator import SchemaValidator
from services.embedding_cache import embedding_cache
from services.audit_service import audit_service

logger = structlog.get_logger()

class QueryState(TypedDict):
    agent_id: str
    session_id: str
    user_message: str
    context: List[Dict[str, str]]

    # Audit logging
    query_history_id: Optional[Any]  # UUID of query_history record for audit logging

    # Thread management (NEW)
    thread_id: Optional[str]
    is_refinement: bool
    needs_schema_search: bool
    previous_query: Optional[Dict[str, Any]]  # Previous canonical query
    previous_sql: Optional[str]
    previous_user_message: Optional[str]  # NEW: Previous user message for refinement context
    previous_results: Optional[List[Dict[str, Any]]]
    refinement_intent: Optional[Dict[str, Any]]  # What to modify
    refinement_complexity: Optional[str]  # NEW: "simple" | "complex" | None
    iteration_count: int

    # Routing control (NEW)
    skip_query_builder: Optional[bool]  # NEW: Route simple refinements directly to sql_generator

    # Pipeline state
    agent_config: Optional[Dict[str, Any]]
    schema_metadata: Optional[Dict[str, Any]]
    sensitivity_rules: Optional[Dict[str, Any]]

    intent: Optional[Dict[str, Any]]
    is_off_topic: bool
    is_ambiguous: bool
    is_data_guide_request: bool  # NEW: Flag for data guide requests
    clarifying_questions: List[str]

    relevant_schema: List[Dict[str, Any]]
    pinned_schema: Optional[List[Dict[str, Any]]]  # NEW: Strictly pinned schema for SQL correction
    no_match: bool # NEW: Flag for when schema search fails
    new_entities: Optional[List[str]]  # NEW: Track entities that need schema search
    canonical_query: Optional[Dict[str, Any]]
    generated_sql: Optional[str]
    sql_dialect: str
    validation_result: Optional[Dict[str, Any]]
    pre_query_warnings: Annotated[List[Dict[str, str]], operator.add]
    queryability_warnings: Annotated[List[Dict[str, str]], operator.add]
    raw_results: List[Dict[str, Any]]
    sanitized_results: List[Dict[str, Any]]
    final_response: str
    error: Optional[str]
    correction_note: Optional[str]

    start_time: float
    execution_time_ms: int
    current_step: str


class QueryGraphNodes:
    # Common column names that appear in many tables
    # These get lower weight in schema search to prevent over-matching
    COMMON_COLUMN_NAMES = {
        'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
        'is_deleted', 'deleted_at', 'is_active', 'status', 'name',
        'description', 'type', 'timestamp', 'date', 'time',
        'user_id', 'organization_id', 'tenant_id', 'owner_id'
    }

    def __init__(self, agent_config: Optional[Dict[str, Any]] = None):
        # Initialize services
        self.system_db = SystemDBService()
        self.embedding_service = EmbeddingService()
        self.sql_validator = SQLValidator()
        self.sensitivity_registry = SensitivityRegistry()
        self.dialect_translator = DialectTranslator()
        self.audit_logger = AuditLogger()
        self._schema_validator_service = SchemaValidator(
            self.embedding_service,
            self.system_db,
            embedding_cache
        )

        # Store agent config but don't initialize LLM yet
        # LLM will be initialized in load_config() with actual DB values
        self.agent_config = agent_config
        self.llm = None  # Will be initialized in load_config()

    async def _call_llm_with_logging(
        self,
        messages: List,
        node_name: str,
        query_history_id: Optional[Any] = None
    ):
        """
        Wrapper for LLM calls that logs to audit service with sanitized config.

        Args:
            messages: List of LangChain messages (SystemMessage, HumanMessage, etc.)
            node_name: Name of the node making the LLM call
            query_history_id: UUID of the query_history record for audit logging

        Returns:
            LLM response
        """
        from datetime import datetime

        logger.info("🔍 [DEBUG] _call_llm_with_logging CALLED",
                    node_name=node_name,
                    query_history_id=str(query_history_id) if query_history_id else None,
                    has_query_history_id=query_history_id is not None)

        start_time = datetime.now()

        # Extract prompts for logging
        system_prompt = None
        user_prompt = None
        for msg in messages:
            if isinstance(msg, SystemMessage):
                system_prompt = msg.content
            elif isinstance(msg, HumanMessage):
                user_prompt = msg.content

        logger.info("🔍 [DEBUG] Prompts extracted",
                    node_name=node_name,
                    has_system_prompt=system_prompt is not None,
                    has_user_prompt=user_prompt is not None,
                    system_prompt_length=len(system_prompt) if system_prompt else 0,
                    user_prompt_length=len(user_prompt) if user_prompt else 0)

        # Extract LLM configuration (will be sanitized by audit_service)
        llm_config = {}
        llm_provider = self.agent_config.get('llmProvider', 'openai') if self.agent_config else 'openai'
        llm_model = 'unknown'

        try:
            # Extract config from LLM instance
            if hasattr(self.llm, 'model_name'):
                llm_model = self.llm.model_name
            elif hasattr(self.llm, 'model'):
                llm_model = self.llm.model

            if hasattr(self.llm, 'temperature'):
                llm_config['temperature'] = self.llm.temperature
            if hasattr(self.llm, 'max_tokens'):
                llm_config['max_tokens'] = self.llm.max_tokens
            if hasattr(self.llm, 'top_p'):
                llm_config['top_p'] = self.llm.top_p
            if hasattr(self.llm, 'frequency_penalty'):
                llm_config['frequency_penalty'] = self.llm.frequency_penalty
            if hasattr(self.llm, 'presence_penalty'):
                llm_config['presence_penalty'] = self.llm.presence_penalty
        except Exception as e:
            logger.warning("Failed to extract LLM config for logging", error=str(e))

        # Call the LLM
        try:
            response = await self.llm.ainvoke(messages)
            response_content = response.content if hasattr(response, 'content') else str(response)

            # Extract token usage if available
            # Extract token usage if available
            token_usage = None
            
            # Check for usage_metadata (newer LangChain) or response_metadata (older/OpenAI)
            usage_source = None
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                usage_source = response.usage_metadata
            elif hasattr(response, 'response_metadata'):
                usage_source = response.response_metadata.get('usage') or response.response_metadata.get('token_usage')

            if usage_source:
                token_usage = {
                    'prompt_tokens': usage_source.get('input_tokens') or usage_source.get('prompt_tokens'),
                    'completion_tokens': usage_source.get('output_tokens') or usage_source.get('completion_tokens'),
                    'total_tokens': usage_source.get('total_tokens'),
                    # Include cached tokens if available
                    'prompt_tokens_details': usage_source.get('prompt_tokens_details'),
                    'completion_tokens_details': usage_source.get('completion_tokens_details')
                }
                
            # If total_tokens missing but we have others, calculate it
            if token_usage and not token_usage.get('total_tokens') and token_usage.get('prompt_tokens') and token_usage.get('completion_tokens'):
                token_usage['total_tokens'] = token_usage['prompt_tokens'] + token_usage['completion_tokens']


            # Calculate duration
            end_time = datetime.now()
            duration_ms = int((end_time - start_time).total_seconds() * 1000)

            # Log to audit service (non-blocking - don't fail query if logging fails)
            if query_history_id:
                await audit_service.log_llm_call(
                    query_history_id=query_history_id,
                    node_name=node_name,
                    llm_provider=llm_provider,
                    llm_model=llm_model,
                    system_prompt=system_prompt,
                    prompt=user_prompt,
                    response=response_content,
                    llm_config=llm_config,  # Will be sanitized by audit_service
                    token_usage=token_usage,
                    duration_ms=duration_ms
                )

            return response

        except Exception as e:
            # Log error to audit service
            end_time = datetime.now()
            duration_ms = int((end_time - start_time).total_seconds() * 1000)

            if query_history_id:
                await audit_service.log_llm_call(
                    query_history_id=query_history_id,
                    node_name=node_name,
                    llm_provider=llm_provider,
                    llm_model=llm_model,
                    system_prompt=system_prompt,
                    prompt=user_prompt,
                    response=None,
                    llm_config=llm_config,
                    token_usage=None,
                    duration_ms=duration_ms,
                    error=str(e)
                )

            # Re-raise the exception
            raise

    async def load_config(self, state: QueryState) -> Dict:
        try:
            logger.info("=== LOADING AGENT CONFIGURATION ===", agent_id=state["agent_id"])

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

            schema = await self.system_db.get_agent_enriched_metadata(state["agent_id"])
            table_count = len(schema.get("tables", []))
            logger.info(
                "Schema metadata loaded",
                table_count=table_count,
                tables=[t.get("name") for t in schema.get("tables", [])]
            )

            sensitivity = await self.system_db.get_agent_sensitivity(state["agent_id"])

            # Extract schema-based sensitive columns
            schema_sensitive_fields = self._extract_sensitive_columns(schema)

            # Merge with existing sensitivity rules
            enhanced_sensitivity = {
                "globalRules": sensitivity.get("globalRules", []),
                "agentRules": sensitivity.get("agentRules", []),
                "schemaSensitiveColumns": schema_sensitive_fields,  # NEW
                "forbiddenFields": sensitivity.get("forbiddenFields", [])
            }

            self.sensitivity_registry.load_rules(enhanced_sensitivity)

            logger.info(
                "Config loaded with schema-based sensitivity",
                agent_id=state["agent_id"],
                schema_sensitive_count=len(schema_sensitive_fields),
                global_rules_count=len(enhanced_sensitivity["globalRules"]),
                agent_rules_count=len(enhanced_sensitivity["agentRules"]),
                forbidden_fields_count=len(enhanced_sensitivity["forbiddenFields"])
            )

            return {
                "agent_config": config,
                "schema_metadata": schema,
                "sensitivity_rules": enhanced_sensitivity,
                "sql_dialect": config.get("dbType", "postgresql"),
                "current_step": "config_loaded"
            }
        except Exception as e:
            logger.error("Failed to load config", error=str(e))
            return {"error": f"Config load failed: {str(e)}", "current_step": "error"}

    async def refinement_detector(self, state: QueryState) -> Dict:
        """
        Detect if user message is a refinement of previous query or new query.
        Uses fast keyword matching first, then LLM for edge cases.
        Runs BEFORE nlu_router.
        """
        # If no thread_id, it's definitely a new query
        if not state.get("thread_id"):
            logger.info("No thread_id - treating as new query")
            return {
                "is_refinement": False,
                "current_step": "refinement_detected"
            }

        # If thread exists but no previous query, treat as new
        if not state.get("previous_query"):
            logger.info("Thread exists but no previous query - treating as new query")
            return {
                "is_refinement": False,
                "current_step": "refinement_detected"
            }

        # OPTIMIZATION: Fast keyword-based refinement detection
        # Check for obvious refinement keywords before calling LLM
        keyword_result = self._fast_refinement_check(state["user_message"])
        if keyword_result["is_obvious"]:
            logger.info(
                "Fast refinement detection",
                is_refinement=keyword_result["is_refinement"],
                detected_type=keyword_result.get("type"),
                reason="keyword_match"
            )
            if not keyword_result["is_refinement"]:
                # Obviously a new query based on keywords
                return {
                    "is_refinement": False,
                    "current_step": "refinement_detected"
                }
            # Otherwise, continue to LLM for detailed refinement analysis
        
        # Use LLM to detect refinement intent
        # Use LLM to detect refinement intent
        previous_query_str = json.dumps(state.get("previous_query", {}), indent=2)
        previous_sql = state.get("previous_sql", "N/A")
        
        # Extract previous user message
        # Priority 1: Use explicitly saved message from thread state
        # Priority 2: Extract from context (list of dicts with role/content)
        previous_user_message = state.get("previous_user_message")
        
        if not previous_user_message:
            context = state.get("context", [])
            if context:
                # Find the last message from user in history
                for msg in reversed(context):
                    if msg.get("role") == "user" and msg.get("content") != state["user_message"]:
                        previous_user_message = msg.get("content")
                        break
        
        if not previous_user_message:
            previous_user_message = "N/A"
        
        formatted_history = self._format_chat_history(state.get("context", []))
        logger.info("Refinement Detector: Formatted chat history", history_length=len(formatted_history))
        
        system_prompt = f"""You are analyzing if a user message is a refinement of a previous query.

Chat History:
{formatted_history}

Previous Query Details:
- User Message: {previous_user_message}
- Generated SQL: {previous_sql}

Current Message: {state["user_message"]}

Determine:
1. Is this a refinement/modification of the previous query?
2. If yes, what type of refinement? (filter, sort, limit, column selection, aggregation)
3. What specific changes are requested?
4. Does this refinement introduce NEW entities/tables not in the previous query?
5. **Refinement complexity**: Can this be done with direct SQL modification or does it need full regeneration?
6. **Direct SQL Check**: If the current message starts with "SELECT" and appears to be a complete SQL query, it is almost certainly a NEW QUERY or a total replacement, NOT a refinement, unless it's a very specific tweak that requires context from the previous query.

Return JSON:
{{
    "is_refinement": true/false,
    "refinement_type": "filter|sort|limit|columns|aggregation|null",
    "refinement_complexity": "simple|complex|null",
    "needs_schema_search": true/false,
    "new_entities": ["list of new table/entity names if any"],
    "changes": {{
        "add_filters": [],
        "remove_filters": [],
        "change_sort": {{"column": "column_name or alias", "order": "ascending|descending"}},
        "change_limit": null,
        "add_columns": [],
        "remove_columns": []
    }},
    "reasoning": "Brief explanation"
}}

**Refinement Complexity Classification**:

SIMPLE (direct SQL modification possible):
- Sort changes: "sort by descending" → modify ORDER BY clause
- Limit changes: "show only 10" → modify LIMIT clause
- Simple filter on existing columns: "only active" → add WHERE condition
- Remove filters: "show all" → remove WHERE conditions

COMPLEX (requires full query regeneration):
- New tables needed: "also show their orders" → needs JOIN
- New columns from other tables: "include supplier name" → schema search required
- Aggregation changes: "count instead of sum" → change GROUP BY logic
- Ambiguous requests: "make it better" → unclear intent

**IMPORTANT**: Set "needs_schema_search" to true if:
- User mentions entities/tables NOT in the previous query (e.g., "also show products" when previous was about users)
- User wants to join/combine data from new tables

Examples:

SIMPLE REFINEMENTS:
- "sort by date descending" → simple, refinement_type="sort", refinement_complexity="simple"
- "show top 10" → simple, refinement_type="limit", refinement_complexity="simple"
- "sort the result by descending order of contract count" → simple, refinement_type="sort", refinement_complexity="simple"

COMPLEX REFINEMENTS:
- "only active users" → complex (needs to identify correct WHERE clause), refinement_complexity="complex"
- "also show their orders" → complex, refinement_type="columns", refinement_complexity="complex", needs_schema_search=true
- "include product details" → complex, needs_schema_search=true, refinement_complexity="complex"

NEW QUERIES (not refinements):
- "show me orders instead" → is_refinement=false
- "what about products?" → is_refinement=false
"""
        
        try:
            logger.info("Detecting refinement intent", user_message=state["user_message"])
            response = await self._call_llm_with_logging(
                messages=[
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=state["user_message"])
                ],
                node_name="refinement_detector",
                query_history_id=state.get("query_history_id")
            )
            
            intent = self._parse_json_content(response.content)
            
            if not intent:
                logger.warning("Failed to parse refinement intent, defaulting to new query")
                return {
                    "is_refinement": False,
                    "current_step": "refinement_detected"
                }
            
            is_refinement = intent.get("is_refinement", False)
            needs_schema_search = intent.get("needs_schema_search", False)
            new_entities = intent.get("new_entities", [])
            refinement_complexity = intent.get("refinement_complexity", "complex")  # Default to complex for safety

            logger.info(
                "Refinement detection complete",
                is_refinement=is_refinement,
                refinement_type=intent.get("refinement_type"),
                refinement_complexity=refinement_complexity,
                needs_schema_search=needs_schema_search,
                new_entities=new_entities,
                changes=json.dumps(intent.get("changes", {})),
                reasoning=intent.get("reasoning")
            )

            # Bind context variable for logging
            structlog.contextvars.bind_contextvars(is_refinement=is_refinement)

            # Populate a default 'intent' if it's a refinement and no intent exists (nlu_router bypassed)
            # This ensures QUERY_BUILDER_SYSTEM_PROMPT doesn't show "User Intent: None"
            refinement_intent_summary = {
                "is_database_query": True,
                "intent": f"Refining previous query: {intent.get('reasoning', 'Applying requested modifications')}",
                "is_direct_sql": False
            }

            return {
                "is_refinement": is_refinement,
                "refinement_intent": intent if is_refinement else None,
                "intent": refinement_intent_summary if is_refinement else None,
                "refinement_complexity": refinement_complexity if is_refinement else None,
                "needs_schema_search": intent.get("needs_schema_search", False) if is_refinement else False,
                "new_entities": intent.get("new_entities", []) if is_refinement else [],
                "current_step": "refinement_detected"
            }
        except Exception as e:
            logger.error("Refinement detection failed", error=str(e))
            # Default to new query on error
            return {
                "is_refinement": False,
                "current_step": "refinement_detected"
            }

    async def query_modifier(self, state: QueryState) -> Dict:
        """
        Modify previous canonical query based on refinement intent.
        For SIMPLE refinements: route to sql_generator (skip query_builder LLM).
        For COMPLEX refinements: route to query_builder (use LLM for semantic understanding).
        """
        previous_query = state.get("previous_query", {})
        refinement = state.get("refinement_intent", {})
        complexity = state.get("refinement_complexity", "complex")

        if not previous_query or not refinement:
            logger.error("query_modifier called without previous_query or refinement_intent")
            return {"error": "Missing previous query or refinement intent", "current_step": "error"}

        logger.info("Modifying canonical query",
                    refinement_type=refinement.get("refinement_type"),
                    complexity=complexity)

        # Create a copy of previous query and apply modifications
        modified_query = dict(previous_query)
        changes = refinement.get("changes", {})

        # Apply modifications based on refinement type

        # Add filters
        if changes.get("add_filters"):
            if "filters" not in modified_query:
                modified_query["filters"] = []
            modified_query["filters"].extend(changes["add_filters"])
            logger.info("Added filters", count=len(changes["add_filters"]))

        # Remove filters
        # Remove filters
        if changes.get("remove_filters"):
            if "filters" in modified_query:
                remove_cols = set(changes["remove_filters"])
                # robustness: handle string filters (skip check) or dict filters
                modified_query["filters"] = [
                    f for f in modified_query["filters"]
                    if (isinstance(f, dict) and f.get("column") not in remove_cols) or isinstance(f, str)
                ]
                logger.info("Removed filters", count=len(changes["remove_filters"]))

        # Change sorting
        if changes.get("change_sort"):
            new_sort = changes["change_sort"]
            # Ensure order_by is always a list of dicts
            if isinstance(new_sort, dict) and new_sort: # Ignore empty dicts
                modified_query["order_by"] = [new_sort]
            elif isinstance(new_sort, list):
                modified_query["order_by"] = new_sort
            
            logger.info("Changed sorting", new_sort=modified_query.get("order_by"))

        # Change limit
        if changes.get("change_limit") is not None:
            modified_query["limit"] = changes["change_limit"]
            logger.info("Changed limit", new_limit=changes["change_limit"])

        # Add columns
        if changes.get("add_columns"):
            if "columns" not in modified_query:
                modified_query["columns"] = []
            
            # Normalize strings to dicts
            new_cols = []
            for col in changes["add_columns"]:
                if isinstance(col, str):
                    new_cols.append({"column": col, "alias": None, "aggregate": None})
                else:
                    new_cols.append(col)
            
            # If we are adding a raw wildcard (*), we can remove existing simple columns
            # to avoid redundancy like "SELECT email, *". 
            # We keep columns that have aliases or aggregates as they are "essential".
            if any(c.get("column") == "*" and not c.get("aggregate") and not c.get("alias") for c in new_cols):
                if "columns" in modified_query:
                    modified_query["columns"] = [
                        c for c in modified_query["columns"] 
                        if c.get("alias") or c.get("aggregate")
                    ]
                    logger.info("Wildcard added: removing redundant simple columns")

            modified_query["columns"].extend(new_cols)
            logger.info("Added columns", count=len(new_cols))

        # Remove columns
        if changes.get("remove_columns"):
            if "columns" in modified_query:
                remove_aliases = set(changes["remove_columns"])
                modified_query["columns"] = [
                    col for col in modified_query["columns"]
                    if isinstance(col, dict) and col.get("alias") not in remove_aliases
                ]
                logger.info("Removed columns", count=len(changes["remove_columns"]))

        # Determine routing: simple refinements skip query_builder, complex ones use it
        needs_search = state.get("needs_schema_search", False)
        is_simple = complexity == "simple"

        result = {
            "canonical_query": modified_query,
            "iteration_count": state.get("iteration_count", 1) + 1,
            "needs_schema_search": needs_search,
            "new_entities": state.get("new_entities", []),
            "skip_query_builder": is_simple,  # NEW: Flag to route simple refinements directly to sql_generator
            "current_step": "query_modified"
        }

        # CRITICAL: Always preserve relevant_schema for refinements
        # Even if we need schema search, preserve previous schema to combine with new results
        if state.get("relevant_schema"):
            result["relevant_schema"] = state["relevant_schema"]
            logger.info(
                "Preserving relevant_schema from previous query",
                relevant_tables=[t.get("name") for t in state["relevant_schema"]],
                will_search_new=needs_search,
                is_simple_refinement=is_simple
            )

        logger.info(
            "=== QUERY_MODIFIER RESULT ===",
            complexity=complexity,
            is_simple=is_simple,
            skip_query_builder=result["skip_query_builder"],
            needs_schema_search=result["needs_schema_search"],
            has_canonical_query=bool(result.get("canonical_query")),
            has_relevant_schema=bool(result.get("relevant_schema"))
        )

        return result

    async def nlu_router(self, state: QueryState) -> Dict:
        if state.get("error"): return {}
        
        schema_summary = self._build_schema_summary(state["schema_metadata"])
        custom_dict = state["agent_config"].get("customDictionary", {})
        
        custom_dict_str = json.dumps(custom_dict, indent=2)
        
        system_prompt = NLU_SYSTEM_PROMPT.format(
            schema_summary=schema_summary,
            custom_dict=custom_dict_str,
            chat_history=self._format_chat_history(state.get("context", []))
        )
        
        try:
            logger.info("Calling NLU LLM", task="intent_classification")
            response = await self._call_llm_with_logging(
                messages=[
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=state["user_message"])
                ],
                node_name="nlu_router",
                query_history_id=state.get("query_history_id")
            )
            
            logger.info("NLU response received", response=response.content)
            
            content = self._parse_json_content(response.content)
            
            # Handle empty response
            if not content:
                logger.error("Empty NLU response after parsing", llm_response=response.content[:500])
                # Default to treating as database query
                content = {
                    "is_database_query": True,
                    "is_data_guide_request": False,
                    "is_ambiguous": False,
                    "clarifying_questions": []
                }

            # Extract intent classification flags
            is_data_guide = content.get("is_data_guide_request", False)
            is_db_query = content.get("is_database_query", True)
            is_direct_sql = content.get("is_direct_sql", False)
            is_readonly_sql = content.get("is_readonly_sql", True)

            # Manual safety fallback (regex/keywords)
            msg_upper = state["user_message"].upper()
            forbidden_keywords = ["UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "INSERT ", "ALTER ", "CREATE "]
            has_forbidden = any(k in msg_upper for k in forbidden_keywords)
            
            # If the LLM missed it or if it's obvious direct SQL that is forbidden
            if has_forbidden:
                is_readonly_sql = False
                is_direct_sql = True

            # Safety check: if direct SQL is detected but it's not readonly, block it immediately
            if is_direct_sql and not is_readonly_sql:
                logger.warning("Unsafe SQL detected", query=state["user_message"])
                return {
                    "error": "Only SELECT queries are allowed for security reasons. Please rephrase your query.",
                    "intent": content,
                    "is_direct_sql": True,
                    "current_step": "error"
                }

            # If data guide request, it's not off-topic and not a query
            is_off_topic = not is_db_query and not is_data_guide and not is_direct_sql

            logger.info(
                "Intent classified",
                is_data_guide_request=is_data_guide,
                is_database_query=is_db_query,
                is_direct_sql=is_direct_sql,
                is_readonly_sql=is_readonly_sql,
                is_off_topic=is_off_topic,
                is_ambiguous=content.get("is_ambiguous", False)
            )

            return {
                "intent": content,
                "is_data_guide_request": is_data_guide,
                "is_direct_sql": is_direct_sql,
                "is_off_topic": is_off_topic,
                "is_ambiguous": content.get("is_ambiguous", False),
                "clarifying_questions": content.get("clarifying_questions", []),
                "current_step": "intent_analyzed"
            }
        except Exception as e:
            logger.error("NLU router failed", error=str(e), error_type=type(e).__name__)
            # Default to treating as database query on error
            return {
                "intent": {"is_database_query": True, "is_ambiguous": False},
                "is_off_topic": False,
                "is_ambiguous": False,
                "clarifying_questions": [],
                "current_step": "intent_analyzed"
            }

    async def guardrail_responder(self, state: QueryState) -> Dict:
        """Handle off-topic messages with special cases for greetings"""
        user_message = state.get("user_message", "").lower().strip()

        # Detect greetings - common greeting patterns
        greeting_patterns = [
            "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
            "greetings", "howdy", "hiya", "sup", "what's up", "whats up",
            "yo", "hola", "bonjour", "namaste"
        ]

        # Check if message is a greeting
        is_greeting = any(
            user_message == pattern or
            user_message.startswith(pattern + " ") or
            user_message.startswith(pattern + "!") or
            user_message.startswith(pattern + ",")
            for pattern in greeting_patterns
        )

        if is_greeting:
            # Generate dynamic examples from actual schema
            try:
                schema_metadata = state.get("schema_metadata", {})
                examples = self._generate_example_queries(schema_metadata, count=3)

                if examples:
                    example_list = "\n".join([f"- \"{ex}\"" for ex in examples])
                    response = f"""Hello! 👋 I'm your database query assistant. I can help you explore and analyze your data using natural language.

Try asking me things like:
{example_list}

What would you like to know about your data?"""
                else:
                    # Fallback if no schema available
                    response = """Hello! 👋 I'm your database query assistant. I can help you explore and analyze your data using natural language.

What would you like to know about your data?"""
            except Exception as e:
                logger.error("Failed to generate greeting examples", error=str(e))
                # Fallback response
                response = """Hello! 👋 I'm your database query assistant. I can help you explore and analyze your data using natural language.

What would you like to know about your data?"""
        else:
            # Standard off-topic response
            response = "I can only help you with database queries. Please ask a question about your data."

        return {
            "final_response": response,
            "current_step": "guardrail_response",
            "is_off_topic": True,
            "data_fetched": False  # No query execution for greetings
        }

    async def no_match_responder(self, state: QueryState) -> Dict:
        """Handle cases where schema search finds no relevant tables"""
        response = "I don't have any such matching data. Can you try asking relevant question."
        
        return {
            "final_response": response,
            "current_step": "no_match_response",
            "error": "No relevant schema found"
        }

    async def clarification_responder(self, state: QueryState) -> Dict:
        questions = state.get("clarifying_questions", [])
        if not questions:
            response = "I'm not sure what you mean. Could you please clarify?"
        else:
            response = "I need a bit more information to help you:\n" + "\n".join([f"- {q}" for q in questions])

        # Append data guide to help user understand what can be queried
        try:
            data_guide = await self._generate_data_guide_text(state)
            if data_guide:
                response += "\n\n---\n\n**To help you, here is a guide on what data is available:**\n\n" + data_guide
        except Exception as e:
            logger.error("Failed to append data guide to clarification", error=str(e))

        return {"final_response": response, "current_step": "complete"}

    async def _generate_data_guide_text(self, state: QueryState) -> str:
        """Helper to generate natural language data guide text using LLM."""
        schema_metadata = state.get("schema_metadata")
        if not schema_metadata:
            return ""

        agent_config = state.get("agent_config", {})
        user_message = state.get("user_message", "Show me what data is available")

        # Build natural language schema description
        guide_context = self._build_data_guide_context(schema_metadata, agent_config)

        # Get agent name
        agent_name = agent_config.get("name", "Database Assistant")

        # Create prompt for LLM to generate user-friendly explanation
        from agent.prompts import DATA_GUIDE_SYSTEM_PROMPT
        system_prompt = DATA_GUIDE_SYSTEM_PROMPT.format(
            guide_context=guide_context,
            agent_name=agent_name
        )

        logger.info("Calling LLM for data guide text generation", agent_name=agent_name)

        response = await self._call_llm_with_logging(
            messages=[
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_message)
            ],
            node_name="data_guide_generator",
            query_history_id=state.get("query_history_id")
        )

        return response.content

    async def data_guide_responder(self, state: QueryState) -> Dict:
        """
        Responds to meta-questions about what data is available.
        Converts technical schema into natural language guide with examples.
        No SQL execution - pure conversational guidance.
        """
        try:
            final_response = await self._generate_data_guide_text(state)
            
            if not final_response:
                final_response = "I'm here to help you explore your data. What would you like to know?"

            logger.info("Data guide response generated")

            return {
                "final_response": final_response,
                "current_step": "complete",
                "data_fetched": False  # No query execution
            }

        except Exception as e:
            logger.error("Data guide generation failed", error=str(e), error_type=type(e).__name__)
            # Fallback response
            return {
                "final_response": "I'm here to help you explore your data. Could you please rephrase your question?",
                "current_step": "complete",
                "data_fetched": False,
                "error": f"Data guide failed: {str(e)}"
            }

    async def schema_search(self, state: QueryState) -> Dict:
        import re
        import difflib
        
        # # TEMPORARY: Disable schema search for testing
        # # Returning empty relevant_schema with no_match=False forces _build_schema_context 
        # # to use the FULL schema_metadata.
        # logger.warning("SCHEMA SEARCH DISABLED - USING FULL SCHEMA FOR TESTING")
        # return {
        #      "relevant_schema": [],
        #      "current_step": "schema_searched",
        #      "no_match": False
        # }
        
        try:
            # OPTIMIZATION: If relevant_schema already in state (from query_modifier preserving it),
            # skip schema search entirely. This prevents schema bloat for simple refinements.
            if state.get("relevant_schema") and state.get("is_refinement"):
                logger.info(
                    "Skipping schema search - using preserved relevant_schema from refinement",
                    relevant_tables=[t.get("name") for t in state["relevant_schema"]]
                )
                return {
                    "relevant_schema": state["relevant_schema"],
                    "current_step": "schema_seschema_seararched",
                    "no_match": False
                }

            # Determine search query based on context
            # Determine search query based on context
            is_refinement = state.get("is_refinement", False)
            new_entities = state.get("new_entities", [])
            user_message = state["user_message"]

            if is_refinement:
                # Extract previous user message to provide context
                previous_user_message = ""
                context = state.get("context", [])
                if context:
                    for msg in reversed(context):
                        if msg.get("role") == "user" and msg.get("content") != user_message:
                            previous_user_message = msg.get("content")
                            break
                
                # Combined query improves vector search quality for short refinements
                # e.g., "what about last month?" -> "Show me sales. what about last month?"
                if previous_user_message:
                    search_query = f"{previous_user_message} {user_message}"
                else:
                    search_query = user_message

                # If specific new entities were detected, append them to boost relevance
                if new_entities:
                    entity_str = " ".join(new_entities)
                    if entity_str not in search_query:
                         search_query += f" {entity_str}"
                
                logger.info("=== SCHEMA SEARCH (Refinement) ===", 
                            original_query=user_message,
                            context_query=search_query,
                            new_entities=new_entities)
            else:
                # For new queries, use full user message
                search_query = user_message
                logger.info("=== SCHEMA SEARCH ===", user_query=search_query)

            # --- 1. Vector Search ---
            query_embedding = await self.embedding_service.generate_single_embedding(search_query)
            vector_results = []

            if query_embedding:
                raw_vector_results = await self.system_db.search_similar_vectors(
                    state["agent_id"],
                    query_embedding,
                    limit=20  # IMPROVED: Increased from 10 to get more candidates
                )

                # Filter results by similarity threshold (tables only)
                # IMPROVED: Higher thresholds to filter false positives
                TABLE_SIMILARITY_THRESHOLD = 0.5   # Tables need strong semantic match

                if isinstance(raw_vector_results, list):
                    filtered_results = []
                    for r in raw_vector_results:
                        target_type = r.get("target_type", "")
                        similarity = r.get("similarity", 0)
                        
                        # Strict Table-Centric Search: Ignore column matches
                        if target_type != "table":
                            continue

                        if similarity >= TABLE_SIMILARITY_THRESHOLD:
                            filtered_results.append(r)

                    vector_results = filtered_results
                    logger.info(
                        "Vector search results (Tables Only)",
                        raw_count=len(raw_vector_results),
                        filtered_count=len(vector_results),
                        table_threshold=TABLE_SIMILARITY_THRESHOLD
                    )

            # --- 2. Keyword/Fuzzy Hybrid Search ---
            # Extract potential tokens from user message
            tokens = set(re.findall(r'\w+', user_message.lower()))
            
            all_tables = state["schema_metadata"].get("tables", [])
            keyword_matches = []
            
            for table in all_tables:
                table_name = table.get("name", "")
                table_name_lower = table_name.lower()
                
                # Check for exact token match
                if table_name_lower in tokens:
                    keyword_matches.append(table)
                    logger.info("Exact keyword match found", table=table_name)
                    continue
                
                # Check for strong fuzzy match against tokens
                # We check if any token is highly similar to the table name
                for token in tokens:
                    if len(token) < 3: continue # Skip short tokens
                    ratio = difflib.SequenceMatcher(None, token, table_name_lower).ratio()
                    if ratio > 0.85: # Strong fuzzy match
                        keyword_matches.append(table)
                        logger.info("Fuzzy keyword match found", table=table_name, token=token, ratio=ratio)
                        break

            # --- 3. Weighted Scoring and Merging ---
            # Score each table based on match quality and type
            # Higher scores = more relevant tables
            table_scores = {}  # table_name -> score
            table_by_name = {t.get("name", "").lower(): t for t in all_tables}

            # If it's a refinement, start with existing relevant schema (max score)
            if is_refinement and state.get("relevant_schema"):
                for t in state["relevant_schema"]:
                    table_scores[t.get("name")] = 1000.0  # Maximum score for preserved tables

            # Score vector results
            for r in vector_results:
                metadata = r.get("metadata", {})
                if isinstance(metadata, str):
                    try: metadata = json.loads(metadata)
                    except: metadata = {}

                target_type = r.get("target_type", "")
                t_name = None

                if target_type == "table":
                    t_name = metadata.get("table_name")
                elif target_type == "column":
                    t_name = metadata.get("table_name")

                if t_name and t_name.lower() in table_by_name:
                    similarity = r.get("similarity", 0)

                    # Calculate weighted score
                    if target_type == "table":
                        # Direct table match: highest weight
                        score = similarity * 10.0
                    else:
                        score = 0.0

                    # Accumulate scores (tables can match multiple times)
                    current_score = table_scores.get(t_name, 0)
                    table_scores[t_name] = current_score + score

            # Score keyword matches (direct table name matches)
            for t in keyword_matches:
                t_name = t.get("name")
                # Direct keyword match on table name: very high score
                current_score = table_scores.get(t_name, 0)
                table_scores[t_name] = current_score + 15.0  # Higher than vector matches

            # Sort tables by score (descending) and take top 10
            sorted_tables = sorted(
                table_scores.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10]

            logger.info(
                "Weighted schema scoring complete",
                total_scored=len(table_scores),
                top_10_scores=[(name, f"{score:.2f}") for name, score in sorted_tables[:10]]
            )

            # Convert back to table objects
            final_relevant_tables = []
            for table_name, score in sorted_tables:
                if table_name.lower() in table_by_name:
                    final_relevant_tables.append(table_by_name[table_name.lower()])
                elif table_name in table_by_name:
                    final_relevant_tables.append(table_by_name[table_name])
            
            logger.info(
                "Hybrid search complete",
                vector_count=len(vector_results),
                keyword_count=len(keyword_matches),
                merged_count=len(final_relevant_tables),
                tables=[t.get("name") for t in final_relevant_tables]
            )

            # --- 4. Multi-Hop FK Relationship Expansion (NEW) ---
            # Automatically include related tables via FK relationships
            if final_relevant_tables:
                final_relevant_tables = self._expand_with_related_tables(
                    final_relevant_tables,
                    all_tables,
                    state["schema_metadata"]
                )

                logger.info(
                    "After FK relationship expansion",
                    final_count=len(final_relevant_tables),
                    tables=[t.get("name") for t in final_relevant_tables]
                )

            if not final_relevant_tables:
                return {
                    "relevant_schema": [],
                    "current_step": "schema_searched",
                    "no_match": True
                }

            # --- 5. Schema Combining for Refinements (NEW) ---
            # For complex refinements that need new entities, combine previous schema with new results
            if state.get("is_refinement") and state.get("relevant_schema"):
                # Complex refinement: combine previous schema + new search results
                previous_tables = {t["name"]: t for t in state["relevant_schema"]}
                new_tables = {t["name"]: t for t in final_relevant_tables}

                # Merge: previous tables + new tables (avoid duplicates by name)
                combined = list(previous_tables.values())
                for table_name, table_data in new_tables.items():
                    if table_name not in previous_tables:
                        combined.append(table_data)

                logger.info(
                    "Combined previous schema with new search results for complex refinement",
                    previous_count=len(previous_tables),
                    new_count=len(new_tables),
                    combined_count=len(combined),
                    previous_tables=list(previous_tables.keys()),
                    new_tables=list(new_tables.keys())
                )

                final_relevant_tables = combined[:25]  # Limit combined schema to top 25 tables
            else:
                # New query: use only search results (already filtered by FK expansion)
                final_relevant_tables = final_relevant_tables[:25]  # Limit to top 25 for new queries

            return {
                "relevant_schema": final_relevant_tables,
                "current_step": "schema_searched",
                "no_match": False
            }
            
        except Exception as e:
            logger.error("Schema search failed", error=str(e), error_type=type(e).__name__)

            # CRITICAL: For refinements, preserve previous schema instead of using full schema
            if state.get("is_refinement") and state.get("relevant_schema"):
                fallback = state["relevant_schema"]  # Preserve previous schema
                logger.warning("Schema search failed during refinement, using preserved schema",
                              preserved_tables=[t.get("name") for t in fallback])
            else:
                fallback = state["schema_metadata"].get("tables", [])  # Full schema for new queries
                logger.warning("Schema search failed, using full schema as fallback")

            return {
                "relevant_schema": fallback,
                "current_step": "schema_searched",
                "schema_search_failed": True  # NEW: Track failure
            }

    async def query_builder(self, state: QueryState) -> Dict:
        logger.info("=== QUERY BUILDER ===", 
                    user_message=state["user_message"], 
                    query_history_id=state.get("query_history_id"))

        # Use imported audit_service
        # audit_service already imported at top level

        schema_context = self._build_schema_context(state)
        logger.info("Schema context built", context_length=len(schema_context))

        # Extract custom prompts relevant to the user query
        custom_prompts = self._extract_custom_prompts(
            state["schema_metadata"],
            state["user_message"]
        )

        if custom_prompts:
            logger.info("Custom prompts found", prompts_length=len(custom_prompts))

        # Escape curly braces in schema_context to prevent format() KeyError
        # Schema descriptions may contain JSON examples with {}, which .format() interprets as placeholders
        schema_context_escaped = schema_context.replace("{", "{{").replace("}", "}}")
        
        formatted_history = self._format_chat_history(state.get("context", []))
        logger.info("Query Builder: Formatted chat history", history_length=len(formatted_history))

        system_prompt = QUERY_BUILDER_SYSTEM_PROMPT.format(
            schema_context=schema_context_escaped,
            intent=state["intent"],
            dialect=state["sql_dialect"],
            chat_history=formatted_history,
            current_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )

        # Append custom prompts if found
        if custom_prompts:
            system_prompt += custom_prompts

        # Prepare for logging
        start_time = datetime.now()
        llm_config = {
            "model": getattr(self.llm, "model_name", getattr(self.llm, "model", "unknown")),
            "temperature": getattr(self.llm, "temperature", 0.0) # Default to 0 if not accessible
        }

        try:
            logger.info("Calling LLM for canonical query generation", dialect=state["sql_dialect"])
            
            # Use structured output with the Pydantic model
            # This enforces the schema at the LLM level (if supported) or via parsing
            from agent.models import QueryStructure
            
            structured_llm = self.llm.with_structured_output(QueryStructure, include_raw=True)
            
            # Context injection for refinement
            user_content = state["user_message"]
            if state.get("is_refinement") and state.get("canonical_query"):
                 import json
                 prev_query_str = json.dumps(state["canonical_query"], indent=2)
                 user_content += f"\n\n[CONTEXT] This is a refinement of the following query:\n{prev_query_str}\nMaintain the existing query structure (grouping, filtering) unless explicitly asked to change it."
                 logger.info("Injected previous query context for refinement")

            logger.info("###########Query Builder SYstem Prompt#############", prompt=system_prompt)
            logger.info("###########Query Builder Human Prompt#############", Human=user_content)
            result = await structured_llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_content)
            ])
            
            # Extract parsed output and raw response (for metadata)
            response = result["parsed"]
            raw_response = result["raw"]
            
            if not response:
                logger.warning("LLM failed to build query structure", raw_response=raw_response)
                return {"error": "I couldn't translate that into a valid database query. Please try rephrasing."}

            canonical_query = response.model_dump()
            correction_note = response.correction_note
            
            logger.info("Canonical query built", canonical_query=canonical_query, correction_note=correction_note)
            if state.get("query_history_id"):
                end_time = datetime.now()
                duration_ms = int((end_time - start_time).total_seconds() * 1000)
                
                # Attempt to extract token usage from raw response
                # Note: structured_llm returns a Message or LLMResult object in 'raw'
                token_usage = None
                
                # Priority 1: Check standardized usage_metadata (LangChain standard)
                if hasattr(raw_response, "usage_metadata") and raw_response.usage_metadata:
                    usage = raw_response.usage_metadata
                    token_usage = {
                         "prompt_tokens": usage.get("input_tokens", usage.get("prompt_tokens")),
                         "completion_tokens": usage.get("output_tokens", usage.get("completion_tokens")),
                         "total_tokens": usage.get("total_tokens")
                    }
                
                # Priority 2: Check response_metadata (Provider specific, e.g. OpenAI uses 'token_usage')
                if not token_usage and hasattr(raw_response, "response_metadata"):
                     meta = raw_response.response_metadata
                     # OpenAI often puts it in 'token_usage', others might use 'usage'
                     usage = meta.get("token_usage") or meta.get("usage") or {}
                     if usage:
                        token_usage = {
                             "prompt_tokens": usage.get("prompt_tokens"),
                             "completion_tokens": usage.get("completion_tokens"),
                             "total_tokens": usage.get("total_tokens")
                        }

                
                logger.info("🔍 [DEBUG] Attempting to log LLM call", 
                            query_history_id=str(state.get("query_history_id")),
                            has_response_metadata=hasattr(response, "response_metadata"))

                try:
                    await audit_service.log_llm_call(
                        query_history_id=state["query_history_id"],
                        node_name="query_builder",
                        llm_provider=self.agent_config.get("llmProvider", "openai") if self.agent_config else "openai",
                        llm_model=llm_config["model"],
                        system_prompt=system_prompt,
                        prompt=user_content,
                        response=str(response.model_dump()),
                        llm_config=llm_config,
                        token_usage=token_usage,
                        duration_ms=duration_ms
                    )
                    logger.info("✅ [DEBUG] LLM call logged successfully")
                except Exception as log_err:
                    logger.error("❌ [DEBUG] Failed to log LLM call", error=str(log_err), type=type(log_err).__name__)
            
            # Store the Pydantic model dump (dict) in state
            return {
                "canonical_query": response.model_dump(), 
                "correction_note": response.correction_note,
                "current_step": "query_built"
            }
            
        except Exception as e:
            logger.error("Query builder failed", error=str(e), error_type=type(e).__name__)
            
            # Log error to audit service
            if state.get("query_history_id"):
                end_time = datetime.now()
                duration_ms = int((end_time - start_time).total_seconds() * 1000)
                
                await audit_service.log_llm_call(
                    query_history_id=state["query_history_id"],
                    node_name="query_builder",
                    llm_provider=self.agent_config.get("llmProvider", "openai") if self.agent_config else "openai",
                    llm_model=llm_config["model"],
                    system_prompt=system_prompt,
                    prompt=user_content if 'user_content' in locals() else state["user_message"],
                    response=None,
                    llm_config=llm_config,
                    token_usage=None,
                    duration_ms=duration_ms,
                    error=str(e)
                )

            return {"error": f"Failed to build query: {str(e)}"}

    async def schema_validator(self, state: QueryState) -> Dict:
        """
        Validate and auto-correct canonical query using SchemaValidator module.
        Fixes hallucinated table/column names and incorrect JOIN conditions.
        """
        if state.get("error"):
            return {}
        
        try:
            canonical_query = state.get("canonical_query")
            if not canonical_query:
                return {"current_step": "schema_validated"}
            
            schema = state.get("schema_metadata", {})
            
            logger.info("=== SCHEMA VALIDATOR ===", canonical_query=canonical_query)
            
            # 1. Enforce queryability early to prevent technical validation errors for restricted tables
            filtered_query, queryability_warnings = self._enforce_queryability(
                canonical_query,
                schema
            )
            
            # Check if all tables were removed (primary table and no joins)
            p_ref = filtered_query.get("primary_table")
            p_name = p_ref.get("name", "").lower() if isinstance(p_ref, dict) else str(p_ref or "").lower()
            
            # If the primary table in filtered query is same as original BUT it's non-queryable,
            # it means we couldn't swap it and no queryable tables exist.
            # actually, _enforce_queryability should tell us.
            
            # Better check: did we remove the primary table and fail to replace it?
            original_p = canonical_query.get("primary_table", {})
            original_p_name = original_p.get("name", "").lower() if isinstance(original_p, dict) else str(original_p).lower()
            
            # Build queryable map for check
            table_queryable = {
                t.get('name', t.get('tableName', '')).lower(): t.get("isQueryable", True)
                for t in schema.get("tables", [])
            }
            
            if not table_queryable.get(p_name, True):
                # No queryable tables found at all
                error_msg = f"The table '{p_name}' is not accessible."
                return {
                    "error": error_msg,
                    "queryability_warnings": queryability_warnings,
                    "current_step": "schema_validated",
                    "final_response": f"I'm sorry, but I'm not allowed to access the data in the '{p_name}' table per organization policy. Please ask about other available information."
                }
            
            # Update canonical_query if it was partially filtered (e.g. some joins removed)
            # but primary table is still valid
            canonical_query = filtered_query

            
            # Use SchemaValidator module with agent_id for embedding cache
            result = await self._schema_validator_service.validate(
                canonical_query, 
                schema,
                agent_id=state["agent_id"]
            )
            
            # Check for critical validation errors (unresolvable hallucinations)
            if result.get("validation_errors"):
                error_msg = f"Schema validation failed: {'; '.join(result['validation_errors'])}"
                logger.warning("Critical schema validation errors", errors=result["validation_errors"])
                return {
                    "error": error_msg,
                    "current_step": "schema_validated",
                    "final_response": f"I couldn't process this query because: {result['validation_errors'][0]}\nPlease check the table names or ask about available data."
                }
            
            if result["has_corrections"]:
                logger.info(
                    "Schema validation: corrections applied",
                    corrections_count=len(result["corrections"]),
                    details=result["corrections"]
                )
                # Context Pinning: Restrict relevant_schema to strictly query tables
                final_query = result["corrected_query"]
                used_tables = self._extract_tables_from_query(final_query)
                all_tables = state.get("schema_metadata", {}).get("tables", [])
                pinned_schema = [t for t in all_tables if t.get("name") and t.get("name").lower() in used_tables]

                logger.info(
                    "Context pinned after corrections",
                    used_tables=list(used_tables),
                    all_tables_count=len(all_tables),
                    all_tables_names=[t.get("name") for t in all_tables if t.get("name")],
                    pinned_schema_count=len(pinned_schema),
                    pinned_tables=[t.get("name") for t in pinned_schema]
                )

                return {
                    "canonical_query": final_query,
                    "schema_corrections": result["corrections"],
                    "queryability_warnings": queryability_warnings,
                    "pinned_schema": pinned_schema, # Pin the context strictly for correction
                    "current_step": "schema_validated"
                }
            
            # Context Pinning: Restrict relevant_schema to strictly query tables
            used_tables = self._extract_tables_from_query(canonical_query)
            all_tables = state.get("schema_metadata", {}).get("tables", [])
            pinned_schema = [t for t in all_tables if t.get("name") and t.get("name").lower() in used_tables]

            logger.info(
                "Schema validation: no corrections needed (Context pinned)",
                used_tables=list(used_tables),
                all_tables_count=len(all_tables),
                all_tables_names=[t.get("name") for t in all_tables if t.get("name")],
                pinned_schema_count=len(pinned_schema),
                pinned_tables=[t.get("name") for t in pinned_schema]
            )
            return {
                "schema_corrections": [],
                "queryability_warnings": queryability_warnings,
                "pinned_schema": pinned_schema, # Pin the context strictly for correction
                "current_step": "schema_validated"
            }
            
        except Exception as e:
            logger.error("Schema validation failed", error=str(e))
            # Don't fail the pipeline, just log and continue
            return {"schema_corrections": [], "current_step": "schema_validated"}


    async def sql_generator(self, state: QueryState) -> Dict:
        if state.get("error"): return {}
        try:
            # Ensure canonical_query is a dict (might be JSON string from thread state)
            canonical_query = state["canonical_query"]
            if isinstance(canonical_query, str):
                import json
                canonical_query = json.loads(canonical_query)
                logger.info("Deserialized canonical_query from JSON string")

            # Ensure schema_metadata is a dict (might be JSON string from thread state)
            schema_metadata = state.get("schema_metadata", {})
            if isinstance(schema_metadata, str):
                import json
                schema_metadata = json.loads(schema_metadata)
                logger.info("Deserialized schema_metadata from JSON string")

            logger.info("=== SQL GENERATOR ===", canonical_query=canonical_query)

            # Enforce data queryability: strip non-queryable tables and columns
            filtered_query, pre_warnings = self._enforce_queryability(
                canonical_query,
                schema_metadata
            )

            sql = self.dialect_translator.generate_sql(
                filtered_query,
                state["sql_dialect"],
                schema_metadata  # Pass schema for boolean column detection
            )
            logger.info("SQL generated", sql=sql, dialect=state["sql_dialect"])
            return {
                "canonical_query": filtered_query,
                "generated_sql": sql,
                "queryability_warnings": pre_warnings, # Track warnings from filtering
                "current_step": "sql_generated"
            }
        except Exception as e:
            logger.error("SQL generation failed", error=str(e), canonical_query=state.get("canonical_query"))
            return {"error": f"SQL generation failed: {str(e)}"}

    async def sql_validator_node(self, state: QueryState) -> Dict:
        if not state.get("generated_sql"):
            return {"error": "No SQL to validate", "current_step": "error"}

        # Extract forbidden fields from sensitivity rules
        forbidden_fields = state.get("sensitivity_rules", {}).get("forbiddenFields", [])

        # Basic SQL validation (security, forbidden fields)
        validation = self.sql_validator.validate(
            state["generated_sql"],
            dialect=state.get("sql_dialect", "postgresql"),
            forbidden_fields=forbidden_fields
        )

        # Check queryability (collect warnings)
        queryability_warnings = self._check_queryability_warnings(
            state["generated_sql"],
            state["schema_metadata"]
        )

        return {
            "validation_result": validation,
            "queryability_warnings": queryability_warnings,
            "current_step": "validated"
        }

    async def sql_corrector(self, state: QueryState) -> Dict:
        """
        Dedicated node to repair invalid SQL using LLM expertise.
        Called on validation or execution failure.
        """
        # Get per-message correction iteration counter
        correction_iteration = state.get("correction_iteration", 0)
        global_iteration = state.get("iteration_count", 0)

        logger.info(
            "=== SQL CORRECTOR ===",
            correction_iteration=correction_iteration,
            global_iteration=global_iteration
        )

        # Debug: Check what's in the state
        logger.info(
            "SQL Corrector state check",
            has_pinned_schema=bool(state.get("pinned_schema")),
            has_relevant_schema=bool(state.get("relevant_schema")),
            pinned_schema_type=type(state.get("pinned_schema")).__name__ if state.get("pinned_schema") is not None else "None",
            relevant_schema_count=len(state.get("relevant_schema", [])),
            pinned_schema_count=len(state.get("pinned_schema", [])) if state.get("pinned_schema") else 0
        )

        # 1. State/Iteration Check (use per-message correction counter)
        # Allow up to 2 correction attempts per message (total 3 attempts including initial)
        MAX_CORRECTION_RETRIES = 2
        if correction_iteration >= MAX_CORRECTION_RETRIES:
            logger.warning(
                "Max SQL correction retries reached for this message",
                correction_iteration=correction_iteration,
                max_retries=MAX_CORRECTION_RETRIES
            )
            return {
                "error": f"Failed to correct SQL after {MAX_CORRECTION_RETRIES} attempts. Original error: {state.get('error')}",
                "current_step": "sql_correction_failed"
            }

        # Use imported audit_service
        start_time = datetime.now()
        llm_config = {
            "model": getattr(self.llm, "model_name", getattr(self.llm, "model", "unknown")),
            "temperature": getattr(self.llm, "temperature", 0.0)
        }

        # Log which schema is being used for correction
        schema_source = "pinned" if state.get("pinned_schema") else ("relevant" if state.get("relevant_schema") else "full")
        logger.info(
            "Building schema context for SQL correction",
            schema_source=schema_source,
            pinned_tables=[t.get("name") for t in state.get("pinned_schema", [])][:5] if state.get("pinned_schema") else None
        )

        schema_context = self._build_schema_context(state)
        # Escape curly braces to prevent format() KeyError
        schema_context_escaped = schema_context.replace("{", "{{").replace("}", "}}")
        
        system_prompt = SQL_CORRECTOR_SYSTEM_PROMPT.format(
            dialect=state["sql_dialect"],
            current_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            schema_context=schema_context_escaped,
            failed_sql=state.get("generated_sql", "No SQL generated"),
            error_message=state.get("error", "Unknown error")
        )

        logger.info("Calling LLM for SQL correction", error_preview=str(state.get("error"))[:100])
        
        try:
            # Fix: Use specialized SQLCorrection model
            from agent.models import SQLCorrection
            structured_llm = self.llm.with_structured_output(SQLCorrection, include_raw=True)
            
            result = await structured_llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Please fix the SQL query above based on the error: {state.get('error')}")
            ])

            response = result.get("parsed")
            raw_response = result.get("raw")

            if not response or not response.generated_sql:
                return {"error": "LLM failed to provide a corrected SQL query."}

            # Auditing
            if state.get("query_history_id"):
                end_time = datetime.now()
                duration_ms = int((end_time - start_time).total_seconds() * 1000)
                
                token_usage = None
                if result and hasattr(result, "get"):
                    raw_response = result.get("raw")
                    if raw_response and hasattr(raw_response, "usage_metadata") and raw_response.usage_metadata:
                        usage = raw_response.usage_metadata
                        token_usage = {
                             "prompt_tokens": usage.get("input_tokens", usage.get("prompt_tokens")),
                             "completion_tokens": usage.get("output_tokens", usage.get("completion_tokens")),
                             "total_tokens": usage.get("total_tokens")
                        }

                try:
                    await audit_service.log_llm_call(
                        query_history_id=state["query_history_id"],
                        node_name="sql_corrector",
                        llm_provider=self.agent_config.get("llmProvider", "openai") if self.agent_config else "openai",
                        llm_model=llm_config["model"],
                        system_prompt=system_prompt,
                        prompt=f"Failed SQL: {state.get('generated_sql')}\nError: {state.get('error')}",
                        response=str(response.model_dump()),
                        llm_config=llm_config,
                        token_usage=token_usage,
                        duration_ms=duration_ms
                    )
                except Exception as log_err:
                    logger.error("Failed to log SQL correction LLM call", error=str(log_err))

            logger.info("SQL corrected successfully", 
                        correction=response.correction_note,
                        sql_preview=response.generated_sql[:50])
            
            return {
                "generated_sql": response.generated_sql,
                "correction_note": response.correction_note,
                "iteration_count": global_iteration + 1,  # Increment global counter
                "correction_iteration": correction_iteration + 1,  # Increment per-message counter
                "error": None, # Clear error for retry
                "current_step": "sql_corrected"
            }

        except Exception as e:
            logger.error("SQL correction failed", error=str(e))
            return {"error": f"SQL correction process failed: {str(e)}"}

    async def sql_executor(self, state: QueryState) -> Dict:
        try:
            conn_details = await self.system_db.get_connection_details(state["agent_id"])
            executor = SQLExecutor(conn_details)
            
            # Use VALIDATION ONLY - do not fetch data
            validation = await executor.validate(state["generated_sql"])
            
            if not validation["valid"]:
                return {"error": f"Query validation failed: {validation['error']}"}
            
            logger.info("SQL validated successfully", sql_preview=state["generated_sql"][:50])
            
            # Return empty results but mark as validated
            return {
                "raw_results": [], 
                "current_step": "executed",
                "data_fetched": False,
                "validation_success": True
            }
        except Exception as e:
            logger.error("Execution/Validation failed", error=str(e))
            return {"error": f"Execution failed: {str(e)}"}

    def _make_json_serializable(self, obj):
        """Convert non-JSON-serializable types to serializable formats"""
        from uuid import UUID
        from datetime import datetime, date
        from decimal import Decimal
        
        if isinstance(obj, UUID):
            return str(obj)
        elif isinstance(obj, (datetime, date)):
            return obj.isoformat()
        elif isinstance(obj, Decimal):
            return float(obj)
        elif isinstance(obj, bytes):
            return obj.decode('utf-8', errors='replace')
        elif isinstance(obj, dict):
            return {k: self._make_json_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [self._make_json_serializable(item) for item in obj]
        else:
            return obj

    async def sanitizer(self, state: QueryState) -> Dict:
        """Sanitize results: apply sensitivity masking AND filter non-queryable columns"""
        # First, apply sensitivity masking
        sanitized = self.sensitivity_registry.sanitize_results(
            state["raw_results"],
            state["sensitivity_rules"]
        )
        
        # Then, filter out non-queryable columns
        if state.get("queryability_warnings"):
            sanitized = self._filter_non_queryable_columns(
                sanitized,
                state["queryability_warnings"],
                state["schema_metadata"]
            )
        
        # Finally, ensure all values are JSON-serializable
        sanitized = self._make_json_serializable(sanitized)
        
        return {
            "sanitized_results": sanitized,  # RETURN THE RESULTS!
            "current_step": "sanitized",
            "result_type": "table"
        }

    async def response_composer(self, state: QueryState) -> Dict:
        # Don't need result count since frontend will fetch in real-time
        # Return empty string for success - table component will be the primary display
        response_text = ""
        
        # Include correction note if query was auto-corrected from direct SQL
        if state.get("correction_note"):
            response_text += f"**Note:** {state['correction_note']}\n\n"
        
        # Append queryability warnings if present
        if state.get("queryability_warnings"):
            warnings = state["queryability_warnings"]
            if warnings:
                response_text += "\n\n**⚠️ Warnings:**\n"
                seen_messages = set()
                for w in warnings:
                    msg = w.get('message', str(w))
                    if msg not in seen_messages:
                        response_text += f"- {msg}\n"
                        seen_messages.add(msg)
        
        return {
            "final_response": response_text,
            "current_step": "complete",
            "result_type": "table"
        }

    async def error_handler(self, state: QueryState) -> Dict:
        # If a final response was already generated (e.g. policy warning in schema_validator), use it
        if state.get("final_response"):
            return {
                "final_response": state["final_response"],
                "current_step": "error"
            }

        error_msg = state.get("error") or "Unknown error"
        if state.get("validation_result") and not state["validation_result"]["is_valid"]:
            error_msg = f"SQL Validation Failed: {state['validation_result']['errors']}"
            
        final_response = f"I encountered an error: {error_msg}"
        
        # Include SQL in markdown for debugging/advanced users
        if state.get("generated_sql"):
            final_response += f"\n\n**Generated SQL (Invalid):**\n```sql\n{state['generated_sql']}\n```"
            
        return {
            "final_response": final_response,
            "current_step": "error"
        }

    # --- Helpers ---

    def _parse_json_content(self, content: str) -> Dict:
        """Parse JSON from LLM response, handling markdown code blocks and errors"""
        try:
            # First, try to parse directly
            return json.loads(content.strip())
        except json.JSONDecodeError as e:
            logger.warning("Direct JSON parse failed, trying extraction", error=str(e))
            
            # Try to extract JSON from markdown code blocks
            import re
            
            # Look for ```json ... ``` blocks
            if "```json" in content:
                try:
                    extracted = content.split("```json")[1].split("```")[0].strip()
                    return json.loads(extracted)
                except (IndexError, json.JSONDecodeError) as ex:
                    logger.warning("Failed to parse json block", error=str(ex))
            
            # Look for ``` ... ``` blocks (without json marker)
            elif "```" in content:
                try:
                    extracted = content.split("```")[1].split("```")[0].strip()
                    return json.loads(extracted)
                except (IndexError, json.JSONDecodeError) as ex:
                    logger.warning("Failed to parse code block", error=str(ex))
            
            # Look for any {...} pattern
            json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
            if json_match:
                try:
                    return json.loads(json_match.group(0))
                except json.JSONDecodeError as ex:
                    logger.warning("Failed to parse extracted JSON", error=str(ex))
            
            # If all parsing fails, log the content and return empty dict
            logger.error("Failed to parse JSON from LLM response", content_preview=content[:200], full_content=content)
            return {}


    def _build_schema_summary(self, schema: Optional[Dict]) -> str:
        """
        Build enriched schema summary for NLU with table names, key columns, and descriptions.
        This helps NLU better understand intent and detect ambiguity.
        """
        if not schema or not schema.get("tables"):
            return "No schema available"

        lines = []
        for table in schema.get("tables", [])[:20]:
            name = table.get("tableName", table.get("name", "unknown"))
            desc = table.get("description", "")

            # Build table line with description
            table_line = f"- **{name}**"
            if desc:
                table_line += f": {desc[:100]}"  # Limit description length

            # Add key columns (PK, FK, and first 3-5 important columns)
            columns = table.get("columns", [])
            key_cols = []

            # First, add primary keys
            for col in columns[:10]:  # Limit to first 10 columns
                if col.get("primaryKey"):
                    key_cols.append(f"{col['name']} (PK)")
                elif col.get("foreignKey"):
                    key_cols.append(f"{col['name']} (FK)")
                elif len(key_cols) < 20:  # Add up to 20 total columns
                    key_cols.append(col['name'])

            if key_cols:
                table_line += f" → Columns: {', '.join(key_cols)}"

            lines.append(table_line)

        return "\n".join(lines)

    def _extract_tables_from_query(self, canonical_query: Dict) -> Set[str]:
        """Extract all table names (normalized to lower case) used in the canonical query."""
        tables = set()

        # Primary table
        pt = canonical_query.get("primary_table")
        if pt:
            pt_name = pt.get("name") if isinstance(pt, dict) else str(pt)
            if pt_name:
                tables.add(pt_name.lower())

        # Joins
        for join in canonical_query.get("joins", []):
            j_table = join.get("table")
            if j_table:
                tables.add(j_table.lower())

        logger.info(
            "Extracted tables from canonical query",
            extracted_tables=list(tables),
            primary_table=canonical_query.get("primary_table"),
            joins_count=len(canonical_query.get("joins", []))
        )

        return tables

    def _build_schema_context(self, state: QueryState) -> str:
        """
        Build schema description for LLM with all metadata.
        Uses pinned schema (from schema validator) if available,
        otherwise relevant schema from search, otherwise full schema.
        OPTIMIZED: Only includes relationships for tables in relevant schema.
        """
        # Priority: pinned_schema > relevant_schema > full schema
        # Pinned schema contains only tables used in the generated query
        if state.get("pinned_schema"):
            relevant_schema = state.get("pinned_schema")
        elif state.get("relevant_schema"):
            relevant_schema = state.get("relevant_schema")
        else:
            relevant_schema = None

        if relevant_schema:
            schema_to_use = {"tables": relevant_schema[:25]}

            # OPTIMIZATION: Filter relationships to only those involving relevant tables
            all_relationships = state["schema_metadata"].get("relationships", []) if state["schema_metadata"] else []
            relationships = self._filter_relevant_relationships(
                all_relationships,
                relevant_schema
            )

            logger.debug(
                "Filtered relationships for relevant schema",
                total_relationships=len(all_relationships),
                filtered_relationships=len(relationships),
                relevant_tables=[t.get("name") for t in relevant_schema],
                using_pinned_schema=bool(state.get("pinned_schema"))
            )
        else:
            # Use full schema and all relationships
            schema_to_use = state["schema_metadata"]
            relationships = state["schema_metadata"].get("relationships", []) if state["schema_metadata"] else []

        return self._format_schema_with_metadata(schema_to_use, relationships)

    def _filter_relevant_relationships(
        self,
        relationships: List[Dict[str, Any]],
        relevant_tables: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Filter relationships to only include those where BOTH source and target tables
        are in the relevant_tables list.

        This prevents sending irrelevant relationship information to the LLM when we've
        already filtered the schema to only relevant tables.

        Args:
            relationships: List of all relationships from schema metadata
            relevant_tables: List of table objects from schema search

        Returns:
            Filtered list of relationships
        """
        if not relationships or not relevant_tables:
            return []

        # Build set of relevant table names for fast lookup (case-insensitive)
        relevant_table_names = {
            t.get("name", "").lower()
            for t in relevant_tables
            if t.get("name")
        }

        # Filter relationships where both source and target are relevant
        filtered = []
        for rel in relationships:
            source_table = rel.get("sourceTable", "").lower()
            target_table = rel.get("targetTable", "").lower()

            # STRICT: Only include if BOTH source AND target are in relevant schema
            # User requirement: do not add any further relationship or Degree 1 neighbour tables
            if source_table in relevant_table_names and target_table in relevant_table_names:
                filtered.append(rel)
            else:
                # Log filtered out relationships for debugging
                pass

        return filtered

    def _format_schema_with_metadata(self, schema: Dict[str, Any], relationships: List[Dict[str, Any]] = None) -> str:
        """
        Format schema with all metadata including descriptions, hints, constraints, and relationships.
        Filters out non-queryable tables/columns.
        ENHANCED: Shows FK relationships inline with columns for clarity.
        """
        lines = []

        # Build a lookup map for relationships: table.column -> target_table.target_column
        fk_map = {}
        if relationships:
            for rel in relationships:
                source_key = f"{rel.get('sourceTable')}.{rel.get('sourceColumn')}"
                target_ref = f"{rel.get('targetTable')}.{rel.get('targetColumn')}"
                fk_map[source_key] = target_ref

        for table in schema.get("tables", []):
            # Skip non-queryable tables
            if not table.get("isQueryable", True):
                continue

            table_name = table.get('name', table.get('tableName', 'unknown'))

            # Build table header with description and hints
            table_line = f"Table: {table_name}"
            if table.get("description"):
                table_line += f" - {table['description']}"
            if table.get("semanticHints"):
                table_line += f" [Hints: {table['semanticHints']}]"
            lines.append(table_line)

            # Add queryable columns
            for col in table.get("columns", []):
                if not col.get("isQueryable", True):
                    continue  # Skip non-queryable columns

                col_name = col['name']

                # Build column line with metadata
                col_type = col.get('type', 'unknown').lower()
                is_id = col_name.endswith('_id') or col_name == 'id' or 'uuid' in col_type
                
                # Format: - col_name (TYPE) [Hints] : Description
                col_line = f"  - {col_name} ({col.get('type', 'unknown')})"
                
                # Add sample values if available (CRITICAL for ENUMs/Status/Names)
                if col.get('sampleValues'):
                    samples = ", ".join(col['sampleValues'][:3])
                    col_line += f" (e.g. {samples})"
                
                # Add helpful hint for ID columns to prevent string filtering
                if is_id:
                    col_line += " [ID/Foreign Key - DO NOT filter with name strings]"
                
                if col.get("description"):
                    col_line += f": {col['description']}"
                if col.get("semanticHints"):
                    col_line += f" [{col['semanticHints']}]"

                # Add constraint indicators
                constraints = []
                if col.get("primaryKey"):
                    constraints.append("PK")
                if col.get("foreignKey"):
                    constraints.append("FK")
                    # ENHANCEMENT: Show FK relationship inline
                    fk_key = f"{table_name}.{col_name}"
                    if fk_key in fk_map:
                        col_line += f" → References {fk_map[fk_key]}"
                if col.get("unique"):
                    constraints.append("UNIQUE")
                if constraints:
                    col_line += f" ({', '.join(constraints)})"

                lines.append(col_line)

            lines.append("")  # Blank line between tables

        # Add summary relationships section for reference
        if relationships:
            lines.append("=" * 60)
            lines.append("RELATIONSHIP SUMMARY (for complex JOINs):")
            lines.append("=" * 60)
            lines.append("CRITICAL: Always verify which table contains the FK column!")
            lines.append("")

            for rel in relationships:
                # Format: source_table.source_column -> target_table.target_column (type)
                # Make it crystal clear which table has the FK
                source_table = rel.get('sourceTable')
                source_col = rel.get('sourceColumn')
                target_table = rel.get('targetTable')
                target_col = rel.get('targetColumn')

                rel_line = f"JOIN {target_table} ON {source_table}.{source_col} = {target_table}.{target_col}"
                if rel.get('type'):
                    rel_line += f" [{rel['type']}]"
                rel_line += f"  ← FK is in {source_table}"
                lines.append(rel_line)

            lines.append("")

            logger.info("Included relationships in schema context", relationship_count=len(relationships))

        return "\n".join(lines)

    def _extract_custom_prompts(self, schema: Dict[str, Any], user_message: str) -> str:
        """
        Extract relevant custom prompts based on user query using keyword matching.
        Uses text_utils for better relevance detection with lemmatization.
        """
        prompts = []

        # Extract query keywords for matching
        query_keywords = extract_keywords(user_message)

        for table in schema.get("tables", []):
            # Check table relevance
            table_searchable = f"{table.get('name', table.get('tableName', ''))} {table.get('description', '')} {table.get('semanticHints', '')}"
            if is_keyword_match(user_message, table_searchable):
                if table.get("customPrompt"):
                    prompts.append(f"[Table: {table.get('name', table.get('tableName'))}] {table['customPrompt']}")

            # Check column relevance
            for col in table.get("columns", []):
                col_searchable = f"{col['name']} {col.get('description', '')} {col.get('semanticHints', '')}"
                if is_keyword_match(user_message, col_searchable):
                    if col.get("customPrompt"):
                        prompts.append(f"[{table.get('name', table.get('tableName'))}.{col['name']}] {col['customPrompt']}")

        if prompts:
            return "\n\nSpecial Instructions:\n" + "\n".join(prompts)
        return ""

    def _is_common_column(self, column_name: str) -> bool:
        """
        Check if a column name is a common column that appears in many tables.
        Common columns get lower weight in schema search scoring.

        Args:
            column_name: Column name to check (case-insensitive)

        Returns:
            True if column is common, False otherwise
        """
        return column_name.lower() in self.COMMON_COLUMN_NAMES

    def _expand_with_related_tables(
        self,
        initial_tables: List[Dict],
        all_tables: List[Dict],
        schema_metadata: Dict
    ) -> List[Dict]:
        """
        Expand table list by including tables related via FK relationships.

        This helps capture missing tables that are semantically related but didn't
        match the vector search. For example, if 'contract' is found, automatically
        include 'procuring_entities' and 'suppliers' if they're linked via FKs.

        Args:
            initial_tables: Tables found by vector + keyword search
            all_tables: Complete list of all queryable tables
            schema_metadata: Full schema metadata including relationships

        Returns:
            Expanded list of tables including FK-related tables
        """
        # Track table names already included (case-insensitive)
        expanded_table_names = {t.get("name", "").lower() for t in initial_tables}
        relationships = schema_metadata.get("relationships", [])

        # Create a working copy to avoid modifying while iterating
        result_tables = initial_tables.copy()

        # For each found table, find related tables via FKs
        for table in initial_tables:
            table_name = table.get("name", "")

            # Find relationships where this table is involved
            for rel in relationships:
                related_table = None
                relationship_type = None

                # Check both directions of the relationship
                if rel.get("sourceTable", "").lower() == table_name.lower():
                    related_table = rel.get("targetTable")
                    relationship_type = "references"
                elif rel.get("targetTable", "").lower() == table_name.lower():
                    related_table = rel.get("sourceTable")
                    relationship_type = "referenced_by"

                # Add the related table if not already included
                if related_table and related_table.lower() not in expanded_table_names:
                    # Find the full table object from all_tables
                    related_table_obj = next(
                        (t for t in all_tables if t.get("name", "").lower() == related_table.lower()),
                        None
                    )

                    if related_table_obj:
                        expanded_table_names.add(related_table.lower())
                        result_tables.append(related_table_obj)

                        logger.info(
                            "Added related table via FK",
                            from_table=table_name,
                            to_table=related_table,
                            relationship=relationship_type,
                            fk_column=rel.get("sourceColumn")
                        )

        return result_tables

    def _build_data_guide_context(self, schema_metadata: Dict, agent_config: Dict) -> str:
        """
        Convert technical schema into natural language context for data guide.
        Focus on business entities, relationships, and common use cases.

        Args:
            schema_metadata: Full schema metadata with tables, columns, relationships
            agent_config: Agent configuration with custom dictionary

        Returns:
            Natural language description of available data
        """
        lines = []
        tables = schema_metadata.get("tables", [])
        relationships = schema_metadata.get("relationships", [])
        custom_dict = agent_config.get("customDictionary", {})

        # Filter to only queryable tables
        queryable_tables = [t for t in tables if t.get("isQueryable", True)]

        lines.append("=== Available Data Entities ===\n")

        for table in queryable_tables[:15]:  # Limit to top 15 tables
            table_name = table.get("name", "")
            description = table.get("description", "")
            columns = table.get("columns", [])

            # Natural language description
            if description:
                lines.append(f"**{table_name}**: {description}")
            else:
                lines.append(f"**{table_name}**")

            # Key fields (non-ID, interesting columns)
            interesting_columns = []
            for col in columns:
                col_name = col.get("name", "")
                col_desc = col.get("description", "")

                # Skip ID fields and common technical columns
                if col_name.lower() in ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']:
                    continue
                if col_name.lower().endswith('_id'):
                    continue

                # Skip non-queryable columns
                if not col.get("isQueryable", True):
                    continue

                if col_desc:
                    interesting_columns.append(f"  - {col_name}: {col_desc}")
                else:
                    interesting_columns.append(f"  - {col_name}")

            if interesting_columns:
                lines.append("  Key fields:")
                lines.extend(interesting_columns[:5])  # Limit to top 5 per table

            lines.append("")  # Blank line

        # Add relationship summaries
        if relationships:
            lines.append("\n=== How Entities Connect ===\n")
            for rel in relationships[:10]:  # Limit to top 10 relationships
                source = rel.get("sourceTable", "")
                target = rel.get("targetTable", "")
                rel_type = rel.get("type", "one-to-many")

                # Only include if both tables are queryable
                source_queryable = any(t.get("name") == source and t.get("isQueryable", True) for t in tables)
                target_queryable = any(t.get("name") == target and t.get("isQueryable", True) for t in tables)

                if not (source_queryable and target_queryable):
                    continue

                if rel_type == "one-to-many":
                    lines.append(f"- Each {target} can have multiple {source}")
                elif rel_type == "many-to-one":
                    lines.append(f"- Multiple {source} belong to one {target}")
                elif rel_type == "many-to-many":
                    lines.append(f"- {source} and {target} have many-to-many relationship")

        # Add custom dictionary terms if available
        if custom_dict:
            lines.append("\n=== Special Terms & Concepts ===\n")
            # Handle both dict and string (JSON) formats
            if isinstance(custom_dict, str):
                try:
                    import json
                    custom_dict = json.loads(custom_dict)
                except (json.JSONDecodeError, ValueError):
                    logger.warning("Failed to parse customDictionary as JSON", custom_dict=custom_dict[:100])
                    custom_dict = {}
            
            if isinstance(custom_dict, dict):
                for term, definition in list(custom_dict.items())[:10]:
                    lines.append(f"- **{term}**: {definition}")

        return "\n".join(lines)

    def _generate_example_queries(self, schema_metadata: Dict, count: int = 5) -> List[str]:
        """
        Generate realistic example queries based on actual schema.

        Args:
            schema_metadata: Full schema metadata
            count: Number of examples to generate

        Returns:
            List of example query strings
        """
        examples = []
        tables = schema_metadata.get("tables", [])

        # Filter to queryable tables
        queryable_tables = [t for t in tables if t.get("isQueryable", True)]

        def humanize(s):
            return s.replace("_", " ").replace("-", " ") if s else ""

        for table in queryable_tables[:5]:  # Process top 5 tables
            table_name = table.get("name", "")
            display_name = humanize(table_name)
            columns = table.get("columns", [])

            # Find interesting columns
            name_col = next((c for c in columns if 'name' in c.get('name', '').lower() and c.get("isQueryable", True)), None)
            status_col = next((c for c in columns if 'status' in c.get('name', '').lower() and c.get("isQueryable", True)), None)
            date_col = next((c for c in columns if 'created' in c.get('name', '').lower() and c.get("isQueryable", True)), None)

            # Generate examples
            examples.append(f"Show me all {display_name}")

            if status_col:
                examples.append(f"Find active {display_name}")

            if date_col:
                examples.append(f"Show {display_name} from last week")

            if name_col:
                examples.append(f"Search {display_name} by {humanize(name_col.get('name'))}")

            if len(examples) >= count:
                break

        return examples[:count]

    def _fast_refinement_check(self, user_message: str) -> Dict[str, Any]:
        """
        Fast keyword-based heuristic to detect obvious refinements or new queries.
        Returns:
            {
                "is_obvious": bool,  # True if we're confident without LLM
                "is_refinement": bool,  # True if it's a refinement
                "type": str  # Type of refinement detected
            }
        """
        msg_lower = user_message.lower().strip()

        # DATA GUIDE REQUEST keywords (user asking about available data - ALWAYS new query)
        # These should NEVER be treated as refinements even with thread_id
        data_guide_keywords = [
            "what data", "what all data", "what kind of data", "what type of data",
            "what can i query", "what can i search", "what can i ask",
            "what tables", "what information", "available data",
            "help me understand", "show me examples", "what do you have",
            "tell me what", "explain what data", "guide me"
        ]

        # Check for data guide requests first (highest priority)
        if any(keyword in msg_lower for keyword in data_guide_keywords):
            return {
                "is_obvious": True,
                "is_refinement": False,
                "type": "data_guide"
            }

        # DIRECT SQL detection (user providing SQL) - usually a new query or replacement
        # We handle this as NOT obvious for refinement detection, let the LLM decide 
        # based on context, but keywords like "SELECT", "UPDATE", "DELETE" shouldn't trigger "limit" or "where" refinement logic incorrectly.
        sql_keywords = ["select", "update", "delete", "insert", "drop", "truncate", "alter", "create"]
        if any(msg_lower.startswith(k) for k in sql_keywords):
            return {
                "is_obvious": True,
                "is_refinement": False,
                "type": "direct_sql"
            }

        # Obvious NEW QUERY keywords (user wants something different)
        new_query_keywords = [
            "show me", "fetch", "get me", "list", "find", "search",
            "what about", "tell me about", "how about",
            "give me", "display", "retrieve"
        ]

        # Obvious REFINEMENT keywords (user wants to modify current results)
        refinement_keywords = {
            "filter": ["only", "just", "filter", "where", "with", "exclude", "without", "remove"],
            "sort": ["sort", "order by", "arrange", "organize"],
            "limit": ["top", "first", "last", "limit", "show me", "only show"],
            "columns": ["also show", "include", "add", "also include", "with", "plus"],
        }

        # 1. Check for obvious refinement patterns FIRST (Priority over "New Query")
        # Example: "Show me only active users" -> Contains "only" (refinement) AND "Show me" (new query)
        # We want to catch the "only" intent first, OR treat as ambiguous.
        has_refinement_keyword = False
        detected_refinement_type = None
        
        for ref_type, keywords in refinement_keywords.items():
            if any(keyword in msg_lower for keyword in keywords):
                has_refinement_keyword = True
                detected_refinement_type = ref_type
                break
        
        # 2. Check for obvious new query keywords
        has_new_query_keyword = any(msg_lower.startswith(keyword) for keyword in new_query_keywords)
        
        # 3. Decision Logic
        if has_refinement_keyword:
            if has_new_query_keyword:
                # Ambiguous: "Show me only..." -> Could be new or refinement. Let LLM decide.
                logger.info("Ambiguous intent detected (mixed keywords)", message=user_message)
                return {"is_obvious": False}
            else:
                # Strong refinement signal without new query intro -> Definitely refinement
                return {
                    "is_obvious": True,
                    "is_refinement": True,
                    "type": detected_refinement_type
                }
        
        if has_new_query_keyword:
             # New query keyword present, and NO refinement keyword found above
            return {
                "is_obvious": True,
                "is_refinement": False,
                "type": "new_query"
            }

        # Not obvious either way - let LLM decide
        return {"is_obvious": False}

    def _enforce_queryability(
        self, 
        canonical_query: Dict[str, Any], 
        schema: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
        """
        Comprehensive enforcement of isQueryable restrictions.
        Strips non-queryable tables and columns from the query structure.
        Returns (filtered_query, warnings).
        """
        if not canonical_query or not schema:
            return canonical_query, []

        warnings = []
        
        # 1. Build lookup maps for fast check
        table_queryable = {
            t.get('name', t.get('tableName', '')).lower(): t.get("isQueryable", True)
            for t in schema.get("tables", [])
        }
        
        col_queryable = {}
        for t in schema.get("tables", []):
            t_name = t.get('name', t.get('tableName', '')).lower()
            for col in t.get("columns", []):
                c_name = col.get('name', col.get('columnName', '')).lower()
                col_queryable[f"{t_name}.{c_name}"] = col.get("isQueryable", True)
                # Also store naked column name if it's the only one (for simpler lookups)
                if c_name not in col_queryable:
                    col_queryable[c_name] = col.get("isQueryable", True)

        # 2. Map aliases to real table names
        alias_to_table = {}
        pt = canonical_query.get("primary_table", {})
        if isinstance(pt, dict):
            p_name = pt.get("name", "").lower()
            p_alias = pt.get("alias", "").lower()
            if p_alias: alias_to_table[p_alias] = p_name
        
        for j in canonical_query.get("joins", []):
            j_name = j.get("table", "").lower()
            j_alias = j.get("alias", "").lower()
            if j_alias: alias_to_table[j_alias] = j_name

        filtered_query = copy.deepcopy(canonical_query)
        removed_tables = set()

        # 3. Check Primary Table
        p_ref = filtered_query.get("primary_table")
        p_name = p_ref.get("name", "").lower() if isinstance(p_ref, dict) else str(p_ref).lower()
        
        if not table_queryable.get(p_name, True):
            warnings.append({
                "type": "non_queryable_table",
                "entity": p_name,
                "message": f"Table '{p_name}' is marked as non-queryable and has been removed from the query.",
                "severity": "warning"
            })
            removed_tables.add(p_name)
            
            # Swap primary table if possible
            joins = filtered_query.get("joins", [])
            new_primary = None
            remaining_joins = []
            for j in joins:
                j_name = j.get("table", "").lower()
                if not new_primary and table_queryable.get(j_name, True):
                    new_primary = {"name": j.get("table"), "alias": j.get("alias")}
                else:
                    remaining_joins.append(j)
            
            if new_primary:
                filtered_query["primary_table"] = new_primary
                filtered_query["joins"] = remaining_joins
            else:
                # No queryable tables left - this will likely fail later or we can raise here
                logger.warning("All tables in query were non-queryable", primary=p_name)

        # 4. Filter Joins
        kept_joins = []
        for j in filtered_query.get("joins", []):
            j_name = j.get("table", "").lower()
            if table_queryable.get(j_name, True):
                kept_joins.append(j)
            else:
                warnings.append({
                    "type": "non_queryable_table",
                    "entity": j_name,
                    "message": f"Table '{j_name}' is marked as non-queryable and has been removed from the query.",
                    "severity": "warning"
                })
                removed_tables.add(j_name)
        filtered_query["joins"] = kept_joins

        # Helper to check if a column reference or expression contains restricted entities
        def is_restricted(expression: str) -> Tuple[bool, Optional[str]]:
            if not expression: return False, None
            expr_lower = expression.lower()
            
            # 1. Extract all qualified references: alias.column or table.column
            # Handles backticks and double quotes
            import re
            qualified_refs = re.findall(r'[`"]?(\w+)[`"]?\.[`"]?(\w+)[`"]?', expr_lower)
            for t_alias, col_name in qualified_refs:
                # Check for removed tables
                t_real = alias_to_table.get(t_alias, t_alias)
                if t_real in removed_tables:
                    return True, "table_removed"
                
                # Check for restricted columns
                qualified_name = f"{t_real}.{col_name}"
                if not col_queryable.get(qualified_name, True):
                    return True, "column_restricted"

            # 2. Extract all standalone words to check for naked column/table references
            # Use a mask to avoid matching parts of qualified references
            # We replace detected qualified references with spaces in a temporary string
            expr_for_naked_check = expr_lower
            for t_alias, col_name in qualified_refs:
                # Construct the span to remove (roughly)
                # Note: This is an approximation. For stricter parsing we'd need a parser.
                # But since we extracted them via regex, we can just replace that specific pattern match.
                # To be safe, let's just use re.sub for the exact matches found.
                pattern = re.compile(re.escape(t_alias) + r'[`"]?\.[`"]?' + re.escape(col_name))
                expr_for_naked_check = pattern.sub(" ", expr_for_naked_check)

            # We filter out common SQL keywords to avoid false positives
            keywords = {
                'count', 'sum', 'avg', 'min', 'max', 'distinct', 'as', 'select', 'from', 'where', 
                'group', 'by', 'order', 'limit', 'and', 'or', 'in', 'between', 'is', 'null', 'not',
                'true', 'false', 'now', 'current_date', 'interval', 'case', 'when', 'then', 'else', 'end'
            }
            words = re.findall(r'\b(\w+)\b', expr_for_naked_check)
            for word in words:
                if word in keywords:
                    continue
                
                # If the word is an alias of a removed table
                if word in alias_to_table and alias_to_table[word] in removed_tables:
                    return True, "table_removed"
                
                # If the word is a naked column name that is restricted in ANY current table
                # Validate against current context tables
                
                # Check primary table
                pt_real = alias_to_table.get(p_name, p_name)
                qualified_pt_col = f"{pt_real}.{word}"
                # Only check if the column actually belongs to this table (is in our map) and is restricted
                if qualified_pt_col in col_queryable and not col_queryable[qualified_pt_col]:
                    return True, "column_restricted"
                
                # Check joined tables
                for j in filtered_query.get("joins", []):
                    j_table = j.get("table", "").lower()
                    qualified_j_col = f"{j_table}.{word}"
                    if qualified_j_col in col_queryable and not col_queryable[qualified_j_col]:
                        return True, "column_restricted"
            
            return False, None

        # 5. Filter Columns (SELECT)
        original_cols = filtered_query.get("columns", [])
        kept_cols = []
        for c in original_cols:
            c_ref = c.get("column", "")
            restricted, reason = is_restricted(c_ref)
            if not restricted:
                kept_cols.append(c)
            else:
                # Suppress warning if restricted due to table removal (already warned)
                if reason != "table_removed":
                    warnings.append({
                        "type": "non_queryable_column",
                        "entity": c_ref,
                        "message": f"Column '{c_ref}' is marked as non-queryable and has been removed from the results.",
                        "severity": "warning"
                    })
        filtered_query["columns"] = kept_cols

        # 6. Filter Filters (WHERE)
        filtered_query["filters"] = [
            f for f in filtered_query.get("filters", [])
            if not (isinstance(f, dict) and is_restricted(f.get("column"))[0])
        ]

        # 7. Filter Group By and Order By
        filtered_query["group_by"] = [
            g for g in filtered_query.get("group_by", [])
            if not is_restricted(g)[0]
        ]
        filtered_query["order_by"] = [
            o for o in filtered_query.get("order_by", [])
            if not is_restricted(o.get("column"))[0]
        ]

        return filtered_query, warnings

    def _check_queryability_warnings(self, sql: str, schema: Dict[str, Any]) -> List[Dict[str, str]]:
        """
        Check if SQL uses non-queryable tables or columns.
        Returns warnings (not errors - query proceeds but skips these fields).
        Uses sqlparse for better SQL parsing.
        """
        warnings = []

        try:
            # Parse SQL to extract table and column references
            parsed = sqlparse.parse(sql)
            if not parsed:
                return warnings

            statement = parsed[0]

            # Extract table names from FROM and JOIN clauses
            table_refs = self._extract_table_references(statement)

            # Extract column references
            column_refs = self._extract_column_references(statement)

            # Check tables
            for table in schema.get("tables", []):
                table_name = table.get('name', table.get('tableName', ''))
                if not table.get("isQueryable", True):
                    # Check if this table is referenced
                    if table_name.lower() in [t.lower() for t in table_refs]:
                        warnings.append({
                            "type": "non_queryable_table",
                            "entity": table_name,
                            "message": f"Table '{table_name}' is marked as non-queryable. It will be skipped.",
                            "severity": "warning"
                        })

                # Check columns within this table
                for col in table.get("columns", []):
                    if not col.get("isQueryable", True):
                        # Check if this column is referenced
                        col_ref_qualified = f"{table_name}.{col['name']}".lower()
                        col_name_only = col['name'].lower()
                        
                        # Check both qualified and unqualified references
                        is_referenced = False
                        for c in column_refs:
                            c_lower = c.lower()
                            if c_lower == col_ref_qualified:
                                is_referenced = True
                                break
                            if c_lower == col_name_only:
                                # Only warn if it's likely referring to this table 
                                # (heuristic: either it's the only table or it's clearly this column)
                                is_referenced = True
                                break

                        if is_referenced:
                            warnings.append({
                                "type": "non_queryable_column",
                                "entity": col_ref_qualified,
                                "message": f"Column '{col_ref_qualified}' is marked as non-queryable. It will be skipped.",
                                "severity": "warning"
                            })

        except Exception as e:
            # If parsing fails, fall back to simple string matching
            sql_upper = sql.upper()

            for table in schema.get("tables", []):
                table_name = table.get('name', table.get('tableName', ''))
                if not table.get("isQueryable", True):
                    if f" {table_name.upper()} " in sql_upper or f" {table_name.upper()}," in sql_upper:
                        warnings.append({
                            "type": "non_queryable_table",
                            "entity": table_name,
                            "message": f"Table '{table_name}' may be non-queryable.",
                            "severity": "warning"
                        })

        return warnings

    def _extract_table_references(self, statement) -> List[str]:
        """
        Extract table names from SQL statement using sqlparse.
        Handles FROM and JOIN clauses.
        """
        tables = []

        from_seen = False
        for token in statement.tokens:
            # Check for FROM keyword
            if token.ttype is Keyword and token.value.upper() == 'FROM':
                from_seen = True
                continue

            # After FROM, collect identifiers
            if from_seen:
                if isinstance(token, Identifier):
                    tables.append(token.get_real_name())
                elif isinstance(token, IdentifierList):
                    for identifier in token.get_identifiers():
                        tables.append(identifier.get_real_name())
                elif token.ttype is Keyword and token.value.upper() in ('WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT'):
                    from_seen = False

            # Check for JOIN keywords
            if token.ttype is Keyword and 'JOIN' in token.value.upper():
                # Next identifier after JOIN is a table
                idx = statement.tokens.index(token)
                for next_token in statement.tokens[idx+1:]:
                    if isinstance(next_token, Identifier):
                        tables.append(next_token.get_real_name())
                        break

        return [t for t in tables if t]

    def _extract_column_references(self, statement) -> List[str]:
        """
        Extract column references from SQL statement.
        Returns list of table.column strings.
        """
        columns = []

        def extract_from_token(token):
            if isinstance(token, Identifier):
                # Could be table.column or just column (Identifier covers both)
                name = str(token)
                columns.append(name)
            elif hasattr(token, 'tokens'):
                for sub_token in token.tokens:
                    extract_from_token(sub_token)

        extract_from_token(statement)
        return columns

    def _extract_sensitive_columns(self, schema: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract columns marked as sensitive in schema.
        Returns list of sensitive column metadata for sensitivity registry.
        """
        sensitive_cols = []

        for table in schema.get("tables", []):
            table_name = table.get('name', table.get('tableName', ''))
            for col in table.get("columns", []):
                if col.get("isSensitive", False):
                    sensitive_cols.append({
                        "table": table_name,
                        "column": col["name"],
                        "sensitivityLevel": col.get("sensitivityLevel", "high"),
                        "maskingStrategy": col.get("maskingStrategy", "full"),
                        "source": "schema_admin"
                    })
                
                # ALSO ADD NON-QUERYABLE COLUMNS WITH 'REMOVE' STRATEGY
                if not col.get("isQueryable", True):
                    sensitive_cols.append({
                        "table": table_name,
                        "column": col["name"],
                        "sensitivityLevel": "critical",
                        "maskingStrategy": "remove", # My new strategy in SensitivityRegistry
                        "source": "schema_queryability"
                    })

        return sensitive_cols

    def _filter_non_queryable_columns(
        self, 
        results: List[Dict[str, Any]], 
        warnings: List[Dict[str, str]],
        schema: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Filter out non-queryable columns from query results.
        Removes columns that were marked as non-queryable in the schema.
        """
        if not results or not warnings:
            return results
        
        # Extract non-queryable column names from warnings
        non_queryable_columns = set()
        for warning in warnings:
            if warning.get("type") == "non_queryable_column":
                # Entity format: "table_name.column_name"
                entity = warning.get("entity", "")
                if "." in entity:
                    _, column_name = entity.split(".", 1)
                    non_queryable_columns.add(column_name.lower())
                else:
                    # Handle naked column name entity
                    non_queryable_columns.add(entity.lower())
        
        if not non_queryable_columns:
            return results

        # Filter columns from each result row
        filtered_results = []
        for row in results:
            filtered_row = {
                key: value
                for key, value in row.items()
                if key.lower() not in non_queryable_columns
            }
            filtered_results.append(filtered_row)

        logger.info(
            "Filtered non-queryable columns from results",
            removed_columns=list(non_queryable_columns),
            original_column_count=len(results[0]) if results else 0,
            filtered_column_count=len(filtered_results[0]) if filtered_results else 0
        )

        return filtered_results

    def _format_chat_history(self, history: List[Dict[str, Any]]) -> str:
        """Format chat history for LLM context"""
        if not history:
            return "No previous context."
            
        formatted = []
        for msg in history:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            
            # If assistant message is empty (common for table results), 
            # try to show the SQL from metadata to give context
            if role == "assistant" and not content:
                metadata = msg.get("metadata", {}) or {}
                sql = metadata.get("sql")
                if sql:
                    content = f"[Executed SQL Query: {sql}]"
            
            formatted.append(f"{role.upper()}: {content}")
            
        return "\n".join(formatted)
