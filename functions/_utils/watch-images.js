// Cloudinary versions, delivery transforms and file extensions can describe
// the same uploaded photo. Keep the first URL (usually the versioned original).
export function imageIdentity(value) {
  try {
    const url = new URL(value);
    const marker = "/image/upload/";
    const index = url.pathname.indexOf(marker);
    if (!/(^|\.)cloudinary\.com$/i.test(url.hostname) || index < 0) return url.href;
    const parts = url.pathname.slice(index + marker.length).split("/").filter(Boolean);
    const transformPart = /^(?:a_|ar_|b_|bo_|c_|co_|d_|dpr_|e_|f_|fl_|g_|h_|l_|o_|q_|r_|so_|t_|u_|w_|x_|y_|z_|if_|if$|fn_|pg_|vc_|vs_)/i;
    while (parts.length && parts[0].split(",").every(part => transformPart.test(part))) parts.shift();
    if (/^v\d+$/i.test(parts[0] || "")) parts.shift();
    return url.origin + url.pathname.slice(0, index + marker.length)
      + parts.join("/").replace(/\.(?:jpe?g|png|webp|avif|gif|tiff?|heic)$/i, "");
  } catch {
    return String(value || "");
  }
}

export function uniqueWatchImages(values) {
  const seen = new Set();
  return values.filter(value => {
    if (!value) return false;
    const key = imageIdentity(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
