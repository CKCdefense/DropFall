import { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from '@dropfall/shared';
import { assetAttr } from './assets';
import { el } from './dom';

export interface CodeInput {
  wrapper: HTMLElement;
  /** 4칸을 합친 값 (대문자) */
  getValue(): string;
  focus(): void;
}

/**
 * 방 코드 입력 — 한 글자씩 4칸 (와이어프레임 기준).
 *
 * 칸을 나누면 자릿수가 눈에 보여서 오타가 줄지만, 그만큼 입력 편의를 직접 챙겨야 한다:
 * 자동 다음 칸 이동, 백스페이스로 이전 칸 복귀, 붙여넣기 한 번에 채우기, 방향키 이동.
 * 이게 없으면 나눠놓은 게 오히려 불편해진다.
 */
export function createCodeInput(onComplete?: () => void): CodeInput {
  const boxes: HTMLInputElement[] = [];

  const focusAt = (index: number) => {
    const box = boxes[Math.max(0, Math.min(index, boxes.length - 1))];
    box?.focus();
    box?.select();
  };

  const fill = (text: string, from = 0) => {
    const chars = text.toUpperCase().split('');
    let cursor = from;
    for (const char of chars) {
      if (cursor >= boxes.length) break;
      if (!ROOM_CODE_ALPHABET.includes(char)) continue;
      boxes[cursor].value = char;
      cursor += 1;
    }
    focusAt(cursor);
    if (cursor >= boxes.length) onComplete?.();
  };

  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const box = el('input', {
      class: 'code-box',
      type: 'text',
      maxlength: 1,
      inputmode: 'latin',
      autocomplete: 'off',
      'aria-label': `방 코드 ${i + 1}번째 글자`,
      ...assetAttr('input'),
    });

    box.addEventListener('input', () => {
      const value = box.value.toUpperCase();
      // 허용되지 않은 글자는 애초에 받지 않는다 (0/O, 1/I 등은 코드 알파벳에서 제외돼 있다)
      box.value = ROOM_CODE_ALPHABET.includes(value) ? value : '';
      if (!box.value) return;

      if (i === ROOM_CODE_LENGTH - 1) onComplete?.();
      else focusAt(i + 1);
    });

    box.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !box.value) {
        event.preventDefault();
        focusAt(i - 1);
        if (boxes[i - 1]) boxes[i - 1].value = '';
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusAt(i - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusAt(i + 1);
      }
    });

    box.addEventListener('paste', (event) => {
      event.preventDefault();
      fill(event.clipboardData?.getData('text') ?? '', i);
    });

    boxes.push(box);
  }

  const wrapper = el('div', { class: 'code-boxes' }, boxes);

  return {
    wrapper,
    getValue: () => boxes.map((box) => box.value).join(''),
    focus: () => focusAt(0),
  };
}
