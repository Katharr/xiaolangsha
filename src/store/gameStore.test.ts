import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { ScriptedAiClient } from "../ai-client";
import { createGameDatabase } from "../storage";
import { recoverGame } from "../storage";

import { createGameStore } from "./gameStore";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";
const now = () => "2026-06-19T13:00:00.000Z";

let dbCounter = 0;
function freshDb() {
  dbCounter += 1;
  return createGameDatabase(`store-test-${dbCounter}`);
}

async function startFreeVillagerGame(store: ReturnType<typeof createGameStore>) {
  await store.getState().dispatch({
    type: "create_game",
    idempotencyKey: "s-create",
    mode: "free",
    boardId,
    humanPlayerId,
  });
  await store.getState().dispatch({
    type: "confirm_role_setup",
    idempotencyKey: "s-setup",
    playerId: humanPlayerId,
    selectedRole: "villager",
  });
  await store.getState().dispatch({
    type: "confirm_role_reveal",
    idempotencyKey: "s-reveal",
    playerId: humanPlayerId,
  });
}

describe("createGameStore", () => {
  it("dispatches through the engine, drives AI, derives the human view and persists", async () => {
    const db = freshDb();
    const store = createGameStore({ ai: new ScriptedAiClient(), db, now });

    await store.getState().bootstrap();
    expect(store.getState().ready).toBe(true);

    await startFreeVillagerGame(store);

    const state = store.getState();
    expect(state.busy).toBe(false);
    // 真人是平民，driver 跑完两个 AI 夜晚行动后停在需真人确认的天亮播报。
    expect(state.snapshot?.gamePhase).toBe("day_announcement");
    // ISO-001：暴露给 UI 的是真人视角。
    expect(state.visibleInformation?.viewerId).toBe(humanPlayerId);
    expect(state.messages.length).toBeGreaterThan(0);

    // 已原子持久化，可被恢复。
    const recovered = await recoverGame(db);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.data.status).toBe("recovered");
      if (recovered.data.status === "recovered") {
        expect(recovered.data.game.snapshot.gamePhase).toBe("day_announcement");
      }
    }
  });

  it("rejects an illegal action with lastError and leaves the phase unchanged", async () => {
    const db = freshDb();
    const store = createGameStore({ ai: new ScriptedAiClient(), db, now });
    await store.getState().bootstrap();
    await startFreeVillagerGame(store);

    const phaseBefore = store.getState().snapshot?.gamePhase;
    await store.getState().dispatch({
      type: "submit_speech",
      idempotencyKey: "s-illegal-speech",
      speakerId: humanPlayerId,
      text: "现在还不能发言。",
    });

    const state = store.getState();
    expect(state.lastError).not.toBeNull();
    expect(state.busy).toBe(false);
    expect(state.snapshot?.gamePhase).toBe(phaseBefore);
  });

  it("recovers a persisted game in a fresh store on bootstrap", async () => {
    const db = freshDb();
    const first = createGameStore({ ai: new ScriptedAiClient(), db, now });
    await first.getState().bootstrap();
    await startFreeVillagerGame(first);

    // 同一 db、全新 store：bootstrap 应恢复到天亮播报。
    const second = createGameStore({ ai: new ScriptedAiClient(), db, now });
    await second.getState().bootstrap();

    const state = second.getState();
    expect(state.ready).toBe(true);
    expect(state.snapshot?.gamePhase).toBe("day_announcement");
    expect(state.visibleInformation?.viewerId).toBe(humanPlayerId);
  });
});
