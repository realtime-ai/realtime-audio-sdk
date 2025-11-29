# Silero VAD Integration Guide

## Overview

Silero VAD is a state-of-the-art neural network-based Voice Activity Detection system integrated into the Realtime Audio SDK. It provides more accurate speech detection compared to traditional energy-based methods, especially in noisy environments.

## Features

- **Neural Network-based Detection**: Uses ONNX Runtime for efficient inference
- **Real-time Speech Probability**: Returns continuous probability values (0-1)
- **Speech Segmentation**: Automatically detects speech segments with pre-speech padding
- **Configurable Thresholds**: Fine-tune detection sensitivity for your use case
- **Frame Size Alignment**: Automatically buffers and aligns audio frames for optimal processing

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Download Silero VAD Model

```bash
npm run download-model
```

This downloads the Silero VAD ONNX model (~4.4MB) to `public/models/silero_vad_v5.onnx`.

## Usage

### Basic Setup

```typescript
import { RTA } from '@realtime-ai/audio-sdk';

const sdk = new RTA({
  sampleRate: 16000,
  channelCount: 1,
  frameSize: 20,
  processing: {
    vad: {
      enabled: true,
      modelPath: '/models/silero_vad_v5.onnx'
    }
  }
});

// Start recording
await sdk.start();
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | `boolean` | Required | Enable VAD |
| `positiveSpeechThreshold` | `number` | `0.3` | Threshold for detecting speech start (0-1) |
| `negativeSpeechThreshold` | `number` | `0.25` | Threshold for detecting speech end (0-1) |
| `silenceDuration` | `number` | `1400` | Silence duration to end speech segment (ms) |
| `preSpeechPadDuration` | `number` | `800` | Audio padding before speech start (ms) |
| `minSpeechDuration` | `number` | `400` | Minimum duration to consider as speech (ms) |

### State Machine

Silero VAD now tracks speech using a four-phase state machine to reduce flicker:

1. **`silence`** – default idle state, buffers only enough audio for pre-padding.
2. **`potential_start`** – entered when probability rises above `positiveSpeechThreshold`. The detector waits until the buffered speech lasts longer than `minSpeechDuration`.
3. **`speaking`** – confirmed speech. `speech-start` is emitted at this transition and all subsequent frames are treated as active speech.
4. **`potential_end`** – triggered by probability dropping below `negativeSpeechThreshold`. Only after continuous silence exceeds `silenceDuration` does the state return to `silence` and emit `speech-end`. If speech resumes earlier, the state jumps back to `speaking`.

This hysteresis ensures that short noises do not trigger speech events and brief pauses do not immediately end a segment.

### Event Listeners

#### Unified Audio Event with VAD

```typescript
sdk.on('audio', (event) => {
  const { audio, metadata, processing } = event;

  // Check VAD results
  if (processing.vad?.active) {
    console.log('Speech:', processing.vad.isSpeech);
    console.log('Probability:', processing.vad.probability);
    console.log('Confidence:', processing.vad.confidence);
  }
});
```

#### Speech State Changes

```typescript
sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    console.log('Speech started', {
      probability: event.probability,
      timestamp: event.timestamp
    });
  } else {
    console.log('Speech ended', {
      probability: event.probability,
      duration: event.duration
    });

    if (event.segment) {
      console.log('Speech segment detected', {
        startTime: event.segment.startTime,
        endTime: event.segment.endTime,
        duration: event.segment.duration,
        avgProbability: event.segment.avgProbability,
        confidence: event.segment.confidence
      });

      // Send audio segment for transcription
      sendToTranscriptionAPI(event.segment.audio);
    }
  }
});
```


## Advanced Usage

### Custom Configuration

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,

      // Fine-tune for your environment
      positiveSpeechThreshold: 0.5,    // More strict speech detection
      negativeSpeechThreshold: 0.15,   // Quicker to end speech
      silenceDuration: 1000,            // 1 second silence to end
      preSpeechPadDuration: 500,       // 500ms pre-padding
      minSpeechDuration: 300,          // Minimum 300ms speech

      // Performance options
      modelPath: '/models/silero_vad_v5.onnx',
      modelVersion: 'v5'               // or 'legacy' for older model
    }
  }
});
```

### Updating VAD Configuration at Runtime

```typescript
// Start with default VAD settings
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      modelPath: '/models/silero_vad_v5.onnx'
    }
  }
});

// Update VAD thresholds at runtime
await sdk.updateConfig({
  processing: {
    vad: {
      enabled: true,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.2,
      modelPath: '/models/silero_vad_v5.onnx'
    }
  }
});
```

### Processing Speech Segments

```typescript
// Collect speech segments for batch processing
const speechSegments: Float32Array[] = [];

sdk.on('speech-state', (event) => {
  if (event.type === 'end' && event.segment?.audio) {
    speechSegments.push(event.segment.audio);

    // Process when we have enough segments
    if (speechSegments.length >= 5) {
      processBatch(speechSegments);
      speechSegments.length = 0;
    }
  }
});
```

## Performance Considerations

### CPU Usage

- Neural network inference: ~5-15% CPU usage
- Varies with frame size and processing frequency

### Memory Usage

- Model size: ~4.4MB
- Runtime memory: ~10-20MB including buffers

### Latency

- Frame processing: <10ms per frame
- Total latency: 20-60ms depending on frame size

### Frame Size Alignment

Silero VAD v5 requires 512 samples (32ms at 16kHz) for optimal processing. The SDK automatically handles buffering when capture frame sizes don't align:

- 20ms capture (320 samples): Buffered to accumulate 512 samples
- 40ms capture (640 samples): Processed with 512 samples, remainder buffered
- 60ms capture (960 samples): Processes one 512-sample frame, buffers remainder

## Troubleshooting

### Model Loading Issues

If the model fails to load:

1. Ensure the model file exists:
```bash
ls -la public/models/silero_vad_v5.onnx
```

2. Re-download the model:
```bash
npm run download-model
```

3. Check console for ONNX Runtime errors

### High CPU Usage

If CPU usage is too high:

1. Increase frame size (40ms or 60ms)
2. Reduce processing frequency by adjusting buffer settings
3. Consider adjusting detection thresholds for your use case

### Detection Issues

If speech detection is not working well:

1. Adjust thresholds based on your environment:
   - Noisy: Higher `positiveSpeechThreshold` (0.5-0.7)
   - Quiet: Lower `positiveSpeechThreshold` (0.2-0.3)

2. Tune timing parameters:
   - Fast response: Lower `silenceDuration` (500-1000ms)
   - Avoid cutting off: Higher `silenceDuration` (1500-2000ms)

## Examples

### Web Application

See `examples/silero-vad-example.html` for a complete web application demonstrating:
- Real-time probability visualization
- Speech segment detection
- Configuration tuning
- Frame size alignment handling

### Node.js Application

See `examples/silero-vad-node.js` for a Node.js example showing:
- Server-side audio processing
- Speech segment collection
- Statistics tracking

## Browser Compatibility

- **Chrome**: ✅ Full support
- **Firefox**: ✅ Full support
- **Safari**: ✅ Full support (16.4+)
- **Edge**: ✅ Full support

Note: WebAssembly is required for ONNX Runtime.

## Resources

- [Silero VAD GitHub](https://github.com/snakers4/silero-vad)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript.html)
- [Realtime Audio SDK Docs](../README.md)
