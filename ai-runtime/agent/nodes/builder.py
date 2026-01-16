from datetime import datetime
from typing import Dict, Any, List, Optional
import structlog
import json
from langchain_core.messages import SystemMessage, HumanMessage

from agent.nodes.base import BaseNode, QueryState
from agent.prompts import build_query_builder_prompt
from agent.utils import format_chat_history

logger = structlog.get_logger()

class BuilderNodes(BaseNode):
    async def query_builder(self, state: QueryState) -> Dict:
        """Generate canonical query structure with full schema context and custom prompts"""
        if state.get("error") or state.get("no_match"): return {}

        intent_data = state.get("intent") or {}
        
        # 1. Build rich schema context (tables, columns, FK relationships)
        schema_context = self._build_schema_context(state)
        # Escape curly braces for .format() safety
        schema_context_escaped = schema_context.replace("{", "{{").replace("}", "}}")
        
        # 2. Extract context
        is_refinement = state.get("is_refinement", False)
        is_direct_sql = state.get("is_direct_sql", False)
        relevant_tables = [t.get("name") or t.get("tableName") for t in (state.get("relevant_schema") or []) if t]
        restricted_context = self._build_restricted_context(state, table_names_filter=relevant_tables)
        
        # 3. Build dynamic system prompt
        system_prompt_template = build_query_builder_prompt(
            dialect=state["sql_dialect"], 
            is_refinement=is_refinement,
            is_direct_sql=is_direct_sql
        )
        
        # 4. Format prompt
        system_prompt = system_prompt_template.format(
            schema_context=schema_context_escaped,
            restricted_entities=restricted_context,
            chat_history=format_chat_history(state.get("context", [])),
            current_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            # Intent Analysis mapping
            intent_summary=intent_data.get("intent_summary") or state.get("user_message") or "None",
            is_refinement=is_refinement,
            is_direct_sql=is_direct_sql,
            base_query_to_modify=intent_data.get("base_query_to_modify") or state.get("previous_sql") or "N/A",
            changes=json.dumps(intent_data.get("changes") or {}, indent=2),
            required_tables=json.dumps(intent_data.get("required_tables") or [], indent=2),
            extracted_timeframe=json.dumps(intent_data.get("extracted_timeframe") or {}, indent=2),
            assumptions_made=intent_data.get("assumptions_made") or "None"
        )

        # 5. Extract domain-specific prompts/hints
        custom_prompts = self._extract_custom_prompts(state["schema_metadata"], state["user_message"])
        if custom_prompts:
            system_prompt += "\n\n### ADDITIONAL DOMAIN CONTEXT ###\n" + custom_prompts

        try:
            user_content = state["user_message"]
            logger.info("Calling Query Builder LLM with structured output")
            from agent.models import QueryStructure
            
            response = await self._call_llm_with_logging(
                messages=[
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_content)
                ],
                node_name="query_builder",
                query_history_id=state.get("query_history_id"),
                structured_model=QueryStructure
            )

            if not response:
                return {"error": "Failed to generate query structure", "current_step": "error"}

            logger.info("Query builder completed", sql_preview=response.generated_sql[:50] if response.generated_sql else "None")
            return {
                "canonical_query": response.model_dump(),
                "generated_sql": response.generated_sql,
                "sql_explanation": getattr(response, "sql_explanation", None),
                "correction_note": response.correction_note,
                "current_step": "query_built",
                "visual_confirmation": f"Generated SQL: {response.generated_sql}" if response.generated_sql else "No SQL generated"
            }
        except Exception as e:
            logger.error("Query builder failed", error=str(e))
            return {"error": str(e), "current_step": "error"}
