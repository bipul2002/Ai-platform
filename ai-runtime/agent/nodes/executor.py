from typing import Dict, Any, List, Optional
import structlog
from mcp_tools.sql_executor import SQLExecutor

from agent.nodes.base import BaseNode, QueryState

logger = structlog.get_logger()

class ExecutorNodes(BaseNode):
    async def sql_executor(self, state: QueryState) -> Dict:
        """Execute/Validate SQL query and log telemetry"""
        if state.get("error") or not state.get("generated_sql"):
            return {}

        try:
            conn_details = await self.system_db.get_connection_details(state["agent_id"])
            executor = SQLExecutor(conn_details)
            
            clean_sql = state["generated_sql"].strip().rstrip(";")
            logger.info("Executing SQL", sql_preview=clean_sql[:100])
            results = await executor.execute(clean_sql)
            
            # Update query history with success
            if state.get("query_history_id"):
                 await self.audit_logger.update_query_log(
                     query_history_id=state["query_history_id"],
                     generated_sql=state["generated_sql"],
                     row_count=len(results),
                     is_success=True
                 )
            
            return {
                "raw_results": results,
                "current_step": "executed",
                "data_fetched": True
            }
        except Exception as e:
            logger.error("Execution failed", error=str(e))
            if state.get("query_history_id"):
                 await self.audit_logger.update_query_log(
                     query_history_id=state["query_history_id"],
                     is_success=False,
                     error_message=str(e)
                 )
            return {"error": str(e), "current_step": "execution_failed"}
