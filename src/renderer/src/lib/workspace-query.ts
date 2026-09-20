/** Shared react-query key for the workspace list so the sidebar and the
 *  composer picker invalidate the same cache after create/delete. */
export const WORKSPACES_QUERY_KEY = ["workspaces"] as const;
