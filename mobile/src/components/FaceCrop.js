import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { mediaSource } from "../lib/api";
import { useTheme } from "../lib/theme";

/** Shows just one face: the stored preview of the photo, zoomed and shifted to the face's box. */
export default function FaceCrop({ face, size = 64, round = true }) {
  const { theme } = useTheme();
  const box = face?.box;
  const frame = { width: size, height: size, overflow: "hidden", backgroundColor: theme.surfaceRaised, borderRadius: round ? size / 2 : 8 };
  if (!box) return <View style={frame} />;
  const k = size / box.side;
  return (
    <View style={frame}>
      <Image source={mediaSource(face.mediaId)} contentFit="fill" cachePolicy="memory-disk" style={{ position: "absolute", width: box.imgW * k, height: box.imgH * k, left: -box.x * k, top: -box.y * k }} />
    </View>
  );
}
