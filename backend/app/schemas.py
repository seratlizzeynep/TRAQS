from pydantic import BaseModel, ConfigDict, Field


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class ProjectOut(_Out):
    id: int
    name: str
    description: str


class ModuleIn(ProjectIn):
    pass


class ModuleUpdate(ProjectUpdate):
    pass


class ModuleOut(_Out):
    id: int
    project_id: int
    name: str
    description: str


class ObjectIn(BaseModel):
    heading: str = Field(default="", max_length=300)
    text: str = ""
    parent_id: int | None = None
    position: int | None = Field(default=None, ge=0, description="Index among siblings; omitted = append")


class ObjectUpdate(BaseModel):
    heading: str | None = Field(default=None, max_length=300)
    text: str | None = None


class ObjectMove(BaseModel):
    parent_id: int | None = None
    position: int | None = Field(default=None, ge=0)


class ObjectOut(_Out):
    id: int
    module_id: int
    parent_id: int | None
    position: int
    heading: str
    text: str


class ObjectNode(ObjectOut):
    children: list["ObjectNode"] = []
