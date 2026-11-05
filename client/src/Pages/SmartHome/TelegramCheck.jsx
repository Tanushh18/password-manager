import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Section } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { getTelegramDiagnose, repairTelegram } from "../../api/client";

/** Why Telegram updates may not be arriving: each thing that has to be true, with the fix, and a one-press "Fix it" that also sends a test message. */
export function TelegramCheckCard() {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    setBusy(true);
    try { setR(await getTelegramDiagnose()); } catch (e) { toast.error(errorMessage(e, "Could not check Telegram.")); } finally { setBusy(false); }
  }, []);
  useEffect(() => { check(); }, [check]);
  const fix = async () => {
    setBusy(true);
    try {
      const out = await repairTelegram();
      setR(out);
      if (out.sent) toast.success("Telegram par test message bhej diya. Check karo."); else toast.error("Test message nahi gaya: neeche dekho kya rukta hai.");
    } catch (e) { toast.error(errorMessage(e, "Could not fix Telegram.")); } finally { setBusy(false); }
  };
  if (!r) return null;
  return (
    <Section title="Telegram check" subtitle="Updates tabhi aate hain jab ye sab theek ho. Jo ✗ hai wahi rukawat hai; “Fix it” sab kuch on karke ek test message bhejta hai.">
      <ul className="sh-lan">
        {r.checks.map((c) => (
          <li key={c.id}>
            <div className="sh-lan__main"><b>{c.ok ? "✅" : "❌"} {c.text}</b>{!c.ok && c.fix ? <span>{c.fix}</span> : null}</div>
          </li>
        ))}
      </ul>
      <div className="sh-row">
        <button type="button" className="rd-btn rd-btn--primary" onClick={fix} disabled={busy}>Fix it and send a test</button>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={check} disabled={busy}>Check again</button>
      </div>
      <p className="sh-dim">{r.ready ? "Sab theek hai: Stashr ka har update Telegram par aayega." : "Koi cheez theek nahi hai, isliye update nahi aa rahe."}</p>
    </Section>
  );
}
