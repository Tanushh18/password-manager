import React from "react";
import Ambience from "../Ambience/Ambience";
import { ShieldLine } from "../Icons/Icons";

export default function Splash({ title = "Opening your vault…", body = "One moment while we check it's you." }) {
  return (
    <div className="page splash">
      <Ambience petals={false} />
      <div className="splash__inner anim-fade-up">
        <span className="splash__seal anim-beat">
          <ShieldLine size={28} strokeWidth={1.6} />
        </span>
        <p className="splash__title">{title}</p>
        <p className="splash__body">{body}</p>
      </div>
    </div>
  );
}
