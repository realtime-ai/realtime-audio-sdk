# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Realtime Audio SDK for the Web — provides audio capture, voice activity detection (VAD), and real-time encoding (Opus/PCM). Designed for real-time transcription, translation, and AI voice conversations.

## Development Commands

```bash
# Install dependencies
npm install

# Development server (runs examples)
npm run dev

# Build library
npm run build

# Type checking
npm run type-check

# Run tests
npm test
npm run test:ui
npm run test:coverage
```

## Project Structure

```
src/
├── core/
│   ├── EventEmitter.ts       # Event system base class
│   └── RTA.ts   # Main SDK entry point
├── capture/
│   ├── AudioCapture.ts            # Audio capture with AudioWorklet
│   └── audio-worklet-processor.ts # Worklet processor (runs in audio thread)
├── devices/
│   └── DeviceManager.ts      # Device enumeration and hot-plug detection
├── processing/
│   └── AudioProcessor.ts     # VAD and audio normalization
├── encoding/
│   ├── OpusEncoder.ts        # WebCodecs Opus encoder
│   └── PCMEncoder.ts         # Fallback PCM encoder
└── types/
    └── index.ts              # TypeScript type definitions
```

## Architecture

### Audio Pipeline Flow

1. **Device Management** ([DeviceManager.ts](src/devices/DeviceManager.ts))
   - Lists available audio input devices
   - Monitors device hot-plug events
   - Auto-switches on device removal (if enabled)

2. **Audio Capture** ([AudioCapture.ts](src/capture/AudioCapture.ts))
   - Uses `getUserMedia` to access microphone
   - Creates `AudioContext` with specified sample rate
   - Loads AudioWorklet processor for precise time chunking

3. **AudioWorklet Processing** ([audio-worklet-processor.ts](src/capture/audio-worklet-processor.ts))
   - Runs in separate audio thread
   - Buffers 128-frame blocks from Web Audio API
   - Extracts exact frame counts (320/640/960 frames for 20/40/60ms @ 16kHz)
   - Sends chunks to main thread via `postMessage`

4. **Audio Processing** ([AudioProcessor.ts](src/processing/AudioProcessor.ts))
   - Normalizes audio to [-1, 1] range (optional)
   - Calculates energy (RMS)
   - Performs energy-based VAD with hysteresis

5. **Encoding** ([OpusEncoder.ts](src/encoding/OpusEncoder.ts) / [PCMEncoder.ts](src/encoding/PCMEncoder.ts))
   - OpusEncoder: Uses WebCodecs API for Opus encoding
   - PCMEncoder: Fallback for browsers without WebCodecs
   - Converts Float32 to Int16 PCM or Opus frames

6. **Event Emission** ([RTA.ts](src/core/RTA.ts))
   - Emits `audio-data` events with encoded chunks
   - Emits `processed-audio` events with VAD results
   - Emits device and state change events

### Key Design Patterns

- **EventEmitter Pattern**: All modules extend EventEmitter for loose coupling
- **Async Initialization**: Encoders and capture must be initialized before use
- **Resource Cleanup**: All modules provide cleanup methods (close/stop/destroy)
- **Graceful Degradation**: Falls back to PCM when WebCodecs unavailable

### Important Implementation Details

1. **Precise Time Chunking**
   - AudioWorklet receives 128-frame blocks (Web Audio API standard)
   - Processor buffers blocks and extracts exact frame counts
   - Formula: `frames = (frameSize_ms * sampleRate) / 1000`

2. **Device Switching**
   - Stops current stream
   - Creates new MediaStream with new deviceId
   - Reconnects AudioWorklet
   - Optionally resumes recording state

3. **VAD Hysteresis**
   - Requires sustained energy above threshold before marking as speech
   - Requires sustained silence before marking as non-speech
   - Prevents flickering on threshold boundary

4. **WebCodecs Opus Configuration**
   - Codec: 'opus'
   - frameDuration in microseconds (frameSize * 1000)
   - Format: 'opus' (raw Opus packets)

## Common Tasks

### Adding a New Audio Processor

1. Create processor class in `src/processing/`
2. Add configuration to `ProcessingConfig` in [types/index.ts](src/types/index.ts)
3. Integrate in [AudioProcessor.ts](src/processing/AudioProcessor.ts) process method
4. Update SDK config in [RTA.ts](src/core/RTA.ts)

### Adding a New Encoder

1. Create encoder class in `src/encoding/`
2. Implement interface: `initialize()`, `encode()`, `flush()`, `close()`
3. Add codec type to `AudioCodec` in [types/index.ts](src/types/index.ts)
4. Add initialization logic in [RTA.ts](src/core/RTA.ts):initializeEncoder()

### Modifying AudioWorklet

- AudioWorklet code must be inlined as string or loaded from blob URL
- Cannot use ES6 imports in worklet context
- Must use `postMessage` for communication with main thread
- See [AudioCapture.ts](src/capture/AudioCapture.ts):getWorkletCode()

## Browser Compatibility Notes

- **AudioWorklet**: Chrome 66+, Firefox 76+, Safari 14.1+
- **WebCodecs**: Chrome 94+, Edge 94+, Safari 16.4+
- **getUserMedia**: All modern browsers

Always check feature availability:
```typescript
if (!('AudioEncoder' in window)) {
  // Use PCM fallback
}
```

## Testing Considerations

- Audio APIs require user gesture in browsers (can't automate easily)
- Use mocked MediaStream for unit tests
- Integration tests need actual microphone access
- Test device switching with virtual audio devices

---

## Design Proposal

### 项目需求

**核心能力**：
1. Web 端音频采集，支持 20ms、40ms、60ms 时间分片
2. 列举音频设备、支持设备选择、设备热插拔检测和自动切换
3. 支持采样率配置，默认单声道 16kHz
4. 通过 WebCodecs API 进行 Opus 编码

**使用场景**：
- 实时语音转录
- 实时语音翻译
- 实时 AI 对话

### 技术方案

#### 1. 模块架构

```
┌─────────────────────────────────────────────────────────┐
│                   RTA                       │
│  (主入口、配置管理、事件协调)                             │
└────────────┬────────────────────────────────────────────┘
             │
     ┌───────┴───────┬───────────┬──────────┬──────────┐
     │               │           │          │          │
┌────▼────┐  ┌──────▼──────┐ ┌─▼────┐  ┌──▼─────┐ ┌──▼──────┐
│ Device  │  │   Audio     │ │Audio │  │ Opus   │ │  PCM    │
│ Manager │  │   Capture   │ │Proc. │  │Encoder │ │Encoder  │
└─────────┘  └─────────────┘ └──────┘  └────────┘ └─────────┘
                    │
            ┌───────▼────────┐
            │ AudioWorklet   │
            │   Processor    │
            │ (音频线程)      │
            └────────────────┘
```

#### 2. 音频采集流程

**精确时间分片实现**：

问题：Web Audio API 的 AudioWorklet 每次处理固定的 128 帧，无法直接对应 20/40/60ms

解决方案：
```typescript
// 在 AudioWorklet 中缓冲音频帧
class AudioCaptureProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array[] = [];
  private framesPerChunk: number;

  constructor() {
    super();
    // 计算目标帧数
    // 例: 20ms @ 16kHz = 320 frames
    this.framesPerChunk = (frameSize * sampleRate) / 1000;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0][0]; // 128 frames

    // 累积到缓冲区
    this.buffer.push(new Float32Array(input));

    const totalFrames = this.buffer.reduce((sum, arr) => sum + arr.length, 0);

    // 当累积够目标帧数时提取
    if (totalFrames >= this.framesPerChunk) {
      const chunk = this.extractExactFrames(this.framesPerChunk);
      this.port.postMessage({ type: 'audio-data', data: chunk });
    }

    return true;
  }

  extractExactFrames(count: number): Float32Array {
    const result = new Float32Array(count);
    let offset = 0;

    while (offset < count && this.buffer.length > 0) {
      const block = this.buffer[0];
      const remaining = count - offset;

      if (block.length <= remaining) {
        result.set(block, offset);
        offset += block.length;
        this.buffer.shift();
      } else {
        result.set(block.subarray(0, remaining), offset);
        this.buffer[0] = block.subarray(remaining);
        offset += remaining;
      }
    }

    return result;
  }
}
```

#### 3. 设备管理方案

**设备枚举**：
```typescript
async getDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audioinput');
}
```

**热插拔检测**：
```typescript
navigator.mediaDevices.addEventListener('devicechange', async () => {
  const currentDevices = await this.getDevices();

  // 检测当前设备是否被拔出
  if (this.currentDeviceId) {
    const exists = currentDevices.some(d => d.deviceId === this.currentDeviceId);
    if (!exists) {
      this.emit('device-unplugged', this.currentDeviceId);

      // 自动切换到默认设备
      if (this.autoSwitchDevice) {
        const defaultDevice = await this.getDefaultDevice();
        await this.switchDevice(defaultDevice.deviceId);
      }
    }
  }

  this.emit('devices-updated', currentDevices);
});
```

**设备切换流程**：
```typescript
async switchDevice(newDeviceId: string): Promise<void> {
  const wasRecording = this.isRecording;

  // 1. 停止当前采集
  await this.stopCapture();

  // 2. 创建新的 MediaStream
  this.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: newDeviceId } }
  });

  // 3. 重新连接 AudioWorklet
  this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
  this.sourceNode.connect(this.workletNode);

  // 4. 恢复录音状态
  if (wasRecording) {
    await this.startCapture();
  }

  this.emit('device-changed', newDeviceId);
}
```

#### 4. Opus 编码方案

**WebCodecs API 配置**：
```typescript
const encoderConfig: AudioEncoderConfig = {
  codec: 'opus',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitrate: 16000,
  opus: {
    complexity: 5,              // 0-10，复杂度
    frameDuration: 20 * 1000,   // 微秒 (20ms)
    format: 'opus',             // 'opus' 或 'ogg'
  }
};

this.encoder = new AudioEncoder({
  output: (chunk, metadata) => {
    // 编码完成的回调
    const buffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(buffer);
    this.emit('encoded-audio', buffer);
  },
  error: (error) => {
    console.error('Opus encoding error:', error);
  }
});

await this.encoder.configure(encoderConfig);
```

**编码流程**：
```typescript
async encode(audioData: Float32Array, timestamp: number): Promise<void> {
  // 创建 AudioData
  const audioDataObj = new AudioData({
    format: 'f32-planar',
    sampleRate: this.sampleRate,
    numberOfFrames: audioData.length,
    numberOfChannels: 1,
    timestamp: timestamp * 1000000, // 转换为微秒
    data: audioData,
  });

  // 编码
  this.encoder.encode(audioDataObj);
  audioDataObj.close();

  // 刷新编码器
  await this.encoder.flush();
}
```

**降级方案（PCM）**：
```typescript
// 当 WebCodecs 不支持时
if (!('AudioEncoder' in window)) {
  console.warn('WebCodecs not supported, using PCM fallback');

  // 转换为 Int16 PCM
  const pcm = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    const s = Math.max(-1, Math.min(1, audioData[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  this.emit('encoded-audio', pcm.buffer);
}
```

#### 5. VAD (语音活动检测) 方案

**基于能量的 VAD 实现**：
```typescript
class VAD {
  private isSpeech = false;
  private speechStartTime = 0;
  private silenceStartTime = 0;

  detect(audioData: Float32Array, timestamp: number, threshold: number): boolean {
    // 计算能量 (RMS)
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const energy = Math.sqrt(sum / audioData.length);

    const isSpeechNow = energy > threshold;

    // 状态机：带迟滞避免抖动
    if (isSpeechNow && !this.isSpeech) {
      if (this.speechStartTime === 0) {
        this.speechStartTime = timestamp;
      }
      // 需要持续 100ms 才认为是语音
      if (timestamp - this.speechStartTime >= 0.1) {
        this.isSpeech = true;
        this.silenceStartTime = 0;
      }
    } else if (!isSpeechNow && this.isSpeech) {
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = timestamp;
      }
      // 需要静音 300ms 才认为停止
      if (timestamp - this.silenceStartTime >= 0.3) {
        this.isSpeech = false;
        this.speechStartTime = 0;
      }
    }

    return this.isSpeech;
  }
}
```

#### 6. 完整数据流

```
用户麦克风
    ↓
getUserMedia → MediaStream
    ↓
AudioContext.createMediaStreamSource()
    ↓
AudioWorkletNode (主线程)
    ↓
AudioWorkletProcessor (音频线程)
    ├─ 接收 128 帧块
    ├─ 缓冲并组装成目标帧数 (320/640/960)
    └─ postMessage 发送到主线程
    ↓
AudioCapture (主线程)
    └─ emit('audio-data', Float32Array)
    ↓
AudioProcessor
    ├─ 归一化
    ├─ 计算能量
    └─ VAD 检测
    ↓
AudioEncoder
    ├─ WebCodecs Opus (优先)
    └─ PCM fallback
    ↓
RTA
    └─ emit('audio-data', EncodedAudioChunk)
    ↓
应用层 (WebSocket 发送)
```

#### 7. 使用示例

```typescript
// 初始化 SDK
const sdk = new RTA({
  sampleRate: 16000,
  channelCount: 1,
  frameSize: 20,
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
  },
  autoSwitchDevice: true,
});

// 监听音频数据
sdk.on('audio-data', (chunk) => {
  // 发送到服务器
  websocket.send(chunk.data);
});

// 监听 VAD
sdk.on('processed-audio', (data) => {
  if (data.isSpeech) {
    console.log('用户正在说话');
  }
});

// 设备管理
const devices = await sdk.getDevices();
await sdk.setDevice(devices[0].deviceId);

// 开始采集
await sdk.start();
```

### 浏览器兼容性

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| AudioWorklet | 66+ | 76+ | 14.1+ | 79+ |
| WebCodecs | 94+ | ❌ | 16.4+ | 94+ |
| getUserMedia | ✅ | ✅ | ✅ | ✅ |

**降级策略**：
- WebCodecs 不支持 → 使用 PCM 编码
- AudioWorklet 不支持 → SDK 无法使用（必需）

### 性能优化

1. **零拷贝**：使用 `Transferable` 对象传递音频数据
2. **内存池**：复用 `Float32Array` 和 `ArrayBuffer`
3. **Web Worker**：将编码移到 Worker 避免阻塞主线程
4. **批处理**：支持批量发送减少事件频率

### 技术难点与解决方案

| 难点 | 解决方案 |
|------|----------|
| 精确时间分片 | AudioWorklet 缓冲区分段提取 |
| 设备热插拔 | `devicechange` 事件 + 状态对比 |
| 编码兼容性 | WebCodecs 检测 + PCM 降级 |
| 低延迟 | AudioWorklet + 最小缓冲 |
| VAD 抖动 | 迟滞状态机 |

### 项目文件

完整实现请参考：
- [使用文档](../docs/usage-guide.md)
- [示例代码](../examples/)
- [源代码](../src/)
