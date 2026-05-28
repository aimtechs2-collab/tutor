"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";
import { SettingsPageHeader, SettingSection, SettingRow } from "@/components/settings/shared";

interface VoiceConfig {
  enabled: boolean;
  models: { id: string; display_name: string; affective_dialog: boolean }[];
  voices: string[];
}

export default function VoiceSettingsPage() {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiFetch(apiUrl("/api/v1/gemini-live/config"));
      const d = await res.json();
      setConfig(d);
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch(apiUrl("/api/v1/gemini-live/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash-live-001", voice: "Aoede" }),
      });
      setTestResult(res.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <SettingsPageHeader
        title="Voice"
        description="Configure Gemini Live real-time voice tutoring."
      />

      <SettingSection
        title="Connection"
        description="Live voice uses Google's Gemini Live API. Set GEMINI_API_KEY in your server environment."
      >
        {/* Status */}
        <SettingRow
          label="Status"
          description={
            config === null
              ? "Loading…"
              : config.enabled
              ? "Gemini Live is configured and ready."
              : "GEMINI_API_KEY is not set. Add it to your server environment and restart."
          }
        >
          {config === null ? (
            <Loader2 size={16} className="animate-spin opacity-40" />
          ) : config.enabled ? (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#22c55e" }}>
              <CheckCircle size={14} />
              Enabled
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#ef4444" }}>
              <XCircle size={14} />
              Not configured
            </div>
          )}
        </SettingRow>

        {/* Test connection */}
        {config?.enabled && (
          <SettingRow
            label="Test connection"
            description="Request a token to verify the API key is working."
          >
            <div className="flex items-center gap-3">
              {testResult === "ok" && (
                <span className="text-xs" style={{ color: "#22c55e" }}>✓ API key works</span>
              )}
              {testResult === "fail" && (
                <span className="text-xs" style={{ color: "#ef4444" }}>✗ Token request failed</span>
              )}
              <button
                onClick={handleTest}
                disabled={testing}
                className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                {testing ? "Testing…" : "Test"}
              </button>
            </div>
          </SettingRow>
        )}
      </SettingSection>

      {config?.enabled && (
        <SettingSection
          title="Available models"
          description="Models available for voice sessions."
        >
          {config.models.map((m) => (
            <SettingRow
              key={m.id}
              label={m.display_name}
              description={`${m.id}${m.affective_dialog ? " · Supports affective dialog" : ""}`}
            >
              <span
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}
              >
                Available
              </span>
            </SettingRow>
          ))}
        </SettingSection>
      )}

      {config?.enabled && (
        <SettingSection title="Available voices" description="Voice options for speech output.">
          <div className="flex flex-wrap gap-2 py-1">
            {config.voices.map((v) => (
              <span
                key={v}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: "var(--muted)", color: "var(--foreground)" }}
              >
                {v}
              </span>
            ))}
          </div>
        </SettingSection>
      )}

      <SettingSection title="How to enable" description="">
        <div className="space-y-2 py-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          <p>1. Get a Gemini API key at <strong>aistudio.google.com</strong></p>
          <p>2. Set <code className="rounded px-1" style={{ background: "var(--muted)" }}>GEMINI_API_KEY=your_key</code> in your server environment</p>
          <p>3. Restart the backend</p>
          <p>4. A 🎤 mic button will appear in the chat composer</p>
        </div>
      </SettingSection>
    </div>
  );
}
