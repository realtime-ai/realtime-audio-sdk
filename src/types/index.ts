/**
 * Audio frame size in milliseconds
 */
export type FrameSize = 20 | 40 | 60;

/**
 * SDK state
 */
export type SDKState = 'idle' | 'recording' | 'paused' | 'error';

/**
 * Audio capture configuration
 */
export interface CaptureOptions {
  /** Device ID to capture from */
  deviceId?: string;
  /** Sample rate in Hz (default: 16000) */
  sampleRate: number;
  /** Number of audio channels (default: 1 for mono) */
  channelCount: number;
  /** Frame size in milliseconds */
  frameSize: FrameSize;
}


/**
 * Voice Activity Detection configuration (Silero VAD only)
 */
export interface VADConfig {
  /** Enable VAD */
  enabled: boolean;

  // Silero VAD parameters
  /** Speech detection threshold (0-1, default: 0.3) */
  positiveSpeechThreshold?: number;
  /** Non-speech threshold (0-1, default: 0.25) */
  negativeSpeechThreshold?: number;
  /** Silence duration for ending speech segment in ms (default: 1400) */
  silenceDuration?: number;
  /** Pre-speech padding duration in ms (default: 800) */
  preSpeechPadDuration?: number;
  /** Minimum speech duration in ms (default: 400) */
  minSpeechDuration?: number;

  // Model configuration
  /** ONNX model path */
  modelPath?: string;
}

// Keep SileroVADConfig as an alias for backward compatibility
export type SileroVADConfig = VADConfig;

/**
 * Audio processing configuration
 */
export interface ProcessingConfig {
  /** Voice Activity Detection config */
  vad?: VADConfig;
  /** Enable audio normalization */
  normalize?: boolean;
}

/**
 * Main SDK configuration
 */
export interface SDKConfig {
  /** Device ID to use (optional, uses default if not specified) */
  deviceId?: string;
  /** Sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Number of channels (default: 1) */
  channelCount?: number;
  /** Frame size in ms (default: 20) */
  frameSize?: FrameSize;
  /** Processing configuration */
  processing?: ProcessingConfig;
  /** Auto-switch to default device when current device is unplugged */
  autoSwitchDevice?: boolean;
}

/**
 * Unified audio data event
 */
export interface AudioDataEvent {
  /** Core audio data */
  audio: {
    /** Raw audio samples */
    raw: Float32Array;
  };

  /** Audio metadata */
  metadata: {
    /** Timestamp in milliseconds */
    timestamp: number;
    /** Frame index */
    frameIndex: number;
    /** Sample rate in Hz */
    sampleRate: number;
    /** Number of channels */
    channelCount: number;
    /** Frame size in milliseconds */
    frameSize: number;
  };

  /** Processing results */
  processing: {
    /** Audio energy (RMS) */
    energy: number;
    /** Whether audio was normalized */
    normalized: boolean;

    /** VAD results (if VAD enabled) */
    vad?: {
      /** Whether VAD is active */
      active: boolean;
      /** Is speech detected */
      isSpeech: boolean;
      /** Speech probability (0-1) */
      probability: number;
      /** Confidence level */
      confidence: 'high' | 'medium' | 'low';
    };
  };
}

/**
 * VAD state change event
 */
export interface VADStateEvent {
  /** Event type */
  type: 'start' | 'end';
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Speech probability at transition */
  probability: number;
  /** Duration of speech (only for 'end' event) */
  duration?: number;
  /** Complete speech segment data (only for 'end' event) */
  segment?: VADSegment;
}

/**
 * VAD speech segment payload
 */
export interface VADSegment {
  /** Complete audio segment with pre-padding */
  audio: Float32Array;
  /** Start timestamp in milliseconds */
  startTime: number;
  /** End timestamp in milliseconds */
  endTime: number;
  /** Total duration in milliseconds */
  duration: number;
  /** Average speech probability */
  avgProbability: number;
  /** Segment confidence score (0-1) */
  confidence: number;
}

// Backward compatibility alias for the segment payload
export type VADSegmentEvent = VADSegment;

/**
 * VAD result event - emitted for each processed audio frame
 */
export interface VADResultEvent {
  /** Is speech detected */
  isSpeech: boolean;
  /** Speech probability (0-1) */
  probability: number;
  /** Timestamp in seconds */
  timestamp: number;
}

/**
 * Device event
 */
export interface DeviceEvent {
  /** Event type */
  type: 'changed' | 'list-updated' | 'unplugged' | 'switch-failed';
  /** Current device (for 'changed') */
  device?: MediaDeviceInfo;
  /** Device list (for 'list-updated') */
  devices?: MediaDeviceInfo[];
  /** Device ID (for 'unplugged' or 'switch-failed') */
  deviceId?: string;
  /** Error details (for 'switch-failed') */
  error?: Error;
  /** Whether rollback succeeded (for 'switch-failed') */
  rolledBack?: boolean;
}

/**
 * SDK error with context
 */
export interface SDKError extends Error {
  /** Error code */
  code?: string;
  /** Error context */
  context?: Record<string, unknown>;
}

/**
 * Audio worklet message types
 */
export interface AudioWorkletMessage {
  type: 'audio-data' | 'config' | 'state';
  data?: Float32Array;
  config?: {
    frameSize: FrameSize;
    sampleRate: number;
  };
  state?: 'started' | 'stopped';
}

/**
 * SDK event types
 */
export interface SDKEvents {
  /** Unified audio data event (fired for each frame) */
  'audio': (event: AudioDataEvent) => void;

  /** VAD state change events */
  'speech-state': (event: VADStateEvent) => void;

  /** VAD result event - fired asynchronously for each processed audio frame */
  'vad-result': (event: VADResultEvent) => void;

  /** Device events */
  'device': (event: DeviceEvent) => void;

  /** System events */
  'state': (state: SDKState) => void;
  'error': (error: SDKError) => void;
}

/**
 * Audio processor result
 */
export interface AudioProcessorResult {
  /** Processed audio data */
  data: Float32Array;
  /** Audio energy (RMS) */
  energy: number;
  /** Whether audio was normalized */
  normalized: boolean;
  /** VAD results (if enabled) */
  vad?: {
    isSpeech: boolean;
    probability: number;
  };
  /** Timestamp */
  timestamp: number;
}

/**
 * Event listener type
 */
export type EventListener<T = unknown> = (data: T) => void;
