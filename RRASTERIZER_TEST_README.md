Test rasterizer helper

This repository includes a simple test script to verify a rasterizer endpoint (the server-side rasterizer) is working and returns a PNG.

Usage

1. Start your rasterizer server (example: rasterizer-server.js) on port 3000 or any other host.
2. Run the test script from the repository root:

```bash
node scripts/test-rasterizer.js http://localhost:3000/rasterize YOUR_API_KEY_IF_SET
```

The script will POST a small SVG payload and save the returned PNG as `rasterizer-test-output.png` in the current working directory.

Notes

- The rasterizer endpoint must accept JSON { type:'svg', data: '<svg...>' } and return PNG bytes. If your server requires an API key, pass it as the second script argument and the script will send it as `X-API-KEY` header.
- If you're on Node <18, install `node-fetch`:

```bash
npm install node-fetch
```

