import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import { AudioProcessor } from '../src/processing/AudioProcessor';
import { AudioLoader, type AudioData } from './utils/audio-loader';
import type {
  AudioProcessorResult,
  VADStateEvent,
  VADSegment,
  VADConfig
} from '../src/types';

// Skip VAD tests in Node.js environment (requires browser/WASM)
describe.skip('VAD (Voice Activity Detection) Tests', () => {
  let audioData: AudioData;
  let audioFrames: Float32Array[];

  beforeAll(async () => {
    // Load test audio file
    const audioPath = path.join(__dirname, 'vad_test_en.wav');
    audioData = await AudioLoader.loadWavFile(audioPath);

    // Split into 20ms frames (standard frame size)
    audioFrames = AudioLoader.splitIntoFrames(audioData, 20);

    console.log('Test audio loaded:', {
      duration: `${audioData.duration.toFixed(2)}s`,
      sampleRate: `${audioData.sampleRate}Hz`,
      frames: audioFrames.length,
      channels: audioData.channels
    });
  });

  describe('Energy Calculation', () => {
    it('should calculate energy correctly', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: false  // Disable VAD to test energy calculation
        }
      });

      const energyValues: number[] = [];

      for (let i = 0; i < Math.min(100, audioFrames.length); i++) {
        const timestamp = (i * 20);
        const result = await processor.process(audioFrames[i], timestamp);

        if (result.energy !== undefined) {
          energyValues.push(result.energy);
        }
      }

      expect(energyValues.length).toBeGreaterThan(0);

      // Energy should vary (not all the same)
      const uniqueEnergies = new Set(energyValues);
      expect(uniqueEnergies.size).toBeGreaterThan(1);

      // Energy should be in reasonable range
      const maxEnergy = Math.max(...energyValues);
      const minEnergy = Math.min(...energyValues);
      expect(maxEnergy).toBeLessThanOrEqual(1.0);
      expect(minEnergy).toBeGreaterThanOrEqual(0);

      processor.close();
    });
  });

  describe('Silero VAD', () => {
    let processor: AudioProcessor;
    let speechSegments: VADSegment[] = [];
    let speechStateEvents: VADStateEvent[] = [];

    beforeEach(() => {
      speechSegments = [];
      speechStateEvents = [];
    });

    it('should initialize and process audio with Silero VAD', async () => {
      const config: VADConfig = {
        enabled: true,
        positiveSpeechThreshold: 0.3,
        negativeSpeechThreshold: 0.25,
        silenceDuration: 800,
        preSpeechPadDuration: 500,
        minSpeechDuration: 400,
        modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
      };

      processor = new AudioProcessor({
        vad: config
      });

      // Setup event listeners
      processor.on('speech-state', (event: VADStateEvent) => {
        speechStateEvents.push(event);
        if (event.type === 'end' && event.segment) {
          speechSegments.push(event.segment);
        }
      });

      // Initialize Silero VAD
      await processor.initialize();

      let detectedSpeechFrames = 0;
      const results: AudioProcessorResult[] = [];

      // Process all frames
      for (let i = 0; i < audioFrames.length; i++) {
        const timestamp = (i * 20);
        const result = await processor.process(audioFrames[i], timestamp);
        results.push(result);

        if (result.vad?.isSpeech) {
          detectedSpeechFrames++;
        }

        // Check speech probability is included
        if (result.vad?.probability !== undefined) {
          expect(result.vad.probability).toBeGreaterThanOrEqual(0);
          expect(result.vad.probability).toBeLessThanOrEqual(1);
        }
      }

      processor.flush();

      // Verify Silero VAD detected speech
      expect(detectedSpeechFrames).toBeGreaterThan(0);

      // Count start and end events
      const startEvents = speechStateEvents.filter(e => e.type === 'start');
      const endEvents = speechStateEvents.filter(e => e.type === 'end');

      // Verify events were fired
      console.log('\n=== Silero VAD Detection Results ===');
      console.log('Overall Statistics:', {
        speechFrames: detectedSpeechFrames,
        totalFrames: audioFrames.length,
        speechRatio: `${(detectedSpeechFrames / audioFrames.length * 100).toFixed(1)}%`,
        totalSegments: speechSegments.length,
        startEvents: startEvents.length,
        endEvents: endEvents.length
      });

      // Log detailed segment information
      if (speechSegments.length > 0) {
        console.log('\nDetected Speech Segments:');
        speechSegments.forEach((segment, index) => {
          console.log(`  Segment ${index + 1}:`, {
            startTime: `${segment.startTime}ms`,
            endTime: `${segment.endTime}ms`,
            duration: `${segment.duration}ms`,
            audioSamples: segment.audio ? segment.audio.length : 0,
            avgProbability: segment.avgProbability.toFixed(3),
            confidence: segment.confidence.toFixed(3)
          });

          // Save each segment as WAV file
          if (segment.audio && segment.audio.length > 0) {
            const fileName = `segment_${index + 1}_${segment.startTime}ms-${segment.endTime}ms.wav`;
            const filePath = path.join(__dirname, fileName);
            AudioLoader.saveWavFile(filePath, segment.audio, audioData.sampleRate);
            console.log(`    Saved to: ${fileName}`);
          }
        });

        // Calculate total speech duration
        const totalSpeechDuration = speechSegments.reduce((sum, seg) => sum + seg.duration, 0);
        const avgSegmentDuration = totalSpeechDuration / speechSegments.length;

        console.log('\nSegment Statistics:');
        console.log(`  Total speech duration: ${totalSpeechDuration}ms`);
        console.log(`  Average segment duration: ${avgSegmentDuration.toFixed(1)}ms`);
        console.log(`  Shortest segment: ${Math.min(...speechSegments.map(s => s.duration))}ms`);
        console.log(`  Longest segment: ${Math.max(...speechSegments.map(s => s.duration))}ms`);
      }
      console.log('=' + '='.repeat(35) + '\n');

      // Should have detected speech segments
      expect(startEvents.length).toBeGreaterThan(0);
      expect(endEvents.length).toBeGreaterThan(0);
      expect(speechSegments.length).toBeGreaterThan(0);

      // Verify segment structure
      speechSegments.forEach(segment => {
        expect(segment.duration).toBeGreaterThan(0);
        expect(segment.endTime).toBeGreaterThan(segment.startTime);
        expect(segment.duration).toBe(segment.endTime - segment.startTime);
        if (segment.audio) {
          expect(segment.audio.length).toBeGreaterThan(0);
        }
      });
    });

    it('should return consistent probabilities', async () => {
      const config: VADConfig = {
        enabled: true,
        positiveSpeechThreshold: 0.3,
        negativeSpeechThreshold: 0.25,
        modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
      };

      processor = new AudioProcessor({
        vad: config
      });

      await processor.initialize();

      const speechProbabilities: number[] = [];

      // Process subset of frames
      for (let i = 0; i < Math.min(100, audioFrames.length); i++) {
        const timestamp = (i * 20);
        const result = await processor.process(audioFrames[i], timestamp);

        if (result.vad?.probability !== undefined) {
          speechProbabilities.push(result.vad.probability);
        }
      }

      // All frames should have probability
      expect(speechProbabilities.length).toBe(Math.min(100, audioFrames.length));

      // Probabilities should be in valid range
      speechProbabilities.forEach(prob => {
        expect(prob).toBeGreaterThanOrEqual(0);
        expect(prob).toBeLessThanOrEqual(1);
      });

      // Should have variation in probabilities
      const uniqueProbs = new Set(speechProbabilities.map(p => Math.round(p * 100)));
      expect(uniqueProbs.size).toBeGreaterThan(1);
    });

    it('should respect configuration thresholds', async () => {
      // Test with high thresholds (less sensitive)
      const strictConfig: VADConfig = {
        enabled: true,
        positiveSpeechThreshold: 0.7,  // Very high threshold
        negativeSpeechThreshold: 0.6,
        silenceDuration: 500,
        minSpeechDuration: 200,
        modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
      };

      processor = new AudioProcessor({
        vad: strictConfig
      });

      await processor.initialize();

      let strictSpeechFrames = 0;

      for (let i = 0; i < audioFrames.length; i++) {
        const timestamp = (i * 20);
        const result = await processor.process(audioFrames[i], timestamp);

        if (result.vad?.isSpeech) {
          strictSpeechFrames++;
        }
      }

      // Now test with low thresholds (more sensitive)
      const sensitiveConfig: VADConfig = {
        enabled: true,
        positiveSpeechThreshold: 0.1,  // Very low threshold
        negativeSpeechThreshold: 0.05,
        silenceDuration: 2000,
        minSpeechDuration: 100,
        modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
      };

      const sensitiveProcessor = new AudioProcessor({
        vad: sensitiveConfig
      });

      await sensitiveProcessor.initialize();

      let sensitiveSpeechFrames = 0;

      for (let i = 0; i < audioFrames.length; i++) {
        const timestamp = (i * 20);
        const result = await sensitiveProcessor.process(audioFrames[i], timestamp);

        if (result.vad?.isSpeech) {
          sensitiveSpeechFrames++;
        }
      }

      // Sensitive detection should detect more speech
      expect(sensitiveSpeechFrames).toBeGreaterThan(strictSpeechFrames);

      console.log('Threshold comparison:', {
        strict: `${(strictSpeechFrames / audioFrames.length * 100).toFixed(1)}%`,
        sensitive: `${(sensitiveSpeechFrames / audioFrames.length * 100).toFixed(1)}%`
      });

      await sensitiveProcessor.close();
    });

    it('should flush pending speech segment on close', async () => {
      const config: VADConfig = {
        enabled: true,
        positiveSpeechThreshold: 0.3,
        negativeSpeechThreshold: 0.25,
        silenceDuration: 800,
        minSpeechDuration: 400,
        modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
      };

      processor = new AudioProcessor({
        vad: config
      });

      await processor.initialize();

      const speechSegments: VADSegment[] = [];
      processor.on('speech-state', (event: VADStateEvent) => {
        if (event.type === 'end' && event.segment) {
          speechSegments.push(event.segment);
        }
      });

      // Process only first half of audio (simulate incomplete stream)
      const halfFrames = Math.floor(audioFrames.length / 2);
      for (let i = 0; i < halfFrames; i++) {
        const timestamp = (i * 20);
        await processor.process(audioFrames[i], timestamp);
      }

      // Close processor (should flush any pending speech segment)
      await processor.close();

      console.log('Flush test - segments captured:', speechSegments.length);

      // Should have at least one segment even though we didn't process till the end
      expect(speechSegments.length).toBeGreaterThan(0);

      if (speechSegments.length > 0) {
        const lastSegment = speechSegments[speechSegments.length - 1];
        console.log('Last segment (flushed):', {
          startTime: `${lastSegment.startTime}ms`,
          endTime: `${lastSegment.endTime}ms`,
          duration: `${lastSegment.duration}ms`,
          audioSamples: lastSegment.audio ? lastSegment.audio.length : 0
        });

        // Save flushed segment
        if (lastSegment.audio && lastSegment.audio.length > 0) {
          const fileName = `flushed_segment_${lastSegment.startTime}ms-${lastSegment.endTime}ms.wav`;
          const filePath = path.join(__dirname, fileName);
          AudioLoader.saveWavFile(filePath, lastSegment.audio, audioData.sampleRate);
          console.log(`Saved flushed segment to: ${fileName}`);
        }
      }
    });

    afterAll(async () => {
      if (processor) {
        await processor.close();
      }
    });
  });

  describe('VAD Processing', () => {
    it('should process audio efficiently', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: true,
          positiveSpeechThreshold: 0.3,
          negativeSpeechThreshold: 0.25,
          modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
        }
      });

      await processor.initialize();

      let speechFrames = 0;
      const results: boolean[] = [];
      const probabilities: number[] = [];

      for (let i = 0; i < audioFrames.length; i++) {
        const timestamp = (i * 20);
        const result = await processor.process(audioFrames[i], timestamp);

        if (result.vad?.isSpeech) {
          speechFrames++;
          results.push(true);
        } else {
          results.push(false);
        }

        if (result.vad?.probability !== undefined) {
          probabilities.push(result.vad.probability);
        }
      }

      console.log('VAD Processing Results:', {
        speechFrames: speechFrames,
        speechRatio: `${(speechFrames / audioFrames.length * 100).toFixed(1)}%`,
        avgProbability: probabilities.length > 0
          ? (probabilities.reduce((a, b) => a + b, 0) / probabilities.length).toFixed(3)
          : 'N/A'
      });

      // Should detect some speech
      expect(speechFrames).toBeGreaterThan(0);
      expect(speechFrames).toBeLessThan(audioFrames.length);

      // Cleanup
      await processor.close();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should measure processing speed', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: false  // Disable VAD for pure processing speed test
        }
      });

      const startTime = performance.now();

      for (let i = 0; i < audioFrames.length; i++) {
        const timestamp = (i * 20);
        await processor.process(audioFrames[i], timestamp);
      }

      const endTime = performance.now();
      const processingTime = endTime - startTime;
      const realTimeRatio = (audioData.duration * 1000) / processingTime;

      console.log('Audio Processing Performance:', {
        processingTime: `${processingTime.toFixed(2)}ms`,
        audioLength: `${(audioData.duration * 1000).toFixed(2)}ms`,
        realTimeRatio: `${realTimeRatio.toFixed(2)}x`,
        framesPerSecond: Math.round((audioFrames.length / processingTime) * 1000)
      });

      // Should be faster than real-time
      expect(realTimeRatio).toBeGreaterThan(1);

      await processor.close();
    });

    it('should measure processing speed for Silero VAD', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: true,
          modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
        }
      });

      await processor.initialize();

      const startTime = performance.now();

      for (let i = 0; i < audioFrames.length; i++) {
        const timestamp = (i * 20);
        await processor.process(audioFrames[i], timestamp);
      }

      const endTime = performance.now();
      const processingTime = endTime - startTime;
      const realTimeRatio = (audioData.duration * 1000) / processingTime;

      console.log('Silero VAD Performance:', {
        processingTime: `${processingTime.toFixed(2)}ms`,
        audioLength: `${(audioData.duration * 1000).toFixed(2)}ms`,
        realTimeRatio: `${realTimeRatio.toFixed(2)}x`,
        framesPerSecond: Math.round((audioFrames.length / processingTime) * 1000)
      });

      // Should be reasonable speed (might be slower than energy VAD)
      expect(processingTime).toBeLessThan(audioData.duration * 1000 * 10); // Not more than 10x slower than real-time

      await processor.close();
    });

    it('should measure memory usage', () => {
      if (global.gc) {
        global.gc(); // Force garbage collection if available
      }

      const initialMemory = process.memoryUsage();

      // Create processor with Silero VAD
      new AudioProcessor({
        vad: {
          enabled: true,
          modelPath: path.join(__dirname, '../public/models/silero_vad_v5.onnx')
        } as VADConfig
      });

      const afterCreation = process.memoryUsage();

      const memoryIncrease = {
        heapUsed: (afterCreation.heapUsed - initialMemory.heapUsed) / 1024 / 1024,
        external: (afterCreation.external - initialMemory.external) / 1024 / 1024
      };

      console.log('Memory Usage:', {
        heapIncrease: `${memoryIncrease.heapUsed.toFixed(2)} MB`,
        externalIncrease: `${memoryIncrease.external.toFixed(2)} MB`
      });

      // Memory increase should be reasonable
      expect(memoryIncrease.heapUsed).toBeLessThan(100); // Less than 100MB
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty audio frames', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: false
        }
      });

      const emptyFrame = new Float32Array(320); // 20ms at 16kHz, all zeros
      const result = await processor.process(emptyFrame, 0);

      expect(result).toBeDefined();
      expect(result.energy).toBe(0);

      await processor.close();
    });

    it('should handle very loud audio', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: false
        }
      });

      const loudFrame = new Float32Array(320);
      loudFrame.fill(0.9); // Near max amplitude
      const result = await processor.process(loudFrame, 0);

      expect(result).toBeDefined();
      expect(result.energy).toBeGreaterThan(0);

      await processor.close();
    });

    it('should reset VAD state correctly', async () => {
      const processor = new AudioProcessor({
        vad: {
          enabled: true
        } as VADConfig
      });

      // Process some frames
      for (let i = 0; i < 10; i++) {
        await processor.process(audioFrames[i], i * 20);
      }

      // Reset VAD
      processor.resetVAD();

      // Process again - should start fresh
      const result = await processor.process(audioFrames[0], 0);
      expect(result).toBeDefined();

      await processor.close();
    });
  });
});
