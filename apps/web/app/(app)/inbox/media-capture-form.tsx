"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { createFileCapture } from "./actions";

type Kind = "voice" | "image" | "pdf";

async function uploadFile(
  file: File,
  kind: Kind,
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  const uploadUrlRes = await fetch("/api/capture/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, filename: file.name, contentType: file.type, size: file.size }),
  });
  const uploadUrlBody = await uploadUrlRes.json();
  if (!uploadUrlRes.ok) {
    throw new Error(uploadUrlBody.detail || `Upload failed (${uploadUrlRes.status})`);
  }

  const { error } = await supabase.storage
    .from("captures")
    .uploadToSignedUrl(uploadUrlBody.path, uploadUrlBody.token, file, { contentType: file.type });
  if (error) throw new Error(error.message);

  await createFileCapture({ kind, storagePath: uploadUrlBody.path });
}

export function MediaCaptureForm() {
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [busy, setBusy] = useState<Kind | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const kind: Kind = file.type === "application/pdf" ? "pdf" : "image";
    setBusy(kind);
    setError(null);
    try {
      await uploadFile(file, kind, supabase);
      router.refresh();
    } catch (err) {
      console.error("media capture upload failed:", err);
      const message = friendlyError(err);
      setError(message);
      toast(message);
    } finally {
      setBusy(null);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        setBusy("voice");
        try {
          await uploadFile(file, "voice", supabase);
          router.refresh();
        } catch (err) {
          console.error("voice capture upload failed:", err);
          const message = friendlyError(err);
          setError(message);
          toast(message);
        } finally {
          setBusy(null);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Couldn't access your microphone - check your browser's permission settings.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy !== null}
        className="gap-1.5"
      >
        <Icon name="attach_file" size={16} />
        {busy === "image" || busy === "pdf" ? "Uploading..." : "Upload image/PDF"}
      </Button>
      <Button
        type="button"
        variant={recording ? "destructive" : "outline"}
        size="sm"
        onClick={recording ? stopRecording : startRecording}
        disabled={busy === "voice"}
        className="gap-1.5"
      >
        <Icon name={recording ? "stop" : "mic"} size={16} />
        {busy === "voice" ? "Uploading..." : recording ? "Stop recording" : "Record voice"}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
