import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ElementPresence {
  element: string
  present: boolean
  details: string
}

interface ObjectiveEval {
  required_elements: ElementPresence[]
  composition_issues: string[]
  technical_issues: string[]
  style_match: boolean
  overall_score: number
  evaluation_notes: string
}

interface EvaluationResult {
  prompt: string
  image_b64: string
  similarity_score: number
  objective_evaluation: ObjectiveEval
  feedback: string
}

interface BatchMetrics {
  avg_similarity_score: number
  avg_objective_score: number
  technical_issues_frequency: Record<string, number>
}

interface EvaluationResponse {
  batch_id: string
  description: string | null
  timestamp: string
  prompts: string[]
  metrics: BatchMetrics
  results: EvaluationResult[]
}

interface BatchSummary {
  batch_id: string
  description: string | null
  timestamp: string
  image_count: number
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const modalUrl = import.meta.env.VITE_MODAL_URL

  // Pipeline states
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [transcript, setTranscript] = useState("")
  const [imageB64, setImageB64] = useState("")
  const [similarityScore, setSimilarityScore] = useState<number | null>(null)
  const [imageDescription, setImageDescription] = useState("")
  const [descriptionAudio, setDescriptionAudio] = useState("")

  // Evaluation states
  const [activeTab, setActiveTab] = useState<"pipeline" | "evaluation">("pipeline")
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [selectedBatch, setSelectedBatch] = useState<EvaluationResponse | null>(null)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [evalDescription, setEvalDescription] = useState("")
  const [evalTab, setEvalTab] = useState<"overview" | "prompts" | "metrics" | "gallery">("overview")

  // Load batches on mount
  useEffect(() => {
    fetchBatches()
  }, [])

  const fetchBatches = async () => {
    try {
      const res = await fetch(`${modalUrl}/evaluation_batches`)
      const data = await res.json()
      setBatches(data)
    } catch (e) {
      console.error(e)
    }
  }

  const fetchBatchDetails = async (batchId: string) => {
    try {
      const res = await fetch(`${modalUrl}/evaluation/${batchId}`)
      const data = await res.json()
      setSelectedBatch(data)
    } catch (e) {
      console.error(e)
    }
  }

  const handleRequestMicPermissions = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const devices = await navigator.mediaDevices.enumerateDevices()
      const microphones = devices.filter((d) => d.kind === "audioinput")
      setAudioDevices(microphones)
      if (microphones.length > 0) setSelectedDeviceId(microphones[0].deviceId)
    } catch (err) {
      console.error("Error requesting mic permission:", err)
    }
  }

  const handleStartRecording = async () => {
    try {
      if (!selectedDeviceId) return
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedDeviceId } },
      })
      const mimeType = "audio/webm; codecs=opus"
      const newRecorder = new MediaRecorder(stream, { mimeType })
      setRecordedBlob(null)
      let chunks: Blob[] = []
      newRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      newRecorder.onstop = () => {
        setRecordedBlob(new Blob(chunks, { type: mimeType }))
        stream.getTracks().forEach((t) => t.stop())
      }
      newRecorder.start(1000)
      setRecorder(newRecorder)
      setIsRecording(true)
    } catch (err) {
      console.error("Error starting recording:", err)
    }
  }

  const handleStopRecording = () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
      setIsRecording(false)
    }
  }

  const handleProcessFlow = async () => {
    if (!recordedBlob) return
    setIsProcessing(true)
    setProgress(0)
    try {
      setCurrentStep("transcribing")
      setProgress(20)
      const formData = new FormData()
      formData.append("file", recordedBlob, "recording.webm")
      const transcriptRes = await fetch(`${modalUrl}/transcribe`, { method: "POST", body: formData })
      const transcriptData = await transcriptRes.json()
      setTranscript(transcriptData.transcript)
      setProgress(40)

      setCurrentStep("generating")
      const imageRes = await fetch(`${modalUrl}/generate_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: transcriptData.transcript }),
      })
      const imageData = await imageRes.json()
      setImageB64(imageData.image_b64)
      setProgress(60)

      setCurrentStep("analyzing")
      const analysisRes = await fetch(`${modalUrl}/analyze_image_similarity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: transcriptData.transcript, image_b64: imageData.image_b64 }),
      })
      const analysisData = await analysisRes.json()
      setSimilarityScore(analysisData.similarity_score)
      setImageDescription(analysisData.image_description)
      setProgress(80)

      setCurrentStep("speaking")
      const ttsRes = await fetch(`${modalUrl}/text_to_speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: analysisData.image_description }),
      })
      const ttsData = await ttsRes.json()
      setDescriptionAudio(ttsData.audio)
      setProgress(100)
    } catch (error) {
      console.error("Processing error:", error)
    } finally {
      setIsProcessing(false)
      setCurrentStep(null)
    }
  }

  const handleRunEvaluation = async () => {
    setIsEvaluating(true)
    try {
      const res = await fetch(`${modalUrl}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: evalDescription || "Evaluation batch", num_iterations: 1 }),
      })
      const data = await res.json()
      setSelectedBatch(data)
      await fetchBatches()
    } catch (e) {
      console.error(e)
    } finally {
      setIsEvaluating(false)
    }
  }

  const getStepDescription = () => {
    switch (currentStep) {
      case "transcribing": return "Transcription de l'audio..."
      case "generating": return "Génération de l'image..."
      case "analyzing": return "Analyse de l'image..."
      case "speaking": return "Création de la description audio..."
      default: return ""
    }
  }

  return (
    <div className="container mx-auto p-4 max-w-5xl">
      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("pipeline")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "pipeline" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
        >
          🎤 Pipeline
        </button>
        <button
          onClick={() => setActiveTab("evaluation")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "evaluation" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
        >
          📊 Evaluation
        </button>
      </div>

      {/* ── Pipeline Tab ── */}
      {activeTab === "pipeline" && (
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold mb-6">Multi-Modal AI Demo</h1>

            {/* Microphone */}
            <div className="space-y-3 mb-6">
              <h2 className="text-lg font-semibold">Microphone</h2>
              <Button variant="outline" onClick={handleRequestMicPermissions}>
                Demander les permissions
              </Button>
              <select
                className="w-full rounded-md border border-gray-300 p-2 text-sm"
                value={selectedDeviceId ?? ""}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
              >
                <option value="">Sélectionner un microphone...</option>
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Recording */}
            <div className="space-y-3 mb-6">
              <h2 className="text-lg font-semibold">Enregistrement</h2>
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
              <div className="space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span>{getStepDescription()}</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            {/* Results */}
            {transcript && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Résultats</h2>
                <div>
                  <h3 className="font-medium text-sm text-gray-600">Transcript</h3>
                  <p className="bg-gray-50 p-3 rounded-lg text-sm">{transcript}</p>
                </div>
                {imageB64 && (
                  <div>
                    <h3 className="font-medium text-sm text-gray-600">Image générée</h3>
                    <img src={`data:image/png;base64,${imageB64}`} alt="Generated" className="w-full max-w-2xl rounded-lg shadow" />
                    {similarityScore !== null && (
                      <p className="text-sm text-gray-500 mt-1">Similarité : {similarityScore.toFixed(1)}%</p>
                    )}
                  </div>
                )}
                {imageDescription && (
                  <div>
                    <h3 className="font-medium text-sm text-gray-600">Description IA</h3>
                    <p className="bg-gray-50 p-3 rounded-lg text-sm">{imageDescription}</p>
                    {descriptionAudio && (
                      <audio controls src={`data:audio/mp3;base64,${descriptionAudio}`} className="w-full mt-2" />
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Evaluation Tab ── */}
      {activeTab === "evaluation" && (
        <div className="space-y-4">
          {/* Run evaluation */}
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">Lancer une évaluation</h2>
              <div className="flex gap-2">
                <input
                  value={evalDescription}
                  onChange={(e) => setEvalDescription(e.target.value)}
                  placeholder="Description du batch (optionnel)"
                  className="flex-1 border rounded-md px-3 py-2 text-sm"
                />
                <Button onClick={handleRunEvaluation} disabled={isEvaluating}>
                  {isEvaluating ? "En cours..." : "Lancer"}
                </Button>
              </div>
              {isEvaluating && (
                <p className="text-sm text-gray-500 mt-2">
                  ⏳ Génération et évaluation en cours (~5-10 min)...
                </p>
              )}
            </CardContent>
          </Card>

          {/* Select batch */}
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">Sélectionner un batch</h2>
              <select
                className="w-full border rounded-md p-2 text-sm"
                onChange={(e) => fetchBatchDetails(e.target.value)}
                defaultValue=""
              >
                <option value="">Choisir un batch...</option>
                {batches.map((b) => (
                  <option key={b.batch_id} value={b.batch_id}>
                    {b.description || "Sans titre"} — {new Date(b.timestamp).toLocaleDateString()} ({b.image_count} images)
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* Batch details */}
          {selectedBatch && (
            <Card>
              <CardContent className="pt-6">
                {/* Sub-tabs */}
                <div className="flex gap-2 mb-6">
                  {(["overview", "prompts", "metrics", "gallery"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setEvalTab(tab)}
                      className={`px-3 py-1.5 rounded text-sm font-medium capitalize ${evalTab === tab ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Overview */}
                {evalTab === "overview" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-500">Avg Similarity Score</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {selectedBatch.metrics.avg_similarity_score.toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-500">Avg Objective Score</p>
                      <p className="text-3xl font-bold text-green-600">
                        {selectedBatch.metrics.avg_objective_score.toFixed(1)}/10
                      </p>
                    </div>
                    <div className="col-span-2 bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">Batch ID</p>
                      <p className="text-xs font-mono">{selectedBatch.batch_id}</p>
                    </div>
                    <div className="col-span-2 bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">Total images</p>
                      <p className="text-xl font-bold">{selectedBatch.results.length}</p>
                    </div>
                  </div>
                )}

                {/* Prompts */}
                {evalTab === "prompts" && (
                  <div className="space-y-2">
                    {selectedBatch.prompts.map((p, i) => (
                      <div key={i} className="bg-gray-50 p-3 rounded-lg text-sm">{p}</div>
                    ))}
                  </div>
                )}

                {/* Metrics */}
                {evalTab === "metrics" && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">Technical Issues Frequency</h3>
                    {Object.keys(selectedBatch.metrics.technical_issues_frequency).length === 0 ? (
                      <p className="text-sm text-gray-500">No technical issues detected 🎉</p>
                    ) : (
                      Object.entries(selectedBatch.metrics.technical_issues_frequency)
                        .sort(([, a], [, b]) => b - a)
                        .map(([issue, count]) => (
                          <div key={issue} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="truncate max-w-xs">{issue}</span>
                              <span className="font-medium">{count}x</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-red-500 h-2 rounded-full"
                                style={{ width: `${Math.min(count * 20, 100)}%` }}
                              />
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                )}

                {/* Gallery */}
                {evalTab === "gallery" && (
                  <div className="grid grid-cols-2 gap-4">
                    {selectedBatch.results.map((result, i) => (
                      <div key={i} className="border rounded-lg overflow-hidden">
                        <img
                          src={`data:image/png;base64,${result.image_b64}`}
                          alt={result.prompt}
                          className="w-full h-48 object-cover"
                        />
                        <div className="p-3">
                          <p className="text-xs text-gray-500 truncate">{result.prompt}</p>
                          <div className="flex justify-between mt-1">
                            <span className="text-xs">
                              Similarity: <strong>{result.similarity_score.toFixed(1)}%</strong>
                            </span>
                            <span className="text-xs">
                              Score: <strong>{result.objective_evaluation.overall_score}/10</strong>
                            </span>
                          </div>
                          {result.objective_evaluation.technical_issues.length > 0 && (
                            <div className="mt-2">
                              {result.objective_evaluation.technical_issues.map((issue, j) => (
                                <span key={j} className="inline-block bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded mr-1 mb-1">
                                  {issue}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

export default App