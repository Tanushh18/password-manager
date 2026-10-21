# Face model

`facenet.tflite` — FaceNet-style face embedding: input 160×160×3 float32, output 128 floats.

- Obtained from `shubham0204/FaceRecognition_With_FaceNet_Android` (Apache-2.0 code), `app/src/main/assets/facenet.tflite`, 23,705,216 bytes.
- The repository says the weights come from `nyoki-mtl/keras-facenet` and does not state a licence for the weights themselves.
  Face-recognition weights are often trained on datasets with research-only terms.

**Review the licence of these weights before releasing the app publicly.** To swap the model, replace this file with another
160×160 → 128 TFLite embedder (or edit `FACE` and `DIM` in `src/lib/faceScan.js` / `faceCluster.js` for a different size).
