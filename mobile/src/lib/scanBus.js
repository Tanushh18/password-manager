// Hands a scanned QR payload from the camera screen back to whoever opened it.
let listener = null;
export const onScan = (fn) => {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
};
export const emitScan = (data) => listener?.(data);
