# AI Runtime Slow Startup Fix

## Problem

The ai-runtime container was taking a long time to start up. Docker showed the container as "Started" but the FastAPI app inside took additional time before becoming responsive.

## Root Cause

**NLTK Data Download at Runtime**

The issue was caused by NLTK (Natural Language Toolkit) downloading data files (`wordnet` and `omw-1.4`) during the first import of the `text_utils.py` module.

### Import Chain That Triggers the Issue:

```
main.py
  └─> api/websocket.py
        └─> agent/query_pipeline.py
              └─> agent/nodes.py
                    └─> agent/text_utils.py  ← Downloads NLTK data here!
```

When the FastAPI app starts, it imports the websocket module, which triggers this entire chain. The `text_utils.py` file contains:

```python
# Download NLTK data on first import (will only download once)
try:
    import nltk
    try:
        nltk.data.find('corpora/wordnet')
    except LookupError:
        nltk.download('wordnet', quiet=True)      # ← Slow!
        nltk.download('omw-1.4', quiet=True)      # ← Slow!
```

### Why This Causes Delays:

1. **Network Download**: NLTK downloads ~10MB of data from the internet
2. **File I/O**: Extracts and writes files to disk
3. **Every Container Start**: If the data isn't persisted in a volume, it happens on every container restart
4. **Blocking Import**: Python blocks until downloads complete before continuing startup

## Solution

**Download NLTK Data During Docker Build**

By downloading the NLTK data during the Docker image build process, it becomes baked into the image and doesn't need to be downloaded at runtime.

### Dockerfile Change

**File**: `/ai-runtime/Dockerfile`

**Before:**
```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r requirements.txt

COPY . .
```

**After:**
```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r requirements.txt

# Download NLTK data during build to avoid runtime delays
RUN python -c "import nltk; nltk.download('wordnet', quiet=True); nltk.download('omw-1.4', quiet=True)"

COPY . .
```

### How This Fixes the Issue:

1. ✅ **Build Time Download**: NLTK data is downloaded once during `docker build`
2. ✅ **Baked Into Image**: Data files are included in the Docker image layers
3. ✅ **Fast Runtime**: `nltk.data.find('corpora/wordnet')` succeeds immediately, skipping download
4. ✅ **No Network Dependency**: Container startup doesn't require internet access for NLTK
5. ✅ **Consistent Performance**: Every container starts quickly, regardless of environment

## Expected Improvement

### Before Fix:
- Container start: ~2-5 seconds
- NLTK download: ~10-30 seconds (depending on network)
- **Total startup time: ~12-35 seconds**

### After Fix:
- Container start: ~2-5 seconds
- NLTK check: <100ms (data already present)
- **Total startup time: ~2-5 seconds**

**Improvement: ~10-30 seconds faster startup** ⚡

## Testing

To verify the fix:

1. **Rebuild the Docker image:**
   ```bash
   sudo docker-compose build ai-runtime
   ```

2. **Restart the container:**
   ```bash
   sudo docker-compose up -d ai-runtime
   ```

3. **Check startup time:**
   ```bash
   sudo docker logs ai-query-ai-runtime --follow
   ```

   You should see:
   ```json
   {"event": "Starting AI Runtime Backend", "port": 8000, ...}
   ```
   Almost immediately after the container starts.

4. **Verify health check:**
   ```bash
   curl http://localhost:8000/api/health
   ```

   Should respond quickly with:
   ```json
   {"status": "healthy"}
   ```

## Additional Notes

### NLTK Usage in the Platform

NLTK is used in `/ai-runtime/agent/text_utils.py` for:
- **Lemmatization**: Converting words to their base form (e.g., "users" → "user")
- **Keyword Extraction**: Extracting meaningful keywords from user queries
- **Relevance Scoring**: Matching user queries to database schema elements

### WordNet Data Files

- **wordnet**: Lexical database of English words and their relationships
- **omw-1.4**: Open Multilingual WordNet for cross-language support
- **Total Size**: ~10MB compressed, ~25MB uncompressed
- **Location in Container**: `/root/nltk_data/corpora/`

### Alternative Solutions Considered

1. **Lazy Import**: Import text_utils only when needed
   - ❌ Still causes delay on first query
   - ❌ Inconsistent performance

2. **Persistent Volume**: Mount NLTK data directory
   - ❌ Adds complexity to deployment
   - ❌ Requires volume management

3. **Remove NLTK**: Use simpler text processing
   - ❌ Reduces query matching quality
   - ❌ Would need to rewrite text_utils

4. **Pre-download in Dockerfile** ✅ **CHOSEN**
   - ✅ Simple one-line change
   - ✅ No runtime overhead
   - ✅ No deployment complexity

## Files Modified

1. `/ai-runtime/Dockerfile` (line 14-15)
   - Added NLTK data download during build

## Files Analyzed (No Changes)

1. `/ai-runtime/agent/text_utils.py`
   - Contains NLTK download logic
   - No changes needed (download check still works)

2. `/ai-runtime/agent/nodes.py`
   - Imports text_utils
   - No changes needed

3. `/ai-runtime/api/websocket.py`
   - Triggers import chain
   - No changes needed

## Impact

- ✅ **Faster Startup**: 80-90% reduction in container startup time
- ✅ **Better UX**: Users see the platform as "ready" much faster
- ✅ **No Code Changes**: Existing Python code works without modification
- ✅ **Offline Capable**: Container can start without internet access
- ✅ **Production Ready**: Consistent startup time in all environments
