import { type Page } from '@playwright/test';

export interface ToneHandle {
  stop: () => Promise<void>;
}

export async function injectSineWave(page: Page, frequency: number): Promise<ToneHandle> {
  await page.evaluate((freq) => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(ctx.destination);
    osc.start();
    (window as unknown as Record<string, unknown>).__streamlate_osc = osc;
    (window as unknown as Record<string, unknown>).__streamlate_ctx = ctx;
  }, frequency);

  return {
    stop: async () => {
      await page.evaluate(() => {
        const osc = (window as unknown as Record<string, unknown>).__streamlate_osc as OscillatorNode;
        const ctx = (window as unknown as Record<string, unknown>).__streamlate_ctx as AudioContext;
        osc?.stop();
        ctx?.close();
      });
    },
  };
}

export async function detectDominantFrequency(
  page: Page,
  timeoutMs: number = 15000
): Promise<number> {
  return page.evaluate(
    async ({ timeoutMs }) => {
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Frequency detection timed out')), timeoutMs);

        const audioEl = document.querySelector('audio') as HTMLAudioElement;
        if (!audioEl || !audioEl.srcObject) {
          clearTimeout(timeout);
          reject(new Error('No audio element or stream'));
          return;
        }

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(audioEl.srcObject as MediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 8192;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        const sampleRate = ctx.sampleRate;
        let attempts = 0;

        function check() {
          attempts++;
          analyser.getFloatFrequencyData(dataArray);

          let maxVal = -Infinity;
          let maxIdx = 0;
          for (let i = 1; i < bufferLength; i++) {
            if (dataArray[i] > maxVal) {
              maxVal = dataArray[i];
              maxIdx = i;
            }
          }

          const dominantFreq = (maxIdx * sampleRate) / analyser.fftSize;

          if (maxVal > -60 && dominantFreq > 100) {
            clearTimeout(timeout);
            source.disconnect();
            ctx.close();
            resolve(dominantFreq);
          } else if (attempts > 500) {
            clearTimeout(timeout);
            source.disconnect();
            ctx.close();
            reject(new Error(`Could not detect frequency. Max: ${maxVal.toFixed(1)} dB at ${dominantFreq.toFixed(0)} Hz`));
          } else {
            requestAnimationFrame(check);
          }
        }

        if (ctx.state === 'suspended') ctx.resume();
        check();
      });
    },
    { timeoutMs }
  );
}

export async function assertAudioFrequency(
  page: Page,
  expectedHz: number,
  toleranceHz: number,
  timeoutMs: number
): Promise<void> {
  await page.evaluate(
    async ({ expectedHz, toleranceHz, timeoutMs }) => {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        analyser.getFloatFrequencyData(dataArray);
        let maxIndex = 0;
        let maxValue = -Infinity;
        for (let i = 0; i < bufferLength; i++) {
          if (dataArray[i] > maxValue) {
            maxValue = dataArray[i];
            maxIndex = i;
          }
        }
        const dominantHz = (maxIndex * ctx.sampleRate) / analyser.fftSize;
        if (Math.abs(dominantHz - expectedHz) <= toleranceHz) {
          ctx.close();
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      ctx.close();
      throw new Error(`Expected frequency ${expectedHz} Hz not detected within ${timeoutMs}ms`);
    },
    { expectedHz, toleranceHz, timeoutMs }
  );
}

export async function assertAudioAboveSilence(
  page: Page,
  thresholdDb: number,
  timeoutMs: number
): Promise<void> {
  await page.evaluate(
    async ({ thresholdDb, timeoutMs }) => {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const bufferLength = analyser.fftSize;
      const dataArray = new Float32Array(bufferLength);

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const db = 20 * Math.log10(rms);
        if (db > thresholdDb) {
          ctx.close();
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      ctx.close();
      throw new Error(`Audio did not exceed ${thresholdDb} dB within ${timeoutMs}ms`);
    },
    { thresholdDb, timeoutMs }
  );
}

export async function assertAudioSilent(
  page: Page,
  thresholdDb: number,
  durationMs: number
): Promise<void> {
  await page.evaluate(
    async ({ thresholdDb, durationMs }) => {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const bufferLength = analyser.fftSize;
      const dataArray = new Float32Array(bufferLength);

      const start = Date.now();
      while (Date.now() - start < durationMs) {
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const db = 20 * Math.log10(rms);
        if (db > thresholdDb) {
          ctx.close();
          throw new Error(`Audio exceeded silence threshold: ${db} dB > ${thresholdDb} dB`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      ctx.close();
    },
    { thresholdDb, durationMs }
  );
}

export async function getVUMeterLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const meter = document.querySelector('[data-testid="vu-meter"]');
    if (!meter) return -1;
    return parseFloat(meter.getAttribute('data-level') || '0');
  });
}

export async function getVUMeterDb(page: Page): Promise<number> {
  return page.evaluate(() => {
    const meter = document.querySelector('[data-testid="vu-meter"]');
    if (!meter) return -100;
    return parseFloat(meter.getAttribute('data-rms-db') || '-100');
  });
}
