import { EventEmitter } from './EventEmitter';
import { AudioCapture } from '@/capture/AudioCapture';
import { DeviceManager } from '@/devices/DeviceManager';
import { AudioProcessor } from '@/processing/AudioProcessor';
import type {
  SDKConfig,
  SDKEvents,
  SDKState,
  CaptureOptions,
  AudioDataEvent,
  DeviceEvent,
  SDKError,
} from '@/types';
import type { VADResultEvent } from '@/vad/SileroVAD';

/**
 * Main RTA (Real-Time Audio) class
 */
export class RTA extends EventEmitter<SDKEvents> {
  private config: Required<SDKConfig>;
  private state: SDKState = 'idle';
  private deviceManager: DeviceManager;
  private audioCapture: AudioCapture;
  private audioProcessor: AudioProcessor;
  private frameCounter: number = 0;

  // Cache for the latest VAD result (updated asynchronously)
  private latestVADResult: VADResultEvent | null = null;

  // Device switching state
  private isSwitchingDevice: boolean = false;
  private deviceSwitchRetryCount: number = 0;
  private readonly MAX_DEVICE_SWITCH_RETRIES = 3;

  constructor(config: SDKConfig = {}) {
    super();

    // Set default config
    this.config = {
      deviceId: config.deviceId || '',
      sampleRate: config.sampleRate || 16000,
      channelCount: config.channelCount || 1,
      frameSize: config.frameSize || 20,
      processing: {
        vad: config.processing?.vad,
        normalize: config.processing?.normalize,
      },
      autoSwitchDevice: config.autoSwitchDevice ?? true,
    };

    // Initialize modules
    this.deviceManager = new DeviceManager();
    this.audioCapture = new AudioCapture();
    this.audioProcessor = new AudioProcessor(this.config.processing);

    this.setupEventHandlers();
  }

  /**
   * Setup internal event handlers
   */
  private setupEventHandlers(): void {
    // Device change events
    this.deviceManager.on('device-changed', (devices) => {
      const event: DeviceEvent = {
        type: 'list-updated',
        devices
      };
      this.emit('device', event);
    });

    this.deviceManager.on('device-unplugged', async (deviceId) => {
      const event: DeviceEvent = {
        type: 'unplugged',
        deviceId
      };
      this.emit('device', event);

      // Auto-switch to default device if enabled
      if (this.config.autoSwitchDevice && this.state === 'recording') {
        // Check if we've exceeded retry limit
        if (this.deviceSwitchRetryCount >= this.MAX_DEVICE_SWITCH_RETRIES) {
          console.error(`[RTA] Max device switch retries (${this.MAX_DEVICE_SWITCH_RETRIES}) exceeded, stopping auto-switch`);
          this.handleError(new Error('Maximum device switch retry attempts exceeded'));
          return;
        }

        this.deviceSwitchRetryCount++;
        console.log(`[RTA] Device unplugged, attempting auto-switch (attempt ${this.deviceSwitchRetryCount}/${this.MAX_DEVICE_SWITCH_RETRIES})`);

        try {
          const defaultDevice = await this.deviceManager.getDefaultDevice();
          if (defaultDevice) {
            await this.setDevice(defaultDevice.deviceId);
            console.log(`[RTA] Auto-switched to default device: ${defaultDevice.label}`);
          } else {
            console.warn('[RTA] No default device available for auto-switch');
          }
        } catch (error) {
          console.error('[RTA] Auto-switch failed:', error);
          this.handleError(error as Error);
          
          // If this was the last retry, emit a critical error
          if (this.deviceSwitchRetryCount >= this.MAX_DEVICE_SWITCH_RETRIES) {
          const criticalError = new Error('Failed to auto-switch device after multiple attempts');
          (criticalError as SDKError).code = 'AUTO_SWITCH_FAILED';
          this.handleError(criticalError);
          }
        }
      }
    });

    // Audio capture events
    this.audioCapture.on('audio-data', ({ data, timestamp }) => {
      try {
        this.handleAudioFrame(data, timestamp);
      } catch (error) {
        this.handleError(error as Error);
      }
    });

    this.audioCapture.on('error', (error) => {
      this.handleError(error);
    });

    // VAD events from AudioProcessor
    this.audioProcessor.on('speech-state', (event) => {
      this.emit('speech-state', event);
    });

    // Cache VAD results from async processing
    this.audioProcessor.on('vad-result', (event) => {
      this.latestVADResult = event;
      // Also emit vad-result event for real-time VAD updates
      this.emit('vad-result', event);
    });
  }

  /**
   * Handle incoming audio frame
   * Note: VAD is processed asynchronously, so VAD results in the audio event
   * may be from a previous frame. For real-time VAD updates, listen to 'vad-result' event.
   */
  private handleAudioFrame(
    rawData: Float32Array,
    timestamp: number
  ): void {
    // Process audio (non-blocking, VAD is queued for async processing)
    const processed = this.audioProcessor.process(rawData, timestamp);

    // Build unified audio event
    // Note: VAD result is from the cached async result, may not correspond to this exact frame
    const audioEvent: AudioDataEvent = {
      audio: {
        raw: processed.data,
      },
      metadata: {
        timestamp,
        frameIndex: this.frameCounter++,
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channelCount,
        frameSize: this.config.frameSize
      },
      processing: {
        energy: processed.energy,
        normalized: processed.normalized,
        // Use cached VAD result from async processing
        vad: this.latestVADResult ? {
          active: true,
          isSpeech: this.latestVADResult.isSpeech,
          probability: this.latestVADResult.probability,
          confidence: this.getConfidenceLevel(this.latestVADResult.probability)
        } : undefined
      }
    };

    // Emit unified audio event
    this.emit('audio', audioEvent);
  }

  /**
   * Get confidence level from probability
   */
  private getConfidenceLevel(probability: number): 'high' | 'medium' | 'low' {
    if (probability > 0.8) return 'high';
    if (probability > 0.5) return 'medium';
    return 'low';
  }

  /**
   * Get all available audio input devices
   */
  async getDevices(): Promise<MediaDeviceInfo[]> {
    return this.deviceManager.getDevices();
  }

  /**
   * Set the audio input device
   */
  async setDevice(deviceId: string): Promise<void> {
    // Prevent concurrent device switches
    if (this.isSwitchingDevice) {
      console.warn('[RTA] Device switch already in progress, ignoring request');
      return;
    }

    if (this.state === 'recording') {
      // Switch device while recording
      this.isSwitchingDevice = true;
      
      try {
        const captureOptions = this.getCaptureOptions(deviceId);
        await this.audioCapture.switchDevice(deviceId, captureOptions);
        this.deviceManager.setCurrentDevice(deviceId);

        const device = await this.deviceManager.getDeviceById(deviceId);
        if (device) {
          const event: DeviceEvent = {
            type: 'changed',
            device
          };
          this.emit('device', event);
        }
        
        // Reset retry count on successful switch
        this.deviceSwitchRetryCount = 0;
        console.log(`[RTA] Successfully switched to device: ${deviceId}`);
      } catch (error) {
        console.error(`[RTA] Failed to switch device:`, error);
        
        // Determine if rollback succeeded or failed
        const errorWithCode = error as Error & { code?: string };
        const errorCode = errorWithCode.code;
        const rolledBack = errorCode === 'DEVICE_SWITCH_FAILED_ROLLBACK_SUCCESS';
        
        // Emit device switch failed event
        const failedEvent: DeviceEvent = {
          type: 'switch-failed',
          deviceId,
          error: error as Error,
          rolledBack
        };
        this.emit('device', failedEvent);
        
        // Re-throw error for caller to handle
        throw error;
      } finally {
        this.isSwitchingDevice = false;
      }
    } else {
      // Just update config for next start
      this.config.deviceId = deviceId;
      this.deviceManager.setCurrentDevice(deviceId);
    }
  }

  /**
   * Start audio capture
   */
  async start(): Promise<void> {
    if (this.state === 'recording') {
      console.warn('Already recording');
      return;
    }

    try {
      this.setState('recording');

      // Request permission if not already granted
      const hasPermission = await this.deviceManager.requestPermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }

      // Get device to use
      let deviceId = this.config.deviceId;
      if (!deviceId) {
        const defaultDevice = await this.deviceManager.getDefaultDevice();
        if (!defaultDevice) {
          throw new Error('No audio input device available');
        }
        deviceId = defaultDevice.deviceId;
        this.config.deviceId = deviceId;
      }

      this.deviceManager.setCurrentDevice(deviceId);

      // Initialize audio processor if needed
      console.log('Checking VAD initialization - config:', this.config.processing);
      if (this.config.processing?.vad?.enabled) {
        console.log('VAD is enabled, initializing AudioProcessor...');
        await this.audioProcessor.initialize();
      } else {
        console.log('VAD not enabled in config');
      }

      // Start capture
      const captureOptions = this.getCaptureOptions(deviceId);
      await this.audioCapture.start(captureOptions);

      console.log('Audio capture started');
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  /**
   * Stop audio capture
   */
  async stop(): Promise<void> {
    if (this.state === 'idle') {
      return;
    }

    try {
      // Stop capturing first
      await this.audioCapture.stop();

      // Wait for VAD queue to be empty, then flush any pending speech segment
      await this.audioProcessor.flushAsync();

      // Clear cached VAD result
      this.latestVADResult = null;

      this.setState('idle');
      console.log('Audio capture stopped');
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Pause audio capture
   */
  async pause(): Promise<void> {
    if (this.state !== 'recording') {
      return;
    }

    await this.audioCapture.stop();
    this.setState('paused');
  }

  /**
   * Resume audio capture
   */
  async resume(): Promise<void> {
    if (this.state !== 'paused') {
      return;
    }

    const captureOptions = this.getCaptureOptions(this.config.deviceId);
    await this.audioCapture.start(captureOptions);
    this.setState('recording');
  }

  /**
   * Update SDK configuration
   */
  async updateConfig(config: Partial<SDKConfig>): Promise<void> {
    const wasRecording = this.state === 'recording';

    if (wasRecording) {
      await this.stop();
    }

    this.config = {
      ...this.config,
      ...config,
      processing: { ...this.config.processing, ...config.processing },
    };

    this.audioProcessor.updateConfig(this.config.processing);

    if (wasRecording) {
      await this.start();
    }
  }

  /**
   * Flush any pending speech segment (synchronous).
   * Note: This does not wait for the VAD processing queue to empty.
   * Use flushAsync() to wait for all pending audio frames to be processed first.
   * @param timestamp Optional timestamp to use as end time
   */
  flush(timestamp?: number): void {
    this.audioProcessor.flush(timestamp);
  }

  /**
   * Flush any pending speech segment asynchronously.
   * Waits for the VAD processing queue to be empty before flushing.
   * @param timestamp Optional timestamp to use as end time
   */
  async flushAsync(timestamp?: number): Promise<void> {
    await this.audioProcessor.flushAsync(timestamp);
  }

  /**
   * Wait for the VAD processing queue to be empty
   */
  async waitForVADQueue(): Promise<void> {
    await this.audioProcessor.waitForVADQueue();
  }

  /**
   * Get the VAD processing queue length
   */
  getVADQueueLength(): number {
    return this.audioProcessor.getVADQueueLength();
  }

  /**
   * Get current SDK state
   */
  getState(): SDKState {
    return this.state;
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<SDKConfig> {
    return { ...this.config };
  }

  /**
   * Get capture options from config
   */
  private getCaptureOptions(deviceId: string): CaptureOptions {
    return {
      deviceId,
      sampleRate: this.config.sampleRate,
      channelCount: this.config.channelCount,
      frameSize: this.config.frameSize,
    };
  }

  /**
   * Set SDK state and emit event
   */
  private setState(state: SDKState): void {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    this.setState('error');
    const sdkError: SDKError = error as SDKError;
    if (!sdkError.code) {
      sdkError.code = 'SDK_ERROR';
    }
    this.emit('error', sdkError);
    console.error('SDK Error:', error);
  }

  /**
   * Cleanup and destroy SDK instance
   */
  async destroy(): Promise<void> {
    await this.stop();
    await this.audioProcessor.close();
    this.removeAllListeners();
    this.deviceManager.removeAllListeners();
    this.audioCapture.removeAllListeners();
    this.audioProcessor.removeAllListeners();
  }
}

/**
 * @deprecated Use RTA instead. RealtimeAudioSDK will be removed in a future version.
 */
export class RealtimeAudioSDK extends RTA {}
