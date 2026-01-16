from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from services.config import settings

engine = create_async_engine(
    settings.system_db_url,
    echo=False,
    future=True
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
