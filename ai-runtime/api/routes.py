from fastapi import APIRouter, HTTPException, Depends, Body, Response as FastAPIResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import structlog
import pandas as pd
import io
import json
import uuid as uuid_module

from services.config import settings
from services.embedding_service import EmbeddingService
from services.system_db import SystemDBService
from services.auth import require_admin, require_authenticated, User
from mcp_tools.sql_executor import SQLExecutor
from mcp_tools.sensitivity_registry import SensitivityRegistry

router = APIRouter()
logger = structlog.get_logger()

embedding_service = EmbeddingService()
system_db = SystemDBService()
sensitivity_registry = SensitivityRegistry()


class EmbeddingRequest(BaseModel):
    texts: List[str]
    model: Optional[str] = None


class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]]


class HealthResponse(BaseModel):
    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(status="healthy", version="1.0.0")


class ExecuteQueryRequest(BaseModel):
    agent_id: str
    sql: str
    page: int = 1
    page_size: int = 10

class ExecuteQueryResponse(BaseModel):
    data: List[Dict[str, Any]]
    pagination: Dict[str, Any]

async def _get_enriched_sensitivity_config(agent_id: str) -> Dict[str, Any]:
    """Load sensitivity rules and enrich them with non-queryable/sensitive schema metadata."""
    # 1. Get base sensitivity rules
    sensitivity_config = await system_db.get_agent_sensitivity(agent_id)
    
    # 2. Get enriched metadata to find non-queryable/sensitive columns
    schema = await system_db.get_agent_enriched_metadata(agent_id)
    
    # 3. Add schema-based restrictions
    schema_rules = sensitivity_config.get("schemaSensitiveColumns", [])
    for table in schema.get("tables", []):
        table_name = table.get('name', table.get('tableName', ''))
        
        # If table itself is non-queryable, we should add a rule for all its columns
        # or handle it at a higher level. For now, we follow column-level removal.
        for col in table.get("columns", []):
            if not col.get("isQueryable", True):
                schema_rules.append({
                    "table": table_name,
                    "column": col["name"],
                    "maskingStrategy": "remove"
                })
            elif col.get("isSensitive", False):
                schema_rules.append({
                    "table": table_name,
                    "column": col["name"],
                    "maskingStrategy": col.get("maskingStrategy", "full")
                })
    
    sensitivity_config["schemaSensitiveColumns"] = schema_rules
    return sensitivity_config


@router.post("/query/execute", response_model=ExecuteQueryResponse)
async def execute_query(
    request: ExecuteQueryRequest,
    user: User = Depends(require_authenticated)
):
    try:
        # Security: if api_key role, ensure it matches the agent_id
        if user.role == "api_key":
            if user.agent_id != request.agent_id:
                logger.warning("Agent ID mismatch for API key", 
                               user_agent_id=user.agent_id, 
                               request_agent_id=request.agent_id)
                raise HTTPException(status_code=403, detail="Unauthorized for this agent")
        # 1. Get Agent Config & Credentials
        connection_details = await system_db.get_connection_details(request.agent_id)
        if not connection_details:
             raise HTTPException(status_code=404, detail="Agent connection details not found")

        # 2. Get Enriched Sensitivity Config
        sensitivity_config = await _get_enriched_sensitivity_config(request.agent_id)

        # 3. Prepare SQL (Strip trailing semicolon)
        original_sql = request.sql.strip().rstrip(';')
        
        # 4. Get Total Count (Respecting LIMIT via subquery)
        count_sql = f"SELECT COUNT(*) as exact_count FROM ({original_sql}) AS subquery"
        
        executor = SQLExecutor(connection_details)
        count_result = await executor.execute(count_sql, timeout=30)
        total_count = count_result[0].get("exact_count", 0) if count_result else 0
        
        # 5. Fetch Paginated Data (Respecting LIMIT via wrapper)
        offset = (request.page - 1) * request.page_size
        paginated_sql = f"SELECT * FROM ({original_sql}) AS subquery LIMIT {request.page_size} OFFSET {offset}"
        
        # Execute query
        raw_results = await executor.execute(paginated_sql, timeout=30, limit=request.page_size)
        
        # 6. Sanitize Results
        sanitized_results = sensitivity_registry.sanitize_results(
            raw_results,
            sensitivity_config
        )
        
        return ExecuteQueryResponse(
            data=sanitized_results,
            pagination={
                "page": request.page,
                "pageSize": request.page_size,
                "totalCount": total_count,
                "totalPages": (total_count + request.page_size - 1) // request.page_size if request.page_size > 0 else 0
            }
        )
        
    except Exception as e:
        logger.error("Query execution failed", error=str(e), sql=request.sql)
        raise HTTPException(status_code=500, detail=str(e))


class ExportExcelRequest(BaseModel):
    agent_id: str
    sql: str

@router.post("/query/export-excel")
async def export_excel(
    request: ExportExcelRequest,
    user: User = Depends(require_authenticated)
):
    try:
        # Security: if api_key role, ensure it matches the agent_id
        if user.role == "api_key":
            if user.agent_id != request.agent_id:
                logger.warning("Agent ID mismatch for API key", 
                               user_agent_id=user.agent_id, 
                               request_agent_id=request.agent_id)
                raise HTTPException(status_code=403, detail="Unauthorized for this agent")
        # 1. Get Agent Config & Credentials
        connection_details = await system_db.get_connection_details(request.agent_id)
        if not connection_details:
             raise HTTPException(status_code=404, detail="Agent connection details not found")

        # 2. Get Enriched Sensitivity Config
        sensitivity_config = await _get_enriched_sensitivity_config(request.agent_id)

        # 3. Prepare SQL (Use wrapper to enforce original LIMIT if present)
        original_sql = request.sql.strip().rstrip(';')
        
        # We fetch "all" rows, but "all" is defined by the original SQL's limit
        # Wrapping ensures we don't accidentally fetch more if original had a limit
        # No LIMIT/OFFSET clause added here, just the wrapper
        wrapped_sql = f"SELECT * FROM ({original_sql}) AS subquery"

        # 3. Execute Query (Fetch all matching rows)
        executor = SQLExecutor(connection_details)
        # Set a high safety limit just in case (e.g. 100k rows max download)
        MAX_DOWNLOAD_ROWS = 100000 
        raw_results = await executor.execute(wrapped_sql, timeout=60, limit=MAX_DOWNLOAD_ROWS)
        
        # 4. Sanitize Results
        sanitized_results = sensitivity_registry.sanitize_results(
            raw_results,
            sensitivity_config
        )
        
        # 5. Generate Excel
        if not sanitized_results:
             # Return empty excel with headers if possible, or just empty
             df = pd.DataFrame()
        else:
             df = pd.DataFrame(sanitized_results)
        
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Query Results')
        
        output.seek(0)
        
        # 6. Return Streaming Response
        headers = {
            'Content-Disposition': 'attachment; filename="query_results.xlsx"'
        }
        return StreamingResponse(
            output, 
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
            headers=headers
        )

    except Exception as e:
        logger.error("Excel export failed", error=str(e), sql=request.sql)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/embeddings/generate", response_model=EmbeddingResponse)
async def generate_embeddings(
    request: EmbeddingRequest,
    user: User = Depends(require_admin)
):
    try:
        embeddings = await embedding_service.generate_embeddings(
            request.texts,
            model=request.model or settings.embedding_model
        )
        return EmbeddingResponse(embeddings=embeddings)
    except Exception as e:
        logger.error("Embedding generation failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# SQL Generation API (Returns SQL only, no execution)
class GenerateSQLRequest(BaseModel):
    query: str


class GenerateSQLResponse(BaseModel):
    sql: Optional[str] = None
    success: bool
    message: Optional[str] = None
    intent: Optional[str] = None
    execution_time_ms: int


@router.post("/agents/{agent_id}/generate-sql", response_model=GenerateSQLResponse)
async def generate_sql(
    agent_id: str,
    request: GenerateSQLRequest,
    user: User = Depends(require_authenticated)
):
    """
    Generate SQL from a natural language query without executing it.
    
    This endpoint takes an English query and returns the generated SQL.
    The SQL is NOT executed against the database - only generated.
    """
    try:
        # Security: if api_key role, ensure it matches the agent_id
        if user.role == "api_key":
            if user.agent_id != agent_id:
                logger.warning("Agent ID mismatch for API key", 
                               user_agent_id=user.agent_id, 
                               request_agent_id=agent_id)
                raise HTTPException(status_code=403, detail="Unauthorized for this agent")
        
        # Verify agent exists
        agent_config = await system_db.get_agent_config(agent_id)
        if not agent_config:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Import here to avoid circular imports
        from agent.query_pipeline import QueryPipeline
        
        # Create a temporary session for the pipeline
        temp_session_id = f"sql_api_{uuid_module.uuid4().hex[:8]}"
        
        # Create pipeline instance with proper identifiers
        pipeline = QueryPipeline(
            agent_id=agent_id,
            session_id=temp_session_id,
            user_id=user.sub if hasattr(user, 'sub') else None,
            api_key_id=user.api_key_id if hasattr(user, 'api_key_id') else None,
            api_key_name=user.api_key_name if hasattr(user, 'api_key_name') else None
        )
        
        # Generate SQL only (no execution, no streaming)
        result = await pipeline.generate_sql_only(request.query)
        
        return GenerateSQLResponse(
            sql=result.get("sql"),
            success=result.get("success", False),
            message=result.get("message"),
            intent=result.get("intent"),
            execution_time_ms=result.get("execution_time_ms", 0)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("SQL generation failed", error=str(e), agent_id=agent_id)
        raise HTTPException(status_code=500, detail=str(e))
