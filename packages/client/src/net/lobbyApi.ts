import type { RoomListItem } from '@dropfall/shared';
import { SERVER_HTTP_URL } from './config';

/**
 * 방 목록 조회.
 * Colyseus 0.17 클라이언트 SDK에는 getAvailableRooms()가 없어서,
 * 서버가 직접 노출한 GET /rooms 를 쓴다. (packages/server/src/index.ts)
 */
export async function fetchRooms(signal?: AbortSignal): Promise<RoomListItem[]> {
  const response = await fetch(`${SERVER_HTTP_URL}/rooms`, { signal });
  if (!response.ok) {
    throw new Error(`방 목록을 불러오지 못했습니다. (HTTP ${response.status})`);
  }
  return (await response.json()) as RoomListItem[];
}
