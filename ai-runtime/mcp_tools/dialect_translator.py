import re
from typing import Dict, Any, List, Optional, Union
import structlog
from sqlalchemy import (
    select, 
    table as sqla_table, 
    column as sqla_column, 
    text, 
    func, 
    and_, 
    desc, 
    asc, 
    cast, 
    Boolean, 
    String,
    Integer,
    Numeric,
    DateTime,
    Date,
    null as sqla_null,
    literal_column
)
from sqlalchemy.sql import expression
from sqlalchemy.dialects import postgresql, mysql, sqlite

logger = structlog.get_logger()


class DialectTranslator:
    DIALECT_MAP = {
        "postgresql": postgresql.dialect(),
        "mysql": mysql.dialect(),
        "sqlite": sqlite.dialect()
    }

    DIALECT_CONFIGS = {
        "postgresql": {
            "quote_char": '"',
            "string_quote": "'",
            "limit_syntax": "LIMIT {limit}",
            "offset_syntax": "OFFSET {offset}",
            "ilike_supported": True,
            "boolean_true": "TRUE",
            "boolean_false": "FALSE",
            "current_timestamp": "CURRENT_TIMESTAMP",
            "current_date": "CURRENT_DATE",
            "concat_operator": "||",
            "json_extract": "{column}->>{path}",
            "case_insensitive_like": "ILIKE",
        },
        "mysql": {
            "quote_char": "`",
            "string_quote": "'",
            "limit_syntax": "LIMIT {limit}",
            "offset_syntax": "OFFSET {offset}",
            "ilike_supported": False,
            "boolean_true": "1",
            "boolean_false": "0",
            "current_timestamp": "NOW()",
            "current_date": "CURDATE()",
            "concat_operator": None,
            "json_extract": "JSON_UNQUOTE(JSON_EXTRACT({column}, {path}))",
            "case_insensitive_like": "LIKE",
        }
    }

    AGG_FUNCS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "STDDEV", "VARIANCE"]
    
    def __init__(self):
        pass

    def generate_sql(
        self,
        canonical_query: Dict[str, Any],
        dialect: str = "postgresql",
        schema: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Generate SQL from a strictly validated canonical query dictionary
        using SQLAlchemy Core for robust dialect handling.
        """
        # 0. Set up dialect
        sqla_dialect = self.DIALECT_MAP.get(dialect, self.DIALECT_MAP["postgresql"])
        
        # 1. Primary Table
        primary_table_info = canonical_query.get("primary_table", {})
        if not primary_table_info:
            raise ValueError("Canonical query missing 'primary_table'")
            
        primary_name = primary_table_info.get("name")
        primary_alias_name = primary_table_info.get("alias")
        
        t1 = sqla_table(primary_name)
        if primary_alias_name:
            t1 = t1.alias(primary_alias_name)
        
        # Map of table aliases -> SQLAlchemy table/alias objects
        tables = {primary_alias_name or primary_name: t1}
        
        # 2. Joins (Need to process tables BEFORE columns to ensure alias resolution)
        join_nodes = []
        for j in canonical_query.get("joins", []):
            j_name = j.get("table")
            j_alias_name = j.get("alias")
            
            tj = sqla_table(j_name)
            if j_alias_name:
                tj = tj.alias(j_alias_name)
            
            tables[j_alias_name or j_name] = tj
            join_nodes.append((tj, j))

        # 3. Columns (Select)
        select_cols = []
        for col_data in canonical_query.get("columns", []):
            select_cols.append(self._sqla_column(col_data, tables))
            
        if not select_cols:
            select_cols = [text("1 /* No queryable columns found */")]
            
        stmt = select(*select_cols).select_from(t1)
        
        # 4. Apply Joins to statement
        for tj, j in join_nodes:
            j_type = j.get("type", "INNER").upper()
            on = j.get("on", {})
            left = self._resolve_sqla_column(on.get("left_column"), tables)
            right = self._resolve_sqla_column(on.get("right_column"), tables)
            op = on.get("operator", "=")
            
            on_clause = self._sqla_operator(left, op, right)
            
            if j_type == "LEFT":
                stmt = stmt.outerjoin(tj, on_clause)
            elif j_type == "RIGHT":
                 # SQLAlchemy supports right joins but they are less common in generators
                 stmt = stmt.join(tj, on_clause, isouter=True, full=False) # Simplified mapping
            elif j_type == "FULL":
                 stmt = stmt.outerjoin(tj, on_clause, full=True)
            else:
                stmt = stmt.join(tj, on_clause)

        # 5. Filters (Where)
        filters = []
        for f in canonical_query.get("filters", []):
            filter_node = self._sqla_filter(f, tables, schema, dialect)
            if filter_node is not None:
                filters.append(filter_node)
            
        if filters:
            stmt = stmt.where(and_(*filters))
            
        # 6. Group By
        group_by = canonical_query.get("group_by", [])
        if group_by:
            group_cols = [self._resolve_sqla_column(c, tables) for c in group_by]
            stmt = stmt.group_by(*group_cols)
            
        # 7. Order By
        order_by = canonical_query.get("order_by", [])
        if order_by:
            order_clauses = []
            for o in order_by:
                col = self._resolve_sqla_column(o["column"], tables)
                direction = o.get("direction", o.get("order", "ASC")).upper()
                if direction.startswith("DESC"):
                    order_clauses.append(desc(col))
                else:
                    order_clauses.append(asc(col))
            stmt = stmt.order_by(*order_clauses)
            
        # 8. Limit / Offset
        limit = canonical_query.get("limit")
        offset = canonical_query.get("offset")
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset:
            stmt = stmt.offset(offset)
            
        # 9. Compile with literal binds to get the final SQL string
        compiled = stmt.compile(
            dialect=sqla_dialect, 
            compile_kwargs={"literal_binds": True}
        )
        
        sql = str(compiled)
        logger.info("Generated SQL via SQLAlchemy", dialect=dialect, sql_preview=sql[:200])
        return sql

    def _resolve_sqla_column(self, col_ref: str, tables: Dict[str, Any]) -> Any:
        """Resolve a string column reference (e.g. 'u.name') to a SQLAlchemy column object."""
        if not col_ref: return None
        if col_ref == "*": return text("*")
        
        # Detect if this is an expression (contains operators or parentheses)
        # Avoid treating simple qualified names 't.col' as expressions
        if any(op in col_ref for op in (" ", "(", ")", "+", "-", "*", "/", "||")):
             return text(col_ref)

        # Handle table-qualified references
        if "." in col_ref:
            table_alias, col_name = col_ref.split(".", 1)
            if table_alias in tables:
                t = tables[table_alias]
                # The standard SQLAlchemy way for aliases/tables is t.c[name]
                try:
                    return t.c[col_name]
                except (AttributeError, KeyError):
                    # Fallback for dynamic columns or if t.c fails
                    c = sqla_column(col_name)
                    c.table = t
                    return c
            else:
                # Table not found in alias map - still split and quote separately
                from sqlalchemy import table as sqla_tbl
                c = sqla_column(col_name)
                c.table = sqla_tbl(table_alias)
                return c
            
        # Handle bare column name
        return sqla_column(col_ref)

    def _sqla_column(self, col_data: Dict[str, Any], tables: Dict[str, Any]) -> Any:
        """Create a SQLAlchemy column expression from canonical column metadata."""
        col_ref = col_data.get("column")
        agg = col_data.get("aggregate")
        alias = col_data.get("alias")

        # Robustness: Check if this aggregate is ALREADY present in the column string
        # e.g. if column is "ROUND(AVG(x), 2)" and agg is "AVG", it's a duplicate.
        if agg and isinstance(col_ref, str):
            agg_pattern = rf"\b{re.escape(agg)}\s*\("
            if re.search(agg_pattern, col_ref, re.IGNORECASE):
                # It's already there, so we don't need to wrap it again
                agg = None

        # Robustness: Check if LLM put aggregate at the top level (e.g. "COUNT(a.id)")
        if not agg and col_ref and "(" in col_ref and col_ref.strip().endswith(")"):
            # Simple extraction of FUNCTION(arg)
            match = re.match(r"^(\w+)\s*\((.+)\)$", col_ref.strip(), re.IGNORECASE)
            if match:
                agg = match.group(1).upper()
                col_ref = match.group(2).strip()
        
        # Handle DISTINCT in the column string (hallucination safeguard)
        is_distinct = False
        if isinstance(col_ref, str) and col_ref.upper().startswith("DISTINCT "):
            is_distinct = True
            col_ref = col_ref[9:].strip()
            
        c = self._resolve_sqla_column(col_ref, tables)
        
        # Apply Aggregation
        if agg:
            agg_func = agg.upper()
            if is_distinct:
                from sqlalchemy import distinct
                c = getattr(func, agg_func.lower())(distinct(c))
            else:
                # Handle possible mapping issues (e.g. VAR -> variance)
                func_name = agg_func.lower()
                if func_name == "var": func_name = "variance"
                
                c = getattr(func, func_name)(c)
        elif is_distinct:
            from sqlalchemy import distinct
            c = distinct(c)
                
        # Apply Alias
        if alias:
            c = c.label(alias)
            
        return c

    def _sqla_operator(self, left: Any, op: str, right: Any) -> Any:
        """Map canonical operators to SQLAlchemy expressions."""
        op = op.upper()
        if op == "=": return left == right
        if op == "!=" or op == "<>": return left != right
        if op == ">": return left > right
        if op == "<": return left < right
        if op == ">=": return left >= right
        if op == "<=": return left <= right
        if op == "LIKE": return left.like(right)
        if op == "ILIKE": return left.ilike(right)
        if op == "IN": return left.in_(right) if isinstance(right, (list, tuple)) else left == right
        if op == "BETWEEN": return left.between(right[0], right[1]) if isinstance(right, (list, tuple)) and len(right) == 2 else left == right
        if op == "IS": 
            if right is None: return left.is_(None)
            return left == right
        if op == "IS NOT":
            if right is None: return left.isnot(None)
            return left != right
        
        # Fallback to custom text operator for unknown ops
        return text(f"{left} {op} {right}")

    def _sqla_filter(self, f: Union[str, Dict[str, Any]], tables: Dict[str, Any], schema: Optional[Dict[str, Any]], dialect: str) -> Any:
        """Convert a canonical filter dict to a SQLAlchemy clause."""
        if isinstance(f, str):
            return text(f)
            
        col_data = f.get("column")
        operator = f.get("operator", "=").upper()
        value = f.get("value")
        
        # Handle "NULL" string as None
        if isinstance(value, str) and value.upper() == "NULL":
            value = None
            
        left = self._resolve_sqla_column(col_data, tables)
        
        # Handle list-based values for IN/BETWEEN
        if operator == "IN" and isinstance(value, str):
            # Try to parse "val1, val2" or "(val1, val2)"
            value = [v.strip().strip("'").strip('"') for v in value.strip("()").split(",")]
        
        # Boolean conversion logic (reused from legacy)
        if self._is_boolean_column(col_data, schema):
            if isinstance(value, bool):
                pass # Good
            elif isinstance(value, (int, str)):
                # Simplified conversion
                if str(value).lower() in ("1", "true", "t", "yes"):
                    value = True
                else:
                    value = False
                    
        return self._sqla_operator(left, operator, value)

    def _is_boolean_column(self, column_ref: str, schema: Optional[Dict[str, Any]]) -> bool:
        """Helper to detect boolean columns in schema."""
        if not schema or not column_ref: return False
        col_name = column_ref.split(".")[-1] if "." in column_ref else column_ref
        for table in schema.get("tables", []):
            for col in table.get("columns", []):
                if col.get("name", "").lower() == col_name.lower():
                    return col.get("type", "").lower() in ["boolean", "bool", "tinyint(1)"]
        return False

    def translate(self, sql: str, from_dialect: str, to_dialect: str) -> str:
        """Legacy translator for manual SQL adjustments (retained for backward compatibility)."""
        if from_dialect == to_dialect:
            return sql
        
        # Basic string replacement fallback
        if from_dialect == "postgresql" and to_dialect == "mysql":
            sql = sql.replace("ILIKE", "LIKE")
            sql = sql.replace('"', '`')
        elif from_dialect == "mysql" and to_dialect == "postgresql":
            sql = sql.replace('`', '"')
        
        return sql
