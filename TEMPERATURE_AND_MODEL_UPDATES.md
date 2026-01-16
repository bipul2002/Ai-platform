# Temperature Field and Model List Updates

## Summary

Added temperature field (0-1 range) to the Advanced tab of Agent Create/Edit screens and updated the model dropdown to include all current OpenAI and Claude models.

## Changes Made

### 1. Frontend - Agent Detail Page (`/frontend/src/pages/admin/AgentDetailPage.tsx`)

#### Added Temperature Field to Interface
```typescript
interface AgentForm {
  // ... existing fields
  llmTemperature: number
}
```

#### Updated Model Lists
Added latest models for both OpenAI and Anthropic:

**OpenAI Models:**
- gpt-4o (NEW)
- gpt-4o-mini (NEW)
- gpt-4-turbo (NEW)
- gpt-4-turbo-preview
- gpt-4
- gpt-4-0125-preview
- gpt-3.5-turbo
- gpt-3.5-turbo-16k
- o1-preview (NEW)
- o1-mini (NEW)

**Anthropic Models:**
- claude-3-5-sonnet-20241022
- claude-3-5-haiku-20241022 (NEW)
- claude-3-opus-20240229
- claude-3-sonnet-20240229
- claude-3-haiku-20240307

#### Added Temperature Input Field to Advanced Tab
Located in the LLM Configuration section, the temperature field includes:
- Number input with step 0.1, min 0, max 1
- Label: "Temperature (0-1)" with helper text "Controls randomness in responses"
- Validation: min 0, max 1
- Description: "0 = More deterministic, 1 = More creative"
- Default value: 0

#### Updated Form Defaults
- Added `llmTemperature: 0` to defaultValues
- Added `llmTemperature: agentData.llmTemperature || 0` to values mapping
- Removed hardcoded `llmTemperature: 0` override in onSubmit (now uses form value)

### 2. AI Runtime - LLM Module (`/ai-runtime/agent/llm.py`)

Updated model lists to match frontend:

**OPENAI_MODELS:**
- Added: gpt-4o, gpt-4o-mini, gpt-4-turbo, o1-preview, o1-mini

**ANTHROPIC_MODELS:**
- Added: claude-3-5-haiku-20241022

### 3. Backend Verification

**Already Implemented:**
- ✅ Schema field exists: `llmTemperature: decimal('llm_temperature', { precision: 3, scale: 2 }).default('0.00')`
- ✅ DTO validation exists: `@Min(0) @Max(2)` with proper decorators
- ✅ Temperature is passed to LLM initialization in nodes.py: `temperature=agent_config.get('llmTemperature', 0.0)`
- ✅ LLM objects (ChatOpenAI, ChatAnthropic) receive temperature parameter

## Data Flow

1. **User Input**: User sets temperature in Advanced tab (0-1 range)
2. **Frontend**: Form validates and sends to backend via create/update API
3. **Backend**: NestJS validates (0-2 range) and stores in PostgreSQL as decimal(3,2)
4. **AI Runtime**: Retrieves agent config and passes temperature to LLM initialization
5. **LLM**: ChatOpenAI or ChatAnthropic uses temperature for all query generations

## Temperature Behavior

- **0.0**: Deterministic, consistent responses (recommended for SQL generation)
- **0.5**: Balanced creativity and consistency
- **1.0**: Maximum creativity and randomness (may reduce accuracy for structured queries)

## UI Location

**Path**: Edit Agent → Advanced Tab → LLM Configuration

**Layout**:
```
┌─────────────────────────────────────────────────┐
│ LLM Configuration                               │
├─────────────────────────────────────────────────┤
│ LLM Provider: [OpenAI ▼]    Model: [gpt-4o ▼] │
│                                                 │
│ Temperature (0-1)                               │
│ Controls randomness in responses                │
│ [0.0                                          ] │
│ 0 = More deterministic, 1 = More creative      │
└─────────────────────────────────────────────────┘
```

## Testing Checklist

- [ ] Create new agent with temperature 0.5
- [ ] Edit existing agent and change temperature from 0 to 0.7
- [ ] Verify temperature is displayed correctly when editing
- [ ] Verify temperature validation (cannot set < 0 or > 1)
- [ ] Test model dropdown shows all new models for OpenAI
- [ ] Test model dropdown shows all new models for Anthropic
- [ ] Switch between OpenAI and Anthropic to verify correct models appear
- [ ] Execute query and verify LLM uses configured temperature
- [ ] Check logs to confirm temperature is passed to LLM initialization

## Files Modified

1. `/frontend/src/pages/admin/AgentDetailPage.tsx`
   - Added llmTemperature to interface
   - Updated LLM_MODELS constant
   - Added temperature field to form
   - Updated form defaults and values mapping

2. `/ai-runtime/agent/llm.py`
   - Updated OPENAI_MODELS list
   - Updated ANTHROPIC_MODELS list

## Files Verified (No Changes Needed)

1. `/admin-backend/src/db/schema/core.schema.ts` - Schema already has llmTemperature field
2. `/admin-backend/src/modules/agents/dto/create-agent.dto.ts` - DTO already has validation
3. `/ai-runtime/agent/nodes.py` - Already passes temperature to LLM
4. `/ai-runtime/db/models.py` - Already maps llmTemperature field

## Notes

- Backend validation allows 0-2 range (following OpenAI spec) but UI restricts to 0-1 for safety
- Temperature is stored as decimal(3,2) allowing values like 0.00, 0.50, 1.00
- Default temperature remains 0.0 for deterministic SQL generation
- New models added align with latest releases as of December 2024
