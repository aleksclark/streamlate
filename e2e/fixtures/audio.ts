import { Page } from '@playwright/test';

export async function assertAudioAboveSilence(
  page: Page,
  thresholdDb: number = -40,
  timeoutMs: number = 15000
): Promise<void> {
  const result = await page.evaluate(
    async ({ thresholdDb, timeoutMs }) => {
      return new Promise<{ rmsDb: number; success: boolean }>((resolve) => {
        const timeout = setTimeout(() => resolve({ rmsDb: -100, success: false }), timeoutMs);

        const audioEl = document.querySelector('audio') as HTMLAudioElement;
        if (!audioEl || !audioEl.srcObject) {
          clearTimeout(timeout);
          resolve({ rmsDb: -100, success: false });
          return;
        }

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(audioEl.srcObject as MediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const dataArray = new Float32Array(analyser.fftSize);

        function check() {
          analyser.getFloatTimeDomainData(dataArray);
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sumSq += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;

          if (rmsDb > thresholdDb) {
            clearTimeout(timeout);
            source.disconnect();
            ctx.close();
            resolve({ rmsDb, success: true });
          } else {
            requestAnimationFrame(check);
          }
        }

        if (ctx.state === 'suspended') ctx.resume();
        check();
      });
    },
    { thresholdDb, timeoutMs }
  );

  if (!result.success) {
    throw new Error(
      `Audio not above silence threshold. Expected > ${thresholdDb} dB, got ${result.rmsDb.toFixed(1)} dB`
    );
  }
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
  toleranceHz: number = 50,
  timeoutMs: number = 15000
): Promise<void> {
  const detectedHz = await detectDominantFrequency(page, timeoutMs);
  if (Math.abs(detectedHz - expectedHz) > toleranceHz) {
    throw new Error(
      `Expected frequency ~${expectedHz} Hz (±${toleranceHz}), detected ${detectedHz.toFixed(0)} Hz`
    );
  }
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
