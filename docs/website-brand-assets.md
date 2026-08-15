# Website brand assets

`src/website/public/logo.svg` is the canonical OpenMA organization mark used by the website header and SVG favicon. It is synchronized from the exported `@openma/common/brand/openma-logo-mark.svg` asset; do not redraw or edit it directly.

The PNG and ICO files are compatibility derivatives of that same SVG:

- `favicon-16.png` and `favicon-32.png`: browser fallbacks
- `favicon-192.png` and `favicon-512.png`: web app manifest icons
- `apple-touch-icon.png`: iOS home-screen icon
- `favicon.ico`: 16/32/48 px multi-image favicon

Regenerate the full set after updating `@openma/common`:

```sh
pnpm website:brand
```

`build/icon.svg`, `build/icon.png`, `build/icon.icns`, and `build/icon.ico` are Backchat desktop application packaging assets. They are intentionally separate from the OpenMA organization mark used on the public website.
