-- Add 'openrouter' to the llm_provider enum
ALTER TYPE "llm_provider" ADD VALUE IF NOT EXISTS 'openrouter';
