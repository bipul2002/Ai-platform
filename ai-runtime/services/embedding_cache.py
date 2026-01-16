"""
Embedding Cache Service

Provides in-memory caching of schema embeddings with TTL.
Reduces API calls by reusing pre-computed embeddings from database.
"""

import time
from typing import Dict, Any, Optional
import structlog

logger = structlog.get_logger()


class EmbeddingCache:
    """
    In-memory cache for schema embeddings with configurable TTL.
    
    Cache structure:
    {
        agent_id: {
            "data": {
                "tables": {table_name: {"embedding": [...], "content": "..."}},
                "columns": {table.column: {"embedding": [...], "content": "..."}}
            },
            "timestamp": float
        }
    }
    """
    
    def __init__(self, ttl_hours: int = 24):
        """
        Args:
            ttl_hours: Time-to-live in hours (default: 24)
        """
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.ttl_seconds = ttl_hours * 3600
        logger.info("EmbeddingCache initialized", ttl_hours=ttl_hours)
    
    async def get_schema_embeddings(
        self, 
        agent_id: str, 
        system_db
    ) -> Dict[str, Any]:
        """
        Get schema embeddings for an agent (cached or from DB).
        
        Args:
            agent_id: Agent ID
            system_db: SystemDBService instance
            
        Returns:
            {
                "tables": {table_name: {"embedding": [...], "content": "..."}},
                "columns": {table.column: {"embedding": [...], "content": "..."}}
            }
        """
        # Check cache first
        if agent_id in self.cache:
            cache_entry = self.cache[agent_id]
            age_seconds = time.time() - cache_entry["timestamp"]
            
            if age_seconds < self.ttl_seconds:
                logger.info(
                    "Embedding cache hit",
                    agent_id=agent_id,
                    age_seconds=int(age_seconds),
                    tables_count=len(cache_entry["data"]["tables"]),
                    columns_count=len(cache_entry["data"]["columns"])
                )
                return cache_entry["data"]
            else:
                logger.info(
                    "Embedding cache expired",
                    agent_id=agent_id,
                    age_seconds=int(age_seconds)
                )
        
        # Cache miss - fetch from database
        logger.info("Embedding cache miss - fetching from database", agent_id=agent_id)
        embeddings = await system_db.get_schema_embeddings(agent_id)
        
        # Cache it
        self.cache[agent_id] = {
            "data": embeddings,
            "timestamp": time.time()
        }
        
        logger.info(
            "Embeddings cached",
            agent_id=agent_id,
            tables_count=len(embeddings["tables"]),
            columns_count=len(embeddings["columns"])
        )
        
        return embeddings
    
    def invalidate(self, agent_id: str):
        """
        Invalidate cache for a specific agent.
        Call this when schema is updated.
        
        Args:
            agent_id: Agent ID to invalidate
        """
        if agent_id in self.cache:
            del self.cache[agent_id]
            logger.info("Embedding cache invalidated", agent_id=agent_id)
    
    def clear_all(self):
        """Clear entire cache"""
        self.cache.clear()
        logger.info("Embedding cache cleared")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        stats = {
            "cached_agents": len(self.cache),
            "agents": []
        }
        
        current_time = time.time()
        for agent_id, entry in self.cache.items():
            age_seconds = current_time - entry["timestamp"]
            stats["agents"].append({
                "agent_id": agent_id,
                "age_seconds": int(age_seconds),
                "tables_count": len(entry["data"]["tables"]),
                "columns_count": len(entry["data"]["columns"])
            })
        
        return stats


# Global singleton instance
embedding_cache = EmbeddingCache(ttl_hours=24)
