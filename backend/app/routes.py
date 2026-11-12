from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import models as m
from . import schemas as s
from .database import get_db

router = APIRouter(prefix="/api/v1")


def _get(db: Session, model, id_: int):
    obj = db.get(model, id_)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} {id_} not found")
    return obj


# ---------------------------------------------------------------- projects
@router.post("/projects", response_model=s.ProjectOut, status_code=201)
def create_project(body: s.ProjectIn, db: Session = Depends(get_db)):
    p = m.Project(**body.model_dump())
    db.add(p)
    db.commit()
    return p


@router.get("/projects", response_model=list[s.ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.scalars(select(m.Project).order_by(m.Project.id)).all()


@router.get("/projects/{project_id}", response_model=s.ProjectOut)
def read_project(project_id: int, db: Session = Depends(get_db)):
    return _get(db, m.Project, project_id)


@router.patch("/projects/{project_id}", response_model=s.ProjectOut)
def update_project(project_id: int, body: s.ProjectUpdate, db: Session = Depends(get_db)):
    p = _get(db, m.Project, project_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    return p


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, m.Project, project_id))
    db.commit()
    return Response(status_code=204)


# ----------------------------------------------------------------- modules
@router.post("/projects/{project_id}/modules", response_model=s.ModuleOut, status_code=201)
def create_module(project_id: int, body: s.ModuleIn, db: Session = Depends(get_db)):
    _get(db, m.Project, project_id)
    mod = m.Module(project_id=project_id, **body.model_dump())
    db.add(mod)
    db.commit()
    return mod


@router.get("/projects/{project_id}/modules", response_model=list[s.ModuleOut])
def list_modules(project_id: int, db: Session = Depends(get_db)):
    _get(db, m.Project, project_id)
    return db.scalars(select(m.Module).where(m.Module.project_id == project_id).order_by(m.Module.id)).all()


@router.get("/modules/{module_id}", response_model=s.ModuleOut)
def read_module(module_id: int, db: Session = Depends(get_db)):
    return _get(db, m.Module, module_id)


@router.patch("/modules/{module_id}", response_model=s.ModuleOut)
def update_module(module_id: int, body: s.ModuleUpdate, db: Session = Depends(get_db)):
    mod = _get(db, m.Module, module_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(mod, k, v)
    db.commit()
    return mod


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(module_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, m.Module, module_id))
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ objects
def _siblings_filter(module_id: int, parent_id: int | None):
    cond = [m.Object.module_id == module_id]
    cond.append(m.Object.parent_id.is_(None) if parent_id is None else m.Object.parent_id == parent_id)
    return cond


def _sibling_count(db: Session, module_id: int, parent_id: int | None) -> int:
    return len(db.scalars(select(m.Object.id).where(*_siblings_filter(module_id, parent_id))).all())


def _check_parent(db: Session, module_id: int, parent_id: int | None) -> None:
    if parent_id is None:
        return
    parent = db.get(m.Object, parent_id)
    if parent is None or parent.module_id != module_id:
        raise HTTPException(422, "parent_id must reference an object in the same module")


def _make_room(db: Session, module_id: int, parent_id: int | None, position: int) -> None:
    db.execute(
        update(m.Object)
        .where(*_siblings_filter(module_id, parent_id), m.Object.position >= position)
        .values(position=m.Object.position + 1)
    )


def _close_gap(db: Session, module_id: int, parent_id: int | None, position: int) -> None:
    db.execute(
        update(m.Object)
        .where(*_siblings_filter(module_id, parent_id), m.Object.position > position)
        .values(position=m.Object.position - 1)
    )


@router.post("/modules/{module_id}/objects", response_model=s.ObjectOut, status_code=201)
def create_object(module_id: int, body: s.ObjectIn, db: Session = Depends(get_db)):
    _get(db, m.Module, module_id)
    _check_parent(db, module_id, body.parent_id)
    n = _sibling_count(db, module_id, body.parent_id)
    pos = n if body.position is None else min(body.position, n)
    _make_room(db, module_id, body.parent_id, pos)
    obj = m.Object(
        module_id=module_id, parent_id=body.parent_id, position=pos, heading=body.heading, text=body.text
    )
    db.add(obj)
    db.commit()
    return obj


@router.get("/modules/{module_id}/objects", response_model=list[s.ObjectNode])
def list_objects(module_id: int, flat: bool = False, db: Session = Depends(get_db)):
    """Objects of a module as a nested, ordered tree (or a flat list with `flat=true`)."""
    _get(db, m.Module, module_id)
    rows = db.scalars(
        select(m.Object).where(m.Object.module_id == module_id).order_by(m.Object.position, m.Object.id)
    ).all()
    nodes = {r.id: s.ObjectNode.model_validate(r) for r in rows}
    if flat:
        return list(nodes.values())
    roots: list[s.ObjectNode] = []
    for r in rows:  # rows are position-ordered, so children land in order
        (roots if r.parent_id is None else nodes[r.parent_id].children).append(nodes[r.id])
    return roots


@router.get("/objects/{object_id}", response_model=s.ObjectOut)
def read_object(object_id: int, db: Session = Depends(get_db)):
    return _get(db, m.Object, object_id)


@router.patch("/objects/{object_id}", response_model=s.ObjectOut)
def update_object(object_id: int, body: s.ObjectUpdate, db: Session = Depends(get_db)):
    obj = _get(db, m.Object, object_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    return obj


@router.post("/objects/{object_id}/move", response_model=s.ObjectOut)
def move_object(object_id: int, body: s.ObjectMove, db: Session = Depends(get_db)):
    """Re-parent and/or reorder an object (within its module). Omitted position = append."""
    obj = _get(db, m.Object, object_id)
    _check_parent(db, obj.module_id, body.parent_id)
    # cycle check: new parent must not be the object itself or one of its descendants
    cur = body.parent_id
    while cur is not None:
        if cur == obj.id:
            raise HTTPException(422, "cannot move an object under itself or its descendants")
        cur = db.scalar(select(m.Object.parent_id).where(m.Object.id == cur))

    old_parent, old_pos = obj.parent_id, obj.position
    # detach from old location
    obj.position = -1
    db.flush()
    _close_gap(db, obj.module_id, old_parent, old_pos)
    n = _count_excluding(db, obj, body.parent_id)
    pos = n if body.position is None else min(body.position, n)
    _make_room(db, obj.module_id, body.parent_id, pos)
    obj.parent_id, obj.position = body.parent_id, pos
    db.commit()
    return obj


def _count_excluding(db: Session, obj: m.Object, parent_id: int | None) -> int:
    return len(
        db.scalars(
            select(m.Object.id).where(*_siblings_filter(obj.module_id, parent_id), m.Object.id != obj.id)
        ).all()
    )


@router.delete("/objects/{object_id}", status_code=204)
def delete_object(object_id: int, db: Session = Depends(get_db)):
    """Deletes the object and its whole subtree; remaining siblings are renumbered gap-free."""
    obj = _get(db, m.Object, object_id)
    module_id, parent_id, pos = obj.module_id, obj.parent_id, obj.position
    db.delete(obj)
    db.flush()
    _close_gap(db, module_id, parent_id, pos)
    db.commit()
    return Response(status_code=204)
