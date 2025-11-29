# Realtime Audio SDK

![Tests](https://github.com/realtime-ai/realtime-audio-sdk/workflows/Test/badge.svg)
![Package](https://github.com/realtime-ai/realtime-audio-sdk/workflows/Publish%20Package/badge.svg)

A powerful Web SDK for real-time audio capture, processing, and encoding. Perfect for building voice-based applications like transcription, translation, and AI conversations.

## Features

- **📱 Device Management** - List, select, and auto-switch audio input devices with hot-plug detection
- **🎤 Precise Audio Capture** - Capture audio in exact time chunks (20ms, 40ms, or 60ms)
- **🔊 Audio Processing** - Voice Activity Detection (VAD) and audio normalization
- **📦 Flexible Encoding** - Opus encoding via WebCodecs with PCM fallback
- **⚡ Low Latency** - Built on AudioWorklet for minimal latency
- **🎯 TypeScript** - Full type safety and excellent IDE support

## Use Cases

- Real-time transcription
- Real-time translation
- AI-powered voice conversations
- Voice commands and control
- Audio streaming applications

## Installation

```bash
npm install @realtime-ai/audio-sdk
```

## Quick Start

```typescript
import { RTA } from '@realtime-ai/audio-sdk';

// Initialize SDK
const sdk = new RTA({
  sampleRate: 16000,
  channelCount: 1,
  frameSize: 20, // 20ms chunks
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 16000,
  },
  processing: {
    vad: {
      enabled: true,
      threshold: 0.02,
    },
    normalize: true,
  },
});

// Listen for unified audio event (includes all frame data)
sdk.on('audio', (event) => {
  const { audio, metadata, processing } = event;

  // Send encoded audio to your service
  if (audio.encoded) {
    websocket.send(audio.encoded);
  }

  // Check speech detection
  if (processing.vad?.active) {
    console.log('Speech detected:', processing.vad.isSpeech);
    console.log('Probability:', processing.vad.probability);
  }
  console.log('Audio energy:', processing.energy);
});

// Or listen for speech state changes only
sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    console.log('Speech started');
  } else {
    console.log('Speech ended, duration:', event.duration);
  }
});

// Start recording
await sdk.start();
```

## Configuration

### SDKConfig

```typescript
interface SDKConfig {
  deviceId?: string;              // Audio input device ID
  sampleRate?: number;            // Sample rate in Hz (default: 16000)
  channelCount?: number;          // Number of channels (default: 1)
  frameSize?: 20 | 40 | 60;      // Frame size in ms (default: 20)
  encoding?: EncodingConfig;
  processing?: ProcessingConfig;
  autoSwitchDevice?: boolean;     // Auto-switch on device unplug (default: true)
}
```

### Encoding Configuration

```typescript
interface EncodingConfig {
  enabled: boolean;              // Enable encoding
  codec: 'opus' | 'pcm';        // Codec to use
  bitrate?: number;             // Bitrate for Opus (default: 16000)
  complexity?: number;          // Opus complexity 0-10 (default: 5)
}
```

### Processing Configuration

```typescript
interface ProcessingConfig {
  vad?: {
    enabled: boolean;

    // Silero VAD parameters:
    positiveSpeechThreshold?: number;   // Speech threshold (default: 0.3)
    negativeSpeechThreshold?: number;   // Non-speech threshold (default: 0.25)
    silenceDuration?: number;           // Silence duration to end speech in ms (default: 1400)
    preSpeechPadDuration?: number;      // Pre-speech padding in ms (default: 800)
    minSpeechDuration?: number;         // Min speech duration in ms (default: 400)
  };
  normalize?: boolean;                  // Enable audio normalization
}
```

## API Reference

### RTA

#### Methods

- `start(): Promise<void>` - Start audio capture
- `stop(): Promise<void>` - Stop audio capture
- `pause(): Promise<void>` - Pause audio capture
- `resume(): Promise<void>` - Resume audio capture
- `getDevices(): Promise<MediaDeviceInfo[]>` - Get available audio devices
- `setDevice(deviceId: string): Promise<void>` - Set audio input device
- `updateConfig(config: Partial<SDKConfig>): Promise<void>` - Update configuration
- `getState(): SDKState` - Get current state
- `destroy(): Promise<void>` - Cleanup and destroy SDK instance

#### Events

**Audio Events:**
- `audio` - Unified audio event with all frame data (raw, encoded, metadata, processing results)
- `speech-state` - Speech state changes (start/end events with segment payload on end)

**Device Events:**
- `device` - All device events (changed/list-updated/unplugged)

**System Events:**
- `state` - SDK state changes
- `error` - Errors with context

## Examples

### Device Selection

```typescript
// Get all audio devices
const devices = await sdk.getDevices();
console.log('Available devices:', devices);

// Select a specific device
await sdk.setDevice(devices[0].deviceId);

// Listen for device events
sdk.on('device', (event) => {
  switch (event.type) {
    case 'unplugged':
      console.log('Device unplugged:', event.deviceId);
      // SDK will auto-switch if autoSwitchDevice is enabled
      break;
    case 'changed':
      console.log('Device changed to:', event.device?.label);
      break;
    case 'list-updated':
      console.log('Device list updated, count:', event.devices?.length);
      break;
  }
});
```

### Voice Activity Detection

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      provider: 'silero',  // Use advanced neural network VAD
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      silenceDuration: 1400,
      minSpeechDuration: 400,
    },
  },
});

// Listen for audio frames with VAD results
sdk.on('audio', (event) => {
  if (event.processing.vad?.isSpeech) {
    console.log('Speech detected with probability:', event.processing.vad.probability);
  }
});

// Or listen for speech state transitions (end events include segment data)
sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    console.log('Speech started at:', event.timestamp);
  } else {
    console.log('Speech ended, duration:', event.duration, 'ms');

    if (event.segment) {
      console.log('Speech segment:', {
        duration: event.segment.duration,
        confidence: event.segment.confidence,
        audioSamples: event.segment.audio.length
      });
      // Send event.segment.audio to transcription service
    }
  }
});
```

### Real-time Transcription

```typescript
const sdk = new RTA({
  frameSize: 20,
  encoding: {
    enabled: true,
    codec: 'opus',
  },
  processing: {
    vad: {
      enabled: true,
      provider: 'silero',  // Only send speech to transcription
    },
  },
});

// Connect to transcription service
const ws = new WebSocket('wss://transcription-service.com/ws');

// Send audio frames to transcription service
sdk.on('audio', (event) => {
  // Only send when speech is detected to save bandwidth
  if (event.audio.encoded && event.processing.vad?.isSpeech) {
    ws.send(event.audio.encoded);
  }
});

// Or send complete speech segments for better accuracy (available on speech-state end)
sdk.on('speech-state', async (event) => {
  if (event.type === 'end' && event.segment) {
    const encoded = await encodeSegment(event.segment.audio);
    ws.send(encoded);
  }
});

ws.onmessage = (event) => {
  const result = JSON.parse(event.data);
  console.log('Transcript:', result.text);
};

await sdk.start();
```

## Browser Compatibility

- Chrome/Edge 94+ (WebCodecs support)
- Firefox 100+ (AudioWorklet support)
- Safari 16.4+ (WebCodecs support)
- Mobile: iOS 16.4+, Android Chrome 94+

For browsers without WebCodecs support, the SDK automatically falls back to PCM encoding.

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build library
npm run build

# Run tests
npm test

# Type check
npm run type-check
```

## Examples

Check out the [examples](./examples) directory:
- [Basic Example](./examples/basic/index.html) - Device selection and audio capture
- [Transcription Example](./examples/transcription/index.html) - Real-time transcription setup

## License

MIT © realtime-ai
