# Cloudflare Pages Deployment Guide

This guide explains how to deploy the Realtime Audio SDK examples to Cloudflare Pages.

## Prerequisites

- A Cloudflare account
- A GitHub repository with this project

## Deployment Methods

### Method 1: Connect to Git (Recommended)

1. Go to [Cloudflare Pages](https://pages.cloudflare.com/)
2. Click "Create a project" > "Connect to Git"
3. Select your repository
4. Configure the build settings:

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `npm run build:examples` |
| Build output directory | `dist-examples` |
| Root directory | `/` (leave empty) |

5. Set environment variables (if needed):
   - `NODE_VERSION`: `18` (or higher)

6. Click "Save and Deploy"

### Method 2: Direct Upload

```bash
# Build locally
npm install
npm run build:examples

# Upload dist-examples folder via Cloudflare Dashboard
```

### Method 3: Wrangler CLI

1. Install Wrangler:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy:
```bash
npm run build:examples
wrangler pages deploy dist-examples --project-name=realtime-audio-sdk
```

## Build Output Structure

```
dist-examples/
├── index.html              # Examples navigation page
├── basic/
│   └── index.html          # Basic example
├── vad/
│   └── index.html          # VAD demo
├── transcription/
│   └── index.html          # Transcription example
├── assets/
│   └── *.js                # Bundled JavaScript
├── models/
│   └── silero_vad_v5.onnx  # VAD model (downloaded during build)
├── ort-wasm-simd.wasm      # ONNX Runtime WASM files
├── ort-wasm-simd-threaded.wasm
└── ort-wasm.wasm
```

## Configuration Files

### wrangler.toml (Optional)

```toml
name = "realtime-audio-sdk-examples"
compatibility_date = "2024-01-01"

[site]
bucket = "./dist-examples"
```

## CORS and Headers

For WASM files and SharedArrayBuffer support, you may need custom headers.
Create `_headers` file in `examples/public/`:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

## Troubleshooting

### VAD Model Not Found

If the VAD model fails to download during build:

1. Check the build logs for download errors
2. Manually download the model:
   ```bash
   curl -L -o examples/public/models/silero_vad_v5.onnx \
     https://media.githubusercontent.com/media/snakers4/silero-vad/master/src/silero_vad/data/silero_vad_v5.onnx
   ```
3. Commit the model file to your repository

### WASM Loading Errors

Ensure the WASM files are being served with correct MIME type (`application/wasm`).
Cloudflare Pages handles this automatically.

### Microphone Access

- HTTPS is required for `getUserMedia`
- Cloudflare Pages provides HTTPS by default

## Custom Domain

1. Go to your project in Cloudflare Pages Dashboard
2. Click "Custom domains"
3. Add your domain
4. Update DNS records as instructed

## Environment Variables

No environment variables are required for the examples.
All configuration is done at runtime in the browser.
