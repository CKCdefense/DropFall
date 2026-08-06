export * from './constants';
export * from './protocol/messages';
export * from './protocol/room';
export * from './protocol/lobby';
export * from './sim/world';
export * from './sim/movement';
export * from './sim/inventory';
export * from './sim/storage';
export * from './sim/fixedStep';
export * from './data';
export * from './terrain/noise';
export * from './terrain/terrain';
// world.ts가 HIT_RADIUS는 이미 재수출하고 있다 — 원-원 충돌 판정을 클라이언트에서도
// (외삽 시 장애물을 인지하게, docs/backend/42) 그대로 쓸 수 있도록 최소한만 더 연다.
export { circlesOverlap } from './sim/combat';
export { COLONY_RADIUS } from './sim/colony';
