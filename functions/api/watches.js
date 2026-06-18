export async function onRequestGet() {
  return Response.json({
    test: "YES - Cloudflare is using functions/api/watches.js",
    cloudinaryExample: "https://res.cloudinary.com/YOUR-CLOUD-NAME/image/upload/f_auto,q_auto/watches/SK001/01"
  });
}
