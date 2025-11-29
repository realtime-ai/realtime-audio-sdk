# SDK 使用指南

## 目录

- [快速开始](#快速开始)
- [基础概念](#基础概念)
- [完整配置说明](#完整配置说明)
- [API 参考](#api-参考)
- [使用场景](#使用场景)
- [常见问题](#常见问题)
- [最佳实践](#最佳实践)

## 快速开始

### 安装

```bash
npm install @realtime-ai/audio-sdk
```

### 最简单的使用

```typescript
import { RTA } from '@realtime-ai/audio-sdk';

// 创建实例（使用默认配置）
const sdk = new RTA();

// 监听统一的音频事件（包含所有帧数据）
sdk.on('audio', (event) => {
  const { audio, metadata, processing } = event;
  console.log('收到音频数据:', audio.encoded || audio.raw);
  console.log('编码格式:', audio.format); // 'opus' 或 'pcm'
  console.log('时间戳:', metadata.timestamp);
  console.log('音频能量:', processing.energy);
});

// 开始录音
await sdk.start();

// 停止录音
await sdk.stop();
```

## 基础概念

### 音频帧大小 (Frame Size)

音频帧大小决定了每次采集的音频时长，支持：
- **20ms** - 低延迟，适合实时对话
- **40ms** - 平衡延迟和性能
- **60ms** - 更大的缓冲，降低处理频率

**计算公式**：
```
帧数 = (帧大小ms × 采样率Hz) / 1000

例如：20ms @ 16kHz = 320 帧
     40ms @ 16kHz = 640 帧
     60ms @ 16kHz = 960 帧
```

### 采样率 (Sample Rate)

- **16000 Hz** (默认) - 适合语音，最常用
- **24000 Hz** - 更好的音质
- **48000 Hz** - 高保真音质

### 编码格式

#### Opus 编码（推荐）
- 使用 WebCodecs API
- 高压缩率，低延迟
- 浏览器要求：Chrome 94+, Safari 16.4+

#### PCM 编码（降级方案）
- 原始音频数据（16-bit PCM）
- 无压缩，数据量大
- 所有浏览器支持

### VAD (Voice Activity Detection)

语音活动检测，用于识别用户是否在说话：
- 基于音频能量阈值
- 带有迟滞（hysteresis）避免抖动
- 可配置最小语音/静音持续时间

## 完整配置说明

### SDK 配置对象

```typescript
interface SDKConfig {
  // 设备 ID（可选，不指定则使用默认设备）
  deviceId?: string;

  // 采样率（Hz）
  // 默认：16000
  // 常用值：8000, 16000, 24000, 48000
  sampleRate?: number;

  // 声道数
  // 默认：1（单声道）
  // 可选：2（立体声）
  channelCount?: number;

  // 音频帧大小（毫秒）
  // 默认：20
  // 可选值：20, 40, 60
  frameSize?: 20 | 40 | 60;

  // 编码配置
  encoding?: {
    enabled: boolean;      // 是否启用编码，默认 true
    codec: 'opus' | 'pcm'; // 编码格式，默认 'opus'
    bitrate?: number;      // Opus 比特率，默认 16000
    complexity?: number;   // Opus 复杂度 0-10，默认 5
  };

  // 音频处理配置
  processing?: {
    // VAD 配置
    vad?: {
      enabled: boolean;           // 启用 VAD
      threshold?: number;         // 能量阈值 0-1，默认 0.5
      minSpeechDuration?: number; // 最小语音持续时间（ms），默认 100
      minSilenceDuration?: number; // 最小静音持续时间（ms），默认 300
    };

    // 音频归一化
    normalize?: boolean; // 默认 false
  };

  // 设备拔出时自动切换到默认设备
  // 默认：true
  autoSwitchDevice?: boolean;
}
```

### 配置示例

#### 1. 实时对话配置（低延迟）

```typescript
const sdk = new RTA({
  frameSize: 20,        // 20ms 帧
  sampleRate: 16000,    // 16kHz
  channelCount: 1,      // 单声道
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 16000,
    complexity: 5,
  },
  processing: {
    vad: {
      enabled: true,
      threshold: 0.02,  // 较低阈值，更灵敏
    },
    normalize: true,
  },
});
```

#### 2. 转录配置（平衡）

```typescript
const sdk = new RTA({
  frameSize: 40,        // 40ms 帧
  sampleRate: 16000,
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 24000,     // 更高比特率
  },
  processing: {
    vad: {
      enabled: true,
      threshold: 0.05,
      minSpeechDuration: 200,
      minSilenceDuration: 500,
    },
  },
});
```

#### 3. 高质量录音配置

```typescript
const sdk = new RTA({
  frameSize: 60,
  sampleRate: 48000,    // 高采样率
  channelCount: 2,      // 立体声
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 64000,     // 高比特率
    complexity: 10,     // 最高质量
  },
  processing: {
    normalize: true,
  },
});
```

#### 4. 原始 PCM 数据配置

```typescript
const sdk = new RTA({
  frameSize: 20,
  sampleRate: 16000,
  encoding: {
    enabled: false,  // 禁用编码，直接输出 PCM
  },
});

// 监听音频事件，获取原始音频
sdk.on('audio', (event) => {
  console.log('PCM 数据:', event.audio.raw); // Float32Array
});
```

## API 参考

### RTA

#### 构造函数

```typescript
constructor(config?: SDKConfig)
```

#### 方法

##### start()

开始音频采集

```typescript
await sdk.start(): Promise<void>
```

**说明**：
- 请求麦克风权限（如未授权）
- 初始化编码器
- 开始音频采集
- 触发 `state` 事件

**错误处理**：
```typescript
try {
  await sdk.start();
} catch (error) {
  if (error.name === 'NotAllowedError') {
    console.error('用户拒绝麦克风权限');
  } else if (error.name === 'NotFoundError') {
    console.error('未找到音频设备');
  }
}
```

##### stop()

停止音频采集

```typescript
await sdk.stop(): Promise<void>
```

**说明**：
- 停止音频采集
- 刷新并关闭编码器
- 释放资源
- 触发 `state` 事件

##### pause()

暂停音频采集

```typescript
await sdk.pause(): Promise<void>
```

##### resume()

恢复音频采集

```typescript
await sdk.resume(): Promise<void>
```

##### getDevices()

获取所有音频输入设备

```typescript
await sdk.getDevices(): Promise<MediaDeviceInfo[]>
```

**示例**：
```typescript
const devices = await sdk.getDevices();
devices.forEach(device => {
  console.log(`${device.label} (${device.deviceId})`);
});
```

##### setDevice()

设置音频输入设备

```typescript
await sdk.setDevice(deviceId: string): Promise<void>
```

**示例**：
```typescript
const devices = await sdk.getDevices();
await sdk.setDevice(devices[0].deviceId);
```

**注意**：
- 如果正在录音，会自动重启采集
- 触发 `device` 事件 (type: 'changed')

##### updateConfig()

更新配置

```typescript
await sdk.updateConfig(config: Partial<SDKConfig>): Promise<void>
```

**示例**：
```typescript
// 切换编码器
await sdk.updateConfig({
  encoding: {
    enabled: true,
    codec: 'pcm',
  },
});

// 调整 VAD 阈值
await sdk.updateConfig({
  processing: {
    vad: {
      enabled: true,
      threshold: 0.03,
    },
  },
});
```

**注意**：如果正在录音，会先停止再重新开始

##### getState()

获取当前状态

```typescript
sdk.getState(): SDKState
```

返回值：`'idle' | 'recording' | 'paused' | 'error'`

##### getConfig()

获取当前配置

```typescript
sdk.getConfig(): Required<SDKConfig>
```

##### destroy()

销毁 SDK 实例

```typescript
await sdk.destroy(): Promise<void>
```

**说明**：
- 停止录音
- 移除所有事件监听器
- 释放所有资源

#### 事件

##### audio

统一的音频事件，包含所有帧数据

```typescript
sdk.on('audio', (event: AudioDataEvent) => {
  const { audio, metadata, processing } = event;

  // 音频数据
  console.log('原始音频:', audio.raw);           // Float32Array
  console.log('编码音频:', audio.encoded);       // ArrayBuffer (如果编码启用)
  console.log('编码格式:', audio.format);        // 'opus' | 'pcm'

  // 元数据
  console.log('时间戳:', metadata.timestamp);     // 毫秒
  console.log('帧索引:', metadata.frameIndex);
  console.log('采样率:', metadata.sampleRate);

  // 处理结果
  console.log('音频能量:', processing.energy);
  console.log('是否归一化:', processing.normalized);

  // VAD 结果（如果启用）
  if (processing.vad?.active) {
    console.log('是否语音:', processing.vad.isSpeech);
    console.log('概率:', processing.vad.probability);
    console.log('置信度:', processing.vad.confidence);
  }
});
```

##### speech-state

语音状态变化事件（开始/结束）

```typescript
sdk.on('speech-state', (event: VADStateEvent) => {
  if (event.type === 'start') {
    console.log('语音开始:', event.timestamp);
    console.log('概率:', event.probability);
  } else {
    console.log('语音结束:', event.timestamp);
    console.log('持续时长:', event.duration);
    if (event.segment) {
      console.log('语音片段音频:', event.segment.audio);      // Float32Array
      console.log('开始时间:', event.segment.startTime);
      console.log('结束时间:', event.segment.endTime);
      console.log('持续时长:', event.segment.duration);
      console.log('平均概率:', event.segment.avgProbability);
      console.log('置信度:', event.segment.confidence);
    }
  }
});
```

##### device

设备相关事件（统一）

```typescript
sdk.on('device', (event: DeviceEvent) => {
  switch (event.type) {
    case 'changed':
      console.log('切换到设备:', event.device?.label);
      break;
    case 'list-updated':
      console.log('设备列表更新:', event.devices?.length, '个设备');
      break;
    case 'unplugged':
      console.log('设备拔出:', event.deviceId);
      // 如果 autoSwitchDevice = true，会自动切换到默认设备
      break;
  }
});
```

##### state

SDK 状态改变

```typescript
sdk.on('state', (state: SDKState) => {
  console.log('状态:', state); // 'idle' | 'recording' | 'paused' | 'error'
});
```

##### error

错误发生

```typescript
sdk.on('error', (error: Error) => {
  console.error('SDK 错误:', error.message);
});
```

## 使用场景

### 场景 1：实时语音转录

```typescript
import { RTA } from '@realtime-ai/audio-sdk';

const sdk = new RTA({
  frameSize: 20,
  encoding: {
    enabled: true,
    codec: 'opus',
  },
  processing: {
    vad: {
      enabled: true,
      threshold: 0.02,
    },
  },
});

// 连接到转录服务
const ws = new WebSocket('wss://your-transcription-service.com/ws');

// 发送音频数据
sdk.on('audio', (event) => {
  if (ws.readyState === WebSocket.OPEN && event.audio.encoded) {
    ws.send(event.audio.encoded);
  }

  // 显示 VAD 状态
  if (event.processing.vad?.active && event.processing.vad.isSpeech) {
    console.log('🎤 用户正在说话...');
  }
});

// 接收转录结果
ws.onmessage = (event) => {
  const result = JSON.parse(event.data);
  console.log('转录结果:', result.text);
};

await sdk.start();
```

### 场景 2：实时翻译

```typescript
const sdk = new RTA({
  frameSize: 40,
  sampleRate: 16000,
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 24000,
  },
});

// 发送到翻译服务
sdk.on('audio', async (chunk) => {
  const response = await fetch('https://translation-api.com/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Source-Lang': 'zh-CN',
      'Target-Lang': 'en-US',
    },
    body: chunk.data,
  });

  const result = await response.json();
  console.log('翻译结果:', result.translatedText);
});

await sdk.start();
```

### 场景 3：AI 实时对话

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
      threshold: 0.02,
      minSpeechDuration: 100,
      minSilenceDuration: 500,
    },
  },
});

let isSpeaking = false;
const audioBuffer: ArrayBuffer[] = [];

// 缓存音频数据
sdk.on('audio', (chunk) => {
  if (isSpeaking) {
    audioBuffer.push(chunk.data);
  }
});

// 监听语音活动
sdk.on('audio', async (data) => {
  if (data.isSpeech && !isSpeaking) {
    // 开始说话
    isSpeaking = true;
    audioBuffer.length = 0;
    console.log('开始录音...');
  } else if (!data.isSpeech && isSpeaking) {
    // 停止说话
    isSpeaking = false;
    console.log('停止录音，发送到 AI...');

    // 合并音频并发送
    const blob = new Blob(audioBuffer, { type: 'audio/opus' });
    const response = await sendToAI(blob);
    console.log('AI 回复:', response);
  }
});

async function sendToAI(audioBlob: Blob) {
  const formData = new FormData();
  formData.append('audio', audioBlob);

  const response = await fetch('https://ai-service.com/chat', {
    method: 'POST',
    body: formData,
  });

  return response.json();
}

await sdk.start();
```

### 场景 4：多设备切换

```typescript
const sdk = new RTA({
  autoSwitchDevice: true, // 设备拔出时自动切换
});

// 获取并显示设备列表
async function updateDeviceList() {
  const devices = await sdk.getDevices();
  const select = document.getElementById('deviceSelect');

  select.innerHTML = '';
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    select.appendChild(option);
  });
}

// 监听设备选择
document.getElementById('deviceSelect').addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  await sdk.setDevice(deviceId);
  console.log('已切换设备');
});

// 监听设备变化
sdk.on('devices-updated', () => {
  console.log('设备列表已更新');
  updateDeviceList();
});

sdk.on('device-unplugged', (deviceId) => {
  console.log('设备被拔出:', deviceId);
  // autoSwitchDevice = true 时会自动切换
});

sdk.on('device', (device) => {
  console.log('当前设备:', device.label);
});

await updateDeviceList();
await sdk.start();
```

## 常见问题

### 1. 如何检测浏览器支持？

```typescript
import { OpusEncoder } from '@realtime-ai/audio-sdk';

// 检查 WebCodecs 支持
if (OpusEncoder.isSupported()) {
  console.log('✅ 支持 Opus 编码');
} else {
  console.log('⚠️ 不支持 Opus，将使用 PCM');
}

// 检查 AudioWorklet 支持
const audioContext = new AudioContext();
if (audioContext.audioWorklet) {
  console.log('✅ 支持 AudioWorklet');
} else {
  console.log('❌ 不支持 AudioWorklet，无法使用此 SDK');
}
```

### 2. 为什么收不到 `audio-data` 事件？

确保：
1. 已调用 `await sdk.start()`
2. 已授予麦克风权限
3. 有音频输入（检查麦克风是否静音）
4. 监听器在 `start()` 之前注册

```typescript
// ✅ 正确
sdk.on('audio', (chunk) => {
  console.log('收到数据');
});
await sdk.start();

// ❌ 错误（监听器注册太晚）
await sdk.start();
sdk.on('audio', (chunk) => {
  console.log('收到数据'); // 可能错过数据
});
```

### 3. VAD 不准确怎么办？

调整阈值和持续时间：

```typescript
// 环境安静 - 使用较低阈值
sdk.updateConfig({
  processing: {
    vad: {
      enabled: true,
      threshold: 0.01,  // 更灵敏
    },
  },
});

// 环境嘈杂 - 使用较高阈值
sdk.updateConfig({
  processing: {
    vad: {
      enabled: true,
      threshold: 0.05,  // 不太灵敏
    },
  },
});

// 避免频繁切换 - 增加持续时间
sdk.updateConfig({
  processing: {
    vad: {
      enabled: true,
      threshold: 0.02,
      minSpeechDuration: 300,   // 需要连续 300ms 才认为是语音
      minSilenceDuration: 1000, // 需要静音 1s 才认为停止
    },
  },
});
```

### 4. 如何降低延迟？

```typescript
const sdk = new RTA({
  frameSize: 20,        // 使用最小帧大小
  sampleRate: 16000,    // 不要使用过高采样率
  encoding: {
    enabled: true,
    codec: 'opus',
    complexity: 3,      // 降低编码复杂度
  },
});
```

### 5. 如何节省带宽？

```typescript
// 方案 1: 仅在检测到语音时发送
let shouldSend = false;

sdk.on('audio', (data) => {
  shouldSend = data.isSpeech ?? false;
});

sdk.on('audio', (chunk) => {
  if (shouldSend) {
    websocket.send(chunk.data);
  }
});

// 方案 2: 降低比特率
const sdk = new RTA({
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 8000,  // 降低比特率（音质会下降）
  },
});
```

### 6. 如何处理设备权限被拒绝？

```typescript
sdk.on('error', (error) => {
  if (error.message.includes('permission denied')) {
    // 显示提示
    alert('请授予麦克风权限以使用此功能');
  }
});

try {
  await sdk.start();
} catch (error) {
  if (error.name === 'NotAllowedError') {
    console.error('用户拒绝了麦克风权限');
    // 显示权限引导界面
  }
}
```

## 最佳实践

### 1. 资源清理

```typescript
// 组件卸载时清理
class AudioRecorder {
  private sdk: RTA;

  constructor() {
    this.sdk = new RTA();
  }

  async cleanup() {
    await this.sdk.destroy(); // 释放所有资源
  }
}

// React 示例
useEffect(() => {
  const sdk = new RTA();

  return () => {
    sdk.destroy(); // 组件卸载时清理
  };
}, []);
```

### 2. 错误恢复

```typescript
sdk.on('error', async (error) => {
  console.error('错误:', error);

  // 尝试恢复
  if (sdk.getState() === 'error') {
    await sdk.stop();
    setTimeout(async () => {
      try {
        await sdk.start();
        console.log('已恢复录音');
      } catch (e) {
        console.error('恢复失败:', e);
      }
    }, 1000);
  }
});
```

### 3. 性能优化

```typescript
// 使用 Web Worker 处理音频数据
const worker = new Worker('audio-processor.worker.js');

sdk.on('audio', (chunk) => {
  // 转移所有权到 Worker，避免拷贝
  worker.postMessage({ chunk }, [chunk.data]);
});

// audio-processor.worker.js
self.onmessage = (e) => {
  const chunk = e.data.chunk;
  // 在 Worker 中处理音频
  // 例如：发送到服务器、本地存储等
};
```

### 4. 类型安全

```typescript
import type {
  RTA,
  SDKConfig,
  EncodedAudioChunk,
  ProcessedAudioData
} from '@realtime-ai/audio-sdk';

// 定义配置
const config: SDKConfig = {
  frameSize: 20,
  encoding: {
    enabled: true,
    codec: 'opus',
  },
};

// 类型安全的事件处理
sdk.on('audio', (chunk: EncodedAudioChunk) => {
  // chunk 有完整的类型提示
  console.log(chunk.timestamp);
});
```

### 5. 调试和监控

```typescript
// 添加详细日志
sdk.on('state', (state) => {
  console.log(`[${new Date().toISOString()}] 状态: ${state}`);
});

sdk.on('device', (device) => {
  console.log(`[${new Date().toISOString()}] 设备: ${device.label}`);
});

sdk.on('audio', (data) => {
  console.log(`[${new Date().toISOString()}] 能量: ${data.energy.toFixed(3)}, 语音: ${data.isSpeech}`);
});

// 性能监控
let chunkCount = 0;
let startTime = Date.now();

sdk.on('audio', (chunk) => {
  chunkCount++;
  if (chunkCount % 100 === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const fps = chunkCount / elapsed;
    console.log(`处理速率: ${fps.toFixed(2)} chunks/s`);
  }
});
```

---

更多示例请查看 [examples](../examples) 目录。
