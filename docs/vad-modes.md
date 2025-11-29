# VAD 工作模式设计文档

## 概述

Realtime Audio SDK 的 VAD（Voice Activity Detection）支持两种工作模式：

- **Passthrough 模式（透传模式）** - 返回所有音频帧，同时提供 VAD 检测结果
- **Filter 模式（过滤模式）** - 仅返回检测到语音的音频片段，自动过滤静音

两种模式都使用相同的 Silero VAD 神经网络模型，只是音频数据的输出策略不同。

## 快速对比

| 特性 | Passthrough 模式 | Filter 模式 |
|------|-----------------|------------|
| **'audio' 事件频率** | 每帧都触发 | 仅语音时触发 |
| **带宽消耗** | 高（100%） | 低（减少 50-80%） |
| **时间轴连续性** | ✅ 连续 | ❌ 有跳跃（仅语音段） |
| **Pre-speech Padding** | ❌ 需手动实现 | ✅ 自动包含 |
| **Post-speech Padding** | ❌ 需手动实现 | ✅ 自动包含 |
| **适用场景** | 完整录音、后端处理 VAD | 实时转录、低带宽场景 |
| **默认模式** | ✅ 是（向后兼容） | ❌ 否 |

## Passthrough 模式（默认）

### 行为特性

Passthrough 模式是**默认模式**，保持所有音频帧的连续输出：

- ✅ 每个音频帧都触发 `audio` 事件
- ✅ 保持完整的时间轴连续性
- ✅ VAD 结果作为元数据包含在事件中
- ✅ 适合需要完整音频流的场景

### 基础用法

```typescript
import { RTA } from '@realtime-ai/audio-sdk';

const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'passthrough',  // 可省略，默认就是 passthrough
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      preSpeechPadDuration: 800,
      silenceDuration: 1400,
    }
  }
});

// 所有音频帧都会收到
sdk.on('audio', (event) => {
  console.log('帧索引:', event.metadata.frameIndex);
  console.log('时间戳:', event.metadata.timestamp);

  // VAD 结果（可能滞后几帧）
  if (event.processing.vad) {
    console.log('是否语音:', event.processing.vad.isSpeech);
    console.log('概率:', event.processing.vad.probability);
    console.log('置信度:', event.processing.vad.confidence);
  }

  // 发送所有音频到服务器
  websocket.send(event.audio.encoded);
});

// 实时 VAD 结果（异步，更准确）
sdk.on('vad-result', (event) => {
  console.log(`VAD: ${event.isSpeech ? '🎤 语音' : '🔇 静音'} (${event.probability.toFixed(2)})`);
  updateUIIndicator(event.isSpeech);
});

// 语音段边界
sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    console.log('🎤 用户开始说话');
  } else {
    console.log('🔇 用户停止说话, 时长:', event.duration, 'ms');

    // 可以获取完整的语音段（包含 pre-padding）
    if (event.segment) {
      console.log('语音段长度:', event.segment.audio.length, '样本');
      console.log('平均概率:', event.segment.avgProbability);
      // 可选：发送到转录服务
      sendToTranscription(event.segment.audio);
    }
  }
});

await sdk.start();
```

### 使用场景

#### 1. 完整音频录制

```typescript
// 录制完整的会议音频，保留所有内容
const audioChunks: ArrayBuffer[] = [];

sdk.on('audio', (event) => {
  if (event.audio.encoded) {
    audioChunks.push(event.audio.encoded);
  }
});

sdk.on('speech-state', (event) => {
  // 仅用于 UI 提示
  if (event.type === 'start') {
    showSpeakingIndicator();
  } else {
    hideSpeakingIndicator();
  }
});
```

#### 2. 后端处理 VAD

```typescript
// 发送所有音频到服务器，由服务器决定如何处理
sdk.on('audio', (event) => {
  websocket.send(JSON.stringify({
    audio: arrayBufferToBase64(event.audio.encoded),
    isSpeech: event.processing.vad?.isSpeech,
    probability: event.processing.vad?.probability,
    timestamp: event.metadata.timestamp
  }));
});
```

#### 3. 需要精确时间轴的应用

```typescript
// 音频分析工具，需要完整时间轴
const timeline: Array<{timestamp: number, energy: number, isSpeech: boolean}> = [];

sdk.on('audio', (event) => {
  timeline.push({
    timestamp: event.metadata.timestamp,
    energy: event.processing.energy,
    isSpeech: event.processing.vad?.isSpeech || false
  });
});
```

## Filter 模式

### 行为特性

Filter 模式**仅输出语音片段**，自动过滤静音：

- ✅ 仅在检测到语音时触发 `audio` 事件
- ✅ 自动包含 pre-speech padding（语音前缓冲）
- ✅ 自动包含 post-speech padding（语音后缓冲）
- ✅ 显著减少网络带宽消耗（50-80%）
- ⚠️ 时间轴不连续（仅包含语音段）

### 基础用法

```typescript
import { RTA } from '@realtime-ai/audio-sdk';

const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',  // 🔥 启用 Filter 模式

      // VAD 参数
      positiveSpeechThreshold: 0.3,     // 语音检测阈值
      negativeSpeechThreshold: 0.25,    // 静音检测阈值
      preSpeechPadDuration: 800,        // 语音前保留 800ms
      silenceDuration: 1400,             // 静音 1400ms 后结束
      minSpeechDuration: 400,            // 最小语音时长 400ms
    }
  }
});

// 只会收到语音部分的音频帧
sdk.on('audio', (event) => {
  // 在 filter 模式下，event.processing.vad.isSpeech 永远是 true
  console.log('语音帧:', event.metadata.frameIndex);

  // 只发送语音部分，节省带宽
  websocket.send(event.audio.encoded);
});

// vad-result 仍然包含所有帧的结果（用于调试或 UI 显示）
sdk.on('vad-result', (event) => {
  // 所有帧（包括静音帧）的 VAD 结果
  updateVADIndicator(event.isSpeech, event.probability);
});

// 语音段边界
sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    console.log('🎤 语音开始');
    // 在此之前，SDK 已经发送了 pre-padding 的音频帧
  } else {
    console.log('🔇 语音结束, 时长:', event.duration, 'ms');
    // 完整的语音段数据
    if (event.segment) {
      console.log('语音段数据:', event.segment.audio);
    }
  }
});

await sdk.start();
```

### Pre-speech Padding（语音前填充）

Filter 模式自动在语音开始前包含一段缓冲音频，避免切掉开头的辅音：

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',
      preSpeechPadDuration: 800,  // 语音前保留 800ms
    }
  }
});

sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    // 在收到此事件之前，SDK 已经通过 'audio' 事件
    // 发送了过去 800ms 的音频帧
    console.log('语音开始，已发送 800ms pre-padding');
  }
});
```

**工作原理**：
1. SDK 始终在内部维护一个环形缓冲区
2. 当检测到语音开始时，从缓冲区提取 `preSpeechPadDuration` 时长的音频
3. 先通过 `audio` 事件发送这些缓冲的音频帧
4. 然后触发 `speech-state` 'start' 事件
5. 继续发送后续的语音帧

### Post-speech Padding（语音后填充）

Filter 模式在语音结束后继续发送一段音频，避免切掉结尾的尾音：

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',
      silenceDuration: 1400,  // 静音 1400ms 后才结束
    }
  }
});
```

**工作原理**：
1. 当检测到可能的语音结束时（概率低于阈值），进入 `potential_end` 状态
2. 在 `potential_end` 状态期间，继续发送音频帧
3. 只有当持续静音达到 `silenceDuration` 时长后，才真正结束
4. 这段 `potential_end` 期间的音频就是 post-speech padding

### 使用场景

#### 1. 实时语音转录（节省带宽）

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',
      preSpeechPadDuration: 800,
      silenceDuration: 1200,
    }
  }
});

// 只发送语音片段到转录服务
sdk.on('audio', (event) => {
  // 相比 passthrough 模式，减少 50-80% 的数据传输
  websocket.send({
    type: 'audio',
    data: event.audio.encoded
  });
});

sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    websocket.send({ type: 'speech-start' });
  } else {
    websocket.send({ type: 'speech-end' });
  }
});
```

#### 2. 语音助手对话

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',
      minSpeechDuration: 400,    // 至少 400ms 才算语音
      silenceDuration: 1000,      // 1 秒静音后结束
    }
  }
});

const currentUtterance: ArrayBuffer[] = [];

sdk.on('audio', (event) => {
  if (event.audio.encoded) {
    currentUtterance.push(event.audio.encoded);
  }
});

sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    currentUtterance.length = 0;  // 清空缓冲
  } else if (event.type === 'end') {
    // 用户说完了，发送完整的话语到 AI
    sendToAI(currentUtterance);
    currentUtterance.length = 0;
  }
});
```

#### 3. 低带宽环境

```typescript
const sdk = new RTA({
  sampleRate: 16000,
  frameSize: 40,  // 使用 40ms 帧减少事件频率
  encoding: {
    enabled: true,
    codec: 'opus',
    bitrate: 12000,  // 降低码率
  },
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',  // 只发送语音，进一步节省带宽
    }
  }
});

sdk.on('audio', (event) => {
  // 总带宽消耗 = 12kbps × 语音占比（通常 20-40%）
  // 实际带宽: ~2.4-4.8 kbps
  sendCompressedAudio(event.audio.encoded);
});
```

## 配置参数详解

### VADConfig 接口

```typescript
interface VADConfig {
  /** 是否启用 VAD */
  enabled: boolean;

  /**
   * 工作模式
   * - 'passthrough': 返回所有音频帧（默认）
   * - 'filter': 仅返回语音片段
   *
   * @default 'passthrough'
   */
  mode?: 'filter' | 'passthrough';

  /**
   * 语音检测阈值（0-1）
   * 概率超过此值开始检测语音
   *
   * @default 0.3
   * 建议范围: 0.2-0.5
   * - 安静环境: 0.2-0.3
   * - 噪音环境: 0.4-0.5
   */
  positiveSpeechThreshold?: number;

  /**
   * 静音检测阈值（0-1）
   * 概率低于此值检测为静音
   *
   * @default 0.25
   * 建议: 略低于 positiveSpeechThreshold
   */
  negativeSpeechThreshold?: number;

  /**
   * 持续静音多久后结束语音段（毫秒）
   *
   * @default 1400
   * 建议范围: 800-2000
   * - 快速响应: 800-1000ms
   * - 避免切断句子: 1400-2000ms
   */
  silenceDuration?: number;

  /**
   * 语音前填充时长（毫秒）
   * Filter 模式下，语音开始前保留的音频时长
   *
   * @default 800
   * 建议范围: 500-1000
   */
  preSpeechPadDuration?: number;

  /**
   * 最小语音时长（毫秒）
   * 短于此时长的不算语音
   *
   * @default 400
   * 建议范围: 300-600
   */
  minSpeechDuration?: number;

  /**
   * ONNX 模型路径
   *
   * @default '/models/silero_vad_v5.onnx'
   */
  modelPath?: string;
}
```

### 参数调优指南

#### 安静办公室环境
```typescript
vad: {
  enabled: true,
  mode: 'filter',
  positiveSpeechThreshold: 0.3,
  negativeSpeechThreshold: 0.25,
  silenceDuration: 1400,
  preSpeechPadDuration: 800,
}
```

#### 嘈杂咖啡厅环境
```typescript
vad: {
  enabled: true,
  mode: 'filter',
  positiveSpeechThreshold: 0.5,      // 提高阈值避免误检
  negativeSpeechThreshold: 0.35,
  silenceDuration: 1000,              // 缩短静音时长
  preSpeechPadDuration: 600,
  minSpeechDuration: 500,             // 提高最小时长
}
```

#### 快速响应场景（语音助手）
```typescript
vad: {
  enabled: true,
  mode: 'filter',
  positiveSpeechThreshold: 0.3,
  negativeSpeechThreshold: 0.25,
  silenceDuration: 800,               // 更短的静音时长
  preSpeechPadDuration: 500,
  minSpeechDuration: 300,
}
```

#### 避免切断长句子
```typescript
vad: {
  enabled: true,
  mode: 'filter',
  positiveSpeechThreshold: 0.3,
  negativeSpeechThreshold: 0.2,       // 更低的静音阈值
  silenceDuration: 2000,              // 更长的静音时长
  preSpeechPadDuration: 1000,
  minSpeechDuration: 400,
}
```

## 模式切换

### 运行时切换模式

```typescript
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'passthrough',
    }
  }
});

await sdk.start();

// 网络带宽降低时，切换为 filter 模式
navigator.connection?.addEventListener('change', async () => {
  const connection = navigator.connection;

  if (connection.effectiveType === '2g' || connection.effectiveType === '3g') {
    console.log('网络较慢，切换为 Filter 模式节省带宽');
    await sdk.updateConfig({
      processing: {
        vad: {
          enabled: true,
          mode: 'filter',
        }
      }
    });
  }
});
```

### 根据场景动态选择

```typescript
function createSDK(scenario: 'recording' | 'transcription' | 'assistant') {
  const baseConfig = {
    sampleRate: 16000,
    channelCount: 1,
    frameSize: 20,
  };

  switch (scenario) {
    case 'recording':
      // 录音场景：使用 passthrough 保留完整音频
      return new RTA({
        ...baseConfig,
        processing: {
          vad: {
            enabled: true,
            mode: 'passthrough',
          }
        }
      });

    case 'transcription':
      // 转录场景：使用 filter 节省带宽
      return new RTA({
        ...baseConfig,
        processing: {
          vad: {
            enabled: true,
            mode: 'filter',
            preSpeechPadDuration: 800,
            silenceDuration: 1400,
          }
        }
      });

    case 'assistant':
      // 助手场景：使用 filter 快速响应
      return new RTA({
        ...baseConfig,
        processing: {
          vad: {
            enabled: true,
            mode: 'filter',
            silenceDuration: 800,
            minSpeechDuration: 300,
          }
        }
      });
  }
}
```

## 事件对比

### Passthrough 模式事件流

```
时间轴：[--------语音--------][--静音--][----语音----][静音]

'audio' 事件：
  ████████████████████████████████████████████████████
  (所有帧都触发)

'vad-result' 事件：
  ████████████████████████████████████████████████████
  (所有帧都触发，提供 isSpeech 和 probability)

'speech-state' 事件：
          ↑start                    ↑end  ↑start    ↑end
```

### Filter 模式事件流

```
时间轴：[--------语音--------][--静音--][----语音----][静音]

'audio' 事件：
      ███████████████████████             ████████████
      (只有语音片段触发，包含 padding)

'vad-result' 事件：
  ████████████████████████████████████████████████████
  (所有帧都触发，无论是否过滤)

'speech-state' 事件：
          ↑start                    ↑end  ↑start    ↑end
          (同 passthrough)
```

## 性能考虑

### 带宽消耗对比

假设：
- 采样率：16kHz
- 帧大小：20ms
- 编码：Opus @ 16kbps
- 语音占比：30%（典型会话）

| 模式 | 数据传输率 | 相对带宽 | 节省 |
|------|----------|---------|------|
| Passthrough | 16 kbps | 100% | 0% |
| Filter | ~4.8 kbps | 30% | 70% |

### CPU 使用

两种模式的 CPU 使用相同，因为 VAD 检测始终在后台运行：

- VAD 推理：~5-15% CPU
- 音频处理：~2-5% CPU
- 编码：~3-8% CPU

### 内存使用

| 组件 | Passthrough | Filter |
|------|------------|--------|
| VAD 模型 | 4.4 MB | 4.4 MB |
| 音频缓冲 | ~10 MB | ~15 MB (+环形缓冲区) |
| 总计 | ~14 MB | ~19 MB |

## 最佳实践

### 1. 选择合适的模式

```typescript
// ✅ 推荐：明确场景，选择合适的模式
const transcriptionSDK = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',  // 转录场景使用 filter
    }
  }
});

const recordingSDK = new RTA({
  processing: {
    vad: {
      enabled: true,
      mode: 'passthrough',  // 录音场景使用 passthrough
    }
  }
});
```

### 2. 合理设置 Padding

```typescript
// ✅ 推荐：根据语言特性调整 padding
const config = {
  processing: {
    vad: {
      enabled: true,
      mode: 'filter',
      // 中文、英文：800ms pre-padding 足够
      preSpeechPadDuration: 800,
      // 德语、俄语等辅音较多的语言：可增加到 1000ms
      // preSpeechPadDuration: 1000,
    }
  }
};
```

### 3. 处理语音段

```typescript
// ✅ 推荐：利用 speech-state 事件处理完整语音段
const currentSegment: ArrayBuffer[] = [];

sdk.on('audio', (event) => {
  if (event.audio.encoded) {
    currentSegment.push(event.audio.encoded);
  }
});

sdk.on('speech-state', (event) => {
  if (event.type === 'start') {
    currentSegment.length = 0;
  } else if (event.type === 'end') {
    // 处理完整的语音段
    processSegment(currentSegment);

    // 或者使用 segment.audio（Float32Array 原始音频）
    if (event.segment) {
      processRawAudio(event.segment.audio);
    }
  }
});
```

### 4. 调试 VAD

```typescript
// ✅ 推荐：使用 vad-result 事件调试
let speechFrames = 0;
let silenceFrames = 0;

sdk.on('vad-result', (event) => {
  if (event.isSpeech) {
    speechFrames++;
  } else {
    silenceFrames++;
  }

  // 每秒打印一次统计
  if ((speechFrames + silenceFrames) % 50 === 0) {  // 50 frames @ 20ms = 1 second
    const total = speechFrames + silenceFrames;
    console.log(`语音占比: ${((speechFrames / total) * 100).toFixed(1)}%`);
  }
});
```

### 5. 网络自适应

```typescript
// ✅ 推荐：根据网络状况自动调整
class AdaptiveVAD {
  private sdk: RTA;
  private currentMode: 'filter' | 'passthrough' = 'passthrough';

  async adjustForBandwidth(availableBandwidth: number) {
    // 带宽低于 50kbps 时，使用 filter 模式
    const shouldUseFilter = availableBandwidth < 50000;
    const targetMode = shouldUseFilter ? 'filter' : 'passthrough';

    if (targetMode !== this.currentMode) {
      console.log(`切换 VAD 模式: ${targetMode} (带宽: ${availableBandwidth}bps)`);
      await this.sdk.updateConfig({
        processing: {
          vad: {
            enabled: true,
            mode: targetMode,
          }
        }
      });
      this.currentMode = targetMode;
    }
  }
}
```

## 故障排除

### 问题：Filter 模式下语音被切断

**症状**：语音开头或结尾被切掉

**解决方案**：
```typescript
// 增加 padding 时长
vad: {
  enabled: true,
  mode: 'filter',
  preSpeechPadDuration: 1000,  // 增加 pre-padding
  silenceDuration: 1800,        // 增加静音判定时长
}
```

### 问题：Filter 模式下语音段太碎

**症状**：一句话被切成多个片段

**解决方案**：
```typescript
// 增加静音容忍时长
vad: {
  enabled: true,
  mode: 'filter',
  silenceDuration: 2000,              // 允许更长的句内停顿
  negativeSpeechThreshold: 0.2,      // 降低静音阈值
  minSpeechDuration: 300,             // 降低最小语音时长
}
```

### 问题：Filter 模式下误检噪音

**症状**：背景噪音被当作语音

**解决方案**：
```typescript
// 提高检测阈值
vad: {
  enabled: true,
  mode: 'filter',
  positiveSpeechThreshold: 0.5,      // 提高语音阈值
  negativeSpeechThreshold: 0.35,
  minSpeechDuration: 500,             // 提高最小时长
}
```

### 问题：Passthrough 模式下带宽过高

**症状**：网络拥塞，延迟增加

**解决方案**：
```typescript
// 方案 1: 切换到 filter 模式
vad: {
  enabled: true,
  mode: 'filter',
}

// 方案 2: 降低编码码率
encoding: {
  enabled: true,
  codec: 'opus',
  bitrate: 12000,  // 从 16kbps 降到 12kbps
}

// 方案 3: 增加帧大小
frameSize: 40,  // 从 20ms 增加到 40ms
```

## 兼容性说明

### 浏览器支持

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| Passthrough 模式 | ✅ 94+ | ✅ 76+ | ✅ 16.4+ | ✅ 94+ |
| Filter 模式 | ✅ 94+ | ✅ 76+ | ✅ 16.4+ | ✅ 94+ |
| Silero VAD | ✅ 94+ | ✅ 76+ | ✅ 16.4+ | ✅ 94+ |

### 向后兼容

- ✅ 默认 `mode: 'passthrough'` 保持现有行为
- ✅ 现有代码无需修改
- ✅ 所有事件保持不变
- ✅ 配置项向后兼容

```typescript
// 现有代码继续工作
const sdk = new RTA({
  processing: {
    vad: {
      enabled: true,
      // mode 未指定，默认 passthrough
    }
  }
});
```

## 相关文档

- [Silero VAD 集成指南](./silero-vad-guide.md)
- [VAD 帧对齐说明](./vad-frame-alignment.md)
- [SDK 使用指南](./usage-guide.md)
- [API 参考](./api-reference.md)

## 更新日志

### v2.0.0 (计划中)
- ✨ 新增 Filter 模式支持
- ✨ 新增 `mode` 配置选项
- ✨ 自动 pre-speech/post-speech padding
- 🔧 优化 VAD 状态机
- 📖 完善文档和示例

## 反馈与贡献

如有问题或建议，请访问：
- [GitHub Issues](https://github.com/realtime-ai/audio-sdk/issues)
- [GitHub Discussions](https://github.com/realtime-ai/audio-sdk/discussions)
