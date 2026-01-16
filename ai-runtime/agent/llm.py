from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from services.config import settings
import structlog

logger = structlog.get_logger()

# Supported models for each provider
OPENAI_MODELS = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4',
    'gpt-4-0125-preview',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
    'o1-preview',
    'o1-mini'
]

ANTHROPIC_MODELS = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307'
]

# OpenRouter models (using OpenAI-compatible API)
OPENROUTER_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'google/gemma-2-9b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen-2-7b-instruct:free',
]

# OpenRouter API base URL
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

def get_llm(
    provider: str = None,
    model: str = None,
    temperature: float = None
):
    """
    Get an LLM instance based on provider and model configuration.
    
    Args:
        provider: LLM provider ('openai' or 'anthropic')
        model: Model name
        temperature: Temperature setting (0-2)
    
    Returns:
        LLM instance (ChatOpenAI or ChatAnthropic)
    """
    # Use defaults from settings if not provided
    provider = provider or 'openai'
    model = model or settings.llm_model
    temperature = temperature if temperature is not None else 0.0
    
    logger.info(
        "Initializing LLM",
        provider=provider,
        model=model,
        temperature=temperature
    )
    
    try:
        if provider == 'openai':
            if not settings.openai_api_key:
                raise ValueError("OpenAI API key not configured")
            
            return ChatOpenAI(
                model=model,
                api_key=settings.openai_api_key,
                temperature=temperature
            )
        
        elif provider == 'anthropic':
            if not settings.anthropic_api_key:
                raise ValueError("Anthropic API key not configured")
            
            return ChatAnthropic(
                model=model,
                api_key=settings.anthropic_api_key,
                temperature=temperature
            )
        
        elif provider == 'openrouter':
            if not settings.openrouter_api_key:
                raise ValueError("OpenRouter API key not configured")
            
            # OpenRouter uses OpenAI-compatible API
            return ChatOpenAI(
                model=model,
                api_key=settings.openrouter_api_key,
                base_url=OPENROUTER_BASE_URL,
                temperature=temperature,
                default_headers={
                    "HTTP-Referer": "https://ai-platform.local",
                    "X-Title": "AI Platform"
                }
            )
        
        else:
            logger.error("Unsupported LLM provider", provider=provider)
            raise ValueError(f"Unsupported LLM provider: {provider}")
    
    except Exception as e:
        logger.error("Failed to initialize LLM", error=str(e), provider=provider, model=model)
        # Fallback to default OpenAI model
        logger.warning("Falling back to default OpenAI model")
        return ChatOpenAI(
            model=settings.llm_model,
            api_key=settings.openai_api_key,
            temperature=0
        )
