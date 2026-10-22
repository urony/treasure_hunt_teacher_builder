/**
 * המרת הקלטה לקובץ WAV סטנדרטי (PCM 16-bit מונו).
 * סיבה: MediaRecorder ב-Chrome באנדרואיד מייצר MP4 "מקוטע" שוואטסאפ ואפליקציות אחרות לא מצליחים לעבד
 * ("עיבוד השמע נכשל"), וגם שיתוף שלו נכשל. WAV מתנגן ונשלח בכל מכשיר.
 * 16kHz מונו מספיק לדיבור, וגודלו כ-1.9MB לדקה.
 */
export const WAV_SAMPLE_RATE = 16000;
const MAX_SECONDS = 300;

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataLen = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // גודל בלוק fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // מונו
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** מפענח הקלטה (mp4/webm/ogg/mp3...) ומחזיר WAV. זורק שגיאה אם הדפדפן לא מצליח לפענח. */
export async function toWav(blob: Blob, sampleRate = WAV_SAMPLE_RATE): Promise<Blob> {
  const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(raw, res, rej));
    if (decoded.duration > MAX_SECONDS) throw new Error('too long');
    const frames = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const off = new OfflineAudioContext(1, frames, sampleRate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), sampleRate);
  } finally {
    void ctx.close?.();
  }
}
