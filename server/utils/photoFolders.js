const { updateEntry, driveFetch } = require("./photoStore");

const FOLDER = "Stashr Photos";
const DRIVE = "https://www.googleapis.com";

async function driveFolder(user, key, connection, name, parentId) {
    const esc = (v) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentId ? ` and '${parentId}' in parents` : ""}`;
    const found = await driveFetch(user, key, connection, `${DRIVE}/drive/v3/files?` + new URLSearchParams({ q, fields: "files(id)", pageSize: "1" }));
    const id = found.ok ? (await found.json()).files?.[0]?.id : "";
    if (id) return id;
    const made = await driveFetch(user, key, connection, `${DRIVE}/drive/v3/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }) });
    return made.ok ? (await made.json()).id : "";
}

/** The Drive folder to upload into: "Stashr Photos" or, for a Stashr folder, its path below it (created on demand). */
async function ensureFolder(user, key, connection, folder, allFolders = []) {
    if (!connection.folderId) {
        connection.folderId = await driveFolder(user, key, connection, FOLDER, "");
        if (connection.folderId && connection._eid) await updateEntry(user, "photoConnections", connection, key);
    }
    if (!folder || !connection.folderId) return connection.folderId || "";
    if (folder.driveIds?.[connection.id]) return folder.driveIds[connection.id];
    const parent = folder.parentId ? allFolders.find((f) => f.id === folder.parentId) : null;
    const parentDrive = parent ? await ensureFolder(user, key, connection, parent, allFolders) : connection.folderId;
    const id = await driveFolder(user, key, connection, folder.name, parentDrive);
    if (id) { folder.driveIds = { ...(folder.driveIds || {}), [connection.id]: id }; await updateEntry(user, "photoFolders", folder, key); }
    return id || connection.folderId;
}

module.exports = { ensureFolder, driveFolder, FOLDER };
