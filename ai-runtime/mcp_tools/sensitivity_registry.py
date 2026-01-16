import re
from typing import Dict, Any, List, Optional
import hashlib
import structlog

logger = structlog.get_logger()


class SensitivityRegistry:
    VALUE_PATTERNS = {
        "jwt": r"^eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$",
        "aws_key": r"^AKIA[0-9A-Z]{16}$",
        "aws_secret": r"^[A-Za-z0-9/+=]{40}$",
        "api_key": r"^sk-[a-zA-Z0-9]{48}$",
        "credit_card": r"^\d{13,19}$",
        "ssn": r"^\d{3}-?\d{2}-?\d{4}$",
        # "email": r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
        # "phone": r"^\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$",
        "ip_address": r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$",
    }
    
    def __init__(self):
        self.global_rules: List[Dict[str, Any]] = []
        self.agent_rules: List[Dict[str, Any]] = []
        self.forbidden_fields: List[Dict[str, Any]] = []
        self.schema_sensitive_columns: List[Dict[str, Any]] = []  # NEW: Schema-based rules

    def load_rules(self, sensitivity_config: Dict[str, Any]) -> None:
        self.global_rules = sensitivity_config.get("globalRules", [])
        self.agent_rules = sensitivity_config.get("agentRules", [])
        self.forbidden_fields = sensitivity_config.get("forbiddenFields", [])
        self.schema_sensitive_columns = sensitivity_config.get("schemaSensitiveColumns", [])  # NEW

        logger.info(
            "Sensitivity rules loaded",
            global_count=len(self.global_rules),
            agent_count=len(self.agent_rules),
            forbidden_count=len(self.forbidden_fields),
            schema_sensitive_count=len(self.schema_sensitive_columns)  # NEW
        )
    
    def sanitize_results(
        self,
        results: List[Dict[str, Any]],
        sensitivity_config: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        if sensitivity_config:
            self.load_rules(sensitivity_config)
        
        sanitized = []
        
        for row in results:
            sanitized_row = {}
            
            for column, value in row.items():
                masking = self._get_column_masking(column)
                
                if masking:
                    if masking.get("strategy") == "remove":
                        # Skip this column entirely
                        continue
                        
                    sanitized_row[column] = self._apply_masking(
                        value,
                        masking["strategy"],
                        masking["level"]
                    )
                else:
                    sanitized_value = self._check_value_patterns(value)
                    sanitized_row[column] = sanitized_value
            
            sanitized.append(sanitized_row)
        
        return sanitized
    
    def _get_column_masking(self, column_name: str) -> Optional[Dict[str, Any]]:
        """
        Get masking strategy for a column.
        Priority: schema-based rules > pattern-based rules > keyword-based rules
        """
        column_lower = column_name.lower()

        logger.debug(
            "🔍 [DEBUG] Checking masking for column",
            column=column_name,
            schema_rules_count=len(self.schema_sensitive_columns),
            global_rules_count=len(self.global_rules),
            agent_rules_count=len(self.agent_rules)
        )

        # PRIORITY 1: Check schema-based sensitive columns (highest priority)
        # These are explicitly marked by admins in the schema metadata
        for schema_rule in self.schema_sensitive_columns:
            schema_column = schema_rule.get("column", "").lower()
            schema_table = schema_rule.get("table", "").lower()

            # Match by column name (with optional table.column format)
            if "." in column_name:
                # Format: table.column
                parts = column_lower.split(".")
                if len(parts) == 2:
                    table_name, col_name = parts
                    if col_name == schema_column and (not schema_table or table_name == schema_table):
                        return {
                            "strategy": schema_rule.get("maskingStrategy", "full"),
                            "level": schema_rule.get("sensitivityLevel", "high")
                        }
            else:
                # Simple column name
                # Simple column name
                # Match if the rule column matches the result column.
                # If the result key is ambiguous (no dot), we match against the schema rule 
                # even if the rule is table-specific. This protects against SELECT * bypass.
                if column_lower == schema_column:
                    logger.info(
                        "🔍 [DEBUG] Column matched SCHEMA-BASED rule (table-agnostic match for security)",
                        column=column_name,
                        matched_rule=schema_rule,
                        strategy=schema_rule.get("maskingStrategy", "full")
                    )
                    return {
                        "strategy": schema_rule.get("maskingStrategy", "full"),
                        "level": schema_rule.get("sensitivityLevel", "high")
                    }

        # PRIORITY 2: Check pattern-based rules (global and agent-specific)
        for rule in self.global_rules + self.agent_rules:
            if not rule.get("isActive", True):
                continue

            pattern_type = rule.get("patternType")
            pattern_value = rule.get("patternValue", "")
            pattern_regex = rule.get("patternRegex")

            if pattern_type == "column_name":
                if pattern_regex:
                    if re.match(pattern_regex, column_lower, re.IGNORECASE):
                        logger.info(
                            "🔍 [DEBUG] Column matched PATTERN-BASED rule (regex)",
                            column=column_name,
                            rule_id=rule.get("id"),
                            pattern_regex=pattern_regex,
                            strategy=rule.get("maskingStrategy", "full")
                        )
                        return {
                            "strategy": rule.get("maskingStrategy", "full"),
                            "level": rule.get("sensitivityLevel", "high")
                        }
                elif pattern_value.lower() in column_lower:
                    logger.info(
                        "🔍 [DEBUG] Column matched PATTERN-BASED rule (keyword)",
                        column=column_name,
                        rule_id=rule.get("id"),
                        pattern_value=pattern_value,
                        strategy=rule.get("maskingStrategy", "full")
                    )
                    return {
                        "strategy": rule.get("maskingStrategy", "full"),
                        "level": rule.get("sensitivityLevel", "high")
                    }

        # PRIORITY 3: Check common sensitive keywords (fallback)
        sensitive_keywords = [
            "password", "passwd", "pwd", "secret", "token", "key",
            "ssn", "social_security", "credit_card", "cvv", "cvc",
            "auth", "credential", "private", "api_key"
        ]

        for keyword in sensitive_keywords:
            if keyword in column_lower:
                logger.info(
                    "🔍 [DEBUG] Column matched KEYWORD-BASED rule (fallback)",
                    column=column_name,
                    matched_keyword=keyword,
                    strategy="full"
                )
                return {"strategy": "full", "level": "critical"}

        logger.debug(
            "🔍 [DEBUG] No masking rule matched for column",
            column=column_name
        )
        return None
    
    def _check_value_patterns(self, value: Any) -> Any:
        if value is None:
            return None
        
        str_value = str(value)
        
        for pattern_name, pattern in self.VALUE_PATTERNS.items():
            if re.match(pattern, str_value):
                logger.debug(f"Sensitive value pattern detected: {pattern_name}")
                return self._apply_masking(value, "full", "high")
        
        return value
    
    def _apply_masking(
        self,
        value: Any,
        strategy: str,
        level: str
    ) -> Any:
        if value is None:
            return None
        
        str_value = str(value)
        
        if strategy == "full":
            return "***REDACTED***"
        
        elif strategy == "partial":
            if len(str_value) <= 4:
                return "****"
            
            if "@" in str_value:
                parts = str_value.split("@")
                masked_local = parts[0][:2] + "***"
                return f"{masked_local}@{parts[1]}"
            
            visible_chars = min(4, len(str_value) // 4)
            return str_value[:visible_chars] + "*" * (len(str_value) - visible_chars * 2) + str_value[-visible_chars:]
        
        elif strategy == "hash":
            hash_value = hashlib.sha256(str_value.encode()).hexdigest()[:16]
            return f"HASH:{hash_value}"
        
        elif strategy == "redact":
            return "[REDACTED]"
        
        elif strategy == "tokenize":
            token = hashlib.md5(str_value.encode()).hexdigest()[:8]
            return f"TOK_{token}"
        
        else:
            return "***MASKED***"
    
    def is_field_forbidden(self, table: str, column: str) -> bool:
        for field in self.forbidden_fields:
            table_pattern = field.get("tablePattern", "")
            column_pattern = field.get("columnPattern", "")
            
            table_match = not table_pattern or re.match(
                table_pattern.replace("*", ".*"),
                table,
                re.IGNORECASE
            )
            
            column_match = not column_pattern or re.match(
                column_pattern.replace("*", ".*"),
                column,
                re.IGNORECASE
            )
            
            if table_match and column_match:
                return True
        
        return False
