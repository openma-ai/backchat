import { useQuery } from "@tanstack/react-query";

export const PROJECTS_QUERY_KEY = ["projects"] as const;
export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => window.backchat.projectsList(),
    staleTime: 30_000,
  });
}
