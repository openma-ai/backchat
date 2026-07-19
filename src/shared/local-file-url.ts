const LOCAL_FILE_PROTOCOL = "oma-file:";
const LOCAL_FILE_HOST = "local";
const LOCAL_FILE_ROUTE = "/file";
const LOCAL_FILE_PATH_PARAM = "path";

export function localFileProtocolUrl(path: string): string {
  const url = new URL(`${LOCAL_FILE_PROTOCOL}//${LOCAL_FILE_HOST}${LOCAL_FILE_ROUTE}`);
  url.searchParams.set(LOCAL_FILE_PATH_PARAM, path);
  return url.toString();
}

export function localFilePathFromProtocolUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== LOCAL_FILE_PROTOCOL || url.hostname !== LOCAL_FILE_HOST) {
      return null;
    }
    if (url.pathname === LOCAL_FILE_ROUTE && url.searchParams.has(LOCAL_FILE_PATH_PARAM)) {
      return url.searchParams.get(LOCAL_FILE_PATH_PARAM) || null;
    }

    const legacyPath = decodeURIComponent(url.pathname);
    return legacyPath || null;
  } catch {
    return null;
  }
}
