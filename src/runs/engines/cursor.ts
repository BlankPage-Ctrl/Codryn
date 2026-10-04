export interface SseFrame {
  seq: number;
  line: string;
}

export function framesAfter(frames: SseFrame[], afterSeq: number): SseFrame[] {
  const cursor = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  return frames.filter((f) => f.seq > cursor);
}

export function nextSeq(frames: SseFrame[]): number {
  let max = 0;
  for (const f of frames) {
    if (f.seq > max) max = f.seq;
  }
  return max;
}
