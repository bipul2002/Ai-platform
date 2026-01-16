import copy
from datetime import datetime
from typing import Dict, Any, List, Optional
import structlog
from langchain_core.messages import SystemMessage, HumanMessage
from mcp_tools.sql_executor import SQLExecutor

from agent.nodes.base import BaseNode, QueryState
from agent.prompts import build_sql_corrector_prompt
from agent.models import SQLCorrection

logger = structlog.get_logger()

class ValidatorNodes(BaseNode):
    async def sql_validator_node(self, state: QueryState) -> Dict:
        """Validate generated SQL for safety, syntax and correctness"""
        if state.get("error") or not state.get("generated_sql"):
            return {}

        sql = state["generated_sql"]
        dialect = state["sql_dialect"]
        forbidden_fields = state.get("sensitivity_rules", {}).get("forbiddenFields", [])

        # 1. Static & Syntax Validation (Security + SQLGlot)
        result = self.sql_validator.validate(
            sql, 
            dialect=dialect,
            forbidden_fields=forbidden_fields
        )

        # 2. Critical Semantic Linting (SQLFluff filtered)
        lint_errors = self.sql_validator.lint_sql(sql, dialect=dialect)

        # 3. Dynamic Sandbox Validation (Execute with LIMIT 0)
        validation_error = None
        sandbox_success = True
        
        if result["is_valid"]:
            try:
                conn_details = await self.system_db.get_connection_details(state["agent_id"])
                executor = SQLExecutor(conn_details)
                
                # Strip trailing semicolon for subquery wrapping
                clean_sql = sql.strip().rstrip(";")
                sandbox_sql = clean_sql
                if "limit" not in sql.lower():
                    if dialect == "mysql":
                        sandbox_sql = f"SELECT * FROM ({clean_sql}) AS sandbox_check LIMIT 0"
                    else: # postgresql
                        sandbox_sql = f"SELECT * FROM ({clean_sql}) AS sandbox_check LIMIT 0"
                
                logger.info("Running sandbox validation", sql_preview=sandbox_sql[:50])
                await executor.execute(sandbox_sql)
                logger.info("Sandbox validation passed")
            except Exception as e:
                msg = str(e)
                sandbox_success = False

                # Check if this is an explicit connection error raised by SQLExecutor
                is_conn_error = "DATABASE_CONNECTION_ERROR" in msg
                
                if is_conn_error:
                    # Clean up the message for user display
                    display_msg = msg.replace("DATABASE_CONNECTION_ERROR: ", "")
                    # Return immediately for connection errors
                    logger.warning("DB Connection Failure detected", error=display_msg)
                    return {
                        "validation_result": result,
                        "validation_success": False,
                        "queryability_warnings": [],
                        "error": f"Database connection error: {display_msg}",
                        "is_connection_error": True,
                        "current_step": "validated_with_error"
                    }
                
                # Any other error is treated as a SQL runtime error (schema/syntax/logic)
                validation_error = f"Sandbox execution failed: {msg}"
                logger.warning("Sandbox validation failed (SQL Error)", error=msg)

        # Check queryability (collect warnings)
        queryability_warnings = self._check_queryability_warnings(
            sql,
            state["schema_metadata"],
            sensitivity_rules=state.get("sensitivity_rules")
        )

        # Format all errors into a single flat list of clear strings
        all_errors = []
        
        # 1. Add validator/parser errors
        if not result["is_valid"]:
            all_errors.extend(result["errors"])

        # 2. Add sandbox execution error
        if validation_error:
            # Clean up sandbox error if it's too technical
            msg = validation_error
            if "Sandbox execution failed:" in msg:
                msg = msg.replace("Sandbox execution failed:", "Database execution error:")
            all_errors.append(msg)

        # 3. Add critical lint errors (limited to avoid bloat)
        if lint_errors:
            # We already stripped rule codes in lint_sql
            all_errors.extend(lint_errors[:10])

        # Combine into a single string for the prompt, ensuring uniqueness
        unique_errors = []
        seen_errors = set()
        for err in all_errors:
            if err not in seen_errors:
                unique_errors.append(err)
                seen_errors.add(err)
        
        combined_error = "\n".join(unique_errors) if unique_errors else None
        
        # Consider the query valid only if there are NO errors and NO critical violations
        is_valid = result["is_valid"] and sandbox_success and not lint_errors

        return {
            "validation_result": result,
            "validation_success": is_valid,
            "queryability_warnings": queryability_warnings,
            "error": combined_error,
            "is_connection_error": False,
            "current_step": "validated"
        }

    async def sql_corrector(self, state: QueryState) -> Dict:
        """Repair invalid SQL using LLM with strictly pinned schema context"""
        correction_iteration = state.get("correction_iteration", 0)
        global_iteration = state.get("iteration_count", 0)
        
        if correction_iteration >= 3:
            logger.warning("Max SQL correction retries reached")
            return {"error": f"Correction failed after 3 attempt. Error: {state.get('error')}"}

        # Calculate pinned schema based on the generated query that failed
        pinned_schema = self._calculate_pinned_schema(state)
        
        # Temporarily update state copy for _build_schema_context
        temp_state = copy.copy(state)
        if pinned_schema:
            temp_state["pinned_schema"] = pinned_schema
            logger.info("SQL Corrector using pinned schema", tables=[t.get("name") for t in pinned_schema])
        
        # Build strict schema context (uses pinned_schema if present)
        schema_context = self._build_schema_context(temp_state)
        schema_context_escaped = schema_context.replace("{", "{{").replace("}", "}}")
        
        # Build restricted context only for involved tables
        pinned_table_names = [t.get("name") or t.get("tableName") for t in pinned_schema] if pinned_schema else None
        restricted_context = self._build_restricted_context(state, table_names_filter=pinned_table_names)

        # Build dialect-specific SQL Corrector prompt
        dialect = state.get("sql_dialect", "mysql")
        system_prompt_template = build_sql_corrector_prompt(dialect)
        
        system_prompt = system_prompt_template.format(
            current_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            schema_context=schema_context_escaped,
            restricted_entities=restricted_context,
            failed_sql=state.get("generated_sql", "No SQL generated"),
            error_message=state.get("error", "Unknown error")
        )

        try:
            logger.info("Calling SQL Corrector LLM")
            response = await self._call_llm_with_logging(
                messages=[
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=f"The following errors were found in the generated SQL. Please fix all of them:\n\n{state.get('error')}")
                ],
                node_name="sql_corrector",
                query_history_id=state.get("query_history_id"),
                structured_model=SQLCorrection
            )
            
            # Log the raw response for debugging
            logger.info("SQL Corrector response received", 
                        generated_sql=response.generated_sql if response else None,
                        correction_note=response.correction_note if response else None)

            if not response:
                return {"error": "LLM failed to correct SQL"}

            # Programmatic verification: Check if the SQL actually changed
            failed_sql = state.get("generated_sql", "")
            new_sql = response.generated_sql
            
            if self._normalize_sql(failed_sql) == self._normalize_sql(new_sql):
                logger.warning("SQL Corrector returned identical SQL (fake fix detected)")
                # Force a retry by returning an error that will be seen in the next iteration
                return {
                    "error": f"The correction you provided is identical to the failed SQL. You claimed to fix: {response.correction_note}. Please actually apply the changes to the SQL code.",
                    "correction_iteration": correction_iteration + 1,
                    "iteration_count": global_iteration + 1,
                    "current_step": "verification_failed"
                }

            return {
                "generated_sql": response.generated_sql,
                "correction_note": response.correction_note,
                "iteration_count": global_iteration + 1,
                "correction_iteration": correction_iteration + 1,
                "error": None,
                "current_step": "sql_corrected"
            }
        except Exception as e:
            logger.error("SQL correction failed", error=str(e))
            return {"error": str(e), "current_step": "error"}
    async def native_schema_validator(self, state: QueryState) -> Dict:
        """Validate native SQL against database schema using SQLGlot catalog."""
        if state.get("error") or not state.get("generated_sql"):
            return {}

        sql = state["generated_sql"]
        dialect = state["sql_dialect"]
        relevant_schema = state.get("relevant_schema", [])
        
        errors = []
        
        # 1. SQLGlot Schema Validation
        from sqlglot import parse_one, exp
        from sqlglot.optimizer.qualify_columns import qualify_columns
        from sqlglot.schema import MappingSchema
        from sqlglot.errors import OptimizeError, ParseError

        glot_dialect = "postgres" if dialect.lower() == "postgresql" else dialect.lower()
        
        try:
            # Build Schema from relevant_schema, respecting restrictions
            schema_dict = {}
            forbidden_fields = state.get("sensitivity_rules", {}).get("forbiddenFields", [])
            forbidden_tables = {f.lower() for f in forbidden_fields if "." not in f}
            forbidden_cols = {f.lower() for f in forbidden_fields if "." in f}
            
            for table in relevant_schema:
                t_name = table.get("name") or table.get("tableName")
                if not t_name: continue
                t_lower = t_name.lower()
                
                # Skip non-queryable or forbidden tables
                if not table.get("isQueryable", True) or t_lower in forbidden_tables:
                    continue
                
                columns_map = {}
                for col in table.get("columns", []):
                    c_name = col.get("name") or col.get("columnName")
                    if not c_name: continue
                    c_lower = c_name.lower()
                    
                    # Skip non-queryable or forbidden columns
                    full_col = f"{t_lower}.{c_lower}"
                    if not col.get("isQueryable", True) or full_col in forbidden_cols:
                        continue
                        
                    c_type = col.get("type", "varchar").lower()
                    columns_map[c_name] = c_type
                
                if columns_map:
                    schema_dict[t_name] = columns_map
            
            schema = MappingSchema(schema_dict)
            
            # Parse and Qualify
            expression = parse_one(sql, read=glot_dialect)
            qualify_columns(expression, schema=schema)
            logger.info("SQLGlot schema validation passed")
            
        except ParseError as e:
            errors.append(f"SQL Syntax Error: {str(e)}")
        except OptimizeError as e:
            # OptimizeError is often where qualify_columns throws for missing items
            msg = str(e)
            if "Column" in msg and "not found" in msg:
                msg = f"Schema Error: {msg}. Please check if the column name is correct and exists in the tables used."
            elif "Table" in msg and "not found" in msg:
                msg = f"Schema Error: {msg}. Please ensure you only use tables provided in the schema context."
            errors.append(msg)
        except Exception as e:
            if "Column" in str(e) or "Table" in str(e):
                errors.append(f"Schema Error: {str(e)}")
            else:
                logger.warning("SQLGlot validation warning", error=str(e))

        # 2. Call existing static/security/sandbox validation
        # We reuse sql_validator_node's logic but combine the results
        validator_result = await self.sql_validator_node(state)
        
        if validator_result.get("error"):
            # Split the combined string back to list to deduplicate with SQLGlot errors
            existing_errors = validator_result["error"].split("\n")
            for err in existing_errors:
                if err not in errors:
                    errors.append(err)

        unique_errors = []
        seen = set()
        for err in errors:
            if err not in seen:
                unique_errors.append(err)
                seen.add(err)

        combined_error = "\n".join(unique_errors) if unique_errors else None
        is_valid = not combined_error

        return {
            "validation_success": is_valid,
            "error": combined_error,
            "is_connection_error": validator_result.get("is_connection_error", False),
            "queryability_warnings": validator_result.get("queryability_warnings", []),
            "current_step": "native_schema_validated",
            "visual_confirmation": "SQL validation passed successfully." if is_valid else f"Validation failed with {len(unique_errors)} errors."
        }
