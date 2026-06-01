"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MonitorPlay, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { apiFetch, apiUrl } from "@/lib/api";
import {
  inputClass,
  SettingRow,
  SettingSection,
  SettingsPageHeader,
} from "@/components/settings/shared";

interface ScreenPipeSettings {
  enabled: boolean;
  url: string;
  api_key_set: boolean;
  window_minutes: number;
  include_audio: boolean;
  exclude: string[];
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; status: string }
  | { kind: "fail"; status: string };

const ENDPOINT = "/api/v1/gemini-live/screenpipe/settings";
const TEST_ENDPOINT = "/api/v1/gemini-live/screenpipe/test";
const DEFAULT_URL = "http://localhost:3030";

export default function ScreenPipeSettingsPage() {
  const { t } = useTranslation();

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [exclude, setExclude] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const markDirty = useCallback(() => {
    setDirty(true);
    setSavedAt(null);
  }, []);

  const applyServer = useCallback((data: ScreenPipeSettings) => {
    setEnabled(Boolean(data.enabled));
    setUrl(data.url || DEFAULT_URL);
    setApiKeySet(Boolean(data.api_key_set));
    setApiKey("");
    setApiKeyDirty(false);
    setWindowMinutes(Number(data.window_minutes) || 10);
    setIncludeAudio(Boolean(data.include_audio));
    setExclude(Array.isArray(data.exclude) ? data.exclude.join(", ") : "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(apiUrl(ENDPOINT));
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ScreenPipeSettings;
        if (!cancelled) applyServer(data);
      } catch {
        /* leave defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyServer]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled,
        url: url.trim() || DEFAULT_URL,
        window_minutes: windowMinutes,
        include_audio: includeAudio,
        exclude: exclude
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
      // Only touch the saved key when the field was edited (blank clears it).
      if (apiKeyDirty) body.api_key = apiKey.trim();

      const res = await apiFetch(apiUrl(ENDPOINT), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ScreenPipeSettings;
      applyServer(data);
      setDirty(false);
      setSavedAt(Date.now());
    } catch {
      setDirty(true);
    } finally {
      setSaving(false);
    }
  }, [
    enabled,
    url,
    apiKey,
    apiKeyDirty,
    windowMinutes,
    includeAudio,
    exclude,
    applyServer,
  ]);

  const handleTest = useCallback(async () => {
    setTest({ kind: "testing" });
    try {
      const res = await apiFetch(apiUrl(TEST_ENDPOINT), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() || DEFAULT_URL }),
      });
      const data = (await res.json()) as { reachable: boolean; status: string };
      setTest(
        data.reachable
          ? { kind: "ok", status: data.status || "ok" }
          : { kind: "fail", status: data.status || "unreachable" },
      );
    } catch {
      setTest({ kind: "fail", status: "unreachable" });
    }
  }, [url]);

  const toggleClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
      on ? "bg-[var(--primary)]" : "bg-[var(--border)]"
    }`;
  const knobClass = (on: boolean) =>
    `inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
      on ? "translate-x-[22px]" : "translate-x-[2px]"
    }`;

  return (
    <div>
      <SettingsPageHeader
        title={t("ScreenPipe")}
        description={t(
          "ScreenPipe is an optional, locally running screen recorder. When enabled, the live voice tutor pulls your recent on-screen text and uses it as background context at the start of each voice session.",
        )}
      />

      <SettingSection
        title={t("Connection")}
        description={t(
          "ScreenPipe runs on your machine and exposes a local API (default http://localhost:3030). Nothing is sent unless ScreenPipe is installed, running, and reachable.",
        )}
      >
        <SettingRow
          title={t("Enable ScreenPipe context")}
          description={t(
            "Inject recent screen activity into the live voice tutor's instructions. Off by default for privacy.",
          )}
          control={
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={loading}
              onClick={() => {
                setEnabled((v) => !v);
                markDirty();
              }}
              className={toggleClass(enabled)}
            >
              <span className={knobClass(enabled)} />
            </button>
          }
        />

        <SettingRow
          title={t("Server URL")}
          description={t("Base URL of your local ScreenPipe API.")}
          control={
            <input
              type="text"
              value={url}
              disabled={loading}
              placeholder={DEFAULT_URL}
              onChange={(e) => {
                setUrl(e.target.value);
                markDirty();
                setTest({ kind: "idle" });
              }}
              className={`${inputClass} w-[260px]`}
              spellCheck={false}
            />
          }
        />

        <SettingRow
          title={t("API key")}
          description={t(
            "Optional. Newer ScreenPipe builds require a local API key (SCREENPIPE_LOCAL_API_KEY) for search.",
          )}
          control={
            <input
              type="password"
              value={apiKey}
              disabled={loading}
              placeholder={apiKeySet ? "•••••••• (saved)" : t("Optional")}
              onChange={(e) => {
                setApiKey(e.target.value);
                setApiKeyDirty(true);
                markDirty();
              }}
              className={`${inputClass} w-[260px]`}
              spellCheck={false}
              autoComplete="off"
            />
          }
        />

        <SettingRow
          title={t("Test connection")}
          description={t("Check whether ScreenPipe is reachable at the URL above.")}
          control={
            <div className="flex items-center gap-3">
              <TestResult test={test} t={t} />
              <button
                type="button"
                onClick={handleTest}
                disabled={loading || test.kind === "testing"}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
              >
                {test.kind === "testing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MonitorPlay className="h-3.5 w-3.5" />
                )}
                {t("Test")}
              </button>
            </div>
          }
        />
      </SettingSection>

      <SettingSection
        title={t("Context & privacy")}
        description={t(
          "Control how much recent activity is included and exclude sensitive apps. Keyboard and clipboard capture are never sent.",
        )}
      >
        <SettingRow
          title={t("Look-back window (minutes)")}
          description={t("How far back to pull recent activity (1–120).")}
          control={
            <input
              type="number"
              min={1}
              max={120}
              value={windowMinutes}
              disabled={loading}
              onChange={(e) => {
                const n = Number(e.target.value);
                setWindowMinutes(Number.isFinite(n) ? n : 10);
                markDirty();
              }}
              className={`${inputClass} w-[100px]`}
            />
          }
        />

        <SettingRow
          title={t("Include audio transcriptions")}
          description={t(
            "Also include recent transcribed audio (meetings, calls, media) in addition to screen text.",
          )}
          control={
            <button
              type="button"
              role="switch"
              aria-checked={includeAudio}
              disabled={loading}
              onClick={() => {
                setIncludeAudio((v) => !v);
                markDirty();
              }}
              className={toggleClass(includeAudio)}
            >
              <span className={knobClass(includeAudio)} />
            </button>
          }
        />

        <SettingRow
          title={t("Excluded apps / windows")}
          description={t(
            "Comma- or newline-separated. Any row whose app name or window title contains one of these is dropped (e.g. 1Password, Banking, Messages).",
          )}
          control={
            <textarea
              value={exclude}
              disabled={loading}
              rows={3}
              placeholder="1Password, Banking, Messages"
              onChange={(e) => {
                setExclude(e.target.value);
                markDirty();
              }}
              className={`${inputClass} w-[260px] resize-y`}
              spellCheck={false}
            />
          }
        />
      </SettingSection>

      <div className="flex items-center justify-end gap-3">
        {savedAt && !dirty && (
          <span className="text-[12px] text-[var(--muted-foreground)]">
            {t("Saved")}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || saving || !dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-[13px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

function TestResult({
  test,
  t,
}: {
  test: TestState;
  t: (key: string) => string;
}) {
  if (test.kind === "ok") {
    const detail = test.status && test.status !== "ok" ? ` (${test.status})` : "";
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("Reachable")}
        {detail}
      </span>
    );
  }
  if (test.kind === "fail") {
    const detail =
      test.status && test.status !== "unreachable" ? ` (${test.status})` : "";
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        {t("Unreachable")}
        {detail}
      </span>
    );
  }
  return null;
}
