import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { api } from "../lib/api";
import { useTheme, alpha } from "../lib/theme";

/** Live server status from /health (the same endpoint the uptime cron pings). */
export default function StatusPill({ interval = 30000, compact, style }) {
  const { theme } = useTheme();
  const [state, setState] = useState("checking");
  const [latency, setLatency] = useState(null);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const probe = useCallback(async () => {
    const t0 = Date.now();
    try {
      await api.health();
      const took = Date.now() - t0;
      setLatency(took);
      setState(took > 2500 ? "waking" : "online");
    } catch (e) {
      setState(e?.status ? "online" : "offline");
      setLatency(null);
    }
  }, []);

  useEffect(() => {
    probe();
    const id = setInterval(probe, interval);
    return () => clearInterval(id);
  }, [probe, interval]);

  const color = { checking: theme.textFaint, online: theme.ok, waking: theme.warn, offline: theme.danger }[state];
  const label = {
    checking: "Checking server…",
    online: "Server online",
    waking: "Server waking up…",
    offline: "Server unreachable",
  }[state];

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 3] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        alignSelf: "flex-start",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: alpha(color.startsWith("#") ? color : "#888888", 0.35),
        backgroundColor: alpha(color.startsWith("#") ? color : "#888888", 0.1),
        ...style,
      }}
    >
      <View style={{ width: 8, height: 8 }}>
        <Animated.View style={{ position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: color, transform: [{ scale }], opacity }} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      </View>
      <Text style={{ color, fontSize: 12, fontFamily: theme.font.bodySemi }}>{label}</Text>
      {!compact && latency != null && state === "online" ? (
        <Text style={{ color: theme.textFaint, fontSize: 11, fontFamily: theme.font.body }}>{latency}ms</Text>
      ) : null}
    </View>
  );
}
