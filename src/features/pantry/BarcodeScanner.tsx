import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, ScanLine, X } from "lucide-react";

interface BarcodeDetectorApi {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: new () => BarcodeDetectorApi;
}

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [manualBarcode, setManualBarcode] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);
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
    let animationFrame = 0;
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
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setCameraReady(true);

        async function scanFrame() {
          if (!active || !video) return;
          try {
            if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
              const results = await detector.detect(video);
              const barcode = results.find((result) => result.rawValue.trim())?.rawValue.trim();
              if (barcode) {
                onDetectedRef.current(barcode);
                return;
              }
            }
          } catch {
            setMessage("Der Barcode konnte nicht gelesen werden. Richte die Kamera auf den Code oder gib ihn manuell ein.");
          }
          if (active) animationFrame = window.requestAnimationFrame(() => void scanFrame());
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
      window.cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function submitManualBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const barcode = manualBarcode.trim();
    if (barcode) onDetectedRef.current(barcode);
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
          {cameraReady && <span className="barcode-scan-guide" aria-hidden="true" />}
        </div>
        {message && <p className="pantry-scan-message" role="status">{message}</p>}
        <form className="pantry-barcode-form" onSubmit={submitManualBarcode}>
          <label className="field-label">
            Barcode manuell eingeben
            <input
              autoFocus
              value={manualBarcode}
              onChange={(event) => setManualBarcode(event.target.value)}
              placeholder="z. B. 4001234567890"
              maxLength={64}
            />
          </label>
          <button className="button button-primary" disabled={!manualBarcode.trim()}><ScanLine size={17} /> Barcode übernehmen</button>
        </form>
      </section>
    </div>
  );
}
