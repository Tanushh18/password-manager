import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import Icon from "../components/Icon";
import { GradientButton, IconButton } from "../components/ui";
import { useTheme } from "../lib/theme";
import { emitScan } from "../lib/scanBus";

/** Scans an authenticator (otpauth://) QR code for the item editor. */
export default function Scan() {
  const { theme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState("Point the camera at the 2FA QR code");
  const done = useRef(false);

  const onScanned = ({ data }) => {
    if (done.current) return;
    if (!String(data).startsWith("otpauth://")) {
      setHint("That QR code isn't a 2FA setup code");
      return;
    }
    done.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    emitScan(String(data));
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {permission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScanned} />
      ) : null}
      <SafeAreaView style={styles.overlay}>
        <View style={styles.top}>
          <IconButton name="close" bg="rgba(0,0,0,0.5)" color="#fff" onPress={() => router.back()} />
        </View>
        {permission?.granted ? (
          <>
            <View style={[styles.frame, { borderColor: theme.accent3 }]} />
            <Text style={styles.hint}>{hint}</Text>
          </>
        ) : (
          <View style={styles.ask}>
            <Icon name="scan" size={48} color="#fff" />
            <Text style={styles.askText}>Aurelia needs the camera to read 2FA QR codes. Nothing is recorded or uploaded.</Text>
            <GradientButton title="Allow camera" icon="scan" onPress={requestPermission} />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center" },
  top: { alignSelf: "stretch", padding: 16 },
  frame: { width: 250, height: 250, borderWidth: 3, borderRadius: 28, marginTop: 60 },
  hint: { color: "#fff", marginTop: 24, fontSize: 15, textAlign: "center", paddingHorizontal: 30 },
  ask: { flex: 1, justifyContent: "center", alignItems: "center", gap: 18, paddingHorizontal: 30 },
  askText: { color: "#fff", textAlign: "center", fontSize: 15, lineHeight: 22 },
});
