import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";

function MultiModalApp() {
  const modalUrl = import.meta.env.VITE_MODAL_URL;

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [imageB64, setImageB64] = useState("");
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [imageDescription, setImageDescription] = useState<string>("");
  const [descriptionAudio, setDescriptionAudio] = useState<string>("");

  const handleRequestMicPermissions = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((d) => d.kind === "audioinput");
      setAudioDevices(microphones);
      if (microphones.length > 0) {
        setSelectedDeviceId(microphones[0].deviceId);
      }
    } catch (err: unknown) {
      console.error("Error requesting mic permission:", err);
    }
  };

  const handleStartRecording = async () => {
    try {
      if (!selectedDeviceId) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedDeviceId } },
      });
      const mimeType = "audio/webm; codecs=opus";
      const newRecorder = new MediaRecorder(stream, { mimeType });
      setRecordedBlob(null);
      let chunks: Blob[] = [];
      newRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      newRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        setRecordedBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };
      newRecorder.start(1000);
      setRecorder(newRecorder);
      setIsRecording(true);
    } catch (err: unknown) {
      console.error("Error starting recording:", err);
    }
  };

  const handleStopRecording = () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      setIsRecording(false);
    }
  };

  const handleProcessFlow = async () => {
    if (!recordedBlob) return;
    setIsProcessing(true);
    setProgress(0);
    try {
      // Step 1: Transcribe
      setCurrentStep("transcribing");
      setProgress(20);
      const formData = new FormData();
      formData.append("file", recordedBlob, "recording.webm");
      const transcriptResponse = await fetch(`${modalUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });
      const transcriptData = await transcriptResponse.json();
      setTranscript(transcriptData.transcript);
      setProgress(40);

      // Step 2: Generate image
      setCurrentStep("generating");
      const imageResponse = await fetch(`${modalUrl}/generate_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: transcriptData.transcript }),
      });
      const imageData = await imageResponse.json();
      setImageB64(imageData.image_b64);
      setProgress(60);

      // Step 3: Analyze
      setCurrentStep("analyzing");
      const analysisResponse = await fetch(`${modalUrl}/analyze_image_similarity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: transcriptData.transcript,
          image_b64: imageData.image_b64,
        }),
      });
      const analysisData = await analysisResponse.json();
      setSimilarityScore(analysisData.similarity_score);
      setImageDescription(analysisData.image_description);
      setProgress(80);

      // Step 4: TTS
      setCurrentStep("speaking");
      const ttsResponse = await fetch(`${modalUrl}/text_to_speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: analysisData.image_description }),
      });
      const ttsData = await ttsResponse.json();
      setDescriptionAudio(ttsData.audio);
      setProgress(100);

    } catch (error: unknown) {
      console.error("Processing error:", error);
    } finally {
      setIsProcessing(false);
      setCurrentStep(null);
    }
  };

  const getStepDescription = () => {
    switch (currentStep) {
      case "transcribing": return "Transcription de l'audio...";
      case "generating": return "Génération de l'image...";
      case "analyzing": return "Analyse de l'image...";
      case "speaking": return "Création de la description audio...";
      default: return "";
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card className="mb-8">
        <CardContent className="pt-6">
          <h1 className="text-2xl font-bold mb-6">Multi-Modal AI Demo</h1>

          {/* Microphone Setup */}
          <div className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">Microphone</h2>
            <Button variant="outline" onClick={handleRequestMicPermissions}>
              Demander les permissions
            </Button>
            <select
              className="w-full rounded-md border border-gray-300 p-2"
              value={selectedDeviceId ?? ""}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
            >
              <option value="">Sélectionner un microphone...</option>
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>

          {/* Recording */}
          <div className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">Enregistrement</h2>
            <div className="flex gap-2 flex-wrap">
              {!isRecording ? (
                <Button onClick={handleStartRecording} disabled={!selectedDeviceId || isProcessing}>
                  Démarrer
                </Button>
              ) : (
                <Button variant="destructive" onClick={handleStopRecording}>
                  Arrêter
                </Button>
              )}
              {recordedBlob && (
                <>
                  <audio controls src={URL.createObjectURL(recordedBlob)} className="w-full mt-2" />
                  <Button onClick={handleProcessFlow} disabled={isRecording || isProcessing}>
                    Traiter
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2 mb-8">
              <div className="flex justify-between text-sm">
                <span>{getStepDescription()}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          {/* Results */}
          {transcript && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Résultats</h2>
              <div>
                <h3 className="font-semibold">Transcript :</h3>
                <p className="bg-gray-50 p-4 rounded-lg">{transcript}</p>
              </div>
              {imageB64 && (
                <div>
                  <h3 className="font-semibold">Image générée :</h3>
                  <img
                    src={`data:image/png;base64,${imageB64}`}
                    alt="Generated"
                    className="w-full max-w-2xl rounded-lg shadow-lg"
                  />
                  {similarityScore !== null && (
                    <p className="text-sm text-gray-600 mt-1">
                      Similarité : {similarityScore.toFixed(1)}%
                    </p>
                  )}
                </div>
              )}
              {imageDescription && (
                <div>
                  <h3 className="font-semibold">Description IA :</h3>
                  <p className="bg-gray-50 p-4 rounded-lg">{imageDescription}</p>
                  {descriptionAudio && (
                    <audio controls src={`data:audio/mp3;base64,${descriptionAudio}`} className="w-full mt-2" />
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default MultiModalApp;