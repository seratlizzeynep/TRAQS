import { useCallback, useEffect, useState } from "react";
import { get } from "../api.js";

// Attribute types (what kinds exist) and definitions (what this project defines).
// Failures leave the lists empty: the rest of the screen keeps working without attribute columns.
export function useAttributes(projectId) {
  const [state, setState] = useState({ types: [], definitions: [], loading: true });

  const load = useCallback(async () => {
    const [types, definitions] = await Promise.all([
      get("/attribute-types").catch(() => []),
      get(`/projects/${projectId}/attributes`).catch(() => []),
    ]);
    setState({ types, definitions, loading: false });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
