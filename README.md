# Multi-Tenant Enterprise AI Query Platform

A production-ready, enterprise-grade AI-powered natural language to SQL query platform with multi-tenant isolation, schema-aware query generation, and comprehensive security controls.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React + Socket.IO)                       │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────────┐ │
│  │        Chat Interface         │  │         Admin Console                │ │
│  │  • Real-time streaming        │  │  • Agent management                  │ │
│  │  • Markdown rendering         │  │  • Schema explorer                   │ │
│  │  • SQL preview                │  │  • Sensitivity rules                 │ │
│  └──────────────────────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    │ WebSocket                    │ REST API
                    ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   ADMIN BACKEND (NestJS + Drizzle ORM)                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         Core Modules                                   │   │
│  │  • Agent Management        • Schema Management      • Embeddings       │   │
│  │  • Auth & RBAC            • Sensitivity Registry   • Audit Logging    │   │
│  │  • External DB Config     • Metadata Enrichment    • Connection Pool  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                              System Database                                 │
│                         (PostgreSQL + pgvector)                             │
│                                    ▲                                         │
│                                    │ (Direct Access via SQLAlchemy)          │
│                                    │                                         │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     │
┌────────────────────────────────────┴────────────────────────────────────────┐
│                    AI RUNTIME (FastAPI + LangGraph)                          │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     LangGraph Multi-Agent Pipeline                      │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │ │
│  │  │   NLU    │→ │ Schema   │→ │  Query   │→ │   SQL    │→ │   SQL    │ │ │
│  │  │  Router  │  │ Vector   │  │ Builder  │  │Generator │  │Validator │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │ │
│  │       ↓              ↓                                        ↓        │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │ │
│  │  │Guardrail │  │ Clarification│  │  Sanitizer   │  │    Response    │ │ │
│  │  │Responder │  │ Responder    │  │  Middleware  │  │    Composer    │ │ │
│  │  └──────────┘  └──────────────┘  └──────────────┘  └────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                     Connects to External Databases (MySQL/PostgreSQL)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### Multi-Tenancy
- Complete tenant isolation per agent
- Namespaced vector embeddings
- Per-agent sensitivity rules
- Isolated external database connections

### AI-Powered Query Generation
- Natural language to SQL conversion
- Schema-aware query building
- Support for PostgreSQL and MySQL dialects
- Semantic understanding via embeddings
- **Human-in-the-Loop (HITL)** ambiguity resolution
- Context-aware clarification questions

### Security & Compliance
- SQL injection prevention
- Read-only query enforcement
- Sensitive data detection and masking
- Comprehensive audit logging
- RBAC for admin operations

### Admin Capabilities
- Visual schema explorer
- Custom metadata annotations
- Sensitivity rule management
- Embedding visualization
- Real-time schema sync

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)
- Python 3.11+ (for local development)

### Running with Docker Compose

```bash
# Clone and navigate to the project
cd ai-query-platform

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Access the application
# Frontend: http://localhost:3000
# Admin Backend: http://localhost:4000
# AI Runtime: http://localhost:8000
```

### Environment Configuration

Copy the example environment files and configure:

```bash
cp admin-backend/.env.example admin-backend/.env
cp ai-runtime/.env.example ai-runtime/.env
cp frontend/.env.example frontend/.env
```

### Default Credentials

- **Super Admin**: admin@platform.local / SecureAdmin123!
- **System Database**: postgres:postgres@localhost:5432/ai_query_platform

## Project Structure

```
/ai-query-platform
├── admin-backend/          # NestJS Admin Backend
│   ├── src/
│   │   ├── modules/        # Feature modules
│   │   │   ├── agents/     # Agent CRUD
│   │   │   ├── auth/       # Authentication & RBAC
│   │   │   ├── schema/     # Schema management
│   │   │   ├── embeddings/ # Embedding orchestration
│   │   │   ├── sensitivity/# Sensitive field registry
│   │   │   ├── audit/      # Audit logging
│   │   │   └── external-db/# External DB connections
│   │   ├── config/         # Configuration
│   │   ├── common/         # Shared utilities
│   │   └── db/             # Database schemas
│   └── db/
│       └── system_schema.sql
│
├── ai-runtime/             # FastAPI AI Runtime
│   ├── mcp_tools/          # MCP Tool implementations
│   ├── workflows/          # LangGraph workflows
│   ├── agent/              # Agent Logic
│   │   ├── nodes.py        # Graph Nodes
│   │   ├── query_pipeline.py # Pipeline Orchestration
│   │   └── prompts.py      # LLM Prompts
│   ├── middleware/         # Request middleware
│   ├── services/           # Business logic services
│   │   ├── auth.py         # JWT Authentication
│   │   └── system_db.py    # System DB Access (SQLAlchemy)
│   ├── models/             # Pydantic models
│   ├── api/                # API routes
│   └── db/
│       └── pgvector_setup.sql
│
├── frontend/               # React Frontend
│   ├── src/
│   │   ├── components/     # UI Components
│   │   │   ├── chat/       # Chat interface
│   │   │   ├── admin/      # Admin console
│   │   │   ├── common/     # Shared components
│   │   │   └── layout/     # Layout components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom hooks
│   │   ├── services/       # API services
│   │   ├── store/          # State management
│   │   └── types/          # TypeScript types
│   └── public/
│
├── docker-compose.yml      # Docker Compose configuration
└── README.md               # This file
```

## API Documentation

### Admin Backend APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET/POST | List/Create agents |
| `/api/agents/:id` | GET/PUT/DELETE | Agent CRUD |
| `/api/agents/:id/config` | GET | Get agent configuration |
| `/api/agents/:id/schema` | GET/POST | Get/Refresh schema |
| `/api/agents/:id/enriched-metadata` | GET | Get enriched metadata |
| `/api/agents/:id/sensitivity` | GET/PUT | Sensitivity rules |
| `/api/agents/:id/embeddings` | GET/POST | Embedding management |
| `/api/sensitivity/global` | GET/PUT | Global sensitivity rules |
| `/api/audit` | GET | Audit log viewer |

### AI Runtime APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws` | WebSocket | Chat streaming endpoint |
| `/api/health` | GET | Health check |
| `/api/embeddings/generate` | POST | Generate embeddings |

## Configuration

### Admin Backend (.env)

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_query_platform
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRATION=24h
ENCRYPTION_KEY=32-byte-encryption-key-here
AI_RUNTIME_URL=http://ai-runtime:8000
```

### AI Runtime (.env)

```env
ADMIN_BACKEND_URL=http://admin-backend:4000
OPENAI_API_KEY=your-openai-api-key
EMBEDDING_MODEL=text-embedding-3-small
LLM_MODEL=gpt-4-turbo-preview
SYSTEM_DB_URL=postgresql://postgres:postgres@postgres:5432/ai_query_platform
JWT_SECRET=your-super-secret-jwt-key
JWT_ALGORITHM=HS256
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:8000
```

## Development

### Admin Backend

```bash
cd admin-backend
npm install
npm run db:migrate
npm run db:seed
npm run start:dev
```

### AI Runtime

```bash
cd ai-runtime
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Security Considerations

1. **SQL Injection Prevention**: All queries are validated through AST parsing
2. **Sensitive Data Masking**: PII, secrets, and configurable fields are masked
3. **Read-Only Enforcement**: Only SELECT queries are permitted
4. **Multi-Tenant Isolation**: Strict agent-based access control
5. **Encrypted Credentials**: External DB credentials are AES-256 encrypted
6. **Audit Trail**: All operations are logged for compliance

## License

MIT License - See LICENSE file for details.
