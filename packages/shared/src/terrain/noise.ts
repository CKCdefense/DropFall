/**
 * 결정론적 값 노이즈.
 *
 * **왜 Math.random을 안 쓰나**
 * 지형은 모든 플레이어에게 똑같이 보여야 한다. 같은 방에 있는 두 사람이 다른 사막을 보면
 * "저기 바위 뒤"라는 말이 통하지 않는다. 좌표와 시드만 넣으면 언제 어디서 계산해도 같은
 * 값이 나오는 함수여야 한다 — 그래서 상태를 들고 있는 난수 생성기가 아니라 해시를 쓴다.
 *
 * 서버가 지형을 내려보내지 않고 각자 계산하는 이유도 같다. 128×128 타일을 전송할 필요 없이
 * 시드 하나만 맞추면 된다.
 */

/** 정수 좌표 → [0, 1). 인접한 좌표끼리 상관관계가 없도록 비트를 충분히 섞는다. */
export function hashNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 5차 스무스스텝. 격자 사이를 부드럽게 이어 노이즈에 각진 자국이 남지 않게 한다. */
function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 격자점 해시값을 보간한 값 노이즈. 실수 좌표를 받는다. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);

  const n00 = hashNoise(x0, y0, seed);
  const n10 = hashNoise(x0 + 1, y0, seed);
  const n01 = hashNoise(x0, y0 + 1, seed);
  const n11 = hashNoise(x0 + 1, y0 + 1, seed);

  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * 옥타브를 겹친 노이즈(fBm). 한 겹만 쓰면 덩어리가 너무 매끈해서 인공적으로 보인다 —
 * 주파수를 배로 올리고 진폭을 반으로 줄인 겹을 더해 가장자리에 잔결을 만든다.
 */
export function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let max = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + i * 101) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / max;
}

/** 방 코드처럼 짧은 문자열을 시드로 바꾼다. 방마다 다른 지형이 나오게 하는 용도다. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
