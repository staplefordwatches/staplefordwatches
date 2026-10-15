# PP Neue Montreal webfont setup

The site now prefers **PP Neue Montreal** for its principal typography. To activate the typeface for visitors, add your **licensed webfont (WOFF2)** files at these paths:

- `fonts/pp-neue-montreal-light.woff2` (300)
- `fonts/pp-neue-montreal-regular.woff2` (400)
- `fonts/pp-neue-montreal-medium.woff2` (500)
- `fonts/pp-neue-montreal-bold.woff2` (600–700)

These paths are referenced by the `@font-face` declarations in `index.html`. The files are **not included** in the repository because PP Neue Montreal requires appropriate commercial webfont licensing. Ensure your licence permits hosting the files on this site.

Until the files are supplied (or if loading fails), the site's existing Sweet Sans Pro font is the fallback. Existing Sweet Sans Pro files remain in `fonts/` intentionally. You do not need to rename those files.

After adding the WOFF2 files, deploy normally and verify in the browser's Network and computed-font panels that PP Neue Montreal loads on desktop and mobile.
