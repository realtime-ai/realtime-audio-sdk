import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

export default defineConfig({
  root: './examples',
  base: '/',
  build: {
    outDir: '../dist-examples',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'examples/index.html'),
        basic: resolve(__dirname, 'examples/basic/index.html'),
        vad: resolve(__dirname, 'examples/vad/index.html'),
        transcription: resolve(__dirname, 'examples/transcription/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  assetsInclude: ['**/*.wasm', '**/*.onnx'],
  plugins: [
    {
      name: 'copy-wasm-assets',
      closeBundle() {
        const distDir = './dist-examples';

        // Copy ONNX models
        const modelsDir = `${distDir}/models`;
        if (!existsSync(modelsDir)) {
          mkdirSync(modelsDir, { recursive: true });
        }

        const sourceModelsDir = './examples/public/models';
        if (existsSync(sourceModelsDir)) {
          const files = readdirSync(sourceModelsDir);
          let onnxFound = false;
          files.forEach(file => {
            if (file.endsWith('.onnx')) {
              const srcPath = `${sourceModelsDir}/${file}`;
              const destPath = `${modelsDir}/${file}`;
              copyFileSync(srcPath, destPath);
              console.log(`Copied: ${file} -> ${destPath}`);
              onnxFound = true;
            }
          });
          if (!onnxFound) {
            console.warn('Warning: No ONNX model files found. VAD features may not work.');
            console.warn('Run: npm run download:model to download the Silero VAD model.');
          }
        }

        // Copy WASM files from onnxruntime-web
        const wasmFiles = [
          'ort-wasm-simd-threaded.wasm',
          'ort-wasm-simd.wasm',
          'ort-wasm.wasm',
          'ort-wasm-simd-threaded.mjs',
          'ort-wasm-simd.mjs',
        ];

        const onnxDist = './node_modules/onnxruntime-web/dist';
        if (existsSync(onnxDist)) {
          wasmFiles.forEach(file => {
            const src = `${onnxDist}/${file}`;
            if (existsSync(src)) {
              copyFileSync(src, `${distDir}/${file}`);
              console.log(`Copied: ${file}`);
            }
          });
        }
      }
    }
  ],
});
