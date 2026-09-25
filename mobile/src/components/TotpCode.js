import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import C from "../lib/crypto";
import { useTheme, alpha } from "../lib/theme";
import { useToast } from "./Toast";
import { tap } from "./ui";
import Icon from "./Icon";

const R = 9;
const LEN = 2 * Math.PI * R;

/** Live 2FA code with a countdown ring. Tap to copy. */
export default function TotpCode({ secret, big }) {
  const { theme } = useTheme();
  const toast = useToast();
  const [state, setState] = useState(null);

  useEffect(() => {
    const cfg = C.parseTotp(secret);
    if (!cfg) {
      setState({ invalid: true });
      return undefined;
    }
    let alive = true;
    const tick = async () => {
      const r = await C.totpCode(cfg);
      if (alive) setState(r);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [secret]);

  if (!state) return null;
  if (state.invalid) return <Text style={{ color: theme.danger, fontFamily: theme.font.bodyMedium, fontSize: 12 }}>Invalid 2FA secret</Text>;

  const urgent = state.remaining <= 5;
  const color = urgent ? theme.danger : theme.accent3;
  const pretty = state.code.length === 6 ? `${state.code.slice(0, 3)} ${state.code.slice(3)}` : state.code;

  return (
    <Pressable
      onPress={async () => {
        tap();
        await Clipboard.setStringAsync(state.code);
        toast("2FA code copied", "info");
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        alignSelf: "flex-start",
        paddingHorizontal: 12,
        paddingVertical: big ? 10 : 7,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: alpha(color, 0.4),
        backgroundColor: alpha(color, 0.1),
      }}
    >
      <Svg width={22} height={22} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={11} cy={11} r={R} stroke={alpha(color, 0.25)} strokeWidth={3} fill="none" />
        <Circle cx={11} cy={11} r={R} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${LEN} ${LEN}`} strokeDashoffset={LEN - (LEN * state.remaining) / state.period} />
      </Svg>
      <Text style={{ color: urgent ? theme.danger : theme.heading, fontFamily: theme.font.mono, fontSize: big ? 24 : 18, letterSpacing: 2, fontWeight: "700" }}>{pretty}</Text>
      <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 11 }}>{state.remaining}s</Text>
      <Icon name="copy" size={14} color={theme.textFaint} />
    </Pressable>
  );
}
