-- Manual migration to add pgvector index and search function
-- These depend on the agent_schema_embeddings table being created first

-- Create index on embeddings if not exists
-- Note: ivfflat is used here, which is standard for pgvector
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_schema_embeddings_vector'
    ) THEN
        CREATE INDEX idx_schema_embeddings_vector ON agent_schema_embeddings 
        USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);
    END IF;
END $$;

--> statement-breakpoint

-- Function to perform vector similarity search
CREATE OR REPLACE FUNCTION search_similar_embeddings(
    p_agent_id UUID,
    p_query_vector vector(1536),
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    target_type VARCHAR,
    target_id UUID,
    embedding_text TEXT,
    metadata JSONB,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.target_type,
        e.target_id,
        e.embedding_text,
        e.metadata,
        1 - (e.embedding_vector <=> p_query_vector) as similarity
    FROM agent_schema_embeddings e
    WHERE e.agent_id = p_agent_id
    ORDER BY e.embedding_vector <=> p_query_vector
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
