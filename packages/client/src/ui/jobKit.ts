import { SLOT_COUNT, itemsData, jobStartingItems, type JobId } from '@dropfall/shared';
import { itemIcon } from './characterPortrait';
import { el } from './dom';

/**
 * 직업 시작 지급품을 **퀵슬롯 네 칸 그대로** 그린다.
 *
 * 글자로 적으면 "붕대 ×2"가 몇 번 칸에 있는지 알 수 없다. 지급품은 칸까지 정해져
 * 있으므로(loadout.json의 slot) 인게임과 같은 배치로 보여주는 편이 정확하고, 게임에
 * 들어간 뒤에도 손이 같은 자리를 찾는다.
 *
 * 대기실(멀티)과 혼자하기 모달이 **같은 조각**을 쓴다 — 같은 정보가 화면마다 다르게
 * 생기면 같은 것이라는 걸 알아보기 어렵다.
 *
 * @param job 직업. null이면 빈 칸 네 개(자리만 잡는 용도).
 */
export function jobKitRow(job: JobId | null): HTMLElement {
  const kit = job ? jobStartingItems(job) : [];

  return el(
    'div',
    { class: 'slot-kit' },
    Array.from({ length: SLOT_COUNT }, (_, index) => {
      const entry = kit.find((item) => (item.slot ?? -1) === index);
      if (!entry) {
        return el('div', { class: 'kit-cell' }, [el('span', { class: 'kit-num' }, [`${index + 1}`])]);
      }

      const name = itemsData[entry.itemId]?.name ?? entry.itemId;
      /*
       * 인원수만큼 주는 항목(의무병 붕대)은 숫자 대신 그렇다고 적는다 — 방을 고르는
       * 시점에는 아직 인원이 확정되지 않아 정확한 개수를 말할 수 없다.
       */
      const count = entry.perPlayer ? '×N' : entry.count > 1 ? `${entry.count}` : '';
      return el(
        'div',
        { class: 'kit-cell kit-filled', title: `${name}${count ? ` ${count}` : ''}` },
        [
          itemIcon(entry.itemId) ?? el('span', { class: 'kit-mark' }, [name.charAt(0)]),
          count ? el('span', { class: 'kit-count' }, [count]) : null,
        ],
      );
    }),
  );
}
