import os

os.environ["TRAQS_DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    return TestClient(app)


@pytest.fixture()
def module(client):
    pid = client.post("/api/v1/projects", json={"name": "P"}).json()["id"]
    return client.post(f"/api/v1/projects/{pid}/modules", json={"name": "M"}).json()


def add(client, module, heading, parent=None, position=None):
    body = {"heading": heading, "parent_id": parent, "position": position}
    r = client.post(f"/api/v1/modules/{module['id']}/objects", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def tree(client, module):
    def shape(nodes):
        return [(n["heading"], shape(n["children"])) if n["children"] else n["heading"] for n in nodes]

    return shape(client.get(f"/api/v1/modules/{module['id']}/objects").json())
