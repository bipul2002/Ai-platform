"""
Text processing utilities for schema metadata matching and relevance detection.
Includes stemming and lemmatization for better keyword matching.
"""
import re
from typing import List, Set, Dict, Any
import structlog

# Download NLTK data on first import (will only download once)
try:
    import nltk
    try:
        nltk.data.find('corpora/wordnet')
    except LookupError:
        nltk.download('wordnet', quiet=True)
        nltk.download('omw-1.4', quiet=True)

    from nltk.stem import WordNetLemmatizer
    lemmatizer = WordNetLemmatizer()
    NLTK_AVAILABLE = True
except (ImportError, Exception):
    NLTK_AVAILABLE = False
    lemmatizer = None

logger = structlog.get_logger()


def normalize_text(text: str) -> str:
    """
    Normalize text for matching: lowercase, remove special chars, keep alphanumeric.
    """
    return re.sub(r'[^a-z0-9\s]', '', text.lower())


def extract_keywords(text: str) -> Set[str]:
    """
    Extract keywords from text with lemmatization.
    Returns set of normalized keywords.
    """
    normalized = normalize_text(text)
    words = normalized.split()

    if NLTK_AVAILABLE and lemmatizer:
        # Lemmatize words (converts "users" -> "user", "querying" -> "query")
        keywords = {lemmatizer.lemmatize(word) for word in words if len(word) > 2}
    else:
        # Fallback: just use the words as-is
        keywords = {word for word in words if len(word) > 2}

    return keywords


def calculate_relevance_score(query_keywords: Set[str], target_text: str) -> float:
    """
    Calculate relevance score between query keywords and target text.
    Returns float between 0.0 and 1.0.
    """
    target_keywords = extract_keywords(target_text)

    if not query_keywords or not target_keywords:
        return 0.0

    # Calculate Jaccard similarity
    intersection = query_keywords.intersection(target_keywords)
    union = query_keywords.union(target_keywords)

    if not union:
        return 0.0

    return len(intersection) / len(union)


def find_relevant_items(
    query_text: str,
    items: List[Dict[str, str]],
    name_key: str = 'name',
    description_keys: List[str] = None,
    threshold: float = 0.1
) -> List[Dict[str, Any]]:
    """
    Find relevant items from a list based on query text.

    Args:
        query_text: User query text
        items: List of items to search (e.g., tables, columns)
        name_key: Key for item name (e.g., 'name', 'tableName')
        description_keys: Keys to search in descriptions (e.g., ['description', 'semanticHints'])
        threshold: Minimum relevance score (0.0-1.0)

    Returns:
        List of items with relevance scores, sorted by score descending
    """
    if description_keys is None:
        description_keys = ['description', 'semanticHints', 'customPrompt']

    query_keywords = extract_keywords(query_text)
    results = []

    for item in items:
        # Build searchable text from item
        searchable_parts = [item.get(name_key, '')]
        for key in description_keys:
            value = item.get(key)
            if value:
                searchable_parts.append(value)

        searchable_text = ' '.join(searchable_parts)
        score = calculate_relevance_score(query_keywords, searchable_text)

        if score >= threshold:
            results.append({
                'item': item,
                'score': score
            })

    # Sort by score descending
    results.sort(key=lambda x: x['score'], reverse=True)
    return results


def is_keyword_match(query_text: str, target_text: str) -> bool:
    """
    Check if any keyword from query appears in target text (with lemmatization).
    Useful for quick relevance checks.
    """
    query_keywords = extract_keywords(query_text)
    target_keywords = extract_keywords(target_text)

    return bool(query_keywords.intersection(target_keywords))
