import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as ort from "onnxruntime-web";
import { useLocation } from "react-router-dom";
import { openDB, getModelFromDB, saveModelToDB } from "./indexedDB"; // Adjust path as needed

const MODEL_URL = "/model/facenet_simplified.onnx"; // Path to your ONNX model
const DB_NAME = "ModelCacheDB";
const STORE_NAME = "models";
const MODEL_KEY = "facenet_model";

// const MODEL_URL = "/model/facenet_simplified.onnx"; // Path to your ONNX model

const BackgroundMonitor = () => {
  const [model, setModel] = useState(null);
  const [encoding, setEncoding] = useState(null);
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [faceActive, setFaceActive] = useState(true);
  const webcamRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    const loadModel = async () => {
      try {
        // Open or create the IndexedDB database
        const db = await openDB(DB_NAME, STORE_NAME);

        // Attempt to load the model from IndexedDB
        let session = await getModelFromDB(db, STORE_NAME, MODEL_KEY);

        if (session) {
          // If the model is found in IndexedDB, create a session from the binary data
          session = await ort.InferenceSession.create(session);
          console.log("Loaded model from IndexedDB.");
        } else {
          // If not found, fetch the model from the server
          const modelBytes = await (await fetch(MODEL_URL)).arrayBuffer();
          session = await ort.InferenceSession.create(modelBytes);

          // Save the fetched model to IndexedDB for future use
          await saveModelToDB(db, STORE_NAME, MODEL_KEY, modelBytes);
          console.log("Downloaded model and saved to IndexedDB.");
        }

        // Set the model in the state
        setModel(session);
      } catch (error) {
        console.error("Error loading model:", error);
      }
    };

    loadModel();
  }, []);

  useEffect(() => {
    if (location.state && location.state.userData) {
      const storedEncoding = JSON.parse(location.state.userData.encoding);
      setEncoding(new Float32Array(storedEncoding));
    }
  }, [location]);

  useEffect(() => {
    if (!model || !encoding || !webcamRef.current) return;

    const detectFace = async () => {
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) return;

      const img = new Image();
      img.onload = async () => {
        try {
          const inputTensor = preprocessImage(img);
          const results = await model.run({ input: inputTensor });
          const prediction = results.output.data;
          const similarity = compareEmbeddings(prediction, encoding);

          if (similarity > 0.6) {
            setIsFaceDetected(true);
            setFaceActive(true);
          } else {
            setFaceActive(false);
          }
        } catch (error) {
          console.error("Error during face detection:", error);
        }
      };
      img.src = imageSrc;
    };

    const intervalId = setInterval(detectFace, 1000); // Check every 2 seconds
    return () => clearInterval(intervalId);
  }, [model, encoding]);

  const preprocessImage = (image) => {
    const cropCanvas = document.createElement("canvas");
    const cropCtx = cropCanvas.getContext("2d");
    const resizeCanvas = document.createElement("canvas");
    const resizeCtx = resizeCanvas.getContext("2d");
    const outputSize = 160;
    resizeCanvas.width = outputSize;
    resizeCanvas.height = outputSize;
    const cropSize = Math.min(image.width, image.height);
    const cropX = (image.width - cropSize) / 2;
    const cropY = 0;
    cropCanvas.width = cropSize;
    cropCanvas.height = cropSize;
    cropCtx.drawImage(
      image,
      cropX,
      cropY,
      cropSize,
      cropSize,
      0,
      0,
      cropSize,
      cropSize
    );
    resizeCtx.drawImage(
      cropCanvas,
      0,
      0,
      cropSize,
      cropSize,
      0,
      0,
      outputSize,
      outputSize
    );
    const imgData = resizeCtx.getImageData(0, 0, outputSize, outputSize);
    const data = new Float32Array(outputSize * outputSize * 3);
    for (let i = 0; i < outputSize * outputSize; i++) {
      data[i] = imgData.data[i * 4] / 255.0; // R channel
      data[i + outputSize * outputSize] = imgData.data[i * 4 + 1] / 255.0; // G channel
      data[i + outputSize * outputSize * 2] = imgData.data[i * 4 + 2] / 255.0; // B channel
    }
    return new ort.Tensor("float32", data, [1, 3, outputSize, outputSize]);
  };

  const compareEmbeddings = (embedding1, embedding2) => {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      normA += embedding1[i] ** 2;
      normB += embedding2[i] ** 2;
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    const similarity = dotProduct / (normA * normB);
    return similarity;
  };

  const handleMonitoringFailure = () => {
    console.log("Background monitoring failed.");

    // Notify the user
    alert(
      "Background monitoring failed. Please make sure you are in front of the camera and try again."
    );

    // Optionally redirect to a different page or retry the authentication
    window.location.href = "/face-authentication"; // Redirect to the face authentication page
    // OR
    // setAuthenticationMessage("Background monitoring failed. Please try again."); // Show a message in the UI

    // Optionally log the failure (e.g., to an analytics service or server)
    // axios.post('/api/log', { error: "Background monitoring failed" });
  };

  return (
    <div>
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: -1,
          opacity: 0, // Make it invisible
          pointerEvents: "none", // Prevent it from blocking interactions
        }}
      />

      {!isFaceDetected && (
        <p
          style={{
            color: "red",
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999,
            background: "rgba(255, 255, 255, 0.8)",
            padding: "10px",
            borderRadius: "8px",
            transition: "opacity 0.5s ease-in-out",
            opacity: faceActive ? 0 : 1,
          }}
        >
          Face not detected
        </p>
      )}
      {isFaceDetected && !faceActive && (
        <p
          style={{
            color: "red",
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999,
            background: "rgba(255, 255, 255, 0.8)",
            padding: "10px",
            borderRadius: "8px",
            transition: "opacity 0.5s ease-in-out",
            opacity: faceActive ? 0 : 1,
          }}
        >
          Face not active
        </p>
      )}
    </div>
  );
};

export default BackgroundMonitor;
