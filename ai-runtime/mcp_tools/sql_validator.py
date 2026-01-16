import re
from typing import Dict, Any, List, Optional
import structlog
import sqlfluff
import sqlglot
from sqlglot.errors import ParseError
from sqlfluff.core import Linter, FluffConfig

logger = structlog.get_logger()


class SQLValidator:
    CRITICAL_SQLFLUFF_RULE_PREFIXES = (
        "AM",   # Ambiguous references
        "RF",   # References
        "ST",   # Structural
    )

    IGNORED_PREFIXES = (
        "LT",   # Layout/Formatting
        "CP",   # Capitalization
        "AL",   # Aliasing
        "L",    # Legacy Layout
        "JJ",   # Joins noise
        "CV",   # Convention noise
        "TQ",   # Table quoting
        "JO",   # Join noise
    )

    LAYOUT_RULES_TO_EXCLUDE = [
        "L001", "L002", "L003", "L004", "L037",
        "RF04", "RF05", 
        "AM01", "AM05",
    ] + list(IGNORED_PREFIXES)

    FORBIDDEN_KEYWORDS = [
        'DELETE', 'UPDATE', 'INSERT', 'DROP', 'ALTER', 'TRUNCATE',
        'CREATE', 'GRANT', 'REVOKE', 'EXECUTE', 'EXEC',
        'INTO OUTFILE', 'INTO DUMPFILE', 'LOAD_FILE',
        'INFORMATION_SCHEMA', 'PG_CATALOG', 'MYSQL',
        'SLEEP', 'BENCHMARK', 'WAITFOR'
    ]
    
    DANGEROUS_PATTERNS = [
        r';\s*--',
        r'/\*.*\*/',
        r'UNION\s+ALL\s+SELECT',
        r'OR\s+1\s*=\s*1',
        r"OR\s+'[^']*'\s*=\s*'[^']*'",
        r'EXEC\s*\(',
        r'xp_cmdshell',
        r'sp_executesql',
    ]
    
    def __init__(self):
        self.max_limit = 10000
        self.default_limit = 1000

    def lint_sql(self, sql: str, dialect: str = "postgresql") -> List[str]:
        """Lint SQL using sqlfluff and return only critical correctness issues as strings."""
        # SQLFluff is temporarily disabled to avoid noise from layout rules
        return []
        
        # if not sql:
        #     return []
        # ... (rest of the code commented out)

    def validate(
        self,
        sql: str,
        dialect: str = "postgresql",
        forbidden_fields: List[Dict[str, str]] = None,
        allowed_tables: List[str] = None
    ) -> Dict[str, Any]:
        """Validate SQL and return error strings in the 'errors' list."""
        result = {
            "is_valid": True,
            "sql": sql,
            "errors": [],
            "warnings": [],
            "details": {}
        }
        
        if not sql or not sql.strip():
            result["is_valid"] = False
            result["errors"].append("SQL query is empty")
            return result
        
        # 1. Hard syntax & parse validation (sqlglot)
        glot_dialect = "postgres" if dialect.lower() == "postgresql" else dialect.lower()
        try:
            sqlglot.parse_one(sql, read=glot_dialect, normalize=False)
        except ParseError as e:
            result["is_valid"] = False
            result["errors"].append(f"Syntax error: {str(e)}")
            return result
        except Exception as e:
            result["warnings"].append(f"SQLGlot parsing warning: {str(e)}")

        sql_upper = sql.upper()
        
        # 2. Security Checks
        for keyword in self.FORBIDDEN_KEYWORDS:
            pattern = r'\b' + keyword.replace(' ', r'\s+') + r'\b'
            if re.search(pattern, sql_upper):
                result["is_valid"] = False
                result["errors"].append(f"Forbidden keyword detected: {keyword}")
        
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern, sql_upper, re.IGNORECASE):
                result["is_valid"] = False
                result["errors"].append("Dangerous SQL pattern detected")
        
        if not sql_upper.strip().startswith('SELECT'):
            result["is_valid"] = False
            result["errors"].append("Only SELECT queries are allowed")
        
        if sql.count(';') > 1:
            result["is_valid"] = False
            result["errors"].append("Multiple statements not allowed")

        # 3. Limit Enforcement
        limit_match = re.search(r'\bLIMIT\s+(\d+)', sql_upper)
        if limit_match:
            limit_value = int(limit_match.group(1))
            if limit_value > self.max_limit:
                result["is_valid"] = False
                result["errors"].append(f"LIMIT exceeds maximum allowed ({self.max_limit})")
            result["details"]["limit"] = limit_value
        else:
            result["warnings"].append("No LIMIT clause found. Consider adding one.")
            result["details"]["limit"] = None
        
        # 4. Forbidden Fields
        if forbidden_fields:
            for field in forbidden_fields:
                column_pattern = field.get("column", "")
                if column_pattern:
                    col_regex = column_pattern.replace("*", ".*")
                    if re.search(r'\b' + col_regex + r'\b', sql, re.IGNORECASE):
                        result["is_valid"] = False
                        result["errors"].append(f"Forbidden field accessed: {column_pattern}")
        
        result["is_valid"] = len(result["errors"]) == 0
        return result

    def sanitize_sql(self, sql: str) -> str:
        sql = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
        sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
        sql = sql.strip()
        sql = sql.rstrip(';')
        
        return sql
    
    def add_limit(self, sql: str, limit: int = None, dialect: str = "postgresql") -> str:
        limit = limit or self.default_limit
        limit = min(limit, self.max_limit)
        
        sql_upper = sql.upper()
        
        if 'LIMIT' in sql_upper:
            return sql
        
        sql = sql.rstrip(';').strip()
        
        if dialect == "mysql" or dialect == "postgresql":
            sql = f"{sql} LIMIT {limit}"
        
        return sql
