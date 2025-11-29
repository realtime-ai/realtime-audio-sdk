# VAD Frame Alignment

## Problem

The Silero VAD model requires exactly **512 samples** per frame for processing (equivalent to 32ms at 16kHz sample rate). However, the audio capture system is configured to produce chunks of:
- **20ms** = 320 samples
- **40ms** = 640 samples
- **60ms** = 960 samples

This mismatch caused VAD to fail when using 20ms chunks, as 320 samples are insufficient for a single 512-sample VAD frame.

## Solution

We implemented internal buffering in the `SileroVAD` class to accumulate samples across multiple audio chunks:

### Implementation Details

1. **Sample Buffer**: Added `sampleBuffer` to store incomplete frames between calls
2. **Accumulation**: Each new audio chunk is concatenated with buffered samples
3. **Processing**: All complete 512-sample frames are processed
4. **Carryover**: Remaining samples are stored for the next call

### Code Flow

```typescript
// In SileroVAD.process()

// 1. Concatenate new audio with buffer
const combinedAudio = concat(this.sampleBuffer, newAudio);

// 2. Process all complete 512-sample frames
while (offset + 512 <= combinedAudio.length) {
  const frame = combinedAudio.slice(offset, offset + 512);
  processFrame(frame);
  offset += 512;
}

// 3. Store remaining samples
this.sampleBuffer = combinedAudio.slice(offset);
```

## Frame Size Examples

### 20ms Chunks (320 samples)
- **Chunk 1**: 320 samples → No complete frame, buffered
- **Chunk 2**: 320 + 320 = 640 samples → 1 frame processed, 128 buffered
- **Chunk 3**: 128 + 320 = 448 samples → No complete frame, buffered
- **Chunk 4**: 448 + 320 = 768 samples → 1 frame processed, 256 buffered

### 40ms Chunks (640 samples)
- **Chunk 1**: 640 samples → 1 frame processed, 128 buffered
- **Chunk 2**: 128 + 640 = 768 samples → 1 frame processed, 256 buffered
- **Chunk 3**: 256 + 640 = 896 samples → 1 frame processed, 384 buffered

### 60ms Chunks (960 samples)
- **Chunk 1**: 960 samples → 1 frame processed, 448 buffered
- **Chunk 2**: 448 + 960 = 1408 samples → 2 frames processed, 384 buffered
- **Chunk 3**: 384 + 960 = 1344 samples → 2 frames processed, 320 buffered

## Benefits

1. **Compatibility**: VAD works with all supported frame sizes (20/40/60ms)
2. **No Sample Loss**: All audio samples are eventually processed
3. **Accurate Detection**: Speech detection accuracy is maintained
4. **Transparent**: No changes needed to external API or configuration

## Usage

No changes required! Simply configure your desired frame size:

```javascript
const sdk = new RTA({
  frameSize: 20,  // Works with 20, 40, or 60ms
  processing: {
    vad: {
      enabled: true,
      provider: 'silero',
      // ... other VAD settings
    }
  }
});
```

## Testing

Run the alignment tests:
```bash
npm test -- vad-alignment
```

Run the demo:
```bash
node examples/vad-frame-alignment-demo.js
```

## Performance Considerations

- **20ms frames**: May have slight delays as it needs 2 chunks for first VAD frame
- **40ms/60ms frames**: Process VAD frames immediately in first chunk
- **Memory**: Minimal overhead (max 511 samples buffered)
- **Latency**: No additional latency beyond inherent frame accumulation