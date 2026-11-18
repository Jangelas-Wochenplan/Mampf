import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Focus, ScanLine, X } from "lucide-react";
import { isProductBarcodeFormat, StableBarcodeReader } from "../../lib/barcode-scan";

interface BarcodeDetectorApi {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string; format?: string }>>;
}

interface BarcodeDetectorConstructor {
  new(): BarcodeDetectorApi;
}

interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: BarcodeDetectorConstructor;
}

interface FocusTrackCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
}

interface FocusTrackConstraintSet extends MediaTrackConstraintSet {
  focusMode?: string;
}

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const focusTrackRef = useRef<MediaStreamTrack | null>(null);
  const focusModesRef = useRef<string[]>([]);
  const [manualBarcode, setManualBarcode] = useState("");
  const [detectedBarcode, setDetectedBarcode] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [focusAvailable, setFocusAvailable] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (!Detector) {
      setMessage("Dieser Browser unterstützt kein automatisches Scannen. Gib den Barcode unten manuell ein.");
      return;
    }
    setCameraAvailable(true);
    const BrowserDetector = Detector;

    let active = true;
    let scanTimer = 0;
    let stream: MediaStream | null = null;
    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraAvailable(false);
          setMessage("Die Kamera ist in diesem Browser nicht verfügbar. Du kannst den Barcode manuell eingeben.");
          return;
        }
        const detector = new BrowserDetector();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const videoTrack = stream.getVideoTracks()[0];
        let focusMessage = "";
        if (videoTrack) {
          focusTrackRef.current = videoTrack;
          try {
            const focusModes = (videoTrack.getCapabilities() as FocusTrackCapabilities).focusMode ?? [];
            focusModesRef.current = focusModes;
            setFocusAvailable(focusModes.includes("continuous") || focusModes.includes("single-shot"));
            const focusMode = focusModes.includes("continuous")
              ? "continuous"
              : focusModes.includes("single-shot") ? "single-shot" : null;
            if (focusMode) {
              await videoTrack.applyConstraints({
                advanced: [{ focusMode } as FocusTrackConstraintSet],
              });
            }
          } catch {
            focusMessage = "Der Autofokus ließ sich nicht automatisch einstellen. Tippe auf „Fokussieren“ oder bewege den Code langsam näher.";
          }
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setCameraReady(true);
        setMessage(focusMessage || "Halte den Code ruhig und mittig im Rahmen. Nach mehreren gleichen Messungen kannst du den Wert prüfen.");
        const stableReader = new StableBarcodeReader(3);

        async function scanFrame() {
          if (!active || !video) return;
          try {
            if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
              const results = await detector.detect(video);
              const candidate = results.find((result) => {
                const formatAllowed = !result.format
                  || result.format === "unknown"
                  || isProductBarcodeFormat(result.format);
                return formatAllowed && result.rawValue.trim().length >= 4;
              });
              const barcode = stableReader.observe(candidate?.rawValue.trim() ?? null);
              if (barcode) {
                setManualBarcode(barcode);
                setDetectedBarcode(true);
                setMessage("Barcode stabil erkannt. Prüfe den Wert und übernimm ihn.");
                return;
              }
            }
          } catch {
            stableReader.reset();
            setMessage("Der Barcode konnte nicht gelesen werden. Richte die Kamera auf den Code oder gib ihn manuell ein.");
          }
          if (active) scanTimer = window.setTimeout(() => void scanFrame(), 250);
        }

        void scanFrame();
      } catch {
        if (active) {
          setCameraAvailable(false);
          stream?.getTracks().forEach((track) => track.stop());
          setMessage("Die Kamera konnte nicht gestartet werden. Prüfe die Kamerafreigabe oder gib den Barcode manuell ein.");
        }
      }
    }

    void startCamera();
    return () => {
      active = false;
      window.clearTimeout(scanTimer);
      focusTrackRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function submitManualBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const barcode = manualBarcode.trim();
    if (barcode) onDetectedRef.current(barcode);
  }

  async function focusCamera() {
    const track = focusTrackRef.current;
    if (!track) return;
    const modes = focusModesRef.current;
    const focusMode = modes.includes("single-shot")
      ? "single-shot"
      : modes.includes("continuous") ? "continuous" : null;
    if (!focusMode) {
      setMessage("Diese Kamera bietet keinen steuerbaren Fokus. Bewege den Code langsam näher oder weiter weg.");
      return;
    }
    try {
      await track.applyConstraints({ advanced: [{ focusMode } as FocusTrackConstraintSet] });
      setMessage("Fokus wird neu eingestellt. Halte den Code kurz ruhig.");
    } catch {
      setMessage("Der Fokus ließ sich nicht neu einstellen. Bewege den Code langsam näher oder weiter weg.");
    }
  }

  return (
    <div className="modal-backdrop pantry-scanner-backdrop" role="presentation" onClick={onClose}>
      <section
        className="pantry-scanner modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pantry-scanner-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pantry-modal-heading">
          <div className="pantry-scanner-title">
            <span className="pantry-scanner-icon"><ScanLine size={20} /></span>
            <div><p className="eyebrow">Produkt hinzufügen</p><h2 id="pantry-scanner-title">Barcode scannen</h2></div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Scanner schließen"><X size={20} /></button>
        </div>
        <div className={cameraReady ? "barcode-camera" : "barcode-camera barcode-camera-idle"}>
          {cameraAvailable && <video ref={videoRef} autoPlay muted playsInline aria-label="Kamerabild zum Scannen des Barcodes" />}
          {!cameraReady && <div><Camera size={28} /><span>{cameraAvailable ? "Kamera wird vorbereitet …" : "Automatisches Scannen nicht verfügbar"}</span></div>}
          {cameraReady && <span className={`barcode-scan-guide${detectedBarcode ? " barcode-scan-guide-detected" : ""}`} aria-hidden="true" />}
          {cameraReady && focusAvailable && (
            <button type="button" className="barcode-focus-button" onClick={() => void focusCamera()}>
              <Focus size={15} /> Fokussieren
            </button>
          )}
        </div>
        {message && <p className="pantry-scan-message" role="status">{message}</p>}
        <form className="pantry-barcode-form" onSubmit={submitManualBarcode}>
          <label className="field-label">
            Barcode manuell eingeben
            <input
              value={manualBarcode}
              onChange={(event) => {
                setManualBarcode(event.target.value);
                setDetectedBarcode(false);
              }}
              placeholder="z. B. 4001234567890"
              maxLength={64}
            />
          </label>
          <button className="button button-primary" disabled={!manualBarcode.trim()}><ScanLine size={17} /> {detectedBarcode ? "Erkannten Barcode prüfen & übernehmen" : "Barcode übernehmen"}</button>
        </form>
      </section>
    </div>
  );
}
