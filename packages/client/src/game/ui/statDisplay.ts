/**
 * 스탯 게이지 공용 눈금·색.
 *
 * 하단 직업/스탯 칸(QuickSlotBar)과 캐릭터 창(CharacterModal)이 **같은 스탯을 같은
 * 모양**으로 그려야 한다 — 칸의 작은 게이지가 창의 큰 게이지의 축소판으로 읽히려면
 * 눈금과 색이 한 곳에서 나와야 한다. 두 곳에서 따로 정하면 반드시 어긋난다.
 */

/**
 * 게이지가 가득 찼다고 볼 기준값. 레벨·성장 상한이 아직 없어서 "지금 수치가 대략
 * 어디쯤인가"만 보여주는 눈금이다 — 숫자는 창에 그대로 적으므로 이 값이 조금
 * 어긋나도 정보가 틀리지는 않는다. 성장 상한이 생기면 그 값으로 바꾼다.
 */
export const STAT_FULL = { hp: 200, stamina: 200, attack: 40 } as const;

/** 체력 초록 — 체력 바(barColor의 정상 구간)와 같은 색. */
export const STAT_HP_COLOR = 0x6fd08c;
/** 스태미나 파랑 — 하단 스태미나 바와 같은 색. */
export const STAT_STAMINA_COLOR = 0x6f9fd0;
/** 공격력 금색 — 검 아이콘의 코등이와 같은 계열. */
export const STAT_ATTACK_COLOR = 0xd0a05f;
