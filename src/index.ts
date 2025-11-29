/**
 * Realtime Audio SDK - Main entry point
 */

export { RTA, RealtimeAudioSDK } from '@/core/RealtimeAudioSDK';
export { DeviceManager } from '@/devices/DeviceManager';
export { AudioProcessor } from '@/processing/AudioProcessor';
export { OpusEncoder } from '@/encoding/OpusEncoder';
export { PCMEncoder } from '@/encoding/PCMEncoder';

// Export types
export type {
  SDKConfig,
  SDKState,
  SDKEvents,
  CaptureOptions,
  EncodingConfig,
  ProcessingConfig,
  VADConfig,
  AudioDataEvent,
  DeviceEvent,
  VADStateEvent,
  VADSegment,
  VADSegmentEvent,
  VADResultEvent,
  SDKError,
  FrameSize,
  AudioCodec,
  OpusEncoderConfig,
} from '@/types';

// Export SileroVAD for advanced usage
export { SileroVAD } from '@/vad/SileroVAD';
export type { VADResultEvent as SileroVADResultEvent } from '@/vad/SileroVAD';
