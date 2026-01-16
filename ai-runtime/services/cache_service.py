import redis.asyncio as redis
import json
import hashlib
from typing import Optional, Dict, Any, List
import structlog
from services.config import settings

logger = structlog.get_logger()

class CacheService:
    """
    Redis caching service for schema metadata and embeddings.
    Reduces database load and improves query performance.
    """
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.enabled = settings.REDIS_ENABLED
        self.ttl = settings.CACHE_TTL_SECONDS  # Default: 1 hour
        
    async def connect(self):
        """Initialize Redis connection"""
        if not self.enabled:
            logger.info("Redis caching disabled")
            return
            
        try:
            self.redis_client = await redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True
            )
            await self.redis_client.ping()
            logger.info("Redis cache connected", url=settings.REDIS_URL)
        except Exception as e:
            logger.warning("Redis connection failed, caching disabled", error=str(e))
            self.enabled = False
            self.redis_client = None
    
    async def close(self):
        """Close Redis connection"""
        if self.redis_client:
            await self.redis_client.close()
            logger.info("Redis cache disconnected")
    
    def _make_key(self, prefix: str, identifier: str) -> str:
        """Generate cache key"""
        return f"{prefix}:{identifier}"
    
    async def get_schema(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get cached schema metadata"""
        if not self.enabled or not self.redis_client:
            return None
            
        try:
            key = self._make_key("schema", agent_id)
            cached = await self.redis_client.get(key)
            if cached:
                logger.info("Schema cache hit", agent_id=agent_id)
                return json.loads(cached)
            logger.debug("Schema cache miss", agent_id=agent_id)
            return None
        except Exception as e:
            logger.warning("Schema cache get failed", error=str(e))
            return None
    
    async def set_schema(self, agent_id: str, schema: Dict[str, Any], ttl: Optional[int] = None):
        """Cache schema metadata"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("schema", agent_id)
            await self.redis_client.setex(
                key,
                ttl or self.ttl,
                json.dumps(schema)
            )
            logger.info("Schema cached", agent_id=agent_id, ttl=ttl or self.ttl)
        except Exception as e:
            logger.warning("Schema cache set failed", error=str(e))
    
    async def invalidate_schema(self, agent_id: str):
        """Invalidate schema cache"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("schema", agent_id)
            await self.redis_client.delete(key)
            logger.info("Schema cache invalidated", agent_id=agent_id)
        except Exception as e:
            logger.warning("Schema cache invalidation failed", error=str(e))
    
    async def get_embedding_search(self, agent_id: str, query: str, limit: int) -> Optional[List[Dict]]:
        """Get cached embedding search results"""
        if not self.enabled or not self.redis_client:
            return None
            
        try:
            # Create hash of query for cache key
            query_hash = hashlib.md5(query.encode()).hexdigest()
            key = self._make_key(f"embeddings:{agent_id}", f"{query_hash}:{limit}")
            cached = await self.redis_client.get(key)
            if cached:
                logger.info("Embedding search cache hit", agent_id=agent_id, query_hash=query_hash)
                return json.loads(cached)
            logger.debug("Embedding search cache miss", agent_id=agent_id)
            return None
        except Exception as e:
            logger.warning("Embedding search cache get failed", error=str(e))
            return None
    
    async def set_embedding_search(
        self, 
        agent_id: str, 
        query: str, 
        limit: int, 
        results: List[Dict],
        ttl: Optional[int] = None
    ):
        """Cache embedding search results"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            query_hash = hashlib.md5(query.encode()).hexdigest()
            key = self._make_key(f"embeddings:{agent_id}", f"{query_hash}:{limit}")
            # Shorter TTL for embedding searches (5 minutes)
            search_ttl = ttl or 300
            await self.redis_client.setex(
                key,
                search_ttl,
                json.dumps(results)
            )
            logger.info("Embedding search cached", agent_id=agent_id, ttl=search_ttl)
        except Exception as e:
            logger.warning("Embedding search cache set failed", error=str(e))
    
    async def get_agent_config(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get cached agent configuration"""
        if not self.enabled or not self.redis_client:
            return None
            
        try:
            key = self._make_key("agent_config", agent_id)
            cached = await self.redis_client.get(key)
            if cached:
                logger.info("Agent config cache hit", agent_id=agent_id)
                return json.loads(cached)
            return None
        except Exception as e:
            logger.warning("Agent config cache get failed", error=str(e))
            return None
    
    async def set_agent_config(self, agent_id: str, config: Dict[str, Any], ttl: Optional[int] = None):
        """Cache agent configuration"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("agent_config", agent_id)
            await self.redis_client.setex(
                key,
                ttl or self.ttl,
                json.dumps(config)
            )
            logger.info("Agent config cached", agent_id=agent_id)
        except Exception as e:
            logger.warning("Agent config cache set failed", error=str(e))
    
    async def invalidate_agent(self, agent_id: str):
        """Invalidate all caches for an agent"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            # Delete schema, config, and all embedding searches
            pattern = f"*:{agent_id}*"
            keys = []
            async for key in self.redis_client.scan_iter(match=pattern):
                keys.append(key)
            
            if keys:
                await self.redis_client.delete(*keys)
                logger.info("Agent caches invalidated", agent_id=agent_id, keys_deleted=len(keys))
        except Exception as e:
            logger.warning("Agent cache invalidation failed", error=str(e))

    async def get_agent_sensitivity(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get cached agent sensitivity rules"""
        if not self.enabled or not self.redis_client:
            return None
            
        try:
            key = self._make_key("sensitivity", agent_id)
            cached = await self.redis_client.get(key)
            if cached:
                logger.debug("Sensitivity cache hit", agent_id=agent_id)
                return json.loads(cached)
            return None
        except Exception as e:
            logger.warning("Sensitivity cache get failed", error=str(e))
            return None

    async def set_agent_sensitivity(self, agent_id: str, rules: Dict[str, Any], ttl: Optional[int] = None):
        """Cache agent sensitivity rules"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("sensitivity", agent_id)
            await self.redis_client.setex(
                key,
                ttl or self.ttl,
                json.dumps(rules)
            )
            logger.debug("Sensitivity cached", agent_id=agent_id)
        except Exception as e:
            logger.warning("Sensitivity cache set failed", error=str(e))

    async def get_connection_details(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get cached connection details"""
        if not self.enabled or not self.redis_client:
            return None
            
        try:
            key = self._make_key("connection", agent_id)
            cached = await self.redis_client.get(key)
            if cached:
                logger.debug("Connection details cache hit", agent_id=agent_id)
                return json.loads(cached)
            return None
        except Exception as e:
            logger.warning("Connection details cache get failed", error=str(e))
            return None

    async def set_connection_details(self, agent_id: str, details: Dict[str, Any], ttl: Optional[int] = None):
        """Cache connection details"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("connection", agent_id)
            await self.redis_client.setex(
                key,
                ttl or 300, # 5 minutes default for credentials
                json.dumps(details)
            )
            logger.debug("Connection details cached", agent_id=agent_id)
        except Exception as e:
            logger.warning("Connection details cache set failed", error=str(e))




    async def get_connection_details(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get cached connection details"""
        if not self.enabled or not self.redis_client:
            return None
            
        try:
            key = self._make_key("connection", agent_id)
            cached = await self.redis_client.get(key)
            if cached:
                logger.info("Connection details cache hit", agent_id=agent_id)
                return json.loads(cached)
            logger.debug("Connection details cache miss", agent_id=agent_id)
            return None
        except Exception as e:
            logger.warning("Connection details cache get failed", error=str(e))
            return None

    async def set_connection_details(self, agent_id: str, details: Dict[str, Any], ttl: Optional[int] = None):
        """Cache connection details"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("connection", agent_id)
            await self.redis_client.setex(
                key,
                ttl or self.ttl,
                json.dumps(details)
            )
            logger.info("Connection details cached", agent_id=agent_id)
        except Exception as e:
            logger.warning("Connection details cache set failed", error=str(e))
    
    async def invalidate_connection_details(self, agent_id: str):
        """Invalidate connection details cache"""
        if not self.enabled or not self.redis_client:
            return
            
        try:
            key = self._make_key("connection", agent_id)
            await self.redis_client.delete(key)
            logger.info("Connection details cache invalidated", agent_id=agent_id)
        except Exception as e:
            logger.warning("Connection details cache invalidation failed", error=str(e))


# Global cache instance
cache_service = CacheService()
