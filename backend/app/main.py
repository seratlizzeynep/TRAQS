from fastapi import FastAPI

from . import models  # noqa: F401  (register tables)
from .database import Base, engine
from .routes import router

Base.metadata.create_all(engine)

app = FastAPI(title="TRAQS API", version="1.0.0")
app.include_router(router)
