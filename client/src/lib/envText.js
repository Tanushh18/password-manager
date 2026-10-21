/* Turns variables into one KEY=VALUE line each, the way parseEnvBlock reads them back. */
export function envToText(rows) {
  return (rows || [])
    .filter((r) => r && r.name)
    .map((r) => {
      const v = String(r.value ?? "");
      if (!/[\s#"'\\]/.test(v) && v !== "") return r.name + "=" + v;
      // The parser strips one pair of outer quotes and does not unescape, so pick the quote the value does not contain.
      const quote = v.includes("'") ? '"' : "'";
      return r.name + "=" + quote + v + quote;
    })
    .join("\n");
}
