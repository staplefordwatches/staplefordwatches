# Changing the homepage photograph

Open the **Homepage** table in the existing Watches Airtable base. Edit the single row named **Homepage**.

1. Upload your high-resolution original to Cloudinary.
2. Copy its full, versioned HTTPS delivery URL and paste it into **Image URL**.
3. Update **Image Alt** to describe the new photograph.

The site reads these settings automatically. Allow about a minute, then refresh the homepage. No code changes or deployment are needed for future photo updates.

**Mobile Image URL** is optional: use it for a separate portrait composition, or leave it empty to use the main photograph on all screens. The site fills the viewport without stretching the image, so different screen shapes crop its edges.

**Desktop Focus** and **Mobile Focus** control the visible portion. Use two percentages, such as `50% 38%`. Start with `50% 50%`, then adjust the second number to move the crop up or down. These settings do not alter the original image.

The original DSC00037 photograph is included at `/assets/homepage-watch.jpg` and remains the fallback when **Image URL** is empty or a replacement cannot load. Its resolution is 1638 × 2048 pixels; use a larger original for the best results on large, high-density displays.

The server uses the existing `AIRTABLE_BASE_ID` and Airtable token. The default settings table is `Homepage`; `AIRTABLE_HOMEPAGE_TABLE_NAME` can override it. Cloudinary URLs receive responsive width variants and automatic format/quality optimization. The shared data cache retains the last good settings during temporary Airtable errors.
