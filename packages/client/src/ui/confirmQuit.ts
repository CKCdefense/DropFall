import { assetAttr } from './assets';
import { el } from './dom';

/**
 * ESC로 게임을 나갈 때 뜨는 확인창. 예전엔 ESC 한 번에 바로 로비로 돌아갔는데,
 * 오발 입력(오타로 ESC 누름, 채팅창이 닫혀 있는 줄 알고 누름 등) 한 번으로 진행
 * 중이던 판을 통째로 잃는 사고가 있어서 확인 단계를 끼워 넣는다.
 *
 * `#app`(뷰포트에 고정된 앱 셸, index.html)에 직접 붙는다 — 로비 화면(#ui-root)과
 * 인게임 화면(#game-root)이 서로 반대로 숨겨져 있어도(하나가 hidden이면 다른
 * 하나만 보임) 이 확인창은 항상 최상단에 뜬다.
 *
 * 이미 열려 있으면 중복으로 열지 않는다 — main.ts의 keydown 리스너가 매 ESC마다
 * 이 함수를 부르는데, 확인창이 뜬 상태에서 또 ESC를 누르면(취소 리스너가 먼저
 * 닫지 않는 한) 두 번째 호출이 새 창을 겹쳐 만들지 않게 막는 안전장치다.
 */
let activeDialog: HTMLElement | null = null;

export function showQuitConfirm(container: HTMLElement, onConfirm: () => void): void {
  if (activeDialog) return;

  const close = (): void => {
    activeDialog?.remove();
    activeDialog = null;
    window.removeEventListener('keydown', onKey);
  };

  // ESC/Enter는 "확인창을 다시 확인하는" 게 아니라 취소/확인 단축키로 쓴다 —
  // 모달을 여는 키(ESC)가 그 안에서는 닫는 키가 되는 흔한 관례를 따른다.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      close();
      onConfirm();
    }
  };

  const confirmButton = el(
    'button',
    { class: 'btn btn-primary', type: 'button', ...assetAttr('button') },
    ['나가기'],
  );
  confirmButton.addEventListener('click', () => {
    close();
    onConfirm();
  });

  const cancelButton = el('button', { class: 'btn btn-ghost', type: 'button' }, ['취소']);
  cancelButton.addEventListener('click', close);

  const modal = el('div', { class: 'modal confirm-modal', ...assetAttr('modal') }, [
    el('p', { class: 'confirm-message' }, ['정말 나가시겠습니까?']),
    el('div', { class: 'modal-actions' }, [confirmButton, cancelButton]),
  ]);

  const backdrop = el('div', { class: 'modal-backdrop' }, [modal]);
  // 바깥(어두운 배경)을 눌러도 취소와 같다 — 다른 모달들과 동일한 관례(LobbyApp).
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  container.appendChild(backdrop);
  activeDialog = backdrop;
  window.addEventListener('keydown', onKey);
}
