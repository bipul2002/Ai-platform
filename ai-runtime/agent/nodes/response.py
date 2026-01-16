from typing import Dict, Any, List, Optional
import structlog

from agent.nodes.base import BaseNode, QueryState
from agent.utils import make_json_serializable

logger = structlog.get_logger()

class ResponseNodes(BaseNode):
    async def response_composer(self, state: QueryState) -> Dict:
        """Compose final user response"""
        logger.info("Composing final response", warnings_count=len(state.get("queryability_warnings", [])))
        
        response_text = ""
        
        # 1. Provide a natural language confirmation instead of direct SQL
        if state.get("generated_sql"):
            if state.get("sql_explanation"):
                response_text += f"{state['sql_explanation']} "
            elif state.get("is_refinement"):
                response_text += "I've updated the query based on your request. "
            else:
                response_text += "I've generated a query to answer your question. "
        else:
             # Fixed: Use specific user-requested message for missing queries
             response_text += "Not able to process this request. "

        # 2. Add correction notes if any
        if state.get("correction_note"):
            response_text += f"\n\n**Note:** {state['correction_note']}"
        
        # 3. Add warnings if any
        warnings = state.get("queryability_warnings")
        if warnings:
            response_text += "\n\n**⚠️ Warnings:**\n"
            seen = set()
            for w in warnings:
                msg = w.get('message', str(w))
                if msg not in seen:
                    response_text += f"- {msg}\n"
                    seen.add(msg)

        # 4. Add Errors (e.g. Connection Error)
        if state.get("error"):
            response_text += f"\n\n**❌ Error:** {state['error']}"

        return {
            "final_response": response_text.strip(),
            "current_step": "complete",
            "result_type": "table" if state.get("generated_sql") else "text"
        }

    async def error_handler(self, state: QueryState) -> Dict:
        """Unified error handling"""
        error_msg = state.get("error") or "Unknown error"
        return {
            "final_response": f"I encountered an error: {error_msg}",
            "current_step": "error"
        }
