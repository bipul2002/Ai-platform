from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
from sqlalchemy import Column, String, Boolean, Integer, Text, ForeignKey, DateTime, JSON, ARRAY, Enum, BigInteger, Numeric
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY as PG_ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

class Base(DeclarativeBase):
    pass

class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizationId: Mapped[Optional[uuid.UUID]] = mapped_column("organization_id", UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    tags: Mapped[List[str]] = mapped_column(PG_ARRAY(Text), default=[])
    isActive: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    createdBy: Mapped[Optional[uuid.UUID]] = mapped_column("created_by", UUID(as_uuid=True))
    lastUsedAt: Mapped[Optional[datetime]] = mapped_column("last_used_at", DateTime(timezone=True))
    queryCount: Mapped[int] = mapped_column("query_count", BigInteger, default=0)
    customDictionary: Mapped[Dict[str, Any]] = mapped_column("custom_dictionary", JSONB, default={})
    systemPromptOverride: Mapped[Optional[str]] = mapped_column("system_prompt_override", Text)
    maxResultsLimit: Mapped[int] = mapped_column("max_results_limit", Integer, default=1000)
    timeoutSeconds: Mapped[int] = mapped_column("timeout_seconds", Integer, default=30)
    llmProvider: Mapped[Optional[str]] = mapped_column("llm_provider", Enum('openai', 'anthropic', 'openrouter', name='llm_provider', create_type=False), default="openai")
    llmModel: Mapped[Optional[str]] = mapped_column("llm_model", String(100), default="gpt-4-turbo-preview")
    llmTemperature: Mapped[Optional[float]] = mapped_column("llm_temperature", Numeric(3, 2), default=0.0)
    disabledSensitivityRules: Mapped[List[str]] = mapped_column("disabled_sensitivity_rules", PG_ARRAY(Text), default=[])
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)

    # Relationships
    externalDb: Mapped[Optional["AgentExternalDbCredentials"]] = relationship("AgentExternalDbCredentials", uselist=False, back_populates="agent")
    tables: Mapped[List["AgentTable"]] = relationship("AgentTable", back_populates="agent")
    sensitivityRules: Mapped[List["SensitiveFieldRegistryAgent"]] = relationship("SensitiveFieldRegistryAgent", back_populates="agent")
    forbiddenFields: Mapped[List["ForbiddenField"]] = relationship("ForbiddenField", back_populates="agent")
    embeddings: Mapped[List["AgentSchemaEmbedding"]] = relationship("AgentSchemaEmbedding", back_populates="agent")
    columns: Mapped[List["AgentColumn"]] = relationship("AgentColumn", back_populates="agent")
    relationships: Mapped[List["AgentRelationship"]] = relationship("AgentRelationship", back_populates="agent")

class AgentExternalDbCredentials(Base):
    __tablename__ = "agent_external_db_credentials"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), unique=True)
    dbType: Mapped[str] = mapped_column("db_type", Enum('postgresql', 'mysql', name='db_type', create_type=False), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    databaseName: Mapped[str] = mapped_column("database_name", String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    encryptedPassword: Mapped[str] = mapped_column("encrypted_password", Text, nullable=False)
    sslEnabled: Mapped[bool] = mapped_column("ssl_enabled", Boolean, default=False)
    sslCaCert: Mapped[Optional[str]] = mapped_column("ssl_ca_cert", Text)
    sslClientCert: Mapped[Optional[str]] = mapped_column("ssl_client_cert", Text)
    sslClientKey: Mapped[Optional[str]] = mapped_column("ssl_client_key", Text)
    connectionPoolSize: Mapped[int] = mapped_column("connection_pool_size", Integer, default=5)
    connectionTimeoutMs: Mapped[int] = mapped_column("connection_timeout_ms", Integer, default=5000)
    schemaFilterInclude: Mapped[List[str]] = mapped_column("schema_filter_include", PG_ARRAY(Text), default=[])
    schemaFilterExclude: Mapped[List[str]] = mapped_column("schema_filter_exclude", PG_ARRAY(Text), default=[])
    lastConnectionTestAt: Mapped[Optional[datetime]] = mapped_column("last_connection_test_at", DateTime(timezone=True))
    lastConnectionTestSuccess: Mapped[Optional[bool]] = mapped_column("last_connection_test_success", Boolean)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
    
    agent: Mapped["Agent"] = relationship("Agent", back_populates="externalDb")

class AgentTable(Base):
    __tablename__ = "agent_tables"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"))
    tableName: Mapped[str] = mapped_column("table_name", String(255), nullable=False)
    schemaName: Mapped[str] = mapped_column("schema_name", String(255), default='public')
    originalComment: Mapped[Optional[str]] = mapped_column("original_comment", Text)
    adminDescription: Mapped[Optional[str]] = mapped_column("admin_description", Text)
    semanticHints: Mapped[Optional[str]] = mapped_column("semantic_hints", Text)
    customPrompt: Mapped[Optional[str]] = mapped_column("custom_prompt", Text)
    isVisible: Mapped[bool] = mapped_column("is_visible", Boolean, default=True)
    isQueryable: Mapped[bool] = mapped_column("is_queryable", Boolean, default=True)
    rowCountEstimate: Mapped[Optional[int]] = mapped_column("row_count_estimate", BigInteger)
    lastAnalyzedAt: Mapped[Optional[datetime]] = mapped_column("last_analyzed_at", DateTime(timezone=True))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
    
    agent: Mapped["Agent"] = relationship("Agent", back_populates="tables")
    columns: Mapped[List["AgentColumn"]] = relationship("AgentColumn", back_populates="table")

class AgentColumn(Base):
    __tablename__ = "agent_columns"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    tableId: Mapped[uuid.UUID] = mapped_column("table_id", ForeignKey("agent_tables.id", ondelete="CASCADE"), nullable=False)
    columnName: Mapped[str] = mapped_column("column_name", String(255), nullable=False)
    dataType: Mapped[str] = mapped_column("data_type", String(100), nullable=False)
    isNullable: Mapped[Optional[bool]] = mapped_column("is_nullable", Boolean, default=True)
    isPrimaryKey: Mapped[Optional[bool]] = mapped_column("is_primary_key", Boolean, default=False)
    isForeignKey: Mapped[Optional[bool]] = mapped_column("is_foreign_key", Boolean, default=False)
    isUnique: Mapped[Optional[bool]] = mapped_column("is_unique", Boolean, default=False)
    isIndexed: Mapped[Optional[bool]] = mapped_column("is_indexed", Boolean, default=False)
    defaultValue: Mapped[Optional[str]] = mapped_column("default_value", Text)
    originalComment: Mapped[Optional[str]] = mapped_column("original_comment", Text)
    adminDescription: Mapped[Optional[str]] = mapped_column("admin_description", Text)
    semanticHints: Mapped[Optional[str]] = mapped_column("semantic_hints", Text)
    customPrompt: Mapped[Optional[str]] = mapped_column("custom_prompt", Text)
    sampleValues: Mapped[Optional[List[str]]] = mapped_column("sample_values", PG_ARRAY(Text))
    valueDistribution: Mapped[Optional[Any]] = mapped_column("value_distribution", JSONB)
    isVisible: Mapped[Optional[bool]] = mapped_column("is_visible", Boolean, default=True)
    isQueryable: Mapped[Optional[bool]] = mapped_column("is_queryable", Boolean, default=True)
    isSensitive: Mapped[Optional[bool]] = mapped_column("is_sensitive", Boolean, default=False)
    sensitivityOverride: Mapped[Optional[str]] = mapped_column("sensitivity_override", Enum('low', 'medium', 'high', 'critical', name='sensitivity_level'), nullable=True)
    maskingStrategyOverride: Mapped[Optional[str]] = mapped_column("masking_strategy_override", Enum('full', 'partial', 'hash', 'redact', 'tokenize', name='masking_strategy'), nullable=True)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
    
    table: Mapped["AgentTable"] = relationship("AgentTable", back_populates="columns")
    agent: Mapped["Agent"] = relationship("Agent", back_populates="columns")

class AgentRelationship(Base):
    __tablename__ = "agent_relationships"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    sourceTableId: Mapped[uuid.UUID] = mapped_column("source_table_id", ForeignKey("agent_tables.id", ondelete="CASCADE"), nullable=False)
    sourceColumnId: Mapped[uuid.UUID] = mapped_column("source_column_id", ForeignKey("agent_columns.id", ondelete="CASCADE"), nullable=False)
    targetTableId: Mapped[uuid.UUID] = mapped_column("target_table_id", ForeignKey("agent_tables.id", ondelete="CASCADE"), nullable=False)
    targetColumnId: Mapped[uuid.UUID] = mapped_column("target_column_id", ForeignKey("agent_columns.id", ondelete="CASCADE"), nullable=False)
    relationshipType: Mapped[Optional[str]] = mapped_column("relationship_type", String(50), default='foreign_key')
    isInferred: Mapped[Optional[bool]] = mapped_column("is_inferred", Boolean, default=False)
    confidenceScore: Mapped[Optional[float]] = mapped_column("confidence_score", Numeric(3, 2))
    originalConstraintName: Mapped[Optional[str]] = mapped_column("original_constraint_name", String(255))
    adminDescription: Mapped[Optional[str]] = mapped_column("admin_description", Text)
    isActive: Mapped[Optional[bool]] = mapped_column("is_active", Boolean, default=True)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)

    agent: Mapped["Agent"] = relationship("Agent", back_populates="relationships")

class AgentSchemaEmbedding(Base):
    __tablename__ = "agent_schema_embeddings"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    targetType: Mapped[str] = mapped_column("target_type", String(50), nullable=False) # 'table', 'column'
    targetId: Mapped[uuid.UUID] = mapped_column("target_id", UUID(as_uuid=True), nullable=False)
    embeddingText: Mapped[str] = mapped_column("embedding_text", Text, nullable=False)
    embeddingVector: Mapped[Any] = mapped_column("embedding_vector", Vector(1536))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
    
    agent: Mapped["Agent"] = relationship("Agent", back_populates="embeddings")

class SensitiveFieldRegistryGlobal(Base):
    __tablename__ = "sensitive_field_registry_global"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patternType: Mapped[str] = mapped_column("pattern_type", String(50), nullable=False)
    patternValue: Mapped[str] = mapped_column("pattern_value", Text, nullable=False)
    patternRegex: Mapped[Optional[str]] = mapped_column("pattern_regex", Text)
    sensitivityLevel: Mapped[str] = mapped_column("sensitivity_level", Enum('low', 'medium', 'high', 'critical', name='sensitivity_level', create_type=False), default='high')
    maskingStrategy: Mapped[str] = mapped_column("masking_strategy", Enum('full', 'partial', 'hash', 'redact', 'tokenize', name='masking_strategy', create_type=False), default='full')
    description: Mapped[Optional[str]] = mapped_column(Text)
    isActive: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    createdBy: Mapped[Optional[uuid.UUID]] = mapped_column("created_by", UUID(as_uuid=True))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)

class SensitiveFieldRegistryAgent(Base):
    __tablename__ = "sensitive_field_registry_agent"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    # The actual DB has pattern_type, pattern_value etc, not 'pattern'.
    # Syncing model to match DB schema from migration 0000_calm_puppet_master.sql
    columnId: Mapped[Optional[uuid.UUID]] = mapped_column("column_id", UUID(as_uuid=True))
    patternType: Mapped[Optional[str]] = mapped_column("pattern_type", String(50))
    patternValue: Mapped[Optional[str]] = mapped_column("pattern_value", Text)
    patternRegex: Mapped[Optional[str]] = mapped_column("pattern_regex", Text)
    
    sensitivityLevel: Mapped[str] = mapped_column("sensitivity_level", Enum('low', 'medium', 'high', 'critical', name='sensitivity_level'), default='high')
    maskingStrategy: Mapped[str] = mapped_column("masking_strategy", Enum('full', 'partial', 'hash', 'redact', 'tokenize', name='masking_strategy'), default='full')
    description: Mapped[Optional[str]] = mapped_column(Text)
    isActive: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    createdBy: Mapped[Optional[uuid.UUID]] = mapped_column("created_by", UUID(as_uuid=True))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
    
    agent: Mapped["Agent"] = relationship("Agent", back_populates="sensitivityRules")

class ForbiddenField(Base):
    __tablename__ = "forbidden_fields"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[Optional[uuid.UUID]] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"))
    scope: Mapped[str] = mapped_column(String(20), default='agent')
    tablePattern: Mapped[Optional[str]] = mapped_column("table_pattern", Text)
    columnPattern: Mapped[Optional[str]] = mapped_column("column_pattern", Text)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    isActive: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    createdBy: Mapped[Optional[uuid.UUID]] = mapped_column("created_by", UUID(as_uuid=True))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
    
    agent: Mapped["Agent"] = relationship("Agent", back_populates="forbiddenFields")

class Conversation(Base):
    __tablename__ = "conversations"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    userId: Mapped[Optional[uuid.UUID]] = mapped_column("user_id", UUID(as_uuid=True))
    apiKeyId: Mapped[Optional[uuid.UUID]] = mapped_column("api_key_id", UUID(as_uuid=True))
    title: Mapped[Optional[str]] = mapped_column(String(255))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)

import enum

class ConversationRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"

class Message(Base):
    __tablename__ = "messages"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversationId: Mapped[uuid.UUID] = mapped_column("conversation_id", ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[ConversationRole] = mapped_column(Enum(ConversationRole, name="conversation_role", create_type=False), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[Optional[Dict[str, Any]]] = mapped_column("metadata", JSONB, default={})
    threadId: Mapped[Optional[str]] = mapped_column("thread_id", String(255))  # NEW
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)

class QueryThread(Base):
    """Track query refinement sessions within conversations"""
    __tablename__ = "query_threads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversationId: Mapped[uuid.UUID] = mapped_column("conversation_id", ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    threadId: Mapped[str] = mapped_column("thread_id", String(255), nullable=False, unique=True)
    initialQuery: Mapped[str] = mapped_column("initial_query", Text, nullable=False)
    currentSql: Mapped[Optional[str]] = mapped_column("current_sql", Text)
    metadata_: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default={})
    iterationCount: Mapped[int] = mapped_column("iteration_count", Integer, default=1)
    status: Mapped[str] = mapped_column(String(50), default="active")  # active, completed
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)

class QueryHistory(Base):
    """Audit log for all query requests and responses"""
    __tablename__ = "query_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agentId: Mapped[uuid.UUID] = mapped_column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    organizationId: Mapped[Optional[uuid.UUID]] = mapped_column("organization_id", UUID(as_uuid=True))
    sessionId: Mapped[Optional[str]] = mapped_column("session_id", String(255))
    userMessage: Mapped[str] = mapped_column("user_message", Text, nullable=False)
    canonicalQuery: Mapped[Optional[Dict[str, Any]]] = mapped_column("canonical_query", JSONB)
    generatedSql: Mapped[Optional[str]] = mapped_column("generated_sql", Text)
    sqlDialect: Mapped[Optional[str]] = mapped_column("sql_dialect", Enum('postgresql', 'mysql', name='db_type', create_type=False))
    executionTimeMs: Mapped[Optional[int]] = mapped_column("execution_time_ms", Integer)
    rowCount: Mapped[Optional[int]] = mapped_column("row_count", Integer)
    isSuccess: Mapped[bool] = mapped_column("is_success", Boolean, default=True)
    errorMessage: Mapped[Optional[str]] = mapped_column("error_message", Text)
    validationErrors: Mapped[Optional[Dict[str, Any]]] = mapped_column("validation_errors", JSONB)
    sanitizationApplied: Mapped[Optional[Dict[str, Any]]] = mapped_column("sanitization_applied", JSONB)
    threadId: Mapped[Optional[str]] = mapped_column("thread_id", String(255))
    isRefinement: Mapped[bool] = mapped_column("is_refinement", Boolean, default=False)
    iterationCount: Mapped[int] = mapped_column("iteration_count", Integer, default=1)
    apiKeyId: Mapped[Optional[uuid.UUID]] = mapped_column("api_key_id", UUID(as_uuid=True))
    apiKeyName: Mapped[Optional[str]] = mapped_column("api_key_name", String(255))
    userId: Mapped[Optional[uuid.UUID]] = mapped_column("user_id", UUID(as_uuid=True))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)

    # Relationships
    agent: Mapped["Agent"] = relationship("Agent")
    pipelineExecutions: Mapped[List["QueryPipelineExecution"]] = relationship("QueryPipelineExecution", back_populates="queryHistory", cascade="all, delete-orphan")
    llmCalls: Mapped[List["QueryLlmCall"]] = relationship("QueryLlmCall", back_populates="queryHistory", cascade="all, delete-orphan")

class QueryPipelineExecution(Base):
    """Track execution flow through pipeline nodes"""
    __tablename__ = "query_pipeline_execution"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    queryHistoryId: Mapped[uuid.UUID] = mapped_column("query_history_id", ForeignKey("query_history.id", ondelete="CASCADE"), nullable=False)
    nodeName: Mapped[str] = mapped_column("node_name", String(100), nullable=False)
    executionOrder: Mapped[int] = mapped_column("execution_order", Integer, nullable=False)
    startedAt: Mapped[datetime] = mapped_column("started_at", DateTime(timezone=True), nullable=False)
    completedAt: Mapped[Optional[datetime]] = mapped_column("completed_at", DateTime(timezone=True))
    durationMs: Mapped[Optional[int]] = mapped_column("duration_ms", Integer)
    nodeState: Mapped[Optional[Dict[str, Any]]] = mapped_column("node_state", JSONB)
    error: Mapped[Optional[str]] = mapped_column(Text)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)

    # Relationships
    queryHistory: Mapped["QueryHistory"] = relationship("QueryHistory", back_populates="pipelineExecutions")

class QueryLlmCall(Base):
    """Track all LLM API calls with complete configuration (sanitized)"""
    __tablename__ = "query_llm_calls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    queryHistoryId: Mapped[uuid.UUID] = mapped_column("query_history_id", ForeignKey("query_history.id", ondelete="CASCADE"), nullable=False)
    nodeName: Mapped[str] = mapped_column("node_name", String(100), nullable=False)
    llmProvider: Mapped[str] = mapped_column("llm_provider", Enum('openai', 'anthropic', 'openrouter', name='llm_provider', create_type=False), nullable=False)
    llmModel: Mapped[str] = mapped_column("llm_model", String(100), nullable=False)
    systemPrompt: Mapped[Optional[str]] = mapped_column("system_prompt", Text)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    response: Mapped[Optional[str]] = mapped_column(Text)
    llmConfig: Mapped[Optional[Dict[str, Any]]] = mapped_column("llm_config", JSONB)
    tokenUsage: Mapped[Optional[Dict[str, Any]]] = mapped_column("token_usage", JSONB)
    durationMs: Mapped[Optional[int]] = mapped_column("duration_ms", Integer)
    error: Mapped[Optional[str]] = mapped_column(Text)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=datetime.now)

    # Relationships
    queryHistory: Mapped["QueryHistory"] = relationship("QueryHistory", back_populates="llmCalls")
