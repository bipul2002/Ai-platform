from typing import Dict, Any, List, Optional
import uuid
import json
import structlog
from datetime import datetime
from sqlalchemy import select, update, text, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import selectinload

from db.session import get_db
from db.models import (
    Agent, AgentExternalDbCredentials, AgentTable, AgentColumn,
    SensitiveFieldRegistryAgent, SensitiveFieldRegistryGlobal, ForbiddenField, AgentSchemaEmbedding,
    AgentRelationship
)
from services.encryption import encryption_service
from services.cache_service import cache_service

logger = structlog.get_logger()

class SystemDBService:
    async def get_agent_config(self, agent_id: str) -> Dict[str, Any]:
        # Try cache first
        cached = await cache_service.get_agent_config(agent_id)
        if cached:
            return cached
        
        async for session in get_db():
            stmt = select(Agent).where(Agent.id == uuid.UUID(agent_id))
            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()
            
            if not agent:
                raise ValueError(f"Agent {agent_id} not found")
                
            # Fetch external DB details
            stmt_db = select(AgentExternalDbCredentials).where(AgentExternalDbCredentials.agentId == agent.id)
            result_db = await session.execute(stmt_db)
            db_creds = result_db.scalar_one_or_none()
            
            config = {
                "id": str(agent.id),
                "organizationId": str(agent.organizationId) if agent.organizationId else None,
                "name": agent.name,
                "description": agent.description,
                "systemPromptOverride": agent.systemPromptOverride,
                "maxResultsLimit": agent.maxResultsLimit,
                "timeoutSeconds": agent.timeoutSeconds,
                "customDictionary": agent.customDictionary,
                "dbType": db_creds.dbType if db_creds else "postgresql",
                "llmProvider": agent.llmProvider or "openai",
                "llmModel": agent.llmModel or "gpt-4-turbo-preview",
                "llmTemperature": float(agent.llmTemperature) if agent.llmTemperature else 0.0
            }
            
            # Cache the config
            await cache_service.set_agent_config(agent_id, config)
            return config

    async def get_agent_enriched_metadata(self, agent_id: str) -> Dict[str, Any]:
        """
        Fetch enriched schema with all metadata for AI query pipeline.
        Python implementation - builds schema from database tables.
        Returns combined descriptions, hints, and visibility/sensitivity settings.
        """
        # Try cache first
        cached = await cache_service.get_schema(agent_id)
        if cached:
            return cached
        
        async for session in get_db():
            try:
                agent_uuid = uuid.UUID(agent_id)
                
                # Fetch all tables for this agent (only visible ones)
                tables_stmt = select(AgentTable).where(
                    AgentTable.agentId == agent_uuid,
                    AgentTable.isVisible == True
                ).order_by(AgentTable.tableName)
                
                tables_result = await session.execute(tables_stmt)
                tables = tables_result.scalars().all()
                
                if not tables:
                    logger.warning("No visible tables found for agent", agent_id=agent_id)
                    return {"tables": [], "relationships": []}
                
                # Build tables array
                tables_data = []
                for table in tables:
                    # Fetch columns for this table (only visible ones)
                    columns_stmt = select(AgentColumn).where(
                        AgentColumn.tableId == table.id,
                        AgentColumn.isVisible == True
                    ).order_by(AgentColumn.columnName)
                    
                    columns_result = await session.execute(columns_stmt)
                    columns = columns_result.scalars().all()
                    
                    # Build columns array
                    columns_data = []
                    for col in columns:
                        # Combine descriptions
                        description = self._combine_descriptions(
                            col.originalComment,
                            col.adminDescription
                        )
                        
                        columns_data.append({
                            "name": col.columnName,
                            "type": col.dataType,
                            "nullable": col.isNullable,
                            "primaryKey": col.isPrimaryKey,
                            "foreignKey": col.isForeignKey,
                            "unique": col.isUnique,
                            "indexed": col.isIndexed,
                            "defaultValue": col.defaultValue,
                            "description": description,
                            "semanticHints": col.semanticHints,
                            "customPrompt": col.customPrompt,
                            "isVisible": col.isVisible,
                            "isQueryable": col.isQueryable,
                            "isSensitive": col.isSensitive,
                            "sensitivityLevel": col.sensitivityOverride,
                            "maskingStrategy": col.maskingStrategyOverride
                        })
                    
                    # Combine table descriptions
                    table_description = self._combine_descriptions(
                        table.originalComment,
                        table.adminDescription
                    )
                    
                    tables_data.append({
                        "name": table.tableName,
                        "schema": table.schemaName,
                        "description": table_description,
                        "semanticHints": table.semanticHints,
                        "customPrompt": table.customPrompt,
                        "isVisible": table.isVisible,
                        "isQueryable": table.isQueryable,
                        "rowCountEstimate": table.rowCountEstimate,
                        "columns": columns_data
                    })
                
                # Fetch relationships
                relationships_stmt = select(AgentRelationship).where(
                    AgentRelationship.agentId == agent_uuid,
                    AgentRelationship.isActive == True
                )
                
                relationships_result = await session.execute(relationships_stmt)
                relationships = relationships_result.scalars().all()
                
                # Build relationships array
                relationships_data = []
                for rel in relationships:
                    # Fetch source and target table/column names
                    source_table_stmt = select(AgentTable).where(AgentTable.id == rel.sourceTableId)
                    source_table_result = await session.execute(source_table_stmt)
                    source_table = source_table_result.scalar_one_or_none()
                    
                    source_col_stmt = select(AgentColumn).where(AgentColumn.id == rel.sourceColumnId)
                    source_col_result = await session.execute(source_col_stmt)
                    source_col = source_col_result.scalar_one_or_none()
                    
                    target_table_stmt = select(AgentTable).where(AgentTable.id == rel.targetTableId)
                    target_table_result = await session.execute(target_table_stmt)
                    target_table = target_table_result.scalar_one_or_none()
                    
                    target_col_stmt = select(AgentColumn).where(AgentColumn.id == rel.targetColumnId)
                    target_col_result = await session.execute(target_col_stmt)
                    target_col = target_col_result.scalar_one_or_none()
                    
                    if source_table and source_col and target_table and target_col:
                        relationships_data.append({
                            "sourceTable": source_table.tableName,
                            "sourceColumn": source_col.columnName,
                            "targetTable": target_table.tableName,
                            "targetColumn": target_col.columnName,
                            "type": rel.relationshipType,
                            "constraintName": rel.originalConstraintName
                        })
                
                schema = {
                    "tables": tables_data,
                    "relationships": relationships_data
                }
                
                logger.info(
                    "Schema metadata loaded",
                    agent_id=agent_id,
                    table_count=len(tables_data),
                    relationship_count=len(relationships_data)
                )
                
                # Cache the schema
                await cache_service.set_schema(agent_id, schema)
                return schema
                
            except Exception as e:
                logger.error("Failed to fetch enriched schema", agent_id=agent_id, error=str(e), error_type=type(e).__name__)
                # Fallback to empty schema
                return {"tables": [], "relationships": []}
    
    def _combine_descriptions(self, original_comment: Optional[str], admin_description: Optional[str]) -> Optional[str]:
        """Combine original DB comment and admin description naturally"""
        if original_comment and admin_description:
            return f"{original_comment}. {admin_description}"
        elif original_comment:
            return original_comment
        elif admin_description:
            return admin_description
        else:
            return None


    async def get_agent_sensitivity(self, agent_id: str) -> Dict[str, Any]:
        """
        Fetch both global and agent-specific sensitivity rules.
        Returns format compatible with SensitivityRegistry.
        Excludes global rules that are disabled at the agent level.
        """
        async for session in get_db():
            try:
                # Fetch agent to get disabled sensitivity rules
                agent_stmt = select(Agent).where(Agent.id == uuid.UUID(agent_id))
                agent_result = await session.execute(agent_stmt)
                agent = agent_result.scalar_one_or_none()

                # Get list of disabled rule IDs (empty if agent not found)
                disabled_rule_ids = set(agent.disabledSensitivityRules) if agent and agent.disabledSensitivityRules else set()

                # Fetch global rules
                global_stmt = select(SensitiveFieldRegistryGlobal).where(
                    SensitiveFieldRegistryGlobal.isActive == True
                )
                global_result = await session.execute(global_stmt)
                global_rules = global_result.scalars().all()

                # Fetch agent-specific rules
                agent_rules_stmt = select(SensitiveFieldRegistryAgent).where(
                    SensitiveFieldRegistryAgent.agentId == uuid.UUID(agent_id),
                    SensitiveFieldRegistryAgent.isActive == True
                )
                agent_rules_result = await session.execute(agent_rules_stmt)
                agent_rules = agent_rules_result.scalars().all()

                # Fetch forbidden fields
                forbidden_stmt = select(ForbiddenField).where(
                    ForbiddenField.agentId == uuid.UUID(agent_id),
                    ForbiddenField.isActive == True
                )
                forbidden_result = await session.execute(forbidden_stmt)
                forbidden_fields = forbidden_result.scalars().all()

                # Filter out disabled global rules
                active_global_rules = [rule for rule in global_rules if str(rule.id) not in disabled_rule_ids]

                logger.info(
                    "Loaded sensitivity rules",
                    agent_id=agent_id,
                    global_count=len(active_global_rules),
                    disabled_count=len(disabled_rule_ids),
                    agent_count=len(agent_rules),
                    forbidden_count=len(forbidden_fields)
                )

                result_dict = {
                    "globalRules": [
                        {
                            "id": str(rule.id),
                            "patternType": rule.patternType,
                            "patternValue": rule.patternValue,
                            "patternRegex": rule.patternRegex,
                            "sensitivityLevel": rule.sensitivityLevel,
                            "maskingStrategy": rule.maskingStrategy,
                            "description": rule.description,
                            "isActive": rule.isActive
                        }
                        for rule in active_global_rules
                    ],
                    "agentRules": [
                        {
                            "id": str(rule.id),
                            "columnId": str(rule.columnId) if rule.columnId else None,
                            "patternType": rule.patternType,
                            "patternValue": rule.patternValue,
                            "patternRegex": rule.patternRegex,
                            "sensitivityLevel": rule.sensitivityLevel,
                            "maskingStrategy": rule.maskingStrategy,
                            "description": rule.description,
                            "isActive": rule.isActive
                        }
                        for rule in agent_rules
                    ],
                    "forbiddenFields": [
                        {
                            "id": str(field.id),
                            "table": field.tablePattern,
                            "column": field.columnPattern,
                            "reason": field.reason
                        }
                        for field in forbidden_fields
                    ]
                }
                
                # Cache the rules
                await cache_service.set_agent_sensitivity(agent_id, result_dict, ttl=300)
                return result_dict
            except Exception as e:
                logger.error("Failed to load sensitivity rules", error=str(e), agent_id=agent_id)
                # Return empty rules on error to avoid breaking pipeline
                return {
                    "globalRules": [],
                    "agentRules": [],
                    "forbiddenFields": []
                }

    async def get_connection_details(self, agent_id: str) -> Dict[str, Any]:
        # Try cache first
        cached = await cache_service.get_connection_details(agent_id)
        if cached:
            # Decrypt password from cached encrypted password
            try:
                if "encryptedPassword" in cached:
                    cached["password"] = encryption_service.decrypt(cached["encryptedPassword"])
                return cached
            except Exception as e:
                logger.warning("Failed to decrypt cached password", agent_id=agent_id, error=str(e))
                # Fallback to DB fetch if cache extraction fails
        
        async for session in get_db():
            stmt = select(AgentExternalDbCredentials).where(
                AgentExternalDbCredentials.agentId == uuid.UUID(agent_id)
            )
            result = await session.execute(stmt)
            creds = result.scalar_one_or_none()
            
            if not creds:
                raise ValueError(f"No credentials found for agent {agent_id}")
            
            # Create connection details with ENCRYPTED password for caching
            connection_details_cache = {
                "dbType": creds.dbType,
                "host": creds.host,
                "port": creds.port,
                "database": creds.databaseName,
                "username": creds.username,
                "encryptedPassword": creds.encryptedPassword, # Store encrypted
                "sslEnabled": creds.sslEnabled,
                "ssl": {
                    "enabled": creds.sslEnabled,
                    "ca": creds.sslCaCert
                }
            }
            
            # Cache the version with ENCRYPTED password
            await cache_service.set_connection_details(agent_id, connection_details_cache, ttl=300)
            
            # Create return version with DECRYPTED password
            try:
                decrypted_password = encryption_service.decrypt(creds.encryptedPassword)
                connection_details_return = connection_details_cache.copy()
                connection_details_return["password"] = decrypted_password
                return connection_details_return
            except Exception as e:
                logger.error("Failed to decrypt password", agent_id=agent_id, error=str(e))
                raise ValueError(f"Failed to decrypt database password: {str(e)}")

    async def update_agent_last_used(self, agent_id: str) -> None:
        async for session in get_db():
            try:
                # Use direct UPDATE instead of a stored function to avoid missing function errors
                stmt = text("""
                    UPDATE agents 
                    SET query_count = query_count + 1, 
                        last_used_at = NOW() 
                    WHERE id = :agent_id
                """)
                await session.execute(stmt, {"agent_id": agent_id})
                await session.commit()
            except Exception as e:
                logger.error("Failed to update last used", error=str(e))

    async def update_api_key_usage(self, api_key_id: str) -> None:
        async for session in get_db():
            try:
                # Use raw SQL to match the incremental update pattern
                stmt = text("""
                    UPDATE agent_api_keys 
                    SET request_count = request_count + 1, 
                        last_used_at = NOW() 
                    WHERE id = :api_key_id
                """)
                await session.execute(stmt, {"api_key_id": api_key_id})
                await session.commit()
                logger.debug("API key usage updated", api_key_id=api_key_id)
            except Exception as e:
                logger.error("Failed to update API key usage", error=str(e), api_key_id=api_key_id)

    async def search_similar_vectors(self, agent_id: str, vector: List[float], limit: int = 10) -> List[Dict[str, Any]]:
        """Search for similar schema embeddings using vector similarity with caching"""
        # Try cache first (use first 10 dimensions as cache key)
        query_str = json.dumps(vector[:10])
        cached = await cache_service.get_embedding_search(agent_id, query_str, limit)
        if cached:
            return cached
        
        async for session in get_db():
            try:
                # Convert to pgvector format
                vector_str = '[' + ','.join(map(str, vector)) + ']'
                
                # Use ACTUAL database column names (database schema differs from Python model!)
                # OPTIMIZED: Filter for target_type = 'table' directly in database
                query = f"""
                    SELECT 
                        id, 
                        agent_id, 
                        target_type,
                        target_id,
                        embedding_text,
                        1 - (embedding_vector <=> '{vector_str}'::vector) as similarity
                    FROM agent_schema_embeddings
                    WHERE agent_id = :agent_id_param
                      AND target_type = 'table'
                    ORDER BY embedding_vector <=> '{vector_str}'::vector
                    LIMIT :limit_param
                """
                
                from sqlalchemy import bindparam
                stmt = text(query).bindparams(
                    bindparam('agent_id_param', type_=UUID),
                    bindparam('limit_param', type_=Integer)
                )
                
                result = await session.execute(stmt, {
                    "agent_id_param": uuid.UUID(agent_id),
                    "limit_param": limit
                })
                
                rows = result.fetchall()
                
                # Build results with metadata from database joins
                results = []
                for row in rows:
                    # Build metadata by fetching table/column info
                    metadata = {}
                    
                    if row.target_type == "table":
                        # Fetch table name
                        table_stmt = select(AgentTable).where(AgentTable.id == row.target_id)
                        table_result = await session.execute(table_stmt)
                        table = table_result.scalar_one_or_none()
                        if table:
                            metadata = {"table_name": table.tableName}
                    
                    elif row.target_type == "column":
                        # Fetch column and table name
                        col_stmt = select(AgentColumn).where(AgentColumn.id == row.target_id)
                        col_result = await session.execute(col_stmt)
                        col = col_result.scalar_one_or_none()
                        if col:
                            # Get table name
                            table_stmt = select(AgentTable).where(AgentTable.id == col.tableId)
                            table_result = await session.execute(table_stmt)
                            table = table_result.scalar_one_or_none()
                            if table:
                                metadata = {
                                    "table_name": table.tableName,
                                    "column_name": col.columnName
                                }
                    
                    results.append({
                        "id": str(row.id),
                        "agent_id": str(row.agent_id),
                        "target_type": row.target_type,
                        "target_id": str(row.target_id),
                        "text": row.embedding_text,
                        "metadata": metadata,
                        "similarity": float(row.similarity)
                    })
                
                # Enhanced logging to see actual similarity scores
                if results:
                    logger.info(
                        "Vector search completed",
                        total_results=len(results),
                        top_5_similarities=[r["similarity"] for r in results[:5]],
                        top_5_texts=[r["text"][:50] if r["text"] else "" for r in results[:5]],
                        top_5_types=[r["target_type"] for r in results[:5]]
                    )
                else:
                    logger.warning("Vector search returned no results", agent_id=agent_id)
                
                # Cache the results
                await cache_service.set_embedding_search(agent_id, query_str, limit, results)
                return results
            except Exception as e:
                logger.error("Vector search failed", error=str(e), agent_id=agent_id, error_type=type(e).__name__)
                return []

    async def create_conversation(self, agent_id: str, user_id: Optional[str] = None, api_key_id: Optional[str] = None, title: Optional[str] = None) -> Dict[str, Any]:
        async for session in get_db():
            from db.models import Conversation
            try:
                # If no user_id, we might want to allow anonymous convos if logic permits, 
                # but schema has nullable user_id, so it's fine.
                conv = Conversation(
                    agentId=uuid.UUID(agent_id),
                    userId=uuid.UUID(user_id) if user_id else None,
                    apiKeyId=uuid.UUID(api_key_id) if api_key_id else None,
                    title=title or "New Conversation"
                )
                session.add(conv)
                await session.flush()
                await session.refresh(conv)
                await session.commit()
                
                return {
                    "id": str(conv.id),
                    "agent_id": str(conv.agentId),
                    "user_id": str(conv.userId) if conv.userId else None,
                    "api_key_id": str(conv.apiKeyId) if conv.apiKeyId else None,
                    "title": conv.title,
                    "created_at": conv.createdAt.isoformat()
                }
            except Exception as e:
                logger.error("Failed to create conversation", error=str(e))
                raise

    async def add_message(
        self, 
        conversation_id: str, 
        role: str, 
        content: str, 
        metadata: Optional[Dict[str, Any]] = None,
        thread_id: Optional[str] = None  # NEW
    ) -> Dict[str, Any]:
        async for session in get_db():
            from db.models import Message, Conversation
            try:
                msg = Message(
                    conversationId=uuid.UUID(conversation_id),
                    role=role,
                    content=content,
                    metadata_=metadata or {},
                    threadId=thread_id  # NEW
                )
                session.add(msg)
                
                # CRITICAL: Update conversation updated_at for sorting
                stmt = update(Conversation).where(Conversation.id == uuid.UUID(conversation_id)).values(updatedAt=datetime.now())
                await session.execute(stmt)
                
                await session.commit()
                
                return {
                    "id": str(msg.id),
                    "role": msg.role,
                    "content": msg.content,
                    "thread_id": msg.threadId,  # NEW
                    "created_at": msg.createdAt.isoformat()
                }
            except Exception as e:
                logger.error("Failed to add message", error=str(e))
                raise

    async def get_conversation_history(self, conversation_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        async for session in get_db():
            from db.models import Message, Conversation
            try:
                stmt = select(Message).where(
                    Message.conversationId == uuid.UUID(conversation_id)
                ).order_by(Message.createdAt.asc()).limit(limit)
                
                result = await session.execute(stmt)
                messages = result.scalars().all()
                
                return [{
                    "id": str(msg.id),
                    "role": msg.role,
                    "content": msg.content,
                    "metadata": msg.metadata_,
                    "created_at": msg.createdAt.isoformat()
                } for msg in messages]
            except Exception as e:
                logger.error("Failed to get conversation history", error=str(e))
                raise

    # Thread Management Methods (NEW)
    
    async def get_thread_history(
        self,
        thread_id: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Get chat history for a specific thread only.
        Returns messages in chronological order.
        """
        async for session in get_db():
            from db.models import Message, Conversation
            try:
                stmt = select(Message).where(
                    Message.threadId == thread_id
                ).order_by(Message.createdAt.desc()).limit(limit)
                
                result = await session.execute(stmt)
                messages = result.scalars().all()
                
                # Return in chronological order (oldest first)
                return [{
                    "role": msg.role.value,
                    "content": msg.content,
                    "metadata": msg.metadata_
                } for msg in reversed(messages)]
            except Exception as e:
                logger.error("Failed to get thread history", error=str(e), thread_id=thread_id)
                raise

    async def create_thread(
        self,
        conversation_id: str,
        thread_id: str,
        initial_query: str
    ) -> Dict[str, Any]:
        """Create a new query thread."""
        async for session in get_db():
            from db.models import QueryThread
            try:
                thread = QueryThread(
                    conversationId=uuid.UUID(conversation_id),
                    threadId=thread_id,
                    initialQuery=initial_query,
                    iterationCount=1,
                    status="active"
                )
                session.add(thread)
                await session.commit()
                
                return {
                    "id": str(thread.id),
                    "thread_id": thread.threadId,
                    "conversation_id": str(thread.conversationId),
                    "initial_query": thread.initialQuery
                }
            except Exception as e:
                logger.error("Failed to create thread", error=str(e), thread_id=thread_id)
                raise

    async def save_thread_state(
        self,
        thread_id: str,
        conversation_id: str,
        state: Dict[str, Any]
    ):
        """Save thread state for refinement continuity."""
        async for session in get_db():
            from db.models import QueryThread
            try:
                stmt = select(QueryThread).where(QueryThread.threadId == thread_id)
                result = await session.execute(stmt)
                thread = result.scalar_one_or_none()
                
                if thread:
                    # Update existing thread
                    thread.currentSql = state.get("generated_sql")
                    thread.iterationCount = state.get("iteration_count", 1)
                    thread.updatedAt = datetime.now()
                    
                    # Store canonical query and results in metadata
                    # CRITICAL: Create a copy of metadata dict. modifying in place typically fails
                    # to trigger SQLAlchemy update detection for JSON fields.
                    metadata = dict(thread.metadata_ or {})
                    metadata["canonical_query"] = state.get("canonical_query")
                    metadata["sanitized_results"] = state.get("sanitized_results")
                    metadata["relevant_schema"] = state.get("relevant_schema")  # CRITICAL: Save for refinements
                    metadata["pinned_schema"] = state.get("pinned_schema")  # CRITICAL: Save pinned schema from validator
                    thread.metadata_ = metadata
                else:
                    # Create new thread
                    thread = QueryThread(
                        conversationId=uuid.UUID(conversation_id),
                        threadId=thread_id,
                        initialQuery=state.get("user_message", ""),
                        currentSql=state.get("generated_sql"),
                        iterationCount=state.get("iteration_count", 1),
                        metadata_={
                            "canonical_query": state.get("canonical_query"),
                            "sanitized_results": state.get("sanitized_results"),
                            "relevant_schema": state.get("relevant_schema"),  # CRITICAL: Save for refinements
                            "pinned_schema": state.get("pinned_schema")  # CRITICAL: Save pinned schema from validator
                        }
                    )
                    session.add(thread)
                
                await session.commit()
                logger.info("Thread state saved", thread_id=thread_id, iteration=state.get("iteration_count", 1))
            except Exception as e:
                logger.error("Failed to save thread state", error=str(e), thread_id=thread_id)
                raise

    async def get_thread_state(self, thread_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve thread state for refinement."""
        async for session in get_db():
            from db.models import QueryThread
            try:
                stmt = select(QueryThread).where(QueryThread.threadId == thread_id)
                result = await session.execute(stmt)
                thread = result.scalar_one_or_none()
                
                if not thread:
                    return None
                
                metadata = thread.metadata_ or {}
                return {
                    "canonical_query": metadata.get("canonical_query"),
                    "generated_sql": thread.currentSql,
                    "sanitized_results": metadata.get("sanitized_results"),
                    "relevant_schema": metadata.get("relevant_schema"),  # CRITICAL: Load for refinements
                    "pinned_schema": metadata.get("pinned_schema"),  # CRITICAL: Load pinned schema from validator
                    "iteration_count": thread.iterationCount,
                    "user_message": thread.initialQuery
                }
            except Exception as e:
                logger.error("Failed to get thread state", error=str(e), thread_id=thread_id)
                raise

    async def get_schema_embeddings(self, agent_id: str) -> Dict[str, Any]:
        """
        Fetch all pre-computed schema embeddings for an agent from database.
        Used by embedding cache to avoid regenerating embeddings.
        
        Args:
            agent_id: Agent ID
            
        Returns:
            {
                "tables": {
                    table_name: {
                        "embedding": [float],
                        "content": str
                    }
                },
                "columns": {
                    "table.column": {
                        "embedding": [float],
                        "content": str
                    }
                }
            }
        """
        try:
            async for session in get_db():
                # Fetch all embeddings for this agent
                stmt = select(AgentSchemaEmbedding).where(
                    AgentSchemaEmbedding.agentId == uuid.UUID(agent_id)
                )
                result = await session.execute(stmt)
                embeddings = result.scalars().all()
                
                # Organize by type
                tables_emb = {}
                columns_emb = {}
                
                for emb in embeddings:
                    if emb.targetType == "table":
                        # Get table name from target_id
                        table_stmt = select(AgentTable).where(AgentTable.id == emb.targetId)
                        table_result = await session.execute(table_stmt)
                        table = table_result.scalar_one_or_none()
                        
                        if table:
                            tables_emb[table.tableName.lower()] = {
                                "embedding": list(emb.embeddingVector) if emb.embeddingVector is not None else [],
                                "content": emb.embeddingText
                            }
                    
                    elif emb.targetType == "column":
                        # Get column and table names from target_id
                        col_stmt = select(AgentColumn).where(AgentColumn.id == emb.targetId)
                        col_result = await session.execute(col_stmt)
                        col = col_result.scalar_one_or_none()
                        
                        if col:
                            # Get table name
                            table_stmt = select(AgentTable).where(AgentTable.id == col.tableId)
                            table_result = await session.execute(table_stmt)
                            table = table_result.scalar_one_or_none()
                            
                            if table:
                                key = f"{table.tableName}.{col.columnName}".lower()
                                columns_emb[key] = {
                                    "embedding": list(emb.embeddingVector) if emb.embeddingVector is not None else [],
                                    "content": emb.embeddingText
                                }
                
                logger.info(
                    "Fetched schema embeddings from database",
                    agent_id=agent_id,
                    tables_count=len(tables_emb),
                    columns_count=len(columns_emb)
                )
                
                return {
                    "tables": tables_emb,
                    "columns": columns_emb
                }
        except Exception as e:
            logger.error("Failed to fetch schema embeddings", error=str(e), agent_id=agent_id)
            # Return empty structure on error
            return {"tables": {}, "columns": {}}
