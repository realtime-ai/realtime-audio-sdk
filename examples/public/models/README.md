# VAD Models

This directory should contain the Silero VAD v5 ONNX model for Voice Activity Detection.

## Automatic Download

The model is automatically downloaded during build:

```bash
npm run download:model
```

Or as part of the full examples build:

```bash
npm run build:examples
```

## Manual Download

If automatic download fails, you can manually download the model:

**Option 1: GitHub LFS**
```bash
curl -L -o silero_vad_v5.onnx https://media.githubusercontent.com/media/snakers4/silero-vad/master/src/silero_vad/data/silero_vad_v5.onnx
```

**Option 2: Direct from Repository**
1. Visit: https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/data/silero_vad_v5.onnx
2. Click "Download" or "Raw" button
3. Save as `silero_vad_v5.onnx` in this directory

## File Size

The model file should be approximately 2MB. If your downloaded file is much smaller, the download may have failed.
