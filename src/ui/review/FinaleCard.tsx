import type { FinaleArchive } from "../../shared";
import { Avatar } from "../Avatar";
import { Nm } from "./parts";

/** 终局卡（#finale · .rcard.fin）：一句话终局 + 存活者名单。 */
export function FinaleCard({ finale }: { finale: FinaleArchive }) {
  return (
    <section className="rwrap" id="finale">
      <div className="rcard fin">
        <div className="rhead">🏆 终局</div>
        <div className="rbody">
          <div className="fin-line">{finale.line}</div>
          <div className="fin-sub">{finale.narrText}</div>
          <div className="fin-alive">
            <span className="sec-t">存活</span>
            {finale.alive.map((p) => (
              <span className="mp" key={p.playerId}>
                <Avatar seat={p.seat} className="pav pav-20" />
                <Nm p={p} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
