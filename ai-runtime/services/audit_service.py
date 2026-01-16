"""
Audit Service for Direct Database Writes
Handles logging of query history, pipeline execution, and LLM calls
"""
from typing import Dict, Any, List, Optional
import uuid
from datetime import datetime
import structlog
from sqlalchemy import select

from db.session import get_db
from db.models import QueryHistory, QueryPipelineExecution, QueryLlmCall

logger = structlog.get_logger()

# Sensitive keys that should be removed from LLM config before logging
SENSITIVE_CONFIG_KEYS = {
    'api_key', 'openai_api_key', 'anthropic_api_key',
    'api_secret', 'access_token', 'secret_key',
    'password', 'token', 'authorization'
}

class AuditService:
    """Service for audit logging with direct database writes"""

    def _sanitize_llm_config(self, config: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Remove sensitive information from LLM configuration before logging.
        CRITICAL: Prevents API keys and other secrets from being stored in logs.

        Args:
            config: Raw LLM configuration dictionary

        Returns:
            Sanitized configuration with sensitive keys removed
        """
        if not config:
            return None

        sanitized = {}
        for key, value in config.items():
            # Skip any key that contains sensitive terms
            key_lower = key.lower()
            if any(sensitive in key_lower for sensitive in SENSITIVE_CONFIG_KEYS):
                logger.debug("Removed sensitive key from LLM config", key=key)
                continue
            sanitized[key] = value

        return sanitized

    async def _to_uuid(self, val: Any) -> Optional[uuid.UUID]:
        """Safely convert a value (string or UUID object) to a UUID object."""
        if val is None or val == "":
            return None
        if isinstance(val, uuid.UUID):
            return val
        try:
            return uuid.UUID(str(val))
        except (ValueError, TypeError):
            logger.warning("Invalid UUID format ignored", value=val)
            return None

    async def create_query_log(
        self,
        agent_id: str,
        user_message: str,
        organization_id: Optional[str] = None,
        session_id: Optional[str] = None,
        canonical_query: Optional[Dict[str, Any]] = None,
        generated_sql: Optional[str] = None,
        sql_dialect: Optional[str] = None,
        execution_time_ms: Optional[int] = None,
        row_count: Optional[int] = None,
        is_success: bool = True,
        error_message: Optional[str] = None,
        validation_errors: Optional[Dict[str, Any]] = None,
        sanitization_applied: Optional[Dict[str, Any]] = None,
        thread_id: Optional[str] = None,
        is_refinement: bool = False,
        iteration_count: int = 1,
        api_key_id: Optional[str] = None,
        api_key_name: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Optional[uuid.UUID]:
        """
        Create a query history record and return its ID.
        This is the main entry point for query audit logging.

        Returns:
            UUID of the created query_history record, or None if logging fails
        """
        logger.info(
            "Attempting to create query log",
            agent_id=agent_id,
            user_message=user_message[:50] + "...",
            api_key_id=api_key_id,
            user_id=user_id
        )
        try:
            async for session in get_db():
                query_log = QueryHistory(
                    agentId=await self._to_uuid(agent_id),
                    organizationId=await self._to_uuid(organization_id),
                    sessionId=session_id,
                    userMessage=user_message,
                    canonicalQuery=canonical_query,
                    generatedSql=generated_sql,
                    sqlDialect=sql_dialect,
                    executionTimeMs=execution_time_ms,
                    rowCount=row_count,
                    isSuccess=is_success,
                    errorMessage=error_message,
                    validationErrors=validation_errors,
                    sanitizationApplied=sanitization_applied,
                    threadId=thread_id,
                    isRefinement=is_refinement,
                    iterationCount=iteration_count,
                    apiKeyId=await self._to_uuid(api_key_id),
                    apiKeyName=api_key_name,
                    userId=await self._to_uuid(user_id),
                )

                session.add(query_log)
                await session.commit()
                await session.refresh(query_log)

                logger.info(
                    "Query log created",
                    query_history_id=str(query_log.id),
                    agent_id=agent_id,
                    organization_id=organization_id,
                    is_refinement=is_refinement,
                    is_success=is_success
                )

                return query_log.id
            
            logger.warning("get_db() did not yield a session in create_query_log")
            return None

        except Exception as e:
            import traceback
            logger.error(
                "Failed to create query log", 
                error=str(e), 
                stack=traceback.format_exc(),
                agent_id=agent_id, 
                api_key_id=api_key_id
            )
            return None

    async def log_pipeline_execution(
        self,
        query_history_id: uuid.UUID,
        node_name: str,
        execution_order: int,
        started_at: datetime,
        completed_at: Optional[datetime] = None,
        duration_ms: Optional[int] = None,
        node_state: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ) -> bool:
        """
        Log execution of a pipeline node.

        Returns:
            True if logging succeeded, False otherwise
        """
        try:
            async for session in get_db():
                pipeline_exec = QueryPipelineExecution(
                    queryHistoryId=query_history_id,
                    nodeName=node_name,
                    executionOrder=execution_order,
                    startedAt=started_at,
                    completedAt=completed_at,
                    durationMs=duration_ms,
                    nodeState=node_state,
                    error=error
                )

                session.add(pipeline_exec)
                await session.commit()

                logger.debug(
                    "Pipeline execution logged",
                    query_history_id=str(query_history_id),
                    node_name=node_name,
                    execution_order=execution_order
                )

                return True

        except Exception as e:
            logger.warning(
                "Failed to log pipeline execution",
                error=str(e),
                query_history_id=str(query_history_id),
                node_name=node_name
            )
            return False

    async def log_llm_call(
        self,
        query_history_id: uuid.UUID,
        node_name: str,
        llm_provider: str,
        llm_model: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        response: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        token_usage: Optional[Dict[str, Any]] = None,
        duration_ms: Optional[int] = None,
        error: Optional[str] = None
    ) -> bool:
        """
        Log an LLM API call with complete configuration (sanitized).

        CRITICAL: This method automatically sanitizes llm_config to remove API keys
        and other sensitive information before storing in the database.

        Args:
            llm_config: Raw LLM configuration - will be sanitized automatically

        Returns:
            True if logging succeeded, False otherwise
        """
        try:
            # CRITICAL SECURITY: Sanitize config to remove API keys
            sanitized_config = self._sanitize_llm_config(llm_config)

            async for session in get_db():
                llm_call = QueryLlmCall(
                    queryHistoryId=query_history_id,
                    nodeName=node_name,
                    llmProvider=llm_provider,
                    llmModel=llm_model,
                    systemPrompt=system_prompt,
                    prompt=prompt,
                    response=response,
                    llmConfig=sanitized_config,
                    tokenUsage=token_usage,
                    durationMs=duration_ms,
                    error=error
                )

                session.add(llm_call)
                await session.commit()

                logger.debug(
                    "LLM call logged",
                    query_history_id=str(query_history_id),
                    node_name=node_name,
                    llm_provider=llm_provider,
                    llm_model=llm_model
                )

                return True

        except Exception as e:
            logger.warning(
                "Failed to log LLM call",
                error=str(e),
                query_history_id=str(query_history_id),
                node_name=node_name
            )
            return False

    async def update_query_log(
        self,
        query_history_id: uuid.UUID,
        generated_sql: Optional[str] = None,
        execution_time_ms: Optional[int] = None,
        row_count: Optional[int] = None,
        is_success: Optional[bool] = None,
        error_message: Optional[str] = None
    ) -> bool:
        """
        Update a query log with execution results.
        Useful for updating the log after SQL execution completes.

        Returns:
            True if update succeeded, False otherwise
        """
        try:
            async for session in get_db():
                stmt = select(QueryHistory).where(QueryHistory.id == query_history_id)
                result = await session.execute(stmt)
                query_log = result.scalar_one_or_none()

                if not query_log:
                    logger.warning("Query log not found for update", query_history_id=str(query_history_id))
                    return False

                if generated_sql is not None:
                    query_log.generatedSql = generated_sql
                if execution_time_ms is not None:
                    query_log.executionTimeMs = execution_time_ms
                if row_count is not None:
                    query_log.rowCount = row_count
                if is_success is not None:
                    query_log.isSuccess = is_success
                if error_message is not None:
                    query_log.errorMessage = error_message

                await session.commit()

                logger.debug("Query log updated", query_history_id=str(query_history_id))
                return True

        except Exception as e:
            logger.warning(
                "Failed to update query log",
                error=str(e),
                query_history_id=str(query_history_id)
            )
            return False

# Global singleton instance
audit_service = AuditService()
