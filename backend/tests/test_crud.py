from tests.conftest import add

API = "/api/v1"


def test_project_crud(client):
    r = client.post(f"{API}/projects", json={"name": "Alpha", "description": "d"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.get(f"{API}/projects/{pid}").json()["name"] == "Alpha"
    assert [p["id"] for p in client.get(f"{API}/projects").json()] == [pid]
    r = client.patch(f"{API}/projects/{pid}", json={"name": "Beta"})
    assert r.json() == {"id": pid, "name": "Beta", "description": "d"}
    assert client.delete(f"{API}/projects/{pid}").status_code == 204
    assert client.get(f"{API}/projects/{pid}").status_code == 404


def test_project_validation(client):
    assert client.post(f"{API}/projects", json={"name": ""}).status_code == 422
    assert client.post(f"{API}/projects", json={}).status_code == 422


def test_module_crud(client):
    pid = client.post(f"{API}/projects", json={"name": "P"}).json()["id"]
    r = client.post(f"{API}/projects/{pid}/modules", json={"name": "Mod"})
    assert r.status_code == 201 and r.json()["project_id"] == pid
    mid = r.json()["id"]
    assert len(client.get(f"{API}/projects/{pid}/modules").json()) == 1
    assert client.patch(f"{API}/modules/{mid}", json={"description": "x"}).json()["description"] == "x"
    assert client.delete(f"{API}/modules/{mid}").status_code == 204
    assert client.get(f"{API}/modules/{mid}").status_code == 404
    assert client.post(f"{API}/projects/999/modules", json={"name": "x"}).status_code == 404


def test_object_crud(client, module):
    r = client.post(f"{API}/modules/{module['id']}/objects", json={"heading": "H", "text": "T"})
    assert r.status_code == 201
    o = r.json()
    assert (o["parent_id"], o["position"], o["heading"], o["text"]) == (None, 0, "H", "T")
    assert client.get(f"{API}/objects/{o['id']}").json() == o
    r = client.patch(f"{API}/objects/{o['id']}", json={"text": "T2"})
    assert r.json()["text"] == "T2" and r.json()["heading"] == "H"
    assert client.delete(f"{API}/objects/{o['id']}").status_code == 204
    assert client.get(f"{API}/objects/{o['id']}").status_code == 404


def test_cascade_delete(client, module):
    a = add(client, module, "A")
    b = add(client, module, "B", parent=a["id"])
    assert client.delete(f"{API}/projects/{module['project_id']}").status_code == 204
    assert client.get(f"{API}/objects/{a['id']}").status_code == 404
    assert client.get(f"{API}/objects/{b['id']}").status_code == 404
