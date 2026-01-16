"""
Dynamic prompt builder functions.
"""

from agent.prompts.common import COMMON_PROMPT_SECTIONS
from agent.prompts.mysql import (
    MYSQL_QUERY_BUILDER_PROMPT,
    MYSQL_REFINEMENT_PROMPT,
    MYSQL_SQL_CORRECTOR_PROMPT,
    MYSQL_DATE_TIME_SYNTAX,
    MYSQL_STRING_FUNCTIONS,
    MYSQL_BOOLEAN_SYNTAX,
    MYSQL_GROUP_BY_RULES
)
from agent.prompts.postgres import (
    POSTGRESQL_QUERY_BUILDER_PROMPT,
    POSTGRESQL_REFINEMENT_PROMPT,
    POSTGRESQL_SQL_CORRECTOR_PROMPT,
    POSTGRESQL_DATE_TIME_SYNTAX,
    POSTGRESQL_STRING_FUNCTIONS,
    POSTGRESQL_BOOLEAN_SYNTAX,
    POSTGRESQL_GROUP_BY_RULES
)

def build_query_builder_prompt(dialect: str, is_refinement: bool = False, is_direct_sql: bool = False) -> str:
    """
    Build Query Builder prompt dynamically based on dialect and context.
    
    Args:
        dialect: Database type ('mysql' or 'postgresql')
        is_refinement: Whether this is a refinement request
        is_direct_sql: Whether user provided direct SQL
        
    Returns:
        Complete Query Builder prompt with dialect-specific syntax and common sections
    """
    dialect_lower = dialect.lower() if dialect else "mysql"
    is_postgres = "postgres" in dialect_lower or dialect_lower == "postgresql"
    
    
    # 1. Select Base Prompt and Syntax
    if is_postgres:
        syntax = {
            "date_time_syntax": POSTGRESQL_DATE_TIME_SYNTAX,
            "string_functions": POSTGRESQL_STRING_FUNCTIONS,
            "boolean_syntax": POSTGRESQL_BOOLEAN_SYNTAX,
            "group_by_rules": POSTGRESQL_GROUP_BY_RULES
        }
        base_prompt = POSTGRESQL_REFINEMENT_PROMPT if is_refinement else POSTGRESQL_QUERY_BUILDER_PROMPT
    else:
        syntax = {
            "date_time_syntax": MYSQL_DATE_TIME_SYNTAX,
            "string_functions": MYSQL_STRING_FUNCTIONS,
            "boolean_syntax": MYSQL_BOOLEAN_SYNTAX,
            "group_by_rules": MYSQL_GROUP_BY_RULES
        }
        base_prompt = MYSQL_REFINEMENT_PROMPT if is_refinement else MYSQL_QUERY_BUILDER_PROMPT

    # 2. Format Syntax into Base Prompt (process placeholders if they exist)
    for key, value in syntax.items():
        placeholder = "{" + key + "}"
        base_prompt = base_prompt.replace(placeholder, value)
        
    # 3. Inject Dialect Name into Common Sections
    dialect_display_name = "PostgreSQL" if is_postgres else "MySQL"
    common_sections = COMMON_PROMPT_SECTIONS.replace("{{dialect}}", dialect_display_name)
    
    # 5. Combine
    return f"{base_prompt}\n{common_sections}"


def build_sql_corrector_prompt(dialect: str) -> str:
    """
    Build SQL Corrector prompt based on database dialect.
    
    Args:
        dialect: Database type ('mysql' or 'postgresql')
        
    Returns:
        Dialect-specific SQL Corrector prompt with common sections
    """
    dialect_lower = dialect.lower() if dialect else "mysql"
    is_postgres = "postgres" in dialect_lower or dialect_lower == "postgresql"
    
    # 1. Select Base Prompt
    base_prompt = POSTGRESQL_SQL_CORRECTOR_PROMPT if is_postgres else MYSQL_SQL_CORRECTOR_PROMPT
    
    # 2. Inject Dialect Name into Common Sections
    dialect_display_name = "PostgreSQL" if is_postgres else "MySQL"
    common_sections = COMMON_PROMPT_SECTIONS.replace("{{dialect}}", dialect_display_name)
    
    # 3. Combine
    return f"{base_prompt}\n{common_sections}"
