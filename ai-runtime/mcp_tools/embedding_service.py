from typing import List, Dict, Any, Optional
import asyncpg
import openai
import structlog

from services.config import settings

logger = structlog.get_logger()


class EmbeddingMCPService:
    def __init__(self):
        self.client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model
        self.dimension = settings.embedding_dimension
        self.pgvector_url = settings.pgvector_url
    
    async def generate_embeddings(
        self,
        texts: List[str],
        model: Optional[str] = None
    ) -> List[List[float]]:
        if not texts:
            return []
        
        model = model or self.model
        
        try:
            texts = [t[:8000] for t in texts]
            
            response = await self.client.embeddings.create(
                model=model,
                input=texts,
                encoding_format="float"
            )
            
            embeddings = [item.embedding for item in response.data]
            
            logger.info(
                "Generated embeddings",
                count=len(texts),
                model=model
            )
            
            return embeddings
            
        except Exception as e:
            logger.error("Embedding generation failed", error=str(e))
            raise
    
    async def store_embeddings(
        self,
        agent_id: str,
        embeddings_data: List[Dict[str, Any]]
    ) -> int:
        conn = await asyncpg.connect(self.pgvector_url)
        
        try:
            await conn.execute("""
                DELETE FROM agent_schema_embeddings
                WHERE agent_id = $1
            """, agent_id)
            
            count = 0
            for item in embeddings_data:
                vector_str = f"[{','.join(map(str, item['embedding']))}]"
                
                await conn.execute("""
                    INSERT INTO agent_schema_embeddings 
                    (agent_id, target_type, target_id, embedding_text, embedding_vector, embedding_model, metadata)
                    VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
                """, 
                    agent_id,
                    item["target_type"],
                    item["target_id"],
                    item["text"],
                    vector_str,
                    self.model,
                    item.get("metadata", {})
                )
                count += 1
            
            logger.info("Stored embeddings", agent_id=agent_id, count=count)
            return count
            
        finally:
            await conn.close()
    
    async def search_similar(
        self,
        agent_id: str,
        query_embedding: List[float],
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        conn = await asyncpg.connect(self.pgvector_url)
        
        try:
            vector_str = f"[{','.join(map(str, query_embedding))}]"
            
            results = await conn.fetch("""
                SELECT 
                    id,
                    target_type,
                    target_id,
                    embedding_text,
                    metadata,
                    1 - (embedding_vector <=> $1::vector) as similarity
                FROM agent_schema_embeddings
                WHERE agent_id = $2
                ORDER BY embedding_vector <=> $1::vector
                LIMIT $3
            """, vector_str, agent_id, limit)
            
            return [
                {
                    "id": str(r["id"]),
                    "target_type": r["target_type"],
                    "target_id": str(r["target_id"]),
                    "text": r["embedding_text"],
                    "metadata": r["metadata"],
                    "similarity": float(r["similarity"])
                }
                for r in results
            ]
            
        finally:
            await conn.close()
    
    async def search_by_text(
        self,
        agent_id: str,
        query_text: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        embeddings = await self.generate_embeddings([query_text])
        
        if not embeddings:
            return []
        
        return await self.search_similar(agent_id, embeddings[0], limit)
