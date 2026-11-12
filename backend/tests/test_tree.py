from tests.conftest import add, tree

API = "/api/v1"


def test_append_order_and_nesting(client, module):
    a = add(client, module, "A")
    add(client, module, "B")
    add(client, module, "A.1", parent=a["id"])
    add(client, module, "A.2", parent=a["id"])
    assert tree(client, module) == [("A", ["A.1", "A.2"]), "B"]


def test_insert_at_position_shifts_siblings(client, module):
    add(client, module, "A")
    add(client, module, "B")
    add(client, module, "X", position=1)
    add(client, module, "F", position=0)
    add(client, module, "Z", position=99)  # clamped to end
    assert tree(client, module) == ["F", "A", "X", "B", "Z"]
    flat = client.get(f"{API}/modules/{module['id']}/objects", params={"flat": True}).json()
    assert sorted(o["position"] for o in flat) == [0, 1, 2, 3, 4]


def test_parent_must_be_in_same_module(client, module):
    other = client.post(f"{API}/projects/{module['project_id']}/modules", json={"name": "M2"}).json()
    foreign = add(client, other, "foreign")
    r = client.post(f"{API}/modules/{module['id']}/objects", json={"parent_id": foreign["id"]})
    assert r.status_code == 422
    r = client.post(f"{API}/modules/{module['id']}/objects", json={"parent_id": 999})
    assert r.status_code == 422


def test_delete_closes_gap_and_removes_subtree(client, module):
    a = add(client, module, "A")
    b = add(client, module, "B")
    add(client, module, "C")
    add(client, module, "B.1", parent=b["id"])
    assert client.delete(f"{API}/objects/{b['id']}").status_code == 204
    assert tree(client, module) == ["A", "C"]
    flat = client.get(f"{API}/modules/{module['id']}/objects", params={"flat": True}).json()
    assert [(o["heading"], o["position"]) for o in flat] == [("A", 0), ("C", 1)]
    assert client.get(f"{API}/objects/{a['id']}").status_code == 200


def test_move_reorder_within_parent(client, module):
    a, _, c = add(client, module, "A"), add(client, module, "B"), add(client, module, "C")
    client.post(f"{API}/objects/{c['id']}/move", json={"position": 0})
    assert tree(client, module) == ["C", "A", "B"]
    client.post(f"{API}/objects/{c['id']}/move", json={"position": 1})
    assert tree(client, module) == ["A", "C", "B"]
    client.post(f"{API}/objects/{a['id']}/move", json={})  # append
    assert tree(client, module) == ["C", "B", "A"]


def test_move_to_other_parent(client, module):
    a = add(client, module, "A")
    b = add(client, module, "B")
    c = add(client, module, "C")
    r = client.post(f"{API}/objects/{c['id']}/move", json={"parent_id": a["id"]})
    assert r.status_code == 200 and r.json()["parent_id"] == a["id"]
    client.post(f"{API}/objects/{b['id']}/move", json={"parent_id": a["id"], "position": 0})
    assert tree(client, module) == [("A", ["B", "C"])]
    client.post(f"{API}/objects/{c['id']}/move", json={"parent_id": None, "position": 0})
    assert tree(client, module) == ["C", ("A", ["B"])]


def test_move_rejects_cycles(client, module):
    a = add(client, module, "A")
    b = add(client, module, "B", parent=a["id"])
    c = add(client, module, "C", parent=b["id"])
    assert client.post(f"{API}/objects/{a['id']}/move", json={"parent_id": c["id"]}).status_code == 422
    assert client.post(f"{API}/objects/{a['id']}/move", json={"parent_id": a["id"]}).status_code == 422
    assert tree(client, module) == [("A", [("B", ["C"])])]
