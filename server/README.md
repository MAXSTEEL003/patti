Patti Thumbnail Server
======================

Minimal Express server to store and serve thumbnail images for the Patti app. The server accepts a single-file upload and returns a public URL under `/images`.

Features
- Accepts `POST /upload` multipart/form-data (`file` field)
- Returns JSON with `url`, `filename`, `size`, `mime`
- Lists thumbnails at `GET /list`
- Deletes a thumbnail via `DELETE /images/:filename`

Limits and notes
- By default uploads are limited to 200 KB per file (set in `server.js`). Adjust if needed.
- This is a self-hosted solution: you need to run and host it (Render, Railway, VPS, etc.). Use HTTPS in production.

Run locally
-----------
1. Install dependencies

```bash
cd server
npm install
```

2. Start server

```bash
npm start
```

The server listens on port 4000 by default.

Client integration (browser)
---------------------------
Upload a thumbnail Blob (e.g., produced by `makeThumbnailBlob`) to the server and update local pattis metadata with the returned `url`:

```js
async function uploadThumbnailToServer(blob, serverBase = 'http://localhost:4000'){
  const form = new FormData(); form.append('file', blob, 'thumb.jpg');
  const res = await fetch(serverBase + '/upload', { method: 'POST', body: form });
  if(!res.ok) throw new Error('Upload failed: ' + res.status);
  return await res.json(); // { url, filename, size, mime }
}

// Usage example inside your save flow:
// const thumb = await makeThumbnailBlob(originalBlob, 800, 'image/jpeg', 0.8);
// const meta = await uploadThumbnailToServer(thumb, 'https://your-server.example.com');
// item.remoteUrl = meta.url; saveAll(items);
```

Security
--------
- For public usage you can keep the `/images` endpoint public. For private data you should add authentication and secure the upload/list/delete endpoints.
