# Business Console

One place to run Charleston 3D and Elevated Designs: dashboard, brand pages, a map of every connected service, and a design studio with an image library and shirt designer.

Static site (no build step) plus one Netlify function for image storage.

- `index.html`: app shell
- `assets/`: styles, data and page scripts
- `netlify/functions/images.mjs`: image library storage (Netlify Blobs), served at `/api/images`

Run locally with `npx netlify dev`, or open `index.html` directly (the library then keeps images in the browser only).
