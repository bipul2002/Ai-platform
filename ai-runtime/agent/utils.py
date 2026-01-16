import json
from typing import Any, Dict, List, Optional
import structlog

logger = structlog.get_logger()

def parse_json_content(content: str) -> Optional[Dict[str, Any]]:
    """Robustly parse JSON from LLM response strings"""
    if not content:
        return None
    
    # Try direct parse
    try:
        return json.loads(content)
    except:
        pass
    
    # Try extracting from code blocks
    try:
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        return json.loads(content)
    except Exception as e:
        logger.warning("Failed to parse JSON content", error=str(e), partial_content=content[:100])
        return None

def make_json_serializable(obj: Any) -> Any:
    """Helper to convert objects like UUIDs or datetimes to JSON serializable formats"""
    from uuid import UUID
    from datetime import datetime, date
    from decimal import Decimal

    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: make_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [make_json_serializable(i) for i in obj]
    return obj

def format_chat_history(history: List[Dict[str, Any]]) -> str:
    """Format chat history for LLM context"""
    if not history:
        return "No previous context."
        
    formatted = []
    for msg in history:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        
        # If assistant message is empty (common for table results in this platform), 
        # try to show the SQL from metadata to give context
        if role == "assistant" and not content:
            metadata = msg.get("metadata", {}) or {}
            sql = metadata.get("sql")
            if sql:
                content = f"[Executed SQL Query: {sql}]"
        
        formatted.append(f"{role.upper()}: {content}")
        
    return "\n".join(formatted)
