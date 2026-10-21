/* Reads a Google Drive account's photos and videos (and its storage quota). Runs here or on a worker server. */
const DRIVE_FIELDS = "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webViewLink,md5Checksum,parents,imageMediaMetadata(time,width,height))";
const QUERY = "trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')";

async function listDriveMedia(accessToken, { maxPages = 10, send = fetch } = {}) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const files = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page += 1) {
    const response = await send("https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q: QUERY, pageSize: "100", orderBy: "createdTime desc", fields: DRIVE_FIELDS, ...(pageToken ? { pageToken } : {}) }), { headers });
    if (!response.ok) return { ok: false, status: response.status, files: [] };
    const payload = await response.json();
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || "";
    if (!pageToken) break;
  }
  let quota = null;
  const about = await send("https://www.googleapis.com/drive/v3/about?fields=storageQuota", { headers }).catch(() => null);
  if (about && about.ok) {
    const q = (await about.json()).storageQuota || {};
    quota = { usedGb: Number(q.usage || 0) / (1024 ** 3), limitGb: q.limit ? Number(q.limit) / (1024 ** 3) : null };
  }
  return { ok: true, status: 200, files, quota, more: Boolean(pageToken) };
}


async function listDriveFolders(accessToken, { maxPages = 10, send = fetch } = {}) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const folders = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      q: "trashed = false and mimeType = 'application/vnd.google-apps.folder'",
      pageSize: "100",
      orderBy: "name",
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,parents)",
      ...(pageToken ? { pageToken } : {})
    });
    const response = await send("https://www.googleapis.com/drive/v3/files?" + params.toString(), { headers });
    if (!response.ok) return { ok: false, status: response.status, folders: [] };
    const payload = await response.json();
    folders.push(...(payload.files || []));
    pageToken = payload.nextPageToken || "";
    if (!pageToken) break;
  }
  return { ok: true, folders, more: Boolean(pageToken) };
}

module.exports = { listDriveMedia, listDriveFolders };
