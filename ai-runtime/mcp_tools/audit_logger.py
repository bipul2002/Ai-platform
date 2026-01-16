from typing import Dict, Any, Optional
from datetime import datetime
import httpx
import structlog

from services.config import settings

logger = structlog.get_logger()


class AuditLogger:
    def __init__(self):
        self.admin_backend_url = settings.admin_backend_url
    
    async def log_query(
        self,
        agent_id: str,
        session_id: str,
        user_message: str,
        canonical_query: Optional[Dict[str, Any]] = None,
        generated_sql: Optional[str] = None,
        sql_dialect: Optional[str] = None,
        execution_time_ms: Optional[int] = None,
        row_count: Optional[int] = None,
        is_success: bool = True,
        error_message: Optional[str] = None,
        validation_errors: Optional[Dict] = None,
        sanitization_applied: Optional[Dict] = None
    ) -> bool:
        try:
            payload = {
                "agentId": agent_id,
                "sessionId": session_id,
                "userMessage": user_message,
                "canonicalQuery": canonical_query,
                "generatedSql": generated_sql,
                "sqlDialect": sql_dialect,
                "executionTimeMs": execution_time_ms,
                "rowCount": row_count,
                "isSuccess": is_success,
                "errorMessage": error_message,
                "validationErrors": validation_errors,
                "sanitizationApplied": sanitization_applied,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.admin_backend_url}/api/audit/queries",
                    json=payload,
                    timeout=5.0
                )
                response.raise_for_status()
            
            logger.debug("Query audit logged", agent_id=agent_id, session_id=session_id)
            return True
            
        except Exception as e:
            logger.warning("Failed to log query audit", error=str(e))
            return False
    
    async def log_action(
        self,
        agent_id: Optional[str],
        action: str,
        resource_type: str,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        is_success: bool = True,
        error_message: Optional[str] = None
    ) -> bool:
        try:
            payload = {
                "agentId": agent_id,
                "action": action,
                "resourceType": resource_type,
                "resourceId": resource_id,
                "details": details or {},
                "isSuccess": is_success,
                "errorMessage": error_message,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.admin_backend_url}/api/audit/logs",
                    json=payload,
                    timeout=5.0
                )
                response.raise_for_status()
            
            return True
            
        except Exception as e:
            logger.warning("Failed to log action audit", error=str(e))
            return False
