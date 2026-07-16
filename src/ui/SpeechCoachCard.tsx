import { useState } from "react";

import type { Role } from "../shared";

/**
 * 新手发言提示卡：轮到人类发言时挂在操作区提示下方。第一天默认展开，之后默认收起、
 * 点标题可展开。文案是给人看的公开领域打法，不含任何 AI 隐藏推理（ISO-001 无涉）。
 */
const OPENER =
  "发言三段式：表个态（我怎么看昨晚）→ 给个怀疑或信任（点名+理由）→ 报票向（我今天倾向投谁）。";

const TABOO = "忌：只说「我是好人，过」／复读别人说过的话／没理由地跟票。";

const ROLE_TIPS: Partial<Record<Role, string>> = {
  villager:
    "你是村民，没有夜里的信息，聊感受就够：谁发言空、谁在复读、谁跳了身份你信不信。模板：「我是村民。X号那段我觉得挺真；Y号全程没给内容，我今天倾向投Y。」",
  seer: "你是预言家，第一天要跳出来！报身份 → 报昨晚验了谁、结果是好人还是狼 → 说今晚打算验谁。验出好人（金水）就让大家保他，验出狼（查杀）就带大家投他。你一藏，好人整局没信息。",
  witch:
    "你是女巫，要藏：当自己是村民正常发言，别提救没救人、也别透露药的情况——一暴露今晚就会被刀。",
  hunter:
    "你是猎人，要藏：当村民正常发言。你的威慑全在死后能开枪，活着别亮身份。",
  werewolf:
    "你是狼，要装好人：别一言不发（太安静反而可疑），点评别人的发言、给一个看似合理的怀疑方向；千万别说出只有夜里才知道的事。",
};

export type SpeechCoachCardProps = {
  role: Role;
  day: number;
};

export function SpeechCoachCard({ role, day }: SpeechCoachCardProps) {
  const [open, setOpen] = useState(day === 1);
  const roleTip = ROLE_TIPS[role] ?? ROLE_TIPS.villager;

  return (
    <div className="speech-coach">
      <button
        type="button"
        className="speech-coach-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        💡 新手提示：这一轮说什么？
        <span className="speech-coach-caret">{open ? "收起" : "展开"}</span>
      </button>
      {open ? (
        <ul className="speech-coach-tips">
          <li>{OPENER}</li>
          <li>{roleTip}</li>
          <li>{TABOO}</li>
        </ul>
      ) : null}
    </div>
  );
}
