from typing import List
import openai
import structlog

from services.config import settings

logger = structlog.get_logger()


class EmbeddingService:
    def __init__(self):
        self.client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model
        self.dimension = settings.embedding_dimension
    
    async def generate_embeddings(
        self, 
        texts: List[str], 
        model: str = None
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
                model=model,
                dimension=len(embeddings[0]) if embeddings else 0
            )
            
            return embeddings
            
        except Exception as e:
            logger.error("Embedding generation failed", error=str(e))
            raise
    
    async def generate_single_embedding(self, text: str, model: str = None) -> List[float]:
        embeddings = await self.generate_embeddings([text], model)
        return embeddings[0] if embeddings else []
