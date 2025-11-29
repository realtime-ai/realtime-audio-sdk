# API Reference

## Table of Contents

- [RTA](#realtimeaudiosdk)
- [Configuration](#configuration)
- [Events](#events)
- [Type Definitions](#type-definitions)

## RTA

The main class for real-time audio capture, processing, and encoding.

### Constructor

```typescript
new RTA(config?: SDKConfig)
```

Creates a new instance of the RTA.

**Parameters:**
- `config` (optional): Configuration object for the SDK

### Methods

#### start()

```typescript
async start(): Promise<void>
```

Starts audio capture from the configured device.

**Throws:**
- Error if microphone permission is denied
- Error if no audio device is available

#### stop()

```typescript
async stop(): Promise<void>
```

Stops audio capture and releases resources.

#### pause()

```typescript
async pause(): Promise<void>
```

Pauses audio capture without releasing resources.

#### resume()

```typescript
async resume(): Promise<void>
```

Resumes audio capture from paused state.

#### getDevices()

```typescript
async getDevices(): Promise<MediaDeviceInfo[]>
```

Returns a list of available audio input devices.

#### setDevice()

```typescript
async setDevice(deviceId: string): Promise<void>
```

Sets the audio input device.

**Parameters:**
- `deviceId`: The ID of the device to use

#### updateConfig()

```typescript
async updateConfig(config: Partial<SDKConfig>): Promise<void>
```

Updates SDK configuration. Will restart capture if currently recording.

**Parameters:**
- `config`: Partial configuration to update

#### getState()

```typescript
getState(): SDKState
```

Returns the current SDK state.

**Returns:**
- `'idle'` | `'recording'` | `'paused'` | `'error'`

#### getConfig()

```typescript
getConfig(): Required<SDKConfig>
```

Returns the current configuration.

#### destroy()

```typescript
async destroy(): Promise<void>
```

Cleanup and destroy the SDK instance. Releases all resources.

## Configuration

### SDKConfig

```typescript
interface SDKConfig {
  deviceId?: string;
  sampleRate?: number;
  channelCount?: number;
  frameSize?: 20 | 40 | 60;
  encoding?: EncodingConfig;
  processing?: ProcessingConfig;
  autoSwitchDevice?: boolean;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `deviceId` | `string` | `''` | Audio input device ID |
| `sampleRate` | `number` | `16000` | Sample rate in Hz |
| `channelCount` | `number` | `1` | Number of audio channels |
| `frameSize` | `20 \| 40 \| 60` | `20` | Frame size in milliseconds |
| `encoding` | `EncodingConfig` | See below | Encoding configuration |
| `processing` | `ProcessingConfig` | See below | Audio processing configuration |
| `autoSwitchDevice` | `boolean` | `true` | Auto-switch to default device on unplug |

### EncodingConfig

```typescript
interface EncodingConfig {
  enabled?: boolean;
  codec?: 'opus' | 'pcm';
  bitrate?: number;
  complexity?: number;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable audio encoding |
| `codec` | `'opus' \| 'pcm'` | `'opus'` | Codec to use |
| `bitrate` | `number` | `16000` | Bitrate for Opus encoding |
| `complexity` | `number` | `5` | Opus complexity (0-10) |

### ProcessingConfig

```typescript
interface ProcessingConfig {
  vad?: VADConfig;
  normalize?: boolean;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `vad` | `VADConfig` | `undefined` | VAD configuration |
| `normalize` | `boolean` | `false` | Enable audio normalization |

### VADConfig

```typescript
interface VADConfig {
  enabled: boolean;

  // Silero VAD parameters
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  silenceDuration?: number;
  preSpeechPadDuration?: number;
  minSpeechDuration?: number;
  modelPath?: string;
  modelVersion?: 'v5' | 'legacy';
  bufferSize?: number;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | Required | Enable VAD |
| `positiveSpeechThreshold` | `number` | `0.3` | Speech start threshold (0-1) |
| `negativeSpeechThreshold` | `number` | `0.25` | Speech end threshold (0-1) |
| `silenceDuration` | `number` | `1400` | Silence duration to end speech (ms) |
| `preSpeechPadDuration` | `number` | `800` | Pre-speech padding (ms) |
| `minSpeechDuration` | `number` | `400` | Minimum speech duration (ms) |
| `modelPath` | `string` | `'/models/silero_vad_v5.onnx'` | Path to Silero model |
| `modelVersion` | `'v5' \| 'legacy'` | `'v5'` | Model version |
| `bufferSize` | `number` | Auto | Audio buffer size |

## Events

### audio

Unified audio event containing all frame data.

```typescript
sdk.on('audio', (event: AudioDataEvent) => void)
```

**Event Data:**
```typescript
interface AudioDataEvent {
  audio: {
    raw: Float32Array;        // Raw audio samples
    encoded?: ArrayBuffer;    // Encoded audio (if enabled)
    format?: 'opus' | 'pcm';  // Encoding format
  };
  metadata: {
    timestamp: number;        // Timestamp in milliseconds
    frameIndex: number;       // Sequential frame index
    sampleRate: number;       // Sample rate in Hz
    channelCount: number;     // Number of channels
    frameSize: number;        // Frame size in ms
  };
  processing: {
    energy: number;           // Audio energy (RMS)
    normalized: boolean;      // Whether normalized
    vad?: {                   // VAD results (if enabled)
      active: boolean;
      isSpeech: boolean;
      probability: number;
      confidence: 'high' | 'medium' | 'low';
    };
  };
}
```

### speech-state

Speech state change events (start/end).

```typescript
sdk.on('speech-state', (event: VADStateEvent) => void)
```

**Event Data:**
```typescript
interface VADStateEvent {
  type: 'start' | 'end';
  timestamp: number;          // Timestamp in milliseconds
  probability: number;        // Speech probability (0-1)
  duration?: number;          // Duration in ms (end event only)
  segment?: {                 // Present on end events when a full segment is available
    audio: Float32Array;      // Complete audio segment
    startTime: number;        // Start timestamp (ms)
    endTime: number;          // End timestamp (ms)
    duration: number;         // Total duration (ms)
    avgProbability: number;   // Average speech probability
    confidence: number;       // Segment confidence (0-1)
  };
}
```

### device

Device-related events.

```typescript
sdk.on('device', (event: DeviceEvent) => void)
```

**Event Data:**
```typescript
interface DeviceEvent {
  type: 'changed' | 'list-updated' | 'unplugged';
  device?: MediaDeviceInfo;   // Current device (changed)
  devices?: MediaDeviceInfo[]; // Device list (list-updated)
  deviceId?: string;          // Device ID (unplugged)
}
```

### state

SDK state changes.

```typescript
sdk.on('state', (state: SDKState) => void)
```

**State Values:**
- `'idle'`: Not recording
- `'recording'`: Actively capturing audio
- `'paused'`: Capture paused
- `'error'`: Error state

### error

Error events with context.

```typescript
sdk.on('error', (error: SDKError) => void)
```

**Event Data:**
```typescript
interface SDKError extends Error {
  code?: string;              // Error code
  context?: Record<string, unknown>; // Additional context
}
```

## Type Definitions

### SDKState

```typescript
type SDKState = 'idle' | 'recording' | 'paused' | 'error';
```

### FrameSize

```typescript
type FrameSize = 20 | 40 | 60;
```

### AudioCodec

```typescript
type AudioCodec = 'opus' | 'pcm';
```

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| AudioWorklet | 66+ | 76+ | 14.1+ | 79+ |
| WebCodecs (Opus) | 94+ | ❌ | 16.4+ | 94+ |
| getUserMedia | ✅ | ✅ | ✅ | ✅ |
| ONNX Runtime (Silero) | ✅ | ✅ | ✅ | ✅ |

## Error Codes

| Code | Description |
|------|-------------|
| `PERMISSION_DENIED` | Microphone permission denied |
| `NO_DEVICE` | No audio input device available |
| `ENCODER_ERROR` | Failed to initialize encoder |
| `VAD_ERROR` | VAD initialization failed |
| `DEVICE_ERROR` | Device-related error |
| `SDK_ERROR` | General SDK error |

## Examples

### Basic Usage

```typescript
const sdk = new RTA({
  frameSize: 20,
  encoding: { enabled: true, codec: 'opus' }
});

sdk.on('audio', (event) => {
  console.log('Audio frame:', event);
});

await sdk.start();
```

### With VAD

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      positiveSpeechThreshold: 0.3,
      modelPath: '/models/silero_vad_v5.onnx'
    }
  }
});

sdk.on('speech-state', (event) => {
  console.log(event.type === 'start' ? 'Speech started' : 'Speech ended');
  if (event.type === 'end' && event.segment) {
    console.log('Got speech segment:', event.segment.duration, 'ms');
  }
});

await sdk.start();
```

### Device Management

```typescript
const devices = await sdk.getDevices();
console.log('Available devices:', devices);

sdk.on('device', (event) => {
  if (event.type === 'unplugged') {
    console.log('Device unplugged, switching...');
  }
});

await sdk.setDevice(devices[0].deviceId);
```
