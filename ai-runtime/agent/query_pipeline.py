import asyncio
import time
from typing import Dict, List, Any
from datetime import datetime
import uuid as uuid_module

import structlog
from langgraph.graph import StateGraph, END

from agent.nodes import QueryGraphNodes, QueryState
from services.state_checkpointer import state_checkpointer
from services.audit_service import audit_service

logger = structlog.get_logger()


class QueryPipeline:
    # Class-level cache for compiled pipelines: agent_id -> compiled_app
    # IMPORTANT: Cache includes version to invalidate on code changes
    _PIPELINE_VERSION = "v3.0_unified_query_modifier"  # Increment this when pipeline structure changes
    _pipeline_cache: Dict[str, Any] = {}

    def __init__(self, agent_id: str, session_id: str, user_id: str = None, api_key_id: str = None, api_key_name: str = None):
        self.agent_id = agent_id
        self.session_id = session_id
        self.user_id = user_id
        self.api_key_id = api_key_id
        self.api_key_name = api_key_name
        self.agent_config = None
        self.nodes = None
        # self.app will be set during processing from cache or fresh compile
        self.app = None
        
    async def _initialize_nodes(self):
        """Initialize nodes with agent configuration and state persistence"""
        from services.system_db import SystemDBService
        
        # Fetch agent config to get LLM settings
        self.system_db = SystemDBService()
        self.agent_config = await self.system_db.get_agent_config(self.agent_id)
        
        # Initialize nodes with agent config
        self.nodes = QueryGraphNodes(agent_config=self.agent_config)
        
    def _sanitize_state_for_logging(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize the QueryState object before logging to avoid storing 
        excessively large or sensitive metadata.
        """
        if not state:
            return {}
            
        # Define fields to EXCLUDE from logs
        # agent_config and schema_metadata are very large and already permanent in DB
        # assistant_response is often redundant with final_response
        exclude_keys = {'agent_config', 'schema_metadata', 'assistant_response', 'sensitivity_rules'}
        
        result = {k: v for k, v in state.items() if k not in exclude_keys}
        
        # 1. Clean up relevant_schema (often contains full Table objects)
        if "relevant_schema" in result and isinstance(result["relevant_schema"], list):
            # If it's a list of dicts (actual schema objects), just extract names
            if result["relevant_schema"] and isinstance(result["relevant_schema"][0], dict):
                result["relevant_schema"] = [t.get("name") or t.get("tableName") or "unknown" for t in result["relevant_schema"]]
        
        # 2. Truncate context (large strings of role/content)
        if 'context' in result and isinstance(result['context'], list):
            if len(result['context']) > 5:
                result['context'] = result['context'][-5:]
                
        # 3. Truncate results previews
        if 'sanitized_results' in result and isinstance(result['sanitized_results'], list):
            if len(result['sanitized_results']) > 10:
                result['sanitized_results'] = result['sanitized_results'][:10] + ["... (truncated)"]
                
        # 4. Handle potentially large raw strings
        for key in ["final_response", "error"]:
            if key in result and isinstance(result[key], str) and len(result[key]) > 2000:
                result[key] = result[key][:2000] + "... (truncated)"
                
        return result

    async def _get_or_create_app(self):
        """Get cached compiled app or create new one"""
        # Use versioned cache key to invalidate cache on pipeline structure changes
        cache_key = f"{self.agent_id}:{QueryPipeline._PIPELINE_VERSION}"

        if cache_key in QueryPipeline._pipeline_cache:
            self.app = QueryPipeline._pipeline_cache[cache_key]
            # Ensure nodes are initialized even if app is cached
            if not self.nodes:
                await self._initialize_nodes()
            logger.info("Using cached pipeline", agent_id=self.agent_id, version=QueryPipeline._PIPELINE_VERSION)
            return

        # Not cached, build it
        logger.info("Building new pipeline", agent_id=self.agent_id, version=QueryPipeline._PIPELINE_VERSION)
        await self._initialize_nodes()

        # Build the graph
        self.workflow = self._build_graph()

        # Compile with checkpointer for state persistence
        checkpointer = state_checkpointer.get_checkpointer()
        if checkpointer:
            self.app = self.workflow.compile(checkpointer=checkpointer)
            logger.info("Query pipeline compiled with state persistence enabled", agent_id=self.agent_id)
        else:
            self.app = self.workflow.compile()
            logger.warning("Query pipeline compiled without state persistence", agent_id=self.agent_id)

        # Cache it with versioned key
        QueryPipeline._pipeline_cache[cache_key] = self.app

        
    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(QueryState)
        
        # Add nodes
        workflow.add_node("load_config", self.nodes.load_config)
        workflow.add_node("unified_intent", self.nodes.unified_intent_node)
        # workflow.add_node("query_modifier", self.nodes.query_modifier) # [DEPRECATED] Consolidated into query_builder
        workflow.add_node("guardrail_responder", self.nodes.guardrail_responder)
        workflow.add_node("clarification_responder", self.nodes.clarification_responder)
        workflow.add_node("data_guide_responder", self.nodes.data_guide_responder)
        workflow.add_node("no_match_responder", self.nodes.no_match_responder)
        
        workflow.add_node("schema_search", self.nodes.schema_search)
        workflow.add_node("query_builder", self.nodes.query_builder)
        workflow.add_node("native_schema_validator", self.nodes.native_schema_validator)
        workflow.add_node("sql_corrector", self.nodes.sql_corrector)
        workflow.add_node("response_composer", self.nodes.response_composer)
        workflow.add_node("error_handler", self.nodes.error_handler)
        
        # Define edges
        workflow.set_entry_point("load_config")
        workflow.add_edge("load_config", "unified_intent")

        # 3. Routing after Unified Intent
        workflow.add_conditional_edges(
            "unified_intent",
            self._check_unified_intent,
            {
                "schema_search": "schema_search",
                "query_builder": "query_builder",
                "off_topic": "guardrail_responder",
                "ambiguous": "clarification_responder",
                "data_guide": "data_guide_responder",
                "error": "error_handler"
            }
        )

        # NEW: Conditional routing after query modification
        # Simple refinements skip schema_search but use query_builder with preserved schema
        # Complex refinements with new entities do schema_search then query_builder
        # [DEPRECATED] Consolidation into query_builder
        # workflow.add_conditional_edges(
        #     "query_modifier",
        #     self._check_query_modification_result,
        #     {
        #         "schema_search": "schema_search",   # Complex refinement needs new schema
        #         "skip_builder": "native_schema_validator", # Valid modification -> Skip LLM
        #         "query_builder": "query_builder"    # Fallback to LLM
        #     }
        # )
        

        workflow.add_edge("guardrail_responder", END)
        workflow.add_edge("clarification_responder", END)
        workflow.add_edge("data_guide_responder", END)  # NEW: Data guide completes directly
        workflow.add_edge("no_match_responder", END) # NEW

        # Conditional edge from Schema Search (Replaces direct edge)
        workflow.add_conditional_edges(
            "schema_search",
            self._check_schema_match,
            {
                "no_match": "no_match_responder",
                "match": "query_builder"
            }
        )
        
        # workflow.add_edge("schema_search", "query_builder") # Removed
        workflow.add_edge("query_builder", "native_schema_validator")
        
        # NEW: Conditional routing after schema validation to prevent technical errors for restricted tables
        # Valid schema -> Done (Execution handled externally)
        workflow.add_conditional_edges(
            "native_schema_validator",
            self._check_schema_validation,
            {
                "valid": "response_composer",
                "invalid": "sql_corrector"
            }
        )
        
        # Conditional edge from Corrector (Self-Correction Loop: Corrector -> Validator)
        workflow.add_conditional_edges(
            "sql_corrector",
            self._check_correction_result,
            {
                "retry": "native_schema_validator",  # Back to validator to check corrected SQL
                "error": "error_handler"
            }
        )
        
        workflow.add_edge("response_composer", END)
        workflow.add_edge("error_handler", END)
        
        return workflow

    # --- Conditional Logic ---

    # --- Conditional Logic ---

    async def _check_refinement_path(self, state: QueryState) -> str:
        """
        Route refinement based on whether new entities were detected or schema is missing.
        NOTE: This is the fallback if high-confidence shortcut didn't apply.
        """
        intent = state.get("intent") or {}
        needs_search = intent.get("needs_schema_search", False)
        new_entities = intent.get("new_entities", [])

        # Force schema search if explicitly requested, or if new entities are identified for the refinement
        # Also force search if we literally have no schema context at all (rare for refinements)
        if needs_search or new_entities or not state.get("relevant_schema"):
            logger.info("✓ Refinement needs schema context: routing to schema_search", 
                       needs_search=needs_search, new_entities=new_entities, 
                       has_schema=bool(state.get("relevant_schema")))
            return "schema_search"

        logger.info("✓ Routing refinement to query_builder (LLM) with existing schema context")
        return "query_builder"

    async def _check_unified_intent(self, state: QueryState) -> str:
        """Route based on consolidated orchestrator intent analysis"""
        if state.get("error"): return "error"
        
        intent_data = state.get("intent", {})
        route_to = intent_data.get("route_to", "query_builder")
        primary_intent = intent_data.get("primary_intent")

        # 1. NEW: Strict Gating for Database Queries
        # Only proceed to database paths if intent is explicitly query or correction
        is_database_path = primary_intent in ["database_query", "correction"]
        
        if route_to == "none" or not is_database_path:
            if primary_intent == "data_guide":
                return "data_guide"
            if state.get("is_ambiguous"):
                return "ambiguous"
            # Greetings, explanations, and out_of_scope go to guardrail_responder
            return "off_topic"

        intent_data = state.get("intent", {})
        is_refinement = state.get("is_refinement", False)
        confidence = intent_data.get("confidence", 0)
        needs_search = intent_data.get("needs_schema_search", True)
        required_tables = intent_data.get("required_tables", [])
        new_entities = intent_data.get("new_entities", [])

        # 2. HIGH-CONFIDENCE SHORTCUT (NEW)
        # Skip schema_search if Intent is extremely confident and no search is needed
        # RULE: Even if confident, refinements with new_entities MUST search (Rule #3)
        logger.info("Evaluating shortcut", confidence=confidence, needs_search=needs_search, 
                    has_tables=bool(required_tables), is_refinement=is_refinement, 
                    new_entities=new_entities)
        
        if confidence >= 0.9 and not needs_search and required_tables:
            if not is_refinement or not new_entities:
                logger.info("⚡ High-confidence intent detected: shortcutting to query_builder", 
                           confidence=confidence, tables=required_tables, is_refinement=is_refinement)
                return "query_builder"
            else:
                logger.info("Refinement has new entities, search mandatory despite confidence", 
                           new_entities=new_entities)

        # 3. Check for refinement fallback
        if is_refinement:
            return await self._check_refinement_path(state)
        
        # 4. Default to schema_search for new queries
        return "schema_search"
        
    def _check_schema_match(self, state: QueryState) -> str:
        return "no_match" if state.get("no_match") else "match"

    def _check_schema_validation(self, state: QueryState) -> str:
        """Route based on schema validation success (prevent restricted table access)"""
        
        # Allow connection errors to pass through to display the SQL
        if state.get("is_connection_error"):
            logger.warning("Database connection error detected, bypassing corrector")
            return "valid"

        # NEW: If generated_sql is missing, bypass corrector and go to response_composer
        # This allows handled failures (e.g. prompt rejection) to show a clean message.
        if not state.get("generated_sql"):
            logger.warning("No SQL generated by builder, bypassing corrector")
            return "valid"

        # Prioritize explicit error flag or negative validation success
        if state.get("error") or state.get("validation_success") is False:
            logger.warning("Schema validation check failed", 
                          error=state.get("error"))
            return "invalid"
        return "valid"

    def _check_execution(self, state: QueryState) -> str:
        return "success" if not state.get("error") else "error"
        
    def _check_correction_result(self, state: QueryState) -> str:
        """Route based on whether the SQL Corrector succeeded or failed."""
        if state.get("error"):
            # If we are under the retry limit, allow looping back to try again
            # This handles "verification_failed" (fake fixes) and other recoverable errors
            if state.get("correction_iteration", 0) < 3:
                logger.info("SQL Correction reported error, but retrying loop", 
                           iteration=state.get("correction_iteration"),
                           error=state.get("error"))
                return "retry"
                
            logger.error("SQL Correction failed to resolve error", error=state.get("error"))
            return "error"
        return "retry"

    # --- Public Interface ---

    async def process(self, user_message: str, context: List[Dict] = None, thread_id: str = None):
        """
        Process a user query through the pipeline.
        
        Args:
            user_message: The user's natural language query
            context: Previous conversation context (will be overridden if thread_id provided)
            thread_id: Optional thread ID for query refinement
        """
        # Initialize/Get cached pipeline
        if not self.app:
            await self._get_or_create_app()
        
        # Load previous thread state if thread_id provided
        previous_state = None
        if thread_id:
            try:
                previous_state = await self.system_db.get_thread_state(thread_id)
                if previous_state:
                    logger.info("Loaded previous thread state", thread_id=thread_id, iteration=previous_state.get("iteration_count", 0))
                    # Override context with thread-scoped history
                    context = await self.system_db.get_thread_history(thread_id, limit=10)
            except Exception as e:
                logger.error("Failed to load thread state", error=str(e), thread_id=thread_id)
                previous_state = None
        
        # Generate new thread_id if not provided
        if not thread_id:
            thread_id = f"thread_{uuid_module.uuid4().hex[:16]}"
            logger.info("Generated new thread_id", thread_id=thread_id)
        
        initial_state = QueryState(
            agent_id=self.agent_id,
            session_id=self.session_id,
            user_message=user_message,
            context=context or [],
            start_time=time.time(),
            # Audit logging
            query_history_id=None,  # Will be set after creating query log
            # Thread management (NEW)
            thread_id=thread_id,
            is_refinement=False,  # Will be set by unified_intent
            previous_query=previous_state.get("canonical_query") if previous_state else None,
            previous_sql=previous_state.get("generated_sql") if previous_state else None,
            # Use last_query_user_message to ensure Previous SQL + Previous Message stay coupled
            previous_user_message=previous_state.get("last_query_user_message") if previous_state else None,
            last_query_user_message=previous_state.get("last_query_user_message") if previous_state else None,
            previous_results=previous_state.get("sanitized_results") if previous_state else None,
            refinement_intent=None,
            iteration_count=previous_state.get("iteration_count", 0) if previous_state else 0,
            correction_iteration=0,  # NEW: Per-message SQL correction counter (always reset to 0)
            # Initialize optionals
            agent_config=None, schema_metadata=None, sensitivity_rules=None,
            intent=None, relevant_tables_from_intent=[], 
            is_off_topic=False, is_ambiguous=False, is_data_guide_request=False, clarifying_questions=[],
            correction_note=None,
            relevant_schema=previous_state.get("relevant_schema", []) if previous_state else [], # CRITICAL: Load previous schema for refinements
            pinned_schema=previous_state.get("pinned_schema") if previous_state else None, # Load pinned schema from previous turn
            no_match=False,
            canonical_query=None, generated_sql=None, sql_dialect="postgresql",
            validation_result=None, queryability_warnings=[], pre_query_warnings=[],
            raw_results=[], sanitized_results=[],
            final_response="", error=None, execution_time_ms=0, current_step="init"
        )

        # Initialize query_history_id (will be set after creating query log)
        query_history_id = None
        
        # Update the state with query_history_id after creating it
        if query_history_id:
            initial_state["query_history_id"] = query_history_id
        
        # Configure LangGraph thread for state persistence
        config = {"configurable": {"thread_id": thread_id}}
        
        
        logger.info("Starting query pipeline", thread_id=thread_id, has_previous_state=previous_state is not None)
        
        # Initialize context vars for this request
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            agent_id=self.agent_id,
            thread_id=thread_id,
            is_refinement=False, # Default until detected
            request_id=None # if available
        )

        # AUDIT LOGGING: Create query history record
        organization_id = self.agent_config.get("organizationId") if self.agent_config else None
        sql_dialect = self.agent_config.get("dbType", "postgresql") if self.agent_config else "postgresql"
        query_history_id = await audit_service.create_query_log(
            agent_id=self.agent_id,
            user_message=user_message,
            organization_id=organization_id,
            session_id=self.session_id,
            sql_dialect=sql_dialect,
            thread_id=thread_id,
            is_refinement=bool(previous_state),  # Has previous state = refinement
            iteration_count=initial_state.get("iteration_count", 0),
            user_id=self.user_id,
            api_key_id=self.api_key_id,
            api_key_name=self.api_key_name
        )

        # Update the state with the generated query_history_id
        if query_history_id:
            initial_state["query_history_id"] = query_history_id
            logger.info("Query history ID assigned to state", query_history_id=str(query_history_id))

        # Track execution order for pipeline logging
        execution_order = 0
        node_start_times = {}  # Track when each node starts

        last_generated_sql = initial_state.get("previous_sql")
        last_canonical_query = initial_state.get("previous_query")
        last_query_user_message = initial_state.get("last_query_user_message")
        last_row_count = 0
        last_sanitized_results = []
        last_data_fetched = True # Default to True (legacy behavior)
        last_relevant_schema = initial_state.get("relevant_schema", [])
        last_relevant_tables_from_intent = []
        last_pinned_schema = initial_state.get("pinned_schema")
        last_is_refinement = False
        last_iteration_count = initial_state.get("iteration_count", 0)

        logger.info("🔍 [DEBUG] Starting pipeline stream", 
                    initial_state_keys=list(initial_state.keys()), 
                    query_history_id=str(initial_state.get("query_history_id")))

        async for event in self.app.astream(initial_state, config=config):
            # Yield progress updates based on state changes
            for node_name, state_update in event.items():
                if not state_update:
                    continue

                # Track canonical query updates
                if "canonical_query" in state_update:
                    last_canonical_query = state_update["canonical_query"]
                
                # DETECT THREAD FORK: If this is an unrelated query in an existing thread, fork to new ID
                if node_name == "unified_intent":
                    last_is_refinement = state_update.get("is_refinement", False)
                    last_relevant_tables_from_intent = state_update.get("relevant_tables_from_intent", [])
                    intent_data = state_update.get("intent", {})
                    primary_intent = intent_data.get("primary_intent")
                    
                    # Fork ONLY if it's a new database query (not a refinement)
                    # Conversational intents (explanation, greeting, etc.) should stay in thread context
                    is_new_db_query = primary_intent == "database_query" and not last_is_refinement
                    
                    if is_new_db_query and initial_state.get("previous_query"):
                        old_thread_id = thread_id
                        thread_id = f"thread_{uuid_module.uuid4().hex[:16]}"
                        logger.info("New unrelated query detected. Forking thread for isolation.", 
                                   old_thread_id=old_thread_id, new_thread_id=thread_id)
                        
                        # Update logging context
                        structlog.contextvars.bind_contextvars(thread_id=thread_id)
            
                # AUDIT LOGGING: Track node execution
                if query_history_id:
                    current_time = datetime.now()
                    if 'last_step_end_time' not in locals():
                         last_step_end_time = datetime.fromtimestamp(initial_state["start_time"])

                    duration_ms = max(int((current_time - last_step_end_time).total_seconds() * 1000), 1)

                    # Sanitize the current state update (or the combined state)
                    # node_state in QueryPipelineExecution represents what changed or the current state
                    sanitized_node_state = self._sanitize_state_for_logging(state_update)

                    await audit_service.log_pipeline_execution(
                        query_history_id=query_history_id,
                        node_name=node_name,
                        execution_order=execution_order,
                        started_at=last_step_end_time,
                        completed_at=current_time,
                        duration_ms=duration_ms,
                        node_state=sanitized_node_state,
                        error=state_update.get("error")
                    )
                    
                    execution_order += 1
                    last_step_end_time = current_time

                # Track relevant_schema updates (from schema_search or query_modifier)
                if "relevant_schema" in state_update:
                    last_relevant_schema = state_update["relevant_schema"]

                # Track pinned_schema updates (from schema_validator)
                if "pinned_schema" in state_update:
                    last_pinned_schema = state_update["pinned_schema"]

                if "data_fetched" in state_update:
                    last_data_fetched = state_update["data_fetched"]
                
                if "iteration_count" in state_update:
                    last_iteration_count = state_update["iteration_count"]

                if "current_step" in state_update:
                    yield {
                        "type": "thinking",
                        "stage": node_name,
                        "message": f"Completed {node_name}"
                    }
                
                if "generated_sql" in state_update:
                    last_generated_sql = state_update["generated_sql"]
                    # Also update the message that corresponds to this SQL
                    last_query_user_message = user_message
                    logger.info(f"Updated pipeline SQL from node: {node_name}", sql_preview=last_generated_sql[:50] if last_generated_sql else "None")
                
                if node_name in ["response_composer", "guardrail_responder", "error_handler", "clarification_responder", "no_match_responder", "data_guide_responder"]:
                    final_resp = state_update.get("final_response", "")
                    yield {
                        "type": "stream",
                        "content": final_resp
                    }

                    # Save thread state on completion (NEW)
                    if node_name in ["response_composer", "guardrail_responder", "no_match_responder", "clarification_responder", "data_guide_responder"]:
                        try:
                            await self.system_db.save_thread_state(
                                thread_id=thread_id,
                                conversation_id=self.session_id,
                                state={
                                    "user_message": user_message,
                                    "last_query_user_message": last_query_user_message, # coupling with SQL
                                    "canonical_query": last_canonical_query,  # Use tracked value
                                    "generated_sql": last_generated_sql,
                                    "relevant_schema": last_relevant_schema,  # CRITICAL: Save for refinements
                                    "relevant_tables_from_intent": last_relevant_tables_from_intent, # Save identified tables
                                    "pinned_schema": last_pinned_schema,  # CRITICAL: Save pinned schema from validator
                                    "iteration_count": last_iteration_count
                                }
                            )
                            logger.info("Thread state saved", thread_id=thread_id,
                                       pinned_tables=[t.get("name") for t in last_pinned_schema] if last_pinned_schema else None,
                                       relevant_tables=[t.get("name") for t in last_relevant_schema] if last_relevant_schema else [])
                        except Exception as e:
                            logger.error("Failed to save thread state", error=str(e), thread_id=thread_id)

                    # AUDIT LOGGING: Update query log with final results
                    if query_history_id:
                        execution_time = int((time.time() - initial_state["start_time"]) * 1000)
                        is_success = node_name != "error_handler" and not state_update.get("error")
                        error_msg = state_update.get("error") if not is_success else None

                        await audit_service.update_query_log(
                            query_history_id=query_history_id,
                            generated_sql=last_generated_sql,
                            execution_time_ms=execution_time,
                            is_success=is_success,
                            error_message=error_msg
                        )

                    # Build complete event - only include row_count and data for successful queries
                    # Build complete event - only include row_count and data for successful queries
                    complete_event = {
                        "type": "complete",
                        "response": final_resp,
                        "execution_time_ms": int((time.time() - initial_state["start_time"]) * 1000),
                        "thread_id": thread_id,  # Include thread_id for potential resume
                        "is_refinement": last_is_refinement,  # Use tracked value
                        "iteration_count": last_iteration_count,  # Use tracked value
                        "data_fetched": last_data_fetched  # NEW
                    }

                    # Only include SQL for successful response_composer completions
                    if node_name == "response_composer":
                        complete_event["sql"] = last_generated_sql or state_update.get("generated_sql")

                    yield complete_event
    
    async def resume(self, thread_id: str):
        """
        Resume a workflow from a saved checkpoint.
        
        Args:
            thread_id: The thread ID of the workflow to resume
        """
        if not state_checkpointer.get_checkpointer():
            raise ValueError("State persistence not enabled, cannot resume workflow")
        
        logger.info("Resuming workflow from checkpoint", thread_id=thread_id)
        
        config = {"configurable": {"thread_id": thread_id}}
        
        # Resume from last checkpoint
        async for event in self.app.astream(None, config=config):
            for node_name, state_update in event.items():
                if "current_step" in state_update:
                    yield {
                        "type": "thinking",
                        "stage": node_name,
                        "message": f"Resumed: {node_name}"
                    }
                
                if node_name in ["response_composer", "guardrail_responder", "error_handler", "clarification_responder", "no_match_responder", "data_guide_responder"]:
                    final_resp = state_update.get("final_response", "")
                    yield {
                        "type": "complete",
                        "response": final_resp,
                        "sql": state_update.get("generated_sql"),
                        "thread_id": thread_id
                    }

    async def generate_sql_only(self, user_message: str) -> Dict[str, Any]:
        """
        Generate SQL from a natural language query WITHOUT database validation.
        
        This is a simplified version that only runs:
        1. load_config - Load agent configuration
        2. unified_intent - Analyze the user's intent
        3. schema_search - Find relevant schema
        4. query_builder - Generate SQL
        
        It SKIPS:
        - native_schema_validator (which tries to connect to external DB)
        - sql_corrector
        - response_composer
        
        Args:
            user_message: The user's natural language query
            
        Returns:
            Dict with keys: sql, success, message, intent, execution_time_ms
        """
        start_time = time.time()
        
        # Initialize nodes if needed
        if not self.nodes:
            await self._initialize_nodes()
        
        # Generate a temporary thread ID
        temp_thread_id = f"sql_gen_{uuid_module.uuid4().hex[:16]}"
        
        # Create initial state
        state = QueryState(
            agent_id=self.agent_id,
            session_id=self.session_id,
            user_message=user_message,
            context=[],
            start_time=start_time,
            query_history_id=None,
            thread_id=temp_thread_id,
            is_refinement=False,
            previous_query=None,
            previous_sql=None,
            previous_user_message=None,
            last_query_user_message=user_message,
            previous_results=None,
            refinement_intent=None,
            iteration_count=0,
            correction_iteration=0,
            # Initialize optionals
            agent_config=None, schema_metadata=None, sensitivity_rules=None,
            intent=None, relevant_tables_from_intent=[], 
            is_off_topic=False, is_ambiguous=False, is_data_guide_request=False, clarifying_questions=[],
            correction_note=None,
            relevant_schema=[],
            pinned_schema=None,
            no_match=False,
            canonical_query=None, generated_sql=None, sql_dialect="postgresql",
            validation_result=None, queryability_warnings=[], pre_query_warnings=[],
            raw_results=[], sanitized_results=[],
            final_response="", error=None, execution_time_ms=0, current_step="init"
        )
        
        try:
            # Step 1: Load config
            logger.info("SQL-only: Loading config")
            config_update = await self.nodes.load_config(state)
            state.update(config_update)
            
            if state.get("error"):
                return self._build_sql_only_response(None, state.get("error"), None, start_time)
            
            # Step 2: Unified Intent Analysis
            # NOTE: For the SQL generation API, we still run intent to extract entities/tables
            # but we SKIP the off-topic check since user explicitly wants SQL generation
            logger.info("SQL-only: Analyzing intent")
            intent_update = await self.nodes.unified_intent_node(state)
            state.update(intent_update)
            
            intent_data = state.get("intent", {})
            primary_intent = intent_data.get("primary_intent")
            
            # For SQL generation API, we don't reject off-topic or ambiguous queries
            # The user explicitly asked for SQL, so we try our best to generate it
            logger.info("SQL-only: Skipping intent guards (user explicitly wants SQL)", 
                       intent=primary_intent, is_off_topic=state.get("is_off_topic"))
            
            # Step 3: Schema Search
            logger.info("SQL-only: Searching schema")
            schema_update = await self.nodes.schema_search(state)
            state.update(schema_update)
            
            if state.get("no_match"):
                return self._build_sql_only_response(
                    None,
                    "Could not find relevant tables for this query.",
                    primary_intent,
                    start_time
                )
            
            # Step 4: Query Builder (Generate SQL)
            # Step 4: Query Builder (Generate SQL)
            logger.info("SQL-only: Building SQL")
            query_update = await self.nodes.query_builder(state)
            
            # Check if query_builder returned an error (it catches its own exceptions)
            if query_update.get("error"):
                 raise Exception(f"Query Builder failed: {query_update.get('error')}")

            state.update(query_update)
            
            generated_sql = state.get("generated_sql")
            
            if not generated_sql:
                 # If no SQL but no explicit error, still trigger fallback
                 raise Exception("No SQL generated by Query Builder")
            
            # Success - return the SQL without database validation
            return self._build_sql_only_response(
                generated_sql,
                state.get("canonical_query") or "SQL generated successfully",
                primary_intent,
                start_time
            )
            
        except Exception as e:
            logger.warning("Pipeline nodes failed, attempting minimal fallback", error=str(e))
            
            # --- FALLBACK MECHANISM ---
            # If the sophisticated pipeline fails (e.g. model doesn't support tools/streaming),
            # fall back to a simple, direct prompt approach using the loaded schema.
            
            try:
                # Ensure we at least have config loaded
                if not state.get("schema_metadata"):
                     logger.info("Fallback: Loading config")
                     config_update = await self.nodes.load_config(state)
                     state.update(config_update)
                
                # Get summarized schema
                # We access the method from IntentNodes (mixed into QueryGraphNodes)
                schema_summary = self.nodes._build_orchestrator_schema_summary(state)
                dialect = state.get("sql_dialect", "postgresql")
                
                # Build a simple direct prompt (No tools, no structured output)
                from langchain_core.messages import SystemMessage, HumanMessage
                
                fallback_system_prompt = (
                    f"You are an expert SQL assistant for a {dialect} database.\n"
                    f"Your task is to generate a valid SQL query for the user's question.\n"
                    f"Return ONLY the SQL query. Do not include markdown formatting (like ```sql), explanations, or notes.\n"
                    f"Just the raw SQL query string.\n\n"
                    f"Database Schema Summary:\n{schema_summary}"
                )
                
                logger.info("Fallback: Calling LLM directly")
                response = await self.nodes.llm.ainvoke([
                    SystemMessage(content=fallback_system_prompt),
                    HumanMessage(content=user_message)
                ])
                
                fallback_sql = response.content
                
                # Basic cleaning
                fallback_sql = self.nodes._normalize_sql(fallback_sql)
                # Remove markdown code blocks if present (despite instructions)
                fallback_sql = fallback_sql.replace("```sql", "").replace("```", "").strip()
                
                if fallback_sql:
                     return self._build_sql_only_response(
                        fallback_sql,
                        "Generated via fallback (simplified mode)",
                        "direct_sql",
                        start_time
                    )
                    
            except Exception as fallback_error:
                logger.error("Fallback generation also failed", error=str(fallback_error))
                error = f"Primary error: {str(e)}. Fallback error: {str(fallback_error)}"

        execution_time_ms = int((time.time() - start_time) * 1000)
        
        return {
            "sql": None,
            "success": False,
            "message": error or "Failed to generate SQL (Unknown error)",
            "intent": intent if 'intent' in locals() else None,
            "execution_time_ms": execution_time_ms
        }

    def _build_sql_only_response(
        self, 
        sql: str, 
        message: Any, 
        intent: str, 
        start_time: float
    ) -> Dict[str, Any]:
        """Build standardized response for SQL-only generation."""
        execution_time_ms = int((time.time() - start_time) * 1000)
        
        # Ensure message is a string to pass Pydantic validation
        if message is not None and not isinstance(message, str):
            if isinstance(message, dict) and "message" in message:
                message = message["message"]
            else:
                message = str(message)
                
        return {
            "sql": sql,
            "success": sql is not None,
            "message": message,
            "intent": intent,
            "execution_time_ms": execution_time_ms
        }
