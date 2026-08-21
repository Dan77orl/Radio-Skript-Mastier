import { promises as fs } from "fs";

const OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

/** drive.file limits us to files this app created — it cannot read the user's other documents. */
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/userinfo.email"];

export function isGoogleDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function requireConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google Drive is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI)");
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * `state` carries a signed/opaque value the caller can tie back to a session —
 * without it the callback could be replayed against a different account.
 */
export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent is what actually returns a refresh_token; without them
    // Google silently omits it on repeat authorisations.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${OAUTH_BASE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; accessToken: string; email: string | null }> {
  const { clientId, clientSecret, redirectUri } = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json() as any;
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token — revoke the app's access and connect again");
  }

  let email: string | null = null;
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (me.ok) email = ((await me.json()) as any).email ?? null;
  } catch { /* the address is cosmetic — never fail the connection over it */ }

  return { refreshToken: data.refresh_token, accessToken: data.access_token, email };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} — reconnect Google Drive`);
  }
  return ((await res.json()) as any).access_token;
}

async function findOrCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const query = `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false${parentClause}`;

  const search = await fetch(`${FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (search.ok) {
    const found = ((await search.json()) as any).files?.[0];
    if (found?.id) return found.id;
  }

  const create = await fetch(FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!create.ok) {
    throw new Error(`Could not create Drive folder "${name}": ${create.status}`);
  }
  return ((await create.json()) as any).id;
}

/** Resolve a "/radio/news" style path into a Drive folder id, creating segments as needed. */
export async function resolveFolderPath(accessToken: string, folderPath: string, rootId?: string): Promise<string | undefined> {
  const segments = folderPath.split("/").map(s => s.trim()).filter(Boolean);
  let parent = rootId;
  for (const segment of segments) {
    parent = await findOrCreateFolder(accessToken, segment, parent);
  }
  return parent;
}

export async function uploadFile(opts: {
  refreshToken: string;
  localPath: string;
  fileName: string;
  folderPath?: string;
  rootFolderId?: string;
  mimeType?: string;
}): Promise<{ fileId: string; webViewLink: string | null; path: string }> {
  const accessToken = await getAccessToken(opts.refreshToken);
  const folderId = opts.folderPath
    ? await resolveFolderPath(accessToken, opts.folderPath, opts.rootFolderId)
    : opts.rootFolderId;

  const fileData = await fs.readFile(opts.localPath);
  const metadata = {
    name: opts.fileName,
    ...(folderId ? { parents: [folderId] } : {}),
  };

  // Multipart upload: one request carrying metadata and bytes together.
  const boundary = `rf${Date.now()}${Math.random().toString(36).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${opts.mimeType || "audio/mpeg"}\r\n\r\n`),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google Drive upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const uploaded = await res.json() as any;
  return {
    fileId: uploaded.id,
    webViewLink: uploaded.webViewLink ?? null,
    path: `${opts.folderPath || ""}/${opts.fileName}`.replace(/\/+/g, "/"),
  };
}
