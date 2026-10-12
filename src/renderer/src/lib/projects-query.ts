import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const PROJECTS_QUERY_KEY = ["projects"] as const;
const NO_OWNERS: Record<string, string> = {};

export function useProjects() {
  const queryClient = useQueryClient();
  useEffect(() => window.backchat.onProjectsChanged(() => {
    void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
  }), [queryClient]);
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => window.backchat.projectsList(),
    staleTime: 30_000,
  });
}

/** Which saved project owns each path, resolved by the main process with the
 *  registry's folder identity (`~`, symlinks, trailing separators). Lives under
 *  the projects key so a registry change refetches it. */
export function useFolderProjectOwners(paths: readonly string[]): Record<string, string> {
  const wanted = [...new Set(paths.filter(Boolean))].sort();
  const { data } = useQuery({
    queryKey: [...PROJECTS_QUERY_KEY, "folder-owners", wanted],
    queryFn: () => window.backchat.projectFolderOwners({ paths: wanted }),
    enabled: wanted.length > 0,
    staleTime: 30_000,
  });
  return data ?? NO_OWNERS;
}
