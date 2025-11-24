import type { SileroVADConfig } from '../types';
import { EventEmitter } from '../core/EventEmitter';
import * as ort from 'onnxruntime-web/wasm';

interface VADEventData {
  isSpeech: boolean;
  probability: number;
  timestamp: number;
  segment?: {
    start: number;
    end: number;
    duration: number;
    audioData?: Float32Array;
  };
}

interface SileroVADEvents {
  'speech-start': (data: VADEventData) => void;
  'speech-end': (data: VADEventData) => void;
}

type VADState = 'silence' | 'potential_start' | 'speaking' | 'potential_end';

/**
 * Silero VAD implementation using ONNX Runtime
 */
export class SileroVAD extends EventEmitter<SileroVADEvents> {
  private session: any | null = null;
  private config: Required<SileroVADConfig>;
  private state: VADState = 'silence';

  // Model states
  private stateTensor: any | null = null; // State tensor [2, 1, 128] for Silero v5
  private srTensor: any; // Sample rate tensor

  // Buffer management
  private audioBuffer: Float32Array[] = [];
  private speechStartTime: number = 0;
  private speechEndCandidateTime: number = 0;
  private speechStartBufferIndex: number = 0; // Track buffer index when speech starts
  private potentialSpeechDurationMs: number = 0;
  private potentialSilenceDurationMs: number = 0;
  private frameSize: number = 512; // v5 model default

  // Sample buffer for handling misaligned chunks
  private sampleBuffer: Float32Array = new Float32Array(0);
  private lastProbability: number = 0;
  private lastTimestamp: number = 0; // Track last processed timestamp

  constructor(config: SileroVADConfig) {
    super();

    // Set default configuration
    this.config = {
      ...config,
      enabled: config.enabled ?? true,
      positiveSpeechThreshold: config.positiveSpeechThreshold ?? 0.3,
      negativeSpeechThreshold: config.negativeSpeechThreshold ?? 0.25,
      silenceDuration: config.silenceDuration ?? 1400,
      preSpeechPadDuration: config.preSpeechPadDuration ?? 800,
      minSpeechDuration: config.minSpeechDuration ?? 400,
      modelPath: config.modelPath ?? '/models/silero_vad_v5.onnx',
    } as Required<SileroVADConfig>;

    // Silero v5 uses 512 samples per frame (32ms at 16kHz)
    this.frameSize = 512;
  }

  /**
   * Static factory method to create a new instance (similar to reference implementation)
   */
  static async create(config: SileroVADConfig): Promise<SileroVAD> {
    const vad = new SileroVAD(config);
    await vad.initialize();
    return vad;
  }

  /**
   * Initialize the Silero VAD model
   */
  async initialize(): Promise<void> {
    try {
      // Initialize sample rate tensor (int64 with value 16000)
      this.srTensor = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);

      // Configure ONNX Runtime for browser
      if (ort.env && ort.env.wasm) {
        // Use single thread for better compatibility
        ort.env.wasm.numThreads = 1;
        // Set WASM paths to the public directory where files are copied
        ort.env.wasm.wasmPaths = '/public/';
      }

      // Load ONNX model
      console.log('Loading VAD model...');
      this.session = await ort.InferenceSession.create(
        this.config.modelPath,
        {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        }
      );

      // Initialize model state
      this.resetStates();

      console.log('Silero VAD initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Silero VAD:', error);
      throw error;
    }
  }

  /**
   * Reset LSTM hidden states
   */
  private resetStates(): void {
    // Silero v5 uses a combined state tensor [2, 1, 128]
    const zeroes = Array(2 * 128).fill(0);
    this.stateTensor = new ort.Tensor('float32', zeroes, [2, 1, 128]);
  }

  /**
   * Process audio data and return VAD results
   */
  async process(audioData: Float32Array, timestamp: number): Promise<{
    isSpeech: boolean;
    probability: number;
  }> {
    // Track last timestamp for flush operation
    this.lastTimestamp = timestamp;

    // Ensure audio is at 16kHz (assuming input is already 16kHz)
    // If resampling is needed, it should be added here

    // Add to speech segment buffer (for pre-speech padding)
    this.audioBuffer.push(new Float32Array(audioData));

    // Limit buffer size ONLY when not in speech state
    // During speech, we need to keep all audio data for the segment
    if (this.state === 'silence') {
      // Keep enough frames for pre-padding (with some extra margin)
      const prePadSamples = (this.config.preSpeechPadDuration * 16000) / 1000;
      const prePadFrames = Math.ceil(prePadSamples / audioData.length);
      const maxBufferFrames = prePadFrames * 2; // 2x for safety margin

      // Batch deletion when buffer exceeds 1.5x limit to reduce shift() calls
      if (this.audioBuffer.length > maxBufferFrames * 1.5) {
        this.audioBuffer = this.audioBuffer.slice(-maxBufferFrames);
      }
    }

    // Concatenate new audio with sample buffer
    const totalSamples = this.sampleBuffer.length + audioData.length;
    const combinedAudio = new Float32Array(totalSamples);
    combinedAudio.set(this.sampleBuffer, 0);
    combinedAudio.set(audioData, this.sampleBuffer.length);

    // Process all complete 512-sample frames
    let offset = 0;
    let totalProbability = 0;
    let frameCount = 0;

    while (offset + this.frameSize <= combinedAudio.length) {
      const frame = combinedAudio.slice(offset, offset + this.frameSize);
      const probability = await this.processFrame(frame, timestamp);

      totalProbability += probability;
      frameCount++;
      this.lastProbability = probability;

      offset += this.frameSize;
    }

    // Store remaining samples for next call
    if (offset < combinedAudio.length) {
      this.sampleBuffer = combinedAudio.slice(offset);
    } else {
      this.sampleBuffer = new Float32Array(0);
    }

    const processedDurationMs = frameCount > 0
      ? frameCount * ((this.frameSize / 16000) * 1000)
      : (audioData.length / 16000) * 1000;

    const finalProbability = frameCount > 0
      ? (totalProbability / frameCount)
      : this.lastProbability;

    const isSpeech = this.updateVADState(finalProbability, timestamp, processedDurationMs);

    return {
      isSpeech,
      probability: finalProbability
    };
  }

  /**
   * Process a single frame through the model
   */
  private async processFrame(frame: Float32Array, _timestamp: number): Promise<number> {
    if (!this.session || !this.stateTensor) {
      throw new Error('SileroVAD not initialized');
    }

    // Prepare input tensor
    const inputTensor = new ort.Tensor('float32', frame, [1, frame.length]);

    // Prepare feeds for Silero v5 model
    const inputs = {
      input: inputTensor,
      state: this.stateTensor,
      sr: this.srTensor
    };

    // Run inference
    const out = await this.session.run(inputs);

    // Update state from output
    this.stateTensor = out['stateN'] || out['state'];

    // Get speech probability
    const outputData = out['output']?.data;
    const isSpeech = outputData[0] as number;

    return isSpeech;
  }

  /**
   * Update VAD state based on probability and elapsed time
   */
  private updateVADState(probability: number, timestamp: number, processedDurationMs: number): boolean {
    const durationMs = processedDurationMs > 0
      ? processedDurationMs
      : (this.frameSize / 16000) * 1000;

    const positiveThreshold = this.config.positiveSpeechThreshold;
    const negativeThreshold = this.config.negativeSpeechThreshold;

    switch (this.state) {
      case 'silence': {
        if (probability > positiveThreshold) {
          console.log(`[VAD] Potential speech detected - probability ${probability.toFixed(3)}, timestamp: ${timestamp.toFixed(3)}s`);
          this.state = 'potential_start';
          this.speechStartTime = timestamp;
          this.potentialSpeechDurationMs = durationMs;
          this.potentialSilenceDurationMs = 0;
        }
        break;
      }
      case 'potential_start': {
        if (probability > positiveThreshold) {
          this.potentialSpeechDurationMs += durationMs;
          if (this.potentialSpeechDurationMs >= this.config.minSpeechDuration) {
            this.confirmSpeechStart(timestamp, probability);
          }
        } else if (probability < negativeThreshold) {
          console.log(`[VAD] Potential speech cancelled - fell below negative threshold (${probability.toFixed(3)})`);
          this.resetToSilence();
        }
        break;
      }
      case 'speaking': {
        if (probability < negativeThreshold) {
          console.log(`[VAD] Potential speech end detected - probability ${probability.toFixed(3)}`);
          this.state = 'potential_end';
          this.potentialSilenceDurationMs = durationMs;
          this.speechEndCandidateTime = timestamp;
        } else {
          this.potentialSilenceDurationMs = 0;
          this.speechEndCandidateTime = 0;
        }
        break;
      }
      case 'potential_end': {
        if (probability < negativeThreshold) {
          this.potentialSilenceDurationMs += durationMs;
          console.log(`[VAD] Silence accumulating: ${this.potentialSilenceDurationMs.toFixed(0)}ms / ${this.config.silenceDuration}ms`);
          if (this.potentialSilenceDurationMs >= this.config.silenceDuration) {
            console.log(`[VAD] Speech END - silence duration reached`);
            const endTime = this.speechEndCandidateTime || timestamp;
            this.endSpeech(endTime, probability);
          }
        } else if (probability > positiveThreshold) {
          console.log('[VAD] Speech resumed before silence threshold reached');
          this.state = 'speaking';
          this.potentialSilenceDurationMs = 0;
          this.speechEndCandidateTime = 0;
        }
        break;
      }
      default:
        break;
    }

    return this.state === 'speaking' || this.state === 'potential_end';
  }

  /**
   * Confirm speech start once minimum duration is satisfied
   */
  private confirmSpeechStart(timestamp: number, probability: number): void {
    console.log(`[VAD] Speech START confirmed - probability ${probability.toFixed(3)}, timestamp: ${timestamp.toFixed(3)}s`);
    this.state = 'speaking';
    this.potentialSpeechDurationMs = 0;
    this.potentialSilenceDurationMs = 0;
    this.speechEndCandidateTime = 0;
    this.speechStartBufferIndex = this.calculateSpeechStartBufferIndex();

    const eventData: VADEventData = {
      isSpeech: true,
      probability,
      timestamp
    };

    this.emit('speech-start', eventData);
  }

  /**
   * Reset transient speech tracking back to silence
   */
  private resetToSilence(): void {
    this.state = 'silence';
    this.speechStartTime = 0;
    this.speechEndCandidateTime = 0;
    this.potentialSpeechDurationMs = 0;
    this.potentialSilenceDurationMs = 0;
    this.speechStartBufferIndex = 0;
  }

  /**
   * Calculate buffer index to include pre-speech padding
   */
  private calculateSpeechStartBufferIndex(): number {
    if (this.audioBuffer.length === 0) {
      return 0;
    }

    const lastChunkLength = this.audioBuffer[this.audioBuffer.length - 1]?.length || this.frameSize;
    const prePadSamples = (this.config.preSpeechPadDuration * 16000) / 1000;
    const prePadFrames = Math.ceil(prePadSamples / Math.max(1, lastChunkLength));
    return Math.max(0, this.audioBuffer.length - prePadFrames);
  }

  /**
   * End speech and emit events
   */
  private endSpeech(timestamp: number, probability: number): void {
    const speechDurationSeconds = timestamp - this.speechStartTime;
    const speechDurationMs = speechDurationSeconds * 1000;
    console.log(`[VAD] endSpeech called - startTime: ${this.speechStartTime.toFixed(3)}s, endTime: ${timestamp.toFixed(3)}s, duration: ${speechDurationMs.toFixed(0)}ms, minDuration: ${this.config.minSpeechDuration}ms`);

    // Always emit speech-end event for state consistency
    // Only include segment if duration meets minimum threshold
    let segment: { start: number; end: number; duration: number; audioData?: Float32Array } | undefined;

    if (speechDurationMs >= this.config.minSpeechDuration) {
      console.log(`[VAD] Speech segment valid, including segment data`);
      segment = this.createSpeechSegment(timestamp);
    } else {
      console.log(`[VAD] Speech segment too short (${speechDurationMs.toFixed(0)}ms < ${this.config.minSpeechDuration}ms), no segment data`);
    }

    const eventData: VADEventData = {
      isSpeech: false,
      probability,
      timestamp,
      segment
    };
    this.emit('speech-end', eventData);

    // Reset state for next detection window
    this.resetToSilence();

    // Clear old audio buffer to prevent memory buildup
    // Keep only frames needed for pre-padding of next segment
    const prePadSamples = (this.config.preSpeechPadDuration * 16000) / 1000;
    const prePadFrames = Math.ceil(prePadSamples / 320); // Assume 20ms frames
    const maxBufferFrames = prePadFrames * 2; // 2x for safety margin

    if (this.audioBuffer.length > maxBufferFrames) {
      this.audioBuffer = this.audioBuffer.slice(-maxBufferFrames);
    }
  }

  /**
   * Create a speech segment with pre-padding
   */
  private createSpeechSegment(endTime: number): { start: number; end: number; duration: number; audioData?: Float32Array } {
    // Extract audio data from speechStartBufferIndex to current buffer end
    // This includes pre-padding and the entire speech segment
    const segmentData: Float32Array[] = this.audioBuffer.slice(this.speechStartBufferIndex);

    // Merge audio data
    const totalLength = segmentData.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of segmentData) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }

    // Calculate duration based on actual audio data length (more accurate)
    // Sample rate is 16kHz (16000 samples per second)
    const durationMs = (totalLength / 16000) * 1000;

    // Calculate start time based on end time and actual duration
    const startTimeSeconds = endTime - (durationMs / 1000);
    const segmentStart = Math.max(0, startTimeSeconds);

    console.log(`[VAD] createSpeechSegment - audioLength: ${totalLength} samples, duration: ${durationMs.toFixed(0)}ms, start: ${segmentStart.toFixed(3)}s, end: ${endTime.toFixed(3)}s`);

    return {
      start: segmentStart,      // in seconds
      end: endTime,              // in seconds
      duration: durationMs,      // in milliseconds
      audioData
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SileroVADConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    this.resetToSilence();
    this.audioBuffer = [];
    this.sampleBuffer = new Float32Array(0);
    this.lastProbability = 0;
    this.lastTimestamp = 0;
    this.resetStates();
  }

  /**
   * Flush any pending speech segment
   * Should be called when audio stream ends to save the last segment
   */
  flush(timestamp?: number): void {
    if (this.state === 'speaking' || this.state === 'potential_end') {
      // Force end the current speech segment
      // Use provided timestamp, speech-end candidate, or last processed timestamp
      const endTime = timestamp
        ?? this.speechEndCandidateTime
        ?? this.lastTimestamp
        ?? (this.speechStartTime + 1000);
      this.endSpeech(endTime, this.lastProbability);
    } else if (this.state === 'potential_start') {
      // Discard partial speech that never reached minimum duration
      this.resetToSilence();
    }
  }

  /**
   * Close and cleanup
   */
  async close(): Promise<void> {
    // Flush any pending speech segment before closing
    this.flush();

    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.stateTensor = null;
    this.removeAllListeners();
  }

  /**
   * Check if Silero VAD is supported (WebAssembly required)
   */
  static isSupported(): boolean {
    return typeof WebAssembly !== 'undefined';
  }
}