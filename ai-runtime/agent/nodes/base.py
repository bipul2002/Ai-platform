import time
import re
import copy
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple, Set, TypedDict, Annotated
import operator
import structlog
import sqlparse
from sqlparse.sql import Identifier, IdentifierList
from sqlparse.tokens import Keyword
from langchain_core.messages import SystemMessage, HumanMessage

from services.system_db import SystemDBService
from services.embedding_service import EmbeddingService
from mcp_tools.sql_validator import SQLValidator
from mcp_tools.sensitivity_registry import SensitivityRegistry
from mcp_tools.dialect_translator import DialectTranslator
from services.audit_service import audit_service
from agent.llm import get_llm
from agent.utils import parse_json_content, format_chat_history, make_json_serializable
from services.embedding_cache import embedding_cache

logger = structlog.get_logger()

class QueryState(TypedDict):
    agent_id: str
    session_id: str
    user_message: str
    context: List[Dict[str, str]]

    # Audit logging
    query_history_id: Optional[Any]  # UUID of query_history record for audit logging

    # Thread management
    thread_id: Optional[str]
    is_refinement: bool
    needs_schema_search: bool
    previous_query: Optional[Dict[str, Any]]
    previous_sql: Optional[str]
    previous_user_message: Optional[str]
    last_query_user_message: Optional[str] # Specific message that produced previous_sql
    previous_results: Optional[List[Dict[str, Any]]]
    refinement_intent: Optional[Dict[str, Any]]
    refinement_complexity: Optional[str]
    iteration_count: int
    correction_iteration: int  # Per-message SQL correction counter

    # Routing control
    skip_query_builder: Optional[bool]

    # Pipeline state
    agent_config: Optional[Dict[str, Any]]
    schema_metadata: Optional[Dict[str, Any]]
    sensitivity_rules: Optional[Dict[str, Any]]

    intent: Optional[Dict[str, Any]]
    relevant_tables_from_intent: Optional[List[str]] # Table names identified by orchestrator
    is_off_topic: bool
    is_ambiguous: bool
    is_data_guide_request: bool
    is_direct_sql: bool # NEW: Flag for direct SQL input
    is_connection_error: bool
    clarifying_questions: List[str]

    relevant_schema: List[Dict[str, Any]]
    pinned_schema: Optional[List[Dict[str, Any]]]
    no_match: bool
    new_entities: Optional[List[str]]
    canonical_query: Optional[Dict[str, Any]]
    generated_sql: Optional[str]
    sql_dialect: str
    validation_result: Optional[Dict[str, Any]]
    validation_success: bool
    pre_query_warnings: Annotated[List[Dict[str, str]], operator.add]
    queryability_warnings: Annotated[List[Dict[str, str]], operator.add]
    raw_results: List[Dict[str, Any]]
    sanitized_results: List[Dict[str, Any]]
    final_response: str
    error: Optional[str]
    sql_explanation: Optional[str]
    correction_note: Optional[str]

    start_time: float
    execution_time_ms: int
    current_step: str

class BaseNode:
    COMMON_COLUMN_NAMES = {
        'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
        'is_deleted', 'deleted_at', 'is_active', 'status', 'name',
        'description', 'type', 'timestamp', 'date', 'time',
        'user_id', 'organization_id', 'tenant_id', 'owner_id'
    }

    def __init__(self, agent_config: Optional[Dict[str, Any]] = None):
        self.system_db = SystemDBService()
        self.embedding_service = EmbeddingService()
        self.sql_validator = SQLValidator()
        self.sensitivity_registry = SensitivityRegistry()
        self.dialect_translator = DialectTranslator()
        self.audit_logger = audit_service
        self.agent_config = agent_config
        self.llm = None
        if agent_config:
            self.llm = get_llm(
                provider=agent_config.get('llmProvider', 'openai'),
                model=agent_config.get('llmModel', 'gpt-4-turbo-preview'),
                temperature=agent_config.get('llmTemperature', 0.0)
            )

    def _normalize_sql(self, sql: str) -> str:
        """Normalize SQL for comparison by removing comments, extra whitespace, and trailing semicolons."""
        if not sql:
            return ""
        # Remove comments
        sql = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
        sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
        # Normalize whitespace and lowercase
        sql = sql.replace('\n', ' ').strip().lower()
        sql = re.sub(r'\s+', ' ', sql)
        # Remove trailing semicolon
        sql = sql.rstrip(';')
        return sql

    async def _call_llm_with_logging(
        self, 
        messages: List[Any], 
        node_name: str, 
        query_history_id: Optional[str] = None,
        structured_model: Optional[Any] = None
    ) -> Any:
        """Wrapper for LLM calls with audit logging and timing. Supports structured output."""
        if not self.llm:
            raise ValueError("LLM not initialized. Call load_config node first.")

        start_time = time.time()
        
        try:
            if structured_model:
                # Use with_structured_output for guaranteed schema compliance
                # We use include_raw=True to get metadata like token usage
                llm_to_call = self.llm.with_structured_output(structured_model, include_raw=True)
                result = await llm_to_call.ainvoke(messages)
                response_obj = result.get("parsed")
                raw_response = result["raw"]
                
                # Enhanced logging for parsing failures
                if not response_obj:
                    logger.error("Structured output parsing failed", 
                                 node_name=node_name, 
                                 raw_content=raw_response.content if hasattr(raw_response, 'content') else str(raw_response))
                
                content = response_obj.model_dump() if response_obj and hasattr(response_obj, "model_dump") else str(response_obj)
            else:
                raw_response = await self.llm.ainvoke(messages)
                response_obj = raw_response
                content = raw_response.content

            duration_ms = int((time.time() - start_time) * 1000)
            
            # Extract token usage from raw response
            token_usage = {}
            if hasattr(raw_response, 'usage_metadata') and raw_response.usage_metadata:
                usage = raw_response.usage_metadata
                token_usage = {
                    "prompt_tokens": usage.get("input_tokens", usage.get("prompt_tokens")),
                    "completion_tokens": usage.get("output_tokens", usage.get("completion_tokens")),
                    "total_tokens": usage.get("total_tokens")
                }
            elif hasattr(raw_response, 'response_metadata'):
                meta = raw_response.response_metadata
                usage = meta.get("token_usage") or meta.get("usage") or {}
                token_usage = {
                    "prompt_tokens": usage.get("prompt_tokens"),
                    "completion_tokens": usage.get("completion_tokens"),
                    "total_tokens": usage.get("total_tokens")
                }

            # Log to audit service
            if query_history_id:
                system_prompt = ""
                user_prompts = []
                for m in messages:
                    if isinstance(m, SystemMessage):
                        system_prompt += str(m.content) + "\n"
                    else:
                        user_prompts.append(str(m.content))
                
                prompt_text = "\n".join(user_prompts)
                
                await self.audit_logger.log_llm_call(
                    query_history_id=query_history_id,
                    node_name=node_name,
                    llm_provider=self.agent_config.get('llmProvider', 'openai') if self.agent_config else 'openai',
                    llm_model=self.agent_config.get('llmModel', 'unknown') if self.agent_config else 'unknown',
                    prompt=prompt_text,
                    system_prompt=system_prompt.strip(),
                    response=str(content),
                    token_usage=token_usage,
                    duration_ms=duration_ms
                )
            
            logger.info(
                f"LLM call completed for {node_name}",
                duration_ms=duration_ms,
                tokens=token_usage.get('total_tokens', 0)
            )
            
            return response_obj
        except Exception as e:
            logger.error(f"LLM call failed for {node_name}", error=str(e))
            raise

    def _check_queryability_warnings(self, sql: str, schema: Dict[str, Any], sensitivity_rules: Optional[Dict] = None) -> List[Dict[str, str]]:
        """Check if SQL uses non-queryable tables or columns, including forbidden fields."""
        warnings = []
        try:
            parsed = sqlparse.parse(sql)
            if not parsed: return warnings
            statement = parsed[0]
            table_refs = {t.lower() for t in self._extract_table_references(statement)}
            column_refs = {c.lower() for c in self._extract_column_references(statement)}

            # 1. Check isQueryable in schema metadata
            for table in schema.get("tables", []):
                table_name = table.get('name', '').lower()
                if not table.get("isQueryable", True) and table_name in table_refs:
                    warnings.append({
                        "type": "non_queryable_table",
                        "entity": table_name,
                        "message": f"Table '{table_name}' is non-queryable.",
                        "severity": "warning"
                    })

                for col in table.get("columns", []):
                    if not col.get("isQueryable", True):
                        col_ref = f"{table_name}.{col['name']}".lower()
                        if col_ref in column_refs or col['name'].lower() in column_refs:
                            warnings.append({
                                "type": "non_queryable_column",
                                "entity": col_ref,
                                "message": f"Column '{col_ref}' is non-queryable.",
                                "severity": "warning"
                            })

            # 2. Check forbiddenFields from sensitivity rules
            if sensitivity_rules:
                forbidden_fields = sensitivity_rules.get("forbiddenFields", [])
                for field in forbidden_fields:
                    f_lower = field.lower()
                    if "." in f_lower:
                        if f_lower in column_refs or f_lower.split(".")[-1] in column_refs:
                            warnings.append({
                                "type": "non_queryable_column",
                                "entity": f_lower,
                                "message": f"Column '{f_lower}' is restricted.",
                                "severity": "warning"
                            })
                    else:
                        if f_lower in table_refs:
                            warnings.append({
                                "type": "non_queryable_table",
                                "entity": f_lower,
                                "message": f"Table '{f_lower}' is restricted.",
                                "severity": "warning"
                            })
        except Exception as e:
            logger.debug("Failed to check queryability warnings", error=str(e))
            pass
        return warnings

    def _extract_table_references(self, statement) -> List[str]:
        tables = []
        from_seen = False
        for token in statement.tokens:
            if token.ttype is Keyword and token.value.upper() == 'FROM':
                from_seen = True
                continue
            if from_seen:
                if isinstance(token, Identifier): tables.append(token.get_real_name())
                elif isinstance(token, IdentifierList):
                    for identifier in token.get_identifiers(): tables.append(identifier.get_real_name())
                elif token.ttype is Keyword and token.value.upper() in ('WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT'):
                    from_seen = False
            if token.ttype is Keyword and 'JOIN' in token.value.upper():
                idx = statement.tokens.index(token)
                for next_token in statement.tokens[idx+1:]:
                    if isinstance(next_token, Identifier):
                        tables.append(next_token.get_real_name())
                        break
        return [t for t in tables if t]

    def _extract_column_references(self, statement) -> List[str]:
        columns = []
        def extract(token):
            if isinstance(token, Identifier): columns.append(str(token))
            elif hasattr(token, 'tokens'):
                for t in token.tokens: extract(t)
        extract(statement)
        return columns

    def _extract_sensitive_columns(self, schema: Dict[str, Any]) -> List[Dict[str, Any]]:
        sensitive_cols = []
        for table in schema.get("tables", []):
            t_name = table.get('name', '')
            for col in table.get("columns", []):
                if col.get("isSensitive", False):
                    sensitive_cols.append({"table": t_name, "column": col["name"], "maskingStrategy": col.get("maskingStrategy", "full")})
                if not col.get("isQueryable", True):
                    sensitive_cols.append({"table": t_name, "column": col["name"], "maskingStrategy": "remove"})
        return sensitive_cols

    def _filter_non_queryable_columns(self, results: List[Dict[str, Any]], warnings: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        if not results or not warnings: return results
        non_queryable = {w["entity"].split(".")[-1].lower() for w in warnings if w["type"] == "non_queryable_column"}
        if not non_queryable: return results
        return [{k: v for k, v in row.items() if k.lower() not in non_queryable} for row in results]

    def _build_schema_summary(self, schema: Optional[Dict]) -> str:
        """Build lightweight schema summary for faster NLU classification."""
        if not schema or not schema.get("tables"): return "No schema available"
        lines = []
        for table in schema.get("tables", []):
            if not table.get("isQueryable", True): continue
            name = table.get("tableName", table.get("name", "unknown"))
            desc = table.get("description", "")
            line = f"- {name}"
            if desc: line += f": {desc[:100]}"
            lines.append(line)
        return "Available Tables:\n" + "\n".join(lines)

    def _format_schema_with_metadata(self, schema: Dict[str, Any], relationships: List[Dict[str, Any]] = None) -> str:
        """Format schema with metadata and FK relationships inline."""
        lines = []
        fk_map = {f"{r['sourceTable'].lower()}.{r['sourceColumn'].lower()}": f"{r['targetTable']}.{r['targetColumn']}" for r in (relationships or [])}
        for table in schema.get("tables", []):
            if not table.get("isQueryable", True): continue
            t_name = table.get('name', 'unknown')
            t_line = f"Table: {t_name}" + (f" - {table['description']}" if table.get('description') else "")
            lines.append(t_line)
            for col in table.get("columns", []):
                if not col.get("isQueryable", True): 
                    logger.debug("Skipping non-queryable column", table=t_name, column=col.get("name"))
                    continue
                c_name = col['name']
                c_line = f"  - {c_name} ({col.get('type', 'unknown')})"
                if c_name.endswith('_id') or c_name == 'id': c_line += " [ID/FK]"
                if col.get('description'): c_line += f": {col['description']}"
                fk_key = f"{t_name.lower()}.{c_name.lower()}"
                if fk_key in fk_map:
                    target_ref = fk_map[fk_key]
                    target_table = target_ref.split('.')[0]
                    c_line += f" → JOIN {target_table} ON {t_name}.{c_name} = {target_ref} ← FK is in {t_name}"
                lines.append(c_line)
                logger.debug("Included column in schema context", table=t_name, column=c_name)
            lines.append("")
        return "\n".join(lines)
    def _build_schema_context(self, state: QueryState) -> str:
        """Build schema context for LLM using best available sources."""
        # Preference: Pinned schema takes priority for corrections
        pinned_schema = state.get("pinned_schema")
        
        if pinned_schema:
            relevant_tables = pinned_schema
            # For pinned schema (corrector), we typically stay focused, but expansion
            # might be needed if a neighbor is missing. For now, keep it strictly pinned.
        else:
            # Merge existing relevant schema with new intent-based tables
            search_tables = state.get("relevant_schema") or []
            intent_table_names = {name.lower() for name in (state.get("relevant_tables_from_intent") or [])}
            all_tables = state.get("schema_metadata", {}).get("tables", [])
            
            # Map intent names to actual table objects if they aren't already in search_tables
            existing_names = {(t.get("name") or t.get("tableName", "")).lower() for t in search_tables}
            new_intent_tables = [
                t for t in all_tables 
                if (t.get("name") or t.get("tableName", "")).lower() in intent_table_names 
                and (t.get("name") or t.get("tableName", "")).lower() not in existing_names
            ]
            
            relevant_tables = search_tables + new_intent_tables

            # Only apply Degree-1 expansion if confidence is low (< 0.9)
            # This prevents polluting the context with extra tables when orchestrator is sure.
            confidence = state.get("intent", {}).get("confidence", 0)
            if relevant_tables and confidence < 0.9:
                relevant_tables = self._expand_with_related_tables(relevant_tables, all_tables, state["schema_metadata"])

        if not relevant_tables:
            # Fallback to full schema if search found nothing
            schema_to_format = state["schema_metadata"]
        else:
            # Create sub-schema containing only relevant tables
            schema_to_format = {
                "tables": relevant_tables,
                "relationships": self._filter_relevant_relationships(
                    state["schema_metadata"].get("relationships", []),
                    relevant_tables
                )
            }

        return self._format_schema_with_metadata(
            schema_to_format,
            schema_to_format.get("relationships")
        )

    def _filter_relevant_relationships(self, relationships: List[Dict], relevant_tables: List[Dict]) -> List[Dict]:
        """Filter relationships to include those where at least ONE side is in the relevant set."""
        table_names = {t.get("name").lower() for t in relevant_tables}
        filtered = []
        for rel in relationships:
            # Relaxed filter: if AT LEAST ONE table is relevant, show the relationship
            # so the LLM knows how to join OUT of the current set.
            if rel.get("sourceTable", "").lower() in table_names or \
               rel.get("targetTable", "").lower() in table_names:
                filtered.append(rel)
        return filtered

    def _build_restricted_context(self, state: QueryState, table_names_filter: List[str] = None) -> str:
        """Build context for non-queryable tables and columns, optionally filtered by table names."""
        schema = state.get("schema_metadata", {})
        if not schema:
            return ""
        
        # Normalize filter to set for efficient lookup if provided
        table_filter = {name.lower() for name in table_names_filter} if table_names_filter else None
        
        restricted_tables = []
        restricted_columns = []
        
        # 1. Check isQueryable in schema metadata
        for table in schema.get("tables", []):
            t_name = table.get("name") or table.get("tableName", "unknown")
            
            # Filter logic: if filter is provided, only check if table is in the filter
            if table_filter and t_name.lower() not in table_filter:
                continue
                
            if not table.get("isQueryable", True):
                restricted_tables.append(t_name)
            else:
                for col in table.get("columns", []):
                    if not col.get("isQueryable", True):
                        c_name = col.get("name") or col.get("columnName", "unknown")
                        restricted_columns.append(f"{t_name}.{c_name}")

        # 2. Add forbiddenFields from sensitivity rules
        forbidden_fields = state.get("sensitivity_rules", {}).get("forbiddenFields", [])
        for field in forbidden_fields:
            if "." in field:
                t_part, c_part = field.split(".", 1)
                if not table_filter or t_part.lower() in table_filter:
                    if field not in restricted_columns:
                        restricted_columns.append(field)
            else:
                # If it's just a table name in forbiddenFields
                if not table_filter or field.lower() in table_filter:
                    if field not in restricted_tables:
                        restricted_tables.append(field)
        
        lines = []
        lines.append("### FULLY RESTRICTED TABLES (Blocking: Do NOT query or mention these) ###")
        if restricted_tables:
            for t in sorted(list(set(restricted_tables))):
                lines.append(f"- {t}")
        else:
            lines.append("- [None]")
        
        lines.append("")
        lines.append("### TABLES WITH RESTRICTED COLUMNS (Partial Access: These tables ARE queryable, but listed columns MUST be omitted) ###")
        if restricted_columns:
            # Group by table for cleaner presentation
            grouped_cols = {}
            for col_ref in restricted_columns:
                if "." in col_ref:
                    t, c = col_ref.split(".", 1)
                    if t not in grouped_cols: grouped_cols[t] = []
                    grouped_cols[t].append(c)
                else:
                    if "Miscellaneous" not in grouped_cols: grouped_cols["Miscellaneous"] = []
                    grouped_cols["Miscellaneous"].append(col_ref)
            
            for t in sorted(grouped_cols.keys()):
                cols = ", ".join(sorted(list(set(grouped_cols[t]))))
                lines.append(f"- {t}: {cols}")
        else:
            lines.append("- [None]")
                
        return "\n".join(lines)

    def _is_common_column(self, col_name: str) -> bool:
        """Helper to identify generic columns (id, timestamp, etc.)"""
        return col_name.lower() in self.COMMON_COLUMN_NAMES or col_name.lower().endswith('_id')

    def _expand_with_related_tables(self, initial_tables: List[Dict], all_tables: List[Dict], schema_metadata: Dict) -> List[Dict]:
        """Degree-1 Expansion: Include tables directly related via FK."""
        if not initial_tables: return []
        
        expanded_names = {t["name"].lower() for t in initial_tables}
        relationships = schema_metadata.get("relationships", [])
        all_tables_by_name = {t["name"].lower(): t for t in all_tables}
        
        new_tables = list(initial_tables)
        for rel in relationships:
            src = rel.get("sourceTable", "").lower()
            tgt = rel.get("targetTable", "").lower()
            
            # If source is in, add target
            if src in expanded_names and tgt not in expanded_names:
                if tgt in all_tables_by_name:
                    new_tables.append(all_tables_by_name[tgt])
                    expanded_names.add(tgt)
            # If target is in, add source
            elif tgt in expanded_names and src not in expanded_names:
                if src in all_tables_by_name:
                    new_tables.append(all_tables_by_name[src])
                    expanded_names.add(src)
        
        return new_tables

    def _extract_custom_prompts(self, schema: Dict, user_message: str) -> str:
        """Extract domain-specific hints from schema metadata."""
        # Legacy implementation used keyword matching on user_message
        hints = []
        user_message_lower = user_message.lower()
        
        # Check table-level hints
        for table in schema.get("tables", []):
            t_name = table.get("name", "").lower()
            if t_name in user_message_lower:
                if table.get("prompt_hint"):
                    hints.append(f"Hint for {t_name}: {table['prompt_hint']}")
                
        # Check column-level hints in queryable tables only
        for table in schema.get("tables", []):
            if not table.get("isQueryable", True): continue
            for col in table.get("columns", []):
                c_name = col.get("name", "").lower()
                if c_name in user_message_lower and col.get("prompt_hint"):
                    hints.append(f"Hint for {table['name']}.{c_name}: {col['prompt_hint']}")
                    
        return "\n".join(hints) if hints else ""
    def _extract_tables_from_query(self, canonical_query: Dict) -> Set[str]:
        """Extract all table names (normalized to lower case) used in the canonical query."""
        tables = set()
        if not canonical_query: return tables

        # Primary table
        pt = canonical_query.get("primary_table")
        if pt:
            pt_name = pt.get("name") if isinstance(pt, dict) else str(pt)
            if pt_name: tables.add(pt_name.lower())

        # Joins
        for join in canonical_query.get("joins", []):
            j_table = join.get("table")
            if j_table: tables.add(j_table.lower())
        return tables

    def _calculate_pinned_schema(self, state: QueryState) -> List[Dict]:
        """
        Calculate pinned schema by extracting tables from generated SQL or canonical query.
        Strictly includes only these tables, their columns, and mutual relationships.
        """
        used_tables = set()
        
        # 1. Try extracting from generated SQL first (most accurate for corrector)
        if state.get("generated_sql"):
            try:
                parsed = sqlparse.parse(state["generated_sql"])
                if parsed:
                    used_tables = set(t.lower() for t in self._extract_table_references(parsed[0]))
            except Exception as e:
                logger.warning("Failed to extract tables from SQL", error=str(e))

        # 2. Fallback to canonical query if SQL extraction found nothing
        if not used_tables and state.get("canonical_query"):
            used_tables = self._extract_tables_from_query(state["canonical_query"])

        if not used_tables:
            return []

        # 3. Filter schema metadata
        all_tables = state.get("schema_metadata", {}).get("tables", [])
        pinned_schema = [t for t in all_tables if (t.get("name") or t.get("tableName", "")).lower() in used_tables]
        
        logger.info(
            "Pinned schema calculated",
            used_tables=list(used_tables),
            pinned_count=len(pinned_schema)
        )
        return pinned_schema
