ImgBB Upload (free) integration

You can use ImgBB (https://imgbb.com/) to host images for free and get a public URL.

1) Create a free ImgBB account and get an API key.
2) In your app, set the key before loading `app.js` by adding to `src/index.html`:

```html
<script>window.IMGBB_API_KEY = 'YOUR_IMGBB_KEY_HERE';</script>
```

3) In the Pattis gallery, press the Upload button on a card to upload the image to ImgBB. On success it will save the returned URL in localStorage and update the gallery.

Notes:
- ImgBB is free for basic use but check their limits and terms.
- For production you may want to move images to your own storage (e.g., S3 or Firebase Storage) and secure uploads.
