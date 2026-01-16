import asyncio
import json
from typing import Dict, Any, List, Optional, Tuple
import structlog
from langchain_core.messages import SystemMessage, HumanMessage

from agent.nodes.base import BaseNode, QueryState
from agent.prompts import UNIFIED_INTENT_SYSTEM_PROMPT, GUARDRAIL_RESPONSE, DATA_GUIDE_SYSTEM_PROMPT
from agent.utils import parse_json_content, format_chat_history
from agent.llm import get_llm
from agent.models import IntentStructure

logger = structlog.get_logger()

class IntentNodes(BaseNode):
    async def load_config(self, state: QueryState) -> Dict:
        """Optimized config loader using parallel DB calls"""
        try:
            logger.info("=== LOADING AGENT CONFIGURATION (Optimized) ===", agent_id=state["agent_id"])

            # 1. Parallelize DB calls
            config_task = self.system_db.get_agent_config(state["agent_id"])
            schema_task = self.system_db.get_agent_enriched_metadata(state["agent_id"])
            sensitivity_task = self.system_db.get_agent_sensitivity(state["agent_id"])

            config, schema, sensitivity = await asyncio.gather(config_task, schema_task, sensitivity_task)
            
            # Initialize LLM
            self.llm = get_llm(
                provider=config.get('llmProvider', 'openai'),
                model=config.get('llmModel', 'gpt-4-turbo-preview'),
                temperature=config.get('llmTemperature', 0.0)
            )

            # Extract sensitive columns for filtering
            sensitive_cols = self._extract_sensitive_columns(schema)

            return {
                "agent_config": config,
                "schema_metadata": schema,
                "sensitivity_rules": sensitivity,
                "sensitivity_columns": sensitive_cols,
                "sql_dialect": config.get("dbType", "postgresql"),
                "current_step": "config_loaded"
            }
        except Exception as e:
            logger.error("Configuration loading failed", error=str(e))
            raise

    async def unified_intent_node(self, state: QueryState) -> Dict:
        """Consolidated refinement and NLU detection in a single LLM call"""
        if state.get("error"): return {}

        # Prepare context
        custom_dict = state["agent_config"].get("customDictionary", {})
        orchestrator_summary = self._build_orchestrator_schema_summary(state)
        
        # Build restricted context for orchestrator (all restricted entities)
        restricted_entities = self._build_restricted_context(state)
        
        agent_name = state["agent_config"].get("name", "AI Assistant")
        
        
        previous_user_message = state.get("previous_user_message", "N/A")
        previous_sql = state.get("previous_sql", "N/A")
        
        logger.info("Orchestrator Context", 
                    previous_sql=previous_sql[:100] if previous_sql else "None",
                    previous_user_message=previous_user_message)

        from datetime import datetime
        current_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        chat_history = format_chat_history(state.get("context", []))

        system_prompt = UNIFIED_INTENT_SYSTEM_PROMPT.format(
            agent_name=agent_name,
            schema_summary=orchestrator_summary,
            restricted_entities=restricted_entities,
            custom_dict=json.dumps(custom_dict, indent=2),
            chat_history=chat_history,
            previous_user_message=previous_user_message,
            previous_sql=previous_sql,
            user_message=state["user_message"],
            current_date=current_date
        )

        try:
            logger.info("Calling Orchestrator LLM", agent_id=state["agent_id"], model=self.agent_config.get("llmModel"))
            
            response_obj = await self._call_llm_with_logging(
                messages=[
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=state["user_message"])
                ],
                node_name="unified_intent",
                query_history_id=state.get("query_history_id"),
                structured_model=IntentStructure
            )

            if not response_obj:
                logger.error("Failed to get unified intent response")
                return {
                    "is_refinement": False, 
                    "is_off_topic": True, 
                    "intent": {"primary_intent": "out_of_scope", "route_to": "none", "intent_summary": "Parsing failed"},
                    "final_response": "I'm sorry, I'm having trouble processing that. Could you try rephrasing?",
                    "current_step": "intent_analyzed"
                }

            # Map unified response to QueryState
            content = response_obj.model_dump()
            logger.info("Parsed intent content", content=content)
            
            primary_intent = content.get("primary_intent")
            is_refinement = content.get("is_refinement", False)
            is_direct_sql = content.get("is_direct_sql", False)
            route_to = content.get("route_to", "query_builder")
            rejected = content.get("rejected", False)
            
            # Robustness: Force route_to: "none" for conversational intents if LLM is inconsistent
            conversational_intents = ["greeting", "data_guide", "query_explanation", "out_of_scope"]
            if primary_intent in conversational_intents:
                route_to = "none"

            # Robustness: legacy flags for downstream compatibility
            is_data_guide = primary_intent == "data_guide"
            is_db_query = primary_intent in ["database_query", "correction"]
            
            if is_direct_sql:
                is_refinement = False

            is_off_topic = primary_intent == "out_of_scope" or rejected or primary_intent == "greeting"
            
            # Table identification: map required_tables to what schema_search expects
            relevant_tables_from_intent = content.get("required_tables", [])

            logger.info("Orchestrator analysis complete", 
                        intent=primary_intent,
                        is_refinement=is_refinement, 
                        route_to=route_to,
                        rejected=rejected,
                        relevant_tables=relevant_tables_from_intent)

            result = {
                "intent": content,
                "is_refinement": is_refinement,
                "refinement_intent": content if is_refinement else None,
                "refinement_complexity": content.get("refinement_complexity") if is_refinement else None,
                "needs_schema_search": content.get("needs_schema_search", False),
                "new_entities": content.get("new_entities", []) if is_refinement else [],
                "relevant_tables_from_intent": relevant_tables_from_intent,
                
                "is_data_guide_request": is_data_guide,
                "is_direct_sql": is_direct_sql,
                "is_off_topic": is_off_topic,
                "is_ambiguous": content.get("is_ambiguous", False),
                "clarifying_questions": content.get("clarifying_questions", []),
                "current_step": "intent_analyzed"
            }

            # Phase 45: Reset stale schema context if not a refinement
            if not is_refinement:
                result["relevant_schema"] = []
                result["pinned_schema"] = None
                logger.info("Resetting stale schema context for new query")

            # Handle direct response if routing is "none" or it's a known conversational intent
            if route_to == "none" or rejected:
                result["final_response"] = content.get("direct_response") or "I'm sorry, I cannot process that request."
                result["data_fetched"] = False
                # If it's a greeting but LLM didn't provide direct_response, add a default
                if primary_intent == "greeting" and not content.get("direct_response"):
                    result["final_response"] = "Hi there! How can I help you with your data today?"

            return result
        except Exception as e:
            logger.error("Unified intent node failed", error=str(e), traceback=True)
            return {
                "is_refinement": False, 
                "is_off_topic": True, 
                "intent": {"primary_intent": "out_of_scope", "route_to": "none", "intent_summary": "Error fallback"},
                "final_response": "I encountered an error while analyzing your request. Please try again.",
                "current_step": "intent_analyzed"
            }


    async def guardrail_responder(self, state: QueryState) -> Dict:
        """Standard guardrail responder - uses direct_response if provided by orchestrator"""
        response = state.get("final_response") or GUARDRAIL_RESPONSE
        return {
            "final_response": response,
            "current_step": "guardrail_response",
            "is_off_topic": True,
            "data_fetched": False
        }

    async def no_match_responder(self, state: QueryState) -> Dict:
        """Handle cases where schema search finds no relevant tables"""
        response = state.get("final_response") or "I don't have any matching data to answer that. Could you please rephrase or ask about something else?"
        return {
            "final_response": response,
            "current_step": "no_match_response",
            "error": "No relevant schema found"
        }

    async def clarification_responder(self, state: QueryState) -> Dict:
        """Ask clarifying questions if intent is ambiguous"""
        if state.get("final_response"):
            return {"final_response": state["final_response"], "current_step": "complete"}
            
        questions = state.get("clarifying_questions", [])
        if not questions:
            response = "I'm not sure what you mean. Could you please clarify?"
        else:
            response = "I need a bit more information to help you:\n" + "\n".join([f"- {q}" for q in questions])

        try:
            data_guide = await self._generate_data_guide_text(state)
            if data_guide:
                response += "\n\n---\n\n**To help you, here is a guide on what data is available:**\n\n" + data_guide
        except Exception as e:
            logger.error("Failed to append data guide to clarification", error=str(e))

        return {"final_response": response, "current_step": "complete"}

    async def data_guide_responder(self, state: QueryState) -> Dict:
        """Conversational guidance about available data."""
        if state.get("final_response"):
            return {
                "final_response": state["final_response"],
                "current_step": "complete",
                "data_fetched": False
            }
        
        try:
            final_response = await self._generate_data_guide_text(state)
            return {
                "final_response": final_response or "I'm here to help you explore your data.",
                "current_step": "complete",
                "data_fetched": False
            }
        except Exception as e:
            logger.error("Data guide generation failed", error=str(e))
            return {
                "final_response": "I'm here to help you explore your data. Please rephrase your question.",
                "current_step": "complete",
                "data_fetched": False
            }

    async def _generate_data_guide_text(self, state: QueryState) -> str:
        """Helper to generate natural language data guide text using LLM."""
        schema_metadata = state.get("schema_metadata")
        if not schema_metadata: return ""

        agent_config = state.get("agent_config", {})
        guide_context = self._build_data_guide_context(schema_metadata, agent_config)

        system_prompt = DATA_GUIDE_SYSTEM_PROMPT.format(
            guide_context=guide_context,
            agent_name=agent_config.get("name", "Database Assistant")
        )

        response = await self._call_llm_with_logging(
            messages=[
                SystemMessage(content=system_prompt),
                HumanMessage(content=state.get("user_message", "Show me available data"))
            ],
            node_name="data_guide_generator",
            query_history_id=state.get("query_history_id")
        )
        return response.content

    def _build_orchestrator_schema_summary(self, state: QueryState) -> str:
        """
        Build a simplified schema summary specifically for the Orchestrator.
        Format: Table -> "Description" (if exists) or just Table
        Section: How Entities Connect (Unique symmetrical relationships)
        Includes [RESTRICTED] labels for non-queryable tables and columns.
        """
        lines = []
        schema_metadata = state["schema_metadata"]
        tables = schema_metadata.get("tables", [])
        relationships = schema_metadata.get("relationships", [])
        
        # Build set of forbidden fields for efficient lookup
        forbidden_fields = state.get("sensitivity_rules", {}).get("forbiddenFields", [])
        forbidden_tables = {f.lower() for f in forbidden_fields if "." not in f}
        forbidden_cols = {f.lower() for f in forbidden_fields if "." in f}

        # 1. List all Tables
        lines.append("### AVAILABLE TABLES ###")
        for table in tables:
            is_queryable = table.get("isQueryable", True)
            name = table.get("name") or table.get("tableName", "unknown")
            desc = table.get("description")
            
            is_fully_restricted = not table.get("isQueryable", True) or name.lower() in forbidden_tables
            
            label = ""
            if is_fully_restricted:
                label = " [FULLY RESTRICTED]"
            else:
                # Check for column-level restrictions
                restricted_cols = []
                for col in table.get("columns", []):
                    c_name = col.get("name") or col.get("columnName")
                    full_col = f"{name.lower()}.{c_name.lower()}"
                    if not col.get("isQueryable", True) or full_col in forbidden_cols:
                        restricted_cols.append(c_name)
                
                if restricted_cols:
                    label = f" [COLUMNS RESTRICTED: {', '.join(restricted_cols)}]"
            
            # Clean description: filter out None, "None", and empty strings
            is_valid_desc = desc and str(desc).strip() and str(desc).lower() != "none"
            
            if is_valid_desc:
                lines.append(f"{name}{label} -> \"{str(desc).strip()}\"")
            else:
                lines.append(f"{name}{label}")
        
        lines.append("")

        # 2. List all Relationships (Symmetrical De-duplication)
        if relationships:
            lines.append("### HOW ENTITIES CONNECT ###")
            seen_pairs = set()
            for rel in relationships:
                src = rel.get("sourceTable")
                tgt = rel.get("targetTable")
                if src and tgt:
                    # Sort pair to treat (A, B) and (B, A) as identical
                    pair = tuple(sorted([src, tgt]))
                    if pair not in seen_pairs:
                        lines.append(f"{src} connects to {tgt}")
                        seen_pairs.add(pair)
        
        return "\n".join(lines)

    def _build_data_guide_context(self, schema_metadata: Dict, agent_config: Dict) -> str:
        """Convert technical schema into natural language context."""
        lines = []
        tables = schema_metadata.get("tables", [])
        relationships = schema_metadata.get("relationships", [])
        custom_dict = agent_config.get("customDictionary", {})

        lines.append("=== Available Data Entities ===\n")
        for table in [t for t in tables if t.get("isQueryable", True)][:15]:
            t_name = table.get("name", "")
            desc = table.get("description", "")
            lines.append(f"**{t_name}**" + (f": {desc}" if desc else ""))
            
            cols = [f"  - {c['name']}" + (f": {c['description']}" if c.get('description') else "") 
                    for c in table.get("columns", []) 
                    if c.get("isQueryable", True) and c['name'].lower() not in ['id', 'created_at', 'updated_at']]
            if cols:
                lines.append("  Key fields:")
                lines.extend(cols[:5])
            lines.append("")

        if relationships:
            lines.append("\n=== How Entities Connect ===\n")
            for rel in relationships[:10]:
                lines.append(f"- {rel.get('sourceTable')} connects to {rel.get('targetTable')}")

        if custom_dict:
            lines.append("\n=== Special Terms ===\n")
            if isinstance(custom_dict, dict):
                for term, definition in list(custom_dict.items())[:10]:
                    lines.append(f"- **{term}**: {definition}")

        return "\n".join(lines)
