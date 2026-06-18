import type {
  ActiveVoteRound,
  GameMode,
  NightActionType,
  Role,
  VoteChoiceType,
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
        actionType: Exclude<NightActionType, "none">;
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
        type: "request_fast_forward";
        playerId: string;
      }
    | {
        type: "confirm_new_game";
        playerId: string;
      }
  );
