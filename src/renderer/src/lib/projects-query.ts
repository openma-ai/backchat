import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const PROJECTS_QUERY_KEY = ["projects"] as const;
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
