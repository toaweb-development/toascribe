// The upload limit in one unit everywhere: MiB (1024 × 1024 bytes), in the api and in the proxy (Caddy's `MiB`; its `MB` would be
// 1000 × 1000). UPLOAD_MAX_SIZE_MB (TOASCRIBE_UPLOAD_MAX_SIZE_MB) caps the whole request of an upload, in Caddy and in the api's
// body limit alike. The file itself may be FORM_ROOM_BYTES smaller, the room for the multipart framing and the form's other
// fields, so a file the api accepts is never refused by the proxy. Settings → Media (`upload_max_size_mb`) can lower the limit.

export const MIB = 1024 * 1024

/** Room for the multipart framing and the other fields of the upload form (title, alt, folder): far more than they take. */
export const FORM_ROOM_BYTES = 64 * 1024

/** The largest request body of an upload route: the cap, as Caddy counts it. */
export function uploadRequestLimit(capMib: number): number {
  return capMib * MIB
}

/** The largest file: the setting, and never more than fits in the request under the cap. */
export function uploadFileLimit(settingMib: number, capMib: number): number {
  return Math.min(settingMib * MIB, uploadRequestLimit(capMib) - FORM_ROOM_BYTES)
}
