import type {
  ActiveVoteRound,
  GameMode,
  Role,
  VoteChoiceType,
  WitchChoice,
} from "./enums";

type BaseGameAction = {
  idempotencyKey: string;
};

export type GameAction = BaseGameAction &
  (
    | {
        type: "create_game";
        mode: GameMode;
        boardId: string;
        humanPlayerId: string;
      }
    | {
        type: "confirm_role_setup";
        playerId: string;
        selectedRole: Role;
      }
    | {
        type: "confirm_role_reveal";
        playerId: string;
      }
    | {
        type: "submit_night_action";
        actorId: string;
        // 狼刀 / 预言家验 / 守卫守护走这里；女巫、猎人各有独立动作。
        actionType: "werewolf_kill" | "seer_check" | "guard_protect";
        targetId?: string;
      }
    | {
        type: "submit_witch_action";
        actorId: string;
        witchChoice: WitchChoice;
        // save 无需 target（救被刀者）；poison 需要 targetId；skip 无 target。
        targetId?: string;
      }
    | {
        type: "submit_hunter_shoot";
        actorId: string;
        // 开枪带走的目标；不开枪则省略。
        targetId?: string;
      }
    | {
        type: "confirm_day_announcement";
        playerId: string;
      }
    | {
        type: "submit_speech";
        speakerId: string;
        text: string;
      }
    | {
        type: "submit_vote";
        voterId: string;
        voteRound: ActiveVoteRound;
        choiceType: VoteChoiceType;
        targetId?: string;
      }
    | {
        type: "submit_tie_speech";
        speakerId: string;
        text: string;
      }
    | {
        type: "submit_last_words";
        speakerId: string;
        text: string;
      }
    | {
        type: "confirm_new_game";
        playerId: string;
      }
  );
