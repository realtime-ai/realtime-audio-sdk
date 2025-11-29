import type { CaptureOptions, AudioWorkletMessage } from '@/types';
import { EventEmitter } from '@/core/EventEmitter';

interface AudioCaptureEvents {
  'audio-data': (data: { data: Float32Array; timestamp: number }) => void;
  'error': (error: Error) => void;
}

/**
 * Handles audio capture using Web Audio API and AudioWorklet
 */
export class AudioCapture extends EventEmitter<AudioCaptureEvents> {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isCapturing: boolean = false;
  private currentOptions: CaptureOptions | null = null;

  /**
   * Start audio capture
   */
  async start(options: CaptureOptions): Promise<void> {
    if (this.isCapturing) {
      throw new Error('Already capturing');
    }

    try {
      // Create audio context with specified sample rate
      this.audioContext = new AudioContext({
        sampleRate: options.sampleRate,
        latencyHint: 'interactive',
      });

      // Get user media with constraints
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
          sampleRate: { ideal: options.sampleRate },
          channelCount: { ideal: options.channelCount },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Create source node from media stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Load and create AudioWorklet
      await this.setupAudioWorklet(options);

      this.isCapturing = true;
      this.currentOptions = options; // Save current options for rollback
    } catch (error) {
      this.cleanup();
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to start audio capture: ${message}`);
    }
  }

  /**
   * Setup AudioWorklet processor
   */
  private async setupAudioWorklet(options: CaptureOptions): Promise<void> {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }

    // Load the worklet module
    // In production, this would be a bundled URL or blob URL
    const workletCode = await this.getWorkletCode();
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await this.audioContext.audioWorklet.addModule(workletUrl);

      // Create worklet node
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        'audio-capture-processor'
      );

      // Configure the processor
      this.workletNode.port.postMessage({
        type: 'config',
        config: {
          frameSize: options.frameSize,
          sampleRate: options.sampleRate,
        },
      } as AudioWorkletMessage);

      // Listen for audio data
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'audio-data') {
          this.emit('audio-data', { data: event.data.data, timestamp: event.data.timestamp });
        }
      };

      // Connect nodes
      if (this.sourceNode) {
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
      }
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
  }

  /**
   * Get the worklet processor code as a string
   */
  private async getWorkletCode(): Promise<string> {
    // In a real implementation, this would import the actual worklet file
    // For now, we'll inline it as a string
    return `
      class AudioCaptureProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = [];
          this.framesPerChunk = 0;
          this.config = { frameSize: 20, sampleRate: 16000 };

          this.port.onmessage = (event) => {
            if (event.data.type === 'config') {
              this.config = event.data.config;
              this.framesPerChunk = (this.config.frameSize * this.config.sampleRate) / 1000;
            }
          };
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (!input || input.length === 0) return true;

          const channelData = input[0];
          if (!channelData) return true;

          this.buffer.push(new Float32Array(channelData));
          const totalFrames = this.buffer.reduce((sum, arr) => sum + arr.length, 0);

          if (totalFrames >= this.framesPerChunk) {
            const chunk = this.extractChunk();
            this.port.postMessage({
              type: 'audio-data',
              data: chunk,
              timestamp: currentTime,
            });
          }

          return true;
        }

        extractChunk() {
          const chunk = new Float32Array(this.framesPerChunk);
          let offset = 0;

          while (offset < this.framesPerChunk && this.buffer.length > 0) {
            const block = this.buffer[0];
            const remainingInChunk = this.framesPerChunk - offset;
            const availableInBlock = block.length;

            if (availableInBlock <= remainingInChunk) {
              chunk.set(block, offset);
              offset += availableInBlock;
              this.buffer.shift();
            } else {
              chunk.set(block.subarray(0, remainingInChunk), offset);
              this.buffer[0] = block.subarray(remainingInChunk);
              offset += remainingInChunk;
            }
          }

          return chunk;
        }
      }

      registerProcessor('audio-capture-processor', AudioCaptureProcessor);
    `;
  }

  /**
   * Stop audio capture
   */
  async stop(): Promise<void> {
    this.cleanup();
    this.isCapturing = false;
    this.currentOptions = null;
  }

  /**
   * Switch to a different audio device with automatic rollback on failure
   */
  async switchDevice(newDeviceId: string, options: CaptureOptions): Promise<void> {
    const wasCapturing = this.isCapturing;
    if (!wasCapturing) {
      return;
    }

    // Save current device info for potential rollback
    const oldOptions = this.currentOptions;
    const oldDeviceId = oldOptions?.deviceId;

    try {
      // Stop current capture
      await this.stop();

      // Start with new device
      const newOptions = { ...options, deviceId: newDeviceId };
      await this.start(newOptions);

      console.log(`[AudioCapture] Successfully switched from device ${oldDeviceId} to ${newDeviceId}`);
    } catch (error) {
      console.error(`[AudioCapture] Failed to switch to device ${newDeviceId}:`, error);

      // Attempt to rollback to old device
      if (oldOptions) {
        try {
          console.log(`[AudioCapture] Attempting to rollback to previous device ${oldDeviceId}`);
          await this.start(oldOptions);
          console.log(`[AudioCapture] Successfully rolled back to device ${oldDeviceId}`);
          
          // Re-throw error to notify caller that switch failed but rollback succeeded
          const rollbackError = new Error(`Failed to switch to device ${newDeviceId}, rolled back to ${oldDeviceId}`);
          (rollbackError as any).code = 'DEVICE_SWITCH_FAILED_ROLLBACK_SUCCESS';
          (rollbackError as any).originalError = error;
          throw rollbackError;
        } catch (rollbackError) {
          // Rollback also failed - system is now in stopped state
          console.error(`[AudioCapture] Rollback to device ${oldDeviceId} also failed:`, rollbackError);
          
          const criticalError = new Error(`Failed to switch to device ${newDeviceId} and rollback to ${oldDeviceId} also failed`);
          (criticalError as any).code = 'DEVICE_SWITCH_FAILED_ROLLBACK_FAILED';
          (criticalError as any).originalError = error;
          (criticalError as any).rollbackError = rollbackError;
          throw criticalError;
        }
      } else {
        // No previous device to rollback to
        throw error;
      }
    }
  }

  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Get current audio context
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
